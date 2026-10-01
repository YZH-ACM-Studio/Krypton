import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { rankSkippingUnofficial } from '../src/lib/contest-unrank';
import { compareByStatusSort, markStudentDivergence, projectContestStatus, scoreboardLockView } from '../src/lib/contest-scoreboard-live';

const Module = require('module');
const contestPath = require.resolve('../src/model/contest.ts');
const originalLoad = Module._load;

const STATUS = {
    STATUS_ACCEPTED: 1,
    STATUS_WRONG_ANSWER: 2,
    STATUS_COMPILE_ERROR: 7,
    STATUS_CANCELED: 9,
};

const defaultStub = new Proxy({}, { get: () => async () => undefined });

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === contestPath) {
        if (request === '../context') return { Context: class {} };
        if (request === '../error') return new Proxy({}, { get: () => class extends Error {} });
        if (request === '../lib/avatar') return { __esModule: true, default: () => '' };
        if (request === '../service/bus') return { __esModule: true, default: defaultStub };
        if (request === '../service/db') {
            return {
                __esModule: true,
                default: {
                    collection: () => new Proxy({}, { get: () => async () => undefined }),
                    async ranked(cursor: unknown[] | { toArray: () => Promise<unknown[]> }, equ: (a: any, b: any) => boolean) {
                        const docs = Array.isArray(cursor) ? cursor : await cursor.toArray();
                        return rankSkippingUnofficial(docs, equ);
                    },
                },
            };
        }
        if (request === './builtin') return { PERM: {}, PRIV: {}, STATUS, STATUS_SHORT_TEXTS: {} };
        if (request === './contest-participation') {
            return {
                getParticipationMode: (tdoc: { participationMode?: string }) => tdoc.participationMode || 'individual',
                normalizeParticipationConfig: (tdoc: unknown) => tdoc,
                planParticipationModeTransition: () => ({}),
                teamModeClearConfirmation: () => '',
            };
        }
        if (request === './contest-team-status') return defaultStub;
        if (request === './document') return { TYPE_CONTEST: 30 };
        if (request === './message' || request === './record') return { __esModule: true, default: defaultStub };
        if (request === './problem') {
            const problemStub = { getMultiStatus: () => ({ toArray: async () => [] }) };
            return { __esModule: true, default: problemStub, ProblemModel: problemStub };
        }
        if (request === './user') {
            return {
                __esModule: true,
                default: {
                    async getListForRender(_domainId: string, uids: number[]) {
                        return Object.fromEntries(uids.map((uid) => [uid, { uname: `u${uid}` }]));
                    },
                },
                User: class {},
            };
        }
        if (request === './oplog') return defaultStub;
        if (request === './contest-team') return {};
        if (request === './contest-team-gate') return { withContestTeamBoundary: async (_d: string, _t: unknown, work: () => unknown) => work() };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let contestModel: typeof import('../src/model/contest');
try {
    (global as any).Hydro = { model: {} };
    delete require.cache[contestPath];
    contestModel = require(contestPath);
} finally {
    Module._load = originalLoad;
}

const HOUR = 60 * 60 * 1000;
const beginAt = new Date('2020-01-01T00:00:00.000Z');
const lockAt = new Date('2020-01-01T02:00:00.000Z');
const endAt = new Date('2030-01-01T00:00:00.000Z');

function ridAt(date: Date) {
    return ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

function entry(offsetMs: number, pid: number, status: number, score: number) {
    return { rid: ridAt(new Date(beginAt.getTime() + offsetMs)), pid, status, score };
}

function contestDoc(rule: string) {
    return {
        domainId: 'system',
        docId: new ObjectId(),
        rule,
        pids: [11],
        beginAt,
        lockAt,
        endAt,
    } as any;
}

function rowByUser(rows: any[], uid: number) {
    return rows.slice(1).find((row) => row.some((cell) => cell.type === 'user' && cell.raw === uid));
}

function problemCell(row: any[]) {
    const headerProblem = 3;
    return row[headerProblem];
}

describe('locked scoreboard view selection', () => {
    it('shows the live board only to an allowed viewer of a locked acm, oi, or ioi contest', () => {
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'ioi', allowed: true })).to.deep.equal({
            revealLocked: true,
            lockAtActive: false,
            canToggle: true,
        });
        expect(scoreboardLockView({ realtime: false, locked: true, rule: 'oi', allowed: true }).canToggle).to.equal(true);
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'ioi', allowed: false }).revealLocked).to.equal(false);
        expect(scoreboardLockView({ realtime: true, locked: false, rule: 'ioi', allowed: true }).canToggle).to.equal(false);
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'homework', allowed: true }).revealLocked).to.equal(false);
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'acm', allowed: true }).revealLocked).to.equal(true);
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'acm', allowed: true, team: true })).to.deep.equal({
            revealLocked: false,
            lockAtActive: true,
            canToggle: false,
        });
        expect(scoreboardLockView({ realtime: true, locked: true, rule: 'homework', allowed: true }).lockAtActive).to.equal(true);
    });
});

