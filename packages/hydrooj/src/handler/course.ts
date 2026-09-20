/**
 * 课程模块（PLAN 2026-07-02 §10）。
 *
 * 课程与题集共用 docType 40（TrainingDoc），靠 `kind: 'course'` 区分；
 * 复用 training model 的报名 / 进度 / 章节题目跟踪。课程额外有：
 *   - `courseGroupIds`：可见范围（userbind 班级；空 = 全域可见）
 *   - `courseHidden`：对学生隐藏（缺省可见）
 *   - `courseExam`：可选结业考试绑定（一门课一场 exam；复制不带绑定）
 *   - 章节 `tids`：引用制挂已有比赛/作业（比赛在比赛模块独立创建）
 *   - `term`：学期等元信息
 *
 * 章节结构是线性目录（DAG requireNids 始终为空，前端编辑器只做线性）。
 * 每章可再挂线性小节；题目可落在章或小节，练习范围仍是章。
 * 权限：查看 PERM_VIEW_TRAINING；建/改 PERM_CREATE_COURSE / PERM_EDIT_COURSE。
 */
import assert from 'assert';
import { escapeRegExp, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import {
    ContestNotFoundError,
    localizeErrorParameter,
    localizedErrorText,
    FileLimitExceededError,
    FileUploadError,
    HydroError,
    NotFoundError,
    PermissionError,
    TrainingNotFoundError,
    ValidationError,
} from '../error';
import { TrainingDoc, TrainingNode } from '../interface';
import { PERM, PRIV, STATUS } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import { deleteCourseVideoProgress, loadUserCourseProgress } from '../model/course-video-progress';
import * as contest from '../model/contest';
import * as oplog from '../model/oplog';
import { practiceIntegrityService } from '../model/practice-integrity';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';
import { assertCourseAccessible, canManageCourse, courseAssignsUserGroups, courseUserGroupIds, isCourseHidden } from '../lib/course-access';
import { isCourseExamCompleteFromStatus } from '../lib/course-exam-complete';
import { courseExamRosterFactsByUid, courseExamRosterMeta } from '../lib/course-exam-roster';
import {
    canRetakeExamPaper,
    examAttemptScore,
    examAttemptsUsed,
    isExamAttemptJudgePending,
    isExamAttemptPassed,
    readExamAttemptLimit,
    readExamPassScore,
} from '../lib/exam-paper';
import { isCourseExamDuplicateKey, parseCourseExamForm, resolveCourseExamForSave } from '../lib/course-exam';
import { courseNodePids, parseCourseSections } from '../lib/course-chapter';
import { copiedCourseTitle } from '../lib/course-copy';
import {
    parseCourseVideos,
    reconcileCourseDagVideos,
    rewriteCourseVideosForCopy,
    courseVideoStoragePath,
    studentVisibleVideos,
    courseUnitProgress,
    isCourseVideoComplete,
} from '../lib/course-video';
import { liveReferencedPids } from '../lib/course-live-ref';
import { resolveProblemKnowledgeNodeIds } from '../lib/problem-tag-canonical';
import { courseKindClause, isCourseKind, isProblemSetKind } from '../lib/training-kind';
import { computePrerequisiteClosure } from '../lib/problem-set-stage';
import { problemSetAccessService } from '../model/problem-set-access';
import { getVisibleReferencedProblems, normalizeProblemDocIds } from './problem-reference';
import { loadCompletedPidsByUid } from '../lib/practice-roster-load';
import {
    assemblePracticeRosterMembers,
    PRACTICE_ROSTER_ENROLL_LIMIT,
    serializePracticeRosterProblems,
    uniqueBoundUserIds,
} from '../lib/practice-roster';

const logger = new Logger('course');

function canAssignCourse(actor: { hasPerm: (...perm: bigint[]) => boolean; hasPriv: (priv: number) => boolean }) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_EDIT_COURSE);
}

function canCreateCourse(actor: { hasPerm: (...perm: bigint[]) => boolean; hasPriv: (priv: number) => boolean }) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_CREATE_COURSE);
}

function canCreateCourseQuiz(actor: { hasPerm: (...perm: bigint[]) => boolean; hasPriv: (priv: number) => boolean }) {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_CREATE_HOMEWORK);
}

async function hydrateCourseExamContest(
    domainId: string,
    tdoc?: Pick<TrainingDoc, 'courseExam'>,
    uid?: number,
): Promise<{
    docId: string;
    title: string;
    endAt?: string;
    beginAt?: string;
    startAt?: string;
    paperFinalizedAt?: string;
    duration?: number;
    attend?: boolean;
    complete?: boolean;
    missing?: boolean;
    examPassScore?: number;
    examAttemptLimit?: number;
    examAttemptsUsed?: number;
    examScore?: number;
    examJudging?: boolean;
    examPassed?: boolean;
    canRetake?: boolean;
} | undefined> {
    const contestId = tdoc?.courseExam?.contestId;
    if (!contestId) return undefined;
    const docId = contestId instanceof ObjectId ? contestId.toHexString() : String(contestId);
    let oid: ObjectId;
    try {
        oid = contestId instanceof ObjectId ? contestId : new ObjectId(docId);
    } catch {
        return { docId, title: '', missing: true };
    }
    try {
        const cdoc = await contest.get(domainId, oid);
        const endAt = cdoc.endAt instanceof Date && !Number.isNaN(cdoc.endAt.getTime())
            ? cdoc.endAt.toISOString()
            : undefined;
        const beginAt = cdoc.beginAt instanceof Date && !Number.isNaN(cdoc.beginAt.getTime())
            ? cdoc.beginAt.toISOString()
            : undefined;
        const duration = typeof cdoc.duration === 'number' && cdoc.duration > 0
            ? cdoc.duration
            : undefined;
        let attend = false;
        let startAt: string | undefined;
        let paperFinalizedAt: string | undefined;
        let complete = false;
        let tsdoc: Awaited<ReturnType<typeof contest.getStatus>> | null = null;
        if (typeof uid === 'number' && uid > 0) {
            tsdoc = await contest.getStatus(domainId, oid, uid);
            attend = Boolean(tsdoc?.attend);
            if (tsdoc?.startAt instanceof Date && !Number.isNaN(tsdoc.startAt.getTime())) {
                startAt = tsdoc.startAt.toISOString();
            }
            if (tsdoc?.paperFinalizedAt instanceof Date && !Number.isNaN(tsdoc.paperFinalizedAt.getTime())) {
                paperFinalizedAt = tsdoc.paperFinalizedAt.toISOString();
            }
            complete = isCourseExamCompleteFromStatus(cdoc, tsdoc);
        }
        const passScore = readExamPassScore(cdoc);
        const attemptLimit = readExamAttemptLimit(cdoc);
        const attemptsUsed = tsdoc ? examAttemptsUsed(tsdoc) : 0;
        const judging = Boolean(paperFinalizedAt) && isExamAttemptJudgePending(tsdoc);
        const passed = isExamAttemptPassed(cdoc, tsdoc);
        const canRetake = typeof uid === 'number' && uid > 0 && canRetakeExamPaper(cdoc, tsdoc, new Date());
        return {
            docId,
            title: typeof cdoc.title === 'string' ? cdoc.title : '',
            ...(endAt ? { endAt } : {}),
            ...(beginAt ? { beginAt } : {}),
            ...(startAt ? { startAt } : {}),
            ...(paperFinalizedAt ? { paperFinalizedAt } : {}),
            ...(complete ? { complete: true } : {}),
            ...(duration ? { duration } : {}),
            ...(attend ? { attend: true } : {}),
            ...(passScore !== null ? { examPassScore: passScore } : {}),
            ...(attemptLimit > 1 ? { examAttemptLimit: attemptLimit } : {}),
            ...(attemptsUsed > 0 ? { examAttemptsUsed: attemptsUsed } : {}),
            ...(paperFinalizedAt ? { examScore: examAttemptScore(tsdoc) } : {}),
            ...(judging ? { examJudging: true } : {}),
            ...(passed ? { examPassed: true } : {}),
            ...(canRetake ? { canRetake: true } : {}),
        };
    } catch (error) {
        if (error instanceof ContestNotFoundError || (error instanceof Error && error.name === 'ContestNotFoundError')) {
            return { docId, title: '', missing: true };
        }
        throw error;
    }
}

