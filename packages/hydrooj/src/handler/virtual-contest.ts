import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { ContestNotFoundError, ContestScoreboardHiddenError, localizedErrorText, ForbiddenError, PermissionError, ValidationError } from '../error';
import { ioiVirtualBoardStatus, rankIoiVirtualAttempts } from '../lib/contest-ioi-standing';
import { projectCurrentSetTdoc } from '../lib/set-problem-access';
import { buildVirtualContestSnapshot, rankVirtualAttempts, syntheticVirtualContestDoc, virtualContestRule } from '../lib/virtual-contest';
import { sameReplaySnapshot, supportsContestReplay } from '../lib/virtual-contest-replay';
import { readContestReplay } from '../model/virtual-contest-replay';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import problem from '../model/problem';
import record from '../model/record';
import user from '../model/user';
import {
    canManageVirtualContest,
    virtualContestService,
    type VirtualContestAttemptDoc,
} from '../model/virtual-contest';
import * as oplog from '../model/oplog';
import { param, Types } from '../service/server';
import { ContestDetailBaseHandler, requireContestViewUnlessEditor } from './contest';

const logger = new Logger('virtual-contest-handler');

function publicAttempt(attempt: VirtualContestAttemptDoc, canManage = false, revealLocked = true) {
    return {
        _id: attempt._id,
        uid: attempt.uid,
        status: attempt.status,
        startAt: attempt.startAt,
        endAt: attempt.endAt,
        endedAt: attempt.endedAt,
        firstRecordAt: attempt.firstRecordAt,
        snapshot: {
            rule: attempt.snapshot.rule,
            pids: attempt.snapshot.pids,
            title: attempt.snapshot.title,
            durationMs: attempt.snapshot.durationMs,
        },
        accept: attempt.accept || 0,
        time: attempt.time || 0,
        score: attempt.score || 0,
        penaltyScore: attempt.penaltyScore || 0,
        detail: attempt.status === 'active' && !revealLocked ? attempt.display || attempt.detail : attempt.detail,
        remainingMs: attempt.status === 'active' ? Math.max(0, attempt.endAt.getTime() - Date.now()) : 0,
        rev: attempt.rev,
        voidConfirmation: canManage ? `VOID-VP:${attempt._id.toHexString()}:${attempt.rev}` : undefined,
    };
}

function attemptRankStats(attempt: VirtualContestAttemptDoc): Record<string, unknown> {
    return {
        accept: attempt.accept || 0,
        time: attempt.time || 0,
        score: attempt.score || 0,
        maxPoints: attempt.maxPoints,
        penaltyScore: attempt.penaltyScore || 0,
    };
}

function assertAttemptContest(attempt: { sourceContestId: ObjectId }, tid: ObjectId) {
    if (String(attempt.sourceContestId) !== String(tid)) throw new ValidationError('attemptId');
}

export class VirtualContestHandler extends ContestDetailBaseHandler {
    async prepare() {
        requireContestViewUnlessEditor(this, this.tdoc);
        if (!this.tdoc.setConfig && contest.RULES[this.tdoc.rule]?.hidden) throw new ContestNotFoundError(this.authoritativeDomainId(), this.tdoc.docId);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = this.authoritativeDomainId();
        const { tdoc, eligibility } = await virtualContestService.inspectEligibility(domainId, tid, undefined, this.tsdoc?.attend === 1);
        const attempt = await virtualContestService.getOfficialAttempt(domainId, tid, this.user._id);
        const canManage = canManageVirtualContest(this.user, tdoc);
        let pdict = {};
        if (attempt && (attempt.status === 'active' || attempt.status === 'ended' || canManage)) {
            pdict = await problem.getList(domainId, attempt.snapshot.pids, true, true, problem.PROJECTION_CONTEST_LIST, true);
        }
        const adminAttempts = canManage
            ? await (async () => {
                  const rows = await virtualContestService.listByContest(domainId, tid);
                  const uids = Array.from(new Set(rows.map((row) => row.uid)));
                  const udict = await user.getListForRender(domainId, uids, ['displayName']);
                  return rows.map((row) => ({
                      ...publicAttempt(row, true, row.status !== 'active' || row.uid === this.user._id),
                      uname: udict[row.uid]?.uname || String(row.uid),
                  }));
              })()
            : [];
        const replayAllowed = attempt && eligibility.allowed && await canOpenReplay(this, attempt);
        const comparable = replayAllowed && sameReplaySnapshot(buildVirtualContestSnapshot(tdoc), attempt.snapshot);
        this.response.template = 'contest_virtual.html';
        this.response.body = {
            tdoc: await projectCurrentSetTdoc(this.tdoc, this.user._id, canManage, this.tsdoc),
            eligibility,
            attempt: attempt ? publicAttempt(attempt, canManage) : null,
            replayUrl: comparable ? this.url('contest_virtual_replay', { tid }) : null,
            replayUnavailable: replayAllowed && !comparable ? '本次 VP 的试卷或计分规则与当前比赛不同，成绩保留在参赛工作台。' : null,
            pdict,
            canManage,
            isolation: attempt?.status === 'active',
            adminAttempts,
            postContestPractice: { supported: true, open: contest.isDone(this.tdoc), eligible: false },
        };
        this.response.addHeader('Cache-Control', 'no-store');
    }

