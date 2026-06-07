/**
 * userBindModel — all CRUD + business operations for krypton-userbind.
 *
 * Exposed on `hydrooj.Model.userbind` via module augmentation in `./types.ts`.
 * Phase 2/3 callers (Vigil integration, exam contest) depend on `lookupStudent`
 * and `claimTemporaryAccount` specifically — those are stable contracts.
 */
import type { Filter } from 'mongodb';
import { ObjectId, ValidationError, UserModel } from 'hydrooj';
import {
    bindTokensColl,
    ensureIndexes,
    schoolsColl,
    studentsColl,
    userGroupsColl,
} from './db';
import type {
    BindToken,
    BindTokenKind,
    BindingRequest,
    ImportConflictPolicy,
    ImportReport,
    ImportStudentReport,
    ImportStudentRow,
    LookupStudentResult,
    RosterLookupOutcome,
    School,
    SchoolBindToken,
    StudentBindToken,
    StudentRecord,
    UserGroup,
    UserGroupBindToken,
} from './types';

export { ensureIndexes };

function nowDate(): Date {
    return new Date();
}

function escapeRegexLiteral(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive enrollment year from a studentId. Convention: first two digits are
 * the last two digits of the enrollment year (e.g. `240340179` → 2024).
 *
 * Returns null if the first two chars aren't both digits — admin can then
 * override in the student detail page. We map yy→20yy unconditionally
 * because Krypton serves universities and the OJ won't outlive year 2099.
 */
export function deriveEnrollmentYear(studentId: string): number | null {
    if (!studentId || studentId.length < 2) return null;
    const yy = studentId.slice(0, 2);
    if (!/^\d{2}$/.test(yy)) return null;
    return 2000 + parseInt(yy, 10);
}

// ─── Roster validation helpers ────────────────────────────────────────────

/** studentId must be 1-64 chars of letters, digits, dash/underscore/dot. */
const STUDENT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
/** realName: 1-32 trimmed characters. We accept any non-control unicode. */
const REAL_NAME_MAX = 32;

export type RosterRowStatus = 'ok' | 'invalid_id' | 'invalid_name' | 'dup_in_batch' | 'dup_in_school' | 'empty';

export interface ParsedRosterRow {
    line: number;
    raw: string;
    studentId: string;
    realName: string;
    status: RosterRowStatus;
    reason?: string;
}

/** Parse pasted roster text into structured rows + per-row validation status. */
export function parseRosterText(text: string): ParsedRosterRow[] {
    const out: ParsedRosterRow[] = [];
    const seen = new Set<string>();
    const lines = (text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/[\s,;\t]+/).filter(Boolean);
        const studentId = (parts[0] || '').trim();
        const realName = parts.slice(1).join(' ').trim();
        const row: ParsedRosterRow = {
            line: i + 1, raw,
            studentId, realName,
            status: 'ok',
        };
        if (!studentId && !realName) {
            row.status = 'empty';
            row.reason = '空行（已跳过）';
        } else if (!STUDENT_ID_RE.test(studentId)) {
            row.status = 'invalid_id';
            row.reason = '学号必须为 1-64 位字母/数字/._-';
        } else if (!realName) {
            row.status = 'invalid_name';
            row.reason = '姓名不能为空';
        } else if (realName.length > REAL_NAME_MAX) {
            row.status = 'invalid_name';
            row.reason = `姓名超过 ${REAL_NAME_MAX} 字符`;
        } else if (seen.has(studentId)) {
            row.status = 'dup_in_batch';
            row.reason = '本批次内已出现该学号';
        } else {
            seen.add(studentId);
        }
        if (row.status === 'empty') continue;
        out.push(row);
    }
    return out;
}

export function isValidStudentId(id: string): boolean {
    return STUDENT_ID_RE.test(id);
}

export function isValidRealName(name: string): boolean {
    const t = (name || '').trim();
    return t.length > 0 && t.length <= REAL_NAME_MAX;
}

