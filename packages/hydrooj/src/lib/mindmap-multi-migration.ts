import fs from 'node:fs/promises';
import { BSON, ObjectId } from 'mongodb';
import { canonicalJson, sha256 } from './problem-batch-import';

export const MINDMAP_MULTI_MIGRATION_SCHEMA_VERSION = 1;
export const MINDMAP_MULTI_MIGRATION_NODE_COUNT = 274;
export const MINDMAP_MULTI_MIGRATION_TITLE = '算法知识图谱';

const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export class MindmapMultiMigrationError extends Error {
    constructor(
        message: string,
        public readonly code = 'MINDMAP_MULTI_MIGRATION_FAILED',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'MindmapMultiMigrationError';
    }
}

export interface MindmapMultiMigrationSnapshot {
    configs: Array<Record<string, any>>;
    maps: Array<Record<string, any>>;
    nodes: Array<Record<string, any>>;
    problems: Array<Record<string, any>>;
    courses: Array<Record<string, any>>;
}

export interface MindmapMultiMigrationSourceFacts {
    config: {
        id: 'global';
        title: string;
        rootNodeId: string;
        layoutDirection: 'RIGHT' | 'DOWN';
        updatedAt: string;
    };
    configHash: string;
    nodeCount: number;
    nodeHash: string;
    problemCount: number;
    problemNonTargetHash: string;
    problemKnowledgeNodeReferenceCount: number;
    managedKnowledgeNodeReferenceCount: number;
    courseCount: number;
    courseHash: string;
}

export interface MindmapMultiMigrationReport {
    schemaVersion: 1;
    generatedAt: string;
    source: MindmapMultiMigrationSourceFacts;
    target: {
        mapId: string;
        title: typeof MINDMAP_MULTI_MIGRATION_TITLE;
        rootNodeId: string;
        visibility: 'public';
        layoutDirection: 'RIGHT' | 'DOWN';
        createdAt: string;
        updatedAt: string;
    };
    fingerprint: string;
    confirmationToken: string;
    execution?: {
        actor: number;
        startedAt: string;
        completedAt?: string;
        state: 'applying' | 'applied' | 'failed';
        error?: string;
    };
    verification?: {
        verifiedAt: string;
        ok: true;
        auditId: string;
    };
}

export interface MindmapMultiMigrationWriteResult {
    matchedCount: number;
    modifiedCount: number;
}

export interface MindmapMultiMigrationRepository {
    loadSnapshot(): Promise<MindmapMultiMigrationSnapshot>;
    isSystemAdministrator(uid: number): Promise<boolean>;
    insertMap(map: Record<string, any>): Promise<void>;
    setNodeMapId(mapId: ObjectId): Promise<MindmapMultiMigrationWriteResult>;
    setProblemMapId(mapId: ObjectId): Promise<MindmapMultiMigrationWriteResult>;
    deleteGlobalConfig(config: MindmapMultiMigrationSourceFacts['config']): Promise<number>;
    insertAudit(audit: Record<string, any>): Promise<string>;
    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null>;
    close?(): Promise<void>;
}

function fail(message: string, code = 'MINDMAP_MULTI_MIGRATION_INVALID', details?: unknown): never {
    throw new MindmapMultiMigrationError(message, code, details);
}

function objectId(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) fail(`${field} must be a BSON ObjectId`);
    return value;
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

function sortedDocuments(rows: Array<Record<string, any>>): Array<Record<string, any>> {
    return [...rows].sort((left, right) => {
        const leftKey = `${String(left.domainId || '')}/${String(left.docId ?? '')}/${String(left._id || '')}`;
        const rightKey = `${String(right.domainId || '')}/${String(right.docId ?? '')}/${String(right._id || '')}`;
        return leftKey.localeCompare(rightKey);
    });
}

function withoutField(row: Record<string, any>, field: string): Record<string, any> {
    const clone = { ...row };
    delete clone[field];
    return clone;
}

