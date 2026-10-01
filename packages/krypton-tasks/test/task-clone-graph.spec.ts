import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

const {
    localizeError,
    localizedErrorText,
    ForbiddenError,
    NotFoundError,
    PermissionError,
    ValidationError,
} = require('../../hydrooj/src/error');

const Module = require('module');
const modelPath = require.resolve('../src/model.ts');
const originalLoad = Module._load;

const domainId = 'system';
const actorUid = 21;
const groupId = new ObjectId('66d220000000000000000011');
const upperTargetId = groupId.toHexString().toUpperCase();
const lowerTargetId = groupId.toHexString();

function idHex(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const toHexString = (value as { toHexString?: unknown }).toHexString;
    if (typeof toHexString !== 'function') return '';
    const hex = toHexString.call(value);
    return typeof hex === 'string' ? hex : '';
}

function membershipGraph(targetId: string) {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            {
                id: 'member',
                type: 'task',
                position: { x: 40, y: 80 },
                presetId: 'group_membership',
                name: '属于指定用户组',
                params: { scope: 'user_group', targetId },
            },
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

const sourceGraph = membershipGraph(upperTargetId);
const source = {
    _id: new ObjectId('66d2200000000000000000aa'),
    domainId,
    title: '已有任务',
    description: '',
    tags: [] as string[],
    graph: sourceGraph,
    access: { type: 'public' as const },
    maxAssignments: null,
    countsAsStay: false,
    admissionMode: 'auto' as const,
    quota: null,
};
const tasks = [source];
const inserted: Array<{ graph?: { nodes?: Array<{ presetId?: string; params?: { targetId?: unknown } }> } }> = [];

const tasksColl = {
    async findOne(query: { domainId?: string; _id?: unknown }) {
        return tasks.find((doc) => doc.domainId === query.domainId && idHex(doc._id) === idHex(query._id)) ?? null;
    },
    async insertOne(doc: (typeof inserted)[number]) {
        inserted.push(doc);
        return { acknowledged: true, insertedId: (doc as { _id?: unknown })._id };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modelPath) {
        if (request === './db') return { tasksColl };
        if (request === './presets') return { runChecker: async () => undefined, taskPointPresets: {} };
        if (request === '@hydrooj/krypton-userbind') return { userBindModel: {} };
        if (request === 'hydrooj') {
            return {
                ObjectId,
                localizeError,
                localizedErrorText,
                ForbiddenError,
                NotFoundError,
                PermissionError,
                ValidationError,
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let taskModel: {
    cloneTask(domainId: string, sourceId: ObjectId, actorUid: number, graph: ReturnType<typeof membershipGraph>): Promise<ObjectId | null>;
};
try {
    delete require.cache[modelPath];
    ({ taskModel } = require(modelPath));
} finally {
    Module._load = originalLoad;
}

function membershipTarget(graph: { nodes?: Array<{ presetId?: string; params?: { targetId?: unknown } }> } | undefined) {
    const node = graph?.nodes?.find((item) => item.presetId === 'group_membership');
    if (!node?.params) throw new Error('missing group_membership node');
    return node.params.targetId;
}

describe('task clone graph persistence', () => {
    it('cloneTask 把传入的小写图写入副本，不把源图的大写 targetId 落库', async () => {
        inserted.length = 0;
        const lookupId = new ObjectId(source._id.toHexString());
        const normalized = membershipGraph(lowerTargetId);
        const createdId = await taskModel.cloneTask(domainId, lookupId, actorUid, normalized);

        expect(idHex(lookupId)).to.equal(idHex(source._id));
        expect(lookupId).to.not.equal(source._id);
        expect(createdId).to.be.instanceOf(ObjectId);
        expect(inserted).to.have.length(1);
        expect(membershipTarget(inserted[0].graph)).to.equal(lowerTargetId);
        expect(inserted[0].graph).to.not.equal(source.graph);
        expect(membershipTarget(source.graph)).to.equal(upperTargetId);
    });
});
