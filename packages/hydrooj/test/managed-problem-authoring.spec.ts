import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { managedProblemPatchCapability } from '../src/model/managed-problem-patch';

(global as any).Hydro ||= { model: {} };

class TestValidationError extends Error {
    name = 'ValidationError';
}

class TestMetadataConflictError extends Error {
    name = 'ManagedProblemMetadataConflictError';
}

let mindmapDocs: any[] = [];
let trainingDocs: any[] = [];
let problemDocs: any[] = [];
let counterValue: number | null = null;
const counterCalls: any[] = [];
const indexCalls: any[] = [];
const problemIndexCalls: any[] = [];
let problemIndexDocs: any[] = [];

const collectionStub = (name: string) => {
    if (name === 'mindmap.nodes') {
        return {
            find() {
                return {
                    async toArray() {
                        return mindmapDocs.map((node) => ({ ...node, tags: [...node.tags] }));
                    },
                };
            },
        };
    }
    if (name === 'problem.pid_counters') {
        return {
            async createIndex(key: any, options: any) {
                indexCalls.push({ key, options });
            },
            async findOneAndUpdate(filter: any, update: any, options: any) {
                counterCalls.push({ filter: structuredClone(filter), update: structuredClone(update), options: structuredClone(options) });
                if (counterValue === null) return null;
                counterValue += update.$inc.value;
                return { ...filter, value: counterValue, updatedAt: update.$set.updatedAt };
            },
        };
    }
    throw new Error(`unexpected collection ${name}`);
};

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const errorPath = require.resolve('../src/error.ts');
const modulePath = require.resolve('../src/model/managed-problem-authoring.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: collectionStub } },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: {
        ManagedProblemMetadataConflictError: TestMetadataConflictError,
        ValidationError: TestValidationError,
    },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        TYPE_PROBLEM: 10,
        TYPE_TRAINING: 40,
        coll: {
            async distinct(field: string, filter: any) {
                if (field !== 'tag') throw new Error(`unexpected distinct field ${field}`);
                return [
                    ...new Set(
                        problemDocs
                            .filter((doc) => doc.domainId === filter.domainId && (doc.docType ?? 10) === filter.docType)
                            .flatMap((doc) => (Array.isArray(doc.tag) ? doc.tag : [])),
                    ),
                ];
            },
            async createIndex(key: any, options: any) {
                problemIndexCalls.push({ key: structuredClone(key), options: structuredClone(options) });
                return options.name;
            },
            listIndexes() {
                return {
                    async toArray() {
                        return problemIndexDocs.map((index) => structuredClone(index));
                    },
                };
            },
            find(filter: any) {
                let docs = filter.docType === 40 ? trainingDocs : problemDocs;
                if (filter.docId?.$in) docs = docs.filter((doc) => filter.docId.$in.includes(doc.docId));
                const cursor = {
                    sort() {
                        return cursor;
                    },
                    async toArray() {
                        return docs.map((doc) => ({ ...doc }));
                    },
                };
                return cursor;
            },
            async findOne(filter: any) {
                if (filter.docType === 40) {
                    return trainingDocs.find((doc) => doc.domainId === filter.domainId && doc.docId.equals(filter.docId)) || null;
                }
                return (
                    problemDocs.find(
                        (doc) =>
                            doc.domainId === filter.domainId &&
                            filter.docId.$in.includes(doc.docId) &&
                            Array.isArray(doc.tag) &&
                            doc.tag.includes(filter.tag),
                    ) || null
                );
            },
        },
    },
} as NodeModule;
delete require.cache[modulePath];

const authoring = require(modulePath) as typeof import('../src/model/managed-problem-authoring');

async function expectReject(work: Promise<unknown>, error: string | (new (...args: any[]) => Error)) {
    try {
        await work;
    } catch (caught) {
        if (typeof error === 'string') expect(caught).to.have.property('message').that.includes(error);
        else expect(caught).to.be.instanceOf(error);
        return;
    }
    expect.fail('expected promise to reject');
}

