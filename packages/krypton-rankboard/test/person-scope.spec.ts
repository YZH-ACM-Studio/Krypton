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
const systemPersonId = new ObjectId();
const outerPersonId = new ObjectId();
const missingPersonId = new ObjectId();
const batchId = new ObjectId();

const award = {
    type: 'ladder_team_gold',
    contest: '2026 年天梯赛',
    date: '2026-04',
    team: '测试队',
    imageUrls: ['/file/42/award.jpg'],
};
const people = [
    { _id: systemPersonId, studentDocId: systemStudentId, awards: [{ ...award }], updatedAt: new Date(), createdAt: new Date(), createdBy: 1 },
    { _id: outerPersonId, studentDocId: outerStudentId, awards: [{ ...award }], updatedAt: new Date(), createdAt: new Date(), createdBy: 1 },
    { _id: missingPersonId, studentDocId: missingStudentId, awards: [{ ...award }], updatedAt: new Date(), createdAt: new Date(), createdBy: 1 },
];
const students = [
    {
        _id: systemStudentId,
        domainId: 'system',
        studentId: '20230001',
        realName: '系统学生',
        schoolId: new ObjectId(),
        groupIds: [],
        boundUserId: null,
    },
    {
        _id: outerStudentId,
        domainId: 'owned-course',
        studentId: '20239999',
        realName: '外域学生',
        schoolId: new ObjectId(),
        groupIds: [],
        boundUserId: null,
    },
];

const studentFindQueries: any[] = [];
const studentFindOneQueries: any[] = [];
const peopleUpdates: any[] = [];
const peopleDeletes: any[] = [];
const peopleUpdateMany: any[] = [];
const batchUpdates: any[] = [];

function idIn(value: any, candidates: any[]) {
    return candidates.some((candidate) => String(candidate) === String(value));
}

function personMatches(person: any, filter: any) {
    if (filter?._id && !filter._id.$in && String(person._id) !== String(filter._id)) return false;
    if (filter?._id?.$in && !idIn(person._id, filter._id.$in)) return false;
    if (filter?.studentDocId && String(person.studentDocId) !== String(filter.studentDocId)) return false;
    if (filter?.['awards.importBatchId']) {
        return person.awards.some((item: any) => String(item.importBatchId) === String(filter['awards.importBatchId']));
    }
    return true;
}

const studentsColl = {
    async findOne(filter: any) {
        studentFindOneQueries.push(filter);
        return students.find((student) => (
            String(student._id) === String(filter._id)
            && (filter.domainId === undefined || student.domainId === filter.domainId)
        )) || null;
    },
    find(filter: any) {
        studentFindQueries.push(filter);
        return {
            async toArray() {
                return students.filter((student) => (
                    idIn(student._id, filter._id?.$in || [])
                    && (filter.domainId === undefined || student.domainId === filter.domainId)
                ));
            },
        };
    },
};

const peopleColl = {
    find(filter: any) {
        const docs = people.filter((person) => personMatches(person, filter));
        return {
            sort() { return this; },
            async toArray() { return docs; },
        };
    },
    async findOne(filter: any) {
        return people.find((person) => personMatches(person, filter)) || null;
    },
    async updateOne(filter: any, update: any) {
        peopleUpdates.push({ filter, update });
        return { matchedCount: people.some((person) => personMatches(person, filter)) ? 1 : 0 };
    },
    async deleteOne(filter: any) {
        peopleDeletes.push(filter);
        return { deletedCount: people.some((person) => personMatches(person, filter)) ? 1 : 0 };
    },
    async updateMany(filter: any, update: any) {
        peopleUpdateMany.push({ filter, update });
        return { modifiedCount: people.filter((person) => personMatches(person, filter)).length };
    },
    async insertOne() { throw new Error('unexpected insert'); },
};

const awardTypesColl = {
    find() {
        return {
            sort() { return this; },
            async toArray() {
                return [{
                    _id: new ObjectId(),
                    key: 'ladder_team_gold',
                    name: '天梯赛团队金奖',
                    weight: 1,
                    useRankDecay: false,
                    hidden: false,
                    order: 1,
                    builtin: true,
                }];
            },
        };
    },
};

const importBatchesColl = {
    async findOne(filter: any) {
        return String(filter._id) === String(batchId)
            ? { _id: batchId, rolledBack: false, rolledBackAt: null }
            : null;
    },
    async updateOne(filter: any, update: any) {
        batchUpdates.push({ filter, update });
        return { matchedCount: 1 };
    },
};

