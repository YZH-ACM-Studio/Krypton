import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const systemStudentId = new ObjectId();
const outerStudentId = new ObjectId();
const missingStudentId = new ObjectId();
const studentQueries: any[] = [];
const personReads: any[] = [];
const personInserts: any[] = [];

const students = [
    { _id: systemStudentId, domainId: 'system', studentId: '20230001' },
    { _id: outerStudentId, domainId: 'owned-course', studentId: '20239999' },
];

const studentsColl = {
    async findOne(filter: any) {
        studentQueries.push(filter);
        return (
            students.find(
                (student) => String(student._id) === String(filter._id) && (filter.domainId === undefined || student.domainId === filter.domainId),
            ) || null
        );
    },
};

const peopleColl = {
    async findOne(filter: any) {
        personReads.push(filter);
        return null;
    },
    async insertOne(doc: any) {
        personInserts.push(doc);
        return { insertedId: doc._id };
    },
};

const dbStub = {
    awardTypesColl: {},
    importBatchesColl: {},
    peopleColl,
    async seedAwardTypesIfEmpty() {
        return undefined;
    },
    async getConfig() {
        return { baseScore: 100, decayFactor: 0.5 };
    },
    async setConfig() {
        return undefined;
    },
};

const hydroojStub = {
    ...framework,
    ObjectId,
    UserModel: {},
    db: {
        collection(name: string) {
            if (name === 'userbind.students') return studentsColl;
            return {};
        },
    },
};

const modelPath = require.resolve('../src/model.ts');
const dbPath = require.resolve('../src/db.ts');
const previousDbCache = require.cache[dbPath];
const originalLoad = Module._load;
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    return originalLoad.call(this, request, parent, isMain);
};

let createPerson: (input: { studentDocId: any; createdBy: number }) => Promise<any>;
try {
    ({ createPerson } = require(modelPath));
} finally {
    Module._load = originalLoad;
    if (previousDbCache) require.cache[dbPath] = previousDbCache;
    else delete require.cache[dbPath];
}

beforeEach(() => {
    studentQueries.length = 0;
    personReads.length = 0;
    personInserts.length = 0;
});

async function captureFailure(studentDocId: any) {
    try {
        await createPerson({ studentDocId, createdBy: 42 });
        return null;
    } catch (error) {
        return error as any;
    }
}

describe('rankboard person system-domain invariant', () => {
    it('rejects outer-domain and missing student ids identically before touching people', async () => {
        const outerError = await captureFailure(outerStudentId);
        const missingError = await captureFailure(missingStudentId);

        expect(outerError?.name).to.equal('NotFoundError');
        expect(missingError?.name).to.equal('NotFoundError');
        expect(outerError?.code).to.equal(missingError?.code);
        expect(personReads).to.have.lengthOf(0);
        expect(personInserts).to.have.lengthOf(0);
        expect(studentQueries).to.deep.equal([
            { _id: outerStudentId, domainId: 'system' },
            { _id: missingStudentId, domainId: 'system' },
        ]);
    });

    it('creates a person only after resolving the student in the system domain', async () => {
        const person = await createPerson({ studentDocId: systemStudentId, createdBy: 42 });

        expect(studentQueries).to.deep.equal([{ _id: systemStudentId, domainId: 'system' }]);
        expect(personReads).to.deep.equal([{ studentDocId: systemStudentId }]);
        expect(personInserts).to.have.lengthOf(1);
        expect(String(person.studentDocId)).to.equal(String(systemStudentId));
    });
});
