import type { ObjectId } from 'mongodb';

/**
 * AnnouncementDoc — the core announcement record. Stored in its own
 * `announcement.docs` collection rather than the generic Hydro `document`
 * collection so we can index `(scope, hidden, publishAt, unpublishAt)`
 * without polluting the shared document table.
 */
export interface AnnouncementDoc {
    _id: ObjectId;
    /**
     * `'global'` — visible across all domains; only `PRIV_EDIT_SYSTEM` may create.
     * `'domain'` — scoped to one domain; PERM_EDIT_DOMAIN of that domain may create.
     */
    scope: 'global' | 'domain';
    /** Always set; for `'global'` this is the creator's current domain (informational). */
    domainId: string;
    owner: number;
    title: string;
    /** Markdown source. Rendered client-side via MarkdownView. */
    content: string;
    /** Category key — must match an existing AnnouncementCategory.key. */
    category: string;
    /**
     * Manual hide override. When true, the announcement is invisible to
     * non-admins regardless of publishAt/unpublishAt.
     */
    hidden: boolean;
    /** Sticky to top of lists. */
    pin: boolean;
    /**
     * Drag-and-drop ordering value. Lower comes first within the same
     * pin bucket. Initial value = floor(Date.now() / 1000) so new items
     * land near the bottom; admin can shuffle by drag (which rewrites).
     */
    sortOrder: number;
    /**
     * When the announcement becomes effectively visible to non-admins.
     * Defaults to now() at create time.
     */
    publishAt: Date;
    /**
     * Optional auto-hide deadline. If null, never auto-hides.
     */
    unpublishAt: Date | null;
    views: number;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * AnnouncementCategory — preset 4 are seeded on first boot; admin may add
 * more. The `key` is the stable machine-readable id stored on docs; `name`
 * is the display label and `color` controls the chip tone.
 */
export interface AnnouncementCategory {
    _id: ObjectId;
    key: string;
    name: string;
    /** Tailwind-friendly color name — one of: gray, amber, blue, purple, green, rose, sky. */
    color: string;
    order: number;
    hidden: boolean;
    builtin: boolean;
}

/**
 * AnnouncementReadState — per-user per-announcement read marker. Composite
 * `_id: "uid:aid"` lets us upsert cheaply on detail-page load.
 */
export interface AnnouncementReadState {
    _id: string;
    uid: number;
    aid: ObjectId;
    readAt: Date;
}

/** Visible-to-user computed flag, not stored. */
export function isEffectivelyVisible(
    doc: Pick<AnnouncementDoc, 'hidden' | 'publishAt' | 'unpublishAt'>,
    now: Date = new Date(),
): boolean {
    if (doc.hidden) return false;
    if (doc.publishAt && doc.publishAt > now) return false;
    if (doc.unpublishAt && doc.unpublishAt <= now) return false;
    return true;
}
