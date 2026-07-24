import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { PermissionError, ValidationError } from '../error';
import type { User } from '../interface';
import db from '../service/db';
import { PERM, PRIV } from './builtin';
import * as document from './document';
import * as oplog from './oplog';
import {
    formatManagedProblemPid,
    managedPidCounterNamespace,
    normalizeManagedSourceMeta,
    type ManagedSourceMeta,
    type ManagedSourceTemplate,
} from './managed-problem-source';
import type { ProblemWriteCapability, ProblemWriteClaim } from './problem-access';

declare module './problem' {
    interface ProblemDoc {
        /** Canonical domain-scoped PID namespace. Missing only on unmigrated legacy problems. */
        pidNamespaceId?: string;
        /** Narrow manager review note; never contains statement or evaluation data. */
        pidNamespaceReview?: {
            note: string;
            returnedBy: number;
            returnedAt: Date;
        };
    }
}

export const BUILTIN_PID_NAMESPACE_IDS = {
    patBasic: 'builtin:pat-basic',
    patAdvanced: 'builtin:pat-advanced',
    self: 'builtin:self',
    nowcoder: 'builtin:nowcoder',
    hdu: 'builtin:hdu',
    gplt: 'builtin:gplt',
    cauc: 'builtin:cauc',
} as const;

export const DEFAULT_PID_NAMESPACE_ID = BUILTIN_PID_NAMESPACE_IDS.self;

export type BuiltinPidNamespaceId = (typeof BUILTIN_PID_NAMESPACE_IDS)[keyof typeof BUILTIN_PID_NAMESPACE_IDS];
export type PidNamespaceKind = 'builtin' | 'custom';
export type PidNamespaceRole = 'author' | 'manager';
export type PidNamespaceScopedCapability = 'manager' | 'editAll' | 'admin';

export interface PidNamespaceMember {
    uid: number;
    role: PidNamespaceRole;
    editAll: boolean;
}

export interface PidNamespaceDoc {
    _id: ObjectId;
    domainId: string;
    namespaceId: string;
    kind: PidNamespaceKind;
    name: string;
    enabled: boolean;
    revision: number;
    members: PidNamespaceMember[];
    /** Custom namespace only. */
    prefix?: string;
    /** First sequence that may be allocated. Custom namespace only. */
    start?: number;
    /** Last allocated sequence, or start - 1 before first allocation. */
    counter?: number;
    allocated?: boolean;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface PidNamespaceCounterView {
    scope: string;
    value: number;
}

export interface PidNamespaceView {
    namespaceId: string;
    kind: PidNamespaceKind;
    name: string;
    enabled: boolean;
    revision: number;
    members: PidNamespaceMember[];
    sourceTemplates: ManagedSourceTemplate[];
    pidPattern: string;
    prefix?: string;
    start?: number;
    counter: number | null;
    allocated: boolean;
    counterEntries: PidNamespaceCounterView[];
    createdAt?: Date;
    updatedAt?: Date;
}

export interface PidNamespaceAclSnapshot {
    authorNamespaceIds: Set<string>;
    managerNamespaceIds: Set<string>;
    editAllNamespaceIds: Set<string>;
}

export type PidNamespaceAclUser = Pick<User, '_id' | 'hasPerm' | 'hasPriv'> & {
    _pidNamespaceAuthorIds?: Set<string>;
    _pidNamespaceManagerIds?: Set<string>;
    _pidNamespaceEditAllIds?: Set<string>;
    _pidNamespaceAclDomainId?: string;
    _pidNamespaceAclLoaded?: boolean;
};

interface BuiltinPidNamespaceDefinition {
    namespaceId: BuiltinPidNamespaceId;
    name: string;
    sourceTemplates: ManagedSourceTemplate[];
    pidPattern: string;
    counterMatches: (namespace: string) => boolean;
}

const BUILTIN_PID_NAMESPACES: readonly BuiltinPidNamespaceDefinition[] = [
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
        name: 'PAT 乙级',
        sourceTemplates: ['pat_basic'],
        pidPattern: 'P3xxx',
        counterMatches: (namespace) => namespace === 'pat-basic',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.patAdvanced,
        name: 'PAT 甲级',
        sourceTemplates: ['pat_advanced'],
        pidPattern: 'P4xxx',
        counterMatches: (namespace) => namespace === 'pat-advanced',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.self,
        name: '自命题',
        sourceTemplates: ['self'],
        pidPattern: 'P5xxx',
        counterMatches: (namespace) => namespace === 'self',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.nowcoder,
        name: '牛客',
        sourceTemplates: ['nowcoder_summer'],
        pidPattern: 'NKxxxx',
        counterMatches: (namespace) => namespace === 'nowcoder',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.hdu,
        name: 'HDU',
        sourceTemplates: ['hdu_summer', 'hdu_spring'],
        pidPattern: 'HDUxxxx',
        counterMatches: (namespace) => namespace === 'hdu',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.gplt,
        name: '天梯赛',
        sourceTemplates: ['gplt_national', 'gplt_provincial'],
        pidPattern: 'GPLT{year}{N/P}xxx',
        counterMatches: (namespace) => /^gplt-\d{4}-(?:national|provincial)$/.test(namespace),
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.cauc,
        name: 'CAUC 校赛',
        sourceTemplates: ['cauc'],
        pidPattern: 'CCCCCAUC{year}xxxx',
        counterMatches: (namespace) => /^cauc-\d{4}$/.test(namespace),
    },
] as const;

