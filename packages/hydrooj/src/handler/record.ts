import { readStoredSetConfig } from '@hydrooj/common';
import { omit, pick, throttle } from 'lodash';
import { effectiveProblemKind, homeworkKindRevealsVerdict, normalizeSubtasks, type ProblemConfigFile } from '@hydrooj/common';
import { readYamlCases } from '@hydrooj/common/cases';
import { load as loadYaml } from 'js-yaml';
import { Filter, ObjectId } from 'mongodb';
import {
    localizeError,
    localizedErrorText,
    ContestClientFinishedError,
    ContestNotFoundError,
    HackRejudgeFailedError,
    PermissionError,
    PretestRejudgeFailedError,
    ProblemConfigError,
    ProblemNotFoundError,
    RecordNotFoundError,
    ValidationError,
} from '../error';
import { RecordDoc, Tdoc } from '../interface';
import { canAccessPostContestPracticeRecord, canUsePostContestPractice } from '../lib/contest-correction';
import {
    concealHomeworkObjectiveFromStudent,
    concealObjectiveRecord,
    loadHomeworkProblemKinds,
} from '../lib/homework-objective-verdict';
import { canManageTeachContainer } from '../lib/teach-access';
import { studentContestProblemPids, type ExamPaperStatusClock } from '../lib/exam-paper';
import { currentSetProblemPids, projectCurrentSetTdoc } from '../lib/set-problem-access';
import { assertSetParticipation } from '../lib/set-participation-access';
import { canUseSetCapability, isSetManager } from '../lib/set-permissions';
import { projectLiveExamRecord } from '../lib/exam-live-record';
import { canViewVirtualContestRecord, isVirtualAttemptOpen } from '../lib/virtual-contest';
import { buildPersonalPracticeRecordQuery } from '../lib/contest-problem-status';
import { buildExamModeRecordCodePayload, shouldUseLiveClientRecordCodeOnly } from '../lib/exam-mode-record';
import { formatRecordJudgeMessages } from '../lib/record-judge-presentation';
import { matchesRecordConnectionScope, RECORD_PRETEST_CONTEST_ID } from '../lib/record-connection-scope';
import { recordDateRange, resolveRecordUserIds } from '../lib/record-list-filter';
import { clientProblemConfig, parseProblemConfigObject } from '../lib/problem-config';
import { parseConfig } from '../lib/testdataConfig';
import { PERM, PRIV, STATUS, STATUS_TEXTS } from '../model/builtin';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import problem, { ProblemDoc } from '../model/problem';
import {
    PROBLEM_ACL_INTERNAL_FIELDS,
    readContextViewableProblem,
    type ProblemAclUser,
    type ProblemViewContext,
} from '../model/problem-access';
import record from '../model/record';
import {
    auditRecordScorePermissionRejection,
    cancelRecordScore,
    getRecordScoreAction,
    recoverCanceledRecord,
} from '../model/record-score-cancellation';
import { langs } from '../model/setting';
import storage from '../model/storage';
import system from '../model/system';
import user from '../model/user';
import { ConnectionHandler, param, subscribe, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';
import { Logger } from '../logger';
import { buildProjection, Time } from '../utils';
import {
    canManageVirtualContest,
    virtualContestService,
    type VirtualContestActor,
    type VirtualContestAttemptDoc,
} from '../model/virtual-contest';
import { assertHomeworkAccessOrHide, ContestDetailBaseHandler, hideAssignRestrictedContest } from './contest';

const logger = new Logger('record-handler');
const NON_CONTEST_RECORD_SENTINELS = [record.RECORD_GENERATE, record.RECORD_PRETEST, record.RECORD_VERIFY];

function canSearchRecordStudents(actor: Parameters<typeof canManageTeachContainer>[0], tdoc?: Tdoc) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || !!(tdoc && canManageTeachContainer(actor, tdoc.rule === 'homework' ? 'homework' : 'exam', tdoc));
}

async function recordUserIds(domainId: string, query: string, allowStudents: boolean) {
    return resolveRecordUserIds(query, async (value) =>
        (/^\d+$/.test(value) ? await user.getById(domainId, +value) : null)
        || await user.getByUname(domainId, value)
        || await user.getByEmail(domainId, value),
    allowStudents ? (value) => studentDirectory().searchBoundStudents(domainId, value, 0) : undefined);
}

function isNonContestSentinel(contestId: unknown): boolean {
    return contestId instanceof ObjectId && NON_CONTEST_RECORD_SENTINELS.some((sentinel) => sentinel.equals(contestId));
}

function isVerifyRecord(contestId: unknown): boolean {
    return contestId instanceof ObjectId && record.RECORD_VERIFY.equals(contestId);
}

function assertVerifyRecordVisible(
    rdoc: RecordDoc,
    actor: { _id: number; hasPriv: (priv: number) => boolean },
    practice: boolean,
) {
    if (!isVerifyRecord(rdoc.contest)) return;
    if (!practice && (rdoc.uid === actor._id || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM))) return;
    logger.warn(
        'Verify record view rejected domain=%s uid=%d rid=%s stage=detail result=denied',
        rdoc.domainId,
        actor._id,
        rdoc._id.toHexString(),
    );
    throw new PermissionError(PERM.PERM_VIEW_RECORD);
}

function isContestNotFoundError(error: unknown): boolean {
    return error instanceof ContestNotFoundError || (error instanceof Error && error.name === 'ContestNotFoundError');
}

async function hideLoadedContest(domainId: string, tdoc: Tdoc, actor: any) {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
    if (tdoc.rule === 'homework') await assertHomeworkAccessOrHide(domainId, tdoc, actor);
    else await hideAssignRestrictedContest(domainId, tdoc, actor);
}

async function assertSetRecordAccess(handler: Parameters<typeof assertSetParticipation>[0], tdoc: Tdoc) {
    const { status } = await assertSetParticipation(handler, tdoc, false);
    if (tdoc._code && !status?.attend && !isSetManager(tdoc, handler.user)) throw new PermissionError(PERM.PERM_VIEW_RECORD);
}

async function recheckSetRecordParticipation(handler: ConnectionHandler, tdoc: Tdoc, rid: ObjectId): Promise<boolean> {
    try {
        await assertSetRecordAccess(handler, tdoc);
        return true;
    } catch (error) {
        if (error instanceof PermissionError || error instanceof ContestNotFoundError
            || error instanceof ContestClientFinishedError || error instanceof ValidationError) {
            logger.info('Record connection access revoked domain=%s tid=%s rid=%s uid=%d reason=%s',
                tdoc.domainId, tdoc.docId, rid, handler.user._id, error.message);
            handler.close(4003, 'Problem set record access revoked');
            return false;
        }
        throw error;
    }
}

async function projectRecordProblem(tdoc: Tdoc | undefined, actor: Parameters<typeof isSetManager>[1], pdoc: ProblemDoc) {
    if (!tdoc?.setConfig || isSetManager(tdoc, actor)) return pdoc;
    if (!await canUseSetCapability(tdoc, actor, 'view')) {
        const config = pdoc.config && typeof pdoc.config === 'object' ? pdoc.config : { type: 'default' };
        const questions: unknown = 'questions' in config ? config.questions : undefined;
        return {
            ...pick(pdoc, ['domainId', 'docId', 'pid', 'problemKind']),
            title: '题目不可见',
            config: {
                type: config.type,
                ...(Array.isArray(questions) ? { questions: questions.map((question) => pick(question, ['key', 'kind', 'score', 'presentation'])) } : {}),
            },
        };
    }
    return readStoredSetConfig(tdoc).settings.experience?.showDifficulty ? pdoc : omit(pdoc, ['difficulty']);
}

function canRejudgeVirtualOnList(
    actor: VirtualContestActor,
    tdoc: Tdoc | undefined,
    rdocs: RecordDoc[],
): boolean {
    if (!rdocs.some((rdoc) => rdoc.virtualAttemptId)) return false;
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_EDIT_CONTEST)) return true;
    return Boolean(tdoc && canManageVirtualContest(actor, tdoc));
}

const STABLE_VIEW_AUTHORIZATION_FIELDS = ['domainId', 'docId', 'owner', 'hidden', 'authoringMode', 'pidNamespaceId', 'managedAuthoring'] as const;

function stableViewProjection(projection: readonly (keyof ProblemDoc)[]): (keyof ProblemDoc)[] {
    // ACL coordination fields are persisted but absent from ProblemDoc; they are
    // projected out again by stripUnrequestedStableViewFields.
    return Array.from(new Set([...projection, ...STABLE_VIEW_AUTHORIZATION_FIELDS, ...PROBLEM_ACL_INTERNAL_FIELDS])) as (keyof ProblemDoc)[];
}

function stripUnrequestedStableViewFields(pdoc: ProblemDoc | null, requested: readonly (keyof ProblemDoc)[]): ProblemDoc | null {
    if (!pdoc) return null;
    const wanted = new Set(requested);
    for (const field of STABLE_VIEW_AUTHORIZATION_FIELDS) {
        if (!wanted.has(field)) delete pdoc[field];
    }
    return pdoc;
}

