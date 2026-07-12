/**
 * User-bound API access tokens ("kat" = Krypton Access Token).
 *
 * The evolution of `lib/service-token.ts`: where service-token is a flat
 * channel-level credential (vigil/tagger), this binds a token to a Hydro user
 * so authorization can reuse Hydro's native permission system instead of a
 * parallel RBAC. See docs/PLAN-2026-06-11-krypton-toolkit-authtoken.md.
 *
 * ## Three-layer authorization (all keyed on the bound uid)
 *
 *   1. identity   — token → uid → `UserModel.getById(domain, uid, scopeMask)`,
 *                   then normal `checkPerm` / `own`. Reuses the 71-bit PERM model
 *                   and the `User.scope` intersection primitive.
 *   2. channel    — `channels[]` gate which endpoints the token may reach.
 *   3. data scope — `scopeFilters` (school / enrollmentYear / score-level) are
 *                   applied by each consuming handler as a mongo query
 *                   constraint. Problems keep their existing id-level
 *                   maintainer/permits — they do NOT use scopeFilters.
 *
 * ## Security posture
 *
 * - **hash-at-rest.** Only `SHA-256(token)` is stored; the plaintext is shown
 *   once at issue and is unrecoverable thereafter (mongo dump leak ≠ token leak).
 * - **live lookup.** Every request hits the collection (not the cached `system`
 *   settings) → revoke/expire take effect immediately, no restart (cf. 坑6).
 * - **`uid: null`** is a pure service token (channel-only, vigil-style); no Hydro
 *   user is bound and no perm check applies — the handler does its own auth.
 */

import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { CreateError, ForbiddenError } from '../error';
import { AuthTokenDoc, ScopeFilters } from '../interface';
import { PRIV } from '../model/builtin';
import UserModel, { User } from '../model/user';
import db from '../service/db';
import { Handler } from '../service/server';

const logger = new Logger('auth-token');

/** Header inspected on incoming requests (lower-cased to match koa). Shared with service-token. */
const HEADER = 'x-service-token';

/** 403 + JSON (ForbiddenError is a UserFacingError, so it renders cleanly for the desktop client). */
// CreateError is a factory (aliased `Err` in error.ts), NOT a constructor — must be called without `new`.
// eslint-disable-next-line unicorn/throw-new-error
export const AuthTokenRejectedError = CreateError('AuthTokenRejectedError', ForbiddenError, '访问令牌无效、已撤销或已过期。');

const coll = db.collection('authtoken.tokens');

export function hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext.trim(), 'utf8').digest('hex');
}

let indexesEnsured = false;
export async function ensureAuthTokenIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    await db.ensureIndexes(
        coll,
        { key: { hash: 1 }, name: 'hash', unique: true },
        { key: { uid: 1 }, name: 'uid', sparse: true },
        { key: { domainId: 1, createdAt: -1 }, name: 'list' },
        // TTL: reap rows whose expiresAt is a past Date. Rows with expiresAt:null
        // are not Date-typed → mongo TTL skips them → they never expire.
        { key: { expiresAt: 1 }, name: 'expire', expireAfterSeconds: 0 },
    );
}

export interface IssueOpts {
    /** Bound Hydro user; null/omit => pure service token. */
    uid?: number | null;
    channels: string[];
    /** Permission-bitmask cap; omit/null => no extra narrowing (PERM_ALL). */
    scopeMask?: bigint | null;
    scopeFilters?: ScopeFilters;
    label?: string;
    domainId?: string;
    createdBy: number;
    /** Absolute expiry; null/omit => never expires. */
    expiresAt?: Date | null;
}

/**
 * Normalize scopeFilters at the mint point so malformed values never enter the
 * DB (defense-in-depth — each consuming handler also re-validates). Known keys
 * are type-checked; unknown keys are preserved for forward-compat with future
 * channels.
 */
