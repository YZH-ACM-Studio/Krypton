import { DomainRolePermissionConflictError, RoleAlreadyExistError, ValidationError } from '../error';
import { BUILTIN_ROLES, PERMS } from '../model/builtin';

export const PROTECTED_DOMAIN_ROLES = ['root', 'guest', 'default', 'teacher'] as const;
const PROTECTED_ROLE_SET = new Set<string>(PROTECTED_DOMAIN_ROLES);
const ROLE_NAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

export const DOMAIN_PERMISSION_DEFINITIONS = PERMS.map((permission) => ({
    family: permission.family,
    key: permission.key,
    desc: permission.desc,
}));
const PERMISSION_BY_KEY = new Map(DOMAIN_PERMISSION_DEFINITIONS.map((permission) => [permission.key.toString(), permission]));
export const KNOWN_DOMAIN_PERMISSION_MASK = DOMAIN_PERMISSION_DEFINITIONS.reduce((mask, permission) => mask | permission.key, 0n);

export function resolveCurrentDomainId(requestedDomainId: unknown, authoritativeDomainId: unknown): string {
    const requested = typeof requestedDomainId === 'string' ? requestedDomainId : '';
    const authoritative = typeof authoritativeDomainId === 'string' ? authoritativeDomainId : '';
    if (!requested || !authoritative || requested !== authoritative) {
        throw new ValidationError('domainId', requestedDomainId, 'The requested domain does not match the current domain.');
    }
    return authoritative;
}

interface DomainRoleRecord {
    _id: string;
    perm: bigint | string;
}

export interface DomainRolePermissionRepository {
    getRoles(domainId: string): Promise<DomainRoleRecord[]>;
    countUser(domainId: string, role: string): Promise<number>;
    compareAndSetRolePermission(
        domainId: string,
        role: string,
        expected: bigint,
        next: bigint,
    ): Promise<{ state: 'updated' } | { state: 'missing' | 'conflict'; current?: bigint }>;
    addRoleFromDefault(
        domainId: string,
        role: string,
        expectedDefault: bigint,
    ): Promise<{ state: 'created' } | { state: 'exists' | 'conflict' }>;
    deleteRoleWithFallback(
        domainId: string,
        role: string,
    ): Promise<{ state: 'deleted'; affectedUsers: number } | { state: 'missing' | 'conflict' }>;
}

export interface DomainPermissionWorkspaceRole {
    id: string;
    perm: string;
    memberCount: number;
    type: 'root' | 'builtin' | 'custom';
    editable: boolean;
    deletable: boolean;
}

function rolePermission(role: DomainRoleRecord): bigint {
    if (role._id === 'root') return BUILTIN_ROLES.root;
    try {
        return BigInt(role.perm);
    } catch {
        throw new TypeError(`Invalid permission mask for role ${role._id}`);
    }
}

function validateRoleName(role: string) {
    if (!ROLE_NAME_PATTERN.test(role)) {
        throw new ValidationError('role', role, 'Role name can only contains numbers, letters and underscores.');
    }
}

function parseNonNegativeMask(raw: unknown, field: string): bigint {
    const value = typeof raw === 'bigint' ? raw.toString() : typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d+$/.test(value)) throw new ValidationError(field, raw);
    const mask = BigInt(value);
    if (mask < 0n) throw new ValidationError(field, raw);
    return mask;
}

function normalizePermissionValues(raw: unknown): unknown[] {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' || typeof raw === 'bigint') return [raw];
    if (typeof raw === 'object') {
        const entries = Object.entries(raw);
        if (!entries.length || entries.some(([key]) => !/^(0|[1-9]\d*)$/.test(key))) {
            throw new ValidationError('permissions', raw);
        }
        entries.sort(([left], [right]) => Number(left) - Number(right));
        if (entries.some(([key], index) => Number(key) !== index)) {
            throw new ValidationError('permissions', raw);
        }
        return entries.map(([, value]) => value);
    }
    throw new ValidationError('permissions', raw);
}

export function parseDomainPermissionSelection(raw: unknown): { mask: bigint; keys: string[] } {
    const seen = new Set<string>();
    let mask = 0n;
    for (const entry of normalizePermissionValues(raw)) {
        const bit = parseNonNegativeMask(entry, 'permissions');
        const key = bit.toString();
        if (bit === 0n || (bit & (bit - 1n)) !== 0n || !PERMISSION_BY_KEY.has(key)) {
            throw new ValidationError('permissions', entry, 'Unknown domain permission bit.');
        }
        if (seen.has(key)) throw new ValidationError('permissions', entry, 'Duplicate domain permission bit.');
        seen.add(key);
        mask |= bit;
    }
    return { mask, keys: [...seen] };
}