async function parseProjectedConfig(pdoc: ProblemDoc, projection: readonly string[], rawConfig: boolean) {
    if (rawConfig || !projection.includes('config')) return pdoc;
    try {
        pdoc.config = await parseConfig(pdoc.config as string | ProblemConfigFile, pdoc.data?.map((item) => item.name) || []);
    } catch (error) {
        pdoc.config = `Cannot parse: ${(error as Error).message}`;
    }
    return pdoc;
}

function createStableProblemRead(domainId: string, pid: string | number, projection: readonly (keyof ProblemDoc)[], rawConfig = false) {
    const readProjection = stableViewProjection(projection);
    return async (filter?: Filter<ProblemDoc>) => {
        if (!filter) return problem.get(domainId, pid, readProjection, rawConfig);
        const [res] = await problem.getMulti(domainId, filter, readProjection).limit(1).toArray();
        if (!res) return null;
        return parseProjectedConfig(res, readProjection, rawConfig);
    };
}

async function readRecordContextProblem(
    domainId: string,
    // eslint-disable-next-line ts/no-shadow
    user: ProblemAclUser,
    context: ProblemViewContext,
    pid: string | number,
    projection: readonly (keyof ProblemDoc)[],
    rawConfig = false,
) {
    const pdoc = await readContextViewableProblem(domainId, user, context, {
        readDirectStable: createStableProblemRead(domainId, pid, projection, rawConfig),
        readContainer: () => problem.get(domainId, pid, [...projection], rawConfig),
    });
    return stripUnrequestedStableViewFields(pdoc, projection);
}

async function getCurrentTeamForRecord(domainId: string, rdoc: RecordDoc, uid: number): Promise<contestTeam.ContestTeamDoc | null> {
    if (!(rdoc.contest instanceof ObjectId) || !(rdoc.contestTeamId instanceof ObjectId)) return null;
    if (isNonContestSentinel(rdoc.contest)) return null;
    const team = await contestTeam.getTeam(domainId, rdoc.contest, rdoc.contestTeamId);
    return team?.memberUids.includes(uid) ? team : null;
}

async function canAccessCurrentTeamRecord(domainId: string, rdoc: RecordDoc, uid: number): Promise<boolean> {
    return !!(await getCurrentTeamForRecord(domainId, rdoc, uid));
}

async function assertVirtualContestRecordAccess(
    domainId: string,
    rdoc: RecordDoc,
    actor: { _id: number; hasPerm: (...perm: bigint[]) => boolean; hasPriv: (priv: number) => boolean; own: (doc: { owner?: number }) => boolean },
): Promise<VirtualContestAttemptDoc> {
    if (!rdoc.virtualAttemptId || !rdoc.sourceContestId) throw new PermissionError(PERM.PERM_VIEW_RECORD);
    const attempt = await virtualContestService.getAttempt(domainId, rdoc.virtualAttemptId);
    if (String(attempt.sourceContestId) !== String(rdoc.sourceContestId)) {
        throw new PermissionError(PERM.PERM_VIEW_RECORD);
    }
    const tdoc = await contest.get(domainId, attempt.sourceContestId);
    const mine = await virtualContestService.getOfficialAttempt(domainId, attempt.sourceContestId, actor._id);
    if (
        !canViewVirtualContestRecord({
            attempt,
            viewerUid: actor._id,
            canManage: canManageVirtualContest(actor, tdoc),
            viewerHasEnded: mine?.status === 'ended',
        })
    ) {
        throw new PermissionError(PERM.PERM_VIEW_RECORD);
    }
    return attempt;
}

