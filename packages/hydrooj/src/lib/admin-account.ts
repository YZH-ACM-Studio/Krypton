import { cloneDeep } from 'lodash';
import { PRIV } from '@hydrooj/common';
import { isCredentialSecretKey } from './credential-sanitizer';

export const SUPERADMIN_UID = 2;
export const ACCOUNT_BULK_LIMIT = 100;
const ACCOUNT_LIST_PATH = '/admin/accounts';
const ACCOUNT_LIST_RETURN_PARAMS = [
    'q',
    'status',
    'admin',
    'security',
    'binding',
    'groupDomain',
    'group',
    'roleDomain',
    'role',
    'registeredFrom',
    'registeredTo',
    'loginFrom',
    'loginTo',
    'sort',
    'order',
    'page',
    'pageSize',
] as const;

/**
 * Account detail pages may return only to the account list on this site.
 * Export/action-only parameters are stripped so the back link cannot trigger a
 * download, reopen a sensitive action, or redirect to another detail page.
 */
export function normalizeAccountListReturnTo(value: unknown): string {
    if (typeof value !== 'string') return ACCOUNT_LIST_PATH;
    const raw = value.trim();
    if (!raw || raw.length > 2048) return ACCOUNT_LIST_PATH;
    const base = new URL('https://krypton.invalid');
    let parsed: URL;
    try {
        parsed = new URL(raw, base);
    } catch {
        return ACCOUNT_LIST_PATH;
    }
    if (parsed.origin !== base.origin || parsed.pathname !== ACCOUNT_LIST_PATH) return ACCOUNT_LIST_PATH;
    const normalized = new URLSearchParams();
    for (const key of ACCOUNT_LIST_RETURN_PARAMS) {
        const entry = parsed.searchParams.get(key);
        if (entry) normalized.set(key, entry);
    }
    if (parsed.searchParams.get('view') === 'permissions') normalized.set('view', 'permissions');
    return `${ACCOUNT_LIST_PATH}${normalized.size ? `?${normalized}` : ''}`;
}

export interface AccountListCandidate {
    uid: number;
    username: string;
    email: string;
    displayName?: string;
    school?: string;
    studentId?: string;
    status: string;
    isAdmin: boolean;
    hasTfa: boolean;
    hasWebAuthn: boolean;
    oauthProviders: string[];
    binding?: null | { realName?: string; studentId?: string };
    registeredAt?: Date | string | null;
    lastLoginAt?: Date | string | null;
}

export interface AccountListFilter {
    q: string;
    status: string;
    admin: string;
    security: string;
    binding: string;
    registeredFrom: Date | null;
    registeredTo: Date | null;
    loginFrom: Date | null;
    loginTo: Date | null;
    sort: string;
    order: string;
}

export interface AccountListMembershipFilter {
    selected?: ReadonlySet<number> | null;
    groupMembers?: ReadonlySet<number> | null;
    roleMembers?: ReadonlySet<number> | null;
}

