import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
(global as any).Hydro.module ||= {};

type Stored = Record<string, any>;

let rows: Stored[] = [];
let activeClaim: Stored | null = null;
let forceConcurrentMutation = false;

class ProblemContributionConflictError extends Error {}

function sameId(left: unknown, right: unknown) {
    return String(left) === String(right);
}

function matches(row: Stored, filter: Stored): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = row[key];
        if (key === '_id') return sameId(actual, expected);
        if (expected && typeof expected === 'object' && '$exists' in expected) {
            return Object.hasOwn(row, key) === expected.$exists;
        }
        return actual === expected;
    });
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

const collection = {
    async findOne(filter: Stored) {
        const row = rows.find((item) => matches(item, filter));
        return row ? clone(row) : null;
    },
    async findOneAndUpdate(filter: Stored, update: Stored) {
        if (forceConcurrentMutation) return null;
        const index = rows.findIndex((item) => matches(item, filter));
        if (index < 0) return null;
        Object.assign(rows[index], clone(update.$set || {}));
        if (update.$push?.history) rows[index].history.push(clone(update.$push.history));
        return clone(rows[index]);
    },
    async insertOne(doc: Stored) {
        if (rows.some((item) => ['domainId', 'pid', 'uid', 'scope'].every((key) => item[key] === doc[key]))) {
            const error: any = new Error('duplicate contribution identity');
            error.code = 11000;
            throw error;
        }
        rows.push(clone(doc));
        return { insertedId: doc._id };
    },
    find(filter: Stored) {
        const selected = rows.filter((item) => matches(item, filter)).map(clone);
        const cursor = {
            project() {
                return cursor;
            },
            sort(spec: Record<string, 1 | -1>) {
                selected.sort((left, right) => {
                    for (const [key, direction] of Object.entries(spec)) {
                        const l = left[key];
                        const r = right[key];
                        if (l < r) return -direction;
                        if (l > r) return direction;
                    }
                    return 0;
                });
                return cursor;
            },
            async toArray() {
                return clone(selected);
            },
        };
        return cursor;
    },
    async deleteMany(filter: Stored) {
        const before = rows.length;
        rows = rows.filter((item) => !matches(item, filter));
        return { deletedCount: before - rows.length };
    },
};

const contributionsPath = require.resolve('../src/contributions.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === contributionsPath && request === 'hydrooj') {
        return { ObjectId: require('mongodb').ObjectId, ProblemContributionConflictError };
    }
    if (parent?.filename === contributionsPath && request === './db') return { contributionsColl: collection };
    if (parent?.filename === contributionsPath && request === './repository') {
        return { mongoAclRepository: { getProblemWriteClaim: async () => clone(activeClaim) } };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let contributions: typeof import('../src/contributions');
try {
    delete require.cache[contributionsPath];
    contributions = require(contributionsPath);
} finally {
    Module._load = originalLoad;
}

const base = {
    domainId: 'system',
    pid: 7,
    actor: 2,
    writeClaimRequestId: 'claim-1',
};

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    rows = [];
    forceConcurrentMutation = false;
    activeClaim = {
        requestId: 'claim-1',
        actor: 2,
        operation: 'contribution-assign',
        capability: 'contributions',
        state: 'active',
    };
});

