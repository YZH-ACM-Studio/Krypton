import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';

const Module = require('module');
const historyPath = require.resolve('../src/history.ts');
const originalLoad = Module._load;

interface HistoryDoc {
    uid: number;
    site: 'codeforces' | 'nowcoder';
    handle: string;
    contestId: string;
    contestName: string | null;
    ratedAt: Date;
    rating: number;
    oldRating: number | null;
    rank: number | null;
    ingestedAt: Date;
}

interface HistoryPoint {
    handle: string;
    contestId: string;
    contestName?: string | null;
    ratedAt: Date;
    rating: number;
    oldRating?: number | null;
    rank?: number | null;
}

interface HistoryBySite {
    codeforces: HistoryDoc[];
    nowcoder: HistoryDoc[];
}

interface BulkWriteOp {
    updateOne: {
        filter: { uid: number; site: string; contestId: string };
        update: { $set: HistoryDoc };
        upsert?: boolean;
    };
}

function cloneDoc(doc: HistoryDoc): HistoryDoc {
    return {
        ...doc,
        ratedAt: new Date(doc.ratedAt.getTime()),
        ingestedAt: new Date(doc.ingestedAt.getTime()),
    };
}

function matchesIdentity(doc: HistoryDoc, filter: BulkWriteOp['updateOne']['filter']): boolean {
    return doc.uid === filter.uid && doc.site === filter.site && doc.contestId === filter.contestId;
}

const docs: HistoryDoc[] = [];
const bulkWriteCalls: BulkWriteOp[][] = [];
const deleteCalls: unknown[] = [];
let ensureIndexesCalls = 0;

const historyColl = {
    async bulkWrite(operations: BulkWriteOp[]) {
        bulkWriteCalls.push(operations);
        for (const operation of operations) {
            const { filter, update, upsert } = operation.updateOne;
            const index = docs.findIndex((doc) => matchesIdentity(doc, filter));
            if (index >= 0) {
                docs[index] = { ...docs[index], ...update.$set };
                continue;
            }
            if (!upsert) continue;
            docs.push({ ...update.$set });
        }
        return { ok: 1 };
    },
    find(filter: { uid?: number; site?: string } = {}) {
        let rows = docs
            .filter((doc) => (filter.uid === undefined || doc.uid === filter.uid)
                && (filter.site === undefined || doc.site === filter.site))
            .map(cloneDoc);
        const cursor = {
            sort(spec: { ratedAt?: number }) {
                if (spec.ratedAt) {
                    rows = [...rows].sort((left, right) => (left.ratedAt.getTime() - right.ratedAt.getTime()) * spec.ratedAt);
                }
                return cursor;
            },
            async toArray() {
                return rows;
            },
        };
        return cursor;
    },
    async deleteMany(filter: unknown) {
        deleteCalls.push(filter);
        throw new Error('history must not delete rows');
    },
    async deleteOne(filter: unknown) {
        deleteCalls.push(filter);
        throw new Error('history must not delete rows');
    },
};

