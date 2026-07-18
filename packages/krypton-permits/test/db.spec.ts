import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');

interface IndexRecord {
    name: string;
    key: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: unknown;
    expireAfterSeconds?: number;
}

class FakeCollection {
    indexes: IndexRecord[] = [{ name: '_id_', key: { _id: 1 }, unique: true }];
    corruptName: string | null = null;
    namespaceExists = true;
    namespaceNotFoundStyle: 'code' | 'codeName' | null = null;
    listIndexesError: Error | null = null;
    createIndexCalls = 0;

    markNamespaceMissing(style: 'code' | 'codeName') {
        this.namespaceExists = false;
        this.namespaceNotFoundStyle = style;
        // A collection that does not exist has no pre-populated `_id_` index.
        this.indexes = [];
    }

    async createIndex(key: Record<string, number>, options: any = {}) {
        this.createIndexCalls++;
        if (!this.namespaceExists) {
            this.namespaceExists = true;
            this.indexes.push({ name: '_id_', key: { _id: 1 }, unique: true });
        }
        this.indexes.push({ key, ...options });
        return options.name;
    }

    listIndexes() {
        return {
            toArray: async () => {
                if (this.listIndexesError) throw this.listIndexesError;
                if (!this.namespaceExists) {
                    const error: any = new Error('ns not found');
                    if (this.namespaceNotFoundStyle === 'code') error.code = 26;
                    if (this.namespaceNotFoundStyle === 'codeName') error.codeName = 'NamespaceNotFound';
                    throw error;
                }
                return this.indexes.map((index) => (index.name === this.corruptName ? { ...index, key: { wrong: 1 } } : { ...index }));
            },
        };
    }
}

function loadDbModule() {
    const collections = new Map<string, FakeCollection>();
    const hydroojStub = {
        db: {
            collection(name: string) {
                if (!collections.has(name)) collections.set(name, new FakeCollection());
                return collections.get(name);
            },
        },
    };
    const dbPath = require.resolve('../src/db.ts');
    delete require.cache[dbPath];
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (request === 'hydrooj') return hydroojStub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return { module: require(dbPath), collections };
    } finally {
        Module._load = originalLoad;
    }
}