    @param('tid', Types.ObjectId)
    async postStart(_domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const attempt = await virtualContestService.start({
            domainId: this.authoritativeDomainId(),
            sourceContestId: tid,
            uid: this.user._id,
            attended: this.tsdoc?.attend === 1,
        });
        await oplog.log(this, 'contest.virtual.start', { tid, attemptId: attempt._id });
        this.response.redirect = this.url('contest_virtual', { tid });
    }

    @param('tid', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    async postCancel(_domainId: string, tid: ObjectId, attemptId: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const current = await virtualContestService.getAttempt(this.authoritativeDomainId(), attemptId);
        assertAttemptContest(current, tid);
        await virtualContestService.cancel({ domainId: this.authoritativeDomainId(), attemptId, uid: this.user._id });
        await oplog.log(this, 'contest.virtual.cancel', { tid, attemptId });
        this.response.redirect = this.url('contest_virtual', { tid });
    }

    @param('tid', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    async postEnd(_domainId: string, tid: ObjectId, attemptId: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const current = await virtualContestService.getAttempt(this.authoritativeDomainId(), attemptId);
        assertAttemptContest(current, tid);
        await virtualContestService.end({
            domainId: this.authoritativeDomainId(),
            attemptId,
            actor: this.user,
            uid: this.user._id,
        });
        await oplog.log(this, 'contest.virtual.end', { tid, attemptId });
        this.response.redirect = this.url('contest_virtual', { tid });
    }

    @param('tid', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    @param('confirmation', Types.String)
    async postVoid(_domainId: string, tid: ObjectId, attemptId: ObjectId, confirmation: string) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const current = await virtualContestService.getAttempt(this.authoritativeDomainId(), attemptId);
        assertAttemptContest(current, tid);
        await virtualContestService.voidAttempt({
            domainId: this.authoritativeDomainId(),
            attemptId,
            actor: this.user,
            confirmation,
        });
        await oplog.log(this, 'contest.virtual.void', { tid, attemptId });
        this.response.redirect = this.url('contest_virtual', { tid });
    }
}

async function canOpenReplay(handler: ContestDetailBaseHandler, mine: VirtualContestAttemptDoc) {
    const { tdoc } = handler;
    return handler.user.hasPerm(PERM.PERM_VIEW_CONTEST_SCOREBOARD)
        && mine.uid === handler.user._id && (mine.status === 'active' || mine.status === 'ended')
        && (mine.snapshot.rule === 'acm' || mine.snapshot.rule === 'ioi') && supportsContestReplay(tdoc)
        && (!tdoc._code || handler.tsdoc?.attend === 1)
        && (tdoc.setConfig?.settings.scoreboard !== 'after_end' || mine.status === 'ended')
        && await contest.canShowScoreboardForUser.call(handler, tdoc, false);
}

export class VirtualContestReplayHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    @param('at', Types.UnsignedInt, true)
    async get(_domainId: string, tid: ObjectId, at?: number) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        requireContestViewUnlessEditor(this, this.tdoc);
        this.response.addHeader('Cache-Control', 'private, no-store');
        const mine = await virtualContestService.getOfficialAttempt(this.authoritativeDomainId(), tid, this.user._id);
        if (!mine || !await canOpenReplay(this, mine)) throw new ContestScoreboardHiddenError(tid);
        this.response.template = null;
        this.response.body = { replay: await readContestReplay(this.tdoc, mine, this.user, at) };
    }
}

