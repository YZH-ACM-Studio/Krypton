import { createHash, createHmac } from 'node:crypto';
import { ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';

export const EXAM_PRELOGIN_SCHEMA_VERSION = 1 as const;
export const EXAM_PRELOGIN_TICKET_TTL_MS = 5 * 60 * 1000;

export type ExamPreloginDiagnosticCode =
    | 'active_session_conflict'
    | 'assignment_reference_changed'
    | 'contest_not_enterable'
    | 'endpoint_capability_missing'
    | 'endpoint_incompatible'
    | 'endpoint_offline'
    | 'external_workspace_unavailable'
    | 'seat_binding_changed'
    | 'user_binding_changed';

export interface ExamPreloginDiagnostic {
    code: ExamPreloginDiagnosticCode;
    severity: 'error' | 'warning';
}

export interface ExamPreloginEndpointCapability {
    name: string;
    version: number;
    commands: string[];
}

export interface ExamPreloginEndpointFact {
    online: boolean;
    serviceVersion: string | null;
    protocolVersion: number | null;
    capabilities: ExamPreloginEndpointCapability[];
    activeSessionId: string | null;
}

export interface ExamPreloginWorkspace {
    kind: 'contest';
    contestId: string;
    path: string;
}

export interface ExamPreloginPreparationItem {
    uid: number;
    studentRecordId: ObjectId;
    sourceSeatId: string;
    bindingId: ObjectId | null;
    bindingRevision: number | null;
    endpointId: string | null;
    ready: boolean;
    diagnostics: ExamPreloginDiagnostic[];
    endpoint: ExamPreloginEndpointFact;
}

export interface ExamPreloginPreparation {
    schemaVersion: typeof EXAM_PRELOGIN_SCHEMA_VERSION;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    assignment: { assignmentId: ObjectId; revision: number; fingerprint: string };
    publicationRevision: number;
    workspace: ExamPreloginWorkspace | null;
    items: ExamPreloginPreparationItem[];
    hardErrorCount: number;
    warningCount: number;
    fingerprint: string;
}

export type ExamPreloginDispatchStatus = 'applied' | 'expired' | 'failed' | 'offline' | 'queued' | 'rejected' | 'sent';
export type ExamPreloginStage = 'dispatch' | 'launch' | 'page_ready' | 'process_ready' | 'redeemed';

export interface ExamPreloginProjectionItem {
    ticketId: string;
    endpointId: string;
    commandId: string | null;
    status: ExamPreloginDispatchStatus;
    stage: ExamPreloginStage;
    failureReason: string | null;
}

export interface ExamPreloginProjection {
    requestId: string;
    batchId: string;
    dispatchStatus: 'complete' | 'dispatching';
    projectionRevision: number;
    summary: Record<string, number>;
    items: ExamPreloginProjectionItem[];
}

export interface ExamPreloginWorkflowBinding {
    fingerprint: string;
    executionRevision: number;
    policy: { id: ObjectId; revision: number; fingerprint: string };
    target: { id: ObjectId; revision: number; fingerprint: string };
    targetCount: number;
    startAt: Date;
    hardEndAt: Date;
}

export interface ExamPreloginBatchDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    assignment: { assignmentId: ObjectId; revision: number; fingerprint: string };
    publicationRevision: number;
    requestId: string;
    preparationFingerprint: string;
    /** Absent only on canonical P2.6/P2.7 batches created before P2.9. */
    workflow?: ExamPreloginWorkflowBinding;
    state: 'dispatching' | 'dispatched';
    revision: number;
    ticketIds: ObjectId[];
    projection: ExamPreloginProjection | null;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    fingerprint: string;
}

export interface ExamPreloginTicketDoc {
    _id: ObjectId;
    batchId: ObjectId;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    assignment: { assignmentId: ObjectId; revision: number; fingerprint: string };
    publicationRevision: number;
    uid: number;
    studentRecordId: ObjectId;
    sourceSeatId: string;
    bindingId: ObjectId;
    bindingRevision: number;
    endpointId: string;
    workspace: ExamPreloginWorkspace;
    nonce: string;
    ticketDigest: string;
    issuedAt: Date;
    expiresAt: Date;
    state: 'issued' | 'redeemed';
    redemptionRequestId: string | null;
    redeemedAt: Date | null;
    fingerprint: string;
}

export interface ExamPreloginDispatchPayload {
    schemaVersion: typeof EXAM_PRELOGIN_SCHEMA_VERSION;
    requestId: string;
    idempotencyKey: string;
    batchId: string;
    domainId: string;
    eventId: string;
    eventRevision: number;
    assignment: { assignmentId: string; revision: number; fingerprint: string };
    publicationRevision: number;
    items: Array<{
        ticketId: string;
        ticketDigest: string;
        uid: number;
        endpointId: string;
        workspace: ExamPreloginWorkspace;
        expiresAt: string;
    }>;
}

export interface ExamPreloginRetryPayload {
    schemaVersion: typeof EXAM_PRELOGIN_SCHEMA_VERSION;
    requestId: string;
    idempotencyKey: string;
    batchId: string;
    originalRequestId: string;
    expectedProjectionRevision: number;
    ticketIds: string[];
    tickets: Array<{
        ticketId: string;
        ticketDigest: string;
        expiresAt: string;
        resumeSessionId: string | null;
    }>;
}

interface PreloginFindCursor<T> {
    limit(limit: number): PreloginFindCursor<T>;
    sort(spec: Record<string, 1 | -1>): PreloginFindCursor<T>;
    toArray(): Promise<T[]>;
}

interface PreloginCollection<T extends { _id: ObjectId }> {
    createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): PromiseLike<unknown>;
    deleteMany(filter: Record<string, unknown>): PromiseLike<unknown>;
    find(filter: Record<string, unknown>): PreloginFindCursor<T>;
    findOne(filter: Record<string, unknown>): Promise<T | null>;
    insertOne(doc: T): PromiseLike<unknown>;
    replaceOne(expected: T, target: T): PromiseLike<{ matchedCount: number }>;
}

export class ExamPreloginError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamPreloginError';
    }
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalHash(value: unknown): string {
    return sha256(JSON.stringify(value));
}

function deterministicObjectId(identity: string): ObjectId {
    return new ObjectId(sha256(identity).slice(0, 24));
}

function duplicateKey(error: unknown): boolean {
    return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 11000;
}

function exactObject(value: unknown, keys: readonly string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamPreloginError(reason);
    const record = value as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new ExamPreloginError(reason);
    }
    return record;
}

function canonicalText(value: unknown, field: string, maximum = 128): string {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum) {
        throw new ExamPreloginError(`${field}_invalid`);
    }
    return value;
}

function canonicalRequestId(value: unknown): string {
    const requestId = canonicalText(value, 'request_id');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(requestId)) throw new ExamPreloginError('request_id_invalid');
    return requestId;
}

function assertRevision(value: unknown, field = 'revision'): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ExamPreloginError(`${field}_invalid`);
}

function assertUid(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) <= 1) throw new ExamPreloginError('uid_invalid');
}

function assertActorUid(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ExamPreloginError('actor_uid_invalid');
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new ExamPreloginError(`${field}_invalid`);
}

function assertFingerprint(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ExamPreloginError(`${field}_invalid`);
}

function canonicalDate(value: unknown, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ExamPreloginError(`${field}_invalid`);
    return new Date(value);
}

function canonicalWorkspace(value: unknown): ExamPreloginWorkspace {
    const workspace = exactObject(value, ['contestId', 'kind', 'path'], 'workspace_invalid');
    if (workspace.kind !== 'contest') throw new ExamPreloginError('workspace_invalid');
    const contestId = canonicalText(workspace.contestId, 'contest_id', 24);
    if (!/^[a-f0-9]{24}$/.test(contestId)) throw new ExamPreloginError('contest_id_invalid');
    const path = canonicalText(workspace.path, 'workspace_path', 256);
    if (path !== `/exam-mode/${contestId}`) throw new ExamPreloginError('workspace_path_invalid');
    return { kind: 'contest', contestId, path };
}

