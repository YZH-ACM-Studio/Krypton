import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { syntheticVirtualContestDoc, type VirtualContestSnapshot } from '../src/lib/virtual-contest';

const Module = require('module');
const contestPath = require.resolve('../src/model/contest.ts');
const originalLoad = Module._load;

const STATUS = {
    STATUS_WAITING: 0,
    STATUS_ACCEPTED: 1,
    STATUS_WRONG_ANSWER: 2,
    STATUS_COMPILE_ERROR: 7,
    STATUS_CANCELED: 9,
    STATUS_FORMAT_ERROR: 31,
};

const collection = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);
const defaultStub = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === contestPath) {
        if (request === '../context') return { Context: class {} };
        if (request === '../error') {
            return new Proxy(
                {},
                {
                    get: () => class extends Error {},
                },
            );
        }
        if (request === '../lib/avatar') return { __esModule: true, default: () => '' };
        if (request === '../service/bus') return { __esModule: true, default: defaultStub };
        if (request === '../service/db') return { __esModule: true, default: { collection: () => collection } };
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
        if (request === './message' || request === './problem' || request === './record' || request === './user') {
            return { __esModule: true, default: defaultStub, ProblemModel: defaultStub, User: class {} };
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

const beginAt = new Date('2026-08-01T01:00:00.000Z');
const endAt = new Date('2026-08-01T03:00:00.000Z');
const lockAt = new Date('2026-08-01T02:30:00.000Z');
const vpStart = new Date('2026-08-10T04:00:00.000Z');
const shift = vpStart.getTime() - beginAt.getTime();

function ridAt(sourceTime: Date) {
    return ObjectId.createFromTime(Math.floor(sourceTime.getTime() / 1000));
}

function shiftedRid(sourceTime: Date) {
    return ObjectId.createFromTime(Math.floor((sourceTime.getTime() + shift) / 1000));
}

describe('P4.2 virtual contest scoring matches official rule.stat', () => {
    const snapshot: VirtualContestSnapshot = {
        rule: 'acm',
        pids: [11, 12],
        score: { 11: 100, 12: 100 },
        title: 'Source',
        durationMs: endAt.getTime() - beginAt.getTime(),
        lockOffsetMs: lockAt.getTime() - beginAt.getTime(),
        sourceBeginAt: beginAt,
        sourceEndAt: endAt,
        langs: [],
    };

    it('keeps ACM penalty time and lock pending aligned after shifting the attempt clock', () => {
        const officialJournal = [
            { rid: ridAt(new Date(beginAt.getTime() + 10 * 60_000)), pid: 11, status: STATUS.STATUS_WRONG_ANSWER, score: 0 },
            { rid: ridAt(new Date(beginAt.getTime() + 20 * 60_000)), pid: 11, status: STATUS.STATUS_ACCEPTED, score: 100 },
            { rid: ridAt(new Date(lockAt.getTime() + 60_000)), pid: 12, status: STATUS.STATUS_ACCEPTED, score: 100 },
        ];
        const virtualJournal = officialJournal.map((entry) => ({
            ...entry,
            rid: shiftedRid(entry.rid.getTimestamp()),
        }));
        const official = {
            domainId: 'system',
            docId: new ObjectId(),
            rule: 'acm' as const,
            pids: snapshot.pids,
            score: snapshot.score,
            beginAt,
            endAt,
            lockAt,
        };
        const virtual = syntheticVirtualContestDoc({
            domainId: 'system',
            sourceContestId: official.docId,
            snapshot,
            startAt: vpStart,
            endAt: new Date(vpStart.getTime() + snapshot.durationMs),
        });
        const officialStat = contestModel.RULES.acm.stat(official as any, officialJournal);
        const virtualStat = contestModel.RULES.acm.stat(virtual, virtualJournal);
        expect(virtualStat.accept).to.equal(officialStat.accept);
        expect(virtualStat.time).to.equal(officialStat.time);
        expect(virtualStat.detail[11].naccept).to.equal(officialStat.detail[11].naccept);
        expect(virtualStat.display[12]?.npending).to.equal(officialStat.display[12]?.npending);
        const unlocked = syntheticVirtualContestDoc({
            domainId: 'system',
            sourceContestId: official.docId,
            snapshot,
            startAt: vpStart,
            endAt: new Date(vpStart.getTime() + snapshot.durationMs),
            unlocked: true,
        });
        const unlockedStat = contestModel.RULES.acm.stat(unlocked, virtualJournal);
        expect(unlockedStat.accept).to.equal(2);
        expect(unlockedStat.detail[12].status).to.equal(STATUS.STATUS_ACCEPTED);
    });

    it('matches OI/IOI/Ledo/StrictIOI score snapshots on the same relative journal', () => {
        const journal = [
            { rid: ridAt(new Date(beginAt.getTime() + 5 * 60_000)), pid: 11, status: STATUS.STATUS_WRONG_ANSWER, score: 40, subtasks: { 1: { score: 40, status: STATUS.STATUS_WRONG_ANSWER } } },
            { rid: ridAt(new Date(beginAt.getTime() + 15 * 60_000)), pid: 11, status: STATUS.STATUS_ACCEPTED, score: 80, subtasks: { 1: { score: 80, status: STATUS.STATUS_ACCEPTED } } },
            { rid: ridAt(new Date(beginAt.getTime() + 25 * 60_000)), pid: 12, status: STATUS.STATUS_ACCEPTED, score: 100, subtasks: { 1: { score: 100, status: STATUS.STATUS_ACCEPTED } } },
        ];
        const virtualJournal = journal.map((entry) => ({ ...entry, rid: shiftedRid(entry.rid.getTimestamp()) }));
        const official = {
            domainId: 'system',
            docId: new ObjectId(),
            pids: snapshot.pids,
            score: snapshot.score,
            beginAt,
            endAt,
        };
        const virtualBase = {
            domainId: 'system',
            sourceContestId: official.docId,
            startAt: vpStart,
            endAt: new Date(vpStart.getTime() + snapshot.durationMs),
        };
        for (const rule of ['oi', 'ioi', 'ledo', 'strictioi'] as const) {
            const officialStat = contestModel.RULES[rule].stat({ ...official, rule } as any, journal);
            const virtualStat = contestModel.RULES[rule].stat(
                syntheticVirtualContestDoc({ ...virtualBase, snapshot: { ...snapshot, rule } }),
                virtualJournal,
            );
            expect(virtualStat.score, rule).to.equal(officialStat.score);
            expect(Object.keys(virtualStat.detail || {}), rule).to.deep.equal(Object.keys(officialStat.detail || {}));
        }
    });
});
