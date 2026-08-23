import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
    courseKindClause,
    isCourseKind,
    isProblemSetKind,
    practiceContainerKindOf,
    PROBLEM_SET_KIND,
    problemSetKindClause,
    resolveWritableTrainingKind,
    withProblemSetKind,
} from '../src/lib/training-kind';

(global as any).Hydro ||= { model: {} };

const trainingId = new ObjectId('68486d8165edbb11e9ec9036');
const created: any[] = [];
let stored: any = null;
let documentGetResult: any = null;
let enrollAvailable = true;
let enrollIncCalls = 0;

const trainingPath = require.resolve('../src/model/training.ts');
const documentPath = require.resolve('../src/model/document.ts');
const oplogPath = require.resolve('../src/model/oplog.ts');
const accessPath = require.resolve('../src/model/problem-access.ts');
const errorPath = require.resolve('../src/error.ts');
const builtinPath = require.resolve('../src/model/builtin.ts');

require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        TYPE_TRAINING: 40,
        async add(
            _domainId: string,
            _content: string,
            _owner: number,
            _docType: number,
            _docId: unknown,
            _parentType: unknown,
            _parentId: unknown,
            extra: any,
        ) {
            created.push(extra);
            return trainingId;
        },
        async get() {
            return documentGetResult;
        },
        async set(_domainId: string, _docType: number, _tid: unknown, $set: any) {
            created.push($set);
            return $set;
        },
        async setIfNotStatus() {
            if (!enrollAvailable) return false;
            enrollAvailable = false;
            return { enroll: 1 };
        },
        async inc() {
            enrollIncCalls += 1;
            return 1;
        },
        coll: {
            async findOne(filter: any) {
                if (!stored) return null;
                if (filter.domainId !== stored.domainId || String(filter.docId) !== String(stored.docId)) return null;
                if (filter.$or) {
                    const kind = stored.kind;
                    const matches = kind === undefined || kind === null || kind === 'training' || kind === 'problem_set';
                    if (!matches) return null;
                }
                return stored;
            },
            async updateOne() {
                return { modifiedCount: 0 };
            },
        },
    },
} as NodeModule;
require.cache[oplogPath] = {
    id: oplogPath,
    filename: oplogPath,
    loaded: true,
    exports: {
        coll: {
            async findOne() {
                return null;
            },
        },
        async add() {
            return undefined;
        },
    },
} as NodeModule;
require.cache[accessPath] = {
    id: accessPath,
    filename: accessPath,
    loaded: true,
    exports: { isProblemBankAdmin: () => true },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: {
        PermissionError: Error,
        TrainingAlreadyEnrollError: Error,
        TrainingNotFoundError: class TrainingNotFoundError extends Error {
            name = 'TrainingNotFoundError';
        },
    },
} as NodeModule;
require.cache[builtinPath] = {
    id: builtinPath,
    filename: builtinPath,
    loaded: true,
    exports: { PERM: { PERM_EDIT_PROBLEM: 1n } },
} as NodeModule;
delete require.cache[trainingPath];
const TrainingModel = require(trainingPath) as typeof import('../src/model/training');

async function expectReject(work: Promise<unknown>, name: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.have.property('name', name);
        return error;
    }
    expect.fail('expected promise to reject');
}

describe('P3.1 training kind helpers', () => {
    it('treats missing, null, training, and problem_set as problem sets', () => {
        expect(isProblemSetKind(undefined)).to.equal(true);
        expect(isProblemSetKind(null)).to.equal(true);
        expect(isProblemSetKind('training')).to.equal(true);
        expect(isProblemSetKind('problem_set')).to.equal(true);
        expect(isProblemSetKind('course')).to.equal(false);
        expect(isProblemSetKind('')).to.equal(false);
        expect(isProblemSetKind('other')).to.equal(false);
    });

    it('treats only course as a course', () => {
        expect(isCourseKind('course')).to.equal(true);
        expect(isCourseKind(undefined)).to.equal(false);
        expect(isCourseKind('training')).to.equal(false);
        expect(isCourseKind('problem_set')).to.equal(false);
    });

    it('maps known kinds to practice containers and fails closed on unknown', () => {
        expect(practiceContainerKindOf(undefined)).to.equal('problemSet');
        expect(practiceContainerKindOf('training')).to.equal('problemSet');
        expect(practiceContainerKindOf('problem_set')).to.equal('problemSet');
        expect(practiceContainerKindOf('course')).to.equal('course');
        expect(() => practiceContainerKindOf('other')).to.throw(TypeError, /unknown training document kind/);
    });

    it('writes only problem_set or course and rejects legacy or unknown kinds', () => {
        expect(resolveWritableTrainingKind(undefined)).to.equal(PROBLEM_SET_KIND);
        expect(resolveWritableTrainingKind('problem_set')).to.equal('problem_set');
        expect(resolveWritableTrainingKind('course')).to.equal('course');
        expect(() => resolveWritableTrainingKind('training')).to.throw(TypeError, /cannot be written/);
        expect(() => resolveWritableTrainingKind('other')).to.throw(TypeError, /cannot be written/);
    });

    it('builds a fail-closed problem-set filter that does not use $ne:course', () => {
        expect(problemSetKindClause()).to.deep.equal({
            $or: [{ kind: { $exists: false } }, { kind: null }, { kind: { $in: ['training', 'problem_set'] } }],
        });
        expect(courseKindClause()).to.deep.equal({ kind: 'course' });
        expect(withProblemSetKind({ domainId: 'system' })).to.deep.include({
            domainId: 'system',
            $or: [{ kind: { $exists: false } }, { kind: null }, { kind: { $in: ['training', 'problem_set'] } }],
        });
        expect(withProblemSetKind({ $or: [{ owner: 1 }] })).to.deep.equal({
            $and: [problemSetKindClause(), { $or: [{ owner: 1 }] }],
        });
        expect(JSON.stringify(problemSetKindClause())).to.not.include('$ne');
    });
});

