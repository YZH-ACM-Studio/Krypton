/**
 * Routes for the merged knowledge graph: the public course browser, the
 * course-node editor, and the administrator workspace.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import {
    Handler,
    localizedErrorText,
    NotFoundError,
    ObjectId,
    param,
    PermissionError,
    PRIV,
    PrivilegeError,
    ProblemModel,
    Types,
} from 'hydrooj';
import {
    canEditCourseSubtree,
    canSeeCourseNode,
    courseNodeOf,
    getMergedMap,
    listCourseNodes,
    setCourseNodeSettings,
    type CourseNodeView,
    type MindmapActor,
} from './course-nodes';
import { MindmapRequestError } from './error';
import {
    createNode,
    deleteNode,
    getKnowledgeMap,
    getNodeReferenceCounts,
    listAllNodes,
    listProblemsForNode,
    moveNode,
    searchProblemsForAdmin,
    updateKnowledgeMap,
    updateNode,
} from './model';
import type { KnowledgeMapDoc, MindmapNode } from './types';

const logger = new Logger('krypton-mindmap.handler');

interface ActorUser {
    _id?: number;
    hasPriv?: (...privileges: number[]) => boolean;
}

function actorOf(user: ActorUser | null | undefined): MindmapActor {
    return {
        _id: typeof user?._id === 'number' ? user._id : 0,
        hasPriv: (...privileges: number[]) => (typeof user?.hasPriv === 'function' ? user.hasPriv(...privileges) === true : false),
    };
}

/** courseNodeOf uses this text only when the id is absent. Corruption and merge errors stay distinct. */
function isAbsentMindmapNode(error: unknown): boolean {
    if (!(error instanceof MindmapRequestError) || error.name !== 'MindmapRequestError') return false;
    return error.message === '导图节点不存在';
}

function canExposeProblemMetadata(user: any, domainId: string): boolean {
    try {
        ProblemModel.assertProblemAclDomain(user, domainId);
        return ProblemModel.canBrowseProblemBank(user);
    } catch (error) {
        logger.error(
            'mindmap bootstrap ACL evaluation failed for domain=%s uid=%s: %s',
            domainId,
            user?._id ?? 'anonymous',
            error instanceof Error ? error.stack || error.message : String(error),
        );
        return false;
    }
}

function serializeNode(node: MindmapNode) {
    return {
        ...node,
        _id: node._id.toHexString(),
        mapId: node.mapId.toHexString(),
        parentId: node.parentId ? node.parentId.toHexString() : null,
        ...(node.createdAt ? { createdAt: new Date(node.createdAt).toISOString() } : {}),
        ...(node.updatedAt ? { updatedAt: new Date(node.updatedAt).toISOString() } : {}),
    };
}

function serializeMap(config: KnowledgeMapDoc) {
    return {
        _id: config._id.toHexString(),
        title: config.title,
        rootNodeId: config.rootNodeId.toHexString(),
        visibility: config.visibility,
        layoutDirection: config.layoutDirection,
        ...(config.createdAt ? { createdAt: new Date(config.createdAt).toISOString() } : {}),
        ...(config.updatedAt ? { updatedAt: new Date(config.updatedAt).toISOString() } : {}),
    };
}

function serializePublicNode(node: MindmapNode, exposeProblemMetadata: boolean) {
    const serialized = serializeNode(node);
    return {
        ...serialized,
        problemIds: [] as string[],
        tags: exposeProblemMetadata ? serialized.tags : [],
    };
}

function nodeAndDescendants(nodes: MindmapNode[], rootHex: string): MindmapNode[] {
    const children = new Map<string, MindmapNode[]>();
    let root: MindmapNode | undefined;
    for (const node of nodes) {
        if (node._id.toHexString() === rootHex) root = node;
        const parent = node.parentId?.toHexString();
        if (!parent) continue;
        const list = children.get(parent) ?? [];
        list.push(node);
        children.set(parent, list);
    }
    if (!root) throw new Error(`mindmap node missing node=${rootHex}`);
    const selected = [root];
    const seen = new Set<string>([rootHex]);
    const stack = [...(children.get(rootHex) ?? [])];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) break;
        const id = node._id.toHexString();
        if (seen.has(id)) throw new Error(`mindmap cycle node=${id}`);
        seen.add(id);
        selected.push(node);
        for (const child of children.get(id) ?? []) stack.push(child);
    }
    return selected;
}

