import { Readable } from 'node:stream';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import yaml from 'js-yaml';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createProblemBatchExecutionReport, preflightProblemBatchImport, validateProblemBatchManifest } from '../src/lib/problem-batch-import';

(global as any).Hydro ||= { model: {} };

const trainingId = new ObjectId('68486d8165edbb11e9ec9036');
const knowledgeMapId = new ObjectId('6a50935a53f083fa84681fb7');
const nodeId = '6a50935a53f083fa84681fb8';
const actor = { _id: 2, uname: 'root', perm: 1n };
const author = { _id: 515, uname: '2025多校' };
const counter = { value: 1063 };
const problemDocs: any[] = [];
const authorPermits: any[] = [];
const storageObjects = new Map<string, Buffer>();
const oplogs: any[] = [];
const calls: string[] = [];
const managedDraftInputs: any[] = [];
let nextDocId = 3000;
let failConfigObserver = false;
let publicationIncomplete = false;
let failOriginalStatisticsAuditOnce = false;
let clearHistoricalChapterAfterDraftReady = false;

const anchorProblem = { domainId: 'system', docType: 10, docId: 99, tag: ['牛客暑期多校'] };
const training: any = {
    _id: new ObjectId('68486d8165edbb11e9ec9000'),
    domainId: 'system',
    docType: 40,
    docId: trainingId,
    title: '牛客暑期多校训练集',
    dag: [{ _id: 1, title: '2025年牛客-第10场', requireNids: [], pids: [99] }],
};

function clone<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
    }
    return value;
}

function objectIdEqual(left: unknown, right: unknown): boolean {
    return String(left) === String(right);
}

function cursor(items: any[]) {
    return {
        sort() {
            return this;
        },
        async toArray() {
            return items.map(clone);
        },
    };
}

const documentStub = {
    TYPE_PROBLEM: 10,
    TYPE_TRAINING: 40,
    coll: {
        find(filter: any) {
            if (filter['batchImport.batchId']) {
                return cursor(problemDocs.filter((doc) => doc.batchImport?.batchId === filter['batchImport.batchId']));
            }
            if (filter.$or) {
                const titles = filter.$or.find((entry: any) => entry.title)?.title.$in || [];
                const pids = filter.$or.find((entry: any) => entry.pid)?.pid.$in || [];
                return cursor(problemDocs.filter((doc) => titles.includes(doc.title) || pids.includes(doc.pid)));
            }
            throw new Error(`unexpected find ${JSON.stringify(filter)}`);
        },
        async findOne(filter: any) {
            if (filter.docType === 40) {
                if (!objectIdEqual(filter.docId, training.docId)) return null;
                if (filter.title && filter.title !== training.title) return null;
                return training;
            }
            if (filter['batchImport.identity']) {
                return problemDocs.find((doc) => doc.batchImport?.identity === filter['batchImport.identity']) || null;
            }
            if (filter.docId?.$in && filter.tag) {
                const candidates = [anchorProblem, ...problemDocs];
                return candidates.find((doc) => filter.docId.$in.includes(doc.docId) && doc.tag?.includes(filter.tag)) || null;
            }
            throw new Error(`unexpected findOne ${JSON.stringify(filter)}`);
        },
    },
};

async function streamBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
    const chunks = [] as Buffer[];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

function problemForClaim(claim: any) {
    const pdoc = problemDocs.find((doc) => doc.docId === claim.pid);
    if (!pdoc) throw new Error(`missing claimed problem ${claim.pid}`);
    return pdoc;
}