export class RecordListHandler extends ContestDetailBaseHandler {
    @param('tid', Types.ObjectId, true)
    async __prepare(domainId: string, tid: ObjectId) {
        if (!tid) return;
        try {
            await super.__prepare(domainId, tid);
        } catch (error) {
            if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && this.tdoc && isContestNotFoundError(error)) return;
            throw error;
        }
    }

    @param('page', Types.PositiveInt, true)
    @param('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('virtual', Types.Boolean)
    @param('uidOrName', Types.String, true)
    @param('lang', Types.String, true)
    @param('status', Types.Int, true)
    @param('fullStatus', Types.Boolean)
    @param('all', Types.Boolean)
    @param('allDomain', Types.Boolean)
    @param('stat', Types.Boolean)
    @param('from', Types.String, true)
    @param('to', Types.String, true)
    async get(
        domainId: string,
        page = 1,
        pid?: string | number,
        tid?: ObjectId,
        practice = false,
        virtual = false,
        uidOrName?: string,
        lang?: string,
        status?: number,
        full = false,
        all = false,
        allDomain = false,
        stat = false,
        from = '',
        to = '',
    ) {
        const notification = [];
        let tdoc = null;
        let invalid = false;
        let teamRecordAccess = false;
        let postContestPracticeActive = false;
        let virtualAttemptOpen = false;
        let virtualAttemptPids: number[] | undefined;
        this.response.template = 'record_main.html';
        // tid undefined → practice mode. The Node MongoDB driver strips
        // {contest: undefined} from the filter, which would otherwise let
        // pretest records (contest = RECORD_PRETEST sentinel) leak into
        // the per-problem "提交记录" list. Build the contest filter
        // explicitly to keep practice records (no contest field) only.
        let q: Filter<RecordDoc> = tid ? { contest: tid } : { contest: { $exists: false }, virtualAttemptId: { $exists: false } };
        if (practice && !tid) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        if (virtual && practice) throw new ValidationError('virtual');
        if (virtual && !tid) throw new ValidationError('tid');
        if (virtual && (all || allDomain)) throw new ValidationError('virtual');
        if (full) uidOrName = this.user._id.toString();
        if (uidOrName) {
            const uids = await recordUserIds(domainId, uidOrName, canSearchRecordStudents(this.user, this.tdoc));
            q.uid = uids.length === 1 ? uids[0] : { $in: uids };
            if (!uids.length) invalid = true;
        }
        if (tid) {
            tdoc = this.tdoc || await contest.get(domainId, tid);
            if (tdoc) await hideLoadedContest(domainId, tdoc, this.user);
            this.tdoc = tdoc;
            if (!tdoc) throw localizeError(new ContestNotFoundError(domainId, pid), 'Contest {0} not found.', tid);
            if (tdoc.setConfig && !practice && !virtual) await assertSetRecordAccess(this, tdoc);
            if (virtual) {
                const attempt = await virtualContestService.getOfficialAttempt(domainId, tid, this.user._id);
                if (!attempt) throw new ValidationError('virtual', null, localizedErrorText`虚拟参赛尚未开始`);
                const canManage = canManageVirtualContest(this.user, tdoc);
                if (!canManage && attempt.uid !== this.user._id) throw new PermissionError(PERM.PERM_VIEW_RECORD);
                virtualAttemptOpen = isVirtualAttemptOpen(attempt);
                virtualAttemptPids = attempt.snapshot.pids;
                q = { virtualAttemptId: attempt._id, uid: canManage && uidOrName ? q.uid : attempt.uid };
            } else {
                postContestPracticeActive = practice && canUsePostContestPractice(tdoc, this.tsdoc);
                if (practice && !postContestPracticeActive) throw new PermissionError(PERM.PERM_VIEW_RECORD);
                if (postContestPracticeActive) {
                    if (!pid || all || allDomain || (q.uid !== undefined && q.uid !== this.user._id)) {
                        throw new PermissionError(PERM.PERM_VIEW_RECORD);
                    }
                    q = buildPersonalPracticeRecordQuery(this.user._id, tdoc.pids);
                } else if (contest.getParticipationMode(tdoc) === 'team' && q.uid === this.user._id) {
                    const team = await contestTeam.getTeamByMember(domainId, tid, this.user._id);
                    if (team) {
                        delete q.uid;
                        q.contestTeamId = team.teamId;
                        teamRecordAccess = true;
                    } else this.checkPerm(PERM.PERM_VIEW_RECORD);
                }
                if (!postContestPracticeActive) {
                    if (!teamRecordAccess && q.uid !== this.user._id && (!tdoc.setConfig || !await contest.canShowRecordForUser.call(this, tdoc, true, 'list'))) this.checkPerm(PERM.PERM_VIEW_RECORD);
                    const ownRecords = teamRecordAccess || q.uid === this.user._id;
                    // An open exam keeps the scoreboard hidden. That must not block a student from reading their own submissions.
                    const examOwnRecords = (tdoc.setConfig || tdoc.rule === 'exam') && ownRecords && (await contest.canShowSelfRecordForUser.call(this, tdoc, true));
                    const canListOthers = await contest.canShowRecordForUser.call(this, tdoc, true, 'list');
                    if (!examOwnRecords && !canListOthers && !(await contest.canShowScoreboardForUser.call(this, tdoc, true))) {
                        throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                    }
                    if (!(ownRecords ? await contest.canShowSelfRecordForUser.call(this, tdoc, true) : canListOthers)) {
                        throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                    }
                    if (!(await contest.getStatus(domainId, tid, this.user._id))?.attend) {
                        const name = tdoc.rule === 'homework' ? "You haven't claimed this homework yet." : "You haven't attended this contest yet.";
                        notification.push({ name, args: { type: 'note' }, checker: () => true });
                    }
                }
            }
        } else if (q.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
        else if (q.uid === this.user._id) {
            q = { $or: [{ contest: { $exists: false }, virtualAttemptId: { $exists: false } }, { virtualAttemptId: { $exists: true } }], uid: this.user._id };
        }
        if (pid) {
            if (typeof pid === 'string' && tdoc && /^[A-Z]$/.test(pid)) {
                const canManageContest = this.user.own(tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);
                const visiblePids = virtualAttemptPids ?? await currentSetProblemPids(tdoc, this.user._id, canManageContest) ?? studentContestProblemPids(
                    tdoc,
                    this.tsdoc,
                    canManageContest,
                );
                pid = visiblePids[Number.parseInt(pid, 36) - 10];
            }
            const pdoc = tdoc
                ? await problem.get(domainId, pid)
                : await problem.getViewableAuthorized(domainId, pid, this.user, problem.PROJECTION_LIST);
            if (pdoc) {
                if (
                    postContestPracticeActive &&
                    !canAccessPostContestPracticeRecord(tdoc, this.tsdoc, {
                        pid: pdoc.docId,
                        actorUid: this.user._id,
                        recordUid: this.user._id,
                    })
                ) {
                    throw new PermissionError(PERM.PERM_VIEW_RECORD);
                }
                q.pid = pdoc.docId;
            } else if (postContestPracticeActive) throw new ProblemNotFoundError(domainId, pid);
            else invalid = true;
        }
        if (lang) q.lang = lang;
        if (typeof status === 'number') {
            if (tdoc && !virtual && !postContestPracticeActive
                && !await contest.canFilterRecordStatus(tdoc, this.user.own(tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST), typeof q.pid === 'number' ? q.pid : undefined)) {
                throw new ValidationError('status', null, localizedErrorText`评测结果尚未公开，暂时不能按结果筛选。`);
            }
            q.status = status;
        }
        if (all) {
            this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            this.checkPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD);
            q.contest = { $nin: NON_CONTEST_RECORD_SENTINELS };
            q.virtualAttemptId = { $exists: false };
        }
        if (allDomain) {
            this.checkPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN);
            q.contest = { $nin: NON_CONTEST_RECORD_SENTINELS };
            q.virtualAttemptId = { $exists: false };
            q._id = { $gt: Time.getObjectID(new Date(Date.now() - 10 * Time.week)) };
        }
        const dateRange = recordDateRange(from, to);
        if (dateRange) q.$and = [...(q.$and || []), { _id: dateRange }];
        let cursor = record.getMulti(allDomain ? '' : domainId, q).sort('_id', -1);
        if (!full) cursor = cursor.project(buildProjection(record.PROJECTION_LIST));
        const limit = full ? 10 : system.get('pagination.record');
        let rdocs = invalid
            ? ([] as RecordDoc[])
            : await cursor
                  .skip((page - 1) * limit)
                  .limit(limit)
                  .toArray();
        const recordScoreActions = this.user.hasPerm(PERM.PERM_REJUDGE)
            ? Object.fromEntries(
                  (await Promise.all(rdocs.map(async (rdoc) => [rdoc._id.toHexString(), await getRecordScoreAction(rdoc, true)] as const))).filter(
                      (entry) => entry[1],
                  ),
              )
            : {};
        rdocs = rdocs.map((rdoc) => omit(rdoc, ['scoreCancellation'])) as RecordDoc[];
        if (tdoc && concealHomeworkObjectiveFromStudent(tdoc, canManageTeachContainer(this.user, 'homework', tdoc))) {
            const kinds = await loadHomeworkProblemKinds(tdoc.domainId, tdoc.pids || []);
            rdocs = rdocs.map((rdoc) => {
                const kind = kinds.get(rdoc.pid);
                return kind && homeworkKindRevealsVerdict(kind) ? rdoc : concealObjectiveRecord(rdoc);
            });
        }
        const [udict, pdict] = full
            ? [{}, {}]
            : await Promise.all([
                  user.getList(
                      domainId,
                      rdocs.map((rdoc) => rdoc.uid),
                  ),
                  tid
                      ? problem.getList(
                            domainId,
                            rdocs.map((rdoc) => rdoc.pid),
                            true,
                            false,
                            problem.PROJECTION_CONTEST_LIST,
                        )
                      : problem.getListViewableAuthorized(
                            domainId,
                            rdocs.map((rdoc) => rdoc.pid),
                            this.user,
                            problem.PROJECTION_LIST,
                        ),
              ]);
        if (this.tdoc && !postContestPracticeActive && !virtual && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            rdocs = await Promise.all(rdocs.map((i) => contest.applyProjection(this.tdoc, i, this.user)));
            if (this.tdoc.rule === 'exam') {
                const kinds = await loadHomeworkProblemKinds(this.tdoc.domainId, rdocs.map((item) => item.pid));
                rdocs = rdocs.map((item) => projectLiveExamRecord(this.tdoc, item, kinds.get(item.pid) ?? null));
            }
        }
        // Canonical student identity is available to system admins and this container
        // manager; ordinary viewers retain the public account projection.
        let studentDict: Record<string, { studentId: string; realName: string }> = {};
        if (canSearchRecordStudents(this.user, tdoc)) {
            const uids = Array.from(new Set(rdocs.map((r) => r.uid))).filter((u) => u && u > 1);
            const students = await studentDirectory().findStudentsByUserIds(domainId, uids);
            studentDict = Object.fromEntries(
                Object.entries(students).map(([uid, s]: [string, any]) => [uid, { studentId: s.studentId, realName: s.realName }]),
            );
        }
        this.response.body = {
            page,
            rdocs,
            tdoc: tdoc
                ? await projectCurrentSetTdoc(
                      tdoc,
                      this.user._id,
                      this.user.own(tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                      this.tsdoc,
                  )
                : tdoc,
            pdict: tdoc?.setConfig ? Object.fromEntries(await Promise.all(Object.entries(pdict).map(async ([problemId, pdoc]) =>
                [problemId, await projectRecordProblem(tdoc, this.user, pdoc)]))) : pdict,
            udict,
            studentDict,
            all,
            allDomain,
            filterPid: pid,
            filterTid: tid,
            virtual,
            virtualAttemptOpen,
            filterUidOrName: uidOrName,
            filterLang: lang,
            filterStatus: status,
            filterFrom: from,
            filterTo: to,
            canSearchStudents: canSearchRecordStudents(this.user, tdoc),
            notification,
            teamRecordAccess,
            postContestPracticeActive,
            recordDetailTid: postContestPracticeActive || virtual ? tid : undefined,
            recordScoreActions,
            canRejudgeVirtual: canRejudgeVirtualOnList(this.user, tdoc, rdocs),
            langs,
            statusTexts: STATUS_TEXTS,
        };
        if (stat) {
            // Contest scope (PLAN 2026-07-02 §8): owner/teacher only — a
            // student (incl. the vigil exam shell) never satisfies this, so
            // the exam-mode record list DOM is unchanged for them.
            if (tid && this.tdoc && (this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST))) {
                this.response.body.statistics = await record.stat(domainId, tid);
                this.response.body.statisticsScope = 'contest';
            } else if (this.user.hasPriv(PRIV.PRIV_VIEW_JUDGE_STATISTICS)) {
                this.response.body.statistics = await record.stat(allDomain ? undefined : domainId);
                this.response.body.statisticsScope = allDomain ? 'all' : 'domain';
            }
        }
    }
}

export class RecordDetailHandler extends ContestDetailBaseHandler {
    rdoc: RecordDoc;
    authorizedSetRecord = false;
    teamRecordAccess = false;
    postContestPracticeRecordAccess = false;
    contestPretestRecordAccess = false;
    virtualAttempt?: VirtualContestAttemptDoc;

    // Same tid decoration as RecordListHandler. A direct call is (domainId, rid, tid);
    // the param decorator calls (domainId, tid) and the route rid stays on this.args.
    // Either way a verify record must return before the base handler loads ?tid=.
    @param('tid', Types.ObjectId, true)
    async __prepare(domainId: string, tid: ObjectId, positionalTid?: ObjectId) {
        const directCall = positionalTid !== undefined;
        const contestTid = directCall ? positionalTid : tid;
        const rawRid = directCall ? tid : this.args?.rid;
        const rid = rawRid instanceof ObjectId
            ? rawRid
            : typeof rawRid === 'string' && ObjectId.isValid(rawRid)
                ? new ObjectId(rawRid)
                : undefined;
        if (rid) {
            const rdoc = await record.get(domainId, rid);
            if (isVerifyRecord(rdoc?.contest)) {
                this.tdoc = undefined;
                this.tsdoc = undefined;
                return;
            }
        }
        await super.__prepare(domainId, contestTid);
    }