function sanitizeScopeFilters(input: any): ScopeFilters {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out: ScopeFilters = { ...input };
    if ('years' in out) {
        out.years = Array.isArray(out.years) ? out.years.filter((y: any) => Number.isInteger(y)) : [];
    }
    if ('schools' in out) {
        out.schools = Array.isArray(out.schools) ? out.schools.filter((s: any) => typeof s === 'string' && s) : [];
    }
    if ('scoreLevels' in out) {
        out.scoreLevels = Array.isArray(out.scoreLevels) ? out.scoreLevels.filter((s: any) => typeof s === 'string' && s) : [];
    }
    return out;
}

/** Mint a token. Returns the plaintext ONCE (never stored) plus the stored doc. */
export async function issueAuthToken(opts: IssueOpts): Promise<{ token: string; doc: AuthTokenDoc }> {
    await ensureAuthTokenIndexes();
    const token = `kat_${randomBytes(24).toString('base64url')}`;
    const channels = [...new Set((opts.channels || []).map((c) => String(c).trim()).filter(Boolean))];
    if (!channels.length) throw new AuthTokenRejectedError();
    const doc: AuthTokenDoc = {
        _id: new ObjectId(),
        hash: hashToken(token),
        display: `${token.slice(0, 12)}…`,
        domainId: opts.domainId || 'system',
        uid: opts.uid ?? null,
        channels,
        scopeMask: opts.scopeMask != null ? opts.scopeMask.toString() : null,
        scopeFilters: sanitizeScopeFilters(opts.scopeFilters),
        label: opts.label || '',
        createdBy: opts.createdBy,
        createdAt: new Date(),
        lastUsedAt: null,
        expiresAt: opts.expiresAt ?? null,
        revoked: false,
    };
    await coll.insertOne(doc);
    logger.info('issued (display=%s uid=%s channels=%s)', doc.display, String(doc.uid), channels.join(','));
    return { token, doc };
}

/**
 * Look up + validate a presented token. Returns the doc or null. Checks
 * revoked + expiry defensively (the TTL index can lag a deletion by up to 60s).
 */
export async function verifyAuthToken(presented: string): Promise<AuthTokenDoc | null> {
    if (!presented) return null;
    const doc = await coll.findOne({ hash: hashToken(presented) });
    if (!doc) return null;
    if (doc.revoked) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) return null;
    return doc;
}

/** Fire-and-forget `lastUsedAt` bump (zombie-token detection in the admin list). */
function touchLastUsed(id: ObjectId): void {
    coll.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } }).catch(() => {
        /* best-effort */
    });
}

export interface ResolvedAuthToken {
    doc: AuthTokenDoc;
    scopeFilters: ScopeFilters;
    channels: string[];
}

/**
 * Validate the `X-Service-Token` header and, for user-bound tokens, set
 * `handler.user` to the bound Hydro user capped by the token's scope-mask — so
 * all downstream `checkPerm` / `own` honor "user perms ∩ scope" automatically.
 * Also exposes `handler.tokenDoc`. Throws AuthTokenRejectedError on failure.
 *
 * Call from a Handler's `prepare()` (which must set `noCheckPermView = true`).
 */