export interface AutoBindResult {
    alreadyBound: number;
    autoBound: number;
    autoBindSkipped: Array<{ studentId: string; reason: string }>;
}

function studentMatchKey(studentId: string, realName: string): string {
    return `${studentId}\u0000${realName}`;
}

async function autoBindStudentRecords(
    domainId: string,
    records: StudentRecord[],
    extraGroupIds: ObjectId[] = [],
    options: { includeNoMatch?: boolean } = {},
): Promise<AutoBindResult> {
    const report: AutoBindResult = {
        alreadyBound: records.filter((r) => !!r.boundUserId).length,
        autoBound: 0,
        autoBindSkipped: [],
    };
    const candidates = records.filter((r) => !r.boundUserId);
    if (candidates.length === 0) return report;

    const studentIds = Array.from(new Set(candidates.map((r) => r.studentId)));
    const users = await UserModel.coll.find(
        {
            studentId: { $in: studentIds },
        } as any,
        { projection: { _id: 1, studentId: 1, realName: 1 } },
    ).toArray();

    const usersByKey = new Map<string, Array<{ _id: number; studentId?: string; realName?: string }>>();
    for (const user of users) {
        const studentId = String(user.studentId || '').trim();
        const realName = String(user.realName || '').trim();
        if (!studentId || !realName) continue;
        const key = studentMatchKey(studentId, realName);
        const bucket = usersByKey.get(key) || [];
        bucket.push({ _id: user._id, studentId, realName });
        usersByKey.set(key, bucket);
    }

    for (const record of candidates) {
        const matches = usersByKey.get(studentMatchKey(record.studentId, record.realName)) || [];
        if (matches.length === 0) {
            if (options.includeNoMatch) {
                report.autoBindSkipped.push({ studentId: record.studentId, reason: '未找到同学号同姓名的 OJ 用户' });
            }
            continue;
        }
        if (matches.length > 1) {
            report.autoBindSkipped.push({ studentId: record.studentId, reason: '匹配到多个同学号同姓名的 OJ 用户' });
            continue;
        }
        const uid = matches[0]._id;
        const conflict = await studentsColl.findOne(
            {
                domainId,
                boundUserId: uid,
                _id: { $ne: record._id },
            } as any,
            { projection: { studentId: 1, realName: 1 } },
        );
        if (conflict) {
            report.autoBindSkipped.push({
                studentId: record.studentId,
                reason: `UID ${uid} 已绑定到 ${conflict.studentId} ${conflict.realName}`,
            });
            continue;
        }

        const studentUpdate: any = {
            $set: { boundUserId: uid, boundAt: nowDate() },
        };
        if (extraGroupIds.length > 0) {
            studentUpdate.$addToSet = { groupIds: { $each: extraGroupIds } };
        }
        const groupIds = Array.from(new Set([
            ...record.groupIds.map((g) => g.toString()),
            ...extraGroupIds.map((g) => g.toString()),
        ])).map((s) => new ObjectId(s));
        const userAddToSet: Record<string, any> = { parentSchoolId: record.schoolId as any };
        if (groupIds.length > 0) userAddToSet.parentUserGroupId = { $each: groupIds as any[] };
        await Promise.all([
            studentsColl.updateOne({ domainId, _id: record._id }, studentUpdate),
            UserModel.coll.updateOne(
                { _id: uid },
                {
                    $set: {
                        studentId: record.studentId,
                        realName: record.realName,
                    } as any,
                    $addToSet: userAddToSet as any,
                },
            ),
        ]);
        report.autoBound++;
    }
    return report;
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

    const report: ImportStudentReport = {
        inserted: 0, duplicates: [], alreadyBound: 0, autoBound: 0, autoBindSkipped: [],
    };
    if (rows.length === 0) return report;

    // Pre-check existing studentIds within this school.
    const existingRecords = await studentsColl.find(
            { domainId, schoolId, studentId: { $in: rows.map((r) => r.studentId) } },
        ).toArray();
    const existingByStudentId = new Map(existingRecords.map((d) => [d.studentId, d]));

    const docs: StudentRecord[] = [];
    const autoBindCandidates: StudentRecord[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const studentId = (row.studentId || '').trim();
        const realName = (row.realName || '').trim();
        if (!studentId || !realName) {
            report.duplicates.push({ studentId, reason: '学号或姓名为空' });
            continue;
        }
        if (!isValidStudentId(studentId)) {
            report.duplicates.push({ studentId, reason: '学号格式非法（1-64 位字母/数字/._-）' });
            continue;
        }
        if (!isValidRealName(realName)) {
            report.duplicates.push({ studentId, reason: `姓名为空或超过 ${REAL_NAME_MAX} 字符` });
            continue;
        }
        if (seen.has(studentId)) {
            report.duplicates.push({ studentId, reason: '本批次内重复' });
            continue;
        }
        seen.add(studentId);
        const existing = existingByStudentId.get(studentId);
        if (existing) {
            if (existing.realName === realName) autoBindCandidates.push(existing);
            report.duplicates.push({
                studentId,
                reason: existing.realName === realName
                    ? '该学校已存在同学号'
                    : `该学校已存在同学号（库内"${existing.realName}"）`,
            });
            continue;
        }
        docs.push({
            _id: new ObjectId(),
            domainId,
            schoolId,
            studentId,
            realName,
            groupIds: [],
            boundUserId: null,
            boundAt: null,
            enrollmentYear: deriveEnrollmentYear(studentId),
            createdAt: nowDate(),
            createdBy,
        });
    }

    if (docs.length > 0) {
        await studentsColl.insertMany(docs);
        autoBindCandidates.push(...docs);
        report.inserted = docs.length;
    }
    const autoBindReport = await autoBindStudentRecords(domainId, autoBindCandidates);
    report.alreadyBound = autoBindReport.alreadyBound;
    report.autoBound = autoBindReport.autoBound;
    report.autoBindSkipped = autoBindReport.autoBindSkipped;
    return report;
}

