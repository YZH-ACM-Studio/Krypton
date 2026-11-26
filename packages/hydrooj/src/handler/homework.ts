import * as oplog from '../model/oplog';
import yaml from 'js-yaml';
import { escapeRegExp, pick } from 'lodash';
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import {
    assertSetCreateAllowed,
    effectiveProblemKind,
    isTeachKindAllowed,
    scaleByContestProblemScore,
    setConfigMessage,
    STATUS,
    teachPath,
    type ProblemKind,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { randomstring, sortFiles, Time } from '@hydrooj/utils/lib/utils';
import {
    ContestNotFoundError,
    FileLimitExceededError,
    FileUploadError,
    HomeworkNotLiveError,
    LocalizedErrorText,
    localizedErrorText,
    NotAssignedError,
    PermissionError,
    ValidationError,
} from '../error';
import { PenaltyRules, ProblemDict, Tdoc, TrainingDoc, TrainingNode } from '../interface';
import { allowsPostContestView, getPostContestPracticeState } from '../lib/contest-correction';
import {
    buildSetWorkspace,
    scoreWorkspaceProblems,
    type DraftFacts,
    type JournalFacts,
    type SetWorkspace,
} from '../lib/set-workspace';
import { parseProblemConfigObject } from '../lib/problem-config';
import { storedSetConfigOrNull } from '../lib/set-publication';
import { loadSetStudentState, setWorkspaceState } from '../lib/set-student-state';
import { setWorkspaceResponse } from '../lib/set-workspace-response';
import { assertSetParticipation } from '../lib/set-participation-access';
import { setProblemFact } from '../lib/set-problem-fact';
import { assertSetBasicEdit, planSetPaperEdit } from '../lib/set-basic-edit';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { projectStudentPdict } from '../lib/student-pdict';
import { decideContainerVisibility } from '../lib/container-visibility';
import { assertCourseAccessible, canManageCourse } from '../lib/course-access';
import { contestProblemScoreWeight, examScoresForPool, parseContestProblemScores } from '../lib/exam-paper';
import { isCourseKind } from '../lib/training-kind';
import {
    assertGroupsAttachable,
    describeGroupRefs,
    listAttachableGroups,
    parseGroupIdList,
    type AttachActor,
} from '../lib/user-group-attach';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import * as discussion from '../model/discussion';
import * as document from '../model/document';
import {
    assertHomeworkAccess,
    buildHomeworkListAccessFilter,
    canBypassHomeworkAccess,
    getHomeworkUserGroupIds,
    participantGroupObjectIds,
} from '../model/homework-access';
import problem, { type ProblemDoc } from '../model/problem';
import { assertProblemBankSelection, readContextViewableProblems } from '../model/problem-access';
import record from '../model/record';
import { SETTINGS_BY_KEY } from '../model/setting';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';
import { ContestCodeHandler, ContestFileDownloadHandler, ContestScoreboardHandler } from './contest';

const logger = new Logger('homework');

/** The authoritative-domain test stubs Logger with error() only. Production Logger always has info. */
function logHomework(message: string, ...args: unknown[]) {
    const sink: { info?: (format: string, ...parts: unknown[]) => void } = logger;
    if (typeof sink.info !== 'function') return;
    sink.info(message, ...args);
}

const HOMEWORK_KIND_LABEL: Readonly<Record<ProblemKind, string>> = Object.freeze({
    true_false: '判断题',
    single: '单选题',
    multi: '多选题',
    blank: '填空题',
    program_fill: '程序填空题',
    subjective: '主观题',
    function: '函数题',
    programming: '编程题',
});

function positiveDurationHours(duration: unknown): number | null {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
    return duration;
}

function homeworkWindowOpen(tdoc: Tdoc): boolean {
    return !contest.isNotStarted(tdoc) && !contest.isDone(tdoc);
}

function homeworkStartView(tdoc: Tdoc, tsdoc?: { startAt?: Date | null } | null) {
    const durationHours = positiveDurationHours(tdoc.duration);
    const startAt = tsdoc?.startAt instanceof Date && !Number.isNaN(tsdoc.startAt.getTime()) ? tsdoc.startAt : null;
    let personalEndAt: string | null = null;
    if (durationHours != null && startAt && tdoc.endAt instanceof Date && !Number.isNaN(tdoc.endAt.getTime())) {
        const personalEnd = new Date(startAt.getTime() + durationHours * Time.hour);
        const end = personalEnd.getTime() < tdoc.endAt.getTime() ? personalEnd : tdoc.endAt;
        personalEndAt = end.toISOString();
    }
    return {
        required: tdoc.rule === 'homework' && durationHours != null && !startAt && homeworkWindowOpen(tdoc),
        durationMinutes: durationHours == null ? null : Math.round(durationHours * 60),
        startAt: startAt ? startAt.toISOString() : null,
        personalEndAt,
    };
}

function postedContestDuration(
    contestDuration: number | undefined,
    extensionDays: number,
    beginAt: moment.Moment,
    endAt: moment.Moment,
): number | null {
    if (contestDuration == null) return null;
    const windowMs = endAt.valueOf() - beginAt.valueOf();
    const limitMs = contestDuration * Time.hour;
    if (typeof contestDuration !== 'number' || !Number.isFinite(contestDuration) || !(contestDuration > 0) || limitMs > windowMs) {
        throw new ValidationError('contestDuration', null, localizedErrorText`个人限时必须大于 0，且不能超过开放时间`);
    }
    if (extensionDays > 0) {
        throw new ValidationError('contestDuration', null, localizedErrorText`个人限时和允许迟交不能同时打开`);
    }
    return contestDuration;
}

function postedProblemScores(problemScores: string | undefined, pids: number[]): Record<number, number> | undefined {
    if (problemScores == null || problemScores === '') return undefined;
    try {
        return examScoresForPool(parseContestProblemScores(JSON.parse(problemScores)), pids);
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError('problemScores', null, localizedErrorText`题目分数无效`);
    }
}

function newlyAddedProblemDocIds(nextPids: readonly number[], previousPids: readonly number[]): number[] {
    const previous = new Set(previousPids);
    const seen = new Set<number>();
    const added: number[] = [];
    for (const docId of nextPids) {
        if (previous.has(docId) || seen.has(docId)) continue;
        seen.add(docId);
        added.push(docId);
    }
    return added;
}

/** Used only when the kind guard cannot load because this process has no Hydro app. */
async function rejectHomeworkKindsFromProblemList(authoritativeDomainId: string, nextPids: number[], previousPids: number[]) {
    const added = newlyAddedProblemDocIds(nextPids, previousPids);
    if (!added.length) return;
    const listed = await problem.getList(authoritativeDomainId, added, true, false, ['docId', 'problemKind', 'pid', 'title'], true);
    const rejected: Array<{ docId: number; text: string }> = [];
    for (const docId of added) {
        const row = listed[docId];
        if (!row) continue;
        const kind = effectiveProblemKind(row);
        if (isTeachKindAllowed('homework', kind)) continue;
        rejected.push({ docId, text: `${row.pid}（${HOMEWORK_KIND_LABEL[kind]}）` });
    }
    if (!rejected.length) return;
    logger.warn(
        'Container problem kind rejected domain=%s type=%s docIds=%s',
        authoritativeDomainId,
        'homework',
        rejected.map((item) => item.docId).join(','),
    );
    throw new ValidationError(
        'pids',
        null,
        localizedErrorText`这些题目不能加入当前类型的题目集：${rejected.map((item) => item.text).join('、')}`,
    );
}

// 静态 import 会加载 document → bus。作业 handler 单测没有 Hydro app，只能在调用时加载 B1 守卫。
async function assertHomeworkProblemKinds(authoritativeDomainId: string, nextPids: number[], previousPids: number[]) {
    let guard: { assertContainerProblemKinds: (domainId: string, type: 'homework', next: readonly number[], previous: readonly number[]) => Promise<void> };
    try {
        guard = require('../lib/container-problem-kinds');
    } catch (error) {
        if (!(error instanceof ReferenceError)) throw error;
        await rejectHomeworkKindsFromProblemList(authoritativeDomainId, nextPids, previousPids);
        return;
    }
    await guard.assertContainerProblemKinds(authoritativeDomainId, 'homework', nextPids, previousPids);
}

function canCreateHomework(actor: { hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean }) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_CREATE_HOMEWORK);
}