async function loadCourseExamRoster(
    domainId: string,
    contestId: ObjectId,
    memberUids: readonly number[],
): Promise<{
    meta?: ReturnType<typeof courseExamRosterMeta>;
    facts?: ReturnType<typeof courseExamRosterFactsByUid>;
    warning?: string;
}> {
    let examDoc: Awaited<ReturnType<typeof contest.get>>;
    try {
        examDoc = await contest.get(domainId, contestId);
    } catch (error) {
        if (error instanceof ContestNotFoundError || (error instanceof Error && error.name === 'ContestNotFoundError')) {
            logger.error(
                'Course roster found missing courseExam contest domain=%s contest=%s error=%s',
                domainId,
                contestId,
                error instanceof Error ? error.message : error,
            );
            return { warning: '结业考试已不存在，名单不显示考试分数。' };
        }
        throw error;
    }
    if (examDoc.rule !== 'exam') {
        logger.error(
            'Course roster found non-exam courseExam binding domain=%s contest=%s rule=%s',
            domainId,
            contestId,
            examDoc.rule,
        );
        return { warning: '结业考试绑定已损坏，名单不显示考试分数。' };
    }
    const examStatuses = memberUids.length
        ? await contest.getMultiStatus(domainId, { docId: examDoc.docId, uid: { $in: [...memberUids] } }).toArray()
        : [];
    return {
        meta: courseExamRosterMeta(examDoc),
        facts: courseExamRosterFactsByUid(examDoc, memberUids, examStatuses),
    };
}

function isStaleReferencedProblemSetError(error: unknown): boolean {
    if (error instanceof TrainingNotFoundError || error instanceof ValidationError) return true;
    return error instanceof Error && (error.name === 'TrainingNotFoundError' || error.name === 'ValidationError');
}

async function liveReferencedPidsForCourseGet(
    domainId: string,
    tid: ObjectId,
    node: TrainingNode,
): Promise<{ pids: number[]; stale: boolean }> {
    if (!node.problemSetId) return { pids: [], stale: false };
    try {
        return { pids: await liveReferencedPids(domainId, node), stale: false };
    } catch (error) {
        if (isStaleReferencedProblemSetError(error)) {
            logger.error(
                'Course detail found unavailable problem-set reference domain=%s tid=%s chapter=%s problemSetId=%s error=%s',
                domainId,
                tid,
                node._id,
                String(node.problemSetId),
                error instanceof Error ? error.message : error,
            );
            return { pids: [], stale: true };
        }
        throw error;
    }
}

function courseChapterEditorPayload(tdoc: TrainingDoc) {
    return (tdoc.dag || []).map((node) => ({
        _id: node._id,
        title: node.title,
        content: node.content || '',
        pids: node.pids,
        sections: node.sections || [],
        tids: (node.tids || []).map((item) => String(item)),
        problemSetId: node.problemSetId ? String(node.problemSetId) : '',
        stageIds: node.stageIds || [],
        ...(node.videos?.length ? { videos: node.videos } : {}),
    }));
}

function serializeCourseAssignUser(udoc: {
    _id?: unknown;
    uname?: unknown;
    displayName?: unknown;
    mail?: unknown;
    avatarUrl?: unknown;
    studentId?: unknown;
    realName?: unknown;
}) {
    const uid = Number(udoc._id);
    if (!Number.isSafeInteger(uid) || uid < 1) throw new TypeError('course assign user uid must be a positive integer');
    return {
        _id: uid,
        ...(typeof udoc.uname === 'string' && udoc.uname ? { uname: udoc.uname } : {}),
        ...(typeof udoc.displayName === 'string' && udoc.displayName ? { displayName: udoc.displayName } : {}),
        ...(typeof udoc.mail === 'string' && udoc.mail ? { mail: udoc.mail } : {}),
        ...(typeof udoc.avatarUrl === 'string' && udoc.avatarUrl ? { avatarUrl: udoc.avatarUrl } : {}),
        ...(typeof udoc.studentId === 'string' && udoc.studentId ? { studentId: udoc.studentId } : {}),
        ...(typeof udoc.realName === 'string' && udoc.realName ? { realName: udoc.realName } : {}),
    };
}

function courseAssignUserView(udict: Record<string, { _id?: unknown }>, uid: number) {
    const loaded = udict[uid];
    if (loaded && Number(loaded._id) === uid) return serializeCourseAssignUser(loaded);
    return { _id: uid, uname: `UID ${uid}` };
}

async function loadCourseAssignUsers(domainId: string, uids: number[]) {
    const unique = [...new Set(uids.filter((uid) => Number.isSafeInteger(uid) && uid >= 1))];
    if (!unique.length) return {};
    const udict = await user.getList(domainId, unique);
    const views: Record<string, ReturnType<typeof serializeCourseAssignUser>> = {};
    for (const uid of unique) views[String(uid)] = courseAssignUserView(udict, uid);
    return views;
}

interface CourseMindmapService {
    getPublicMap(id: ObjectId | string): Promise<any | null>;
    getPublicSnapshot(id: ObjectId | string): Promise<{ config: any; nodes: any[] } | null>;
    listPublicMaps(): Promise<any[]>;
}

function courseMindmapService(): CourseMindmapService {
    const service = (global as any).Hydro?.model?.mindmap;
    if (
        typeof service?.getPublicMap !== 'function' ||
        typeof service?.getPublicSnapshot !== 'function' ||
        typeof service?.listPublicMaps !== 'function'
    ) {
        logger.error('Course mindmap service unavailable');
        throw new TypeError('mindmap model service is unavailable');
    }
    return service;
}

function storedObjectIdString(value: unknown, field: string): string {
    let id: string;
    if (typeof value === 'string') id = value;
    else if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
        id = String((value as { toHexString(): string }).toHexString());
    } else {
        throw new TypeError(`${field} must be an ObjectId`);
    }
    if (!ObjectId.isValid(id) || new ObjectId(id).toHexString() !== id.toLowerCase()) {
        throw new TypeError(`${field} must be a canonical ObjectId`);
    }
    return id.toLowerCase();
}

function storedOptionalObjectIdString(value: unknown, field: string): string | null {
    return value === undefined || value === null ? null : storedObjectIdString(value, field);
}

function serializedDate(value: unknown, field: string): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
    return date.toISOString();
}

function serializeCourseMindmapOption(map: any) {
    return {
        _id: storedObjectIdString(map?._id, 'mindmap._id'),
        title: String(map?.title || ''),
        visibility: map?.visibility,
    };
}

async function listCourseMindmapOptions() {
    const maps = await courseMindmapService().listPublicMaps();
    if (!Array.isArray(maps)) throw new TypeError('mindmap public-map list must be an array');
    return maps.map((map) => {
        const option = serializeCourseMindmapOption(map);
        if (!option.title || option.visibility !== 'public') throw new TypeError(`invalid public mindmap option map=${option._id}`);
        return option;
    });
}

