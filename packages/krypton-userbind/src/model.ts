/**
 * userBindModel — all CRUD + business operations for krypton-userbind.
 *
 * Exposed on `hydrooj.Model.userbind` via module augmentation in `./types.ts`.
 * Phase 2/3 callers (Vigil integration, exam contest) depend on `lookupStudent`
 * and `claimTemporaryAccount` specifically — those are stable contracts.
 */
import { Filter, ObjectId } from 'mongodb';
import { ValidationError, UserModel } from 'hydrooj';
import {
    bindingRequestsColl,
    bindTokensColl,
    ensureIndexes,
    schoolsColl,
    studentsColl,
    userGroupsColl,
} from './db';
import type {
    BindToken,
    BindingRequest,
    ImportConflictPolicy,
    ImportReport,
    ImportStudentReport,
    ImportStudentRow,
    LookupStudentResult,
    School,
    StudentRecord,
    UserGroup,
} from './types';

export { ensureIndexes };

import { randomBytes } from 'node:crypto';

function randomTokenId(): string {
    return randomBytes(32).toString('hex');
}

function nowDate(): Date {
    return new Date();
}

// ─── Schools ──────────────────────────────────────────────────────────────

export async function createSchool(domainId: string, name: string, createdBy: number): Promise<School> {
    name = name.trim();
    if (!name) throw new ValidationError('name');
    const doc: School = {
        _id: new ObjectId(),
        domainId,
        name,
        createdAt: nowDate(),
        createdBy,
    };
    try {
        await schoolsColl.insertOne(doc);
    } catch (e: any) {
        if (e?.code === 11000) throw new ValidationError('name', null, 'School name already exists in this domain');
        throw e;
    }
    return doc;
}

export async function listSchools(domainId: string): Promise<School[]> {
    return await schoolsColl.find({ domainId }).sort({ createdAt: -1 }).toArray();
}

export async function getSchool(domainId: string, id: ObjectId): Promise<School | null> {
    return await schoolsColl.findOne({ domainId, _id: id });
}

export async function updateSchool(domainId: string, id: ObjectId, patch: { name?: string }): Promise<void> {
    const setOps: Partial<School> = {};
    if (typeof patch.name === 'string') {
        const name = patch.name.trim();
        if (!name) throw new ValidationError('name');
        setOps.name = name;
    }
    if (Object.keys(setOps).length === 0) return;
    try {
        await schoolsColl.updateOne({ domainId, _id: id }, { $set: setOps });
    } catch (e: any) {
        if (e?.code === 11000) throw new ValidationError('name', null, 'School name already exists in this domain');
        throw e;
    }
}

export async function deleteSchool(domainId: string, id: ObjectId): Promise<void> {
    const studentCount = await studentsColl.countDocuments({ domainId, schoolId: id });
    if (studentCount > 0) {
        throw new ValidationError(
            'school',
            null,
            `Cannot delete school: ${studentCount} student record(s) still belong to it`,
        );
    }
    const groupCount = await userGroupsColl.countDocuments({ domainId, schoolId: id });
    if (groupCount > 0) {
        throw new ValidationError(
            'school',
            null,
            `Cannot delete school: ${groupCount} user group(s) still belong to it`,
        );
    }
    await schoolsColl.deleteOne({ domainId, _id: id });
}

// ─── UserGroups ───────────────────────────────────────────────────────────

export async function createUserGroup(
    domainId: string, schoolId: ObjectId, name: string, createdBy: number,
): Promise<UserGroup> {
    name = name.trim();
    if (!name) throw new ValidationError('name');
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new ValidationError('schoolId', null, 'School not found');
    const doc: UserGroup = {
        _id: new ObjectId(),
        domainId,
        schoolId,
        name,
        createdAt: nowDate(),
        createdBy,
    };
    try {
        await userGroupsColl.insertOne(doc);
    } catch (e: any) {
        if (e?.code === 11000) throw new ValidationError('name', null, 'Group name already exists in this school');
        throw e;
    }
    return doc;
}

export async function listUserGroups(domainId: string, schoolId?: ObjectId): Promise<UserGroup[]> {
    const filter: Filter<UserGroup> = { domainId };
    if (schoolId) filter.schoolId = schoolId;
    return await userGroupsColl.find(filter).sort({ createdAt: -1 }).toArray();
}

export async function getUserGroup(domainId: string, id: ObjectId): Promise<UserGroup | null> {
    return await userGroupsColl.findOne({ domainId, _id: id });
}

