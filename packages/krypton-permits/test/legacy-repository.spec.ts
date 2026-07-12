import { expect } from 'chai';
import { describe, it } from 'node:test';
import { createAclService } from '../src/service';

const Module = require('module');

class FakeObjectId {
    constructor(private readonly value: string) { }
    toHexString() { return this.value; }
}

function sameValue(actual: any, expected: any): boolean {
    if (expected && typeof expected === 'object' && '$ne' in expected) {
        return actual !== expected.$ne;
    }
    const actualId = actual?.toHexString?.() || actual;
    const expectedId = expected?.toHexString?.() || expected;
    return actualId === expectedId;
}

function matches(doc: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, expected]) => sameValue(doc[key], expected));
}

describe('legacy canonical repository compatibility', () => {
    it('preloads legacy direct/contest verifier/maintainer rows read-only and rejects active:false', async () => {
        const writes: any[] = [];
        const rows = [
            { domainId: 'system', pid: 1, uid: 9, role: 'verifier', viaContest: null, grantedBy: 1, grantedAt: new Date() },
            { domainId: 'system', pid: 2, uid: 9, role: 'maintainer', viaContest: null, grantedBy: 1, grantedAt: new Date() },
            { domainId: 'system', pid: 3, uid: 9, role: 'verifier', viaContest: new FakeObjectId('c-verifier'), grantedBy: 1, grantedAt: new Date() },
            {
                domainId: 'system',
                pid: 4,
                uid: 9,
                role: 'maintainer',
                viaContest: new FakeObjectId('c-maintainer'),
                grantedBy: 1,
                grantedAt: new Date(),
            },
            { domainId: 'system', pid: 5, uid: 9, role: 'maintainer', active: false, viaContest: null, grantedBy: 1, grantedAt: new Date() },
        ];
        const collections = new Map<string, any>();
        const collection = (name: string) => {
            if (!collections.has(name)) {
                const docs = name === 'problem.permits' ? rows : [];
                collections.set(name, {
                    find(filter: any) {
                        return { toArray: async () => docs.filter((doc) => matches(doc, filter)) };
                    },
                    async findOne(filter: any) { return docs.find((doc) => matches(doc, filter)) || null; },
                    async insertOne(...args: any[]) { writes.push(['insertOne', name, ...args]); },
                    async updateOne(...args: any[]) { writes.push(['updateOne', name, ...args]); },
                    async deleteOne(...args: any[]) { writes.push(['deleteOne', name, ...args]); },
                });
            }
            return collections.get(name);
        };
        const hydroojStub = {
            db: { collection, client: {} },
            ObjectId: FakeObjectId,
        };
        const dbPath = require.resolve('../src/db.ts');
        const repositoryPath = require.resolve('../src/repository.ts');
        const previousDb = require.cache[dbPath];
        const previousRepository = require.cache[repositoryPath];
        const originalLoad = Module._load;
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === 'hydrooj') return hydroojStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            delete require.cache[dbPath];
            delete require.cache[repositoryPath];
            const { MongoAclRepository } = require(repositoryPath);
            const service = createAclService(new MongoAclRepository());

            const loaded = await service.loadUserAcl('system', 9);

            expect([...loaded.permitPids]).to.deep.equal([1, 2, 3, 4]);
            expect([...loaded.maintainedPids]).to.deep.equal([2, 4]);
            expect(writes).to.deep.equal([]);
        } finally {
            Module._load = originalLoad;
            if (previousDb) require.cache[dbPath] = previousDb;
            else delete require.cache[dbPath];
            if (previousRepository) require.cache[repositoryPath] = previousRepository;
            else delete require.cache[repositoryPath];
        }
    });

    it('strips marker fields from every canonical pair Mongo filter', async () => {
        const filters: Array<[string, string, Record<string, any>]> = [];
        const collection = (name: string) => ({
            find(filter: any) {
                filters.push([name, 'find', filter]);
                return { toArray: async () => [] };
            },
            async findOne(filter: any) {
                filters.push([name, 'findOne', filter]);
                return null;
            },
            async updateOne(filter: any) {
                filters.push([name, 'updateOne', filter]);
                return { matchedCount: 1 };
            },
            async deleteOne(filter: any) {
                filters.push([name, 'deleteOne', filter]);
                return { deletedCount: 1 };
            },
        });
        const hydroojStub = {
            db: { collection, client: {} },
            ObjectId: FakeObjectId,
        };
        const dbPath = require.resolve('../src/db.ts');
        const repositoryPath = require.resolve('../src/repository.ts');
        const previousDb = require.cache[dbPath];
        const previousRepository = require.cache[repositoryPath];
        const originalLoad = Module._load;
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === 'hydrooj') return hydroojStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            delete require.cache[dbPath];
            delete require.cache[repositoryPath];
            const { MongoAclRepository } = require(repositoryPath);
            const repository = new MongoAclRepository();
            const marker = {
                domainId: 'system', pid: 7, uid: 9, requestId: 'marker-request',
                intent: { role: 'verifier' }, completedSteps: ['source'], lastError: null,
            };
            await repository.getCanonical(marker);
            await repository.getSources(marker);
            await repository.getFence(marker);
            await repository.updateFence(marker, 'owned-request', { lastError: null });
            await repository.writeCanonical(marker, null);
            await repository.writeCanonical(marker, {
                domainId: 'system', pid: 7, uid: 9, role: 'verifier', active: true,
                grantedBy: 2, grantedAt: new Date(), viaContest: null, note: '',
            });
            await repository.deleteFence(marker, 'owned-request');

            const pairKeys = ['domainId', 'pid', 'uid'];
            for (const [, , filter] of filters) {
                const allowed = filter.requestId ? [...pairKeys, 'requestId'] : filter.active ? [...pairKeys, 'active'] : pairKeys;
                expect(Object.keys(filter).sort()).to.deep.equal(allowed.sort());
                expect(filter).not.to.have.property('intent');
                expect(filter).not.to.have.property('completedSteps');
                expect(filter).not.to.have.property('lastError');
            }
        } finally {
            Module._load = originalLoad;
            if (previousDb) require.cache[dbPath] = previousDb;
            else delete require.cache[dbPath];
            if (previousRepository) require.cache[repositoryPath] = previousRepository;
            else delete require.cache[repositoryPath];
        }
    });
});