const BUILTIN_BY_ID = new Map(BUILTIN_PID_NAMESPACES.map((definition) => [definition.namespaceId, definition]));
const BUILTIN_BY_TEMPLATE = new Map(
    BUILTIN_PID_NAMESPACES.flatMap((definition) => definition.sourceTemplates.map((template) => [template, definition.namespaceId] as const)),
);
const RESERVED_CUSTOM_PREFIXES = new Set(['P', 'P3', 'P4', 'P5', 'PAT', 'NK', 'NOWCODER', 'HDU', 'GPLT', 'CAUC', 'CCCCCAUC']);
const logger = new Logger('problem-pid-namespace');
const namespaceColl = db.collection<PidNamespaceDoc>('problem.pid_namespaces');
const counterColl = db.collection<{ domainId: string; namespace: string; value: number; updatedAt: Date }>('problem.pid_counters');
const namespaceBoundaries = new Map<string, Promise<void>>();
const heldNamespaceBoundaries = new AsyncLocalStorage<ReadonlySet<string>>();

function boundaryKey(domainId: string, namespaceId: string) {
    return `${domainId}\0${namespaceId}`;
}

/**
 * The production site runs one Hydro process. This small in-process boundary
 * serializes membership changes, namespace config changes and scoped writes
 * without introducing a queue, lease or distributed lock.
 */
export async function withPidNamespaceBoundary<T>(domainId: string, namespaceId: string, work: () => Promise<T>): Promise<T> {
    const key = boundaryKey(domainId, namespaceId);
    const alreadyHeld = heldNamespaceBoundaries.getStore();
    if (alreadyHeld?.has(key)) return work();
    const previous = namespaceBoundaries.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => gate);
    namespaceBoundaries.set(key, tail);
    await previous;
    try {
        return await heldNamespaceBoundaries.run(new Set([...(alreadyHeld || []), key]), work);
    } finally {
        release();
        if (namespaceBoundaries.get(key) === tail) namespaceBoundaries.delete(key);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parseInteger(value: unknown, field: string, minimum: number, maximum: number): number {
    const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isSafeInteger(normalized) || Number(normalized) < minimum || Number(normalized) > maximum) {
        throw new ValidationError(field);
    }
    return Number(normalized);
}

function assertDomainId(domainId: unknown): asserts domainId is string {
    if (typeof domainId !== 'string' || !domainId.trim()) throw new ValidationError('domainId');
}

function assertNamespaceId(namespaceId: unknown): asserts namespaceId is string {
    if (typeof namespaceId !== 'string' || !/^(?:builtin:[a-z-]+|custom:[a-f0-9]{24})$/.test(namespaceId)) {
        throw new ValidationError('pidNamespaceId');
    }
}

function assertMember(member: PidNamespaceMember): void {
    if (!Number.isSafeInteger(member.uid) || member.uid < 1) throw new TypeError('PID namespace member uid must be a positive integer');
    if (member.role !== 'author' && member.role !== 'manager') throw new TypeError('PID namespace member role is invalid');
    if (typeof member.editAll !== 'boolean') throw new TypeError('PID namespace member editAll must be boolean');
}

function normalizeMembers(input: unknown): PidNamespaceMember[] {
    if (!Array.isArray(input)) throw new TypeError('PID namespace members must be an array');
    const byUid = new Map<number, PidNamespaceMember>();
    for (const raw of input) {
        if (!isPlainObject(raw)) throw new TypeError('PID namespace member must be an object');
        const member = { uid: raw.uid, role: raw.role, editAll: raw.editAll } as PidNamespaceMember;
        assertMember(member);
        if (byUid.has(member.uid)) throw new TypeError(`PID namespace contains duplicate member uid ${member.uid}`);
        byUid.set(member.uid, member);
    }
    return [...byUid.values()].sort((left, right) => left.uid - right.uid);
}

function builtinDefinition(namespaceId: string): BuiltinPidNamespaceDefinition | null {
    return BUILTIN_BY_ID.get(namespaceId as BuiltinPidNamespaceId) || null;
}

export function builtinPidNamespaceIdForSourceTemplate(template: unknown): BuiltinPidNamespaceId {
    const namespaceId = typeof template === 'string' ? BUILTIN_BY_TEMPLATE.get(template as ManagedSourceTemplate) : undefined;
    if (!namespaceId) throw new ValidationError('template');
    return namespaceId;
}

export function normalizeCustomPidNamespaceInput(input: unknown): { name: string; prefix: string; start: number } {
    if (!isPlainObject(input)) throw new ValidationError('namespace');
    const allowed = new Set(['name', 'prefix', 'start']);
    const unknown = Object.keys(input).filter((field) => !allowed.has(field));
    if (unknown.length) throw new ValidationError('namespace', null, `命名空间不接受字段：${unknown.join(', ')}`);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const prefix = typeof input.prefix === 'string' ? input.prefix.trim().toUpperCase() : '';
    if (!name || name.length > 64) throw new ValidationError('name');
    if (!/^[A-Z]{2,8}$/.test(prefix) || RESERVED_CUSTOM_PREFIXES.has(prefix)) throw new ValidationError('prefix');
    const start = parseInteger(input.start, 'start', 1, 9999);
    return { name, prefix, start };
}

export function formatCustomPid(prefixInput: unknown, sequence: unknown): string {
    const prefix = typeof prefixInput === 'string' ? prefixInput.trim().toUpperCase() : '';
    if (!/^[A-Z]{2,8}$/.test(prefix)) throw new ValidationError('prefix');
    const value = parseInteger(sequence, 'sequence', 1, 9999);
    return `${prefix}${String(value).padStart(4, '0')}`;
}

function maxBuiltinSequence(sourceMeta: ManagedSourceMeta): number {
    if (sourceMeta.template === 'pat_basic') return 3999;
    if (sourceMeta.template === 'pat_advanced') return 4999;
    if (sourceMeta.template === 'self') return 5999;
    if (sourceMeta.template === 'gplt_national' || sourceMeta.template === 'gplt_provincial') return 999;
    return 9999;
}