export interface SearchBindableUserResult {
    _id: number;
    uname?: string;
    studentId: string;
    realName: string;
    boundUserId: number;
}

export async function searchBindableUsers(
    domainId: string,
    schoolId: ObjectId,
    query: string,
    limit = 50,
): Promise<SearchBindableUserResult[]> {
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new ValidationError('schoolId', null, 'School not found');
    const q = (query || '').trim();
    if (!q) return [];
    const regex = new RegExp(escapeRegexLiteral(q), 'i');
    const users = await UserModel.coll.find(
        {
            studentId: { $exists: true, $ne: '' },
            realName: { $exists: true, $ne: '' },
            $or: [
                { studentId: { $regex: regex } },
                { realName: { $regex: regex } },
                { uname: { $regex: regex } },
            ],
        } as any,
        { projection: { _id: 1, uname: 1, studentId: 1, realName: 1 } },
    ).limit(limit).toArray();
    return users.map((u: any) => ({
        _id: u._id,
        uname: u.uname,
        studentId: u.studentId,
        realName: u.realName,
        boundUserId: u._id,
    }));
}

export async function importUsersToSchool(
    domainId: string,
    schoolId: ObjectId,
    userIds: number[],
    createdBy: number,
): Promise<ImportStudentReport> {
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new ValidationError('schoolId', null, 'School not found');
    const report: ImportStudentReport = {
        inserted: 0, duplicates: [], alreadyBound: 0, autoBound: 0, autoBindSkipped: [],
    };
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
    if (uniqueUserIds.length === 0) return report;

    const users = await UserModel.coll.find(
        { _id: { $in: uniqueUserIds } },
        { projection: { _id: 1, studentId: 1, realName: 1 } },
    ).toArray();
    const docs: StudentRecord[] = [];
    const autoBindCandidates: StudentRecord[] = [];
    const seenStudentIds = new Set<string>();

    for (const user of users as any[]) {
        const studentId = String(user.studentId || '').trim();
        const realName = String(user.realName || '').trim();
        if (!studentId || !realName) {
            report.duplicates.push({ studentId: studentId || `UID ${user._id}`, reason: '该用户缺少学号或姓名' });
            continue;
        }
        if (!isValidStudentId(studentId) || !isValidRealName(realName)) {
            report.duplicates.push({ studentId, reason: '该用户的学号或姓名格式非法' });
            continue;
        }
        if (seenStudentIds.has(studentId)) {
            report.duplicates.push({ studentId, reason: '本次选择中学号重复' });
            continue;
        }
        seenStudentIds.add(studentId);

        const existing = await studentsColl.findOne({ domainId, schoolId, studentId });
        if (existing) {
            if (existing.realName !== realName) {
                report.duplicates.push({
                    studentId,
                    reason: `已存在记录但姓名不一致（库内"${existing.realName}"）`,
                });
                continue;
            }
            autoBindCandidates.push(existing);
            report.duplicates.push({ studentId, reason: '该学校已存在同学号' });
            continue;
        }

        docs.push({
            _id: new ObjectId(),
            domainId,
            schoolId,
            studentId,
            realName,
            groupIds: [],
            boundUserId: null,
            boundAt: null,
            enrollmentYear: deriveEnrollmentYear(studentId),
            createdAt: nowDate(),
            createdBy,
        });
    }

    if (docs.length > 0) {
        await studentsColl.insertMany(docs);
        report.inserted = docs.length;
        autoBindCandidates.push(...docs);
    }
    const autoBindReport = await autoBindStudentRecords(domainId, autoBindCandidates);
    report.alreadyBound = autoBindReport.alreadyBound;
    report.autoBound = autoBindReport.autoBound;
    report.autoBindSkipped = autoBindReport.autoBindSkipped;
    return report;
}

