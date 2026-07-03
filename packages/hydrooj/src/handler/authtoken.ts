/**
 * Auth-token management (issue / list / revoke / renew) + capability discovery.
 *
 * Management routes are gated by `PRIV_EDIT_SYSTEM` (a logged-in system admin,
 * session-authed — NOT a token). The capability route is token-authed and lets
 * the desktop Shell discover which tabs to render. See lib/auth-token.ts and
 * docs/PLAN-2026-06-11-krypton-toolkit-authtoken.md.
 */
import type { ObjectId } from 'mongodb';
import {
    Context, Handler, OplogModel, param, PERM, PRIV, Types, UserModel,
} from 'hydrooj';
import {
    ensureAuthTokenIndexes, issueAuthToken, listAuthTokens, renewAuthToken,
    resolveAuthToken, revokeAuthToken, updateAuthToken,
} from '../lib/auth-token';

function expiryFromDays(expireDays: number): Date | null {
    return expireDays && expireDays > 0 ? new Date(Date.now() + expireDays * 86400 * 1000) : null;
}

// ─── /admin/authtoken (PRIV_EDIT_SYSTEM) ─────────────────────────────────────

class AuthTokenAdminHandler extends Handler {
    async get() {
        const tokens = await listAuthTokens();
        // Resolve bound usernames for the list (uid is global; any domain works for uname).
        const uids = [...new Set(tokens.map((t) => t.uid).filter((u): u is number => u != null))];
        const udict = uids.length ? await UserModel.getList('system', uids) : {};
        const unames: Record<number, string> = {};
        for (const uid of uids) unames[uid] = udict[uid]?.uname || `UID ${uid}`;
        // No ui-default template file: setting this name routes to the ui-next
        // 'next' fallback renderer, which resolves PAGE_MAP['admin_authtoken.html'].
        this.response.template = 'admin_authtoken.html';
        this.response.body = { tokens, unames };
    }

    @param('channels', Types.CommaSeperatedArray)
    @param('uid', Types.Int, true)
    @param('label', Types.String, true)
    @param('expireDays', Types.UnsignedInt, true)
    @param('years', Types.CommaSeperatedArray, true)
    async postIssue(
        _args: any, channels: string[], uid: number, label: string,
        expireDays: number, years: string[],
    ) {
        // Build scopeFilters from structured params, NOT a JSON-string field:
        // Types.Any is identity, so a urlencoded JSON string would arrive as a
        // string, fail issueAuthToken's object guard, and silently issue an
        // UNSCOPED token. `years` is the only filter any handler enforces today.
        const scopeFilters: Record<string, any> = {};
        if (years && years.length) {
            const ys = years
                .map((y) => parseInt(String(y).trim(), 10))
                .filter((y) => Number.isSafeInteger(y));
            if (ys.length) scopeFilters.years = ys;
        }
        const { token, doc } = await issueAuthToken({
            uid: Number.isSafeInteger(uid) && uid > 0 ? uid : null,
            channels,
            scopeFilters,
            label: label || '',
            domainId: 'system',
            createdBy: this.user._id,
            expiresAt: expiryFromDays(expireDays),
        });
        await OplogModel.log(this as any, 'authtoken.issue', {
            display: doc.display, uid: doc.uid, channels: doc.channels, label: doc.label, expiresAt: doc.expiresAt,
        });
        // Plaintext returned ONCE — never recoverable after this response.
        const safe: any = { ...doc };
        delete safe.hash;
        this.response.body = { token, doc: safe };
    }

    @param('id', Types.ObjectId)
    @param('channels', Types.CommaSeperatedArray, true)
    @param('label', Types.String, true)
    @param('years', Types.CommaSeperatedArray, true)
    async postUpdate(
        _args: any, id: ObjectId, channels: string[], label: string, years: string[],
    ) {
        // Edit replaces the data-scope wholesale (an empty `years` field clears it),
        // mirroring postIssue's structured parsing. Expiry is changed via renew.
        const scopeFilters: Record<string, any> = {};
        if (years && years.length) {
            const ys = years
                .map((y) => parseInt(String(y).trim(), 10))
                .filter((y) => Number.isSafeInteger(y));
            if (ys.length) scopeFilters.years = ys;
        }
        const patch: { channels?: string[]; scopeFilters?: Record<string, any>; label?: string } = {
            scopeFilters,
            label: label || '',
        };
        if (channels && channels.length) patch.channels = channels;
        const ok = await updateAuthToken(id, patch);
        await OplogModel.log(this as any, 'authtoken.update', {
            id: id.toHexString(), channels: patch.channels, years: scopeFilters.years,
        });
        this.response.body = { ok };
    }

    @param('id', Types.ObjectId)
    async postRevoke(_args: any, id: ObjectId) {
        const ok = await revokeAuthToken(id);
        await OplogModel.log(this as any, 'authtoken.revoke', { id: id.toHexString() });
        this.response.body = { ok };
    }

    @param('id', Types.ObjectId)
    @param('expireDays', Types.UnsignedInt, true)
    async postRenew(_args: any, id: ObjectId, expireDays: number) {
        const expiresAt = expiryFromDays(expireDays);
        const ok = await renewAuthToken(id, expiresAt);
        await OplogModel.log(this as any, 'authtoken.renew', { id: id.toHexString(), expiresAt });
        this.response.body = { ok };
    }
}

// ─── GET /api/me/capabilities (token-authed) ─────────────────────────────────

class AuthTokenCapabilitiesHandler extends Handler {
    noCheckPermView = true;

    async prepare() {
        await resolveAuthToken(this);
    }

    async get() {
        const u = this.user;
        const doc = (this as any).tokenDoc;
        this.response.body = {
            uid: u._id,
            uname: u.uname,
            channels: doc?.channels || [],
            scopeFilters: doc?.scopeFilters || {},
            perms: {
                editProblem: u.hasPerm(PERM.PERM_EDIT_PROBLEM),
                createProblem: u.hasPerm(PERM.PERM_CREATE_PROBLEM),
                readProblemData: u.hasPerm(PERM.PERM_READ_PROBLEM_DATA),
            },
        };
    }
}

export async function apply(ctx: Context) {
    ensureAuthTokenIndexes().catch((e) => {
        console.error('[authtoken] ensureIndexes failed:', e);
    });
    ctx.Route('authtoken_admin', '/admin/authtoken', AuthTokenAdminHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('authtoken_capabilities', '/api/me/capabilities', AuthTokenCapabilitiesHandler);
}
