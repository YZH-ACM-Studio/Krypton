import { ObjectId, type Filter } from 'mongodb';
import {
    effectiveProblemKind,
    parseTeachType,
    readExamAttemptLimit,
    readExamPaperQuotas,
    readExamPassScore,
    TEACH_TYPES,
    type ProblemKind,
    type TeachType,
} from '@hydrooj/common';
import { Logger, Time } from '@hydrooj/utils';
import {
    localizeError,
    localizedErrorText,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import * as document from '../model/document';
import problem, { type ProblemDoc } from '../model/problem';
import * as training from '../model/training';
import user from '../model/user';
import {
    canCreateTeachType,
    canManageTeachContainer,
    loadTeachContainer,
    type TeachActor,
    type TeachDoc,
} from './teach-access';
import { readCopiedFrom, readSchoolShared } from './teach-fields';

const logger = new Logger('teach-copy');
const DELETED_PROBLEM_TITLE = '（题目已删除）';

export interface TeachCopyProblem {
    docId: number;
    pid: string;
    title: string;
    kind: ProblemKind;
}

export interface TeachCopyStage {
    id: number;
    title: string;
    requireIds: number[];
    pids: number[];
}

export type TeachCopySettings =
    | {
        kind: 'contest';
        rated: boolean;
        autoHide: boolean;
        hidden: boolean;
        lockMinutes: number | null;
        allowViewCode: boolean;
        allowPrint: boolean;
        keepScoreboardHidden: boolean;
        allowVirtual: boolean | null;
        allowPostContestPractice: boolean | null;
        allowPostContestView: boolean | null;
        allowPostContestSubmit: boolean | null;
        langs: string[];
        examShowVerdict: boolean | null;
        examPassScore: number | null;
        examAttemptLimit: number | null;
    }
    | {
        kind: 'homework';
        rated: boolean;
        langs: string[];
        extensionDays: number;
        penaltyRules: Record<string, number>;
    }
    | { kind: 'practice' };

export interface TeachCopySource {
    type: TeachType;
    id: string;
    title: string;
    content: string;
    description: string;
    ownerUid: number;
    ownerName: string;
    mine: boolean;
    rule: string;
    beginAt: string | null;
    endAt: string | null;
    durationMinutes: number | null;
    pids: number[];
    problems: TeachCopyProblem[];
    scores: Record<string, number>;
    examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
    stages: TeachCopyStage[] | null;
    settings: TeachCopySettings;
    unusablePids: number[];
}

export interface TeachCourseLink {
    courseId: string;
    chapterId: number;
}

export interface TeachNewPayload {
    canCreate: Record<TeachType, boolean>;
    initialType: TeachType | null;
    fromCourse: TeachCourseLink | null;
    copy: TeachCopySource | null;
}

function invalid(field: string, text: ReturnType<typeof localizedErrorText>): never {
    throw new ValidationError(field, null, text);
}

function missingContainer(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function rethrowType(error: unknown, code: string, field: string, text: ReturnType<typeof localizedErrorText>): never {
    if (error instanceof TypeError && error.message === code) invalid(field, text);
    throw error;
}

function positiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readDate(raw: unknown, field: string): Date {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    invalid(field, localizedErrorText`题目集的时间无效。`);
}

function readText(raw: unknown, field: string): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') invalid(field, localizedErrorText`题目集的文字内容无效。`);
    return raw;
}

function readTitle(raw: unknown): string {
    if (typeof raw !== 'string') invalid('title', localizedErrorText`题目集标题无效。`);
    return raw;
}

function readOwnerUid(raw: unknown): number {
    if (!positiveInt(raw)) invalid('owner', localizedErrorText`题目集的所有者无效。`);
    return raw;
}

function readFlag(raw: unknown, field: string): boolean {
    if (raw === undefined || raw === null) return false;
    if (typeof raw === 'boolean') return raw;
    invalid(field, localizedErrorText`题目集的设置无效。`);
}

function readTri(raw: unknown, field: string): boolean | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'boolean') return raw;
    invalid(field, localizedErrorText`题目集的设置无效。`);
}