function isProblemBankAdmin(user: PidNamespaceAclUser): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function hasBaseCreatePermission(user: PidNamespaceAclUser): boolean {
    return isProblemBankAdmin(user) || user.hasPerm(PERM.PERM_CREATE_PROBLEM) || user.hasPerm(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
}

function hasLoadedPidNamespaceAcl(user: PidNamespaceAclUser, domainId: string): boolean {
    return user._pidNamespaceAclLoaded === true && user._pidNamespaceAclDomainId === domainId;
}

export function canCreateInPidNamespace(user: PidNamespaceAclUser, domainId: string, namespaceId: string): boolean {
    if (!hasBaseCreatePermission(user) || !hasLoadedPidNamespaceAcl(user, domainId)) return false;
    if (isProblemBankAdmin(user) || namespaceId === DEFAULT_PID_NAMESPACE_ID) return true;
    return user._pidNamespaceAuthorIds?.has(namespaceId) === true || user._pidNamespaceManagerIds?.has(namespaceId) === true;
}

export function pidNamespaceCapabilityForProblem(
    user: PidNamespaceAclUser,
    pdoc: {
        domainId: string;
        pidNamespaceId?: string;
        authoringMode?: 'managed';
        hidden?: boolean;
        archivedAt?: Date;
        managedAuthoring?: { metadataStatus?: 'draft' | 'confirmed' };
    },
    capability: ProblemWriteCapability,
): PidNamespaceScopedCapability | null {
    if (!hasLoadedPidNamespaceAcl(user, pdoc.domainId)) return null;
    if (isProblemBankAdmin(user)) return 'admin';
    if (pdoc.archivedAt) return null;
    const namespaceId = pdoc.pidNamespaceId;
    if (!namespaceId) return null;
    if (user._pidNamespaceEditAllIds?.has(namespaceId) && ['content', 'metadata', 'data', 'tag'].includes(capability)) {
        return 'editAll';
    }
    const managerReviewable =
        user._pidNamespaceManagerIds?.has(namespaceId) === true &&
        pdoc.authoringMode === 'managed' &&
        pdoc.hidden === true &&
        !pdoc.archivedAt &&
        (pdoc.managedAuthoring?.metadataStatus === 'draft' || pdoc.managedAuthoring?.metadataStatus === 'confirmed');
    if (managerReviewable && ['metadata', 'tag'].includes(capability)) return 'manager';
    const managerPublishable =
        user._pidNamespaceManagerIds?.has(namespaceId) === true &&
        pdoc.authoringMode === 'managed' &&
        pdoc.hidden === true &&
        !pdoc.archivedAt &&
        (pdoc.managedAuthoring?.metadataStatus === 'draft' || pdoc.managedAuthoring?.metadataStatus === 'confirmed');
    if (managerPublishable && capability === 'publish') return 'manager';
    return null;
}

function clearPidNamespaceAcl(user: PidNamespaceAclUser): void {
    user._pidNamespaceAuthorIds = new Set();
    user._pidNamespaceManagerIds = new Set();
    user._pidNamespaceEditAllIds = new Set();
    user._pidNamespaceAclDomainId = undefined;
    user._pidNamespaceAclLoaded = false;
}

export async function loadPidNamespaceAclForUser(domainId: string, uid: number): Promise<PidNamespaceAclSnapshot> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(uid) || uid < 0) throw new TypeError('PID namespace ACL uid must be a non-negative integer');
    if (uid === 0) {
        return {
            authorNamespaceIds: new Set(),
            managerNamespaceIds: new Set(),
            editAllNamespaceIds: new Set(),
        };
    }
    const docs = await namespaceColl.find({ domainId, 'members.uid': uid }, { projection: { namespaceId: 1, members: 1 } }).toArray();
    const authorNamespaceIds = new Set<string>();
    const managerNamespaceIds = new Set<string>();
    const editAllNamespaceIds = new Set<string>();
    for (const doc of docs) {
        assertNamespaceId(doc.namespaceId);
        const member = normalizeMembers(doc.members).find((candidate) => candidate.uid === uid);
        if (!member) throw new TypeError(`PID namespace ACL query returned no matching member for ${doc.namespaceId}/${uid}`);
        authorNamespaceIds.add(doc.namespaceId);
        if (member.role === 'manager') managerNamespaceIds.add(doc.namespaceId);
        if (member.editAll) editAllNamespaceIds.add(doc.namespaceId);
    }
    return { authorNamespaceIds, managerNamespaceIds, editAllNamespaceIds };
}

export async function refreshPidNamespaceAcl(user: PidNamespaceAclUser, domainId: string): Promise<void> {
    clearPidNamespaceAcl(user);
    try {
        const service = (global.Hydro?.model as any)?.pidNamespaces;
        if (typeof service?.loadAclForUser !== 'function') throw new TypeError('pidNamespaces.loadAclForUser is unavailable');
        const snapshot = await service.loadAclForUser(domainId, user._id);
        if (
            !(snapshot?.authorNamespaceIds instanceof Set) ||
            !(snapshot?.managerNamespaceIds instanceof Set) ||
            !(snapshot?.editAllNamespaceIds instanceof Set)
        ) {
            throw new TypeError('pidNamespaces.loadAclForUser returned an invalid ACL snapshot');
        }
        user._pidNamespaceAuthorIds = snapshot.authorNamespaceIds;
        user._pidNamespaceManagerIds = snapshot.managerNamespaceIds;
        user._pidNamespaceEditAllIds = snapshot.editAllNamespaceIds;
        user._pidNamespaceAclDomainId = domainId;
        user._pidNamespaceAclLoaded = true;
    } catch (error) {
        clearPidNamespaceAcl(user);
        logger.error('PID namespace ACL reload failed domain=%s uid=%d error=%o', domainId, user._id, error);
        throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
    }
}

