import { Readable } from 'stream';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { stringify as toCSV } from 'csv-stringify/sync';
import { readFile } from 'fs-extra';
import { escapeRegExp, pick } from 'lodash';
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { Counter, getAlphabeticId, Logger, randomstring, sortFiles, Time, yaml } from '@hydrooj/utils/lib/utils';
import { Context, Service } from '../context';
import {
    localizeError,
    localizedErrorText,
    BadRequestError,
    ContestClientFinishedError,
    ContestClientRequiredError,
    ContestNotAttendedError,
    ContestNotEndedError,
    ContestNotFoundError,
    ContestNotLiveError,
    ContestScoreboardHiddenError,
    FileLimitExceededError,
    FileUploadError,
    InvalidTokenError,
    MethodNotAllowedError,
    NotAssignedError,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '../error';
import { FileInfo, ScoreboardConfig, Tdoc } from '../interface';
import { canUsePostContestPractice, getPostContestPracticeState } from '../lib/contest-correction';
import { assertIndividualContestUnrankAllowed } from '../lib/contest-unrank';
import { isContestGloballyEnded } from '../lib/virtual-contest';
import { virtualContestService } from '../model/virtual-contest';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { getScoreboardExportCapabilities, getScoreboardSnapshotMode } from '../lib/contest-scoreboard-export';
import {
    buildLatestContestProblemStatusByPid,
    buildPersonalPracticeRecordQuery,
    buildPersonalPracticeStatusByPid,
    PersonalPracticeRecord,
} from '../lib/contest-problem-status';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import * as contestTeamBatch from '../model/contest-team-batch';
import * as contestTeamStatus from '../model/contest-team-status';
import * as discussion from '../model/discussion';
import * as document from '../model/document';
import { assertHomeworkAccess } from '../model/homework-access';
import message from '../model/message';
import * as oplog from '../model/oplog';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import record from '../model/record';
import ScheduleModel from '../model/schedule';
import storage from '../model/storage';
import user from '../model/user';
import { Handler, param, post, Type, Types } from '../service/server';

const logger = new Logger('contest-handler');

async function listContestScopeGroups(domainId: string, required: boolean): Promise<any[]> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.listUserGroups !== 'function') {
        if (required) throw new TypeError('userbind.listUserGroups is unavailable');
        return [];
    }
    try {
        return await userbind.listUserGroups(domainId);
    } catch (error) {
        logger.error('Contest group catalog lookup failed domain=%s error=%o', domainId, error);
        if (required) throw error;
        return [];
    }
}

function serializedContestEdit(_target: unknown, _key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = async function contestEditBoundary(this: ContestEditHandler, ...args: any[]) {
        const tid = args[1] as ObjectId | null;
        if (!tid) return original.apply(this, args);
        const domainId = String(this.domain?._id);
        return await withContestEditBoundary(domainId, tid, async (waited) => {
            if (waited) this.tdoc = await contest.get(domainId, tid);
            return await original.apply(this, args);
        });
    };
    return descriptor;
}

async function currentTeamContext(domainId: string, tdoc: Tdoc, uid: number) {
    if (contest.getParticipationMode(tdoc) !== 'team') return { team: null, status: null };
    const team = await contestTeam.getTeamByMember(domainId, tdoc.docId, uid);
    const status = team ? await contestTeamStatus.get(domainId, tdoc.docId, team.teamId) : null;
    return { team, status };
}

function publicTeamStatus(status: contestTeamStatus.TeamContestStatusDoc | null) {
    return status ? pick(status, ['teamId', 'score', 'accept', 'time', 'detail', 'display', 'updatedAt']) : null;
}

function parseProblemDocIds(input: string) {
    const tokens = input
        .replace(/，/g, ',')
        .split(',')
        .map((i) => i.trim())
        .filter(Boolean);
    const pids = tokens.map((i) => Number(i));
    if (!pids.every((i) => Number.isSafeInteger(i) && i > 0)) throw new ValidationError('pids');
    return pids;
}

async function assertCanPublishAutoHiddenProblems(domainId: string, pids: number[], actor: any) {
    const uniquePids = Array.from(new Set(pids));
    const pdict = await problem.getList(domainId, uniquePids, true, false, [...problem.PROJECTION_PUBLIC, 'pidNamespaceId'], true);
    const pdocs = uniquePids.map((pid) => pdict[pid]).filter(Boolean);
    // Evaluate every existing target before deciding, so the sequential writes
    // never begin a partially authorized hide batch. Missing and unauthorized
    // references intentionally collapse to the same capability error.
    let allPublishable = pdocs.length === uniquePids.length;
    for (const pdoc of pdocs) {
        if (!problem.canPublishProblem(actor, pdoc)) allPublishable = false;
    }
    if (!allPublishable) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
}

export async function autoUnhideContestProblem(domainId: string, contestId: ObjectId | string, pid: number): Promise<void> {
    const pdoc = await problem.get(domainId, pid);
    if (!pdoc) {
        logger.warn('Contest auto-publish skipped missing problem domain=%s contest=%s pid=%d stage=unhide result=skipped', domainId, contestId, pid);
        return;
    }
    if (pdoc.authoringMode === 'managed') {
        await problem.autoRevealConfirmedManagedProgrammingProblem({ domainId, docId: pid, contestId });
        return;
    }
    if ((pdoc as any).lockHidden) {
        logger.info(
            'Contest auto-publish retained explicitly locked problem domain=%s contest=%s pid=%d stage=unhide result=locked',
            domainId,
            contestId,
            pid,
        );
        return;
    }
    await problem.edit(domainId, pid, { hidden: false });
}

function contestUnhideTask(domainId: string, tid: ObjectId | string) {
    return {
        type: 'schedule',
        subType: 'contest',
        domainId,
        tid,
    };
}

async function scheduleContestUnhide(domainId: string, tid: ObjectId | string, executeAfter: Date, pids?: number[]) {
    const task = contestUnhideTask(domainId, tid);
    const scheduleId = await ScheduleModel.add({
        ...task,
        operation: ['unhide'],
        ...(pids?.length ? { pids } : {}),
        executeAfter,
        // WorkerService atomically moves contest-unhide tasks into a short
        // retry window before invoking handlers. The handler deletes that
        // retained task only after the complete visibility transition
        // succeeds.
        interval: [1, 'minute'],
    });
    await ScheduleModel.deleteMany({ ...task, _id: { $ne: scheduleId } });
}

async function unhideContestProblems(
    domainId: string,
    tid: ObjectId | string,
    pids: number[],
    stage: string,
    actor?: number,
    onFailure?: (remainingPids: number[], error: unknown) => Promise<void>,
): Promise<void> {
    const acknowledgedPids: number[] = [];
    try {
        for (const pid of pids) {
            await autoUnhideContestProblem(domainId, tid, pid);
            acknowledgedPids.push(pid);
        }
    } catch (error) {
        logger.error(
            'Contest auto-unhide failed domain=%s contest=%s actor=%s acknowledged=%j failedPid=%s unattempted=%j stage=%s error=%o',
            domainId,
            tid,
            actor ?? 'worker',
            acknowledgedPids,
            pids[acknowledgedPids.length],
            pids.slice(acknowledgedPids.length + 1),
            stage,
            error,
        );
        if (onFailure) await onFailure(pids.slice(acknowledgedPids.length), error);
        throw error;
    }
}

export async function runContestScheduleTask(doc: any): Promise<void> {
    await withContestEditBoundary(doc.domainId, doc.tid, async () => {
        let tdoc: Tdoc;
        try {
            tdoc = await contest.get(doc.domainId, doc.tid);
        } catch (error) {
            if (error instanceof ContestNotFoundError || (error as Error)?.name === 'ContestNotFoundError') {
                await ScheduleModel.deleteMany(contestUnhideTask(doc.domainId, doc.tid));
                logger.info(
                    'Contest unhide schedule removed for deleted contest domain=%s contest=%s stage=load-contest result=deleted',
                    doc.domainId,
                    doc.tid,
                );
                return;
            }
            throw error;
        }
        if (!tdoc || !doc.operation?.includes('unhide')) return;
        const hasTrackedPids = Array.isArray(tdoc.autoHideProblemPids);
        const trackedPids = hasTrackedPids ? tdoc.autoHideProblemPids : undefined;
        if (hasTrackedPids && !trackedPids.length) {
            await ScheduleModel.deleteMany(contestUnhideTask(doc.domainId, doc.tid));
            return;
        }
        const endAt = tdoc.endAt instanceof Date ? tdoc.endAt : new Date(tdoc.endAt);
        if (tdoc.autoHide && Number.isFinite(endAt.getTime()) && Date.now() < endAt.getTime()) {
            await scheduleContestUnhide(doc.domainId, doc.tid, endAt, trackedPids);
            logger.warn(
                'Contest unhide schedule was stale and has been replaced domain=%s contest=%s staleExecuteAfter=%s authoritativeEndAt=%s stage=reschedule result=success',
                doc.domainId,
                doc.tid,
                doc.executeAfter instanceof Date ? doc.executeAfter.toISOString() : String(doc.executeAfter),
                endAt.toISOString(),
            );
            return;
        }
        const targetPids = trackedPids || (Array.isArray(doc.pids) && doc.pids.length ? doc.pids : tdoc.pids);
        await unhideContestProblems(doc.domainId, doc.tid, targetPids, 'worker-unhide', undefined, async (remainingPids, error) => {
            const recoveryErrors: unknown[] = [];
            try {
                await scheduleContestUnhide(doc.domainId, doc.tid, new Date(Date.now() + Time.minute), remainingPids);
            } catch (scheduleError) {
                recoveryErrors.push(scheduleError);
            }
            try {
                await document.set(doc.domainId, document.TYPE_CONTEST, doc.tid, {
                    autoHidePendingPids: remainingPids,
                    autoHideProblemPids: remainingPids,
                });
            } catch (markerError) {
                recoveryErrors.push(markerError);
            }
            if (recoveryErrors.length) {
                throw new AggregateError(
                    [error, ...recoveryErrors],
                    `Contest ${doc.tid} auto-unhide failed and its retry state could not be fully persisted`,
                );
            }
        });
        await document.set(doc.domainId, document.TYPE_CONTEST, doc.tid, {
            autoHidePendingPids: [],
            autoHideProblemPids: [],
        });
        await ScheduleModel.deleteMany(contestUnhideTask(doc.domainId, doc.tid));
    });
}

function parseStringList(value: any): string[] {
    const raw = Array.isArray(value) ? value.join('\n') : String(value || '');
    return raw
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePortList(value: any): number[] {
    const ports = parseStringList(value)
        .map((item) => Number(item))
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
    return Array.from(new Set(ports));
}

export class ContestListHandler extends Handler {
    @param('rule', Types.Range(contest.RULES), true)
    @param('group', Types.Name, true)
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, rule = '', group = '', page = 1, q = '') {
        const authoritativeDomainId = String(this.domain?._id);
        if (rule && contest.RULES[rule].hidden) throw new BadRequestError();
        const groups = (
            await user.listGroup(authoritativeDomainId, this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST) ? undefined : this.user._id)
        ).map((i) => i.name);
        if (group && !groups.includes(group)) throw new NotAssignedError(group);
        const rules = Object.keys(contest.RULES).filter((i) => !contest.RULES[i].hidden);
        const escaped = escapeRegExp(q.toLowerCase());
        const $regex = new RegExp(q.length >= 2 ? escaped : `\\A${escaped}`, 'gim');
        const filter = {
            ...(this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST) && !group
                ? {}
                : {
                      $or: [{ maintainer: this.user._id }, { owner: this.user._id }, { assign: { $in: groups } }, { assign: { $size: 0 } }],
                  }),
            ...(rule ? { rule } : { rule: { $in: rules } }),
            ...(group ? { assign: { $in: [group] } } : {}),
            ...(q ? { title: { $regex } } : {}),
        };
        await this.ctx.parallel('contest/list', filter, this);
        const cursor = contest.getMulti(authoritativeDomainId, filter).sort({ endAt: -1, beginAt: -1, _id: -1 });
        let qs = rule ? `rule=${rule}` : '';
        if (group) qs += qs ? `&group=${group}` : `group=${group}`;
        if (q) qs += `${qs ? '&' : ''}q=${encodeURIComponent(q)}`;
        const [tdocs, tpcount] = await this.paginate(cursor, page, 'contest');
        const tids = [];
        for (const tdoc of tdocs) tids.push(tdoc.docId);
        const tsdict = await contest.getListStatus(authoritativeDomainId, this.user._id, tids);
        const groupsFilter = groups.filter((i) => !Number.isSafeInteger(+i));
        this.response.template = 'contest_main.html';
        this.response.body = {
            page,
            tpcount,
            qs,
            rule,
            rules: Object.fromEntries(rules.map((i) => [i, contest.RULES[i].TEXT])),
            tdocs,
            tsdict,
            groups: groupsFilter,
            group,
            q,
        };
    }
}