function readLangs(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        invalid('langs', localizedErrorText`编程语言设置无效。`);
    }
    return raw.slice();
}

function readPids(raw: unknown): number[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.some((item) => !positiveInt(item))) invalid('pids', localizedErrorText`题目列表无效。`);
    return raw.slice();
}

function readScores(raw: unknown, pids: readonly number[]): Record<string, number> {
    if (raw === undefined || raw === null) return {};
    if (!isPlainObject(raw)) invalid('score', localizedErrorText`题目分数无效。`);
    const scores: Record<string, number> = {};
    for (const pid of pids) {
        const key = String(pid);
        if (!Object.hasOwn(raw, key)) continue;
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid('score', localizedErrorText`题目分数无效。`);
        scores[key] = value;
    }
    return scores;
}

function readPenaltyRules(raw: unknown): Record<string, number> {
    if (raw === undefined || raw === null) return {};
    if (!isPlainObject(raw)) invalid('penaltyRules', localizedErrorText`迟交扣分规则无效。`);
    const rules: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid('penaltyRules', localizedErrorText`迟交扣分规则无效。`);
        rules[key] = value;
    }
    return rules;
}

function readDurationMinutes(duration: unknown): number | null {
    if (duration === undefined || duration === null || duration === 0) return null;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        invalid('duration', localizedErrorText`个人限时无效。`);
    }
    const minutes = Math.round(duration * 60);
    if (!Number.isSafeInteger(minutes) || minutes <= 0) invalid('duration', localizedErrorText`个人限时无效。`);
    return minutes;
}

function readExtensionDays(endAt: Date, penaltySince: unknown): number {
    const since = readDate(penaltySince, 'penaltySince');
    const days = Math.round((endAt.getTime() - since.getTime()) / (Time.day / 100)) / 100;
    if (!Number.isFinite(days) || days < 0) invalid('extensionDays', localizedErrorText`允许迟交的天数无效。`);
    return days;
}

function readLockMinutes(endAt: Date, lockAt: unknown): number | null {
    if (lockAt === undefined || lockAt === null) return null;
    const lock = readDate(lockAt, 'lockAt');
    const ms = endAt.getTime() - lock.getTime();
    if (ms < 0 || ms % 60_000 !== 0) invalid('lockAt', localizedErrorText`封榜时间无效。`);
    return ms / 60_000;
}

function readPassScore(raw: unknown): number | null {
    try {
        return readExamPassScore({ examPassScore: raw });
    } catch (error) {
        rethrowType(error, 'exam_pass_score_invalid', 'examPassScore', localizedErrorText`考试的及格线无效。`);
    }
}

function readAttemptLimit(raw: unknown): number | null {
    if (raw === undefined || raw === null) return null;
    try {
        return readExamAttemptLimit({ examAttemptLimit: raw });
    } catch (error) {
        rethrowType(error, 'exam_attempt_limit_invalid', 'examAttemptLimit', localizedErrorText`考试的作答次数无效。`);
    }
}

function readQuotas(type: TeachType, raw: unknown): Partial<Record<ProblemKind, number>> | null {
    if (type !== 'exam') return null;
    try {
        return readExamPaperQuotas(raw);
    } catch (error) {
        rethrowType(error, 'exam_paper_quotas_invalid', 'examPaperQuotas', localizedErrorText`抽题设置无效。`);
    }
}