function canonicalCapability(value: unknown): ExamPreloginEndpointCapability {
    const capability = exactObject(value, ['commands', 'name', 'version'], 'endpoint_capability_invalid');
    const name = canonicalText(capability.name, 'capability_name', 64);
    assertRevision(capability.version, 'capability_version');
    if (
        !Array.isArray(capability.commands) ||
        capability.commands.some((command) => typeof command !== 'string' || !command || command !== command.trim())
    ) {
        throw new ExamPreloginError('endpoint_capability_invalid');
    }
    const commands = [...capability.commands].sort();
    if (new Set(commands).size !== commands.length) throw new ExamPreloginError('endpoint_capability_invalid');
    return { name, version: capability.version, commands };
}

function canonicalEndpointFact(value: unknown): ExamPreloginEndpointFact {
    const endpoint = exactObject(value, ['activeSessionId', 'capabilities', 'online', 'protocolVersion', 'serviceVersion'], 'endpoint_fact_invalid');
    if (typeof endpoint.online !== 'boolean') throw new ExamPreloginError('endpoint_fact_invalid');
    if (endpoint.serviceVersion !== null) canonicalText(endpoint.serviceVersion, 'service_version', 32);
    if (endpoint.protocolVersion !== null) assertRevision(endpoint.protocolVersion, 'protocol_version');
    if (endpoint.activeSessionId !== null) canonicalText(endpoint.activeSessionId, 'active_session_id', 128);
    if (!Array.isArray(endpoint.capabilities)) throw new ExamPreloginError('endpoint_fact_invalid');
    const capabilities = endpoint.capabilities
        .map(canonicalCapability)
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    if (new Set(capabilities.map((capability) => capability.name)).size !== capabilities.length) {
        throw new ExamPreloginError('endpoint_capability_invalid');
    }
    return {
        online: endpoint.online,
        serviceVersion: endpoint.serviceVersion as string | null,
        protocolVersion: endpoint.protocolVersion as number | null,
        capabilities,
        activeSessionId: endpoint.activeSessionId as string | null,
    };
}

const diagnosticCodes = new Set<ExamPreloginDiagnosticCode>([
    'active_session_conflict',
    'assignment_reference_changed',
    'contest_not_enterable',
    'endpoint_capability_missing',
    'endpoint_incompatible',
    'endpoint_offline',
    'external_workspace_unavailable',
    'seat_binding_changed',
    'user_binding_changed',
]);

function canonicalDiagnostic(value: unknown): ExamPreloginDiagnostic {
    const diagnostic = exactObject(value, ['code', 'severity'], 'prelogin_diagnostic_invalid');
    if (!diagnosticCodes.has(diagnostic.code as ExamPreloginDiagnosticCode)) throw new ExamPreloginError('prelogin_diagnostic_invalid');
    if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') {
        throw new ExamPreloginError('prelogin_diagnostic_invalid');
    }
    return { code: diagnostic.code as ExamPreloginDiagnosticCode, severity: diagnostic.severity };
}

function preparationFact(preparation: Omit<ExamPreloginPreparation, 'fingerprint'>): unknown {
    return {
        schemaVersion: preparation.schemaVersion,
        domainId: preparation.domainId,
        eventId: preparation.eventId.toHexString(),
        eventRevision: preparation.eventRevision,
        assignment: {
            assignmentId: preparation.assignment.assignmentId.toHexString(),
            revision: preparation.assignment.revision,
            fingerprint: preparation.assignment.fingerprint,
        },
        publicationRevision: preparation.publicationRevision,
        workspace: preparation.workspace,
        items: preparation.items.map((item) => ({
            uid: item.uid,
            studentRecordId: item.studentRecordId.toHexString(),
            sourceSeatId: item.sourceSeatId,
            bindingId: item.bindingId?.toHexString() ?? null,
            bindingRevision: item.bindingRevision,
            endpointId: item.endpointId,
            ready: item.ready,
            diagnostics: item.diagnostics,
            endpoint: item.endpoint,
        })),
        hardErrorCount: preparation.hardErrorCount,
        warningCount: preparation.warningCount,
    };
}

export function createExamPreloginPreparation(input: Omit<ExamPreloginPreparation, 'fingerprint'>): ExamPreloginPreparation {
    const preparation = { ...input, fingerprint: canonicalHash(preparationFact(input)) };
    assertExamPreloginPreparationIntegrity(preparation);
    return preparation;
}

export function assertExamPreloginPreparationIntegrity(value: unknown): asserts value is ExamPreloginPreparation {
    const preparation = exactObject(
        value,
        [
            'assignment',
            'domainId',
            'eventId',
            'eventRevision',
            'fingerprint',
            'hardErrorCount',
            'items',
            'publicationRevision',
            'schemaVersion',
            'warningCount',
            'workspace',
        ],
        'preparation_invalid',
    );
    if (preparation.schemaVersion !== EXAM_PRELOGIN_SCHEMA_VERSION) throw new ExamPreloginError('preparation_schema_invalid');
    const domainId = canonicalText(preparation.domainId, 'domain_id', 64);
    assertObjectId(preparation.eventId, 'event_id');
    assertRevision(preparation.eventRevision, 'event_revision');
    const assignment = exactObject(preparation.assignment, ['assignmentId', 'fingerprint', 'revision'], 'assignment_ref_invalid');
    assertObjectId(assignment.assignmentId, 'assignment_id');
    assertRevision(assignment.revision, 'assignment_revision');
    assertFingerprint(assignment.fingerprint, 'assignment_fingerprint');
    assertRevision(preparation.publicationRevision, 'publication_revision');
    const workspace = preparation.workspace === null ? null : canonicalWorkspace(preparation.workspace);
    if (!Array.isArray(preparation.items) || !preparation.items.length || preparation.items.length > 500) {
        throw new ExamPreloginError('preparation_items_invalid');
    }
    const items = preparation.items.map((rawItem) => {
        const item = exactObject(
            rawItem,
            ['bindingId', 'bindingRevision', 'diagnostics', 'endpoint', 'endpointId', 'ready', 'sourceSeatId', 'studentRecordId', 'uid'],
            'preparation_item_invalid',
        );
        assertUid(item.uid);
        assertObjectId(item.studentRecordId, 'student_record_id');
        const missingBinding = item.bindingId === null && item.bindingRevision === null && item.endpointId === null;
        const completeBinding = item.bindingId instanceof ObjectId && item.bindingRevision !== null && item.endpointId !== null;
        if (!missingBinding && !completeBinding) throw new ExamPreloginError('preparation_binding_invalid');
        if (completeBinding) {
            assertRevision(item.bindingRevision, 'binding_revision');
            canonicalText(item.endpointId, 'endpoint_id');
        }
        const sourceSeatId = canonicalText(item.sourceSeatId, 'source_seat_id');
        if (typeof item.ready !== 'boolean' || !Array.isArray(item.diagnostics)) {
            throw new ExamPreloginError('preparation_item_invalid');
        }
        const diagnostics = item.diagnostics.map(canonicalDiagnostic);
        const endpoint = canonicalEndpointFact(item.endpoint);
        if (item.ready !== !diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            throw new ExamPreloginError('preparation_item_readiness_invalid');
        }
        if (item.ready && !completeBinding) throw new ExamPreloginError('preparation_item_readiness_invalid');
        return {
            uid: item.uid,
            studentRecordId: item.studentRecordId,
            sourceSeatId,
            bindingId: item.bindingId as ObjectId | null,
            bindingRevision: item.bindingRevision as number | null,
            endpointId: item.endpointId as string | null,
            ready: item.ready,
            diagnostics,
            endpoint,
        } satisfies ExamPreloginPreparationItem;
    });
    if (
        new Set(items.map((item) => item.uid)).size !== items.length ||
        new Set(items.map((item) => item.studentRecordId.toHexString())).size !== items.length ||
        new Set(items.map((item) => item.sourceSeatId)).size !== items.length ||
        new Set(items.flatMap((item) => (item.bindingId ? [item.bindingId.toHexString()] : []))).size !==
            items.filter((item) => item.bindingId !== null).length ||
        new Set(items.flatMap((item) => (item.endpointId ? [item.endpointId] : []))).size !== items.filter((item) => item.endpointId !== null).length
    ) {
        throw new ExamPreloginError('preparation_items_duplicate');
    }
    if (items.some((item, index) => index > 0 && items[index - 1].uid >= item.uid)) {
        throw new ExamPreloginError('preparation_items_order_invalid');
    }
    const hardErrorCount = items.reduce((count, item) => count + item.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length, 0);
    const warningCount = items.reduce((count, item) => count + item.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length, 0);
    if (preparation.hardErrorCount !== hardErrorCount || preparation.warningCount !== warningCount) {
        throw new ExamPreloginError('preparation_diagnostic_count_invalid');
    }
    assertFingerprint(preparation.fingerprint, 'preparation_fingerprint');
    const canonical: Omit<ExamPreloginPreparation, 'fingerprint'> = {
        schemaVersion: EXAM_PRELOGIN_SCHEMA_VERSION,
        domainId,
        eventId: preparation.eventId,
        eventRevision: preparation.eventRevision,
        assignment: {
            assignmentId: assignment.assignmentId,
            revision: assignment.revision,
            fingerprint: assignment.fingerprint,
        },
        publicationRevision: preparation.publicationRevision,
        workspace,
        items,
        hardErrorCount,
        warningCount,
    };
    if (preparation.fingerprint !== canonicalHash(preparationFact(canonical))) {
        throw new ExamPreloginError('preparation_fingerprint_mismatch');
    }
}