describe('admin live scoreboard versus the student board', () => {
    async function boards(ruleName: 'ioi' | 'oi', statuses: any[]) {
        const tdoc = contestDoc(ruleName);
        const rule = contestModel.RULES[ruleName];
        const pdict: any = { 11: { docId: 11, title: 'A', nAccept: 0, nSubmit: 0 } };
        const liveDocs = statuses.map((tsdoc) => projectContestStatus(rule, tdoc, tsdoc, 'live')).sort(compareByStatusSort(rule.statusSort));
        const frozenDocs = statuses.map((tsdoc) => projectContestStatus(rule, tdoc, tsdoc, 'frozen')).sort(compareByStatusSort(rule.statusSort));
        const [frozenRows] = await rule.scoreboard({ isExport: false, showDisplayName: false, lockAt }, (text) => text, tdoc, pdict, frozenDocs);
        const [liveRows] = await rule.scoreboard({ isExport: false, showDisplayName: false }, (text) => text, tdoc, pdict, liveDocs);
        markStudentDivergence(liveRows, frozenRows);
        return { liveRows, frozenRows };
    }

    it('ranks an IOI contest by the post-lock score and marks cells that differ from the student board', async () => {
        const { liveRows, frozenRows } = await boards('ioi', [
            { uid: 1, domainId: 'system', journal: [entry(HOUR, 11, STATUS.STATUS_WRONG_ANSWER, 40), entry(3 * HOUR, 11, STATUS.STATUS_ACCEPTED, 100)] },
            { uid: 2, domainId: 'system', journal: [entry(90 * 60 * 1000, 11, STATUS.STATUS_ACCEPTED, 90)] },
        ]);
        const liveLeader = rowByUser(liveRows, 1);
        const frozenLeader = rowByUser(frozenRows, 1);
        expect(liveLeader[0].value).to.equal('1');
        expect(liveLeader[2].value).to.equal(100);
        expect(problemCell(liveLeader).value).to.equal('100');
        expect(problemCell(liveLeader).studentDivergence).to.equal(true);
        expect(liveLeader[0].studentDivergence).to.equal(undefined);
        expect(liveLeader[2].studentDivergence).to.equal(true);
        expect(String(problemCell(frozenLeader).value)).to.include('+1');
        expect(problemCell(frozenLeader).studentDivergence).to.equal(undefined);
        const unchanged = rowByUser(liveRows, 2);
        expect(problemCell(unchanged).studentDivergence).to.equal(undefined);
        expect(unchanged[2].value).to.equal(90);
    });

    it('marks an IOI cell when a post-lock submit does not change the kept score', async () => {
        const { liveRows } = await boards('ioi', [
            { uid: 1, domainId: 'system', journal: [entry(HOUR, 11, STATUS.STATUS_ACCEPTED, 80), entry(3 * HOUR, 11, STATUS.STATUS_WRONG_ANSWER, 50)] },
        ]);
        const row = rowByUser(liveRows, 1);
        expect(row[2].value).to.equal(80);
        expect(problemCell(row).studentDivergence).to.equal(true);
        expect(String(problemCell(row).value)).to.equal('80');
    });

    it('uses the latest OI submission on the live board and keeps the pre-lock score for students', async () => {
        const { liveRows, frozenRows } = await boards('oi', [
            { uid: 1, domainId: 'system', journal: [entry(HOUR, 11, STATUS.STATUS_ACCEPTED, 100), entry(3 * HOUR, 11, STATUS.STATUS_WRONG_ANSWER, 30)] },
        ]);
        expect(rowByUser(liveRows, 1)[2].value).to.equal(30);
        expect(problemCell(rowByUser(liveRows, 1)).studentDivergence).to.equal(true);
        expect(String(problemCell(rowByUser(frozenRows, 1)).value)).to.include('100');
    });

    it('does not mark a board whose post-lock journal is empty', async () => {
        const { liveRows } = await boards('ioi', [
            { uid: 1, domainId: 'system', journal: [entry(HOUR, 11, STATUS.STATUS_ACCEPTED, 70)] },
        ]);
        const row = rowByUser(liveRows, 1);
        expect(row[0].studentDivergence).to.equal(undefined);
        expect(problemCell(row).studentDivergence).to.equal(undefined);
        expect(row[2].studentDivergence).to.equal(undefined);
    });
});
