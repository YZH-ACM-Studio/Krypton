import fs from 'node:fs/promises';
import { BSON, ObjectId } from 'mongodb';
import {
    BUILTIN_PID_NAMESPACE_DEFINITIONS,
    classifyLegacyBuiltinPidForMigration,
    type LegacyBuiltinPidMatch,
} from './problem-pid-namespace-registry';
import { canonicalJson, sha256 } from './problem-batch-import';

export const PID_NAMESPACE_MIGRATION_SCHEMA_VERSION = 1;
export const PID_NAMESPACE_MIGRATION_DOMAIN_ID = 'system';
export const PID_NAMESPACE_OS_OLD_PID = 'OS1999';
export const PID_NAMESPACE_OS_NEW_PID = 'OS1071';
export const PID_NAMESPACE_OS_NEXT_PID = 'OS1072';
export const PID_NAMESPACE_OS_DOC_ID = 2966;
export const PID_NAMESPACE_OS_MANAGER_UID = 8;

const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EXPECTED_PROBLEM_COUNT = 1710;
const EXPECTED_INVALID_PID_COUNT = 13;
const EXPECTED_LEGACY_PID_COUNT = 1164;

export type PidNamespaceMigrationFamily = LegacyBuiltinPidMatch['family'] | 'os' | 'legacy' | 'invalid-pid';
export type PidNamespaceMigrationDecision = 'assign' | 'rename-os' | 'skip-legacy' | 'skip-invalid';

const EXPECTED_FAMILIES: Record<Exclude<PidNamespaceMigrationFamily, 'legacy' | 'invalid-pid'>, { count: number; maxSequence?: number }> = {
    'pat-basic': { count: 71, maxSequence: 3100 },
    'pat-advanced': { count: 58, maxSequence: 4059 },
    self: { count: 23, maxSequence: 5045 },
    nowcoder: { count: 83, maxSequence: 1083 },
    hdu: { count: 175, maxSequence: 1175 },
    gplt: { count: 0 },
    cauc: { count: 52 },
    os: { count: 71, maxSequence: 1999 },
};

export class PidNamespaceMigrationError extends Error {
    constructor(
        message: string,
        public readonly code = 'PID_NAMESPACE_MIGRATION_FAILED',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'PidNamespaceMigrationError';
    }
}

export interface PidNamespaceMigrationDatabaseIdentity {
    databaseName: string;
    collectionPrefix: string;
    collectionMap: Array<{ logicalName: string; physicalName: string }>;
    replicaSet: string | null;
    primary: string | null;
    hosts: string[];
}

export interface PidNamespaceMigrationRelatedRows {
    records: Array<Record<string, any>>;
    recordStats: Array<Record<string, any>>;
    recordHistory: Array<Record<string, any>>;
    statuses: Array<Record<string, any>>;
    containers: Array<Record<string, any>>;
    trainingCourses: Array<Record<string, any>>;
    problemReferences: Array<Record<string, any>>;
    solutions: Array<Record<string, any>>;
    discussions: Array<Record<string, any>>;
    mindmap: Array<Record<string, any>>;
    tasks: Array<Record<string, any>>;
    paperDrafts: Array<Record<string, any>>;
    permits: Array<Record<string, any>>;
    permitSources: Array<Record<string, any>>;
    testdataSources: Array<Record<string, any>>;
    storage: Array<Record<string, any>>;
}

export interface PidNamespaceMigrationSnapshot {
    databaseIdentity: PidNamespaceMigrationDatabaseIdentity;
    codeVersion: string;
    problems: Array<Record<string, any>>;
    domains: Array<Record<string, any>>;
    counters: Array<Record<string, any>>;
    namespaceDocs: Array<Record<string, any>>;
    related: PidNamespaceMigrationRelatedRows;
}

export interface PidNamespaceMigrationEntry {
    documentId: string;
    domainId: string;
    docId: number;
    pid: string | null;
    family: PidNamespaceMigrationFamily;
    decision: PidNamespaceMigrationDecision;
    namespaceId?: string;
    counterScope?: string;
    sequence?: number;
    targetPid?: string;
    targetSort?: string;
    structureRevisionPresent: boolean;
    structureRevision: unknown;
    pidNamespaceIdPresent: boolean;
    pidNamespaceId: unknown;
    stateFingerprint: string;
    nonTargetFingerprint: string;
}

export interface PidNamespaceMigrationCounterTarget {
    domainId: string;
    scope: string;
    currentPresent: boolean;
    currentValue: number | null;
    targetValue: number;
}

export interface PidNamespaceMigrationRelatedSummary {
    records: { count: number; accepted: number; hash: string };
    recordStats: { count: number; hash: string };
    recordHistory: { count: number; hash: string };
    statuses: { count: number; hash: string };
    storage: { count: number; hash: string };
    references: Record<
        | 'containers'
        | 'trainingCourses'
        | 'problemReferences'
        | 'solutions'
        | 'discussions'
        | 'mindmap'
        | 'tasks'
        | 'paperDrafts'
        | 'permits'
        | 'permitSources'
        | 'testdataSources',
        { count: number; hash: string }
    >;
    fingerprint: string;
}

export interface PidNamespaceMigrationReport {
    schemaVersion: 1;
    generatedAt: string;
    source: {
        databaseIdentity: PidNamespaceMigrationDatabaseIdentity;
        codeVersion: string;
        registry: Array<{
            namespaceId: string;
            name: string;
            sourceTemplates: string[];
            pidPattern: string;
            counterScope: string;
        }>;
        problemCount: number;
        familyCounts: Record<PidNamespaceMigrationFamily, number>;
        familyMaxSequence: Partial<Record<PidNamespaceMigrationFamily, number>>;
        problemNonTargetFingerprint: string;
        skippedFingerprint: string;
        domainFingerprint: string;
        namespaceDocsFingerprint: string;
        untouchedCountersFingerprint: string;
        related: PidNamespaceMigrationRelatedSummary;
        drifts: string[];
        executable: boolean;
    };
    target: {
        osNamespace: {
            namespaceId: string;
            name: '操作系统';
            prefix: 'OS';
            start: 1001;
            counter: 1071;
            enabled: true;
            members: [{ uid: 8; role: 'manager'; editAll: false }];
        };
        osRename: {
            documentId: string;
            domainId: 'system';
            docId: 2966;
            oldPid: 'OS1999';
            newPid: 'OS1071';
            nextPid: 'OS1072';
        };
        counters: PidNamespaceMigrationCounterTarget[];
    };
    entries: PidNamespaceMigrationEntry[];
    fingerprint: string;
    confirmationToken: string;
    execution?: {
        actor: number;
        startedAt: string;
        updatedAt: string;
        completedAt?: string;
        state: 'applying' | 'applied' | 'failed';
        osNamespaceStatus?: 'applied' | 'no-op';
        results: Array<{
            domainId: string;
            docId: number;
            pid: string | null;
            status: 'applied' | 'no-op' | 'stale';
            at: string;
            reason: string;
        }>;
        counterResults: Array<{
            domainId: string;
            scope: string;
            status: 'applied' | 'no-op';
            at: string;
        }>;
        auditId?: string;
        lastError?: string;
    };
    verification?: {
        verifiedAt: string;
        ok: boolean;
        checks: Array<{ check: string; ok: boolean; detail?: string }>;
        auditId?: string;
    };
}