function validateNodeReferences(value: unknown, field: string, nodeIds: Set<string>): number {
    if (value === undefined) return 0;
    if (!Array.isArray(value)) fail(`${field} must be an ObjectId array`);
    for (const [index, id] of value.entries()) {
        const normalized = objectId(id, `${field}.${index}`).toHexString();
        if (!nodeIds.has(normalized)) fail(`${field}.${index} references a missing mindmap node`, 'MINDMAP_MULTI_MIGRATION_REFERENCE_INVALID');
    }
    return value.length;
}

function validateTree(nodes: Array<Record<string, any>>, rootNodeId: ObjectId, requireMapId?: ObjectId): void {
    const byId = new Map<string, Record<string, any>>();
    for (const [index, node] of nodes.entries()) {
        const id = objectId(node._id, `nodes.${index}._id`).toHexString();
        if (byId.has(id)) fail(`duplicate mindmap node ${id}`);
        if (requireMapId) {
            if (!(node.mapId instanceof ObjectId) || !node.mapId.equals(requireMapId)) {
                fail(`mindmap node ${id} does not belong to the target map`, 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
            }
        } else if (own(node, 'mapId')) {
            fail(`legacy mindmap node ${id} already has mapId`, 'MINDMAP_MULTI_MIGRATION_PARTIAL_STATE');
        }
        byId.set(id, node);
    }
    const roots = nodes.filter((node) => node.parentId === null);
    if (roots.length !== 1 || !objectId(roots[0]._id, 'root._id').equals(rootNodeId)) {
        fail('mindmap must contain exactly the configured root', 'MINDMAP_MULTI_MIGRATION_TREE_INVALID');
    }
    for (const node of nodes) {
        const start = objectId(node._id, 'node._id').toHexString();
        const visited = new Set<string>();
        let current: Record<string, any> = node;
        while (current.parentId !== null) {
            const currentId = objectId(current._id, 'node._id').toHexString();
            if (visited.has(currentId)) fail(`mindmap cycle detected at ${start}`, 'MINDMAP_MULTI_MIGRATION_TREE_INVALID');
            visited.add(currentId);
            const parentId = objectId(current.parentId, `${currentId}.parentId`).toHexString();
            const parent = byId.get(parentId);
            if (!parent) fail(`mindmap ancestor ${parentId} is missing`, 'MINDMAP_MULTI_MIGRATION_TREE_INVALID');
            current = parent;
        }
        if (!objectId(current._id, 'root._id').equals(rootNodeId)) {
            fail(`mindmap node ${start} is disconnected from the configured root`, 'MINDMAP_MULTI_MIGRATION_TREE_INVALID');
        }
    }
}

function sourceFacts(snapshot: MindmapMultiMigrationSnapshot): MindmapMultiMigrationSourceFacts {
    if (snapshot.configs.length !== 1 || snapshot.configs[0]._id !== 'global') {
        fail('expected exactly one legacy global mindmap config', 'MINDMAP_MULTI_MIGRATION_LEGACY_STATE_INVALID');
    }
    if (snapshot.maps.length !== 0) fail('mindmap.maps must be empty before migration', 'MINDMAP_MULTI_MIGRATION_PARTIAL_STATE');
    if (snapshot.nodes.length !== MINDMAP_MULTI_MIGRATION_NODE_COUNT) {
        fail(`expected exactly ${MINDMAP_MULTI_MIGRATION_NODE_COUNT} legacy mindmap nodes`, 'MINDMAP_MULTI_MIGRATION_NODE_COUNT_DRIFT', {
            actual: snapshot.nodes.length,
        });
    }
    const config = snapshot.configs[0];
    const rootNodeId = objectId(config.rootNodeId, 'mindmap.config.rootNodeId');
    if (typeof config.title !== 'string' || !config.title.trim()) fail('legacy mindmap title is malformed');
    if (!['RIGHT', 'DOWN'].includes(config.layoutDirection)) fail('legacy mindmap layoutDirection is malformed');
    if (!(config.updatedAt instanceof Date) || Number.isNaN(config.updatedAt.getTime())) fail('legacy mindmap updatedAt is malformed');
    validateTree(snapshot.nodes, rootNodeId);
    const nodeIds = new Set(snapshot.nodes.map((node) => objectId(node._id, 'node._id').toHexString()));
    let problemKnowledgeNodeReferenceCount = 0;
    let managedKnowledgeNodeReferenceCount = 0;
    for (const [index, problem] of snapshot.problems.entries()) {
        if (problem.docType !== 10) fail(`problems.${index}.docType is not Problem`);
        if (own(problem, 'knowledgeMapId')) {
            fail(`Problem ${problem.domainId}/${problem.docId} already has knowledgeMapId`, 'MINDMAP_MULTI_MIGRATION_PARTIAL_STATE');
        }
        problemKnowledgeNodeReferenceCount += validateNodeReferences(
            own(problem, 'knowledgeNodeIds') ? problem.knowledgeNodeIds : undefined,
            `Problem ${problem.domainId}/${problem.docId}.knowledgeNodeIds`,
            nodeIds,
        );
        const managedNodeIds =
            problem.managedAuthoring && own(problem.managedAuthoring, 'selectedMindmapNodeIds')
                ? problem.managedAuthoring.selectedMindmapNodeIds
                : undefined;
        managedKnowledgeNodeReferenceCount += validateNodeReferences(
            managedNodeIds,
            `Problem ${problem.domainId}/${problem.docId}.managedAuthoring.selectedMindmapNodeIds`,
            nodeIds,
        );
    }
    for (const course of snapshot.courses) {
        if (course.docType !== 40 || course.kind !== 'course') fail('course query returned a non-course document');
        if (own(course, 'knowledgeMapId')) {
            fail(`Course ${course.domainId}/${course.docId} is already bound to a map`, 'MINDMAP_MULTI_MIGRATION_PARTIAL_STATE');
        }
    }
    const canonicalConfig = {
        id: 'global' as const,
        title: config.title.trim(),
        rootNodeId: rootNodeId.toHexString(),
        layoutDirection: config.layoutDirection as 'RIGHT' | 'DOWN',
        updatedAt: config.updatedAt.toISOString(),
    };
    return {
        config: canonicalConfig,
        configHash: hash(config),
        nodeCount: snapshot.nodes.length,
        nodeHash: hash(sortedDocuments(snapshot.nodes.map((node) => withoutField(node, 'mapId')))),
        problemCount: snapshot.problems.length,
        problemNonTargetHash: hash(sortedDocuments(snapshot.problems.map((problem) => withoutField(problem, 'knowledgeMapId')))),
        problemKnowledgeNodeReferenceCount,
        managedKnowledgeNodeReferenceCount,
        courseCount: snapshot.courses.length,
        courseHash: hash(sortedDocuments(snapshot.courses)),
    };
}

function reportFingerprintPayload(report: Pick<MindmapMultiMigrationReport, 'schemaVersion' | 'source' | 'target'>) {
    return { schemaVersion: report.schemaVersion, source: report.source, target: report.target };
}

export function mindmapMultiMigrationFingerprint(report: Pick<MindmapMultiMigrationReport, 'schemaVersion' | 'source' | 'target'>): string {
    return hash(reportFingerprintPayload(report));
}

export function buildMindmapMultiMigrationPlan(
    snapshot: MindmapMultiMigrationSnapshot,
    targetMapId = new ObjectId(),
    generatedAt = new Date(),
): MindmapMultiMigrationReport {
    if (!(targetMapId instanceof ObjectId)) fail('target map ID must be a BSON ObjectId');
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) fail('plan timestamp is invalid');
    const source = sourceFacts(snapshot);
    const timestamp = generatedAt.toISOString();
    const report = {
        schemaVersion: MINDMAP_MULTI_MIGRATION_SCHEMA_VERSION,
        generatedAt: timestamp,
        source,
        target: {
            mapId: targetMapId.toHexString(),
            title: MINDMAP_MULTI_MIGRATION_TITLE,
            rootNodeId: source.config.rootNodeId,
            visibility: 'public' as const,
            layoutDirection: source.config.layoutDirection,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
    } as const;
    const fingerprint = mindmapMultiMigrationFingerprint(report);
    return {
        ...report,
        fingerprint,
        confirmationToken: `APPLY:mindmap-migrate-multi:${fingerprint}`,
    };
}

export function assertMindmapMultiMigrationReport(value: unknown): asserts value is MindmapMultiMigrationReport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('migration report must be an object');
    const report = value as MindmapMultiMigrationReport;
    if (report.schemaVersion !== MINDMAP_MULTI_MIGRATION_SCHEMA_VERSION) fail('migration report schemaVersion is unsupported');
    if (!OBJECT_ID.test(report.target?.mapId || '') || !OBJECT_ID.test(report.target?.rootNodeId || '')) {
        fail('migration target identity is malformed');
    }
    if (report.target.title !== MINDMAP_MULTI_MIGRATION_TITLE || report.target.visibility !== 'public') fail('migration target is malformed');
    if (!SHA256.test(report.fingerprint || '') || mindmapMultiMigrationFingerprint(report) !== report.fingerprint) {
        fail('migration report fingerprint is invalid', 'MINDMAP_MULTI_MIGRATION_REPORT_TAMPERED');
    }
    if (report.confirmationToken !== `APPLY:mindmap-migrate-multi:${report.fingerprint}`) {
        fail('migration report confirmation token is invalid', 'MINDMAP_MULTI_MIGRATION_REPORT_TAMPERED');
    }
    if (
        report.source.nodeCount !== MINDMAP_MULTI_MIGRATION_NODE_COUNT ||
        !SHA256.test(report.source.configHash || '') ||
        !SHA256.test(report.source.nodeHash || '') ||
        !SHA256.test(report.source.problemNonTargetHash || '') ||
        !SHA256.test(report.source.courseHash || '')
    ) {
        fail('migration source facts are malformed', 'MINDMAP_MULTI_MIGRATION_REPORT_TAMPERED');
    }
}

