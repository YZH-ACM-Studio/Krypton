import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import type { ValidatedProblemBatch } from '../src/lib/problem-batch-import';
import type { ProblemBatchFactsRepository } from '../src/lib/problem-batch-production-facts';
import { buildProblemBatchProductionFacts } from '../src/lib/problem-batch-production-facts';
import {
    MongoProblemBatchFactsRepository,
    problemBatchReadonlyInternals,
    ReadonlyProblemBatchImportAdapter,
} from '../src/model/problem-batch-readonly-adapter';

const trainingId = '68486d8165edbb11e9ec9036';
const mapId = new ObjectId('64a000000000000000000001');
const rootNodeId = new ObjectId('64b000000000000000000010');
const selectedNodeId = new ObjectId('64b000000000000000000011');

function batch(): ValidatedProblemBatch {
    return {
        manifestPath: '/fixture/batch.json',
        rootDir: '/fixture',
        fingerprint: '1'.repeat(64),
        totalCases: 1,
        manifest: {
            schemaVersion: 1,
            batchId: 'nowcoder-2026-summer-1',
            domain: 'system',
            actor: 2,
            source: { template: 'nowcoder_summer', year: 2026, round: 1 },
            author: { uid: 515, username: 'nowcoder-2026' },
            training: { id: trainingId, title: '牛客暑期多校训练集', chapterTitle: '2026年牛客-第1场' },
            selection: { field: 'accepted', operator: '>', value: 100, source: 'official screenshot' },
            problems: [],
        },
        problems: [
            {
                sourceProblemCode: 'A',
                title: '2090 Virus',
                difficulty: 2,
                mindmapNodeIds: [selectedNodeId.toHexString()],
                origStat: { accepted: 1582, submitted: 1583 },
                statement: 'problems/A/statement.md',
                assets: [],
                testdata: {
                    directory: 'problems/A/testdata',
                    files: ['1.in', '1.out'],
                    config: 'problems/A/config.yaml',
                    checker: null,
                    cases: [{ input: '1.in', output: '1.out' }],
                },
                fingerprint: '2'.repeat(64),
                statementFile: { name: 'statement.md', path: '/fixture/statement.md', size: 1, sha256: '3'.repeat(64) },
                assetFiles: [],
                testdataFiles: [
                    { name: '1.in', path: '/fixture/1.in', size: 1, sha256: '4'.repeat(64) },
                    { name: '1.out', path: '/fixture/1.out', size: 1, sha256: '5'.repeat(64) },
                ],
                configFile: { name: 'config.yaml', path: '/fixture/config.yaml', size: 1, sha256: '6'.repeat(64) },
            },
        ],
    };
}

