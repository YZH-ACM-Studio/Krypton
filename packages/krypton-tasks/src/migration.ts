/**
 * Migration channel for krypton-tasks. Registered as 'tasks'.
 *
 * V1 just ensures indexes exist. No legacy import is needed
 * (this is a fresh feature on Krypton).
 */
import { Logger } from '@hydrooj/utils';
import { ensureIndexes } from './db';

const logger = new Logger('tasks.migration');

async function migrateV1(): Promise<void> {
    await ensureIndexes();
    logger.info('v1: indexes ensured');
}

export const migrationScripts = [
    // Version 0 → 1: initial schema (indexes only)
    migrateV1,
];