export class ContestDetailBaseHandler extends Handler {
    tdoc?: Tdoc;
    tsdoc?: any;

    protected authoritativeDomainId(): string {
        return String(this.domain?._id);
    }

    @param('tid', Types.ObjectId, true)
    async __prepare(_domainId: string, tid: ObjectId) {
        if (!tid) return; // ProblemDetailHandler also extends from ContestDetailBaseHandler
        const authoritativeDomainId = String(this.domain?._id);
        [this.tdoc, this.tsdoc] = await Promise.all([
            contest.get(authoritativeDomainId, tid),
            contest.getStatus(authoritativeDomainId, tid, this.user._id),
        ]);
        const postContestPracticeEligible = canUsePostContestPractice(this.tdoc, this.tsdoc);
        if (this.tdoc.rule === 'homework') {
            await assertHomeworkAccess(authoritativeDomainId, this.tdoc, this.user);
        } else {
            if (
                this.tdoc.assign?.length &&
                !postContestPracticeEligible &&
                !this.user.own(this.tdoc) &&
                !this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)
            ) {
                const groups = await user.listGroup(authoritativeDomainId, this.user._id);
                if (!new Set(this.tdoc.assign).intersection(new Set(groups.map((i) => i.name))).size) {
                    throw new NotAssignedError(localizedErrorText`contest`, tid);
                }
            }
            // ── Krypton: client-required contest gate ────────────────────────
            //
            // Two-part overlay layered on top of the legacy `assign` check above:
            //   (a) Participant scope (school / group) — must match the user's
            //       StudentRecord. Off when participantScopeMode==='none'.
            //   (b) Client-required gate — when entryMode==='client_required',
            //       the request must carry an active vigil.client_sessions row
            //       bound to *this* contestId (single-contest binding).
            //
            // Admins / owner / maintainer bypass both for diagnostics and
            // preview mode (DESIGN §11.3). Preview mode is signaled to the UI
            // via `this.response.body.previewMode` so the frontend can show a
            // banner; that gets set by the concrete handler that needs it.
            const isAdminBypass = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
            if (!isAdminBypass) {
                // The client-required gate (must enter through the locked-down Vigil
                // client) protects exam integrity only WHILE the contest is running.
                // Once it has ended, lift it so participants can review the problems
                // and the scoreboard from an ordinary browser — otherwise the
                // post-contest "外部榜单" is visible to admins only. Uses the global
                // endAt (isDone(tdoc) without tsdoc) so a per-user duration expiring
                // early can't open the scoreboard while others are still competing.
                // Participant scope (scope_miss) is eligibility, not integrity, so it
                // stays enforced regardless.
                const contestDone = contest.isDone(this.tdoc);
                if (!contestDone && contest.isClientRequired(this.tdoc) && contest.isClientFinished(this.tsdoc)) {
                    throw new ContestClientFinishedError();
                }
                const vg = (global as any).Hydro?.model?.vigilguard;
                if (vg?.effectiveContestAccess) {
                    const sid = vg.clientSessionKeyFromSession
                        ? vg.clientSessionKeyFromSession((this as any).session)
                        : (this as any).session?.sessionId || (this as any).session?._id || '';
                    const result = await vg.effectiveContestAccess(authoritativeDomainId, this.tdoc, this.user._id, sid);
                    if (!result.ok) {
                        if (result.reason === 'scope_miss' && !postContestPracticeEligible) {
                            throw new NotAssignedError(localizedErrorText`contest`, tid);
                        }
                        if (result.reason === 'client_only' && !contestDone) {
                            throw new ContestClientRequiredError();
                        }
                    }
                }
            }
        }
        if (this.tdoc.duration && this.tsdoc?.startAt) {
            const endAt = moment(this.tsdoc.startAt).add(this.tdoc.duration, 'hours').toDate();
            this.tsdoc.endAt = endAt < this.tdoc.endAt ? endAt : this.tdoc.endAt;
        }
    }

    tsdocAsPublic() {
        if (!this.tsdoc) return null;
        return pick(this.tsdoc, ['attend', 'subscribe', 'startAt', ...(this.tdoc.duration ? ['endAt'] : [])]);
    }

    @param('tid', Types.ObjectId, true)
    async after(_domainId: string, tid: ObjectId) {
        if (!tid || this.tdoc.rule === 'homework') return;
        if (this.request.json || !this.response.template) return;
        const pdoc = 'pdoc' in this ? (this as any).pdoc : {};
        this.response.body.overrideNav = [
            {
                name: 'contest_main',
                args: {},
                displayName: 'Back to contest list',
                checker: () => true,
            },
            {
                name: 'contest_detail',
                displayName: this.tdoc.title,
                args: { tid, prefix: 'contest_detail' },
                checker: () => true,
            },
            {
                name: 'contest_problemlist',
                args: { tid, prefix: 'contest_problemlist' },
                checker: () => this.tsdoc?.attend || contest.isDone(this.tdoc),
            },
            {
                name: 'contest_print',
                args: { tid, prefix: 'contest_print' },
                checker: () => this.tdoc.allowPrint && (this.tsdoc?.attend || this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST)),
            },
            {
                name: 'contest_scoreboard',
                args: { tid, prefix: 'contest_scoreboard' },
                checker: () => contest.canShowScoreboard.call(this, this.tdoc, true),
            },
            {
                name: 'problem_detail',
                displayName: `${getAlphabeticId(this.tdoc.pids.indexOf(pdoc.docId))}. ${pdoc.title}`,
                args: { query: { tid }, pid: pdoc.docId, prefix: 'contest_detail_problem' },
                checker: () => 'pdoc' in this,
            },
        ];
    }
}

