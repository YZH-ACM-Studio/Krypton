import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

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

let loadedContest: any;
let contestReads: number;
let individualJournal: any[];
let individualResult: any;
let individualStatusReloads: number;
let revSetConflicts: number;
let releaseStatusWrite: (() => void) | null;
let signalStatusWriteStarted: (() => void) | null;
let statusWriteBarrier: Promise<void> | null;
let statusWriteStarted: Promise<void>;
let teamJournal: any[];
let teamResult: any;

async function waitAtStatusWriteBarrier() {
    if (!statusWriteBarrier) return;
    const barrier = statusWriteBarrier;
    statusWriteBarrier = null;
    signalStatusWriteStarted?.();
    await barrier;
}

const collection = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);
const documentStub = {
    TYPE_CONTEST: 30,
    async get() {
        contestReads += 1;
        return loadedContest;
    },
    getMultiStatus() {
        return {
            async toArray() {
                return individualJournal.length ? [{ uid: 10, rev: 1, journal: individualJournal.map((entry) => ({ ...entry })) }] : [];
            },
        };
    },
    async revPushStatus() {
        return { uid: 10, rev: 1, journal: individualJournal.map((entry) => ({ ...entry })) };
    },
    async revSetStatus(_domainId: string, _docType: number, _tid: ObjectId, _uid: number, _rev: number, value: any) {
        await waitAtStatusWriteBarrier();
        if (revSetConflicts > 0) {
            revSetConflicts -= 1;
            return null;
        }
        individualResult = value;
        return value;
    },
    async getStatus() {
        individualStatusReloads += 1;
        return { uid: 10, rev: 2, journal: individualJournal.map((entry) => ({ ...entry })) };
    },
};
const contestTeamStatusStub = {
    async recalculateAll(tdoc: any, calculate: (contest: any, journal: any[]) => any) {
        teamResult = calculate(
            tdoc,
            teamJournal.map((entry) => ({ ...entry })),
        );
    },
    async synchronizeFromRecord(tdoc: any, recordId: ObjectId, _loadRecord: any, calculate: (contest: any, journal: any[]) => any) {
        await waitAtStatusWriteBarrier();
        teamResult = calculate(
            tdoc,
            teamJournal.map((entry) => ({ ...entry })),
        );
        return {
            status: teamResult,
            record: {
                _id: recordId,
                uid: 10,
                pid: 101,
                status: STATUS.STATUS_ACCEPTED,
                contestTeamId: new ObjectId(),
            },
        };
    },
};
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
                getParticipationMode: (tdoc: any) => tdoc.participationMode || 'individual',
                normalizeParticipationConfig: (tdoc: any) => tdoc,
                planParticipationModeTransition: () => ({}),
                teamModeClearConfirmation: () => '',
            };
        }
        if (request === './contest-team-status') return contestTeamStatusStub;
        if (request === './document') return documentStub;
        if (request === './message' || request === './problem' || request === './record' || request === './user') {
            return { __esModule: true, default: defaultStub, ProblemModel: defaultStub, User: class {} };
        }
        if (request === './oplog') return defaultStub;
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

const domainId = 'system';
const tid = new ObjectId();
const beginAt = new Date('2020-01-01T00:00:00.000Z');
const endAt = new Date('2020-01-01T02:00:00.000Z');

function rid(seconds: number) {
    return ObjectId.createFromTime(Math.floor(beginAt.getTime() / 1000) + seconds);
}

function journal() {
    return [
        { rid: rid(600), pid: 101, status: STATUS.STATUS_WRONG_ANSWER, score: 0 },
        { rid: rid(1200), pid: 101, status: STATUS.STATUS_ACCEPTED, score: 100 },
        { rid: rid(2400), pid: 102, status: STATUS.STATUS_ACCEPTED, score: 100 },
    ];
}

function contest(lockAt: Date | null, participationMode: 'individual' | 'team' = 'individual', unlocked = false) {
    return {
        domainId,
        docId: tid,
        rule: 'acm',
        pids: [101, 102],
        beginAt,
        endAt,
        lockAt,
        unlocked,
        participationMode,
    } as any;
}

beforeEach(() => {
    loadedContest = null;
    contestReads = 0;
    individualJournal = [];
    individualResult = null;
    individualStatusReloads = 0;
    revSetConflicts = 0;
    releaseStatusWrite = null;
    signalStatusWriteStarted = null;
    statusWriteBarrier = null;
    statusWriteStarted = Promise.resolve();
    teamJournal = [];
    teamResult = null;
});

