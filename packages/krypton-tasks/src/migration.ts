/**
 * Migration channel for krypton-tasks. Registered as 'tasks'.
 *
 *   v1 — ensure indexes exist (initial fresh install).
 *   v2 — graph-based schema + admission state machine.
 *         Drops legacy `points`/`condition` fields, writes empty graph,
 *         adds `admissionMode`/`quota` to TaskDoc, backfills admission
 *         columns on TaskAssignmentDoc, recreates the unique-active-assignment
 *         index with widened partial-filter (now includes
 *         qualified/admitted alongside pending/completed).
 *
 *         No semantic translation of old condition rules — the only
 *         existing production task is an empty placeholder. Future
 *         installs starting at v2 land directly in the new schema.
 */
import { Logger } from '@hydrooj/utils';
import { assignmentsColl, ensureIndexes, tasksColl } from './db';
import { emptyTaskGraph } from './types';

const logger = new Logger('tasks.migration');

// Note on return values: the MigrationService treats a falsy return as
// "abort upgrade loop" (it `break`s before bumping dbVer). All scripts that
// completed successfully MUST `return true` so the framework records the
// new version. Failure mode without this: data migrates but db.ver-<channel>
// stays at the old value and the script re-runs (idempotent here but noisy).

async function migrateV1(): Promise<boolean> {
    await ensureIndexes();
    logger.info('v1: indexes ensured');
    return true;
}

async function migrateV2(): Promise<boolean> {
    // 1. Drop the v1 partial index so we can recreate with a wider filter.
    try {
        await assignmentsColl.dropIndex('domainId_1_taskId_1_userId_1');
    } catch (e: any) {
        if (e?.code !== 27 && e?.codeName !== 'IndexNotFound') {
            logger.warn('v2: drop old assignment index failed: %s', e?.message || e);
        }
    }

    // 2. Replace legacy points+condition with empty graph + new admission fields.
    const taskRes = await tasksColl.updateMany(
        { graph: { $exists: false } },
        {
            $set: {
                graph: emptyTaskGraph(),
                admissionMode: 'auto',
                quota: null,
            },
            $unset: { points: '', condition: '' },
        },
    );
    logger.info('v2: converted %d task(s) to graph schema', taskRes.modifiedCount);

    // 3. Backfill admission columns on existing assignments.
    const aRes = await assignmentsColl.updateMany(
        { qualifiedAt: { $exists: false } },
        {
            $set: {
                qualifiedAt: null,
                admittedAt: null,
                admittedBy: 0,
                admissionNote: '',
                confirmedAt: null,
                confirmedBy: 0,
            },
        },
    );
    logger.info('v2: backfilled %d assignment(s) with admission fields', aRes.modifiedCount);

    // 4. Recreate the active-assignment uniqueness index with widened filter.
    //    Cancelled rows are still allowed to duplicate; all four "live"
    //    statuses count as active for the purpose of "one assignment per user".
    await assignmentsColl.createIndex(
        { domainId: 1, taskId: 1, userId: 1 },
        {
            partialFilterExpression: {
                status: { $in: ['pending', 'qualified', 'admitted', 'completed'] },
            },
        },
    );

    logger.info('v2: schema migrated');
    return true;
}

export const migrationScripts = [
    // Version 0 → 1: initial schema (indexes only)
    migrateV1,
    // Version 1 → 2: graph-based tasks + admission state machine
    migrateV2,
];