/**
 * Import roster rows directly into a user group: creates any missing student
 * records in the group's parent school AND adds them all (existing + new) to
 * the group. Returns rich report: how many created, how many attached, how
 * many were already group members, how many failed validation.
 */
export interface ImportGroupReport {
    /** Newly created student records in the parent school. */
    created: number;
    /** Existing students that got added to the group. */
    attached: number;
    /** Students that were already members (no-op). */
    alreadyMember: number;
    /** Failed validation, per row. */
    failed: Array<{ studentId: string; reason: string }>;
    /** Existing OJ accounts that were matched exactly and bound while importing. */
    autoBound: number;
    /** Student records that were already bound before this import. */
    alreadyBound: number;
    /** Exact-match OJ accounts that could not be auto-bound. */
    autoBindSkipped: Array<{ studentId: string; reason: string }>;
}

export async function importStudentsToGroup(
    domainId: string,
    groupId: ObjectId,
    rows: ImportStudentRow[],
    createdBy: number,
): Promise<ImportGroupReport> {
    const group = await userGroupsColl.findOne({ domainId, _id: groupId });
    if (!group) throw new ValidationError('groupId', null, '用户组不存在');
    const schoolId = group.schoolId;

    const report: ImportGroupReport = {
        created: 0, attached: 0, alreadyMember: 0, failed: [], autoBound: 0, alreadyBound: 0, autoBindSkipped: [],
    };
    if (rows.length === 0) return report;

    // Look up existing students by studentId within this school in one shot.
    const studentIds = rows.map((r) => (r.studentId || '').trim()).filter(Boolean);
    const existingRecords = await studentsColl.find({
        domainId, schoolId, studentId: { $in: studentIds },
    }).toArray();
    const existingByStudentId = new Map(existingRecords.map((r) => [r.studentId, r]));

    const toCreate: StudentRecord[] = [];
    const toAttach: ObjectId[] = [];
    const autoBindCandidates: StudentRecord[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
        const studentId = (row.studentId || '').trim();
        const realName = (row.realName || '').trim();
        if (!studentId || !realName) {
            report.failed.push({ studentId, reason: '学号或姓名为空' });
            continue;
        }
        if (!isValidStudentId(studentId)) {
            report.failed.push({ studentId, reason: '学号格式非法' });
            continue;
        }
        if (!isValidRealName(realName)) {
            report.failed.push({ studentId, reason: '姓名格式非法' });
            continue;
        }
        if (seen.has(studentId)) {
            report.failed.push({ studentId, reason: '本批次内重复' });
            continue;
        }
        seen.add(studentId);

        const existing = existingByStudentId.get(studentId);
        if (existing) {
            if (existing.realName !== realName) {
                report.failed.push({
                    studentId,
                    reason: `已存在记录但姓名不一致（库内"${existing.realName}"）`,
                });
                continue;
            }
            if (existing.groupIds.some((g) => g.equals(groupId))) {
                report.alreadyMember++;
            } else {
                toAttach.push(existing._id);
                report.attached++;
            }
            autoBindCandidates.push(existing);
        } else {
            toCreate.push({
                _id: new ObjectId(),
                domainId,
                schoolId,
                studentId,
                realName,
                groupIds: [groupId],
                boundUserId: null,
                boundAt: null,
                enrollmentYear: deriveEnrollmentYear(studentId),
                createdAt: nowDate(),
                createdBy,
            });
            report.created++;
        }
    }

    if (toCreate.length > 0) {
        await studentsColl.insertMany(toCreate);
        autoBindCandidates.push(...toCreate);
    }
    if (toAttach.length > 0) {
        await studentsColl.updateMany(
            { _id: { $in: toAttach } },
            { $addToSet: { groupIds: groupId as any } },
        );
        // Mirror onto already-bound users so their parentUserGroupId reflects membership.
        const bound = await studentsColl.find(
            { _id: { $in: toAttach }, boundUserId: { $ne: null } },
            { projection: { boundUserId: 1 } },
        ).toArray();
        const uids = bound.map((d) => d.boundUserId!).filter(Boolean);
        if (uids.length > 0) {
            await UserModel.coll.updateMany(
                { _id: { $in: uids } },
                { $addToSet: { parentUserGroupId: groupId as any } },
            );
        }
    }
    const autoBindReport = await autoBindStudentRecords(domainId, autoBindCandidates, [groupId]);
    report.autoBound = autoBindReport.autoBound;
    report.alreadyBound = autoBindReport.alreadyBound;
    report.autoBindSkipped = autoBindReport.autoBindSkipped;
    return report;
}