const sourceTags = ['MultiSchool', '牛客暑期多校', '2026牛客暑期多校'];
const ProblemModelStub = {
    isProblemBankAdmin(user: any) {
        return user?._id === 2;
    },
    async createManagedProgrammingDraft(domainId: string, input: any, creator: number) {
        calls.push('createManagedProgrammingDraft');
        managedDraftInputs.push(clone(input));
        counter.value++;
        const docId = nextDocId++;
        const pid = `NK${counter.value}`;
        const pdoc = {
            domainId,
            docType: 10,
            docId,
            pid,
            owner: creator,
            title: `待审核 · ${input.workingTitle}`,
            content: input.content,
            config: '',
            data: [],
            additional_file: [],
            difficulty: input.difficulty,
            hidden: true,
            problemKind: 'programming',
            authoringMode: 'managed',
            sourceMeta: clone(input.sourceMeta),
            tag: [...sourceTags, '模拟'],
            knowledgeMapId,
            knowledgeNodeIds: input.mindmapNodeIds.map((id: string) => new ObjectId(id)),
            structureRevision: 1,
            managedAuthoring: {
                workingTitle: input.workingTitle,
                selectedMindmapNodeIds: input.mindmapNodeIds.map((id: string) => new ObjectId(id)),
                metadataStatus: 'draft',
            },
            batchImport: {
                ...clone(input.batchImport),
                identity: `${input.batchImport.batchId}:${input.batchImport.sourceProblemCode}`,
            },
            hasBatchImportIdentity: true,
        };
        problemDocs.push(pdoc);
        authorPermits.push({ domainId, pid: docId, uid: input.authorUid, role: 'author', active: true });
        authorPermits.push({ domainId, pid: docId, uid: 888, role: 'verifier', active: true });
        return { docId, pid, documentId: new ObjectId() };
    },
    async withAuthorizedDataWriteClaim(domainId: string, docId: number, _user: any, operation: string, callback: any, options: any) {
        calls.push('withAuthorizedDataWriteClaim');
        const result = await callback({
            domainId,
            pid: docId,
            actor: 2,
            operation,
            capability: 'data',
            state: 'active',
            requestId: options.requestId,
        });
        problemDocs.find((doc) => doc.docId === docId).structureRevision++;
        return result;
    },
    async addTestdataWithClaim(claim: any, name: string, stream: AsyncIterable<Buffer | string>) {
        calls.push(`addTestdataWithClaim:${name}`);
        if (claim.operation !== 'files-upload' || claim.capability !== 'data') {
            throw new TypeError(`fixture rejected testdata claim operation=${claim.operation} capability=${claim.capability}`);
        }
        const body = await streamBuffer(stream);
        const pdoc = problemForClaim(claim);
        storageObjects.set(`problem/${claim.domainId}/${claim.pid}/testdata/${name}`, body);
        pdoc.data = pdoc.data.filter((file: any) => file.name !== name);
        pdoc.data.push({ _id: name, name, size: body.length, lastModified: new Date() });
        if (name === 'config.yaml') pdoc.config = body.toString();
        if (name === 'config.yaml' && failConfigObserver) throw new Error('fixture observer failed');
    },
    async addAdditionalFileWithClaim(claim: any, name: string, stream: AsyncIterable<Buffer | string>) {
        calls.push(`addAdditionalFileWithClaim:${name}`);
        const body = await streamBuffer(stream);
        const pdoc = problemForClaim(claim);
        storageObjects.set(`problem/${claim.domainId}/${claim.pid}/additional_file/${name}`, body);
        pdoc.additional_file = pdoc.additional_file.filter((file: any) => file.name !== name);
        pdoc.additional_file.push({ _id: name, name, size: body.length, lastModified: new Date() });
    },
    async editAuthorized(_domainId: string, docId: number, patch: any) {
        calls.push('editAuthorized:origStat');
        Object.assign(
            problemDocs.find((doc) => doc.docId === docId),
            patch,
        );
    },
    assertProblemReadyForUse(pdoc: any) {
        if (!pdoc.config || !pdoc.data.length) throw new Error('problem is not ready');
        if (clearHistoricalChapterAfterDraftReady) {
            const chapter = training.dag.find((candidate: any) => candidate._id === 47);
            if (!chapter) throw new Error('fixture historical chapter is missing');
            chapter.pids = [];
            clearHistoricalChapterAfterDraftReady = false;
        }
    },
    async setManagedProgrammingDraftTrainingPlacement(input: any) {
        calls.push('setManagedProgrammingDraftTrainingPlacement');
        const pdoc = problemDocs.find((doc) => doc.docId === input.docId);
        pdoc.managedAuthoring.pendingTrainingPlacement = { trainingId: input.trainingId, chapterId: input.chapterId };
        return pdoc;
    },
    async publishManagedProgrammingProblem(input: any) {
        calls.push('publishManagedProgrammingProblem');
        const pdoc = problemDocs.find((doc) => doc.docId === input.docId);
        if (pdoc.structureRevision !== input.expectedStructureRevision) throw new Error('stale revision');
        const chapter = training.dag.find((candidate: any) => candidate._id === pdoc.managedAuthoring.pendingTrainingPlacement.chapterId);
        chapter.pids.push(pdoc.docId);
        pdoc.title = input.formalTitle;
        pdoc.difficulty = input.difficulty;
        pdoc.hidden = false;
        pdoc.structureRevision++;
        pdoc.managedAuthoring.metadataStatus = 'confirmed';
        pdoc.managedAuthoring.approvedBy = input.actor;
        pdoc.managedAuthoring.approvedAt = new Date();
        delete pdoc.managedAuthoring.pendingTrainingPlacement;
        return publicationIncomplete
            ? { state: 'committed_with_error', requestId: `publish-${pdoc.docId}`, incompleteStages: ['edit-observers'] }
            : { state: 'published', requestId: `publish-${pdoc.docId}`, incompleteStages: [] };
    },
};