export async function updateUserGroup(
    domainId: string, id: ObjectId, patch: { name?: string },
): Promise<void> {
    const setOps: Partial<UserGroup> = {};
    if (typeof patch.name === 'string') {
        const name = patch.name.trim();
        if (!name) throw new ValidationError('name');
        setOps.name = name;
    }
    if (Object.keys(setOps).length === 0) return;
    try {
        await userGroupsColl.updateOne({ domainId, _id: id }, { $set: setOps });
    } catch (e: any) {
        if (e?.code === 11000) throw new ValidationError('name', null, 'Group name already exists in this school');
        throw e;
    }
}

export async function deleteUserGroup(domainId: string, id: ObjectId): Promise<void> {
    // Remove group ref from any student that still has it.
    await studentsColl.updateMany(
        { domainId, groupIds: id },
        { $pull: { groupIds: id } as any },
    );
    await userGroupsColl.deleteOne({ domainId, _id: id });
}

// ─── Student records ──────────────────────────────────────────────────────

export async function importStudents(
    domainId: string,
    schoolId: ObjectId,
    rows: ImportStudentRow[],
    createdBy: number,
): Promise<ImportStudentReport> {
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new ValidationError('schoolId', null, 'School not found');

    const report: ImportStudentReport = { inserted: 0, duplicates: [] };
    if (rows.length === 0) return report;

    // Pre-check existing studentIds within this school.
    const existingIds = new Set(
        (await studentsColl.find(
            { domainId, schoolId, studentId: { $in: rows.map((r) => r.studentId) } },
            { projection: { studentId: 1 } },
        ).toArray()).map((d) => d.studentId),
    );

    const docs: StudentRecord[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const studentId = (row.studentId || '').trim();
        const realName = (row.realName || '').trim();
        if (!studentId || !realName) {
            report.duplicates.push({ studentId, reason: 'missing studentId or realName' });
            continue;
        }
        if (existingIds.has(studentId)) {
            report.duplicates.push({ studentId, reason: 'already exists in school' });
            continue;
        }
        if (seen.has(studentId)) {
            report.duplicates.push({ studentId, reason: 'duplicate within this batch' });
            continue;
        }
        seen.add(studentId);
        docs.push({
            _id: new ObjectId(),
            domainId,
            schoolId,
            studentId,
            realName,
            groupIds: [],
            boundUserId: null,
            boundAt: null,
            createdAt: nowDate(),
            createdBy,
        });
    }

    if (docs.length > 0) {
        await studentsColl.insertMany(docs);
        report.inserted = docs.length;
    }
    return report;
}

export interface ListStudentsFilter {
    schoolId?: ObjectId;
    groupId?: ObjectId;
    boundOnly?: boolean;
    unboundOnly?: boolean;
    query?: string;
    limit?: number;
    skip?: number;
}

export async function listStudents(
    domainId: string, filter: ListStudentsFilter = {},
): Promise<{ docs: StudentRecord[]; total: number }> {
    const mongoFilter: Filter<StudentRecord> = { domainId };
    if (filter.schoolId) mongoFilter.schoolId = filter.schoolId;
    if (filter.groupId) mongoFilter.groupIds = filter.groupId;
    if (filter.boundOnly) mongoFilter.boundUserId = { $ne: null };
    if (filter.unboundOnly) mongoFilter.boundUserId = null;
    if (filter.query) {
        const q = filter.query.trim();
        if (q) {
            mongoFilter.$or = [
                { studentId: { $regex: q, $options: 'i' } },
                { realName: { $regex: q, $options: 'i' } },
            ];
        }
    }
    const total = await studentsColl.countDocuments(mongoFilter);
    const docs = await studentsColl
        .find(mongoFilter)
        .sort({ studentId: 1 })
        .skip(filter.skip || 0)
        .limit(filter.limit || 100)
        .toArray();
    return { docs, total };
}

export async function getStudent(domainId: string, id: ObjectId): Promise<StudentRecord | null> {
    return await studentsColl.findOne({ domainId, _id: id });
}

export async function findStudentByStudentId(
    domainId: string, schoolId: ObjectId, studentId: string,
): Promise<StudentRecord | null> {
    return await studentsColl.findOne({ domainId, schoolId, studentId });
}

export async function deleteStudent(domainId: string, id: ObjectId): Promise<void> {
    const doc = await studentsColl.findOne({ domainId, _id: id });
    if (!doc) return;
    if (doc.boundUserId) {
        throw new ValidationError(
            'student',
            null,
            'Cannot delete a student record that is bound to a user; unbind first',
        );
    }
    // Drop any pending tokens for this student.
    await bindTokensColl.deleteMany({ studentRecordId: id, used: false });
    await studentsColl.deleteOne({ domainId, _id: id });
}

