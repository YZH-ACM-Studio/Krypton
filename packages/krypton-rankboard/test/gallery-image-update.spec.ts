import { createRequire } from 'node:module';
import { expect } from 'chai';
import { after, before, beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { MongoClient, ObjectId } = requireFromFramework('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

describe('rankboard gallery image persistence', () => {
    let memoryServer: any;
    let client: any;
    let database: any;
    let rawPeopleColl: any;
    let peopleColl: any;
    let studentsColl: any;
    let model: any;
    let personId: any;
    let studentId: any;
    let beforeCoverWrite: (() => Promise<void>) | null;

    before(
        async () => {
            memoryServer = await MongoMemoryServer.create();
            client = new MongoClient(memoryServer.getUri());
            await client.connect();
            database = client.db('rankboard_gallery_test');
            rawPeopleColl = database.collection('rankboard.people');
            peopleColl = {
                deleteMany: (...args: any[]) => rawPeopleColl.deleteMany(...args),
                find: (...args: any[]) => rawPeopleColl.find(...args),
                findOne: (...args: any[]) => rawPeopleColl.findOne(...args),
                insertOne: (...args: any[]) => rawPeopleColl.insertOne(...args),
                updateOne: async (...args: any[]) => {
                    const update = args[1];
                    const writesCover = Object.keys(update?.$set || {}).some((path) => path.endsWith('.coverIndex'));
                    if (writesCover && beforeCoverWrite) {
                        const hook = beforeCoverWrite;
                        beforeCoverWrite = null;
                        await hook();
                    }
                    return rawPeopleColl.updateOne(...args);
                },
            };
            studentsColl = database.collection('userbind.students');

            const dbStub = {
                awardTypesColl: database.collection('rankboard.award_types'),
                importBatchesColl: database.collection('rankboard.import_batches'),
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
                UserModel: {
                    async getList() {
                        return {};
                    },
                },
                db: {
                    collection(name: string) {
                        return database.collection(name);
                    },
                },
            };

            const modelPath = require.resolve('../src/model.ts');
            const dbPath = require.resolve('../src/db.ts');
            const previousModelCache = require.cache[modelPath];
            const previousDbCache = require.cache[dbPath];
            const originalLoad = Module._load;
            delete require.cache[modelPath];
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
            try {
                model = require(modelPath);
            } finally {
                Module._load = originalLoad;
                if (previousModelCache) require.cache[modelPath] = previousModelCache;
                else delete require.cache[modelPath];
                if (previousDbCache) require.cache[dbPath] = previousDbCache;
                else delete require.cache[dbPath];
            }
        },
        { timeout: 60000 },
    );

    after(async () => {
        await client?.close();
        await memoryServer?.stop();
    });

    beforeEach(async () => {
        beforeCoverWrite = null;
        await Promise.all([peopleColl.deleteMany({}), studentsColl.deleteMany({})]);
        personId = new ObjectId();
        studentId = new ObjectId();
        await studentsColl.insertOne({
            _id: studentId,
            domainId: 'system',
            studentId: '20230001',
            realName: '测试学生',
        });
        await peopleColl.insertOne({
            _id: personId,
            studentDocId: studentId,
            awards: [
                { type: 'ladder_team_gold', imageUrls: null },
                { type: 'icpc_silver', imageUrls: ['/file/2/existing.jpg'] },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 2,
        });
    });

    async function replaceGalleryWithTeam(team: string, type: string, liveRanks: unknown[]): Promise<void> {
        await Promise.all([peopleColl.deleteMany({}), studentsColl.deleteMany({})]);
        for (const [index, liveRank] of liveRanks.entries()) {
            const memberStudentId = new ObjectId();
            await studentsColl.insertOne({
                _id: memberStudentId,
                domainId: 'system',
                studentId: `2026${String(index + 1).padStart(4, '0')}`,
                realName: `成员${index + 1}`,
            });
            await peopleColl.insertOne({
                _id: new ObjectId(),
                studentDocId: memberStudentId,
                awards: [
                    {
                        type,
                        contest: `2026 ${team} 测试站`,
                        date: '2026-11',
                        team,
                        ...(liveRank === undefined ? {} : { liveRank }),
                    },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: 2,
            });
        }
    }

    it('persists a first image on exactly the selected award', async () => {
        const url = '/file/2/new.jpg?noDisposition=1';
        const imageUrls = await model.addAwardImage(personId, 0, url, true, 'ladder_team_gold');
        const persisted = await peopleColl.findOne({ _id: personId });

        expect(imageUrls).to.deep.equal([url]);
        expect(persisted.awards[0].imageUrls).to.deep.equal([url]);
        expect(persisted.awards[0].coverIndex).to.equal(0);
        expect(persisted.awards[0]).not.to.have.property('0');
        expect(persisted.awards[1]).not.to.have.property('0');
        expect(persisted.awards[1].imageUrls).to.deep.equal(['/file/2/existing.jpg']);
    });

    it('appends and replaces images without changing sibling awards', async () => {
        const appended = '/file/2/appended.jpg?noDisposition=1';
        expect(await model.addAwardImage(personId, 1, appended, false, 'icpc_silver')).to.deep.equal(['/file/2/existing.jpg', appended]);

        const replacement = '/file/2/replacement.jpg?noDisposition=1';
        expect(await model.addAwardImage(personId, 1, replacement, false, 'icpc_silver', true)).to.deep.equal([replacement]);
        const persisted = await peopleColl.findOne({ _id: personId });
        expect(persisted.awards[0].imageUrls).to.equal(null);
        expect(persisted.awards[1].imageUrls).to.deep.equal([replacement]);
        expect(persisted.awards[1].coverIndex).to.equal(0);
    });

    it('rejects a stale cover write instead of corrupting a concurrent replacement', async () => {
        const appended = '/file/2/appended.jpg?noDisposition=1';
        const concurrent = '/file/2/concurrent.jpg?noDisposition=1';
        beforeCoverWrite = async () => {
            await rawPeopleColl.updateOne(
                { _id: personId },
                {
                    $set: {
                        'awards.1.imageUrls': [concurrent],
                        'awards.1.coverIndex': 0,
                    },
                },
            );
        };

        let failure: any = null;
        try {
            await model.addAwardImage(personId, 1, appended, true, 'icpc_silver');
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(Error);
        expect(failure.message).to.include('cover write failed');
        const persisted = await rawPeopleColl.findOne({ _id: personId });
        expect(persisted.awards[1].imageUrls).to.deep.equal([concurrent]);
        expect(persisted.awards[1].coverIndex).to.equal(0);
    });

    it('publishes a confirmed ICPC team rank when every grouped member has the same live rank', async () => {
        await replaceGalleryWithTeam('一致队', 'icpc_gold', [42, 42, 42]);

        const gallery = await model.buildGallery();
        const card = gallery.years[0].icpc[0];

        expect(card.team).to.equal('一致队');
        expect(card.teamRank).to.equal(42);
        expect(card.teamRankStatus).to.equal('confirmed');
    });

    it('publishes a missing ICPC team rank instead of using a populated member as fallback', async () => {
        for (const missingRank of [undefined, null]) {
            await replaceGalleryWithTeam('缺失队', 'icpc_silver', [17, missingRank, 17]);
            const gallery = await model.buildGallery();
            const card = gallery.years[0].icpc[0];

            expect(card.team).to.equal('缺失队');
            expect(card.teamRank).to.equal(null);
            expect(card.teamRankStatus).to.equal('missing');
        }
    });

    it('keeps ICPC team-rank conflicts above missing data for every member order', async () => {
        const rankOrders = [
            [9, 12, undefined],
            [9, undefined, 12],
            [12, 9, undefined],
            [12, undefined, 9],
            [undefined, 9, 12],
            [undefined, 12, 9],
        ];
        for (const liveRanks of rankOrders) {
            await replaceGalleryWithTeam('冲突队', 'ccpc_bronze', liveRanks);
            const gallery = await model.buildGallery();
            const card = gallery.years[0].icpc[0];

            expect(card.team).to.equal('冲突队');
            expect(card.teamRank).to.equal(null);
            expect(card.teamRankStatus).to.equal('conflict');
        }
    });

    it('publishes each invalid non-empty ICPC team rank as a conflict', async () => {
        for (const [index, invalidRank] of [0, -1, 1.5, '9', '', Number.NaN].entries()) {
            const team = `脏值队${index}`;
            await replaceGalleryWithTeam(team, 'icpc_bronze', [invalidRank]);
            const gallery = await model.buildGallery();
            const card = gallery.years[0].icpc[0];

            expect(card.team).to.equal(team);
            expect(card.teamRank).to.equal(null);
            expect(card.teamRankStatus).to.equal('conflict');
        }
    });

    it('does not add ICPC team-rank state to ladder cards', async () => {
        const gallery = await model.buildGallery();
        const card = gallery.years[0].ladder[0];

        expect(card).not.to.have.property('teamRank');
        expect(card).not.to.have.property('teamRankStatus');
    });
});