async function resolveCourseMindmapId(domainId: string, tid: ObjectId | null, actor: number, raw: string): Promise<ObjectId | null> {
    const requested = raw.trim();
    if (!requested) return null;
    if (!ObjectId.isValid(requested) || new ObjectId(requested).toHexString() !== requested.toLowerCase()) {
        logger.warn('Course mindmap binding rejected domain=%s tid=%s actor=%d requested=%s reason=invalid-id', domainId, tid || 'new', actor, raw);
        throw new ValidationError('mindmapId', null, localizedErrorText`知识导图 id 无效`);
    }
    const mindmapId = new ObjectId(requested);
    const map = await courseMindmapService().getPublicMap(mindmapId);
    if (!map) {
        logger.warn(
            'Course mindmap binding rejected domain=%s tid=%s actor=%d requested=%s reason=not-public-or-missing',
            domainId,
            tid || 'new',
            actor,
            mindmapId,
        );
        throw new ValidationError('mindmapId', null, localizedErrorText`只能绑定真实且已公开的知识导图`);
    }
    if (storedObjectIdString(map._id, 'mindmap._id') !== mindmapId.toHexString() || map.visibility !== 'public') {
        throw new TypeError(`mindmap service returned mismatched public map requested=${mindmapId}`);
    }
    return mindmapId;
}

function serializeCourseMindmapSnapshot(snapshot: { config: any; nodes: any[] }, expectedMapId: string) {
    const configId = storedObjectIdString(snapshot.config?._id, 'mindmap.config._id');
    if (configId !== expectedMapId || snapshot.config?.visibility !== 'public') {
        throw new TypeError(`mindmap snapshot mismatch expected=${expectedMapId} actual=${configId}`);
    }
    if (!Array.isArray(snapshot.nodes)) throw new TypeError(`mindmap snapshot nodes must be an array map=${expectedMapId}`);
    const nodes = snapshot.nodes.map((node, index) => {
        const nodeId = storedObjectIdString(node?._id, `mindmap.nodes[${index}]._id`);
        const mapId = storedObjectIdString(node?.mapId, `mindmap.nodes[${index}].mapId`);
        if (mapId !== expectedMapId) throw new TypeError(`mindmap snapshot contains cross-map node map=${expectedMapId} node=${nodeId}`);
        return {
            _id: nodeId,
            mapId,
            parentId: node.parentId === null ? null : storedObjectIdString(node.parentId, `mindmap.nodes[${index}].parentId`),
            topic: String(node.topic || ''),
            ...(node.description ? { description: String(node.description) } : {}),
            ...(node.color ? { color: String(node.color) } : {}),
            ...(node.layoutSide === 'left' || node.layoutSide === 'right' ? { layoutSide: node.layoutSide } : {}),
            tags: [],
            problemIds: [],
            order: Number(node.order),
            createdAt: serializedDate(node.createdAt, `mindmap.nodes[${index}].createdAt`),
            updatedAt: serializedDate(node.updatedAt, `mindmap.nodes[${index}].updatedAt`),
        };
    });
    return {
        config: {
            _id: configId,
            title: String(snapshot.config.title || ''),
            rootNodeId: storedObjectIdString(snapshot.config.rootNodeId, 'mindmap.config.rootNodeId'),
            visibility: 'public' as const,
            layoutDirection: snapshot.config.layoutDirection,
            createdAt: serializedDate(snapshot.config.createdAt, 'mindmap.config.createdAt'),
            updatedAt: serializedDate(snapshot.config.updatedAt, 'mindmap.config.updatedAt'),
        },
        nodes,
    };
}

async function buildCourseMindmapView(
    domainId: string,
    tdoc: TrainingDoc,
    pids: number[],
    currentUser: any,
    referencedPidsByChapter: Map<number, number[]>,
) {
    const expectedMapId = storedObjectIdString(tdoc.mindmapId, 'course.mindmapId');
    const snapshot = await courseMindmapService().getPublicSnapshot(expectedMapId);
    if (!snapshot) {
        logger.error('Course mindmap binding is unavailable domain=%s tid=%s map=%s', domainId, tdoc.docId, expectedMapId);
        return null;
    }
    const serialized = serializeCourseMindmapSnapshot(snapshot, expectedMapId);
    const nodeIds = new Set(serialized.nodes.map((node) => node._id));
    const projection = [...problem.PROJECTION_LIST, 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring'] as any;
    const visible = await problem.getListViewableAuthorized(domainId, pids, currentUser, projection, false, true);
    const problems: Array<{
        domainId: string;
        docId: number;
        pid: string;
        title: string;
        nodeIds: string[];
        chapters: Array<{ id: number; title: string }>;
    }> = [];
    const usedNodeIds = new Set<string>();
    for (const docId of pids) {
        const pdoc = visible[docId];
        if (!pdoc) continue;
        const problemMapId = storedOptionalObjectIdString(pdoc.knowledgeMapId, `problem.${docId}.knowledgeMapId`);
        if (problemMapId !== expectedMapId) continue;
        const selectedNodeIds = resolveProblemKnowledgeNodeIds(pdoc, `problem.${docId}`);
        if (!selectedNodeIds.length) continue;
        for (const nodeId of selectedNodeIds) {
            if (!nodeIds.has(nodeId)) {
                logger.error(
                    'Course problem references a missing mindmap node domain=%s tid=%s docId=%s node=%s',
                    domainId,
                    tdoc.docId,
                    docId,
                    nodeId,
                );
                return null;
            }
            usedNodeIds.add(nodeId);
        }
        const chapters = tdoc.dag
            .filter((chapter) => courseNodePids(chapter).includes(docId) || (referencedPidsByChapter.get(chapter._id) || []).includes(docId))
            .map((chapter) => ({ id: chapter._id, title: chapter.title }));
        if (!chapters.length) continue;
        problems.push({
            domainId: String(pdoc.domainId || domainId),
            docId,
            pid: String(pdoc.pid || docId),
            title: String(pdoc.title || pdoc.pid || docId),
            nodeIds: selectedNodeIds,
            chapters,
        });
    }
    return { ...serialized, problems, usedNodeIds: [...usedNodeIds] };
}

/** 当前用户所属的 userbind 班级 id 集合；查询失败必须向上抛出。 */
function parseCourseVideoDueAt(raw: string): Date | null {
    const value = String(raw || '').trim();
    if (!value) return null;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) throw new ValidationError('courseVideoDueAt', null, localizedErrorText`视频观看截止时间无效`);
    return at;
}

function courseFilePrefix(domainId: string, tid: ObjectId): string {
    return `course/${domainId}/${tid}/`;
}

function listedCourseFile(tdoc: TrainingDoc, filename: string) {
    const file = (tdoc.files || []).find((item) => item.name === filename);
    if (!file) throw new NotFoundError(localizedErrorText`file`);
    return file;
}

