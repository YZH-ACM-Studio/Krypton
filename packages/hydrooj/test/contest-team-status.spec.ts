import { expect } from 'chai';
import { readFileSync } from 'fs';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
const modulePath = require.resolve('../src/model/contest-team-status.ts');
const originalLoad = Module._load;

class TestValidationError extends Error {}

const docs: any[] = [];
let readBarrierRemaining = 0;
let releaseReadBarrier: (() => void) | null = null;
let readBarrier = Promise.resolve();

function armReadBarrier(participants: number) {
    readBarrierRemaining = participants;
    readBarrier = new Promise<void>((resolve) => {
        releaseReadBarrier = resolve;
    });
}

function same(left: any, right: any): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, value]) => same(doc[key], value));
}

function clone(doc: any) {
    if (!doc) return doc;
    return {
        ...doc,
        journal: (doc.journal || []).map((entry: any) => ({ ...entry })),
        detail: { ...(doc.detail || {}) },
        display: { ...(doc.display || {}) },
    };
}

const collection = {
    async findOne(filter: any) {
        const found = clone(docs.find((doc) => matches(doc, filter)) || null);
        if (readBarrierRemaining > 0) {
            readBarrierRemaining -= 1;
            if (readBarrierRemaining === 0) releaseReadBarrier?.();
            else await readBarrier;
        }
        return found;
    },
    async findOneAndUpdate(filter: any, update: any) {
        const found = docs.find((doc) => matches(doc, filter));
        if (!found) return null;
        Object.assign(found, clone(update.$set || {}));
        found.revision += Number(update.$inc?.revision || 0);
        return clone(found);
    },
    async insertOne(doc: any) {
        if (docs.some((candidate) => candidate.domainId === doc.domainId && same(candidate.contestId, doc.contestId) && same(candidate.teamId, doc.teamId))) {
            throw Object.assign(new Error('duplicate team status'), { code: 11000 });
        }
        docs.push(clone(doc));
        return { insertedId: doc._id };
    },
    distinct(key: string, filter: any) {
        return Promise.resolve(docs.filter((doc) => matches(doc, filter)).map((doc) => doc[key]));
    },
    find(filter: any) {
        return {
            async toArray() {
                return docs.filter((doc) => matches(doc, filter)).map(clone);
            },
        };
    },
    async deleteMany(filter: any) {
        const found = docs.filter((doc) => matches(doc, filter));
        for (const doc of found) docs.splice(docs.indexOf(doc), 1);
        return { deletedCount: found.length };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === '../context') return { Context: class {} };
        if (request === '../error') return { ValidationError: TestValidationError };
        if (request === '../service/db') return { __esModule: true, default: { collection: () => collection } };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let statusModel: typeof import('../src/model/contest-team-status');
try {
    (global as any).Hydro = { model: {} };
    delete require.cache[modulePath];
    statusModel = require(modulePath);
} finally {
    Module._load = originalLoad;
}

const domainId = 'system';
const contestId = new ObjectId();
const teamA = new ObjectId();
const teamB = new ObjectId();
const beginAt = new Date('2026-07-21T00:00:00.000Z');
const tdoc = {
    domainId,
    docId: contestId,
    rule: 'acm',
    pids: [101, 102],
    beginAt,
} as any;

function rid(seconds: number) {
    return ObjectId.createFromTime(Math.floor(beginAt.getTime() / 1000) + seconds);
}

function ridInSecond(seconds: number, sequence: number) {
    return new ObjectId(`${rid(seconds).toHexString().slice(0, 8)}${sequence.toString(16).padStart(16, '0')}`);
}

function record(teamId: ObjectId | undefined, recordId: ObjectId, pid: number, uid: number, status: number) {
    return {
        _id: recordId,
        domainId,
        contest: contestId,
        contestTeamId: teamId,
        pid,
        uid,
        status,
        score: status === 4 ? 100 : 0,
        lang: 'cc',
    } as any;
}

function acmStats(_tdoc: any, journal: any[]) {
    const detail: Record<number, any> = {};
    const attempts: Record<number, number> = {};
    for (const entry of journal) {
        if (detail[entry.pid]?.status === 4) continue;
        if (entry.status !== 4) attempts[entry.pid] = (attempts[entry.pid] || 0) + 1;
        const real = Math.floor((entry.rid.getTimestamp().getTime() - beginAt.getTime()) / 1000);
        detail[entry.pid] = { ...entry, real, penalty: (attempts[entry.pid] || 0) * 1200, time: real + (attempts[entry.pid] || 0) * 1200 };
    }
    const solved = Object.values(detail).filter((entry: any) => entry.status === 4) as any[];
    return {
        accept: solved.length,
        time: solved.reduce((sum, entry) => sum + entry.time, 0),
        detail,
        display: { ...detail },
    } as any;
}

function team(teamId: ObjectId, name: string, active: boolean, memberUids = [10], captainUid = memberUids[0]) {
    return {
        _id: teamId,
        teamId,
        domainId,
        contestId,
        name,
        nameKey: name.toLowerCase(),
        description: '',
        captainUid,
        memberUids,
        managementMode: 'admin',
        revision: 1,
        active,
        createdBy: 1,
        createdAt: beginAt,
        updatedAt: beginAt,
    } as any;
}

beforeEach(() => {
    docs.length = 0;
    readBarrierRemaining = 0;
    releaseReadBarrier = null;
    readBarrier = Promise.resolve();
});

describe('P1.13 team contest status', () => {
    it('keeps scoring on the stable team when the real submitting actor changes with the captain', async () => {
        await statusModel.updateFromRecord(tdoc, record(teamA, rid(60), 101, 10, 2), acmStats);
        const updated = await statusModel.updateFromRecord(tdoc, record(teamA, rid(120), 101, 11, 4), acmStats);

        expect(updated.teamId.equals(teamA)).to.equal(true);
        expect(updated.journal.map((entry) => entry.rid.toHexString())).to.deep.equal([rid(60).toHexString(), rid(120).toHexString()]);
        expect(updated).to.include({ accept: 1, score: 1, time: 1320 });
    });

    it('replaces the same rid idempotently for rejudge and duplicate callbacks', async () => {
        const recordId = rid(300);
        await statusModel.updateFromRecord(tdoc, record(teamA, recordId, 101, 10, 2), acmStats);
        await statusModel.updateFromRecord(tdoc, record(teamA, recordId, 101, 10, 4), acmStats);
        const duplicate = await statusModel.updateFromRecord(tdoc, record(teamA, recordId, 101, 10, 4), acmStats);

        expect(duplicate.journal).to.have.length(1);
        expect(duplicate.journal[0].status).to.equal(4);
        expect(duplicate).to.include({ accept: 1, score: 1, time: 300 });
    });

    it('reconciles a stale waiting snapshot with the current accepted Record before returning', async () => {
        const recordId = rid(240);
        const waiting = record(teamA, recordId, 101, 10, 2);
        const accepted = record(teamA, recordId, 101, 10, 4);
        const snapshots = [waiting, accepted, accepted];
        const synced = await statusModel.synchronizeFromRecord(tdoc, recordId, async () => snapshots.shift() || accepted, acmStats);

        expect(synced.record.status).to.equal(4);
        expect(synced.status.journal).to.have.length(1);
        expect(synced.status.journal[0].status).to.equal(4);
        expect(await statusModel.get(domainId, contestId, teamA)).to.include({ accept: 1, score: 1, time: 240 });
    });

    it('orders submissions in the same second by the complete Record ObjectId', async () => {
        const wrong = ridInSecond(60, 1);
        const accepted = ridInSecond(60, 2);
        await statusModel.updateFromRecord(tdoc, record(teamA, accepted, 101, 10, 4), acmStats);
        const updated = await statusModel.updateFromRecord(tdoc, record(teamA, wrong, 101, 10, 2), acmStats);

        expect(updated.journal.map((entry) => entry.rid.toHexString())).to.deep.equal([wrong.toHexString(), accepted.toHexString()]);
        expect(updated).to.include({ accept: 1, score: 1, time: 1260 });
    });

    it('marks exactly one team as first accepted when two teams solve in the same second', () => {
        const firstRid = ridInSecond(90, 1);
        const secondRid = ridInSecond(90, 2);
        const statuses = [
            { detail: { 101: { pid: 101, rid: secondRid, status: 4 } } },
            { detail: { 101: { pid: 101, rid: firstRid, status: 4 } } },
        ] as any;
        const first = statusModel.firstAcceptedRidByProblem(statuses, 4);

        expect(first[101]).to.equal(firstRid.toHexString());
        expect(statusModel.matchesFirstAcceptedRid(firstRid, first[101])).to.equal(true);
        expect(statusModel.matchesFirstAcceptedRid(secondRid, first[101])).to.equal(false);
        expect(statusModel.matchesFirstAcceptedRid(secondRid, secondRid.getTimestamp().getTime())).to.equal(true);
    });

    it('merges concurrent callbacks with revision CAS instead of losing either problem', async () => {
        await statusModel.updateFromRecord(tdoc, record(teamA, rid(30), 101, 10, 2), acmStats);
        armReadBarrier(2);
        await Promise.all([
            statusModel.updateFromRecord(tdoc, record(teamA, rid(90), 101, 10, 4), acmStats),
            statusModel.updateFromRecord(tdoc, record(teamA, rid(180), 102, 10, 4), acmStats),
        ]);

        const current = await statusModel.get(domainId, contestId, teamA);
        expect(current?.journal).to.have.length(3);
        expect(current).to.include({ accept: 2, score: 2, time: 1470 });
    });

    it('uses the Record team id even after an administrator moves the actor to another team', async () => {
        await statusModel.updateFromRecord(tdoc, record(teamA, rid(100), 101, 10, 4), acmStats);
        await statusModel.updateFromRecord(tdoc, record(teamB, rid(200), 102, 10, 4), acmStats);

        expect(await statusModel.get(domainId, contestId, teamA)).to.include({ accept: 1, score: 1 });
        expect(await statusModel.get(domainId, contestId, teamB)).to.include({ accept: 1, score: 1 });
    });

    it('builds one ranked row per active team, preserves current rosters, and retains scored inactive teams', () => {
        const inactiveWithoutScore = new ObjectId();
        const statusA = {
            _id: teamA,
            domainId,
            contestId,
            teamId: teamA,
            revision: 2,
            journal: [],
            score: 2,
            accept: 2,
            time: 500,
            detail: {},
            display: {},
            createdAt: beginAt,
            updatedAt: beginAt,
        } as any;
        const statusB = { ...statusA, _id: teamB, teamId: teamB, score: 1, accept: 1, time: 100 };
        const currentRoster = team(teamA, 'Alpha', true, [11, 12, 13], 12);
        const entries = statusModel.mergeScoreboardEntries(
            tdoc,
            [team(teamB, 'Beta', false, [20]), team(inactiveWithoutScore, 'Closed', false, [30]), currentRoster, team(new ObjectId(), 'Zero', true, [40])],
            [statusB, statusA],
        );

        expect(entries.map((entry) => entry.team.name)).to.deep.equal(['Alpha', 'Beta', 'Zero']);
        expect(entries[0].team.memberUids).to.deep.equal([11, 12, 13]);
        expect(entries[0].team.captainUid).to.equal(12);
        expect(entries[2].status).to.include({ accept: 0, score: 0, time: 0 });
    });

    it('fails closed when a team contest record has no valid stable team id', async () => {
        const error = await statusModel.updateFromRecord(tdoc, record(undefined, rid(100), 101, 10, 4), acmStats).catch((caught) => caught);
        expect(error).to.be.instanceOf(TestValidationError);
        expect(docs).to.deep.equal([]);
    });

    it('keeps the concrete Record to judge callback to team-status and team-scoreboard wiring intact', () => {
        const recordSource = readFileSync(require.resolve('../src/model/record.ts'), 'utf8');
        const judgeSource = readFileSync(require.resolve('../src/handler/judge.ts'), 'utf8');
        const contestSource = readFileSync(require.resolve('../src/model/contest.ts'), 'utf8');
        expect(recordSource).to.include('data.contestTeamId = capability.teamId');
        expect(judgeSource).to.include('contest.updateStatus(rdoc.domainId, rdoc.contest, rdoc.uid, rdoc._id, rdoc.pid, rdoc)');
        expect(contestSource).to.include('contestTeamStatus.synchronizeFromRecord(');
        expect(contestSource).to.include("getParticipationMode(tdoc) === 'team'");
        expect(contestSource).to.include('await getTeamScoreboard.call(this, tdoc, config, pdict)');
    });
});