function dateValue(value: Date | string | null | undefined): number {
    if (!value) return 0;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/** Pure server-side list semantics, separated so every filter can be regression-tested without a database. */
export function filterAndSortAccountRows<T extends AccountListCandidate>(
    rows: T[],
    filter: AccountListFilter,
    membership: AccountListMembershipFilter = {},
): T[] {
    const needle = filter.q.toLocaleLowerCase();
    const result = rows.filter((row) => {
        if (membership.selected && !membership.selected.has(row.uid)) return false;
        if (filter.status === 'enabled' && row.status !== 'enabled') return false;
        if (filter.status === 'disabled' && row.status !== 'disabled') return false;
        if (filter.admin === 'yes' && !row.isAdmin) return false;
        if (filter.admin === 'no' && row.isAdmin) return false;
        if (filter.security === 'tfa' && !row.hasTfa) return false;
        if (filter.security === 'webauthn' && !row.hasWebAuthn) return false;
        if (filter.security === 'oauth' && !row.oauthProviders.length) return false;
        if (filter.security === 'none' && (row.hasTfa || row.hasWebAuthn || row.oauthProviders.length)) return false;
        if (filter.binding === 'bound' && !row.binding) return false;
        if (filter.binding === 'unbound' && row.binding) return false;
        if (membership.groupMembers && !membership.groupMembers.has(row.uid)) return false;
        if (membership.roleMembers && !membership.roleMembers.has(row.uid)) return false;
        const registeredAt = dateValue(row.registeredAt);
        const lastLoginAt = dateValue(row.lastLoginAt);
        if ((filter.registeredFrom || filter.registeredTo) && !registeredAt) return false;
        if ((filter.loginFrom || filter.loginTo) && !lastLoginAt) return false;
        if (filter.registeredFrom && registeredAt < filter.registeredFrom.getTime()) return false;
        if (filter.registeredTo && registeredAt > filter.registeredTo.getTime()) return false;
        if (filter.loginFrom && lastLoginAt < filter.loginFrom.getTime()) return false;
        if (filter.loginTo && lastLoginAt > filter.loginTo.getTime()) return false;
        if (!needle) return true;
        return [row.uid, row.username, row.email, row.displayName, row.school, row.studentId, row.binding?.realName, row.binding?.studentId]
            .some((value) => String(value || '').toLocaleLowerCase().includes(needle));
    });
    const direction = filter.order === 'asc' ? 1 : -1;
    result.sort((a, b) => {
        let compared = 0;
        if (filter.sort === 'username') compared = a.username.localeCompare(b.username, 'zh-CN');
        else if (filter.sort === 'registeredAt') compared = dateValue(a.registeredAt) - dateValue(b.registeredAt);
        else if (filter.sort === 'lastLoginAt') compared = dateValue(a.lastLoginAt) - dateValue(b.lastLoginAt);
        else compared = a.uid - b.uid;
        return compared * direction || a.uid - b.uid;
    });
    return result;
}

export function paginateAccountRows<T>(rows: T[], requestedPage: number, requestedPageSize: number) {
    if (!Number.isSafeInteger(requestedPage) || requestedPage <= 0) throw new Error('页码必须是正整数');
    if (!Number.isSafeInteger(requestedPageSize) || requestedPageSize <= 0) throw new Error('每页数量必须是正整数');
    const pageSize = Math.min(requestedPageSize, 100);
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(requestedPage, pageCount);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, pageCount };
}

/** Restore the saved privilege snapshot, but never resurrect system-admin authority. */
export function resolveRestoredPrivilege(previousPriv: unknown, defaultPriv: number): number {
    const previous = Number(previousPriv);
    let restored = Number.isSafeInteger(previous) && previous > 0 ? previous : defaultPriv;
    restored &= ~PRIV.PRIV_EDIT_SYSTEM;
    if (!restored) throw new Error('站点默认权限不能用于恢复账号');
    return restored;
}

export type AccountTargetOperation =
    | 'profile'
    | 'password'
    | 'disable'
    | 'restore'
    | 'privilege'
    | 'security'
    | 'session'
    | 'group'
    | 'role'
    | 'impersonate';

export interface AccountTargetPolicyInput {
    actorUid: number;
    targetUid: number;
    targetPriv: number;
    operation: AccountTargetOperation;
}

/**
 * Fail-closed policy shared by single and bulk account mutations.
 *
 * UID 2 is the site's immutable super-admin anchor. Disabling and proxying a
 * system administrator are intentionally stricter than editing an ordinary
 * account: the privilege editor is the only supported way to demote another
 * administrator, and it has its own last-admin/current-actor checks.
 */
