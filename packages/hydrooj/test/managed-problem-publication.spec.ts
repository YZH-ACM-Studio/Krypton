import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import type { ManagedProblemPublicationCommit } from '../src/model/managed-problem-publication';

class TestMetadataConflictError extends Error {
    name = 'ManagedProblemMetadataConflictError';
}

let topology = 'Single';
let problemDoc: any;
let trainingDoc: any;
let casMode: 'success' | 'null' | 'throw-after-write' = 'success';
let attachMode: 'success' | 'throw-after-write' = 'success';
let pullMode: 'success' | 'throw' = 'success';
let endSessionMode: 'success' | 'throw' = 'success';
let trainingReadFailures = 0;
const calls = {
    updates: [] as any[],
    problemUpdates: [] as any[],
    problemReads: [] as any[],
    sessions: [] as any[],
};

const documentColl = {
    async updateOne(filter: any, update: any, options?: any) {
        calls.updates.push({ filter, update, options });
        const chapter = trainingDoc?.dag?.find((candidate: any) => candidate._id === filter.dag?.$elemMatch?._id);
        if (update.$addToSet) {
            const duplicateInTraining = trainingDoc?.dag?.some((candidate: any) =>
                candidate.pids.map(Number).includes(update.$addToSet['dag.$.pids']),
            );
            if (!chapter || duplicateInTraining) return { matchedCount: 0, modifiedCount: 0 };
            chapter.pids.push(update.$addToSet['dag.$.pids']);
            if (attachMode === 'throw-after-write') throw new Error('training attach response lost');
            return { matchedCount: 1, modifiedCount: 1 };
        }
        if (pullMode === 'throw') throw new Error('pull failed');
        const values = update.$pull['dag.$.pids'].$in;
        if (!chapter || !chapter.pids.some((pid: number | string) => values.includes(pid))) {
            return { matchedCount: chapter ? 1 : 0, modifiedCount: 0 };
        }
        chapter.pids = chapter.pids.filter((pid: number | string) => !values.includes(pid));
        return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filter: any, update: any, options: any) {
        calls.problemUpdates.push({ filter, update, options });
        if (filter['aclWriteClaim.operation'] !== problemDoc?.aclWriteClaim?.operation) return null;
        if (filter.structureRevision !== problemDoc?.structureRevision || problemDoc?.structureLockedAt) return null;
        if (casMode === 'null') return null;
        Object.assign(problemDoc, update.$set);
        if (casMode === 'throw-after-write') throw new Error('problem update response lost');
        return { ...problemDoc };
    },
    async findOne(filter: any) {
        if (filter.docType === 40) {
            if (trainingReadFailures) {
                trainingReadFailures--;
                throw new Error('training confirmation read failed');
            }
            return trainingDoc ? { ...trainingDoc, dag: trainingDoc.dag.map((chapter: any) => ({ ...chapter, pids: [...chapter.pids] })) } : null;
        }
        calls.problemReads.push(filter);
        const expectedAt = filter['managedAuthoring.approvedAt'];
        if (
            problemDoc?.hidden === filter.hidden &&
            problemDoc.managedAuthoring?.metadataStatus === 'confirmed' &&
            problemDoc.managedAuthoring?.approvedAt?.getTime() === expectedAt?.getTime() &&
            filter.structureRevision === problemDoc.structureRevision &&
            filter['aclWriteClaim.operation'] === problemDoc.aclWriteClaim?.operation
        ) {
            return { ...problemDoc };
        }
        return null;
    },
};

const session = {
    async withTransaction(work: () => Promise<void>) {
        await work();
    },
    async endSession() {
        if (endSessionMode === 'throw') throw new Error('session finalization failed');
        return undefined;
    },
};

const dbStub = {
    client: {
        topology: {
            description: {
                get type() {
                    return topology;
                },
            },
        },
        startSession() {
            calls.sessions.push(session);
            return session;
        },
    },
};

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const errorPath = require.resolve('../src/error.ts');
const modulePath = require.resolve('../src/model/managed-problem-publication.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: dbStub },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_PROBLEM: 10, TYPE_TRAINING: 40, coll: documentColl },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { ManagedProblemMetadataConflictError: TestMetadataConflictError },
} as NodeModule;
delete require.cache[modulePath];

const publication = require(modulePath) as typeof import('../src/model/managed-problem-publication');