/**
 * Revalidate a namespace-scoped claim at a specialized write boundary.
 *
 * Generic Problem updates do this in commitProblemWriteClaimUpdate. Managed
 * publication owns a separate persistence session and must call this helper
 * before its canonical write instead of trusting request-local ACL state.
 */
export async function withLivePidNamespaceGrant<T>(
    claim: Pick<ProblemWriteClaim, 'domainId' | 'pid' | 'requestId' | 'actor' | 'pidNamespaceId' | 'pidNamespaceGrant'>,
    work: () => Promise<T>,
): Promise<T | null> {
    if (!claim.pidNamespaceId || !claim.pidNamespaceGrant) return work();
    return withPidNamespaceBoundary(claim.domainId, claim.pidNamespaceId, async () => {
        const snapshot = await loadPidNamespaceAclForUser(claim.domainId, claim.actor);
        const stillAuthorized =
            claim.pidNamespaceGrant === 'manager'
                ? snapshot.managerNamespaceIds.has(claim.pidNamespaceId!)
                : snapshot.editAllNamespaceIds.has(claim.pidNamespaceId!);
        if (!stillAuthorized) {
            logger.warn(
                'PID namespace scoped specialized write rejected domain=%s namespace=%s pid=%d actor=%d grant=%s requestId=%s stage=live-grant result=revoked',
                claim.domainId,
                claim.pidNamespaceId,
                claim.pid,
                claim.actor,
                claim.pidNamespaceGrant,
                claim.requestId,
            );
            return null;
        }
        return work();
    });
}

function overlayBuiltin(definition: BuiltinPidNamespaceDefinition, persisted?: PidNamespaceDoc | null): PidNamespaceView {
    if (persisted) {
        if (persisted.kind !== 'builtin' || persisted.namespaceId !== definition.namespaceId) {
            throw new TypeError(`PID namespace built-in overlay is invalid: ${definition.namespaceId}`);
        }
        normalizeMembers(persisted.members);
    }
    return {
        namespaceId: definition.namespaceId,
        kind: 'builtin',
        name: definition.name,
        enabled: persisted?.enabled !== false,
        revision: persisted?.revision || 0,
        members: persisted ? normalizeMembers(persisted.members) : [],
        sourceTemplates: [...definition.sourceTemplates],
        pidPattern: definition.pidPattern,
        counter: null,
        allocated: false,
        counterEntries: [],
        createdAt: persisted?.createdAt,
        updatedAt: persisted?.updatedAt,
    };
}