export interface PidNamespaceMigrationWriteResult {
    matchedCount: number;
    modifiedCount: number;
}

export interface PidNamespaceMigrationRepository {
    loadSnapshot(): Promise<PidNamespaceMigrationSnapshot>;
    isSystemAdministrator(uid: number): Promise<boolean>;
    loadProblem(domainId: string, docId: number): Promise<Record<string, any> | null>;
    casProblem(entry: PidNamespaceMigrationEntry): Promise<PidNamespaceMigrationWriteResult>;
    ensureOsNamespace(target: PidNamespaceMigrationReport['target']['osNamespace'], actor: number, now: Date): Promise<'applied' | 'no-op'>;
    ensureCounter(target: PidNamespaceMigrationCounterTarget, now: Date): Promise<'applied' | 'no-op'>;
    insertAudit(audit: Record<string, any>): Promise<string>;
    findEntryAudit(fingerprint: string, domainId: string, docId: number): Promise<Record<string, any> | null>;
    findNamespaceAudit(fingerprint: string): Promise<Record<string, any> | null>;
    findCounterAudit(fingerprint: string, domainId: string, scope: string): Promise<Record<string, any> | null>;
    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null>;
    loadSuccessfulAudits(fingerprint: string): Promise<Array<Record<string, any>>>;
    close?(): Promise<void>;
}

function fail(message: string, code = 'PID_NAMESPACE_MIGRATION_INVALID', details?: unknown): never {
    throw new PidNamespaceMigrationError(message, code, details);
}

function own(value: object, field: PropertyKey): boolean {
    return Object.hasOwn(value, field);
}

function serialized(value: unknown): unknown {
    return BSON.EJSON.serialize(value, { relaxed: false });
}

function hash(value: unknown): string {
    return sha256(canonicalJson(serialized(value)));
}

function documentSortKey(row: Record<string, any>): string {
    return `${String(row.domainId || '')}/${String(row.docId ?? '')}/${String(row._id || '')}`;
}

function sortedDocuments(rows: Array<Record<string, any>>): Array<Record<string, any>> {
    return [...rows].sort((left, right) => documentSortKey(left).localeCompare(documentSortKey(right)));
}

function rowsHash(rows: Array<Record<string, any>>): string {
    return hash(sortedDocuments(rows));
}

function customNamespaceId(objectId: string): string {
    if (!OBJECT_ID.test(objectId)) fail('OS namespace ObjectId is malformed');
    return `custom:${objectId.toLowerCase()}`;
}

function problemSort(pid: string, namespaces: unknown): string {
    const mapping = namespaces && typeof namespaces === 'object' && !Array.isArray(namespaces) ? (namespaces as Record<string, string>) : undefined;
    const [namespace, body] = pid.includes('-') ? pid.split('-', 2) : ['default', pid];
    return ((mapping ? `${mapping[namespace]}-` : '') + body).replace(/(\d+)/g, (digits) =>
        digits.length >= 6 ? digits : `${'0'.repeat(6 - digits.length)}${digits}`,
    );
}

function withoutFields(row: Record<string, any>, fields: readonly string[]): Record<string, any> {
    const result = { ...row };
    for (const field of fields) delete result[field];
    return result;
}

function problemNonTargetFields(entry: Pick<PidNamespaceMigrationEntry, 'decision'>): readonly string[] {
    return entry.decision === 'rename-os' ? ['pidNamespaceId', 'pid', 'sort'] : entry.decision === 'assign' ? ['pidNamespaceId'] : [];
}

function problemFingerprint(row: Record<string, any>, fields: readonly string[] = []): string {
    return hash(withoutFields(row, fields));
}

function validateProblemIdentity(problem: Record<string, any>, index: number): { documentId: string; domainId: string; docId: number } {
    const documentId = String(problem._id || '');
    if (!OBJECT_ID.test(documentId)) fail(`problems.${index}._id is malformed`);
    if (typeof problem.domainId !== 'string' || !problem.domainId || !Number.isSafeInteger(problem.docId) || problem.docId < 1) {
        fail(`problems.${index} identity is malformed`);
    }
    if (problem.docType !== 10) fail(`problems.${index} is not a Problem`);
    return { documentId: documentId.toLowerCase(), domainId: problem.domainId, docId: problem.docId };
}

function osMatch(problem: Record<string, any>): { sequence: number } | null {
    if (problem.domainId !== PID_NAMESPACE_MIGRATION_DOMAIN_ID || typeof problem.pid !== 'string') return null;
    const match = /^OS(\d{4})$/.exec(problem.pid);
    return match && Number(match[1]) >= 1 ? { sequence: Number(match[1]) } : null;
}

function classifyProblem(problem: Record<string, any>): { family: PidNamespaceMigrationFamily; match?: LegacyBuiltinPidMatch; sequence?: number } {
    if (typeof problem.pid !== 'string' || !problem.pid.trim()) return { family: 'invalid-pid' };
    const builtin = classifyLegacyBuiltinPidForMigration(problem.pid);
    if (builtin) return { family: builtin.family, match: builtin, sequence: builtin.sequence };
    const os = osMatch(problem);
    if (os) return { family: 'os', sequence: os.sequence };
    return { family: 'legacy' };
}

function buildRelatedSummary(rows: PidNamespaceMigrationRelatedRows): PidNamespaceMigrationRelatedSummary {
    const referenceNames = [
        'containers',
        'trainingCourses',
        'problemReferences',
        'solutions',
        'discussions',
        'mindmap',
        'tasks',
        'paperDrafts',
        'permits',
        'permitSources',
        'testdataSources',
    ] as const;
    const references = Object.fromEntries(
        referenceNames.map((name) => [name, { count: rows[name].length, hash: rowsHash(rows[name]) }]),
    ) as PidNamespaceMigrationRelatedSummary['references'];
    const summary = {
        records: {
            count: rows.records.length,
            accepted: rows.records.filter((record) => record.status === 1).length,
            hash: rowsHash(rows.records),
        },
        recordStats: { count: rows.recordStats.length, hash: rowsHash(rows.recordStats) },
        recordHistory: { count: rows.recordHistory.length, hash: rowsHash(rows.recordHistory) },
        statuses: { count: rows.statuses.length, hash: rowsHash(rows.statuses) },
        storage: { count: rows.storage.length, hash: rowsHash(rows.storage) },
        references,
    };
    return { ...summary, fingerprint: hash(summary) };
}