function canEditHomework(
    actor: { own(doc: Tdoc): boolean; hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean },
    tdoc: Tdoc,
) {
    return (
        actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) ||
        (actor.own(tdoc) ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF) : actor.hasPerm(PERM.PERM_EDIT_HOMEWORK))
    );
}

function assertCanEditHomework(
    actor: { own(doc: Tdoc): boolean; hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean },
    tdoc: Tdoc,
) {
    if (canEditHomework(actor, tdoc)) return;
    throw new PermissionError(actor.own(tdoc) ? PERM.PERM_EDIT_HOMEWORK_SELF : PERM.PERM_EDIT_HOMEWORK);
}

function canDeleteHomework(
    actor: { own(doc: Tdoc): boolean; hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean },
    tdoc: Tdoc,
) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.own(tdoc) || actor.hasPerm(PERM.PERM_EDIT_HOMEWORK);
}

function assertCanDeleteHomework(
    actor: { own(doc: Tdoc): boolean; hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean },
    tdoc: Tdoc,
) {
    if (canDeleteHomework(actor, tdoc)) return;
    throw new PermissionError(PERM.PERM_EDIT_HOMEWORK);
}

async function assertHomeworkManageOrHide(
    domainId: string,
    tdoc: Tdoc,
    actor: any,
    allowed: boolean,
    deny: () => void,
) {
    if (tdoc.rule !== 'homework') throw new ContestNotFoundError(domainId, tdoc.docId);
    if (allowed) return;
    try {
        await assertHomeworkAccess(domainId, tdoc, actor);
    } catch (error) {
        if (error instanceof NotAssignedError || (error instanceof Error && error.name === 'NotAssignedError')) {
            throw new ContestNotFoundError(domainId, tdoc.docId);
        }
        throw error;
    }
    deny();
}

function homeworkGroupsUnrestricted(actor: { hasPriv(...priv: number[]): boolean; hasPerm(...perm: bigint[]): boolean }): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_EDIT_HOMEWORK);
}

/** 库存的 participantGroupIds 只能是 ObjectId。其它值直接报错，不能丢弃，也不能交给只收字符串的 parseGroupIdList。 */
function storedParticipantGroupIds(raw: unknown): ObjectId[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new ValidationError('participantGroupIds', null, localizedErrorText`用户组参数无效`);
    return raw.map((groupId) => {
        if (!(groupId instanceof ObjectId)) throw new ValidationError('participantGroupIds', null, localizedErrorText`用户组参数无效`);
        return groupId;
    });
}

interface ParticipantScopeGroupRow {
    _id: ObjectId;
    name: string;
    schoolId?: ObjectId;
    archivedAt?: Date | null;
}

function participantScopeGroupRows(
    attachable: ReadonlyArray<{ _id: string }>,
    described: ReadonlyArray<{ _id: string }>,
    groups: ReadonlyArray<{ _id: ObjectId; name: string; schoolId: ObjectId; archivedAt?: Date | null }>,
    savedIds: readonly ObjectId[],
): ParticipantScopeGroupRow[] {
    const byHex = new Map(groups.map((group) => [group._id.toHexString(), group]));
    const savedByHex = new Map(savedIds.map((id) => [id.toHexString(), id]));
    const order: string[] = [];
    const seen = new Set<string>();
    for (const view of attachable) {
        if (seen.has(view._id)) continue;
        seen.add(view._id);
        order.push(view._id);
    }
    for (const view of described) {
        if (seen.has(view._id)) continue;
        seen.add(view._id);
        order.push(view._id);
    }
    return order.map((hex) => {
        const group = byHex.get(hex);
        if (!group) {
            const saved = savedByHex.get(hex);
            if (!saved) throw new Error(`homework scope catalog missing saved group ${hex}`);
            return { _id: saved, name: '已删除的组' };
        }
        const row: ParticipantScopeGroupRow = {
            _id: group._id,
            name: group.name,
            schoolId: group.schoolId,
        };
        if (group.archivedAt != null) row.archivedAt = group.archivedAt;
        return row;
    });
}

async function listScopeDirectoryGroups(domainId: string) {
    return studentDirectory().listUserGroups(domainId);
}

async function homeworkEditScopeGroups(
    domainId: string,
    actor: AttachActor,
    savedIds: readonly ObjectId[],
    unrestricted: boolean,
): Promise<ParticipantScopeGroupRow[]> {
    try {
        const [attachable, described, groups] = await Promise.all([
            listAttachableGroups(domainId, actor, { unrestricted }),
            describeGroupRefs(domainId, actor, savedIds, { unrestricted }),
            listScopeDirectoryGroups(domainId),
        ]);
        return participantScopeGroupRows(attachable, described, groups, savedIds);
    } catch (error) {
        logger.error('Homework group catalog lookup failed domain=%s error=%o', domainId, error);
        throw error;
    }
}

function normalizeParticipantGroups(
    mode: 'none' | 'groups',
    rawGroupIds: string[],
): { participantScopeMode: 'none' | 'groups'; participantGroupIds: ObjectId[] } {
    if (mode === 'none') return { participantScopeMode: 'none', participantGroupIds: [] };
    const participantGroupIds = parseGroupIdList('participantGroupIds', rawGroupIds);
    if (!participantGroupIds.length) throw new ValidationError('participantGroupIds');
    return { participantScopeMode: 'groups', participantGroupIds };
}

async function checkedHomeworkParticipantGroups(
    domainId: string,
    actor: AttachActor & { hasPriv(...priv: number[]): boolean; hasPerm(...perm: bigint[]): boolean },
    tdoc: { participantGroupIds?: unknown } | null,
    mode: 'none' | 'groups',
    rawGroupIds: string[],
) {
    const scope = normalizeParticipantGroups(mode, rawGroupIds);
    const previous = tdoc ? storedParticipantGroupIds(tdoc.participantGroupIds) : [];
    await assertGroupsAttachable(domainId, actor, {
        field: 'participantGroupIds',
        previous,
        next: scope.participantGroupIds,
        unrestricted: homeworkGroupsUnrestricted(actor),
    });
    return scope;
}

async function loadCourseQuizContext(
    domainId: string,
    courseId: ObjectId,
    chapterId: number,
    handlerUser: any,
): Promise<{ course: TrainingDoc; chapter: TrainingNode }> {
    const course = await training.get(domainId, courseId);
    if (!isCourseKind(course.kind)) throw new ValidationError('fromCourse');
    if (!canManageCourse(handlerUser, course, PERM.PERM_EDIT_COURSE)) {
        await assertCourseAccessible(domainId, handlerUser._id, course);
        throw new PermissionError(PERM.PERM_EDIT_COURSE);
    }
    const chapter = course.dag.find((node) => node._id === chapterId);
    if (!chapter) throw new ValidationError('chapter');
    return { course, chapter };
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

function problemDocsFromGetList(dict: ProblemDict, pids: number[]) {
    const docs: ProblemDoc[] = [];
    const seen = new Set<number>();
    for (const pid of pids) {
        const pdoc = dict[pid];
        if (!pdoc || !Number.isSafeInteger(pdoc.docId) || seen.has(pdoc.docId)) continue;
        seen.add(pdoc.docId);
        docs.push(pdoc);
    }
    return docs;
}

function problemDictFromDocs(docs: ProblemDoc[]) {
    const pdict: Record<string | number, ProblemDoc> = {};
    for (const pdoc of docs) {
        pdict[pdoc.docId] = pdoc;
        if (pdoc.pid) pdict[pdoc.pid] = pdoc;
    }
    return pdict;
}

const validatePenaltyRules = (input: string) => {
    try {
        const res = yaml.load(input);
        return typeof res === 'object' && res !== null && Object.keys(res).every((key) => typeof res[key] === 'number');
    } catch (e) {
        return false;
    }
};
const convertPenaltyRules = (input: string) => yaml.load(input);

interface HomeworkWorkspaceActor {
    _id: number;
    uname?: string;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
    own(doc: Tdoc): boolean;
}

interface HomeworkWorkspaceHost {
    tdoc: Tdoc;
    user: HomeworkWorkspaceActor;
    response: { body: Record<string, any> };
    url(name: string, ...args: any[]): string;
}

/** These models touch Mongo as soon as they load. Handler unit tests have no Hydro app. */
function hydroRuntimeMissing(): boolean {
    return (global as { app?: unknown }).app == null;
}

function loadOptionalModule<T>(request: string): T | null {
    try {
        return require(request) as T;
    } catch (error) {
        if (!hydroRuntimeMissing()) throw error;
        return null;
    }
}

function homeworkLangRange(): Record<string, string> {
    const codeLang = SETTINGS_BY_KEY.codeLang as { range?: unknown } | undefined;
    const range = codeLang?.range;
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error('codeLang.range is missing from settings');
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(range as Record<string, unknown>)) {
        if (typeof value !== 'string') throw new TypeError('codeLang.range values must be strings');
        out[key] = value;
    }
    return out;
}

