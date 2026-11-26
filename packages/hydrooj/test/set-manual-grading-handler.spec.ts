import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig } from '@hydrooj/common';

const Module = require('module');
const path = require.resolve('../src/handler/manual-grading.ts');
const originalLoad = Module._load;
const tid = new ObjectId();
const firstRound = new ObjectId();
const secondRound = new ObjectId();
let records: Array<Record<string, any>>;
let answers: Array<Record<string, any>>;
let manage = true;
let legacyAccess = 0;
let normalizedGrade: number | undefined;
const tdoc = { domainId: 'system', docId: tid, rule: 'contest', owner: 1, pids: [7], title: '作业',
    setConfig: { ...createDraftConfig('contest'), publication: 'published' } };

class FakeHandler {
    domain = { _id: 'system' };
    user = { _id: 2, hasPriv: () => false };
    response: { body?: any; template?: string } = {};
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== path) return originalLoad.call(this, request, parent, isMain);
    if (request === '../service/server') return { Handler: FakeHandler, param: () => () => undefined, Types: {} };
    if (request === '../model/contest') return { get: async () => tdoc };
    if (request === '../lib/teach-access') return { canManageTeachContainer: () => manage };
    if (request === '../model/homework-access') return { assertHomeworkAccess: async () => { legacyAccess++; } };
    if (request === './contest') return { hideAssignRestrictedContest: async () => { legacyAccess++; } };
    if (request === '../model/builtin') return { PRIV: { PRIV_EDIT_SYSTEM: 1 } };
    if (request === '../model/manual-grade') {
 return {
        MANUAL_GRADE_RULES: ['exam', 'homework', 'oi'],
        gradeLatestManualRecord: async (input: { latestRid: ObjectId; score: number }) => {
            normalizedGrade = input.score;
            return { _id: input.latestRid, manualGrade: { revision: 1, score: input.score } };
        },
    };
}
    if (request === '../model/problem') {
 return { get: async () => ({ docId: 7, problemKind: 'subjective', title: '推导', config: {
        type: 'objective', main: { gradingInstructions: '说明计算过程' }, answers: { main: ['', 100, { kind: 'subjective' }] },
    } }) };
}
    if (request === '../model/record') {
 return { getMulti: (_domainId: string, query: Record<string, unknown>) => ({
        sort: () => ({ toArray: async () => records.filter((row) => row.contest.equals(query.contest)
            && row.pid === query.pid && (!query.uid || query.uid === row.uid)).toSorted((a, b) => String(b._id).localeCompare(String(a._id))) }),
    }) };
}
    if (request === '../model/user') return { getListForRender: async () => ({ 42: { uname: 'student42' } }) };
    if (request === '../service/db') {
 return { collection: (name: string) => ({ find: (query: Record<string, any>) => ({
        toArray: async () => name === 'contest.rounds'
            ? [{ _id: firstRound, roundNo: 1, closedAt: new Date() }, { _id: secondRound, roundNo: 2, closedAt: null }]
            : answers.filter((row) => row.domainId === query.domainId && row.pid === query.pid
                && query.roundId.$in.some((id: ObjectId) => id.equals(row.roundId))),
    }) }) };
}
    return originalLoad.call(this, request, parent, isMain);
};

let ManualGradingHandler: typeof import('../src/handler/manual-grading').ManualGradingHandler;
try {
    delete require.cache[path];
    ({ ManualGradingHandler } = require(path));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    manage = true;
    normalizedGrade = undefined;
    Reflect.deleteProperty(tdoc, 'setPoints');
    legacyAccess = 0;
    records = [];
    answers = [];
});

function saved(roundId: ObjectId, version: number, text: string, official = true) {
    const rid = new ObjectId();
    records.push({ _id: rid, domainId: 'system', contest: tid, pid: 7, uid: 42,
        setRoundId: roundId, setAnswerVersion: version, setAcceptedAt: new Date('2026-11-10T01:00:00Z'),
        code: JSON.stringify({ main: text }), status: 0, manualPending: true });
    if (official) answers.push({ domainId: 'system', roundId, pid: 7, version, rid: rid.toHexString(), body: { main: text } });
    return rid;
}

describe('configured manual grading page', () => {
    it('retains the official answer from every round and excludes superseded or pending-operation Records', async () => {
        const earlier = saved(firstRound, 2, '第一轮答案');
        const current = saved(secondRound, 1, '第二轮答案');
        saved(firstRound, 1, '过期答案', false);
        saved(secondRound, 2, '尚未完成正式保存', false);
        const handler = new ManualGradingHandler(null as never, null as never) as unknown as FakeHandler & InstanceType<typeof ManualGradingHandler>;
        await handler._prepare('ignored-domain', tid);
        await handler.get('ignored-domain', 7);
        expect(handler.response.body.rows).to.have.length(2);
        expect(handler.response.body.rows.map((row: Record<string, unknown>) => row.latestRid)).to.have.members([String(earlier), String(current)]);
        expect(handler.response.body.rows.find((row: Record<string, unknown>) => row.roundNo === 1)).to.include({ answer: '第一轮答案', answerVersion: 2 });
        expect(handler.response.body.rows.find((row: Record<string, unknown>) => row.roundNo === 2)).to.include({ answer: '第二轮答案', answerVersion: 1, closedAt: null });
        expect(handler.response.body.roundHistory).to.equal(true);
        expect(legacyAccess).to.equal(0);
    });

    it('grades using paper points, rescales an existing grade and rejects stale or withdrawn edits', async () => {
        const rid = saved(firstRound, 1, '主观题');
        const points = { 7: { rawMax: 100, points: 20, excluded: false } };
        Reflect.set(tdoc, 'setPoints', points);
        const handler = new ManualGradingHandler(null as never, null as never) as unknown as FakeHandler & InstanceType<typeof ManualGradingHandler>;
        await handler._prepare('system', tid);
        await handler.post('system', 7, 42, rid, 0, 12, '', '', 20);
        expect(normalizedGrade).to.equal(60);
        records[0].manualGrade = { score: normalizedGrade, revision: 1 };
        points[7].points = 30;
        await handler.get('system', 7);
        expect(handler.response.body.rows[0].manualGrade).to.include({ score: 18, maxScore: 30 });
        const edit = (maximum: number) => handler.post('system', 7, 42, rid, 1, 10, '', '', maximum);
        await assert.rejects(edit(20));
        points[7].excluded = true;
        await assert.rejects(edit(30));
    });

    it('requires the same manager capability as the teacher workbench', async () => {
        manage = false;
        const handler = new ManualGradingHandler(null as never, null as never) as unknown as FakeHandler & InstanceType<typeof ManualGradingHandler>;
        let rejected = false;
        try {
            await handler._prepare('system', tid);
        } catch {
            rejected = true;
        }
        expect(rejected).to.equal(true);
    });
});
