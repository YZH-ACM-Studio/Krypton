/**
 * Routes for the public read-only mindmap and the isolated administrator
 * workspace introduced by PLAN P2.16.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { ForbiddenError, Handler, ObjectId, param, PRIV, PrivilegeError, ProblemModel, Types } from 'hydrooj';
import { MindmapRequestError } from './error';
import {
    createNode,
    deleteNode,
    getConfig,
    getNodeReferenceCounts,
    listAllNodes,
    listProblemsForNode,
    moveNode,
    searchProblemsForAdmin,
    updateNode,
} from './model';
import type { MindmapConfig, MindmapNode } from './types';

const logger = new Logger('krypton-mindmap.handler');

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
        parentId: node.parentId ? node.parentId.toHexString() : null,
        ...(node.createdAt ? { createdAt: new Date(node.createdAt).toISOString() } : {}),
        ...(node.updatedAt ? { updatedAt: new Date(node.updatedAt).toISOString() } : {}),
    };
}

function serializeConfig(config: MindmapConfig) {
    return {
        ...config,
        rootNodeId: config.rootNodeId ? config.rootNodeId.toHexString() : null,
        ...(config.updatedAt ? { updatedAt: new Date(config.updatedAt).toISOString() } : {}),
    };
}

async function adminSnapshot() {
    const [nodes, config] = await Promise.all([listAllNodes(), getConfig()]);
    const referenceCounts = await getNodeReferenceCounts(nodes);
    return { nodes: nodes.map(serializeNode), config: serializeConfig(config), referenceCounts };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parsePayload(payload: string | undefined): Record<string, unknown> {
    if (!payload) throw new MindmapRequestError('缺少操作数据');
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        throw new MindmapRequestError('操作数据不是有效 JSON');
    }
    if (!isPlainObject(parsed)) throw new MindmapRequestError('操作数据必须是对象');
    return parsed;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
    const value = payload[field];
    if (typeof value !== 'string' || !value.trim()) throw new MindmapRequestError(`${field} 必填`);
    return value;
}

function requiredDate(payload: Record<string, unknown>, field: string): Date {
    const raw = requiredString(payload, field);
    const value = new Date(raw);
    if (Number.isNaN(value.getTime()) || value.toISOString() !== raw) throw new MindmapRequestError(`${field} 无效`);
    return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new MindmapRequestError(`${label}包含不支持的字段：${unknown.join('、')}`);
}

class MindmapPage extends Handler {
    noCheckPermView = true;
    async get() {
        const exposeProblemMetadata = canExposeProblemMetadata(this.user as any, String(this.domain?._id || ''));
        const [nodes, config] = await Promise.all([listAllNodes(), getConfig()]);
        this.response.template = 'mindmap_main.html';
        this.response.body = {
            nodes: nodes.map((node) => ({
                ...serializeNode(node),
                // Manual associations can include hidden or otherwise scoped
                // problems. The public page resolves related problems through
                // ProblemsApi, so raw PIDs never belong in its bootstrap.
                problemIds: [],
                ...(exposeProblemMetadata ? {} : { tags: [] }),
            })),
            config: serializeConfig(config),
        };
    }
}

class ProblemsApi extends Handler {
    noCheckPermView = true;
    @param('nodeId', Types.ObjectId)
    async get(_args: { domainId: string }, nodeId: ObjectId) {
        const domainId = String(this.domain?._id);
        ProblemModel.assertProblemAclDomain(this.user as any, domainId);
        if (!ProblemModel.canBrowseProblemBank(this.user as any)) throw new ForbiddenError();
        const scope = ProblemModel.buildProblemBankScope(this.user as any);
        const problems = await listProblemsForNode(domainId, nodeId, scope);
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
    async get() {
        this.response.template = 'admin_mindmap.html';
        this.response.body = await adminSnapshot();
    }
}

class AdminProblemSearchApi extends AdminBase {
    @param('q', Types.String, true)
    async get(_args: unknown, q = '') {
        this.response.body = { problems: await searchProblemsForAdmin(String(this.domain?._id), q) };
    }
}

class AdminNodeProblemsApi extends AdminBase {
    @param('nodeId', Types.ObjectId)
    async get(_args: unknown, nodeId: ObjectId) {
        const problems = await listProblemsForNode(String(this.domain?._id), nodeId, {}, { includeHidden: true });
        this.response.body = { problems };
    }
}

class AdminMutateNodes extends AdminBase {
    private async mutate(operation: 'create' | 'update' | 'move' | 'delete', payloadJson?: string) {
        const domainId = String(this.domain?._id);
        const actor = Number(this.user._id);
        let payload: Record<string, unknown> = {};
        let committed = false;
        try {
            const rawBody = (this.request.body || {}) as Record<string, unknown>;
            const legacyFields = Object.keys(rawBody).filter((key) => !['operation', 'payload', '_csrf'].includes(key));
            if (legacyFields.length) throw new MindmapRequestError(`旧版写入字段已停用：${legacyFields.join('、')}`);
            payload = parsePayload(payloadJson);
            if (operation === 'create') {
                assertOnlyKeys(payload, ['parentId', 'expectedParentUpdatedAt', 'topic', 'description', 'color', 'tags', 'problemIds'], '创建请求');
                await createNode({
                    domainId,
                    actor,
                    parentId: requiredString(payload, 'parentId'),
                    expectedParentUpdatedAt: requiredDate(payload, 'expectedParentUpdatedAt'),
                    topic: payload.topic,
                    description: payload.description,
                    color: payload.color,
                    tags: payload.tags,
                    problemIds: payload.problemIds,
                });
            } else if (operation === 'update') {
                assertOnlyKeys(payload, ['id', 'expectedUpdatedAt', 'fields'], '更新请求');
                if (!isPlainObject(payload.fields)) throw new MindmapRequestError('fields 必须是对象');
                await updateNode({
                    domainId,
                    actor,
                    id: requiredString(payload, 'id'),
                    expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                    patch: payload.fields,
                });
            } else if (operation === 'move') {
                assertOnlyKeys(
                    payload,
                    ['id', 'newParentId', 'targetIndex', 'layoutSide', 'expectedUpdatedAt', 'expectedParentUpdatedAt'],
                    '移动请求',
                );
                if (!Number.isSafeInteger(payload.targetIndex) || Number(payload.targetIndex) < 0) throw new MindmapRequestError('targetIndex 无效');
                if (payload.layoutSide !== undefined && payload.layoutSide !== 'left' && payload.layoutSide !== 'right') {
                    throw new MindmapRequestError('layoutSide 无效');
                }
                await moveNode({
                    domainId,
                    actor,
                    id: requiredString(payload, 'id'),
                    newParentId: requiredString(payload, 'newParentId'),
                    targetIndex: Number(payload.targetIndex),
                    layoutSide: payload.layoutSide as 'left' | 'right' | undefined,
                    expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                    expectedParentUpdatedAt: requiredDate(payload, 'expectedParentUpdatedAt'),
                });
            } else if (operation === 'delete') {
                assertOnlyKeys(payload, ['id', 'expectedUpdatedAt'], '删除请求');
                await deleteNode({
                    domainId,
                    actor,
                    id: requiredString(payload, 'id'),
                    expectedUpdatedAt: requiredDate(payload, 'expectedUpdatedAt'),
                });
            } else {
                throw new MindmapRequestError(`未知操作：${operation}`);
            }
            committed = true;
            this.response.body = { ok: true, ...(await adminSnapshot()) };
        } catch (error: any) {
            const code = typeof error?.code === 'number' ? error.code : 500;
            const affectedProblems = Array.isArray(error?.params?.[1]?.problems) ? error.params[1].problems.length : 0;
            const mutationContext = isPlainObject(error?.mindmapMutationContext) ? error.mindmapMutationContext : {};
            const fromParent = String(mutationContext.fromParent ?? '-');
            const toParent = String(mutationContext.toParent ?? payload.newParentId ?? payload.parentId ?? '-');
            const fromIndex = String(mutationContext.fromIndex ?? '-');
            const toIndex = String(mutationContext.toIndex ?? payload.targetIndex ?? '-');
            const expectedUpdatedAt = String(mutationContext.expectedUpdatedAt ?? payload.expectedUpdatedAt ?? '-');
            const expectedParentUpdatedAt = String(
                mutationContext.expectedParentUpdatedAt ?? payload.expectedParentUpdatedAt ?? '-',
            );
            const format =
                'Mindmap mutation failed domain=%s actor=%d operation=%s node=%s fromParent=%s toParent=%s fromIndex=%s toIndex=%s expectedUpdatedAt=%s expectedParentUpdatedAt=%s result=error committed=%s code=%d affectedProblems=%d error=%s';
            const values = [
                domainId,
                actor,
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
                error?.stack || error?.message || String(error),
            ] as const;
            if (code < 500) logger.warn(format, ...values);
            else logger.error(format, ...values);
            throw error;
        }
    }

    @param('payload', Types.String, true)
    async postCreate(_ctx: unknown, payload?: string) {
        await this.mutate('create', payload);
    }

    @param('payload', Types.String, true)
    async postUpdate(_ctx: unknown, payload?: string) {
        await this.mutate('update', payload);
    }

    @param('payload', Types.String, true)
    async postMove(_ctx: unknown, payload?: string) {
        await this.mutate('move', payload);
    }

    @param('payload', Types.String, true)
    async postDelete(_ctx: unknown, payload?: string) {
        await this.mutate('delete', payload);
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
    ctx.Route('mindmap_api_problems', '/api/mindmap/problems', ProblemsApi);
    ctx.Route('admin_mindmap', '/admin/mindmap', AdminMindmapPage);
    ctx.Route('admin_mindmap_problem_search', '/api/mindmap/admin/problems', AdminProblemSearchApi);
    ctx.Route('admin_mindmap_node_problems', '/api/mindmap/admin/node-problems', AdminNodeProblemsApi);
    ctx.Route('admin_mindmap_nodes', '/admin/mindmap/nodes', AdminMutateNodes);
    ctx.Route('admin_mindmap_rebuild', '/admin/mindmap/rebuild', AdminRebuildGoneHandler);
}