function readStages(raw: unknown): TeachCopyStage[] {
    if (!Array.isArray(raw)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
    return raw.map((node) => {
        if (!isRecord(node)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        const id = node._id;
        const { title, requireNids, pids } = node;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof title !== 'string') {
            invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        }
        if (!Array.isArray(requireNids) || requireNids.some((item) => typeof item !== 'number' || !Number.isSafeInteger(item))) {
            invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        }
        if (!Array.isArray(pids) || pids.some((item) => !positiveInt(item))) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        return {
            id,
            title,
            requireIds: requireNids.slice(),
            pids: pids.slice(),
        };
    });
}

function containerIdOf(doc: TeachDoc): ObjectId {
    if (doc._id instanceof ObjectId) return doc._id;
    invalid('id', localizedErrorText`题目集不存在。`);
}

function sharedForCopy(doc: TeachDoc): boolean {
    try {
        return readSchoolShared(doc.schoolShared) !== null;
    } catch (error) {
        rethrowType(error, 'teach_school_shared_invalid', 'schoolShared', localizedErrorText`学校共享数据无效。`);
    }
}

function storedCopiedFrom(doc: TeachDoc): ReturnType<typeof readCopiedFrom> {
    try {
        return readCopiedFrom(doc.copiedFrom);
    } catch (error) {
        rethrowType(error, 'teach_copied_from_invalid', 'copiedFrom', localizedErrorText`复制来源数据无效。`);
    }
}

export function canReadTeachCopy(actor: TeachActor, type: TeachType, doc: TeachDoc): boolean {
    if (canManageTeachContainer(actor, type, doc)) return true;
    return sharedForCopy(doc) && canCreateTeachType(actor, type);
}

interface SelectionActor extends TeachActor {
    _problemAclLoaded?: boolean;
    _pidNamespaceAclLoaded?: boolean;
    _problemAclDomainId?: string;
    _pidNamespaceAclDomainId?: string;
    _ownsLegacyProblems?: boolean;
    _authoredPids?: Set<number>;
    _maintainedPids?: Set<number>;
    _aclFencedPids?: Set<number>;
    _pidNamespaceManagerIds?: Set<string>;
    _pidNamespaceEditAllIds?: Set<string>;
}

const DENY_ALL_PROBLEMS: Filter<ProblemDoc> = { docId: { $in: [] } };

function sortedIds(values?: Set<number>): number[] {
    return Array.from(values || []).sort((left, right) => left - right);
}

function selectionActor(actor: TeachActor): SelectionActor {
    return actor as SelectionActor;
}

/**
 * Same filter as buildProblemContainerSelectionScope (contributions off, school bank on).
 * Importing that module also loads the database and the Hydro loader, which this request path must not boot.
 */
function containerSelectionScope(actor: SelectionActor): Filter<ProblemDoc> {
    const fenced = sortedIds(actor._aclFencedPids);
    if (actor._problemAclLoaded !== true) return { ...DENY_ALL_PROBLEMS };
    const liveLockExclusion: Filter<ProblemDoc> = { 'aclMutationLocks.uid': { $ne: actor._id } } as Filter<ProblemDoc>;
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
        return fenced.length ? { $and: [{ docId: { $nin: fenced } }, liveLockExclusion] } : liveLockExclusion;
    }
    const canBrowse = actor._pidNamespaceAclLoaded === true
        && actor._problemAclDomainId === actor._pidNamespaceAclDomainId
        && (
            actor.hasPerm(PERM.PERM_VIEW_PROBLEM_BANK)
            || actor.hasPerm(PERM.PERM_CREATE_PROBLEM)
            || actor.hasPerm(PERM.PERM_CREATE_PROGRAMMING_DRAFT)
            || actor._ownsLegacyProblems === true
            || (actor._authoredPids?.size || 0) > 0
            || (actor._maintainedPids?.size || 0) > 0
            || (actor._pidNamespaceManagerIds?.size || 0) > 0
            || (actor._pidNamespaceEditAllIds?.size || 0) > 0
        );
    if (!canBrowse) return { ...DENY_ALL_PROBLEMS };
    const maintained = sortedIds(new Set(sortedIds(actor._maintainedPids).filter((pid) => !actor._aclFencedPids?.has(pid))));
    const authored = sortedIds(new Set(sortedIds(actor._authoredPids).filter((pid) => !actor._aclFencedPids?.has(pid))));
    const managerNamespaceIds = Array.from(actor._pidNamespaceManagerIds || []).sort();
    const editAllNamespaceIds = Array.from(actor._pidNamespaceEditAllIds || []).sort();
    const authorScopes: Filter<ProblemDoc>[] = [];
    if (actor.hasPerm(PERM.PERM_CREATE_PROBLEM) || actor._ownsLegacyProblems === true) {
        authorScopes.push({ $and: [{ owner: actor._id }, { authoringMode: { $ne: 'managed' } }] });
    }
    if (maintained.length) {
        const maintainedScope: Filter<ProblemDoc>[] = [{ docId: { $in: maintained } }, { maintainer: actor._id }];
        if (!actor.hasPerm(PERM.PERM_CREATE_PROBLEM)) maintainedScope.push({ authoringMode: 'managed' });
        authorScopes.push({ $and: maintainedScope });
    }
    if (authored.length) {
        authorScopes.push({ $and: [{ docId: { $in: authored } }, { authoringMode: 'managed' }] });
    }
    if (editAllNamespaceIds.length) authorScopes.push({ pidNamespaceId: { $in: editAllNamespaceIds } });
    if (managerNamespaceIds.length) {
        authorScopes.push({
            pidNamespaceId: { $in: managerNamespaceIds },
            authoringMode: 'managed',
            hidden: true,
            archivedAt: { $exists: false },
            'managedAuthoring.metadataStatus': { $in: ['draft', 'confirmed'] },
        });
    }
    if (actor.hasPerm(PERM.PERM_VIEW_PROBLEM_BANK) && actor.hasPerm(PERM.PERM_CREATE_PROBLEM)) {
        authorScopes.push({ hidden: { $ne: true } });
        authorScopes.push({ 'schoolBank.sharedAt': { $exists: true } } as Filter<ProblemDoc>);
    }
    if (!authorScopes.length) {
        if (!actor.hasPerm(PERM.PERM_VIEW_PROBLEM_BANK)) return { ...DENY_ALL_PROBLEMS };
        const publicCatalog: Filter<ProblemDoc> = { hidden: { $ne: true } };
        return fenced.length
            ? { $and: [publicCatalog, { docId: { $nin: fenced } }, liveLockExclusion] }
            : { $and: [publicCatalog, liveLockExclusion] };
    }
    const authorScope: Filter<ProblemDoc> = authorScopes.length === 1 ? authorScopes[0] : { $or: authorScopes };
    return fenced.length
        ? { $and: [authorScope, { docId: { $nin: fenced } }, liveLockExclusion] }
        : { $and: [authorScope, liveLockExclusion] };
}