    @param('rid', Types.ObjectId)
    @param('practice', Types.Boolean)
    async prepare(domainId: string, rid: ObjectId, practice = false) {
        this.rdoc = await record.get(domainId, rid);
        if (!this.rdoc) throw new RecordNotFoundError(rid);
        assertVerifyRecordVisible(this.rdoc, this.user, practice);
        if (isVerifyRecord(this.rdoc.contest)) {
            this.tdoc = undefined;
            this.tsdoc = undefined;
            return;
        }
        if (this.rdoc.virtualAttemptId) {
            if (practice) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            this.virtualAttempt = await assertVirtualContestRecordAccess(domainId, this.rdoc, this.user);
            this.tdoc = await contest.get(domainId, this.rdoc.sourceContestId);
            return;
        }
        const realContestRecord = this.rdoc.contest instanceof ObjectId && !isNonContestSentinel(this.rdoc.contest);
        if (practice) {
            if (!this.args.tid || !this.tdoc || realContestRecord) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            const ordinaryRecord = this.rdoc.contest === undefined;
            const pretestRecord = this.rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(this.rdoc.contest);
            if (
                (!ordinaryRecord && !pretestRecord) ||
                this.rdoc.hackTarget !== undefined ||
                this.rdoc.contestTeamId !== undefined ||
                (ordinaryRecord && this.rdoc.input !== undefined) ||
                !canAccessPostContestPracticeRecord(this.tdoc, this.tsdoc, {
                    pid: this.rdoc.pid,
                    actorUid: this.user._id,
                    recordUid: this.rdoc.uid,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.postContestPracticeRecordAccess = true;
            return;
        }
        if (this.args.tid && this.tdoc && this.rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(this.rdoc.contest)) {
            if (
                this.rdoc.uid !== this.user._id ||
                this.tsdoc?.attend !== 1 ||
                !studentContestProblemPids(
                    this.tdoc,
                    this.tsdoc,
                    this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                ).includes(this.rdoc.pid)
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.contestPretestRecordAccess = true;
            return;
        }
        if (realContestRecord) {
            this.tdoc = await contest.get(domainId, this.rdoc.contest);
            if (this.tdoc.setConfig) {
                await assertSetRecordAccess(this, this.tdoc);
                this.authorizedSetRecord = true;
            }
            if (contest.getParticipationMode(this.tdoc) === 'team') {
                if (!(this.rdoc.contestTeamId instanceof ObjectId)) throw new PermissionError(rid);
                this.teamRecordAccess = await canAccessCurrentTeamRecord(domainId, this.rdoc, this.user._id);
                if (!this.teamRecordAccess && (!this.tdoc.setConfig || !await contest.canShowRecordForUser.call(this, this.tdoc))) this.checkPerm(PERM.PERM_VIEW_RECORD);
                return;
            }
        }
        if (this.rdoc.uid !== this.user._id && (!this.tdoc?.setConfig || !await contest.canShowRecordForUser.call(this, this.tdoc))) this.checkPerm(PERM.PERM_VIEW_RECORD);
        this.tdoc = undefined;
        this.tsdoc = undefined;
    }

    async download() {
        for (const file of ['code', 'hack']) {
            if (!this.rdoc.files?.[file]) continue;
            const [id, filename] = this.rdoc.files?.[file]?.split('#') || [];

            this.response.redirect = await storage.signDownloadLink(`submission/${id}`, filename || file, true, 'user');
            return;
        }
        const lang = langs[this.rdoc.lang]?.pretest || this.rdoc.lang;
        this.response.body = this.rdoc.code;
        this.response.type = 'text/plain';
        this.response.disposition = `attachment; filename="${langs[lang]?.code_file || `foo.${this.rdoc.lang}`}"`;
    }

    @param('rid', Types.ObjectId)
    @param('download', Types.Boolean)
    @param('rev', Types.ObjectId, true)
    async get(domainId: string, rid: ObjectId, download = false, rev?: ObjectId) {
        let rdoc = this.rdoc;
        let currentRecordTeam: contestTeam.ContestTeamDoc | null = null;
        const allRev = await record.collHistory.find({ rid }).project({ _id: 1, judgeAt: 1 }).sort({ _id: -1 }).toArray();
        const allRevs: Record<string, Date> = Object.fromEntries(allRev.map((i) => [i._id.toString(), i.judgeAt]));
        if (rev && allRevs[rev.toString()]) {
            rdoc = { ...rdoc, ...omit(await record.collHistory.findOne({ _id: rev }), ['_id']), progress: null };
        }
        let canViewDetail = true;
        if (isVerifyRecord(rdoc.contest)) {
            assertVerifyRecordVisible(rdoc, this.user, false);
        } else if (rdoc.contest?.toString().startsWith('0'.repeat(23))) {
            if (rdoc.uid !== this.user._id) throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
        } else if (rdoc.contest) {
            this.tdoc ||= await contest.get(domainId, rdoc.contest);
            const teamContestRecord = contest.getParticipationMode(this.tdoc) === 'team';
            if (teamContestRecord) {
                currentRecordTeam = await getCurrentTeamForRecord(domainId, rdoc, this.user._id);
                this.teamRecordAccess = !!currentRecordTeam;
            }
            let canView = this.user.own(this.tdoc);
            canView ||= (await contest.canShowRecordForUser.call(this, this.tdoc));
            canView ||=
                (await contest.canShowSelfRecordForUser.call(this, this.tdoc, true)) && (teamContestRecord ? this.teamRecordAccess : rdoc.uid === this.user._id);
            if (!canView) throw new PermissionError(rid);
            canViewDetail = canView;
            this.args.tid = this.tdoc.docId;
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                rdoc = await contest.applyProjection(this.tdoc, rdoc, this.user);
                this.rdoc = rdoc;
            }
        }

        if (this.tdoc) {
            this.tsdoc = await contest.getStatus(domainId, this.tdoc.docId, this.user._id);
        }
        const liveClientRecordCodeOnly =
            !!this.tdoc &&
            shouldUseLiveClientRecordCodeOnly({
                clientRequired: contest.isClientRequired(this.tdoc),
                ongoing: contest.isOngoing(this.tdoc),
                contestOwner: this.user.own(this.tdoc),
                canEditContest: this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                systemAdmin: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
                contextualRecordAccess: this.postContestPracticeRecordAccess || this.contestPretestRecordAccess,
            });
        if (liveClientRecordCodeOnly && rev) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        const contextualProblemAccess = this.postContestPracticeRecordAccess || this.contestPretestRecordAccess;
        const problemViewContext = {
            kind: 'record-detail' as const,
            contextualProblemAccess,
            authorizedSetRecord: this.authorizedSetRecord,
            virtualAttemptId: rdoc.virtualAttemptId,
            tdoc: this.tdoc,
            teamRecordAccess: this.teamRecordAccess,
            tsdoc: this.tsdoc,
        };
        const detailProjection = problem.PROJECTION_LIST.concat('config');
        const [pdoc, self, udoc] = await Promise.all([
            readRecordContextProblem(rdoc.domainId, this.user, problemViewContext, rdoc.pid, detailProjection),
            problem.getStatus(domainId, rdoc.pid, this.user._id),
            user.getById(domainId, rdoc.uid),
        ]);

        let canViewCode = isVerifyRecord(rdoc.contest)
            ? rdoc.uid === this.user._id || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
            : !contextualProblemAccess && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team'
              ? this.teamRecordAccess
              : rdoc.uid === this.user._id;
        canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;
        if (this.tdoc) {
            canViewCode ||= this.user.own(this.tdoc);
            if (this.tdoc.setConfig && readStoredSetConfig(this.tdoc).settings.authorization) {
                canViewCode ||= await contest.canShowRecordForUser.call(this, this.tdoc);
            }
            if (contest.getParticipationMode(this.tdoc) !== 'team' && this.tdoc.allowViewCode && contest.isDone(this.tdoc)) {
                canViewCode ||= this.tsdoc?.attend;
            }
        }
        if (
            download &&
            !this.postContestPracticeRecordAccess &&
            this.tdoc &&
            contest.getParticipationMode(this.tdoc) === 'team' &&
            this.teamRecordAccess
        ) {
            if (
                !currentRecordTeam ||
                currentRecordTeam.captainUid !== this.user._id ||
                !(rdoc.contestTeamId instanceof ObjectId) ||
                !currentRecordTeam.teamId.equals(rdoc.contestTeamId)
            ) {
                throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
            }
        }
        if (!pdoc) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        if (['single', 'multi', 'true_false', 'blank', 'subjective'].includes(String(pdoc.problemKind || ''))) {
            const rawObjective = await readRecordContextProblem(rdoc.domainId, this.user, problemViewContext, rdoc.pid, ['config'], true);
            pdoc.config = clientProblemConfig(parseProblemConfigObject(rawObjective) || { type: 'objective' });
        }
        if (!canViewCode) {
            rdoc.code = '';
            rdoc.files = {};
            rdoc.compilerTexts = [];
        } else if (download) return await this.download();
        // PTA-style per-test-point hints. Visibility is enforced HERE (server
        // side), never trusted to the client: a hint is exposed only when its
        // author flag `hintPublic` is set AND the record is NOT being viewed
        // inside a contest that is not yet done for THIS viewer (passing tsdoc
        // covers per-attendee duration windows — revealed only after the
        // contest ends). parseConfig() strips per-case fields, so re-load the
        // raw config and run it through the SAME readYamlCases + normalizeSubtasks
        // the judge uses, so the (subtaskId, caseId) keys line up EXACTLY with
        // the record's testCases (positional flattening mis-maps under parallel
        // judging + subtask/case id sorting). Keyed `${subtaskId}-${caseId}`.
        // NOTE(MVP): does not yet block the "open the same problem from the bank
        // while attending an ongoing contest that contains it" bypass — left as
        // a follow-up; the practice problem is normally contest-hidden anyway.
        const testHints: Record<string, { hint?: string; videoUrl?: string }> = {};
        const canViewProblem = !this.tdoc?.setConfig || await canUseSetCapability(this.tdoc, this.user, 'view');
        let hintsWithVerdict = false;
        if (pdoc && pdoc.problemKind !== null) {
            try {
                hintsWithVerdict = homeworkKindRevealsVerdict(effectiveProblemKind(pdoc));
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
            }
        }
        try {
            const inActiveContest = this.tdoc ? !contest.isDone(this.tdoc, this.tsdoc) : false;
            const virtualAttemptOpen = this.virtualAttempt ? isVirtualAttemptOpen(this.virtualAttempt) : false;
            // Public hints follow the test points. Function and programming show
            // those points as soon as they are judged, so their hints do too.
            if (canViewDetail && canViewProblem && (!this.tdoc?.setConfig || rdoc.testCases?.length > 0)
                && (!inActiveContest || hintsWithVerdict) && !virtualAttemptOpen) {
                const rawPdoc = await readRecordContextProblem(
                    rdoc.domainId,
                    this.user,
                    problemViewContext,
                    rdoc.pid,
                    ['domainId', 'docId', 'config'],
                    true,
                );
                const rawCfg = rawPdoc?.config;
                const cfgObj: any = typeof rawCfg === 'string' ? loadYaml(rawCfg) : rawCfg;
                if (cfgObj && typeof cfgObj === 'object') {
                    const parsed: any = await readYamlCases(cfgObj);
                    const normalized = normalizeSubtasks(parsed.subtasks || [], (s: string) => s, parsed.time, parsed.memory, true);
                    for (const st of normalized) {
                        for (const c of (st.cases || []) as any[]) {
                            if (!c) continue;
                            // Hint and video have independent publish flags;
                            // videoPublic falls back to hintPublic when unset
                            // so pre-existing configs keep their behavior.
                            const showHint = c.hintPublic && c.hint;
                            const showVideo = (c.videoPublic ?? c.hintPublic) && c.videoUrl;
                            if (showHint || showVideo) {
                                testHints[`${st.id}-${c.id}`] = {
                                    ...(showHint ? { hint: c.hint } : {}),
                                    ...(showVideo ? { videoUrl: c.videoUrl } : {}),
                                };
                            }
                        }
                    }
                }
            }
        } catch {
            /* malformed config → no hints, never break the page */
        }
        let recordStudent: { studentId: string; realName: string } | null = null;
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && rdoc.uid > 1) {
            const students = await studentDirectory().findStudentsByUserIds(domainId, [rdoc.uid]);
            const student = students[String(rdoc.uid)];
            if (student) {
                recordStudent = {
                    studentId: String(student.studentId || ''),
                    realName: String(student.realName || ''),
                };
            }
        }
        this.response.template = 'record_detail.html';
        if (this.tdoc && pdoc && concealHomeworkObjectiveFromStudent(this.tdoc, canManageTeachContainer(this.user, 'homework', this.tdoc))
            && !homeworkKindRevealsVerdict(effectiveProblemKind(pdoc))) {
            rdoc = concealObjectiveRecord(rdoc);
        }
        if (this.tdoc && pdoc && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            rdoc = projectLiveExamRecord(this.tdoc, rdoc, effectiveProblemKind(pdoc));
        }
        const responseRdoc = formatRecordJudgeMessages(omit(rdoc, ['scoreCancellation']), this.translate.bind(this));
        const recordScoreAction = this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        const virtualRecords = !!rdoc.virtualAttemptId;
        const virtualAttemptOpen = this.virtualAttempt ? isVirtualAttemptOpen(this.virtualAttempt) : false;
        const responseBody = {
            udoc,
            recordStudent,
            rdoc: canViewDetail ? responseRdoc : pick(responseRdoc, ['_id', 'lang', 'code']),
            pdoc: await projectRecordProblem(this.tdoc, this.user, pdoc),
            tdoc: this.tdoc
                ? await projectCurrentSetTdoc(
                      this.tdoc,
                      this.user._id,
                      this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                      this.tsdoc,
                  )
                : this.tdoc,
            postContestPracticeRecordAccess: this.postContestPracticeRecordAccess,
            practiceTid: this.postContestPracticeRecordAccess || virtualRecords ? this.tdoc?.docId : undefined,
            ...(virtualRecords
                ? { virtual: true, virtualAttemptOpen, virtualContestActive: virtualAttemptOpen }
                : {}),
            rev,
            allRevs,
            // ui-next needs `langs` to render `rdoc.lang` (e.g. "cc.cc17") as
            // a human-readable label (e.g. "C++ 17"). RecordsMain already
            // ships this; mirror it here for the detail page.
            langs,
            // Per-test-point hints to render next to each case (already
            // visibility-filtered above). Keyed by 1-based case order.
            testHints,
            ...(this.user.hasPerm(PERM.PERM_REJUDGE) ? { recordScoreAction } : {}),
            canRejudgeVirtual: Boolean(rdoc.virtualAttemptId && this.tdoc && canManageVirtualContest(this.user, this.tdoc)),
        };
        const teamMemberCannotDownload =
            !!this.tdoc &&
            contest.getParticipationMode(this.tdoc) === 'team' &&
            this.teamRecordAccess &&
            currentRecordTeam?.captainUid !== this.user._id;
        this.response.body = liveClientRecordCodeOnly
            ? buildExamModeRecordCodePayload({
                  ...responseBody,
                  ...(teamMemberCannotDownload ? { examRecordDownloadAvailable: false } : {}),
              })
            : responseBody;
    }

    @param('rid', Types.ObjectId)
    async post() {
        const operation = String(this.args.operation || '');
        if (!this.user.hasPerm(PERM.PERM_REJUDGE)) {
            if (operation === 'cancel' || (operation === 'rejudge' && this.rdoc.status === STATUS.STATUS_CANCELED)) {
                await auditRecordScorePermissionRejection({
                    rdoc: this.rdoc,
                    actor: this.user._id,
                    operation,
                });
            }
            throw new PermissionError(PERM.PERM_REJUDGE);
        }
        if (this.rdoc.virtualAttemptId && operation !== 'cancel') {
            throw new ValidationError('rid', null, localizedErrorText`确认后才能重测虚拟参赛记录`);
        }
        if (operation !== 'cancel') {
            if (this.rdoc.files?.hack) throw new HackRejudgeFailedError();
            if (this.rdoc.contest?.toString().startsWith('0'.repeat(23))) throw new PretestRejudgeFailedError();
        }
    }

    @param('expectedCancellationAt', Types.String, true)
    @param('rid', Types.ObjectId)
    async postRejudge(domainId: string, expectedCancellationAt: string | undefined, rid: ObjectId) {
        if (this.rdoc.virtualAttemptId) throw new ValidationError('rid', null, localizedErrorText`确认后才能重测虚拟参赛记录`);
        if (expectedCancellationAt !== undefined || this.rdoc.status === STATUS.STATUS_CANCELED || this.rdoc.scoreCancellation) {
            if (!expectedCancellationAt) throw new ValidationError('expectedCancellationAt');
            const cancellationAt = new Date(expectedCancellationAt);
            if (Number.isNaN(cancellationAt.getTime())) throw new ValidationError('expectedCancellationAt');
            const result = await recoverCanceledRecord({
                domainId,
                rid,
                actor: this.user._id,
                expectedCancellationAt: cancellationAt,
            });
            this.ctx.broadcast('record/change', result.rdoc);
            if (this.request.json) {
                this.response.body = result;
                return;
            }
            this.back();
            return;
        }
        const pdoc = await problem.get(domainId, this.rdoc.pid);
        if (!pdoc?.config || typeof pdoc.config === 'string') throw new ProblemConfigError();
        const priority = await record.submissionPriority(this.user._id, -20);
        const rdoc = await record.reset(domainId, rid, true);
        this.ctx.broadcast('record/change', rdoc);
        await record.judge(domainId, rid, priority, this.rdoc.contest ? { detail: false } : {});
        if (this.request.json) {
            this.response.body = {
                rdoc,
                recordScoreAction: null,
            };
            return;
        }
        this.back();
    }

    @param('expectedStatus', Types.Int)
    @param('expectedJudgeAt', Types.String)
    @param('reason', Types.String, true)
    @param('rid', Types.ObjectId)
    async postCancel(domainId: string, expectedStatus: number, expectedJudgeAt: string, reason: string | undefined, rid: ObjectId) {
        const judgeAt = new Date(expectedJudgeAt);
        if (Number.isNaN(judgeAt.getTime())) throw new ValidationError('expectedJudgeAt');
        const result = await cancelRecordScore({
            domainId,
            rid,
            actor: this.user._id,
            expectedStatus,
            expectedJudgeAt: judgeAt,
            reason,
        });
        this.ctx.broadcast('record/change', result.rdoc);
        if (this.request.json) {
            this.response.body = {
                ...result,
                rdoc: omit(result.rdoc, ['scoreCancellation']),
            };
            return;
        }
        this.back();
    }
}

export class RecordMainConnectionHandler extends ConnectionHandler {
    all = false;
    allDomain = false;
    tid: string;
    virtualAttemptId?: string;
    uid: number;
    searchUids?: number[];
    dateRange?: ReturnType<typeof recordDateRange>;
    teamId?: ObjectId;
    pid: number;
    lang: string;
    status: number;
    pretest = false;
    practice = false;
    practiceTid?: string;
    practiceTsdoc?: { attend?: number } & Pick<ExamPaperStatusClock, 'startAt' | 'examPaperPids'>;
    tdoc: Tdoc;
    applyProjection = false;
    noTemplate = false;
    queue: Map<string, () => Promise<any>> = new Map();
    throttleQueueClear: () => void;

    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('virtual', Types.Boolean)
    @param('pid', Types.ProblemId, true)
    @param('uidOrName', Types.String, true)
    @param('lang', Types.String, true)
    @param('status', Types.Int, true)
    @param('pretest', Types.Boolean)
    @param('all', Types.Boolean)
    @param('allDomain', Types.Boolean)
    @param('noTemplate', Types.Boolean, true)
    @param('from', Types.String, true)
    @param('to', Types.String, true)
    async prepare(
        domainId: string,
        tid?: ObjectId,
        practice = false,
        virtual = false,
        pid?: string | number,
        uidOrName?: string,
        lang?: string,
        status?: number,
        pretest = false,
        all = false,
        allDomain = false,
        noTemplate = false,
        from = '',
        to = '',
    ) {
        this.dateRange = recordDateRange(from, to);
        if (practice && !tid) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        if (virtual && (practice || pretest || all || allDomain)) throw new ValidationError('virtual');
        if (virtual && !tid) throw new ValidationError('tid');
        if (virtual) {
            this.tdoc = await contest.get(domainId, tid);
            if (!this.tdoc) throw new ContestNotFoundError(domainId, tid);
            await hideLoadedContest(domainId, this.tdoc, this.user);
            const attempt = await virtualContestService.getOfficialAttempt(domainId, tid, this.user._id);
            if (!attempt) throw new ValidationError('virtual', null, localizedErrorText`虚拟参赛尚未开始`);
            const canManage = canManageVirtualContest(this.user, this.tdoc);
            if (!canManage && attempt.uid !== this.user._id) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            this.virtualAttemptId = attempt._id.toHexString();
            this.uid = attempt.uid;
        } else if (tid) {
            this.tdoc = await contest.get(domainId, tid);
            if (!this.tdoc) throw new ContestNotFoundError(domainId, tid);
            if (this.tdoc.setConfig && !practice && !pretest) await assertSetRecordAccess(this, this.tdoc);
            await hideLoadedContest(domainId, this.tdoc, this.user);
            this.practiceTsdoc = practice ? await contest.getStatus(domainId, tid, this.user._id) : undefined;
            this.practice = practice && canUsePostContestPractice(this.tdoc, this.practiceTsdoc);
            if (practice && !this.practice) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            if (this.practice) this.practiceTid = tid.toHexString();
            else if (pretest || (await contest.canShowScoreboardForUser.call(this, this.tdoc, true)) || this.tdoc.setConfig || this.tdoc.rule === 'exam') this.tid = tid.toHexString();
            else throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            if (!this.practice && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.applyProjection = true;
            }
        }
        if (pretest) {
            this.pretest = true;
            this.uid = this.user._id;
        } else if (uidOrName && !this.virtualAttemptId) {
            const uids = await recordUserIds(domainId, uidOrName, canSearchRecordStudents(this.user, this.tdoc));
            if (uids.length === 1) this.uid = uids[0];
            else this.searchUids = uids;
        }
        if (this.practice) {
            if ((typeof this.uid === 'number' && this.uid !== this.user._id) || !pid || all || allDomain) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.uid = this.user._id;
        }
        if (!this.practice && !pretest && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team' && this.uid === this.user._id) {
            const team = await contestTeam.getTeamByMember(domainId, tid, this.user._id);
            if (team) {
                this.teamId = team.teamId;
                this.uid = undefined;
            } else this.checkPerm(PERM.PERM_VIEW_RECORD);
        }
        if (!this.teamId && this.uid !== this.user._id && (!this.tdoc?.setConfig || !await contest.canShowRecordForUser.call(this, this.tdoc, true, 'list'))) this.checkPerm(PERM.PERM_VIEW_RECORD);
        if (
            (this.tdoc?.setConfig || this.tdoc?.rule === 'exam')
            && !this.practice
            && !pretest
            && !(await contest.canShowScoreboardForUser.call(this, this.tdoc, true))
        ) {
            const ownRecords = !!this.teamId || this.uid === this.user._id;
            if (!(ownRecords ? await contest.canShowSelfRecordForUser.call(this, this.tdoc, true) : await contest.canShowRecordForUser.call(this, this.tdoc, true, 'list'))) {
                throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            }
        }
        if (pid) {
            const pdoc = this.tdoc
                ? await problem.get(domainId, pid)
                : await problem.getViewableAuthorized(domainId, pid, this.user, problem.PROJECTION_LIST);
            if (
                pdoc &&
                this.practice &&
                !canAccessPostContestPracticeRecord(this.tdoc, this.practiceTsdoc, {
                    pid: pdoc.docId,
                    actorUid: this.user._id,
                    recordUid: this.user._id,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            if (pdoc) this.pid = pdoc.docId;
            else throw new ProblemNotFoundError(domainId, pid);
        }
        if (lang) this.lang = lang;
        if (typeof status === 'number') {
            if (this.tdoc && !this.virtualAttemptId && !this.practice && !pretest
                && !await contest.canFilterRecordStatus(this.tdoc, !this.applyProjection, this.pid)) {
                throw new ValidationError('status', null, localizedErrorText`评测结果尚未公开，暂时不能按结果筛选。`);
            }
            this.status = status;
        }
        if (all) {
            this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            this.checkPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD);
            this.all = true;
        }
        if (allDomain) {
            this.checkPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN);
            this.allDomain = true;
        }
        this.noTemplate = noTemplate;
        this.throttleQueueClear = throttle(this.queueClear, 100, { trailing: true });
    }

    async message(msg: { rids: string[] }) {
        if (!(msg.rids instanceof Array)) return;
        const rids = msg.rids.map((id) => new ObjectId(id));
        const rdocs = await record
            .getMulti(this.args.domainId, { _id: { $in: rids } })
            .project<RecordDoc>({ ...buildProjection(record.PROJECTION_LIST), input: 1 })
            .toArray();
        for (const rdoc of rdocs) await this.onRecordChange(rdoc);
    }

    @subscribe('record/change')
    async onRecordChange(rdoc: RecordDoc) {
        if (this.searchUids && !this.searchUids.includes(rdoc.uid)) return;
        if (this.applyProjection && this.tdoc?.setConfig && rdoc.contest?.equals(this.tdoc.docId)) {
            this.tdoc = await contest.get(this.tdoc.domainId, this.tdoc.docId);
            if (typeof this.status === 'number' && !await contest.canFilterRecordStatus(this.tdoc, false, this.pid)) {
                this.close(4003, 'Record verdict filter is no longer public');
                return;
            }
        }
        if (this.dateRange?.$gte && rdoc._id.toHexString() < this.dateRange.$gte.toHexString()) return;
        if (this.dateRange?.$lt && rdoc._id.toHexString() >= this.dateRange.$lt.toHexString()) return;
        const contestId = rdoc.contest?.toString();
        if (
            !matchesRecordConnectionScope(
                {
                    domainId: rdoc.domainId,
                    contestId,
                    virtualAttemptId: rdoc.virtualAttemptId?.toHexString(),
                    lang: rdoc.lang,
                    status: rdoc.status,
                    input: rdoc.input,
                },
                {
                    domainId: this.args.domainId,
                    tid: this.tid,
                    virtualAttemptId: this.virtualAttemptId,
                    lang: this.lang,
                    status: this.status,
                    pretest: this.pretest,
                    all: this.all,
                    allDomain: this.allDomain,
                },
            )
        ) {
            return;
        }
        if (
            this.practice &&
            (rdoc.uid !== this.user._id ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (this.pretest
                    ? !(rdoc.contest instanceof ObjectId) || !record.RECORD_PRETEST.equals(rdoc.contest)
                    : rdoc.contest !== undefined || rdoc.input !== undefined))
        ) {
            return;
        }
        if (!this.allDomain && !this.all) {
            if (this.tid && contestId !== RECORD_PRETEST_CONTEST_ID) {
                if (this.teamId) {
                    if (!(rdoc.contestTeamId instanceof ObjectId) || !rdoc.contestTeamId.equals(this.teamId)) return;
                    const team = await contestTeam.getTeam(this.args.domainId, this.tdoc.docId, this.teamId);
                    if (!team?.memberUids.includes(this.user._id)) {
                        this.close(4003, 'Team record access revoked');
                        return;
                    }
                    if (!(await contest.canShowSelfRecordForUser.call(this, this.tdoc, true))) return;
                } else {
                    if (rdoc.uid !== this.user._id && !(await contest.canShowRecordForUser.call(this, this.tdoc, true, 'list'))) return;
                    if (rdoc.uid === this.user._id && !(await contest.canShowSelfRecordForUser.call(this, this.tdoc, true))) return;
                }
            }
        }
        if (typeof this.pid === 'number' && rdoc.pid !== this.pid) return;
        if (typeof this.uid === 'number' && rdoc.uid !== this.uid) return;

        const recordScoreAction = this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        const [udoc, pdoc] = await Promise.all([
            user.getById(this.args.domainId, rdoc.uid),
            rdoc.contest || this.practice ? problem.get(rdoc.domainId, rdoc.pid) : problem.getViewableAuthorized(rdoc.domainId, rdoc.pid, this.user),
        ]);
        const tdoc = this.tid || this.practice ? this.tdoc : null;
        const studentTdoc = tdoc
            ? await projectCurrentSetTdoc(
                  tdoc,
                  this.user._id,
                  this.user.own(tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                  this.practiceTsdoc
                      ? { startAt: this.practiceTsdoc.startAt, examPaperPids: this.practiceTsdoc.examPaperPids }
                      : undefined,
              )
            : tdoc;
        if (this.applyProjection && rdoc.contest?.toString() !== '0'.repeat(24)) rdoc = await contest.applyProjection(tdoc, rdoc, this.user);
        if (tdoc && pdoc && concealHomeworkObjectiveFromStudent(tdoc, canManageTeachContainer(this.user, 'homework', tdoc))
            && !homeworkKindRevealsVerdict(effectiveProblemKind(pdoc))) {
            rdoc = concealObjectiveRecord(rdoc);
        }
        if (tdoc && pdoc && !this.user.own(tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            rdoc = projectLiveExamRecord(tdoc, rdoc, effectiveProblemKind(pdoc));
        }
        rdoc = pick(rdoc, record.PROJECTION_LIST.filter((field) => field !== 'scoreCancellation' && field !== 'files')) as RecordDoc;
        if (this.pretest) {
            this.queueSend(rdoc._id.toHexString(), async (visibleRecord = rdoc) => ({ rdoc: omit(visibleRecord, ['code', 'input']) }), rdoc);
        } else if (this.noTemplate) {
            this.queueSend(rdoc._id.toHexString(), async (visibleRecord = rdoc) => ({ rdoc: visibleRecord, recordScoreAction }), rdoc);
        } else {
            this.queueSend(rdoc._id.toHexString(), async (visibleRecord = rdoc) => ({
                html: await this.renderHTML('record_main_tr.html', {
                    rdoc: visibleRecord,
                    udoc,
                    pdoc: await projectRecordProblem(this.tdoc, this.user, pdoc),
                    tdoc: studentTdoc,
                    recordDetailTid: this.practice ? this.practiceTid : undefined,
                    allDomain: this.allDomain,
                    recordScoreActions: recordScoreAction ? { [rdoc._id.toHexString()]: recordScoreAction } : {},
                }),
            }), rdoc);
        }
    }

    @subscribe('contest/team-role-change')
    async onTeamRoleChange(payload: { after: contestTeam.ContestTeamDoc }) {
        if (!this.teamId || !this.tid) return;
        if (!payload.after.teamId.equals(this.teamId) || payload.after.contestId.toHexString() !== this.tid) return;
        this.send({ teamRoleChanged: true, teamRevision: payload.after.revision });
        if (!payload.after.active || !payload.after.memberUids.includes(this.user._id)) this.close(4003, 'Team record access revoked');
    }

    queueSend(rid: string, fn: (visibleRecord: RecordDoc) => Promise<any>, rdoc: RecordDoc) {
        this.queue.set(rid, async () => {
            let visibleRecord = rdoc;
            if (this.tdoc?.setConfig && !this.practice && !this.pretest && !this.virtualAttemptId) {
                this.tdoc = await contest.get(this.tdoc.domainId, this.tdoc.docId);
                if (!await recheckSetRecordParticipation(this, this.tdoc, rdoc._id)) return null;
                const own = rdoc.uid === this.user._id
                    || (!!this.teamId && await canAccessCurrentTeamRecord(this.args.domainId, rdoc, this.user._id));
                const allowed = own ? await contest.canShowSelfRecordForUser.call(this, this.tdoc, true)
                    : await contest.canShowRecordForUser.call(this, this.tdoc, true, 'list');
                if (!allowed) {
                    this.close(4003, 'Problem set record access revoked');
                    return null;
                }
                visibleRecord = await contest.applyProjection(this.tdoc, rdoc, this.user);
            }
            return fn(visibleRecord);
        });
        this.throttleQueueClear();
    }

    async queueClear() {
        await Promise.all([...this.queue.values()].map(async (fn) => {
            const payload = await fn();
            if (payload !== null) this.send(payload);
        }));
        this.queue.clear();
    }
}

export class RecordDetailConnectionHandler extends ConnectionHandler {
    pdoc: ProblemDoc;
    tdoc?: Tdoc;
    rid: string = '';
    disconnectTimeout: NodeJS.Timeout;
    throttleSend: any;
    applyProjection = false;
    noTemplate = false;
    canViewCode = false;
    authorizedSetRecord = false;
    teamRecordAccess = false;
    liveClientRecordCodeOnly = false;
    postContestPracticeRecordAccess = false;
    contestPretestRecordAccess = false;
    practiceTid?: ObjectId;
    practiceRecordPid?: number;
    recordTeamId?: ObjectId;
    recordContestId?: ObjectId;

    @param('rid', Types.ObjectId)
    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('noTemplate', Types.Boolean, true)
    async prepare(domainId: string, rid: ObjectId, tid?: ObjectId, practice = false, noTemplate = false) {
        const rdoc = await record.get(domainId, rid);
        if (!rdoc) return;
        assertVerifyRecordVisible(rdoc, this.user, practice);
        const realContestRecord = rdoc.contest instanceof ObjectId && !isNonContestSentinel(rdoc.contest);
        if (rdoc.virtualAttemptId) {
            if (practice) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            await assertVirtualContestRecordAccess(domainId, rdoc, this.user);
            this.tdoc = await contest.get(domainId, rdoc.sourceContestId);
            await hideLoadedContest(domainId, this.tdoc, this.user);
            this.canViewCode = rdoc.uid === this.user._id || this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        } else if (practice) {
            if (!tid || realContestRecord) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            this.tdoc = await contest.get(domainId, tid);
            await hideLoadedContest(domainId, this.tdoc, this.user);
            const tsdoc = await contest.getStatus(domainId, tid, this.user._id);
            const ordinaryRecord = rdoc.contest === undefined;
            const pretestRecord = rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(rdoc.contest);
            if (
                !this.tdoc ||
                (!ordinaryRecord && !pretestRecord) ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (ordinaryRecord && rdoc.input !== undefined) ||
                !canAccessPostContestPracticeRecord(this.tdoc, tsdoc, {
                    pid: rdoc.pid,
                    actorUid: this.user._id,
                    recordUid: rdoc.uid,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.postContestPracticeRecordAccess = true;
            this.practiceTid = tid;
            this.practiceRecordPid = rdoc.pid;
        } else if (tid && rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(rdoc.contest)) {
            this.tdoc = await contest.get(domainId, tid);
            await hideLoadedContest(domainId, this.tdoc, this.user);
            const tsdoc = await contest.getStatus(domainId, tid, this.user._id);
            if (
                !this.tdoc ||
                rdoc.uid !== this.user._id ||
                tsdoc?.attend !== 1 ||
                !studentContestProblemPids(
                    this.tdoc,
                    tsdoc,
                    this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                ).includes(rdoc.pid)
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.contestPretestRecordAccess = true;
        } else if (realContestRecord) {
            this.tdoc = await contest.get(domainId, rdoc.contest);
            if (this.tdoc.setConfig) {
                await assertSetRecordAccess(this, this.tdoc);
                this.authorizedSetRecord = true;
            }
            await hideLoadedContest(domainId, this.tdoc, this.user);
            this.liveClientRecordCodeOnly = shouldUseLiveClientRecordCodeOnly({
                clientRequired: contest.isClientRequired(this.tdoc),
                ongoing: contest.isOngoing(this.tdoc),
                contestOwner: this.user.own(this.tdoc),
                canEditContest: this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                systemAdmin: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            });
            const teamContestRecord = contest.getParticipationMode(this.tdoc) === 'team';
            if (teamContestRecord) {
                if (!(rdoc.contestTeamId instanceof ObjectId)) throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                this.teamRecordAccess = await canAccessCurrentTeamRecord(domainId, rdoc, this.user._id);
                this.recordTeamId = rdoc.contestTeamId;
                this.recordContestId = rdoc.contest;
            }
            let canView = this.user.own(this.tdoc);
            canView ||= (await contest.canShowRecordForUser.call(this, this.tdoc));
            canView ||= (teamContestRecord ? this.teamRecordAccess : this.user._id === rdoc.uid) && (await contest.canShowSelfRecordForUser.call(this, this.tdoc));
            if (!canView) throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.applyProjection = true;
            }
        }
        const contextualProblemAccess = this.postContestPracticeRecordAccess || this.contestPretestRecordAccess;
        const problemViewContext = {
            kind: 'record-detail-connection' as const,
            contextualProblemAccess,
            authorizedSetRecord: this.authorizedSetRecord,
            virtualAttemptId: rdoc.virtualAttemptId,
            contest: rdoc.contest,
            teamRecordAccess: this.teamRecordAccess,
            recordUid: rdoc.uid,
        };
        const [pdoc, self] = await Promise.all([
            readRecordContextProblem(rdoc.domainId, this.user, problemViewContext, rdoc.pid, problem.PROJECTION_PUBLIC),
            problem.getStatus(domainId, rdoc.pid, this.user._id),
        ]);

        this.canViewCode = isVerifyRecord(rdoc.contest)
            ? rdoc.uid === this.user._id || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
            : !contextualProblemAccess && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team'
              ? this.teamRecordAccess
              : rdoc.uid === this.user._id;
        this.canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        this.canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        this.canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;
        // Same grant as RecordDetailHandler.get. The page bootstrap includes
        // source for a contest owner or maintainer, then this socket's first
        // push used to replace it with an empty string.
        if (realContestRecord && this.tdoc) {
            this.canViewCode ||= this.user.own(this.tdoc);
            if (this.tdoc.setConfig && readStoredSetConfig(this.tdoc).settings.authorization) {
                this.canViewCode ||= await contest.canShowRecordForUser.call(this, this.tdoc);
            }
            if (contest.getParticipationMode(this.tdoc) !== 'team' && this.tdoc.allowViewCode && contest.isDone(this.tdoc)) {
                const tsdoc = await contest.getStatus(domainId, this.tdoc.docId, this.user._id);
                this.canViewCode ||= !!tsdoc?.attend;
            }
        }

        if (!pdoc) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);

        this.pdoc = pdoc;
        this.noTemplate = noTemplate;
        this.throttleSend = throttle(this.sendUpdate, 1000, { trailing: true });
        this.rid = rid.toString();
        await this.onRecordChange(rdoc);
    }

    @subscribe('contest/team-role-change')
    async onTeamRoleChange(payload: { before: contestTeam.ContestTeamDoc; after: contestTeam.ContestTeamDoc }) {
        if (!this.teamRecordAccess || !this.recordTeamId || !this.recordContestId) return;
        if (!payload.after.teamId.equals(this.recordTeamId) || !payload.after.contestId.equals(this.recordContestId)) return;
        this.send({ teamRoleChanged: true, teamRevision: payload.after.revision });
        if (!payload.after.active || !payload.after.memberUids.includes(this.user._id)) this.close(4003, 'Team record access revoked');
    }

    async sendUpdate(rdoc: RecordDoc) {
        if (this.tdoc?.setConfig && !this.postContestPracticeRecordAccess && !this.contestPretestRecordAccess) {
            this.tdoc = await contest.get(this.tdoc.domainId, this.tdoc.docId);
            if (!await recheckSetRecordParticipation(this, this.tdoc, rdoc._id)) return;
            const own = rdoc.uid === this.user._id || (this.teamRecordAccess && await canAccessCurrentTeamRecord(this.args.domainId, rdoc, this.user._id));
            const details = await contest.canShowRecordForUser.call(this, this.tdoc);
            if (!details && (!own || !await contest.canShowSelfRecordForUser.call(this, this.tdoc))) {
                this.close(4003, 'Problem set record access revoked');
                return;
            }
            this.canViewCode = own || details;
            rdoc = await contest.applyProjection(this.tdoc, rdoc, this.user);
        }
        const recordScoreAction =
            !this.liveClientRecordCodeOnly && this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        if (this.tdoc && this.pdoc && concealHomeworkObjectiveFromStudent(this.tdoc, canManageTeachContainer(this.user, 'homework', this.tdoc))
            && !homeworkKindRevealsVerdict(effectiveProblemKind(this.pdoc))) {
            rdoc = concealObjectiveRecord(rdoc);
        }
        rdoc = omit(rdoc, ['scoreCancellation']) as RecordDoc;
        rdoc = formatRecordJudgeMessages(rdoc, this.translate.bind(this));
        if (this.liveClientRecordCodeOnly) {
            const codeVisibleRecord = this.canViewCode
                ? rdoc
                : {
                      ...rdoc,
                      code: '',
                      files: {},
                      compilerTexts: [],
                  };
            const payload = buildExamModeRecordCodePayload({ rdoc: codeVisibleRecord, tdoc: this.tdoc, pdoc: this.pdoc, langs });
            this.send({ rdoc: payload.rdoc });
            return;
        }
        if (this.noTemplate) {
            this.send({ rdoc, recordScoreAction });
        } else {
            const pdoc = await projectRecordProblem(this.tdoc, this.user, this.pdoc);
            this.send({
                status: rdoc.status,
                status_html: await this.renderHTML('record_detail_status.html', { rdoc, pdoc }),
                summary_html: await this.renderHTML('record_detail_summary.html', { rdoc, pdoc }),
            });
        }
    }

    @subscribe('record/change')
    // eslint-disable-next-line
    async onRecordChange(rdoc: RecordDoc, $set?: any, $push?: any) {
        if (rdoc._id.toString() !== this.rid) return;
        if (
            this.postContestPracticeRecordAccess &&
            (rdoc.uid !== this.user._id ||
                rdoc.pid !== this.practiceRecordPid ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (rdoc.contest === undefined && rdoc.input !== undefined) ||
                (rdoc.contest !== undefined && (!(rdoc.contest instanceof ObjectId) || !record.RECORD_PRETEST.equals(rdoc.contest))))
        ) {
            this.close(4003, 'Post-contest practice record access revoked');
            return;
        }
        if (this.teamRecordAccess && !(await canAccessCurrentTeamRecord(this.args.domainId, rdoc, this.user._id))) {
            this.close(4003, 'Team record access revoked');
            return;
        }
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }
        if (this.applyProjection) {
            if (this.tdoc?.setConfig) this.tdoc = await contest.get(this.tdoc.domainId, this.tdoc.docId);
            rdoc = await contest.applyProjection(this.tdoc, rdoc, this.user);
            if (this.tdoc?.rule === 'exam' && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                const liveProblem = await problem.get(rdoc.domainId, rdoc.pid);
                rdoc = projectLiveExamRecord(this.tdoc, rdoc, liveProblem ? effectiveProblemKind(liveProblem) : null);
            }
        }
        // TODO: frontend doesn't support incremental update
        // if ($set) this.send({ $set, $push });
        if (!this.canViewCode) {
            rdoc = {
                ...rdoc,
                code: '',
                compilerTexts: [],
            };
        }
        if (rdoc.judging !== true && ![STATUS.STATUS_WAITING, STATUS.STATUS_JUDGING, STATUS.STATUS_COMPILING, STATUS.STATUS_FETCHED].includes(rdoc.status)) {
            this.disconnectTimeout = setTimeout(() => this.close(4001, 'Ended'), 30000);
        }
        this.throttleSend(rdoc);
    }
}

export async function apply(ctx) {
    ctx.Route('record_main', '/record', RecordListHandler);
    ctx.Route('record_detail', '/record/:rid', RecordDetailHandler);
    ctx.Connection('record_conn', '/record-conn', RecordMainConnectionHandler);
    ctx.Connection('record_detail_conn', '/record-detail-conn', RecordDetailConnectionHandler);
}
