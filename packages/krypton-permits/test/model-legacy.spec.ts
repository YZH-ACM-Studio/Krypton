import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');

class FakeObjectId {
    constructor(private readonly value: string) {}
    toHexString() {
        return this.value;
    }
}

const ids = {
    directVerifier: new FakeObjectId('direct-verifier'),
    directMaintainer: new FakeObjectId('direct-maintainer'),
    contestVerifier: new FakeObjectId('contest-verifier'),
    contestMaintainer: new FakeObjectId('contest-maintainer'),
    inactive: new FakeObjectId('inactive'),
    managedAuthor: new FakeObjectId('managed-author'),
    managedMaintainer: new FakeObjectId('managed-maintainer'),
};

const rows = [
    { _id: ids.directVerifier, domainId: 'system', pid: 1, uid: 9, role: 'verifier', viaContest: null },
    { _id: ids.directMaintainer, domainId: 'system', pid: 2, uid: 9, role: 'maintainer', viaContest: null },
    { _id: ids.contestVerifier, domainId: 'system', pid: 3, uid: 9, role: 'verifier', viaContest: new FakeObjectId('c1') },
    { _id: ids.contestMaintainer, domainId: 'system', pid: 4, uid: 9, role: 'maintainer', viaContest: new FakeObjectId('c2') },
    { _id: ids.inactive, domainId: 'system', pid: 5, uid: 9, role: 'maintainer', active: false, viaContest: null },
    { _id: ids.managedAuthor, domainId: 'system', pid: 6, uid: 9, role: 'author', active: true, viaContest: null },
    { _id: ids.managedMaintainer, domainId: 'system', pid: 7, uid: 9, role: 'maintainer', active: true, viaContest: null },
];

const managedPids = new Set([6, 7, 8]);
const claims = new Map<number, any>();
let sourceRows: any[] = [];

function sameValue(actual: any, expected: any): boolean {
    if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== expected.$ne;
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(actual);
    return (actual?.toHexString?.() || actual) === (expected?.toHexString?.() || expected);
}

function matches(doc: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, expected]) => sameValue(doc[key], expected));
}

const calls = {
    grantDirect: [] as any[],
    resumeMarkers: [] as any[],
    revokePairs: [] as any[],
    revokeSource: [] as any[],
    writes: [] as any[],
};
const permitsColl = {
    async findOne(filter: any) {
        return rows.find((row) => matches(row, filter)) || null;
    },
    find(filter: any) {
        const cursor = {
            sort() {
                return cursor;
            },
            async toArray() {
                return rows.filter((row) => matches(row, filter));
            },
        };
        return cursor;
    },
};
const aclService = {
    async grantDirect(...args: any[]) {
        calls.grantDirect.push(args);
        return { active: true };
    },
    async loadUserAcl() {
        return {
            permitPids: new Set([1, 2, 3, 4, 5]),
            authoredPids: new Set<number>(),
            maintainedPids: new Set([2, 4]),
            fencedPids: new Set<number>(),
        };
    },
    async revokePairs(...args: any[]) {
        calls.revokePairs.push(args);
        return 1;
    },
    async revokeSource(...args: any[]) {
        calls.revokeSource.push(args);
        return true;
    },
    async resumeMarkersForPair(...args: any[]) {
        calls.resumeMarkers.push(args);
        return { role: 'maintainer' };
    },
};