function registrySnapshot() {
    return BUILTIN_PID_NAMESPACE_DEFINITIONS.map((definition) => ({
        namespaceId: definition.namespaceId,
        name: definition.name,
        sourceTemplates: [...definition.sourceTemplates],
        pidPattern: definition.pidPattern,
        counterScope: definition.counterScope,
    }));
}

function reportFingerprintPayload(report: Pick<PidNamespaceMigrationReport, 'schemaVersion' | 'generatedAt' | 'source' | 'target' | 'entries'>) {
    return {
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        source: report.source,
        target: report.target,
        entries: report.entries,
    };
}

export function pidNamespaceMigrationFingerprint(
    report: Pick<PidNamespaceMigrationReport, 'schemaVersion' | 'generatedAt' | 'source' | 'target' | 'entries'>,
): string {
    return hash(reportFingerprintPayload(report));
}

function expectedFactsDrifts(
    problemCount: number,
    familyCounts: Record<PidNamespaceMigrationFamily, number>,
    familyMaxSequence: Partial<Record<PidNamespaceMigrationFamily, number>>,
): string[] {
    const drifts: string[] = [];
    if (problemCount !== EXPECTED_PROBLEM_COUNT) drifts.push(`problem-count:${problemCount}!=${EXPECTED_PROBLEM_COUNT}`);
    if (familyCounts.legacy !== EXPECTED_LEGACY_PID_COUNT) {
        drifts.push(`legacy-count:${familyCounts.legacy}!=${EXPECTED_LEGACY_PID_COUNT}`);
    }
    if (familyCounts['invalid-pid'] !== EXPECTED_INVALID_PID_COUNT) {
        drifts.push(`invalid-pid-count:${familyCounts['invalid-pid']}!=${EXPECTED_INVALID_PID_COUNT}`);
    }
    for (const [family, expected] of Object.entries(EXPECTED_FAMILIES) as Array<
        [Exclude<PidNamespaceMigrationFamily, 'legacy' | 'invalid-pid'>, { count: number; maxSequence?: number }]
    >) {
        if (familyCounts[family] !== expected.count) drifts.push(`${family}-count:${familyCounts[family]}!=${expected.count}`);
        if (expected.maxSequence !== undefined && familyMaxSequence[family] !== expected.maxSequence) {
            drifts.push(`${family}-max:${String(familyMaxSequence[family])}!=${expected.maxSequence}`);
        }
    }
    return drifts;
}

