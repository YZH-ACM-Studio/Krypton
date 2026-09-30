import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import type { AttachActor } from '../src/lib/user-group-attach';
import {
    assertGroupsAttachable,
    describeGroupRefs,
    listAttachableGroups,
    parseGroupIdList,
} from '../src/lib/user-group-attach';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import type { StudentDirectory, StudentDirectoryGroup, StudentDirectorySchool } from '../src/service/student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

const domainId = 'system';
const teacherId = 21;
const otherTeacherId = 44;
const archivedAt = new Date('2026-09-01T00:00:00.000Z');

const schoolParent = new ObjectId('66d200000000000000000001');
const schoolStaff = new ObjectId('66d200000000000000000002');
const schoolStudent = new ObjectId('66d200000000000000000003');
const schoolOutside = new ObjectId('66d200000000000000000004');
const schoolMissing = new ObjectId('66d200000000000000000005');

const ownId = new ObjectId('66d210000000000000000001');
const otherId = new ObjectId('66d210000000000000000002');
const closedId = new ObjectId('66d210000000000000000003');
const falseFlagId = new ObjectId('66d210000000000000000004');
const openParentId = new ObjectId('66d210000000000000000005');
const openStaffId = new ObjectId('66d210000000000000000006');
const openStudentId = new ObjectId('66d210000000000000000007');
const openOutsideId = new ObjectId('66d210000000000000000008');
const archivedOpenId = new ObjectId('66d210000000000000000009');
const archivedOwnId = new ObjectId('66d21000000000000000000a');
const missingSchoolId = new ObjectId('66d21000000000000000000b');
const otherDomainId = new ObjectId('66d21000000000000000000c');
const deletedId = new ObjectId('66d21000000000000000000d');
const ownOutsideId = new ObjectId('66d21000000000000000000e');
const otherPlainId = new ObjectId('66d21000000000000000000f');

const deletedMessage = '所选用户组已被删除，请先移除后再保存';
const invalidMessage = '用户组参数无效';

function cannotUse(name: string): string {
    return `你不能使用用户组「${name}」，只能使用自己的用户组或管理员开放给老师的本校用户组`;
}

function teacher(): AttachActor {
    return { _id: teacherId, parentSchoolId: [schoolParent] };
}

function sameId(id: ObjectId): ObjectId {
    return new ObjectId(id.toHexString());
}

function mainDirectory(): InMemoryStudentDirectory {
    const schools: StudentDirectorySchool[] = [
        { _id: schoolParent, domainId, name: 'Parent' },
        { _id: schoolStaff, domainId, name: 'Staff', staffUids: [teacherId] },
        { _id: schoolStudent, domainId, name: 'Student' },
        { _id: schoolOutside, domainId, name: 'Outside', staffUids: [99] },
    ];
    const groups: StudentDirectoryGroup[] = [
        { _id: ownId, domainId, schoolId: schoolParent, name: 'own-group', ownerUid: teacherId },
        {
            _id: otherId,
            domainId,
            schoolId: schoolParent,
            name: 'other-group',
            ownerUid: otherTeacherId,
            teacherAttachable: true,
        },
        { _id: otherPlainId, domainId, schoolId: schoolParent, name: 'other-plain', ownerUid: otherTeacherId },
        { _id: closedId, domainId, schoolId: schoolParent, name: 'closed-group' },
        { _id: falseFlagId, domainId, schoolId: schoolParent, name: 'false-group', teacherAttachable: false },
        { _id: openParentId, domainId, schoolId: schoolParent, name: 'open-parent', teacherAttachable: true },
        { _id: openStaffId, domainId, schoolId: schoolStaff, name: 'open-staff', teacherAttachable: true },
        { _id: openStudentId, domainId, schoolId: schoolStudent, name: 'open-student', teacherAttachable: true },
        { _id: openOutsideId, domainId, schoolId: schoolOutside, name: 'open-outside', teacherAttachable: true },
        {
            _id: archivedOpenId,
            domainId,
            schoolId: schoolParent,
            name: 'archived-open',
            teacherAttachable: true,
            archivedAt,
        },
        {
            _id: archivedOwnId,
            domainId,
            schoolId: schoolParent,
            name: 'archived-own',
            ownerUid: teacherId,
            archivedAt,
        },
        { _id: ownOutsideId, domainId, schoolId: schoolOutside, name: 'own-outside', ownerUid: teacherId },
        { _id: missingSchoolId, domainId, schoolId: schoolMissing, name: 'missing-school', teacherAttachable: true },
        {
            _id: otherDomainId,
            domainId: 'other',
            schoolId: schoolParent,
            name: 'secret-other-domain',
            teacherAttachable: true,
        },
    ];
    return new InMemoryStudentDirectory({
        schools,
        groups,
        students: [studentRecord({ domainId, schoolId: schoolStudent, boundUserId: teacherId, studentId: '20210001', realName: '测试' })],
    });
}

