/**
 * Fresh-install seed only. An empty library becomes the merged graph
 * (one map and its root, no course nodes). Existing data is left untouched;
 * merging real maps is the offline mindmap:merge-courses migration.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { oncePerSetting } from 'hydrooj';
import { seedDefaultMapIfEmpty } from './db';

const logger = new Logger('mindmap.migration');
const MIGRATION_FLAG = 'mindmap.migration_v1_done';

async function migrateV1(_ctx: Context): Promise<boolean> {
    return await oncePerSetting(MIGRATION_FLAG, async () => {
        await seedDefaultMapIfEmpty();
        logger.info('seeded merged knowledge graph when the mindmap collections were empty');
    });
}

export const migrationScripts = [migrateV1];
