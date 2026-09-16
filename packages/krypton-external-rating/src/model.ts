/**
 * Canonical persist path for CF / Nowcoder handles, publicShow flags, and
 * server-owned rating snapshots. One extra field on the Hydro `user`
 * document (`externalRating`). Unbound students have no write entry (G2).
 */
import {
    CreateError as Err,
    ForbiddenError,
    PERM,
    PRIV,
    PermissionError,
    UserModel,
    UserNotFoundError,
    ValidationError,
    localizedErrorText,
} from 'hydrooj';
import {
    EXTERNAL_RATING_SITES,
    USER_EXTERNAL_RATING_KEY,
    isExternalRatingSiteId,
    isHandleUnset,
    parseUserExternalRatingState,
    sameExternalRatingHandle,
    snapshotAfterHandleChange,
    withSiteSnapshot,
    type ExternalRatingSiteId,
    type UserExternalRatingState,
} from './types';
import { assertClientMayNotSetSnapshotFields, normalizeCfHandle, normalizeNowcoderName, parsePublicFlag } from './validate';

export type { ExternalRatingSiteId, UserExternalRatingState } from './types';
export { USER_EXTERNAL_RATING_KEY } from './types';

export const ExternalRatingUnboundError = Err(
    'ExternalRatingUnboundError',
    ForbiddenError,
    '未绑定学生不能填写外站账号',
    403,
);

export interface ExternalRatingActor {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
}

export type ExternalRatingHandleInput = Partial<Record<ExternalRatingSiteId, string | null>>;

export type ExternalRatingFlagInput = Partial<Record<ExternalRatingSiteId, { publicShow?: boolean }>>;

export interface SaveExternalRatingHandlesAndFlagsInput {
    actor: ExternalRatingActor;
    targetUid: number;
    domainId: string;
    handles?: ExternalRatingHandleInput;
    flags?: ExternalRatingFlagInput;
}

interface HydroGlobal {
    Hydro?: {
        model?: {
            userbind?: unknown;
        };
    };
}

interface UserbindBoundLookup {
    findStudentByUserId(domainId: string, userId: number): Promise<{ boundUserId?: number | null } | null>;
}