export class ContestDetailHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        if (contest.RULES[this.tdoc.rule].hidden) throw new ContestNotFoundError(this.authoritativeDomainId(), tid);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        this.response.template = 'contest_detail.html';
        const canManageContest = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);
        const postContestPractice = getPostContestPracticeState(this.tdoc, this.tsdoc);
        // Load contest problem dict so the new UI can render the problem table
        // inline. Older Hydro split this across /contest/:tid (description) and
        // /contest/:tid/problems (table), but Krypton merges them.
        // attend alone is not enough — the contest must also have started.
        // Otherwise a user who clicked "参加比赛" can peek the problem set
        // ahead of time (same bug class the `files` field already guards
        // against below at line ~185, and that `ContestProblemListHandler`
        // already guards at line ~305).
        const canPeekProblems = (this.tsdoc?.attend && !contest.isNotStarted(this.tdoc)) || contest.isDone(this.tdoc) || canManageContest;
        const canViewAllContestProblems =
            !postContestPractice.supported ||
            canManageContest ||
            (!!this.tsdoc?.attend && !contest.isDone(this.tdoc)) ||
            postContestPractice.eligible;
        const [udict, pdict, teamContext, teamCount] = await Promise.all([
            user.getList(authoritativeDomainId, [this.tdoc.owner]),
            canPeekProblems
                ? canViewAllContestProblems
                    ? problem.getList(
                          authoritativeDomainId,
                          this.tdoc.pids,
                          true,
                          true,
                          // PROJECTION_CONTEST_LIST omits nSubmit/nAccept/difficulty/tag —
                          // include them so the detail page can show real pass/submit
                          // counts in its problem table.
                          [...problem.PROJECTION_CONTEST_LIST, 'nSubmit', 'nAccept', 'difficulty', 'tag'],
                          true,
                      )
                    : problem.getListViewableAuthorized(
                          authoritativeDomainId,
                          this.tdoc.pids,
                          this.user,
                          [...problem.PROJECTION_CONTEST_LIST, 'nSubmit', 'nAccept', 'difficulty', 'tag'],
                          false,
                          true,
                      )
                : Promise.resolve({}),
            currentTeamContext(authoritativeDomainId, this.tdoc, this.user._id),
            contest.getParticipationMode(this.tdoc) === 'team'
                ? contestTeam.countActiveTeams(authoritativeDomainId, this.tdoc.docId)
                : Promise.resolve(null),
        ]);
        const psdict = canPeekProblems
            ? contest.getParticipationMode(this.tdoc) === 'team'
                ? teamContext.status?.detail || {}
                : this.tsdoc?.detail || {}
            : {};
        const canViewRecord =
            contest.canShowSelfRecord.call(this, this.tdoc) && (contest.getParticipationMode(this.tdoc) !== 'team' || !!teamContext.team);
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdocAsPublic(),
            udict,
            pdict,
            pids: this.tdoc.pids.filter((pid) => pdict[pid]),
            psdict,
            team: teamContext.team,
            teamStatus: publicTeamStatus(teamContext.status),
            teamCount,
            canManageContest,
            canViewRecord,
            postContestPractice,
            virtualContest: null,
            files: this.tsdoc?.attend && !contest.isNotStarted(this.tdoc) ? sortFiles(this.tdoc.privateFiles || []) : [],
            urlForFile: (filename: string) => this.url('contest_file_download', { tid, filename, type: 'private' }),
        };
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE) && isContestGloballyEnded(this.tdoc)) {
            const inspected = await virtualContestService.inspectEligibility(authoritativeDomainId, tid, undefined, this.tsdoc?.attend === 1);
            const attempt = await virtualContestService.getOfficialAttempt(authoritativeDomainId, tid, this.user._id);
            this.response.body.virtualContest = {
                eligibility: inspected.eligibility,
                attempt: attempt
                    ? {
                          _id: attempt._id,
                          status: attempt.status,
                          startAt: attempt.startAt,
                          endAt: attempt.endAt,
                      }
                    : null,
            };
        }
        if (this.request.json) return;
        this.response.body.tdoc.content = this.response.body.tdoc.content
            .replace(/\(file:\/\//g, `(./${this.tdoc.docId}/file/public/`)
            .replace(/="file:\/\//g, `="./${this.tdoc.docId}/file/public/`);
    }

    @param('tid', Types.ObjectId)
    @param('code', Types.String, true)
    @param('unrank', Types.Boolean, true)
    async postAttend(_domainId: string, tid: ObjectId, code = '', unrank = false) {
        const authoritativeDomainId = this.authoritativeDomainId();
        this.checkPerm(PERM.PERM_ATTEND_CONTEST);
        if (contest.isDone(this.tdoc)) throw new ContestNotLiveError(tid);
        if (this.tdoc._code && code !== this.tdoc._code) throw new InvalidTokenError(localizedErrorText`Contest Invitation`, code);
        if (unrank) assertIndividualContestUnrankAllowed(this.tdoc.rule, contest.getParticipationMode(this.tdoc));
        const payload: { subscribe: number; unrank?: boolean } = { subscribe: 1 };
        if (unrank) payload.unrank = true;
        await contest.attend(authoritativeDomainId, tid, this.user._id, payload);
        logger.info('contest attend domain=%s contest=%s uid=%d unrank=%s stage=create', authoritativeDomainId, tid, this.user._id, unrank);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('subscribe', Types.Boolean)
    async postSubscribe(_domainId: string, tid: ObjectId, subscribe = false) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.tsdoc?.attend) throw new ContestNotAttendedError(authoritativeDomainId, tid);
        await contest.setStatus(authoritativeDomainId, tid, this.user._id, { subscribe: subscribe ? 1 : 0 });
        this.back();
    }
}

export class ContestPrintHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    async prepare(_args: { domainId?: string }, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.tdoc?.allowPrint) throw new NotFoundError();
        if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST) && !this.tsdoc?.attend) {
            throw new ContestNotAttendedError(authoritativeDomainId, tid);
        }
    }

    async get() {
        this.response.body = { tdoc: this.tdoc };
        this.response.template = 'contest_print.html';
    }

    async post() {
        if (this.args.operation) return;
        if (this.args.file_contents && this.args.original_name) {
            try {
                await (this.postPrint as any)({
                    ...this.args,
                    title: this.args.original_name,
                    content: Buffer.from(this.args.file_contents, 'base64').toString('utf-8'),
                });
                this.response.body = { success: true, output: '' };
            } catch (e) {
                this.response.body = { success: false, output: e.message };
            } finally {
                delete this.response.redirect;
            }
        } else throw new MethodNotAllowedError(localizedErrorText`POST`);
    }

    @param('tid', Types.ObjectId)
    @param('title', Types.Title, true)
    @param('content', Types.Content, true)
    async postPrint(_domainId: string, tid: ObjectId, title = '', content = '') {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.tsdoc?.attend) throw new ContestNotAttendedError(authoritativeDomainId, tid);
        if (!contest.isOngoing(this.tdoc, this.tsdoc)) throw new ContestNotLiveError(authoritativeDomainId, tid);
        await this.limitRate('add_print', 3600, 60);
        if (this.request.files?.file) {
            const file = this.request.files.file;
            if (file.size > 1024 * 1024) throw new ValidationError('file');
            content = await readFile(file.filepath, 'utf-8');
            title ||= file.originalFilename || 'file';
        }
        if (!content) throw new ValidationError('content');
        await contest.addPrintTask(authoritativeDomainId, tid, this.user._id, title, content);
        this.back();
    }

    @param('tid', Types.ObjectId)
    async postGetPrintTask(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const isContestAdmin = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);
        const tasks = await contest
            .getMultiPrintTask(authoritativeDomainId, tid, isContestAdmin ? {} : { owner: this.user._id })
            .project({ _id: 1, title: 1, owner: 1, status: 1 })
            .sort({ _id: 1 })
            .toArray();
        const uids = Array.from(new Set(tasks.map((i) => i.owner)));
        const udict = await user.getListForRender(authoritativeDomainId, uids, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO));
        this.response.body = { tasks, udict };
    }

    @param('tid', Types.ObjectId)
    async postAllocatePrintTask(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        }
        const task = await contest.allocatePrintTask(authoritativeDomainId, tid);
        const udoc = task ? await user.getById(authoritativeDomainId, task.owner) : null;
        this.response.body = { task, udoc };
    }

    @param('tid', Types.ObjectId)
    @param('taskId', Types.ObjectId)
    @param('status', Types.Range(['printed', 'pending']))
    async postUpdatePrintTask(_domainId: string, tid: ObjectId, taskId: ObjectId, status: 'printed' | 'pending') {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            throw new PermissionError(PERM.PERM_EDIT_CONTEST);
        }
        await contest.updatePrintTask(authoritativeDomainId, tid, taskId, {
            status: status === 'printed' ? contest.PrintTaskStatus.printed : contest.PrintTaskStatus.pending,
        });
        this.response.body = { success: true };
    }
}

/**
 * 本场每题实时通过统计（PLAN 2026-07 P1.4，仅 rule=acm）。
 * 双口径：按人（acUsers/triedUsers）主显 + 按提交（acSubmits/totalSubmits）tooltip。
 * 30s 内存缓存——生产 record 全量 8.7 万，单次聚合毫秒级，缓存只为挡住刷新风暴。
 */
interface ContestLiveStat {
    acUsers: number;
    triedUsers: number;
    acSubmits: number;
    totalSubmits: number;
}
const liveStatsCache = new Map<string, { at: number; data: Record<string, ContestLiveStat> }>();

async function getContestLiveStats(domainId: string, tid: ObjectId, pids: number[], teamMode = false) {
    const key = `${domainId}/${tid.toHexString()}/${teamMode ? 'team' : 'individual'}`;
    const hit = liveStatsCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 1000) return hit.data;
    const rows = await record.coll
        .aggregate(
            [
                {
                    $match: {
                        domainId,
                        contest: tid,
                        pid: { $in: pids },
                        ...(teamMode ? { contestTeamId: { $type: 'objectId' } } : {}),
                    },
                },
                {
                    $group: {
                        _id: { pid: '$pid', participant: teamMode ? '$contestTeamId' : '$uid' },
                        subs: { $sum: 1 },
                        acSubs: { $sum: { $cond: [{ $eq: ['$status', STATUS.STATUS_ACCEPTED] }, 1, 0] } },
                    },
                },
                {
                    $group: {
                        _id: '$_id.pid',
                        triedUsers: { $sum: 1 },
                        acUsers: { $sum: { $cond: [{ $gt: ['$acSubs', 0] }, 1, 0] } },
                        totalSubmits: { $sum: '$subs' },
                        acSubmits: { $sum: '$acSubs' },
                    },
                },
            ],
            { maxTimeMS: 5000 },
        )
        .toArray();
    const data: Record<string, ContestLiveStat> = {};
    for (const r of rows as any[]) {
        data[String(r._id)] = {
            acUsers: r.acUsers,
            triedUsers: r.triedUsers,
            acSubmits: r.acSubmits,
            totalSubmits: r.totalSubmits,
        };
    }
    // 简单容量上限：缓存按需重建，别让长期在线进程无界增长。
    if (liveStatsCache.size > 200) liveStatsCache.clear();
    liveStatsCache.set(key, { at: Date.now(), data });
    return data;
}

export class ContestProblemListHandler extends ContestDetailBaseHandler {
    /** 考试壳（exam-mode）子类置 false——本场热度数据不进考试客户端 payload。 */
    protected liveStatsEnabled = true;
    /** Exam Mode only: expose a minimal status snapshot before rule projection removes status fields. */
    protected latestProblemStatusesEnabled = false;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        if (contest.RULES[this.tdoc.rule].hidden) throw new ContestNotFoundError(this.authoritativeDomainId(), tid);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (contest.isNotStarted(this.tdoc)) throw new ContestNotLiveError(authoritativeDomainId, tid);
        if (!this.tsdoc?.attend && !contest.isDone(this.tdoc)) throw new ContestNotAttendedError(authoritativeDomainId, tid);
        const postContestPractice = getPostContestPracticeState(this.tdoc, this.tsdoc);
        const canManageContest = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const canViewAllContestProblems =
            !postContestPractice.supported ||
            canManageContest ||
            (!!this.tsdoc?.attend && !contest.isDone(this.tdoc)) ||
            postContestPractice.eligible;
        const [pdict, udict, tcdocs, teamContext] = await Promise.all([
            canViewAllContestProblems
                ? problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, problem.PROJECTION_CONTEST_LIST, true)
                : problem.getListViewableAuthorized(authoritativeDomainId, this.tdoc.pids, this.user, problem.PROJECTION_CONTEST_LIST, false, true),
            user.getList(authoritativeDomainId, [this.tdoc.owner, this.user._id]),
            contest.getMultiClarification(authoritativeDomainId, tid, this.user._id),
            currentTeamContext(authoritativeDomainId, this.tdoc, this.user._id),
        ]);
        this.response.body = {
            pdict,
            visiblePids: this.tdoc.pids.filter((pid) => pdict[pid]),
            psdict: {},
            udict,
            rdict: {},
            tdoc: this.tdoc,
            tcdocs,
            team: teamContext.team,
            teamStatus: publicTeamStatus(teamContext.status),
            postContestPractice,
        };
        // P1.4：仅 ACM 下发本场每题统计；上方两道 throw（未开赛/未报名且未结束）
        // 已保证可见性门槛（与题目可见同 gate）。
        if (this.liveStatsEnabled && this.tdoc.rule === 'acm') {
            const teamMode = contest.getParticipationMode(this.tdoc) === 'team';
            this.response.body.liveStats = await getContestLiveStats(authoritativeDomainId, tid, this.tdoc.pids, teamMode);
            this.response.body.liveStatsParticipantUnit = teamMode ? 'team' : 'user';
        }
        this.response.template = 'contest_problemlist.html';
        this.response.body.showScore = Object.values(this.tdoc.score || {}).some((i) => i && i !== 100);
        if (!this.tsdoc) return;
        if (this.tsdoc.attend && !this.tsdoc.startAt && contest.isOngoing(this.tdoc)) {
            await contest.setStatus(authoritativeDomainId, tid, this.user._id, { startAt: new Date() });
            this.tsdoc.startAt = new Date();
        }
        this.response.body.tsdoc = this.tsdocAsPublic();
        const teamMode = contest.getParticipationMode(this.tdoc) === 'team';
        this.response.body.psdict = teamMode ? teamContext.status?.detail || {} : this.tsdoc.detail || {};
        if (this.latestProblemStatusesEnabled) {
            const statusJournal = teamMode ? teamContext.status?.journal || [] : this.tsdoc.journal || [];
            this.response.body.problemStatusByPid = buildLatestContestProblemStatusByPid(statusJournal, this.tdoc.pids);
        }
        const psdocs: any[] = Object.values(this.response.body.psdict);
        const canViewContestRecord = contest.canShowSelfRecord.call(this, this.tdoc) && (!teamMode || !!teamContext.team);
        const canViewRecord = canViewContestRecord || postContestPractice.eligible;
        this.response.body.canViewContestRecord = canViewContestRecord;
        this.response.body.canViewRecord = canViewRecord;
        const contestRids = psdocs.map((i) => i.rid).filter(Boolean);
        const rids = canViewContestRecord ? [...contestRids] : [];
        if (postContestPractice.eligible) {
            const personalRecords = await record
                .getMulti(authoritativeDomainId, buildPersonalPracticeRecordQuery(this.user._id, this.tdoc.pids))
                .project<PersonalPracticeRecord>({ _id: 1, pid: 1, status: 1, contest: 1, contestTeamId: 1, hackTarget: 1, input: 1 })
                .toArray();
            const personalPracticeStatusByPid = buildPersonalPracticeStatusByPid(personalRecords, this.tdoc.pids, this.tdoc.beginAt, this.tdoc.endAt);
            rids.push(...Object.values(personalPracticeStatusByPid).map((i) => i.rid));
            this.response.body.personalPracticeStatusByPid = personalPracticeStatusByPid;
            // ui-default still renders this field as its correction column.
            this.response.body.correction = personalPracticeStatusByPid;
        } else if (!postContestPractice.supported && !teamMode && contest.isDone(this.tdoc) && canViewContestRecord) {
            // Preserve Hydro's existing post-contest correction display for
            // unsupported rules such as exam/homework. P1.24 must not reinterpret
            // or remove that legacy behavior.
            const correction = await problem.getListStatus(authoritativeDomainId, this.user._id, this.tdoc.pids);
            for (const pid in correction) {
                if (this.tsdoc.detail?.[pid]?.rid === correction[pid].rid) delete correction[pid];
            }
            rids.push(...Object.values(correction).map((i: any) => i.rid));
            this.response.body.correction = correction;
        }
        const hiddenContestRecords = canViewContestRecord ? {} : Object.fromEntries(contestRids.map((rid) => [rid, { _id: rid }]));
        [this.response.body.rdict, this.response.body.rdocs] = canViewRecord
            ? await Promise.all([
                  record.getList(authoritativeDomainId, rids).then((records) => ({ ...hiddenContestRecords, ...records })),
                  canViewContestRecord
                      ? record
                            .getMulti(
                                authoritativeDomainId,
                                teamMode ? { contest: tid, contestTeamId: teamContext.team.teamId } : { contest: tid, uid: this.user._id },
                            )
                            .sort({ _id: -1 })
                            .toArray()
                      : Promise.resolve([]),
              ])
            : [hiddenContestRecords, []];
        if (teamMode && this.response.body.rdocs.length) {
            Object.assign(
                this.response.body.udict,
                await user.getList(authoritativeDomainId, Array.from(new Set(this.response.body.rdocs.map((rdoc: any) => rdoc.uid)))),
            );
        }
        if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            this.response.body.rdocs = this.response.body.rdocs.map((rdoc) => contest.applyProjection(this.tdoc, rdoc, this.user));
            for (const key in this.response.body.rdict) {
                this.response.body.rdict[key] = contest.applyProjection(this.tdoc, this.response.body.rdict[key], this.user);
            }
            for (const key in this.response.body.psdict) {
                this.response.body.psdict[key] = contest.applyProjection(this.tdoc, this.response.body.psdict[key], this.user);
            }
        }
    }

    @param('tid', Types.ObjectId)
    @param('content', Types.Content)
    @param('subject', Types.Int)
    async postClarification(_domainId: string, tid: ObjectId, content: string, subject: number) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.tsdoc?.attend) throw new ContestNotAttendedError(authoritativeDomainId, tid);
        if (!contest.isOngoing(this.tdoc)) throw new ContestNotLiveError(authoritativeDomainId, tid);
        await this.limitRate('add_discussion', 3600, 60);
        await contest.addClarification(authoritativeDomainId, tid, this.user._id, content, this.request.ip, subject);
        if (!this.user.own(this.tdoc)) {
            await message.send(
                1,
                (this.tdoc.maintainer || []).concat(this.tdoc.owner),
                JSON.stringify({
                    message: 'Contest {0} has a new clarification about {1}, please go to contest clarifications page to reply.',
                    params: [this.tdoc.title, subject > 0 ? `#${this.tdoc.pids.indexOf(subject) + 1}` : 'the contest'],
                    url: this.url('contest_clarification', { tid }),
                }),
                message.FLAG_I18N | message.FLAG_UNREAD,
            );
        }
        this.back();
    }
}

