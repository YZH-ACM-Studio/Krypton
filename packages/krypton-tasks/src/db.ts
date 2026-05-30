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
            { domainId: 1, userId: 1, level: 1, year: 1, season: 1 },
            { unique: true },
        ),
        patScoreColl.createIndex({ domainId: 1, level: 1, year: 1 }),

        gpltScoreColl.createIndex(
            { domainId: 1, userId: 1, level: 1, year: 1 },
            { unique: true },
        ),
        gpltScoreColl.createIndex({ domainId: 1, level: 1, year: 1 }),

        cspScoreColl.createIndex(
            { domainId: 1, userId: 1, round: 1 },
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
