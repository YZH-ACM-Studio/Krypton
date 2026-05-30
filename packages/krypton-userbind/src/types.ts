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
    /**
     * Enrollment year (入学年) e.g. 2024. Auto-derived from the first two
     * digits of `studentId` at create/edit time (240340179 → 2024), or null
     * if the prefix isn't a valid 2-digit year. Admins can override in the
     * student detail page — useful for non-standard student IDs or transfers.
     * Used by `TaskAccess.grade` and `TaskCondition.by_grade` (krypton-tasks).
     */
    enrollmentYear: number | null;
    createdAt: Date;
    createdBy: number;
}

/**
 * BindToken / 邀请绑定令牌. Three kinds:
 *
 * - `student`     — points at a specific StudentRecord; one-shot (used=true → never again).
 *                   Landing page: shows student info + inviter, single "确认绑定" button.
 *
 * - `school`      — points at a School; **shared, reusable**. Multiple students can
 *                   click the same link. Landing page collects studentId + realName
 *                   and matches against the school's StudentRecord roster. Four outcomes:
 *                     ① matched + unbound → bind & set studentId/realName/school/groups
 *                     ② matched + bound to self → no-op
 *                     ③ matched + bound to other user → reject
 *                     ④ no match → redirect to /user/bind/apply with school pre-selected
 *
 * - `user_group`  — points at a UserGroup (and implicitly its school via the group).
 *                   Same flow as `school` but also adds the user to that UserGroup
 *                   on success. The "申请" fallback (case ④) records `targetUserGroupId`
 *                   so the admin approval can auto-join the group.
 */
export type BindTokenKind = 'student' | 'school' | 'user_group';

interface BindTokenBase {
    _id: string;
    domainId: string;
    kind: BindTokenKind;
    createdAt: Date;
    createdBy: number;
    expiresAt: Date | null;
    /** For `student` kind: flipped to true once consumed. For `school` / `user_group`: ALWAYS false (shared link). */
    used: boolean;
    /** For `student` kind only — the uid that consumed it. */
    usedBy: number | null;
    usedAt: Date | null;
}

export interface StudentBindToken extends BindTokenBase {
    kind: 'student';
    studentRecordId: ObjectId;
    schoolId?: undefined;
    userGroupId?: undefined;
}

export interface SchoolBindToken extends BindTokenBase {
    kind: 'school';
    schoolId: ObjectId;
    studentRecordId?: undefined;
    userGroupId?: undefined;
}

export interface UserGroupBindToken extends BindTokenBase {
    kind: 'user_group';
    userGroupId: ObjectId;
    studentRecordId?: undefined;
    schoolId?: undefined;
}

export type BindToken = StudentBindToken | SchoolBindToken | UserGroupBindToken;

/**
 * BindingRequest / 绑定申请. Used by:
 *   - the apply flow (when school/user_group token finds no roster match)
 *   - the temporary-account claim flow (`claimTempUserId !== null`)
 *
 * If `sourceTokenId` is set, the approval flow knows to auto-join `targetUserGroupId`
 * (when set) after creating + binding the student record.
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
    /** Set when the request came from a school/user_group invite link. */
    sourceTokenId: string | null;
    /** If sourceTokenId points to a user_group token, this is that group. */
    targetUserGroupId: ObjectId | null;
    /** Set when the request is a claim of a temporary OJ user's records. */
    claimTempUserId: number | null;
}

/** Result of `lookupStudent(domainId, sid, realName)` — Phase 2 / 3 contract. */
export interface LookupStudentResult {
    found: boolean;
    userId?: number;
    /** Domain where the matched StudentRecord lives. */
    domainId?: string;
    /** Contest._id list of exam-rule contests the student is eligible to enter. */
    eligibleContestIds: ObjectId[];
    /** When `found` is false, the reason. */
    reason?: 'no_match' | 'not_bound' | 'name_mismatch' | 'school_not_specified' | 'ambiguous_match';
}

/** Used by the migration tool. */
export interface ImportStudentRow {
    studentId: string;
    realName: string;
}

export interface ImportStudentReport {
    inserted: number;
    duplicates: Array<{ studentId: string; reason: string }>;
    alreadyBound?: number;
    autoBound?: number;
    autoBindSkipped?: Array<{ studentId: string; reason: string }>;
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

/** Outcome of resolving a school/user_group token against a (studentId, realName) input. */
export type RosterLookupOutcome =
    | { kind: 'matched_unbound'; studentRecord: StudentRecord }
    | { kind: 'matched_self';    studentRecord: StudentRecord }
    | { kind: 'matched_other';   boundToUid: number }
    | { kind: 'no_match' };

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