function logStage(stage: string, detail: string): void {
    console.info(`krypton-external-rating.model stage=${stage} ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertUid(uid: unknown, field: string): number {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) {
        throw new ValidationError(field, null, localizedErrorText`无效用户`);
    }
    return uid;
}

function assertDomainId(domainId: unknown): string {
    if (typeof domainId !== 'string' || !domainId.trim()) {
        throw new ValidationError('domainId', null, localizedErrorText`无效域`);
    }
    return domainId;
}

function assertActor(actor: ExternalRatingActor): void {
    if (!actor || typeof actor !== 'object') {
        throw new TypeError('actor is required');
    }
    if (typeof actor.hasPerm !== 'function' || typeof actor.hasPriv !== 'function') {
        throw new TypeError('actor.hasPerm/hasPriv is unavailable');
    }
    assertUid(actor._id, 'actor');
}

function userbindOrThrow(): UserbindBoundLookup {
    const userbind = (globalThis as HydroGlobal).Hydro?.model?.userbind;
    if (!userbind || typeof userbind !== 'object') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    const bridge = userbind as UserbindBoundLookup;
    if (typeof bridge.findStudentByUserId !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    return bridge;
}

export function canEditOthersExternalRating(actor: ExternalRatingActor): boolean {
    assertActor(actor);
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS);
}

async function assertBoundStudent(domainId: string, uid: number): Promise<void> {
    const student = await userbindOrThrow().findStudentByUserId(domainId, uid);
    if (!student || student.boundUserId !== uid) {
        logStage('unbound', `domainId=${domainId} uid=${uid}`);
        throw new ExternalRatingUnboundError();
    }
}

async function assertCanWrite(actor: ExternalRatingActor, domainId: string, targetUid: number): Promise<void> {
    assertActor(actor);
    const domain = assertDomainId(domainId);
    const uid = assertUid(targetUid, 'targetUid');
    if (actor._id !== uid && !canEditOthersExternalRating(actor)) {
        throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
    }
    await assertBoundStudent(domain, uid);
}

function cloneState(state: UserExternalRatingState): UserExternalRatingState {
    return {
        codeforces: { ...state.codeforces },
        nowcoder: { ...state.nowcoder },
    };
}

function assertOnlySiteKeys(record: Record<string, unknown>, field: string): void {
    for (const key of Object.keys(record)) {
        if (!isExternalRatingSiteId(key)) {
            throw new ValidationError(`${field}.${key}`, null, localizedErrorText`未知外站`);
        }
    }
}

function normalizeSiteHandle(site: ExternalRatingSiteId, raw: unknown): string {
    return site === 'codeforces' ? normalizeCfHandle(raw) : normalizeNowcoderName(raw);
}

async function readUserDoc(uid: number): Promise<Record<string, unknown>> {
    const id = assertUid(uid, 'uid');
    const udoc = await UserModel.coll.findOne({ _id: id });
    if (!udoc) throw new UserNotFoundError(id);
    return udoc as unknown as Record<string, unknown>;
}

async function persistState(uid: number, state: UserExternalRatingState): Promise<UserExternalRatingState> {
    const canonical = parseUserExternalRatingState(state);
    const res = await UserModel.setById(uid, { [USER_EXTERNAL_RATING_KEY]: canonical });
    if (!res) throw new UserNotFoundError(uid);
    return canonical;
}

function applyHandleWrites(current: UserExternalRatingState, handles: unknown): UserExternalRatingState {
    if (handles === undefined) return current;
    assertClientMayNotSetSnapshotFields(handles);
    if (!isPlainObject(handles)) {
        throw new ValidationError('handles', null, localizedErrorText`handles 必须是对象`);
    }
    assertOnlySiteKeys(handles, 'handles');
    let next = current;
    for (const site of EXTERNAL_RATING_SITES) {
        if (!Object.hasOwn(handles, site)) continue;
        const raw = handles[site];
        if (raw === undefined) continue;
        const handle = normalizeSiteHandle(site, raw);
        next = withSiteSnapshot(next, site, snapshotAfterHandleChange(next[site], site, handle));
    }
    return next;
}

function applyFlagWrites(current: UserExternalRatingState, flags: unknown): UserExternalRatingState {
    if (flags === undefined) return current;
    assertClientMayNotSetSnapshotFields(flags);
    if (!isPlainObject(flags)) {
        throw new ValidationError('flags', null, localizedErrorText`flags 必须是对象`);
    }
    assertOnlySiteKeys(flags, 'flags');
    let next = current;
    for (const site of EXTERNAL_RATING_SITES) {
        if (!Object.hasOwn(flags, site)) continue;
        const raw = flags[site];
        if (raw === undefined) continue;
        assertClientMayNotSetSnapshotFields(raw);
        if (!isPlainObject(raw)) {
            throw new ValidationError(`flags.${site}`, null, localizedErrorText`公开开关必须是对象`);
        }
        for (const key of Object.keys(raw)) {
            if (key !== 'publicShow') {
                throw new ValidationError(`flags.${site}.${key}`, null, localizedErrorText`未知公开开关字段`);
            }
        }
        if (!Object.hasOwn(raw, 'publicShow')) continue;
        const publicShow = parsePublicFlag(raw.publicShow);
        if (publicShow === true && isHandleUnset(next[site].handle)) {
            throw new ValidationError(`${site}.publicShow`, null, localizedErrorText`未填写账号不能公开`);
        }
        next = withSiteSnapshot(next, site, { ...next[site], publicShow });
    }
    return next;
}

/** Missing `externalRating` is all-hidden defaults. Corrupt stored data fails closed. */
export async function loadState(uid: number): Promise<UserExternalRatingState> {
    const udoc = await readUserDoc(uid);
    const raw = udoc[USER_EXTERNAL_RATING_KEY];
    return parseUserExternalRatingState(raw ?? null);
}

/**
 * Persist handles and publicShow only. Client-supplied rating / fetchedAt /
 * lastError are rejected. Handle change clears that site's snapshot (G8).
 */
export async function saveHandlesAndFlags(input: SaveExternalRatingHandlesAndFlagsInput): Promise<UserExternalRatingState> {
    if (!input || typeof input !== 'object') {
        throw new TypeError('saveHandlesAndFlags input is required');
    }
    const targetUid = assertUid(input.targetUid, 'targetUid');
    await assertCanWrite(input.actor, input.domainId, targetUid);
    assertClientMayNotSetSnapshotFields({ handles: input.handles, flags: input.flags });
    const current = cloneState(await loadState(targetUid));
    const next = applyFlagWrites(applyHandleWrites(current, input.handles), input.flags);
    const saved = await persistState(targetUid, next);
    logStage('save_handles', `uid=${targetUid} actor=${input.actor._id}`);
    return saved;
}

/**
 * Persist a post-fetch snapshot. Caller is the fetch module, not a client.
 * Handles and publicShow must still match the stored identity; this path
 * cannot change them or invent a rating for a different handle.
 */
export async function saveSnapshot(uid: number, state: UserExternalRatingState): Promise<UserExternalRatingState> {
    const id = assertUid(uid, 'uid');
    const current = await loadState(id);
    const incoming = parseUserExternalRatingState(state);
    let next = cloneState(current);
    for (const site of EXTERNAL_RATING_SITES) {
        const stored = current[site];
        const snapshot = incoming[site];
        if (!sameExternalRatingHandle(site, stored.handle, snapshot.handle)) {
            throw new ValidationError(`${site}.handle`, null, localizedErrorText`快照 handle 与已保存账号不一致`);
        }
        if (snapshot.publicShow !== stored.publicShow) {
            throw new ValidationError(`${site}.publicShow`, null, localizedErrorText`快照不能修改公开开关`);
        }
        next = withSiteSnapshot(next, site, {
            ...stored,
            rating: snapshot.rating,
            fetchedAt: snapshot.fetchedAt,
            lastError: snapshot.lastError,
        });
    }
    const saved = await persistState(id, next);
    logStage('save_snapshot', `uid=${id}`);
    return saved;
}
