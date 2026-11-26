import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { PERM, PRIV } from '@hydrooj/common';

const Module = require('node:module');
const handlerPath = require.resolve('../src/signing-handler');
const schoolId = new ObjectId();
const firstGroup = new ObjectId();
const secondGroup = new ObjectId();
const unrelatedGroup = new ObjectId();
const request = {
    _id: new ObjectId(), kind: 'signing', ownerUid: 2, collaboratorUids: [3],
    title: '安全知情书', schoolId, groupIds: [firstGroup, secondGroup],
    status: 'published', revision: 1, dueAt: new Date('2026-12-01'),
};
const groups = [
    { _id: String(firstGroup), schoolId: String(schoolId), name: '一班' },
    { _id: String(secondGroup), schoolId: String(schoolId), name: '二班', archivedAt: '2026-10-01T00:00:00.000Z' },
    { _id: String(unrelatedGroup), schoolId: String(schoolId), name: '其它组' },
];
let groupReads = 0;
let schoolReads = 0;
class HandlerStub {
    user = { _id: 3, hasPriv: (_priv: number) => false, hasPerm: (_perm: bigint) => false };
    response = { body: {} as Record<string, unknown>, template: '' };
    url(name: string, args: { id: ObjectId }) { return `/${name}/${args.id}`; }
}
type SigningHandler = HandlerStub & { get(domainId: string, id?: ObjectId): Promise<void> };
const routes = new Map<string, new () => SigningHandler>();
const originalLoad = Module._load;
try {
    Module._load = function load(name: string, parent: { filename?: string }, isMain: boolean) {
        if (name === 'hydrooj' && parent?.filename?.includes('krypton-collect/src')) {
            return {
                ObjectId, PERM, PRIV, Handler: HandlerStub, Types: { ObjectId },
                param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
                CreateError: require('../../../framework/framework').CreateError,
                ForbiddenError: require('../../../framework/framework').ForbiddenError,
                NotFoundError: require('../../../framework/framework').NotFoundError,
                UserFacingError: require('../../../framework/framework').UserFacingError,
            };
        }
        if (parent?.filename === handlerPath) {
            if (name === './model') {
                return {
                userbindOrThrow: async () => ({ listSchools: async () => { schoolReads++; return [{ _id: schoolId, name: '学校' }]; } }),
                listCollectEditorGroups: async () => { groupReads++; return groups; },
                };
            }
            if (name === './signing-model') {
                return {
                signingRequest: async () => request,
                signingProgress: async () => ({ rows: [], files: [] }),
                };
            }
            if (name === './signing-pdf') return {};
            if (name === './handler') return { assertNotBoundClient: async () => {} };
        }
        return originalLoad.call(this, name, parent, isMain);
    };
    require(handlerPath).applySigningHandlers({
        Route(name: string, _path: string, handlerClass: new () => SigningHandler) { routes.set(name, handlerClass); },
    });
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    groupReads = 0;
    schoolReads = 0;
});
function handler(uid: number, administrator = false) {
    const Class = routes.get('admin_collect_sign');
    assert.ok(Class);
    const result = new Class();
    result.user = {
        _id: uid,
        hasPriv: (priv) => administrator && priv === PRIV.PRIV_EDIT_SYSTEM,
        hasPerm: (perm) => perm === PERM.PERM_CREATE_COLLECT,
    };
    return result;
}

describe('signing administrator group projections', () => {
    it('gives a collaborator only the selected groups, including an archived group, without a school catalog', async () => {
        const h = handler(3);
        await h.get('system', request._id);
        assert.deepEqual(h.response.body.groups, [
            { id: String(firstGroup), schoolId: String(schoolId), name: '一班' },
            { id: String(secondGroup), schoolId: String(schoolId), name: '二班（已归档）' },
        ]);
        assert.deepEqual(h.response.body.schools, []);
        assert.equal(schoolReads, 0);
    });

    it('preserves the administrator group catalog for activity settings', async () => {
        const h = handler(2, true);
        await h.get('system', request._id);
        assert.equal((h.response.body.groups as unknown[]).length, 3);
        assert.equal(schoolReads, 1);
    });

    it('rejects outsiders before loading any group metadata', async () => {
        await assert.rejects(handler(4).get('system', request._id), { name: 'CollectForbiddenError' });
        assert.equal(groupReads, 0);
        assert.equal(schoolReads, 0);
    });
});
