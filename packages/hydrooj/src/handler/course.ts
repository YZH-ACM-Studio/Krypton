/**
 * 课程模块（PLAN 2026-07-02 §10）。
 *
 * 课程与训练共用 docType 40（TrainingDoc），靠 `kind: 'course'` 区分；
 * 复用 training model 的报名 / 进度 / 章节题目跟踪。课程额外有：
 *   - `courseGroupIds`：可见范围（userbind 班级；空 = 全域可见）
 *   - 章节 `tids`：引用制挂已有比赛/作业（比赛在比赛模块独立创建）
 *   - `term`：学期等元信息
 *
 * 章节结构是线性目录（DAG requireNids 始终为空，前端编辑器只做线性）。
 * 权限：查看 PERM_VIEW_TRAINING；建/改 PERM_CREATE_COURSE / PERM_EDIT_COURSE。
 */
import assert from 'assert';
import { escapeRegExp, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import { FileLimitExceededError, FileUploadError, NotFoundError, PermissionError, ValidationError } from '../error';
import { TrainingDoc, TrainingNode } from '../interface';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import * as oplog from '../model/oplog';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { resolveProblemKnowledgeNodeIds } from '../lib/problem-tag-canonical';
import { getVisibleReferencedProblems, normalizeProblemDocIds } from './problem-reference';

const logger = new Logger('course');

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
        throw new ValidationError('mindmapId', null, '知识导图 id 无效');
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
        throw new ValidationError('mindmapId', null, '只能绑定真实且已公开的知识导图');
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

async function buildCourseMindmapView(domainId: string, tdoc: TrainingDoc, pids: number[], currentUser: any) {
    const expectedMapId = storedObjectIdString(tdoc.mindmapId, 'course.mindmapId');
    const snapshot = await courseMindmapService().getPublicSnapshot(expectedMapId);
    if (!snapshot) {
        logger.error('Course mindmap binding is unavailable domain=%s tid=%s map=%s', domainId, tdoc.docId, expectedMapId);
        throw new TypeError(`course references an unavailable public mindmap domain=${domainId} tid=${tdoc.docId} map=${expectedMapId}`);
    }
    const serialized = serializeCourseMindmapSnapshot(snapshot, expectedMapId);
    const nodeIds = new Set(serialized.nodes.map((node) => node._id));
    const projection = [...problem.PROJECTION_LIST, 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring.selectedMindmapNodeIds'] as any;
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
                throw new TypeError(
                    `course problem references a missing mindmap node domain=${domainId} tid=${tdoc.docId} docId=${docId} node=${nodeId}`,
                );
            }
            usedNodeIds.add(nodeId);
        }
        const chapters = tdoc.dag.filter((chapter) => chapter.pids.includes(docId)).map((chapter) => ({ id: chapter._id, title: chapter.title }));
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
async function userGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.findStudentByUserId !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    try {
        const student = await userbind.findStudentByUserId(domainId, uid);
        return new Set((student?.groupIds || []).map((g: ObjectId) => String(g)));
    } catch (error) {
        logger.error('Course user-group lookup failed domain=%s uid=%d error=%o', domainId, uid, error);
        throw error;
    }
}

/** 课程对当前用户是否可见：全域课程(空 groupIds)或用户属于其某个班级。 */
function courseVisibleTo(tdoc: TrainingDoc, myGroups: Set<string>, canManage: boolean): boolean {
    if (canManage) return true;
    const groups = tdoc.courseGroupIds || [];
    if (!groups.length) return true;
    return groups.some((g) => myGroups.has(String(g)));
}

function courseFilePrefix(domainId: string, tid: ObjectId): string {
    return `course/${domainId}/${tid}/`;
}

function listedCourseFile(tdoc: TrainingDoc, filename: string) {
    const file = (tdoc.files || []).find((item) => item.name === filename);
    if (!file) throw new NotFoundError('file');
    return file;
}

async function parseChaptersJson(domainId: string, raw: string): Promise<TrainingNode[]> {
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
                throw new ValidationError('chapters', null, `章节 ${node._id} 的讲义必须是字符串`);
            }
            const pids = normalizeProblemDocIds(Array.isArray(node.pids) ? node.pids : []);
            const rawTids: string[] = Array.isArray(node.tids) ? node.tids : [];
            // 校验比赛存在。
            const tids: ObjectId[] = [];
            for (const t of rawTids) {
                let tid: ObjectId;
                try {
                    tid = new ObjectId(t);
                } catch {
                    throw new ValidationError('tids', null, `无效的比赛 id: ${t}`);
                }

                const tdoc = await contest.get(domainId, tid).catch(() => null);
                if (!tdoc) throw new ValidationError('tids', null, `比赛不存在: ${t}`);
                tids.push(tid);
            }
            parsed.push({
                _id: +node._id,
                title: node.title,
                ...(node.content ? { content: node.content } : {}),
                requireNids: [], // 线性目录：无先修依赖
                pids,
                ...(tids.length ? { tids } : {}),
            });
        }
    } catch (e: any) {
        throw new ValidationError('chapters', null, e.message);
    }
    return parsed;
}

class CourseMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, page = 1, q = '') {
        const domainId = String(this.domain?._id);
        const query: Filter<TrainingDoc> = { kind: 'course' };
        if (q) query.title = { $regex: new RegExp(escapeRegExp(q), 'i') };
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const canCreate = this.user.hasPerm(PERM.PERM_CREATE_COURSE) || isAdmin;
        const canManageAll = this.user.hasPerm(PERM.PERM_EDIT_COURSE) || isAdmin;
        // 可见性下推进 mongo query，使分页计数准确（对抗性审查 #5）：全域
        // 课程(空/无 courseGroupIds)或用户所属班级的课程。管理者看全部。
        if (!canManageAll) {
            const myGroups = await userGroupIds(domainId, this.user._id);
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
            query.$or = [
                { owner: this.user._id },
                { courseGroupIds: { $exists: false } },
                { courseGroupIds: { $size: 0 } },
                ...(groupOids.length ? [{ courseGroupIds: { $in: groupOids } }] : []),
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
        this.response.body = {
            tdocs,
            page,
            tpcount,
            tcount,
            tsdict,
            q,
            canCreate,
            managedIds,
        };
    }
}

class CourseDetailHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('view', Types.String, true)
    async get(_domainId: string, tid: ObjectId, view = '') {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        const activeView = view === 'mindmap' ? 'mindmap' : 'overview';
        const canManage = this.user.own(tdoc) || this.user.hasPerm(PERM.PERM_EDIT_COURSE) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        // 可见性拦截（非管理者且不属于课程班级 → 拒绝）。
        if (!canManage && (tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, false)) {
                throw new ValidationError('tid', null, '你不在该课程的可见范围内');
            }
        }
        const pids = training.getPids(tdoc.dag);
        // 解析章节引用的所有比赛。
        const allTids = Array.from(new Set<string>(tdoc.dag.flatMap((n) => (n.tids || []).map((t) => String(t))))).map((s) => new ObjectId(s));
        const overviewData =
            activeView === 'overview'
                ? Promise.all([
                      getVisibleReferencedProblems(domainId, pids, this.user),
                      this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? problem.getListStatus(domainId, this.user._id, pids) : {},
                      allTids.length
                          ? contest
                                .getMulti(domainId, { docId: { $in: allTids } })
                                .project({ docId: 1, title: 1, rule: 1, beginAt: 1, endAt: 1 })
                                .toArray()
                          : [],
                  ])
                : Promise.resolve([{}, {}, []] as const);
        const [udoc, tsdoc, courseMindmap, [pdict, psdict, ctdocs]] = await Promise.all([
            user.getById(domainId, tdoc.owner),
            this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? training.getStatus(domainId, tdoc.docId, this.user._id) : null,
            activeView === 'mindmap' && tdoc.mindmapId !== undefined && tdoc.mindmapId !== null
                ? buildCourseMindmapView(domainId, tdoc, pids, this.user)
                : null,
            overviewData,
        ]);
        const cdict: Record<string, any> = {};
        for (const c of ctdocs) cdict[String(c.docId)] = c;
        // 逐章节进度（线性，无先修）。
        const donePids = new Set<number>();
        for (const pid in psdict) {
            if (!+pid) continue;
            if (psdict[pid].status === STATUS.STATUS_ACCEPTED) donePids.add(+pid);
        }
        const chapters =
            activeView === 'overview'
                ? tdoc.dag.map((node) => {
                      const total = node.pids.length;
                      const done = node.pids.filter((p) => donePids.has(p)).length;
                      return {
                          _id: node._id,
                          title: node.title,
                          content: node.content || '',
                          pids: node.pids,
                          tids: (node.tids || []).map((t) => String(t)),
                          progress: total ? Math.floor(100 * (done / total)) : 100,
                          doneCount: done,
                          totalCount: total,
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
                      }
                    : tdoc,
            chapters,
            pdict,
            psdict,
            cdict,
            udoc,
            canManage,
            tsdoc,
            canCreateQuiz: canManage && this.user.hasPerm(PERM.PERM_CREATE_HOMEWORK),
            canEnroll: canDownloadFiles && !tsdoc?.enroll,
            canDownloadFiles,
            files: activeView === 'overview' && canDownloadFiles ? sortFiles(tdoc.files || []) : [],
            view: activeView,
            courseMindmap,
        };
    }