export class ContestEditHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid) {
            this.tdoc = await contest.get(authoritativeDomainId, tid);
            if (!this.tdoc) throw new ContestNotFoundError(authoritativeDomainId, tid);
            if (contest.RULES[this.tdoc.rule].hidden) throw new ContestNotFoundError(authoritativeDomainId, tid);
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
            else this.checkPerm(PERM.PERM_EDIT_CONTEST_SELF);
        } else this.checkPerm(PERM.PERM_CREATE_CONTEST);
    }

    @param('tid', Types.ObjectId, true)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        this.response.template = 'contest_edit.html';
        const rules = {};
        for (const i in contest.RULES) {
            if (!contest.RULES[i].hidden) {
                rules[i] = contest.RULES[i].TEXT;
            }
        }
        let ts = Date.now();
        ts = ts - (ts % (15 * Time.minute)) + 15 * Time.minute;
        const beginAt = moment(this.tdoc?.beginAt || new Date(ts)).tz(this.user.timeZone);
        const canManageTeamBatches = contestTeamBatch.canManageTeamBatches(this.user);
        const [activeTeamCount, recordCount, teamBatches] = await Promise.all([
            tid ? contestTeam.countActiveTeams(authoritativeDomainId, tid) : Promise.resolve(0),
            tid ? record.coll.countDocuments({ domainId: authoritativeDomainId, contest: tid }) : Promise.resolve(0),
            canManageTeamBatches ? contestTeamBatch.listBatches(authoritativeDomainId) : Promise.resolve([]),
        ]);
        const participationRevision = this.tdoc?.participationRevision ?? 0;
        const canUpdatePlannedTeamBatch =
            canManageTeamBatches &&
            (!tid || (new Date() < this.tdoc.beginAt && recordCount === 0 && activeTeamCount === 0 && !this.tdoc.teamBatchId));

        // Hydrate the school + user-group catalog when krypton-userbind is
        // loaded, so the participant-scope picker in the editor doesn't
        // have to make a second roundtrip. Both lists are admin-only
        // metadata; we already gate on PERM_EDIT_CONTEST / CREATE.
        let scopeSchools: any[] = [];
        try {
            const userbind = (global as any).Hydro?.model?.userbind;
            if (userbind?.listSchools) scopeSchools = await userbind.listSchools(authoritativeDomainId);
        } catch {
            /* best-effort */
        }
        const scopeGroups = await listContestScopeGroups(
            authoritativeDomainId,
            Boolean(this.tdoc && (this.tdoc.participationMode || 'individual') !== 'team' && this.tdoc.participantScopeMode === 'groups'),
        );

        this.response.body = {
            rules,
            tdoc: this.tdoc,
            duration: tid ? -beginAt.diff(this.tdoc.endAt, 'hour', true) : 2,
            pids: tid ? this.tdoc.pids.join(',') : '',
            beginAt,
            page_name: tid ? 'contest_edit' : 'contest_create',
            files: tid ? this.tdoc.files : [],
            urlForFile: (filename: string) => this.url('contest_file_download', { tid, filename, type: 'public' }),
            scopeSchools,
            scopeGroups,
            canAutoHideProblems: this.user.hasPerm(PERM.PERM_EDIT_PROBLEM),
            activeTeamCount,
            recordCount,
            participationRevision,
            canManageTeamBatches,
            canUpdatePlannedTeamBatch,
            teamBatches: teamBatches.map((batch) => ({
                batchId: batch.batchId,
                name: batch.name,
                status: batch.status,
                teamCount: batch.teamCount,
                memberCount: batch.memberCount,
                closedAt: batch.closedAt,
            })),
            teamModeClearConfirmation: tid && activeTeamCount > 0 ? contest.teamModeClearConfirmation(tid, participationRevision) : '',
        };
    }

    @param('tid', Types.ObjectId, true)
    @param('beginAtDate', Types.Date)
    @param('beginAtTime', Types.Time)
    @param('duration', Types.Float)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('rule', Types.String)
    @param('pids', Types.Content)
    @param('rated', Types.Boolean)
    @param('code', Types.String, true)
    @param('autoHide', Types.Boolean)
    @param('assign', Types.CommaSeperatedArray, true)
    @param('lock', Types.UnsignedInt, true)
    @param('contestDuration', Types.Float, true)
    @param('maintainer', Types.NumericArray, true)
    @param('allowViewCode', Types.Boolean)
    @param('allowPrint', Types.Boolean)
    @param('keepScoreboardHidden', Types.Boolean)
    @param('allowVirtual', Types.Boolean, true)
    @param('langs', Types.CommaSeperatedArray, true)
    // ── Krypton: client-required & Vigil anti-cheat ─────────────────────
    @param('vigilEnabled', Types.Boolean)
    @param('entryMode', Types.Range(['open', 'client_required']), true)
    @param('approvalMode', Types.Range(['strict', 'auto']), true)
    @param('lockdownMode', Types.Boolean)
    @param('networkLockdownMode', Types.Boolean)
    @param('networkLockdownFailurePolicy', Types.Range(['strict', 'report_only', 'off']), true)
    @param('networkWhitelistHosts', Types.Content, true)
    @param('networkWhitelistIps', Types.Content, true)
    @param('networkWhitelistPorts', Types.Content, true)
    @param('pauseOnDisconnect', Types.Boolean)
    @param('screenshotIntervalMs', Types.UnsignedInt, true)
    @param('exclusive', Types.Boolean)
    @param('clientLoginBlockBeforeMinutes', Types.UnsignedInt, true)
    @param('clientLoginBlockAfterMinutes', Types.UnsignedInt, true)
    // ── Krypton: live media + recording + event detection ───────────────
    @param('liveEnabled', Types.Boolean)
    @param('recordEnabled', Types.Boolean)
    @param('cameraEnabled', Types.Boolean)
    @param('screenshotJitterMs', Types.UnsignedInt, true)
    @param('vigilProcessWhitelist', Types.Content, true)
    // ── Krypton: participant scope ──────────────────────────────────────
    @param('participantScopeMode', Types.Range(['none', 'schools', 'groups']), true)
    @param('participantSchoolIds', Types.CommaSeperatedArray, true)
    @param('participantGroupIds', Types.CommaSeperatedArray, true)
    @param('participationMode', Types.Range(['individual', 'team']), true)
    @param('participationRevision', Types.UnsignedInt, true)
    @param('teamModeClearConfirmation', Types.String, true)
    @param('plannedTeamBatchId', Types.ObjectId, true)
    @serializedContestEdit
    async postUpdate(
        _domainId: string,
        tid: ObjectId,
        beginAtDate: string,
        beginAtTime: string,
        duration: number,
        title: string,
        content: string,
        rule: string,
        _pids: string,
        rated = false,
        _code = '',
        autoHide = false,
        assign: string[] = [],
        lock: number = null,
        contestDuration: number = null,
        maintainer: number[] = [],
        allowViewCode = false,
        allowPrint = false,
        keepScoreboardHidden = false,
        allowVirtual: boolean = null,
        langs: string[] = [],
        vigilEnabled = false,
        entryMode: 'open' | 'client_required' = 'open',
        approvalMode: 'strict' | 'auto' = 'strict',
        lockdownMode = false,
        networkLockdownMode = false,
        networkLockdownFailurePolicy: 'strict' | 'report_only' | 'off' = 'strict',
        networkWhitelistHosts = '',
        networkWhitelistIps = '',
        networkWhitelistPorts = '',
        pauseOnDisconnect = false,
        screenshotIntervalMs: number = null,
        exclusive = false,
        clientLoginBlockBeforeMinutes: number = null,
        clientLoginBlockAfterMinutes: number = null,
        liveEnabled = true,
        recordEnabled = false,
        cameraEnabled = true,
        screenshotJitterMs: number = null,
        vigilProcessWhitelist = '',
        participantScopeMode: 'none' | 'schools' | 'groups' = 'none',
        participantSchoolIds: string[] = [],
        participantGroupIds: string[] = [],
        participationMode: 'individual' | 'team' = null,
        participationRevision: number = null,
        teamModeClearConfirmation = '',
        plannedTeamBatchId: ObjectId = null,
    ) {
        const creatingContest = !tid;
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (!Object.keys(contest.RULES).includes(rule) || contest.RULES[rule].hidden) throw new ValidationError('rule');
        const pids = parseProblemDocIds(_pids);
        const previousPids = new Set(this.tdoc?.pids || []);
        const pendingAutoHidePids = new Set(this.tdoc?.autoHidePendingPids || []);
        const trackedAutoHidePids = new Set(
            Array.isArray(this.tdoc?.autoHideProblemPids) ? this.tdoc.autoHideProblemPids : this.tdoc?.autoHide ? Array.from(previousPids) : [],
        );
        const beginAtMoment = moment.tz(`${beginAtDate} ${beginAtTime}`, this.user.timeZone);
        if (!beginAtMoment.isValid()) throw new ValidationError('beginAtDate', 'beginAtTime');
        const endAt = beginAtMoment.clone().add(duration, 'hours').toDate();
        if (beginAtMoment.isSameOrAfter(endAt)) throw new ValidationError('duration');
        const beginAt = beginAtMoment.toDate();
        const now = Date.now();
        const autoHideActive = now <= endAt.getTime();
        const persistedAutoHideEndAt = this.tdoc?.endAt ? new Date(this.tdoc.endAt as any).getTime() : null;
        const persistedAutoHideActive = !!this.tdoc?.autoHide && persistedAutoHideEndAt !== null && now <= persistedAutoHideEndAt;
        const previousSortedPids = Array.from(previousPids).sort((a, b) => a - b);
        const nextSortedPids = [...pids].sort((a, b) => a - b);
        const pidsChanged =
            previousSortedPids.length !== nextSortedPids.length || previousSortedPids.some((pid, index) => pid !== nextSortedPids[index]);
        const autoHideScheduleChanged =
            !!this.tdoc?.autoHide && autoHide && persistedAutoHideEndAt !== endAt.getTime() && (persistedAutoHideActive || autoHideActive);
        const autoHideStateChanged =
            !!this.tdoc &&
            (!!this.tdoc.autoHide !== autoHide ||
                ((!!this.tdoc.autoHide || autoHide) && (pidsChanged || persistedAutoHideActive !== (autoHide && autoHideActive))) ||
                autoHideScheduleChanged);
        const autoHideRecoveryRequired =
            !!trackedAutoHidePids.size && (!autoHide || !autoHideActive || Array.from(trackedAutoHidePids).some((pid) => !pids.includes(pid)));
        if ((!this.tdoc && autoHide) || autoHideStateChanged || pendingAutoHidePids.size || autoHideRecoveryRequired) {
            this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        }
        const pendingNeedsUnhide = !!pendingAutoHidePids.size && !persistedAutoHideActive;
        if (pendingNeedsUnhide && autoHide && autoHideActive) {
            throw new ValidationError('autoHide', null, localizedErrorText`上一次自动公开尚未完成，请先保持当前结束状态并重试保存`);
        }
        const autoUnhideTargets = !autoHide || !autoHideActive ? Array.from(trackedAutoHidePids) : [];
        const removedAutoHideTargets = autoHide && autoHideActive ? Array.from(trackedAutoHidePids).filter((pid) => !pids.includes(pid)) : [];
        const autoHideTargets =
            !autoUnhideTargets.length && autoHide && autoHideActive
                ? Array.from(new Set(pids.filter((pid) => pendingAutoHidePids.has(pid) || !persistedAutoHideActive || !previousPids.has(pid))))
                : [];
        const prewriteAutoHideProblemPids =
            autoHide && autoHideActive ? Array.from(new Set([...trackedAutoHidePids, ...pids])) : Array.from(trackedAutoHidePids);
        const pendingAutoHideTargets = autoHide && autoHideActive ? autoHideTargets : autoUnhideTargets;
        const lockAt = lock ? moment(endAt).add(-lock, 'minutes').toDate() : null;
        if (lockAt && contestDuration) throw new ValidationError('lockAt', 'duration');
        const statusRecalcReasons: string[] = [];
        let lockBoundaryChanged = false;
        if (tid) {
            const timestamp = (value: Date | null | undefined) => value?.getTime() ?? null;
            if (timestamp(this.tdoc.beginAt) !== timestamp(beginAt)) statusRecalcReasons.push('beginAt');
            if (timestamp(this.tdoc.endAt) !== timestamp(endAt)) statusRecalcReasons.push('endAt');
            if (pidsChanged) statusRecalcReasons.push('pids');
            if (this.tdoc.rule !== rule) statusRecalcReasons.push('rule');
            lockBoundaryChanged = timestamp(this.tdoc.lockAt) !== timestamp(lockAt);
            if (lockBoundaryChanged) statusRecalcReasons.push('lockAt');
            if (this.tdoc.statusRecalcToken) statusRecalcReasons.push('pending');
        }
        const statusRecalcToken = statusRecalcReasons.length ? randomstring(24) : null;
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, this.tdoc?.pids);
        if (autoHideTargets.length) await assertCanPublishAutoHiddenProblems(authoritativeDomainId, autoHideTargets, this.user);
        const actorUnhideTargets = Array.from(
            new Set([...autoUnhideTargets, ...removedAutoHideTargets, ...(autoHideScheduleChanged ? Array.from(trackedAutoHidePids) : [])]),
        );
        if (actorUnhideTargets.length) await assertCanPublishAutoHiddenProblems(authoritativeDomainId, actorUnhideTargets, this.user);
        const effectiveParticipationMode = participationMode || (this.tdoc ? contest.getParticipationMode(this.tdoc) : 'individual');
        const existingTeamBatchId = this.tdoc?.teamBatchId ? new ObjectId(this.tdoc.teamBatchId) : null;
        const existingPlannedTeamBatchId = this.tdoc?.plannedTeamBatchId ? new ObjectId(this.tdoc.plannedTeamBatchId) : null;
        if (plannedTeamBatchId && effectiveParticipationMode !== 'team') throw new ValidationError('plannedTeamBatchId');
        const requestedPlannedTeamBatchId = effectiveParticipationMode === 'team' ? plannedTeamBatchId : null;
        const plannedTeamBatchChanged =
            !!existingPlannedTeamBatchId !== !!requestedPlannedTeamBatchId ||
            (!!existingPlannedTeamBatchId && !!requestedPlannedTeamBatchId && !existingPlannedTeamBatchId.equals(requestedPlannedTeamBatchId));
        if (plannedTeamBatchChanged) {
            if (!contestTeamBatch.canManageTeamBatches(this.user)) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
            if (existingTeamBatchId) {
                throw new ValidationError('plannedTeamBatchId', null, localizedErrorText`A finalized contest roster cannot be rebound.`);
            }
            if (requestedPlannedTeamBatchId && !(await contestTeamBatch.getBatch(authoritativeDomainId, requestedPlannedTeamBatchId))) {
                throw new ValidationError('plannedTeamBatchId');
            }
        }

        // Normalize the shared client-entry contract before the first write so
        // a participation-mode change can never leave a half-configured team contest.
        if (effectiveParticipationMode === 'team') {
            vigilEnabled = true;
            entryMode = 'client_required';
            rated = false;
        } else if (entryMode === 'client_required') vigilEnabled = true;
        else if (!vigilEnabled) entryMode = 'open';

        if (tid) {
            await contest.edit(
                authoritativeDomainId,
                tid,
                {
                    title,
                    content,
                    rule,
                    beginAt,
                    endAt,
                    pids,
                    rated,
                    duration: contestDuration,
                    participationMode: effectiveParticipationMode,
                    vigilEnabled,
                    entryMode,
                    autoHide,
                    autoHidePendingPids: pendingAutoHideTargets,
                    autoHideProblemPids: prewriteAutoHideProblemPids,
                    ...(statusRecalcToken ? { statusRecalcToken } : {}),
                },
                {
                    actor: this.user,
                    expectedParticipationRevision: participationRevision ?? (this.tdoc.participationRevision || 0),
                    teamModeClearConfirmation,
                },
            );
        } else {
            tid = await contest.add(authoritativeDomainId, title, content, this.user._id, rule, beginAt, endAt, pids, rated, {
                duration: contestDuration,
                participationMode: effectiveParticipationMode,
                vigilEnabled,
                entryMode,
                autoHide,
                autoHidePendingPids: pendingAutoHideTargets,
                autoHideProblemPids: prewriteAutoHideProblemPids,
                ...(allowVirtual != null ? { allowVirtual } : {}),
            });
            if (requestedPlannedTeamBatchId) {
                await contestTeamBatch.writeCreatedContestPlannedBatch(authoritativeDomainId, tid, requestedPlannedTeamBatchId, {
                    user: this.user,
                });
            }
        }
        const task = contestUnhideTask(authoritativeDomainId, tid);
        if (autoHideActive && autoHide) {
            try {
                await scheduleContestUnhide(authoritativeDomainId, tid, endAt, prewriteAutoHideProblemPids);
            } catch (error) {
                logger.error(
                    'Contest unhide schedule update failed after contest persistence domain=%s contest=%s actor=%d authoritativeEndAt=%s stage=schedule-unhide error=%o',
                    authoritativeDomainId,
                    tid,
                    this.user._id,
                    endAt.toISOString(),
                    error,
                );
                throw error;
            }
            if (removedAutoHideTargets.length) {
                await unhideContestProblems(authoritativeDomainId, tid, removedAutoHideTargets, 'save-remove-problems', this.user._id);
            }
            const hiddenPids: number[] = [];
            try {
                for (const pid of autoHideTargets) {
                    await problem.editAuthorized(authoritativeDomainId, pid, { hidden: true }, this.user);
                    hiddenPids.push(pid);
                }
            } catch (error) {
                const failedPid = autoHideTargets[hiddenPids.length];
                logger.error(
                    'Contest autoHide failed after contest persistence domain=%s contest=%s actor=%d acknowledged=%j failedPid=%s unattempted=%j stage=hide-problems error=%o',
                    authoritativeDomainId,
                    tid,
                    this.user._id,
                    hiddenPids,
                    failedPid,
                    autoHideTargets.slice(hiddenPids.length + 1),
                    error,
                );
                throw error;
            }
        } else {
            if (autoUnhideTargets.length) {
                await unhideContestProblems(authoritativeDomainId, tid, autoUnhideTargets, 'save-unhide', this.user._id);
            }
            await ScheduleModel.deleteMany(task);
        }
        // ── Krypton: client-required & Vigil anti-cheat normalization ─────
        //
        // Cross-field invariants (CLIENT_REQUIRED_CONTEST_DESIGN.md §5.1):
        //   client_required → vigilEnabled is force-true
        //   vigilEnabled=false → entryMode is force-open
        // Anything else the editor sends is taken at face value.
        if (entryMode === 'client_required') vigilEnabled = true;
        else if (!vigilEnabled) entryMode = 'open';
        if (!vigilEnabled) {
            networkLockdownMode = false;
            networkLockdownFailurePolicy = 'off';
        } else if (!networkLockdownMode) {
            networkLockdownFailurePolicy = 'off';
        }

        // Default lockout-window values when the editor leaves them blank
        // (i.e., the param decoded to `null`). The 60/30 default mirrors
        // §7.2 and the v1 migration backfill in krypton-vigilguard.
        const beforeMin = clientLoginBlockBeforeMinutes ?? 60;
        const afterMin = clientLoginBlockAfterMinutes ?? 30;
        const shotMs = screenshotIntervalMs ?? 60000;
        const jitterMs = screenshotJitterMs ?? 30000;
        const networkHosts = parseStringList(networkWhitelistHosts);
        const networkIps = parseStringList(networkWhitelistIps);
        const networkPorts = parsePortList(networkWhitelistPorts);
        const processWhitelist = parseStringList(vigilProcessWhitelist);

        // recordEnabled implies liveEnabled (cannot record without streaming).
        // If admin set recordEnabled=true but liveEnabled=false, force liveEnabled.
        if (recordEnabled && !liveEnabled) liveEnabled = true;
        // When vigilEnabled=false, all media switches are moot.
        if (!vigilEnabled) {
            liveEnabled = false;
            recordEnabled = false;
            cameraEnabled = false;
        }

        // Participant scope normalization (§5.2): the two lists are
        // mutually exclusive — clear whichever isn't active.
        const sids = participantScopeMode === 'schools' ? participantSchoolIds.map((s) => new ObjectId(s.trim())).filter(Boolean) : [];
        const gids = participantScopeMode === 'groups' ? participantGroupIds.map((s) => new ObjectId(s.trim())).filter(Boolean) : [];

        await contest.edit(authoritativeDomainId, tid, {
            assign,
            _code,
            autoHide,
            autoHidePendingPids: [],
            autoHideProblemPids: autoHide && autoHideActive ? pids : [],
            lockAt,
            ...(lockBoundaryChanged ? { unlocked: false } : {}),
            ...(statusRecalcToken ? { statusRecalcToken } : {}),
            maintainer,
            allowViewCode,
            allowPrint,
            keepScoreboardHidden,
            ...(allowVirtual != null ? { allowVirtual } : {}),
            langs,
            vigilEnabled,
            entryMode,
            approvalMode,
            lockdownMode,
            networkLockdownMode,
            networkLockdownFailurePolicy,
            networkWhitelistHosts: networkHosts,
            networkWhitelistIps: networkIps,
            networkWhitelistPorts: networkPorts,
            pauseOnDisconnect,
            screenshotIntervalMs: shotMs,
            exclusive,
            clientLoginBlockBeforeMinutes: beforeMin,
            clientLoginBlockAfterMinutes: afterMin,
            liveEnabled,
            recordEnabled,
            cameraEnabled,
            screenshotJitterMs: jitterMs,
            vigilProcessWhitelist: processWhitelist,
            participantScopeMode,
            participantSchoolIds: sids,
            participantGroupIds: gids,
        });
        if (this.tdoc && plannedTeamBatchChanged) {
            await contestTeamBatch.setContestPlannedBatch(authoritativeDomainId, tid, requestedPlannedTeamBatchId, existingPlannedTeamBatchId, {
                user: this.user,
            });
        }
        if (statusRecalcReasons.length) {
            try {
                await contest.recalcStatus(authoritativeDomainId, tid);
            } catch (error) {
                logger.error(
                    'Contest status recalculation failed after persisted edit domain=%s contest=%s actor=%s token=%s reasons=%j oldLockAt=%s newLockAt=%s stage=recalc error=%o',
                    authoritativeDomainId,
                    tid,
                    this.user._id,
                    statusRecalcToken,
                    statusRecalcReasons,
                    this.tdoc.lockAt?.toISOString?.() || null,
                    lockAt?.toISOString() || null,
                    error,
                );
                throw error;
            }
            let cleared;
            try {
                cleared = await document.coll.findOneAndUpdate(
                    {
                        domainId: authoritativeDomainId,
                        docType: document.TYPE_CONTEST,
                        docId: tid,
                        statusRecalcToken,
                    },
                    { $unset: { statusRecalcToken: '' } },
                    { returnDocument: 'after' },
                );
            } catch (error) {
                logger.error(
                    'Contest status recalculation token clear failed domain=%s contest=%s actor=%s token=%s reasons=%j stage=clear-token error=%o',
                    authoritativeDomainId,
                    tid,
                    this.user._id,
                    statusRecalcToken,
                    statusRecalcReasons,
                    error,
                );
                throw error;
            }
            logger.info(
                'Contest status recalculated after persisted edit domain=%s contest=%s actor=%s token=%s reasons=%j oldLockAt=%s newLockAt=%s stage=%s',
                authoritativeDomainId,
                tid,
                this.user._id,
                statusRecalcToken,
                statusRecalcReasons,
                this.tdoc.lockAt?.toISOString?.() || null,
                lockAt?.toISOString() || null,
                cleared ? 'complete' : 'superseded',
            );
        }
        if (effectiveParticipationMode === 'individual' && existingTeamBatchId) {
            await contestTeamBatch.clearContestTeamBatchPointers(authoritativeDomainId, tid, { user: this.user });
        }
        this.response.body = { tid };
        this.response.redirect = this.url(creatingContest ? 'contest_edit' : 'contest_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    @param('plannedTeamBatchId', Types.ObjectId)
    async postFinalizeTeamBatch(_domainId: string, tid: ObjectId, plannedTeamBatchId: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        try {
            await contestTeamBatch.finalizePlannedBatchToContest(authoritativeDomainId, tid, plannedTeamBatchId, { user: this.user });
        } catch (error) {
            logger.error(
                'Contest planned team-batch finalization failed domain=%s contest=%s batch=%s actor=%s stage=%s error=%o',
                authoritativeDomainId,
                tid,
                plannedTeamBatchId,
                this.user._id,
                (error as any)?.snapshotStage || 'unknown',
                error,
            );
            throw error;
        }
        this.response.redirect = this.url('contest_edit', { tid });
    }

    @param('tid', Types.ObjectId)
    async postCheckTeamReadiness(_domainId: string, tid: ObjectId) {
        const readiness = await contestTeamBatch.checkContestReadiness(String(this.domain?._id), tid, { user: this.user });
        this.response.body = { ok: true, readiness };
    }

    @param('tid', Types.ObjectId)
    @serializedContestEdit
    async postDelete(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);

        // ── Krypton: block delete while Vigil client sessions are active ─
        //
        // A `vigilEnabled` contest with live `vigil.client_sessions` rows
        // means students are *currently* inside the Qt Client for this
        // contest. Deleting now would orphan their session. Force the
        // admin to force-close those first (the Vigil dashboard has the
        // tool). DESIGN: deferred decision Q12 → friendly error wins
        // over auto-cleanup.
        if (this.tdoc?.vigilEnabled) {
            const vg = (global as any).Hydro?.model?.vigilguard;
            if (vg?.listActiveSessionsForContest) {
                const active = await vg.listActiveSessionsForContest(authoritativeDomainId, tid);
                if (active.length) {
                    throw new BadRequestError(
                        localizedErrorText`Cannot delete this contest: ${active.length} Vigil client session(s) are still active. Force-close them from the Vigil dashboard first.`,
                    );
                }
            }
        }

        const trackedAutoHidePids = Array.isArray(this.tdoc?.autoHideProblemPids)
            ? this.tdoc.autoHideProblemPids
            : this.tdoc?.autoHide
              ? this.tdoc.pids
              : [];
        if (trackedAutoHidePids.length) {
            this.checkPerm(PERM.PERM_EDIT_PROBLEM);
            await assertCanPublishAutoHiddenProblems(authoritativeDomainId, trackedAutoHidePids, this.user);
            await unhideContestProblems(authoritativeDomainId, tid, trackedAutoHidePids, 'delete-contest', this.user._id);
        }
        let ddocs;
        try {
            [ddocs] = await Promise.all([
                discussion.getMulti(authoritativeDomainId, { parentType: document.TYPE_CONTEST, parentId: tid }).project({ _id: 1 }).toArray(),
                contest.del(authoritativeDomainId, tid),
            ]);
        } catch (error) {
            logger.error(
                'Contest deletion failed after auto-hide cleanup domain=%s contest=%s actor=%s stage=delete-contest error=%o',
                authoritativeDomainId,
                tid,
                this.user._id,
                error,
            );
            throw error;
        }
        const tasks: any[] = ddocs.map((i) => discussion.del(authoritativeDomainId, i._id));
        await Promise.all(
            tasks.concat([
                record.updateMulti(authoritativeDomainId, { domainId: authoritativeDomainId, contest: tid }, undefined, undefined, { contest: '' }),
                ScheduleModel.deleteMany({
                    type: 'schedule',
                    subType: 'contest',
                    domainId: authoritativeDomainId,
                    tid,
                }),
                storage.del(
                    (this.tdoc.files?.map((i) => `contest/${authoritativeDomainId}/${tid}/public/${i.name}`) || []).concat(
                        this.tdoc.privateFiles?.map((i) => `contest/${authoritativeDomainId}/${tid}/private/${i.name}`) || [],
                    ),
                    this.user._id,
                ),
            ]),
        );
        this.response.redirect = this.url('contest_main');
    }
}

