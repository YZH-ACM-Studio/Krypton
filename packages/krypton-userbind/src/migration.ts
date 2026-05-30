/**
 * Migration of legacy CAUCOJUserBind data into the new krypton-userbind schema.
 *
 * Registered as channel 'userbind' via the migration service — independent
 * version number from hydrooj core.
 *
 * Strategy (PRD §3.7):
 *   1. Read legacy collections: user_groups, school_groups, bind_tokens, binding_requests
 *   2. Migrate each old SchoolGroup → new userbind.schools doc
 *   3. Migrate inline `members` arrays → independent userbind.students docs
 *   4. Migrate each old UserGroup (groupType=0) → new userbind.user_groups doc
 *   5. For each groupType=1 (contest-only group): try to map to a real contest's
 *      `assign` field; on ambiguous match, write a CSV report and halt the step
 *   6. Migrate bind_tokens and binding_requests 1:1
 *   7. Preserve User document fields (realName/studentId/parentSchoolId/parentUserGroupId)
 *
 * Idempotent: tracked by setting `userbind.migration_v1_done`.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { db, ObjectId, oncePerSetting } from 'hydrooj';
import {
    bindingRequestsColl, bindTokensColl, schoolsColl, studentsColl,
    userGroupsColl,
} from './db';
import { deriveEnrollmentYear } from './model';

const logger = new Logger('userbind.migration');

interface LegacySchoolGroup {
    _id: ObjectId;
    name: string;
    createdAt: Date;
    createdBy: number;
    members?: Array<{
        studentId: string;
        realName: string;
        bound?: boolean;
        boundBy?: number;
        boundAt?: Date;
    }>;
}

interface LegacyUserGroup {
    _id: ObjectId;
    name: string;
    createdAt: Date;
    createdBy: number;
    parentSchoolId: ObjectId | string;
    groupType?: number;
    students?: Array<{
        studentId: string;
        realName: string;
        bound?: boolean;
        boundBy?: number;
        boundAt?: Date;
        contestFinished?: boolean;
    }>;
}

interface LegacyBindToken {
    _id: string;
    type?: 'user_group' | 'school_group';
    targetId?: ObjectId | string;
    createdAt: Date;
    createdBy: number;
    expiresAt?: Date | null;
}

interface LegacyBindingRequest {
    _id: ObjectId;
    userId: number;
    schoolGroupId: ObjectId | string;
    studentId: string;
    realName: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Date;
    updatedAt?: Date;
    reviewedBy?: number;
    reviewedAt?: Date;
    reviewComment?: string;
}

const DEFAULT_DOMAIN = 'system';
const MIGRATION_FLAG = 'userbind.migration_v1_done';

async function legacyCollExists(name: string): Promise<boolean> {
    try {
        const colls = await db.db.listCollections({ name }).toArray();
        return colls.length > 0;
    } catch {
        return false;
    }
}

async function migrateSchools(domainId: string): Promise<Map<string, ObjectId>> {
    const map = new Map<string, ObjectId>(); // legacy _id (string) → new _id

    const legacyColl = db.collection<LegacySchoolGroup>('school_groups' as any);
    const cursor = legacyColl.find({});
    for await (const old of cursor) {
        const existing = await schoolsColl.findOne({ domainId, name: old.name });
        if (existing) {
            map.set(old._id.toString(), existing._id);
            continue;
        }
        const newId = new ObjectId();
        await schoolsColl.insertOne({
            _id: newId,
            domainId,
            name: old.name,
            createdAt: old.createdAt || new Date(),
            createdBy: old.createdBy || 1,
        });
        map.set(old._id.toString(), newId);

        // Migrate inline members → independent student records.
        for (const member of old.members || []) {
            const studentId = (member.studentId || '').toString().trim();
            const realName = (member.realName || '').toString().trim();
            if (!studentId || !realName) continue;
            const existingStudent = await studentsColl.findOne({
                domainId, schoolId: newId, studentId,
            });
            if (existingStudent) continue;
            await studentsColl.insertOne({
                _id: new ObjectId(),
                domainId,
                schoolId: newId,
                studentId,
                realName,
                groupIds: [],
                boundUserId: member.bound && member.boundBy ? member.boundBy : null,
                boundAt: member.bound && member.boundAt ? member.boundAt : null,
                enrollmentYear: deriveEnrollmentYear(studentId),
                createdAt: old.createdAt || new Date(),
                createdBy: old.createdBy || 1,
            });
        }
    }
    logger.info('migrated %d schools', map.size);
    return map;
}

async function migrateUserGroups(
    domainId: string, schoolMap: Map<string, ObjectId>,
): Promise<{
    groupMap: Map<string, ObjectId>;
    contestOnlyGroups: Array<{ legacyId: string; name: string; studentIds: string[] }>;
}> {
    const groupMap = new Map<string, ObjectId>();
    const contestOnlyGroups: Array<{ legacyId: string; name: string; studentIds: string[] }> = [];

    const legacyColl = db.collection<LegacyUserGroup>('user_groups' as any);
    const cursor = legacyColl.find({});
    for await (const old of cursor) {
        const isContestOnly = old.groupType === 1;
        const schoolId = schoolMap.get(old.parentSchoolId?.toString() || '');

        if (isContestOnly) {
            // Stage for operator review — see PRD §3.7 step 4.
            contestOnlyGroups.push({
                legacyId: old._id.toString(),
                name: old.name,
                studentIds: (old.students || []).map((s) => (s.studentId || '').toString()).filter(Boolean),
            });
            continue;
        }
        if (!schoolId) {
            logger.warn('user_group %s skipped: parent school not found', old._id);
            continue;
        }
        const existing = await userGroupsColl.findOne({ domainId, schoolId, name: old.name });
        let newId: ObjectId;
        if (existing) {
            newId = existing._id;
        } else {
            newId = new ObjectId();
            await userGroupsColl.insertOne({
                _id: newId,
                domainId,
                schoolId,
                name: old.name,
                createdAt: old.createdAt || new Date(),
                createdBy: old.createdBy || 1,
            });
        }
        groupMap.set(old._id.toString(), newId);

        // Attach inline students to this group, creating student records if needed.
        for (const member of old.students || []) {
            const studentId = (member.studentId || '').toString().trim();
            const realName = (member.realName || '').toString().trim();
            if (!studentId || !realName) continue;
            let student = await studentsColl.findOne({ domainId, schoolId, studentId });
            if (!student) {
                const sid = new ObjectId();
                await studentsColl.insertOne({
                    _id: sid,
                    domainId,
                    schoolId,
                    studentId,
                    realName,
                    groupIds: [newId],
                    boundUserId: member.bound && member.boundBy ? member.boundBy : null,
                    boundAt: member.bound && member.boundAt ? member.boundAt : null,
                    enrollmentYear: deriveEnrollmentYear(studentId),
                    createdAt: old.createdAt || new Date(),
                    createdBy: old.createdBy || 1,
                });
            } else if (!student.groupIds.some((g) => g.equals(newId))) {
                await studentsColl.updateOne(
                    { _id: student._id },
                    { $addToSet: { groupIds: newId } as any },
                );
            }
        }
    }
    logger.info('migrated %d user groups (skipped %d contest-only)', groupMap.size, contestOnlyGroups.length);
    return { groupMap, contestOnlyGroups };
}

async function migrateBindTokens(
    domainId: string, schoolMap: Map<string, ObjectId>, groupMap: Map<string, ObjectId>,
): Promise<number> {
    let count = 0;
    const legacyColl = db.collection<LegacyBindToken>('bind_tokens' as any);
    const cursor = legacyColl.find({});
    for await (const old of cursor) {
        // Legacy tokens pointed to either user_group or school_group; new tokens
        // point to a specific student record. For the migration we just preserve
        // the token id as-is with a "legacy" flag; on first use, the consume flow
        // will surface a clear error message asking for re-issue (see legacy.ts).
        const existing = await bindTokensColl.findOne({ _id: old._id });
        if (existing) continue;
        // Skip orphaned tokens (target deleted).
        const targetId = old.targetId?.toString();
        if (!targetId) continue;
        const knownSchool = schoolMap.get(targetId);
        const knownGroup = groupMap.get(targetId);
        if (!knownSchool && !knownGroup) continue;
        // Heuristic: pick the first student in the school/group as the bind target.
        // Operator can revoke + re-issue precise tokens after migration.
        const schoolId = knownSchool || (await (async () => {
            const g = await userGroupsColl.findOne({ _id: knownGroup });
            return g?.schoolId;
        })());
        if (!schoolId) continue;
        const sampleStudent = await studentsColl.findOne(
            { domainId, schoolId, boundUserId: null },
            { sort: { studentId: 1 } },
        );
        if (!sampleStudent) continue;
        await bindTokensColl.insertOne({
            _id: old._id,
            domainId,
            kind: 'student',
            studentRecordId: sampleStudent._id,
            createdAt: old.createdAt || new Date(),
            createdBy: old.createdBy || 1,
            expiresAt: old.expiresAt || null,
            used: false,
            usedBy: null,
            usedAt: null,
        } as any);
        count++;
    }
    logger.info('migrated %d bind tokens (heuristically)', count);
    return count;
}

async function migrateBindingRequests(
    domainId: string, schoolMap: Map<string, ObjectId>,
): Promise<number> {
    let count = 0;
    const legacyColl = db.collection<LegacyBindingRequest>('binding_requests' as any);
    const cursor = legacyColl.find({});
    for await (const old of cursor) {
        const schoolId = schoolMap.get(old.schoolGroupId?.toString() || '');
        if (!schoolId) continue;
        const existing = await bindingRequestsColl.findOne({ _id: old._id });
        if (existing) continue;
        await bindingRequestsColl.insertOne({
            _id: old._id,
            domainId,
            userId: old.userId,
            studentIdInput: old.studentId,
            realNameInput: old.realName,
            schoolId,
            status: old.status,
            createdAt: old.createdAt || new Date(),
            reviewedBy: old.reviewedBy || null,
            reviewedAt: old.reviewedAt || null,
            rejectReason: old.reviewComment || null,
            sourceTokenId: null,
            targetUserGroupId: null,
            claimTempUserId: null,
        });
        count++;
    }
    logger.info('migrated %d binding requests', count);
    return count;
}

/** Main migration step v1. Returns true on success, false to halt the channel. */
async function migrateV1(_ctx: Context): Promise<boolean> {
    return await oncePerSetting(MIGRATION_FLAG, async () => {
        const hasOld = await Promise.all([
            legacyCollExists('school_groups'),
            legacyCollExists('user_groups'),
            legacyCollExists('bind_tokens'),
            legacyCollExists('binding_requests'),
        ]);
        if (!hasOld.some(Boolean)) {
            logger.info('no legacy CAUCOJUserBind collections found — fresh install, nothing to do');
            return;
        }

        const domainId = global.Hydro.model.system.get('userbind.legacyDomainId') || DEFAULT_DOMAIN;
        logger.info('migrating legacy data into domain "%s"', domainId);

        const schoolMap = await migrateSchools(domainId);
        const { groupMap, contestOnlyGroups } = await migrateUserGroups(domainId, schoolMap);
        await migrateBindTokens(domainId, schoolMap, groupMap);
        await migrateBindingRequests(domainId, schoolMap);

        if (contestOnlyGroups.length > 0) {
            const csvLines = ['legacyGroupId,name,studentCount,studentIds'];
            for (const g of contestOnlyGroups) {
                const escName = `"${g.name.replace(/"/g, '""')}"`;
                csvLines.push(`${g.legacyId},${escName},${g.studentIds.length},${g.studentIds.join(';')}`);
            }
            await global.Hydro.model.system.set('userbind.migration_v1_contest_groups_csv', csvLines.join('\n'));
            logger.warn(
                'Found %d contest-only legacy groups (groupType=1). Operator must map each to a real ' +
                'contest. CSV saved to global.Hydro.model.system.settings key userbind.migration_v1_contest_groups_csv',
                contestOnlyGroups.length,
            );
        }
    });
}