export function buildPidNamespaceMigrationPlan(
    snapshot: PidNamespaceMigrationSnapshot,
    osNamespaceObjectId = new ObjectId().toHexString(),
    generatedAt = new Date(),
): PidNamespaceMigrationReport {
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) fail('plan timestamp is invalid');
    if (
        !snapshot.databaseIdentity ||
        typeof snapshot.databaseIdentity.databaseName !== 'string' ||
        !snapshot.databaseIdentity.databaseName ||
        typeof snapshot.codeVersion !== 'string' ||
        !snapshot.codeVersion
    ) {
        fail('database identity or code version is missing');
    }
    const namespaceId = customNamespaceId(osNamespaceObjectId);
    const domainsById = new Map(snapshot.domains.map((domain) => [String(domain._id), domain]));
    const entries: PidNamespaceMigrationEntry[] = [];
    const seenIdentities = new Set<string>();
    const seenPublicPids = new Set<string>();
    const familyCounts = {
        'pat-basic': 0,
        'pat-advanced': 0,
        self: 0,
        nowcoder: 0,
        hdu: 0,
        gplt: 0,
        cauc: 0,
        os: 0,
        legacy: 0,
        'invalid-pid': 0,
    } satisfies Record<PidNamespaceMigrationFamily, number>;
    const familyMaxSequence: Partial<Record<PidNamespaceMigrationFamily, number>> = {};
    const counterMax = new Map<string, { domainId: string; scope: string; value: number }>();
    const drifts: string[] = [];

    for (const [index, problem] of sortedDocuments(snapshot.problems).entries()) {
        const identity = validateProblemIdentity(problem, index);
        const identityKey = `${identity.domainId}/${identity.docId}`;
        if (seenIdentities.has(identityKey)) drifts.push(`duplicate-problem-identity:${identityKey}`);
        seenIdentities.add(identityKey);
        if (typeof problem.pid === 'string') {
            const pidKey = `${identity.domainId}/${problem.pid}`;
            if (seenPublicPids.has(pidKey)) drifts.push(`duplicate-public-pid:${pidKey}`);
            seenPublicPids.add(pidKey);
        }
        const classified = classifyProblem(problem);
        familyCounts[classified.family]++;
        if (classified.sequence !== undefined) {
            familyMaxSequence[classified.family] = Math.max(familyMaxSequence[classified.family] || 0, classified.sequence);
        }
        let decision: PidNamespaceMigrationDecision;
        let targetNamespaceId: string | undefined;
        let counterScope: string | undefined;
        if (classified.family === 'invalid-pid') decision = 'skip-invalid';
        else if (classified.family === 'legacy') decision = 'skip-legacy';
        else if (classified.family === 'os') {
            decision = problem.pid === PID_NAMESPACE_OS_OLD_PID ? 'rename-os' : 'assign';
            targetNamespaceId = namespaceId;
        } else {
            decision = 'assign';
            targetNamespaceId = classified.match!.namespaceId;
            counterScope = classified.match!.counterScope;
            const counterKey = `${identity.domainId}\0${counterScope}`;
            const current = counterMax.get(counterKey);
            if (!current || classified.match!.sequence > current.value) {
                counterMax.set(counterKey, {
                    domainId: identity.domainId,
                    scope: counterScope,
                    value: classified.match!.sequence,
                });
            }
        }
        const targetPid = decision === 'rename-os' ? PID_NAMESPACE_OS_NEW_PID : undefined;
        const targetSort =
            decision === 'rename-os' ? problemSort(PID_NAMESPACE_OS_NEW_PID, domainsById.get(identity.domainId)?.namespaces) : undefined;
        const entrySeed = {
            ...identity,
            pid: typeof problem.pid === 'string' ? problem.pid : null,
            family: classified.family,
            decision,
            ...(targetNamespaceId ? { namespaceId: targetNamespaceId } : {}),
            ...(counterScope ? { counterScope } : {}),
            ...(classified.sequence !== undefined ? { sequence: classified.sequence } : {}),
            ...(targetPid ? { targetPid } : {}),
            ...(targetSort ? { targetSort } : {}),
            structureRevisionPresent: own(problem, 'structureRevision'),
            structureRevision: own(problem, 'structureRevision') ? problem.structureRevision : null,
            pidNamespaceIdPresent: own(problem, 'pidNamespaceId'),
            pidNamespaceId: own(problem, 'pidNamespaceId') ? problem.pidNamespaceId : null,
        } satisfies Omit<PidNamespaceMigrationEntry, 'stateFingerprint' | 'nonTargetFingerprint'>;
        const entry: PidNamespaceMigrationEntry = {
            ...entrySeed,
            stateFingerprint: problemFingerprint(problem),
            nonTargetFingerprint: problemFingerprint(problem, problemNonTargetFields(entrySeed)),
        };
        if (entry.pidNamespaceIdPresent) drifts.push(`preexisting-pid-namespace:${identityKey}`);
        entries.push(entry);
    }

    drifts.push(...expectedFactsDrifts(entries.length, familyCounts, familyMaxSequence));
    const osEntries = entries.filter((entry) => entry.family === 'os');
    const expectedOsPids = new Set([
        ...Array.from({ length: 70 }, (_, index) => `OS${String(index + 1001).padStart(4, '0')}`),
        PID_NAMESPACE_OS_OLD_PID,
    ]);
    const actualOsPids = new Set(osEntries.map((entry) => entry.pid || ''));
    if (actualOsPids.size !== expectedOsPids.size || [...expectedOsPids].some((pid) => !actualOsPids.has(pid))) {
        drifts.push('os-pid-set-drift');
    }
    const oldOsEntry = osEntries.find((entry) => entry.pid === PID_NAMESPACE_OS_OLD_PID);
    if (!oldOsEntry || oldOsEntry.docId !== PID_NAMESPACE_OS_DOC_ID || oldOsEntry.domainId !== PID_NAMESPACE_MIGRATION_DOMAIN_ID) {
        drifts.push('os1999-identity-drift');
    }
    if (seenPublicPids.has(`${PID_NAMESPACE_MIGRATION_DOMAIN_ID}/${PID_NAMESPACE_OS_NEW_PID}`)) {
        drifts.push('os1071-is-not-free');
    }
    for (const problem of snapshot.problems.filter((candidate) => osMatch(candidate))) {
        if (problem.owner !== PID_NAMESPACE_OS_MANAGER_UID) drifts.push(`os-owner-drift:${problem.domainId}/${problem.docId}`);
    }

    const related = buildRelatedSummary(snapshot.related);
    for (const [name, facts] of Object.entries(related.references)) {
        if (facts.count) drifts.push(`os1999-reference:${name}:${facts.count}`);
    }
    if (related.records.count !== 12) drifts.push(`os1999-record-count:${related.records.count}!=12`);
    if (related.records.accepted !== 6) drifts.push(`os1999-accepted-count:${related.records.accepted}!=6`);

    const namespaceTargetCollision = snapshot.namespaceDocs.find(
        (doc) => doc.namespaceId === namespaceId || (doc.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID && doc.prefix === 'OS'),
    );
    if (namespaceTargetCollision) drifts.push('os-namespace-collision');

    const countersByKey = new Map<string, Record<string, any>>();
    for (const counter of snapshot.counters) {
        const key = `${String(counter.domainId)}\0${String(counter.namespace)}`;
        if (countersByKey.has(key)) drifts.push(`duplicate-counter:${key.replace('\0', '/')}`);
        countersByKey.set(key, counter);
        if (!Number.isSafeInteger(counter.value) || counter.value < 0) drifts.push(`invalid-counter:${key.replace('\0', '/')}`);
    }
    const counterTargets = [...counterMax.values()]
        .sort((left, right) => left.domainId.localeCompare(right.domainId) || left.scope.localeCompare(right.scope))
        .map((target): PidNamespaceMigrationCounterTarget => {
            const current = countersByKey.get(`${target.domainId}\0${target.scope}`);
            const currentValue = current && Number.isSafeInteger(current.value) ? Number(current.value) : null;
            return {
                domainId: target.domainId,
                scope: target.scope,
                currentPresent: !!current,
                currentValue,
                targetValue: Math.max(target.value, currentValue ?? 0),
            };
        });
    const targetCounterKeys = new Set(counterTargets.map((counter) => `${counter.domainId}\0${counter.scope}`));
    const untouchedCounters = snapshot.counters.filter(
        (counter) => !targetCounterKeys.has(`${String(counter.domainId)}\0${String(counter.namespace)}`),
    );
    const targetOsEntry = oldOsEntry || entries.find((entry) => entry.docId === PID_NAMESPACE_OS_DOC_ID);
    const target: PidNamespaceMigrationReport['target'] = {
        osNamespace: {
            namespaceId,
            name: '操作系统' as const,
            prefix: 'OS' as const,
            start: 1001 as const,
            counter: 1071 as const,
            enabled: true as const,
            members: [{ uid: PID_NAMESPACE_OS_MANAGER_UID, role: 'manager', editAll: false }],
        },
        osRename: {
            documentId: targetOsEntry?.documentId || '',
            domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
            docId: PID_NAMESPACE_OS_DOC_ID,
            oldPid: PID_NAMESPACE_OS_OLD_PID,
            newPid: PID_NAMESPACE_OS_NEW_PID,
            nextPid: PID_NAMESPACE_OS_NEXT_PID,
        },
        counters: counterTargets,
    };
    if (!OBJECT_ID.test(target.osRename.documentId)) drifts.push('os1999-document-id-missing');
    const skipped = entries.filter((entry) => entry.decision === 'skip-invalid' || entry.decision === 'skip-legacy');
    const problemNonTargetFingerprint = hash(
        entries.map((entry) => ({
            identity: `${entry.domainId}/${entry.docId}`,
            fingerprint: entry.nonTargetFingerprint,
        })),
    );
    const source = {
        databaseIdentity: snapshot.databaseIdentity,
        codeVersion: snapshot.codeVersion,
        registry: registrySnapshot(),
        problemCount: entries.length,
        familyCounts,
        familyMaxSequence,
        problemNonTargetFingerprint,
        skippedFingerprint: hash(skipped.map((entry) => ({ identity: `${entry.domainId}/${entry.docId}`, state: entry.stateFingerprint }))),
        domainFingerprint: rowsHash(snapshot.domains),
        namespaceDocsFingerprint: rowsHash(snapshot.namespaceDocs),
        untouchedCountersFingerprint: rowsHash(untouchedCounters),
        related,
        drifts: [...new Set(drifts)].sort(),
        executable: drifts.length === 0,
    };
    const reportBase = {
        schemaVersion: PID_NAMESPACE_MIGRATION_SCHEMA_VERSION,
        generatedAt: generatedAt.toISOString(),
        source,
        target,
        entries,
    } as const;
    const fingerprint = pidNamespaceMigrationFingerprint(reportBase);
    return {
        ...reportBase,
        fingerprint,
        confirmationToken: `APPLY:problem-pid-namespace:${fingerprint}`,
    };
}

