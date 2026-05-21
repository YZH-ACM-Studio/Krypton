import { db } from 'hydrooj';
import type {
    AnnouncementCategory,
    AnnouncementDoc,
    AnnouncementReadState,
} from './types';

export const docsColl = db.collection<AnnouncementDoc>('announcement.docs');
export const categoriesColl = db.collection<AnnouncementCategory>('announcement.categories');
export const readStateColl = db.collection<AnnouncementReadState>('announcement.read');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    await Promise.all([
        // Listings: visible to a domain, pinned first then sortOrder asc.
        docsColl.createIndex({ scope: 1, domainId: 1, pin: -1, sortOrder: 1 }),
        docsColl.createIndex({ publishAt: 1 }),
        docsColl.createIndex({ unpublishAt: 1 }),
        // Recent first for "latest 3" homepage selection.
        docsColl.createIndex({ scope: 1, domainId: 1, hidden: 1, publishAt: -1 }),

        categoriesColl.createIndex({ key: 1 }, { unique: true }),
        categoriesColl.createIndex({ order: 1 }),

        // Reads — upsert on detail view, query by uid for the unread popover.
        readStateColl.createIndex({ uid: 1, readAt: -1 }),
    ]);
}

/** Default preset categories. Seeded once if none exist. */
export const PRESET_CATEGORIES: Array<Omit<AnnouncementCategory, '_id'>> = [
    { key: 'announcement', name: '公告', color: 'gray', order: 10, hidden: false, builtin: true },
    { key: 'maintenance', name: '维护', color: 'amber', order: 20, hidden: false, builtin: true },
    { key: 'contest', name: '比赛', color: 'blue', order: 30, hidden: false, builtin: true },
    { key: 'system', name: '系统', color: 'purple', order: 40, hidden: false, builtin: true },
];

export async function seedCategoriesIfEmpty(): Promise<void> {
    const count = await categoriesColl.estimatedDocumentCount();
    if (count > 0) return;
    await categoriesColl.insertMany(
        PRESET_CATEGORIES.map((c) => ({ ...c } as AnnouncementCategory)),
    );
}