export function validateAccountTarget(input: AccountTargetPolicyInput): void {
    const { actorUid, targetUid, targetPriv, operation } = input;
    if (!Number.isSafeInteger(targetUid) || targetUid <= 0) throw new Error('目标 UID 无效');
    if (targetUid === SUPERADMIN_UID) throw new Error('UID 2 是受保护的超级管理员，不能在账号管理页修改');
    if (operation === 'disable' && targetUid === actorUid) throw new Error('不能禁用当前管理员账号');
    if (['disable', 'impersonate'].includes(operation) && (targetPriv & PRIV.PRIV_EDIT_SYSTEM) === PRIV.PRIV_EDIT_SYSTEM) {
        throw new Error('不能禁用或切换到系统管理员账号；请先在权限编辑器中显式降级');
    }
}

/** Parse, de-duplicate and bound a bulk target list before any write occurs. */
export function normalizeTargetUids(value: string | number[]): number[] {
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    const parsed = raw.map((item) => Number(String(item).trim()));
    if (!parsed.length || parsed.some((uid) => !Number.isSafeInteger(uid) || uid <= 0)) throw new Error('UID 列表包含无效值');
    const unique = [...new Set(parsed)].sort((a, b) => a - b);
    if (unique.length > ACCOUNT_BULK_LIMIT) throw new Error(`单次最多操作 ${ACCOUNT_BULK_LIMIT} 个账号`);
    return unique;
}

/**
 * Return a sanitized clone suitable for audit/JSON output. Exact-key matching
 * deliberately keeps harmless metadata such as `tokenType` and `hasTfa`.
 */
export function redactAccountSecrets<T>(input: T): T {
    const cloned: any = cloneDeep(input);
    const walk = (value: any): any => {
        if (!value || typeof value !== 'object' || value instanceof Date) return value;
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return value;
        }
        for (const key of Object.keys(value)) {
            if (isCredentialSecretKey(key)) {
                delete value[key];
                continue;
            }
            walk(value[key]);
        }
        return value;
    };
    return walk(cloned);
}

export type ImportRowStatus = 'ok' | 'invalid' | 'duplicate';

export interface AccountImportRow {
    line: number;
    email: string;
    username: string;
    displayName: string;
    passwordPresent: boolean;
    extra: Record<string, unknown>;
    status: ImportRowStatus;
    message: string;
}

export interface AccountImportSecretRow extends AccountImportRow {
    /** Internal commit-only value. Never place this object in a response or oplog. */
    password: string;
}

/** Apply the same canonical email identity used by the user model before any import write. */
export function markCanonicalImportDuplicates<T extends AccountImportSecretRow>(
    rows: T[],
    normalizeEmail: (email: string) => string,
): T[] {
    const seenEmails = new Set<string>();
    const seenUsernames = new Set<string>();
    return rows.map((row) => {
        if (row.status !== 'ok') return row;
        const emailKey = normalizeEmail(row.email);
        const usernameKey = row.username.trim().toLowerCase();
        if (seenEmails.has(emailKey) || seenUsernames.has(usernameKey)) {
            return { ...row, status: 'duplicate', message: '本批次内邮箱或用户名重复' };
        }
        seenEmails.add(emailKey);
        seenUsernames.add(usernameKey);
        return row;
    });
}

function looksLikeEmail(value: string): boolean {
    if (!value || /\s/.test(value)) return false;
    const at = value.indexOf('@');
    return at > 0 && at === value.lastIndexOf('@') && value.indexOf('.', at + 2) > at + 1 && !value.endsWith('.');
}

function splitImportLine(raw: string): [string, string, string, string, string] {
    if (raw.includes('\t')) {
        const [email = '', username = '', password = '', displayName = '', ...extra] = raw.split('\t');
        return [email, username, password, displayName, extra.join('\t')];
    }
    const [email = '', username = '', password = '', displayName = '', ...extra] = raw.split(',');
    return [email, username, password, displayName, extra.join(',')];
}

const IMPORT_EXTRA_LIMITS: Record<string, number> = {
    group: 128,
    school: 200,
    studentId: 100,
};