beforeEach(() => {
    mindmapDocs = [];
    trainingDocs = [];
    problemDocs = [];
    counterValue = null;
    counterCalls.length = 0;
    indexCalls.length = 0;
    problemIndexCalls.length = 0;
    problemIndexDocs = [
        {
            name: 'problemPid',
            key: { domainId: 1, docType: 1, pid: 1 },
            unique: true,
            partialFilterExpression: { docType: 10, pid: { $type: 'string' } },
        },
        {
            name: 'problemBatchImportIdentity',
            key: { domainId: 1, docType: 1, 'batchImport.identity': 1 },
            unique: true,
            partialFilterExpression: { docType: 10, hasBatchImportIdentity: true },
        },
    ];
});

describe('P2.14 managed generic patch guard', () => {
    const draft = {
        domainId: 'system',
        docType: 10,
        docId: 101,
        owner: 9,
        hidden: true,
        authoringMode: 'managed',
        problemKind: 'programming',
        pid: 'P3101',
        tag: ['PAT乙级'],
        sourceMeta: { template: 'pat_basic', year: 2026, season: 'spring' },
        managedAuthoring: {
            workingTitle: '旧标题',
            selectedMindmapNodeIds: [new ObjectId('64b000000000000000000011')],
            metadataStatus: 'draft',
        },
    } as any;

    it('rejects dotted canonical writes before administrator publish capability can authorize them', () => {
        for (const [field, value] of [
            ['sourceMeta.template', 'self'],
            ['tag.0', 'forged'],
            ['managedAuthoring.metadataStatus', 'confirmed'],
        ]) {
            const guard = managedProblemPatchCapability(draft, { [field]: value } as any, {});
            expect(guard.capability).to.equal('publish');
            expect(guard.immutableFields).to.deep.equal([field]);
            expect(guard.changedFields).to.include(field);
        }
    });

    it('allows only a coupled draft working-title update and locks it after confirmation', () => {
        const update = {
            title: '待审核 · 新标题',
            managedAuthoring: { ...draft.managedAuthoring, workingTitle: '新标题' },
        };
        const draftGuard = managedProblemPatchCapability(draft, update, {});
        expect(draftGuard.capability).to.equal('metadata');
        expect(draftGuard.immutableFields).to.deep.equal([]);

        const confirmed = {
            ...draft,
            hidden: false,
            title: '正式标题',
            managedAuthoring: { ...draft.managedAuthoring, metadataStatus: 'confirmed' },
        };
        const confirmedGuard = managedProblemPatchCapability(confirmed, update, {});
        expect(confirmedGuard.immutableFields).to.have.members(['title', 'managedAuthoring']);
    });

    it('allows an author to suggest live mindmap nodes without gaining metadata authority', () => {
        const suggested = {
            ...draft.managedAuthoring,
            selectedMindmapNodeIds: [new ObjectId('64b000000000000000000012')],
        };
        const contentGuard = managedProblemPatchCapability(draft, { content: 'updated', managedAuthoring: suggested }, {});
        expect(contentGuard.capability).to.equal('content');
        expect(contentGuard.immutableFields).to.deep.equal([]);

        const metadataGuard = managedProblemPatchCapability(
            draft,
            { title: '待审核 · 新标题', managedAuthoring: { ...suggested, workingTitle: '新标题' } },
            {},
        );
        expect(metadataGuard.capability).to.equal('metadata');
        expect(metadataGuard.immutableFields).to.deep.equal([]);

        const confirmed = {
            ...draft,
            managedAuthoring: { ...draft.managedAuthoring, metadataStatus: 'confirmed' },
        };
        expect(managedProblemPatchCapability(confirmed, { managedAuthoring: suggested }, {}).immutableFields).to.include('managedAuthoring');
    });

    it('treats every removal or non-true hidden value as a unified-publication attempt', () => {
        for (const [$set, $unset] of [
            [{ hidden: false }, {}],
            [{ hidden: null }, {}],
            [{ hidden: 0 }, {}],
            [{ hidden: undefined }, {}],
            [{}, { hidden: '' }],
            [{ hidden: true }, { hidden: '' }],
        ] as Array<[Record<string, unknown>, Record<string, unknown>]>) {
            const guard = managedProblemPatchCapability(draft, $set as any, $unset);
            expect(guard.capability).to.equal('publish');
            expect(guard.publishes).to.equal(true);
        }
    });
});

