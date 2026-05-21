/**
 * Migration of legacy plugin-announcement docs (`document` collection with
 * docType=26817) into the new krypton-announcement schema.
 *
 * Defensive: if no legacy docs exist this is a no-op.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { db, ObjectId, oncePerSetting } from 'hydrooj';
import { docsColl, seedCategoriesIfEmpty } from './db';
import type { AnnouncementDoc } from './types';

const logger = new Logger('announcement.migration');
const LEGACY_DOCTYPE = 26817;
const MIGRATION_FLAG = 'announcement.migration_v1_done';

interface LegacyAnnounceDoc {
    _id: ObjectId;
    domainId: string;
    docType: number;
    docId: ObjectId;
    owner: number;
    title: string;
    content: string;
    parentId?: ObjectId;
    ip?: string;
    pin?: boolean;
    highlight?: boolean;
    updateAt?: Date;
    views?: number;
    sort?: number;
}

async function migrateV1(_ctx: Context): Promise<void> {
    return await oncePerSetting(MIGRATION_FLAG, async () => {
        const legacyColl = db.collection<LegacyAnnounceDoc>('document' as any);
        const legacyCount = await legacyColl.countDocuments({ docType: LEGACY_DOCTYPE });
        if (!legacyCount) {
            logger.info('no legacy announcements found — fresh install, nothing to do');
            await seedCategoriesIfEmpty();
            return;
        }

        logger.info('migrating %d legacy announcements', legacyCount);
        await seedCategoriesIfEmpty();

        const cursor = legacyColl.find({ docType: LEGACY_DOCTYPE });
        let count = 0;
        for await (const old of cursor) {
            const existing = await docsColl.findOne({ _id: old._id });
            if (existing) continue;
            const updatedAt = old.updateAt || new Date();
            const next: AnnouncementDoc = {
                _id: old._id,
                scope: old.domainId === '__global__' ? 'global' : 'domain',
                domainId: old.domainId === '__global__' ? 'system' : old.domainId,
                owner: old.owner,
                title: old.title || '(无标题)',
                content: old.content || '',
                category: 'announcement',
                hidden: false,
                pin: !!old.pin,
                sortOrder: old.sort ?? Math.floor(updatedAt.getTime() / 1000),
                publishAt: updatedAt,
                unpublishAt: null,
                views: old.views || 0,
                createdAt: updatedAt,
                updatedAt,
            };
            await docsColl.insertOne(next);
            count++;
        }
        logger.info('migrated %d announcement docs', count);
    });
}

export const migrationScripts = [
    migrateV1,
];