const emptyCollection = {
    find() {
        return { async toArray() { return []; } };
    },
};

const dbStub = {
    awardTypesColl,
    importBatchesColl,
    peopleColl,
    async seedAwardTypesIfEmpty() { return undefined; },
    async getConfig() { return { baseScore: 100, decayFactor: 0.5 }; },
    async setConfig() { return undefined; },
};

const hydroojStub = {
    ...framework,
    ObjectId,
    UserModel: { async getList() { return {}; } },
    db: {
        collection(name: string) {
            if (name === 'userbind.students') return studentsColl;
            return emptyCollection;
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

let model: any;
try {
    model = require(modelPath);
} finally {
    Module._load = originalLoad;
    if (previousDbCache) require.cache[dbPath] = previousDbCache;
    else delete require.cache[dbPath];
}

beforeEach(() => {
    studentFindQueries.length = 0;
    studentFindOneQueries.length = 0;
    peopleUpdates.length = 0;
    peopleDeletes.length = 0;
    peopleUpdateMany.length = 0;
    batchUpdates.length = 0;
});

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as any;
    }
}

function mutationCount() {
    return peopleUpdates.length + peopleDeletes.length + peopleUpdateMany.length;
}

describe('historical rankboard person scope', () => {
    it('excludes outer-domain and missing-student people from public projections and admin reads', async () => {
        expect(await model.getPerson(systemPersonId)).to.have.property('_id', systemPersonId);
        expect(await model.getPerson(outerPersonId)).to.equal(null);
        expect(await model.getPerson(missingPersonId)).to.equal(null);

        const rows = await model.listLeaderboard();
        expect(rows.map((row: any) => String(row.person._id))).to.deep.equal([String(systemPersonId)]);

        const gallery = await model.buildGallery();
        const memberIds = gallery.years.flatMap((year: any) => [
            ...year.ladder.flatMap((card: any) => card.members.map((member: any) => member.personId)),
            ...year.icpc.flatMap((card: any) => card.members.map((member: any) => member.personId)),
        ]);
        expect(memberIds).to.deep.equal([String(systemPersonId)]);
        expect(studentFindQueries).to.satisfy((queries: any[]) => (
            queries.length >= 2 && queries.every((query) => query.domainId === 'system')
        ));
    });

    for (const [label, invoke] of [
        ['updatePerson', (id: any) => model.updatePerson(id, { employmentStatus: 'x' })],
        ['deletePerson', (id: any) => model.deletePerson(id)],
        ['addAward', (id: any) => model.addAward(id, { type: 'ladder_team_gold' })],
        ['updateAwardAt', (id: any) => model.updateAwardAt(id, 0, { type: 'ladder_team_gold' })],
        ['removeAwardAt', (id: any) => model.removeAwardAt(id, 0)],
        ['addAwardImage', (id: any) => model.addAwardImage(id, 0, '/file/42/new.jpg')],
    ] as Array<[string, (id: any) => Promise<unknown>]>) {
        it(`${label} rejects dirty people identically before mutation`, async () => {
            const outerError = await captureFailure(() => invoke(outerPersonId));
            const missingError = await captureFailure(() => invoke(missingPersonId));

            expect(outerError?.name).to.equal('NotFoundError');
            expect(missingError?.name).to.equal('NotFoundError');
            expect(outerError?.code).to.equal(missingError?.code);
            expect(mutationCount()).to.equal(0);
        });
    }

    it('keeps all person mutation helpers functional for a valid system person', async () => {
        await model.updatePerson(systemPersonId, { employmentStatus: '系统' });
        await model.deletePerson(systemPersonId);
        await model.addAward(systemPersonId, { type: 'ladder_team_gold' });
        await model.updateAwardAt(systemPersonId, 0, { type: 'ladder_team_gold' });
        await model.removeAwardAt(systemPersonId, 0);
        await model.addAwardImage(systemPersonId, 0, '/file/42/new.jpg');

        expect(peopleDeletes).to.have.lengthOf(1);
        expect(peopleUpdates.length).to.be.greaterThanOrEqual(5);
    });

    it('limits batch rollback updateMany to scoped system people', async () => {
        for (const person of people) person.awards[0].importBatchId = batchId;

        await model.rollbackImportBatch(batchId, 42);

        expect(peopleUpdateMany).to.have.lengthOf(1);
        expect(peopleUpdateMany[0].filter._id.$in.map(String)).to.deep.equal([String(systemPersonId)]);
        expect(batchUpdates).to.have.lengthOf(1);
    });
});