function absolutizeProblemFileUrls(handler: HomeworkWorkspaceHost, content: string, pdoc: Record<string, unknown>, tid: ObjectId): string {
    if (!content || pdoc.docId == null) return content;
    const tidHex = tid.toHexString();
    const placeholder = 'KRYPTONFILEPH';
    const sample = handler.url('problem_file_download', { pid: pdoc.docId, filename: placeholder });
    const absBase = sample.slice(0, sample.lastIndexOf(placeholder));
    const withTid = (url: string) => `${url}${url.includes('?') ? '&' : '?'}tid=${tidHex}`;
    const files = Array.isArray(pdoc.additional_file) ? pdoc.additional_file : [];
    let out = content.replace(/file:\/\/([^ \n)\\"]+)/g, (full: string, fileinfo: string) => {
        let filename = fileinfo.split('?')[0] ?? '';
        try {
            filename = decodeURIComponent(filename);
        } catch {
            // Keep the original filename when it is not valid percent-encoding.
        }
        const listed = files.some((file) => !!file && typeof file === 'object' && (file as { name?: unknown }).name === filename);
        if (!listed) return full;
        return withTid(`${absBase}${fileinfo}`);
    });
    const relPrefix = `./${String(pdoc.docId)}/file/`;
    if (out.includes(relPrefix)) out = out.split(relPrefix).join(absBase);
    return out;
}

function absolutizeProgrammingStatementFileUrls(handler: HomeworkWorkspaceHost, view: unknown, pdoc: Record<string, unknown>, tid: ObjectId) {
    if (!view || typeof view !== 'object') return;
    const statement = view as Record<string, any>;
    for (const section of ['background', 'description', 'input', 'output', 'hints']) {
        if (typeof statement[section]?.content === 'string') {
            statement[section].content = absolutizeProblemFileUrls(handler, statement[section].content, pdoc, tid);
        }
    }
    for (const item of statement.examples?.items || []) {
        if (typeof item?.note === 'string') item.note = absolutizeProblemFileUrls(handler, item.note, pdoc, tid);
    }
}

function projectHomeworkStatements(
    handler: HomeworkWorkspaceHost,
    pdict: Record<number, Record<string, unknown>>,
    tid: ObjectId,
): Record<string, Record<string, unknown>> {
    const bridge = loadOptionalModule<{
        projectAndAbsolutizeStudentPdict?: (
            host: HomeworkWorkspaceHost,
            docs: Record<number, Record<string, unknown>>,
            contestId: ObjectId,
        ) => Record<string, Record<string, unknown>>;
    }>('./paper');
    if (bridge) {
        if (typeof bridge.projectAndAbsolutizeStudentPdict !== 'function') {
            throw new TypeError('projectAndAbsolutizeStudentPdict is missing');
        }
        return bridge.projectAndAbsolutizeStudentPdict(handler, pdict, tid);
    }
    const projected = projectStudentPdict(pdict);
    for (const pdoc of Object.values(projected)) {
        if (typeof pdoc.content === 'string') pdoc.content = absolutizeProblemFileUrls(handler, pdoc.content, pdoc, tid);
        if (pdoc.programmingStatementView) absolutizeProgrammingStatementFileUrls(handler, pdoc.programmingStatementView, pdoc, tid);
    }
    return projected;
}

function homeworkCanManage(actor: HomeworkWorkspaceActor, tdoc: Tdoc): boolean {
    const access = loadOptionalModule<{
        canManageTeachContainer: (user: HomeworkWorkspaceActor, type: 'homework', doc: Tdoc) => boolean;
    }>('../lib/teach-access');
    if (!access) return canEditHomework(actor, tdoc);
    return access.canManageTeachContainer(actor, 'homework', tdoc);
}

function answerRecord(value: unknown, label: string): DraftFacts['answers'] {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`homework draft ${label} is invalid`);
    const out: Record<string, string | string[]> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === 'string') {
            out[key] = item;
            continue;
        }
        if (Array.isArray(item) && item.every((part) => typeof part === 'string')) {
            out[key] = item;
            continue;
        }
        throw new TypeError(`homework draft ${label} is invalid`);
    }
    return out;
}

function judgeRecord(value: unknown): DraftFacts['judgeResult'] {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('homework draft judgeResult is invalid');
    const out: Record<string, 'correct' | 'wrong' | 'partial'> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (item !== 'correct' && item !== 'wrong' && item !== 'partial') {
            throw new TypeError('homework draft judgeResult is invalid');
        }
        out[key] = item;
    }
    return out;
}

function homeworkDraftFacts(rows: unknown): Map<number, DraftFacts> {
    if (!Array.isArray(rows)) throw new TypeError('homework drafts must be an array');
    const drafts = new Map<number, DraftFacts>();
    for (const [index, draft] of rows.entries()) {
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError(`homework draft ${index} is malformed`);
        const row = draft as { pid?: unknown; answers?: unknown; submittedAnswers?: unknown; code?: unknown; judgeResult?: unknown };
        if (!Number.isSafeInteger(row.pid) || Number(row.pid) <= 0) throw new TypeError(`homework draft ${index} is malformed`);
        if (row.code != null && typeof row.code !== 'string') throw new TypeError(`homework draft ${index} is malformed`);
        drafts.set(Number(row.pid), {
            answers: answerRecord(row.answers, 'answers'),
            submittedAnswers: answerRecord(row.submittedAnswers, 'submittedAnswers'),
            code: typeof row.code === 'string' ? row.code : null,
            judgeResult: judgeRecord(row.judgeResult),
        });
    }
    return drafts;
}

async function readHomeworkDraftFacts(authoritativeDomainId: string, tid: ObjectId, uid: number): Promise<Map<number, DraftFacts>> {
    const stored = loadOptionalModule<{
        getDraftsForUser: (domainId: string, draftTid: ObjectId, draftUid: number) => Promise<unknown>;
    }>('../model/paper-draft');
    if (!stored) return new Map();
    if (typeof stored.getDraftsForUser !== 'function') throw new TypeError('getDraftsForUser is missing');
    return homeworkDraftFacts(await stored.getDraftsForUser(authoritativeDomainId, tid, uid));
}

function homeworkJournal(tdoc: Tdoc, tsdoc: { journal?: unknown } | null | undefined): Map<number, JournalFacts> {
    if (!tsdoc || tsdoc.journal == null) return new Map();
    if (!Array.isArray(tsdoc.journal)) throw new TypeError('homework journal must be an array');
    const out = new Map<number, JournalFacts>();
    for (const [index, entry] of tsdoc.journal.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`homework journal entry ${index} is malformed`);
        const row = entry as { pid?: unknown; status?: unknown; score?: unknown; penaltyScore?: unknown };
        if (row.status === STATUS.STATUS_CANCELED) continue;
        if (!Number.isSafeInteger(row.pid) || Number(row.pid) <= 0) throw new TypeError(`homework journal entry ${index} is malformed`);
        if (typeof row.status !== 'number' || !Number.isInteger(row.status)) throw new TypeError(`homework journal entry ${index} is malformed`);
        const pid = Number(row.pid);
        const prev = out.get(pid);
        const lastScore = typeof row.penaltyScore === 'number' && Number.isFinite(row.penaltyScore)
            ? row.penaltyScore
            : typeof row.score === 'number' && Number.isFinite(row.score)
                ? scaleByContestProblemScore(tdoc, pid, row.score)
                : null;
        out.set(pid, {
            submits: (prev?.submits ?? 0) + 1,
            lastStatus: row.status,
            lastScore,
        });
    }
    return out;
}

