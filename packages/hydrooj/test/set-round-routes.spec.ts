import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, SET_DEFAULT_PERMISSIONS } from '@hydrooj/common';

global.Hydro ||= { model: {}, module: {}, ui: {} } as typeof global.Hydro;
const { PERM, PRIV } = require('../src/model/builtin') as typeof import('../src/model/builtin');

const Module = require('module');
const originalLoad = Module._load;
let container: any;
let status: any;
let scope = true;
let homeworkAllowed = true;
let watched = true;
let visible = true;
let client = false;
let saveError: Error | null = null;
let accepted = false;
let acceptanceError: Error | null = null;
const calls: string[] = [];
const round = { _id: new ObjectId(), roundNo: 1, state: 'open', startedAt: new Date(), paperPids: [1], closedAt: null };
const contest = {
    get: async (domain: string, tid: ObjectId) => {
        expect(domain).to.equal('test');
        expect(tid.equals(container.docId)).to.equal(true);
        return container;
    },
    getStatus: async () => status,
    requirePublishedForStudent: () => {},
    isClientRequired: () => container.clientRequired === true,
    isClientFinished: (s: any) => s?.clientFinished === true,
    studentRecordHitsContestScope: async () => scope,
    attend: async () => { calls.push('attend'); status = { attend: 1 }; },
    persistSetParticipantStatus: async () => { calls.push('status'); },
};
const roundModel = {
    participantKey: (uid: number) => `u:${uid}`,
    openOrResumeRound: async () => { calls.push('open'); return round; },
    readParticipantRound: async (_d: string, _t: ObjectId, _u: number, _team: unknown, id?: ObjectId) => !id || id.equals(round._id) ? round : null,
    saveOfficialKind: async () => {
        calls.push('save');
        if (saveError) throw saveError;
        return { changed: [1], unchanged: [], versions: { 1: 1 } };
    },
    wasOfficialSaveAccepted: async (request: { domainId: string; tid: ObjectId; uid: number; roundId: ObjectId; operationId: string }) => {
        expect(request.domainId).to.equal('test');
        expect(request.tid.equals(container.docId)).to.equal(true);
        expect(request.uid).to.equal(7);
        expect(request.roundId.equals(round._id)).to.equal(true);
        expect(request.operationId).to.equal('save-0001');
        if (acceptanceError) throw acceptanceError;
        return accepted;
    },
    projectParticipantStatus: async () => ({}),
    handInRound: async () => { calls.push('close'); },
};
class FakeHandler {
    checkPriv(priv: number) { expect(priv).to.equal(PRIV.PRIV_USER_PROFILE); }
    resolveErrorTransport(error: Error) { return { error: { message: error.message } }; }
}
const routes = new Map<string, any>();
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (request === '../model/contest') return contest;
    if (request === '../model/set-round') return roundModel;
    if (request === '../model/contest-team') return { getTeamByMember: async () => null };
    if (request === '../model/contest-participation') return { getParticipationMode: () => 'individual', isTeamBatchFinalizationPending: () => false };
    if (request === '../model/problem') return { __esModule: true, default: { get: async () => ({ problemKind: 'single', config: { type: 'objective', answers: { q1: ['A', 100] } } }) } };
    if (request === '../model/homework-access') return { assertHomeworkAccess: async () => { if (!homeworkAllowed) throw new Error('homework denied'); } };
    if (request === './container-visibility') return { decideContainerVisibility: async () => { if (!visible) throw new Error('hidden'); } };
    if (request === './course-exam-gate') return { assertCourseExamWatchGate: async () => { if (!watched) throw new Error('video incomplete'); } };
    if (request === '../lib/set-student-state') {
        return { loadSetStudentState: async () => ({ round, answers: [] }), setAnswerResponse: () => ({ drafts: [] }) };
    }
    if (request === '../lib/vigil-integration-attendance') {
        return { confirmVigilContestAttendance: async () => { calls.push('client-attend'); } };
    }
    if (request === '../service/server') return { Handler: FakeHandler };
    return originalLoad.call(this, request, parent, main);
};
let register: (ctx: any) => Promise<void>;
try {
    register = require('../src/handler/set-answer.ts').apply;
} finally {
    Module._load = originalLoad;
}

function handler(name: string, body: object = {}) {
    const Class = routes.get(name);
    const instance = new Class();
    instance.domain = { _id: 'test' };
    instance.request = { params: { tid: container.docId.toHexString() }, body, method: 'post' };
    instance.args = { domainId: 'forged', tid: new ObjectId().toHexString() };
    instance.response = {};
    instance.session = {};
    instance.user = { _id: 7, group: [], own: () => false, hasPriv: () => false,
        hasPerm: (permission: bigint) => permission === PERM.PERM_ATTEND_CONTEST || permission === PERM.PERM_ATTEND_HOMEWORK };
    return instance;
}
async function denied(work: () => Promise<unknown>) {
    let failed = false;
    try {
        await work();
    } catch {
        failed = true;
    }
    expect(failed).to.equal(true);
    expect(calls).to.deep.equal([]);
}
beforeEach(async () => {
    await register({ Route: (name: string, _path: string, Class: unknown) => routes.set(name, Class) });
    const cfg = createDraftConfig('exam');
    container = { domainId: 'test', docId: new ObjectId(), rule: 'exam', pids: [1],
        beginAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 60000),
        setConfig: { ...cfg, publication: 'published' } };
    status = null;
    scope = true;
    homeworkAllowed = true;
    watched = true;
    visible = true;
    client = false;
    saveError = null;
    accepted = false;
    acceptanceError = null;
    calls.length = 0;
    global.Hydro ||= { model: {}, module: {}, ui: {} } as typeof global.Hydro;
    (global.Hydro.model as unknown as Record<string, unknown>).vigilguard = {
        clientSessionKeyFromSession: () => 'session', isValidClientSessionForContest: async () => client,
    };
});