describe('P2.14 managed problem source templates', () => {
    const cases: Array<[unknown, string[], string, number]> = [
        [{ template: 'pat_basic', year: 2026, season: 'spring' }, ['PAT乙级', '2026春'], 'P3101', 3101],
        [{ template: 'pat_basic', year: 2026, season: 'summer' }, ['PAT乙级', '2026夏'], 'P3102', 3102],
        [{ template: 'pat_advanced', year: 2026, season: 'autumn' }, ['PAT甲级', '2026秋'], 'P4052', 4052],
        [{ template: 'pat_advanced', year: 2026, season: 'winter' }, ['PAT甲级', '2026冬'], 'P4053', 4053],
        [{ template: 'gplt_national', year: 2026, level: 'L2' }, ['天梯赛全国总决赛', 'L2', '2026CCCC'], 'GPLT2026N001', 1],
        [{ template: 'gplt_provincial', year: 2026, level: 'L3' }, ['天梯赛省级赛', 'L3', '2026CCCC-省'], 'GPLT2026P002', 2],
        [{ template: 'cauc', year: 2026 }, ['CAUC校赛', '2026校赛'], 'CCCCCAUC20260003', 3],
        [{ template: 'self', year: 2026 }, ['自命题', '2026自命题'], 'P5035', 5035],
        [{ template: 'nowcoder_summer', year: 2026, round: 4 }, ['MultiSchool', '牛客暑期多校', '2026牛客暑期多校'], 'NK1064', 1064],
        [{ template: 'hdu_summer', year: 2026, round: 5 }, ['MultiSchool', '杭电暑期多校', '2026杭电暑期多校'], 'HDU1176', 1176],
        [{ template: 'hdu_spring', year: 2026, round: 2 }, ['杭电春季赛', '2026HDU-S'], 'HDU1177', 1177],
    ];

    for (const [sourceMeta, tags, pid, sequence] of cases) {
        it(`derives canonical tags and PID for ${(sourceMeta as any).template}`, () => {
            expect(authoring.deriveManagedSourceTags(sourceMeta)).to.deep.equal(tags);
            expect(authoring.formatManagedProblemPid(sourceMeta, sequence)).to.equal(pid);
            expect(tags).not.to.include.members(['PAT', 'Ladder']);
            expect(tags.some((tag) => /第\s*\d+\s*场/.test(tag))).to.equal(false);
        });
    }

    it('rejects fields outside the selected fixed template', () => {
        expect(() => authoring.normalizeManagedSourceMeta({ template: 'pat_basic', year: 2026, season: 'spring', round: 1 })).to.throw(
            TestValidationError,
        );
        expect(() => authoring.normalizeManagedSourceMeta({ template: 'other', year: 2026 })).to.throw(TestValidationError);
        expect(() => authoring.normalizeManagedSourceMeta({ template: 'pat_basic', year: 2026, season: 'rainy' })).to.throw(TestValidationError);
        expect(() => authoring.normalizeManagedSourceMeta({ template: 'gplt_national', year: 2026, level: 'L4' })).to.throw(TestValidationError);
    });

    it('shares one HDU counter namespace across spring and summer', () => {
        expect(authoring.managedPidCounterNamespace({ template: 'hdu_summer', year: 2026, round: 1 })).to.equal('hdu');
        expect(authoring.managedPidCounterNamespace({ template: 'hdu_spring', year: 2026, round: 1 })).to.equal('hdu');
    });

    it('reserves monotonically and never upserts an uninitialized counter', async () => {
        counterValue = 3100;
        expect(await authoring.reserveManagedProblemPid('system', { template: 'pat_basic', year: 2026, season: 'spring' })).to.equal('P3101');
        expect(await authoring.reserveManagedProblemPid('system', { template: 'pat_basic', year: 2026, season: 'autumn' })).to.equal('P3102');
        expect(counterCalls).to.have.length(2);
        expect(counterCalls[0].options).to.deep.equal({ returnDocument: 'after' });
        expect(counterCalls[0].options).not.to.have.property('upsert');
        counterValue = null;
        await expectReject(
            authoring.reserveManagedProblemPid('system', { template: 'pat_basic', year: 2026, season: 'spring' }),
            'PID counter is not initialized',
        );
    });

    it('creates the required unique counter index', async () => {
        await authoring.ensureManagedProblemAuthoringIndexes();
        expect(indexCalls).to.deep.equal([
            {
                key: { domainId: 1, namespace: 1 },
                options: { name: 'problem_pid_counter_namespace_uq', unique: true },
            },
        ]);
        expect(problemIndexCalls).to.deep.equal([
            {
                key: { domainId: 1, docType: 1, pid: 1 },
                options: {
                    name: 'problemPid',
                    unique: true,
                    partialFilterExpression: { docType: 10, pid: { $type: 'string' } },
                },
            },
            {
                key: { domainId: 1, docType: 1, 'batchImport.identity': 1 },
                options: {
                    name: 'problemBatchImportIdentity',
                    unique: true,
                    partialFilterExpression: { docType: 10, hasBatchImportIdentity: true },
                },
            },
        ]);
    });

    it('fails startup when the Problem PID index is not the required partial unique index', async () => {
        problemIndexDocs[0].unique = false;
        await expectReject(authoring.ensureManagedProblemAuthoringIndexes(), 'Problem PID index is not the required partial unique index');
    });

    it('fails startup when the batch identity index is missing or has drifted', async () => {
        problemIndexDocs[1].unique = false;
        await expectReject(
            authoring.ensureManagedProblemAuthoringIndexes(),
            'Problem batch import identity index is not the required partial unique index',
        );
    });

    it('keeps internal authoring state out of public projections', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/problem.ts'), 'utf8');
        const listProjection = source.match(/static PROJECTION_LIST:[\s\S]*?\n {4}\];/)?.[0] || '';
        const publicProjection = source.match(/static PROJECTION_PUBLIC:[\s\S]*?\n {4}\];/)?.[0] || '';
        expect(listProjection).not.to.include("'managedAuthoring'");
        expect(listProjection).not.to.include("'sourceMeta'");
        expect(publicProjection).not.to.include("'managedAuthoring'");
        expect(publicProjection).not.to.include("'sourceMeta'");
        expect(publicProjection).not.to.include("'knowledgeNodeIds'");
        expect(source).to.include(
            "static PROJECTION_MANAGED_EDITOR: Field[] = [...ProblemModel.PROJECTION_PUBLIC, 'sourceMeta', 'managedAuthoring', 'knowledgeNodeIds']",
        );
    });
});

