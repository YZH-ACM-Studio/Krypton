import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Context } from '../context';
import {
    localizedErrorText,
    AccountStateConflictError,
    BadRequestError,
    ForbiddenError,
    LocalizedErrorText,
    UserNotFoundError,
    ValidationError,
} from '../error';
import {
    ACCOUNT_BULK_LIMIT,
    SUPERADMIN_UID,
    AccountCsvRow,
    AccountTargetOperation,
    buildAccountCsv,
    filterAndSortAccountRows,
    markCanonicalImportDuplicates,
    normalizeTargetUids,
    normalizeAccountListReturnTo,
    paginateAccountRows,
    parseAccountImportForCommit,
    redactAccountSecrets,
    resolveRestoredPrivilege,
    validateAccountTarget,
} from '../lib/admin-account';
import avatar from '../lib/avatar';
import { listAuthTokens, revokeAuthTokensByUid } from '../lib/auth-token';
import { Logger } from '../logger';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as document from '../model/document';
import domain from '../model/domain';
import * as oplog from '../model/oplog';
import RecordModel from '../model/record';
import system from '../model/system';
import token from '../model/token';
import user, { handleMailLower } from '../model/user';
import { Handler, param, Types } from '../service/server';

const logger = new Logger('admin-account');

const ACCOUNT_PROJECTION = {
    _id: 1,
    uname: 1,
    unameLower: 1,
    mail: 1,
    mailLower: 1,
    priv: 1,
    regat: 1,
    loginat: 1,
    loginip: 1,
    ip: 1,
    avatar: 1,
    qq: 1,
    gender: 1,
    bio: 1,
    school: 1,
    studentId: 1,
    tfa: 1,
    authenticators: 1,
    adminDisabled: 1,
    banReason: 1,
} as const;

const PRIVILEGE_ENTRIES = Object.entries(PRIV)
    .filter(([key, value]) => typeof value === 'number' && value > 0 && !['PRIV_DEFAULT', 'PRIV_NEVER'].includes(key))
    .map(([key, value]) => ({ key, value: Number(value) }));
const KNOWN_PRIV_MASK = PRIVILEGE_ENTRIES.reduce((mask, entry) => mask | entry.value, 0);
const LIST_SORTS = new Set(['uid', 'username', 'registeredAt', 'lastLoginAt']);
const LIST_ORDERS = new Set(['asc', 'desc']);
const LIST_STATUSES = new Set(['all', 'enabled', 'disabled']);
const LIST_ADMIN_FILTERS = new Set(['all', 'yes', 'no']);
const LIST_SECURITY_FILTERS = new Set(['all', 'tfa', 'webauthn', 'oauth', 'none']);
const LIST_BINDING_FILTERS = new Set(['all', 'bound', 'unbound']);
const SECURITY_ACTIONS = new Set(['clear_tfa', 'clear_webauthn', 'unlink_oauth', 'revoke_sessions', 'revoke_api_tokens', 'revoke_all']);
const BULK_ACTIONS = new Set(['disable', 'restore', 'force_logout', 'group_add', 'group_remove', 'set_role']);
const ACCOUNT_DETAIL_VIEWS = new Set(['profile', 'security', 'permissions', 'related', 'audit']);
const ACCOUNT_LIST_RETURN_QUERY_KEYS = [
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
    'view',
] as const;

interface AuditContext {
    targetUid?: number | null;
    targetUids?: number[];
    before?: unknown;
    impact?: string;
    progress?: Record<string, unknown>;
}

interface AuditWorkResult<T> {
    value: T;
    after?: unknown;
    detail?: Record<string, unknown>;
    targetUid?: number;
    targetUids?: number[];
}

function validation(field: string, message: LocalizedErrorText): never {
    throw new ValidationError(field, null, message);
}

function integerArg(value: unknown, field: string, positive = true): number {
    const parsed = typeof value === 'number' ? value : Number(String(value || '').trim());
    if (!Number.isSafeInteger(parsed) || (positive && parsed <= 0)) {
        validation(field, positive ? localizedErrorText`${field} 必须是正整数` : localizedErrorText`${field} 必须是整数`);
    }
    return parsed;
}

function legacyAccountDetailPath(args: any, uid: number): string {
    const returnParams = new URLSearchParams();
    for (const key of ACCOUNT_LIST_RETURN_QUERY_KEYS) {
        const value = args[key];
        if (value == null || String(value).trim() === '') continue;
        returnParams.set(key, String(value));
    }
    const detailParams = new URLSearchParams();
    const view = String(args.view || args.tab || '');
    if (ACCOUNT_DETAIL_VIEWS.has(view)) detailParams.set('view', view);
    if (String(args.action || '') === 'impersonate') detailParams.set('action', 'impersonate');
    for (const key of ['groupDomain', 'roleDomain'] as const) {
        if (args[key]) detailParams.set(key, String(args[key]));
    }
    detailParams.set('returnTo', normalizeAccountListReturnTo(`/admin/accounts${returnParams.size ? `?${returnParams}` : ''}`));
    return `/admin/accounts/${uid}?${detailParams}`;
}

function booleanArg(value: unknown, field: string): boolean {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    validation(field, localizedErrorText`${field} 必须是布尔值`);
}

function stringArg(value: unknown, field: string, max: number, allowEmpty = true): string {
    const parsed = value == null ? '' : String(value);
    if (!allowEmpty && !parsed.trim()) validation(field, localizedErrorText`${field} 不能为空`);
    if (parsed.length > max) validation(field, localizedErrorText`${field} 最多 ${max} 个字符`);
    return parsed;
}

function enumArg(value: unknown, field: string, allowed: Set<string>, fallback: string): string {
    const parsed = String(value || fallback);
    if (!allowed.has(parsed)) validation(field, localizedErrorText`${field} 的值无效`);
    return parsed;
}

