/**
 * Migration channel for krypton-collect. Registered as 'collect'.
 *
 *   v1 — ensure indexes exist (initial fresh install).
 */
import { Logger } from '@hydrooj/utils';
import { ensureIndexes } from './db';

const logger = new Logger('collect.migration');

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

export const migrationScripts = [
    // Version 0 → 1: initial schema (indexes only)
    migrateV1,
];
