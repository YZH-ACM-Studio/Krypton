/**
 * HTTP handlers for CF / Nowcoder rating snapshots (P2.1–P2.3).
 *
 * POST /user/external-rating                  — bound user saves handles + public flags, then fetch
 * POST /user/external-rating/refresh          — bound user manual refresh (rate-limited)
 * POST /user/:uid/external-rating             — teacher/admin override (can clear), then fetch
 * POST /home/settings/account with rating fields — same persist+fetch, then strip leftover keys
 *
 * GET profile / ranking / account settings never fetch. Serializer flags come from
 * the server, never from a client publicShow claim.
 */
import {
    Context,
    ForbiddenError,
    Handler,
    OplogModel,
    param,
    PRIV,
    Types,
    UserModel,
    ValidationError,
    localizedErrorText,
} from 'hydrooj';
import {
    applyFetch,
    assertManualRefreshAllowed,
    ExternalRatingRefreshRateLimitError,
    MANUAL_REFRESH_MIN_INTERVAL_MS,
    refreshBoth,
} from './fetch';
import {
    ExternalRatingUnboundError,
    canEditOthersExternalRating,
    loadState,
    saveHandlesAndFlags,
    saveSnapshot,
    type ExternalRatingActor,
    type ExternalRatingFlagInput,
    type ExternalRatingHandleInput,
} from './model';
import {
    serializeForViewer,
    serializeOwnerOrTeacher,
    serializePublic,
    serializeRanking,
    type ExternalRatingViewer,
} from './serialize';
import { EXTERNAL_RATING_ACCOUNT_KEYS } from './settings';
import {
    EXTERNAL_RATING_CLIENT_HANDLE_KEY,
    EXTERNAL_RATING_CLIENT_PUBLIC_SHOW_KEY,
    EXTERNAL_RATING_SITES,
    USER_EXTERNAL_RATING_KEY,
    emptyUserExternalRatingState,
    isExternalRatingSiteId,
    parseUserExternalRatingState,
    type ExternalRatingSiteId,
    type UserExternalRatingState,
} from './types';
import {
    ExternalRatingTypeError,
    assertClientMayNotSetSnapshotFields,
    normalizeCfHandle,
    normalizeNowcoderName,
    parsePublicFlag,
} from './validate';

export {
    serializeForViewer,
    serializeOwnerOrTeacher,
    serializePublic,
    serializeRanking,
};

export const EXTERNAL_RATING_LAST_ATTEMPT_KEY = 'externalRatingLastAttemptAt' as const;

const HANDLE_FIELD_ALIASES: Record<ExternalRatingSiteId, readonly string[]> = {
    codeforces: [EXTERNAL_RATING_CLIENT_HANDLE_KEY.codeforces, EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesHandle],
    nowcoder: [EXTERNAL_RATING_CLIENT_HANDLE_KEY.nowcoder, EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderName],
};

const PUBLIC_FIELD_ALIASES: Record<ExternalRatingSiteId, readonly string[]> = {
    codeforces: [EXTERNAL_RATING_CLIENT_PUBLIC_SHOW_KEY.codeforces, EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesRatingPublic],
    nowcoder: [EXTERNAL_RATING_CLIENT_PUBLIC_SHOW_KEY.nowcoder, EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderRatingPublic],
};

const CLIENT_LEAK_KEYS = [
    USER_EXTERNAL_RATING_KEY,
    EXTERNAL_RATING_LAST_ATTEMPT_KEY,
    ...HANDLE_FIELD_ALIASES.codeforces,
    ...HANDLE_FIELD_ALIASES.nowcoder,
    ...PUBLIC_FIELD_ALIASES.codeforces,
    ...PUBLIC_FIELD_ALIASES.nowcoder,
] as const;