describe('P2.14 managed problem mindmap tags', () => {
    const root = new ObjectId('64b000000000000000000001');
    const parent = new ObjectId('64b000000000000000000002');
    const leaf = new ObjectId('64b000000000000000000003');

    beforeEach(() => {
        mindmapDocs = [
            { _id: root, parentId: null, topic: '数据结构', tags: ['数据结构'] },
            { _id: parent, parentId: root, topic: '线段树', tags: ['线段树'] },
            { _id: leaf, parentId: parent, topic: '基础线段树', tags: ['基础线段树'] },
        ];
    });

    it('materializes tagged ancestors from the live tree', async () => {
        const result = await authoring.materializeManagedMindmapTags([leaf.toHexString()]);
        expect(result.nodeIds.map(String)).to.deep.equal([leaf.toHexString()]);
        expect(result.tags).to.deep.equal(['数据结构', '线段树', '基础线段树']);
        expect(await authoring.listManagedMindmapOptions()).to.deep.include({
            id: leaf.toHexString(),
            label: '数据结构 / 线段树 / 基础线段树',
            tags: ['基础线段树'],
        });
    });

    it('canonicalizes managed draft suggestions from live node ids before persistence', async () => {
        const current = {
            authoringMode: 'managed' as const,
            managedAuthoring: {
                workingTitle: '工作标题',
                selectedMindmapNodeIds: [parent],
                metadataStatus: 'draft' as const,
            },
        };
        const patch: any = {
            managedAuthoring: {
                ...current.managedAuthoring,
                selectedMindmapNodeIds: [leaf.toHexString()],
            },
        };

        expect(await authoring.canonicalizeManagedDraftMindmapPatch(current as any, patch)).to.deep.equal([leaf.toHexString()]);
        expect(patch.managedAuthoring.selectedMindmapNodeIds[0]).to.be.instanceOf(ObjectId);

        mindmapDocs = mindmapDocs.filter((node) => !node._id.equals(leaf));
        await expectReject(authoring.canonicalizeManagedDraftMindmapPatch(current as any, patch), TestMetadataConflictError);
    });

    it('returns 409-style conflicts when a selected node or ancestor vanished', async () => {
        await expectReject(authoring.materializeManagedMindmapTags([new ObjectId().toHexString()]), TestMetadataConflictError);
        mindmapDocs = mindmapDocs.filter((node) => !node._id.equals(parent));
        await expectReject(authoring.materializeManagedMindmapTags([leaf.toHexString()]), TestMetadataConflictError);
    });

    it('allows an empty structured selection without weakening the managed requirement', async () => {
        expect(await authoring.materializeKnowledgeMindmapTags([])).to.deep.equal({ nodeIds: [], tags: [] });
        expect(await authoring.materializeKnowledgeMindmapTags([''])).to.deep.equal({ nodeIds: [], tags: [] });
        await expectReject(authoring.materializeKnowledgeMindmapTags(['not-an-object-id']), 'knowledgeNodeIds');
        await expectReject(authoring.materializeManagedMindmapTags(['']), 'mindmapNodeIds');
    });

    it('publishes one grouped canonical tag catalog without counts or unregistered annual tags', async () => {
        problemDocs = [
            { domainId: 'system', docType: 10, docId: 101, tag: ['PAT乙级', '2026春', 'Ladder'] },
            { domainId: 'system', docType: 10, docId: 102, tag: ['天梯赛全国总决赛', 'L1', '2026CCCC'] },
            { domainId: 'system', docType: 10, docId: 103, tag: ['2026随便'] },
            { domainId: 'other', docType: 10, docId: 104, tag: ['2025校赛'] },
        ];

        const catalog = await authoring.listCanonicalProblemTagOptions('system');
        expect(catalog).to.deep.include({ value: '基础线段树', label: '数据结构 / 线段树 / 基础线段树', group: '算法知识点' });
        expect(catalog).to.deep.include({ value: 'PAT乙级', label: 'PAT乙级', group: '来源与赛事' });
        expect(catalog).to.deep.include({ value: '2026春', label: '2026春', group: '来源与赛事' });
        expect(catalog).to.deep.include({ value: '2026CCCC', label: '2026CCCC', group: '来源与赛事' });
        expect(catalog.map((option) => option.value)).not.to.include.members(['Ladder', '2026随便', '2025校赛']);
        expect(catalog.every((option) => !Object.hasOwn(option, 'count'))).to.equal(true);
    });
});

