/**
 * Route handlers for krypton-mindmap.
 *
 *   GET  /mindmap                          MindmapPage (public; node tree)
 *   GET  /api/mindmap/problems             ProblemsApi (JSON; problems for a node)
 *   POST /admin/mindmap/nodes              AdminMutateNodes (create/update/delete/move/position)
 *   POST /admin/mindmap/config             AdminConfig (title / layoutDirection / reset)
 */
import type { Context } from 'hydrooj';
import {
    Handler, NotFoundError, ObjectId, param, PRIV, PrivilegeError, Types,
} from 'hydrooj';
import {
    clearAllPositions,
    createNode, deleteNodeRecursive, getConfig, getNode, listAllNodes,
    listProblemsForNode, moveNode, setConfig, setNodePosition, updateNode,
} from './model';

class MindmapPage extends Handler {
    noCheckPermView = true;
    async get() {
        const [nodes, config] = await Promise.all([
            listAllNodes(),
            getConfig(),
        ]);
        this.response.template = 'mindmap_main.html';
        this.response.body = {
            nodes: nodes.map((n) => ({
                ...n,
                _id: String(n._id),
                parentId: n.parentId ? String(n.parentId) : null,
            })),
            config: {
                ...config,
                rootNodeId: config.rootNodeId ? String(config.rootNodeId) : null,
            },
        };
    }
}

class ProblemsApi extends Handler {
    noCheckPermView = true;
    @param('nodeId', Types.ObjectId)
    async get({ domainId }: { domainId: string }, nodeId: ObjectId) {
        const problems = await listProblemsForNode(domainId, nodeId);
        this.response.body = { problems };
    }
}

class AdminBase extends Handler {
    async prepare() {
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        }
    }
}

class AdminMutateNodes extends AdminBase {
    @param('operation', Types.String)
    @param('id', Types.ObjectId, true)
    @param('parentId', Types.ObjectId, true)
    @param('topic', Types.String, true)
    @param('description', Types.String, true)
    @param('color', Types.String, true)
    @param('tagsCsv', Types.String, true)
    @param('problemIdsCsv', Types.String, true)
    @param('newParentId', Types.ObjectId, true)
    @param('order', Types.Int, true)
    @param('x', Types.Float, true)
    @param('y', Types.Float, true)
    async post(
        _ctx: any, operation: string,
        id?: ObjectId, parentId?: ObjectId,
        topic?: string, description?: string, color?: string,
        tagsCsv?: string, problemIdsCsv?: string,
        newParentId?: ObjectId, order?: number,
        x?: number, y?: number,
    ) {
        const tags = tagsCsv ? tagsCsv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        const problemIds = problemIdsCsv
            ? problemIdsCsv.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined;

        switch (operation) {
            case 'create': {
                if (!parentId || !topic) throw new Error('parentId + topic required');
                const node = await createNode({
                    parentId, topic, tags, problemIds, description, color,
                });
                this.response.body = {
                    node: {
                        ...node,
                        _id: String(node._id),
                        parentId: String(node.parentId),
                    },
                };
                return;
            }
            case 'update': {
                if (!id) throw new Error('id required');
                const patch: any = {};
                if (topic !== undefined) patch.topic = topic;
                if (description !== undefined) patch.description = description;
                if (color !== undefined) patch.color = color;
                if (tags !== undefined) patch.tags = tags;
                if (problemIds !== undefined) patch.problemIds = problemIds;
                await updateNode(id, patch);
                break;
            }
            case 'delete': {
                if (!id) throw new Error('id required');
                const config = await getConfig();
                if (config.rootNodeId && String(config.rootNodeId) === String(id)) {
                    throw new Error('cannot delete root');
                }
                await deleteNodeRecursive(id);
                break;
            }
            case 'move': {
                if (!id || !newParentId) throw new Error('id + newParentId required');
                await moveNode(id, newParentId, order);
                break;
            }
            case 'setPosition': {
                if (!id) throw new Error('id required');
                if (x == null || y == null) {
                    await setNodePosition(id, null);
                } else {
                    await setNodePosition(id, { x, y });
                }
                break;
            }
            default:
                throw new Error(`unknown operation: ${operation}`);
        }
        this.response.body = { ok: true };
    }
}

class AdminConfig extends AdminBase {
    @param('operation', Types.String)
    @param('title', Types.String, true)
    @param('layoutDirection', Types.String, true)
    async post(_ctx: any, operation: string, title?: string, layoutDirection?: string) {
        if (operation === 'config') {
            const patch: any = {};
            if (title !== undefined) patch.title = title;
            if (layoutDirection === 'RIGHT' || layoutDirection === 'DOWN') {
                patch.layoutDirection = layoutDirection;
            }
            await setConfig(patch);
        } else if (operation === 'resetLayout') {
            await clearAllPositions();
        } else {
            throw new Error(`unknown operation: ${operation}`);
        }
        this.response.body = { ok: true };
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('mindmap_main', '/mindmap', MindmapPage);
    ctx.Route('mindmap_api_problems', '/api/mindmap/problems', ProblemsApi);
    ctx.Route('admin_mindmap_nodes', '/admin/mindmap/nodes', AdminMutateNodes);
    ctx.Route('admin_mindmap_config', '/admin/mindmap/config', AdminConfig);
}