describe('registered formal-round route boundaries', () => {
    it('uses the route/domain target and checks gates before opening or attending', async () => {
        await handler('set_round_start_paper').post();
        expect(calls).to.deep.equal(['open', 'attend', 'status']);
    });
    it('blocks missing attend permission before any write', async () => {
        const h = handler('set_round_start_paper');
        h.user.hasPerm = () => false;
        await denied(() => h.post());
    });
    it('blocks audience, visibility and course gate failures before any write', async () => {
        scope = false;
        await denied(() => handler('set_round_start_paper').post());
        scope = true; visible = false;
        await denied(() => handler('set_round_start_paper').post());
        visible = true; watched = false;
        await denied(() => handler('set_round_start_paper').post());
    });
    it('requires invitation attendance and a live bound Client session', async () => {
        container._code = 'secret';
        await denied(() => handler('set_round_start_paper').post());
        status = { attend: 1 }; container.clientRequired = true;
        await denied(() => handler('set_round_start_paper').post());
        client = true;
        await handler('set_round_start_paper').post();
        expect(calls).to.deep.equal(['open', 'client-attend', 'status']);
    });
    it('does not let save, hand-in or answer reads bypass the same gate', async () => {
        scope = false;
        await denied(() => handler('set_round_save_paper', { roundId: round._id.toHexString(), kind: 'single',
            operationId: 'save-0001', items: [{ pid: 1, body: { q1: 'A' }, baseVersion: 0 }] }).post());
        await denied(() => handler('set_round_hand_in_paper', { roundId: round._id.toHexString() }).post());
        await denied(() => handler('set_round_answers_paper').get());
    });
    it('supports a homework preset on the Client paper alias and retains homework scope', async () => {
        container.setConfig = { ...createDraftConfig('homework'), publication: 'published' };
        container.rule = 'homework';
        homeworkAllowed = false;
        await denied(() => handler('set_round_start_paper').post());
        homeworkAllowed = true;
        await handler('set_round_start_paper').post();
        expect(calls).to.deep.equal(['open', 'attend', 'status']);
    });
    it('rejects a stale tab hand-in and does not return hidden scores on success', async () => {
        await denied(() => handler('set_round_hand_in_paper', { roundId: new ObjectId().toHexString() }).post());
        const h = handler('set_round_hand_in_paper', { roundId: round._id.toHexString() });
        await h.post();
        expect(h.response.body).to.deep.equal({ closed: true, roundId: round._id.toHexString() });
    });
    it('confirms an unaccepted save rejection so local edits can be discarded or corrected', async () => {
        saveError = new Error('answer version conflict');
        const h = handler('set_round_save_paper', { roundId: round._id.toHexString(), kind: 'single',
            operationId: 'save-0001', items: [{ pid: 1, body: { q1: 'A' }, baseVersion: 0 }] });
        await h.post();
        expect(h.response.body).to.deep.equal({ accepted: false, error: { message: 'answer version conflict' } });
        expect(calls).to.deep.equal(['save']);
    });
    it('keeps accepted operations and failed acceptance lookups uncertain for exact-request retry', async () => {
        const body = { roundId: round._id.toHexString(), kind: 'single',
            operationId: 'save-0001', items: [{ pid: 1, body: { q1: 'A' }, baseVersion: 0 }] };
        saveError = new Error('projection interrupted');
        accepted = true;
        let failure: unknown;
        try {
            await handler('set_round_save_paper', body).post();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.equal(saveError);
        accepted = false;
        acceptanceError = new Error('acceptance query failed');
        try {
            await handler('set_round_save_paper', body).post();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.equal(acceptanceError);
        expect(calls).to.deep.equal(['save', 'save']);
    });
});

it('allows view-only students to start but rejects answer writes', async () => {
    container.setConfig.settings.authorization = { defaults: { ...SET_DEFAULT_PERMISSIONS, problems: 'view' }, groups: [] };
    const start = handler('set_round_start_paper');
    await start.post();
    expect(calls).to.include('open');
    calls.length = 0;
    await denied(() => handler('set_round_save_paper', { roundId: round._id.toHexString(), kind: 'single', operationId: 'save-0001', items: [{ pid: 1, body: { q1: 'A' }, baseVersion: 0 }] }).post());
});