export class VirtualContestScoreboardHandler extends ContestDetailBaseHandler {
    async prepare() {
        requireContestViewUnlessEditor(this, this.tdoc);
        if (!this.tdoc.setConfig && contest.RULES[this.tdoc.rule]?.hidden) throw new ContestNotFoundError(this.authoritativeDomainId(), this.tdoc.docId);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = this.authoritativeDomainId();
        const canManage = canManageVirtualContest(this.user, this.tdoc);
        const mine = await virtualContestService.getOfficialAttempt(domainId, tid, this.user._id);
        if (!canManage && mine?.status === 'active') {
            throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
        }
        if (!canManage && mine?.status !== 'ended') {
            throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛尚未开始`);
        }
        let attempts = virtualContestService.boardAttempts(await virtualContestService.listByContest(domainId, tid), {
            includeActive: canManage,
        });
        const boardSource = mine ?? attempts[0];
        if (boardSource) attempts = attempts.filter((row) => row.snapshot.pointSignature === boardSource.snapshot.pointSignature);
        if (boardSource && this.tdoc.setConfig?.settings.draw.enabled) {
            attempts = attempts.filter((row) => row.snapshot.drawSignature === boardSource.snapshot.drawSignature);
        }
        if (boardSource && attempts.length) {
            const current = virtualContestRule(this.tdoc) ? buildVirtualContestSnapshot(this.tdoc) : null;
            const reference = current && sameReplaySnapshot(current, boardSource.snapshot) ? current : boardSource.snapshot;
            if (attempts.some((row) => !sameReplaySnapshot(reference, row.snapshot))) {
                throw new ValidationError('snapshot', null, localizedErrorText`虚拟参赛快照不一致`);
            }
        }
        const boardRuleName = boardSource?.snapshot.rule || virtualContestRule(this.tdoc);
        const scoreOnly = this.tdoc.setConfig?.purpose === 'contest' && boardRuleName === 'ioi';
        const rule = contest.RULES[scoreOnly ? 'oi' : boardRuleName];
        if (!rule?.scoreboardHeader || !rule.scoreboardRow) throw new ValidationError('rule', null, localizedErrorText`该赛制不支持虚拟参赛`);
        const boardPids = boardSource?.snapshot.pids || this.tdoc.pids;
        const uids = Array.from(new Set(attempts.map((attempt) => attempt.uid)));
        const [udict, pdict] = await Promise.all([
            user.getListForRender(domainId, uids, ['displayName']),
            problem.getList(domainId, boardPids, true, true, problem.PROJECTION_CONTEST_LIST, true),
        ]);
        const boardDoc = boardSource
            ? syntheticVirtualContestDoc({
                  domainId,
                  sourceContestId: tid,
                  snapshot: boardSource.snapshot,
                  startAt: boardSource.startAt,
                  endAt: boardSource.endAt,
                  unlocked: true,
              })
            : { ...this.tdoc, pids: boardPids, lockAt: undefined, unlocked: true };
        const ioiBoard = boardRuleName === 'ioi' && !scoreOnly;
        const ranked = ioiBoard
            ? rankIoiVirtualAttempts(boardPids, attempts)
            : rankVirtualAttempts(attempts, rule.statusSort || { accept: -1, time: 1 }, attemptRankStats);
        const translate = ioiBoard ? this.translate.bind(this) : (text: string) => text;
        const scoreboardConfig = { isExport: false, showDisplayName: false };
        const columns = await rule.scoreboardHeader(scoreboardConfig, translate, boardDoc, pdict);
        const rows = [
            columns,
            ...(await Promise.all(
                ranked.map(async ([rank, attempt]) => {
                    const udoc = udict[attempt.uid] || { _id: attempt.uid, uname: `#${attempt.uid}`, mail: '', avatar: '' };
                    const virtualStatus = ioiBoard ? ioiVirtualBoardStatus(attempt) : null;
                    const rowContest = virtualStatus ? { ...boardDoc, beginAt: virtualStatus.startAt, duration: 1 } : boardDoc;
                    const row = await rule.scoreboardRow(scoreboardConfig, translate, rowContest, pdict, udoc, rank, {
                        uid: attempt.uid,
                        accept: attempt.accept,
                        time: attempt.time,
                        score: attempt.score,
                        penaltyScore: attempt.penaltyScore,
                        journal: attempt.journal,
                        startAt: virtualStatus?.startAt,
                        detail: virtualStatus ? virtualStatus.detail : attempt.status === 'active' ? attempt.display || attempt.detail : attempt.detail,
                        display: attempt.display,
                    });
                    const total = row.find((cell) => cell.type === 'total_score');
                    if (total && attempt.maxPoints !== undefined) {
                        const score = attempt.score ?? 0;
                        total.score = score;
                        total.value = `${score}/${attempt.maxPoints}`;
                        if (attempt.maxPoints > 0) total.scorePercentage = 100 * score / attempt.maxPoints;
                    }
                    return row;
                }),
            )),
        ];
        this.response.template = 'contest_virtual_scoreboard.html';
        this.response.body = {
            tdoc: boardSource?.snapshot.drawSignature ? boardDoc : await projectCurrentSetTdoc(this.tdoc, this.user._id, canManage, this.tsdoc),
            rows,
            pdict,
            udict,
            virtual: true,
            canManage,
        };
        this.response.addHeader('Cache-Control', 'no-store');
    }
}

