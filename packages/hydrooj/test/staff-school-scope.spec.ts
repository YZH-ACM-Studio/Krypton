import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { isSchoolInStaffScope, resolveStaffSchoolScope } from '../src/lib/staff-school-scope';
import type { StaffScopeActor } from '../src/lib/staff-school-scope';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import { withStudentDirectory } from '../src/service/student-directory';
import type { StudentDirectory } from '../src/service/student-directory';

const domainId = 'system';

function hexes(ids: ObjectId[]): string[] {
    return ids.map((id) => id.toHexString());
}

async function scope(directory: StudentDirectory, actor: StaffScopeActor): Promise<ObjectId[]> {
    return withStudentDirectory(directory, () => resolveStaffSchoolScope(domainId, actor));
}

class CountingStudentDirectory extends InMemoryStudentDirectory {
    readonly calls = { listSchools: 0, findStudentByUserId: 0, getSchool: 0 };

    async listSchools(targetDomainId: string) {
        this.calls.listSchools += 1;
        return super.listSchools(targetDomainId);
    }

    async findStudentByUserId(targetDomainId: string, userId: number) {
        this.calls.findStudentByUserId += 1;
        return super.findStudentByUserId(targetDomainId, userId);
    }

    async getSchool(targetDomainId: string, schoolId: ObjectId) {
        this.calls.getSchool += 1;
        return super.getSchool(targetDomainId, schoolId);
    }
}

