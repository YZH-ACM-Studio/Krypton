import { ObjectId } from 'hydrooj';
import {
    categoriesColl,
    docsColl,
    readStateColl,
    seedCategoriesIfEmpty,
} from './db';
import type {
    AnnouncementCategory,
    AnnouncementDoc,
    AnnouncementReadState,
} from './types';
import { isEffectivelyVisible } from './types';

/* ---- helpers ---- */

function visibilityClause(now: Date) {
    return {
        hidden: { $ne: true },
        publishAt: { $lte: now },
        $or: [
            { unpublishAt: null },
            { unpublishAt: { $exists: false } },
            { unpublishAt: { $gt: now } },
        ],
    } as const;
}

function scopeClause(domainId: string) {
    return {
        $or: [
            { scope: 'global' as const },
            { scope: 'domain' as const, domainId },
        ],
    } as const;
}

/* ---- documents ---- */

export async function listAnnouncements(
    domainId: string,
    opts: {
        /** Skip visibility filters — for the admin list. */
        includeHidden?: boolean;
        category?: string;
        limit?: number;
        skip?: number;
        /** When set, returns only the rows visible to this user. */
        forUser?: boolean;
        /**
         * Sort direction for non-pinned rows by `publishAt`.
         *   'desc' (default) — newest first
         *   'asc'  — oldest first
         * Pinned rows always come first; within each pin bucket the
         * admin-controlled `sortOrder` still wins, then publishAt.
         */
        sort?: 'asc' | 'desc';
    } = {},
): Promise<{ docs: AnnouncementDoc[]; total: number }> {
    const now = new Date();
    const filter: Record<string, unknown> = { ...scopeClause(domainId) };
    if (opts.forUser !== false && !opts.includeHidden) Object.assign(filter, visibilityClause(now));
    if (opts.category) filter.category = opts.category;
    const total = await docsColl.countDocuments(filter);
    const publishDir = opts.sort === 'asc' ? 1 : -1;
    const cursor = docsColl
        .find(filter)
        .sort({ pin: -1, sortOrder: 1, publishAt: publishDir })
        .skip(opts.skip || 0)
        .limit(opts.limit || 50);
    const docs = await cursor.toArray();
    return { docs, total };
}

export async function getAnnouncement(aid: ObjectId | string): Promise<AnnouncementDoc | null> {
    const _id = typeof aid === 'string' ? new ObjectId(aid) : aid;
    return await docsColl.findOne({ _id });
}

export async function createAnnouncement(input: {
    title: string;
    content: string;
    category: string;
    scope: 'global' | 'domain';
    domainId: string;
    owner: number;
    pin?: boolean;
    hidden?: boolean;
    publishAt?: Date;
    unpublishAt?: Date | null;
}): Promise<AnnouncementDoc> {
    const now = new Date();
    const doc: AnnouncementDoc = {
        _id: new ObjectId(),
        scope: input.scope,
        domainId: input.domainId,
        owner: input.owner,
        title: input.title.trim(),
        content: input.content,
        category: input.category,
        hidden: !!input.hidden,
        pin: !!input.pin,
        sortOrder: Math.floor(now.getTime() / 1000),
        publishAt: input.publishAt || now,
        unpublishAt: input.unpublishAt ?? null,
        views: 0,
        createdAt: now,
        updatedAt: now,
    };
    await docsColl.insertOne(doc);
    return doc;
}

export async function updateAnnouncement(
    aid: ObjectId | string,
    patch: Partial<Omit<AnnouncementDoc, '_id' | 'createdAt' | 'owner' | 'scope' | 'domainId'>>,
): Promise<void> {
    const _id = typeof aid === 'string' ? new ObjectId(aid) : aid;
    const update: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    await docsColl.updateOne({ _id }, { $set: update });
}

export async function deleteAnnouncement(aid: ObjectId | string): Promise<void> {
    const _id = typeof aid === 'string' ? new ObjectId(aid) : aid;
    await docsColl.deleteOne({ _id });
    await readStateColl.deleteMany({ aid: _id });
}

export async function incrementViews(aid: ObjectId): Promise<void> {
    await docsColl.updateOne({ _id: aid }, { $inc: { views: 1 } });
}