describe('krypton-permits indexes', () => {
    it('creates and re-verifies new source and fence collections after real NamespaceNotFound errors', async () => {
        const { module, collections } = loadDbModule();
        const sources = collections.get('problem.permitSources')!;
        const fences = collections.get('problem.aclMutationFences')!;
        sources.markNamespaceMissing('code');
        fences.markNamespaceMissing('codeName');

        await module.ensureIndexes();

        expect(sources.indexes.some((index) => index.name === 'problem_permit_sources_identity_uq')).to.equal(true);
        expect(fences.indexes.some((index) => index.name === 'problem_acl_fences_pair_uq')).to.equal(true);
        expect(sources.createIndexCalls).to.equal(4);
        expect(fences.createIndexCalls).to.equal(3);
    });

    it('propagates listIndexes errors other than NamespaceNotFound without creating indexes', async () => {
        const { module, collections } = loadDbModule();
        const sources = collections.get('problem.permitSources')!;
        const databaseError: any = new Error('primary stepped down');
        databaseError.code = 91;
        databaseError.codeName = 'ShutdownInProgress';
        sources.listIndexesError = databaseError;

        let error: unknown;
        try {
            await module.ensureIndexes();
        } catch (caught) {
            error = caught;
        }

        expect(error).to.equal(databaseError);
        expect(sources.createIndexCalls).to.equal(0);
        expect(collections.get('problem.aclMutationFences')!.createIndexCalls).to.equal(0);
    });

    it('creates explicitly named non-partial indexes and verifies their exact shape', async () => {
        const { module, collections } = loadDbModule();
        await module.ensureIndexes();

        expect([...collections.keys()]).to.have.members([
            'problem.permits',
            'problem.permitSources',
            'problem.aclMutationFences',
            'problem.contributions',
        ]);
        const all = [...collections.values()].flatMap((collection) => collection.indexes.slice(1));
        expect(all.every((index) => Boolean(index.name))).to.equal(true);
        expect(all.every((index) => index.partialFilterExpression === undefined)).to.equal(true);

        const canonicalPair = all.find((index) => index.name === 'problem_permits_pair_uq');
        expect(canonicalPair).to.deep.include({
            key: { domainId: 1, pid: 1, uid: 1 },
            unique: true,
        });
        const sourcePair = all.find((index) => index.name === 'problem_permit_sources_identity_uq');
        expect(sourcePair).to.deep.include({
            key: { domainId: 1, pid: 1, uid: 1, sourceType: 1, sourceId: 1 },
            unique: true,
        });
        const fencePair = all.find((index) => index.name === 'problem_acl_fences_pair_uq');
        expect(fencePair).to.deep.include({
            key: { domainId: 1, pid: 1, uid: 1 },
            unique: true,
        });
        const contributionPair = all.find((index) => index.name === 'problem_contributions_identity_uq');
        expect(contributionPair).to.deep.include({
            key: { domainId: 1, pid: 1, uid: 1, scope: 1 },
            unique: true,
        });
    });

    it('rejects startup when listIndexes reports a named index with the wrong key', async () => {
        const { module, collections } = loadDbModule();
        const canonical = collections.get('problem.permits')!;
        canonical.corruptName = 'problem_permits_pair_uq';

        let error: unknown;
        try {
            await module.ensureIndexes();
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain('problem_permits_pair_uq');
    });

    it('accepts the production legacy unique pair index as the required canonical constraint', async () => {
        const { module, collections } = loadDbModule();
        collections.get('problem.permits')!.indexes.push({
            name: 'domainId_1_pid_1_uid_1',
            key: { domainId: 1, pid: 1, uid: 1 },
            unique: true,
        });

        await module.ensureIndexes();

        const pairIndexes = collections
            .get('problem.permits')!
            .indexes.filter((index) => JSON.stringify(index.key) === JSON.stringify({ domainId: 1, pid: 1, uid: 1 }));
        expect(pairIndexes).to.have.lengthOf(1);
        expect(pairIndexes[0]).to.include({
            name: 'domainId_1_pid_1_uid_1',
            unique: true,
        });
    });

    it('accepts the harmless production viaContest partial index without recreating or dropping it', async () => {
        const { module, collections } = loadDbModule();
        collections.get('problem.permits')!.indexes.push({
            name: 'legacy_viaContest_partial',
            key: { domainId: 1, viaContest: 1 },
            partialFilterExpression: { viaContest: { $type: 'objectId' } },
        });

        await module.ensureIndexes();

        expect(collections.get('problem.permits')!.indexes).to.deep.include({
            name: 'legacy_viaContest_partial',
            key: { domainId: 1, viaContest: 1 },
            partialFilterExpression: { viaContest: { $type: 'objectId' } },
        });
    });

    it('still rejects an unrelated partial index', async () => {
        const { module, collections } = loadDbModule();
        collections.get('problem.permits')!.indexes.push({
            name: 'unsafe_partial',
            key: { domainId: 1, role: 1 },
            partialFilterExpression: { role: 'maintainer' },
        });

        let error: unknown;
        try {
            await module.ensureIndexes();
        } catch (caught) {
            error = caught;
        }
        expect((error as Error)?.message).to.contain('unsafe_partial');
    });

    it('rejects a TTL on the durable mutation fence collection', async () => {
        const { module, collections } = loadDbModule();
        collections.get('problem.aclMutationFences')!.indexes.push({
            name: 'legacy_fence_ttl',
            key: { updatedAt: 1 },
            expireAfterSeconds: 3600,
        });

        let error: unknown;
        try {
            await module.ensureIndexes();
        } catch (caught) {
            error = caught;
        }
        expect((error as Error)?.message).to.contain('legacy_fence_ttl');
    });
});