export class ContestManagementBaseHandler extends ContestDetailBaseHandler {
    async prepare() {
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
    }
}

export class ContestCodeHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('all', Types.Boolean)
    async get(_domainId: string, tid: ObjectId, all: boolean) {
        const authoritativeDomainId = String(this.domain?._id);
        await this.limitRate('contest_code', 60, 10);
        const tdoc = await contest.get(authoritativeDomainId, tid);
        const teamMode = contest.getParticipationMode(tdoc) === 'team';
        const statusSources = teamMode
            ? (await contest.getTeamScoreboardEntries(tdoc)).map(({ team, status }) => ({
                  identity: `T${team.name.replace(/[^\p{L}\p{N}_.-]+/gu, '_')}_${team.teamId.toHexString().slice(-6)}`,
                  status,
              }))
            : (await contest.getAndListStatus(authoritativeDomainId, tid))[1].map((status) => ({ identity: `U${status.uid}`, status }));
        if (tdoc.rule === 'homework') await assertHomeworkAccess(authoritativeDomainId, tdoc, this.user);
        if (!this.user.own(tdoc)) {
            if (!this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE)) {
                this.checkPerm(PERM.PERM_READ_RECORD_CODE);
            }
            if (!contest.isDone(tdoc)) throw new ContestNotEndedError(authoritativeDomainId, tid);
        }
        if (!contest.canShowRecord.call(this, tdoc as any, true)) {
            throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
        }
        const rnames = {};
        for (const { identity, status: tsdoc } of statusSources) {
            if (all) {
                for (const j of tsdoc.journal || []) {
                    let name = `${identity}_P${j.pid}_R${j.rid}`;
                    if (typeof j.score === 'number') name += `_S${j.status || 0}@${j.score}`;
                    rnames[j.rid] = name;
                }
            } else {
                for (const pid in tsdoc.detail || {}) {
                    let name = `${identity}_P${pid}_R${tsdoc.detail[pid].rid}`;
                    if (typeof tsdoc.detail[pid].score === 'number') name += `_S${tsdoc.detail[pid].status || 0}@${tsdoc.detail[pid].score}`;
                    rnames[tsdoc.detail[pid].rid] = name;
                }
            }
        }
        const zip = new ZipWriter(new BlobWriter('application/zip'), { bufferedWrite: true });
        const rdocs = await record
            .getMulti(authoritativeDomainId, {
                _id: { $in: Array.from(Object.keys(rnames)).map((id) => new ObjectId(id)) },
            })
            .toArray();
        await Promise.all(
            rdocs.map(async (rdoc) => {
                if (rdoc.files?.code) {
                    const [id, filename] = rdoc.files?.code?.split('#') || [];
                    if (!id) return;
                    await zip.add(`${rnames[rdoc._id.toHexString()]}.${filename || 'txt'}`, Readable.toWeb(await storage.get(`submission/${id}`)));
                } else if (rdoc.code) {
                    await zip.add(`${rnames[rdoc._id.toHexString()]}.${rdoc.lang}`, new TextReader(rdoc.code));
                }
            }),
        );
        this.binary(await zip.close(), `${tdoc.title}.zip`);
    }
}

