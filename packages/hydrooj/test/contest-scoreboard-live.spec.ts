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
let storedContest: any;
let storedStatuses: any[] = [];

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
        if (request === './document') {
            return {
                TYPE_CONTEST: 30,
                get: async () => storedContest,
                getMultiStatus: () => ({ sort() { return this; }, toArray: async () => [...storedStatuses] }),
                collStatus: { aggregate: () => ({ toArray: async () => [] }) },
            };
        }
        if (request === './message' || request === './record') return { __esModule: true, default: defaultStub };
        if (request === './problem') {
            const problemStub = {
                getMultiStatus: () => ({ toArray: async () => [] }),
                getList: async () => Object.fromEntries(storedContest.pids.map((pid: number) => [pid, { docId: pid, title: String(pid), config: { maxScore: 100 } }])),
            };
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
    return row.find((cell) => cell.type === 'record' || cell.type === 'records');
}

function cellByType(row: any[], type: string) {
    return row.find((cell) => cell.type === type);
}

describe('personal IOI results on a frozen public scoreboard', () => {
    function setup(overrides: Record<string, unknown> = {}) {
        storedContest = { ...contestDoc('ioi'), pids: [11, 12], ...overrides };
        const rule = contestModel.RULES[storedContest.rule];
        storedStatuses = [
            { uid: 1, attend: 1, journal: [entry(HOUR, 11, 2, 40), entry(3 * HOUR, 11, 1, 100), entry(3 * HOUR + 1000, 12, 1, 100)] },
            { uid: 2, attend: 1, journal: [entry(HOUR, 11, 2, 80), entry(3 * HOUR, 12, 1, 100)] },
        ].map((doc) => ({ ...doc, domainId: 'system', ...rule.stat(storedContest, doc.journal) }));
    }

    async function board(uid: number, overrides: Record<string, unknown> = {}) {
        const handler = { user: { _id: uid, own: () => true }, translate: (text: string) => text, args: { uid: 2 } };
        return contestModel.getScoreboard.call(handler as any, 'system', storedContest.docId, {
            isExport: false, showDisplayName: false, lockAt: storedContest.lockAt, showSelfResults: true, ...overrides,
        });
    }

    it('reveals only the authenticated participant, preserving public ranks, other rows, counters and stored status', async () => {
        setup();
        const before = JSON.stringify(storedStatuses);
        const [, frozen, , frozenProblems] = await board(1, { showSelfResults: false });
        const [, personal, , personalProblems] = await board(1);
        const own = rowByUser(personal, 1);
        expect(personal.slice(1).map((row) => row[1].raw)).to.deep.equal(frozen.slice(1).map((row) => row[1].raw));
        expect(own[0]).to.deep.equal(rowByUser(frozen, 1)[0]);
        expect(own[0].value).to.equal('2');
        expect(cellByType(own, 'total_score').value).to.equal(200);
        expect(cellByType(own, 'solved').value).to.equal('2');
        expect(cellByType(own, 'time').value).to.equal('06:00:01');
        expect(own.filter((cell) => cell.type === 'record').map((cell) => cell.value)).to.deep.equal(['100\n03:00:00', '100\n03:00:01']);
        expect(own.filter((cell) => cell.type === 'record').every((cell) => cell.selfVisible)).to.equal(true);
        expect(own.filter((cell) => cell.type === 'record').some((cell) => cell.style)).to.equal(false);
        expect(rowByUser(personal, 2)).to.deep.equal(rowByUser(frozen, 2));
        expect(String(rowByUser(personal, 2).at(-1).value)).to.include('+1');
        expect(personalProblems).to.deep.equal(frozenProblems);
        expect(JSON.stringify(storedStatuses)).to.equal(before);
    });

    it('changes the personal projection when the authenticated viewer changes without sharing another participant result', async () => {
        setup();
        const [, frozen] = await board(2, { showSelfResults: false });
        const [, rows] = await board(2);
        expect(rowByUser(rows, 1)).to.deep.equal(rowByUser(frozen, 1));
        expect(cellByType(rowByUser(rows, 2), 'total_score').value).to.equal(180);
        expect(rowByUser(rows, 2)[0].value).to.equal('1');
    });

    it('keeps a zero-result participant on the public rank while revealing a new post-lock problem', async () => {
        setup();
        storedStatuses[0].journal = [entry(3 * HOUR, 12, 1, 100)];
        Object.assign(storedStatuses[0], contestModel.RULES.ioi.stat(storedContest, storedStatuses[0].journal));
        const [, rows] = await board(1);
        const own = rowByUser(rows, 1);
        expect(own[0].value).to.equal('2');
        expect(cellByType(own, 'total_score').value).to.equal(100);
        expect(own.at(-1).value).to.equal('100\n03:00:00');
        expect(own.at(-2).value).to.equal('-');
    });

    it('keeps the best IOI score and preserves the public first-blood marker', async () => {
        setup();
        storedStatuses[0].journal = [entry(HOUR, 11, 1, 100), entry(3 * HOUR, 11, 2, 20)];
        Object.assign(storedStatuses[0], contestModel.RULES.ioi.stat(storedContest, storedStatuses[0].journal));
        const [, frozen] = await board(1, { showSelfResults: false });
        const [, rows] = await board(1);
        const own = rowByUser(rows, 1);
        expect(problemCell(own).value).to.equal('100\n01:00:00');
        expect(problemCell(own).style).to.equal(problemCell(rowByUser(frozen, 1)).style);
        expect(problemCell(own).style).to.be.a('string');
    });

    it('does not reveal another participant to anonymous, nonparticipant or unattending viewers', async () => {
        for (const uid of [0, 99, 1]) {
            setup();
            if (uid === 1) storedStatuses[0].attend = 0;
            const [, frozen] = await board(uid, { showSelfResults: false });
            const [, rows] = await board(uid);
            expect(rows).to.deep.equal(frozen);
        }
    });

    it('keeps exported snapshots fully frozen even when personal results are requested', async () => {
        setup();
        const [, frozen] = await board(1, { isExport: true, showSelfResults: false });
        const [, rows] = await board(1, { isExport: true });
        expect(rows).to.deep.equal(frozen);
    });

    it('does not personalize before the lock, after unlocking, or for other contest rules', async () => {
        for (const settings of [{ lockAt: new Date('2029-01-01') }, { unlocked: true }, { rule: 'oi' }, { rule: 'acm' }]) {
            setup(settings);
            const [, plain] = await board(1, { showSelfResults: false });
            const [, rows] = await board(1);
            expect(rows).to.deep.equal(plain);
        }
    });

    it('leaves the administrator live board fully live and marked against the public frozen board', async () => {
        setup();
        const [, rows] = await board(1, { revealLocked: true });
        expect(cellByType(rowByUser(rows, 1), 'total_score').value).to.equal(200);
        expect(cellByType(rowByUser(rows, 2), 'total_score').value).to.equal(180);
        expect(rows.flat().some((cell) => cell.selfVisible)).to.equal(false);
        expect(cellByType(rowByUser(rows, 2), 'total_score').studentDivergence).to.equal(true);
    });

    it('retains a starred participant without assigning a live public rank', async () => {
        setup();
        storedStatuses[0].unrank = true;
        const [, rows] = await board(1);
        expect(rowByUser(rows, 1)[0].value).to.equal('*');
        expect(cellByType(rowByUser(rows, 1), 'total_score').value).to.equal(200);
    });
});

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
        const [frozenRows] = await rule.scoreboard({ isExport: false, showDisplayName: false, lockAt }, (text) => text, tdoc, pdict, frozenDocs as any);
        const [liveRows] = await rule.scoreboard({ isExport: false, showDisplayName: false }, (text) => text, tdoc, pdict, liveDocs as any);
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
        expect(problemCell(liveLeader).value).to.equal('100\n03:00:00');
        expect(cellByType(liveLeader, 'solved').value).to.equal('1');
        expect(cellByType(liveLeader, 'time').value).to.equal('03:00:00');
        expect(problemCell(liveLeader).studentDivergence).to.equal(true);
        expect(cellByType(liveLeader, 'time').studentDivergence).to.equal(true);
        expect(cellByType(liveLeader, 'solved').studentDivergence).to.equal(undefined);
        expect(liveLeader[0].studentDivergence).to.equal(undefined);
        expect(liveLeader[2].studentDivergence).to.equal(true);
        expect(String(problemCell(frozenLeader).value)).to.include('+1');
        expect(String(problemCell(frozenLeader).value)).to.include('\n01:00:00');
        expect(cellByType(frozenLeader, 'time').value).to.equal('01:00:00');
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
        expect(problemCell(row).value).to.equal('80\n01:00:00');
        expect(cellByType(row, 'time').value).to.equal('01:00:00');
        expect(cellByType(row, 'time').studentDivergence).to.equal(undefined);
        expect(cellByType(row, 'solved').studentDivergence).to.equal(undefined);
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
