import { escapeRegExp } from 'lodash';
import { ObjectId } from 'mongodb';
import type {
    ExamRosterUserbindSnapshot,
    StudentDirectory,
    StudentDirectoryGroup,
    StudentDirectoryLookupResult,
    StudentDirectorySchool,
    StudentDirectoryStudent,
} from '../../service/student-directory';

export interface InMemoryStudentDirectoryOptions {
    students?: StudentDirectoryStudent[];
    schools?: StudentDirectorySchool[];
    groups?: StudentDirectoryGroup[];
}

/** A complete student record for fixtures; unspecified fields are unbound placeholders. */
export function studentRecord(overrides: Partial<StudentDirectoryStudent> = {}): StudentDirectoryStudent {
    return {
        _id: new ObjectId(),
        domainId: 'system',
        schoolId: new ObjectId(),
        studentId: '',
        realName: '',
        groupIds: [],
        boundUserId: null,
        boundAt: null,
        ...overrides,
    };
}

function byStudentIdThenRecordId(left: StudentDirectoryStudent, right: StudentDirectoryStudent): number {
    if (left.studentId !== right.studentId) return left.studentId < right.studentId ? -1 : 1;
    const leftId = left._id.toHexString();
    const rightId = right._id.toHexString();
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/**
 * Test adapter answering the directory from plain arrays with the filters krypton-userbind applies in Mongo.
 * Exam roster snapshots and Vigil student lookup depend on krypton-userbind's own canonicalization and contest
 * eligibility, so tests that reach them assign those two methods on the instance.
 * Optional `staffUids`, `ownerUid`, and `teacherAttachable` are returned as stored.
 * A missing field stays missing; do not default it to an empty array or false.
 */
export class InMemoryStudentDirectory implements StudentDirectory {
    students: StudentDirectoryStudent[];
    schools: StudentDirectorySchool[];
    groups: StudentDirectoryGroup[];

    constructor(options: InMemoryStudentDirectoryOptions = {}) {
        this.students = options.students || [];
        this.schools = options.schools || [];
        this.groups = options.groups || [];
    }

    async listSchools(domainId: string): Promise<StudentDirectorySchool[]> {
        return this.schools.filter((school) => school.domainId === domainId);
    }

    async getSchool(domainId: string, schoolId: ObjectId): Promise<StudentDirectorySchool | null> {
        return this.schools.find((school) => school.domainId === domainId && school._id.equals(schoolId)) || null;
    }

    async listUserGroups(domainId: string, schoolId?: ObjectId): Promise<StudentDirectoryGroup[]> {
        return this.groups.filter((group) => group.domainId === domainId && (!schoolId || group.schoolId.equals(schoolId)));
    }

    async findStudentByUserId(domainId: string, userId: number): Promise<StudentDirectoryStudent | null> {
        return this.students.find((student) => student.domainId === domainId && student.boundUserId === userId) || null;
    }

    async findStudentsByUserIds(domainId: string, userIds: number[]): Promise<Record<string, StudentDirectoryStudent>> {
        const result: Record<string, StudentDirectoryStudent> = {};
        for (const student of this.students) {
            if (student.domainId === domainId && student.boundUserId !== null && userIds.includes(student.boundUserId)) {
                result[String(student.boundUserId)] = student;
            }
        }
        return result;
    }

    async searchBoundStudents(domainId: string, query: string, limit = 20): Promise<Array<{ boundUserId: number; studentId: string; realName: string }>> {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const pattern = new RegExp(escapeRegExp(trimmed), 'i');
        return this.students
            .filter((student) => student.domainId === domainId && student.boundUserId !== null && (pattern.test(student.studentId) || pattern.test(student.realName)))
            .sort(byStudentIdThenRecordId)
            .slice(0, Math.max(1, Math.min(limit, 50)))
            .flatMap((student) =>
                Number.isSafeInteger(student.boundUserId) && student.boundUserId > 1
                    ? [{ boundUserId: student.boundUserId, studentId: student.studentId, realName: student.realName }]
                    : [],
            );
    }

    async findBoundStudentsByGroupIds(domainId: string, groupIds: ObjectId[]): Promise<StudentDirectoryStudent[]> {
        const wanted = new Set(groupIds.map((groupId) => groupId.toHexString()));
        return this.students
            .filter(
                (student) =>
                    student.domainId === domainId &&
                    student.boundUserId !== null &&
                    student.boundUserId > 1 &&
                    student.groupIds.some((groupId) => wanted.has(groupId.toHexString())),
            )
            .sort(byStudentIdThenRecordId);
    }

    async loadExamRosterUserbindSnapshot(_domainId: string, _schoolId: ObjectId, _selectedGroupIds: ObjectId[] | null): Promise<ExamRosterUserbindSnapshot> {
        throw new Error('InMemoryStudentDirectory does not model exam roster snapshots; assign loadExamRosterUserbindSnapshot in the test');
    }

    async lookupStudent(
        _domainId: string,
        _studentIdInput: string,
        _realNameInput: string,
        _options?: { contestId?: string },
    ): Promise<StudentDirectoryLookupResult> {
        throw new Error('InMemoryStudentDirectory does not model Vigil student lookup; assign lookupStudent in the test');
    }
}