describe('P2.17 legacy programming tag normalization', () => {
    const root = new ObjectId('64b000000000000000000021');
    const unique = new ObjectId('64b000000000000000000022');
    const duplicateA = new ObjectId('64b000000000000000000023');
    const duplicateB = new ObjectId('64b000000000000000000024');
    const mindmapVersion = new Date('2026-07-16T00:00:00.000Z');

    beforeEach(() => {
        mindmapDocs = [
            { _id: root, parentId: null, topic: '算法', tags: ['算法'], updatedAt: new Date(mindmapVersion.getTime()) },
            { _id: unique, parentId: root, topic: '二分', tags: ['二分'], updatedAt: new Date(mindmapVersion.getTime()) },
            { _id: duplicateA, parentId: root, topic: '快速幂 A', tags: ['快速幂'], updatedAt: new Date(mindmapVersion.getTime()) },
            { _id: duplicateB, parentId: root, topic: '快速幂 B', tags: ['快速幂'], updatedAt: new Date(mindmapVersion.getTime()) },
        ];
    });

    it('classifies source, unique, ambiguous, and unknown legacy tags without writing a selection', async () => {
        const options = await authoring.listKnowledgeMindmapOptions();
        const classified = authoring.classifyLegacyProgrammingTags(['PAT乙级', '2026春', '二分', '快速幂', 'Dijksrta'], options);

        expect(classified.sourceTags).to.deep.equal(['PAT乙级', '2026春']);
        expect(classified.suggestions).to.deep.equal([{ tag: '二分', nodeId: unique.toHexString(), label: '算法 / 二分' }]);
        expect(classified.suggestedNodeIds).to.deep.equal([unique.toHexString()]);
        expect(classified.ambiguousTags).to.deep.equal([{ tag: '快速幂', candidates: ['算法 / 快速幂 A', '算法 / 快速幂 B'] }]);
        expect(classified.unknownTags).to.deep.equal(['Dijksrta']);
    });

    it('previews one explicit atomic replacement with retained source tags and live ancestors', async () => {
        const preview = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 17,
            structureRevision: 9,
            currentTags: ['二分', 'PAT乙级', 'Dijksrta'],
            selectedNodeIds: [unique.toHexString()],
        });

        expect(preview.sourceTags).to.deep.equal(['PAT乙级']);
        expect(preview.nextTags).to.deep.equal(['PAT乙级', '算法', '二分']);
        expect(preview.retainedTags).to.deep.equal(['二分', 'PAT乙级']);
        expect(preview.addedTags).to.deep.equal(['算法']);
        expect(preview.removedTags).to.deep.equal(['Dijksrta']);
        expect(preview.selectedNodeIds.map(String)).to.deep.equal([unique.toHexString()]);
        expect(preview.fingerprint).to.match(/^[a-f0-9]{64}$/);
    });

    it('requires at least one live node and changes the fingerprint when source state changes', async () => {
        await expectReject(
            authoring.previewProgrammingTagNormalization({
                domainId: 'system',
                docId: 17,
                structureRevision: 9,
                currentTags: ['PAT乙级'],
                selectedNodeIds: [],
            }),
            'knowledgeNodeIds',
        );
        const first = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 17,
            structureRevision: 9,
            currentTags: ['PAT乙级'],
            selectedNodeIds: [unique.toHexString()],
        });
        const changed = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 17,
            structureRevision: 10,
            currentTags: ['PAT乙级', '2026春'],
            selectedNodeIds: [unique.toHexString()],
        });
        expect(changed.fingerprint).not.to.equal(first.fingerprint);

        const legacy = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 18,
            structureRevision: undefined,
            currentTags: ['PAT乙级'],
            selectedNodeIds: [unique.toHexString()],
        });
        expect(legacy.fingerprint).to.match(/^[a-f0-9]{64}$/);
        expect(legacy.fingerprint).not.to.equal(first.fingerprint);
    });

    it('invalidates a preview when the selected full path changes without changing its tags', async () => {
        const first = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 17,
            structureRevision: 9,
            currentTags: ['PAT乙级', '二分'],
            selectedNodeIds: [unique.toHexString()],
        });
        mindmapDocs = mindmapDocs.map((node) =>
            node._id.equals(unique) ? { ...node, topic: '二分查找', updatedAt: new Date(mindmapVersion.getTime() + 1) } : node,
        );
        const renamed = await authoring.previewProgrammingTagNormalization({
            domainId: 'system',
            docId: 17,
            structureRevision: 9,
            currentTags: ['PAT乙级', '二分'],
            selectedNodeIds: [unique.toHexString()],
        });

        expect(renamed.nextTags).to.deep.equal(first.nextTags);
        expect(renamed.fingerprint).not.to.equal(first.fingerprint);
    });
});