    @param('tid', Types.ObjectId)
    async postEnroll(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        // 可见范围外不允许报名。
        if ((tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM))) {
                throw new PermissionError(PERM.PERM_VIEW_TRAINING);
            }
        }
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
            if (this.tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_COURSE);
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
            (global as any).Hydro?.model?.userbind?.listUserGroups ? (global as any).Hydro.model.userbind.listUserGroups(authoritativeDomainId) : [],
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
            canManageFiles: !!this.tdoc && (this.user.own(this.tdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)),
            canCreateQuiz: !!this.tdoc && this.user.hasPerm(PERM.PERM_CREATE_HOMEWORK),
            files: sortFiles(this.tdoc?.files || []),
            mindmaps,
        };
        if (this.tdoc) {
            this.response.body.tdoc = this.tdoc;
            this.response.body.chapters = JSON.stringify(
                this.tdoc.dag.map((n) => ({
                    _id: n._id,
                    title: n.title,
                    content: n.content || '',
                    pids: n.pids,
                    tids: (n.tids || []).map((t) => String(t)),
                })),
                null,
                2,
            );
        }
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('chapters', Types.Content)
    @param('description', Types.Content, true)
    @param('term', Types.String, true)
    @param('courseGroupIds', Types.CommaSeperatedArray, true)
    @param('mindmapId', Types.String, true)
    async post(
        _domainId: string,
        tid: ObjectId,
        title: string,
        content: string,
        chaptersJson: string,
        description = '',
        term = '',
        courseGroupIds: string[] = [],
        mindmapId = '',
    ) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const dag = await parseChaptersJson(authoritativeDomainId, chaptersJson);
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
        if (!tid) {
            tid = await training.add(authoritativeDomainId, title, content, this.user._id, dag, description, 0, {
                kind: 'course',
                courseGroupIds: groupIds,
                term,
                ...(selectedMindmapId ? { mindmapId: selectedMindmapId } : {}),
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
                    ...(selectedMindmapId ? { mindmapId: selectedMindmapId } : {}),
                },
                selectedMindmapId ? {} : { mindmapId: 1 },
            );
            await oplog.log(this, 'course.edit', {
                tid,
                title,
                previousMindmapId,
                mindmapId: selectedMindmapId?.toHexString() || null,
            });
        }
        logger.info(
            'Course saved domain=%s tid=%s actor=%d mindmap=%s result=success',
            authoritativeDomainId,
            tid,
            this.user._id,
            selectedMindmapId || 'none',
        );
        this.response.body = { tid };
        this.response.redirect = this.url('course_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_COURSE);
        await Promise.all([
            training.del(domainId, tid),
            storage.del(
                (tdoc.files || []).map((file) => `${courseFilePrefix(domainId, tid)}${file.name}`),
                this.user._id,
            ),
        ]);
        await oplog.log(this, 'course.delete', { tid });
        this.response.redirect = this.url('course_main');
    }
}

class CourseFilesHandler extends Handler {
    tdoc: TrainingDoc;
    domainId: string;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.domainId = String(this.domain?._id);
        this.tdoc = await training.get(this.domainId, tid);
        if (this.tdoc.kind !== 'course') throw new NotFoundError('course');
        if (!this.user.own(this.tdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
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
        if (tdoc.kind !== 'course') throw new NotFoundError('course');
        const file = listedCourseFile(tdoc, filename);
        const canManage = this.user.own(tdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        if (!canManage && (tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, false)) throw new PermissionError(PERM.PERM_VIEW_TRAINING);
        }
        const target = `${courseFilePrefix(domainId, tid)}${filename}`;
        this.response.addHeader('Cache-Control', 'private');
        await oplog.log(this, 'course.file.download', { tid, filename, size: file.size || 0 });
        this.response.redirect = await storage.signDownloadLink(target, noDisposition ? undefined : filename, false, 'user');
    }
}

export async function apply(ctx) {
    ctx.Route('course_main', '/course', CourseMainHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('course_create', '/course/create', CourseEditHandler);
    ctx.Route('course_detail', '/course/:tid', CourseDetailHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('course_edit', '/course/:tid/edit', CourseEditHandler);
    ctx.Route('course_files', '/course/:tid/file', CourseFilesHandler);
    ctx.Route('course_file_download', '/course/:tid/file/:filename', CourseFileDownloadHandler);
}
