/**
 * MongoDB collection refs + index setup.
 *
 * Naming: `tasks.<entity>` (dot-separator = plugin namespace, matches
 * other Hydro plugins like `userbind.students` and `vjudge.account`).
 */
import { db } from 'hydrooj';
import type {
    AuditLogDoc,
    CspScoreDoc,
    DomainSettingsDoc,
    GpltScoreDoc,
    PatScoreDoc,
    StayEventDoc,
    TaskAssignmentDoc,
    TaskDoc,
} from './types';

export const tasksColl = db.collection<TaskDoc>('tasks.tasks');
export const assignmentsColl = db.collection<TaskAssignmentDoc>('tasks.assignments');
export const auditColl = db.collection<AuditLogDoc>('tasks.audit');
export const settingsColl = db.collection<DomainSettingsDoc>('tasks.settings');
export const patScoreColl = db.collection<PatScoreDoc>('tasks.score_pat');
export const gpltScoreColl = db.collection<GpltScoreDoc>('tasks.score_gplt');
export const cspScoreColl = db.collection<CspScoreDoc>('tasks.score_csp');
export const stayEventsColl = db.collection<StayEventDoc>('tasks.stay_events');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    // 2026-06-07: score collections were re-keyed userId → studentDocId. Drop
    // any surviving legacy index whose key includes `userId` — new docs carry no
    // `userId` field, so the old non-sparse unique index would treat them all as
    // `userId: null` and collide (E11000) on the 2nd row per (level, year)/round.
    // Name-independent + idempotent; no-op on fresh installs. See docs/PLAN-2026-06-07.
    await Promise.all([patScoreColl, gpltScoreColl, cspScoreColl].map(async (coll) => {
        try {
            const existing = await coll.indexes();
            await Promise.all(existing
                .filter((i) => i.name !== '_id_' && i.key && Object.prototype.hasOwnProperty.call(i.key, 'userId'))
                .map((i) => coll.dropIndex(i.name as string).catch(() => { /* concurrent drop / gone */ })));
        } catch { /* collection not created yet — nothing to drop */ }
    }));

    await Promise.all([
        tasksColl.createIndex({ domainId: 1, isActive: 1, _id: -1 }),
        tasksColl.createIndex({ domainId: 1, createdBy: 1 }),
        tasksColl.createIndex({ domainId: 1, tags: 1 }),
        tasksColl.createIndex({ domainId: 1, 'access.targetId': 1 }),

        assignmentsColl.createIndex({ domainId: 1, userId: 1, status: 1 }),
        assignmentsColl.createIndex({ domainId: 1, taskId: 1, status: 1 }),
        assignmentsColl.createIndex(
            { domainId: 1, taskId: 1, userId: 1 },
            // MongoDB partial indexes don't allow $ne / $not; list the allowed
            // statuses explicitly via $in instead. All "active" statuses
            // (everything except cancelled) participate in uniqueness so a
            // user cannot accumulate two parallel claims of the same task
            // — they must explicitly cancel first.
            {
                partialFilterExpression: {
                    status: { $in: ['pending', 'qualified', 'admitted', 'completed'] },
                },
            },
        ),

        auditColl.createIndex({ domainId: 1, assignmentId: 1, createdAt: -1 }),
        auditColl.createIndex({ domainId: 1, taskId: 1, createdAt: -1 }),

        settingsColl.createIndex({ domainId: 1 }, { unique: true }),

        patScoreColl.createIndex(
            { domainId: 1, studentDocId: 1, level: 1, year: 1, season: 1 },
            { unique: true },
        ),
        patScoreColl.createIndex({ domainId: 1, level: 1, year: 1 }),

        gpltScoreColl.createIndex(
            { domainId: 1, studentDocId: 1, level: 1, year: 1 },
            { unique: true },
        ),
        gpltScoreColl.createIndex({ domainId: 1, level: 1, year: 1 }),

        cspScoreColl.createIndex(
            { domainId: 1, studentDocId: 1, round: 1 },
            { unique: true },
        ),
        cspScoreColl.createIndex({ domainId: 1, round: 1 }),

        // Stay events: unique on source makes the auto-trigger idempotent —
        // re-evaluating a completed task with countsAsStay=true tries to
        // re-insert, mongo rejects with duplicate-key, model silently swallows.
        stayEventsColl.createIndex(
            { domainId: 1, userId: 1, source: 1 },
            { unique: true },
        ),
        stayEventsColl.createIndex({ domainId: 1, userId: 1 }),
        stayEventsColl.createIndex({ domainId: 1, year: 1 }),
    ]);
}