function batchFingerprint(doc: Omit<ExamPreloginBatchDoc, 'fingerprint'>): string {
    return canonicalHash({
        _id: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        assignment: {
            assignmentId: doc.assignment.assignmentId.toHexString(),
            revision: doc.assignment.revision,
            fingerprint: doc.assignment.fingerprint,
        },
        publicationRevision: doc.publicationRevision,
        requestId: doc.requestId,
        preparationFingerprint: doc.preparationFingerprint,
        ...(doc.workflow ? { workflow: workflowBindingFact(doc.workflow) } : {}),
        state: doc.state,
        revision: doc.revision,
        ticketIds: doc.ticketIds.map((id) => id.toHexString()),
        projection: doc.projection,
        createdAt: doc.createdAt.toISOString(),
        createdBy: doc.createdBy,
        updatedAt: doc.updatedAt.toISOString(),
    });
}

function workflowBindingFact(workflow: ExamPreloginWorkflowBinding): Record<string, unknown> {
    return {
        fingerprint: workflow.fingerprint,
        executionRevision: workflow.executionRevision,
        policy: {
            id: workflow.policy.id.toHexString(),
            revision: workflow.policy.revision,
            fingerprint: workflow.policy.fingerprint,
        },
        target: {
            id: workflow.target.id.toHexString(),
            revision: workflow.target.revision,
            fingerprint: workflow.target.fingerprint,
        },
        targetCount: workflow.targetCount,
        startAt: workflow.startAt.toISOString(),
        hardEndAt: workflow.hardEndAt.toISOString(),
    };
}

function assertWorkflowBindingIntegrity(workflow: ExamPreloginWorkflowBinding): void {
    exactObject(
        workflow,
        ['executionRevision', 'fingerprint', 'hardEndAt', 'policy', 'startAt', 'target', 'targetCount'],
        'workflow_binding_invalid',
    );
    assertFingerprint(workflow.fingerprint, 'workflow_fingerprint');
    assertRevision(workflow.executionRevision, 'workflow_execution_revision');
    for (const [field, value] of [
        ['policy', workflow.policy],
        ['target', workflow.target],
    ] as const) {
        const reference = exactObject(value, ['fingerprint', 'id', 'revision'], 'workflow_binding_invalid');
        assertObjectId(reference.id, `${field}_id`);
        assertRevision(reference.revision, `${field}_revision`);
        assertFingerprint(reference.fingerprint, `${field}_fingerprint`);
    }
    if (!Number.isSafeInteger(workflow.targetCount) || workflow.targetCount < 1 || workflow.targetCount > 500) {
        throw new ExamPreloginError('workflow_target_count_invalid');
    }
    canonicalDate(workflow.startAt, 'workflow_start_at');
    canonicalDate(workflow.hardEndAt, 'workflow_hard_end_at');
    if (workflow.hardEndAt <= workflow.startAt) throw new ExamPreloginError('workflow_window_invalid');
}

function ticketMacFact(doc: Omit<ExamPreloginTicketDoc, 'fingerprint' | 'ticketDigest'>): Record<string, unknown> {
    return {
        ticketId: doc._id.toHexString(),
        batchId: doc.batchId.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        assignment: {
            assignmentId: doc.assignment.assignmentId.toHexString(),
            revision: doc.assignment.revision,
            fingerprint: doc.assignment.fingerprint,
        },
        publicationRevision: doc.publicationRevision,
        uid: doc.uid,
        studentRecordId: doc.studentRecordId.toHexString(),
        sourceSeatId: doc.sourceSeatId,
        bindingId: doc.bindingId.toHexString(),
        bindingRevision: doc.bindingRevision,
        endpointId: doc.endpointId,
        workspace: doc.workspace,
        nonce: doc.nonce,
        issuedAt: doc.issuedAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
    };
}

function ticketFingerprint(doc: Omit<ExamPreloginTicketDoc, 'fingerprint'>): string {
    return canonicalHash({
        ...ticketMacFact(doc),
        ticketDigest: doc.ticketDigest,
        state: doc.state,
        redemptionRequestId: doc.redemptionRequestId,
        redeemedAt: doc.redeemedAt?.toISOString() || null,
    });
}

function ticketMaterial(doc: ExamPreloginTicketDoc, ticketKey: string): string {
    const signature = createHmac('sha256', Buffer.from(ticketKey, 'hex'))
        .update(JSON.stringify(ticketMacFact(doc)), 'utf8')
        .digest('base64url');
    return `KPT1.${doc._id.toHexString()}.${signature}`;
}

function sameTicketIssueFacts(left: ExamPreloginTicketDoc, right: ExamPreloginTicketDoc): boolean {
    return left.ticketDigest === right.ticketDigest && canonicalHash(ticketMacFact(left)) === canonicalHash(ticketMacFact(right));
}

function assertBatchIntegrity(doc: ExamPreloginBatchDoc): void {
    const hasWorkflow = Object.hasOwn(doc, 'workflow');
    exactObject(
        doc,
        [
            '_id',
            'assignment',
            'createdAt',
            'createdBy',
            'domainId',
            'eventId',
            'eventRevision',
            'fingerprint',
            'preparationFingerprint',
            'projection',
            'publicationRevision',
            'requestId',
            'revision',
            'state',
            'ticketIds',
            'updatedAt',
            ...(hasWorkflow ? ['workflow'] : []),
        ],
        'batch_schema_invalid',
    );
    assertObjectId(doc._id, 'batch_id');
    canonicalText(doc.domainId, 'domain_id', 64);
    assertObjectId(doc.eventId, 'event_id');
    assertRevision(doc.eventRevision, 'event_revision');
    const assignment = exactObject(doc.assignment, ['assignmentId', 'fingerprint', 'revision'], 'batch_schema_invalid');
    assertObjectId(assignment.assignmentId, 'assignment_id');
    assertRevision(assignment.revision, 'assignment_revision');
    assertFingerprint(assignment.fingerprint, 'assignment_fingerprint');
    assertRevision(doc.publicationRevision, 'publication_revision');
    canonicalRequestId(doc.requestId);
    assertFingerprint(doc.preparationFingerprint, 'preparation_fingerprint');
    if (hasWorkflow) {
        if (!doc.workflow) throw new ExamPreloginError('workflow_binding_invalid');
        assertWorkflowBindingIntegrity(doc.workflow);
    }
    if (doc.state !== 'dispatching' && doc.state !== 'dispatched') throw new ExamPreloginError('batch_state_invalid');
    assertRevision(doc.revision);
    if (!Array.isArray(doc.ticketIds) || !doc.ticketIds.length || doc.ticketIds.some((id) => !(id instanceof ObjectId))) {
        throw new ExamPreloginError('batch_ticket_ids_invalid');
    }
    if (new Set(doc.ticketIds.map((id) => id.toHexString())).size !== doc.ticketIds.length) {
        throw new ExamPreloginError('batch_ticket_ids_invalid');
    }
    if ((doc.state === 'dispatched') !== (doc.projection !== null)) throw new ExamPreloginError('batch_projection_invalid');
    if (doc.projection !== null) canonicalProjection(doc.projection, doc);
    canonicalDate(doc.createdAt, 'batch_created_at');
    canonicalDate(doc.updatedAt, 'batch_updated_at');
    if (doc.updatedAt < doc.createdAt) throw new ExamPreloginError('batch_clock_invalid');
    assertActorUid(doc.createdBy);
    assertFingerprint(doc.fingerprint, 'batch_fingerprint');
    const { fingerprint: _fingerprint, ...canonical } = doc;
    if (doc.fingerprint !== batchFingerprint(canonical)) throw new ExamPreloginError('batch_fingerprint_mismatch');
}