export interface RetryGroupAutoBindReport {
    unboundScanned: number;
    alreadyBound: number;
    autoBound: number;
    autoBindSkipped: Array<{ studentId: string; reason: string }>;
}

export async function retryAutoBindStudentsInGroup(
    domainId: string,
    groupId: ObjectId,
): Promise<RetryGroupAutoBindReport> {
    const group = await userGroupsColl.findOne({ domainId, _id: groupId });
    if (!group) throw new ValidationError('groupId', null, '用户组不存在');
    const records = await studentsColl.find({
        domainId,
        schoolId: group.schoolId,
        groupIds: groupId,
        $or: [{ boundUserId: null }, { boundUserId: { $exists: false } }],
    } as any).toArray();
    const autoBindReport = await autoBindStudentRecords(
        domainId,
        records,
        [],
        { includeNoMatch: true },
    );
    return {
        unboundScanned: records.length,
        alreadyBound: autoBindReport.alreadyBound,
        autoBound: autoBindReport.autoBound,
        autoBindSkipped: autoBindReport.autoBindSkipped,
    };
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

/**
 * Find ALL student records matching a studentId within a domain. studentId is
 * unique only per (schoolId), so cross-school collisions are possible — callers
 * needing exactly one student should treat `length !== 1` as unresolved
 * (0 = not found, >1 = ambiguous across schools). Exact match — no fuzzy regex
 * or result limit. Used by krypton-tasks score entry/import to resolve
 * studentId → studentDocId safely (the scores are keyed by studentDocId).
 */
export async function findStudentsByStudentId(
    domainId: string, studentId: string,
): Promise<StudentRecord[]> {
    return await studentsColl.find({ domainId, studentId }).toArray();
}

/**
 * Find the student record bound to a given OJ user. Returns null if the user
 * has no binding in this domain. Used by sibling plugins (e.g. krypton-tasks)
 * to resolve a user's school / group membership without reaching into our
 * collections directly.
 */
export async function findStudentByUserId(
    domainId: string, userId: number,
): Promise<StudentRecord | null> {
    return await studentsColl.findOne({ domainId, boundUserId: userId });
}

/**
 * Batch lookup students for a set of bound user ids — returns a dict keyed
 * by uid (string) for cheap O(1) frontend access. Used by /record + /ranking
 * to show "学号 / 姓名" in the admin-only column without per-row roundtrips.
 */
export async function findStudentsByUserIds(
    domainId: string, userIds: number[],
): Promise<Record<string, StudentRecord>> {
    if (!userIds.length) return {};
    const docs = await studentsColl
        .find({ domainId, boundUserId: { $in: userIds } })
        .toArray();
    const out: Record<string, StudentRecord> = {};
    for (const d of docs) {
        if (d.boundUserId != null) out[String(d.boundUserId)] = d;
    }
    return out;
}

/**
 * Update mutable student fields. Admin-only. Pass `enrollmentYear: null`
 * explicitly to clear it; `undefined` leaves it unchanged. `realName` and
 * `groupIds` patches are also accepted — useful for typo fixes and class
 * reassignments.
 */
export async function updateStudent(
    domainId: string,
    id: ObjectId,
    patch: {
        realName?: string;
        enrollmentYear?: number | null;
        groupIds?: ObjectId[];
    },
): Promise<void> {
    const $set: Partial<StudentRecord> = {};
    if (typeof patch.realName === 'string') {
        const trimmed = patch.realName.trim();
        if (!isValidRealName(trimmed)) {
            throw new ValidationError('realName', null, '姓名格式非法');
        }
        $set.realName = trimmed;
    }
    if (patch.enrollmentYear !== undefined) {
        if (patch.enrollmentYear !== null
            && (!Number.isInteger(patch.enrollmentYear)
                || patch.enrollmentYear < 1900
                || patch.enrollmentYear > 2099)) {
            throw new ValidationError('enrollmentYear', null, '年份范围必须在 1900–2099');
        }
        $set.enrollmentYear = patch.enrollmentYear;
    }
    if (patch.groupIds) {
        $set.groupIds = patch.groupIds;
    }
    if (Object.keys($set).length === 0) return;
    await studentsColl.updateOne({ domainId, _id: id }, { $set });
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
    importStudentsToGroup,
    importUsersToSchool,
    retryAutoBindStudentsInGroup,
    searchBindableUsers,
    listStudents,
    getStudent,
    findStudentByStudentId,
    findStudentsByStudentId,
    findStudentByUserId,
    findStudentsByUserIds,
    updateStudent,
    deleteStudent,
    assignStudentsToGroup,
    removeStudentsFromGroup,
    parseRosterText,
    isValidStudentId,
    isValidRealName,
    deriveEnrollmentYear,

    // Binding paths (defined in binding.ts; re-exported here for unified surface)
    // These will be set at module init by the binding.ts side-effect.
    /** @deprecated kept for legacy callers — alias of generateStudentInviteToken */
    generateInviteToken: null as unknown as (
        domainId: string, studentRecordId: ObjectId, createdBy: number, ttlMs?: number,
    ) => Promise<StudentBindToken>,
    generateStudentInviteToken: null as unknown as (
        domainId: string, studentRecordId: ObjectId, createdBy: number, ttlMs?: number,
    ) => Promise<StudentBindToken>,
    generateSchoolInviteToken: null as unknown as (
        domainId: string, schoolId: ObjectId, createdBy: number, ttlMs?: number,
    ) => Promise<SchoolBindToken>,
    generateUserGroupInviteToken: null as unknown as (
        domainId: string, userGroupId: ObjectId, createdBy: number, ttlMs?: number,
    ) => Promise<UserGroupBindToken>,
    /** @deprecated routes to consumeStudentInviteToken for kind='student' */
    consumeInviteToken: null as unknown as (
        tokenId: string, userId: number,
    ) => Promise<{ studentRecord: StudentRecord; school: School }>,
    consumeStudentInviteToken: null as unknown as (
        tokenId: string, userId: number,
    ) => Promise<{ studentRecord: StudentRecord; school: School }>,
    bindMatchedStudent: null as unknown as (
        record: StudentRecord, userId: number, extraGroupId?: ObjectId,
    ) => Promise<{ studentRecord: StudentRecord; school: School }>,
    joinUserGroup: null as unknown as (
        userId: number, studentRecord: StudentRecord, userGroupId: ObjectId,
    ) => Promise<void>,
    getInviteToken: null as unknown as (tokenId: string) => Promise<BindToken>,
    rosterLookup: null as unknown as (
        domainId: string, schoolId: ObjectId, studentIdInput: string, realNameInput: string, callerUid: number,
    ) => Promise<RosterLookupOutcome>,
    listInviteTokens: null as unknown as (
        domainId: string, filter?: { studentRecordId?: ObjectId; schoolId?: ObjectId; userGroupId?: ObjectId; kind?: BindTokenKind; usedOnly?: boolean; unusedOnly?: boolean },
    ) => Promise<BindToken[]>,
    revokeInviteToken: null as unknown as (tokenId: string) => Promise<void>,

    submitBindingRequest: null as unknown as (
        domainId: string, userId: number, schoolId: ObjectId, studentIdInput: string, realNameInput: string,
        opts?: { sourceTokenId?: string; targetUserGroupId?: ObjectId; claimTempUserId?: number },
    ) => Promise<BindingRequest>,
    listBindingRequests: null as unknown as (
        domainId: string, filter?: { status?: BindingRequest['status']; userId?: number; schoolId?: ObjectId; limit?: number; skip?: number },
    ) => Promise<{ docs: BindingRequest[]; total: number }>,
    getBindingRequest: null as unknown as (id: ObjectId) => Promise<BindingRequest | null>,
    approveBindingRequest: null as unknown as (
        requestId: ObjectId, reviewerUid: number,
    ) => Promise<void>,
    rejectBindingRequest: null as unknown as (
        requestId: ObjectId, reviewerUid: number, reason: string,
    ) => Promise<void>,

    lookupStudent: null as unknown as (
        domainId: string, studentIdInput: string, realNameInput: string,
        options?: { contestId?: string },
    ) => Promise<LookupStudentResult>,
    /** @deprecated use computeEligibleContests */
    computeEligibleExamContests: null as unknown as (
        domainId: string, uid: number,
    ) => Promise<ObjectId[]>,
    computeEligibleContests: null as unknown as (
        domainId: string, uid: number,
    ) => Promise<ObjectId[]>,

    claimTemporaryAccount: null as unknown as (
        tempUid: number, realUid: number,
    ) => Promise<{ recordsTransferred: number }>,
    findClaimCandidates: null as unknown as (
        domainId: string, studentIdInput: string, realNameInput: string,
    ) => Promise<Array<{ uid: number; uname: string; createdAt: Date; schoolId: ObjectId | null }>>,

    // Cross-domain migration (Issue 1.13)
    exportDomain: null as unknown as (domainId: string) => Promise<unknown>,
    importDomain: null as unknown as (
        targetDomainId: string, pkg: unknown, policy: ImportConflictPolicy,
    ) => Promise<ImportReport>,
};