export class ContestManagementHandler extends ContestManagementBaseHandler {
    @param('tid', Types.ObjectId)
    @param('d', Types.Range(['public', 'private']), true)
    @param('sidebar', Types.Boolean)
    async get(_domainId: string, tid: ObjectId, d?: string, sidebar?: boolean) {
        const authoritativeDomainId = this.authoritativeDomainId();
        // 本场提交统计（PLAN 2026-07-02 §8）：总量/AC/参与人数 + 按题分布 +
        // 按小时曲线。本 handler 已由 ContestManagementBaseHandler 限定
        // own || PERM_EDIT_CONTEST，学生不可达。聚合失败不阻塞页面。
        let submissionStats: any = null;
        try {
            const scope = { domainId: authoritativeDomainId, contest: tid };
            const [overall, byProblem, byHour] = await Promise.all([
                record.stat(authoritativeDomainId, tid),
                record.coll
                    .aggregate([
                        { $match: scope },
                        {
                            $group: {
                                _id: '$pid',
                                total: { $sum: 1 },
                                accepted: { $sum: { $cond: [{ $eq: ['$status', STATUS.STATUS_ACCEPTED] }, 1, 0] } },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ])
                    .toArray(),
                record.coll
                    .aggregate([
                        { $match: scope },
                        {
                            $group: {
                                _id: {
                                    $dateToString: {
                                        format: '%Y-%m-%dT%H',
                                        date: { $toDate: '$_id' },
                                        // 不带 timezone 时 mongo 按 UTC 分桶，中国部署下
                                        // 曲线整体偏 8 小时（对抗性审查发现 #3）。
                                        timezone: (this.user as any).timeZone || 'Asia/Shanghai',
                                    },
                                },
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ])
                    .toArray(),
            ]);
            const participants =
                contest.getParticipationMode(this.tdoc) === 'team'
                    ? await record.coll.distinct('contestTeamId', { ...scope, contestTeamId: { $type: 'objectId' } }).then((ids) => ids.length)
                    : ((overall as any).participants ?? 0);
            submissionStats = {
                total: overall.total,
                accepted: (overall as any).accepted ?? 0,
                participants,
                participantUnit: contest.getParticipationMode(this.tdoc) === 'team' ? 'team' : 'user',
                byProblem: byProblem.map((r) => ({ pid: r._id, total: r.total, accepted: r.accepted })),
                byHour: byHour.map((r) => ({ hour: r._id, count: r.count })),
            };
        } catch (error) {
            logger.error('Contest management statistics failed domain=%s contest=%s error=%o', authoritativeDomainId, tid, error);
        }
        const scopeGroups =
            contest.getParticipationMode(this.tdoc) !== 'team' && this.tdoc.participantScopeMode === 'groups'
                ? await listContestScopeGroups(authoritativeDomainId, true)
                : [];
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdoc,
            owner_udoc: await user.getById(authoritativeDomainId, this.tdoc.owner),
            pdict: await problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, [...problem.PROJECTION_CONTEST_LIST, 'tag']),
            files: sortFiles(this.tdoc.files || []),
            privateFiles: sortFiles(this.tdoc.privateFiles || []),
            scopeGroups,
            urlForFile: (filename: string, type: string) => this.url('contest_file_download', { tid, filename, type }),
            submissionStats,
        };
        this.response.pjax = [
            ...(!d || d === 'public' ? [['partials/files.html', { filetype: 'public', sidebar }] as const] : []),
            ...(!d || d === 'private'
                ? [
                      [
                          'partials/files.html',
                          {
                              files: this.response.body.privateFiles,
                              filetype: 'private',
                              sidebar,
                          },
                      ] as const,
                  ]
                : []),
        ];
        this.response.template = 'contest_manage.html';
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename, true)
    @post('type', Types.Range(['private', 'public']), true)
    async postUploadFile(_domainId: string, tid: ObjectId, filename: string, type: 'private' | 'public' = 'private') {
        const authoritativeDomainId = this.authoritativeDomainId();
        const allFiles = [...(this.tdoc.files || []), ...(this.tdoc.privateFiles || [])];
        if (allFiles.length >= this.ctx.setting.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        if (Math.sum(allFiles.map((i) => i.size)) + file.size >= this.ctx.setting.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        filename ||= file.originalFilename || randomstring(16);
        const target = `contest/${authoritativeDomainId}/${tid}/${type}/${filename}`;
        await storage.put(target, file.filepath, this.user._id);
        const meta = await storage.getMeta(target);
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!meta) throw new FileUploadError();
        const updateList = (files: FileInfo[], newFile: FileInfo) => (files || []).filter((i) => i._id !== newFile._id).concat(newFile);
        await contest.edit(authoritativeDomainId, tid, {
            files: type === 'private' ? this.tdoc.files : updateList(this.tdoc.files, payload),
            privateFiles: type === 'private' ? updateList(this.tdoc.privateFiles, payload) : this.tdoc.privateFiles,
        });
        this.back();
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    @post('type', Types.Range(['public', 'private']), true)
    async postDeleteFiles(_domainId: string, tid: ObjectId, files: string[], type = 'private') {
        const authoritativeDomainId = this.authoritativeDomainId();
        await Promise.all([
            storage.del(
                files.map((t) => `contest/${authoritativeDomainId}/${tid}/${type}/${t}`),
                this.user._id,
            ),
            contest.edit(
                authoritativeDomainId,
                tid,
                type === 'private'
                    ? { privateFiles: this.tdoc.privateFiles?.filter((i) => !files.includes(i.name)) }
                    : { files: this.tdoc.files?.filter((i) => !files.includes(i.name)) },
            ),
        ]);
        this.back();
    }

    @param('pid', Types.PositiveInt)
    @param('score', Types.PositiveInt)
    async postSetScore(_domainId: string, pid: number, score: number) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.tdoc.pids.includes(pid)) throw new ValidationError('pid');
        this.tdoc.score ||= {};
        this.tdoc.score[pid] = score;
        await contest.edit(authoritativeDomainId, this.tdoc.docId, { score: this.tdoc.score });
        await contest.recalcStatus(authoritativeDomainId, this.tdoc.docId);
        this.back();
    }
}

class ContestClarificationHandler extends ContestManagementBaseHandler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const tcdocs = await contest.getMultiClarification(authoritativeDomainId, tid);
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdoc,
            owner_udoc: await user.getById(authoritativeDomainId, this.tdoc.owner),
            pdict: await problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, [...problem.PROJECTION_CONTEST_LIST, 'tag']),
            tcdocs,
            udict: await user.getListForRender(
                authoritativeDomainId,
                tcdocs.map((i) => i.owner),
                this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
            ),
        };
        this.response.pjax = 'partials/contest_clarification.html';
        this.response.template = 'contest_clarification.html';
    }

    @param('tid', Types.ObjectId)
    @param('content', Types.Content)
    @param('did', Types.ObjectId, true)
    @param('subject', Types.Int, true)
    async postClarification(_domainId: string, tid: ObjectId, content: string, did: ObjectId, subject = 0) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (did) {
            const tcdoc = await contest.getClarification(authoritativeDomainId, did);
            await Promise.all([
                contest.addClarificationReply(authoritativeDomainId, did, 0, content, this.request.ip),
                message.send(
                    1,
                    tcdoc.owner,
                    JSON.stringify({
                        message: 'Contest {0} jury replied to your clarification, please go to contest page to view.',
                        params: [this.tdoc.title],
                        url: this.url('contest_problemlist', { tid }),
                    }),
                    message.FLAG_I18N | message.FLAG_ALERT,
                ),
            ]);
        } else {
            const tsdocs = await contest.getMultiStatus(authoritativeDomainId, { docId: tid, subscribe: 1 }).toArray();
            const uids = Array.from<number>(new Set(tsdocs.map((tsdoc) => tsdoc.uid)));
            const flag = contest.isOngoing(this.tdoc) ? message.FLAG_ALERT : message.FLAG_UNREAD;
            await Promise.all([
                contest.addClarification(authoritativeDomainId, tid, 0, content, this.request.ip, subject),
                message.send(
                    1,
                    uids,
                    JSON.stringify({
                        message: 'Broadcast message from contest {0}:\n{1}',
                        params: [this.tdoc.title, content],
                        url: this.url('contest_problemlist', { tid }),
                    }),
                    flag | message.FLAG_I18N,
                ),
            ]);
        }
        this.back();
    }
}