describe('P2.24 problem contribution lifecycle', () => {
    it('combines data and tag scopes independently for the same user', async () => {
        await contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'assign-data' });
        await contributions.assignContribution({ ...base, uid: 42, scope: 'tag', requestId: 'assign-tag' });
        await contributions.assignContribution({ ...base, uid: 43, scope: 'data', requestId: 'assign-other' });

        const loaded = await contributions.loadActiveContributionPids('system', 42);
        expect([...loaded.dataContributionPids]).to.deep.equal([7]);
        expect([...loaded.tagContributionPids]).to.deep.equal([7]);
        expect(await contributions.listContributionsForProblem('system', 7)).to.have.length(3);
    });

    it('preserves first completion and public data credit across revoke and reassignment', async () => {
        const assignedAt = new Date('2026-07-18T01:00:00.000Z');
        const completedAt = new Date('2026-07-18T02:00:00.000Z');
        const revokedAt = new Date('2026-07-18T03:00:00.000Z');
        const reassignedAt = new Date('2026-07-18T04:00:00.000Z');
        await contributions.assignContribution({
            ...base,
            uid: 42,
            scope: 'data',
            note: 'prepare cases',
            requestId: 'assign-1',
            now: assignedAt,
        });
        activeClaim = { requestId: 'complete-claim', actor: 42, operation: 'contribution-status', capability: 'data', state: 'active' };
        await contributions.setContributionStatus({
            domainId: 'system',
            pid: 7,
            uid: 42,
            scope: 'data',
            status: 'completed',
            actor: 42,
            requestId: 'complete-1',
            writeClaimRequestId: 'complete-claim',
            now: completedAt,
        });
        activeClaim = { requestId: 'claim-1', actor: 2, operation: 'contribution-revoke', capability: 'contributions', state: 'active' };
        await contributions.revokeContribution({
            ...base,
            uid: 42,
            scope: 'data',
            requestId: 'revoke-1',
            now: revokedAt,
        });

        expect(await contributions.listCompletedDataContributorUids('system', 7)).to.deep.equal([42]);
        expect([...(await contributions.loadActiveContributionPids('system', 42)).dataContributionPids]).to.deep.equal([]);

        activeClaim = { ...activeClaim, operation: 'contribution-assign' };
        const reassigned = await contributions.assignContribution({
            ...base,
            uid: 42,
            scope: 'data',
            note: 'repair checker',
            requestId: 'assign-2',
            now: reassignedAt,
        });
        expect(reassigned).to.deep.include({ active: true, status: 'pending', note: 'repair checker' });
        expect(reassigned.firstCompletedAt).to.deep.equal(completedAt);
        expect(reassigned.history.map((entry) => entry.action)).to.deep.equal(['assigned', 'completed', 'revoked', 'assigned']);
        expect(reassigned.history.every((entry) => entry.result === 'success')).to.equal(true);
    });

    it('treats a retried historical request id as a no-op instead of replaying an old action', async () => {
        await contributions.assignContribution({ ...base, uid: 42, scope: 'tag', requestId: 'assign-once' });
        activeClaim = { requestId: 'complete-claim', actor: 42, operation: 'contribution-status', capability: 'tag', state: 'active' };
        const completed = await contributions.setContributionStatus({
            domainId: 'system',
            pid: 7,
            uid: 42,
            scope: 'tag',
            status: 'completed',
            actor: 42,
            requestId: 'complete-once',
            writeClaimRequestId: 'complete-claim',
        });
        activeClaim = { requestId: 'claim-1', actor: 2, operation: 'contribution-assign', capability: 'contributions', state: 'active' };
        const replay = await contributions.assignContribution({ ...base, uid: 42, scope: 'tag', requestId: 'assign-once' });

        expect(replay.status).to.equal('completed');
        expect(replay.updatedAt).to.deep.equal(completed.updatedAt);
        expect(replay.history).to.have.length(2);
    });

    it('requires exact management and self-status claims', async () => {
        activeClaim = { ...activeClaim, actor: 9 };
        const deniedAssign = await captureFailure(() =>
            contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'denied-assign' }),
        );
        expect(deniedAssign?.message).to.match(/active contribution-assign claim/);
        expect(rows).to.deep.equal([]);

        activeClaim = { ...activeClaim, actor: 2 };
        await contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'assign' });
        const deniedStatus = await captureFailure(() =>
            contributions.setContributionStatus({
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'data',
                status: 'completed',
                actor: 9,
                requestId: 'forged-complete',
                writeClaimRequestId: 'claim-1',
            }),
        );
        expect(deniedStatus?.message).to.match(/active contributions claim/);
        expect(rows[0].status).to.equal('pending');

        activeClaim = { requestId: 'self-claim', actor: 42, operation: 'contribution-status', capability: 'data', state: 'active' };
        await contributions.setContributionStatus({
            domainId: 'system',
            pid: 7,
            uid: 42,
            scope: 'data',
            status: 'completed',
            actor: 42,
            requestId: 'self-complete',
            writeClaimRequestId: 'self-claim',
        });
        expect(rows[0].status).to.equal('completed');
    });

    it('rejects a request id replayed for a different contribution action', async () => {
        await contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'shared-mutation' });
        activeClaim = { ...activeClaim, operation: 'contribution-revoke' };

        const revokeConflict = await captureFailure(() =>
            contributions.revokeContribution({ ...base, uid: 42, scope: 'data', requestId: 'shared-mutation' }),
        );
        expect(revokeConflict).to.be.instanceOf(ProblemContributionConflictError);
        expect(rows[0]).to.deep.include({ active: true, status: 'pending' });
        expect(rows[0].history.map((entry: Stored) => entry.action)).to.deep.equal(['assigned']);

        activeClaim = {
            requestId: 'self-claim',
            actor: 42,
            operation: 'contribution-status',
            capability: 'data',
            state: 'active',
        };
        await contributions.setContributionStatus({
            domainId: 'system',
            pid: 7,
            uid: 42,
            scope: 'data',
            status: 'completed',
            actor: 42,
            requestId: 'shared-status',
            writeClaimRequestId: 'self-claim',
        });
        const reopenConflict = await captureFailure(() =>
            contributions.setContributionStatus({
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'data',
                status: 'pending',
                actor: 42,
                requestId: 'shared-status',
                writeClaimRequestId: 'self-claim',
            }),
        );
        expect(reopenConflict).to.be.instanceOf(ProblemContributionConflictError);
        expect(rows[0].status).to.equal('completed');
        expect(rows[0].history.map((entry: Stored) => entry.action)).to.deep.equal(['assigned', 'completed']);
    });

    it('requires the write claim operation to match the contribution mutation', async () => {
        activeClaim = { ...activeClaim, operation: 'contribution-revoke' };
        const crossOperationAssign = await captureFailure(() =>
            contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'assign-with-revoke-claim' }),
        );
        expect(crossOperationAssign?.message).to.match(/active contribution-assign claim/);
        expect(rows).to.deep.equal([]);

        activeClaim = { ...activeClaim, operation: 'contribution-assign' };
        await contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'valid-assign' });
        activeClaim = { ...activeClaim, operation: 'contribution-assign' };
        const crossOperationRevoke = await captureFailure(() =>
            contributions.revokeContribution({ ...base, uid: 42, scope: 'data', requestId: 'revoke-with-assign-claim' }),
        );
        expect(crossOperationRevoke?.message).to.match(/active contribution-revoke claim/);
        expect(rows[0].active).to.equal(true);

        activeClaim = {
            requestId: 'file-claim',
            actor: 42,
            operation: 'files-upload',
            capability: 'data',
            state: 'active',
        };
        const crossOperationStatus = await captureFailure(() =>
            contributions.setContributionStatus({
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'data',
                status: 'completed',
                actor: 42,
                requestId: 'status-with-file-claim',
                writeClaimRequestId: 'file-claim',
            }),
        );
        expect(crossOperationStatus?.message).to.match(/active data claim/);
        expect(rows[0].status).to.equal('pending');
    });

    it('reports a contribution-row CAS race as a clean conflict', async () => {
        await contributions.assignContribution({ ...base, uid: 42, scope: 'data', requestId: 'assign' });
        activeClaim = { requestId: 'self-claim', actor: 42, operation: 'contribution-status', capability: 'data', state: 'active' };
        forceConcurrentMutation = true;

        const conflict = await captureFailure(() =>
            contributions.setContributionStatus({
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'data',
                status: 'completed',
                actor: 42,
                requestId: 'complete',
                writeClaimRequestId: 'self-claim',
            }),
        );

        expect(conflict).to.be.instanceOf(ProblemContributionConflictError);
        expect(rows[0].status).to.equal('pending');
    });
});