function assertTicketIntegrity(doc: ExamPreloginTicketDoc): void {
    exactObject(
        doc,
        [
            '_id',
            'assignment',
            'batchId',
            'bindingId',
            'bindingRevision',
            'domainId',
            'endpointId',
            'eventId',
            'eventRevision',
            'expiresAt',
            'fingerprint',
            'issuedAt',
            'nonce',
            'publicationRevision',
            'redeemedAt',
            'redemptionRequestId',
            'sourceSeatId',
            'state',
            'studentRecordId',
            'ticketDigest',
            'uid',
            'workspace',
        ],
        'ticket_schema_invalid',
    );
    assertObjectId(doc._id, 'ticket_id');
    assertObjectId(doc.batchId, 'batch_id');
    canonicalText(doc.domainId, 'domain_id', 64);
    assertObjectId(doc.eventId, 'event_id');
    assertRevision(doc.eventRevision, 'event_revision');
    const assignment = exactObject(doc.assignment, ['assignmentId', 'fingerprint', 'revision'], 'ticket_schema_invalid');
    assertObjectId(assignment.assignmentId, 'assignment_id');
    assertRevision(assignment.revision, 'assignment_revision');
    assertFingerprint(assignment.fingerprint, 'assignment_fingerprint');
    assertRevision(doc.publicationRevision, 'publication_revision');
    assertUid(doc.uid);
    assertObjectId(doc.studentRecordId, 'student_record_id');
    canonicalText(doc.sourceSeatId, 'source_seat_id');
    assertObjectId(doc.bindingId, 'binding_id');
    assertRevision(doc.bindingRevision, 'binding_revision');
    canonicalText(doc.endpointId, 'endpoint_id');
    canonicalWorkspace(doc.workspace);
    if (!/^[a-f0-9]{32}$/.test(doc.nonce)) throw new ExamPreloginError('ticket_nonce_invalid');
    assertFingerprint(doc.ticketDigest, 'ticket_digest');
    canonicalDate(doc.issuedAt, 'ticket_issued_at');
    canonicalDate(doc.expiresAt, 'ticket_expires_at');
    if (doc.expiresAt <= doc.issuedAt || doc.expiresAt.getTime() - doc.issuedAt.getTime() !== EXAM_PRELOGIN_TICKET_TTL_MS) {
        throw new ExamPreloginError('ticket_expiry_invalid');
    }
    if (doc.state !== 'issued' && doc.state !== 'redeemed') throw new ExamPreloginError('ticket_state_invalid');
    if (
        (doc.state === 'issued' && (doc.redemptionRequestId !== null || doc.redeemedAt !== null)) ||
        (doc.state === 'redeemed' && (doc.redemptionRequestId === null || doc.redeemedAt === null))
    ) {
        throw new ExamPreloginError('ticket_redemption_invalid');
    }
    if (doc.redemptionRequestId !== null) canonicalRequestId(doc.redemptionRequestId);
    if (doc.redeemedAt !== null && (doc.redeemedAt < doc.issuedAt || doc.redeemedAt >= doc.expiresAt)) {
        throw new ExamPreloginError('ticket_redemption_time_invalid');
    }
    assertFingerprint(doc.fingerprint, 'ticket_fingerprint');
    const { fingerprint: _fingerprint, ...canonical } = doc;
    if (doc.fingerprint !== ticketFingerprint(canonical)) throw new ExamPreloginError('ticket_fingerprint_mismatch');
}

function canonicalProjection(value: unknown, batch: ExamPreloginBatchDoc): ExamPreloginProjection {
    const projection = exactObject(
        value,
        ['batchId', 'dispatchStatus', 'items', 'projectionRevision', 'requestId', 'summary'],
        'prelogin_projection_invalid',
    );
    if (projection.requestId !== batch.requestId || projection.batchId !== batch._id.toHexString()) {
        throw new ExamPreloginError('prelogin_projection_identity_mismatch');
    }
    if (projection.dispatchStatus !== 'complete' && projection.dispatchStatus !== 'dispatching') {
        throw new ExamPreloginError('prelogin_projection_invalid');
    }
    assertRevision(projection.projectionRevision, 'projection_revision');
    if (!projection.summary || typeof projection.summary !== 'object' || Array.isArray(projection.summary)) {
        throw new ExamPreloginError('prelogin_projection_invalid');
    }
    const summary: Record<string, number> = {};
    for (const [key, count] of Object.entries(projection.summary as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    )) {
        if (!/^[a-z][a-z_]{0,31}$/.test(key) || !Number.isSafeInteger(count) || Number(count) < 0) {
            throw new ExamPreloginError('prelogin_projection_invalid');
        }
        summary[key] = Number(count);
    }
    if (!Array.isArray(projection.items) || projection.items.length !== batch.ticketIds.length) {
        throw new ExamPreloginError('prelogin_projection_invalid');
    }
    const allowedStatuses = new Set<ExamPreloginDispatchStatus>(['applied', 'expired', 'failed', 'offline', 'queued', 'rejected', 'sent']);
    const allowedStages = new Set<ExamPreloginStage>(['dispatch', 'launch', 'page_ready', 'process_ready', 'redeemed']);
    const items = projection.items.map((rawItem) => {
        const item = exactObject(
            rawItem,
            ['commandId', 'endpointId', 'failureReason', 'stage', 'status', 'ticketId'],
            'prelogin_projection_item_invalid',
        );
        const ticketId = canonicalText(item.ticketId, 'ticket_id', 24);
        if (!/^[a-f0-9]{24}$/.test(ticketId)) throw new ExamPreloginError('ticket_id_invalid');
        const endpointId = canonicalText(item.endpointId, 'endpoint_id');
        if (item.commandId !== null) canonicalText(item.commandId, 'command_id');
        if (item.failureReason !== null) canonicalText(item.failureReason, 'failure_reason', 256);
        if (!allowedStatuses.has(item.status as ExamPreloginDispatchStatus) || !allowedStages.has(item.stage as ExamPreloginStage)) {
            throw new ExamPreloginError('prelogin_projection_item_invalid');
        }
        return {
            ticketId,
            endpointId,
            commandId: item.commandId as string | null,
            status: item.status as ExamPreloginDispatchStatus,
            stage: item.stage as ExamPreloginStage,
            failureReason: item.failureReason as string | null,
        };
    });
    const expectedIds = batch.ticketIds.map((id) => id.toHexString()).sort();
    const actualIds = items.map((item) => item.ticketId).sort();
    if (actualIds.some((id, index) => id !== expectedIds[index]) || new Set(items.map((item) => item.endpointId)).size !== items.length) {
        throw new ExamPreloginError('prelogin_projection_identity_mismatch');
    }
    if (Object.values(summary).reduce((total, count) => total + count, 0) !== items.length) {
        throw new ExamPreloginError('prelogin_projection_summary_invalid');
    }
    const actualSummary: Record<string, number> = {};
    for (const item of items) actualSummary[item.status] = (actualSummary[item.status] || 0) + 1;
    const summaryKeys = Object.keys(summary).sort();
    const actualSummaryKeys = Object.keys(actualSummary).sort();
    if (
        summaryKeys.length !== actualSummaryKeys.length ||
        summaryKeys.some((key, index) => key !== actualSummaryKeys[index] || summary[key] !== actualSummary[key])
    ) {
        throw new ExamPreloginError('prelogin_projection_summary_invalid');
    }
    return {
        requestId: batch.requestId,
        batchId: batch._id.toHexString(),
        dispatchStatus: projection.dispatchStatus,
        projectionRevision: projection.projectionRevision,
        summary,
        items,
    };
}

const requestBoundaries = new Map<string, Promise<void>>();

async function withRequestBoundary<T>(identity: string, callback: () => Promise<T>): Promise<T> {
    const previous = requestBoundaries.get(identity) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    requestBoundaries.set(identity, tail);
    await previous;
    try {
        return await callback();
    } finally {
        release();
        if (requestBoundaries.get(identity) === tail) requestBoundaries.delete(identity);
    }
}

export interface ExamPreloginServiceDependencies {
    now?: () => Date;
    ticketKey: string;
    dispatch: (payload: ExamPreloginDispatchPayload) => Promise<unknown>;
    retry: (payload: ExamPreloginRetryPayload) => Promise<unknown>;
}