export class ContestFileDownloadHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    @param('filename', Types.Filename)
    @param('noDisposition', Types.Boolean)
    @param('type', Types.Range(['public', 'private']), true)
    async get(_domainId: string, tid: ObjectId, filename: string, noDisposition = false, type = 'private') {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (contest.RULES[this.tdoc.rule].hidden && !contest.RULES[this.tdoc.rule].features?.includes('download')) {
            throw new ContestNotFoundError(authoritativeDomainId, tid);
        }
        if (type === 'private' && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            if (!this.tsdoc?.attend) throw new ContestNotAttendedError(authoritativeDomainId, tid);
            if (!contest.isOngoing(this.tdoc) && !contest.isDone(this.tdoc)) throw new ContestNotLiveError(authoritativeDomainId, tid);
            if (!this.tsdoc.startAt) await contest.setStatus(authoritativeDomainId, tid, this.user._id, { startAt: new Date() });
        }
        this.response.addHeader('Cache-Control', 'public');
        const target = `contest/${authoritativeDomainId}/${tid}/${type}/${filename}`;
        const file = await storage.getMeta(target);
        await oplog.log(this, 'download.file.contest', {
            target,
            size: file?.size || 0,
        });
        this.response.redirect = await storage.signDownloadLink(target, noDisposition ? undefined : filename, false, 'user');
    }
}

export class ContestUserHandler extends ContestManagementBaseHandler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const tsdocs = await contest
            .getMultiStatus(authoritativeDomainId, { docId: tid })
            .project({
                uid: 1,
                attend: 1,
                startAt: 1,
                unrank: 1,
            })
            .toArray();
        for (const tsdoc of tsdocs) {
            tsdoc.endAt = this.tdoc.duration && tsdoc.startAt ? moment(tsdoc.startAt).add(this.tdoc.duration, 'hours').toDate() : null;
        }
        const udict = await user.getListForRender(
            authoritativeDomainId,
            [this.tdoc.owner, ...tsdocs.map((i) => i.uid)],
            this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
        );
        this.response.body = { tdoc: this.tdoc, tsdocs, udict };
        this.response.pjax = 'partials/contest_user.html';
        this.response.template = 'contest_user.html';
    }

    @param('tid', Types.ObjectId)
    @param('uids', Types.NumericArray)
    @param('unrank', Types.Boolean)
    async postAddUser(_domainId: string, tid: ObjectId, uids: number[], unrank = false) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (unrank) assertIndividualContestUnrankAllowed(this.tdoc.rule, contest.getParticipationMode(this.tdoc));
        await Promise.all(uids.map((uid) => contest.attend(authoritativeDomainId, tid, uid, unrank ? { unrank: true } : {})));
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt)
    async postRank(_domainId: string, tid: ObjectId, uid: number) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const tsdoc = await contest.getStatus(authoritativeDomainId, tid, uid);
        if (!tsdoc) throw new ContestNotAttendedError(uid);
        if (tsdoc.unrank !== undefined && tsdoc.unrank !== null && typeof tsdoc.unrank !== 'boolean') {
            throw new ValidationError('unrank', null, localizedErrorText`打星标记必须是布尔值。`);
        }
        const nextUnrank = !tsdoc.unrank;
        if (nextUnrank) assertIndividualContestUnrankAllowed(this.tdoc.rule, contest.getParticipationMode(this.tdoc));
        await contest.setStatus(authoritativeDomainId, tid, uid, { unrank: nextUnrank });
        logger.info(
            'contest unrank-toggle domain=%s contest=%s uid=%d unrank=%s actor=%d stage=admin',
            authoritativeDomainId,
            tid,
            uid,
            nextUnrank,
            this.user._id,
        );
        this.back();
    }
}

export class ContestBalloonHandler extends ContestManagementBaseHandler {
    @param('tid', Types.ObjectId)
    @param('todo', Types.Boolean)
    async get(_domainId: string, tid: ObjectId, todo = false) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const bdocs = await contest
            .getMultiBalloon(authoritativeDomainId, tid, {
                ...(todo ? { sent: { $exists: false } } : {}),
                ...(!this.tdoc.lockAt || this.user.hasPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD)
                    ? {}
                    : { _id: { $lt: Time.getObjectID(this.tdoc.lockAt) } }),
            })
            .sort({ _id: -1 })
            .toArray();
        const uids = bdocs.map((i) => i.uid).concat(bdocs.filter((i) => i.sent).map((i) => i.sent));
        const teamIds = Array.from(
            new Map(bdocs.filter((item) => item.contestTeamId).map((item) => [item.contestTeamId.toHexString(), item.contestTeamId])).values(),
        );
        const teamDocs = teamIds.length ? await contestTeam.listTeams(authoritativeDomainId, tid, { teamId: { $in: teamIds } }) : [];
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: this.tsdoc,
            owner_udoc: await user.getById(authoritativeDomainId, this.tdoc.owner),
            pdict: await problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, problem.PROJECTION_CONTEST_LIST),
            bdocs,
            teamDict: Object.fromEntries(
                teamDocs.map((team) => [team.teamId.toHexString(), pick(team, ['teamId', 'name', 'captainUid', 'memberUids'])]),
            ),
            udict: await user.getListForRender(authoritativeDomainId, uids, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO)),
        };
        this.response.pjax = 'partials/contest_balloon.html';
        this.response.template = 'contest_balloon.html';
    }

    @param('tid', Types.ObjectId)
    @param('color', Types.Content)
    async postSetColor(_domainId: string, tid: ObjectId, color: string) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const config = yaml.load(color);
        if (typeof config !== 'object') throw new ValidationError('color');
        const balloon = {};
        for (const pid of this.tdoc.pids) {
            if (!config[pid]) throw new ValidationError('color');
            balloon[pid] = config[pid.toString()];
        }
        await contest.edit(authoritativeDomainId, tid, { balloon });
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('balloon', Types.ObjectId)
    async postDone(_domainId: string, tid: ObjectId, bid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const balloon = await contest.getBalloon(authoritativeDomainId, tid, bid);
        if (!balloon) throw new ValidationError('balloon');
        if (balloon.sent) throw new ValidationError('Balloon already sent');
        await contest.updateBalloon(authoritativeDomainId, tid, bid, { sent: this.user._id, sentAt: new Date() });
        this.back();
    }
}

interface BuiltinInput {
    tdoc: Tdoc;
    groups: any[];
}
type AnyFunction = (...args: any) => any;
type ParseArgs<T extends { [key: string]: keyof BuiltinInput | AnyFunction | Type<any> }> = {
    [key in keyof T]: T[key] extends keyof BuiltinInput ? BuiltinInput[T[key]] : T[key] extends AnyFunction ? ReturnType<T[key]> : any;
};
export interface ScoreboardView<T extends { [key: string]: keyof BuiltinInput | AnyFunction | Type<any> }> {
    id: string;
    name: string;
    supportedRules: string[];
    cacheTime?: number; // in seconds
    args: T;
    display: (this: ContestScoreboardHandler, args: ParseArgs<T>) => Promise<void>;
}

export class ContestScoreboardHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId)
    @param('view', Types.String, true)
    async get(_domainId: string, tid: ObjectId, viewId = 'default') {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (contest.RULES[this.tdoc.rule].hidden && !contest.RULES[this.tdoc.rule].features?.includes('scoreboard')) {
            throw new ContestNotFoundError(authoritativeDomainId, tid);
        }
        if (!this.user.own(this.tdoc)) {
            if (!contest.canShowScoreboard.call(this, this.tdoc, true)) throw new ContestScoreboardHiddenError(tid);
            if (contest.isNotStarted(this.tdoc)) throw new ContestNotLiveError(authoritativeDomainId, tid);
        }
        const view = this.ctx.scoreboard.getView(viewId);
        if (!view) throw localizeError(new NotFoundError(`View ${viewId} not found`), 'View {0} not found', viewId);
        const args = {};
        const fetcher = {
            tdoc: () => this.tdoc,
            groups: async () => {
                const allGroups =
                    (this.user.hasPerm(PERM.PERM_EDIT_CONTEST_SELF) && this.user.own(this.tdoc)) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);
                return await user.listGroup(authoritativeDomainId, allGroups ? undefined : this.user._id);
            },
        };
        for (const key in view.args) {
            if (typeof view.args[key] === 'function') {
                try {
                    args[key] = view.args[key](this.args[key]);
                } catch (e) {
                    throw new ValidationError(key);
                }
            } else if (view.args[key] instanceof Array) {
                if (this.args[key] === undefined && view.args[key].find((i) => i === true)) continue;
                if (view.args[key][1] && !view.args[key][1](this.args[key])) throw new ValidationError(key);
                args[key] = view.args[key][0](this.args[key]);
            } else if (fetcher[view.args[key]]) {
                args[key] = await fetcher[view.args[key]]();
            }
        }
        await view.display.call(this, args);
    }

    @param('tid', Types.ObjectId)
    async postUnlock(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
        if (!contest.isDone(this.tdoc)) throw new ContestNotEndedError(authoritativeDomainId, tid);
        await contest.unlockScoreboard(authoritativeDomainId, tid);
        this.back();
    }
}

class ScoreboardService extends Service {
    views: Record<string, ScoreboardView<any>> = {};
    constructor(ctx: Context) {
        super(ctx, 'scoreboard');
    }