describe('contest lock recalculation results', () => {
    it('recalculates individual display when the lock moves backward, forward, then clears', async () => {
        individualJournal = journal();

        loadedContest = contest(new Date(beginAt.getTime() + 900_000));
        await contestModel.recalcStatus(domainId, tid);
        expect(individualResult).to.include({ accept: 0, time: 0 });
        expect(individualResult.detail[101].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(individualResult.display[101]).to.include({ status: STATUS.STATUS_WRONG_ANSWER, npending: 1 });
        expect(individualResult.display[102]).to.deep.equal({ npending: 1 });

        loadedContest = contest(new Date(beginAt.getTime() + 3000_000));
        await contestModel.recalcStatus(domainId, tid);
        expect(individualResult).to.include({ accept: 2, time: 4800 });
        expect(individualResult.display[101].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(individualResult.display[102].status).to.equal(STATUS.STATUS_ACCEPTED);

        loadedContest = contest(null);
        await contestModel.recalcStatus(domainId, tid);
        expect(individualResult).to.include({ accept: 2, time: 4800 });
        expect(individualResult.display).to.deep.equal(individualResult.detail);
    });

    it('uses the same persisted lock boundary for team recalculation', async () => {
        teamJournal = journal();

        loadedContest = contest(new Date(beginAt.getTime() + 900_000), 'team');
        await contestModel.recalcStatus(domainId, tid);
        expect(teamResult).to.include({ accept: 0, time: 0 });
        expect(teamResult.display[101]).to.include({ status: STATUS.STATUS_WRONG_ANSWER, npending: 1 });

        loadedContest = contest(new Date(beginAt.getTime() + 3000_000), 'team');
        await contestModel.recalcStatus(domainId, tid);
        expect(teamResult).to.include({ accept: 2, time: 4800 });
        expect(teamResult.display[101].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(teamResult.display[102].status).to.equal(STATUS.STATUS_ACCEPTED);

        loadedContest = contest(null, 'team');
        await contestModel.recalcStatus(domainId, tid);
        expect(teamResult).to.include({ accept: 2, time: 4800 });
        expect(teamResult.display).to.deep.equal(teamResult.detail);
    });

    it('retries an individual status revision conflict instead of acknowledging stale results', async () => {
        individualJournal = journal();
        revSetConflicts = 1;
        loadedContest = contest(new Date(beginAt.getTime() + 1800_000));

        await contestModel.recalcStatus(domainId, tid);

        expect(individualStatusReloads).to.equal(1);
        expect(individualResult).to.include({ accept: 1, time: 2400 });
    });

    it('serializes recalculations so an older result cannot overwrite a newer boundary', async () => {
        individualJournal = journal();
        statusWriteBarrier = new Promise<void>((resolve) => {
            releaseStatusWrite = resolve;
        });
        statusWriteStarted = new Promise<void>((resolve) => {
            signalStatusWriteStarted = resolve;
        });
        loadedContest = contest(new Date(beginAt.getTime() + 900_000));
        const older = contestModel.recalcStatus(domainId, tid);
        await statusWriteStarted;

        loadedContest = contest(new Date(beginAt.getTime() + 3000_000));
        const newer = contestModel.recalcStatus(domainId, tid);
        await Promise.resolve();
        expect(contestReads).to.equal(1);

        releaseStatusWrite?.();
        await Promise.all([older, newer]);

        expect(contestReads).to.equal(2);
        expect(individualResult).to.include({ accept: 2, time: 4800 });
        expect(individualResult.display[101].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(individualResult.display[102].status).to.equal(STATUS.STATUS_ACCEPTED);
    });

    it('serializes an individual live status update before a newer lock recalculation', async () => {
        individualJournal = journal();
        statusWriteBarrier = new Promise<void>((resolve) => {
            releaseStatusWrite = resolve;
        });
        statusWriteStarted = new Promise<void>((resolve) => {
            signalStatusWriteStarted = resolve;
        });
        loadedContest = contest(new Date(beginAt.getTime() + 900_000));
        const liveUpdate = contestModel.updateStatus(domainId, tid, 10, rid(2400), 102, {
            status: STATUS.STATUS_ACCEPTED,
            score: 100,
        });
        await statusWriteStarted;

        loadedContest = contest(new Date(beginAt.getTime() + 3000_000));
        const recalculation = contestModel.recalcStatus(domainId, tid);
        await Promise.resolve();
        expect(contestReads).to.equal(1);

        releaseStatusWrite?.();
        await Promise.all([liveUpdate, recalculation]);

        expect(contestReads).to.equal(2);
        expect(individualResult).to.include({ accept: 2, time: 4800 });
    });

    it('serializes a team live status update before a newer lock recalculation', async () => {
        teamJournal = journal();
        statusWriteBarrier = new Promise<void>((resolve) => {
            releaseStatusWrite = resolve;
        });
        statusWriteStarted = new Promise<void>((resolve) => {
            signalStatusWriteStarted = resolve;
        });
        loadedContest = contest(new Date(beginAt.getTime() + 900_000), 'team');
        const liveUpdate = contestModel.updateStatus(domainId, tid, 10, rid(1200), 101, {
            status: STATUS.STATUS_ACCEPTED,
            score: 100,
        });
        await statusWriteStarted;

        loadedContest = contest(new Date(beginAt.getTime() + 3000_000), 'team');
        const recalculation = contestModel.recalcStatus(domainId, tid);
        await Promise.resolve();
        expect(contestReads).to.equal(1);

        releaseStatusWrite?.();
        await Promise.all([liveUpdate, recalculation]);

        expect(contestReads).to.equal(2);
        expect(teamResult).to.include({ accept: 2, time: 4800 });
    });
});