export function parseAccountImportForCommit(text: string): AccountImportSecretRow[] {
    const lines = String(text || '').split(/\r?\n/);
    if (lines.length > 1000) throw new Error('单次最多导入 1000 行');
    const seenEmails = new Set<string>();
    const seenUsernames = new Set<string>();
    const rows: AccountImportSecretRow[] = [];
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        if (!raw.trim()) continue;
        const [rawEmail, rawUsername, rawPassword, rawDisplayName, rawExtra] = splitImportLine(raw);
        const email = rawEmail.trim();
        const username = rawUsername.trim();
        const password = rawPassword.trim();
        const displayName = rawDisplayName.trim();
        let extra: Record<string, unknown> = {};
        let status: ImportRowStatus = 'ok';
        let message = '';
        if (!email || !username || !password) {
            status = 'invalid';
            message = '邮箱、用户名和密码均为必填';
        } else if (!looksLikeEmail(email)) {
            status = 'invalid';
            message = '邮箱格式无效';
        } else if (!/^[\p{L}\p{N}_\-.]{1,64}$/u.test(username)) {
            status = 'invalid';
            message = '用户名格式无效';
        }
        if (rawExtra.trim()) {
            try {
                const parsed = JSON.parse(rawExtra);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('extra must be an object');
                extra = parsed;
                const unknown = Object.keys(extra).filter((key) => !(key in IMPORT_EXTRA_LIMITS));
                if (unknown.length) {
                    status = 'invalid';
                    message = `额外信息包含不支持的字段：${unknown.join(', ')}`;
                } else {
                    for (const [key, limit] of Object.entries(IMPORT_EXTRA_LIMITS)) {
                        if (extra[key] == null) continue;
                        if (typeof extra[key] !== 'string' || extra[key].length > limit) {
                            status = 'invalid';
                            message = `额外信息 ${key} 必须是不超过 ${limit} 个字符的字符串`;
                            break;
                        }
                    }
                }
            } catch (error) {
                status = 'invalid';
                message = `额外信息 JSON 无效：${error instanceof Error ? error.message : String(error)}`;
            }
        }
        const emailKey = email.toLowerCase();
        const usernameKey = username.toLowerCase();
        if (status === 'ok' && (seenEmails.has(emailKey) || seenUsernames.has(usernameKey))) {
            status = 'duplicate';
            message = '本批次内邮箱或用户名重复';
        }
        if (status === 'ok') {
            seenEmails.add(emailKey);
            seenUsernames.add(usernameKey);
        }
        rows.push({
            line: index + 1,
            email,
            username,
            password,
            displayName,
            passwordPresent: !!password,
            extra,
            status,
            message,
        });
    }
    return rows;
}

/** Public preview representation: password values are discarded, not masked. */
export function parseAccountImport(text: string): AccountImportRow[] {
    return parseAccountImportForCommit(text).map(({ password: _password, ...row }) => redactAccountSecrets(row));
}

export interface AccountCsvRow {
    uid: number;
    username: string;
    email: string;
    displayName?: string;
    status: string;
    school?: string;
    studentId?: string;
    priv: number;
    registeredAt?: Date | string | null;
    lastLoginAt?: Date | string | null;
}

function csvCell(value: unknown): string {
    let text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value);
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

/** UTF-8 BOM + CRLF keeps Chinese readable in Microsoft Excel and WPS. */
export function buildAccountCsv(rows: AccountCsvRow[]): string {
    const header = ['UID', '用户名', '邮箱', '显示名', '状态', '学校', '学号', '权限值', '注册时间', '最近登录'];
    const lines = [header.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push([
            row.uid,
            row.username,
            row.email,
            row.displayName || '',
            row.status,
            row.school || '',
            row.studentId || '',
            row.priv,
            row.registeredAt || '',
            row.lastLoginAt || '',
        ].map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}