function logStage(stage: string, detail: string): void {
    console.info(`krypton-external-rating.handler stage=${stage} ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function domainIdOf(handler: Handler): string {
    const id = handler.domain?._id || (handler.args as { domainId?: unknown })?.domainId;
    if (typeof id !== 'string' || !id.trim()) {
        throw new ValidationError('domainId', null, localizedErrorText`无效域`);
    }
    return id;
}

function actorOf(handler: Handler): ExternalRatingActor {
    return {
        _id: handler.user._id,
        hasPerm: (perm: bigint) => handler.user.hasPerm(perm),
        hasPriv: (priv: number) => handler.user.hasPriv(priv),
    };
}

function requestRecords(handler: Handler): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    const body = handler.request.body;
    const args = handler.args;
    if (isPlainObject(body)) records.push(body);
    if (isPlainObject(args)) records.push(args);
    return records;
}

function requestPayload(handler: Handler): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const record of requestRecords(handler).reverse()) Object.assign(merged, record);
    return merged;
}

function fieldPresent(handler: Handler, key: string): boolean {
    for (const record of requestRecords(handler)) {
        if (Object.prototype.hasOwnProperty.call(record, key)) return true;
    }
    return false;
}

function firstPresentValue(handler: Handler, keys: readonly string[]): { present: boolean; value: unknown } {
    for (const key of keys) {
        if (!fieldPresent(handler, key)) continue;
        for (const record of requestRecords(handler)) {
            if (Object.prototype.hasOwnProperty.call(record, key)) return { present: true, value: record[key] };
        }
    }
    return { present: false, value: undefined };
}

function coerceFormBoolean(raw: unknown): unknown {
    if (raw === 'true' || raw === 'on' || raw === '1') return true;
    if (raw === 'false' || raw === 'off' || raw === '0' || raw === '') return false;
    return raw;
}

function wrapClientError(error: unknown): never {
    if (error instanceof ExternalRatingTypeError) {
        throw new ValidationError(error.field, null, error.message);
    }
    if (error instanceof ExternalRatingRefreshRateLimitError) {
        throw new ForbiddenError(localizedErrorText`外站 rating 刷新过于频繁，请一分钟后再试`);
    }
    throw error;
}

function normalizeHandle(site: ExternalRatingSiteId, raw: unknown): string {
    try {
        return site === 'codeforces' ? normalizeCfHandle(raw) : normalizeNowcoderName(raw);
    } catch (error) {
        wrapClientError(error);
    }
}

function nestedSiteRecord(handler: Handler, site: ExternalRatingSiteId): Record<string, unknown> | undefined {
    const payload = requestPayload(handler);
    const nested = payload[site];
    if (nested == null) return undefined;
    if (!isPlainObject(nested)) {
        throw new ValidationError(site, null, localizedErrorText`外站字段必须是对象`);
    }
    return nested;
}

function parseWriteInput(
    handler: Handler,
    mode: 'self' | 'override',
): { handles?: ExternalRatingHandleInput; flags?: ExternalRatingFlagInput; fetchSites: ExternalRatingSiteId[] } {
    const payload = requestPayload(handler);
    try {
        assertClientMayNotSetSnapshotFields(payload);
    } catch (error) {
        wrapClientError(error);
    }
    if (payload.rp != null || payload.rpInfo != null || payload.rpdelta != null) {
        throw new ValidationError('rp', null, localizedErrorText`不能把本站 RP 写成外站 rating`);
    }

    const handles: ExternalRatingHandleInput = {};
    const flags: ExternalRatingFlagInput = {};
    const fetchSites: ExternalRatingSiteId[] = [];
    let hasHandleWrite = false;
    let hasFlagWrite = false;

    for (const site of EXTERNAL_RATING_SITES) {
        const nested = nestedSiteRecord(handler, site);
        if (nested) {
            try {
                assertClientMayNotSetSnapshotFields(nested);
            } catch (error) {
                wrapClientError(error);
            }
        }

        const nestedHandlePresent = nested ? Object.prototype.hasOwnProperty.call(nested, 'handle') : false;
        const flatHandle = firstPresentValue(handler, HANDLE_FIELD_ALIASES[site]);
        const handlePresent = nestedHandlePresent || flatHandle.present;
        if (handlePresent) {
            const raw = nestedHandlePresent ? nested?.handle : flatHandle.value;
            handles[site] = normalizeHandle(site, raw);
            fetchSites.push(site);
            hasHandleWrite = true;
        }

        const nestedPublicPresent = nested ? Object.prototype.hasOwnProperty.call(nested, 'publicShow') : false;
        const flatPublic = firstPresentValue(handler, PUBLIC_FIELD_ALIASES[site]);
        const publicPresent = nestedPublicPresent || flatPublic.present;
        if (publicPresent) {
            const raw = nestedPublicPresent ? nested?.publicShow : coerceFormBoolean(flatPublic.value);
            try {
                flags[site] = { publicShow: parsePublicFlag(raw) };
            } catch (error) {
                wrapClientError(error);
            }
            hasFlagWrite = true;
        } else if (mode === 'self' && !handler.request.json) {
            // HTML checkbox omitted = false. JSON omit keeps the stored flag.
            flags[site] = { publicShow: parsePublicFlag(undefined) };
            hasFlagWrite = true;
        }
    }

    if (!hasHandleWrite && !hasFlagWrite) {
        throw new ValidationError('handle', null, localizedErrorText`缺少外站 handle 或公开开关`);
    }

    return {
        ...(hasHandleWrite ? { handles } : {}),
        ...(hasFlagWrite ? { flags } : {}),
        fetchSites,
    };
}

function containsRatingFields(handler: Handler): boolean {
    if (EXTERNAL_RATING_SITES.some((site) => fieldPresent(handler, site))) return true;
    for (const site of EXTERNAL_RATING_SITES) {
        if (HANDLE_FIELD_ALIASES[site].some((key) => fieldPresent(handler, key))) return true;
        if (PUBLIC_FIELD_ALIASES[site].some((key) => fieldPresent(handler, key))) return true;
    }
    return false;
}

function stripRatingFieldsFrom(record: unknown): void {
    if (!isPlainObject(record)) return;
    for (const site of EXTERNAL_RATING_SITES) delete record[site];
    for (const key of CLIENT_LEAK_KEYS) delete record[key];
}

function stripRatingFieldsFromRequest(handler: Handler): void {
    stripRatingFieldsFrom(handler.args);
    stripRatingFieldsFrom(handler.request.body);
    if (isPlainObject(handler.args)) stripRatingFieldsFrom(handler.args.booleanKeys);
    if (isPlainObject(handler.request.body)) stripRatingFieldsFrom(handler.request.body.booleanKeys);
}

function isTeacherOrAdmin(user: Handler['user']): boolean {
    if (!user || typeof user.hasPriv !== 'function' || typeof user.hasPerm !== 'function') return false;
    if (typeof user._id !== 'number' || !Number.isSafeInteger(user._id) || user._id <= 0) return false;
    return canEditOthersExternalRating({
        _id: user._id,
        hasPerm: (perm) => user.hasPerm(perm),
        hasPriv: (priv) => user.hasPriv(priv),
    });
}

export function viewerFor(user: Handler['user'], targetUid: number): ExternalRatingViewer {
    const uid = typeof user?._id === 'number' ? user._id : 0;
    return {
        isSelf: uid > 0 && uid === targetUid,
        isTeacherOrAdmin: isTeacherOrAdmin(user),
    };
}

function stateFromUserLike(user: unknown): UserExternalRatingState {
    if (!isRecord(user)) return emptyUserExternalRatingState();
    const nested = user[USER_EXTERNAL_RATING_KEY];
    const udoc = isRecord(user._udoc) ? user._udoc[USER_EXTERNAL_RATING_KEY] : undefined;
    return parseUserExternalRatingState(nested ?? udoc ?? null);
}

function redactLeakedRatingFields(payload: unknown): void {
    if (!isRecord(payload)) return;
    for (const key of CLIENT_LEAK_KEYS) delete payload[key];
    if (isRecord(payload._udoc)) {
        for (const key of CLIENT_LEAK_KEYS) delete payload._udoc[key];
    }
}

function projectRankingExternalRating(
    row: unknown,
    byUid: Record<string, ReturnType<typeof serializeRanking>>,
): unknown {
    if (!isRecord(row)) return row;
    const uid = typeof row._id === 'number' ? row._id : Number(row._id);
    if (!Number.isSafeInteger(uid) || uid <= 0) return row;
    // Shallow-copy before serialize/redact. Ranking rows spread cached User
    // documents; mutating `_udoc` would delete snapshot fields from the cache.
    const clone: Record<string, unknown> = { ...row };
    const view = serializeRanking(stateFromUserLike(clone));
    delete clone._udoc;
    delete clone._dudoc;
    redactLeakedRatingFields(clone);
    clone.externalRating = view;
    byUid[String(uid)] = view;
    return clone;
}

function replaceUserPayload(udoc: unknown, handler: Handler): Record<string, unknown> {
    if (!udoc || typeof udoc !== 'object') return {};
    const rec = udoc as Record<string, unknown> & { serialize?: (h?: Handler) => Record<string, unknown> };
    const base = typeof rec.serialize === 'function' ? { ...rec.serialize(handler) } : { ...rec };
    redactLeakedRatingFields(base);
    return base;
}

async function syncAccountSettingFields(uid: number, state: UserExternalRatingState): Promise<void> {
    const res = await UserModel.setById(uid, {
        [EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesHandle]: state.codeforces.handle,
        [EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderName]: state.nowcoder.handle,
        [EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesRatingPublic]: state.codeforces.publicShow === true,
        [EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderRatingPublic]: state.nowcoder.publicShow === true,
    });
    if (!res) throw new ValidationError('uid', null, localizedErrorText`无效用户`);
}

function readLastAttemptAt(user: { _udoc?: Record<string, unknown> } | null | undefined): Date | null {
    const raw = user?._udoc?.[EXTERNAL_RATING_LAST_ATTEMPT_KEY] ?? (user as { [EXTERNAL_RATING_LAST_ATTEMPT_KEY]?: unknown } | undefined)?.[EXTERNAL_RATING_LAST_ATTEMPT_KEY];
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    return null;
}

async function markRefreshAttempt(uid: number, at: Date): Promise<void> {
    const res = await UserModel.setById(uid, { [EXTERNAL_RATING_LAST_ATTEMPT_KEY]: at });
    if (!res) throw new ValidationError('uid', null, localizedErrorText`无效用户`);
}

async function fetchSavedSites(
    uid: number,
    state: UserExternalRatingState,
    sites: ExternalRatingSiteId[],
    now: Date,
): Promise<UserExternalRatingState> {
    if (!sites.length) return state;
    let next = state;
    for (const site of sites) {
        if (!isExternalRatingSiteId(site)) {
            throw new ValidationError('site', null, localizedErrorText`未知外站`);
        }
        next = await applyFetch(next, site, next[site].handle, now);
        logStage('fetch', `uid=${uid} site=${site}`);
    }
    return saveSnapshot(uid, next);
}

async function writeHandlesThenFetch(
    handler: Handler,
    targetUid: number,
    mode: 'self' | 'override',
): Promise<UserExternalRatingState> {
    handler.checkPriv(PRIV.PRIV_USER_PROFILE);
    const actor = actorOf(handler);
    const domainId = domainIdOf(handler);
    if (mode === 'override' && !canEditOthersExternalRating(actor)) {
        throw new ForbiddenError(localizedErrorText`只有老师或系统管理员可以改别人的外站 handle`);
    }
    if (mode === 'self' && actor._id !== targetUid) {
        throw new ForbiddenError(localizedErrorText`不能用本人入口改别人的外站 handle`);
    }
    const payload = requestPayload(handler);
    if (payload.uid != null && Number(payload.uid) !== targetUid) {
        throw new ValidationError('uid', null, localizedErrorText`uid 与路径不一致`);
    }
    const input = parseWriteInput(handler, mode);
    const saved = await saveHandlesAndFlags({
        actor,
        targetUid,
        domainId,
        handles: input.handles,
        flags: input.flags,
    });
    const now = new Date();
    const fetched = await fetchSavedSites(targetUid, saved, input.fetchSites, now);
    await syncAccountSettingFields(targetUid, fetched);
    const site = input.fetchSites.length === 1 ? input.fetchSites[0] : 'both';
    const stage = mode === 'override' ? 'override' : 'save';
    await OplogModel.log(handler, `external_rating.${stage}`, {
        actor: actor._id,
        uid: targetUid,
        site,
        stage,
    });
    logStage(stage, `actor=${actor._id} uid=${targetUid} site=${site}`);
    return fetched;
}

async function assertBoundStudent(domainId: string, uid: number): Promise<void> {
    const userbind = (global as { Hydro?: { model?: { userbind?: { findStudentByUserId?: (d: string, u: number) => Promise<{ boundUserId?: number | null } | null> } } } }).Hydro?.model?.userbind;
    const lookup = userbind?.findStudentByUserId;
    if (typeof lookup !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    const student = await lookup(domainId, uid);
    if (!student || student.boundUserId !== uid) {
        logStage('unbound', `domainId=${domainId} uid=${uid}`);
        throw new ExternalRatingUnboundError();
    }
}

function isUnboundError(error: unknown): boolean {
    if (error instanceof ExternalRatingUnboundError) return true;
    return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'ExternalRatingUnboundError';
}

async function isBoundStudent(domainId: string, uid: number): Promise<boolean> {
    try {
        await assertBoundStudent(domainId, uid);
        return true;
    } catch (error) {
        if (isUnboundError(error)) return false;
        throw error;
    }
}

async function refreshSelf(handler: Handler): Promise<UserExternalRatingState> {
    handler.checkPriv(PRIV.PRIV_USER_PROFILE);
    const actor = actorOf(handler);
    const uid = actor._id;
    const domainId = domainIdOf(handler);
    await assertBoundStudent(domainId, uid);
    const state = await loadState(uid);
    const user = await UserModel.getById(domainId, uid);
    const lastAttemptAt = readLastAttemptAt(user);
    const now = new Date();
    try {
        assertManualRefreshAllowed(lastAttemptAt, now);
    } catch (error) {
        wrapClientError(error);
    }
    await handler.limitRate('external_rating_refresh', Math.ceil(MANUAL_REFRESH_MIN_INTERVAL_MS / 1000), 1, '{{user}}');
    await markRefreshAttempt(uid, now);
    let fetched: UserExternalRatingState;
    try {
        fetched = await refreshBoth(state, now, lastAttemptAt);
    } catch (error) {
        wrapClientError(error);
    }
    const saved = await saveSnapshot(uid, fetched);
    await syncAccountSettingFields(uid, saved);
    await OplogModel.log(handler, 'external_rating.refresh', {
        actor: actor._id,
        uid,
        site: 'both',
        stage: 'refresh',
    });
    logStage('refresh', `actor=${actor._id} uid=${uid} site=both`);
    return saved;
}

function respondWithState(handler: Handler, uid: number, state: UserExternalRatingState): void {
    handler.response.body = {
        ok: true,
        uid,
        bound: true,
        canEdit: true,
        canRefresh: handler.user._id === uid,
        externalRating: serializeOwnerOrTeacher(state),
    };
    handler.back(handler.response.body);
}

export async function injectUserProfileExternalRating(handler: Handler): Promise<void> {
    const body = handler.response?.body;
    if (!isRecord(body)) return;
    const udoc = body.udoc;
    const uidRaw = isRecord(udoc) ? udoc._id : undefined;
    const uid = typeof uidRaw === 'number' ? uidRaw : Number(uidRaw);
    if (!Number.isSafeInteger(uid) || uid <= 0) return;
    const domainId = String(handler.domain?._id || (handler.args as { domainId?: unknown })?.domainId || '');
    const state = await loadState(uid);
    const viewer = viewerFor(handler.user, uid);
    const bound = domainId ? await isBoundStudent(domainId, uid) : false;
    if (isRecord(udoc)) body.udoc = replaceUserPayload(udoc, handler);
    body.externalRating = serializeForViewer(state, viewer);
    body.externalRatingBound = bound;
    body.externalRatingCanEdit = bound && (viewer.isSelf || viewer.isTeacherOrAdmin);
    body.externalRatingCanRefresh = bound && viewer.isSelf;
    // Server-computed; user.tsx reads these to show teacher/owner private snapshots.
    body.viewerIsSelf = viewer.isSelf === true;
    body.viewerIsTeacher = viewer.isTeacherOrAdmin === true;
    body.isTeacherOrAdmin = viewer.isTeacherOrAdmin === true;
}

export async function injectRankingExternalRating(handler: Handler): Promise<void> {
    const body = handler.response?.body;
    if (!isRecord(body)) return;
    const byUid: Record<string, ReturnType<typeof serializeRanking>> = {};
    if (Array.isArray(body.udocs)) {
        body.udocs = body.udocs.map((row) => projectRankingExternalRating(row, byUid));
    }
    if (body.self != null) body.self = projectRankingExternalRating(body.self, byUid);
    body.externalRatingByUid = byUid;
}

export async function injectAccountSettingsExternalRating(handler: Handler): Promise<void> {
    const category = String((handler.args as { category?: unknown })?.category || '');
    if (category !== 'account') return;
    const body = handler.response?.body;
    if (!isRecord(body)) return;
    const uid = handler.user._id;
    if (!Number.isSafeInteger(uid) || uid <= 0) return;
    const domainId = String(handler.domain?._id || (handler.args as { domainId?: unknown })?.domainId || '');
    const state = await loadState(uid);
    const viewer = viewerFor(handler.user, uid);
    const bound = domainId ? await isBoundStudent(domainId, uid) : false;
    body.externalRatingBound = bound;
    body.bound = bound;
    body.externalRating = {
        ...serializeForViewer(state, viewer),
        bound,
    };
    body.externalRatingCanEdit = bound && viewer.isSelf;
    body.externalRatingCanRefresh = bound && viewer.isSelf;
}

class ExternalRatingSaveHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async post() {
        const state = await writeHandlesThenFetch(this, this.user._id, 'self');
        respondWithState(this, this.user._id, state);
    }
}

class ExternalRatingRefreshHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async post() {
        const state = await refreshSelf(this);
        respondWithState(this, this.user._id, state);
    }
}

class ExternalRatingOverrideHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param('uid', Types.Int)
    async post(_domainId: string, uid: number) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        if (!Number.isSafeInteger(uid) || uid <= 1) {
            throw new ValidationError('uid', null, localizedErrorText`无效用户`);
        }
        const state = await writeHandlesThenFetch(this, uid, 'override');
        respondWithState(this, uid, state);
    }
}

function preferStaticUserExternalRatingRoute(ctx: Context): void {
    ctx.inject(['server'], (c) => {
        const stack = (c as { server?: { router?: { stack?: Array<{ path?: string }> } } }).server?.router?.stack;
        if (!Array.isArray(stack)) {
            logStage('route_order', 'server router stack unavailable');
            return;
        }
        const staticIdx = stack.findIndex((layer) => layer.path === '/user/external-rating');
        const paramIdx = stack.findIndex((layer) => layer.path === '/user/:uid');
        if (staticIdx < 0) {
            throw new Error('krypton-external-rating: /user/external-rating is not registered');
        }
        if (paramIdx >= 0 && staticIdx > paramIdx) {
            const [layer] = stack.splice(staticIdx, 1);
            stack.splice(paramIdx, 0, layer);
            logStage('route_order', 'placed /user/external-rating before /user/:uid');
        }
    });
}

export function applyHandlers(ctx: Context) {
    ctx.Route('user_external_rating', '/user/external-rating', ExternalRatingSaveHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_external_rating_refresh', '/user/external-rating/refresh', ExternalRatingRefreshHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_external_rating_override', '/user/:uid/external-rating', ExternalRatingOverrideHandler, PRIV.PRIV_USER_PROFILE);
    preferStaticUserExternalRatingRoute(ctx);

    ctx.on('handler/after/UserDetail#get', async (h) => {
        await injectUserProfileExternalRating(h as Handler);
    });
    ctx.on('handler/after/DomainRank#get', async (h) => {
        await injectRankingExternalRating(h as Handler);
    });
    ctx.on('handler/after/HomeSettings#get', async (h) => {
        await injectAccountSettingsExternalRating(h as Handler);
    });
    ctx.on('handler/before/HomeSettings#post', async (h) => {
        const handler = h as Handler;
        if (String((handler.args as { category?: unknown })?.category || '') !== 'account') return;
        if (!containsRatingFields(handler)) return;
        // Account "保存设置" posts handles here; persist+fetch instead of dropping them.
        // Errors fail closed. Strip afterwards so HomeSettings cannot write snapshot fields.
        await writeHandlesThenFetch(handler, handler.user._id, 'self');
        stripRatingFieldsFromRequest(handler);
    });
}
