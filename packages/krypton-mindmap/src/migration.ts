/**
 * Migration for krypton-mindmap. The legacy CAUCOJXMind plugin had no DB
 * persistence (tree was hardcoded in TS), so there's nothing to import.
 * We still register a v1 step that seeds the default tree if the
 * collection is empty — that's the "fresh install" path.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { oncePerSetting } from 'hydrooj';
import { seedDefaultTreeIfEmpty } from './db';

const logger = new Logger('mindmap.migration');
const MIGRATION_FLAG = 'mindmap.migration_v1_done';

async function migrateV1(_ctx: Context): Promise<void> {
    return await oncePerSetting(MIGRATION_FLAG, async () => {
        await seedDefaultTreeIfEmpty();
        logger.info('seeded default mindmap tree (if empty)');
    });
}

export const migrationScripts = [migrateV1];