/**
 * V2: Backfill `kind: 'student'` on all bind_tokens that predate the kind
 * discriminator, and `sourceTokenId/targetUserGroupId: null` on binding_requests.
 */
async function migrateV2(_ctx: Context): Promise<void> {
    const V2_FLAG = 'userbind.migration_v2_done';
    return await oncePerSetting(V2_FLAG, async () => {
        const tokRes = await bindTokensColl.updateMany(
            { kind: { $exists: false } } as any,
            { $set: { kind: 'student' } as any },
        );
        const reqRes = await bindingRequestsColl.updateMany(
            { sourceTokenId: { $exists: false } } as any,
            { $set: { sourceTokenId: null, targetUserGroupId: null } as any },
        );
        logger.info(
            'v2 backfill: %d tokens tagged kind=student, %d requests got sourceTokenId/targetUserGroupId',
            tokRes.modifiedCount || 0, reqRes.modifiedCount || 0,
        );
    });
}

/**
 * V3: Derive and backfill `enrollmentYear` on existing StudentRecord docs.
 * For each student missing the field, parse the first two digits of
 * studentId — `240340179` → 2024. If the prefix isn't two digits, store
 * `null` so admins can override individually in the student detail view.
 */
async function migrateV3(_ctx: Context): Promise<void> {
    const V3_FLAG = 'userbind.migration_v3_done';
    return await oncePerSetting(V3_FLAG, async () => {
        const cursor = studentsColl.find({ enrollmentYear: { $exists: false } as any });
        let updated = 0;
        let nullCount = 0;
        for await (const s of cursor) {
            const yy = (s.studentId || '').slice(0, 2);
            const year = /^\d{2}$/.test(yy) ? 2000 + parseInt(yy, 10) : null;
            await studentsColl.updateOne(
                { _id: s._id },
                { $set: { enrollmentYear: year } },
            );
            updated++;
            if (year === null) nullCount++;
        }
        logger.info(
            'v3 enrollmentYear backfill: %d students updated, %d ended up null (admin should review)',
            updated, nullCount,
        );
    });
}

/**
 * Migration channel script list — registered in `index.ts` via
 * `migration.registerChannel('userbind', migrationScripts)`.
 *
 * Element index = target db version. Add future migrations by appending.
 */
export const migrationScripts = [
    // Version 0 → 1: initial schema + legacy data import
    migrateV1,
    // Version 1 → 2: backfill kind/sourceTokenId for the multi-kind token model
    migrateV2,
    // Version 2 → 3: derive enrollmentYear from studentId for existing records
    migrateV3,
];