const cacheStubs: Array<[string, any]> = [
    ['../src/model/document.ts', documentStub],
    [
        '../src/model/managed-problem-authoring.ts',
        {
            MANAGED_SOURCE_TEMPLATES: [{ id: 'nowcoder_summer', trainingAnchorTag: '牛客暑期多校', fixedTags: ['MultiSchool', '牛客暑期多校'] }],
            managedPidCountersColl: {
                async findOne() {
                    return { domainId: 'system', namespace: 'nowcoder', value: counter.value };
                },
            },
            managedPidCounterNamespace: () => 'nowcoder',
            formatManagedProblemPid: (_source: any, sequence: number) => `NK${sequence}`,
            normalizeManagedSourceMeta: (source: any) => clone(source),
            deriveManagedSourceTags: () => [...sourceTags],
            async listManagedMindmapOptions() {
                return [
                    {
                        id: nodeId,
                        mapId: knowledgeMapId.toHexString(),
                        mapTitle: '算法知识图谱',
                        label: '模拟',
                        tags: ['模拟'],
                    },
                ];
            },
            async materializeManagedMindmapTags(ids: string[]) {
                if (ids.length !== 1 || ids[0] !== nodeId) throw new Error('unknown mindmap node');
                return { mapId: knowledgeMapId, nodeIds: [new ObjectId(nodeId)], tags: ['模拟'] };
            },
        },
    ],
    ['../src/model/problem.ts', { __esModule: true, default: ProblemModelStub }],
    [
        '../src/model/problem-lifecycle.ts',
        {
            assertProgrammingTestcasesConfigured(config: string) {
                if (!config.includes('cases:')) throw new Error('explicit cases are missing');
            },
        },
    ],
    [
        '../src/model/storage.ts',
        {
            __esModule: true,
            default: {
                coll: {
                    async findOne(filter: any) {
                        return storageObjects.has(filter.path) ? { _id: filter.path, path: filter.path, autoDelete: null } : null;
                    },
                },
            },
        },
    ],
    [
        '../src/service/storage.ts',
        {
            __esModule: true,
            default: {
                async get(key: string) {
                    const body = storageObjects.get(key);
                    if (!body) throw new Error(`missing storage object ${key}`);
                    return Readable.from([body]);
                },
            },
        },
    ],
    [
        '../src/model/training.ts',
        {
            async ensureProblemBatchChapter(input: any) {
                calls.push('ensureProblemBatchChapter');
                const existing = training.dag.find((chapter: any) => chapter._id === input.chapterId || chapter.title === input.chapterTitle);
                if (existing) {
                    if (input.mode === 'replace-existing' && JSON.stringify(existing.pids) === JSON.stringify(input.replacePids)) {
                        existing.pids = [];
                        return { chapterId: input.chapterId, created: false, replaced: true };
                    }
                    return { chapterId: input.chapterId, created: false, replaced: false };
                }
                training.dag.unshift({ _id: input.chapterId, title: input.chapterTitle, requireNids: [], pids: [] });
                return { chapterId: input.chapterId, created: true };
            },
            async assertProblemBatchChapterAudit() {
                return undefined;
            },
        },
    ],
    [
        '../src/model/user.ts',
        {
            __esModule: true,
            default: {
                async getById(_domainId: string, uid: number) {
                    return uid === actor._id ? actor : uid === author._id ? author : null;
                },
            },
        },
    ],
    [
        '../src/model/oplog.ts',
        {
            coll: {
                async findOne(filter: any) {
                    return oplogs.find((entry) => Object.entries(filter).every(([key, value]) => entry[key] === value)) || null;
                },
            },
            async add(entry: any) {
                calls.push('oplog');
                if (entry.type === 'realpass.batch-import' && failOriginalStatisticsAuditOnce) {
                    failOriginalStatisticsAuditOnce = false;
                    throw new Error('fixture original statistics audit failed');
                }
                oplogs.push({ ...entry });
            },
        },
    ],
];