function input(withTraining = false): ManagedProblemPublicationCommit {
    const approvedAt = new Date('2026-07-13T10:00:00.000Z');
    const knowledgeMapId = new ObjectId('64a000000000000000000001');
    const knowledgeNodeId = new ObjectId('64b000000000000000000011');
    return {
        domainId: 'system',
        docId: 101,
        claim: { requestId: 'publish-101', actor: 1, operation: 'managed-review-publish', capability: 'publish' },
        title: '正式标题',
        difficulty: 4,
        tags: ['PAT乙级', '2026春', '数据结构'],
        knowledgeMapId,
        knowledgeNodeIds: [knowledgeNodeId],
        sourceMeta: { template: 'pat_basic', year: 2026, season: 'spring' },
        managedAuthoring: {
            workingTitle: '工作标题',
            selectedMindmapNodeIds: [knowledgeNodeId],
            metadataStatus: 'confirmed',
            approvedBy: 1,
            approvedAt,
        },
        expectedMetadataStatus: 'draft',
        expectedStructureRevision: 1,
        ...(withTraining ? { pendingTrainingPlacement: { trainingId: trainingDoc.docId, chapterId: 1 } } : {}),
    };
}

async function captureFailure(work: Promise<unknown>) {
    try {
        await work;
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    topology = 'Single';
    casMode = 'success';
    attachMode = 'success';
    pullMode = 'success';
    endSessionMode = 'success';
    trainingReadFailures = 0;
    problemDoc = {
        domainId: 'system',
        docType: 10,
        docId: 101,
        problemKind: 'programming',
        authoringMode: 'managed',
        hidden: true,
        structureRevision: 1,
        managedAuthoring: { workingTitle: '工作标题', metadataStatus: 'draft' },
        aclWriteClaim: {
            requestId: 'publish-101',
            actor: 1,
            operation: 'managed-review-publish',
            capability: 'publish',
            state: 'active',
        },
    };
    trainingDoc = {
        domainId: 'system',
        docType: 40,
        docId: new ObjectId('64b000000000000000000020'),
        kind: 'training',
        dag: [{ _id: 1, title: '2026 春', pids: [] }],
    };
    calls.updates.length = 0;
    calls.problemUpdates.length = 0;
    calls.problemReads.length = 0;
    calls.sessions.length = 0;
});