async function loadProblemRows(domainId: string, pids: readonly number[]): Promise<Map<number, Record<string, unknown>>> {
    const found = new Map<number, Record<string, unknown>>();
    if (!pids.length) return found;
    const rows = await document.getMulti(domainId, document.TYPE_PROBLEM, { docId: { $in: [...new Set(pids)] } }).toArray();
    for (const row of rows) {
        if (!isRecord(row) || !positiveInt(row.docId)) invalid('docId', localizedErrorText`题目数据无效。`);
        found.set(row.docId, row);
    }
    return found;
}

async function reloadCopiedProblemAcl(actor: SelectionActor, domainId: string): Promise<void> {
    // Unit tests replace the whole problem model and already attach an ACL snapshot.
    // Production ProblemModel always has both methods; call them before the scope find.
    const model: {
        refreshProblemAcl?: (user: SelectionActor, authoritativeDomainId: string) => Promise<void>;
        assertProblemAclDomain?: (user: SelectionActor, authoritativeDomainId: string) => void;
    } = problem;
    if (typeof model.refreshProblemAcl !== 'function' || typeof model.assertProblemAclDomain !== 'function') return;
    await model.refreshProblemAcl(actor, domainId);
    model.assertProblemAclDomain(actor, domainId);
}

async function loadUsableDocIds(domainId: string, actor: TeachActor, pids: readonly number[]): Promise<Set<number>> {
    const usable = new Set<number>();
    if (!pids.length) return usable;
    const selected = selectionActor(actor);
    await reloadCopiedProblemAcl(selected, domainId);
    const scope = containerSelectionScope(selected);
    const query: Filter<ProblemDoc> = {
        $and: [scope, { docId: { $in: [...new Set(pids)] } }, { archivedAt: { $exists: false } }],
    };
    const rows = await document.getMulti(domainId, document.TYPE_PROBLEM, query).toArray();
    for (const row of rows) {
        if (!isRecord(row) || !positiveInt(row.docId)) invalid('docId', localizedErrorText`题目数据无效。`);
        usable.add(row.docId);
    }
    return usable;
}