async function ensureIndexes(): Promise<void> {
    ensureIndexesCalls += 1;
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === './db' && parent?.filename === historyPath) {
        return { historyColl, ensureIndexes, ExternalRatingHistoryDoc: undefined };
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface HistoryApi {
    EXTERNAL_RATING_HISTORY_MAX_POINTS: number;
    upsertPoints(uid: number, site: 'codeforces' | 'nowcoder', points: HistoryPoint[]): Promise<void>;
    listHistory(uid: number): Promise<HistoryBySite>;
    listHistory(uid: number, site: 'codeforces' | 'nowcoder'): Promise<HistoryDoc[]>;
}

delete require.cache[historyPath];
const { EXTERNAL_RATING_HISTORY_MAX_POINTS, upsertPoints, listHistory } = require(historyPath) as HistoryApi;

after(() => {
    Module._load = originalLoad;
});

const UID = 10;
const OTHER_UID = 11;
const RATED_AT = new Date('2026-01-15T00:00:00.000Z');
const LATER = new Date('2026-03-01T00:00:00.000Z');

function point(overrides: Partial<HistoryPoint> = {}): HistoryPoint {
    return {
        handle: 'tourist',
        contestId: '123',
        contestName: 'Round 1',
        ratedAt: RATED_AT,
        rating: 1500,
        oldRating: 1400,
        rank: 100,
        ...overrides,
    };
}

async function expectThrown(run: () => Promise<unknown>, field?: string): Promise<Error> {
    try {
        await run();
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
        if (field !== undefined) {
            expect((error as { field?: string }).field).to.equal(field);
        }
        return error as Error;
    }
    expect.fail('expected fail closed');
    throw new Error('unreachable');
}

beforeEach(() => {
    docs.splice(0, docs.length);
    bulkWriteCalls.splice(0, bulkWriteCalls.length);
    deleteCalls.splice(0, deleteCalls.length);
    ensureIndexesCalls = 0;
});

describe('krypton-external-rating history persist', { concurrency: false }, () => {
    it('upserts the same contestId twice as one row', async () => {
        await upsertPoints(UID, 'codeforces', [point({ rating: 1500 })]);
        await upsertPoints(UID, 'codeforces', [point({ rating: 1500, oldRating: 1450 })]);
        const listed = await listHistory(UID);
        expect(listed.codeforces).to.have.length(1);
        expect(listed.nowcoder).to.have.length(0);
        expect(listed.codeforces[0].contestId).to.equal('123');
        expect(listed.codeforces[0].rating).to.equal(1500);
        expect(listed.codeforces[0].oldRating).to.equal(1450);
        expect(listed.codeforces[0].handle).to.equal('tourist');
    });

    it('keeps old contest rows when the handle changes', async () => {
        await upsertPoints(UID, 'codeforces', [point({ handle: 'alice', contestId: '1', rating: 1200 })]);
        await upsertPoints(UID, 'codeforces', [point({
            handle: 'bob',
            contestId: '2',
            rating: 1600,
            ratedAt: LATER,
            contestName: 'Round 2',
        })]);
        const listed = await listHistory(UID);
        expect(listed.codeforces).to.have.length(2);
        expect(listed.codeforces.map((row) => row.contestId)).to.deep.equal(['1', '2']);
        expect(listed.codeforces[0].handle).to.equal('alice');
        expect(listed.codeforces[1].handle).to.equal('bob');
        expect(deleteCalls).to.have.length(0);
    });

    it('does not delete history when points are empty (unset handle is a no-op)', async () => {
        await upsertPoints(UID, 'nowcoder', [point({ handle: 'jiangly', contestId: 'nk-1', rating: 2000 })]);
        await upsertPoints(UID, 'nowcoder', []);
        expect(bulkWriteCalls).to.have.length(1);
        const listed = await listHistory(UID, 'nowcoder');
        expect(listed).to.have.length(1);
        expect(listed[0].handle).to.equal('jiangly');
        expect(listed[0].contestId).to.equal('nk-1');
        expect(deleteCalls).to.have.length(0);
    });

    it('throws on invalid rating and does not write', async () => {
        await expectThrown(() => upsertPoints(UID, 'codeforces', [point({ rating: 100000 })]), 'points[0].rating');
        await expectThrown(() => upsertPoints(UID, 'codeforces', [point({ rating: -1 })]), 'points[0].rating');
        await expectThrown(() => upsertPoints(UID, 'codeforces', [point({ rating: 1.5 })]), 'points[0].rating');
        await expectThrown(() => upsertPoints(UID, 'codeforces', [point({ rating: Number.NaN })]), 'points[0].rating');
        await expectThrown(
            () => upsertPoints(UID, 'codeforces', [{ ...point(), rating: null as unknown as number }]),
            'points[0].rating',
        );
        expect(docs).to.have.length(0);
        expect(bulkWriteCalls).to.have.length(0);
    });

    it('lists each site sorted by ratedAt ascending', async () => {
        await upsertPoints(UID, 'codeforces', [
            point({ contestId: 'late', ratedAt: LATER, rating: 1700 }),
            point({ contestId: 'early', ratedAt: RATED_AT, rating: 1400 }),
        ]);
        await upsertPoints(UID, 'nowcoder', [point({ handle: 'jiangly', contestId: 'nk-9', rating: 2100 })]);
        await upsertPoints(OTHER_UID, 'codeforces', [point({ handle: 'other', contestId: 'x', rating: 800 })]);
        const listed = await listHistory(UID);
        expect(listed.codeforces.map((row) => row.contestId)).to.deep.equal(['early', 'late']);
        expect(listed.nowcoder).to.have.length(1);
        expect(listed.nowcoder[0].contestId).to.equal('nk-9');
        const cfOnly = await listHistory(UID, 'codeforces');
        expect(cfOnly.map((row) => row.contestId)).to.deep.equal(['early', 'late']);
    });

    it('rejects oversize batches instead of truncating', async () => {
        const oversized = Array.from({ length: EXTERNAL_RATING_HISTORY_MAX_POINTS + 1 }, (_, i) => (
            point({ contestId: String(i + 1), rating: 1000 })
        ));
        await expectThrown(() => upsertPoints(UID, 'codeforces', oversized), 'points');
        expect(docs).to.have.length(0);
        expect(bulkWriteCalls).to.have.length(0);
    });

    it('uses bulkWrite upsert on {uid,site,contestId} and accepts null contestName/oldRating/rank', async () => {
        await upsertPoints(UID, 'codeforces', [point({
            contestName: null,
            oldRating: null,
            rank: null,
        })]);
        expect(bulkWriteCalls).to.have.length(1);
        const [operation] = bulkWriteCalls[0];
        expect(operation.updateOne.upsert).to.equal(true);
        expect(operation.updateOne.filter).to.deep.equal({ uid: UID, site: 'codeforces', contestId: '123' });
        const listed = await listHistory(UID, 'codeforces');
        expect(listed[0].contestName).to.equal(null);
        expect(listed[0].oldRating).to.equal(null);
        expect(listed[0].rank).to.equal(null);
        expect(ensureIndexesCalls).to.be.greaterThan(0);
    });
});