export function assertPidNamespaceMigrationReport(value: unknown): asserts value is PidNamespaceMigrationReport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('migration report must be an object');
    const report = value as PidNamespaceMigrationReport;
    if (report.schemaVersion !== PID_NAMESPACE_MIGRATION_SCHEMA_VERSION) fail('migration report schemaVersion is unsupported');
    if (!SHA256.test(report.fingerprint || '') || pidNamespaceMigrationFingerprint(report) !== report.fingerprint) {
        fail('migration report fingerprint is invalid', 'PID_NAMESPACE_MIGRATION_REPORT_TAMPERED');
    }
    if (report.confirmationToken !== `APPLY:problem-pid-namespace:${report.fingerprint}`) {
        fail('migration confirmation token is invalid', 'PID_NAMESPACE_MIGRATION_REPORT_TAMPERED');
    }
    if (
        report.source.problemCount !== EXPECTED_PROBLEM_COUNT ||
        report.entries.length !== EXPECTED_PROBLEM_COUNT ||
        report.target.osRename.domainId !== PID_NAMESPACE_MIGRATION_DOMAIN_ID ||
        report.target.osRename.docId !== PID_NAMESPACE_OS_DOC_ID ||
        report.target.osRename.oldPid !== PID_NAMESPACE_OS_OLD_PID ||
        report.target.osRename.newPid !== PID_NAMESPACE_OS_NEW_PID ||
        report.target.osRename.nextPid !== PID_NAMESPACE_OS_NEXT_PID ||
        report.target.osNamespace.prefix !== 'OS' ||
        report.target.osNamespace.start !== 1001 ||
        report.target.osNamespace.counter !== 1071 ||
        report.target.osNamespace.members.length !== 1 ||
        report.target.osNamespace.members[0].uid !== PID_NAMESPACE_OS_MANAGER_UID ||
        report.target.osNamespace.members[0].role !== 'manager' ||
        report.target.osNamespace.members[0].editAll !== false
    ) {
        fail('migration target is malformed', 'PID_NAMESPACE_MIGRATION_REPORT_TAMPERED');
    }
    if (!/^custom:[a-f0-9]{24}$/.test(report.target.osNamespace.namespaceId)) {
        fail('OS namespace identity is malformed', 'PID_NAMESPACE_MIGRATION_REPORT_TAMPERED');
    }
}

export async function readPidNamespaceMigrationReport(filename: string): Promise<PidNamespaceMigrationReport> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new PidNamespaceMigrationError(`cannot read migration report: ${filename}`, 'PID_NAMESPACE_MIGRATION_REPORT_UNREADABLE', undefined, {
            cause: error,
        });
    }
    assertPidNamespaceMigrationReport(parsed);
    return parsed;
}

function entryIdentity(entry: Pick<PidNamespaceMigrationEntry, 'domainId' | 'docId'>): string {
    return `${entry.domainId}/${entry.docId}`;
}

function currentEntryState(problem: Record<string, any>, entry: PidNamespaceMigrationEntry): 'source' | 'target' | 'stale' {
    if (
        String(problem._id) !== entry.documentId ||
        problem.domainId !== entry.domainId ||
        problem.docId !== entry.docId ||
        problem.docType !== 10 ||
        problemFingerprint(problem, problemNonTargetFields(entry)) !== entry.nonTargetFingerprint
    ) {
        return 'stale';
    }
    const sourceNamespaceMatches =
        own(problem, 'pidNamespaceId') === entry.pidNamespaceIdPresent &&
        (!entry.pidNamespaceIdPresent || BSON.EJSON.stringify(problem.pidNamespaceId) === BSON.EJSON.stringify(entry.pidNamespaceId));
    const sourceRevisionMatches =
        own(problem, 'structureRevision') === entry.structureRevisionPresent &&
        (!entry.structureRevisionPresent || BSON.EJSON.stringify(problem.structureRevision) === BSON.EJSON.stringify(entry.structureRevision));
    if (sourceNamespaceMatches && sourceRevisionMatches && problemFingerprint(problem) === entry.stateFingerprint) {
        return 'source';
    }
    if (entry.decision === 'assign') {
        return problem.pid === entry.pid && problem.pidNamespaceId === entry.namespaceId ? 'target' : 'stale';
    }
    if (entry.decision === 'rename-os') {
        return problem.pid === entry.targetPid && problem.sort === entry.targetSort && problem.pidNamespaceId === entry.namespaceId
            ? 'target'
            : 'stale';
    }
    return 'stale';
}

function targetOsNamespaceMatches(
    namespace: Record<string, any>,
    target: PidNamespaceMigrationReport['target']['osNamespace'],
    actor: number,
): boolean {
    return (
        String(namespace._id) === target.namespaceId.slice('custom:'.length) &&
        namespace.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID &&
        namespace.namespaceId === target.namespaceId &&
        namespace.kind === 'custom' &&
        namespace.name === target.name &&
        namespace.prefix === target.prefix &&
        namespace.start === target.start &&
        namespace.counter === target.counter &&
        namespace.allocated === true &&
        namespace.enabled === target.enabled &&
        namespace.revision === 1 &&
        namespace.createdBy === actor &&
        same(namespace.members, target.members)
    );
}