export async function assignStudentsToGroup(
    domainId: string, groupId: ObjectId, studentRecordIds: ObjectId[],
): Promise<void> {
    if (studentRecordIds.length === 0) return;
    const group = await userGroupsColl.findOne({ domainId, _id: groupId });
    if (!group) throw new ValidationError('groupId', null, 'Group not found');
    await studentsColl.updateMany(
        { domainId, _id: { $in: studentRecordIds }, schoolId: group.schoolId },
        { $addToSet: { groupIds: groupId } as any },
    );

    // Mirror group membership onto bound users.
    const bound = await studentsColl.find(
        { domainId, _id: { $in: studentRecordIds }, boundUserId: { $ne: null } },
        { projection: { boundUserId: 1 } },
    ).toArray();
    const uids = bound.map((d) => d.boundUserId!).filter(Boolean);
    if (uids.length > 0) {
        await UserModel.coll.updateMany(
            { _id: { $in: uids } },
            { $addToSet: { parentUserGroupId: groupId } as any },
        );
    }
}

export async function removeStudentsFromGroup(
    domainId: string, groupId: ObjectId, studentRecordIds: ObjectId[],
): Promise<void> {
    if (studentRecordIds.length === 0) return;
    const records = await studentsColl.find(
        { domainId, _id: { $in: studentRecordIds }, groupIds: groupId },
        { projection: { boundUserId: 1 } },
    ).toArray();
    await studentsColl.updateMany(
        { domainId, _id: { $in: studentRecordIds } },
        { $pull: { groupIds: groupId } as any },
    );
    const uids = records.map((d) => d.boundUserId!).filter(Boolean);
    if (uids.length > 0) {
        await UserModel.coll.updateMany(
            { _id: { $in: uids } },
            { $pull: { parentUserGroupId: groupId } as any },
        );
    }
}

// ─── userBindModel facade ─────────────────────────────────────────────────

/**
 * Public face of the module. Phase 2/3 code should depend ONLY on this object,
 * not on the individual functions above. Anything not exposed here is internal.
 *
 * Binding paths, lookupStudent, and claimTemporaryAccount are added in the
 * companion `binding.ts` file (Issue 1.5/1.6).
 */
export const userBindModel = {
    // Schools
    createSchool,
    listSchools,
    getSchool,
    updateSchool,
    deleteSchool,

    // Groups
    createUserGroup,
    listUserGroups,
    getUserGroup,
    updateUserGroup,
    deleteUserGroup,

    // Students
    importStudents,
    listStudents,
    getStudent,
    findStudentByStudentId,
    deleteStudent,
    assignStudentsToGroup,
    removeStudentsFromGroup,

    // Binding paths (defined in binding.ts; re-exported here for unified surface)
    // These will be set at module init by the binding.ts side-effect.
    generateInviteToken: null as unknown as (
        domainId: string, studentRecordId: ObjectId, createdBy: number, ttlMs?: number,
    ) => Promise<BindToken>,
    consumeInviteToken: null as unknown as (
        tokenId: string, userId: number,
    ) => Promise<{ studentRecord: StudentRecord; school: School }>,
    listInviteTokens: null as unknown as (
        domainId: string, filter?: { studentRecordId?: ObjectId; usedOnly?: boolean; unusedOnly?: boolean },
    ) => Promise<BindToken[]>,
    revokeInviteToken: null as unknown as (tokenId: string) => Promise<void>,

    submitBindingRequest: null as unknown as (
        domainId: string, userId: number, schoolId: ObjectId, studentIdInput: string, realNameInput: string,
    ) => Promise<BindingRequest>,
    listBindingRequests: null as unknown as (
        domainId: string, filter?: { status?: BindingRequest['status']; userId?: number; limit?: number; skip?: number },
    ) => Promise<{ docs: BindingRequest[]; total: number }>,
    approveBindingRequest: null as unknown as (
        requestId: ObjectId, reviewerUid: number,
    ) => Promise<void>,
    rejectBindingRequest: null as unknown as (
        requestId: ObjectId, reviewerUid: number, reason: string,
    ) => Promise<void>,

    lookupStudent: null as unknown as (
        domainId: string, studentIdInput: string, realNameInput: string,
    ) => Promise<LookupStudentResult>,

    claimTemporaryAccount: null as unknown as (
        tempUid: number, realUid: number,
    ) => Promise<{ recordsTransferred: number }>,

    // Cross-domain migration (Issue 1.13)
    exportDomain: null as unknown as (domainId: string) => Promise<unknown>,
    importDomain: null as unknown as (
        targetDomainId: string, pkg: unknown, policy: ImportConflictPolicy,
    ) => Promise<ImportReport>,
};
