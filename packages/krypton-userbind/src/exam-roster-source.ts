import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { School, StudentRecord, UserGroup } from './types';

export type ExamRosterUserbindSelectionKind = 'groups' | 'school';

export interface ExamRosterUserbindGroupFact {
    groupId: ObjectId;
    schoolId: ObjectId;
    name: string;
    archivedAt: Date | null;
    fingerprint: string;
}

export interface ExamRosterUserbindStudentFact {
    studentRecordId: ObjectId;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
}

export interface ExamRosterUserbindSnapshot {
    domainId: string;
    schoolId: ObjectId;
    schoolName: string;
    selectionKind: ExamRosterUserbindSelectionKind;
    selectedGroupIds: ObjectId[];
    groups: ExamRosterUserbindGroupFact[];
    students: ExamRosterUserbindStudentFact[];
    fingerprint: string;
}

export class ExamRosterUserbindSourceError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamRosterUserbindSourceError';
    }
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function objectId(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) throw new ExamRosterUserbindSourceError(`${field}_invalid`);
    return new ObjectId(value);
}

function text(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) {
        throw new ExamRosterUserbindSourceError(`${field}_invalid`);
    }
    return value;
}

function date(value: unknown, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ExamRosterUserbindSourceError(`${field}_invalid`);
    return new Date(value);
}

function canonicalGroupIds(values: unknown, field: string): ObjectId[] {
    if (!Array.isArray(values)) throw new ExamRosterUserbindSourceError(`${field}_invalid`);
    const ids = values.map((value) => objectId(value, field)).sort((left, right) => left.toHexString().localeCompare(right.toHexString()));
    if (new Set(ids.map((id) => id.toHexString())).size !== ids.length) throw new ExamRosterUserbindSourceError(`${field}_duplicate`);
    return ids;
}

function canonicalSchool(domainId: string, expectedSchoolId: ObjectId, school: School): { schoolId: ObjectId; name: string } {
    const schoolId = objectId(school?._id, 'school_id');
    if (school.domainId !== domainId || !schoolId.equals(expectedSchoolId)) throw new ExamRosterUserbindSourceError('school_identity_mismatch');
    date(school.createdAt, 'school_created_at');
    if (!Number.isSafeInteger(school.createdBy) || school.createdBy < 1) throw new ExamRosterUserbindSourceError('school_created_by_invalid');
    return { schoolId, name: text(school.name, 'school_name', 120) };
}

function canonicalGroup(domainId: string, schoolId: ObjectId, group: UserGroup): Omit<ExamRosterUserbindGroupFact, 'fingerprint'> {
    const groupId = objectId(group?._id, 'group_id');
    const groupSchoolId = objectId(group.schoolId, 'group_school_id');
    if (group.domainId !== domainId) throw new ExamRosterUserbindSourceError('group_domain_mismatch');
    if (!groupSchoolId.equals(schoolId)) throw new ExamRosterUserbindSourceError('group_school_mismatch');
    date(group.createdAt, 'group_created_at');
    if (!Number.isSafeInteger(group.createdBy) || group.createdBy < 1) throw new ExamRosterUserbindSourceError('group_created_by_invalid');
    return {
        groupId,
        schoolId: groupSchoolId,
        name: text(group.name, 'group_name', 120),
        archivedAt: group.archivedAt === undefined ? null : date(group.archivedAt, 'group_archived_at'),
    };
}

function canonicalStudent(domainId: string, schoolId: ObjectId, student: StudentRecord): ExamRosterUserbindStudentFact {
    const studentRecordId = objectId(student?._id, 'student_record_id');
    const studentSchoolId = objectId(student.schoolId, 'student_school_id');
    if (student.domainId !== domainId) throw new ExamRosterUserbindSourceError('student_domain_mismatch');
    if (!studentSchoolId.equals(schoolId)) throw new ExamRosterUserbindSourceError('student_school_mismatch');
    const groupIds = canonicalGroupIds(student.groupIds, 'student_group_ids');
    if (student.boundUserId !== null && (!Number.isSafeInteger(student.boundUserId) || student.boundUserId <= 1)) {
        throw new ExamRosterUserbindSourceError('student_bound_user_invalid');
    }
    if (student.boundAt !== null) date(student.boundAt, 'student_bound_at');
    if ((student.boundUserId === null) !== (student.boundAt === null)) throw new ExamRosterUserbindSourceError('student_binding_inconsistent');
    date(student.createdAt, 'student_created_at');
    if (!Number.isSafeInteger(student.createdBy) || student.createdBy < 1) throw new ExamRosterUserbindSourceError('student_created_by_invalid');
    return {
        studentRecordId,
        schoolId: studentSchoolId,
        studentId: text(student.studentId, 'student_id', 64),
        realName: text(student.realName, 'student_real_name', 32),
        groupIds,
        boundUserId: student.boundUserId,
    };
}

function studentFingerprintFact(student: ExamRosterUserbindStudentFact) {
    return {
        studentRecordId: student.studentRecordId.toHexString(),
        schoolId: student.schoolId.toHexString(),
        studentId: student.studentId,
        realName: student.realName,
        groupIds: student.groupIds.map((id) => id.toHexString()),
        boundUserId: student.boundUserId,
    };
}