async function parseChaptersJson(domainId: string, raw: string, previous: TrainingNode[] = []): Promise<TrainingNode[]> {
    const parsed: TrainingNode[] = [];
    try {
        const chapters = JSON.parse(raw);
        assert(chapters instanceof Array, 'chapters must be an array');
        assert(chapters.length, 'must have at least one chapter');
        const ids = new Set(chapters.map((s) => +s._id));
        assert(chapters.length === ids.size, '_id must be unique');
        for (const node of chapters) {
            assert(node._id, 'each chapter needs an _id');
            assert(node.title, 'each chapter needs a title');
            if (node.content !== undefined && typeof node.content !== 'string') {
                throw new ValidationError('chapters', null, localizedErrorText`章节 ${node._id} 的讲义必须是字符串`);
            }
            if (node.pids !== undefined && node.pids !== null && !Array.isArray(node.pids)) {
                throw new Error(`章节 ${node._id} 的题目必须是数组`);
            }
            const pids = normalizeProblemDocIds(Array.isArray(node.pids) ? node.pids : []);
            const sections = parseCourseSections(+node._id, node.sections, normalizeProblemDocIds);
            const videos = parseCourseVideos(`章节 ${node._id}`, node.videos);
            const sectionPidSet = new Set(sections.flatMap((section) => section.pids));
            for (const pid of pids) {
                if (sectionPidSet.has(pid)) {
                    throw new ValidationError('chapters', null, localizedErrorText`章节 ${node._id} 的题目不能同时属于小节`);
                }
            }
            let problemSetId: ObjectId | undefined;
            let stageIds: number[] | undefined;
            if (node.problemSetId) {
                try {
                    problemSetId = node.problemSetId instanceof ObjectId ? node.problemSetId : new ObjectId(String(node.problemSetId));
                } catch {
                    throw new ValidationError('problemSetId', null, localizedErrorText`无效的题集 id`);
                }
                const setDoc = await training.get(domainId, problemSetId);
                if (!isProblemSetKind(setDoc.kind)) throw new ValidationError('problemSetId', null, localizedErrorText`引用的不是题集`);
                if (Array.isArray(node.stageIds) && node.stageIds.length) {
                    stageIds = Array.from(new Set(node.stageIds.map(Number)));
                    for (const stageId of stageIds) computePrerequisiteClosure(setDoc.dag || [], stageId);
                }
            }
            const rawTids: string[] = Array.isArray(node.tids) ? node.tids : [];
            // 校验比赛存在。
            const tids: ObjectId[] = [];
            for (const t of rawTids) {
                let tid: ObjectId;
                try {
                    tid = new ObjectId(t);
                } catch {
                    throw new ValidationError('tids', null, localizedErrorText`无效的比赛 id: ${t}`);
                }

                const tdoc = await contest.get(domainId, tid).catch(() => null);
                if (!tdoc) throw new ValidationError('tids', null, localizedErrorText`比赛不存在: ${t}`);
                tids.push(tid);
            }
            parsed.push({
                _id: +node._id,
                title: node.title,
                ...(node.content ? { content: node.content } : {}),
                requireNids: [], // 线性目录：无先修依赖
                pids,
                ...(sections.length ? { sections } : {}),
                ...(tids.length ? { tids } : {}),
                ...(problemSetId ? { problemSetId } : {}),
                ...(stageIds?.length ? { stageIds } : {}),
                ...(videos.length ? { videos } : {}),
            });
        }
        return reconcileCourseDagVideos(parsed, previous);
    } catch (error: unknown) {
        // HydroError.message is the uninterpolated template; wrapping it as {0} leaves residual placeholders.
        if (error instanceof HydroError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const detail = /\{\d+\}/.test(message) ? '无法解析该课程结构。' : message;
        throw localizeErrorParameter(new ValidationError('chapters', null, detail), 2, 'The course structure is invalid: {0}', detail);
    }
}

class CourseMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, page = 1, q = '') {
        const domainId = String(this.domain?._id);
        const query: Filter<TrainingDoc> = { ...courseKindClause() };
        if (q) query.title = { $regex: new RegExp(escapeRegExp(q), 'i') };
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const canCreate = this.user.hasPerm(PERM.PERM_CREATE_COURSE) || isAdmin;
        const canManageAll = this.user.hasPerm(PERM.PERM_EDIT_COURSE) || isAdmin;
        // 可见性下推进 mongo query，使分页计数准确（对抗性审查 #5）：全域
        // 课程(空/无 courseGroupIds)或用户所属班级的课程。管理者看全部。
        if (!canManageAll) {
            const myGroups = await courseUserGroupIds(domainId, this.user._id);
            // 容错构造（对齐 post 路径）：畸形 id 跳过，避免整个列表页 500。
            const groupOids = Array.from(myGroups)
                .map((s) => {
                    try {
                        return new ObjectId(s);
                    } catch {
                        return null;
                    }
                })
                .filter((x): x is ObjectId => !!x);
            const entitledIds = await problemSetAccessService.listActiveTargetIds(domainId, this.user._id, 'course');
            query.$or = [
                { owner: this.user._id },
                { maintainer: this.user._id },
                { courseHidden: { $ne: true }, courseGroupIds: { $exists: false } },
                { courseHidden: { $ne: true }, courseGroupIds: { $size: 0 } },
                ...(groupOids.length ? [{ courseHidden: { $ne: true }, courseGroupIds: { $in: groupOids } }] : []),
                ...(entitledIds.length ? [{ courseHidden: { $ne: true }, docId: { $in: entitledIds } }] : []),
            ];
        }
        const [tdocs, tpcount, tcount] = await this.paginate(training.getMulti(domainId, query), page, 'training');
        const managedIds = tdocs.filter((tdoc) => canManageAll || this.user.own(tdoc)).map((tdoc) => String(tdoc.docId));
        const tids = tdocs.map((t) => t.docId);
        const tsdict = {};
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const tsdocs = await training
                .getMultiStatus(domainId, {
                    uid: this.user._id,
                    docId: { $in: tids },
                })
                .toArray();
            for (const tsdoc of tsdocs) tsdict[tsdoc.docId.toHexString()] = tsdoc;
        }
        this.response.template = 'course_main.html';
        const canAssign = canAssignCourse(this.user);
        const assignUsers = canAssign
            ? await loadCourseAssignUsers(
                  domainId,
                  tdocs.flatMap((tdoc) => [tdoc.owner, ...(tdoc.maintainer || [])]),
              )
            : {};
        this.response.body = {
            tdocs,
            page,
            tpcount,
            tcount,
            tsdict,
            q,
            canCreate,
            canAssign,
            managedIds,
            assignUsers,
        };
    }
}

type CourseCollectRequestStatus = 'draft' | 'published' | 'closed' | 'archived';

interface CourseCollectRequestView {
    _id: string;
    title: string;
    dueAt: string;
    status: CourseCollectRequestStatus;
    chapterId: number | null;
}

interface CollectCourseQueryModule {
    listByCourse?: (
        domainId: string,
        courseId: ObjectId,
        options?: {
            includeDraft?: boolean;
            viewer?: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean };
        },
    ) => Promise<unknown>;
    listByCourseChapter?: (
        domainId: string,
        courseId: ObjectId,
        chapterId: number,
        options?: {
            includeDraft?: boolean;
            viewer?: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean };
        },
    ) => Promise<unknown>;
    existsByCourse?: (domainId: string, courseId: ObjectId) => Promise<boolean>;
    existsRequiringCourseExam?: (domainId: string, courseId: ObjectId) => Promise<boolean>;
}

function isNodeModuleNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

function loadCollectCourseQuery(): CollectCourseQueryModule | null {
    try {
        return require('@hydrooj/krypton-collect') as CollectCourseQueryModule;
    } catch (error) {
        if (!isNodeModuleNotFound(error)) throw error;
    }
    try {
        return require('@hydrooj/krypton-collect/src/course-query') as CollectCourseQueryModule;
    } catch (error) {
        if (!isNodeModuleNotFound(error)) throw error;
    }
    const collect = global.Hydro?.model && (global.Hydro.model as { collect?: CollectCourseQueryModule }).collect;
    return collect || null;
}

function asCourseCollectRequestView(value: unknown, index: number): CourseCollectRequestView {
    if (!value || typeof value !== 'object') throw new TypeError(`collectRequests[${index}] must be an object`);
    const row = value as Record<string, unknown>;
    const id = typeof row._id === 'string' ? row._id : '';
    const title = typeof row.title === 'string' ? row.title : '';
    const dueAt = typeof row.dueAt === 'string' ? row.dueAt : '';
    const status = row.status;
    const chapterId = row.chapterId;
    if (!id) throw new TypeError(`collectRequests[${index}]._id must be a string`);
    if (!title) throw new TypeError(`collectRequests[${index}].title must be a string`);
    if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) throw new TypeError(`collectRequests[${index}].dueAt must be an ISO date`);
    if (status !== 'draft' && status !== 'published' && status !== 'closed' && status !== 'archived') {
        throw new TypeError(`collectRequests[${index}].status is invalid`);
    }
    if (chapterId !== undefined && chapterId !== null && (typeof chapterId !== 'number' || !Number.isSafeInteger(chapterId))) {
        throw new TypeError(`collectRequests[${index}].chapterId must be an integer or null`);
    }
    return { _id: id, title, dueAt, status, chapterId: typeof chapterId === 'number' ? chapterId : null };
}