describe('P3.1 training document write and read gates', () => {
    beforeEach(() => {
        created.length = 0;
        stored = null;
        documentGetResult = null;
        enrollAvailable = true;
        enrollIncCalls = 0;
    });

    it('creates new problem sets with kind problem_set and does not backfill extra.kind:training', async () => {
        const tid = await TrainingModel.add('system', 'Set', 'body', 2, [], 'desc', 0);
        expect(tid).to.equal(trainingId);
        expect(created[0]).to.include({ title: 'Set', kind: 'problem_set' });
        expect(created[0]).to.not.have.property('kind', 'training');
    });

    it('keeps explicit course writes as course', async () => {
        await TrainingModel.add('system', 'Course', 'body', 2, [], '', 0, { kind: 'course', term: '2026秋' });
        expect(created[0]).to.include({ kind: 'course', term: '2026秋' });
    });

    it('refuses to write legacy training or unknown kinds', async () => {
        await expectReject(TrainingModel.add('system', 'Old', '', 2, [], '', 0, { kind: 'training' } as any), 'TypeError');
        await expectReject(TrainingModel.add('system', 'Weird', '', 2, [], '', 0, { kind: 'other' } as any), 'TypeError');
        expect(created).to.have.length(0);
    });

    it('reads missing kind, training, and problem_set, and fails closed on unknown kinds', async () => {
        documentGetResult = { domainId: 'system', docId: trainingId, kind: undefined, dag: [] };
        expect((await TrainingModel.get('system', trainingId)).kind).to.equal(undefined);
        documentGetResult = { domainId: 'system', docId: trainingId, kind: 'training', dag: [] };
        expect((await TrainingModel.get('system', trainingId)).kind).to.equal('training');
        documentGetResult = { domainId: 'system', docId: trainingId, kind: 'problem_set', dag: [] };
        expect((await TrainingModel.get('system', trainingId)).kind).to.equal('problem_set');
        documentGetResult = { domainId: 'system', docId: trainingId, kind: 'course', dag: [] };
        expect((await TrainingModel.get('system', trainingId)).kind).to.equal('course');
        documentGetResult = { domainId: 'system', docId: trainingId, kind: 'other', dag: [] };
        await expectReject(TrainingModel.get('system', trainingId), 'TrainingNotFoundError');
    });

    it('refuses to edit kind after create', async () => {
        expect(() => TrainingModel.edit('system', trainingId, { kind: 'course' })).to.throw(TypeError, /cannot be edited/);
        expect(() => TrainingModel.edit('system', trainingId, { title: 'ok' }, { kind: 1 } as any)).to.throw(TypeError, /cannot be edited/);
        expect(created).to.have.length(0);
        TrainingModel.edit('system', trainingId, { title: 'ok' });
        expect(created[0]).to.deep.equal({ title: 'ok' });
    });

    it('does not treat a course as a problem-batch training', async () => {
        stored = {
            _id: new ObjectId(),
            domainId: 'system',
            docType: 40,
            docId: trainingId,
            title: '牛客暑期多校训练集',
            kind: 'course',
            dag: [{ _id: 1, title: 'A', requireNids: [], pids: [] }],
        };
        await expectReject(
            TrainingModel.ensureProblemBatchChapter({
                domainId: 'system',
                trainingId,
                trainingTitle: '牛客暑期多校训练集',
                chapterId: 2,
                chapterTitle: 'B',
                expectedCurrentMaxChapterId: 1,
                batchId: 'batch',
                user: { _id: 2 } as any,
            }),
            'Error',
        );
    });

    it('creates a learning record once and treats a repeat enroll as already present', async () => {
        expect(await TrainingModel.ensureEnrolled('system', trainingId, 42)).to.equal(true);
        expect(enrollIncCalls).to.equal(1);
        expect(await TrainingModel.ensureEnrolled('system', trainingId, 42)).to.equal(false);
        expect(enrollIncCalls).to.equal(1);
        await expectReject(TrainingModel.enroll('system', trainingId, 42), 'Error');
        expect(enrollIncCalls).to.equal(1);
    });
});