function problemRow(source: unknown, pid: number): Record<string, unknown> | null {
    if (!source || typeof source !== 'object') return null;
    const dict = source as Record<string, unknown>;
    const row = dict[String(pid)] ?? dict[pid as unknown as string];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    return row as Record<string, unknown>;
}

interface HomeworkKindMeta {
    title: string;
    kind: ProblemKind;
    judged: boolean;
}

function storedProblemKind(doc: { problemKind?: unknown }): ProblemKind {
    return effectiveProblemKind(doc);
}

function homeworkProblemInputs(
    tdoc: Tdoc,
    statements: Record<string, Record<string, unknown>>,
    pdict: unknown,
    meta: Map<number, HomeworkKindMeta> | null,
): Array<{ pid: number; title: string; kind: ProblemKind; judged: boolean }> {
    if (!Array.isArray(tdoc.pids)) throw new TypeError('homework pids must be an array');
    const inputs: Array<{ pid: number; title: string; kind: ProblemKind; judged: boolean }> = [];
    for (const pid of tdoc.pids) {
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('homework pid is invalid');
        const detail = problemRow(statements, pid);
        const listed = problemRow(pdict, pid);
        if (meta && !detail) {
            const row = meta.get(pid);
            if (!row) continue;
            inputs.push({
                pid,
                title: typeof listed?.title === 'string' ? listed.title : '',
                kind: row.kind,
                judged: row.judged,
            });
            continue;
        }
        const chosen = detail ?? listed;
        if (!chosen) continue;
        const title = typeof detail?.title === 'string' ? detail.title : typeof listed?.title === 'string' ? listed.title : '';
        const fact = setProblemFact(chosen);
        inputs.push({
            pid,
            title,
            ...fact,
        });
    }
    return inputs;
}

function homeworkDocId(tdoc: Tdoc): ObjectId {
    if (!(tdoc.docId instanceof ObjectId)) throw new TypeError('docId must be an ObjectId');
    return tdoc.docId;
}

function homeworkWorkspaceUrls(
    handler: HomeworkWorkspaceHost,
    uid: number,
    canManage: boolean,
    canAttend: boolean,
    timed: boolean,
): SetWorkspace['urls'] {
    const tid = homeworkDocId(handler.tdoc);
    const tidHex = tid.toHexString();
    const detail = () => handler.url('homework_detail', { tid });
    const configured = storedSetConfigOrNull(handler.tdoc) !== null;
    return {
        back: handler.url('training_main'),
        manage: canManage ? teachPath('homework', tidHex) : null,
        overview: detail(),
        problem: null,
        submit: handler.url('problem_submit', { pid: '__PID__', query: { tid: tidHex } }),
        pretest: handler.url('problem_submit', { pid: '__PID__', query: { tid: tidHex } }),
        submitCode: configured ? handler.url('paper_submit_code', { tid, pid: '__PID__' }) : null,
        recordDetail: handler.url('record_detail', { rid: '__RID__', query: { tid: tidHex } }),
        records: handler.url('record_main', { query: { tid: tidHex, uidOrName: String(uid) } }),
        ranking: handler.url('homework_scoreboard', { tid }),
        clarify: null,
        print: null,
        start: storedSetConfigOrNull(handler.tdoc)
            ? handler.url('set_round_start_homework', { tid })
            : (timed ? detail() : null),
        attend: canAttend ? configured ? handler.url('contest_detail', { tid }) : detail() : null,
        draftList: handler.url(configured ? 'set_round_answers_homework' : 'homework_draft_list', { tid }),
        saveAnswers: configured ? handler.url('set_round_save_homework', { tid }) : null,
        draftUpsert: configured ? null : handler.url('homework_draft_upsert', { tid, pid: '__PID__' }),
        submitKind: configured ? null : handler.url('homework_submit_kind', { tid }),
        lockKind: null,
        finalize: configured ? handler.url('set_round_hand_in_homework', { tid }) : null,
        virtual: null,
        practice: null,
        teamProblem: null,
    };
}

async function homeworkWorkspaceStudent(handler: HomeworkWorkspaceHost, authoritativeDomainId: string): Promise<SetWorkspace['student']> {
    const rec = await studentDirectory().findStudentByUserId(authoritativeDomainId, handler.user._id);
    const realName = typeof rec?.realName === 'string' ? rec.realName.trim() : '';
    const rawId = rec?.studentId;
    const studentId = rawId == null || rawId === '' ? null : String(rawId);
    return { name: realName || handler.user.uname || '', studentId };
}

const HOMEWORK_RAW_CONFIG_UNAVAILABLE = Symbol('homework-raw-config-unavailable');

function problemReferenceSource(reference: ProblemDoc['reference'] | null | undefined): { domainId: string; pid: number } | null {
    if (reference == null) return null;
    if (typeof reference !== 'object' || Array.isArray(reference)) throw new TypeError('homework problem reference is invalid');
    const sourceDomainId = reference.domainId;
    const sourcePid = reference.pid;
    if (typeof sourceDomainId !== 'string' || !sourceDomainId) throw new TypeError('homework problem reference is invalid');
    if (!Number.isSafeInteger(sourcePid) || sourcePid <= 0) throw new TypeError('homework problem reference is invalid');
    return { domainId: sourceDomainId, pid: sourcePid };
}

async function rawHomeworkProblemConfig(authoritativeDomainId: string, docId: number): Promise<unknown> {
    if (typeof problem.get !== 'function') return HOMEWORK_RAW_CONFIG_UNAVAILABLE;
    const row = await problem.get(authoritativeDomainId, docId, ['config', 'reference'], true);
    if (!row) throw new TypeError(`homework problem ${docId} is missing`);
    const source = problemReferenceSource(row.reference);
    const configDoc = source ? await problem.get(source.domainId, source.pid, ['config', 'reference'], true) : row;
    if (!configDoc) throw new TypeError(`homework problem ${docId} source is missing`);
    return parseProblemConfigObject(configDoc);
}

async function readHomeworkProblemMeta(handler: HomeworkWorkspaceHost, authoritativeDomainId: string): Promise<Map<number, HomeworkKindMeta>> {
    const docs = await readContextViewableProblems(
        authoritativeDomainId,
        handler.user,
        handler.tdoc.pids,
        { kind: 'homework-membership' },
        {
            readDirectStable: async () => {
                throw new TypeError('homework-membership must use the container face');
            },
            readContainer: async (pids) => {
                const dict = await problem.getList(authoritativeDomainId, pids, true, true, ['docId', 'title', 'problemKind']);
                return problemDocsFromGetList(dict, pids);
            },
        },
    );
    const meta = new Map<number, HomeworkKindMeta>();
    for (const pdoc of docs) {
        if (!Number.isSafeInteger(pdoc.docId)) throw new TypeError('homework problem docId is invalid');
        const kind = storedProblemKind(pdoc);
        const config = kind === 'program_fill' ? await rawHomeworkProblemConfig(authoritativeDomainId, pdoc.docId) : undefined;
        meta.set(pdoc.docId, {
            title: typeof pdoc.title === 'string' ? pdoc.title : '',
            ...setProblemFact({ ...pdoc, config }),
        });
    }
    return meta;
}

async function readHomeworkStatements(
    handler: HomeworkWorkspaceHost,
    authoritativeDomainId: string,
): Promise<Record<string, Record<string, unknown>>> {
    const docs = await readContextViewableProblems(
        authoritativeDomainId,
        handler.user,
        handler.tdoc.pids,
        { kind: 'homework-membership' },
        {
            readDirectStable: async () => {
                throw new TypeError('homework-membership must use the container face');
            },
            readContainer: async (pids) => {
                const dict = await problem.getList(authoritativeDomainId, pids, true, true, [
                    ...problem.PROJECTION_CONTEST_DETAIL,
                    'problemKind', 'difficulty',
                ]);
                return problemDocsFromGetList(dict, pids);
            },
        },
    );
    const raw: Record<number, Record<string, unknown>> = {};
    for (const pdoc of docs) {
        if (!Number.isSafeInteger(pdoc.docId)) throw new TypeError('homework problem docId is invalid');
        const statement = pdoc as unknown as Record<string, unknown>;
        const config = await rawHomeworkProblemConfig(authoritativeDomainId, pdoc.docId);
        raw[pdoc.docId] = config === HOMEWORK_RAW_CONFIG_UNAVAILABLE ? statement : { ...statement, config };
    }
    return projectHomeworkStatements(handler, raw, homeworkDocId(handler.tdoc));
}