async function loadCourseCollectRequests(
    domainId: string,
    courseId: ObjectId,
    chapterIds: number[],
    includeDraft: boolean,
    viewer: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean },
): Promise<{ available: boolean; requests: CourseCollectRequestView[] }> {
    const mod = loadCollectCourseQuery();
    const listByCourse = mod?.listByCourse;
    if (typeof listByCourse === 'function') {
        const list = await listByCourse(domainId, courseId, { includeDraft, viewer });
        if (!Array.isArray(list)) throw new TypeError('listByCourse must return an array');
        return { available: true, requests: list.map((item, index) => asCourseCollectRequestView(item, index)) };
    }
    const listByCourseChapter = mod?.listByCourseChapter;
    if (typeof listByCourseChapter !== 'function') return { available: false, requests: [] };
    if (!chapterIds.length) return { available: true, requests: [] };
    const lists = await Promise.all(
        chapterIds.map((chapterId) => listByCourseChapter(domainId, courseId, chapterId, { includeDraft, viewer })),
    );
    const requests: CourseCollectRequestView[] = [];
    for (const list of lists) {
        if (!Array.isArray(list)) throw new TypeError('listByCourseChapter must return an array');
        for (const item of list) requests.push(asCourseCollectRequestView(item, requests.length));
    }
    return { available: true, requests };
}

class CourseDetailHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('view', Types.String, true)
    async get(_domainId: string, tid: ObjectId, view = '') {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const tdoc = await training.get(domainId, tid);
        if (!isCourseKind(tdoc.kind)) throw new TrainingNotFoundError(domainId, tid);
        const activeView = view === 'mindmap' ? 'mindmap' : view === 'roster' ? 'roster' : 'overview';
        const canManage = canManageCourse(this.user, tdoc, PERM.PERM_EDIT_COURSE);
        const canViewRoster = this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS);
        if (!canManage) {
            if (isCourseHidden(tdoc)) throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
            await assertCourseAccessible(domainId, this.user._id, tdoc);
        }
        if (activeView === 'roster' && !canViewRoster && !canManage) {
            throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
        }
        const referencedPidsByChapter = new Map<number, number[]>();
        const staleReferencedProblemSetIds: string[] = [];
        for (const node of tdoc.dag || []) {
            const live = await liveReferencedPidsForCourseGet(domainId, tid, node);
            referencedPidsByChapter.set(node._id, live.pids);
            if (live.stale) staleReferencedProblemSetIds.push(String(node.problemSetId));
        }
        const pids = Array.from(new Set([...training.getPids(tdoc.dag), ...Array.from(referencedPidsByChapter.values()).flat()]));
        const allTids = Array.from(new Set<string>((tdoc.dag || []).flatMap((n) => (n.tids || []).map((t) => String(t))))).map((s) => new ObjectId(s));
        const overviewData =
            activeView === 'overview' || activeView === 'roster'
                ? Promise.all([
                      getVisibleReferencedProblems(domainId, pids, this.user),
                      activeView === 'overview' && this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? problem.getListStatus(domainId, this.user._id, pids) : {},
                      activeView === 'overview' && allTids.length
                          ? contest
                                .getMulti(domainId, { docId: { $in: allTids } })
                                .project({ docId: 1, title: 1, rule: 1, beginAt: 1, endAt: 1 })
                                .toArray()
                          : [],
                  ])
                : Promise.resolve([{}, {}, []] as const);
        const collectQuery =
            activeView === 'overview'
                ? loadCourseCollectRequests(
                      domainId,
                      tid,
                      (tdoc.dag || []).map((node) => node._id),
                      canManage,
                      this.user,
                  )
                : Promise.resolve({ available: false, requests: [] as CourseCollectRequestView[] });
        const [udoc, tsdoc, courseMindmap, publishedIntegrity, [pdict, psdict, ctdocs], collectResult] = await Promise.all([
            user.getById(domainId, tdoc.owner),
            this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? training.getStatus(domainId, tdoc.docId, this.user._id) : null,
            activeView === 'mindmap' && tdoc.mindmapId !== undefined && tdoc.mindmapId !== null
                ? buildCourseMindmapView(domainId, tdoc, pids, this.user, referencedPidsByChapter)
                : null,
            practiceIntegrityService.getLatestPublished(domainId, 'course', tdoc.docId),
            overviewData,
            collectQuery,
        ]);
        const contextualDoneByScope =
            activeView === 'overview' && publishedIntegrity && this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
                ? await contextualCompletionService.getCompletedByScope(domainId, this.user._id, 'course', tdoc.docId)
                : null;
        const videoProgressDocs =
            activeView === 'overview' && this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
                ? await loadUserCourseProgress(domainId, tdoc.docId, this.user._id)
                : [];
        const videoProgressByKey = new Map(
            videoProgressDocs.map((doc) => [`${doc.videoId}:${doc.contentRevision}`, doc] as const),
        );
        const cdict: Record<string, any> = {};
        for (const c of ctdocs) cdict[String(c.docId)] = c;
        // 逐章节进度（线性，无先修）。
        const donePids = new Set<number>();
        for (const pid in psdict) {
            if (!+pid) continue;
            if (psdict[pid].status === STATUS.STATUS_ACCEPTED) donePids.add(+pid);
        }
        const serializeVideos = (videos: typeof tdoc.dag[0]['videos']) =>
            studentVisibleVideos(videos).map((item) => {
                const progress = videoProgressByKey.get(`${item.id}:${item.contentRevision}`);
                const coverageMs = progress?.coverageMs || 0;
                return {
                    id: item.id,
                    title: item.title,
                    durationMs: item.durationMs,
                    contentRevision: item.contentRevision,
                    playUrl: `/course/${tid}/video/${item.id}/play`,
                    lastPosition: progress?.lastPosition || 0,
                    coverageRatio: item.durationMs ? Math.min(1, coverageMs / item.durationMs) : 0,
                    completed: Boolean(progress?.completedAt) || (progress ? isCourseVideoComplete(progress.ranges || [], item.durationMs) : false),
                    completedAt: progress?.completedAt ? progress.completedAt.toISOString() : null,
                };
            });
        const chapters =
            activeView === 'overview'
                ? tdoc.dag.map((node) => {
                      const livePids = Array.from(new Set([...courseNodePids(node), ...(referencedPidsByChapter.get(node._id) || [])]));
                      const completed = contextualDoneByScope ? contextualDoneByScope.get(node._id) || new Set<number>() : donePids;
                      // Per-problem marks and the chapter counter read the same
                      // scoped set, so the list can never disagree with the
                      // progress figure, and a published integrity policy never
                      // falls back to global ProblemStatus.
                      const donePidsInChapter = livePids.filter((p) => completed.has(p));
                      const sectionPidSet = new Set((node.sections || []).flatMap((section) => section.pids));
                      const liveRefPids = referencedPidsByChapter.get(node._id) || [];
                      const loosePids = Array.from(
                          new Set([...node.pids.filter((pid) => !sectionPidSet.has(pid)), ...liveRefPids.filter((pid) => !sectionPidSet.has(pid))]),
                      );
                      const chapterVideos = serializeVideos(node.videos);
                      const sections = (node.sections || []).map((section) => {
                          const donePidsInSection = section.pids.filter((pid) => completed.has(pid));
                          const sectionVideos = serializeVideos(section.videos);
                          const unit = courseUnitProgress(
                              sectionVideos.filter((item) => item.completed).length,
                              sectionVideos.length,
                              donePidsInSection.length,
                              section.pids.length,
                          );
                          return {
                              _id: section._id,
                              title: section.title,
                              content: section.content || '',
                              pids: section.pids,
                              completedPids: donePidsInSection,
                              videos: sectionVideos,
                              progress: unit.progress,
                              doneCount: unit.doneCount,
                              totalCount: unit.totalCount,
                          };
                      });
                      const allVideos = [...chapterVideos, ...sections.flatMap((section) => section.videos)];
                      const unit = courseUnitProgress(
                          allVideos.filter((item) => item.completed).length,
                          allVideos.length,
                          donePidsInChapter.length,
                          livePids.length,
                      );
                      return {
                          _id: node._id,
                          title: node.title,
                          content: node.content || '',
                          pids: livePids,
                          loosePids,
                          videos: chapterVideos,
                          sections,
                          completedPids: donePidsInChapter,
                          tids: (node.tids || []).map((t) => String(t)),
                          problemSetId: node.problemSetId ? String(node.problemSetId) : '',
                          stageIds: node.stageIds || [],
                          progress: unit.progress,
                          doneCount: unit.doneCount,
                          totalCount: unit.totalCount,
                      };
                  })
                : [];
        this.response.template = 'course_detail.html';
        const canDownloadFiles = this.user.hasPriv(PRIV.PRIV_USER_PROFILE);
        this.response.body = {
            tdoc:
                activeView === 'mindmap'
                    ? {
                          docId: tdoc.docId,
                          title: tdoc.title,
                          term: tdoc.term || '',
                          courseGroupIds: tdoc.courseGroupIds || [],
                      }
                    : tdoc,
            chapters,
            pdict,
            psdict,
            cdict,
            udoc,
            canManage,
            tsdoc,
            canCreate: canCreateCourse(this.user),
            canCreateQuiz: canManage && canCreateCourseQuiz(this.user),
            canCreateCollect:
                collectResult.available &&
                canManage &&
                (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) ||
                    this.user.hasPerm(PERM.PERM_CREATE_COLLECT) ||
                    this.user.hasPerm(PERM.PERM_MANAGE_COLLECT)),
            collectRequests: collectResult.requests,
            canEnroll: canDownloadFiles && !courseAssignsUserGroups(tdoc) && !tsdoc?.enroll,
            canDownloadFiles,
            files: activeView === 'overview' && canDownloadFiles ? sortFiles(tdoc.files || []) : [],
            view: activeView,
            courseMindmap,
            staleReferencedProblemSetIds,
            integrityControlled: !!publishedIntegrity,
            canViewRoster,
        };
        const courseExamContest = await hydrateCourseExamContest(domainId, tdoc, this.user._id);
        if (courseExamContest) this.response.body.courseExamContest = courseExamContest;
        if (activeView === 'roster' && !canViewRoster && canManage) {
            this.response.body.rosterWarning = '花名册需要学生档案管理权限，已隐藏名单。';
            this.response.body.members = [];
        }
        if (activeView === 'roster' && canViewRoster) {
            const ub = studentDirectory();
            const courseGroups = tdoc.courseGroupIds || [];
            let memberUids: number[] = [];
            let membersTruncated = false;
            if (courseGroups.length) {
                const boundStudents = await ub.findBoundStudentsByGroupIds(
                    domainId,
                    courseGroups.map((groupId) => (groupId instanceof ObjectId ? groupId : new ObjectId(String(groupId)))),
                );
                memberUids = uniqueBoundUserIds(boundStudents);
            } else {
                const enrollDocs = await training
                    .getMultiStatus(domainId, { docId: tdoc.docId, uid: { $gt: 1 }, enroll: 1 })
                    .project({ uid: 1 })
                    .limit(PRACTICE_ROSTER_ENROLL_LIMIT)
                    .toArray();
                memberUids = enrollDocs.map((row) => +row.uid);
                membersTruncated = enrollDocs.length >= PRACTICE_ROSTER_ENROLL_LIMIT;
            }
            const rosterPids = pids.filter((pid) => pdict[pid]?.docId);
            const scopePids = new Map<number, Set<number>>();
            for (const node of tdoc.dag || []) {
                scopePids.set(node._id, new Set([...courseNodePids(node), ...(referencedPidsByChapter.get(node._id) || [])]));
            }
            const examContestId = tdoc.courseExam?.contestId;
            const [memberUdict, students, ubGroups, completedPidsByUid, examRoster] = await Promise.all([
                user.getListForRender(domainId, memberUids, false),
                memberUids.length ? ub.findStudentsByUserIds(domainId, memberUids) : {},
                ub.listUserGroups(domainId),
                loadCompletedPidsByUid({
                    domainId,
                    memberUids,
                    pids: rosterPids,
                    publishedIntegrity: !!publishedIntegrity,
                    containerKind: 'course',
                    containerId: tdoc.docId,
                    scopePids,
                }),
                examContestId
                    ? loadCourseExamRoster(domainId, examContestId, memberUids)
                    : Promise.resolve(null),
            ]);
            this.response.body.membersTruncated = membersTruncated;
            this.response.body.members = assemblePracticeRosterMembers({
                memberUids,
                udict: memberUdict,
                students,
                groupNameById: new Map((ubGroups as Array<{ _id: ObjectId; name: string }>).map((group) => [String(group._id), group.name])),
                completedPidsByUid,
                total: rosterPids.length,
                ...(examRoster?.facts ? { examFactsByUid: examRoster.facts } : {}),
            });
            this.response.body.rosterProblems = serializePracticeRosterProblems(rosterPids, pdict);
            if (courseGroups.length) this.response.body.rosterGroupIds = courseGroups.map((groupId) => String(groupId));
            if (examRoster?.meta) this.response.body.rosterExam = examRoster.meta;
            if (examRoster?.warning) this.response.body.rosterExamWarning = examRoster.warning;
        }
    }

    @param('tid', Types.ObjectId)
    async postEnroll(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        if (!isCourseKind(tdoc.kind)) throw new TrainingNotFoundError(domainId, tid);
        const canManage = canManageCourse(this.user, tdoc, PERM.PERM_EDIT_COURSE);
        if (courseAssignsUserGroups(tdoc)) {
            throw new ValidationError('tid', null, localizedErrorText`指定用户组的课程不需要报名`);
        }
        if (!canManage && isCourseHidden(tdoc)) throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
        await training.enroll(domainId, tdoc.docId, this.user._id);
        this.back();
    }
}

class CourseEditHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid) {
            this.tdoc = await training.get(authoritativeDomainId, tid);
            if (!isCourseKind(this.tdoc.kind)) throw new TrainingNotFoundError(authoritativeDomainId, tid);
            if (!canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE)) {
                await assertCourseAccessible(authoritativeDomainId, this.user._id, this.tdoc);
                throw new PermissionError(PERM.PERM_EDIT_COURSE);
            }
        } else if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            if (!this.user.hasPerm(PERM.PERM_CREATE_COURSE)) {
                logger.warn(
                    'Course creation denied domain=%s uid=%d stage=prepare reason=missing-create-permission',
                    authoritativeDomainId,
                    this.user._id,
                );
            }
            this.checkPerm(PERM.PERM_CREATE_COURSE);
        }
    }

    async get(_domainId: string) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const [groups, mindmaps] = await Promise.all([
            studentDirectory().listUserGroups(authoritativeDomainId),
            listCourseMindmapOptions(),
        ]);
        if (this.tdoc && this.tdoc.mindmapId !== undefined && this.tdoc.mindmapId !== null) {
            const currentMindmapId = storedObjectIdString(this.tdoc.mindmapId, 'course.mindmapId');
            if (!mindmaps.some((map) => map._id === currentMindmapId)) {
                logger.error(
                    'Course editor found unavailable mindmap binding domain=%s tid=%s map=%s',
                    authoritativeDomainId,
                    this.tdoc.docId,
                    currentMindmapId,
                );
                throw new TypeError(
                    `course references an unavailable public mindmap domain=${authoritativeDomainId} tid=${this.tdoc.docId} map=${currentMindmapId}`,
                );
            }
        }
        this.response.template = 'course_edit.html';
        this.response.body = {
            page_name: this.tdoc ? 'course_edit' : 'course_create',
            groups: groups.map((g: any) => ({ _id: String(g._id), name: g.name, archivedAt: g.archivedAt || null })),
            canManageFiles: !!this.tdoc && canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE),
            canCreate: canCreateCourse(this.user),
            canCreateQuiz: !!this.tdoc && canCreateCourseQuiz(this.user),
            canAssign: !!this.tdoc && canAssignCourse(this.user),
            files: sortFiles(this.tdoc?.files || []),
            mindmaps,
        };
        if (this.tdoc) {
            this.response.body.tdoc = this.tdoc;
            this.response.body.chapters = JSON.stringify(courseChapterEditorPayload(this.tdoc), null, 2);
            const courseExamContest = await hydrateCourseExamContest(authoritativeDomainId, this.tdoc);
            if (courseExamContest) this.response.body.courseExamContest = courseExamContest;
            if (this.response.body.canAssign) {
                const assignUsers = await loadCourseAssignUsers(authoritativeDomainId, [this.tdoc.owner, ...(this.tdoc.maintainer || [])]);
                this.response.body.expectedOwner = this.tdoc.owner;
                this.response.body.ownerUser = assignUsers[String(this.tdoc.owner)] || courseAssignUserView({}, this.tdoc.owner);
                this.response.body.maintainerUsers = (this.tdoc.maintainer || [])
                    .filter((uid) => uid !== this.tdoc.owner)
                    .map((uid) => assignUsers[String(uid)] || courseAssignUserView({}, uid));
            }
        }
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title, true)
    @param('content', Types.Content, true)
    @param('chapters', Types.Content, true)
    @param('description', Types.Content, true)
    @param('term', Types.String, true)
    @param('courseGroupIds', Types.CommaSeperatedArray, true)
    @param('mindmapId', Types.String, true)
    @param('courseVideoDueAt', Types.String, true)
    @param('courseHidden', Types.Boolean, true)
    @param('courseExamContestId', Types.String, true)
    @param('courseExamGate', Types.String, true)
    @param('courseExamPercent', Types.Int, true)
    @param('courseExamChapterId', Types.Int, true)
    async post(
        _domainId: string,
        tid: ObjectId,
        title?: string,
        content?: string,
        chaptersJson?: string,
        description = '',
        term = '',
        courseGroupIds: string[] = [],
        mindmapId = '',
        courseVideoDueAtRaw = '',
        courseHidden = false,
        courseExamContestId?: string,
        courseExamGate?: string,
        courseExamPercent?: number,
        courseExamChapterId?: number,
    ) {
        // Framework runs `post` before `postAssign`/`postDelete`; those POSTs omit the save payload.
        if (this.args?.operation || this.request.body?.operation) return;
        if (title === undefined) throw new ValidationError('title');
        content = content ?? '';
        if (chaptersJson === undefined) throw new ValidationError('chapters');
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const dag = await parseChaptersJson(authoritativeDomainId, chaptersJson, this.tdoc?.dag || []);
        const courseVideoDueAt = parseCourseVideoDueAt(courseVideoDueAtRaw);
        const selectedMindmapId = await resolveCourseMindmapId(authoritativeDomainId, tid || null, this.user._id, String(mindmapId || ''));
        const pids = training.getPids(dag);
        const existingPids = training.getPids(this.tdoc?.dag || []);
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, existingPids);
        const groupIds = (courseGroupIds || [])
            .map((s) => {
                try {
                    return new ObjectId(s);
                } catch {
                    return null;
                }
            })
            .filter((x): x is ObjectId => !!x);
        const parsedExam = parseCourseExamForm({
            contestId: courseExamContestId,
            gate: courseExamGate,
            percent: courseExamPercent,
            chapterId: courseExamChapterId,
        });
        const courseExam = parsedExam
            ? await resolveCourseExamForSave({
                  domainId: authoritativeDomainId,
                  courseId: tid || null,
                  dag,
                  binding: parsedExam,
                  courseGroupIds: groupIds,
              })
            : null;
        if (tid && !parsedExam && this.tdoc?.courseExam) {
            const collect = loadCollectCourseQuery();
            if (typeof collect?.existsRequiringCourseExam === 'function' && (await collect.existsRequiringCourseExam(authoritativeDomainId, tid))) {
                throw new ValidationError('courseExam', null, localizedErrorText`仍有收集要求先完成结业考试，不能解除绑定`);
            }
        }
        try {
            if (!tid) {
                tid = await training.add(authoritativeDomainId, title, content, this.user._id, dag, description, 0, {
                    kind: 'course',
                    courseGroupIds: groupIds,
                    term,
                    courseHidden: Boolean(courseHidden),
                    ...(selectedMindmapId ? { mindmapId: selectedMindmapId } : {}),
                    ...(courseVideoDueAt ? { courseVideoDueAt } : {}),
                    ...(courseExam ? { courseExam } : {}),
                });
                await oplog.log(this, 'course.create', { tid, title, mindmapId: selectedMindmapId?.toHexString() || null });
            } else {
                const previousMindmapId = storedOptionalObjectIdString(this.tdoc?.mindmapId, 'course.mindmapId');
                await training.edit(
                    authoritativeDomainId,
                    tid,
                    {
                        title,
                        content,
                        dag,
                        description,
                        term,
                        courseGroupIds: groupIds,
                        courseHidden: Boolean(courseHidden),
                        ...(selectedMindmapId ? { mindmapId: selectedMindmapId } : {}),
                        ...(courseVideoDueAt ? { courseVideoDueAt } : {}),
                        ...(courseExam ? { courseExam } : {}),
                    },
                    {
                        ...(selectedMindmapId ? {} : { mindmapId: 1 }),
                        ...(courseVideoDueAt ? {} : { courseVideoDueAt: 1 }),
                        ...(courseExam ? {} : { courseExam: 1 }),
                    },
                );
                await oplog.log(this, 'course.edit', {
                    tid,
                    title,
                    previousMindmapId,
                    mindmapId: selectedMindmapId?.toHexString() || null,
                });
            }
        } catch (error) {
            if (isCourseExamDuplicateKey(error)) {
                throw new ValidationError('courseExamContestId', null, localizedErrorText`这场考试已绑定其它课程`);
            }
            throw error;
        }
        logger.info(
            'Course saved domain=%s tid=%s actor=%d mindmap=%s courseExam=%s result=success',
            authoritativeDomainId,
            tid,
            this.user._id,
            selectedMindmapId || 'none',
            courseExam ? courseExam.contestId.toHexString() : 'none',
        );
        this.response.body = { tid };
        this.response.redirect = this.url('course_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    async postCopy(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (!canCreateCourse(this.user)) this.checkPerm(PERM.PERM_CREATE_COURSE);
        if (!this.tdoc?.docId?.equals(tid) || !isCourseKind(this.tdoc.kind)) {
            throw new TrainingNotFoundError(authoritativeDomainId, tid);
        }
        const title = copiedCourseTitle(this.tdoc.title || '');
        if (!title) throw new ValidationError('title', null, localizedErrorText`课程名称无效`);
        const dag = await parseChaptersJson(authoritativeDomainId, JSON.stringify(courseChapterEditorPayload(this.tdoc)), this.tdoc.dag || []);
        const { dag: copiedDag, copies } = rewriteCourseVideosForCopy(dag);
        const pids = training.getPids(copiedDag);
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, training.getPids(this.tdoc.dag || []));
        const mindmapRaw =
            this.tdoc.mindmapId === undefined || this.tdoc.mindmapId === null ? '' : storedObjectIdString(this.tdoc.mindmapId, 'course.mindmapId');
        const selectedMindmapId = await resolveCourseMindmapId(authoritativeDomainId, null, this.user._id, mindmapRaw);
        const groupIds = (this.tdoc.courseGroupIds || []).map((groupId) => {
            if (groupId instanceof ObjectId) return groupId;
            try {
                return new ObjectId(String(groupId));
            } catch {
                throw new ValidationError('courseGroupIds', null, localizedErrorText`课程可见范围无效`);
            }
        });
        let newTid: ObjectId | null = null;
        const copiedPaths: string[] = [];
        try {
            newTid = await training.add(
                authoritativeDomainId,
                title,
                this.tdoc.content || '',
                this.user._id,
                copiedDag,
                this.tdoc.description || '',
                0,
                {
                    kind: 'course',
                    courseGroupIds: groupIds,
                    term: this.tdoc.term || '',
                    courseHidden: isCourseHidden(this.tdoc),
                    ...(selectedMindmapId ? { mindmapId: selectedMindmapId } : {}),
                    ...(this.tdoc.courseVideoDueAt ? { courseVideoDueAt: this.tdoc.courseVideoDueAt } : {}),
                    // Do not spread tdoc.courseExam: copied courses must start unbound.
                },
            );
            for (const { from, to } of copies) {
                const src = courseVideoStoragePath(authoritativeDomainId, String(tid), from.id, from.contentRevision, from.ext);
                const dst = courseVideoStoragePath(authoritativeDomainId, String(newTid), to.id, to.contentRevision, to.ext);
                await storage.copy(src, dst);
                copiedPaths.push(dst);
            }
        } catch (error) {
            logger.error(
                'Course copy failed domain=%s from=%s to=%s videos=%d copied=%d error=%o',
                authoritativeDomainId,
                tid,
                newTid,
                copies.length,
                copiedPaths.length,
                error,
            );
            if (copiedPaths.length) await storage.del(copiedPaths, this.user._id);
            if (newTid) await training.del(authoritativeDomainId, newTid);
            throw error;
        }
        const filesSkipped = (this.tdoc.files || []).length;
        await oplog.log(this, 'course.copy', {
            from: tid,
            to: newTid,
            title,
            filesSkipped,
            videosCopied: copies.length,
            mindmapId: selectedMindmapId?.toHexString() || null,
        });
        logger.info(
            'Course copied domain=%s from=%s to=%s actor=%d filesSkipped=%d videosCopied=%d mindmap=%s result=success',
            authoritativeDomainId,
            tid,
            newTid,
            this.user._id,
            filesSkipped,
            copies.length,
            selectedMindmapId || 'none',
        );
        this.response.body = { tid: newTid };
        this.response.redirect = this.url('course_edit', { tid: newTid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (!isCourseKind(tdoc.kind)) throw new TrainingNotFoundError(domainId, tid);
        if (!canManageCourse(this.user, tdoc, PERM.PERM_EDIT_COURSE)) {
            await assertCourseAccessible(domainId, this.user._id, tdoc);
            throw new PermissionError(PERM.PERM_EDIT_COURSE);
        }
        const collect = loadCollectCourseQuery();
        if (typeof collect?.existsByCourse === 'function' && (await collect.existsByCourse(domainId, tid))) {
            throw new ValidationError('tid', null, localizedErrorText`课程仍有文件收集，不能删除`);
        }
        const stored = await storage.list(courseFilePrefix(domainId, tid));
        await Promise.all([
            training.del(domainId, tid),
            storage.del(
                stored.map((file) => file.path),
                this.user._id,
            ),
            deleteCourseVideoProgress(domainId, tid),
        ]);
        await oplog.log(this, 'course.delete', { tid });
        this.response.redirect = this.url('course_main');
    }

    @param('tid', Types.ObjectId)
    @param('expectedOwner', Types.Int)
    @param('owner', Types.Int)
    @param('maintainer', Types.NumericArray, true)
    async postAssign(_domainId: string, tid: ObjectId, expectedOwner: number, owner: number, maintainer: number[] = []) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (!canAssignCourse(this.user)) throw new PermissionError(PERM.PERM_EDIT_COURSE);
        const requested = [...new Set([owner, ...maintainer])];
        const udict = await user.getList(authoritativeDomainId, requested);
        for (const uid of requested) {
            if (!Number.isSafeInteger(uid) || uid < 1 || Number(udict[uid]?._id) !== uid) {
                logger.warn(
                    'Course assign rejected missing user domain=%s tid=%s actor=%d uid=%s stage=assign result=user-missing',
                    authoritativeDomainId,
                    tid,
                    this.user._id,
                    uid,
                );
                throw new ValidationError('owner', null, localizedErrorText`课程分配对象不存在`);
            }
        }
        const updated = await training.assignCourseOwnership(authoritativeDomainId, tid, { expectedOwner, owner, maintainer });
        await oplog.log(this, 'course.assign', {
            tid,
            expectedOwner,
            owner: updated.owner,
            maintainer: updated.maintainer || [],
        });
        this.response.body = {
            ok: true,
            expectedOwner: updated.owner,
            owner: serializeCourseAssignUser(udict[updated.owner]),
            maintainers: (updated.maintainer || []).map((uid) => serializeCourseAssignUser(udict[uid])),
        };
    }
}