function problemKindOf(row: Record<string, unknown>): ProblemKind {
    try {
        return effectiveProblemKind(row);
    } catch (error) {
        if (error instanceof TypeError) invalid('problemKind', localizedErrorText`题目的题型无效。`);
        throw error;
    }
}

function problemFace(domainId: string, type: TeachType, id: string, docId: number, row: Record<string, unknown> | undefined): TeachCopyProblem {
    if (!row) {
        logger.error('Teach copy problem missing domain=%s type=%s id=%s docId=%d', domainId, type, id, docId);
        return {
            docId,
            pid: '',
            title: DELETED_PROBLEM_TITLE,
            kind: 'programming',
        };
    }
    if (typeof row.pid !== 'string') invalid('pid', localizedErrorText`题目的题号无效。`);
    if (typeof row.title !== 'string') invalid('title', localizedErrorText`题目的标题无效。`);
    return {
        docId,
        pid: row.pid,
        title: row.title,
        kind: problemKindOf(row),
    };
}

async function ownerNameOf(domainId: string, ownerUid: number): Promise<string> {
    const udoc: unknown = await user.getById(domainId, ownerUid);
    if (!isRecord(udoc) || udoc._id !== ownerUid || typeof udoc.uname !== 'string' || !udoc.uname) {
        invalid('owner', localizedErrorText`题目集的所有者无效。`);
    }
    return udoc.uname;
}

function contestSettings(rule: string, doc: Tdoc, endAt: Date): TeachCopySettings {
    return {
        kind: 'contest',
        rated: readFlag(doc.rated, 'rated'),
        autoHide: readFlag(doc.autoHide, 'autoHide'),
        hidden: readFlag(doc.hidden, 'hidden'),
        lockMinutes: readLockMinutes(endAt, doc.lockAt),
        allowViewCode: readFlag(doc.allowViewCode, 'allowViewCode'),
        allowPrint: readFlag(doc.allowPrint, 'allowPrint'),
        keepScoreboardHidden: readFlag(doc.keepScoreboardHidden, 'keepScoreboardHidden'),
        allowVirtual: readTri(doc.allowVirtual, 'allowVirtual'),
        allowPostContestPractice: readTri(doc.allowPostContestPractice, 'allowPostContestPractice'),
        allowPostContestView: readTri(doc.allowPostContestView, 'allowPostContestView'),
        allowPostContestSubmit: readTri(doc.allowPostContestSubmit, 'allowPostContestSubmit'),
        langs: readLangs(doc.langs),
        examShowVerdict: rule === 'exam' ? readTri(doc.examShowVerdict, 'examShowVerdict') : null,
        examPassScore: rule === 'exam' ? readPassScore(doc.examPassScore) : null,
        examAttemptLimit: rule === 'exam' ? readAttemptLimit(doc.examAttemptLimit) : null,
    };
}

function homeworkSettings(doc: Tdoc, endAt: Date): TeachCopySettings {
    return {
        kind: 'homework',
        rated: readFlag(doc.rated, 'rated'),
        langs: readLangs(doc.langs),
        extensionDays: readExtensionDays(endAt, doc.penaltySince),
        penaltyRules: readPenaltyRules(doc.penaltyRules),
    };
}