export function buildExamRosterUserbindSnapshot(input: {
    domainId: string;
    schoolId: ObjectId;
    selectionKind: ExamRosterUserbindSelectionKind;
    selectedGroupIds?: ObjectId[];
    school: School;
    groups: UserGroup[];
    students: StudentRecord[];
}): ExamRosterUserbindSnapshot {
    if (!input.domainId || input.domainId.length > 64) throw new ExamRosterUserbindSourceError('domain_id_invalid');
    const expectedSchoolId = objectId(input.schoolId, 'school_id');
    if (input.selectionKind !== 'groups' && input.selectionKind !== 'school') throw new ExamRosterUserbindSourceError('selection_kind_invalid');
    const selectedGroupIds = canonicalGroupIds(input.selectedGroupIds || [], 'selected_group_ids');
    if (input.selectionKind === 'groups' && (!selectedGroupIds.length || selectedGroupIds.length > 100)) {
        throw new ExamRosterUserbindSourceError('selected_group_ids_invalid');
    }
    if (input.selectionKind === 'school' && selectedGroupIds.length) throw new ExamRosterUserbindSourceError('selected_group_ids_invalid');

    const school = canonicalSchool(input.domainId, expectedSchoolId, input.school);
    const rawGroups = input.groups
        .map((group) => canonicalGroup(input.domainId, school.schoolId, group))
        .sort((left, right) => left.groupId.toHexString().localeCompare(right.groupId.toHexString()));
    if (new Set(rawGroups.map((group) => group.groupId.toHexString())).size !== rawGroups.length) {
        throw new ExamRosterUserbindSourceError('group_duplicate');
    }
    if (input.selectionKind === 'groups') {
        const actual = rawGroups.map((group) => group.groupId.toHexString());
        const expected = selectedGroupIds.map((groupId) => groupId.toHexString());
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
            throw new ExamRosterUserbindSourceError('group_selection_mismatch');
        }
    } else if (rawGroups.length) throw new ExamRosterUserbindSourceError('group_selection_mismatch');

    const students = input.students
        .map((student) => canonicalStudent(input.domainId, school.schoolId, student))
        .sort((left, right) => left.studentRecordId.toHexString().localeCompare(right.studentRecordId.toHexString()));
    if (new Set(students.map((student) => student.studentRecordId.toHexString())).size !== students.length) {
        throw new ExamRosterUserbindSourceError('student_record_duplicate');
    }
    if (
        input.selectionKind === 'groups' &&
        students.some((student) => !student.groupIds.some((groupId) => selectedGroupIds.some((selected) => selected.equals(groupId))))
    ) {
        throw new ExamRosterUserbindSourceError('student_group_membership_mismatch');
    }

    const groups = rawGroups.map((group) => {
        const members = students.filter((student) => student.groupIds.some((groupId) => groupId.equals(group.groupId))).map(studentFingerprintFact);
        return {
            ...group,
            fingerprint: sha256({
                groupId: group.groupId.toHexString(),
                schoolId: group.schoolId.toHexString(),
                name: group.name,
                archivedAt: group.archivedAt?.toISOString() || null,
                members,
            }),
        };
    });
    const fingerprint = sha256({
        domainId: input.domainId,
        schoolId: school.schoolId.toHexString(),
        schoolName: school.name,
        selectionKind: input.selectionKind,
        selectedGroupIds: selectedGroupIds.map((id) => id.toHexString()),
        groups: groups.map((group) => ({
            groupId: group.groupId.toHexString(),
            schoolId: group.schoolId.toHexString(),
            name: group.name,
            archivedAt: group.archivedAt?.toISOString() || null,
            fingerprint: group.fingerprint,
        })),
        students: students.map(studentFingerprintFact),
    });
    return {
        domainId: input.domainId,
        schoolId: school.schoolId,
        schoolName: school.name,
        selectionKind: input.selectionKind,
        selectedGroupIds,
        groups,
        students,
        fingerprint,
    };
}

export interface ExamRosterUserbindSourceDependencies {
    findSchool(domainId: string, schoolId: ObjectId): Promise<School | null>;
    findGroups(domainId: string, groupIds: ObjectId[]): Promise<UserGroup[]>;
    findStudents(domainId: string, schoolId: ObjectId, groupIds: ObjectId[] | null): Promise<StudentRecord[]>;
}

export async function loadExamRosterUserbindSnapshotWithDependencies(
    input: { domainId: string; schoolId: ObjectId; selectedGroupIds: ObjectId[] | null },
    dependencies: ExamRosterUserbindSourceDependencies,
): Promise<ExamRosterUserbindSnapshot> {
    const canonicalSchoolId = objectId(input.schoolId, 'school_id');
    const selectionKind: ExamRosterUserbindSelectionKind = input.selectedGroupIds === null ? 'school' : 'groups';
    const groupIds = input.selectedGroupIds === null ? [] : canonicalGroupIds(input.selectedGroupIds, 'selected_group_ids');
    if (selectionKind === 'groups' && (!groupIds.length || groupIds.length > 100)) {
        throw new ExamRosterUserbindSourceError('selected_group_ids_invalid');
    }
    const [school, groups, students] = await Promise.all([
        dependencies.findSchool(input.domainId, canonicalSchoolId),
        selectionKind === 'groups' ? dependencies.findGroups(input.domainId, groupIds) : Promise.resolve([]),
        dependencies.findStudents(input.domainId, canonicalSchoolId, selectionKind === 'groups' ? groupIds : null),
    ]);
    if (!school) throw new ExamRosterUserbindSourceError('school_not_found');
    return buildExamRosterUserbindSnapshot({
        domainId: input.domainId,
        schoolId: canonicalSchoolId,
        selectionKind,
        selectedGroupIds: groupIds,
        school,
        groups,
        students,
    });
}
