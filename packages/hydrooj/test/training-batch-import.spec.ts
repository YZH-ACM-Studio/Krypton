import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

(global as any).Hydro ||= { model: {} };

class TestPermissionError extends Error {}

const trainingId = new ObjectId('68486d8165edbb11e9ec9036');
let training: any;
const oplogs: any[] = [];
let updateCalls = 0;
let failNextAudit = false;

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
        coll: {
            async findOne(filter: any) {
                if (filter.domainId !== training.domainId || String(filter.docId) !== String(training.docId)) return null;
                return training;
            },
            async updateOne(filter: any, update: any) {
                updateCalls++;
                if (filter.dag !== training.dag || filter.title !== training.title) return { modifiedCount: 0 };
                training.dag.unshift(...update.$push.dag.$each);
                return { modifiedCount: 1 };
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
            async findOne(filter: any) {
                return oplogs.find((entry) => Object.entries(filter).every(([key, value]) => entry[key] === value)) || null;
            },
        },
        async add(entry: any) {
            if (failNextAudit) {
                failNextAudit = false;
                throw new Error('fixture chapter audit failed');
            }
            oplogs.push(entry);
        },
    },
} as NodeModule;
require.cache[accessPath] = {
    id: accessPath,
    filename: accessPath,
    loaded: true,
    exports: { isProblemBankAdmin: (user: any) => user?._id === 2 },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: {
        PermissionError: TestPermissionError,
        TrainingAlreadyEnrollError: Error,
        TrainingNotFoundError: Error,
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

function input(overrides: Record<string, unknown> = {}) {
    return {
        domainId: 'system',
        trainingId,
        trainingTitle: '牛客暑期多校训练集',
        chapterId: 40,
        chapterTitle: '2026年牛客-第1场',
        expectedCurrentMaxChapterId: 39,
        batchId: '2026-nowcoder-summer-multi-1',
        user: { _id: 2 } as any,
        ...overrides,
    };
}

async function expectReject(work: Promise<unknown>, message: string | (new (...args: any[]) => Error)) {
    try {
        await work;
    } catch (error) {
        if (typeof message === 'string') expect(error).to.have.property('message').that.includes(message);
        else expect(error).to.be.instanceOf(message);
        return;
    }
    expect.fail('expected promise to reject');
}

beforeEach(() => {
    training = {
        _id: new ObjectId('68486d8165edbb11e9ec9000'),
        domainId: 'system',
        docType: 40,
        docId: trainingId,
        title: '牛客暑期多校训练集',
        dag: [
            { _id: 39, title: '2025年牛客-第10场', requireNids: [], pids: [1] },
            { _id: 2, title: '历史章节', requireNids: [], pids: [2] },
        ],
    };
    oplogs.length = 0;
    updateCalls = 0;
    failNextAudit = false;
});

describe('P2.23 canonical training chapter boundary', () => {
    it('creates only max+1 at the front with one CAS and audit record', async () => {
        const result = await TrainingModel.ensureProblemBatchChapter(input());

        expect(result).to.deep.equal({ chapterId: 40, created: true });
        expect(training.dag[0]).to.deep.equal({ _id: 40, title: '2026年牛客-第1场', requireNids: [], pids: [] });
        expect(updateCalls).to.equal(1);
        expect(oplogs).to.have.length(1);
        expect(oplogs[0]).to.include({
            type: 'training.chapter.batch-import',
            operator: 2,
            chapterId: 40,
            batchId: '2026-nowcoder-summer-multi-1',
            requestId: `problem-batch:2026-nowcoder-summer-multi-1:training:${trainingId}:chapter:40`,
            result: 'success',
        });
    });

    it('resumes an exact existing first chapter without writing it again', async () => {
        training.dag.unshift({ _id: 40, title: '2026年牛客-第1场', requireNids: [], pids: [3000] });
        await TrainingModel.ensureProblemBatchChapter(input());
        updateCalls = 0;
        const result = await TrainingModel.ensureProblemBatchChapter(input());

        expect(result).to.deep.equal({ chapterId: 40, created: false });
        expect(updateCalls).to.equal(0);
        expect(oplogs).to.have.length(1);
    });

    it('fills the stable audit on retry after the chapter write succeeded', async () => {
        failNextAudit = true;
        await expectReject(TrainingModel.ensureProblemBatchChapter(input()), 'fixture chapter audit failed');
        expect(training.dag[0]).to.deep.equal({ _id: 40, title: '2026年牛客-第1场', requireNids: [], pids: [] });
        expect(oplogs).to.deep.equal([]);

        const result = await TrainingModel.ensureProblemBatchChapter(input());
        expect(result).to.deep.equal({ chapterId: 40, created: false });
        expect(updateCalls).to.equal(1);
        expect(oplogs).to.have.length(1);
        await TrainingModel.assertProblemBatchChapterAudit({
            domainId: 'system',
            trainingId,
            chapterId: 40,
            chapterTitle: '2026年牛客-第1场',
            batchId: '2026-nowcoder-summer-multi-1',
            actor: 2,
        });
    });

    it('fails closed on authorization, counter drift, and ID/title conflicts', async () => {
        await expectReject(TrainingModel.ensureProblemBatchChapter(input({ user: { _id: 9 } })), TestPermissionError);
        await expectReject(TrainingModel.ensureProblemBatchChapter(input({ expectedCurrentMaxChapterId: 38 })), 'chapter counter changed');
        training.dag.unshift({ _id: 40, title: 'conflicting title', requireNids: [], pids: [] });
        await expectReject(TrainingModel.ensureProblemBatchChapter(input()), 'chapter identity conflicts');
    });
});