export async function buildTeachCopySource(domainId: string, actor: TeachActor, type: TeachType, doc: TeachDoc): Promise<TeachCopySource> {
    const id = containerIdOf(doc);
    const idText = id.toHexString();
    const title = readTitle(doc.title);
    const ownerUid = readOwnerUid(doc.owner);
    const contestDoc = doc as Tdoc;
    const practice = type === 'practice';
    const stages = practice ? readStages((doc as TrainingDoc).dag) : null;
    const pids = stages ? stages.flatMap((stage) => stage.pids) : readPids(contestDoc.pids);
    const rule = practice ? 'problem_set' : contestDoc.rule;
    if (!practice && (typeof rule !== 'string' || !rule)) invalid('rule', localizedErrorText`题目集的赛制无效。`);
    const begin = practice ? null : readDate(contestDoc.beginAt, 'beginAt');
    const end = practice ? null : readDate(contestDoc.endAt, 'endAt');
    if (begin && end && end.getTime() <= begin.getTime()) invalid('endAt', localizedErrorText`结束时间必须晚于开始时间。`);
    const [ownerName, faces, usable] = await Promise.all([
        ownerNameOf(domainId, ownerUid),
        loadProblemRows(domainId, pids),
        loadUsableDocIds(domainId, actor, pids),
    ]);
    const problems = pids.map((docId) => problemFace(domainId, type, idText, docId, faces.get(docId)));
    const settings = practice
        ? { kind: 'practice' as const }
        : type === 'homework'
            ? homeworkSettings(contestDoc, end as Date)
            : contestSettings(rule as string, contestDoc, end as Date);
    return {
        type,
        id: idText,
        title,
        content: readText(doc.content, 'content'),
        description: practice ? readText((doc as TrainingDoc).description, 'description') : '',
        ownerUid,
        ownerName,
        mine: ownerUid === actor._id,
        rule: rule as string,
        beginAt: begin ? begin.toISOString() : null,
        endAt: end ? end.toISOString() : null,
        durationMinutes: practice ? null : readDurationMinutes(contestDoc.duration),
        pids,
        problems,
        scores: practice ? readScores(undefined, pids) : readScores(contestDoc.score, pids),
        examPaperQuotas: readQuotas(type, contestDoc.examPaperQuotas),
        stages,
        settings,
        unusablePids: pids.filter((docId) => !usable.has(docId)),
    };
}

export async function loadTeachCopySource(domainId: string, actor: TeachActor, type: TeachType, id: ObjectId): Promise<TeachCopySource> {
    const doc = await loadTeachContainer(domainId, type, id);
    if (!canReadTeachCopy(actor, type, doc)) missingContainer();
    return buildTeachCopySource(domainId, actor, type, doc);
}

function copiedFromValue(sourceType: TeachType, sourceId: ObjectId, title: string, ownerUid: number, copiedBy: number, copiedAt: Date) {
    return {
        type: sourceType,
        id: sourceId,
        title,
        ownerUid,
        copiedBy,
        copiedAt,
    };
}

export async function recordTeachProvenance(
    domainId: string,
    actor: TeachActor,
    type: TeachType,
    targetId: ObjectId,
    sourceType: TeachType,
    sourceId: ObjectId,
): Promise<void> {
    const target = await loadTeachContainer(domainId, type, targetId);
    if (!canManageTeachContainer(actor, type, target)) {
        throw localizeError(new PermissionError(), '你不能管理这个题目集。');
    }
    if (storedCopiedFrom(target)) invalid('copiedFrom', localizedErrorText`这个题目集已经记录过来源`);
    if (sourceType !== type) invalid('sourceType', localizedErrorText`只能从同一种类型的题目集复制。`);
    const source = await loadTeachContainer(domainId, sourceType, sourceId);
    if (!canReadTeachCopy(actor, sourceType, source)) missingContainer();
    const title = readTitle(source.title);
    const ownerUid = readOwnerUid(source.owner);
    const copiedAt = new Date();
    const copiedFrom = copiedFromValue(sourceType, sourceId, title, ownerUid, actor._id, copiedAt);
    const updated = type === 'practice'
        ? await training.edit(domainId, targetId, { copiedFrom })
        : await document.set(domainId, document.TYPE_CONTEST, targetId, { copiedFrom });
    const written = storedCopiedFrom(isRecord(updated) ? updated as TeachDoc : target);
    if (!written || !written.id.equals(sourceId) || written.copiedBy !== actor._id) {
        logger.error('Teach provenance write missing domain=%s uid=%d target=%s source=%s', domainId, actor._id, targetId.toHexString(), sourceId.toHexString());
        invalid('copiedFrom', localizedErrorText`复制来源没有写上。`);
    }
    logger.info(
        'Teach provenance domain=%s uid=%d target=%s sourceType=%s source=%s result=written',
        domainId,
        actor._id,
        targetId.toHexString(),
        sourceType,
        sourceId.toHexString(),
    );
}