class CountingStudentDirectory extends InMemoryStudentDirectory {
    readonly calls = { listUserGroups: 0, listSchools: 0, findStudentByUserId: 0, getSchool: 0 };

    readonly listUserGroupSchoolArgs: string[] = [];

    async listUserGroups(targetDomainId: string, schoolId?: ObjectId) {
        this.calls.listUserGroups += 1;
        this.listUserGroupSchoolArgs.push(schoolId ? schoolId.toHexString() : '');
        return super.listUserGroups(targetDomainId, schoolId);
    }

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

async function using<T>(directory: StudentDirectory, run: () => Promise<T>): Promise<T> {
    return withStudentDirectory(directory, run);
}

async function rejection(run: () => Promise<unknown>): Promise<InstanceType<typeof ValidationError>> {
    let caught: unknown;
    try {
        await run();
    } catch (error) {
        caught = error;
    }
    expect(caught, 'expected ValidationError').to.be.instanceOf(ValidationError);
    return caught as InstanceType<typeof ValidationError>;
}

function expectValidation(error: InstanceType<typeof ValidationError>, field: string, detail: string) {
    expect(error.params[0]).to.equal(field);
    expect(error.params[1]).to.equal(null);
    expect(error.params[2]).to.equal(detail);
}

async function oneView(directory: StudentDirectory, actor: AttachActor, id: ObjectId, unrestricted: boolean) {
    const views = await using(directory, () => describeGroupRefs(domainId, actor, [id], { unrestricted }));
    expect(views).to.have.length(1);
    return views[0];
}

describe('User group attach rules', { concurrency: false }, () => {
    it('受限执行者可以挂自己学校范围内、未归档的自己的组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, ownId, false)).to.deep.equal({
            _id: ownId.toHexString(),
            name: 'own-group',
            schoolName: 'Parent',
            state: 'active',
            kind: 'own',
            attachable: true,
        });
        await using(directory, () =>
            assertGroupsAttachable(domainId, actor, {
                field: 'courseGroupIds',
                previous: [],
                next: [sameId(ownId)],
                unrestricted: false,
            }),
        );
    });

    it('受限执行者不能挂别的老师的组，即使该组写了开放标记', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, otherId, false)).to.deep.equal({
            _id: otherId.toHexString(),
            name: 'other-group',
            schoolName: 'Parent',
            state: 'active',
            kind: 'other-teacher',
            attachable: false,
        });
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [otherId],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', cannotUse('other-group'));
    });

    it('受限执行者不能挂没有开放标记的学校组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, closedId, false)).to.deep.include({
            name: 'closed-group',
            schoolName: 'Parent',
            state: 'active',
            kind: 'school',
            attachable: false,
        });
        expect(await oneView(directory, actor, falseFlagId, false)).to.deep.include({
            name: 'false-group',
            kind: 'school',
            attachable: false,
        });
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [closedId],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', cannotUse('closed-group'));
    });

    it('受限执行者可以挂学校范围内已开放的学校组，范围含 parent、学生记录和 staffUids', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        for (const id of [openParentId, openStaffId, openStudentId]) {
            const view = await oneView(directory, actor, id, false);
            expect(view.attachable, view.name || '').to.equal(true);
            expect(view.kind).to.equal('school');
            expect(view.state).to.equal('active');
        }
        expect((await oneView(directory, actor, openParentId, false)).schoolName).to.equal('Parent');
        expect((await oneView(directory, actor, openStaffId, false)).schoolName).to.equal('Staff');
        expect((await oneView(directory, actor, openStudentId, false)).schoolName).to.equal('Student');
        await using(directory, () =>
            assertGroupsAttachable(domainId, actor, {
                field: 'participantGroupIds',
                previous: [],
                next: [sameId(openParentId), sameId(openStaffId), sameId(openStudentId)],
                unrestricted: false,
            }),
        );
    });

    it('受限执行者不能挂已开放但不在学校范围内的组，自己的组也不例外', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, openOutsideId, false)).to.deep.include({
            name: 'open-outside',
            schoolName: 'Outside',
            kind: 'school',
            state: 'active',
            attachable: false,
        });
        expect(await oneView(directory, actor, ownOutsideId, false)).to.deep.include({
            name: 'own-outside',
            schoolName: 'Outside',
            kind: 'own',
            attachable: false,
        });
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [openOutsideId],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', cannotUse('open-outside'));
    });

    it('受限执行者不能挂已归档的组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, archivedOpenId, false)).to.deep.include({
            name: 'archived-open',
            state: 'archived',
            kind: 'school',
            attachable: false,
        });
        expect(await oneView(directory, actor, archivedOwnId, false)).to.deep.include({
            name: 'archived-own',
            state: 'archived',
            kind: 'own',
            attachable: false,
        });
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [archivedOpenId],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', cannotUse('archived-open'));
    });

    it('不受限执行者可以挂已归档组，以及受限执行者不能新增的其它现存组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        expect(await oneView(directory, actor, archivedOpenId, true)).to.deep.include({
            state: 'archived',
            kind: 'school',
            attachable: true,
        });
        expect(await oneView(directory, actor, otherId, true)).to.deep.include({ kind: 'other-teacher', attachable: true });
        expect(await oneView(directory, actor, closedId, true)).to.deep.include({ kind: 'school', attachable: true });
        expect(await oneView(directory, actor, openOutsideId, true)).to.deep.include({ attachable: true, schoolName: 'Outside' });
        expect((await oneView(directory, actor, missingSchoolId, true)).attachable).to.equal(true);
        await using(directory, () =>
            assertGroupsAttachable(domainId, actor, {
                field: 'courseGroupIds',
                previous: [],
                next: [archivedOpenId, archivedOwnId, otherId, closedId, openOutsideId, ownOutsideId],
                unrestricted: true,
            }),
        );
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [archivedOpenId, deletedId],
                    unrestricted: true,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', deletedMessage);
    });

    it('previous 里已有、现在不可挂的组留在 next 里可以通过，新增的不可挂组仍报错', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        let kept: unknown = 'ok';
        try {
            await using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [sameId(otherId), sameId(closedId), sameId(archivedOwnId)],
                    next: [sameId(archivedOwnId), sameId(otherId), sameId(closedId)],
                    unrestricted: false,
                }),
            );
        } catch (error) {
            kept = error;
        }
        expect(kept).to.equal('ok');
        const error = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [sameId(closedId)],
                    next: [sameId(closedId), sameId(otherPlainId)],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(error, 'courseGroupIds', cannotUse('other-plain'));
        let scanned: unknown = 'accepted';
        try {
            await using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [],
                    next: [sameId(openParentId), sameId(otherPlainId)],
                    unrestricted: false,
                }),
            );
        } catch (caught) {
            scanned = caught;
        }
        expect(scanned, 'a later unattachable id must still be rejected').to.be.instanceOf(ValidationError);
    });

    it('移除任何组都不检查，包括去掉已删除或现在不可挂的组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        let removed: unknown = 'ok';
        try {
            await using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [sameId(otherId), sameId(deletedId), sameId(openOutsideId), sameId(ownId)],
                    next: [sameId(ownId)],
                    unrestricted: false,
                }),
            );
        } catch (error) {
            removed = error;
        }
        expect(removed).to.equal('ok');
    });

    it('next 里有已删除的组就报错，即使 previous 里已经有它，也不把后面的不可挂组当成原因', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        const kept = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'courseGroupIds',
                    previous: [sameId(deletedId)],
                    next: [sameId(deletedId)],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(kept, 'courseGroupIds', deletedMessage);
        const mixed = await rejection(() =>
            using(directory, () =>
                assertGroupsAttachable(domainId, actor, {
                    field: 'groupIds',
                    previous: [],
                    next: [closedId, deletedId],
                    unrestricted: false,
                }),
            ),
        );
        expectValidation(mixed, 'groupIds', deletedMessage);
        expect(await oneView(directory, actor, otherDomainId, false)).to.deep.equal({
            _id: otherDomainId.toHexString(),
            name: null,
            schoolName: null,
            state: 'deleted',
            kind: 'unknown',
            attachable: false,
        });
    });

    it('缺省和空白用户组参数得到空列表，合法 id 仍按原顺序保留', () => {
        const first = '66d2300000000000000000bb';
        const second = '66d2300000000000000000aa';
        expect(parseGroupIdList('courseGroupIds', undefined).map((id) => id.toHexString())).to.deep.equal([]);
        expect(parseGroupIdList('courseGroupIds', ['', '   ', '\t']).map((id) => id.toHexString())).to.deep.equal([]);
        expect(parseGroupIdList('courseGroupIds', ['   ', first, second]).map((id) => id.toHexString())).to.deep.equal([first, second]);
    });

    it('用户组 id 去重后保持第一次出现的顺序', () => {
        const first = '66d2300000000000000000bb';
        const second = '66d2300000000000000000aa';
        const third = '66d2300000000000000000cc';
        const deduped = parseGroupIdList('participantGroupIds', [
            `  ${first.toUpperCase()}  `,
            second,
            first,
            third,
            ` ${second.toUpperCase()} `,
        ]);
        expect(deduped.map((id) => id.toHexString())).to.deep.equal([first, second, third]);
        expect(deduped[0].equals(new ObjectId(first))).to.equal(true);
    });

    it('格式非法的用户组 id 报错且不静默丢弃', () => {
        const second = '66d2300000000000000000aa';
        const third = '66d2300000000000000000cc';
        let caught: unknown;
        try {
            parseGroupIdList('courseGroupIds', [second, 'not-a-group', third]);
        } catch (error) {
            caught = error;
        }
        expect(caught).to.be.instanceOf(ValidationError);
        expectValidation(caught as InstanceType<typeof ValidationError>, 'courseGroupIds', invalidMessage);
    });

    it('非字符串用户组 id 报错且不静默丢弃', () => {
        const second = '66d2300000000000000000aa';
        let nonString: unknown;
        try {
            parseGroupIdList('courseGroupIds', [second, 12 as unknown as string]);
        } catch (error) {
            nonString = error;
        }
        expect(nonString).to.be.instanceOf(ValidationError);
        expectValidation(nonString as InstanceType<typeof ValidationError>, 'courseGroupIds', invalidMessage);
    });

    it('用户组参数不是数组时报错且不静默丢弃', () => {
        let caught: unknown;
        try {
            parseGroupIdList('courseGroupIds', { bad: true } as unknown as readonly string[]);
        } catch (error) {
            caught = error;
        }
        expect(caught).to.be.instanceOf(ValidationError);
        expectValidation(caught as InstanceType<typeof ValidationError>, 'courseGroupIds', invalidMessage);
    });

    it('listAttachableGroups 对受限执行者只返回可挂组，对不受限执行者返回全部现存组', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        const restricted = await using(directory, () => listAttachableGroups(domainId, actor, { unrestricted: false }));
        expect(restricted.map((view) => view._id).sort()).to.deep.equal(
            [ownId, openParentId, openStaffId, openStudentId].map((id) => id.toHexString()).sort(),
        );
        expect(restricted.every((view) => view.attachable)).to.equal(true);
        const unrestricted = await using(directory, () => listAttachableGroups(domainId, actor, { unrestricted: true }));
        const unrestrictedIds = unrestricted.map((view) => view._id).sort();
        expect(unrestrictedIds).to.include(archivedOpenId.toHexString());
        expect(unrestrictedIds).to.include(otherId.toHexString());
        expect(unrestrictedIds).to.include(openOutsideId.toHexString());
        expect(unrestrictedIds).to.include(missingSchoolId.toHexString());
        expect(unrestrictedIds).to.not.include(otherDomainId.toHexString());
        expect(unrestrictedIds).to.not.include(deletedId.toHexString());
        expect(unrestricted.every((view) => view.attachable)).to.equal(true);
    });

    it('listAttachableGroups 按学校名空串、学校名、组名、id 十六进制排序', async () => {
        const emptySchool = new ObjectId('66d220000000000000000001');
        const alphaSchool = new ObjectId('66d220000000000000000002');
        const betaSchool = new ObjectId('66d220000000000000000003');
        const emptyA1 = new ObjectId('66d221000000000000000001');
        const emptyA2 = new ObjectId('66d221000000000000000002');
        const emptyB = new ObjectId('66d221000000000000000003');
        const alphaM = new ObjectId('66d221000000000000000004');
        const betaA = new ObjectId('66d221000000000000000005');
        const directory = new InMemoryStudentDirectory({
            schools: [
                { _id: betaSchool, domainId, name: 'Beta' },
                { _id: emptySchool, domainId, name: '' },
                { _id: alphaSchool, domainId, name: 'Alpha' },
            ],
            groups: [
                { _id: betaA, domainId, schoolId: betaSchool, name: 'a', ownerUid: teacherId },
                { _id: emptyA2, domainId, schoolId: emptySchool, name: 'a', ownerUid: teacherId },
                { _id: alphaM, domainId, schoolId: alphaSchool, name: 'm', ownerUid: teacherId },
                { _id: emptyB, domainId, schoolId: emptySchool, name: 'b', ownerUid: teacherId },
                { _id: emptyA1, domainId, schoolId: emptySchool, name: 'a', ownerUid: teacherId },
            ],
        });
        const actor: AttachActor = { _id: teacherId, parentSchoolId: [emptySchool, alphaSchool, betaSchool] };
        const views = await using(directory, () => listAttachableGroups(domainId, actor, { unrestricted: true }));
        expect(views.map((view) => view._id)).to.deep.equal([
            emptyA1.toHexString(),
            emptyA2.toHexString(),
            emptyB.toHexString(),
            alphaM.toHexString(),
            betaA.toHexString(),
        ]);
        expect(views.map((view) => view.schoolName)).to.deep.equal(['', '', '', 'Alpha', 'Beta']);
    });

    it('describeGroupRefs 按输入顺序返回，已删除和学校文档缺失的组都保留', async () => {
        const directory = mainDirectory();
        const actor = teacher();
        const views = await using(directory, () =>
            describeGroupRefs(
                domainId,
                actor,
                [openOutsideId, deletedId, missingSchoolId, ownId, deletedId],
                { unrestricted: false },
            ),
        );
        expect(views.map((view) => view._id)).to.deep.equal([
            openOutsideId.toHexString(),
            deletedId.toHexString(),
            missingSchoolId.toHexString(),
            ownId.toHexString(),
            deletedId.toHexString(),
        ]);
        expect(views[1]).to.deep.equal({
            _id: deletedId.toHexString(),
            name: null,
            schoolName: null,
            state: 'deleted',
            kind: 'unknown',
            attachable: false,
        });
        expect(views[2]).to.deep.equal({
            _id: missingSchoolId.toHexString(),
            name: 'missing-school',
            schoolName: null,
            state: 'active',
            kind: 'school',
            attachable: false,
        });
    });

    it('每次调用都重新读取用户组、学校和学校范围，不逐个查询也不跨调用缓存', async () => {
        const directory = new CountingStudentDirectory(mainDirectory());
        const actor = teacher();
        const before = await using(directory, () => listAttachableGroups(domainId, actor, { unrestricted: true }));
        expect(before.map((view) => view._id)).to.not.include('66d2100000000000000000ff');
        expect(directory.calls).to.deep.equal({ listUserGroups: 1, listSchools: 2, findStudentByUserId: 1, getSchool: 0 });
        expect(directory.listUserGroupSchoolArgs).to.deep.equal(['']);

        await using(directory, () => describeGroupRefs(domainId, actor, [ownId, otherId, deletedId], { unrestricted: true }));
        expect(directory.calls).to.deep.equal({ listUserGroups: 2, listSchools: 4, findStudentByUserId: 2, getSchool: 0 });

        await using(directory, () =>
            assertGroupsAttachable(domainId, actor, {
                field: 'courseGroupIds',
                previous: [],
                next: [ownId],
                unrestricted: true,
            }),
        );
        expect(directory.calls).to.deep.equal({ listUserGroups: 3, listSchools: 6, findStudentByUserId: 3, getSchool: 0 });

        const added = new ObjectId('66d2100000000000000000ff');
        directory.groups.push({ _id: added, domainId, schoolId: schoolParent, name: 'added-own', ownerUid: teacherId });
        const after = await using(directory, () => listAttachableGroups(domainId, actor, { unrestricted: true }));
        expect(after.map((view) => view._id)).to.include(added.toHexString());
        expect(directory.calls).to.deep.equal({ listUserGroups: 4, listSchools: 8, findStudentByUserId: 4, getSchool: 0 });
        expect(directory.listUserGroupSchoolArgs).to.deep.equal(['', '', '', '']);
    });
});
