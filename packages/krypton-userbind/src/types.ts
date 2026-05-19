import type { ObjectId } from 'mongodb';

/**
 * School / 学校组. Top-level grouping inside a domain.
 * Unique by `(domainId, name)`.
 */
export interface School {
    _id: ObjectId;
    domainId: string;
    name: string;
    createdAt: Date;
    createdBy: number;
}

/**
 * UserGroup / 用户组. A class or course-section, owned by a school.
 * Unique by `(domainId, schoolId, name)`.
 */
export interface UserGroup {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    createdAt: Date;
    createdBy: number;
}

/**
 * StudentRecord / 学生记录. Independent document; NOT inlined into school or group.
 * Unique by `(domainId, schoolId, studentId)`.
 *
 * `boundUserId` is null until a binding path (① invite, ② request, or operator
 * action) flips it to a real OJ user._id. A student can belong to multiple
 * user groups within the same school via `groupIds`.
 */
export interface StudentRecord {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
    boundAt: Date | null;
    createdAt: Date;
    createdBy: number;
}

/**
 * BindToken / 邀请绑定令牌. Path ① — admin generates a token for a specific
 * student record, sends the corresponding `/bind/:token` URL to the student.
 */
export interface BindToken {
    _id: string;
    domainId: string;
    studentRecordId: ObjectId;
    createdAt: Date;
    createdBy: number;
    expiresAt: Date | null;
    used: boolean;
    usedBy: number | null;
    usedAt: Date | null;
}

/**
 * BindingRequest / 绑定申请. Path ② — student submits a request, admin reviews.
 * Also used by the temporary-account claim flow (`claimTempUserId !== null`).
 */
export interface BindingRequest {
    _id: ObjectId;
    domainId: string;
    userId: number;
    studentIdInput: string;
    realNameInput: string;
    schoolId: ObjectId;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Date;
    reviewedBy: number | null;
    reviewedAt: Date | null;
    rejectReason: string | null;
    /** Set when the request is a claim of a temporary OJ user's records. */
    claimTempUserId: number | null;
}

/** Result of `lookupStudent(domainId, sid, realName)` — Phase 2 / 3 contract. */
export interface LookupStudentResult {
    found: boolean;
    userId?: number;
    /** Contest._id list of exam-rule contests the student is eligible to enter. */
    eligibleContestIds: ObjectId[];
    /** When `found` is false, the reason. */
    reason?: 'no_match' | 'not_bound' | 'name_mismatch' | 'school_not_specified';
}

/** Used by the migration tool. */
export interface ImportStudentRow {
    studentId: string;
    realName: string;
}

export interface ImportStudentReport {
    inserted: number;
    duplicates: Array<{ studentId: string; reason: string }>;
}

/** Cross-domain export package — see PRD §3.8. */
export interface ExportPackage {
    version: 1;
    sourceDomainId: string;
    exportedAt: string;
    schools: School[];
    userGroups: UserGroup[];
    /** `boundUserId` is stripped; bindings are domain-specific and not migrated. */
    students: Array<Omit<StudentRecord, 'boundUserId' | 'boundAt'>>;
    bindTokens: BindToken[];
}

export type ImportConflictPolicy = 'error' | 'skip' | 'overwrite';

export interface ImportReport {
    schoolsInserted: number;
    groupsInserted: number;
    studentsInserted: number;
    tokensInserted: number;
    conflicts: Array<{
        kind: 'school' | 'group' | 'student' | 'token';
        identifier: string;
        action: 'skipped' | 'overwritten' | 'errored';
    }>;
}

// Module augmentation: extend hydrooj's UserDocument and Collections interfaces.
declare module 'hydrooj' {
    interface UserDocument {
        realName?: string;
        studentId?: string;
        parentSchoolId?: ObjectId[];
        parentUserGroupId?: ObjectId[];
        /** Temporary OJ user created by Vigil proctor approval (Task 2). */
        isTemporary?: boolean;
    }

    interface Collections {
        'userbind.schools': School;
        'userbind.user_groups': UserGroup;
        'userbind.students': StudentRecord;
        'userbind.bind_tokens': BindToken;
        'userbind.binding_requests': BindingRequest;
    }

    interface Model {
        userbind: typeof import('./model').userBindModel;
    }
}