const dbPath = require.resolve('../src/db.ts');
const repositoryPath = require.resolve('../src/repository.ts');
const servicePath = require.resolve('../src/service.ts');
const modelPath = require.resolve('../src/model.ts');
const previous = new Map([
    [dbPath, require.cache[dbPath]],
    [repositoryPath, require.cache[repositoryPath]],
    [servicePath, require.cache[servicePath]],
    [modelPath, require.cache[modelPath]],
]);
const originalLoad = Module._load;
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { permitsColl, permitSourcesColl: { countDocuments: async () => 0 } },
} as NodeModule;
require.cache[repositoryPath] = {
    id: repositoryPath,
    filename: repositoryPath,
    loaded: true,
    exports: {
        mongoAclRepository: {
            async getSources(filter: any) {
                return sourceRows.filter(
                    (row) => row.domainId === filter.domainId && row.pid === filter.pid && (filter.uid === undefined || row.uid === filter.uid),
                );
            },
            async getCanonical(filter: any) {
                return (
                    rows.find(
                        (row) => row.domainId === filter.domainId && row.pid === filter.pid && row.uid === filter.uid && row.active !== false,
                    ) || null
                );
            },
            async isManagedProblem(_domainId: string, pid: number) {
                return managedPids.has(pid);
            },
            async getProblemWriteClaim(_domainId: string, pid: number) {
                return claims.get(pid) || null;
            },
            async listSourcesForProblem(domainId: string, pid: number) {
                return sourceRows.filter((row) => row.domainId === domainId && row.pid === pid);
            },
            async listCanonicalForProblem(domainId: string, pid: number) {
                return rows.filter((row) => row.domainId === domainId && row.pid === pid && row.active !== false);
            },
            async getManagedDraftBootstrapState(_domainId: string, pid: number) {
                return managedPids.has(pid)
                    ? { owner: 9, hidden: true, authoringMode: 'managed', metadataStatus: 'draft' }
                    : { owner: 9, hidden: true };
            },
        },
    },
} as NodeModule;
require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: { createAclService: () => aclService },
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return { ObjectId: FakeObjectId };
    return originalLoad.call(this, request, parent, isMain);
};
let model: typeof import('../src/model');
try {
    delete require.cache[modelPath];
    model = require(modelPath);
} finally {
    Module._load = originalLoad;
    for (const [path, cached] of previous) {
        if (cached) require.cache[path] = cached;
        else if (path !== modelPath) delete require.cache[path];
    }
}

beforeEach(() => {
    calls.grantDirect.length = 0;
    calls.revokePairs.length = 0;
    calls.revokeSource.length = 0;
    calls.resumeMarkers.length = 0;
    calls.writes.length = 0;
    claims.clear();
    sourceRows = [];
});

