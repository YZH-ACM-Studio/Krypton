import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import {
    registerStudentDirectory,
    studentDirectory,
    StudentDirectoryUnavailableError,
    withStudentDirectory,
} from '../src/service/student-directory';

const domainId = 'system';
const schoolA = new ObjectId('66d100000000000000000001');
const schoolB = new ObjectId('66d100000000000000000002');
const groupA = new ObjectId('66d100000000000000000011');
const groupB = new ObjectId('66d100000000000000000012');

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

// The registry is module state, so these run in order: unregistered first, then one registration.
describe('StudentDirectory registry', () => {
    it('fails fast before registration and restores the unregistered state after a scoped adapter throws', async () => {
        expect(() => studentDirectory()).to.throw(StudentDirectoryUnavailableError, 'StudentDirectory is not registered (krypton-userbind not loaded)');

        const scoped = new InMemoryStudentDirectory();
        const failure = await rejection(
            withStudentDirectory(scoped, async () => {
                expect(studentDirectory()).to.equal(scoped);
                throw new Error('scoped failure');
            }),
        );
        expect(failure.message).to.equal('scoped failure');
        expect(() => studentDirectory()).to.throw(StudentDirectoryUnavailableError);
    });

    it('keeps one production adapter: the same instance is idempotent and a different one is rejected', () => {
        const production = new InMemoryStudentDirectory();
        registerStudentDirectory(production);
        registerStudentDirectory(production);
        expect(studentDirectory()).to.equal(production);

        expect(() => registerStudentDirectory(new InMemoryStudentDirectory())).to.throw('StudentDirectory is already registered with a different adapter');
        expect(studentDirectory()).to.equal(production);
    });

    it('restores the registered adapter after a scoped replacement resolves or throws', async () => {
        const production = studentDirectory();
        const scoped = new InMemoryStudentDirectory();

        expect(await withStudentDirectory(scoped, async () => studentDirectory())).to.equal(scoped);
        expect(studentDirectory()).to.equal(production);

        await rejection(
            withStudentDirectory(scoped, async () => {
                throw new Error('scoped failure');
            }),
        );
        expect(studentDirectory()).to.equal(production);
    });
});

describe('InMemoryStudentDirectory', () => {
    const directory = new InMemoryStudentDirectory({
        schools: [
            { _id: schoolA, domainId, name: 'A 校' },
            { _id: schoolB, domainId: 'other', name: 'B 校' },
        ],
        groups: [
            { _id: groupA, domainId, schoolId: schoolA, name: '一班' },
            { _id: groupB, domainId, schoolId: schoolB, name: '二班', archivedAt: null },
            { _id: new ObjectId('66d100000000000000000013'), domainId: 'other', schoolId: schoolA, name: '他域' },
        ],
        students: [
            studentRecord({ _id: new ObjectId('66d100000000000000000103'), domainId, schoolId: schoolA, studentId: '2403', realName: '王五', groupIds: [groupA], boundUserId: 43 }),
            studentRecord({ _id: new ObjectId('66d100000000000000000101'), domainId, schoolId: schoolA, studentId: '2401', realName: '张三', groupIds: [groupB, groupA], boundUserId: 42 }),
            studentRecord({ _id: new ObjectId('66d100000000000000000104'), domainId, schoolId: schoolA, studentId: '2404', realName: '赵六', groupIds: [groupA], boundUserId: null }),
            studentRecord({ _id: new ObjectId('66d100000000000000000105'), domainId, schoolId: schoolA, studentId: '2405', realName: '根用户', groupIds: [groupA], boundUserId: 1 }),
            studentRecord({ _id: new ObjectId('66d100000000000000000106'), domainId, schoolId: schoolB, studentId: '2406', realName: '二班生', groupIds: [groupB], boundUserId: 46 }),
            studentRecord({ _id: new ObjectId('66d100000000000000000107'), domainId: 'other', schoolId: schoolA, studentId: '2407', realName: '他域生', groupIds: [groupA], boundUserId: 47 }),
        ],
    });

    it('returns only students bound to a real account whose groups intersect, ordered by student id', async () => {
        const rows = await directory.findBoundStudentsByGroupIds(domainId, [groupA]);
        expect(rows.map((row) => row.studentId)).to.deep.equal(['2401', '2403']);
        expect(await directory.findBoundStudentsByGroupIds(domainId, [])).to.deep.equal([]);
    });

    it('keys bound students by string uid within the domain', async () => {
        const rows = await directory.findStudentsByUserIds(domainId, [42, 44, 47]);
        expect(Object.keys(rows)).to.deep.equal(['42']);
        expect(rows['42'].realName).to.equal('张三');
        expect(await directory.findStudentsByUserIds(domainId, [])).to.deep.equal({});
    });

    it('finds one bound student by uid and scopes schools and groups to the domain', async () => {
        expect((await directory.findStudentByUserId(domainId, 43))?.studentId).to.equal('2403');
        expect(await directory.findStudentByUserId(domainId, 47)).to.equal(null);
        expect((await directory.listSchools(domainId)).map((school) => school.name)).to.deep.equal(['A 校']);
        expect((await directory.getSchool(domainId, schoolA))?.name).to.equal('A 校');
        expect(await directory.getSchool(domainId, schoolB)).to.equal(null);
        expect((await directory.listUserGroups(domainId)).map((group) => group.name)).to.deep.equal(['一班', '二班']);
        expect((await directory.listUserGroups(domainId, schoolA)).map((group) => group.name)).to.deep.equal(['一班']);
    });

    it('searches bound students by literal id or name, case-insensitively, within the result limit', async () => {
        expect(await directory.searchBoundStudents(domainId, ' 张 ')).to.deep.equal([{ boundUserId: 42, studentId: '2401', realName: '张三' }]);
        expect((await directory.searchBoundStudents(domainId, '240')).map((row) => row.boundUserId)).to.deep.equal([42, 43, 46]);
        expect(await directory.searchBoundStudents(domainId, '24.1')).to.deep.equal([]);
        expect(await directory.searchBoundStudents(domainId, '   ')).to.deep.equal([]);
        expect((await directory.searchBoundStudents(domainId, '240', 1)).map((row) => row.boundUserId)).to.deep.equal([42]);
        // krypton-userbind limits before dropping uid <= 1, so a system-account row consumes a slot.
        expect((await directory.searchBoundStudents(domainId, '240', 3)).map((row) => row.boundUserId)).to.deep.equal([42, 43]);
    });

    it('refuses to fake roster snapshots or Vigil lookups until a test assigns them', async () => {
        expect((await rejection(directory.loadExamRosterUserbindSnapshot(domainId, schoolA, null))).message).to.include('does not model exam roster snapshots');
        expect((await rejection(directory.lookupStudent(domainId, '2401', '张三'))).message).to.include('does not model Vigil student lookup');
    });
});