describe('P2.14 managed problem training placement', () => {
    const trainingId = new ObjectId('64b000000000000000000010');

    beforeEach(() => {
        trainingDocs = [
            {
                domainId: 'system',
                docId: trainingId,
                title: 'PAT 乙级训练',
                dag: [{ _id: 1, title: '2026 春季', requireNids: [], pids: [100] }],
            },
        ];
        problemDocs = [{ domainId: 'system', docId: 100, tag: ['PAT乙级'] }];
    });

    it('lists and accepts only an existing source-compatible training chapter', async () => {
        expect(await authoring.listManagedTrainingOptions('system')).to.deep.equal([
            {
                id: trainingId.toHexString(),
                title: 'PAT 乙级训练',
                templates: ['pat_basic'],
                chapters: [{ id: 1, title: '2026 春季' }],
            },
        ]);
        expect(
            await authoring.validateManagedTrainingPlacement('system', 'pat_basic', {
                trainingId: trainingId.toHexString(),
                chapterId: 1,
            }),
        ).to.deep.equal({ trainingId, chapterId: 1 });
        await expectReject(
            authoring.validateManagedTrainingPlacement('system', 'pat_advanced', {
                trainingId: trainingId.toHexString(),
                chapterId: 1,
            }),
            TestMetadataConflictError,
        );
    });

    it('reports the live training chapters that already contain a published problem', async () => {
        trainingDocs.push({
            domainId: 'system',
            docId: new ObjectId('64b000000000000000000020'),
            title: 'Other training',
            dag: [{ _id: 5, title: 'Round 5', requireNids: [], pids: ['100', 101] }],
        });

        expect(await authoring.listManagedProblemTrainingPlacements('system', 100)).to.deep.equal([
            {
                trainingId: trainingId.toHexString(),
                trainingTitle: 'PAT 乙级训练',
                chapterId: 1,
                chapterTitle: '2026 春季',
            },
            {
                trainingId: '64b000000000000000000020',
                trainingTitle: 'Other training',
                chapterId: 5,
                chapterTitle: 'Round 5',
            },
        ]);
    });

    it('prepares one canonical draft with source and ancestor tags', async () => {
        const root = new ObjectId('64b000000000000000000011');
        const leaf = new ObjectId('64b000000000000000000012');
        mindmapDocs = [
            { _id: root, parentId: null, topic: '数据结构', tags: ['数据结构'] },
            { _id: leaf, parentId: root, topic: '线段树', tags: ['线段树'] },
        ];
        const prepared = await authoring.prepareManagedProblemDraft('system', {
            workingTitle: '  线段树练习  ',
            content: 'statement',
            difficulty: 4,
            sourceMeta: { template: 'pat_basic', year: 2026, season: 'spring' },
            mindmapNodeIds: [leaf.toHexString()],
        });
        expect(prepared.workingTitle).to.equal('线段树练习');
        expect(prepared.tags).to.deep.equal(['PAT乙级', '2026春', '数据结构', '线段树']);
    });

    it('normalizes a durable batch identity only at the canonical draft boundary', async () => {
        const nodeId = new ObjectId('64b000000000000000000012');
        mindmapDocs = [{ _id: nodeId, parentId: null, topic: '模拟', tags: ['模拟'] }];
        const prepared = await authoring.prepareManagedProblemDraft('system', {
            workingTitle: '批量题目',
            content: 'statement',
            difficulty: 3,
            sourceMeta: { template: 'nowcoder_summer', year: 2026, round: 1 },
            mindmapNodeIds: [nodeId.toHexString()],
            batchImport: { batchId: 'nowcoder-2026-summer-1', sourceProblemCode: 'A', fingerprint: 'A'.repeat(64) },
        });
        expect(prepared.batchImport).to.deep.equal({
            batchId: 'nowcoder-2026-summer-1',
            sourceProblemCode: 'A',
            identity: 'nowcoder-2026-summer-1:A',
            fingerprint: 'a'.repeat(64),
        });
        await expectReject(
            authoring.prepareManagedProblemDraft('system', {
                workingTitle: '批量题目',
                content: 'statement',
                difficulty: 3,
                sourceMeta: { template: 'nowcoder_summer', year: 2026, round: 1 },
                mindmapNodeIds: [nodeId.toHexString()],
                batchImport: { batchId: 'bad id', sourceProblemCode: 'A', fingerprint: 'a'.repeat(64) },
            }),
            TestValidationError,
        );
    });

    it('rejects invalid source, empty mindmap, and partial training placement at the canonical draft boundary', async () => {
        await expectReject(
            authoring.prepareManagedProblemDraft('system', {
                workingTitle: '题目',
                content: 'statement',
                difficulty: 4,
                sourceMeta: { template: 'unknown', year: 2026 },
                mindmapNodeIds: [],
            }),
            TestValidationError,
        );
        await expectReject(
            authoring.prepareManagedProblemDraft('system', {
                workingTitle: '题目',
                content: 'statement',
                difficulty: 4,
                sourceMeta: { template: 'self', year: 2026 },
                mindmapNodeIds: [],
            }),
            TestValidationError,
        );

        const nodeId = new ObjectId('64b000000000000000000012');
        mindmapDocs = [{ _id: nodeId, parentId: null, topic: '基础', tags: ['基础'] }];
        await expectReject(
            authoring.prepareManagedProblemDraft('system', {
                workingTitle: '题目',
                content: 'statement',
                difficulty: 4,
                sourceMeta: { template: 'self', year: 2026 },
                mindmapNodeIds: [nodeId.toHexString()],
                pendingTrainingPlacement: { trainingId: trainingId.toHexString(), chapterId: '' },
            }),
            TestValidationError,
        );
    });

    it('revalidates stored ObjectIds and rejects a duplicate pending training placement before publish', async () => {
        const root = new ObjectId('64b000000000000000000011');
        const leaf = new ObjectId('64b000000000000000000012');
        mindmapDocs = [
            { _id: root, parentId: null, topic: '数据结构', tags: ['数据结构'] },
            { _id: leaf, parentId: root, topic: '线段树', tags: ['线段树'] },
        ];
        const pdoc = {
            docId: 101,
            sourceMeta: { template: 'pat_basic' as const, year: 2026, season: 'spring' as const },
            managedAuthoring: {
                workingTitle: '线段树练习',
                selectedMindmapNodeIds: [leaf],
                metadataStatus: 'draft' as const,
                pendingTrainingPlacement: { trainingId, chapterId: 1 },
            },
        };
        const prepared = await authoring.prepareManagedProblemPublication('system', pdoc);
        expect(prepared.tags).to.deep.equal(['PAT乙级', '2026春', '数据结构', '线段树']);
        expect(prepared.pendingTrainingPlacement).to.deep.equal({ trainingId, chapterId: 1 });

        trainingDocs[0].dag[0].pids.push(101);
        await expectReject(authoring.prepareManagedProblemPublication('system', pdoc), TestMetadataConflictError);

        trainingDocs[0].dag[0].pids = [];
        trainingDocs[0].dag.push({ _id: 2, title: '历史章节', requireNids: [], pids: ['101'] });
        await expectReject(authoring.prepareManagedProblemPublication('system', pdoc), TestMetadataConflictError);
    });
});
