/**
 * Route handlers for krypton-announcement.
 *
 * Routes:
 *   GET  /announce                         AnnounceListHandler
 *   GET  /announce/:aid                    AnnounceDetailHandler
 *   GET  /admin/announce                   AdminAnnounceListHandler
 *   POST /admin/announce                   AdminAnnounceListHandler.post* (create/update/delete/reorder)
 *   GET  /admin/announce/categories        AdminCategoriesHandler
 *   POST /admin/announce/categories        AdminCategoriesHandler.post* (upsert/delete)
 *   GET  /api/announce/unread              UnreadApiHandler — JSON
 *
 * Permission model:
 *   - Listing / detail: open to anyone (anon included). The list filter
 *     enforces effective visibility.
 *   - Creating / updating a *domain*-scoped announcement: requires
 *     PERM_EDIT_DOMAIN in the current domain.
 *   - Creating / updating a *global*-scoped announcement: requires
 *     PRIV_EDIT_SYSTEM.
 *   - Category management: PRIV_EDIT_SYSTEM (system-wide list).
 */
import type { Context } from 'hydrooj';
import {
    Handler, NotFoundError, ObjectId, param, PERM, PermissionError, PRIV,
    PrivilegeError, Types,
} from 'hydrooj';
import {
    countUnreadForUser,
    createAnnouncement, deleteAnnouncement, deleteCategory, getAnnouncement,
    getCategory, incrementViews, listAnnouncements, listCategories,
    listForHomepage, listUnreadForUser, markRead, reorderAnnouncements,
    updateAnnouncement, upsertCategory,
} from './model';
import type { AnnouncementDoc } from './types';
import { isEffectivelyVisible } from './types';

function parseDateOrNull(input: unknown): Date | null {
    if (!input) return null;
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    const s = String(input).trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function ensureCanEditScope(user: any, scope: 'global' | 'domain') {
    if (scope === 'global') {
        if (!user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        }
    } else if (!user.hasPerm(PERM.PERM_EDIT_DOMAIN)) {
        throw new PermissionError(PERM.PERM_EDIT_DOMAIN);
    }
}

function ensureCanEditAnnouncement(user: any, doc: AnnouncementDoc) {
    ensureCanEditScope(user, doc.scope);
}

class AnnounceListHandler extends Handler {
    noCheckPermView = true;

    @param('category', Types.String, true)
    @param('page', Types.PositiveInt, true)
    @param('sort', Types.String, true)
    async get({ domainId }: { domainId: string }, category?: string, page = 1, sort?: string) {
        const limit = 20;
        const skip = (page - 1) * limit;
        const sortDir = sort === 'asc' ? 'asc' : 'desc';
        const { docs, total } = await listAnnouncements(domainId, {
            forUser: true, category, skip, limit, sort: sortDir,
        });
        const categories = await listCategories();
        this.response.template = 'announce_list.html';
        this.response.body = {
            docs, total, page, limit,
            category: category || '',
            categories,
            sort: sortDir,
        };
    }
}

class AnnounceDetailHandler extends Handler {
    noCheckPermView = true;

    @param('aid', Types.ObjectId)
    async get({ domainId }: { domainId: string }, aid: ObjectId) {
        const doc = await getAnnouncement(aid);
        if (!doc) throw new NotFoundError('announcement', String(aid));
        // Non-admins can't see hidden / future / expired announcements.
        const canSeeHidden = this.user.hasPerm(PERM.PERM_EDIT_DOMAIN)
            || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        if (!canSeeHidden && !isEffectivelyVisible(doc)) {
            throw new NotFoundError('announcement', String(aid));
        }
        if (doc.scope === 'domain' && doc.domainId !== domainId && !canSeeHidden) {
            throw new NotFoundError('announcement', String(aid));
        }
        await incrementViews(doc._id);
        if (this.user._id) {
            await markRead(this.user._id, doc._id);
        }
        const category = await getCategory(doc.category);
        this.response.template = 'announce_detail.html';
        this.response.body = { doc, category };
    }
}

class AdminAnnounceListHandler extends Handler {
    async prepare() {
        // Either domain admin or system admin may *view* the admin list.
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PermissionError(PERM.PERM_EDIT_DOMAIN);
        }
    }

    async get({ domainId }: { domainId: string }) {
        const { docs } = await listAnnouncements(domainId, { includeHidden: true, limit: 200 });
        const categories = await listCategories({ includeHidden: true });
        this.response.template = 'admin_announce_list.html';
        this.response.body = {
            docs, categories,
            canEditGlobal: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
    }

    @param('title', Types.String)
    @param('content', Types.Content, true)
    @param('category', Types.String, true)
    @param('scope', Types.String, true)
    @param('pin', Types.Boolean, true)
    @param('hidden', Types.Boolean, true)
    @param('publishAt', Types.String, true)
    @param('unpublishAt', Types.String, true)
    async postCreate(
        { domainId }: { domainId: string },
        title: string,
        content?: string,
        category?: string,
        scope?: string,
        pin?: boolean,
        hidden?: boolean,
        publishAt?: string,
        unpublishAt?: string,
    ) {
        const finalScope = (scope === 'global') ? 'global' : 'domain';
        ensureCanEditScope(this.user, finalScope);
        await createAnnouncement({
            title,
            content: content || '',
            category: category || 'announcement',
            scope: finalScope,
            domainId,
            owner: this.user._id,
            pin,
            hidden,
            publishAt: parseDateOrNull(publishAt) || new Date(),
            unpublishAt: parseDateOrNull(unpublishAt),
        });
        this.response.redirect = this.url('admin_announce');
    }

    @param('orderedIds', Types.CommaSeperatedArray, true)
    async postReorder(_ctx: any, orderedIds?: string[]) {
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PermissionError(PERM.PERM_EDIT_DOMAIN);
        }
        if (orderedIds && orderedIds.length) {
            await reorderAnnouncements(orderedIds);
        }
        this.response.redirect = this.url('admin_announce');
    }
}