export class VirtualContestRejudgeHandler extends ContestDetailBaseHandler {
    async prepare() {
        if (!canManageVirtualContest(this.user, this.tdoc)) {
            throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
        }
    }

    @param('tid', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    @param('pid', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, attemptId: ObjectId, pid?: number) {
        const domainId = this.authoritativeDomainId();
        const attempt = await virtualContestService.getAttempt(domainId, attemptId);
        if (String(attempt.sourceContestId) !== String(tid)) throw new ValidationError('attemptId');
        const query: Record<string, unknown> = {
            domainId,
            virtualAttemptId: attemptId,
            uid: attempt.uid,
            status: { $ne: STATUS.STATUS_CANCELED },
        };
        if (pid) query.pid = pid;
        const rdocs = await record
            .getMulti(domainId, query)
            .project({ _id: 1, pid: 1, status: 1, uid: 1 })
            .toArray();
        this.response.template = 'contest_virtual.html';
        this.response.body = {
            tdoc: this.tdoc,
            rejudgePreview: {
                attemptId,
                pid: pid || null,
                count: rdocs.length,
                recordIds: rdocs.map((rdoc) => rdoc._id),
                snapshotRule: attempt.snapshot.rule,
            },
        };
    }

    @param('tid', Types.ObjectId)
    @param('attemptId', Types.ObjectId)
    @param('pid', Types.PositiveInt, true)
    @param('confirmation', Types.String)
    async post(_domainId: string, tid: ObjectId, attemptId: ObjectId, pid: number | undefined, confirmation: string) {
        const domainId = this.authoritativeDomainId();
        const attempt = await virtualContestService.getAttempt(domainId, attemptId);
        if (String(attempt.sourceContestId) !== String(tid)) throw new ValidationError('attemptId');
        const query: Record<string, unknown> = {
            domainId,
            virtualAttemptId: attemptId,
            uid: attempt.uid,
            status: { $ne: STATUS.STATUS_CANCELED },
        };
        if (pid) query.pid = pid;
        const rdocs = await record.getMulti(domainId, query).project({ _id: 1 }).toArray();
        const expected = `REJUDGE-VP:${attemptId.toHexString()}:${rdocs.length}`;
        if (confirmation !== expected) throw new ValidationError('confirmation', null, localizedErrorText`确认后才能重测虚拟参赛记录`);
        if (rdocs.length) {
            const priority = await record.submissionPriority(this.user._id, -10000 - rdocs.length * 5);
            await record.reset(
                domainId,
                rdocs.map((rdoc) => rdoc._id),
                true,
            );
            await record.judge(
                domainId,
                rdocs.map((rdoc) => rdoc._id),
                priority,
                {},
                { rejudge: true },
            );
        }
        logger.info(
            'Virtual contest rejudge queued domain=%s contest=%s attempt=%s pid=%s count=%d actor=%d stage=rejudge result=success',
            domainId,
            tid,
            attemptId,
            pid || 'all',
            rdocs.length,
            this.user._id,
        );
        await oplog.log(this, 'contest.virtual.rejudge', { tid, attemptId, pid, count: rdocs.length });
        this.response.redirect = this.url('contest_virtual', { tid });
    }
}

export async function apply(ctx: any) {
    ctx.Route('contest_virtual', '/contest/:tid/virtual', VirtualContestHandler);
    ctx.Route('contest_virtual_replay', '/contest/:tid/virtual/replay', VirtualContestReplayHandler, PERM.PERM_VIEW_CONTEST_SCOREBOARD);
    ctx.Route('contest_virtual_scoreboard', '/contest/:tid/virtual/scoreboard', VirtualContestScoreboardHandler);
    ctx.Route('contest_virtual_rejudge', '/contest/:tid/virtual/rejudge', VirtualContestRejudgeHandler);
}
