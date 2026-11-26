import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createDraftConfig, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS } from '@hydrooj/common';
import { ContestNotFoundError, DiscussionNodeNotFoundError } from '../src/error';
import type { Tdoc } from '../src/interface';
import type { User } from '../src/model/user';

global.Hydro ||= { model: {} } as typeof global.Hydro;
const tid = new ObjectId();
let tdoc: Tdoc;
let loadError: Error | null = null;
const TYPE_CONTEST = 30;
const TYPE_NODE = 20;
const Module = require('node:module');
const originalLoad = Module._load;
const discussionPath = require.resolve('../src/model/discussion.ts');
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (parent.filename === discussionPath) {
        if (request === '../context') return {};
        if (request === '../service/db') return { __esModule: true, default: { collection: () => ({}) } };
        if (request === '../service/bus') return { default: {} };
        if (request === '../utils') return { buildProjection: () => ({}) };
        if (request === './document') {
 return { TYPE_CONTEST, TYPE_DISCUSSION_NODE: TYPE_NODE,
            get: async () => ({ title: '普通讨论', hidden: false }) };
}
        if (request === './contest') {
 return {
            get: async () => { if (loadError) throw loadError; return tdoc; },
            requirePublishedForStudent: (doc: Tdoc, manager: boolean) => {
                if (!manager && doc.setConfig.publication !== 'published') throw new ContestNotFoundError('system', tid);
            },
            studentRecordHitsContestScope: async () => true,
            getStatus: async () => ({ attend: 1 }), RULES: { exam: {} },
        };
}
        if (request === './problem') return { default: {} };
        if (request === './training' || request === './problem-set-access' || request === './homework-access') return {};
        if (request === '../lib/container-visibility') return { decideContainerVisibility: async () => undefined };
        if (request === '../lib/set-problem-access') return { projectCurrentSetTdoc: async (doc: Tdoc) => doc };
    }
    return originalLoad.call(this, request, parent, main);
};
let discussion: typeof import('../src/model/discussion');
try {
    discussion = require(discussionPath);
} finally {
    Module._load = originalLoad;
}
const student = { _id: 7, group: [], own: () => false, hasPerm: () => false, hasPriv: () => false } as unknown as User;
const posts = [{ parentType: TYPE_NODE, parentId: 'public' }, { parentType: TYPE_CONTEST, parentId: tid }];

beforeEach(() => {
    const setConfig = { ...createDraftConfig('exam'), publication: 'published' as const };
    setConfig.settings.experience = { ...SET_EXPERIENCE_DEFAULTS };
    setConfig.settings.authorization = { defaults: { ...SET_DEFAULT_PERMISSIONS }, groups: [] };
    tdoc = { domainId: 'system', docId: tid, owner: 1, rule: 'exam', setConfig,
        beginAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 60_000) } as Tdoc;
    loadError = null;
});

describe('problem set discussion visibility', () => {
    it('filters disabled, hidden, ended and unpublished set discussions without breaking the global list', async () => {
        const settings = tdoc.setConfig.settings;
        for (const change of [
            () => { settings.experience!.discussion = false; },
            () => { settings.experience!.discussion = true; settings.authorization!.defaults.problems = 'hidden'; },
            () => {
                settings.authorization!.defaults.problems = 'view';
                settings.authorization!.defaults.afterEnd = false;
                tdoc.endAt = new Date(0);
            },
            () => { tdoc.setConfig.publication = 'draft'; },
        ]) {
            change();
            const nodes = await discussion.getListVnodes('system', posts, student);
            assert.deepEqual(discussion.filterDiscussionsByVnodes(posts, nodes), [posts[0]]);
            await assert.rejects(() => discussion.getVnode('system', TYPE_CONTEST, tid.toHexString(), student), DiscussionNodeNotFoundError);
        }
    });

    it('keeps enabled discussions and manager access visible', async () => {
        const nodes = await discussion.getListVnodes('system', posts, student);
        assert.deepEqual(discussion.filterDiscussionsByVnodes(posts, nodes), posts);
        tdoc.setConfig.settings.experience!.discussion = false;
        const manager = { ...student, hasPriv: () => true } as User;
        const managed = await discussion.getListVnodes('system', posts, manager);
        assert.deepEqual(discussion.filterDiscussionsByVnodes(posts, managed), posts);
    });

    it('propagates malformed configuration and database errors', async () => {
        tdoc.setConfig.settings.experience!.discussion = 'invalid' as unknown as boolean;
        await assert.rejects(() => discussion.getListVnodes('system', posts, student), TypeError);
        loadError = new Error('database unavailable');
        await assert.rejects(() => discussion.getListVnodes('system', posts, student), loadError);
    });
});