function assertResumeSnapshotMatchesPlan(report: PidNamespaceMigrationReport, snapshot: PidNamespaceMigrationSnapshot, actor: number): void {
    const drifts: string[] = [];
    if (!same(snapshot.databaseIdentity, report.source.databaseIdentity)) drifts.push('database-identity');
    if (snapshot.codeVersion !== report.source.codeVersion) drifts.push('code-version');
    if (!same(registrySnapshot(), report.source.registry)) drifts.push('registry');
    if (snapshot.problems.length !== report.source.problemCount) drifts.push('problem-count');
    if (rowsHash(snapshot.domains) !== report.source.domainFingerprint) drifts.push('domains');

    const problemsByIdentity = new Map<string, Record<string, any>>();
    for (const problem of snapshot.problems) {
        const identity = `${String(problem.domainId)}/${String(problem.docId)}`;
        if (problemsByIdentity.has(identity)) drifts.push(`duplicate-problem:${identity}`);
        problemsByIdentity.set(identity, problem);
    }
    const nonTarget: Array<{ identity: string; fingerprint: string }> = [];
    for (const entry of report.entries) {
        const identity = entryIdentity(entry);
        const problem = problemsByIdentity.get(identity);
        if (!problem) {
            drifts.push(`missing-problem:${identity}`);
            continue;
        }
        nonTarget.push({
            identity,
            fingerprint: problemFingerprint(problem, problemNonTargetFields(entry)),
        });
        const state = currentEntryState(problem, entry);
        if (entry.decision === 'skip-invalid' || entry.decision === 'skip-legacy') {
            if (state !== 'source') drifts.push(`skipped-problem:${identity}`);
        } else if (state !== 'source' && state !== 'target') {
            drifts.push(`target-problem:${identity}`);
        }
    }
    if (problemsByIdentity.size !== report.entries.length) drifts.push('problem-identities');
    if (hash(nonTarget) !== report.source.problemNonTargetFingerprint) drifts.push('problem-non-target-fingerprint');

    const targetNamespaceDocs = snapshot.namespaceDocs.filter((namespace) => namespace.namespaceId === report.target.osNamespace.namespaceId);
    if (targetNamespaceDocs.length > 1) {
        drifts.push('os-namespace-duplicate');
    } else if (targetNamespaceDocs.length === 1 && !targetOsNamespaceMatches(targetNamespaceDocs[0], report.target.osNamespace, actor)) {
        drifts.push('os-namespace-target');
    }
    if (
        rowsHash(snapshot.namespaceDocs.filter((namespace) => namespace.namespaceId !== report.target.osNamespace.namespaceId)) !==
        report.source.namespaceDocsFingerprint
    ) {
        drifts.push('namespace-non-target-fingerprint');
    }

    const counterTargets = new Map(report.target.counters.map((counter) => [`${counter.domainId}\0${counter.scope}`, counter] as const));
    for (const [key, target] of counterTargets) {
        const current = snapshot.counters.filter((counter) => `${String(counter.domainId)}\0${String(counter.namespace)}` === key);
        if (current.length > 1) {
            drifts.push(`counter-duplicate:${key.replace('\0', '/')}`);
            continue;
        }
        if (!current.length) {
            if (target.currentPresent) drifts.push(`counter-missing:${key.replace('\0', '/')}`);
            continue;
        }
        if (current[0].value !== target.currentValue && current[0].value !== target.targetValue) {
            drifts.push(`counter-value:${key.replace('\0', '/')}`);
        }
    }
    if (
        rowsHash(snapshot.counters.filter((counter) => !counterTargets.has(`${String(counter.domainId)}\0${String(counter.namespace)}`))) !==
        report.source.untouchedCountersFingerprint
    ) {
        drifts.push('untouched-counters');
    }
    if (buildRelatedSummary(snapshot.related).fingerprint !== report.source.related.fingerprint) drifts.push('related-fingerprint');
    if (drifts.length) {
        fail(
            'production changed after plan or outside this migration; generate a new report',
            'PID_NAMESPACE_MIGRATION_FINGERPRINT_DRIFT',
            [...new Set(drifts)].sort(),
        );
    }
}

async function persistMigrationReport(
    report: PidNamespaceMigrationReport,
    persistReport: ((report: PidNamespaceMigrationReport) => Promise<void>) | undefined,
): Promise<void> {
    if (persistReport) await persistReport(report);
}