class CourseFilesHandler extends Handler {
    tdoc: TrainingDoc;
    domainId: string;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.domainId = String(this.domain?._id);
        this.tdoc = await training.get(this.domainId, tid);
        if (!isCourseKind(this.tdoc.kind)) throw new NotFoundError(localizedErrorText`course`);
        if (!canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE)) {
            await assertCourseAccessible(this.domainId, this.user._id, this.tdoc);
            throw new PermissionError(PERM.PERM_EDIT_COURSE);
        }
    }

    async get() {
        this.response.body = { files: sortFiles(this.tdoc.files || []) };
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename)
    async postUploadFile(_domainId: string, tid: ObjectId, filename: string) {
        const files = this.tdoc.files || [];
        const previous = files.find((item) => item.name === filename);
        if (!previous && files.length >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const retainedSize = Math.sum(files.filter((item) => item.name !== filename).map((item) => item.size));
        if (retainedSize + file.size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        const target = `${courseFilePrefix(this.domainId, tid)}${filename}`;
        await storage.put(target, file.filepath, this.user._id);
        const meta = await storage.getMeta(target);
        if (!meta) throw new FileUploadError();
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        await training.edit(this.domainId, tid, {
            files: files.filter((item) => item.name !== filename).concat(payload),
        });
        await oplog.log(this, 'course.file.upload', { tid, filename, size: payload.size });
        this.response.body = { file: payload };
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(_domainId: string, tid: ObjectId, files: string[]) {
        for (const filename of files) listedCourseFile(this.tdoc, filename);
        await Promise.all([
            storage.del(
                files.map((filename) => `${courseFilePrefix(this.domainId, tid)}${filename}`),
                this.user._id,
            ),
            training.edit(this.domainId, tid, {
                files: (this.tdoc.files || []).filter((item) => !files.includes(item.name)),
            }),
        ]);
        await oplog.log(this, 'course.file.delete', { tid, files });
        this.response.body = { deleted: files };
    }
}

class CourseFileDownloadHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('filename', Types.Filename)
    @param('noDisposition', Types.Boolean, true)
    async get(_domainId: string, tid: ObjectId, filename: string, noDisposition = false) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (!isCourseKind(tdoc.kind)) throw new NotFoundError(localizedErrorText`course`);
        const canManage = canManageCourse(this.user, tdoc, PERM.PERM_EDIT_COURSE);
        if (!canManage) {
            if (isCourseHidden(tdoc)) throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
            await assertCourseAccessible(domainId, this.user._id, tdoc);
        }
        const file = listedCourseFile(tdoc, filename);
        const target = `${courseFilePrefix(domainId, tid)}${filename}`;
        this.response.addHeader('Cache-Control', 'private');
        await oplog.log(this, 'course.file.download', { tid, filename, size: file.size || 0 });
        this.response.redirect = await storage.signDownloadLink(target, noDisposition ? undefined : filename, false, 'user');
    }
}

export async function apply(ctx) {
    ctx.Route('course_main', '/course', CourseMainHandler);
    ctx.Route('course_create', '/course/create', CourseEditHandler);
    ctx.Route('course_detail', '/course/:tid', CourseDetailHandler);
    ctx.Route('course_edit', '/course/:tid/edit', CourseEditHandler);
    ctx.Route('course_files', '/course/:tid/file', CourseFilesHandler);
    ctx.Route('course_file_download', '/course/:tid/file/:filename', CourseFileDownloadHandler);
}