function lowestPublicCourse(courses: CourseNodeView[]): CourseNodeView | undefined {
    return courses.find((course) => course.visibility === 'public');
}

async function adminSnapshot(requestedMapId?: ObjectId | string) {
    const map = await getMergedMap();
    const requested = requestedMapId ? (typeof requestedMapId === 'string' ? requestedMapId : requestedMapId.toHexString()) : '';
    const staleMapId = requested && requested !== map._id.toHexString() ? requested : null;
    if (staleMapId) logger.error('Mindmap admin found unavailable map id map=%s', staleMapId);
    const nodes = await listAllNodes(map._id);
    const referenceCounts = await getNodeReferenceCounts(map._id, nodes);
    return {
        nodes: nodes.map(serializeNode),
        config: serializeMap(map),
        referenceCounts,
        staleMapId,
    };
}

async function courseEditorSnapshot(course: CourseNodeView) {
    const map = await getMergedMap();
    const nodes = await listAllNodes(map._id);
    const subtree = nodeAndDescendants(nodes, course.id);
    const counts = await getNodeReferenceCounts(map._id, nodes);
    const referenceCounts: Record<string, number> = {};
    for (const node of subtree) {
        const id = node._id.toHexString();
        const count = counts[id];
        if (count === undefined) throw new Error(`mindmap reference count missing node=${id}`);
        referenceCounts[id] = count;
    }
    return {
        courseNode: course,
        nodes: subtree.map(serializeNode),
        referenceCounts,
        config: serializeMap(map),
    };
}