export function canCreateMap(actor: TeachActor): Record<TeachType, boolean> {
    return {
        practice: canCreateTeachType(actor, 'practice'),
        homework: canCreateTeachType(actor, 'homework'),
        exam: canCreateTeachType(actor, 'exam'),
        acm: canCreateTeachType(actor, 'acm'),
        oi: canCreateTeachType(actor, 'oi'),
    };
}

function queryString(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') invalid(field, localizedErrorText`请求参数无效。`);
    return value;
}

function optionalTeachType(value: unknown): TeachType | null {
    const text = queryString(value, 'type');
    if (text === null) return null;
    try {
        return parseTeachType(text);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') return null;
        throw error;
    }
}

function readFromCourse(rawType: unknown, fromCourse: unknown, chapter: unknown): TeachCourseLink | null {
    if (rawType !== 'homework') return null;
    const courseText = queryString(fromCourse, 'fromCourse');
    const chapterText = queryString(chapter, 'chapter');
    if (courseText === null && chapterText === null) return null;
    if (courseText === null) invalid('fromCourse', localizedErrorText`课程测验参数不完整。`);
    if (chapterText === null) invalid('chapter', localizedErrorText`课程测验参数不完整。`);
    if (!/^[0-9a-f]{24}$/i.test(courseText)) invalid('fromCourse', localizedErrorText`课程编号无效。`);
    if (!/^[1-9][0-9]*$/.test(chapterText)) invalid('chapter', localizedErrorText`章节编号无效。`);
    const chapterId = Number(chapterText);
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) invalid('chapter', localizedErrorText`章节编号无效。`);
    return { courseId: new ObjectId(courseText).toHexString(), chapterId };
}

function readCopyRef(raw: unknown): { type: TeachType; id: ObjectId } | null {
    const text = queryString(raw, 'copy');
    if (text === null) return null;
    const split = text.indexOf(':');
    if (split <= 0) invalid('copy', localizedErrorText`复制来源的格式无效。`);
    const typeText = text.slice(0, split);
    const idText = text.slice(split + 1);
    let type: TeachType;
    try {
        type = parseTeachType(typeText);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') invalid('copy', localizedErrorText`复制来源的格式无效。`);
        throw error;
    }
    if (!/^[0-9a-f]{24}$/i.test(idText)) invalid('copy', localizedErrorText`复制来源的格式无效。`);
    return { type, id: new ObjectId(idText) };
}

export async function buildTeachNewPayload(domainId: string, actor: TeachActor, query: Record<string, unknown>): Promise<TeachNewPayload> {
    const canCreate = canCreateMap(actor);
    if (!TEACH_TYPES.some((type) => canCreate[type])) {
        throw localizeError(new PermissionError(), '你不能新建题目集。');
    }
    const requested = optionalTeachType(query.type);
    const copyRef = readCopyRef(query.copy);
    return {
        canCreate,
        initialType: requested && canCreate[requested] ? requested : null,
        fromCourse: readFromCourse(query.type, query.fromCourse, query.chapter),
        copy: copyRef ? await loadTeachCopySource(domainId, actor, copyRef.type, copyRef.id) : null,
    };
}