export function buildDomainRolePermissionUpdate(input: {
    expectedMask: unknown;
    submittedMask: unknown;
    permissions: unknown;
}) {
    const expected = parseNonNegativeMask(input.expectedMask, 'expectedMask');
    const submitted = parseNonNegativeMask(input.submittedMask, 'mask');
    const selection = parseDomainPermissionSelection(input.permissions);
    const next = (expected & ~KNOWN_DOMAIN_PERMISSION_MASK) | selection.mask;
    if (submitted !== next) throw new ValidationError('mask', input.submittedMask, 'Permission mask does not match selected permission bits.');
    const added = DOMAIN_PERMISSION_DEFINITIONS.filter((permission) => !(expected & permission.key) && next & permission.key).map(
        (permission) => permission.desc,
    );
    const removed = DOMAIN_PERMISSION_DEFINITIONS.filter((permission) => expected & permission.key && !(next & permission.key)).map(
        (permission) => permission.desc,
    );
    return { expected, next, selectedKeys: selection.keys, added, removed };
}

export async function loadDomainPermissionWorkspace(
    repository: Pick<DomainRolePermissionRepository, 'getRoles' | 'countUser'>,
    domainId: string,
): Promise<DomainPermissionWorkspaceRole[]> {
    const roles = await repository.getRoles(domainId);
    const withCounts = await Promise.all(
        roles.map(async (role) => {
            const protectedRole = PROTECTED_ROLE_SET.has(role._id);
            return {
                id: role._id,
                perm: rolePermission(role).toString(),
                memberCount: await repository.countUser(domainId, role._id),
                type: role._id === 'root' ? ('root' as const) : protectedRole ? ('builtin' as const) : ('custom' as const),
                editable: role._id !== 'root',
                deletable: !protectedRole,
            };
        }),
    );
    const builtinOrder = new Map([
        ['root', 0],
        ['default', 1],
        ['teacher', 2],
        ['guest', 3],
    ]);
    return withCounts.sort((left, right) => {
        const leftOrder = builtinOrder.get(left.id) ?? 10;
        const rightOrder = builtinOrder.get(right.id) ?? 10;
        return leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
}

export async function updateDomainRolePermissions(
    repository: DomainRolePermissionRepository,
    input: {
        domainId: string;
        role: string;
        expectedMask: unknown;
        submittedMask: unknown;
        permissions: unknown;
    },
) {
    validateRoleName(input.role);
    if (input.role === 'root') throw new ValidationError('role', input.role, 'The root role is read-only.');
    const change = buildDomainRolePermissionUpdate(input);
    const roles = await repository.getRoles(input.domainId);
    const currentRole = roles.find((role) => role._id === input.role);
    if (!currentRole) throw new ValidationError('role', input.role, 'Unknown domain role.');
    if (rolePermission(currentRole) !== change.expected) throw new DomainRolePermissionConflictError(input.role);
    const affectedUsers = await repository.countUser(input.domainId, input.role);
    const result = await repository.compareAndSetRolePermission(input.domainId, input.role, change.expected, change.next);
    if (result.state !== 'updated') throw new DomainRolePermissionConflictError(input.role);
    return {
        role: input.role,
        mask: change.next.toString(),
        permissionCount: change.selectedKeys.length,
        affectedUsers,
        added: change.added,
        removed: change.removed,
    };
}

export async function createDomainRole(repository: DomainRolePermissionRepository, domainId: string, role: string) {
    validateRoleName(role);
    const roles = await repository.getRoles(domainId);
    if (roles.some((candidate) => candidate._id === role) || PROTECTED_ROLE_SET.has(role)) throw new RoleAlreadyExistError(role);
    const defaultRole = roles.find((candidate) => candidate._id === 'default');
    if (!defaultRole) throw new TypeError('Default domain role is unavailable');
    const defaultMask = rolePermission(defaultRole);
    if (defaultMask < 0n) throw new TypeError('Default domain role has an invalid permission mask');
    const result = await repository.addRoleFromDefault(domainId, role, defaultMask);
    if (result.state === 'exists') throw new RoleAlreadyExistError(role);
    if (result.state !== 'created') throw new DomainRolePermissionConflictError('default');
    return {
        id: role,
        perm: defaultMask.toString(),
        memberCount: 0,
        type: 'custom' as const,
        editable: true,
        deletable: true,
    };
}

export async function deleteDomainRole(repository: DomainRolePermissionRepository, domainId: string, role: string) {
    validateRoleName(role);
    if (PROTECTED_ROLE_SET.has(role)) {
        throw new ValidationError('role', role, 'The root, guest, default and teacher roles cannot be deleted.');
    }
    const roles = await repository.getRoles(domainId);
    if (!roles.some((candidate) => candidate._id === role)) throw new ValidationError('role', role, 'Unknown domain role.');
    const result = await repository.deleteRoleWithFallback(domainId, role);
    if (result.state !== 'deleted') throw new DomainRolePermissionConflictError(role);
    return { role, affectedUsers: result.affectedUsers, fallbackRole: 'default' as const };
}
