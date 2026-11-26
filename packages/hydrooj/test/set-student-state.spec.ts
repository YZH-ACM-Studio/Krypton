import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, type OfficialAnswer } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import type { RoundDoc } from '../src/model/set-round';
import type { SetWorkspace } from '../src/lib/set-workspace';
import { setWorkspaceResponse } from '../src/lib/set-workspace-response';

const Module = require('module');
const originalLoad = Module._load;
let rows: RoundDoc[];
let answers: OfficialAnswer[];
let tdoc: Tdoc;
const problems = new Map<number, object>();
const records = [{ pid: 2, status: 1 }];
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (parent.filename.endsWith('/set-student-state.ts')) {
        if (request === '../model/set-round') {
            return { participantKey: (uid: number) => `u:${uid}`, settleParticipantRounds: async () => rows, getOfficialAnswers: async () => answers };
        }
        if (request === '../model/problem') return { __esModule: true, default: { getList: async (_d: string, pids: number[]) => Object.fromEntries(pids.map((pid) => [pid, problems.get(pid)])) } };
        if (request === '../model/record') {
            return { __esModule: true, default: { coll: { find: (filter: { domainId: string; setRoundId: ObjectId }) => {
                expect(filter.domainId).to.equal('test');
                expect(filter.setRoundId.equals(rows[rows.length - 1]._id)).to.equal(true);
                return { project() { return this; }, toArray: async () => records };
            } } } };
        }
    }
    return originalLoad.call(this, request, parent, main);
};
let loadState: typeof import('../src/lib/set-student-state').loadSetStudentState;
let response: typeof import('../src/lib/set-student-state').setAnswerResponse;
try {
    ({ loadSetStudentState: loadState, setAnswerResponse: response } = require('../src/lib/set-student-state.ts'));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    const config = createDraftConfig('exam');
    config.publication = 'published';
    config.settings.feedback.objective.when = 'after_release';
    tdoc = { _id: new ObjectId(), domainId: 'test', docId: new ObjectId(), docType: 30, owner: 1,
        title: 'Set', content: '', rule: 'exam', pids: [1, 2], duration: 0, attend: 1,
        beginAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 3600000), setConfig: config };
    rows = [{ _id: new ObjectId(), domainId: 'test', tid: tdoc.docId, participantKey: 'u:7', roundNo: 1,
        state: 'open', startedAt: tdoc.beginAt, closedAt: null, paperPids: [1, 2], total: 150, passed: false,
        detail: { 1: { pid: 1, score: 100, status: 1 }, 2: { pid: 2, score: 50, status: 2 } } }];
    answers = [{ pid: 1, body: { q1: 'A' }, acceptedAt: new Date(), version: 6, operationId: 'save-0001', rawScore: 100,
        status: 1, judgeResult: { q1: 'correct' } }];
    problems.set(1, { problemKind: 'single', config: { maxScore: 100, type: 'objective', answers: { q1: ['PRIVATE-ANSWER', 100] } } });
    problems.set(2, { problemKind: 'programming', config: { maxScore: 100, type: 'default' } });
});

describe('formal workspace and reload projection', () => {
    it('reloads official answers and versions while concealing unreleased results and aggregate totals', async () => {
        const state = await loadState(tdoc, 7);
        expect(response(state)).to.deep.equal({ roundId: rows[0]._id.toHexString(), roundNo: 1, closedAt: null,
            drafts: [{ pid: 1, answers: { q1: 'A' }, submittedAnswers: { q1: 'A' }, version: 6 }] });
        expect(state.officialResult).to.deep.equal({ score: null, accepted: null, showScore: false });
        expect(state.journal.get(2)?.lastScore).to.equal(50);
        expect(JSON.stringify(response(state))).not.to.contain('PRIVATE-ANSWER');
    });
    it('uses accepted judgment snapshots when grades are released', async () => {
        tdoc.setConfig.settings.feedback.gradesReleased = true;
        const state = await loadState(tdoc, 7);
        expect(state.answers[0].judgeResult).to.deep.equal({ q1: 'correct' });
        expect(state.answers[0].score).to.equal(100);
        expect(state.officialResult.score).to.equal(150);
    });
    it('does not report an empty manual judgment as correct', async () => {
        tdoc.setConfig.settings.feedback.gradesReleased = true;
        answers[0].judgeResult = {};
        answers[0].status = 0;
        const state = await loadState(tdoc, 7);
        expect(state.answers[0]).not.to.have.property('judgeResult');
        expect(state.drafts.get(1)?.judgeResult).to.equal(null);
    });
    it('rejects answers outside the actual round and malformed stored answer bodies', async () => {
        answers[0].pid = 3;
        let error: unknown;
        try {
            await loadState(tdoc, 7);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        answers[0].pid = 1;
        answers[0].body = { q1: { score: 100 } };
        error = undefined;
        try {
            await loadState(tdoc, 7);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
    });
    it('replaces legacy bootstrap objects with the explicit workspace projection', () => {
        const workspace = { groups: [{ items: [{ pid: 2 }] }], totals: { score: null } } as unknown as SetWorkspace;
        const original = { workspace, workspaceProblems: {}, langRange: {}, tsdoc: { score: 999 },
            psdict: { private: 100 }, rdict: { secret: 'answer' }, teamStatus: { score: 100 } };
        const safe = setWorkspaceResponse(tdoc, original);
        expect(Object.keys(safe)).to.have.members(['tdoc', 'workspace', 'workspaceProblems', 'langRange']);
        expect(safe.tdoc.pids).to.deep.equal([2]);
        expect(JSON.stringify(safe)).not.to.contain('secret');
    });
});