export async function resolveAuthToken(handler: Handler): Promise<ResolvedAuthToken> {
    const presented = handler.request.headers[HEADER];
    const token = Array.isArray(presented) ? presented[0] : presented;
    const doc = token ? await verifyAuthToken(token) : null;
    if (!doc) {
        logger.warn('rejected (prefix=%s)', token ? token.slice(0, 8) : '<none>');
        throw new AuthTokenRejectedError();
    }
    if (doc.uid != null) {
        // getById's LRU cache key omits `scope`, so passing a scope there is
        // unsafe: a cache hit returns the cached (PERM_ALL) user — silently
        // ignoring the mask — and a cache miss would poison the shared instance
        // with the token's narrow scope. So fetch WITHOUT scope (matches a
        // normal web session), then derive a fresh, non-cached User capped by it.
        const base = await UserModel.getById(doc.domainId, doc.uid);
        if (!base || base._id !== doc.uid) {
            logger.warn('bound user %s not found for token %s', String(doc.uid), doc.display);
            throw new AuthTokenRejectedError();
        }
        // A banned / deactivated account (priv cleared) must not stay usable via a token.
        if (!base.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            logger.warn('bound user %s banned/deactivated (token %s)', String(doc.uid), doc.display);
            throw new AuthTokenRejectedError();
        }
        let bound = base;
        if (doc.scopeMask != null) {
            let mask: bigint;
            try {
                mask = BigInt(doc.scopeMask);
            } catch {
                logger.warn('malformed scopeMask on token %s', doc.display);
                throw new AuthTokenRejectedError();
            }
            bound = await new User(base._udoc, base._dudoc, mask).init();
        }
        (handler as any).user = bound;
    }
    (handler as any).tokenDoc = doc;
    touchLastUsed(doc._id);
    return { doc, scopeFilters: doc.scopeFilters || {}, channels: doc.channels || [] };
}

/** As `resolveAuthToken`, plus enforce that the token carries `channel`. */
export async function requireAuthToken(handler: Handler, channel: string): Promise<ResolvedAuthToken> {
    const resolved = await resolveAuthToken(handler);
    if (!resolved.channels.includes(channel)) {
        logger.warn('token %s lacks channel "%s"', resolved.doc.display, channel);
        throw new AuthTokenRejectedError();
    }
    return resolved;
}

/** Revoke: reject immediately (live lookup checks `revoked`) and let TTL reap the row. */
export async function revokeAuthToken(id: ObjectId): Promise<boolean> {
    const res = await coll.updateOne({ _id: id }, { $set: { revoked: true, expiresAt: new Date() } });
    return res.matchedCount > 0;
}

/**
 * Renew: extend (or clear, with null) the expiry of a LIVE token. Refuses to
 * touch a revoked row — revoke is a permanent kill; a leaked secret must never
 * be resurrected. To re-grant access, issue a fresh token.
 */
export async function renewAuthToken(id: ObjectId, expiresAt: Date | null): Promise<boolean> {
    const res = await coll.updateOne({ _id: id, revoked: { $ne: true } }, { $set: { expiresAt } });
    return res.matchedCount > 0;
}

/**
 * Edit a LIVE token's channels / data-scope / label IN PLACE — lets an admin
 * widen or narrow an already-issued token's reach without re-minting (the secret
 * is unchanged). Does NOT touch expiry (see renewAuthToken) and refuses a revoked
 * row (a killed token must never be reactivated). Only the keys present in
 * `patch` are written; `channels` must stay non-empty.
 */
export async function updateAuthToken(
    id: ObjectId,
    patch: { channels?: string[]; scopeFilters?: ScopeFilters; label?: string; scopeMask?: bigint | null },
): Promise<boolean> {
    const $set: Record<string, any> = {};
    if (patch.channels) {
        const channels = [...new Set(patch.channels.map((c) => String(c).trim()).filter(Boolean))];
        if (!channels.length) throw new AuthTokenRejectedError();
        $set.channels = channels;
    }
    if (patch.scopeFilters !== undefined) $set.scopeFilters = sanitizeScopeFilters(patch.scopeFilters);
    if (patch.label !== undefined) $set.label = patch.label;
    if (patch.scopeMask !== undefined) {
        $set.scopeMask = patch.scopeMask != null ? patch.scopeMask.toString() : null;
    }
    if (!Object.keys($set).length) return false;
    const res = await coll.updateOne({ _id: id, revoked: { $ne: true } }, { $set });
    return res.matchedCount > 0;
}

/** Admin listing — never returns `hash`. */
export async function listAuthTokens(filter: { uid?: number; domainId?: string } = {}): Promise<AuthTokenDoc[]> {
    const q: Record<string, any> = {};
    if (filter.uid != null) q.uid = filter.uid;
    if (filter.domainId) q.domainId = filter.domainId;
    return coll
        .find(q, { projection: { hash: 0 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray();
}
