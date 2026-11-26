import { rejects } from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { buildDraftFields, createDraftConfig, SET_EXPERIENCE_DEFAULTS, SET_DEFAULT_PERMISSIONS } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};
const host = globalThis as unknown as { Hydro?: { model: Record<string, unknown> } };
host.Hydro ||= { model: {} };
const target = require.resolve('../src/handler/set-settings.ts');
const id = new ObjectId('64b000000000000000000077');
const writes: Array<Partial<Tdoc>> = [];
const schedules: Array<{ domain: string; id: ObjectId; end: Date; pids: number[] }> = [];
let rounds = 0;
let recalcCalls = 0;
let failRecalc = false;
let current: Tdoc;
let rejectGroups = false;
const groupChecks: unknown[] = [];

interface SettingsHandler {
    domain: { _id: string };
    user: { _id: number; hasPriv: () => boolean };
    args: Record<string, unknown>;
    request: { body: Record<string, unknown> };
    response: { body?: Record<string, unknown>; template?: string | null };
    checkPriv: () => void;
    get: (domain: string, type: string, id: string) => Promise<void>;
    post: (domain: string, type: string, id: string) => Promise<void>;
}
let HandlerClass: new () => SettingsHandler;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (parent?.filename !== target) return originalLoad.call(this, request, parent, isMain);
    if (request === './contest') return { scheduleContestUnhide: async (domain: string, tid: ObjectId, end: Date, pids: number[]) => { schedules.push({ domain, id: tid, end, pids }); } };
    if (request === '../service/server') {
 return {
        Handler: class {},
        param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
        Types: { String: {} },
    };
}
    if (request === '../lib/teach-access') return { assertTeachManage: async () => undefined };
    if (request === '../lib/user-group-attach') {
 return { listAttachableGroups: async () => [], describeGroupRefs: async () => [], assertGroupsAttachable: async (...args: unknown[]) => {
 groupChecks.push(args);
      if (rejectGroups) throw new Error('group forbidden');
      } };
}
    if (request === '../model/setting') return { langs: { cc: { display: 'C++' } } };
    if (request === '../lib/set-publish-facts') return { loadSetPublishFacts: async () => { throw new Error('unexpected publish facts'); } };
    if (request === '../model/contest') {
 return {
        get: async () => current,
        edit: async (_domain: string, _id: ObjectId, patch: Partial<Tdoc>) => {
            writes.push(patch);
            current = { ...current, ...patch };
        },
        recalcConfiguredSet: async () => {
            recalcCalls += 1;
            if (failRecalc) throw new Error('fixture recalc failure');
            delete current.statusRecalcToken;
        },
    };
}
    if (request === '../service/db') return { __esModule: true, default: { collection: () => ({ countDocuments: async () => rounds }) } };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    const module = require(target) as { apply: (ctx: { Route: (...args: unknown[]) => void }) => Promise<void> };
    void module.apply({ Route: (_name, _path, ctor) => { HandlerClass = ctor as new () => SettingsHandler; } });
} finally {
    Module._load = originalLoad;
}

function handler(body: Record<string, unknown> = {}): SettingsHandler {
    return Object.assign(new HandlerClass(), {
        domain: { _id: 'system' }, user: { _id: 7, hasPriv: () => true }, args: {}, request: { body }, response: {}, checkPriv() {},
    });
}

beforeEach(() => {
    writes.length = 0;
    groupChecks.length = 0;
    rejectGroups = false;
    schedules.length = 0;
    rounds = 0;
    recalcCalls = 0;
    failRecalc = false;
    current = {
        _id: id, docId: id, domainId: 'system', docType: 30, owner: 7,
        rule: 'contest', title: 'Draft', content: '', pids: [], attend: 0,
        beginAt: new Date('2099-01-01T00:00:00Z'), endAt: new Date('2099-01-01T02:00:00Z'), duration: 0,
        setConfig: createDraftConfig('contest'), unlocked: true, allowPrint: false, allowVirtual: false,
    };
});