class AdminAnnounceCreateHandler extends Handler {
    async prepare() {
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PermissionError(PERM.PERM_EDIT_DOMAIN);
        }
    }
    async get() {
        const categories = await listCategories();
        this.response.template = 'admin_announce_edit.html';
        this.response.body = {
            doc: null,
            categories,
            canEditGlobal: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
    }
}

class AdminAnnounceEditHandler extends Handler {
    async prepare() {
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PermissionError(PERM.PERM_EDIT_DOMAIN);
        }
    }
    @param('aid', Types.ObjectId)
    async get(_ctx: any, aid: ObjectId) {
        const doc = await getAnnouncement(aid);
        if (!doc) throw new NotFoundError('announcement', String(aid));
        const categories = await listCategories({ includeHidden: true });
        this.response.template = 'admin_announce_edit.html';
        this.response.body = {
            doc: { ...doc, _id: String(doc._id) },
            categories,
            canEditGlobal: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
    }

    @param('title', Types.String, true)
    @param('content', Types.Content, true)
    @param('category', Types.String, true)
    @param('pin', Types.Boolean, true)
    @param('hidden', Types.Boolean, true)
    @param('publishAt', Types.String, true)
    @param('unpublishAt', Types.String, true)
    @param('aid', Types.ObjectId, true)
    async postUpdate(
        _ctx: { domainId: string },
        title?: string,
        content?: string,
        category?: string,
        pin?: boolean,
        hidden?: boolean,
        publishAt?: string,
        unpublishAt?: string,
        aid?: ObjectId,
    ) {
        if (!aid) throw new Error('aid required');
        const doc = await getAnnouncement(aid);
        if (!doc) throw new NotFoundError('announcement', String(aid));
        ensureCanEditAnnouncement(this.user, doc);
        const patch: any = {};
        if (title !== undefined) patch.title = title;
        if (content !== undefined) patch.content = content;
        if (category !== undefined) patch.category = category;
        if (pin !== undefined) patch.pin = !!pin;
        if (hidden !== undefined) patch.hidden = !!hidden;
        if (publishAt !== undefined) patch.publishAt = parseDateOrNull(publishAt) || new Date();
        if (unpublishAt !== undefined) patch.unpublishAt = parseDateOrNull(unpublishAt);
        await updateAnnouncement(aid, patch);
        this.response.redirect = this.url('admin_announce');
    }

    @param('aid', Types.ObjectId, true)
    async postDelete(_ctx: any, aid?: ObjectId) {
        if (!aid) throw new Error('aid required');
        const doc = await getAnnouncement(aid);
        if (!doc) throw new NotFoundError('announcement', String(aid));
        ensureCanEditAnnouncement(this.user, doc);
        await deleteAnnouncement(aid);
        this.response.redirect = this.url('admin_announce');
    }
}