export async function applyPidNamespaceMigration(input: {
    report: PidNamespaceMigrationReport;
    repository: PidNamespaceMigrationRepository;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    now?: Date;
    persistReport?: (report: PidNamespaceMigrationReport) => Promise<void>;
}): Promise<void> {
    assertPidNamespaceMigrationReport(input.report);
    if (!input.report.source.executable || input.report.source.drifts.length) {
        fail('migration plan is not executable', 'PID_NAMESPACE_MIGRATION_PLAN_DRIFT', input.report.source.drifts);
    }
    if (!Number.isSafeInteger(input.actor) || input.actor < 1) {
        fail('actor must be a positive integer', 'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (input.fingerprint !== input.report.fingerprint || input.confirmationToken !== input.report.confirmationToken) {
        fail('fingerprint or confirmation token does not match the report', 'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (!(await input.repository.isSystemAdministrator(input.actor))) {
        fail('actor is not a system administrator', 'PID_NAMESPACE_MIGRATION_PERMISSION_DENIED');
    }
    const now = input.now || new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('apply timestamp is invalid');
    const report = input.report;
    const firstRun = !report.execution;
    const liveSnapshot = await input.repository.loadSnapshot();
    if (firstRun) {
        const osObjectId = report.target.osNamespace.namespaceId.slice('custom:'.length);
        const live = buildPidNamespaceMigrationPlan(liveSnapshot, osObjectId, new Date(report.generatedAt));
        if (live.fingerprint !== report.fingerprint) {
            fail('production changed after plan; generate a new report', 'PID_NAMESPACE_MIGRATION_FINGERPRINT_DRIFT', {
                expected: report.fingerprint,
                actual: live.fingerprint,
                drifts: live.source.drifts,
            });
        }
        report.execution = {
            actor: input.actor,
            startedAt: now.toISOString(),
            updatedAt: now.toISOString(),
            state: 'applying',
            results: [],
            counterResults: [],
        };
        await persistMigrationReport(report, input.persistReport);
    } else {
        if (report.execution!.actor !== input.actor) {
            fail('migration resume actor differs from the original actor', 'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED');
        }
        assertResumeSnapshotMatchesPlan(report, liveSnapshot, input.actor);
        if (report.execution!.state === 'applied') return;
        report.execution!.state = 'applying';
        report.execution!.updatedAt = now.toISOString();
        delete report.execution!.lastError;
        await persistMigrationReport(report, input.persistReport);
    }
    const execution = report.execution!;

    try {
        const namespaceStatus = await input.repository.ensureOsNamespace(report.target.osNamespace, input.actor, now);
        let namespaceAudit = await input.repository.findNamespaceAudit(report.fingerprint);
        if (!namespaceAudit) {
            await input.repository.insertAudit({
                type: 'problem.pid-namespace.migration.namespace',
                operator: input.actor,
                domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                namespaceId: report.target.osNamespace.namespaceId,
                fingerprint: report.fingerprint,
                operation: 'create-os-namespace',
                after: report.target.osNamespace,
                recovery: namespaceStatus === 'no-op',
                result: 'success',
                time: new Date(),
            });
            namespaceAudit = await input.repository.findNamespaceAudit(report.fingerprint);
            if (!namespaceAudit) fail('OS namespace audit was not persisted', 'PID_NAMESPACE_MIGRATION_AUDIT_FAILED');
        }
        execution.osNamespaceStatus = namespaceStatus;
        execution.updatedAt = new Date().toISOString();
        await persistMigrationReport(report, input.persistReport);

        const resultByIdentity = new Map<string, (typeof execution.results)[number]>(
            execution.results.map((result) => [`${result.domainId}/${result.docId}`, result]),
        );
        for (const entry of report.entries) {
            if (entry.decision === 'skip-invalid' || entry.decision === 'skip-legacy') continue;
            const problem = await input.repository.loadProblem(entry.domainId, entry.docId);
            if (!problem) fail(`Problem ${entryIdentity(entry)} disappeared`, 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT');
            const state = currentEntryState(problem, entry);
            if (state === 'stale') {
                const result = {
                    domainId: entry.domainId,
                    docId: entry.docId,
                    pid: entry.pid,
                    status: 'stale' as const,
                    at: new Date().toISOString(),
                    reason: 'problem-state-drift',
                };
                execution.results = execution.results.filter((candidate) => entryIdentity(candidate) !== entryIdentity(entry));
                execution.results.push(result);
                execution.updatedAt = result.at;
                await persistMigrationReport(report, input.persistReport);
                fail(`Problem ${entryIdentity(entry)} changed after plan`, 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT');
            }
            let status: 'applied' | 'no-op' = 'no-op';
            if (state === 'source') {
                const write = await input.repository.casProblem(entry);
                if (write.matchedCount !== 1 || write.modifiedCount !== 1) {
                    fail(`Problem ${entryIdentity(entry)} CAS failed`, 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT', write);
                }
                status = 'applied';
            }
            const after = await input.repository.loadProblem(entry.domainId, entry.docId);
            if (!after || currentEntryState(after, entry) !== 'target') {
                fail(`Problem ${entryIdentity(entry)} did not reach its exact target state`, 'PID_NAMESPACE_MIGRATION_WRITE_INVALID');
            }
            let audit = await input.repository.findEntryAudit(report.fingerprint, entry.domainId, entry.docId);
            if (!audit) {
                await input.repository.insertAudit({
                    type: 'problem.pid-namespace.migration.entry',
                    operator: input.actor,
                    domainId: entry.domainId,
                    problemId: entry.docId,
                    fingerprint: report.fingerprint,
                    operation: entry.decision === 'rename-os' ? 'rename-and-assign' : 'assign',
                    before: {
                        pid: entry.pid,
                        pidNamespaceId: entry.pidNamespaceIdPresent ? entry.pidNamespaceId : null,
                        structureRevision: entry.structureRevisionPresent ? entry.structureRevision : null,
                    },
                    after: {
                        pid: entry.targetPid || entry.pid,
                        pidNamespaceId: entry.namespaceId,
                        structureRevision: entry.structureRevisionPresent ? entry.structureRevision : null,
                    },
                    recovery: state === 'target',
                    result: 'success',
                    time: new Date(),
                });
                audit = await input.repository.findEntryAudit(report.fingerprint, entry.domainId, entry.docId);
                if (!audit) fail(`Problem ${entryIdentity(entry)} audit was not persisted`, 'PID_NAMESPACE_MIGRATION_AUDIT_FAILED');
            }
            const result = {
                domainId: entry.domainId,
                docId: entry.docId,
                pid: entry.pid,
                status,
                at: new Date().toISOString(),
                reason: status === 'applied' ? 'namespace-written' : 'exact-target-already-present',
            };
            resultByIdentity.set(entryIdentity(entry), result);
            execution.results = [...resultByIdentity.values()].sort(
                (left, right) => left.domainId.localeCompare(right.domainId) || left.docId - right.docId,
            );
            execution.updatedAt = result.at;
            await persistMigrationReport(report, input.persistReport);
        }

        const counterByKey = new Map(execution.counterResults.map((result) => [`${result.domainId}\0${result.scope}`, result] as const));
        for (const counter of report.target.counters) {
            const status = await input.repository.ensureCounter(counter, new Date());
            let audit = await input.repository.findCounterAudit(report.fingerprint, counter.domainId, counter.scope);
            if (!audit) {
                await input.repository.insertAudit({
                    type: 'problem.pid-namespace.migration.counter',
                    operator: input.actor,
                    domainId: counter.domainId,
                    counterScope: counter.scope,
                    fingerprint: report.fingerprint,
                    operation: 'initialize-counter',
                    before: {
                        present: counter.currentPresent,
                        value: counter.currentValue,
                    },
                    after: { value: counter.targetValue },
                    recovery: status === 'no-op',
                    result: 'success',
                    time: new Date(),
                });
                audit = await input.repository.findCounterAudit(report.fingerprint, counter.domainId, counter.scope);
                if (!audit) {
                    fail(`Counter ${counter.domainId}/${counter.scope} audit was not persisted`, 'PID_NAMESPACE_MIGRATION_AUDIT_FAILED');
                }
            }
            const result = { domainId: counter.domainId, scope: counter.scope, status, at: new Date().toISOString() };
            counterByKey.set(`${counter.domainId}\0${counter.scope}`, result);
            execution.counterResults = [...counterByKey.values()].sort(
                (left, right) => left.domainId.localeCompare(right.domainId) || left.scope.localeCompare(right.scope),
            );
            execution.updatedAt = result.at;
            await persistMigrationReport(report, input.persistReport);
        }

        let audit = await input.repository.findSuccessfulAudit(report.fingerprint);
        if (!audit) {
            await input.repository.insertAudit({
                type: 'problem.pid-namespace.migration',
                operator: input.actor,
                fingerprint: report.fingerprint,
                counts: {
                    assigned: report.entries.filter((entry) => entry.decision === 'assign').length,
                    renamed: report.entries.filter((entry) => entry.decision === 'rename-os').length,
                    skippedLegacy: report.source.familyCounts.legacy,
                    skippedInvalid: report.source.familyCounts['invalid-pid'],
                    counters: report.target.counters.length,
                },
                result: 'success',
                time: new Date(),
            });
            audit = await input.repository.findSuccessfulAudit(report.fingerprint);
            if (!audit) fail('Migration audit was not persisted', 'PID_NAMESPACE_MIGRATION_AUDIT_FAILED');
        }
        execution.auditId = String(audit._id);
        execution.state = 'applied';
        execution.completedAt = new Date().toISOString();
        execution.updatedAt = execution.completedAt;
        await persistMigrationReport(report, input.persistReport);
    } catch (error) {
        execution.state = 'failed';
        execution.updatedAt = new Date().toISOString();
        execution.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        try {
            await persistMigrationReport(report, input.persistReport);
        } catch (persistError) {
            throw new AggregateError([error, persistError], 'PID namespace migration failed and its execution report could not be persisted');
        }
        throw error;
    }
}

function same(value: unknown, expected: unknown): boolean {
    return canonicalJson(serialized(value)) === canonicalJson(serialized(expected));
}

export async function verifyPidNamespaceMigration(
    report: PidNamespaceMigrationReport,
    repository: PidNamespaceMigrationRepository,
    now = new Date(),
): Promise<void> {
    assertPidNamespaceMigrationReport(report);
    if (report.execution?.state !== 'applied') {
        fail('migration has not completed apply', 'PID_NAMESPACE_MIGRATION_VERIFY_FAILED');
    }
    const snapshot = await repository.loadSnapshot();
    const checks: NonNullable<PidNamespaceMigrationReport['verification']>['checks'] = [];
    const check = (name: string, ok: boolean, detail?: string) => checks.push({ check: name, ok, ...(detail ? { detail } : {}) });
    check('database-identity', same(snapshot.databaseIdentity, report.source.databaseIdentity));
    check('code-version', snapshot.codeVersion === report.source.codeVersion);
    check('problem-count', snapshot.problems.length === report.source.problemCount, String(snapshot.problems.length));
    check('domain-fingerprint', rowsHash(snapshot.domains) === report.source.domainFingerprint);

    const problemsByIdentity = new Map<string, Record<string, any>>(
        snapshot.problems.map((problem) => [`${problem.domainId}/${problem.docId}`, problem]),
    );
    const currentNonTarget: Array<{ identity: string; fingerprint: string }> = [];
    let skippedStateMatches = true;
    let targetStateMatches = true;
    for (const entry of report.entries) {
        const current = problemsByIdentity.get(entryIdentity(entry));
        if (!current) {
            targetStateMatches = false;
            continue;
        }
        currentNonTarget.push({
            identity: entryIdentity(entry),
            fingerprint: problemFingerprint(current, problemNonTargetFields(entry)),
        });
        if (entry.decision === 'skip-invalid' || entry.decision === 'skip-legacy') {
            if (problemFingerprint(current) !== entry.stateFingerprint) skippedStateMatches = false;
        } else if (currentEntryState(current, entry) !== 'target') {
            targetStateMatches = false;
        }
    }
    check('target-problems', targetStateMatches);
    check('skipped-problems-unchanged', skippedStateMatches);
    check('problem-non-target-fingerprint', hash(currentNonTarget) === report.source.problemNonTargetFingerprint);

    const osNamespace = snapshot.namespaceDocs.find(
        (doc) =>
            doc.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID && doc.namespaceId === report.target.osNamespace.namespaceId && doc.prefix === 'OS',
    );
    const osNamespaceOk = !!osNamespace && targetOsNamespaceMatches(osNamespace, report.target.osNamespace, report.execution.actor);
    check('os-namespace', osNamespaceOk);
    check(
        'namespace-non-target-fingerprint',
        rowsHash(snapshot.namespaceDocs.filter((doc) => doc.namespaceId !== report.target.osNamespace.namespaceId)) ===
            report.source.namespaceDocsFingerprint,
    );

    const counterTargetKeys = new Set(report.target.counters.map((target) => `${target.domainId}\0${target.scope}`));
    let countersOk = true;
    for (const target of report.target.counters) {
        const matches = snapshot.counters.filter(
            (counter) => counter.domainId === target.domainId && counter.namespace === target.scope && counter.value === target.targetValue,
        );
        if (matches.length !== 1) countersOk = false;
    }
    check('counters', countersOk);
    check(
        'untouched-counters',
        rowsHash(snapshot.counters.filter((counter) => !counterTargetKeys.has(`${String(counter.domainId)}\0${String(counter.namespace)}`))) ===
            report.source.untouchedCountersFingerprint,
    );

    const related = buildRelatedSummary(snapshot.related);
    check('records-status-storage-references', related.fingerprint === report.source.related.fingerprint);
    const oldPidExists = snapshot.problems.some(
        (problem) => problem.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID && problem.pid === PID_NAMESPACE_OS_OLD_PID,
    );
    const nextPidExists = snapshot.problems.some(
        (problem) => problem.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID && problem.pid === PID_NAMESPACE_OS_NEXT_PID,
    );
    const os1071 = snapshot.problems.find(
        (problem) => problem.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID && problem.pid === PID_NAMESPACE_OS_NEW_PID,
    );
    check('os1999-removed', !oldPidExists);
    check('os1071-identity', !!os1071 && os1071.docId === PID_NAMESPACE_OS_DOC_ID && String(os1071._id) === report.target.osRename.documentId);
    check('os1072-next-free', !nextPidExists && osNamespace?.counter === 1071);

    const audits = await repository.loadSuccessfulAudits(report.fingerprint);
    const targetedEntries = report.entries.filter((entry) => entry.decision === 'assign' || entry.decision === 'rename-os');
    const expectedEntryKeys = new Set(targetedEntries.map((entry) => entryIdentity(entry)));
    const entryAudits = audits.filter((audit) => audit.type === 'problem.pid-namespace.migration.entry');
    const entryAuditKeys = entryAudits.map((audit) => `${String(audit.domainId)}/${String(audit.problemId)}`);
    const namespaceAudits = audits.filter((audit) => audit.type === 'problem.pid-namespace.migration.namespace');
    const counterAudits = audits.filter((audit) => audit.type === 'problem.pid-namespace.migration.counter');
    const expectedCounterKeys = new Set(report.target.counters.map((counter) => `${counter.domainId}\0${counter.scope}`));
    const counterAuditKeys = counterAudits.map((audit) => `${String(audit.domainId)}\0${String(audit.counterScope)}`);
    const globalAudits = audits.filter((audit) => audit.type === 'problem.pid-namespace.migration');
    const auditsOk =
        entryAudits.length === expectedEntryKeys.size &&
        new Set(entryAuditKeys).size === expectedEntryKeys.size &&
        entryAuditKeys.every((key) => expectedEntryKeys.has(key)) &&
        namespaceAudits.length === 1 &&
        namespaceAudits[0].namespaceId === report.target.osNamespace.namespaceId &&
        counterAudits.length === expectedCounterKeys.size &&
        new Set(counterAuditKeys).size === expectedCounterKeys.size &&
        counterAuditKeys.every((key) => expectedCounterKeys.has(key)) &&
        globalAudits.length === 1 &&
        audits.every((audit) => audit.operator === report.execution!.actor);
    check('migration-audits', auditsOk);
    const audit = globalAudits[0] || null;
    const ok = checks.every((item) => item.ok);
    report.verification = {
        verifiedAt: now.toISOString(),
        ok,
        checks,
        ...(audit?._id ? { auditId: String(audit._id) } : {}),
    };
    if (!ok) {
        fail(
            'PID namespace migration verification failed',
            'PID_NAMESPACE_MIGRATION_VERIFY_FAILED',
            checks.filter((item) => !item.ok),
        );
    }
}

export function pidNamespaceMigrationSummary(report: PidNamespaceMigrationReport) {
    return {
        executable: report.source.executable,
        drifts: report.source.drifts,
        fingerprint: report.fingerprint,
        problemCount: report.source.problemCount,
        familyCounts: report.source.familyCounts,
        assigned: report.entries.filter((entry) => entry.decision === 'assign').length,
        renamed: report.entries.filter((entry) => entry.decision === 'rename-os').length,
        counters: report.target.counters.length,
        executionState: report.execution?.state || null,
        verificationOk: report.verification?.ok ?? null,
    };
}