    addView<T extends { [key: string]: keyof BuiltinInput | AnyFunction | Type<any> }>(
        id: string,
        name: string,
        args: T,
        {
            display,
            supportedRules,
            cacheTime,
        }: {
            display: (this: ContestScoreboardHandler, args: ParseArgs<T>) => Promise<void>;
            supportedRules: string[];
            cacheTime?: number;
        },
    ) {
        if (this.views[id]) throw new Error(`View ${id} already exists`);
        this.ctx.effect(() => {
            this.views[id] = {
                id,
                name,
                args,
                display,
                supportedRules,
                cacheTime,
            };
            return () => {
                delete this.views[id];
            };
        });
    }

    getAvailableViews(rule: string) {
        return Object.fromEntries(
            Object.values(this.views)
                .filter((i) => i.supportedRules.includes(rule) || i.supportedRules.includes('*'))
                .map((i) => [i.id, i.name]),
        );
    }

    getView(id: string) {
        return this.views[id];
    }
}

declare module 'cordis' {
    interface Context {
        scoreboard: ScoreboardService;
    }
}

export async function apply(ctx: Context) {
    ctx.Route('contest_create', '/contest/create', ContestEditHandler);
    ctx.Route('contest_main', '/contest', ContestListHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_detail', '/contest/:tid', ContestDetailHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_problemlist', '/contest/:tid/problems', ContestProblemListHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_edit', '/contest/:tid/edit', ContestEditHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_print', '/contest/:tid/print', ContestPrintHandler, PERM.PERM_VIEW_CONTEST);
    // Support for DOMJudge printfile
    ctx.Route('contest_print_alt', '/contest/:tid/api/printing/team', ContestPrintHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_manage', '/contest/:tid/management', ContestManagementHandler);
    ctx.Route('contest_clarification', '/contest/:tid/clarification', ContestClarificationHandler);
    ctx.Route('contest_code', '/contest/:tid/code', ContestCodeHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_file_download', '/contest/:tid/file/:type/:filename', ContestFileDownloadHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_user', '/contest/:tid/user', ContestUserHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_balloon', '/contest/:tid/balloon', ContestBalloonHandler, PERM.PERM_VIEW_CONTEST);
    ctx.worker.addHandler('contest', runContestScheduleTask);
    ctx.plugin(ScoreboardService);
    await ctx.inject(['scoreboard'], ({ Route, scoreboard }) => {
        Route('contest_scoreboard', '/contest/:tid/scoreboard', ContestScoreboardHandler, PERM.PERM_VIEW_CONTEST_SCOREBOARD);
        Route('contest_scoreboard_view', '/contest/:tid/scoreboard/:view', ContestScoreboardHandler, PERM.PERM_VIEW_CONTEST_SCOREBOARD);
        scoreboard.addView(
            'default',
            'Default',
            { tdoc: 'tdoc', groups: 'groups', realtime: Types.Boolean },
            {
                async display({ realtime, tdoc, groups }) {
                    if (realtime && !this.user.own(tdoc)) {
                        this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                    }
                    const config: ScoreboardConfig = { isExport: false, showDisplayName: this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO) };
                    if (!realtime && this.tdoc.lockAt && !this.tdoc.unlocked) {
                        config.lockAt = this.tdoc.lockAt;
                    }
                    const [, rows, udict, pdict] = await contest.getScoreboard.call(this, tdoc.domainId, tdoc._id, config);

                    const page_name = tdoc.rule === 'homework' ? 'homework_scoreboard' : 'contest_scoreboard';
                    const availableViews = scoreboard.getAvailableViews(tdoc.rule);
                    // Admin-only columns: studentId / realName looked up via userbind
                    // for every contestant. Mirrors DomainRankHandler — populated only
                    // when the viewer is a system admin so student identities never
                    // leak to ordinary contestants (the frontend hides the columns
                    // when the dict is empty).
                    let studentDict: Record<string, { studentId: string; realName: string }> = {};
                    if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && global.Hydro?.model?.userbind?.findStudentsByUserIds) {
                        const uids = Object.keys(udict)
                            .map(Number)
                            .filter((u) => u && u > 1);
                        const students = await global.Hydro.model.userbind.findStudentsByUserIds(tdoc.domainId, uids);
                        studentDict = Object.fromEntries(
                            Object.entries(students).map(([uid, s]: [string, any]) => [uid, { studentId: s.studentId, realName: s.realName }]),
                        );
                    }
                    const scoreboardExportCapabilities = getScoreboardExportCapabilities({
                        ownsContest: this.user.own(tdoc),
                        canEditContest: this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                        isSystemAdmin: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
                        hasPrivateIdentityData: Object.keys(studentDict).length > 0,
                        teamMode: contest.getParticipationMode(tdoc) === 'team',
                    });
                    this.response.body = {
                        tdoc: this.tdoc,
                        tsdoc: this.tsdocAsPublic(),
                        rows,
                        udict,
                        pdict,
                        page_name,
                        groups,
                        availableViews,
                        studentDict,
                        canExportScoreboardImage: scoreboardExportCapabilities.canExportImage,
                        canExportScoreboardPrivateIdentity: scoreboardExportCapabilities.canIncludePrivateIdentity,
                        scoreboardSnapshotMode: getScoreboardSnapshotMode(!!realtime, contest.isLocked(this.tdoc)),
                    };
                    this.response.pjax = 'partials/scoreboard.html';
                    this.response.template = 'contest_scoreboard.html';
                },
                supportedRules: ['*'],
            },
        );
        scoreboard.addView(
            'ghost',
            'Ghost',
            { tdoc: 'tdoc' },
            {
                async display({ tdoc }) {
                    if (contest.isLocked(tdoc) && !this.user.own(tdoc)) {
                        this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                    }
                    if (contest.getParticipationMode(tdoc) === 'team') {
                        const [pdict, entries] = await Promise.all([
                            problem.getList(tdoc.domainId, tdoc.pids, true, false, problem.PROJECTION_LIST, true),
                            contest.getTeamScoreboardEntries(tdoc),
                        ]);
                        const memberUids = Array.from(new Set(entries.flatMap(({ team }) => team.memberUids)));
                        const udict = await user.getList(tdoc.domainId, memberUids);
                        const elapsed = (rid: ObjectId) => Math.floor((rid.getTimestamp().getTime() - tdoc.beginAt.getTime()) / Time.second);
                        const problemLabel = (index: number) => getAlphabeticId(index);
                        const escapeGhost = (value: string) => value.replace(/[",]/g, '');
                        const statusMap = {
                            [STATUS.STATUS_ACCEPTED]: 'OK',
                            [STATUS.STATUS_WRONG_ANSWER]: 'WA',
                            [STATUS.STATUS_COMPILE_ERROR]: 'CE',
                            [STATUS.STATUS_TIME_LIMIT_EXCEEDED]: 'TL',
                            [STATUS.STATUS_RUNTIME_ERROR]: 'RT',
                        };
                        const submissions = entries.flatMap(({ status }, index) => {
                            const counts = Counter();
                            return (status.journal || [])
                                .filter((item) => tdoc.pids.includes(item.pid))
                                .map((item) => {
                                    const label = problemLabel(tdoc.pids.indexOf(item.pid));
                                    counts[label]++;
                                    return `@s ${index + 1},${label},${counts[label]},${elapsed(item.rid)},${statusMap[item.status] || 'RJ'}`;
                                });
                        });
                        const res = [
                            `@contest "${escapeGhost(tdoc.title)}"`,
                            `@contlen ${Math.floor((tdoc.endAt.getTime() - tdoc.beginAt.getTime()) / Time.minute)}`,
                            `@problems ${tdoc.pids.length}`,
                            `@teams ${entries.length}`,
                            `@submissions ${submissions.length}`,
                        ].concat(
                            tdoc.pids.map(
                                (problemId, index) => `@p ${problemLabel(index)},${escapeGhost(pdict[problemId]?.title || 'Unknown Problem')},20,0`,
                            ),
                            entries.map(({ team }, index) => {
                                const captain = udict[team.captainUid]?.uname || `UID ${team.captainUid}`;
                                const members = team.memberUids.map((uid) => udict[uid]?.uname || `UID ${uid}`).join('/');
                                return `@t ${index + 1},0,1,"${escapeGhost(`${team.name} [${captain}; ${members}]`)}"`;
                            }),
                            submissions,
                        );
                        this.binary(res.join('\n'), `${this.tdoc.title}.ghost`);
                        return;
                    }
                    const [pdict, teams] = await Promise.all([
                        problem.getList(tdoc.domainId, tdoc.pids, true, false, problem.PROJECTION_LIST, true),
                        contest.getMultiStatus(tdoc.domainId, { docId: tdoc._id }).toArray(),
                    ]);
                    const udict = await user.getList(
                        tdoc.domainId,
                        teams.map((i) => i.uid),
                    );
                    const teamIds: Record<number, number> = {};
                    for (let i = 1; i <= teams.length; i++) teamIds[teams[i - 1].uid] = i;
                    const time = (t: ObjectId) => Math.floor((t.getTimestamp().getTime() - tdoc.beginAt.getTime()) / Time.second);
                    const pid = (i: number) => getAlphabeticId(i);
                    const escape = (i: string) => i.replace(/[",]/g, '');
                    const unknownSchool = this.translate('Unknown School');
                    const statusMap = {
                        [STATUS.STATUS_ACCEPTED]: 'OK',
                        [STATUS.STATUS_WRONG_ANSWER]: 'WA',
                        [STATUS.STATUS_COMPILE_ERROR]: 'CE',
                        [STATUS.STATUS_TIME_LIMIT_EXCEEDED]: 'TL',
                        [STATUS.STATUS_RUNTIME_ERROR]: 'RT',
                    };
                    const submissions = teams.flatMap((i, idx) => {
                        if (!i.journal) return [];
                        const journal = i.journal.filter((s) => tdoc.pids.includes(s.pid));
                        const c = Counter();
                        return journal.map((s) => {
                            const id = pid(tdoc.pids.indexOf(s.pid));
                            c[id]++;
                            return `@s ${idx + 1},${id},${c[id]},${time(s.rid)},${statusMap[s.status] || 'RJ'}`;
                        });
                    });
                    const res = [
                        `@contest "${escape(tdoc.title)}"`,
                        `@contlen ${Math.floor((tdoc.endAt.getTime() - tdoc.beginAt.getTime()) / Time.minute)}`,
                        `@problems ${tdoc.pids.length}`,
                        `@teams ${tdoc.attend}`,
                        `@submissions ${submissions.length}`,
                    ].concat(
                        tdoc.pids.map((i, idx) => `@p ${pid(idx)},${escape(pdict[i]?.title || 'Unknown Problem')},20,0`),
                        teams.map((i, idx) => {
                            const showName =
                                this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO) && udict[i.uid].displayName
                                    ? udict[i.uid].displayName
                                    : udict[i.uid].uname;
                            const teamName = `${i.rank ? '*' : ''}${escape(udict[i.uid].school || unknownSchool)}-${escape(showName)}`;
                            return `@t ${idx + 1},0,1,"${teamName}"`;
                        }),
                        submissions,
                    );
                    this.binary(res.join('\n'), `${this.tdoc.title}.ghost`);
                },
                supportedRules: ['*'],
            },
        );
        scoreboard.addView(
            'html',
            'HTML',
            { tdoc: 'tdoc' },
            {
                async display({ tdoc }) {
                    await this.limitRate('scoreboard_download', 60, 3);
                    const [, rows] = await contest.getScoreboard.call(this, tdoc.domainId, tdoc._id, {
                        isExport: true,
                        lockAt: this.tdoc.lockAt,
                        showDisplayName: this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
                    });
                    this.binary(await this.renderHTML('contest_scoreboard_download_html.html', { rows, tdoc }), `${this.tdoc.title}.html`);
                },
                supportedRules: ['*'],
            },
        );
        scoreboard.addView(
            'csv',
            'CSV',
            { tdoc: 'tdoc' },
            {
                async display({ tdoc }) {
                    await this.limitRate('scoreboard_download', 60, 3);
                    const [, rows] = await contest.getScoreboard.call(this, tdoc.domainId, tdoc._id, {
                        isExport: true,
                        lockAt: this.tdoc.lockAt,
                        showDisplayName: this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
                    });
                    this.binary(
                        toCSV(
                            rows.map((r) => r.map((c) => c.value.toString())),
                            { bom: true },
                        ),
                        `${this.tdoc.title}.csv`,
                    );
                },
                supportedRules: ['*'],
            },
        );
    });
}