for (const [relative, exports] of cacheStubs) {
    const filename = require.resolve(relative);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
}

(global.Hydro.model as any).permits = {
    async listForProblem(domainId: string, pid: number) {
        return authorPermits.filter((permit) => permit.domainId === domainId && permit.pid === pid && permit.active !== false);
    },
};

const adapterPath = require.resolve('../src/model/problem-batch-import-adapter.ts');
delete require.cache[adapterPath];
const { HydroProblemBatchImportAdapter } = require(adapterPath) as typeof import('../src/model/problem-batch-import-adapter');

describe('P2.23 Hydro production batch adapter', () => {
    let root: string;
    let manifestPath: string;

    before(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'problem-batch-adapter-'));
        await fsp.mkdir(path.join(root, 'data'), { recursive: true });
        await Promise.all([
            fsp.writeFile(path.join(root, 'statement.md'), '# Fixture\n\n![x](file://figure.png)\n\n```input1\n1\n```\n\n```output1\n2\n```\n'),
            fsp.writeFile(path.join(root, 'figure.png'), 'asset'),
            fsp.writeFile(path.join(root, 'data/1.in'), '1\n'),
            fsp.writeFile(path.join(root, 'data/1.out'), '2\n'),
        ]);
        await fsp.writeFile(path.join(root, 'A.yaml'), yaml.dump({ time: '1s', memory: '256m', cases: [{ input: '1.in', output: '1.out' }] }));
        manifestPath = path.join(root, 'batch.json');
        await fsp.writeFile(
            manifestPath,
            JSON.stringify({
                schemaVersion: 1,
                batchId: 'fixture-2026-1',
                domain: 'system',
                actor: 2,
                source: { template: 'nowcoder_summer', year: 2026, round: 1 },
                author: { uid: 515, username: '2025多校' },
                training: { id: trainingId.toHexString(), title: training.title, chapterTitle: '2026年牛客-第1场' },
                selection: { field: 'accepted', operator: '>', value: 100, source: 'fixture' },
                problems: [
                    {
                        sourceProblemCode: 'A',
                        title: 'Fixture A',
                        difficulty: 3,
                        mindmapNodeIds: [nodeId],
                        origStat: { accepted: 200, submitted: 300 },
                        statement: 'statement.md',
                        assets: [{ source: 'figure.png', target: 'figure.png' }],
                        testdata: {
                            directory: 'data',
                            files: ['1.in', '1.out'],
                            config: 'A.yaml',
                            checker: null,
                            cases: [{ input: '1.in', output: '1.out' }],
                        },
                    },
                ],
            }),
        );
    });

    after(() => fs.rmSync(root, { recursive: true, force: true }));

    beforeEach(() => {
        counter.value = 1063;
        nextDocId = 3000;
        problemDocs.length = 0;
        authorPermits.length = 0;
        storageObjects.clear();
        oplogs.length = 0;
        calls.length = 0;
        managedDraftInputs.length = 0;
        failConfigObserver = false;
        publicationIncomplete = false;
        failOriginalStatisticsAuditOnce = false;
        clearHistoricalChapterAfterDraftReady = false;
        training.dag = [{ _id: 1, title: '2025年牛客-第10场', requireNids: [], pids: [99] }];
    });

    it('uses only canonical managed methods, publishes after readiness, verifies hashes, and resumes as a no-op', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        expect(plan.facts.problems[0]).to.include({
            sourceProblemCode: 'A',
            pid: 'NK1064',
            knowledgeMapId: knowledgeMapId.toHexString(),
            state: 'new',
        });
        const report = createProblemBatchExecutionReport(plan, 2);
        const result = await adapter.apply(batch, plan, report, async () => {});

        expect(result.ok).to.equal(true);
        expect(result.problems[0]).to.include({ pid: 'NK1064', hidden: false, cases: 1, assets: 1 });
        expect(calls.indexOf('createManagedProgrammingDraft')).to.be.lessThan(calls.indexOf('addTestdataWithClaim:1.in'));
        expect(calls.indexOf('addTestdataWithClaim:config.yaml')).to.be.lessThan(calls.indexOf('ensureProblemBatchChapter'));
        expect(calls.indexOf('ensureProblemBatchChapter')).to.be.lessThan(calls.indexOf('publishManagedProgrammingProblem'));
        expect(calls).to.include.members([
            'withAuthorizedDataWriteClaim',
            'addAdditionalFileWithClaim:figure.png',
            'editAuthorized:origStat',
            'setManagedProgrammingDraftTrainingPlacement',
        ]);
        expect(problemDocs[0].batchImport.identity).to.equal('fixture-2026-1:A');
        expect(managedDraftInputs[0].knowledgeMapId).to.equal(knowledgeMapId.toHexString());
        expect(problemDocs[0].managedAuthoring).not.to.have.property('pendingTrainingPlacement');

        const mutationCount = calls.filter((call) =>
            [
                'createManagedProgrammingDraft',
                'addTestdataWithClaim:',
                'addAdditionalFileWithClaim:',
                'editAuthorized:',
                'publishManagedProgrammingProblem',
            ].some((prefix) => call.startsWith(prefix)),
        ).length;
        delete problemDocs[0].knowledgeNodeIds;
        const resumed = await adapter.apply(batch, plan, report, async () => {});
        expect(resumed).to.deep.equal(result);
        expect(problemDocs[0].managedAuthoring.selectedMindmapNodeIds.map(String)).to.deep.equal([nodeId]);
        const resumedMutationCount = calls.filter((call) =>
            [
                'createManagedProgrammingDraft',
                'addTestdataWithClaim:',
                'addAdditionalFileWithClaim:',
                'editAuthorized:',
                'publishManagedProgrammingProblem',
            ].some((prefix) => call.startsWith(prefix)),
        ).length;
        expect(resumedMutationCount).to.equal(mutationCount);
    });

    it('replaces an exact historical placeholder in place and omits unavailable contest statistics', async () => {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        manifest.batchId = 'fixture-historical-2021-spring';
        manifest.training = {
            id: trainingId.toHexString(),
            title: training.title,
            chapterTitle: '2021春-',
            chapterId: 47,
            replacePids: [99],
        };
        manifest.selection = { field: 'sourceProblemCode', operator: 'in', value: ['A'], source: 'user-provided complete list' };
        delete manifest.problems[0].origStat;
        const historicalPath = path.join(root, 'historical.json');
        await fsp.writeFile(historicalPath, JSON.stringify(manifest));
        training.dag = [
            { _id: 50, title: '2021冬-', requireNids: [], pids: [98] },
            { _id: 47, title: '2021春-', requireNids: [], pids: [99] },
        ];

        const batch = await validateProblemBatchManifest(historicalPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        expect(plan.facts.training).to.include({
            chapterId: 47,
            chapterMode: 'replace-existing',
            chapterPosition: 1,
        });
        expect(plan.facts.training.replacePids).to.deep.equal([99]);

        const result = await adapter.apply(batch, plan, createProblemBatchExecutionReport(plan, 2), async () => {});

        expect(result.training).to.include({ chapterId: 47 });
        expect(training.dag.map((chapter: any) => chapter._id)).to.deep.equal([50, 47]);
        expect(training.dag[1].pids).to.deep.equal([3000]);
        expect(problemDocs[0]).not.to.have.property('origStat');
        expect(calls).not.to.include('editAuthorized:origStat');
        expect(oplogs.filter((entry) => entry.type === 'realpass.batch-import')).to.have.length(0);
    });

    it('rejects an externally emptied historical chapter without a matching replacement audit', async () => {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        manifest.batchId = 'fixture-historical-external-clear';
        manifest.training = {
            id: trainingId.toHexString(),
            title: training.title,
            chapterTitle: '2021春-',
            chapterId: 47,
            replacePids: [98],
        };
        manifest.selection = { field: 'sourceProblemCode', operator: 'in', value: ['A'], source: 'user-provided complete list' };
        delete manifest.problems[0].origStat;
        const historicalPath = path.join(root, 'historical-external-clear.json');
        await fsp.writeFile(historicalPath, JSON.stringify(manifest));
        training.dag = [
            { _id: 50, title: '2021冬-', requireNids: [], pids: [99] },
            { _id: 47, title: '2021春-', requireNids: [], pids: [98] },
        ];

        const batch = await validateProblemBatchManifest(historicalPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        clearHistoricalChapterAfterDraftReady = true;

        try {
            await adapter.apply(batch, plan, createProblemBatchExecutionReport(plan, 2), async () => {});
            expect.fail('expected unaudited historical chapter clear to fail');
        } catch (error) {
            expect(error).to.have.property('message').that.includes('without the matching successful replacement audit');
        }
        expect(calls).not.to.include('ensureProblemBatchChapter');
        expect(calls).not.to.include('publishManagedProgrammingProblem');
        expect(training.dag[1].pids).to.deep.equal([]);
        expect(problemDocs[0].hidden).to.equal(true);
    });

    it('fails preflight on an existing identity with a different content fingerprint', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        problemDocs.push({
            domainId: 'system',
            docType: 10,
            docId: 3000,
            pid: 'NK1064',
            title: 'Fixture A',
            hidden: true,
            problemKind: 'programming',
            authoringMode: 'managed',
            managedAuthoring: { metadataStatus: 'draft' },
            batchImport: { batchId: batch.manifest.batchId, sourceProblemCode: 'A', identity: 'fixture-2026-1:A', fingerprint: '0'.repeat(64) },
        });
        authorPermits.push({ domainId: 'system', pid: 3000, uid: 515, role: 'author', active: true });
        const adapter = new HydroProblemBatchImportAdapter();
        try {
            await adapter.preflight(batch);
            expect.fail('expected identity conflict');
        } catch (error) {
            expect(error).to.have.property('code', 'BATCH_IMPORT_IDENTITY_CONFLICT');
        }
    });

    it('rejects every interrupted-draft map or node drift before writing files, training, or publication', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const entry = batch.problems[0];
        await ProblemModelStub.createManagedProgrammingDraft(
            batch.manifest.domain,
            {
                workingTitle: entry.title,
                content: await fsp.readFile(entry.statementFile.path, 'utf8'),
                difficulty: entry.difficulty,
                sourceMeta: batch.manifest.source,
                knowledgeMapId: knowledgeMapId.toHexString(),
                mindmapNodeIds: entry.mindmapNodeIds,
                authorUid: batch.manifest.author.uid,
                batchImport: {
                    batchId: batch.manifest.batchId,
                    sourceProblemCode: entry.sourceProblemCode,
                    fingerprint: entry.fingerprint,
                },
            },
            batch.manifest.actor,
        );
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        const pdoc = problemDocs[0];
        const originalMapId = pdoc.knowledgeMapId;
        const originalKnowledgeNodeIds = [...pdoc.knowledgeNodeIds];
        const originalManagedNodeIds = [...pdoc.managedAuthoring.selectedMindmapNodeIds];
        const otherMapId = new ObjectId('6a50935a53f083fa84681fc7');
        const otherNodeId = new ObjectId('6a50935a53f083fa84681fc8');
        const variants = [
            () => {
                pdoc.knowledgeMapId = otherMapId;
            },
            () => {
                pdoc.knowledgeNodeIds = [otherNodeId];
            },
            () => {
                pdoc.managedAuthoring.selectedMindmapNodeIds = [otherNodeId];
            },
        ];

        for (const mutate of variants) {
            pdoc.knowledgeMapId = originalMapId;
            pdoc.knowledgeNodeIds = [...originalKnowledgeNodeIds];
            pdoc.managedAuthoring.selectedMindmapNodeIds = [...originalManagedNodeIds];
            mutate();
            calls.length = 0;
            let failure: any;
            try {
                await adapter.apply(batch, plan, createProblemBatchExecutionReport(plan, 2), async () => {});
            } catch (error) {
                failure = error;
            }
            expect(failure).to.have.property('code', 'BATCH_IMPORT_MINDMAP_CONFLICT');
            expect(calls).to.deep.equal([]);
        }
    });

    it('propagates a config observer failure before chapter creation or publication', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        failConfigObserver = true;

        try {
            await adapter.apply(batch, plan, createProblemBatchExecutionReport(plan, 2), async () => {});
            expect.fail('expected observer failure');
        } catch (error) {
            expect(error).to.have.property('message', 'fixture observer failed');
        }
        expect(calls).not.to.include('ensureProblemBatchChapter');
        expect(calls).not.to.include('publishManagedProgrammingProblem');
        expect(problemDocs[0].hidden).to.equal(true);
    });

    it('repairs a missing origStat audit on retry without rewriting the statistics', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        failOriginalStatisticsAuditOnce = true;

        try {
            await adapter.apply(batch, plan, report, async () => {});
            expect.fail('expected original statistics audit failure');
        } catch (error) {
            expect(error).to.have.property('message', 'fixture original statistics audit failed');
        }
        expect(problemDocs[0].origStat).to.include({ accepted: 200, submitted: 300, updatedBy: 2 });
        expect(calls).not.to.include('ensureProblemBatchChapter');
        const statisticsWrites = calls.filter((call) => call === 'editAuthorized:origStat').length;

        const result = await adapter.apply(batch, plan, report, async () => {});
        expect(result.ok).to.equal(true);
        expect(calls.filter((call) => call === 'editAuthorized:origStat')).to.have.length(statisticsWrites);
        expect(oplogs.filter((entry) => entry.type === 'realpass.batch-import')).to.have.length(1);
    });

    it('records publication request details when canonical publication commits incompletely', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        const events: any[] = [];
        publicationIncomplete = true;

        try {
            await adapter.apply(batch, plan, createProblemBatchExecutionReport(plan, 2), async (event) => {
                events.push(event);
            });
            expect.fail('expected incomplete publication failure');
        } catch (error) {
            expect(error).to.have.property('code', 'BATCH_IMPORT_PUBLICATION_INCOMPLETE');
        }
        expect(problemDocs[0].hidden).to.equal(false);
        expect(events.at(-1)).to.deep.equal({
            stage: 'publication-incomplete',
            sourceProblemCode: 'A',
            docId: 3000,
            pid: 'NK1064',
            requestId: 'publish-3000',
            incompleteStages: ['edit-observers'],
        });
    });

    it('rejects duplicate or reordered chapter members before another apply mutation', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        await adapter.apply(batch, plan, report, async () => {});
        training.dag[0].pids.push(problemDocs[0].docId);
        const callsBeforeRetry = calls.length;

        try {
            await adapter.apply(batch, plan, report, async () => {});
            expect.fail('expected chapter member conflict');
        } catch (error) {
            expect(error).to.have.property('message').that.includes('exact published manifest prefix');
        }
        expect(calls).to.have.length(callsBeforeRetry);
    });

    it('rejects a missing target chapter when a published batch prefix already exists', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new HydroProblemBatchImportAdapter();
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        await adapter.apply(batch, plan, report, async () => {});
        training.dag = training.dag.filter((chapter: any) => chapter.title !== '2026年牛客-第1场');
        const callsBeforeRetry = calls.length;

        try {
            await adapter.apply(batch, plan, report, async () => {});
            expect.fail('expected missing chapter conflict');
        } catch (error) {
            expect(error).to.have.property('message').that.includes('published batch problems exist');
        }
        expect(calls).to.have.length(callsBeforeRetry);
    });
});