describe('set settings persistence', () => {
    (['homework', 'exam', 'contest'] as const).forEach((purpose) => {
        it(`loads an unscheduled ${purpose} draft, saves policies and initializes its first window`, async () => {
            Object.assign(current, buildDraftFields(purpose, 'New draft'));
            Reflect.deleteProperty(current, 'beginAt');
            Reflect.deleteProperty(current, 'endAt');
            current.autoHide = purpose === 'contest';
            const type = purpose === 'homework' ? 'homework' : 'exam';
            const get = handler();
            await get.get('system', type, String(id));
            const basic = { title: 'New draft', content: '', beginAt: null, endAt: null, maintainer: [], hidden: false };
            expect(get.response.body.basic).to.deep.equal(basic);
            const settings = { ...current.setConfig.settings, codePolicy: 'last' };
            await handler({ basic, settings, expectedRevision: current.setConfig.revision }).post('system', type, String(id));
            expect(current.setConfig.settings.codePolicy).to.equal('last');
            expect(writes[0]).not.to.have.property('beginAt');
            expect(schedules).to.have.length(0);
            const window = { beginAt: '2099-01-02T00:00:00.000Z', endAt: '2099-01-02T02:00:00.000Z' };
            const firstWindow = handler({ basic: { ...basic, ...window }, settings, expectedRevision: current.setConfig.revision });
            await firstWindow.post('system', type, String(id));
            expect(writes).to.have.length(2);
            expect(current.beginAt).to.deep.equal(new Date(window.beginAt));
            expect(current.endAt).to.deep.equal(new Date(window.endAt));
            expect(firstWindow.response.body.basic).to.deep.equal({ ...basic, ...window });
        });
    });

    it('saves basic metadata and independent settings in one versioned write', async () => {
        const get = handler();
        await get.get('system', 'exam', String(id));
        expect(get.response.body.basic).to.deep.equal({
            title: 'Draft', content: '', beginAt: current.beginAt.toISOString(), endAt: current.endAt.toISOString(),
            maintainer: [], hidden: false,
        });
        const basic = { ...get.response.body.basic as object, title: 'New title', content: 'Instructions', maintainer: [8], hidden: true };
        const settings = { ...current.setConfig.settings, codePolicy: 'last' };
        const post = handler({ basic, settings, expectedRevision: current.setConfig.revision });
        await post.post('system', 'exam', String(id));
        expect(writes).to.have.length(1);
        expect(current).to.include({ title: 'New title', content: 'Instructions', hidden: true });
        expect(current.maintainer).to.deep.equal([8]);
        expect(current.setConfig.settings.codePolicy).to.equal('last');
        expect(post.response.body.basic).to.deep.equal(basic);
    });

    it('rejects invalid basic fields, unknown fields, settings and stale revisions without partial saves', async () => {
        const basic = { title: 'Changed', content: '', beginAt: current.beginAt.toISOString(), endAt: current.endAt.toISOString(), maintainer: [], hidden: false };
        const valid = { basic, settings: current.setConfig.settings, expectedRevision: current.setConfig.revision };
        const cases = [
            { ...valid, basic: { ...basic, title: '' } },
            { ...valid, basic: { ...basic, endAt: basic.beginAt } },
            { ...valid, basic: { ...basic, beginAt: null, endAt: null } },
            { ...valid, basic: { ...basic, endAt: null } },
            { ...valid, basic: { ...basic, maintainer: [8, 8] } },
            { ...valid, basic: { ...basic, hidden: 'false' } },
            { ...valid, basic: { ...basic, owner: 99 } },
            { ...valid, settings: { ...current.setConfig.settings, codePolicy: 'invalid' } },
            { ...valid, expectedRevision: current.setConfig.revision - 1 },
        ];
        for (const body of cases) await rejects(handler(body).post('system', 'exam', String(id)));
        expect(writes).to.have.length(0);
        expect(current.title).to.equal('Draft');
    });

    it('validates the lock against the same-request window and rejects invalid retained locks', async () => {
        const basic = { title: 'Draft', content: '', beginAt: '2099-01-02T00:00:00Z', endAt: '2099-01-02T02:00:00Z', maintainer: [], hidden: false };
        await handler({ basic, settings: current.setConfig.settings, expectedRevision: current.setConfig.revision,
            lockAt: '2099-01-02T01:00:00Z' }).post('system', 'exam', String(id));
        expect(writes).to.have.length(1);
        await rejects(handler({ basic: { ...basic, endAt: '2099-01-02T00:30:00Z' }, settings: current.setConfig.settings,
            expectedRevision: current.setConfig.revision }).post('system', 'exam', String(id)));
        expect(writes).to.have.length(1);
    });

    it('reschedules hidden problems and recalculates existing rounds when extending the deadline', async () => {
        rounds = 1;
        current.autoHide = true;
        current.autoHideProblemPids = [4, 8];
        const endAt = '2099-01-01T03:00:00.000Z';
        await handler({ basic: { title: 'Draft', content: '', beginAt: current.beginAt.toISOString(), endAt, maintainer: [], hidden: false },
            settings: current.setConfig.settings, expectedRevision: current.setConfig.revision }).post('system', 'exam', String(id));
        expect(recalcCalls).to.equal(1);
        expect(schedules).to.deep.equal([{ domain: 'system', id, end: new Date(endAt), pids: [4, 8] }]);
    });

    it('projects existing option defaults and atomically restores a changed scoreboard lock', async () => {
        const get = handler();
        await get.get('forged-domain', 'exam', String(id));
        expect(get.response.body).to.include({ allowVirtual: false, allowPrint: false, allowPostContestView: true });
        const revision = current.setConfig.revision;
        const post = handler({ settings: current.setConfig.settings, expectedRevision: revision,
            lockAt: '2099-01-01T01:00:00Z', allowPrint: true });
        await post.post('forged-domain', 'exam', String(id));
        expect(writes).to.have.length(1);
        expect(writes[0]).to.include({ unlocked: false, allowPrint: true });
        expect(writes[0].setConfig.revision).to.equal(revision + 1);
        expect(current.allowVirtual).to.equal(false);
        expect(post.response.body).to.include({ allowPrint: true, allowVirtual: false, lockAt: '2099-01-01T01:00:00.000Z' });
    });

    it('rejects stale revisions and malformed options before any write', async () => {
        const bad = handler({ settings: current.setConfig.settings, expectedRevision: current.setConfig.revision, allowPrint: 'true' });
        let malformed: unknown;
        try {
            await bad.post('system', 'exam', String(id));
        } catch (error) { malformed = error; }
        expect(malformed).to.be.instanceOf(Error);
        const stale = handler({ settings: current.setConfig.settings, expectedRevision: current.setConfig.revision - 1, allowPrint: true });
        let conflict: unknown;
        try {
            await stale.post('system', 'exam', String(id));
        } catch (error) { conflict = error; }
        expect(conflict).to.be.instanceOf(Error);
        expect(writes).to.have.length(0);
    });

    it('clears a pending recalculation even when no formal rounds exist yet', async () => {
        current.statusRecalcToken = 'failed-before-first-round';
        const post = handler({ settings: current.setConfig.settings, expectedRevision: current.setConfig.revision });
        await post.post('system', 'exam', String(id));
        expect(recalcCalls).to.equal(1);
        expect(current.statusRecalcToken).to.equal(undefined);
    });

    it('persists a pending recalc with settings and retries unchanged values after failure', async () => {
        rounds = 1;
        const settings = { ...current.setConfig.settings, retake: { ...current.setConfig.settings.retake, passScore: 30 } };
        failRecalc = true;
        const first = handler({ settings, expectedRevision: current.setConfig.revision });
        let failure: unknown;
        try {
            await first.post('system', 'exam', String(id));
        } catch (error) { failure = error; }
        expect((failure as Error).message).to.equal('fixture recalc failure');
        expect(writes[0].statusRecalcToken).to.be.a('string');
        expect(current.statusRecalcToken).to.be.a('string');
        expect(current.setConfig.settings.retake.passScore).to.equal(30);
        failRecalc = false;
        const retry = handler({ settings, expectedRevision: current.setConfig.revision });
        await retry.post('system', 'exam', String(id));
        expect(recalcCalls).to.equal(2);
        expect(current.statusRecalcToken).to.equal(undefined);
    });
});

