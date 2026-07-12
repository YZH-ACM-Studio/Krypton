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
};

const rows = [
    { _id: ids.directVerifier, domainId: 'system', pid: 1, uid: 9, role: 'verifier', viaContest: null },
    { _id: ids.directMaintainer, domainId: 'system', pid: 2, uid: 9, role: 'maintainer', viaContest: null },
    { _id: ids.contestVerifier, domainId: 'system', pid: 3, uid: 9, role: 'verifier', viaContest: new FakeObjectId('c1') },
    { _id: ids.contestMaintainer, domainId: 'system', pid: 4, uid: 9, role: 'maintainer', viaContest: new FakeObjectId('c2') },
    { _id: ids.inactive, domainId: 'system', pid: 5, uid: 9, role: 'maintainer', active: false, viaContest: null },
];

function sameValue(actual: any, expected: any): boolean {
    if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== expected.$ne;
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(actual);
    return (actual?.toHexString?.() || actual) === (expected?.toHexString?.() || expected);
}

function matches(doc: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, expected]) => sameValue(doc[key], expected));
}

const calls = {
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
    async loadUserAcl() {
        return {
            permitPids: new Set([1, 2, 3, 4, 5]),
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
            async getSources() {
                return [];
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
    calls.revokePairs.length = 0;
    calls.revokeSource.length = 0;
    calls.resumeMarkers.length = 0;
    calls.writes.length = 0;
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
});