describe('P2.14 managed problem publication persistence', () => {
    it('publishes one standalone draft without touching training when no placement was selected', async () => {
        const result = await publication.commitManagedProblemPublication(input());
        expect(result).to.include({ hidden: false, title: '正式标题', difficulty: 4 });
        expect(calls.problemUpdates[0].filter['aclWriteClaim.operation']).to.equal('managed-review-publish');
        expect(calls.updates).to.have.lengthOf(0);
        expect(calls.sessions).to.have.lengthOf(0);
    });

    it('can confirm a managed problem while intentionally keeping it hidden', async () => {
        const request = input();
        request.finalHidden = true;

        const result = await publication.commitManagedProblemPublication(request);

        expect(result).to.include({ hidden: true, title: '正式标题', difficulty: 4 });
        expect(result.managedAuthoring.metadataStatus).to.equal('confirmed');
        expect(calls.problemUpdates[0].update.$set.hidden).to.equal(true);
    });

    it('does not open a transaction for a problem-only publish even when Mongo supports transactions', async () => {
        topology = 'ReplicaSetWithPrimary';

        const result = await publication.commitManagedProblemPublication(input());

        expect(result.hidden).to.equal(false);
        expect(calls.sessions).to.have.lengthOf(0);
        expect(calls.problemUpdates[0].options.session).to.equal(undefined);
    });

    it('rejects a publish-capability claim from another operation before any persistence', async () => {
        const request = input();
        request.claim.operation = 'managed-draft-author-assignment';

        const error = await captureFailure(publication.commitManagedProblemPublication(request));

        expect(error).to.be.instanceOf(TypeError);
        expect(error?.message).to.include('managed-review-publish');
        expect(problemDoc.hidden).to.equal(true);
        expect(calls.updates).to.have.lengthOf(0);
        expect(calls.problemUpdates).to.have.lengthOf(0);
        expect(calls.problemReads).to.have.lengthOf(0);
    });

    it('re-publishes a confirmed managed problem hidden by a later lifecycle action through the same CAS', async () => {
        problemDoc.managedAuthoring.metadataStatus = 'confirmed';
        const request = input();
        request.expectedMetadataStatus = 'confirmed';
        const result = await publication.commitManagedProblemPublication(request);
        expect(result).to.include({ hidden: false, title: '正式标题' });
        expect(calls.problemUpdates[0].update.$set.managedAuthoring.metadataStatus).to.equal('confirmed');
    });

    it('keeps the draft hidden when its structure revision changes before the publication CAS', async () => {
        problemDoc.structureRevision = 2;
        const error = await captureFailure(publication.commitManagedProblemPublication(input()));
        expect(error?.message).to.include('managed publication CAS failed');
        expect(problemDoc.hidden).to.equal(true);
        expect(calls.problemUpdates[0].filter.structureRevision).to.equal(1);
        expect(calls.problemUpdates[0].filter.structureLockedAt).to.deep.equal({ $exists: false });
    });

    it('adds the problem to one chapter exactly once before the standalone publication CAS', async () => {
        const result = await publication.commitManagedProblemPublication(input(true));
        expect(result.hidden).to.equal(false);
        expect(trainingDoc.dag[0].pids).to.deep.equal([101]);
        expect(calls.updates[0].update).to.deep.equal({ $addToSet: { 'dag.$.pids': 101 } });
    });

    it('pulls only its own newly added problem when the standalone publication CAS fails', async () => {
        casMode = 'null';
        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));
        expect(error?.message).to.include('managed publication CAS failed');
        expect(problemDoc.hidden).to.equal(true);
        expect(trainingDoc.dag[0].pids).to.deep.equal([]);
        expect(calls.updates.at(-1).update).to.deep.equal({ $pull: { 'dag.$.pids': { $in: [101, '101'] } } });
    });

    it('rejects a duplicate training placement without publishing or deleting the existing member', async () => {
        trainingDoc.dag[0].pids.push(101);
        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));
        expect(error).to.be.instanceOf(TestMetadataConflictError);
        expect(problemDoc.hidden).to.equal(true);
        expect(trainingDoc.dag[0].pids).to.deep.equal([101]);
        expect(calls.problemUpdates).to.have.lengthOf(0);
    });

    it('rejects a problem already present in another chapter of the same training', async () => {
        trainingDoc.dag.push({ _id: 2, title: '历史章节', pids: ['101'] });
        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));
        expect(error).to.be.instanceOf(TestMetadataConflictError);
        expect(problemDoc.hidden).to.equal(true);
        expect(trainingDoc.dag).to.deep.equal([
            { _id: 1, title: '2026 春', pids: [] },
            { _id: 2, title: '历史章节', pids: ['101'] },
        ]);
        expect(calls.problemUpdates).to.have.lengthOf(0);
        expect(calls.updates[0].filter['dag.pids']).to.deep.equal({ $nin: [101, '101'] });
    });

    it('confirms a successful standalone CAS after its response is lost and keeps the training member', async () => {
        casMode = 'throw-after-write';
        const result = await publication.commitManagedProblemPublication(input(true));
        expect(result.hidden).to.equal(false);
        expect(calls.problemReads.at(-1)['aclWriteClaim.operation']).to.equal('managed-review-publish');
        expect(trainingDoc.dag[0].pids).to.deep.equal([101]);
        expect(calls.updates.filter((call) => call.update.$pull)).to.have.lengthOf(0);
    });

    it('removes a possibly attached member when both the add response and its first confirmation read fail', async () => {
        attachMode = 'throw-after-write';
        trainingReadFailures = 1;
        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));
        expect(error?.message).to.include('training attach outcome is unknown');
        expect(trainingDoc.dag[0].pids).to.deep.equal([]);
        expect(calls.problemUpdates).to.have.lengthOf(0);
    });

    it('uses one Mongo transaction session for the training add and final Problem CAS when supported', async () => {
        topology = 'ReplicaSetWithPrimary';
        const result = await publication.commitManagedProblemPublication(input(true));
        expect(result.hidden).to.equal(false);
        expect(calls.sessions).to.have.lengthOf(1);
        expect(calls.updates[0].options).to.deep.equal({ session });
        expect(calls.problemUpdates[0].options.session).to.equal(session);
    });

    it('returns the committed document in a typed error when session finalization fails after commit', async () => {
        topology = 'ReplicaSetWithPrimary';
        endSessionMode = 'throw';

        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));

        expect(error).to.be.instanceOf(publication.ManagedProblemPublicationCommittedError);
        expect((error as InstanceType<typeof publication.ManagedProblemPublicationCommittedError>).pdoc.hidden).to.equal(false);
        expect(problemDoc.hidden).to.equal(false);
        expect(trainingDoc.dag[0].pids).to.deep.equal([101]);
    });

    it('raises an observable 5xx-style error when bounded compensation cannot remove the member', async () => {
        casMode = 'null';
        pullMode = 'throw';
        const error = await captureFailure(publication.commitManagedProblemPublication(input(true)));
        expect(error?.message).to.include('managed publication compensation failed');
        expect(error?.message).to.include('pid=101');
        expect(error?.message).to.include('chapter=1');
        expect(trainingDoc.dag[0].pids).to.deep.equal([101]);
    });
});