async function requireCourseEditor(actor: MindmapActor, nodeId: ObjectId, domainId: string): Promise<CourseNodeView> {
    const courses = await listCourseNodes();
    const course = courses.find((entry) => entry.id === nodeId.toHexString());
    if (!course) throw new NotFoundError(localizedErrorText`课程节点`, nodeId.toHexString());
    if (!canEditCourseSubtree(actor, course)) {
        logger.warn('Mindmap course edit denied domain=%s actor=%d node=%s result=forbidden', domainId, actor._id, course.id);
        throw new PermissionError();
    }
    return course;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parsePayload(payload: string | undefined): Record<string, unknown> {
    if (!payload) throw new MindmapRequestError(localizedErrorText`缺少操作数据`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        throw new MindmapRequestError(localizedErrorText`操作数据不是有效 JSON`);
    }
    if (!isPlainObject(parsed)) throw new MindmapRequestError(localizedErrorText`操作数据必须是对象`);
    return parsed;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
    const value = payload[field];
    if (typeof value !== 'string' || !value.trim()) throw new MindmapRequestError(localizedErrorText`${field} 必填`);
    return value;
}

function requiredDate(payload: Record<string, unknown>, field: string): Date {
    const raw = requiredString(payload, field);
    const value = new Date(raw);
    if (Number.isNaN(value.getTime()) || value.toISOString() !== raw) throw new MindmapRequestError(localizedErrorText`${field} 无效`);
    return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new MindmapRequestError(localizedErrorText`${label}包含不支持的字段：${unknown.join('、')}`);
}

function legacyBodyFields(body: Record<string, unknown>): string[] {
    return Object.keys(body).filter((key) => !['operation', 'payload', '_csrf'].includes(key));
}

interface MutationFailure {
    code?: number;
    params?: unknown[];
    mindmapMutationContext?: unknown;
    stack?: string;
    message?: string;
}

function asMutationFailure(error: unknown): MutationFailure {
    if (!error || typeof error !== 'object') return { message: String(error) };
    return error as MutationFailure;
}

async function mutateNodes(
    handler: Handler,
    operation: 'create' | 'update' | 'move' | 'delete',
    payloadJson: string | undefined,
    finish: (mapId: string) => Promise<Record<string, unknown>>,
): Promise<void> {
    const domainId = String(handler.domain?._id);
    const actor = actorOf(handler.user as ActorUser);
    let payload: Record<string, unknown> = {};
    let committed = false;
    try {
        const rawBody = (handler.request.body || {}) as Record<string, unknown>;
        const legacyFields = legacyBodyFields(rawBody);
        if (legacyFields.length) throw new MindmapRequestError(localizedErrorText`旧版写入字段已停用：${legacyFields.join('、')}`);
        payload = parsePayload(payloadJson);
        const mapId = requiredString(payload, 'mapId');
        const expectedMapUpdatedAt = requiredDate(payload, 'expectedMapUpdatedAt');
        if (operation === 'create') {
            assertOnlyKeys(
                payload,
                ['mapId', 'expectedMapUpdatedAt', 'parentId', 'expectedParentUpdatedAt', 'topic', 'description', 'color', 'tags', 'problemIds'],
                '创建请求',
            );
            await createNode({
                domainId,
                actor,
                mapId,
                expectedMapUpdatedAt,
                parentId: requiredString(payload, 'parentId'),
                expectedParentUpdatedAt: requiredDate(payload, 'expectedParentUpdatedAt'),
                topic: payload.topic,
                description: payload.description,
                color: payload.color,
                tags: payload.tags,
                problemIds: payload.problemIds,
            });
        } else if (operation === 'update') {
            assertOnlyKeys(payload, ['mapId', 'expectedMapUpdatedAt', 'id', 'expectedUpdatedAt', 'fields'], '更新请求');
            if (!isPlainObject(payload.fields)) throw new MindmapRequestError(localizedErrorText`fields 必须是对象`);
            await updateNode({
                domainId,
                actor,
                mapId,
                expectedMapUpdatedAt,
                id: requiredString(payload, 'id'),
                expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                patch: payload.fields,
            });
        } else if (operation === 'move') {
            assertOnlyKeys(
                payload,
                ['mapId', 'expectedMapUpdatedAt', 'id', 'newParentId', 'targetIndex', 'layoutSide', 'expectedUpdatedAt', 'expectedParentUpdatedAt'],
                '移动请求',
            );
            if (!Number.isSafeInteger(payload.targetIndex) || Number(payload.targetIndex) < 0) {
                throw new MindmapRequestError(localizedErrorText`targetIndex 无效`);
            }
            if (payload.layoutSide !== undefined && payload.layoutSide !== 'left' && payload.layoutSide !== 'right') {
                throw new MindmapRequestError(localizedErrorText`layoutSide 无效`);
            }
            await moveNode({
                domainId,
                actor,
                mapId,
                expectedMapUpdatedAt,
                id: requiredString(payload, 'id'),
                newParentId: requiredString(payload, 'newParentId'),
                targetIndex: Number(payload.targetIndex),
                layoutSide: payload.layoutSide as 'left' | 'right' | undefined,
                expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                expectedParentUpdatedAt: requiredDate(payload, 'expectedParentUpdatedAt'),
            });
        } else if (operation === 'delete') {
            assertOnlyKeys(payload, ['mapId', 'expectedMapUpdatedAt', 'id', 'expectedUpdatedAt'], '删除请求');
            await deleteNode({
                domainId,
                actor,
                mapId,
                expectedMapUpdatedAt,
                id: requiredString(payload, 'id'),
                expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
            });
        } else {
            throw new MindmapRequestError(localizedErrorText`未知操作：${operation}`);
        }
        committed = true;
        handler.response.body = { ok: true, ...(await finish(mapId)) };
    } catch (error: unknown) {
        const failure = asMutationFailure(error);
        const code = typeof failure.code === 'number' ? failure.code : 500;
        const problemList = failure.params?.[1];
        const affectedProblems =
            problemList && typeof problemList === 'object' && Array.isArray((problemList as { problems?: unknown }).problems)
                ? (problemList as { problems: unknown[] }).problems.length
                : 0;
        const mutationContext = isPlainObject(failure.mindmapMutationContext) ? failure.mindmapMutationContext : {};
        const fromParent = String(mutationContext.fromParent ?? '-');
        const toParent = String(mutationContext.toParent ?? payload.newParentId ?? payload.parentId ?? '-');
        const fromIndex = String(mutationContext.fromIndex ?? '-');
        const toIndex = String(mutationContext.toIndex ?? payload.targetIndex ?? '-');
        const expectedUpdatedAt = String(mutationContext.expectedUpdatedAt ?? payload.expectedUpdatedAt ?? '-');
        const expectedParentUpdatedAt = String(mutationContext.expectedParentUpdatedAt ?? payload.expectedParentUpdatedAt ?? '-');
        const format =
            'Mindmap mutation failed domain=%s actor=%d map=%s operation=%s node=%s fromParent=%s toParent=%s fromIndex=%s toIndex=%s expectedUpdatedAt=%s expectedParentUpdatedAt=%s result=error committed=%s code=%d affectedProblems=%d error=%s';
        const values = [
            domainId,
            actor._id,
            String(payload.mapId || '-'),
            operation,
            String(payload.id || '-'),
            fromParent,
            toParent,
            fromIndex,
            toIndex,
            expectedUpdatedAt,
            expectedParentUpdatedAt,
            committed ? 'yes' : 'no',
            code,
            affectedProblems,
            failure.stack || failure.message || String(error),
        ] as const;
        if (code < 500) logger.warn(format, ...values);
        else logger.error(format, ...values);
        throw error;
    }
}

class MindmapPage extends Handler {
    noCheckPermView = true;

    @param('map', Types.ObjectId, true)
    @param('course', Types.ObjectId, true)
    async get(_args: unknown, mapId?: ObjectId, courseId?: ObjectId) {
        const map = await getMergedMap();
        if (mapId && !map._id.equals(mapId)) {
            this.response.redirect = '/mindmap';
            return;
        }
        const actor = actorOf(this.user as ActorUser);
        const courses = (await listCourseNodes()).filter((course) => canSeeCourseNode(actor, course));
        const selected = courseId ? courses.find((course) => course.id === courseId.toHexString()) : lowestPublicCourse(courses);
        if (courseId && !selected) throw new NotFoundError(localizedErrorText`课程节点`, courseId.toHexString());
        const exposeProblemMetadata = canExposeProblemMetadata(this.user, String(this.domain?._id || ''));
        const nodes = await listAllNodes(map._id);
        const root = nodes.find((node) => node._id.equals(map.rootNodeId));
        if (!root) throw new Error(`mindmap root missing map=${map._id.toHexString()}`);
        const visibleNodes = selected ? [root, ...nodeAndDescendants(nodes, selected.id).filter((node) => !node._id.equals(root._id))] : [root];
        this.response.template = 'mindmap_main.html';
        this.response.body = {
            config: serializeMap(map),
            courses,
            course: selected ? selected.id : null,
            nodes: visibleNodes.map((node) => serializePublicNode(node, exposeProblemMetadata)),
        };
    }
}

class ProblemsApi extends Handler {
    noCheckPermView = true;

    @param('mapId', Types.ObjectId)
    @param('nodeId', Types.ObjectId)
    async get(_args: { domainId: string }, mapId: ObjectId, nodeId: ObjectId) {
        const domainId = String(this.domain?._id);
        const map = await getKnowledgeMap(mapId);
        if (!map) throw new NotFoundError(localizedErrorText`mindmap`, String(mapId));
        let course: CourseNodeView | null;
        try {
            course = await courseNodeOf(nodeId);
        } catch (error: unknown) {
            if (!isAbsentMindmapNode(error)) throw error;
            course = null;
        }
        if (!course || !canSeeCourseNode(actorOf(this.user as ActorUser), course)) {
            throw new NotFoundError(localizedErrorText`导图节点`, nodeId.toHexString());
        }
        const problems = await listProblemsForNode(domainId, mapId, nodeId, {});
        this.response.body = { problems };
    }
}

class AdminBase extends Handler {
    async init() {
        await super.init();
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        logger.warn(
            'Mindmap admin access denied domain=%s actor=%s path=%s result=forbidden',
            String(this.domain?._id),
            String(this.user?._id ?? 'anonymous'),
            this.request.path,
        );
        throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
    }
}

class AdminMindmapPage extends AdminBase {
    @param('map', Types.ObjectId, true)
    async get(_args: unknown, mapId?: ObjectId) {
        this.response.template = 'admin_mindmap.html';
        this.response.body = await adminSnapshot(mapId);
    }
}

class AdminProblemSearchApi extends AdminBase {
    @param('mapId', Types.ObjectId)
    @param('q', Types.String, true)
    async get(_args: unknown, mapId: ObjectId, q = '') {
        const map = await getKnowledgeMap(mapId);
        if (!map) throw new NotFoundError(localizedErrorText`mindmap`, String(mapId));
        this.response.body = { problems: await searchProblemsForAdmin(String(this.domain?._id), mapId, q) };
    }
}

class AdminNodeProblemsApi extends AdminBase {
    @param('mapId', Types.ObjectId)
    @param('nodeId', Types.ObjectId)
    async get(_args: unknown, mapId: ObjectId, nodeId: ObjectId) {
        const map = await getKnowledgeMap(mapId);
        if (!map) throw new NotFoundError(localizedErrorText`mindmap`, String(mapId));
        const problems = await listProblemsForNode(String(this.domain?._id), mapId, nodeId, {}, { includeHidden: true });
        this.response.body = { problems };
    }
}

class AdminMutateNodes extends AdminBase {
    @param('payload', Types.String, true)
    async postCreate(_ctx: unknown, payload?: string) {
        await mutateNodes(this, 'create', payload, (mapId) => adminSnapshot(mapId));
    }

    @param('payload', Types.String, true)
    async postUpdate(_ctx: unknown, payload?: string) {
        await mutateNodes(this, 'update', payload, (mapId) => adminSnapshot(mapId));
    }

    @param('payload', Types.String, true)
    async postMove(_ctx: unknown, payload?: string) {
        await mutateNodes(this, 'move', payload, (mapId) => adminSnapshot(mapId));
    }

    @param('payload', Types.String, true)
    async postDelete(_ctx: unknown, payload?: string) {
        await mutateNodes(this, 'delete', payload, (mapId) => adminSnapshot(mapId));
    }
}

class AdminMutateMaps extends AdminBase {
    @param('payload', Types.String, true)
    async postUpdate(_ctx: unknown, payloadJson?: string) {
        const domainId = String(this.domain?._id);
        const actor = actorOf(this.user as ActorUser);
        let payload: Record<string, unknown> = {};
        try {
            const legacyFields = legacyBodyFields((this.request.body || {}) as Record<string, unknown>);
            if (legacyFields.length) throw new MindmapRequestError(localizedErrorText`旧版导图写入字段已停用：${legacyFields.join('、')}`);
            payload = parsePayload(payloadJson);
            assertOnlyKeys(payload, ['id', 'expectedUpdatedAt', 'fields'], '更新导图请求');
            if (!isPlainObject(payload.fields)) throw new MindmapRequestError(localizedErrorText`fields 必须是对象`);
            const updated = await updateKnowledgeMap({
                domainId,
                actor,
                id: requiredString(payload, 'id'),
                expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                patch: payload.fields,
            });
            this.response.body = { ok: true, ...(await adminSnapshot(updated._id.toHexString())) };
        } catch (error: unknown) {
            const failure = asMutationFailure(error);
            const code = typeof failure.code === 'number' ? failure.code : 500;
            const format = 'Mindmap map mutation failed domain=%s actor=%d map=%s operation=%s result=error code=%d error=%s';
            const values = [domainId, actor._id, String(payload.id || '-'), 'update', code, failure.stack || failure.message || String(error)] as const;
            if (code < 500) logger.warn(format, ...values);
            else logger.error(format, ...values);
            throw error;
        }
    }
}

class AdminCourseNodeSettings extends AdminBase {
    @param('payload', Types.String, true)
    async postSettings(_ctx: unknown, payloadJson?: string) {
        const domainId = String(this.domain?._id);
        const actor = actorOf(this.user as ActorUser);
        let payload: Record<string, unknown> = {};
        try {
            const legacyFields = legacyBodyFields((this.request.body || {}) as Record<string, unknown>);
            if (legacyFields.length) throw new MindmapRequestError(localizedErrorText`旧版课程节点写入字段已停用：${legacyFields.join('、')}`);
            payload = parsePayload(payloadJson);
            assertOnlyKeys(payload, ['nodeId', 'expectedUpdatedAt', 'visibility', 'ownerUids'], '课程节点设置');
            if (payload.visibility !== 'public' && payload.visibility !== 'hidden') {
                throw new MindmapRequestError(localizedErrorText`课程公开状态无效`);
            }
            if (!Array.isArray(payload.ownerUids)) throw new MindmapRequestError(localizedErrorText`负责教师必须是数组`);
            const saved = await setCourseNodeSettings({
                actor,
                nodeId: requiredString(payload, 'nodeId'),
                expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                visibility: payload.visibility,
                ownerUids: payload.ownerUids as number[],
            });
            this.response.body = { ok: true, courseNode: saved, ...(await adminSnapshot()) };
        } catch (error: unknown) {
            const failure = asMutationFailure(error);
            const code = typeof failure.code === 'number' ? failure.code : 500;
            const format = 'Mindmap course node settings failed domain=%s actor=%d node=%s operation=settings result=error code=%d error=%s';
            const values = [domainId, actor._id, String(payload.nodeId || '-'), code, failure.stack || failure.message || String(error)] as const;
            if (code < 500) logger.warn(format, ...values);
            else logger.error(format, ...values);
            throw error;
        }
    }
}

class MindmapCourseEditPage extends Handler {
    @param('nodeId', Types.ObjectId)
    async get(_args: unknown, nodeId: ObjectId) {
        const course = await requireCourseEditor(actorOf(this.user as ActorUser), nodeId, String(this.domain?._id));
        this.response.template = 'mindmap_course_edit.html';
        this.response.body = await courseEditorSnapshot(course);
    }
}

class MindmapCourseNodes extends Handler {
    @param('nodeId', Types.ObjectId)
    @param('payload', Types.String, true)
    async postCreate(_args: unknown, nodeId: ObjectId, payload?: string) {
        await this.mutate('create', nodeId, payload);
    }

    @param('nodeId', Types.ObjectId)
    @param('payload', Types.String, true)
    async postUpdate(_args: unknown, nodeId: ObjectId, payload?: string) {
        await this.mutate('update', nodeId, payload);
    }

    @param('nodeId', Types.ObjectId)
    @param('payload', Types.String, true)
    async postMove(_args: unknown, nodeId: ObjectId, payload?: string) {
        await this.mutate('move', nodeId, payload);
    }

    @param('nodeId', Types.ObjectId)
    @param('payload', Types.String, true)
    async postDelete(_args: unknown, nodeId: ObjectId, payload?: string) {
        await this.mutate('delete', nodeId, payload);
    }

    private async mutate(operation: 'create' | 'update' | 'move' | 'delete', nodeId: ObjectId, payload?: string) {
        const course = await requireCourseEditor(actorOf(this.user as ActorUser), nodeId, String(this.domain?._id));
        await mutateNodes(this, operation, payload, async () => {
            const fresh = (await listCourseNodes()).find((entry) => entry.id === course.id);
            if (fresh) return courseEditorSnapshot(fresh);
            return {
                courseNode: null,
                nodes: [],
                referenceCounts: {},
                config: serializeMap(await getMergedMap()),
            };
        });
    }
}

/** P2.2 remains a permanent explicit tombstone. */
class AdminRebuildGoneHandler extends Handler {
    async post() {
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        this.response.status = 410;
        this.response.body = {
            error: 'rebuild 功能已下线（PLAN P2.2）：多级树由迁移脚本维护，从 problem.categories 重建会摧毁多级结构与挂题。',
        };
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('mindmap_main', '/mindmap', MindmapPage);
    ctx.Route('mindmap_course_edit', '/mindmap/:nodeId/edit', MindmapCourseEditPage);
    ctx.Route('mindmap_course_nodes', '/mindmap/:nodeId/nodes', MindmapCourseNodes);
    ctx.Route('mindmap_api_problems', '/api/mindmap/problems', ProblemsApi);
    ctx.Route('admin_mindmap', '/admin/mindmap', AdminMindmapPage);
    ctx.Route('admin_mindmap_problem_search', '/api/mindmap/admin/problems', AdminProblemSearchApi);
    ctx.Route('admin_mindmap_node_problems', '/api/mindmap/admin/node-problems', AdminNodeProblemsApi);
    ctx.Route('admin_mindmap_nodes', '/admin/mindmap/nodes', AdminMutateNodes);
    ctx.Route('admin_mindmap_maps', '/admin/mindmap/maps', AdminMutateMaps);
    ctx.Route('admin_mindmap_course_nodes', '/admin/mindmap/course-nodes', AdminCourseNodeSettings);
    ctx.Route('admin_mindmap_rebuild', '/admin/mindmap/rebuild', AdminRebuildGoneHandler);
}