describe('P2.23 read-only production preflight adapter', () => {
    it('derives one map per problem and permits different maps inside one manifest', async () => {
        const input = batch();
        const otherMapId = new ObjectId('64a000000000000000000002');
        const otherNodeId = new ObjectId('64b000000000000000000012');
        input.problems.push({
            ...structuredClone(input.problems[0]),
            sourceProblemCode: 'B',
            title: 'Other map problem',
            mindmapNodeIds: [otherNodeId.toHexString()],
            fingerprint: '7'.repeat(64),
        });
        const repository: ProblemBatchFactsRepository = {
            getUser: async (_domainId, uid) =>
                uid === 2 ? { uid, username: 'root', isProblemBankAdmin: true } : { uid, username: 'nowcoder-2026', isProblemBankAdmin: false },
            getCounter: async () => 1063,
            getTraining: async () => ({ id: trainingId, title: '牛客暑期多校训练集', dag: [{ _id: 7, title: '往期', requireNids: [], pids: [99] }] }),
            hasTrainingAnchor: async () => true,
            getMindmapFacts: async () => [
                {
                    id: selectedNodeId.toHexString(),
                    mapId: mapId.toHexString(),
                    mapTitle: '算法知识图谱',
                    topic: '模拟',
                    tags: ['模拟'],
                },
                {
                    id: otherNodeId.toHexString(),
                    mapId: otherMapId.toHexString(),
                    mapTitle: '面向对象知识图谱',
                    topic: '类',
                    tags: ['类'],
                },
            ],
            getBatchProblems: async () => [],
            getActiveProblemPermits: async () => [],
            getDuplicateProblems: async () => [],
            getTrainingReplacementAudit: async () => null,
        };

        const facts = await buildProblemBatchProductionFacts(input, repository);

        expect(facts.knowledgeMaps).to.deep.equal([
            { id: mapId.toHexString(), title: '算法知识图谱' },
            { id: otherMapId.toHexString(), title: '面向对象知识图谱' },
        ]);
        expect(facts.problems.map((problem) => [problem.sourceProblemCode, problem.knowledgeMapId])).to.deep.equal([
            ['A', mapId.toHexString()],
            ['B', otherMapId.toHexString()],
        ]);

        input.problems[0].mindmapNodeIds = [selectedNodeId.toHexString(), otherNodeId.toHexString()];
        try {
            await buildProblemBatchProductionFacts(input, repository);
            expect.fail('expected cross-map problem selection to be rejected');
        } catch (error) {
            expect(error).to.have.property('code', 'BATCH_IMPORT_MINDMAP_CONFLICT');
            expect(error).to.have.property('message').that.includes('A: mindmap nodes must belong to exactly one knowledge map');
        }
    });

    it('derives canonical production facts using only Mongo find operations', async () => {
        const operations: string[] = [];
        let batchProblemProjection: Record<string, number> | undefined;
        const collections = {
            user: {
                findOne: async (filter: any) => {
                    operations.push('user.findOne');
                    if (filter._id === 2) return { _id: 2, uname: 'root', priv: 1 };
                    if (filter._id === 515) return { _id: 515, uname: 'nowcoder-2026', priv: 2 };
                    return null;
                },
            },
            'problem.pid_counters': {
                findOne: async () => {
                    operations.push('problem.pid_counters.findOne');
                    return { value: 1063 };
                },
            },
            document: {
                findOne: async (filter: any) => {
                    operations.push('document.findOne');
                    if (filter.docType === 40) {
                        return {
                            docId: new ObjectId(trainingId),
                            title: '牛客暑期多校训练集',
                            dag: [{ _id: 7, title: '往期', requireNids: [], pids: [99] }],
                        };
                    }
                    if (filter.docType === 10 && filter.tag === '牛客暑期多校') return { docId: 99 };
                    return null;
                },
                find: (filter: any, options?: any) => {
                    operations.push('document.find');
                    if (filter['batchImport.batchId']) {
                        batchProblemProjection = options?.projection;
                        return { toArray: async () => [] };
                    }
                    if (filter.$or) return { toArray: async () => [] };
                    throw new Error(`unexpected document query: ${JSON.stringify(filter)}`);
                },
            },
            'mindmap.nodes': {
                find: () => {
                    operations.push('mindmap.nodes.find');
                    return {
                        toArray: async () => [
                            { _id: rootNodeId, mapId, parentId: null, topic: '算法', tags: ['基础'] },
                            { _id: selectedNodeId, mapId, parentId: rootNodeId, topic: '模拟', tags: ['模拟'] },
                        ],
                    };
                },
            },
            'mindmap.maps': {
                find: () => {
                    operations.push('mindmap.maps.find');
                    return { toArray: async () => [{ _id: mapId, title: '算法知识图谱', visibility: 'public' }] };
                },
            },
        } as const;
        const db = {
            collection(name: keyof typeof collections) {
                const collection = collections[name];
                if (!collection) throw new Error(`unexpected collection: ${name}`);
                return new Proxy(collection, {
                    get(target, property, receiver) {
                        if (!['find', 'findOne'].includes(String(property))) {
                            throw new Error(`write or unsupported Mongo operation: ${String(property)}`);
                        }
                        return Reflect.get(target, property, receiver);
                    },
                });
            },
        };
        const adapter = new ReadonlyProblemBatchImportAdapter(new MongoProblemBatchFactsRepository(db as any));
        const facts = await adapter.preflight(batch());

        expect(facts.counter).to.deep.equal({ namespace: 'nowcoder', value: 1063 });
        expect(facts.training).to.include({ chapterId: 8, chapterState: 'missing' });
        expect(facts.knowledgeMaps).to.deep.equal([{ id: mapId.toHexString(), title: '算法知识图谱' }]);
        expect(facts.mindmapNodes).to.deep.equal([
            {
                id: selectedNodeId.toHexString(),
                mapId: mapId.toHexString(),
                topic: '算法 / 模拟',
                tags: ['基础', '模拟'],
            },
        ]);
        expect(facts.problems).to.deep.equal([
            {
                sourceProblemCode: 'A',
                fingerprint: '2'.repeat(64),
                pid: 'NK1064',
                knowledgeMapId: mapId.toHexString(),
                state: 'new',
            },
        ]);
        expect(batchProblemProjection).to.include({ knowledgeMapId: 1, knowledgeNodeIds: 1, managedAuthoring: 1 });
        expect(operations).to.have.members([
            'user.findOne',
            'user.findOne',
            'problem.pid_counters.findOne',
            'document.findOne',
            'mindmap.nodes.find',
            'mindmap.maps.find',
            'document.findOne',
            'document.find',
            'document.find',
        ]);
    });

    it('respects collection mapping and rejects write-side stages', async () => {
        expect(
            problemBatchReadonlyInternals.collectionName({ prefix: 'school', collectionMap: { 'school.document': 'tenant_documents' } }, 'document'),
        ).to.equal('tenant_documents');
        let closed = 0;
        const adapter = new ReadonlyProblemBatchImportAdapter({} as any, async () => {
            closed++;
        });
        for (const [operation, message] of [
            [adapter.apply({} as any, {} as any, {} as any, async () => undefined), 'read-only adapter cannot apply'],
            [adapter.verify({} as any, {} as any), 'read-only adapter cannot verify'],
        ] as const) {
            try {
                await operation;
                expect.fail('read-only adapter unexpectedly accepted a write-side stage');
            } catch (error) {
                expect(error).to.have.property('message').that.includes(message);
            }
        }
        await adapter.close();
        expect(closed).to.equal(1);
    });

    it('rejects root or an administrator as an official-source author', async () => {
        const input = batch();
        input.manifest.author = { uid: 2, username: 'root' };
        const repository = {
            async getUser(_domainId: string, uid: number) {
                return uid === 2 ? { uid: 2, username: 'root', isProblemBankAdmin: true } : null;
            },
            async getCounter() {
                return 1063;
            },
            async getTraining() {
                return { id: trainingId, title: '牛客暑期多校训练集', dag: [{ _id: 7, title: '往期', requireNids: [], pids: [99] }] };
            },
            async hasTrainingAnchor() {
                return true;
            },
            async getMindmapFacts() {
                return [
                    {
                        id: selectedNodeId.toHexString(),
                        mapId: mapId.toHexString(),
                        mapTitle: '算法知识图谱',
                        topic: '算法 / 模拟',
                        tags: ['基础', '模拟'],
                    },
                ];
            },
            async getBatchProblems() {
                return [];
            },
            async getActiveProblemPermits() {
                return [];
            },
            async getDuplicateProblems() {
                return [];
            },
            async getTrainingReplacementAudit() {
                return null;
            },
        } satisfies ProblemBatchFactsRepository;

        try {
            await new ReadonlyProblemBatchImportAdapter(repository).preflight(input);
            expect.fail('expected official author conflict');
        } catch (error) {
            expect(error).to.have.property('code', 'BATCH_IMPORT_AUTHOR_CONFLICT');
        }
    });
});