function customView(doc: PidNamespaceDoc): PidNamespaceView {
    if (doc.kind !== 'custom' || !doc.prefix || !Number.isSafeInteger(doc.start) || !Number.isSafeInteger(doc.counter)) {
        throw new TypeError(`PID namespace custom record is invalid: ${doc.namespaceId}`);
    }
    return {
        namespaceId: doc.namespaceId,
        kind: 'custom',
        name: doc.name,
        enabled: doc.enabled,
        revision: doc.revision,
        members: normalizeMembers(doc.members),
        sourceTemplates: ['self'],
        pidPattern: `${doc.prefix}xxxx`,
        prefix: doc.prefix,
        start: doc.start,
        counter: doc.counter,
        allocated: doc.allocated === true,
        counterEntries: [{ scope: doc.namespaceId, value: doc.counter }],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export async function getPidNamespace(domainId: string, namespaceId: string): Promise<PidNamespaceView | null> {
    assertDomainId(domainId);
    assertNamespaceId(namespaceId);
    const persisted = await namespaceColl.findOne({ domainId, namespaceId });
    const definition = builtinDefinition(namespaceId);
    if (definition) return overlayBuiltin(definition, persisted);
    return persisted ? customView(persisted) : null;
}

export async function listPidNamespaces(domainId: string): Promise<PidNamespaceView[]> {
    assertDomainId(domainId);
    const [persisted, counters] = await Promise.all([
        namespaceColl.find({ domainId }).sort({ kind: 1, name: 1, namespaceId: 1 }).toArray(),
        counterColl.find({ domainId }).sort({ namespace: 1 }).toArray(),
    ]);
    const byId = new Map(persisted.map((doc) => [doc.namespaceId, doc]));
    const builtins = BUILTIN_PID_NAMESPACES.map((definition) => {
        const view = overlayBuiltin(definition, byId.get(definition.namespaceId));
        const entries = counters
            .filter((counter) => definition.counterMatches(counter.namespace))
            .map((counter) => ({ scope: counter.namespace, value: counter.value }));
        view.counterEntries = entries;
        view.counter = entries.length ? Math.max(...entries.map((entry) => entry.value)) : null;
        view.allocated = entries.some((entry) => entry.value > 0);
        byId.delete(definition.namespaceId);
        return view;
    });
    const custom = [...byId.values()].map(customView);
    return [...builtins, ...custom].sort(
        (left, right) => Number(left.kind === 'custom') - Number(right.kind === 'custom') || left.name.localeCompare(right.name, 'zh-CN'),
    );
}

export async function listCreatablePidNamespaces(domainId: string, user: PidNamespaceAclUser): Promise<PidNamespaceView[]> {
    if (!hasLoadedPidNamespaceAcl(user, domainId)) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
    const namespaces = await listPidNamespaces(domainId);
    return namespaces.filter((namespace) => namespace.enabled && canCreateInPidNamespace(user, domainId, namespace.namespaceId));
}

export function canReviewPidNamespaceProblems(user: PidNamespaceAclUser, domainId: string): boolean {
    if (!hasLoadedPidNamespaceAcl(user, domainId)) return false;
    return isProblemBankAdmin(user) || (user._pidNamespaceManagerIds?.size || 0) > 0;
}

export function canManagePidNamespaces(user: PidNamespaceAclUser, domainId: string): boolean {
    return canReviewPidNamespaceProblems(user, domainId);
}

export function managedPidNamespaceIds(user: PidNamespaceAclUser, domainId: string): string[] {
    if (!hasLoadedPidNamespaceAcl(user, domainId)) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
    if (isProblemBankAdmin(user)) return [];
    return Array.from(user._pidNamespaceManagerIds || []).sort();
}

export async function listManageablePidNamespaces(domainId: string, user: PidNamespaceAclUser): Promise<PidNamespaceView[]> {
    if (!canManagePidNamespaces(user, domainId)) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
    const namespaces = await listPidNamespaces(domainId);
    if (isProblemBankAdmin(user)) return namespaces;
    const managed = user._pidNamespaceManagerIds || new Set<string>();
    return namespaces.filter((namespace) => managed.has(namespace.namespaceId));
}

function sourceMetaForNamespace(namespace: PidNamespaceView, sourceMetaInput: unknown): ManagedSourceMeta {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    if (!namespace.sourceTemplates.includes(sourceMeta.template)) {
        throw new ValidationError('template', null, `来源模板不属于题号命名空间 ${namespace.name}`);
    }
    if (namespace.kind === 'custom' && sourceMeta.template !== 'self') {
        throw new ValidationError('template', null, '自定义命名空间只保留自命题来源事实，不自动派生课程标签');
    }
    return sourceMeta;
}

interface PidNamespaceAuditInput {
    operation: string;
    domainId: string;
    namespaceId: string;
    actor: number;
    requestId: string;
    problemId?: number;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
}

async function beginPidNamespaceAudit(input: PidNamespaceAuditInput): Promise<ObjectId> {
    if (!input.requestId?.trim()) throw new TypeError('PID namespace audit requestId is required');
    return oplog.add({
        type: `problem.pid-namespace.${input.operation}`,
        operation: input.operation,
        domainId: input.domainId,
        namespaceId: input.namespaceId,
        operator: input.actor,
        problemId: input.problemId,
        requestId: input.requestId.trim(),
        before: input.before || null,
        after: input.after || null,
        result: 'attempt',
        time: new Date(),
    } as any);
}

async function finishPidNamespaceAudit(
    auditId: ObjectId,
    result: 'success' | 'rejected' | 'incomplete',
    reason?: string,
    after?: Record<string, unknown>,
): Promise<void> {
    const updated = await oplog.coll.updateOne(
        { _id: auditId, result: 'attempt' },
        { $set: { result, ...(reason ? { reason } : {}), ...(after ? { after } : {}), completedAt: new Date() } },
    );
    if (updated.matchedCount !== 1) throw new Error(`PID namespace audit ${auditId.toHexString()} could not be finalized`);
}

async function auditedPidNamespaceMutation<T>(
    input: PidNamespaceAuditInput,
    work: (markCommitted: () => void) => Promise<T>,
): Promise<T> {
    const auditId = await beginPidNamespaceAudit(input);
    let committed = false;
    let result!: T;
    try {
        result = await work(() => {
            committed = true;
        });
        if (!committed) throw new Error(`PID namespace mutation ${input.operation} returned without marking its write committed`);
        await finishPidNamespaceAudit(auditId, 'success');
        return result;
    } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (committed) {
            try {
                await finishPidNamespaceAudit(auditId, 'incomplete', `mutation committed but audit finalization failed: ${reason}`);
            } catch (auditError) {
                throw new AggregateError([error, auditError], 'PID namespace mutation committed but its audit could not be finalized');
            }
            throw error;
        }
        try {
            await finishPidNamespaceAudit(auditId, 'rejected', reason);
        } catch (auditError) {
            throw new AggregateError([error, auditError], 'PID namespace mutation failed and its audit could not be finalized');
        }
        throw error;
    }
}

function adminRequired(user: PidNamespaceAclUser): void {
    if (!isProblemBankAdmin(user)) throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
}

function duplicateNamespace(error: any): never {
    if (error?.code === 11000) throw new ValidationError('prefix', null, '当前域已存在相同题号前缀或命名空间');
    throw error;
}

async function assertCustomPrefixDoesNotMatchExistingProblem(domainId: string, prefix: string): Promise<void> {
    const collision = await document.coll.findOne(
        {
            domainId,
            docType: document.TYPE_PROBLEM,
            pid: new RegExp(`^${prefix}\\d{4}$`),
        },
        { projection: { docId: 1, pid: 1 } },
    );
    if (collision) {
        throw new ValidationError('prefix', null, `前缀已匹配现有题号 ${collision.pid}，不能建立自定义命名空间`);
    }
}

export async function createCustomPidNamespace(
    domainId: string,
    input: unknown,
    user: PidNamespaceAclUser,
    requestId: string,
): Promise<PidNamespaceView> {
    assertDomainId(domainId);
    adminRequired(user);
    const normalized = normalizeCustomPidNamespaceInput(input);
    const namespaceId = `custom:${new ObjectId().toHexString()}`;
    const now = new Date();
    const doc: PidNamespaceDoc = {
        _id: new ObjectId(),
        domainId,
        namespaceId,
        kind: 'custom',
        name: normalized.name,
        prefix: normalized.prefix,
        start: normalized.start,
        counter: normalized.start - 1,
        allocated: false,
        enabled: true,
        revision: 1,
        members: [],
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
    };
    return withPidNamespaceBoundary(domainId, namespaceId, () =>
        auditedPidNamespaceMutation(
            {
                operation: 'create',
                domainId,
                namespaceId,
                actor: user._id,
                requestId,
                after: { name: doc.name, prefix: doc.prefix, start: doc.start, enabled: doc.enabled, revision: doc.revision },
            },
            async (markCommitted) => {
                await assertCustomPrefixDoesNotMatchExistingProblem(domainId, normalized.prefix);
                try {
                    await namespaceColl.insertOne(doc);
                } catch (error) {
                    duplicateNamespace(error);
                }
                markCommitted();
                return customView(doc);
            },
        ),
    );
}

export async function updatePidNamespaceConfig(input: {
    domainId: string;
    namespaceId: string;
    expectedRevision: number;
    user: PidNamespaceAclUser;
    requestId: string;
    name?: unknown;
    enabled?: unknown;
    prefix?: unknown;
    start?: unknown;
}): Promise<PidNamespaceView> {
    assertDomainId(input.domainId);
    assertNamespaceId(input.namespaceId);
    adminRequired(input.user);
    const expectedRevision = parseInteger(input.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    return withPidNamespaceBoundary(input.domainId, input.namespaceId, async () => {
        const current = await getPidNamespace(input.domainId, input.namespaceId);
        if (!current || current.revision !== expectedRevision) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
        const name = input.name === undefined ? current.name : typeof input.name === 'string' ? input.name.trim() : '';
        const enabled = input.enabled === undefined ? current.enabled : input.enabled;
        if (!name || name.length > 64) throw new ValidationError('name');
        if (typeof enabled !== 'boolean') throw new ValidationError('enabled');
        if (
            current.kind === 'builtin' &&
            ((input.name !== undefined && name !== current.name) || input.prefix !== undefined || input.start !== undefined)
        ) {
            throw new ValidationError('fields', null, '内置命名空间的名称、前缀和编号规则不可修改');
        }
        let prefix = current.prefix;
        let start = current.start;
        if (current.kind === 'custom' && (input.prefix !== undefined || input.start !== undefined)) {
            if (current.allocated) throw new ValidationError('prefix', null, '命名空间已分配过题号，前缀与起始编号已永久锁定');
            const referenced = await document.coll.findOne(
                { domainId: input.domainId, docType: document.TYPE_PROBLEM, pidNamespaceId: input.namespaceId },
                { projection: { docId: 1 } },
            );
            if (referenced) throw new ValidationError('prefix', null, '命名空间已有题目归属，前缀与起始编号已永久锁定');
            const normalized = normalizeCustomPidNamespaceInput({
                name,
                prefix: input.prefix === undefined ? current.prefix : input.prefix,
                start: input.start === undefined ? current.start : input.start,
            });
            prefix = normalized.prefix;
            start = normalized.start;
            await assertCustomPrefixDoesNotMatchExistingProblem(input.domainId, prefix);
        }
        const before = {
            name: current.name,
            enabled: current.enabled,
            prefix: current.prefix,
            start: current.start,
            revision: current.revision,
        };
        const after = { name, enabled, prefix, start, revision: current.revision + 1 };
        return auditedPidNamespaceMutation(
            {
                operation: 'config.update',
                domainId: input.domainId,
                namespaceId: input.namespaceId,
                actor: input.user._id,
                requestId: input.requestId,
                before,
                after,
            },
            async (markCommitted) => {
                const now = new Date();
                const definition = builtinDefinition(input.namespaceId);
                if (definition) {
                    const persisted = await namespaceColl.findOne({ domainId: input.domainId, namespaceId: input.namespaceId });
                    if (!persisted && expectedRevision === 0) {
                        try {
                            await namespaceColl.insertOne({
                                _id: new ObjectId(),
                                domainId: input.domainId,
                                namespaceId: input.namespaceId,
                                kind: 'builtin',
                                name: definition.name,
                                enabled,
                                revision: 1,
                                members: [],
                                createdBy: input.user._id,
                                createdAt: now,
                                updatedAt: now,
                            });
                            markCommitted();
                        } catch (error) {
                            duplicateNamespace(error);
                        }
                    } else {
                        const updated = await namespaceColl.findOneAndUpdate(
                            { domainId: input.domainId, namespaceId: input.namespaceId, kind: 'builtin', revision: expectedRevision },
                            { $set: { enabled, updatedAt: now }, $inc: { revision: 1 } },
                            { returnDocument: 'after' },
                        );
                        if (!updated) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
                        markCommitted();
                    }
                } else {
                    const update: Record<string, unknown> = { name, enabled, updatedAt: now };
                    if (prefix !== current.prefix) update.prefix = prefix;
                    if (start !== current.start) {
                        update.start = start;
                        update.counter = Number(start) - 1;
                    }
                    try {
                        const updated = await namespaceColl.findOneAndUpdate(
                            { domainId: input.domainId, namespaceId: input.namespaceId, kind: 'custom', revision: expectedRevision },
                            { $set: update, $inc: { revision: 1 } },
                            { returnDocument: 'after' },
                        );
                        if (!updated) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
                        markCommitted();
                    } catch (error) {
                        duplicateNamespace(error);
                    }
                }
                const result = await getPidNamespace(input.domainId, input.namespaceId);
                if (!result) throw new Error(`PID namespace vanished after config update: ${input.domainId}/${input.namespaceId}`);
                return result;
            },
        );
    });
}

export async function deleteCustomPidNamespace(input: {
    domainId: string;
    namespaceId: string;
    expectedRevision: number;
    user: PidNamespaceAclUser;
    requestId: string;
}): Promise<void> {
    assertDomainId(input.domainId);
    assertNamespaceId(input.namespaceId);
    adminRequired(input.user);
    if (builtinDefinition(input.namespaceId)) throw new ValidationError('pidNamespaceId', null, '内置命名空间不可删除');
    const expectedRevision = parseInteger(input.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    await withPidNamespaceBoundary(input.domainId, input.namespaceId, async () => {
        const current = await getPidNamespace(input.domainId, input.namespaceId);
        if (!current || current.kind !== 'custom') throw new ValidationError('pidNamespaceId');
        if (current.revision !== expectedRevision) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
        if (current.allocated) throw new ValidationError('pidNamespaceId', null, '命名空间已分配过题号，只能停用，不能删除');
        const referenced = await document.coll.findOne(
            { domainId: input.domainId, docType: document.TYPE_PROBLEM, pidNamespaceId: input.namespaceId },
            { projection: { docId: 1 } },
        );
        if (referenced) throw new ValidationError('pidNamespaceId', null, '命名空间已有题目归属，只能停用，不能删除');
        await auditedPidNamespaceMutation(
            {
                operation: 'delete',
                domainId: input.domainId,
                namespaceId: input.namespaceId,
                actor: input.user._id,
                requestId: input.requestId,
                before: { name: current.name, prefix: current.prefix, start: current.start, revision: current.revision },
            },
            async (markCommitted) => {
                const deleted = await namespaceColl.deleteOne({
                    domainId: input.domainId,
                    namespaceId: input.namespaceId,
                    kind: 'custom',
                    revision: expectedRevision,
                    allocated: { $ne: true },
                } as any);
                if (deleted.deletedCount !== 1) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
                markCommitted();
            },
        );
    });
}

export async function setPidNamespaceMember(input: {
    domainId: string;
    namespaceId: string;
    expectedRevision: number;
    targetUid: number;
    role: PidNamespaceRole | null;
    editAll: boolean;
    user: PidNamespaceAclUser;
    requestId: string;
}): Promise<PidNamespaceView> {
    assertDomainId(input.domainId);
    assertNamespaceId(input.namespaceId);
    if (!Number.isSafeInteger(input.targetUid) || input.targetUid < 1) throw new ValidationError('targetUid');
    if (input.role !== null && input.role !== 'author' && input.role !== 'manager') throw new ValidationError('role');
    if (typeof input.editAll !== 'boolean') throw new ValidationError('editAll');
    const expectedRevision = parseInteger(input.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    return withPidNamespaceBoundary(input.domainId, input.namespaceId, async () => {
        const current = await getPidNamespace(input.domainId, input.namespaceId);
        if (!current || current.revision !== expectedRevision) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
        const admin = isProblemBankAdmin(input.user);
        const actorMember = current.members.find((member) => member.uid === input.user._id);
        if (!admin && actorMember?.role !== 'manager') throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
        const existing = current.members.find((member) => member.uid === input.targetUid);
        if (!admin) {
            const removesOrdinaryAuthor = input.role === null && existing?.role === 'author' && existing.editAll === false;
            const writesOrdinaryAuthor =
                input.role === 'author' && input.editAll === false && existing?.role !== 'manager' && existing?.editAll !== true;
            if (!removesOrdinaryAuthor && !writesOrdinaryAuthor) {
                throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
            }
        }
        const members = current.members.filter((member) => member.uid !== input.targetUid);
        if (input.role) members.push({ uid: input.targetUid, role: input.role, editAll: input.editAll });
        members.sort((left, right) => left.uid - right.uid);
        const before = existing ? { uid: existing.uid, role: existing.role, editAll: existing.editAll } : null;
        const after = input.role ? { uid: input.targetUid, role: input.role, editAll: input.editAll } : null;
        return auditedPidNamespaceMutation(
            {
                operation: input.role ? 'member.set' : 'member.remove',
                domainId: input.domainId,
                namespaceId: input.namespaceId,
                actor: input.user._id,
                requestId: input.requestId,
                before,
                after,
            },
            async (markCommitted) => {
                const now = new Date();
                const definition = builtinDefinition(input.namespaceId);
                if (definition && current.revision === 0) {
                    try {
                        await namespaceColl.insertOne({
                            _id: new ObjectId(),
                            domainId: input.domainId,
                            namespaceId: input.namespaceId,
                            kind: 'builtin',
                            name: definition.name,
                            enabled: true,
                            revision: 1,
                            members,
                            createdBy: input.user._id,
                            createdAt: now,
                            updatedAt: now,
                        });
                        markCommitted();
                    } catch (error) {
                        duplicateNamespace(error);
                    }
                } else {
                    const updated = await namespaceColl.findOneAndUpdate(
                        { domainId: input.domainId, namespaceId: input.namespaceId, revision: expectedRevision },
                        { $set: { members, updatedAt: now }, $inc: { revision: 1 } },
                        { returnDocument: 'after' },
                    );
                    if (!updated) throw new ValidationError('expectedRevision', null, '命名空间已变化，请刷新后重试');
                    markCommitted();
                }
                const result = await getPidNamespace(input.domainId, input.namespaceId);
                if (!result) throw new Error(`PID namespace vanished after member update: ${input.domainId}/${input.namespaceId}`);
                return result;
            },
        );
    });
}

export async function reservePidForNamespace(input: {
    domainId: string;
    namespaceId: string;
    sourceMeta: unknown;
    user: PidNamespaceAclUser;
    actor: number;
    requestId: string;
}): Promise<{ namespaceId: string; pid: string; sourceMeta: ManagedSourceMeta }> {
    assertDomainId(input.domainId);
    assertNamespaceId(input.namespaceId);
    if (input.user._id !== input.actor) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
    return withPidNamespaceBoundary(input.domainId, input.namespaceId, async () => {
        await refreshPidNamespaceAcl(input.user, input.domainId);
        const namespace = await getPidNamespace(input.domainId, input.namespaceId);
        if (!namespace) throw new ValidationError('pidNamespaceId');
        if (!namespace.enabled) throw new ValidationError('pidNamespaceId', null, '题号命名空间已停用');
        if (!canCreateInPidNamespace(input.user, input.domainId, input.namespaceId)) {
            throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        }
        const sourceMeta = sourceMetaForNamespace(namespace, input.sourceMeta);
        const counterNamespace = namespace.kind === 'builtin' ? managedPidCounterNamespace(sourceMeta) : input.namespaceId;
        const persistedCounter =
            namespace.kind === 'builtin'
                ? await counterColl.findOne({ domainId: input.domainId, namespace: counterNamespace }, { projection: { value: 1 } })
                : null;
        const before = {
            counter: namespace.kind === 'builtin' ? (persistedCounter?.value ?? null) : namespace.counter,
            counterScope: counterNamespace,
            enabled: namespace.enabled,
        };
        const auditId = await beginPidNamespaceAudit({
            operation: 'pid.allocate',
            domainId: input.domainId,
            namespaceId: input.namespaceId,
            actor: input.actor,
            requestId: input.requestId,
            before,
        });
        let consumedAllocation: { counter: number; pid: string } | null = null;
        let completedAllocation: { namespaceId: string; pid: string; sourceMeta: ManagedSourceMeta } | null = null;
        try {
            let pid: string;
            let sequence: number;
            if (namespace.kind === 'builtin') {
                const maxSequence = maxBuiltinSequence(sourceMeta);
                const counter = await counterColl.findOneAndUpdate(
                    { domainId: input.domainId, namespace: counterNamespace, value: { $lt: maxSequence } },
                    { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
                    { returnDocument: 'after' },
                );
                if (!counter) {
                    const live = await counterColl.findOne({ domainId: input.domainId, namespace: counterNamespace }, { projection: { value: 1 } });
                    if (!live) throw new Error(`PID counter is not initialized: ${input.domainId}/${counterNamespace}`);
                    if (!Number.isSafeInteger(live.value) || live.value < 0) {
                        throw new TypeError(`PID counter is invalid: ${input.domainId}/${counterNamespace}`);
                    }
                    if (live.value >= maxSequence) {
                        throw new ValidationError('pidNamespaceId', null, `题号命名空间已耗尽（最大 ${maxSequence}）`);
                    }
                    throw new ValidationError('pidNamespaceId', null, '题号计数器已变化，请重试');
                }
                sequence = counter.value;
                pid = formatManagedProblemPid(sourceMeta, sequence);
            } else {
                const updated = await namespaceColl.findOneAndUpdate(
                    {
                        domainId: input.domainId,
                        namespaceId: input.namespaceId,
                        kind: 'custom',
                        enabled: true,
                        revision: namespace.revision,
                        counter: { $lt: 9999 },
                    },
                    {
                        $inc: { counter: 1, revision: 1 },
                        $set: { allocated: true, updatedAt: new Date() },
                    },
                    { returnDocument: 'after' },
                );
                if (!updated) {
                    const live = await getPidNamespace(input.domainId, input.namespaceId);
                    if (!live) throw new ValidationError('pidNamespaceId');
                    if (!live.enabled) throw new ValidationError('pidNamespaceId', null, '题号命名空间已停用');
                    if ((live.counter || 0) >= 9999) throw new ValidationError('pidNamespaceId', null, '题号命名空间已耗尽（最大 9999）');
                    throw new ValidationError('expectedRevision', null, '题号命名空间已变化，请重试');
                }
                sequence = updated.counter!;
                pid = formatCustomPid(updated.prefix, sequence);
            }
            consumedAllocation = { counter: sequence, pid };
            const collision = await document.coll.findOne(
                { domainId: input.domainId, docType: document.TYPE_PROBLEM, pid },
                { projection: { docId: 1, pid: 1 } },
            );
            if (collision) {
                throw new ValidationError('pidNamespaceId', null, `分配出的题号 ${pid} 已存在；counter 已消耗，请检查初始化或迁移状态`);
            }
            completedAllocation = { namespaceId: input.namespaceId, pid, sourceMeta };
            const finalized = await oplog.coll.updateOne(
                { _id: auditId, result: 'attempt' },
                {
                    $set: {
                        result: 'success',
                        after: { counter: sequence, pid },
                        completedAt: new Date(),
                    },
                },
            );
            if (finalized.matchedCount !== 1) throw new Error(`PID allocation audit ${auditId.toHexString()} could not be finalized`);
            logger.info(
                'PID namespace allocation completed domain=%s namespace=%s actor=%d pid=%s sequence=%d requestId=%s result=success',
                input.domainId,
                input.namespaceId,
                input.actor,
                pid,
                sequence,
                input.requestId,
            );
            return completedAllocation;
        } catch (error) {
            const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            if (completedAllocation) {
                try {
                    await finishPidNamespaceAudit(auditId, 'incomplete', `PID allocated but audit finalization failed: ${reason}`);
                } catch (auditError) {
                    throw new AggregateError([error, auditError], 'PID allocation committed but its audit could not be finalized');
                }
                throw error;
            }
            try {
                await finishPidNamespaceAudit(
                    auditId,
                    'rejected',
                    reason,
                    consumedAllocation ? { ...consumedAllocation, counterConsumed: true } : undefined,
                );
            } catch (auditError) {
                throw new AggregateError([error, auditError], 'PID allocation failed and its audit could not be finalized');
            }
            logger.error(
                'PID namespace allocation failed domain=%s namespace=%s actor=%d requestId=%s error=%o',
                input.domainId,
                input.namespaceId,
                input.actor,
                input.requestId,
                error,
            );
            throw error;
        }
    });
}

export async function ensurePidNamespaceIndexes(): Promise<void> {
    await namespaceColl.createIndex({ domainId: 1, namespaceId: 1 }, { unique: true, name: 'pidNamespaceIdentity' });
    await namespaceColl.createIndex(
        { domainId: 1, prefix: 1 },
        {
            unique: true,
            name: 'pidNamespaceCustomPrefix',
            partialFilterExpression: { kind: 'custom' },
        },
    );
    await namespaceColl.createIndex({ domainId: 1, 'members.uid': 1 }, { name: 'pidNamespaceMembers' });
}

export async function apply(): Promise<void> {
    await ensurePidNamespaceIndexes();
}

(global.Hydro.model as any).pidNamespaces = {
    loadAclForUser: loadPidNamespaceAclForUser,
    get: getPidNamespace,
    list: listPidNamespaces,
};
