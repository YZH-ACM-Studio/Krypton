import type { ObjectId } from 'mongodb';

export interface StudentDirectoryStudent {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
    boundAt: Date | null;
    enrollmentYear?: number | null;
}

export interface StudentDirectorySchool {
    _id: ObjectId;
    domainId: string;
    name: string;
}

export interface StudentDirectoryGroup {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    archivedAt?: Date | null;
}

export interface ExamRosterUserbindSnapshot {
    domainId: string;
    schoolId: ObjectId;
    schoolName: string;
    selectionKind: 'groups' | 'school';
    selectedGroupIds: ObjectId[];
    groups: Array<{
        groupId: ObjectId;
        schoolId: ObjectId;
        name: string;
        archivedAt: Date | null;
        fingerprint: string;
    }>;
    students: Array<{
        studentRecordId: ObjectId;
        schoolId: ObjectId;
        studentId: string;
        realName: string;
        groupIds: ObjectId[];
        boundUserId: number | null;
    }>;
    fingerprint: string;
}

export interface StudentDirectoryLookupResult {
    found: boolean;
    userId?: number;
    domainId?: string;
    eligibleContestIds: ObjectId[];
    reason?: 'no_match' | 'not_bound' | 'name_mismatch' | 'school_not_specified' | 'ambiguous_match';
}

/** The student roster that core reads; krypton-userbind registers the production adapter. */
export interface StudentDirectory {
    listSchools(domainId: string): Promise<StudentDirectorySchool[]>;
    getSchool(domainId: string, schoolId: ObjectId): Promise<StudentDirectorySchool | null>;
    listUserGroups(domainId: string, schoolId?: ObjectId): Promise<StudentDirectoryGroup[]>;
    findStudentByUserId(domainId: string, userId: number): Promise<StudentDirectoryStudent | null>;
    findStudentsByUserIds(domainId: string, userIds: number[]): Promise<Record<string, StudentDirectoryStudent>>;
    searchBoundStudents(domainId: string, query: string, limit?: number): Promise<Array<{ boundUserId: number; studentId: string; realName: string }>>;
    /** Only students bound to a real account (uid > 1) whose groups intersect `groupIds`. */
    findBoundStudentsByGroupIds(domainId: string, groupIds: ObjectId[]): Promise<StudentDirectoryStudent[]>;
    loadExamRosterUserbindSnapshot(domainId: string, schoolId: ObjectId, selectedGroupIds: ObjectId[] | null): Promise<ExamRosterUserbindSnapshot>;
    lookupStudent(
        domainId: string,
        studentIdInput: string,
        realNameInput: string,
        options?: { contestId?: string },
    ): Promise<StudentDirectoryLookupResult>;
}

export class StudentDirectoryUnavailableError extends Error {
    constructor() {
        super('StudentDirectory is not registered (krypton-userbind not loaded)');
        this.name = 'StudentDirectoryUnavailableError';
    }
}

let registered: StudentDirectory | null = null;

export function registerStudentDirectory(adapter: StudentDirectory): void {
    if (registered && registered !== adapter) throw new Error('StudentDirectory is already registered with a different adapter');
    registered = adapter;
}

export function studentDirectory(): StudentDirectory {
    if (!registered) throw new StudentDirectoryUnavailableError();
    return registered;
}

export async function withStudentDirectory<T>(adapter: StudentDirectory, fn: () => Promise<T>): Promise<T> {
    const previous = registered;
    registered = adapter;
    try {
        return await fn();
    } finally {
        registered = previous;
    }
}