describe('legacy canonical model compatibility', () => {
    it('lists legacy direct/contest verifier/maintainer rows and normalizes active in memory', async () => {
        const byProblem = await model.listForProblem('system', 3);
        const byUser = await model.listForUser('system', 9);

        expect(byProblem.map((row) => [row.pid, row.role, row.active])).to.deep.equal([[3, 'verifier', true]]);
        expect(byUser.map((row) => [row.pid, row.role, row.active])).to.deep.equal([
            [1, 'verifier', true],
            [2, 'maintainer', true],
            [3, 'verifier', true],
            [4, 'maintainer', true],
        ]);
        expect(calls.writes).to.deep.equal([]);
    });

    it('revokes an active legacy row but refuses active:false without a mutation', async () => {
        expect(await model.revoke('system', ids.contestMaintainer as any, { requestId: 'old-row' })).to.equal(true);
        expect(calls.revokePairs).to.have.lengthOf(1);
        expect(calls.revokePairs[0][1]).to.deep.equal([{ pid: 4, uid: 9 }]);

        expect(await model.revoke('system', ids.inactive as any, { requestId: 'inactive-row' })).to.equal(false);
        expect(calls.revokePairs).to.have.lengthOf(1);
    });

    it('preserves legacy viaContest provenance for source-constrained revoke before repair', async () => {
        expect(
            await model.revoke('system', ids.directVerifier as any, {
                requireOwner: 'direct',
                requestId: 'old-direct',
            }),
        ).to.equal(true);
        expect(
            await model.revoke('system', ids.contestVerifier as any, {
                requireOwner: 'viaContest',
                viaContest: new FakeObjectId('c1') as any,
                requestId: 'old-contest',
            }),
        ).to.equal(true);
        expect(
            await model.revoke('system', ids.contestMaintainer as any, {
                requireOwner: 'viaContest',
                viaContest: new FakeObjectId('other') as any,
                requestId: 'wrong-contest',
            }),
        ).to.equal(false);

        expect(calls.revokePairs).to.have.lengthOf(2);
        expect(calls.revokeSource).to.have.lengthOf(0);
    });

    it('delegates resumeFence to pair-marker recovery so an orphan ProblemDoc lock is not ignored', async () => {
        const result = await model.resumeFence('system', 9, 99, 'orphan-request');

        expect(result).to.deep.equal({ role: 'maintainer' });
        expect(calls.resumeMarkers).to.deep.equal([[{ domainId: 'system', pid: 9, uid: 99 }, 'orphan-request']]);
    });

    it('requires an actor-bound managed claim for public grants and maintainer changes', async () => {
        const missingClaim = await model.grant('system', 6, 9, 'author', 8, { requestId: 'no-claim' }).catch((error) => error);
        expect(missingClaim).to.be.instanceOf(Error);
        expect(calls.grantDirect).to.have.lengthOf(0);

        claims.set(6, { requestId: 'author-claim', actor: 8, capability: 'collaborators', state: 'active' });
        await model.grant('system', 6, 9, 'author', 8, {
            requestId: 'author-grant',
            writeClaimRequestId: 'author-claim',
        });
        expect(calls.grantDirect).to.have.lengthOf(1);

        const wrongActor = await model
            .grant('system', 6, 9, 'author', 10, {
                requestId: 'wrong-actor',
                writeClaimRequestId: 'author-claim',
            })
            .catch((error) => error);
        expect(wrongActor).to.be.instanceOf(Error);
        expect(calls.grantDirect).to.have.lengthOf(1);

        claims.set(7, { requestId: 'collaborator-claim', actor: 8, capability: 'collaborators', state: 'active' });
        const maintainerEscalation = await model
            .grant('system', 7, 9, 'author', 8, {
                requestId: 'overwrite-maintainer',
                writeClaimRequestId: 'collaborator-claim',
            })
            .catch((error) => error);
        expect(maintainerEscalation).to.be.instanceOf(Error);
        expect(calls.grantDirect).to.have.lengthOf(1);

        claims.set(7, { requestId: 'admin-claim', actor: 8, capability: 'publish', state: 'active' });
        await model.grant('system', 7, 9, 'author', 8, {
            requestId: 'admin-overwrite',
            writeClaimRequestId: 'admin-claim',
        });
        expect(calls.grantDirect).to.have.lengthOf(2);
    });

    it('requires an administrator-only claim before revoking a managed maintainer', async () => {
        const missingClaim = await model
            .revoke('system', ids.managedMaintainer as any, { requestId: 'managed-revoke', actor: 8 })
            .catch((error) => error);
        expect(missingClaim).to.be.instanceOf(Error);
        expect(calls.revokePairs).to.have.lengthOf(0);

        claims.set(7, { requestId: 'collaborator-claim', actor: 8, capability: 'collaborators', state: 'active' });
        const weakClaim = await model
            .revoke('system', ids.managedMaintainer as any, {
                requestId: 'managed-revoke',
                actor: 8,
                writeClaimRequestId: 'collaborator-claim',
            })
            .catch((error) => error);
        expect(weakClaim).to.be.instanceOf(Error);
        expect(calls.revokePairs).to.have.lengthOf(0);

        claims.set(7, { requestId: 'admin-claim', actor: 8, capability: 'publish', state: 'active' });
        expect(
            await model.revoke('system', ids.managedMaintainer as any, {
                requestId: 'managed-revoke',
                actor: 8,
                writeClaimRequestId: 'admin-claim',
            }),
        ).to.equal(true);
        expect(calls.revokePairs).to.have.lengthOf(1);
    });

    it('does not expose generic ACL mutation or repair methods on the Hydro runtime surface', () => {
        expect((model as any).publicPermitsModel).not.to.have.property('grant');
        expect((model as any).publicPermitsModel).not.to.have.property('revoke');
        expect((model as any).publicPermitsModel).not.to.have.property('repairLegacyMaintainerWithoutCanonical');
        expect((model as any).publicPermitsModel).to.have.property('prepareProblemWriteClaim');
    });
});