describe('experience, compiler and group settings', () => {
    it('persists rules and allowed compilers atomically without recalculating scores', async () => {
        const settings = { ...current.setConfig.settings, experience: { ...SET_EXPERIENCE_DEFAULTS, hideTotalScore: true, allowSelfTest: false },
            authorization: { defaults: SET_DEFAULT_PERMISSIONS, groups: [{ groupId: '64b000000000000000000001', ...SET_DEFAULT_PERMISSIONS }] } };
        await handler({ settings, langs: ['cc'], expectedRevision: current.setConfig.revision }).post('system', 'exam', String(id));
        expect(current.langs).to.deep.equal(['cc']);
        expect(current.setConfig.settings).to.deep.equal(settings);
        expect(writes).to.have.length(1);
        expect(groupChecks).to.have.length(1);
        expect(recalcCalls).to.equal(0);
    });
    it('rejects unauthorized groups and invalid compilers before writing', async () => {
        const settings = { ...current.setConfig.settings, authorization: { defaults: SET_DEFAULT_PERMISSIONS, groups: [{ groupId: '64b000000000000000000001', ...SET_DEFAULT_PERMISSIONS }] } };
        rejectGroups = true;
        await rejects(handler({ settings, expectedRevision: current.setConfig.revision }).post('system', 'exam', String(id)), /group forbidden/);
        rejectGroups = false;
        for (const langs of [['missing'], ['cc', 'cc'], 'cc']) await rejects(handler({ settings: current.setConfig.settings, langs, expectedRevision: current.setConfig.revision }).post('system', 'exam', String(id)));
        expect(writes).to.have.length(0);
    });
});