export async function readMindmapMultiMigrationReport(filename: string): Promise<MindmapMultiMigrationReport> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new MindmapMultiMigrationError(`cannot read migration report: ${filename}`, 'MINDMAP_MULTI_MIGRATION_REPORT_UNREADABLE', undefined, {
            cause: error,
        });
    }
    assertMindmapMultiMigrationReport(parsed);
    return parsed;
}

function assertExactSource(report: MindmapMultiMigrationReport, snapshot: MindmapMultiMigrationSnapshot): void {
    const live = buildMindmapMultiMigrationPlan(snapshot, new ObjectId(report.target.mapId), new Date(report.target.createdAt));
    if (live.fingerprint !== report.fingerprint) {
        fail('production data changed after plan; generate a new report', 'MINDMAP_MULTI_MIGRATION_FINGERPRINT_DRIFT', {
            expected: report.fingerprint,
            actual: live.fingerprint,
        });
    }
}

async function recordFailedAudit(
    repository: MindmapMultiMigrationRepository,
    report: MindmapMultiMigrationReport,
    actor: number,
    error: unknown,
): Promise<void> {
    await repository.insertAudit({
        type: 'mindmap.multi.migration',
        operator: actor,
        fingerprint: report.fingerprint,
        counts: { nodes: report.source.nodeCount, problems: report.source.problemCount, courses: report.source.courseCount },
        result: 'failed',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        time: new Date(),
    });
}

