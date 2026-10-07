import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { rankSkippingUnofficial } from '../src/lib/contest-unrank';
import { compareByStatusSort, projectContestStatus } from '../src/lib/contest-scoreboard-live';
import {
    formatIoiBoardTime,
    ioiBoardRankKey,
    ioiBoardStanding,
    ioiRankKeysTied,
    rankIoiVirtualAttempts,
} from '../src/lib/contest-ioi-standing';

const Module = require('module');
const contestPath = require.resolve('../src/model/contest.ts');
const originalLoad = Module._load;
const STATUS = {
    STATUS_ACCEPTED: 1,
    STATUS_WRONG_ANSWER: 2,
    STATUS_COMPILE_ERROR: 7,
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

const MINUTE = 60 * 1000;
const beginAt = new Date('2020-01-01T00:00:00.000Z');

function ridAt(date: Date) {
    return ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

function at(minutes: number) {
    return new Date(beginAt.getTime() + minutes * MINUTE);
}

function entry(minutes: number, pid: number, status: number, score: number) {
    return { rid: ridAt(at(minutes)), pid, status, score };
}

function boardContest(extra: Record<string, unknown> = {}) {
    return {
        domainId: 'system',
        docId: new ObjectId(),
        rule: 'ioi',
        pids: [11, 12],
        beginAt,
        endAt: new Date('2030-01-01T00:00:00.000Z'),
        ...extra,
    } as any;
}

function pdict(): any {
    return {
        11: { docId: 11, title: 'A', nAccept: 0, nSubmit: 0 },
        12: { docId: 12, title: 'B', nAccept: 0, nSubmit: 0 },
    };
}

async function ioiRows(tdoc: any, statuses: any[]) {
    const rule = contestModel.RULES.ioi;
    const projected = statuses.map((tsdoc) => projectContestStatus(rule, tdoc, tsdoc, 'live')).sort(compareByStatusSort(rule.statusSort));
    const [rows] = await rule.scoreboard({ isExport: false, showDisplayName: false }, (text) => text, tdoc, pdict(), projected as any);
    return rows;
}

function rankOf(rows: any[], uid: number) {
    const row = rows.slice(1).find((candidate) => candidate.some((cell) => cell.type === 'user' && cell.raw === uid));
    return row[0].value;
}

function valueOf(rows: any[], uid: number, type: string) {
    const row = rows.slice(1).find((candidate) => candidate.some((cell) => cell.type === 'user' && cell.raw === uid));
    return row.find((cell) => cell.type === type).value;
}

describe('IOI standing clock', () => {
    it('formats whole seconds and ignores a zero-score problem', () => {
        expect(formatIoiBoardTime(0)).to.equal('00:00:00');
        expect(formatIoiBoardTime(80 * 60)).to.equal('01:20:00');
        const standing = ioiBoardStanding(
            { pids: [11, 12], beginAt },
            {
                detail: {
                    11: { score: 95, rid: ridAt(at(80)) },
                    12: { score: 0, rid: ridAt(at(5)) },
                },
            },
            {},
        );
        expect(standing.passed).to.equal(1);
        expect(standing.seconds).to.equal(80 * 60);
        expect(standing.problemSeconds.get(12)).to.equal(undefined);
    });

    it('uses the personal start when the contest has a duration, and beginAt otherwise', () => {
        const cell = { 11: { score: 10, rid: ridAt(at(40)) } };
        const personal = ioiBoardStanding({ pids: [11], beginAt, duration: 5 }, { startAt: at(30), detail: cell }, {});
        const shared = ioiBoardStanding({ pids: [11], beginAt }, { startAt: at(30), detail: cell }, {});
        expect(personal.seconds).to.equal(10 * 60);
        expect(shared.seconds).to.equal(40 * 60);
    });

    it('uses the frozen cells only while the student board is locked', () => {
        const now = new Date('2020-01-01T01:00:00.000Z');
        const contest = { pids: [11], beginAt, lockAt: at(15) };
        const status = {
            detail: { 11: { score: 100, rid: ridAt(at(20)) } },
            display: { 11: { score: 80, rid: ridAt(at(10)) } },
        };
        expect(ioiBoardStanding(contest, status, { lockAt: at(15) }, now).seconds).to.equal(10 * 60);
        expect(ioiBoardStanding(contest, status, {}, now).seconds).to.equal(20 * 60);
    });

    it('rejects a positive score without a submission id', () => {
        expect(() => ioiBoardStanding({ pids: [11], beginAt }, { detail: { 11: { score: 1 } } }, {})).to.throw(/submission id/);
    });
});

describe('IOI scoreboard order', () => {
    it('ranks by score, then passed problems, then the sum of best-submission times', async () => {
        const rows = await ioiRows(boardContest(), [
            { uid: 1, domainId: 'system', journal: [entry(10, 11, STATUS.STATUS_ACCEPTED, 100)] },
            {
                uid: 2,
                domainId: 'system',
                journal: [entry(10, 11, STATUS.STATUS_ACCEPTED, 50), entry(30, 12, STATUS.STATUS_WRONG_ANSWER, 50)],
            },
            {
                uid: 3,
                domainId: 'system',
                journal: [entry(5, 11, STATUS.STATUS_WRONG_ANSWER, 50), entry(20, 12, STATUS.STATUS_WRONG_ANSWER, 50)],
            },
            {
                uid: 4,
                domainId: 'system',
                journal: [entry(1, 11, STATUS.STATUS_ACCEPTED, 40), entry(2, 12, STATUS.STATUS_ACCEPTED, 50)],
            },
        ]);
        expect(rows[0].map((cell) => cell.type)).to.deep.equal(['rank', 'user', 'total_score', 'solved', 'time', 'problem', 'problem']);
        expect(rows[0].map((cell) => cell.value)).to.include.members(['IOI Passed', 'IOI Total Time']);
        expect(rankOf(rows, 3)).to.equal('1');
        expect(valueOf(rows, 3, 'time')).to.equal('00:25:00');
        expect(valueOf(rows, 3, 'solved')).to.equal('2');
        expect(rankOf(rows, 2)).to.equal('2');
        expect(valueOf(rows, 2, 'time')).to.equal('00:40:00');
        expect(rankOf(rows, 1)).to.equal('3');
        expect(valueOf(rows, 1, 'solved')).to.equal('1');
        expect(rankOf(rows, 4)).to.equal('4');
        expect(valueOf(rows, 4, 'total_score')).to.equal(90);
        const bing = rows.slice(1).find((row) => row.some((cell) => cell.raw === 3));
        expect(bing.find((cell) => cell.type === 'record' && cell.score === 50).value).to.equal('50\n00:05:00');
    });

    it('keeps the earlier submission when the highest score is repeated, and moves time when a later score is higher', async () => {
        const rows = await ioiRows(boardContest({ pids: [11] }), [
            {
                uid: 1,
                domainId: 'system',
                journal: [entry(76, 11, STATUS.STATUS_WRONG_ANSWER, 90), entry(80, 11, STATUS.STATUS_WRONG_ANSWER, 95), entry(100, 11, STATUS.STATUS_WRONG_ANSWER, 90)],
            },
            {
                uid: 2,
                domainId: 'system',
                journal: [entry(30, 11, STATUS.STATUS_WRONG_ANSWER, 95), entry(50, 11, STATUS.STATUS_WRONG_ANSWER, 95)],
            },
        ]);
        expect(valueOf(rows, 1, 'time')).to.equal('01:20:00');
        expect(valueOf(rows, 2, 'time')).to.equal('00:30:00');
        expect(rankOf(rows, 2)).to.equal('1');
        expect(rankOf(rows, 1)).to.equal('2');
    });

    it('leaves a full tie tied and does not let a starred row consume a place', async () => {
        const rows = await ioiRows(boardContest({ pids: [11] }), [
            { uid: 1, domainId: 'system', journal: [entry(10, 11, STATUS.STATUS_ACCEPTED, 100)] },
            { uid: 2, domainId: 'system', unrank: true, journal: [entry(1, 11, STATUS.STATUS_ACCEPTED, 40), entry(2, 11, STATUS.STATUS_ACCEPTED, 60)] },
            { uid: 3, domainId: 'system', journal: [entry(10, 11, STATUS.STATUS_ACCEPTED, 100)] },
            { uid: 4, domainId: 'system', journal: [entry(10, 11, STATUS.STATUS_WRONG_ANSWER, 90)] },
        ]);
        expect(rankOf(rows, 1)).to.equal('1');
        expect(rankOf(rows, 3)).to.equal('1');
        expect(rankOf(rows, 2)).to.equal('*');
        expect(rankOf(rows, 4)).to.equal('3');
    });

    it('counts a positive judge score even when the displayed weight changes the cell', async () => {
        const rows = await ioiRows(boardContest({ pids: [11], score: { 11: 50 } }), [
            { uid: 1, domainId: 'system', journal: [entry(12, 11, STATUS.STATUS_ACCEPTED, 100)] },
            { uid: 2, domainId: 'system', journal: [entry(4, 11, STATUS.STATUS_COMPILE_ERROR, 0)] },
        ]);
        expect(valueOf(rows, 1, 'total_score')).to.equal(50);
        expect(valueOf(rows, 1, 'solved')).to.equal('1');
        expect(valueOf(rows, 1, 'record')).to.equal('50\n00:12:00');
        expect(valueOf(rows, 2, 'solved')).to.equal('0');
        expect(valueOf(rows, 2, 'time')).to.equal('00:00:00');
        expect(valueOf(rows, 2, 'record')).to.equal('0');
    });

    it('keeps same-second submissions tied', () => {
        const left = ioiBoardRankKey({ pids: [11], beginAt }, { uid: 1, score: 100, detail: { 11: { score: 100, rid: ridAt(at(8)) } } }, {});
        const right = ioiBoardRankKey({ pids: [11], beginAt }, { uid: 2, score: 100, detail: { 11: { score: 100, rid: ridAt(at(8)) } } }, {});
        expect(ioiRankKeysTied(left, right)).to.equal(true);
    });

    it('does not add the IOI columns or time tie-break to OI or strict IOI', async () => {
        for (const ruleName of ['oi', 'strictioi'] as const) {
            const tdoc = boardContest({ rule: ruleName, pids: [11] });
            const header = await contestModel.RULES[ruleName].scoreboardHeader({ isExport: false, showDisplayName: false }, (text) => text, tdoc, pdict());
            expect(header.map((cell) => cell.type)).to.deep.equal(['rank', 'user', 'total_score', 'problem']);
            const docs = [
                { uid: 1, domainId: 'system', score: 100, detail: { 11: { score: 100, status: STATUS.STATUS_ACCEPTED, rid: ridAt(at(10)) } }, journal: [] },
                { uid: 2, domainId: 'system', score: 100, detail: { 11: { score: 100, status: STATUS.STATUS_ACCEPTED, rid: ridAt(at(40)) } }, journal: [] },
            ];
            const [rows] = await contestModel.RULES[ruleName].scoreboard({ isExport: false, showDisplayName: false }, (text) => text, tdoc, pdict(), docs as any);
            expect(rows.slice(1).map((row) => row[0].value)).to.deep.equal(['1', '1']);
        }
    });
});

describe('IOI virtual scoreboard order', () => {
    it('measures each attempt from its own start', () => {
        const startA = at(0);
        const startB = at(60);
        const ranked = rankIoiVirtualAttempts([11], [
            {
                uid: 1,
                status: 'ended',
                score: 100,
                startAt: startA,
                detail: { 11: { score: 100, rid: ridAt(new Date(startA.getTime() + 10 * MINUTE)) } },
            },
            {
                uid: 2,
                status: 'ended',
                score: 100,
                startAt: startB,
                detail: { 11: { score: 100, rid: ridAt(new Date(startB.getTime() + 10 * MINUTE)) } },
            },
            {
                uid: 3,
                status: 'active',
                score: 100,
                startAt: startA,
                detail: { 11: { score: 100, rid: ridAt(new Date(startA.getTime() + 50 * MINUTE)) } },
                display: { 11: { score: 40, rid: ridAt(new Date(startA.getTime() + 4 * MINUTE)) } },
            },
        ]);
        expect(ranked.map(([rank, attempt]) => [rank, attempt.uid])).to.deep.equal([
            [1, 3],
            [2, 1],
            [2, 2],
        ]);
    });
});