function dateArg(value: unknown, field: string, endOfDay = false): Date | null {
    if (!value) return null;
    const raw = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00` : raw);
    if (Number.isNaN(date.getTime())) validation(field, localizedErrorText`${field} 不是有效日期`);
    return date;
}

function isSystemAdmin(priv: number): boolean {
    return (priv & PRIV.PRIV_EDIT_SYSTEM) === PRIV.PRIV_EDIT_SYSTEM;
}

function isUsableSystemAdmin(priv: number): boolean {
    return priv !== PRIV.PRIV_NONE && isSystemAdmin(priv) && (priv & PRIV.PRIV_USER_PROFILE) === PRIV.PRIV_USER_PROFILE;
}

function siteDefaultPrivilege(): number {
    const configured = Number(system.get('default.priv'));
    if (
        !Number.isSafeInteger(configured) ||
        configured <= 0 ||
        isSystemAdmin(configured) ||
        (configured & PRIV.PRIV_USER_PROFILE) !== PRIV.PRIV_USER_PROFILE
    ) {
        throw new Error(`系统设置 default.priv 无效：${String(system.get('default.priv'))}`);
    }
    return configured;
}

function safeUserSummary(udoc: any, displayName = '') {
    return {
        uid: Number(udoc._id),
        username: String(udoc.uname || ''),
        email: String(udoc.mail || ''),
        displayName: String(displayName || ''),
        avatar: String(udoc.avatar || ''),
        qq: String(udoc.qq || ''),
        gender: Number.isSafeInteger(udoc.gender) ? udoc.gender : 0,
        bio: String(udoc.bio || ''),
        school: String(udoc.school || ''),
        studentId: String(udoc.studentId || ''),
        priv: Number(udoc.priv || 0),
        status: Number(udoc.priv || 0) === PRIV.PRIV_NONE ? 'disabled' : 'enabled',
    };
}

function accountProfileVersion(summary: ReturnType<typeof safeUserSummary>): string {
    return createHash('sha256').update(JSON.stringify(summary)).digest('base64url');
}

function assertExpectedProfileVersion(expected: unknown, summary: ReturnType<typeof safeUserSummary>) {
    const version = stringArg(expected, 'expectedProfileVersion', 128, false);
    if (version !== accountProfileVersion(summary)) {
        throw new AccountStateConflictError(localizedErrorText`基本资料已被其他操作修改`);
    }
}

function assertExpectedPrivilege(expected: unknown, current: number) {
    if (integerArg(expected, 'expectedPriv', false) !== current) {
        throw new AccountStateConflictError(localizedErrorText`账号权限或禁用状态已被其他操作修改`);
    }
}

function convertTargetPolicyError(error: unknown): never {
    if (!(error instanceof Error)) throw error;
    if (error.message === '目标 UID 无效') throw new BadRequestError(localizedErrorText`目标 UID 无效`);
    if (error.message === 'UID 2 是受保护的超级管理员，不能在账号管理页修改') {
        throw new BadRequestError(localizedErrorText`UID 2 是受保护的超级管理员，不能在账号管理页修改`);
    }
    if (error.message === '不能禁用当前管理员账号') {
        throw new BadRequestError(localizedErrorText`不能禁用当前管理员账号`);
    }
    if (error.message === '不能禁用或切换到系统管理员账号；请先在权限编辑器中显式降级') {
        throw new BadRequestError(localizedErrorText`不能禁用或切换到系统管理员账号；请先在权限编辑器中显式降级`);
    }
    if (error.message === 'UID 列表包含无效值') throw new BadRequestError(localizedErrorText`UID 列表包含无效值`);
    if (error.message === `单次最多操作 ${ACCOUNT_BULK_LIMIT} 个账号`) {
        throw new BadRequestError(localizedErrorText`单次最多操作 ${ACCOUNT_BULK_LIMIT} 个账号`);
    }
    throw error;
}

function assertTarget(actorUid: number, target: any, operation: AccountTargetOperation) {
    try {
        validateAccountTarget({ actorUid, targetUid: target._id, targetPriv: target.priv, operation });
    } catch (error) {
        convertTargetPolicyError(error);
    }
}

async function getTarget(uid: number): Promise<any> {
    const target = await user.coll.findOne({ _id: uid }, { projection: ACCOUNT_PROJECTION });
    if (!target) throw new UserNotFoundError(uid);
    return target;
}

async function getTargets(uids: number[]): Promise<any[]> {
    const targets = await user.coll.find({ _id: { $in: uids } }, { projection: ACCOUNT_PROJECTION }).toArray();
    if (targets.length !== uids.length) {
        const found = new Set(targets.map((target) => target._id));
        throw new UserNotFoundError(uids.find((uid) => !found.has(uid)));
    }
    return targets.sort((a, b) => a._id - b._id);
}

async function requireAdminPassword(handler: Handler, password: unknown) {
    const value = stringArg(password, 'password', 1024, false);
    await handler.limitRate('admin_account_password', 60, 5, '{{ip}}@{{user}}');
    await handler.user.checkPassword(value);
    const actor = await user.coll.findOne({ _id: handler.user._id }, { projection: { priv: 1 } });
    if (!actor || !isUsableSystemAdmin(Number(actor.priv))) {
        throw new ForbiddenError(localizedErrorText`当前账号已不再拥有系统管理权限`);
    }
}

/**
 * Insert an audit intent before the write. The caller then updates the same
 * row to success/failure, so an audit outage prevents mutation and a crash in
 * the middle remains visible as `started` instead of disappearing.
 */
export async function auditAccountOperation(
    handler: Handler,
    operation: string,
    context: AuditContext,
    operatorUid = handler.user?._id,
): Promise<ObjectId> {
    return await oplog.add({
        type: `admin.account.${operation}`,
        time: new Date(),
        domainId: handler.args.domainId,
        ua: handler.request.headers?.['user-agent'],
        referer: handler.request.headers?.referer,
        path: handler.request.path,
        operator: operatorUid,
        operateIp: handler.request.ip,
        result: 'started',
        ...redactAccountSecrets(context),
    });
}

async function runAccountOperation<T>(
    handler: Handler,
    operation: string,
    context: AuditContext,
    work: () => Promise<AuditWorkResult<T>>,
    operatorUid = handler.user?._id,
): Promise<T> {
    const auditId = await auditAccountOperation(handler, operation, context, operatorUid);
    try {
        const result = await work();
        const finalized = await oplog.coll.updateOne(
            { _id: auditId },
            {
                $set: {
                    result: 'success',
                    finishedAt: new Date(),
                    after: redactAccountSecrets(result.after),
                    detail: redactAccountSecrets(result.detail),
                    progress: redactAccountSecrets(context.progress),
                    ...(result.targetUid || context.targetUid ? { targetUid: result.targetUid || context.targetUid } : {}),
                    ...(result.targetUids || context.targetUids ? { targetUids: result.targetUids || context.targetUids } : {}),
                },
            },
        );
        if (finalized.matchedCount !== 1) throw new Error(`账号审计 ${auditId.toHexString()} 在成功收尾时不存在`);
        return result.value;
    } catch (error) {
        try {
            const finalized = await oplog.coll.updateOne(
                { _id: auditId },
                {
                    $set: {
                        result: 'failed',
                        finishedAt: new Date(),
                        error: {
                            name: error instanceof Error ? error.name : 'Error',
                            message: error instanceof Error ? error.message : String(error),
                        },
                        progress: redactAccountSecrets(context.progress),
                        ...(context.targetUid ? { targetUid: context.targetUid } : {}),
                        ...(context.targetUids ? { targetUids: context.targetUids } : {}),
                    },
                },
            );
            if (finalized.matchedCount !== 1) throw new Error(`账号审计 ${auditId.toHexString()} 在失败收尾时不存在`);
        } catch (auditError) {
            logger.error(
                'Failed to finalize account audit %s: %s',
                auditId.toHexString(),
                auditError instanceof Error ? auditError.stack : String(auditError),
            );
            throw new AggregateError([error, auditError], '账号操作失败，且审计结果写入失败');
        }
        throw error;
    }
}

async function revokeAccountAccess(uid: number, includeCore = true, includeApi = true) {
    const result = { coreTokens: 0, apiTokens: 0 };
    try {
        if (includeCore) {
            const deleted = await token.delAccountAccessByUid(uid);
            result.coreTokens = Number((deleted as any)?.deletedCount || 0);
        }
        if (includeApi) result.apiTokens = await revokeAuthTokensByUid(uid);
    } catch (error) {
        throw new Error(`撤销 UID ${uid} 的访问凭据失败`, { cause: error });
    }
    return result;
}

function validateImportRows(rows: ReturnType<typeof parseAccountImportForCommit>) {
    const validated = rows.map((row) => {
        if (row.status !== 'ok') return row;
        if (!Types.Email[1](row.email)) return { ...row, status: 'invalid' as const, message: '邮箱格式无效' };
        if (!Types.Username[1](row.username)) return { ...row, status: 'invalid' as const, message: '用户名格式无效' };
        if (!Types.Password[1](row.password)) return { ...row, status: 'invalid' as const, message: '密码格式无效' };
        return row;
    });
    return markCanonicalImportDuplicates(validated, handleMailLower);
}

interface ListQuery {
    q: string;
    status: string;
    admin: string;
    security: string;
    binding: string;
    groupDomain: string;
    group: string;
    roleDomain: string;
    role: string;
    registeredFrom: Date | null;
    registeredTo: Date | null;
    loginFrom: Date | null;
    loginTo: Date | null;
    sort: string;
    order: string;
    selected: number[] | null;
}

interface AccountListRow extends AccountCsvRow {
    avatarUrl: string;
    isAdmin: boolean;
    hasTfa: boolean;
    hasWebAuthn: boolean;
    oauthProviders: string[];
    binding: null | { studentId: string; realName: string; enrollmentYear?: number | null };
    protected: boolean;
}

function parseListQuery(args: any): ListQuery {
    let selected: number[] | null = null;
    if (args.selected) {
        try {
            selected = normalizeTargetUids(String(args.selected));
        } catch (error) {
            convertTargetPolicyError(error);
        }
    }
    return {
        q: stringArg(args.q, 'q', 200).trim(),
        status: enumArg(args.status, 'status', LIST_STATUSES, 'all'),
        admin: enumArg(args.admin, 'admin', LIST_ADMIN_FILTERS, 'all'),
        security: enumArg(args.security, 'security', LIST_SECURITY_FILTERS, 'all'),
        binding: enumArg(args.binding, 'binding', LIST_BINDING_FILTERS, 'all'),
        groupDomain: stringArg(args.groupDomain || 'system', 'groupDomain', 128, false).trim(),
        group: stringArg(args.group, 'group', 128).trim(),
        roleDomain: stringArg(args.roleDomain || 'system', 'roleDomain', 128, false).trim(),
        role: stringArg(args.role, 'role', 128).trim(),
        registeredFrom: dateArg(args.registeredFrom, 'registeredFrom'),
        registeredTo: dateArg(args.registeredTo, 'registeredTo', true),
        loginFrom: dateArg(args.loginFrom, 'loginFrom'),
        loginTo: dateArg(args.loginTo, 'loginTo', true),
        sort: enumArg(args.sort, 'sort', LIST_SORTS, 'uid'),
        order: enumArg(args.order, 'order', LIST_ORDERS, 'asc'),
        selected,
    };
}

async function listAccountRows(handler: Handler, query: ListQuery): Promise<{ rows: AccountListRow[]; bindingAvailable: boolean }> {
    const rawUsers = await user.coll.find({ _id: { $gt: 0 } }, { projection: ACCOUNT_PROJECTION }).toArray();
    const uids = rawUsers.map((row) => row._id);
    const userbind = (global as any).Hydro?.model?.userbind;
    const bindingAvailable = typeof userbind?.findStudentsByUserIds === 'function';
    if (query.binding !== 'all' && !bindingAvailable) throw new Error('userbind.findStudentsByUserIds is required for binding-status filters');

    const [systemUsers, oauthRows, bindingDict] = await Promise.all([
        domain.collUser.find({ domainId: 'system', uid: { $in: uids } }, { projection: { uid: 1, displayName: 1 } }).toArray(),
        handler.ctx.oauth.coll.find({ uid: { $in: uids } }, { projection: { uid: 1, platform: 1 } }).toArray(),
        bindingAvailable ? userbind.findStudentsByUserIds('system', uids) : {},
    ]);
    const displayNames = new Map(systemUsers.map((row) => [row.uid, String(row.displayName || '')]));
    const oauthByUid = new Map<number, string[]>();
    for (const relation of oauthRows) {
        const providers = oauthByUid.get(relation.uid) || [];
        if (!providers.includes(relation.platform)) providers.push(relation.platform);
        oauthByUid.set(relation.uid, providers);
    }

    let groupMembers: Set<number> | null = null;
    if (query.group) {
        const group = await user.collGroup.findOne({ domainId: query.groupDomain, name: query.group }, { projection: { uids: 1 } });
        if (!group) validation('group', localizedErrorText`所选用户组不存在`);
        groupMembers = new Set(group.uids || []);
    }
    let roleMembers: Set<number> | null = null;
    if (query.role) {
        const roleDocs = await domain.collUser
            .find({ domainId: query.roleDomain, role: query.role, join: true }, { projection: { uid: 1 } })
            .toArray();
        roleMembers = new Set(roleDocs.map((row) => row.uid));
    }
    const candidates: AccountListRow[] = rawUsers.map((raw) => {
        const binding = bindingDict[String(raw._id)] || null;
        const oauthProviders = (oauthByUid.get(raw._id) || []).sort();
        return {
            uid: raw._id,
            username: String(raw.uname || ''),
            email: String(raw.mail || ''),
            displayName: displayNames.get(raw._id) || '',
            status: raw.priv === PRIV.PRIV_NONE ? 'disabled' : 'enabled',
            school: String(raw.school || ''),
            studentId: String(raw.studentId || ''),
            priv: Number(raw.priv || 0),
            registeredAt: raw.regat || null,
            lastLoginAt: raw.loginat || null,
            avatarUrl: avatar(raw.avatar || `gravatar:${raw.mail}`, 64),
            isAdmin: isSystemAdmin(Number(raw.priv || 0)),
            hasTfa: !!raw.tfa,
            hasWebAuthn: !!raw.authenticators?.length,
            oauthProviders,
            binding: binding
                ? {
                      studentId: String(binding.studentId || ''),
                      realName: String(binding.realName || ''),
                      enrollmentYear: binding.enrollmentYear ?? null,
                  }
                : null,
            protected: raw._id === SUPERADMIN_UID,
        };
    });
    const rows = filterAndSortAccountRows(candidates, query, {
        selected: query.selected ? new Set(query.selected) : null,
        groupMembers,
        roleMembers,
    });
    return { rows, bindingAvailable };
}

async function getAccountDetail(handler: Handler, uid: number) {
    const raw = await getTarget(uid);
    const [
        systemUser,
        sessions,
        relations,
        authTokens,
        memberships,
        groups,
        bindingDict,
        submissionCount,
        acceptedCount,
        ownedProblems,
        activity,
        audit,
    ] = await Promise.all([
        domain.collUser.findOne({ domainId: 'system', uid }, { projection: { displayName: 1 } }),
        token.getAccountSessionListByUid(uid),
        handler.ctx.oauth.list(uid),
        listAuthTokens({ uid }),
        domain.collUser.find({ uid, join: true }, { projection: { domainId: 1, role: 1, join: 1 } }).toArray(),
        user.collGroup
            .find({ uids: uid }, { projection: { domainId: 1, name: 1 } })
            .sort({ domainId: 1, name: 1 })
            .toArray(),
        (global as any).Hydro?.model?.userbind?.findStudentsByUserIds
            ? (global as any).Hydro.model.userbind.findStudentsByUserIds('system', [uid])
            : null,
        RecordModel.coll.countDocuments({ domainId: 'system', contest: { $exists: false }, uid }),
        RecordModel.coll.countDocuments({ domainId: 'system', contest: { $exists: false }, uid, status: STATUS.STATUS_ACCEPTED }),
        document.coll.countDocuments({ domainId: 'system', docType: document.TYPE_PROBLEM, owner: uid }),
        oplog.coll
            .find({ type: 'user.loginSuccess', uid }, { projection: { time: 1, operateIp: 1, ua: 1 } })
            .sort({ time: -1 })
            .limit(20)
            .toArray(),
        oplog.coll
            .find(
                { type: { $regex: '^admin\\.account\\.' }, $or: [{ targetUid: uid }, { targetUids: uid }] },
                {
                    projection: {
                        type: 1,
                        time: 1,
                        operator: 1,
                        operateIp: 1,
                        result: 1,
                        before: 1,
                        after: 1,
                        impact: 1,
                        error: 1,
                        progress: 1,
                        detail: 1,
                        targetUid: 1,
                        targetUids: 1,
                    },
                },
            )
            .sort({ time: -1 })
            .limit(50)
            .toArray(),
    ]);
    const domainIds = memberships.map((membership) => membership.domainId);
    const domainDocs = domainIds.length
        ? await domain
              .getMulti({ _id: { $in: domainIds } })
              .project({ _id: 1, name: 1 })
              .toArray()
        : [];
    const domainNames = new Map(domainDocs.map((doc) => [doc._id, doc.name]));
    const summary = safeUserSummary(raw, systemUser?.displayName || '');
    return {
        account: {
            ...summary,
            profileVersion: accountProfileVersion(summary),
            registeredAt: raw.regat || null,
            lastLoginAt: raw.loginat || null,
            registrationIps: Array.isArray(raw.ip) ? raw.ip.map(String) : [],
            lastLoginIp: String(raw.loginip || ''),
            disabled: raw.adminDisabled
                ? {
                      at: raw.adminDisabled.at || null,
                      by: raw.adminDisabled.by || null,
                      previousPriv: Number(raw.adminDisabled.previousPriv || 0),
                  }
                : null,
            banReason: String(raw.banReason || ''),
            protected: uid === SUPERADMIN_UID,
            isAdmin: isSystemAdmin(Number(raw.priv || 0)),
            avatarUrl: avatar(raw.avatar || `gravatar:${raw.mail}`, 128),
        },
        security: {
            hasTfa: !!raw.tfa,
            authenticators: (raw.authenticators || []).map((item: any) => ({
                name: String(item.name || ''),
                registeredAt: item.regat || null,
                credentialType: String(item.credentialType || ''),
                deviceType: String(item.credentialDeviceType || ''),
                attachment: String(item.authenticatorAttachment || ''),
            })),
            oauth: relations.map((relation) => ({ platform: relation.platform })),
            sessions: sessions.map((session) => ({
                createdAt: session.createAt || null,
                updatedAt: session.updateAt || null,
                createdIp: String(session.createIp || ''),
                updatedIp: String(session.updateIp || ''),
                userAgent: String(session.updateUa || session.createUa || ''),
            })),
            apiTokens: authTokens.map((item) => ({
                id: String(item._id),
                display: item.display,
                label: item.label || '',
                channels: item.channels || [],
                createdAt: item.createdAt,
                lastUsedAt: item.lastUsedAt,
                expiresAt: item.expiresAt,
                revoked: !!item.revoked,
            })),
        },
        memberships: memberships.map((membership) => ({
            domainId: membership.domainId,
            domainName: domainNames.get(membership.domainId) || membership.domainId,
            role: membership.role || 'default',
        })),
        groups: groups.map((group) => ({ domainId: group.domainId, name: group.name })),
        binding: bindingDict === null ? { available: false, student: null } : { available: true, student: bindingDict[String(uid)] || null },
        related: {
            submissionCount,
            acceptedCount,
            ownedProblems,
            links: {
                submissions: handler.url('record_main', { domainId: 'system', query: { uidOrName: uid } }),
                ownedProblems: handler.url('problem_main', { domainId: 'system', query: { owner: uid } }),
            },
        },
        activity,
        audit: audit.map((entry) => redactAccountSecrets(entry)),
    };
}

async function listAdminMetadata(groupDomain: string, roleDomain: string) {
    const domains = await domain.getMulti({}).project({ _id: 1, name: 1 }).sort({ _id: 1 }).toArray();
    if (!domains.some((doc) => doc._id === 'system')) throw new Error('账号管理依赖的 system 域不存在');
    if (!domains.some((doc) => doc._id === groupDomain)) validation('groupDomain', localizedErrorText`所选用户组域不存在`);
    if (!domains.some((doc) => doc._id === roleDomain)) validation('roleDomain', localizedErrorText`所选角色域不存在`);
    const [groups, roleDomainDoc] = await Promise.all([
        user.collGroup
            .find({ domainId: groupDomain }, { projection: { name: 1, uids: 1 } })
            .sort({ name: 1 })
            .toArray(),
        domain.get(roleDomain),
    ]);
    if (!roleDomainDoc) throw new Error(`账号管理读取角色时域 ${roleDomain} 已不存在`);
    const roles = (await domain.getRoles(roleDomainDoc)).map((role) => role._id);
    return {
        domains: domains.map((doc) => ({ id: doc._id, name: doc.name || doc._id })),
        groups: groups.map((group) => ({ name: group.name, count: group.uids?.length || 0 })),
        roles,
        groupDomain,
        roleDomain,
        privileges: PRIVILEGE_ENTRIES,
        defaultPriv: siteDefaultPrivilege(),
        bulkLimit: ACCOUNT_BULK_LIMIT,
        superadminUid: SUPERADMIN_UID,
        timeZone: String(system.get('preference.timeZone') || 'Asia/Shanghai'),
    };
}

async function updateGroupMembership(
    domainId: string,
    name: string,
    uids: number[],
    action: 'add' | 'remove',
    expectedMembership?: ReadonlyMap<number, boolean>,
) {
    const group = await user.collGroup.findOne({ domainId, name });
    if (!group) validation('group', localizedErrorText`所选用户组不存在`);
    const current = new Set<number>(group.uids || []);
    if (expectedMembership) {
        for (const [uid, expected] of expectedMembership) {
            if (current.has(uid) !== expected) {
                throw new AccountStateConflictError(localizedErrorText`UID ${uid} 的用户组成员关系已改变`);
            }
        }
    }
    const selected = new Set(uids);
    const next =
        action === 'add'
            ? [...new Set([...(group.uids || []), ...uids])].sort((a, b) => a - b)
            : (group.uids || []).filter((uid) => !selected.has(uid));
    await user.updateGroup(domainId, name, next);
    return {
        beforeCount: group.uids?.length || 0,
        afterCount: next.length,
        beforeMembers: uids.filter((uid) => current.has(uid)),
        afterMembers: uids.filter((uid) => next.includes(uid)),
    };
}

async function setDomainRole(domainId: string, role: string, uids: number[]) {
    const ddoc = await domain.get(domainId);
    if (!ddoc) validation('domainId', localizedErrorText`所选域不存在`);
    const roles = await domain.getRoles(ddoc);
    if (!roles.some((item) => item._id === role)) validation('role', localizedErrorText`所选角色不存在`);
    for (const uid of uids) await domain.setUserRole(domainId, uid, role, true);
}

class AdminAccountManagementHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        if (this.session.sudoUid) throw new ForbiddenError(localizedErrorText`请先退出代理身份再管理账号`);
    }
}

class AdminAccountsHandler extends AdminAccountManagementHandler {
    async get(args: any) {
        if (args.uid != null && String(args.uid).trim() !== '') {
            const uid = integerArg(args.uid, 'uid');
            this.response.redirect = legacyAccountDetailPath(args, uid);
            return;
        }
        const query = parseListQuery(args);
        const { rows, bindingAvailable } = await listAccountRows(this, query);
        if (String(args.format || '') === 'csv') {
            if (rows.length > 5000) validation('format', localizedErrorText`单次最多导出 5000 个账号`);
            this.response.type = 'text/csv; charset=utf-8';
            this.response.disposition = 'attachment; filename="krypton-accounts.csv"';
            this.response.body = buildAccountCsv(rows);
            return;
        }
        const requestedPage = args.page ? integerArg(args.page, 'page') : 1;
        const pageSizeRaw = args.pageSize ? integerArg(args.pageSize, 'pageSize') : 50;
        const paginated = paginateAccountRows(rows, requestedPage, pageSizeRaw);
        const metadata = await listAdminMetadata(query.groupDomain, query.roleDomain);
        this.response.template = 'admin_accounts.html';
        this.response.body = {
            accounts: paginated.rows,
            total: rows.length,
            page: paginated.page,
            pageSize: paginated.pageSize,
            pageCount: paginated.pageCount,
            filters: {
                q: query.q,
                status: query.status,
                admin: query.admin,
                security: query.security,
                binding: query.binding,
                groupDomain: metadata.groupDomain,
                group: query.group,
                roleDomain: metadata.roleDomain,
                role: query.role,
                registeredFrom: args.registeredFrom || '',
                registeredTo: args.registeredTo || '',
                loginFrom: args.loginFrom || '',
                loginTo: args.loginTo || '',
                sort: query.sort,
                order: query.order,
            },
            bindingAvailable,
            metadata,
        };
    }

    async postCreate(args: any) {
        const username = stringArg(args.username, 'username', 64, false).trim();
        const email = stringArg(args.email, 'email', 320, false).trim();
        const accountPassword = stringArg(args.__accountPassword, '__accountPassword', 1024, false);
        const displayName = stringArg(args.displayName, 'displayName', 100).trim();
        const school = stringArg(args.school, 'school', 200).trim();
        const studentId = stringArg(args.studentId, 'studentId', 100).trim();
        if (!Types.Username[1](username)) validation('username', localizedErrorText`用户名格式无效`);
        if (!Types.Email[1](email)) validation('email', localizedErrorText`邮箱格式无效`);
        if (!Types.Password[1](accountPassword)) validation('__accountPassword', localizedErrorText`密码格式无效`);
        const defaultPriv = siteDefaultPrivilege();
        const auditContext: AuditContext = { impact: `创建账号 ${username}`, progress: { stage: 'reauthenticate' } };
        const value = await runAccountOperation(this, 'create', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            auditContext.progress = { stage: 'create-core-account' };
            const uid = await user.create(email, username, accountPassword, undefined, this.request.ip);
            auditContext.targetUid = uid;
            auditContext.progress = { stage: 'write-profile', uid };
            await user.setById(uid, { school, studentId });
            if (displayName) await domain.setUserInDomain('system', uid, { displayName });
            auditContext.progress = { stage: 'run-import-hook', uid };
            await this.ctx.serial('user/import/create', uid, { email, username, displayName, school, studentId });
            auditContext.progress = { stage: 'complete', uid };
            return {
                value: { ok: true, uid },
                after: { uid, username, email, displayName, school, studentId, priv: defaultPriv },
                targetUid: uid,
            };
        });
        this.response.body = value;
    }

    async postImportPreview(args: any) {
        const parsed = validateImportRows(parseAccountImportForCommit(stringArg(args.__users, '__users', 2_000_000, false)));
        const rows = parsed.map(({ password: _password, ...row }) => redactAccountSecrets(row));
        const valid = rows.filter((row) => row.status === 'ok');
        const existing = valid.length
            ? await user.coll
                  .find(
                      {
                          $or: [
                              { mailLower: { $in: valid.map((row) => handleMailLower(row.email)) } },
                              { unameLower: { $in: valid.map((row) => row.username.toLowerCase()) } },
                          ],
                      },
                      { projection: { mailLower: 1, unameLower: 1 } },
                  )
                  .toArray()
            : [];
        const existingMails = new Set(existing.map((row) => row.mailLower));
        const existingNames = new Set(existing.map((row) => row.unameLower));
        const preview = rows.map((row) =>
            row.status === 'ok' && (existingMails.has(handleMailLower(row.email)) || existingNames.has(row.username.toLowerCase()))
                ? { ...row, status: 'duplicate', message: '邮箱或用户名已存在' }
                : row,
        );
        this.response.body = {
            rows: preview,
            summary: {
                total: preview.length,
                ready: preview.filter((row) => row.status === 'ok').length,
                invalid: preview.filter((row) => row.status !== 'ok').length,
            },
        };
    }

    async postImportCommit(args: any) {
        const input = stringArg(args.__users, '__users', 2_000_000, false);
        const rows = validateImportRows(parseAccountImportForCommit(input));
        if (!rows.length) validation('__users', localizedErrorText`导入内容为空`);
        const invalid = rows.filter((row) => row.status !== 'ok');
        if (invalid.length) validation('__users', localizedErrorText`有 ${invalid.length} 行未通过校验，请重新预览`);
        siteDefaultPrivilege();
        const auditContext: AuditContext = {
            before: { accountCount: rows.length },
            impact: `批量创建 ${rows.length} 个账号`,
            progress: { stage: 'preflight', createdUids: [] },
        };
        const value = await runAccountOperation(this, 'import', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            const existing = await user.coll
                .find(
                    {
                        $or: [
                            { mailLower: { $in: rows.map((row) => handleMailLower(row.email)) } },
                            { unameLower: { $in: rows.map((row) => row.username.toLowerCase()) } },
                        ],
                    },
                    { projection: { _id: 1 } },
                )
                .toArray();
            if (existing.length) throw new AccountStateConflictError(localizedErrorText`导入期间邮箱或用户名已存在`);
            const prepared: Array<{
                row: (typeof rows)[number];
                payload: Record<string, any>;
                school: string;
                studentId: string;
                group?: string;
            }> = [];
            for (const row of rows) {
                auditContext.progress = { stage: `preflight-line-${row.line}`, createdUids: [] };
                const payload = { ...row.extra, email: row.email, username: row.username, displayName: row.displayName } as Record<string, any>;
                await this.ctx.serial('user/import/parse', payload);
                const school = stringArg(payload.school, 'school', 200).trim();
                const studentId = stringArg(payload.studentId, 'studentId', 100).trim();
                const group = typeof payload.group === 'string' ? payload.group.trim() : undefined;
                prepared.push({ row, payload, school, studentId, group });
            }
            const created: Array<{ uid: number; email: string; group?: string }> = [];
            for (const { row, payload, school, studentId, group } of prepared) {
                auditContext.progress = { stage: `create-line-${row.line}`, createdUids: created.map((item) => item.uid) };
                const uid = await user.create(row.email, row.username, row.password, undefined, this.request.ip);
                created.push({ uid, email: row.email, group });
                auditContext.targetUids = created.map((item) => item.uid);
                auditContext.progress = { stage: `profile-line-${row.line}`, createdUids: created.map((item) => item.uid) };
                await user.setById(uid, { school, studentId });
                if (row.displayName) await domain.setUserInDomain('system', uid, { displayName: row.displayName });
                await this.ctx.serial('user/import/create', uid, redactAccountSecrets(payload));
            }
            auditContext.progress = { stage: 'groups', createdUids: created.map((item) => item.uid) };
            const existingGroups = await user.listGroup('system');
            for (const name of [...new Set(created.map((item) => item.group).filter((item): item is string => !!item))]) {
                const current = existingGroups.find((group) => group.name === name)?.uids || [];
                const additions = created.filter((item) => item.group === name).map((item) => item.uid);
                await user.updateGroup(
                    'system',
                    name,
                    [...new Set([...current, ...additions])].sort((a, b) => a - b),
                );
            }
            auditContext.progress = { stage: 'complete', createdUids: created.map((item) => item.uid) };
            return {
                value: { ok: true, created: created.map((item) => item.uid) },
                after: { createdUids: created.map((item) => item.uid), count: created.length },
                targetUids: created.map((item) => item.uid),
            };
        });
        this.response.body = value;
    }

    async postUpdateProfile(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const target = await getTarget(uid);
        const systemUser = await domain.collUser.findOne({ domainId: 'system', uid }, { projection: { displayName: 1 } });
        const before = safeUserSummary(target, systemUser?.displayName || '');
        const username = stringArg(args.username, 'username', 64, false).trim();
        const email = stringArg(args.email, 'email', 320, false).trim();
        const patch = {
            avatar: stringArg(args.avatar, 'avatar', 500).trim(),
            qq: stringArg(args.qq, 'qq', 100).trim(),
            gender: integerArg(args.gender ?? 0, 'gender', false),
            bio: stringArg(args.bio, 'bio', 10_000),
            school: stringArg(args.school, 'school', 200).trim(),
            studentId: stringArg(args.studentId, 'studentId', 100).trim(),
        };
        const displayName = stringArg(args.displayName, 'displayName', 100).trim();
        if (![0, 1, 2].includes(patch.gender)) validation('gender', localizedErrorText`性别值无效`);
        if (!Types.Username[1](username)) validation('username', localizedErrorText`用户名格式无效`);
        if (!Types.Email[1](email)) validation('email', localizedErrorText`邮箱格式无效`);
        const identityChanged = target.uname !== username || target.mail !== email;
        const value = await runAccountOperation(
            this,
            'profile',
            { targetUid: uid, before, impact: identityChanged ? '修改登录标识与资料' : '修改账号资料' },
            async () => {
                if (identityChanged) await requireAdminPassword(this, args.password);
                const current = await getTarget(uid);
                assertTarget(this.user._id, current, 'profile');
                const currentSystemUser = await domain.collUser.findOne({ domainId: 'system', uid }, { projection: { displayName: 1 } });
                assertExpectedProfileVersion(args.expectedProfileVersion, safeUserSummary(current, currentSystemUser?.displayName || ''));
                const duplicate = await user.coll.findOne(
                    {
                        _id: { $ne: uid },
                        $or: [{ unameLower: username.toLowerCase() }, { mailLower: handleMailLower(email) }],
                    },
                    { projection: { _id: 1 } },
                );
                if (duplicate) throw new AccountStateConflictError(localizedErrorText`用户名或邮箱已被其他账号占用`);
                await user.setById(uid, {
                    ...patch,
                    uname: username,
                    unameLower: username.toLowerCase(),
                    mail: email,
                    mailLower: handleMailLower(email),
                });
                await domain.setUserInDomain('system', uid, { displayName });
                const after = { ...before, ...patch, username, email, displayName };
                return { value: { ok: true }, after };
            },
        );
        this.response.body = value;
    }

    async postPassword(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const next = stringArg(args.__newPassword, '__newPassword', 1024, false);
        const verify = stringArg(args.__verifyPassword, '__verifyPassword', 1024, false);
        if (next !== verify) validation('__verifyPassword', localizedErrorText`两次输入的新密码不一致`);
        if (!Types.Password[1](next)) validation('__newPassword', localizedErrorText`新密码格式无效`);
        const auditContext: AuditContext = {
            targetUid: uid,
            before: { password: 'unchanged', sessions: 'active' },
            impact: '替换密码并撤销全部 session、恢复 token 与 API/工具 token',
            progress: { stage: 'reauthenticate' },
        };
        const value = await runAccountOperation(this, 'password', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            const current = await getTarget(uid);
            assertTarget(this.user._id, current, 'password');
            auditContext.progress = { stage: 'revoke-access' };
            const revoked = await revokeAccountAccess(uid, true, true);
            auditContext.progress = { stage: 'replace-password', accessRevoked: true };
            await user.setPassword(uid, next);
            auditContext.progress = { stage: 'complete', accessRevoked: true, passwordReplaced: true };
            return { value: { ok: true, revoked }, after: { password: 'replaced', sessions: 'revoked', ...revoked } };
        });
        this.response.body = value;
    }

    async postDisable(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const target = await getTarget(uid);
        const auditContext: AuditContext = {
            targetUid: uid,
            before: { priv: target.priv, status: target.priv === 0 ? 'disabled' : 'enabled' },
            impact: '可逆禁用账号并撤销全部访问 token；不删除业务数据',
            progress: { stage: 'reauthenticate' },
        };
        const value = await runAccountOperation(this, 'disable', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            const current = await getTarget(uid);
            assertTarget(this.user._id, current, 'disable');
            assertExpectedPrivilege(args.expectedPriv, Number(current.priv));
            if (current.priv === PRIV.PRIV_NONE) throw new AccountStateConflictError(localizedErrorText`账号已被禁用`);
            auditContext.progress = { stage: 'revoke-access' };
            const revoked = await revokeAccountAccess(uid, true, true);
            auditContext.progress = { stage: 'disable-account', accessRevoked: true };
            await user.setById(uid, {
                priv: PRIV.PRIV_NONE,
                banReason: 'Disabled by system administrator',
                adminDisabled: { previousPriv: current.priv, at: new Date(), by: this.user._id },
            });
            auditContext.progress = { stage: 'complete', accessRevoked: true, accountDisabled: true };
            return { value: { ok: true, revoked }, after: { priv: 0, status: 'disabled', ...revoked } };
        });
        this.response.body = value;
    }

    async postRestore(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const target = await getTarget(uid);
        const value = await runAccountOperation(
            this,
            'restore',
            {
                targetUid: uid,
                before: { priv: target.priv, status: target.priv === 0 ? 'disabled' : 'enabled' },
                impact: '恢复账号为非系统管理员权限',
            },
            async () => {
                await requireAdminPassword(this, args.password);
                const current = await getTarget(uid);
                assertTarget(this.user._id, current, 'restore');
                assertExpectedPrivilege(args.expectedPriv, Number(current.priv));
                if (current.priv !== PRIV.PRIV_NONE) throw new AccountStateConflictError(localizedErrorText`账号当前未被禁用`);
                const restoredPriv = resolveRestoredPrivilege(current.adminDisabled?.previousPriv, siteDefaultPrivilege());
                await user.setById(uid, { priv: restoredPriv }, { adminDisabled: '', banReason: '' });
                return { value: { ok: true, priv: restoredPriv }, after: { priv: restoredPriv, status: 'enabled' } };
            },
        );
        this.response.body = value;
    }

    async postPrivilege(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const nextPriv = integerArg(args.priv, 'priv', false);
        if (nextPriv < 0 || (nextPriv & ~KNOWN_PRIV_MASK) !== 0) {
            validation('priv', localizedErrorText`权限值包含不允许的位或超级管理员值`);
        }
        if (nextPriv === PRIV.PRIV_NONE) {
            validation('priv', localizedErrorText`禁用账号必须使用可逆禁用操作，不能把权限值直接设为 0`);
        }
        if (isSystemAdmin(nextPriv) && (nextPriv & PRIV.PRIV_USER_PROFILE) !== PRIV.PRIV_USER_PROFILE) {
            validation('priv', localizedErrorText`系统管理员必须保留用户登录权限`);
        }
        const target = await getTarget(uid);
        const auditContext: AuditContext = {
            targetUid: uid,
            before: { priv: target.priv, isAdmin: isSystemAdmin(target.priv) },
            impact: '修改全站 privilege 位',
            progress: { stage: 'reauthenticate' },
        };
        const value = await runAccountOperation(this, 'privilege', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            const current = await getTarget(uid);
            assertTarget(this.user._id, current, 'privilege');
            assertExpectedPrivilege(args.expectedPriv, Number(current.priv));
            if (current.priv === PRIV.PRIV_NONE) throw new AccountStateConflictError(localizedErrorText`请先恢复被禁用账号再修改权限`);
            if (uid === this.user._id && !isSystemAdmin(nextPriv)) {
                throw new BadRequestError(localizedErrorText`不能移除当前管理员自己的系统管理权限`);
            }
            if (isSystemAdmin(current.priv) && !isSystemAdmin(nextPriv)) {
                const admins = await user.coll.find({}, { projection: { _id: 1, priv: 1 } }).toArray();
                if (admins.filter((item) => isUsableSystemAdmin(Number(item.priv))).length <= 1) {
                    throw new AccountStateConflictError(localizedErrorText`不能移除最后一个可用系统管理员`);
                }
            }
            const adminChanged = isSystemAdmin(current.priv) !== isSystemAdmin(nextPriv);
            auditContext.progress = { stage: adminChanged ? 'revoke-access' : 'write-privilege' };
            const revoked = adminChanged ? await revokeAccountAccess(uid, true, true) : { coreTokens: 0, apiTokens: 0 };
            auditContext.progress = { stage: 'write-privilege', accessRevoked: adminChanged };
            await user.setPriv(uid, nextPriv);
            auditContext.progress = { stage: 'complete', accessRevoked: adminChanged, privilegeWritten: true };
            return {
                value: { ok: true, revoked },
                after: { priv: nextPriv, isAdmin: isSystemAdmin(nextPriv), ...(adminChanged ? revoked : {}) },
            };
        });
        this.response.body = value;
    }

    async postSecurity(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const action = enumArg(args.action, 'action', SECURITY_ACTIONS, '');
        const target = await getTarget(uid);
        const value = await runAccountOperation(
            this,
            `security.${action}`,
            {
                targetUid: uid,
                before: { hasTfa: !!target.tfa, authenticatorCount: target.authenticators?.length || 0 },
                impact: action,
            },
            async () => {
                await requireAdminPassword(this, args.password);
                const current = await getTarget(uid);
                assertTarget(this.user._id, current, action.startsWith('revoke_') ? 'session' : 'security');
                let detail: Record<string, unknown> = {};
                if (action === 'clear_tfa') {
                    if (!current.tfa) throw new AccountStateConflictError(localizedErrorText`该账号未启用 TOTP`);
                    await user.setById(uid, undefined, { tfa: '' });
                } else if (action === 'clear_webauthn') {
                    if (!current.authenticators?.length) throw new AccountStateConflictError(localizedErrorText`该账号没有 WebAuthn/passkey`);
                    await user.setById(uid, { authenticators: [] });
                } else if (action === 'unlink_oauth') {
                    const platform = stringArg(args.platform, 'platform', 100, false).trim();
                    const relations = await this.ctx.oauth.list(uid);
                    if (!relations.some((relation) => relation.platform === platform)) {
                        throw new AccountStateConflictError(localizedErrorText`该 OAuth 关联不存在`);
                    }
                    await this.ctx.oauth.unbind(platform, uid);
                    detail = { platform };
                } else if (action === 'revoke_sessions') detail = await revokeAccountAccess(uid, true, false);
                else if (action === 'revoke_api_tokens') detail = await revokeAccountAccess(uid, false, true);
                else detail = await revokeAccountAccess(uid, true, true);
                return { value: { ok: true, ...detail }, after: { action, ...detail } };
            },
        );
        this.response.body = value;
    }

    async postGroup(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const domainId = stringArg(args.targetDomainId, 'targetDomainId', 128, false).trim();
        const group = stringArg(args.group, 'group', 128, false).trim();
        const action = enumArg(args.action, 'action', new Set(['add', 'remove']), '');
        const expectedMember = booleanArg(args.expectedMember, 'expectedMember');
        const groupDoc = await user.collGroup.findOne({ domainId, name: group }, { projection: { uids: 1 } });
        if (!groupDoc) validation('group', localizedErrorText`所选用户组不存在`);
        const before = { domainId, group, member: (groupDoc.uids || []).includes(uid) };
        const value = await runAccountOperation(
            this,
            `group.${action}`,
            { targetUid: uid, before, impact: `${action} ${domainId}/${group}` },
            async () => {
                await requireAdminPassword(this, args.password);
                assertTarget(this.user._id, await getTarget(uid), 'group');
                const counts = await updateGroupMembership(domainId, group, [uid], action as 'add' | 'remove', new Map([[uid, expectedMember]]));
                return { value: { ok: true, ...counts }, after: { domainId, group, action, ...counts } };
            },
        );
        this.response.body = value;
    }

    async postRole(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const domainId = stringArg(args.targetDomainId, 'targetDomainId', 128, false).trim();
        const role = stringArg(args.role, 'role', 128, false).trim();
        const expectedRole = stringArg(args.expectedRole, 'expectedRole', 128);
        const expectedJoin = booleanArg(args.expectedJoin, 'expectedJoin');
        const before = await domain.collUser.findOne({ domainId, uid }, { projection: { role: 1, join: 1 } });
        const value = await runAccountOperation(this, 'role', { targetUid: uid, before, impact: `设置 ${domainId} 域角色为 ${role}` }, async () => {
            await requireAdminPassword(this, args.password);
            assertTarget(this.user._id, await getTarget(uid), 'role');
            const current = await domain.collUser.findOne({ domainId, uid }, { projection: { role: 1, join: 1 } });
            if (String(current?.role || '') !== expectedRole || !!current?.join !== expectedJoin) {
                throw new AccountStateConflictError(localizedErrorText`域成员或角色已被其他操作修改`);
            }
            await setDomainRole(domainId, role, [uid]);
            return { value: { ok: true }, after: { domainId, role, join: true } };
        });
        this.response.body = value;
    }

    async postBulk(args: any) {
        let uids: number[];
        try {
            uids = normalizeTargetUids(String(args.uids || ''));
        } catch (error) {
            convertTargetPolicyError(error);
        }
        const action = enumArg(args.action, 'action', BULK_ACTIONS, '');
        const targets = await getTargets(uids);
        const policyOperation: AccountTargetOperation =
            action === 'disable'
                ? 'disable'
                : action === 'restore'
                  ? 'restore'
                  : action === 'force_logout'
                    ? 'session'
                    : action.startsWith('group_')
                      ? 'group'
                      : 'role';
        const auditContext: AuditContext = {
            targetUids: uids,
            before: {
                count: uids.length,
                targets: targets.map((target) => ({
                    uid: target._id,
                    priv: Number(target.priv),
                    status: target.priv === PRIV.PRIV_NONE ? 'disabled' : 'enabled',
                })),
            },
            impact: action,
            progress: { stage: 'preflight', processedUids: [] },
        };
        const value = await runAccountOperation(this, `bulk.${action}`, auditContext, async () => {
            for (const target of targets) assertTarget(this.user._id, target, policyOperation);
            if (action === 'force_logout' && uids.includes(this.user._id)) {
                throw new BadRequestError(localizedErrorText`批量强制退出不能包含当前管理员`);
            }
            if (action === 'restore' && targets.some((target) => target.priv !== PRIV.PRIV_NONE)) {
                throw new AccountStateConflictError(localizedErrorText`恢复目标中包含未禁用账号`);
            }
            if (action === 'disable' && targets.some((target) => target.priv === PRIV.PRIV_NONE)) {
                throw new AccountStateConflictError(localizedErrorText`禁用目标中包含已禁用账号`);
            }
            await requireAdminPassword(this, args.password);
            const currentTargets = await getTargets(uids);
            for (const target of currentTargets) assertTarget(this.user._id, target, policyOperation);
            const initialPrivByUid = new Map(targets.map((target) => [target._id, Number(target.priv)]));
            if (currentTargets.some((target) => initialPrivByUid.get(target._id) !== Number(target.priv))) {
                throw new AccountStateConflictError(localizedErrorText`批量目标的权限或禁用状态在确认期间发生变化`);
            }
            if (action === 'restore' && currentTargets.some((target) => target.priv !== PRIV.PRIV_NONE)) {
                throw new AccountStateConflictError(localizedErrorText`恢复目标状态在确认期间发生变化`);
            }
            if (action === 'disable' && currentTargets.some((target) => target.priv === PRIV.PRIV_NONE)) {
                throw new AccountStateConflictError(localizedErrorText`禁用目标状态在确认期间发生变化`);
            }
            let detail: Record<string, unknown> = { count: uids.length };
            if (action === 'disable') {
                const revoked = [];
                for (const target of currentTargets) {
                    auditContext.progress = {
                        stage: 'revoke-before-disable',
                        currentUid: target._id,
                        processedUids: revoked.map((item) => item.uid),
                    };
                    revoked.push({ uid: target._id, ...(await revokeAccountAccess(target._id, true, true)) });
                }
                const processedUids: number[] = [];
                for (const target of currentTargets) {
                    auditContext.progress = { stage: 'disable', currentUid: target._id, processedUids };
                    await user.setById(target._id, {
                        priv: PRIV.PRIV_NONE,
                        banReason: 'Disabled by system administrator',
                        adminDisabled: { previousPriv: target.priv, at: new Date(), by: this.user._id },
                    });
                    processedUids.push(target._id);
                }
                detail = { ...detail, revoked };
            } else if (action === 'restore') {
                const processedUids: number[] = [];
                for (const target of currentTargets) {
                    auditContext.progress = { stage: 'restore', currentUid: target._id, processedUids };
                    const restored = resolveRestoredPrivilege(target.adminDisabled?.previousPriv, siteDefaultPrivilege());
                    await user.setById(target._id, { priv: restored }, { adminDisabled: '', banReason: '' });
                    processedUids.push(target._id);
                }
            } else if (action === 'force_logout') {
                const revoked = [];
                for (const uid of uids) {
                    auditContext.progress = { stage: 'force-logout', currentUid: uid, processedUids: revoked.map((item) => item.uid) };
                    revoked.push({ uid, ...(await revokeAccountAccess(uid, true, true)) });
                }
                detail = { ...detail, revoked };
            } else if (action === 'group_add' || action === 'group_remove') {
                const domainId = stringArg(args.targetDomainId, 'targetDomainId', 128, false).trim();
                const group = stringArg(args.group, 'group', 128, false).trim();
                const counts = await updateGroupMembership(domainId, group, uids, action === 'group_add' ? 'add' : 'remove');
                detail = { ...detail, domainId, group, ...counts };
            } else {
                const domainId = stringArg(args.targetDomainId, 'targetDomainId', 128, false).trim();
                const role = stringArg(args.role, 'role', 128, false).trim();
                auditContext.progress = { stage: 'set-role', processedUids: [] };
                await setDomainRole(domainId, role, uids);
                detail = { ...detail, domainId, role };
            }
            auditContext.progress = { stage: 'complete', processedUids: uids };
            return { value: { ok: true, ...detail }, after: { action, ...detail }, targetUids: uids };
        });
        this.response.body = value;
    }

    async postImpersonate(args: any) {
        const uid = integerArg(args.uid, 'uid');
        const auditContext: AuditContext = {
            targetUid: uid,
            before: { actorUid: this.user._id, actorName: this.user.uname },
            impact: `以 UID ${uid} 身份浏览站点`,
            progress: { stage: 'reauthenticate' },
        };
        const value = await runAccountOperation(this, 'impersonate', auditContext, async () => {
            await requireAdminPassword(this, args.password);
            const current = await getTarget(uid);
            assertTarget(this.user._id, current, 'impersonate');
            if (current.priv === PRIV.PRIV_NONE) throw new AccountStateConflictError(localizedErrorText`不能切换到已禁用账号`);
            auditContext.progress = { stage: 'write-session' };
            this.session.sudoUid = this.user._id;
            this.session.sudoUname = this.user.uname;
            this.session.sudoStartedAt = new Date().toISOString();
            this.session.uid = uid;
            this.session.scope = PERM.PERM_ALL.toString();
            this.session.sudo = null;
            this.session.sudoArgs = null;
            auditContext.progress = { stage: 'complete' };
            return { value: { ok: true, redirect: '/' }, after: { actorUid: this.user._id, targetUid: uid } };
        });
        this.response.body = value;
    }
}

class AdminAccountDetailHandler extends AdminAccountManagementHandler {
    @param('uid', Types.Int)
    async get(args: any, uid: number) {
        const groupDomain = stringArg(args.groupDomain || 'system', 'groupDomain', 128, false).trim();
        const roleDomain = stringArg(args.roleDomain || 'system', 'roleDomain', 128, false).trim();
        const [metadata, detail] = await Promise.all([listAdminMetadata(groupDomain, roleDomain), getAccountDetail(this, uid)]);
        this.response.template = 'admin_account_detail.html';
        this.response.body = {
            detail,
            metadata,
            returnTo: normalizeAccountListReturnTo(args.returnTo),
        };
    }
}

class AdminAccountsReturnHandler extends Handler {
    noCheckPermView = true;

    async post() {
        const actorUid = Number(this.session.sudoUid);
        if (!Number.isSafeInteger(actorUid) || actorUid <= 0) throw new ForbiddenError(localizedErrorText`当前会话不在代理身份中`);
        const actor = await user.coll.findOne({ _id: actorUid }, { projection: ACCOUNT_PROJECTION });
        if (!actor) throw new UserNotFoundError(actorUid);
        const targetUid = this.user._id;
        await runAccountOperation(
            this,
            'impersonate.return',
            {
                targetUid,
                before: { actorUid, targetUid },
                impact: '返回原账号',
            },
            async () => {
                this.session.uid = actorUid;
                this.session.scope = PERM.PERM_ALL.toString();
                this.session.sudoUid = null;
                this.session.sudoUname = null;
                this.session.sudoStartedAt = null;
                this.session.sudo = null;
                this.session.sudoArgs = null;
                return { value: undefined, after: { uid: actorUid } };
            },
            actorUid,
        );
        this.response.redirect = '/';
    }
}

export const inject = ['oauth'];

export async function apply(ctx: Context) {
    ctx.Route('admin_accounts', '/admin/accounts', AdminAccountsHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_accounts_return', '/admin/accounts/return', AdminAccountsReturnHandler);
    ctx.Route('admin_account_detail', '/admin/accounts/:uid', AdminAccountDetailHandler, PRIV.PRIV_EDIT_SYSTEM);
}
