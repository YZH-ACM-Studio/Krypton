import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createDraftConfig, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import type { TeachActor } from '../src/lib/teach-permissions';

global.Hydro ||= { model: {} } as typeof global.Hydro;
const groupId = new ObjectId('64b000000000000000000001');
let groupIds: ObjectId[] = [];
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (request === '../service/student-directory' && parent.filename.endsWith('/set-permissions.ts')) {
        return {
            studentDirectory: () => ({
                findStudentByUserId: async (domainId: string, uid: number) => {
                    assert.equal(domainId, 'system');
                    assert.equal(uid, 7);
                    return { groupIds };
                },
            }),
        };
    }
    return originalLoad.call(this, request, parent, main);
};
let policy: typeof import('../src/lib/set-permissions');
try {
    policy = require('../src/lib/set-permissions');
} finally {
    Module._load = originalLoad;
}

const student: TeachActor = { _id: 7, own: () => false, hasPerm: () => false, hasPriv: () => false };
let doc: Tdoc;
beforeEach(() => {
    const setConfig = createDraftConfig('exam');
    setConfig.publication = 'published';
    setConfig.settings.authorization = {
        defaults: { ...SET_DEFAULT_PERMISSIONS },
        groups: [{ groupId: groupId.toHexString(), problems: 'view', records: 'list', scoreboard: false, afterEnd: false }],
    };
    doc = {
        _id: new ObjectId(),
        docId: new ObjectId(),
        docType: 30,
        domainId: 'system',
        owner: 1,
        title: 'Exam',
        content: '',
        rule: 'exam',
        pids: [1],
        duration: 0,
        attend: 1,
        beginAt: new Date('2099-01-01T10:00:00Z'),
        endAt: new Date('2099-01-01T12:00:00Z'),
        setConfig,
    };
    groupIds = [groupId];
});

describe('canonical set group authorization', () => {
    it('distinguishes viewing, answering, listing others and reading their code', async () => {
        assert.equal(await policy.canUseSetCapability(doc, student, 'view'), true);
        assert.equal(await policy.canUseSetCapability(doc, student, 'answer'), false);
        assert.equal(await policy.canUseSetCapability(doc, student, 'recordsList'), true);
        assert.equal(await policy.canUseSetCapability(doc, student, 'recordDetails'), false);
        assert.equal(await policy.canUseSetCapability(doc, student, 'scoreboard'), false);
        doc.setConfig.settings.authorization!.groups[0].records = 'details';
        assert.equal(await policy.canUseSetCapability(doc, student, 'recordDetails'), true);
    });
    it('closes every capability at the deadline when post-end access is disabled', async () => {
        for (const capability of ['view', 'answer', 'selfRecords', 'recordsList', 'recordDetails', 'scoreboard'] as const) {
            assert.equal(await policy.canUseSetCapability(doc, student, capability, doc.endAt), false);
        }
    });
    it('uses default permissions after canonical group removal and preserves manager access', async () => {
        groupIds = [];
        assert.equal(await policy.canUseSetCapability(doc, student, 'answer'), true);
        assert.equal(await policy.canUseSetCapability(doc, student, 'recordsList'), false);
        assert.equal(await policy.canUseSetCapability(doc, { ...student, hasPriv: () => true }, 'answer', doc.endAt), true);
    });
    it('blocks disabled discussion at its server boundary', async () => {
        doc.setConfig.settings.experience = { ...SET_EXPERIENCE_DEFAULTS, discussion: false };
        await assert.rejects(policy.assertSetDiscussion(doc, student));
        await policy.assertSetDiscussion(doc, { ...student, hasPriv: () => true });
    });
});
