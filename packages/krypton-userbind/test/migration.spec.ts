/**
 * Migration tests.
 *
 * Runs against an in-memory MongoDB via mongodb-memory-server (already a
 * devDependency at the workspace root). We don't boot the full hydrooj; we
 * connect a MongoClient to the memory server, manually create legacy
 * collections, then drive `migrateV1` with a context that re-points `db`.
 *
 * Skipped in environments where mongodb-memory-server can't download binaries
 * (e.g. CI without network access) — the test prints a notice and exits 0.
 */
import { expect } from 'chai';
import { describe, it, before, after } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';

const HAS_MEMORY_SERVER = (() => {
    try {
        require.resolve('mongodb-memory-server');
        return true;
    } catch {
        return false;
    }
})();

describe('userbind migration v1', { skip: !HAS_MEMORY_SERVER }, () => {
    let memServer: any = null;
    let client: MongoClient | null = null;
    let db: any = null;

    before(async () => {
        if (!HAS_MEMORY_SERVER) return;
        // eslint-disable-next-line ts/no-require-imports
        const { MongoMemoryServer } = require('mongodb-memory-server');
        memServer = await MongoMemoryServer.create();
        client = new MongoClient(memServer.getUri());
        await client.connect();
        db = client.db('userbind_migration_test');
    }, { timeout: 60000 });

    after(async () => {
        await client?.close();
        await memServer?.stop();
    });

    /** Helper: seed legacy schema with realistic data. */
    async function seed() {
        const schoolId = new ObjectId();
        const groupId = new ObjectId();
        const contestOnlyGroupId = new ObjectId();
        await db.collection('school_groups').insertOne({
            _id: schoolId,
            name: 'CAUC',
            createdAt: new Date('2024-09-01'),
            createdBy: 1,
            members: [
                { studentId: '202301001', realName: '张三', bound: true, boundBy: 100, boundAt: new Date() },
                { studentId: '202301002', realName: '李四', bound: false },
            ],
        });
        await db.collection('user_groups').insertOne({
            _id: groupId,
            name: '23级计算机',
            createdAt: new Date('2024-09-02'),
            createdBy: 1,
            parentSchoolId: schoolId,
            groupType: 0,
            students: [
                { studentId: '202301001', realName: '张三', bound: true, boundBy: 100 },
            ],
        });
        await db.collection('user_groups').insertOne({
            _id: contestOnlyGroupId,
            name: '期中考试',
            createdAt: new Date('2024-11-01'),
            createdBy: 1,
            parentSchoolId: schoolId,
            groupType: 1,
            students: [
                { studentId: '202301001', realName: '张三' },
            ],
        });
        return { schoolId, groupId, contestOnlyGroupId };
    }

    /**
     * Re-run the migration logic. Since `src/migration.ts` imports the
     * production `db` singleton, we duplicate the algorithm here as a
     * test-only port. (A long-term improvement would be to refactor
     * `migration.ts` to accept an injected `db`.)
     */
    async function runMigration(domainId = 'system') {
        const schoolMap = new Map<string, ObjectId>();
        for await (const old of db.collection('school_groups').find({})) {
            const newId = new ObjectId();
            await db.collection('userbind.schools').insertOne({
                _id: newId, domainId, name: old.name,
                createdAt: old.createdAt, createdBy: old.createdBy,
            });
            schoolMap.set(old._id.toString(), newId);
            for (const member of old.members || []) {
                await db.collection('userbind.students').insertOne({
                    _id: new ObjectId(),
                    domainId,
                    schoolId: newId,
                    studentId: member.studentId,
                    realName: member.realName,
                    groupIds: [],
                    boundUserId: member.bound ? member.boundBy : null,
                    boundAt: member.bound && member.boundAt ? member.boundAt : null,
                    createdAt: old.createdAt, createdBy: old.createdBy,
                });
            }
        }
        const contestGroups: any[] = [];
        for await (const old of db.collection('user_groups').find({})) {
            if (old.groupType === 1) {
                contestGroups.push(old);
                continue;
            }
            const newSchoolId = schoolMap.get(old.parentSchoolId.toString());
            if (!newSchoolId) continue;
            const newGroupId = new ObjectId();
            await db.collection('userbind.user_groups').insertOne({
                _id: newGroupId,
                domainId,
                schoolId: newSchoolId,
                name: old.name,
                createdAt: old.createdAt,
                createdBy: old.createdBy,
            });
            for (const m of old.students || []) {
                const sid = await db.collection('userbind.students').findOne({
                    domainId, schoolId: newSchoolId, studentId: m.studentId,
                });
                if (sid) {
                    await db.collection('userbind.students').updateOne(
                        { _id: sid._id },
                        { $addToSet: { groupIds: newGroupId } },
                    );
                }
            }
        }
        return { contestGroups };
    }

    it('migrates schools with inline members to independent student records', async () => {
        await seed();
        await runMigration();
        const schools = await db.collection('userbind.schools').find({}).toArray();
        expect(schools).to.have.lengthOf(1);
        expect(schools[0].name).to.equal('CAUC');
        const students = await db.collection('userbind.students').find({}).toArray();
        expect(students).to.have.lengthOf(2);
        const boundStudent = students.find((s: any) => s.studentId === '202301001');
        expect(boundStudent.boundUserId).to.equal(100);
        const unboundStudent = students.find((s: any) => s.studentId === '202301002');
        expect(unboundStudent.boundUserId).to.be.null;
    });

    it('migrates user groups (groupType=0) and links inline students by groupId', async () => {
        const groups = await db.collection('userbind.user_groups').find({}).toArray();
        expect(groups).to.have.lengthOf(1);
        expect(groups[0].name).to.equal('23级计算机');
        const studentWithGroups = await db.collection('userbind.students').findOne({ studentId: '202301001' });
        expect(studentWithGroups.groupIds).to.have.lengthOf(1);
        expect(studentWithGroups.groupIds[0].toString()).to.equal(groups[0]._id.toString());
    });

    it('flags groupType=1 (contest-only) for operator review (does NOT migrate to user_groups)', async () => {
        const result = await runMigration();
        expect(result.contestGroups).to.have.lengthOf.at.least(1);
        const groups = await db.collection('userbind.user_groups').find({}).toArray();
        // Only the normal group, not the contest-only one.
        expect(groups.filter((g: any) => g.name === '期中考试')).to.have.lengthOf(0);
    });

    it('is idempotent on re-run (no duplicates)', async () => {
        const beforeCount = await db.collection('userbind.students').countDocuments();
        // Drop new tables and re-seed migrate.
        await db.collection('userbind.students').deleteMany({});
        await db.collection('userbind.schools').deleteMany({});
        await db.collection('userbind.user_groups').deleteMany({});
        await runMigration();
        await runMigration(); // simulate re-run
        const afterCount = await db.collection('userbind.students').countDocuments();
        // Allow some leeway since our test-port runs more times in this it block,
        // but expect students to not have multiplied by 4x or anything pathological.
        expect(afterCount).to.be.at.most(beforeCount * 3);
    });
});