describe('Staff school scope', { concurrency: false }, () => {
    it('returns parent schools that still exist, in ascending hex order, after one directory read', async () => {
        const low = new ObjectId('66c100000000000000000001');
        const high = new ObjectId('66c100000000000000000002');
        const unrelated = new ObjectId('66c100000000000000000003');
        const directory = new CountingStudentDirectory({
            schools: [
                { _id: high, domainId, name: '高' },
                { _id: low, domainId, name: '低' },
                { _id: unrelated, domainId, name: '无关', staffUids: [99] },
            ],
            students: [studentRecord({ domainId, schoolId: high, boundUserId: 99 })],
        });
        const ids = await scope(directory, { _id: 21, parentSchoolId: [high, low] });
        expect(hexes(ids)).to.deep.equal([low.toHexString(), high.toHexString()]);
        expect(directory.calls).to.deep.equal({ listSchools: 1, findStudentByUserId: 1, getSchool: 0 });
    });

    it('returns the bound student record school when that is the only source', async () => {
        const school = new ObjectId('66c1000000000000000000b1');
        const other = new ObjectId('66c1000000000000000000b2');
        const directory = new InMemoryStudentDirectory({
            schools: [
                { _id: other, domainId, name: '其它' },
                { _id: school, domainId, name: '学生学校' },
            ],
            students: [studentRecord({ domainId, schoolId: school, boundUserId: 11, studentId: '2401', realName: '甲' })],
        });
        expect(hexes(await scope(directory, { _id: 11 }))).to.deep.equal([school.toHexString()]);
    });

    it('returns schools whose staffUids contain the actor and answers membership from that scope', async () => {
        const school = new ObjectId('66c1000000000000000000c1');
        const other = new ObjectId('66c1000000000000000000c2');
        const missingStaff = new ObjectId('66c1000000000000000000c3');
        const actor: StaffScopeActor = { _id: 12, parentSchoolId: [] };
        const directory = new InMemoryStudentDirectory({
            schools: [
                { _id: other, domainId, name: '别人的任职', staffUids: [99] },
                { _id: missingStaff, domainId, name: '没有教师名单' },
                { _id: school, domainId, name: '任职学校', staffUids: [12] },
            ],
        });
        expect(hexes(await scope(directory, actor))).to.deep.equal([school.toHexString()]);
        expect(await withStudentDirectory(directory, () => isSchoolInStaffScope(domainId, actor, school))).to.equal(true);
        expect(await withStudentDirectory(directory, () => isSchoolInStaffScope(domainId, actor, other))).to.equal(false);
    });

    it('deduplicates one school reached through parent, student record, and staffUids', async () => {
        const school = new ObjectId('66c1000000000000000000d1');
        const directory = new InMemoryStudentDirectory({
            schools: [{ _id: school, domainId, name: '重叠', staffUids: [13] }],
            students: [studentRecord({ domainId, schoolId: school, boundUserId: 13 })],
        });
        const ids = await scope(directory, { _id: 13, parentSchoolId: [school] });
        expect(hexes(ids)).to.deep.equal([school.toHexString()]);
    });

    it('unions distinct parent, student, and staff schools', async () => {
        const fromParent = new ObjectId('66c100000000000000000031');
        const fromStudent = new ObjectId('66c100000000000000000032');
        const fromStaff = new ObjectId('66c100000000000000000033');
        const unrelated = new ObjectId('66c100000000000000000034');
        const directory = new InMemoryStudentDirectory({
            schools: [
                { _id: fromStaff, domainId, name: '任职', staffUids: [14] },
                { _id: unrelated, domainId, name: '无关' },
                { _id: fromParent, domainId, name: '家长字段' },
                { _id: fromStudent, domainId, name: '学籍' },
            ],
            students: [studentRecord({ domainId, schoolId: fromStudent, boundUserId: 14 })],
        });
        expect(hexes(await scope(directory, { _id: 14, parentSchoolId: [fromParent] }))).to.deep.equal([
            fromParent.toHexString(),
            fromStudent.toHexString(),
            fromStaff.toHexString(),
        ]);
    });

    it('does not return a school that is no longer in the directory', async () => {
        const deleted = new ObjectId('66c1000000000000000000e1');
        const directory = new InMemoryStudentDirectory({
            schools: [],
            students: [studentRecord({ domainId, schoolId: deleted, boundUserId: 15 })],
        });
        expect(hexes(await scope(directory, { _id: 15, parentSchoolId: [deleted] }))).to.deep.equal([]);
    });

    it('returns an empty scope when the actor has no school source', async () => {
        const live = new ObjectId('66c1000000000000000000f1');
        const actor: StaffScopeActor = { _id: 16, parentSchoolId: [] };
        const directory = new InMemoryStudentDirectory({
            schools: [{ _id: live, domainId, name: '在册' }],
        });
        expect(hexes(await scope(directory, actor))).to.deep.equal([]);
        expect(await withStudentDirectory(directory, () => isSchoolInStaffScope(domainId, actor, live))).to.equal(false);
    });

    it('skips parentSchoolId values that are not ObjectIds', async () => {
        const school = new ObjectId('66c1000000000000000000aa');
        const fake = { toHexString: () => school.toHexString() };
        const directory = new InMemoryStudentDirectory({
            schools: [{ _id: school, domainId, name: 'A' }],
        });
        const ids = await scope(directory, { _id: 17, parentSchoolId: [fake as unknown as ObjectId] });
        expect(hexes(ids)).to.deep.equal([]);
    });

    it('returns stored school and group documents without filling absent optional fields', async () => {
        const schoolId = new ObjectId('66c200000000000000000010');
        const plainSchool = { _id: new ObjectId('66c200000000000000000011'), domainId, name: '无教师名单' };
        const staffSchool = { _id: schoolId, domainId, name: '有教师名单', staffUids: [3, 4] };
        const plainGroup = { _id: new ObjectId('66c200000000000000000012'), domainId, schoolId, name: '普通学校组' };
        const attachableGroup = {
            _id: new ObjectId('66c200000000000000000013'),
            domainId,
            schoolId,
            name: '开放学校组',
            teacherAttachable: true,
        };
        const ownedGroup = {
            _id: new ObjectId('66c200000000000000000014'),
            domainId,
            schoolId,
            name: '老师组',
            ownerUid: 3,
        };
        const directory = new InMemoryStudentDirectory({
            schools: [plainSchool, staffSchool],
            groups: [plainGroup, attachableGroup, ownedGroup],
        });
        const schools = await directory.listSchools(domainId);
        expect(schools[0]).to.equal(plainSchool);
        expect(Object.hasOwn(schools[0], 'staffUids')).to.equal(false);
        expect(schools[1]).to.equal(staffSchool);
        expect(schools[1].staffUids).to.deep.equal([3, 4]);
        const groups = await directory.listUserGroups(domainId);
        expect(groups[0]).to.equal(plainGroup);
        expect(Object.hasOwn(groups[0], 'ownerUid')).to.equal(false);
        expect(Object.hasOwn(groups[0], 'teacherAttachable')).to.equal(false);
        expect(groups[1]).to.equal(attachableGroup);
        expect(groups[1].teacherAttachable).to.equal(true);
        expect(Object.hasOwn(groups[1], 'ownerUid')).to.equal(false);
        expect(groups[2]).to.equal(ownedGroup);
        expect(groups[2].ownerUid).to.equal(3);
        expect(Object.hasOwn(groups[2], 'teacherAttachable')).to.equal(false);
    });
});