export class ExamPreloginService {
    private indexesPromise?: Promise<void>;
    private readonly now: () => Date;

    constructor(
        private readonly batches: PreloginCollection<ExamPreloginBatchDoc>,
        private readonly tickets: PreloginCollection<ExamPreloginTicketDoc>,
        private readonly dependencies: ExamPreloginServiceDependencies,
    ) {
        if (!/^[a-f0-9]{64}$/.test(dependencies.ticketKey)) throw new ExamPreloginError('ticket_key_invalid');
        this.now = dependencies.now || (() => new Date());
    }

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.batches.createIndex({ domainId: 1, requestId: 1 }, { name: 'examPreloginRequest', unique: true }),
            this.batches.createIndex(
                {
                    domainId: 1,
                    eventId: 1,
                    'assignment.assignmentId': 1,
                    'assignment.revision': 1,
                    publicationRevision: 1,
                },
                {
                    name: 'examPreloginPublishedAssignment',
                    unique: true,
                    partialFilterExpression: { workflow: { $type: 'object' } },
                },
            ),
            this.batches.createIndex({ domainId: 1, eventId: 1, createdAt: -1 }, { name: 'examPreloginEvent' }),
            this.tickets.createIndex({ batchId: 1, endpointId: 1 }, { name: 'examPreloginBatchEndpoint', unique: true }),
            this.tickets.createIndex({ domainId: 1, eventId: 1, state: 1, expiresAt: 1 }, { name: 'examPreloginEventState' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    async confirm(input: {
        preparation: ExamPreloginPreparation;
        workflow: ExamPreloginWorkflowBinding;
        requestId: string;
        actorUid: number;
    }): Promise<{ batch: ExamPreloginBatchDoc; projection: ExamPreloginProjection }> {
        assertExamPreloginPreparationIntegrity(input.preparation);
        assertWorkflowBindingIntegrity(input.workflow);
        const requestId = canonicalRequestId(input.requestId);
        assertActorUid(input.actorUid);
        if (input.preparation.hardErrorCount || input.preparation.items.some((item) => !item.ready)) {
            throw new ExamPreloginError('preparation_blocked');
        }
        const boundary = [
            input.preparation.domainId,
            'assignment',
            input.preparation.eventId.toHexString(),
            input.preparation.assignment.assignmentId.toHexString(),
            input.preparation.assignment.revision,
            input.preparation.publicationRevision,
        ].join('\0');
        return withRequestBoundary(boundary, () => this.confirmWhileGuarded(input.preparation, input.workflow, requestId, input.actorUid));
    }

    private async confirmWhileGuarded(
        preparation: ExamPreloginPreparation,
        workflow: ExamPreloginWorkflowBinding,
        requestId: string,
        actorUid: number,
    ): Promise<{ batch: ExamPreloginBatchDoc; projection: ExamPreloginProjection }> {
        const batchId = deterministicObjectId(`exam-prelogin-batch\0${preparation.domainId}\0${requestId}`);
        const assignmentIdentity = {
            domainId: preparation.domainId,
            eventId: preparation.eventId,
            'assignment.assignmentId': preparation.assignment.assignmentId,
            'assignment.revision': preparation.assignment.revision,
            publicationRevision: preparation.publicationRevision,
        };
        let batch = await this.batches.findOne(assignmentIdentity);
        if (batch && batch.requestId !== requestId) {
            assertBatchIntegrity(batch);
            throw new ExamPreloginError('assignment_already_confirmed');
        }
        batch ||= await this.batches.findOne({ _id: batchId });
        if (batch) {
            assertBatchIntegrity(batch);
            if (
                batch.domainId !== preparation.domainId ||
                !batch.eventId.equals(preparation.eventId) ||
                batch.eventRevision !== preparation.eventRevision ||
                !batch.assignment.assignmentId.equals(preparation.assignment.assignmentId) ||
                batch.assignment.revision !== preparation.assignment.revision ||
                batch.assignment.fingerprint !== preparation.assignment.fingerprint ||
                batch.publicationRevision !== preparation.publicationRevision ||
                batch.preparationFingerprint !== preparation.fingerprint ||
                !batch.workflow ||
                canonicalHash(workflowBindingFact(batch.workflow)) !== canonicalHash(workflowBindingFact(workflow))
            ) {
                throw new ExamPreloginError('request_id_conflict');
            }
        } else {
            const createdAt = canonicalDate(this.now(), 'now');
            const ticketIds = preparation.items.map((item) =>
                deterministicObjectId(`exam-prelogin-ticket\0${batchId.toHexString()}\0${item.endpointId}`),
            );
            const canonical: Omit<ExamPreloginBatchDoc, 'fingerprint'> = {
                _id: batchId,
                domainId: preparation.domainId,
                eventId: new ObjectId(preparation.eventId),
                eventRevision: preparation.eventRevision,
                assignment: {
                    assignmentId: new ObjectId(preparation.assignment.assignmentId),
                    revision: preparation.assignment.revision,
                    fingerprint: preparation.assignment.fingerprint,
                },
                publicationRevision: preparation.publicationRevision,
                requestId,
                preparationFingerprint: preparation.fingerprint,
                workflow: {
                    fingerprint: workflow.fingerprint,
                    executionRevision: workflow.executionRevision,
                    policy: { ...workflow.policy, id: new ObjectId(workflow.policy.id) },
                    target: { ...workflow.target, id: new ObjectId(workflow.target.id) },
                    targetCount: workflow.targetCount,
                    startAt: new Date(workflow.startAt),
                    hardEndAt: new Date(workflow.hardEndAt),
                },
                state: 'dispatching',
                revision: 1,
                ticketIds,
                projection: null,
                createdAt,
                createdBy: actorUid,
                updatedAt: createdAt,
            };
            const target = { ...canonical, fingerprint: batchFingerprint(canonical) };
            assertBatchIntegrity(target);
            try {
                await this.batches.insertOne(target);
                batch = target;
            } catch (error) {
                if (!duplicateKey(error)) throw error;
                batch = (await this.batches.findOne(assignmentIdentity)) || (await this.batches.findOne({ _id: batchId }));
                if (!batch) throw new ExamPreloginError('batch_insert_ack_unknown');
                assertBatchIntegrity(batch);
                if (batch.requestId !== requestId) throw new ExamPreloginError('assignment_already_confirmed');
            }
        }

        if (batch.state === 'dispatched') {
            if (!batch.projection) throw new ExamPreloginError('batch_projection_invalid');
            return { batch, projection: batch.projection };
        }
        const ticketDocs = await this.ensureTickets(batch, preparation);
        return this.dispatchAndFinalize(batch, ticketDocs);
    }

    async resumeDispatching(batch: ExamPreloginBatchDoc): Promise<{ batch: ExamPreloginBatchDoc; projection: ExamPreloginProjection }> {
        assertBatchIntegrity(batch);
        const boundary = [
            batch.domainId,
            'assignment',
            batch.eventId.toHexString(),
            batch.assignment.assignmentId.toHexString(),
            batch.assignment.revision,
            batch.publicationRevision,
        ].join('\0');
        return withRequestBoundary(boundary, async () => {
            const current = await this.batches.findOne({ _id: batch._id });
            if (!current) throw new ExamPreloginError('batch_not_found');
            assertBatchIntegrity(current);
            if (current.requestId !== batch.requestId || current.fingerprint !== batch.fingerprint) {
                throw new ExamPreloginError('batch_cas_conflict');
            }
            if (current.state === 'dispatched') {
                if (!current.projection) throw new ExamPreloginError('batch_projection_invalid');
                return { batch: current, projection: current.projection };
            }
            const tickets = await this.listBatchTickets(current);
            if (tickets.length !== current.ticketIds.length) throw new ExamPreloginError('dispatch_recovery_incomplete');
            return this.dispatchAndFinalize(current, tickets);
        });
    }

    private async dispatchAndFinalize(
        batch: ExamPreloginBatchDoc,
        ticketDocs: ExamPreloginTicketDoc[],
    ): Promise<{ batch: ExamPreloginBatchDoc; projection: ExamPreloginProjection }> {
        const payload = this.dispatchPayload(batch, ticketDocs);
        const rawProjection = await this.dependencies.dispatch(payload);
        const projection = canonicalProjection(rawProjection, batch);
        const updatedAt = canonicalDate(this.now(), 'now');
        if (updatedAt < batch.updatedAt) throw new ExamPreloginError('clock_rollback');
        const canonical: Omit<ExamPreloginBatchDoc, 'fingerprint'> = {
            ...batch,
            state: 'dispatched',
            revision: batch.revision + 1,
            projection,
            updatedAt,
        };
        const target = { ...canonical, fingerprint: batchFingerprint(canonical) };
        assertBatchIntegrity(target);
        const replaced = await this.batches.replaceOne(batch, target);
        if (replaced.matchedCount !== 1) {
            const winner = await this.batches.findOne({ _id: batch._id });
            if (!winner) throw new ExamPreloginError('batch_cas_conflict');
            assertBatchIntegrity(winner);
            if (winner.state !== 'dispatched' || JSON.stringify(winner.projection) !== JSON.stringify(projection)) {
                throw new ExamPreloginError('batch_cas_conflict');
            }
            return { batch: winner, projection: winner.projection! };
        }
        return { batch: target, projection };
    }

    private async ensureTickets(batch: ExamPreloginBatchDoc, preparation: ExamPreloginPreparation): Promise<ExamPreloginTicketDoc[]> {
        if (batch.ticketIds.length !== preparation.items.length) throw new ExamPreloginError('batch_ticket_ids_invalid');
        if (!preparation.workspace) throw new ExamPreloginError('workspace_unavailable');
        const workspace = preparation.workspace;
        const result: ExamPreloginTicketDoc[] = [];
        for (let index = 0; index < preparation.items.length; index++) {
            const item = preparation.items[index];
            const ticketId = batch.ticketIds[index];
            if (!item.bindingId || item.bindingRevision === null || !item.endpointId || !item.ready) {
                throw new ExamPreloginError('preparation_item_not_dispatchable');
            }
            const existing = await this.tickets.findOne({ _id: ticketId });
            const nonce = createHmac('sha256', Buffer.from(this.dependencies.ticketKey, 'hex'))
                .update(`nonce\0${ticketId.toHexString()}\0${batch.requestId}`, 'utf8')
                .digest('hex')
                .slice(0, 32);
            const issuedAt = new Date(batch.createdAt);
            const expiresAt = new Date(issuedAt.getTime() + EXAM_PRELOGIN_TICKET_TTL_MS);
            const withoutDigest: Omit<ExamPreloginTicketDoc, 'fingerprint' | 'ticketDigest'> = {
                _id: ticketId,
                batchId: batch._id,
                domainId: batch.domainId,
                eventId: batch.eventId,
                eventRevision: batch.eventRevision,
                assignment: { ...batch.assignment },
                publicationRevision: batch.publicationRevision,
                uid: item.uid,
                studentRecordId: item.studentRecordId,
                sourceSeatId: item.sourceSeatId,
                bindingId: item.bindingId,
                bindingRevision: item.bindingRevision,
                endpointId: item.endpointId,
                workspace,
                nonce,
                issuedAt,
                expiresAt,
                state: 'issued',
                redemptionRequestId: null,
                redeemedAt: null,
            };
            const unsigned = { ...withoutDigest, ticketDigest: '' } as ExamPreloginTicketDoc;
            const material = ticketMaterial(unsigned, this.dependencies.ticketKey);
            const canonical: Omit<ExamPreloginTicketDoc, 'fingerprint'> = {
                ...withoutDigest,
                ticketDigest: sha256(material),
            };
            const target = { ...canonical, fingerprint: ticketFingerprint(canonical) };
            assertTicketIntegrity(target);
            if (existing) {
                assertTicketIntegrity(existing);
                if (!sameTicketIssueFacts(existing, target)) throw new ExamPreloginError('ticket_fact_conflict');
                result.push(existing);
                continue;
            }
            try {
                await this.tickets.insertOne(target);
                result.push(target);
            } catch (error) {
                if (!duplicateKey(error)) throw error;
                const winner = await this.tickets.findOne({ _id: ticketId });
                if (!winner) throw new ExamPreloginError('ticket_insert_ack_unknown');
                assertTicketIntegrity(winner);
                if (!sameTicketIssueFacts(winner, target)) throw new ExamPreloginError('ticket_fact_conflict');
                result.push(winner);
            }
        }
        return result;
    }

    private dispatchPayload(batch: ExamPreloginBatchDoc, tickets: ExamPreloginTicketDoc[]): ExamPreloginDispatchPayload {
        return {
            schemaVersion: EXAM_PRELOGIN_SCHEMA_VERSION,
            requestId: batch.requestId,
            idempotencyKey: `exam-prelogin:${batch._id.toHexString()}`,
            batchId: batch._id.toHexString(),
            domainId: batch.domainId,
            eventId: batch.eventId.toHexString(),
            eventRevision: batch.eventRevision,
            assignment: {
                assignmentId: batch.assignment.assignmentId.toHexString(),
                revision: batch.assignment.revision,
                fingerprint: batch.assignment.fingerprint,
            },
            publicationRevision: batch.publicationRevision,
            items: tickets.map((ticket) => ({
                ticketId: ticket._id.toHexString(),
                ticketDigest: ticket.ticketDigest,
                uid: ticket.uid,
                endpointId: ticket.endpointId,
                workspace: ticket.workspace,
                expiresAt: ticket.expiresAt.toISOString(),
            })),
        };
    }

    async materialize(input: { batchId: ObjectId; ticketId: ObjectId; endpointId: string }): Promise<{ ticket: string; expiresAt: Date }> {
        assertObjectId(input.batchId, 'batch_id');
        assertObjectId(input.ticketId, 'ticket_id');
        const endpointId = canonicalText(input.endpointId, 'endpoint_id');
        const ticket = await this.tickets.findOne({ _id: input.ticketId });
        if (!ticket || !ticket.batchId.equals(input.batchId)) throw new ExamPreloginError('ticket_not_found');
        assertTicketIntegrity(ticket);
        if (ticket.endpointId !== endpointId) throw new ExamPreloginError('ticket_endpoint_mismatch');
        if (ticket.state !== 'issued' && ticket.state !== 'redeemed') throw new ExamPreloginError('ticket_state_invalid');
        const now = canonicalDate(this.now(), 'now');
        if (now >= ticket.expiresAt) throw new ExamPreloginError('ticket_expired');
        const material = ticketMaterial(ticket, this.dependencies.ticketKey);
        if (sha256(material) !== ticket.ticketDigest) throw new ExamPreloginError('ticket_digest_mismatch');
        return { ticket: material, expiresAt: new Date(ticket.expiresAt) };
    }

    async redeem(input: {
        ticket: string;
        batchId: ObjectId;
        endpointId: string;
        requestId: string;
        validateCurrent: (ticket: ExamPreloginTicketDoc) => Promise<void>;
    }): Promise<ExamPreloginTicketDoc> {
        assertObjectId(input.batchId, 'batch_id');
        const endpointId = canonicalText(input.endpointId, 'endpoint_id');
        const requestId = canonicalRequestId(input.requestId);
        if (typeof input.ticket !== 'string') throw new ExamPreloginError('ticket_invalid');
        const match = /^KPT1\.([a-f0-9]{24})\.[A-Za-z0-9_-]{43}$/.exec(input.ticket);
        if (!match) throw new ExamPreloginError('ticket_invalid');
        const ticket = await this.tickets.findOne({ _id: new ObjectId(match[1]) });
        if (!ticket) throw new ExamPreloginError('ticket_not_found');
        assertTicketIntegrity(ticket);
        if (!ticket.batchId.equals(input.batchId)) throw new ExamPreloginError('ticket_batch_mismatch');
        if (ticket.endpointId !== endpointId) throw new ExamPreloginError('ticket_endpoint_mismatch');
        if (ticketMaterial(ticket, this.dependencies.ticketKey) !== input.ticket || sha256(input.ticket) !== ticket.ticketDigest) {
            throw new ExamPreloginError('ticket_invalid');
        }
        const redeemedAt = canonicalDate(this.now(), 'now');
        if (redeemedAt >= ticket.expiresAt) throw new ExamPreloginError('ticket_expired');
        if (ticket.state === 'redeemed' && ticket.redemptionRequestId !== requestId) {
            throw new ExamPreloginError('ticket_already_redeemed');
        }
        await input.validateCurrent(ticket);
        if (ticket.state === 'redeemed') return ticket;
        const canonical: Omit<ExamPreloginTicketDoc, 'fingerprint'> = {
            ...ticket,
            state: 'redeemed',
            redemptionRequestId: requestId,
            redeemedAt,
        };
        const target = { ...canonical, fingerprint: ticketFingerprint(canonical) };
        assertTicketIntegrity(target);
        const replaced = await this.tickets.replaceOne(ticket, target);
        if (replaced.matchedCount === 1) return target;
        const winner = await this.tickets.findOne({ _id: ticket._id });
        if (!winner) throw new ExamPreloginError('ticket_cas_conflict');
        assertTicketIntegrity(winner);
        if (winner.state === 'redeemed' && winner.redemptionRequestId === requestId) return winner;
        throw new ExamPreloginError('ticket_cas_conflict');
    }

    async getBatch(domainId: string, eventId: ObjectId, batchId: ObjectId): Promise<ExamPreloginBatchDoc | null> {
        const batch = await this.batches.findOne({ domainId, eventId, _id: batchId });
        if (batch) assertBatchIntegrity(batch);
        return batch;
    }

    async getBatchByRequest(domainId: string, eventId: ObjectId, requestId: string): Promise<ExamPreloginBatchDoc | null> {
        const canonicalDomainId = canonicalText(domainId, 'domain_id', 64);
        assertObjectId(eventId, 'event_id');
        const canonicalId = canonicalRequestId(requestId);
        const batch = await this.batches.findOne({ domainId: canonicalDomainId, eventId, requestId: canonicalId });
        if (batch) assertBatchIntegrity(batch);
        return batch;
    }

    async getLatestBatch(domainId: string, eventId: ObjectId): Promise<ExamPreloginBatchDoc | null> {
        const canonicalDomainId = canonicalText(domainId, 'domain_id', 64);
        assertObjectId(eventId, 'event_id');
        const batches = await this.batches.find({ domainId: canonicalDomainId, eventId }).sort({ createdAt: -1, _id: -1 }).limit(1).toArray();
        const batch = batches[0] || null;
        if (batch) assertBatchIntegrity(batch);
        return batch;
    }

    async listBatches(domainId: string, eventId: ObjectId, limit = 20): Promise<ExamPreloginBatchDoc[]> {
        const canonicalDomainId = canonicalText(domainId, 'domain_id', 64);
        assertObjectId(eventId, 'event_id');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ExamPreloginError('batch_list_limit_invalid');
        const batches = await this.batches.find({ domainId: canonicalDomainId, eventId }).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
        batches.forEach(assertBatchIntegrity);
        return batches;
    }

    async listBatchTickets(batch: ExamPreloginBatchDoc): Promise<ExamPreloginTicketDoc[]> {
        assertBatchIntegrity(batch);
        const ticketOrder = new Map(batch.ticketIds.map((ticketId, index) => [ticketId.toHexString(), index]));
        const tickets = await this.tickets.find({ batchId: batch._id }).toArray();
        const seen = new Set<string>();
        for (const ticket of tickets) {
            assertTicketIntegrity(ticket);
            const ticketId = ticket._id.toHexString();
            if (
                seen.has(ticketId) ||
                !ticketOrder.has(ticketId) ||
                !ticket.batchId.equals(batch._id) ||
                ticket.domainId !== batch.domainId ||
                !ticket.eventId.equals(batch.eventId)
            ) {
                throw new ExamPreloginError('batch_ticket_ids_invalid');
            }
            seen.add(ticketId);
        }
        if (batch.state === 'dispatched' && tickets.length !== batch.ticketIds.length) {
            throw new ExamPreloginError('batch_ticket_ids_invalid');
        }
        return tickets.sort((left, right) => ticketOrder.get(left._id.toHexString())! - ticketOrder.get(right._id.toHexString())!);
    }

    async getBatchById(batchId: ObjectId): Promise<ExamPreloginBatchDoc | null> {
        assertObjectId(batchId, 'batch_id');
        const batch = await this.batches.findOne({ _id: batchId });
        if (batch) assertBatchIntegrity(batch);
        return batch;
    }

    async retry(input: {
        domainId: string;
        eventId: ObjectId;
        batchId: ObjectId;
        expectedProjectionRevision: number;
        requestId: string;
        actorUid: number;
        ticketIds: ObjectId[];
        validateCurrent: (tickets: ExamPreloginTicketDoc[]) => Promise<Record<string, string | null>>;
    }): Promise<{ batch: ExamPreloginBatchDoc; projection: ExamPreloginProjection; ticketIds: ObjectId[] }> {
        const domainId = canonicalText(input.domainId, 'domain_id', 64);
        assertObjectId(input.eventId, 'event_id');
        assertObjectId(input.batchId, 'batch_id');
        assertRevision(input.expectedProjectionRevision, 'projection_revision');
        const requestId = canonicalRequestId(input.requestId);
        assertActorUid(input.actorUid);
        const requestedTicketIds = input.ticketIds
            .map((ticketId) => {
                assertObjectId(ticketId, 'ticket_id');
                return ticketId.toHexString();
            })
            .sort();
        if (!requestedTicketIds.length || new Set(requestedTicketIds).size !== requestedTicketIds.length) {
            throw new ExamPreloginError('retry_set_invalid');
        }
        return withRequestBoundary(`${domainId}\0retry\0${input.batchId.toHexString()}`, async () => {
            const current = await this.batches.findOne({ domainId, eventId: input.eventId, _id: input.batchId });
            if (!current) throw new ExamPreloginError('batch_not_found');
            assertBatchIntegrity(current);
            if (current.state !== 'dispatched' || !current.projection) throw new ExamPreloginError('batch_not_dispatched');
            if (current.projection.projectionRevision < input.expectedProjectionRevision) {
                throw new ExamPreloginError('projection_revision_changed');
            }
            const recoveringSavedRetry = current.projection.projectionRevision > input.expectedProjectionRevision;
            if (current.projection.projectionRevision === input.expectedProjectionRevision) {
                const retryable = current.projection.items
                    .filter(
                        (item) => item.status === 'expired' || item.status === 'failed' || item.status === 'offline' || item.status === 'rejected',
                    )
                    .map((item) => item.ticketId)
                    .sort();
                if (!retryable.length) throw new ExamPreloginError('retry_set_empty');
                if (JSON.stringify(retryable) !== JSON.stringify(requestedTicketIds)) {
                    throw new ExamPreloginError('retry_set_changed');
                }
            }
            const now = canonicalDate(this.now(), 'now');
            const tickets: ExamPreloginTicketDoc[] = [];
            for (const ticketId of requestedTicketIds) {
                const ticket = await this.tickets.findOne({ _id: new ObjectId(ticketId) });
                if (!ticket || !ticket.batchId.equals(current._id)) throw new ExamPreloginError('ticket_not_found');
                assertTicketIntegrity(ticket);
                tickets.push(ticket);
            }
            const resumeSessions = await input.validateCurrent(tickets);
            const resumeKeys = Object.keys(resumeSessions).sort();
            if (resumeKeys.length !== requestedTicketIds.length || resumeKeys.some((ticketId, index) => ticketId !== requestedTicketIds[index])) {
                throw new ExamPreloginError('retry_session_validation_invalid');
            }
            for (const ticketId of requestedTicketIds) {
                if (resumeSessions[ticketId] !== null) canonicalText(resumeSessions[ticketId], 'resume_session_id', 128);
            }
            for (let index = 0; index < tickets.length; index++) {
                const ticket = tickets[index];
                const resumeSessionId = resumeSessions[ticket._id.toHexString()];
                if (ticket.state === 'redeemed') {
                    if (!resumeSessionId) throw new ExamPreloginError('retry_redeemed_session_missing');
                } else {
                    if (resumeSessionId) throw new ExamPreloginError('retry_session_identity_conflict');
                    if (!recoveringSavedRetry && now >= ticket.expiresAt) {
                        tickets[index] = await this.renewExpiredTicket(ticket, now, requestId);
                    }
                }
            }
            const payload: ExamPreloginRetryPayload = {
                schemaVersion: EXAM_PRELOGIN_SCHEMA_VERSION,
                requestId,
                idempotencyKey: `exam-prelogin-retry:${current._id.toHexString()}:${requestId}`,
                batchId: current._id.toHexString(),
                originalRequestId: current.requestId,
                expectedProjectionRevision: input.expectedProjectionRevision,
                ticketIds: requestedTicketIds,
                tickets: tickets.map((ticket) => ({
                    ticketId: ticket._id.toHexString(),
                    ticketDigest: ticket.ticketDigest,
                    expiresAt: ticket.expiresAt.toISOString(),
                    resumeSessionId: resumeSessions[ticket._id.toHexString()],
                })),
            };
            const projection = canonicalProjection(await this.dependencies.retry(payload), current);
            const applied = await this.applyProjection(domainId, input.eventId, current._id, projection);
            return { batch: applied.batch, projection: applied.batch.projection!, ticketIds: tickets.map((ticket) => ticket._id) };
        });
    }

    private async renewExpiredTicket(ticket: ExamPreloginTicketDoc, issuedAt: Date, requestId: string): Promise<ExamPreloginTicketDoc> {
        if (ticket.state !== 'issued') throw new ExamPreloginError('retry_redeemed_ticket_expired');
        const nonce = createHmac('sha256', Buffer.from(this.dependencies.ticketKey, 'hex'))
            .update(`renew\0${ticket._id.toHexString()}\0${ticket.fingerprint}\0${requestId}\0${issuedAt.toISOString()}`, 'utf8')
            .digest('hex')
            .slice(0, 32);
        const withoutDigest: Omit<ExamPreloginTicketDoc, 'fingerprint' | 'ticketDigest'> = {
            ...ticket,
            nonce,
            issuedAt,
            expiresAt: new Date(issuedAt.getTime() + EXAM_PRELOGIN_TICKET_TTL_MS),
            state: 'issued',
            redemptionRequestId: null,
            redeemedAt: null,
        };
        const unsigned = { ...withoutDigest, ticketDigest: '' } as ExamPreloginTicketDoc;
        const canonical: Omit<ExamPreloginTicketDoc, 'fingerprint'> = {
            ...withoutDigest,
            ticketDigest: sha256(ticketMaterial(unsigned, this.dependencies.ticketKey)),
        };
        const target = { ...canonical, fingerprint: ticketFingerprint(canonical) };
        assertTicketIntegrity(target);
        const replaced = await this.tickets.replaceOne(ticket, target);
        if (replaced.matchedCount === 1) return target;
        const winner = await this.tickets.findOne({ _id: ticket._id });
        if (!winner) throw new ExamPreloginError('ticket_renewal_ack_unknown');
        assertTicketIntegrity(winner);
        if (JSON.stringify(winner) !== JSON.stringify(target)) throw new ExamPreloginError('ticket_renewal_conflict');
        return winner;
    }

    async applyProjection(
        domainId: string,
        eventId: ObjectId,
        batchId: ObjectId,
        value: unknown,
    ): Promise<{ batch: ExamPreloginBatchDoc; changed: boolean }> {
        const canonicalDomainId = canonicalText(domainId, 'domain_id', 64);
        assertObjectId(eventId, 'event_id');
        assertObjectId(batchId, 'batch_id');
        return withRequestBoundary(`${canonicalDomainId}\0${batchId.toHexString()}`, async () => {
            const current = await this.batches.findOne({ domainId: canonicalDomainId, eventId, _id: batchId });
            if (!current) throw new ExamPreloginError('batch_not_found');
            assertBatchIntegrity(current);
            if (current.state !== 'dispatched' || !current.projection) throw new ExamPreloginError('batch_not_dispatched');
            const projection = canonicalProjection(value, current);
            if (projection.projectionRevision < current.projection.projectionRevision) {
                throw new ExamPreloginError('projection_revision_stale');
            }
            if (projection.projectionRevision === current.projection.projectionRevision) {
                if (JSON.stringify(projection) !== JSON.stringify(current.projection)) {
                    throw new ExamPreloginError('projection_revision_conflict');
                }
                return { batch: current, changed: false };
            }

            const previousByTicket = new Map(current.projection.items.map((item) => [item.ticketId, item]));
            const stageOrder: Record<ExamPreloginStage, number> = {
                dispatch: 0,
                launch: 1,
                process_ready: 2,
                redeemed: 3,
                page_ready: 4,
            };
            const retryableStatuses = new Set<ExamPreloginDispatchStatus>(['expired', 'failed', 'offline', 'rejected']);
            for (const item of projection.items) {
                const previous = previousByTicket.get(item.ticketId);
                if (!previous || previous.endpointId !== item.endpointId) {
                    throw new ExamPreloginError('prelogin_projection_identity_mismatch');
                }
                const ticket = await this.tickets.findOne({ _id: new ObjectId(item.ticketId) });
                if (!ticket) throw new ExamPreloginError('ticket_not_found');
                assertTicketIntegrity(ticket);
                if (!ticket.batchId.equals(current._id) || ticket.endpointId !== item.endpointId) {
                    throw new ExamPreloginError('prelogin_projection_identity_mismatch');
                }
                const commandChanged = previous.commandId !== item.commandId;
                if (commandChanged && !retryableStatuses.has(previous.status)) {
                    throw new ExamPreloginError('projection_command_changed');
                }
                if (!commandChanged && stageOrder[item.stage] < stageOrder[previous.stage]) {
                    throw new ExamPreloginError('projection_stage_regressed');
                }
                if (previous.status === 'applied' && item.status !== 'applied') {
                    throw new ExamPreloginError('projection_success_regressed');
                }
                if (!commandChanged && retryableStatuses.has(previous.status) && item.status !== previous.status) {
                    throw new ExamPreloginError('projection_terminal_changed');
                }
            }

            const updatedAt = canonicalDate(this.now(), 'now');
            if (updatedAt < current.updatedAt) throw new ExamPreloginError('clock_rollback');
            const canonical: Omit<ExamPreloginBatchDoc, 'fingerprint'> = {
                ...current,
                revision: current.revision + 1,
                projection,
                updatedAt,
            };
            const target = { ...canonical, fingerprint: batchFingerprint(canonical) };
            assertBatchIntegrity(target);
            try {
                const replaced = await this.batches.replaceOne(current, target);
                if (replaced.matchedCount === 1) return { batch: target, changed: true };
            } catch (error) {
                const winner = await this.batches.findOne({ _id: current._id });
                if (winner) {
                    assertBatchIntegrity(winner);
                    if (JSON.stringify(winner) === JSON.stringify(target)) return { batch: winner, changed: true };
                }
                throw error;
            }
            const winner = await this.batches.findOne({ _id: current._id });
            if (!winner) throw new ExamPreloginError('batch_cas_conflict');
            assertBatchIntegrity(winner);
            if (JSON.stringify(winner) === JSON.stringify(target)) return { batch: winner, changed: true };
            throw new ExamPreloginError('batch_cas_conflict');
        });
    }

    async apply(domainId: string): Promise<void> {
        await settleDomainCleanupOperations(domainId, [() => this.batches.deleteMany({ domainId }), () => this.tickets.deleteMany({ domainId })]);
    }
}

export const examPreloginBatchColl = db.collection<ExamPreloginBatchDoc>('exam.preloginBatches');
export const examPreloginTicketColl = db.collection<ExamPreloginTicketDoc>('exam.preloginTickets');

export async function apply(ctx: any): Promise<void> {
    await Promise.all([
        examPreloginBatchColl.createIndex({ domainId: 1, requestId: 1 }, { name: 'examPreloginRequest', unique: true }),
        examPreloginBatchColl.createIndex(
            {
                domainId: 1,
                eventId: 1,
                'assignment.assignmentId': 1,
                'assignment.revision': 1,
                publicationRevision: 1,
            },
            {
                name: 'examPreloginPublishedAssignment',
                unique: true,
                partialFilterExpression: { workflow: { $type: 'object' } },
            },
        ),
        examPreloginBatchColl.createIndex({ domainId: 1, eventId: 1, createdAt: -1 }, { name: 'examPreloginEvent' }),
        examPreloginTicketColl.createIndex({ batchId: 1, endpointId: 1 }, { name: 'examPreloginBatchEndpoint', unique: true }),
        examPreloginTicketColl.createIndex({ domainId: 1, eventId: 1, state: 1, expiresAt: 1 }, { name: 'examPreloginEventState' }),
    ]);
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => examPreloginBatchColl.deleteMany({ domainId }),
            () => examPreloginTicketColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.examPrelogin = { examPreloginBatchColl, examPreloginTicketColl };