/**
 * Reorder a set of announcements by writing each one's sortOrder to the
 * provided index in the input array. Called from the drag-and-drop save.
 */
export async function reorderAnnouncements(orderedIds: (ObjectId | string)[]): Promise<void> {
    const ops = orderedIds.map((raw, idx) => {
        const _id = typeof raw === 'string' ? new ObjectId(raw) : raw;
        return { updateOne: { filter: { _id }, update: { $set: { sortOrder: idx + 1, updatedAt: new Date() } } } };
    });
    if (ops.length) await docsColl.bulkWrite(ops, { ordered: false });
}

/* ---- categories ---- */

export async function listCategories(opts: { includeHidden?: boolean } = {}): Promise<AnnouncementCategory[]> {
    await seedCategoriesIfEmpty();
    const filter = opts.includeHidden ? {} : { hidden: { $ne: true } };
    return await categoriesColl.find(filter).sort({ order: 1 }).toArray();
}

export async function getCategory(key: string): Promise<AnnouncementCategory | null> {
    return await categoriesColl.findOne({ key });
}

export async function upsertCategory(input: {
    key: string;
    name: string;
    color: string;
    order: number;
    hidden?: boolean;
}): Promise<void> {
    await categoriesColl.updateOne(
        { key: input.key },
        {
            $set: {
                name: input.name,
                color: input.color,
                order: input.order,
                hidden: !!input.hidden,
            },
            $setOnInsert: { key: input.key, builtin: false },
        },
        { upsert: true },
    );
}

export async function deleteCategory(key: string): Promise<void> {
    const cat = await categoriesColl.findOne({ key });
    if (!cat || cat.builtin) return;
    await categoriesColl.deleteOne({ key, builtin: { $ne: true } });
}

/* ---- read state ---- */

export async function markRead(uid: number, aid: ObjectId | string): Promise<void> {
    const aidObj = typeof aid === 'string' ? new ObjectId(aid) : aid;
    const _id = `${uid}:${aidObj.toString()}`;
    await readStateColl.updateOne(
        { _id },
        { $set: { _id, uid, aid: aidObj, readAt: new Date() } },
        { upsert: true },
    );
}

export async function listUnreadForUser(
    uid: number,
    domainId: string,
    limit = 20,
): Promise<AnnouncementDoc[]> {
    if (!uid) return [];
    const now = new Date();
    const reads = await readStateColl
        .find({ uid })
        .project<Pick<AnnouncementReadState, 'aid'>>({ aid: 1, _id: 0 })
        .toArray();
    const readIds = reads.map((r) => r.aid);
    const filter: Record<string, unknown> = {
        ...scopeClause(domainId),
        ...visibilityClause(now),
    };
    if (readIds.length) filter._id = { $nin: readIds };
    return await docsColl
        .find(filter)
        .sort({ pin: -1, publishAt: -1 })
        .limit(limit)
        .toArray();
}

export async function countUnreadForUser(uid: number, domainId: string): Promise<number> {
    if (!uid) return 0;
    const now = new Date();
    const reads = await readStateColl
        .find({ uid })
        .project<Pick<AnnouncementReadState, 'aid'>>({ aid: 1, _id: 0 })
        .toArray();
    const readIds = reads.map((r) => r.aid);
    const filter: Record<string, unknown> = {
        ...scopeClause(domainId),
        ...visibilityClause(now),
    };
    if (readIds.length) filter._id = { $nin: readIds };
    return await docsColl.countDocuments(filter);
}

/* ---- homepage block ---- */

/**
 * Pinned-first / latest-N selection used by the home page integration.
 * Returns at most `limit` (default 5) effectively-visible announcements.
 */
export async function listForHomepage(
    domainId: string,
    limit = 5,
): Promise<AnnouncementDoc[]> {
    const now = new Date();
    return await docsColl
        .find({ ...scopeClause(domainId), ...visibilityClause(now) })
        .sort({ pin: -1, publishAt: -1, sortOrder: 1 })
        .limit(limit)
        .toArray();
}

/* ---- re-exports ---- */

export { isEffectivelyVisible };