export async function applyMindmapMultiMigration(input: {
    report: MindmapMultiMigrationReport;
    repository: MindmapMultiMigrationRepository;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    now?: Date;
    persistReport?: (report: MindmapMultiMigrationReport) => Promise<void>;
}): Promise<void> {
    assertMindmapMultiMigrationReport(input.report);
    if (!Number.isSafeInteger(input.actor) || input.actor < 1) {
        fail('actor must be a positive integer', 'MINDMAP_MULTI_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (input.fingerprint !== input.report.fingerprint || input.confirmationToken !== input.report.confirmationToken) {
        fail('fingerprint or confirmation token does not match the report', 'MINDMAP_MULTI_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (!(await input.repository.isSystemAdministrator(input.actor))) {
        fail(`UID ${input.actor} is not a system administrator`, 'MINDMAP_MULTI_MIGRATION_ACTOR_DENIED');
    }
    const startedAt = input.now || new Date();
    input.report.execution = { actor: input.actor, startedAt: startedAt.toISOString(), state: 'applying' };
    await input.persistReport?.(input.report);
    try {
        assertExactSource(input.report, await input.repository.loadSnapshot());
        const mapId = new ObjectId(input.report.target.mapId);
        await input.repository.insertMap({
            _id: mapId,
            title: input.report.target.title,
            rootNodeId: new ObjectId(input.report.target.rootNodeId),
            visibility: input.report.target.visibility,
            layoutDirection: input.report.target.layoutDirection,
            createdAt: new Date(input.report.target.createdAt),
            updatedAt: new Date(input.report.target.updatedAt),
        });
        const nodes = await input.repository.setNodeMapId(mapId);
        if (nodes.matchedCount !== input.report.source.nodeCount || nodes.modifiedCount !== input.report.source.nodeCount) {
            fail('node migration count mismatch', 'MINDMAP_MULTI_MIGRATION_WRITE_COUNT_MISMATCH', nodes);
        }
        const problems = await input.repository.setProblemMapId(mapId);
        if (problems.matchedCount !== input.report.source.problemCount || problems.modifiedCount !== input.report.source.problemCount) {
            fail('Problem migration count mismatch', 'MINDMAP_MULTI_MIGRATION_WRITE_COUNT_MISMATCH', problems);
        }
        const removedConfigs = await input.repository.deleteGlobalConfig(input.report.source.config);
        if (removedConfigs !== 1) fail('legacy global config removal count mismatch', 'MINDMAP_MULTI_MIGRATION_WRITE_COUNT_MISMATCH');
        await input.repository.insertAudit({
            type: 'mindmap.multi.migration',
            operator: input.actor,
            fingerprint: input.report.fingerprint,
            targetMapId: mapId,
            counts: { nodes: input.report.source.nodeCount, problems: input.report.source.problemCount, courses: input.report.source.courseCount },
            result: 'success',
            time: new Date(),
        });
        input.report.execution = {
            ...input.report.execution,
            state: 'applied',
            completedAt: new Date().toISOString(),
        };
        await input.persistReport?.(input.report);
    } catch (error) {
        input.report.execution = {
            ...input.report.execution,
            state: 'failed',
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
        const secondaryErrors: unknown[] = [];
        try {
            await input.persistReport?.(input.report);
        } catch (persistError) {
            secondaryErrors.push(persistError);
        }
        try {
            await recordFailedAudit(input.repository, input.report, input.actor, error);
        } catch (auditError) {
            secondaryErrors.push(auditError);
        }
        if (secondaryErrors.length) {
            throw new AggregateError([error, ...secondaryErrors], 'mindmap migration failed and its failure evidence is incomplete');
        }
        throw error;
    }
}

export async function verifyMindmapMultiMigration(
    report: MindmapMultiMigrationReport,
    repository: MindmapMultiMigrationRepository,
    now = new Date(),
): Promise<void> {
    assertMindmapMultiMigrationReport(report);
    if (report.execution?.state !== 'applied' || !Number.isSafeInteger(report.execution.actor)) {
        fail('migration report is not in the applied state', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    const snapshot = await repository.loadSnapshot();
    if (snapshot.configs.length !== 0) fail('legacy global config still exists', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    if (snapshot.maps.length !== 1) fail('expected exactly one migrated knowledge map', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    const mapId = new ObjectId(report.target.mapId);
    const map = snapshot.maps[0];
    if (
        !(map._id instanceof ObjectId) ||
        !map._id.equals(mapId) ||
        !(map.rootNodeId instanceof ObjectId) ||
        map.rootNodeId.toHexString() !== report.target.rootNodeId ||
        map.title !== report.target.title ||
        map.visibility !== report.target.visibility ||
        map.layoutDirection !== report.target.layoutDirection ||
        !(map.createdAt instanceof Date) ||
        map.createdAt.toISOString() !== report.target.createdAt ||
        !(map.updatedAt instanceof Date) ||
        map.updatedAt.toISOString() !== report.target.updatedAt
    ) {
        fail('migrated knowledge map differs from the approved target', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    if (snapshot.nodes.length !== report.source.nodeCount) fail('migrated node count changed', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    validateTree(snapshot.nodes, new ObjectId(report.target.rootNodeId), mapId);
    if (hash(sortedDocuments(snapshot.nodes.map((node) => withoutField(node, 'mapId')))) !== report.source.nodeHash) {
        fail('non-target mindmap node fields changed', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    const nodeIds = new Set(snapshot.nodes.map((node) => objectId(node._id, 'node._id').toHexString()));
    if (snapshot.problems.length !== report.source.problemCount) fail('Problem count changed', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    for (const problem of snapshot.problems) {
        if (!(problem.knowledgeMapId instanceof ObjectId) || !problem.knowledgeMapId.equals(mapId)) {
            fail(`Problem ${problem.domainId}/${problem.docId} has the wrong map`, 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
        }
        validateNodeReferences(problem.knowledgeNodeIds, `Problem ${problem.domainId}/${problem.docId}.knowledgeNodeIds`, nodeIds);
        validateNodeReferences(
            problem.managedAuthoring?.selectedMindmapNodeIds,
            `Problem ${problem.domainId}/${problem.docId}.managedAuthoring.selectedMindmapNodeIds`,
            nodeIds,
        );
    }
    if (hash(sortedDocuments(snapshot.problems.map((problem) => withoutField(problem, 'knowledgeMapId')))) !== report.source.problemNonTargetHash) {
        fail('non-target Problem fields changed', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    if (
        snapshot.courses.length !== report.source.courseCount ||
        snapshot.courses.some((course) => own(course, 'knowledgeMapId')) ||
        hash(sortedDocuments(snapshot.courses)) !== report.source.courseHash
    ) {
        fail('Course documents changed or were implicitly bound', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    const audit = await repository.findSuccessfulAudit(report.fingerprint);
    if (
        !audit ||
        audit.operator !== report.execution.actor ||
        audit.result !== 'success' ||
        String(audit.targetMapId) !== report.target.mapId ||
        audit.counts?.nodes !== report.source.nodeCount ||
        audit.counts?.problems !== report.source.problemCount ||
        audit.counts?.courses !== report.source.courseCount
    ) {
        fail('successful migration audit is missing or conflicting', 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    }
    report.verification = { verifiedAt: now.toISOString(), ok: true, auditId: String(audit._id) };
}

export function mindmapMultiMigrationSummary(report: MindmapMultiMigrationReport) {
    return {
        fingerprint: report.fingerprint,
        confirmationToken: report.confirmationToken,
        targetMapId: report.target.mapId,
        nodes: report.source.nodeCount,
        problems: report.source.problemCount,
        courses: report.source.courseCount,
        state: report.verification?.ok ? 'verified' : report.execution?.state || 'planned',
    };
}
