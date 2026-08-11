import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { buildExamRosterUserbindSnapshot, ExamRosterUserbindSourceError } from '../src/exam-roster-source';
import type { School, StudentRecord, UserGroup } from '../src/types';

const domainId = 'system';
const schoolId = new ObjectId('66b900000000000000000001');
const otherSchoolId = new ObjectId('66b900000000000000000002');
const groupAId = new ObjectId('66b900000000000000000011');
const groupBId = new ObjectId('66b900000000000000000012');

const school: School = {
    _id: schoolId,
    domainId,
    name: '计算机学院',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: 2,
};

function group(groupId: ObjectId, name: string, targetSchoolId = schoolId): UserGroup {
    return {
        _id: groupId,
        domainId,
        schoolId: targetSchoolId,
        name,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: 2,
    };
}

function student(recordId: string, studentId: string, groupIds: ObjectId[], boundUserId: number | null): StudentRecord {
    return {
        _id: new ObjectId(recordId),
        domainId,
        schoolId,
        studentId,
        realName: `学生${studentId}`,
        groupIds,
        boundUserId,
        boundAt: boundUserId === null ? null : new Date('2026-08-02T00:00:00.000Z'),
        enrollmentYear: 2026,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: 2,
    };
}

describe('P2.4 userbind roster source snapshot', () => {
    it('deduplicates multi-group students and derives stable per-group and aggregate fingerprints', () => {
        const students = [
            student('66b900000000000000000101', '26001', [groupAId, groupBId], 101),
            student('66b900000000000000000102', '26002', [groupBId], null),
        ];
        const first = buildExamRosterUserbindSnapshot({
            domainId,
            schoolId,
            selectionKind: 'groups',
            selectedGroupIds: [groupBId, groupAId],
            school,
            groups: [group(groupBId, '二班'), group(groupAId, '一班')],
            students: [...students].reverse(),
        });
        const second = buildExamRosterUserbindSnapshot({
            domainId,
            schoolId,
            selectionKind: 'groups',
            selectedGroupIds: [groupAId, groupBId],
            school,
            groups: [group(groupAId, '一班'), group(groupBId, '二班')],
            students,
        });

        expect(first.students).to.have.lengthOf(2);
        expect(first.selectedGroupIds.map(String)).to.deep.equal([String(groupAId), String(groupBId)]);
        expect(first.groups.map((item) => item.fingerprint)).to.satisfy((values: string[]) => values.every((value) => /^[a-f0-9]{64}$/.test(value)));
        expect(first.fingerprint).to.equal(second.fingerprint);
    });

    it('changes the fingerprint when membership, binding, identity, or group metadata changes', () => {
        const baseStudent = student('66b900000000000000000101', '26001', [groupAId], 101);
        const snapshot = (targetStudent: StudentRecord, groupName = '一班') =>
            buildExamRosterUserbindSnapshot({
                domainId,
                schoolId,
                selectionKind: 'groups',
                selectedGroupIds: [groupAId],
                school,
                groups: [group(groupAId, groupName)],
                students: [targetStudent],
            }).fingerprint;

        expect(snapshot({ ...baseStudent, boundUserId: null, boundAt: null })).not.to.equal(snapshot(baseStudent));
        expect(snapshot({ ...baseStudent, realName: '新姓名' })).not.to.equal(snapshot(baseStudent));
        expect(snapshot(baseStudent, '重命名班级')).not.to.equal(snapshot(baseStudent));
        expect(
            buildExamRosterUserbindSnapshot({
                domainId,
                schoolId,
                selectionKind: 'groups',
                selectedGroupIds: [groupAId],
                school,
                groups: [group(groupAId, '一班')],
                students: [],
            }).fingerprint,
        ).not.to.equal(snapshot(baseStudent));
    });

    it('fails closed on a missing selected group or cross-school group before exposing members', () => {
        expect(() =>
            buildExamRosterUserbindSnapshot({
                domainId,
                schoolId,
                selectionKind: 'groups',
                selectedGroupIds: [groupAId],
                school,
                groups: [],
                students: [],
            }),
        ).to.throw(ExamRosterUserbindSourceError, 'group_selection_mismatch');
        expect(() =>
            buildExamRosterUserbindSnapshot({
                domainId,
                schoolId,
                selectionKind: 'groups',
                selectedGroupIds: [groupAId],
                school,
                groups: [group(groupAId, '越权组', otherSchoolId)],
                students: [],
            }),
        ).to.throw(ExamRosterUserbindSourceError, 'group_school_mismatch');
    });

    it('rejects malformed binding facts instead of silently treating them as unbound', () => {
        expect(() =>
            buildExamRosterUserbindSnapshot({
                domainId,
                schoolId,
                selectionKind: 'school',
                school,
                groups: [],
                students: [{ ...student('66b900000000000000000101', '26001', [], 101), boundAt: null }],
            }),
        ).to.throw(ExamRosterUserbindSourceError, 'student_binding_inconsistent');
    });
});