async function attachHomeworkWorkspace(
    handler: HomeworkWorkspaceHost,
    authoritativeDomainId: string,
    tsdoc: { attend?: number; startAt?: Date | null; journal?: unknown } | null | undefined,
    workspaceProblems: Record<string, Record<string, unknown>>,
) {
    const now = new Date();
    const tid = homeworkDocId(handler.tdoc);
    const preview = homeworkCanManage(handler.user, handler.tdoc);
    const configured = storedSetConfigOrNull(handler.tdoc) !== null;
    const postContestViewClosed = contest.isDone(handler.tdoc) && !allowsPostContestView(handler.tdoc) && !preview;
    const official = configured && !preview && !postContestViewClosed ? await loadSetStudentState(handler.tdoc, handler.user._id, undefined, now) : null;
    if (configured && !preview) {
        workspaceProblems = Object.fromEntries(Object.entries(workspaceProblems).filter(([pid]) => official?.pids.includes(Number(pid))));
    }
    const timed = positiveDurationHours(handler.tdoc.duration) != null;
    const canAttend = (configured ? !!handler.tdoc._code : !timed)
        && !preview && tsdoc?.attend !== 1 && !contest.isDone(handler.tdoc) && handler.user.hasPerm(PERM.PERM_ATTEND_HOMEWORK);
    const status = (tsdoc ?? null) as Record<string, unknown> | null;
    const kindMeta = Object.keys(workspaceProblems).length === 0 ? await readHomeworkProblemMeta(handler, authoritativeDomainId) : null;
    const rows = homeworkProblemInputs(handler.tdoc, workspaceProblems, handler.response.body.pdict, kindMeta)
        .filter((item) => !configured || preview || official?.pids.includes(item.pid));
    handler.response.body.workspace = buildSetWorkspace({
        kind: 'homework',
        tdoc: handler.tdoc,
        tsdoc: status,
        now,
        mode: preview ? 'preview' : 'browser',
        problems: await scoreWorkspaceProblems(problem, authoritativeDomainId, handler.tdoc, rows),
        drafts: configured ? new Map() : await readHomeworkDraftFacts(authoritativeDomainId, tid, handler.user._id),
        journal: homeworkJournal(handler.tdoc, tsdoc),
        paperFacts: null,
        ...(configured ? setWorkspaceState(official) : {}),
        canAttend,
        invitationRequired: configured && !!handler.tdoc._code && !tsdoc?.attend,
        canUnrank: false,
        canShowScoreboard: (await contest.canShowScoreboardForUser.call(handler, handler.tdoc, true)),
        postContestPracticeOpen: getPostContestPracticeState(handler.tdoc, tsdoc, now).open,
        postContestViewClosed,
        virtualAvailable: false,
        canClarify: false,
        team: null,
        announcements: [],
        clarifications: [],
        student: await homeworkWorkspaceStudent(handler, authoritativeDomainId),
        urls: homeworkWorkspaceUrls(handler, handler.user._id, preview, canAttend, timed),
    });
    handler.response.body.workspaceProblems = workspaceProblems;
    handler.response.body.langRange = homeworkLangRange();
    if (configured) {
        handler.response.body = setWorkspaceResponse(handler.tdoc, {
            workspace: handler.response.body.workspace as SetWorkspace,
            workspaceProblems,
            langRange: handler.response.body.langRange,
        });
    }
}

class HomeworkMainHandler extends Handler {
    @param('group', Types.Name, true)
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, group = '', page = 1, q = '') {
        this.response.redirect = this.url('training_main');
        return;
        const authoritativeDomainId = String(this.domain?._id);
        const canBypass = canBypassHomeworkAccess(this.user);
        const groups = (await user.listGroup(authoritativeDomainId, canBypass ? undefined : this.user._id)).map((i) => i.name);
        if (group && !groups.includes(group)) throw new NotAssignedError(group);
        const participantGroups = canBypass ? [] : participantGroupObjectIds(await getHomeworkUserGroupIds(authoritativeDomainId, this.user._id));
        const escaped = escapeRegExp(q.toLowerCase());
        const cursor = contest
            .getMulti(authoritativeDomainId, {
                rule: 'homework',
                ...(canBypass ? {} : buildHomeworkListAccessFilter(this.user._id, groups, participantGroups)),
                ...(group ? { assign: { $in: [group] } } : {}),
                ...(q ? { title: { $regex: new RegExp(q.length >= 2 ? escaped : `^${escaped}`, 'i') } } : {}),
            })
            .sort({
                penaltySince: -1,
                endAt: -1,
                beginAt: -1,
                _id: -1,
            });
        const [tdocs, tpcount] = await this.paginate(cursor, page, 'contest');
        const calendar = [];
        for (const tdoc of tdocs) {
            const cal = { ...tdoc, url: this.url('homework_detail', { tid: tdoc.docId }) };
            if (contest.isExtended(tdoc) || contest.isDone(tdoc)) {
                cal.endAt = tdoc.endAt;
                cal.penaltySince = tdoc.penaltySince;
            } else cal.endAt = tdoc.penaltySince;
            calendar.push(cal);
        }
        let qs = group ? `group=${group}` : '';
        if (q) qs += `${qs ? '&' : ''}q=${encodeURIComponent(q)}`;
        const groupsFilter = groups.filter((i) => !Number.isSafeInteger(+i));
        this.response.body = {
            tdocs,
            calendar,
            tpcount,
            page,
            qs,
            groups: groupsFilter,
            group,
            q,
        };
        this.response.template = 'homework_main.html';
    }
}

class HomeworkDetailHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (this.tdoc.rule !== 'homework') throw new ContestNotFoundError(authoritativeDomainId, tid);
        if (storedSetConfigOrNull(this.tdoc)) {
            if (this.request.method !== 'get') throw new ValidationError('round', null, localizedErrorText`请使用题目集入口参加并开始作答。`);
            await assertSetParticipation(this, this.tdoc, false, true);
            return;
        }
        const homeworkManager = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_HOMEWORK) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        contest.requirePublishedForStudent(this.tdoc, homeworkManager);
        if (await decideContainerVisibility(authoritativeDomainId, this.tdoc, this.user) === 'bypass') return;
        await assertHomeworkAccess(authoritativeDomainId, this.tdoc, this.user);
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, page = 1) {
        const authoritativeDomainId = String(this.domain?._id);
        const tsdoc = await contest.getStatus(authoritativeDomainId, tid, this.user._id);
        if (this.tdoc.rule !== 'homework') throw new ContestNotFoundError(authoritativeDomainId, tid);
        if (storedSetConfigOrNull(this.tdoc)) {
            const access = await assertSetParticipation(this, this.tdoc, false, true);
            this.response.template = 'set_workspace.html';
            if (access.clientOnlyView) {
                this.response.redirect = this.url('paper_layout', { tid });
                return;
            }
            await attachHomeworkWorkspace(this, authoritativeDomainId, tsdoc,
                await readHomeworkStatements(this, authoritativeDomainId));
            return;
        }
        // discussion
        const [ddocs, dpcount, dcount] = await this.paginate(
            discussion.getMulti(authoritativeDomainId, { parentType: this.tdoc.docType, parentId: this.tdoc.docId }),
            page,
            'discussion',
        );
        const uids = ddocs.map((ddoc) => ddoc.owner);
        uids.push(this.tdoc.owner);
        const udict = await user.getList(authoritativeDomainId, uids);
        let homeworkStart = homeworkStartView(this.tdoc, tsdoc);
        this.response.template = 'set_workspace.html';
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc,
            udict,
            ddocs,
            page,
            dpcount,
            dcount,
            homeworkStart,
            canGradeSubjective: this.tdoc.owner === this.user._id || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            canEditHomework: canEditHomework(this.user, this.tdoc),
            canDeleteHomework: canDeleteHomework(this.user, this.tdoc),
        };
        this.response.body.tdoc.content = this.response.body.tdoc.content
            .replace(/\(file:\/\//g, `(./${this.tdoc.docId}/file/public/`)
            .replace(/="file:\/\//g, `="./${this.tdoc.docId}/file/public/`);
        if (
            (contest.isNotStarted(this.tdoc) || (!tsdoc?.attend && !contest.isDone(this.tdoc))) &&
            !this.user.own(this.tdoc) &&
            !this.user.hasPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD)
        ) {
            if (homeworkStart.required) Object.assign(this.response.body, { pdict: {}, psdict: {}, rdict: {} });
            await attachHomeworkWorkspace(this, authoritativeDomainId, tsdoc, {});
            return;
        }
        if (contest.isDone(this.tdoc) && !allowsPostContestView(this.tdoc) && !canEditHomework(this.user, this.tdoc)) {
            if (homeworkStart.required) Object.assign(this.response.body, { pdict: {}, psdict: {}, rdict: {} });
            await attachHomeworkWorkspace(this, authoritativeDomainId, tsdoc, {});
            return;
        }
        if (homeworkStart.required) {
            Object.assign(this.response.body, { pdict: {}, psdict: {}, rdict: {} });
            await attachHomeworkWorkspace(this, authoritativeDomainId, tsdoc, {});
            return;
        }
        const pdict = problemDictFromDocs(
            await readContextViewableProblems(
                authoritativeDomainId,
                this.user,
                this.tdoc.pids,
                { kind: 'homework-membership' },
                {
                    readDirectStable: async () => {
                        throw new TypeError('homework-membership must use the container face');
                    },
                    readContainer: async (pids) => {
                        const dict = await problem.getList(authoritativeDomainId, pids, true, true, problem.PROJECTION_CONTEST_LIST);
                        return problemDocsFromGetList(dict, pids);
                    },
                },
            ),
        );
        const psdict = {};
        let rdict = {};
        if (tsdoc) {
            if (tsdoc.attend && !tsdoc.startAt && contest.isOngoing(this.tdoc) && !this.tdoc.duration) {
                const startAt = new Date();
                await contest.setStatus(authoritativeDomainId, tid, this.user._id, { startAt });
                tsdoc.startAt = startAt;
                homeworkStart = homeworkStartView(this.tdoc, tsdoc);
                this.response.body.homeworkStart = homeworkStart;
            }
            const valid = (tsdoc.journal || []).filter((p) => this.tdoc.pids.includes(p.pid));
            for (const pdetail of valid) {
                psdict[pdetail.pid] = pdetail;
                rdict[pdetail.rid] = { _id: pdetail.rid };
            }
            if ((await contest.canShowSelfRecordForUser.call(this, this.tdoc)) && valid.length) {
                rdict = await record.getList(
                    authoritativeDomainId,
                    valid.map((pdetail) => pdetail.rid),
                );
            }
        }
        Object.assign(this.response.body, { pdict, psdict, rdict });
        await attachHomeworkWorkspace(
            this,
            authoritativeDomainId,
            tsdoc,
            await readHomeworkStatements(this, authoritativeDomainId),
        );
    }

    async postAttend(_args: { domainId?: string }) {
        const authoritativeDomainId = String(this.domain?._id);
        this.checkPerm(PERM.PERM_ATTEND_HOMEWORK);
        if (contest.isDone(this.tdoc)) throw new HomeworkNotLiveError(this.tdoc.docId);
        await contest.attend(authoritativeDomainId, this.tdoc.docId, this.user._id);
        this.back();
    }

    async postStart() {
        const authoritativeDomainId = String(this.domain?._id);
        this.checkPerm(PERM.PERM_ATTEND_HOMEWORK);
        if (contest.isNotStarted(this.tdoc) || contest.isDone(this.tdoc)) throw new HomeworkNotLiveError(this.tdoc.docId);
        if (positiveDurationHours(this.tdoc.duration) == null) {
            throw new ValidationError('operation', null, localizedErrorText`这份作业没有个人限时，不需要开始作答`);
        }
        const tsdoc = await contest.getStatus(authoritativeDomainId, this.tdoc.docId, this.user._id);
        if (!tsdoc?.attend) await contest.attend(authoritativeDomainId, this.tdoc.docId, this.user._id);
        const wroteStart = !(tsdoc?.startAt instanceof Date);
        if (wroteStart) {
            await contest.setStatus(authoritativeDomainId, this.tdoc.docId, this.user._id, { startAt: new Date() });
        }
        logHomework(
            'Homework personal start domain=%s uid=%s tid=%s wroteStart=%s',
            authoritativeDomainId,
            this.user._id,
            this.tdoc.docId,
            wroteStart,
        );
        this.back();
    }
}

function serializedHomeworkEdit(_target: unknown, _key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value as (this: Handler, ...args: unknown[]) => Promise<unknown>;
    descriptor.value = async function homeworkEditBoundary(this: Handler, ...args: unknown[]) {
        const tid = args[1];
        if (!tid) return original.apply(this, args);
        if (!(tid instanceof ObjectId)) throw new ValidationError('tid');
        return withContestEditBoundary(String(this.domain?._id), tid, () => original.apply(this, args));
    };
    return descriptor;
}

class HomeworkEditHandler extends Handler {
    @param('tid', Types.ObjectId, true)
    @param('fromCourse', Types.ObjectId, true)
    @param('chapter', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, fromCourse: ObjectId | undefined, chapter = 0) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid && (fromCourse || chapter)) throw new ValidationError('fromCourse', 'chapter');
        const tdoc = tid ? await contest.get(authoritativeDomainId, tid) : null;
        if (tid) {
            await assertHomeworkManageOrHide(authoritativeDomainId, tdoc, this.user, canEditHomework(this.user, tdoc), () => {
                assertCanEditHomework(this.user, tdoc);
            });
        } else if (!canCreateHomework(this.user)) this.checkPerm(PERM.PERM_CREATE_HOMEWORK);
        const setConfig = tdoc ? storedSetConfigOrNull(tdoc) : null;
        const dated = Boolean(
            tid
            && tdoc.beginAt instanceof Date
            && tdoc.endAt instanceof Date
            && (setConfig || tdoc.penaltySince instanceof Date),
        );
        const extensionDays = setConfig ? 0 : dated
            ? Math.round((tdoc.endAt.getTime() - tdoc.penaltySince.getTime()) / (Time.day / 100)) / 100
            : 1;
        const beginAt = dated
            ? moment(tdoc.beginAt).tz(this.user.timeZone)
            : moment().add(1, 'day').tz(this.user.timeZone).hour(0).minute(0).millisecond(0);
        const penaltySince = dated
            ? moment(setConfig ? tdoc.endAt : tdoc.penaltySince).tz(this.user.timeZone)
            : beginAt.clone().add(7, 'days').tz(this.user.timeZone).hour(23).minute(59).millisecond(0);
        let quizContext: { course: TrainingDoc; chapter: TrainingNode } | null = null;
        if (fromCourse) quizContext = await loadCourseQuizContext(authoritativeDomainId, fromCourse, chapter, this.user);
        if (!fromCourse && chapter) throw new ValidationError('chapter');
        // 测验还没写入作业时，页面用课程上的组做只读展示，候选里要能解析这些组的名字。
        const storedIds = tdoc ? storedParticipantGroupIds(tdoc.participantGroupIds) : [];
        const courseGroupIds = quizContext ? storedParticipantGroupIds(quizContext.course.courseGroupIds) : [];
        const participantScopeMode = quizContext
            ? courseGroupIds.length
                ? 'groups'
                : 'none'
            : tdoc?.participantScopeMode === 'groups'
              ? 'groups'
              : 'none';
        const participantGroupIds = (quizContext ? courseGroupIds : storedIds).map((groupId) => groupId.toHexString());
        const scopeGroups = await homeworkEditScopeGroups(
            authoritativeDomainId,
            this.user,
            quizContext ? [...storedIds, ...courseGroupIds] : storedIds,
            homeworkGroupsUnrestricted(this.user),
        );
        const formDoc =
            tdoc ||
            (quizContext
                ? {
                      title: `${quizContext.course.title} · ${quizContext.chapter.title}`,
                      content: '',
                      assign: [],
                      maintainer: [],
                      langs: [],
                      rated: false,
                      participantScopeMode,
                      participantGroupIds,
                  }
                : null);
        this.response.template = 'homework_edit.html';
        this.response.body = {
            tdoc: formDoc,
            dateBeginText: beginAt.format('YYYY-M-D'),
            timeBeginText: beginAt.format('H:mm'),
            datePenaltyText: penaltySince.format('YYYY-M-D'),
            timePenaltyText: penaltySince.format('H:mm'),
            extensionDays,
            penaltyRules: setConfig ? null : tid ? yaml.dump(tdoc.penaltyRules) : null,
            pids: tid ? tdoc.pids.join(',') : '',
            page_name: tid ? 'homework_edit' : 'homework_create',
            participantScopeMode,
            participantGroupIds,
            scopeGroups,
            fromCourse: fromCourse ? String(fromCourse) : '',
            chapter: chapter || '',
            courseContext: quizContext
                ? {
                      courseTitle: quizContext.course.title,
                      chapterTitle: quizContext.chapter.title,
                  }
                : null,
        };
    }

    @param('tid', Types.ObjectId)
    @param('pids', Types.Content, true)
    @param('problemScores', Types.Content, true)
    @param('paperEdit', Types.Content, true)
    @serializedHomeworkEdit
    async postUpdateProblems(_domainId: string, tid: ObjectId, rawPids = '', problemScores?: string, paperEdit?: string) {
        const authoritativeDomainId = String(this.domain._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const tdoc = await contest.get(authoritativeDomainId, tid);
        await assertHomeworkManageOrHide(authoritativeDomainId, tdoc, this.user, canEditHomework(this.user, tdoc), () => {
            assertCanEditHomework(this.user, tdoc);
        });
        const pids = parseProblemDocIds(rawPids);
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, tdoc.pids);
        await assertHomeworkProblemKinds(authoritativeDomainId, pids, tdoc.pids);
        const plan = await planSetPaperEdit(tdoc, pids, problemScores, paperEdit, this.user._id);
        if (plan.confirmation) {
            this.response.body = { confirmation: plan.confirmation };
            return;
        }
        const { patch, needsRecalc } = plan;
        if (plan.audit) await oplog.add({ type: 'set.paper-score-change', stage: 'confirmed', ...plan.audit, time: new Date() });
        await contest.edit(authoritativeDomainId, tid, patch, { confirmedPaperCorrection: Boolean(plan.audit) });
        if (needsRecalc) await contest.recalcConfiguredSet({ ...tdoc, ...patch }, plan.changedPids);
        logHomework('Problem set paper updated domain=%s homework=%s actor=%d problems=%d', authoritativeDomainId, tid, this.user._id, pids.length);
        this.response.body = { tid, revision: plan.revision };
    }

    @param('tid', Types.ObjectId, true)
    @param('beginAtDate', Types.Date)
    @param('beginAtTime', Types.Time)
    @param('penaltySinceDate', Types.Date, true)
    @param('penaltySinceTime', Types.Time, true)
    @param('extensionDays', Types.Float, true)
    @param('penaltyRules', Types.Content, true, validatePenaltyRules, convertPenaltyRules)
    @param('title', Types.Title)
    @param('content', Types.Content, true)
    @param('pids', Types.Content, true)
    @param('rated', Types.Boolean)
    @param('maintainer', Types.NumericArray, true)
    @param('assign', Types.CommaSeperatedArray, true)
    @param('langs', Types.CommaSeperatedArray, true)
    @param('participantScopeMode', Types.Range(['none', 'groups']), true)
    @param('participantGroupIds', Types.CommaSeperatedArray, true)
    @param('fromCourse', Types.ObjectId, true)
    @param('chapter', Types.PositiveInt, true)
    @param('contestDuration', Types.Float, true)
    @param('problemScores', Types.Content, true)
    @param('homeworkShowObjectiveVerdict', Types.Boolean, true)
    @param('hidden', Types.Boolean)
    @param('endAtDate', Types.Date, true)
    @param('endAtTime', Types.Time, true)
    @serializedHomeworkEdit
    async postUpdate(
        _domainId: string,
        tid: ObjectId,
        beginAtDate: string,
        beginAtTime: string,
        penaltySinceDate: string,
        penaltySinceTime: string,
        extensionDays: number,
        penaltyRules: PenaltyRules,
        title: string,
        content = '',
        _pids = '',
        rated = false,
        maintainer: number[] = [],
        assign: string[] = [],
        langs: string[] = [],
        participantScopeMode: 'none' | 'groups' = 'none',
        participantGroupIds: string[] = [],
        fromCourse: ObjectId | undefined,
        chapter = 0,
        contestDuration?: number,
        problemScores?: string,
        homeworkShowObjectiveVerdict?: boolean,
        hidden = false,
        endAtDate?: string,
        endAtTime?: string,
    ) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const pids = parseProblemDocIds(_pids);
        const tdoc = tid ? await contest.get(authoritativeDomainId, tid) : null;
        const setConfig = tdoc ? storedSetConfigOrNull(tdoc) : null;
        if (tid && (fromCourse || chapter)) throw new ValidationError('fromCourse', 'chapter');
        if (tid) {
            await assertHomeworkManageOrHide(authoritativeDomainId, tdoc, this.user, canEditHomework(this.user, tdoc), () => {
                assertCanEditHomework(this.user, tdoc);
            });
        } else {
            if (!canCreateHomework(this.user)) this.checkPerm(PERM.PERM_CREATE_HOMEWORK);
            try {
                assertSetCreateAllowed(
                    {
                        privEditSystem: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
                        createHomework: this.user.hasPerm(PERM.PERM_CREATE_HOMEWORK),
                        createExam: this.user.hasPerm(PERM.PERM_CREATE_CONTEST),
                        createPractice: this.user.hasPerm(PERM.PERM_CREATE_TRAINING),
                    },
                    'homework',
                );
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                const message = setConfigMessage(error.message);
                const strings = [message] as unknown as TemplateStringsArray;
                Object.defineProperty(strings, 'raw', { value: [message] });
                throw new ValidationError('rule', null, new LocalizedErrorText(strings, []));
            }
        }
        const beginAt = moment.tz(`${beginAtDate} ${beginAtTime}`, this.user.timeZone);
        if (!beginAt.isValid()) throw new ValidationError('beginAtDate', 'beginAtTime');
        // Existing audience forms still post the edit snapshot's deadline fields.
        // For configured sets that snapshot has endAt and zero extension only.
        if (setConfig && Boolean(endAtDate) !== Boolean(endAtTime)) throw new ValidationError('endAtDate', 'endAtTime');
        if (setConfig && !endAtDate && extensionDays !== 0) throw new ValidationError('endAtDate', 'endAtTime');
        if (!setConfig && (penaltySinceDate == null || penaltySinceTime == null || extensionDays == null || penaltyRules == null)) {
            throw new ValidationError('penaltySinceDate', 'penaltySinceTime', 'extensionDays', 'penaltyRules');
        }
        const deadlineDate = setConfig ? endAtDate ?? penaltySinceDate : penaltySinceDate;
        const deadlineTime = setConfig ? endAtTime ?? penaltySinceTime : penaltySinceTime;
        if (!deadlineDate || !deadlineTime) throw new ValidationError('endAtDate', 'endAtTime');
        const penaltySince = moment.tz(`${deadlineDate} ${deadlineTime}`, this.user.timeZone);
        if (!penaltySince.isValid()) throw new ValidationError('endAtDate', 'endAtTime');
        const endAt = setConfig ? penaltySince.clone() : penaltySince.clone().add(extensionDays, 'days');
        if (beginAt.isSameOrAfter(penaltySince)) throw new ValidationError('endAtDate', 'endAtTime');
        if (penaltySince.isAfter(endAt)) throw new ValidationError('extensionDays');
        const durationHours = setConfig ? setConfig.settings.personalLimit.hours : postedContestDuration(contestDuration, extensionDays, beginAt, endAt);
        const nextScores = postedProblemScores(problemScores, pids);
        if (setConfig) {
            await assertSetBasicEdit(tdoc, { beginAt: beginAt.toDate(), endAt: endAt.toDate(), pids, ...(nextScores ? { score: nextScores } : {}) });
        }
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, tdoc?.pids);
        await assertHomeworkProblemKinds(authoritativeDomainId, pids, tdoc?.pids ?? []);
        const quizContext = fromCourse ? await loadCourseQuizContext(authoritativeDomainId, fromCourse, chapter, this.user) : null;
        if (!fromCourse && chapter) throw new ValidationError('chapter');
        // 课程测验的组来自课程文档。课程保存时已经校验过，这里不解析客户端提交，也不做可挂校验。
        const participantScope = quizContext
            ? {
                  participantScopeMode: quizContext.course.courseGroupIds?.length ? ('groups' as const) : ('none' as const),
                  participantGroupIds: quizContext.course.courseGroupIds || [],
              }
            : await checkedHomeworkParticipantGroups(
                  authoritativeDomainId,
                  this.user,
                  tdoc,
                  participantScopeMode,
                  participantGroupIds,
              );
        if (!tid) {
            tid = await contest.add(authoritativeDomainId, title, content, this.user._id, 'homework', beginAt.toDate(), endAt.toDate(), pids, rated, {
                penaltySince: penaltySince.toDate(),
                penaltyRules,
                assign,
                duration: durationHours,
                ...(nextScores ? { score: nextScores } : {}),
                ...(homeworkShowObjectiveVerdict === false ? { homeworkShowObjectiveVerdict: false } : {}),
                hidden,
                ...participantScope,
            });
            if (quizContext) {
                try {
                    const attached = await training.attachContestToCourseChapter(authoritativeDomainId, fromCourse!, chapter, tid);
                    if (!attached) throw new ValidationError('fromCourse', 'chapter');
                } catch (error) {
                    logger.error(
                        'Course quiz attach failed; deleting orphan domain=%s course=%s chapter=%d homework=%s error=%o',
                        authoritativeDomainId,
                        fromCourse,
                        chapter,
                        tid,
                        error,
                    );
                    try {
                        await contest.del(authoritativeDomainId, tid);
                    } catch (cleanupError) {
                        logger.error(
                            'Course quiz orphan cleanup failed domain=%s homework=%s error=%o cleanupError=%o',
                            authoritativeDomainId,
                            tid,
                            error,
                            cleanupError,
                        );
                        throw new Error(`course quiz attach and orphan cleanup failed: ${tid}`, {
                            cause: cleanupError,
                        });
                    }
                    throw error;
                }
            }
        } else {
            const scoresChanged = nextScores != null && pids.some((pid) => contestProblemScoreWeight(tdoc, pid) !== nextScores[pid]);
            const needsRecalc = scoresChanged || Boolean(tdoc.statusRecalcToken)
                || tdoc.beginAt?.getTime() !== beginAt.valueOf()
                || tdoc.endAt?.getTime() !== endAt.valueOf()
                || (!setConfig && tdoc.penaltySince?.getTime() !== penaltySince.valueOf())
                || tdoc.pids.join(' ') !== pids.join(' ');
            const statusRecalcToken = needsRecalc ? randomstring(24) : null;
            await contest.edit(authoritativeDomainId, tid, {
                title,
                content,
                beginAt: beginAt.toDate(),
                endAt: endAt.toDate(),
                pids,
                ...(!setConfig ? { penaltySince: penaltySince.toDate(), penaltyRules } : {}),
                rated,
                maintainer,
                assign,
                langs,
                ...(!setConfig ? { duration: durationHours } : {}),
                ...(nextScores ? { score: nextScores } : {}),
                ...(setConfig && scoresChanged ? { setConfig: { ...setConfig, revision: setConfig.revision + 1 } } : {}),
                ...(statusRecalcToken ? { statusRecalcToken } : {}),
                ...(!setConfig && homeworkShowObjectiveVerdict === false ? { homeworkShowObjectiveVerdict: false } : {}),
                hidden,
                ...participantScope,
            }, !setConfig && homeworkShowObjectiveVerdict === true ? { unset: { homeworkShowObjectiveVerdict: '' } } : {});
            if (statusRecalcToken) {
                await contest.recalcStatus(authoritativeDomainId, tdoc.docId);
                if (!setConfig) {
                    await document.coll.findOneAndUpdate(
                        { domainId: authoritativeDomainId, docType: document.TYPE_CONTEST, docId: tdoc.docId, statusRecalcToken },
                        { $unset: { statusRecalcToken: '' } },
                    );
                }
            }
        }
        logHomework(
            'Homework save domain=%s uid=%s tid=%s problems=%d personalLimit=%s scores=%s',
            authoritativeDomainId,
            this.user._id,
            tid,
            pids.length,
            durationHours != null,
            nextScores != null,
        );
        this.response.body = { tid };
        this.response.redirect = quizContext
            ? `${this.url('course_detail', { tid: fromCourse })}?chapter=${chapter}`
            : this.url('homework_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        const tdoc = await contest.get(authoritativeDomainId, tid);
        await assertHomeworkManageOrHide(authoritativeDomainId, tdoc, this.user, canDeleteHomework(this.user, tdoc), () => {
            assertCanDeleteHomework(this.user, tdoc);
        });
        await Promise.all([
            record.updateMulti(authoritativeDomainId, { domainId: authoritativeDomainId, contest: tid }, undefined, undefined, { contest: '' }),
            contest.del(authoritativeDomainId, tid),
            storage.del(tdoc.files?.map((i) => `contest/${authoritativeDomainId}/${tid}/public/${i.name}`) || [], this.user._id),
        ]);
        this.response.redirect = this.url('homework_main');
    }
}

export class HomeworkFilesHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        await assertHomeworkManageOrHide(
            authoritativeDomainId,
            this.tdoc,
            this.user,
            this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_HOMEWORK),
            () => {
                throw new PermissionError(PERM.PERM_EDIT_HOMEWORK);
            },
        );
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_HOMEWORK)) {
            throw new PermissionError(PERM.PERM_EDIT_HOMEWORK);
        }
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: await contest.getStatus(authoritativeDomainId, this.tdoc.docId, this.user._id),
            udoc: await user.getById(authoritativeDomainId, this.tdoc.owner),
            files: sortFiles(this.tdoc.files || []),
            urlForFile: (filename: string) => this.url('homework_file_download', { tid, filename, type: 'public' }),
        };
        this.response.pjax = 'partials/files.html';
        this.response.template = 'homework_files.html';
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename, true)
    async postUploadFile(_domainId: string, tid: ObjectId, filename: string) {
        const authoritativeDomainId = String(this.domain?._id);
        if ((this.tdoc.files?.length || 0) >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const size = Math.sum((this.tdoc.files || []).map((i) => i.size)) + file.size;
        if (size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        await storage.put(`contest/${authoritativeDomainId}/${tid}/public/${filename}`, file.filepath, this.user._id);
        const meta = await storage.getMeta(`contest/${authoritativeDomainId}/${tid}/public/${filename}`);
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!meta) throw new FileUploadError();
        await contest.edit(authoritativeDomainId, tid, { files: [...(this.tdoc.files || []), payload] });
        this.back();
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(_domainId: string, tid: ObjectId, files: string[]) {
        const authoritativeDomainId = String(this.domain?._id);
        await Promise.all([
            storage.del(
                files.map((t) => `contest/${authoritativeDomainId}/${tid}/public/${t}`),
                this.user._id,
            ),
            contest.edit(authoritativeDomainId, tid, { files: this.tdoc.files.filter((i) => !files.includes(i.name)) }),
        ]);
        this.back();
    }
}

class HomeworkFileDownloadHandler extends ContestFileDownloadHandler {
    async prepare() {
        if (this.tdoc.rule !== 'homework') throw new ContestNotFoundError(this.authoritativeDomainId(), this.tdoc.docId);
    }
}

export async function apply(ctx) {
    ctx.Route('homework_main', '/homework', HomeworkMainHandler);
    ctx.Route('homework_create', '/homework/create', HomeworkEditHandler);
    ctx.Route('homework_detail', '/homework/:tid', HomeworkDetailHandler);
    ctx.Route('homework_code', '/homework/:tid/code', ContestCodeHandler, PERM.PERM_VIEW_HOMEWORK);
    ctx.Route('homework_edit', '/homework/:tid/edit', HomeworkEditHandler);
    ctx.Route('homework_files', '/homework/:tid/file', HomeworkFilesHandler);
    ctx.Route('homework_file_download', '/homework/:tid/file/:type/:filename', HomeworkFileDownloadHandler);
    await ctx.inject(['scoreboard'], ({ Route }) => {
        Route('homework_scoreboard', '/homework/:tid/scoreboard', ContestScoreboardHandler, PERM.PERM_VIEW_HOMEWORK_SCOREBOARD);
        Route('homework_scoreboard_view', '/homework/:tid/scoreboard/:view', ContestScoreboardHandler, PERM.PERM_VIEW_HOMEWORK_SCOREBOARD);
    });
}