class AdminCategoriesHandler extends Handler {
    async prepare() {
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    async get() {
        const categories = await listCategories({ includeHidden: true });
        this.response.template = 'admin_announce_categories.html';
        this.response.body = { categories };
    }

    @param('key', Types.String, true)
    @param('name', Types.String, true)
    @param('color', Types.String, true)
    @param('order', Types.Int, true)
    @param('hidden', Types.Boolean, true)
    async postUpsert(
        _ctx: any,
        key?: string,
        name?: string,
        color?: string,
        order?: number,
        hidden?: boolean,
    ) {
        if (!key || !name || !color) throw new Error('key/name/color required');
        await upsertCategory({
            key,
            name,
            color,
            order: order || 100,
            hidden,
        });
        this.response.redirect = this.url('admin_announce_categories');
    }

    @param('key', Types.String)
    async postDelete(_ctx: any, key: string) {
        await deleteCategory(key);
        this.response.redirect = this.url('admin_announce_categories');
    }
}

class UnreadApiHandler extends Handler {
    noCheckPermView = true;

    async get({ domainId }: { domainId: string }) {
        if (!this.user._id) {
            this.response.body = { count: 0, docs: [] };
            return;
        }
        const [docs, count] = await Promise.all([
            listUnreadForUser(this.user._id, domainId, 20),
            countUnreadForUser(this.user._id, domainId),
        ]);
        const categories = await listCategories();
        const catMap = Object.fromEntries(categories.map((c) => [c.key, c]));
        this.response.body = {
            count,
            docs: docs.map((d) => ({
                _id: d._id,
                title: d.title,
                category: d.category,
                categoryName: catMap[d.category]?.name || d.category,
                categoryColor: catMap[d.category]?.color || 'gray',
                pin: d.pin,
                publishAt: d.publishAt,
            })),
        };
    }
}

class HomepageApiHandler extends Handler {
    noCheckPermView = true;

    async get({ domainId }: { domainId: string }) {
        const docs = await listForHomepage(domainId, 5);
        const categories = await listCategories();
        const catMap = Object.fromEntries(categories.map((c) => [c.key, c]));
        this.response.body = {
            docs: docs.map((d) => ({
                _id: d._id,
                title: d.title,
                category: d.category,
                categoryName: catMap[d.category]?.name || d.category,
                categoryColor: catMap[d.category]?.color || 'gray',
                pin: d.pin,
                publishAt: d.publishAt,
            })),
        };
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('announce_main', '/announce', AnnounceListHandler);
    ctx.Route('announce_detail', '/announce/:aid', AnnounceDetailHandler);
    ctx.Route('admin_announce', '/admin/announce', AdminAnnounceListHandler);
    ctx.Route('admin_announce_create', '/admin/announce/new', AdminAnnounceCreateHandler);
    ctx.Route('admin_announce_edit', '/admin/announce/:aid/edit', AdminAnnounceEditHandler);
    ctx.Route('admin_announce_categories', '/admin/announce/categories', AdminCategoriesHandler);
    ctx.Route('announce_api_unread', '/api/announce/unread', UnreadApiHandler);
    ctx.Route('announce_api_homepage', '/api/announce/homepage', HomepageApiHandler);
}
