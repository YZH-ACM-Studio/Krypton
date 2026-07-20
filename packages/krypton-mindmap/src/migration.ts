/**
 * Fresh-install seed only. Existing singleton `mindmap.config`/node data is
 * intentionally not guessed or rewritten here; P2.29 owns that explicit,
 * backed-up schema migration before P2.28 can be deployed.
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
        logger.info('seeded default knowledge map (if empty)');
    });
}

export const migrationScripts = [migrateV1];
