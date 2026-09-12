import { createHash } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import type { VigilExamNetworkProjection, VigilExamNetworkProjectionItem } from '../service/vigil-bridge';
import { ExamNetworkConfigError, ExamNetworkRevisionRef, loadExamTargetRevisionByFrozenRef } from './exam-network-config';

export type ExamNetworkExecutionOperation = 'apply' | 'stop';
export type ExamNetworkDispatchStatus = 'dispatching' | 'failed' | 'received' | 'unknown';

const RETRYABLE_ENDPOINT_STATUSES = new Set(['expired', 'failed', 'offline', 'rejected']);
const DELIVERY_UNKNOWN_FAILURE_REASON = 'transport_send_failed_delivery_unknown';

export interface ExamNetworkOperationFact {
    kind: ExamNetworkExecutionOperation;
    requestId: string;
    idempotencyKey: string;
    executionRevision: number;
    status: ExamNetworkDispatchStatus;
    requestedAt: Date;
    requestedBy: number;
    receivedAt?: Date;
    failedAt?: Date;
    unknownAt?: Date;
    failureReason?: string;
}

export interface ExamNetworkProjectionFact {
    revision: number;
    fingerprint: string;
    dispatchStatus: 'complete' | 'dispatching';
    summary: Record<string, number>;
    items: VigilExamNetworkProjectionItem[];
    receivedAt: Date;
}

export interface ExamNetworkExecutionDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    schoolId: ObjectId;
    activityId: string;
    revision: number;
    networkPolicyRevision: number;
    desiredState: 'active' | 'stopped';
    policyRef: ExamNetworkRevisionRef;
    targetRef: ExamNetworkRevisionRef;
    startAt: Date;
    hardEndAt: Date;
    operation: ExamNetworkOperationFact;
    projection?: ExamNetworkProjectionFact;
    auditRef: string;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
}

type ExecutionCollection = Pick<Collection<ExamNetworkExecutionDoc>, 'createIndex' | 'deleteMany' | 'findOne' | 'findOneAndUpdate' | 'insertOne'>;

interface TargetEndpointIdentity {
    eventId: ObjectId;
    schoolId: ObjectId;
}
type TargetEndpointResolver = (domainId: string, reference: ExamNetworkRevisionRef, identity?: TargetEndpointIdentity) => Promise<string[]>;

async function resolveApplyProjectionTargetEndpointIds(
    domainId: string,
    reference: ExamNetworkRevisionRef,
    identity?: TargetEndpointIdentity,
): Promise<string[]> {
    if (!identity) throw new TypeError('execution identity is required');
    const target = await loadExamTargetRevisionByFrozenRef({
        domainId,
        eventId: identity.eventId,
        schoolId: identity.schoolId,
        reference,
    });
    return [...target.endpointIds].sort();
}

export class ExamNetworkExecutionError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamNetworkExecutionError';
    }
}

function assertIdentity(domainId: string, eventId: ObjectId): void {
    if (!domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
    if (!(eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
}

function assertRevision(value: number, allowZero = false): void {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError('revision is invalid');
}

function assertUid(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('actorUid is invalid');
}

function cloneRef(value: ExamNetworkRevisionRef): ExamNetworkRevisionRef {
    if (!(value.id instanceof ObjectId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !/^[a-f0-9]{64}$/.test(value.fingerprint)) {
        throw new TypeError('revision reference is invalid');
    }
    return { id: new ObjectId(value.id), revision: value.revision, fingerprint: value.fingerprint };
}

function sameRef(left: ExamNetworkRevisionRef, right: ExamNetworkRevisionRef): boolean {
    return left.id.equals(right.id) && left.revision === right.revision && left.fingerprint === right.fingerprint;
}

function isCompleteExecutionRequest(current: ExamNetworkExecutionDoc): boolean {
    return (
        current.operation.status === 'received' &&
        current.projection?.dispatchStatus === 'complete' &&
        current.projection.items.every((item) => item.failureReason !== DELIVERY_UNKNOWN_FAILURE_REASON)
    );
}

export function isRetryableExamNetworkProjectionItem(item: Pick<VigilExamNetworkProjectionItem, 'status' | 'failureReason'>): boolean {
    return RETRYABLE_ENDPOINT_STATUSES.has(item.status) && item.failureReason !== DELIVERY_UNKNOWN_FAILURE_REASON;
}

export type EndpointPolicyOutcome = 'applied' | 'failed' | 'pending';

export interface EndpointPolicyHeartbeatDiagnosis {
    state: string;
    policyRevision: number | null;
    reason: string | null;
}

export interface EndpointPolicyStatus {
    endpointId: string;
    status: EndpointPolicyOutcome;
    expectedPolicyRevision: number;
    appliedPolicyRevision: number | null;
    commandStatus: VigilExamNetworkProjectionItem['status'] | null;
    failureReason: string | null;
    heartbeat: EndpointPolicyHeartbeatDiagnosis | null;
}

export interface EndpointPolicyStatusSnapshot {
    desiredState: ExamNetworkExecutionDoc['desiredState'];
    operationStatus: ExamNetworkDispatchStatus;
    dispatchStatus: ExamNetworkProjectionFact['dispatchStatus'] | null;
    expectedPolicyRevision: number;
    ready: boolean;
    appliedCount: number;
    failedCount: number;
    pendingCount: number;
    endpoints: EndpointPolicyStatus[];
}

function classifyEndpointPolicyOutcome(
    item: VigilExamNetworkProjectionItem | undefined,
    expectedPolicyRevision: number,
): EndpointPolicyOutcome {
    if (!item) return 'pending';
    if (item.status === 'applied' && item.appliedPolicyRevision === expectedPolicyRevision) return 'applied';
    if (item.status === 'expired' || item.status === 'failed' || item.status === 'offline' || item.status === 'rejected') return 'failed';
    return 'pending';
}

// Heartbeat/networkPolicyState is diagnostic only; applied/ready use command fields.

export function deriveEndpointPolicyStatus(
    execution: ExamNetworkExecutionDoc,
    endpointIds: readonly string[],
): EndpointPolicyStatusSnapshot {
    const expectedPolicyRevision = execution.networkPolicyRevision;
    const itemsByEndpointId = new Map<string, VigilExamNetworkProjectionItem>();
    for (const item of execution.projection?.items ?? []) {
        if (!itemsByEndpointId.has(item.endpointId)) itemsByEndpointId.set(item.endpointId, item);
    }
    const endpoints: EndpointPolicyStatus[] = endpointIds.map((endpointId) => {
        const item = itemsByEndpointId.get(endpointId);
        const heartbeatState = item?.networkPolicyState;
        return {
            endpointId,
            status: classifyEndpointPolicyOutcome(item, expectedPolicyRevision),
            expectedPolicyRevision,
            appliedPolicyRevision: item?.appliedPolicyRevision ?? null,
            commandStatus: item?.status ?? null,
            failureReason: item?.failureReason ?? null,
            heartbeat: heartbeatState
                ? {
                      state: heartbeatState.state,
                      policyRevision: heartbeatState.policyRevision ?? null,
                      reason: heartbeatState.reason ?? null,
                  }
                : null,
        };
    });
    const appliedCount = endpoints.filter((endpoint) => endpoint.status === 'applied').length;
    const failedCount = endpoints.filter((endpoint) => endpoint.status === 'failed').length;
    return {
        desiredState: execution.desiredState,
        operationStatus: execution.operation.status,
        dispatchStatus: execution.projection?.dispatchStatus ?? null,
        expectedPolicyRevision,
        ready:
            execution.operation.status === 'received' &&
            execution.projection?.dispatchStatus === 'complete' &&
            appliedCount === endpointIds.length,
        appliedCount,
        failedCount,
        pendingCount: endpointIds.length - appliedCount - failedCount,
        endpoints,
    };
}

function canonicalWindow(startAt: Date, hardEndAt: Date): { startAt: Date; hardEndAt: Date } {
    if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) throw new TypeError('startAt is invalid');
    if (!(hardEndAt instanceof Date) || !Number.isFinite(hardEndAt.getTime()) || hardEndAt <= startAt) {
        throw new TypeError('hardEndAt is invalid');
    }
    return { startAt: new Date(startAt), hardEndAt: new Date(hardEndAt) };
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function examNetworkExecutionAuditRef(executionId: ObjectId, revision: number): string {
    return `exam-network-execution:${executionId.toHexString()}:${revision}`;
}

function requestIdentity(executionId: ObjectId, revision: number, kind: ExamNetworkExecutionOperation) {
    const base = `${executionId.toHexString()}:${revision}:${kind}`;
    return {
        requestId: `exam-network:${base}`,
        idempotencyKey: `exam-network:${base}`,
    };
}

function projectionFingerprint(projection: VigilExamNetworkProjection): string {
    return sha256({
        dispatchStatus: projection.dispatchStatus,
        summary: projection.summary,
        items: projection.items,
    });
}

function eventDuplicate(error: unknown, domainId: string, eventId: ObjectId): boolean {
    if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== 11000) return false;
    const keyPattern = (error as { keyPattern?: unknown }).keyPattern;
    const keyValue = (error as { keyValue?: unknown }).keyValue;
    if (!keyPattern || typeof keyPattern !== 'object' || Array.isArray(keyPattern)) return false;
    if (!keyValue || typeof keyValue !== 'object' || Array.isArray(keyValue)) return false;
    const pattern = keyPattern as Record<string, unknown>;
    const value = keyValue as Record<string, unknown>;
    return (
        Object.keys(pattern).length === 2 &&
        pattern.domainId === 1 &&
        pattern.eventId === 1 &&
        value.domainId === domainId &&
        value.eventId instanceof ObjectId &&
        value.eventId.equals(eventId)
    );
}

export class ExamNetworkExecutionService {
    private indexesPromise?: Promise<void>;

    constructor(
        private readonly executions: ExecutionCollection,
        private readonly now: () => Date = () => new Date(),
        private readonly idFactory: () => ObjectId = () => new ObjectId(),
        private readonly targetEndpointResolver: TargetEndpointResolver = resolveApplyProjectionTargetEndpointIds,
    ) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.executions.createIndex({ domainId: 1, eventId: 1 }, { name: 'examNetworkExecutionEvent', unique: true }),
            this.executions.createIndex({ domainId: 1, activityId: 1 }, { name: 'examNetworkExecutionActivity', unique: true }),
            this.executions.createIndex({ domainId: 1, updatedAt: -1 }, { name: 'examNetworkExecutionUpdated' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    get(domainId: string, eventId: ObjectId): Promise<ExamNetworkExecutionDoc | null> {
        assertIdentity(domainId, eventId);
        return this.executions.findOne({ domainId, eventId });
    }

    async beginApply(input: {
        executionId?: ObjectId;
        domainId: string;
        eventId: ObjectId;
        schoolId: ObjectId;
        expectedRevision: number;
        actorUid: number;
        policyRef: ExamNetworkRevisionRef;
        targetRef: ExamNetworkRevisionRef;
        startAt: Date;
        hardEndAt: Date;
    }): Promise<ExamNetworkExecutionDoc> {
        assertIdentity(input.domainId, input.eventId);
        if (!(input.schoolId instanceof ObjectId)) throw new TypeError('schoolId must be an ObjectId');
        assertRevision(input.expectedRevision, true);
        assertUid(input.actorUid);
        const policyRef = cloneRef(input.policyRef);
        const targetRef = cloneRef(input.targetRef);
        const window = canonicalWindow(input.startAt, input.hardEndAt);
        const current = await this.executions.findOne({ domainId: input.domainId, eventId: input.eventId });
        const now = this.now();
        if (!current) {
            if (input.expectedRevision !== 0) throw new ExamNetworkExecutionError('revision_conflict');
            if (input.executionId !== undefined && !(input.executionId instanceof ObjectId)) {
                throw new TypeError('executionId must be an ObjectId');
            }
            const _id = input.executionId ? new ObjectId(input.executionId) : this.idFactory();
            const revision = 1;
            const identity = requestIdentity(_id, revision, 'apply');
            const doc: ExamNetworkExecutionDoc = {
                _id,
                domainId: input.domainId,
                eventId: new ObjectId(input.eventId),
                schoolId: new ObjectId(input.schoolId),
                activityId: `exam:${input.eventId.toHexString()}`,
                revision,
                networkPolicyRevision: 1,
                desiredState: 'active',
                policyRef,
                targetRef,
                ...window,
                operation: {
                    kind: 'apply',
                    ...identity,
                    executionRevision: revision,
                    status: 'dispatching',
                    requestedAt: now,
                    requestedBy: input.actorUid,
                },
                auditRef: examNetworkExecutionAuditRef(_id, revision),
                createdAt: now,
                createdBy: input.actorUid,
                updatedAt: now,
                updatedBy: input.actorUid,
            };
            try {
                await this.executions.insertOne(doc);
            } catch (error) {
                if (eventDuplicate(error, input.domainId, input.eventId)) throw new ExamNetworkExecutionError('revision_conflict');
                throw error;
            }
            return doc;
        }
        if (input.executionId && !current._id.equals(input.executionId)) throw new ExamNetworkExecutionError('execution_identity_mismatch');
        if (current.revision !== input.expectedRevision) throw new ExamNetworkExecutionError('revision_conflict');
        if (!current.schoolId.equals(input.schoolId)) throw new ExamNetworkExecutionError('event_school_mismatch');
        if (!isCompleteExecutionRequest(current)) throw new ExamNetworkExecutionError('current_request_unresolved');
        const targetChanged = !sameRef(current.targetRef, targetRef);
        if (targetChanged) {
            if (current.desiredState === 'active') throw new ExamNetworkExecutionError('target_change_requires_stop');
            const releaseConfirmed =
                current.operation.kind === 'stop' &&
                current.operation.status === 'received' &&
                current.projection?.dispatchStatus === 'complete' &&
                current.projection.items.length > 0 &&
                current.projection.items.every((item) => item.status === 'applied');
            if (!releaseConfirmed) throw new ExamNetworkExecutionError('target_release_unconfirmed');
        }
        if (sameRef(current.policyRef, policyRef) && current.desiredState === 'active') {
            throw new ExamNetworkExecutionError('network_policy_unchanged');
        }
        if (current.startAt.getTime() !== window.startAt.getTime() || current.hardEndAt.getTime() !== window.hardEndAt.getTime()) {
            throw new ExamNetworkExecutionError('activity_window_changed');
        }
        const revision = current.revision + 1;
        const identity = requestIdentity(current._id, revision, 'apply');
        const updated = await this.executions.findOneAndUpdate(
            { domainId: input.domainId, eventId: input.eventId, revision: input.expectedRevision },
            {
                $set: {
                    revision,
                    networkPolicyRevision: current.networkPolicyRevision + 1,
                    desiredState: 'active',
                    policyRef,
                    targetRef,
                    operation: {
                        kind: 'apply',
                        ...identity,
                        executionRevision: revision,
                        status: 'dispatching',
                        requestedAt: now,
                        requestedBy: input.actorUid,
                    },
                    auditRef: examNetworkExecutionAuditRef(current._id, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
                $unset: { projection: '' as const },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkExecutionError('revision_conflict');
        return updated;
    }

    async beginStop(input: { domainId: string; eventId: ObjectId; expectedRevision: number; actorUid: number }): Promise<ExamNetworkExecutionDoc> {
        assertIdentity(input.domainId, input.eventId);
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const current = await this.executions.findOne({ domainId: input.domainId, eventId: input.eventId });
        if (!current) throw new ExamNetworkExecutionError('execution_not_found');
        if (current.revision !== input.expectedRevision) throw new ExamNetworkExecutionError('revision_conflict');
        if (current.desiredState !== 'active') throw new ExamNetworkExecutionError('execution_not_active');
        const revision = current.revision + 1;
        const now = this.now();
        const identity = requestIdentity(current._id, revision, 'stop');
        const updated = await this.executions.findOneAndUpdate(
            { domainId: input.domainId, eventId: input.eventId, revision: input.expectedRevision, desiredState: 'active' },
            {
                $set: {
                    revision,
                    desiredState: 'stopped',
                    operation: {
                        kind: 'stop',
                        ...identity,
                        executionRevision: revision,
                        status: 'dispatching',
                        requestedAt: now,
                        requestedBy: input.actorUid,
                    },
                    auditRef: examNetworkExecutionAuditRef(current._id, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
                $unset: { projection: '' as const },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkExecutionError('revision_conflict');
        return updated;
    }

    async beginRetry(input: { domainId: string; eventId: ObjectId; expectedRevision: number; actorUid: number }): Promise<ExamNetworkExecutionDoc> {
        assertIdentity(input.domainId, input.eventId);
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const current = await this.executions.findOne({ domainId: input.domainId, eventId: input.eventId });
        if (!current) throw new ExamNetworkExecutionError('execution_not_found');
        if (current.revision !== input.expectedRevision) throw new ExamNetworkExecutionError('revision_conflict');
        if (
            current.operation.status !== 'received' ||
            current.projection?.dispatchStatus !== 'complete' ||
            current.projection.items.some((item) => item.failureReason === DELIVERY_UNKNOWN_FAILURE_REASON) ||
            !current.projection.items.some(isRetryableExamNetworkProjectionItem)
        ) {
            throw new ExamNetworkExecutionError('endpoint_retry_not_available');
        }
        const kind = current.desiredState === 'active' ? 'apply' : 'stop';
        if (current.operation.kind !== kind) throw new ExamNetworkExecutionError('execution_state_mismatch');
        const revision = current.revision + 1;
        const networkPolicyRevision = kind === 'apply' ? current.networkPolicyRevision + 1 : current.networkPolicyRevision;
        const now = this.now();
        const identity = requestIdentity(current._id, revision, kind);
        const updated = await this.executions.findOneAndUpdate(
            {
                domainId: input.domainId,
                eventId: input.eventId,
                revision: input.expectedRevision,
                desiredState: current.desiredState,
            },
            {
                $set: {
                    revision,
                    networkPolicyRevision,
                    operation: {
                        kind,
                        ...identity,
                        executionRevision: revision,
                        status: 'dispatching',
                        requestedAt: now,
                        requestedBy: input.actorUid,
                    },
                    auditRef: examNetworkExecutionAuditRef(current._id, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
                $unset: { projection: '' as const },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkExecutionError('revision_conflict');
        return updated;
    }

    async markUnknown(
        domainId: string,
        eventId: ObjectId,
        executionRevision: number,
        requestId: string,
        reason: string,
    ): Promise<ExamNetworkExecutionDoc> {
        assertIdentity(domainId, eventId);
        assertRevision(executionRevision);
        if (!requestId || !reason) throw new TypeError('unknown dispatch identity is invalid');
        const now = this.now();
        const updated = await this.executions.findOneAndUpdate(
            {
                domainId,
                eventId,
                revision: executionRevision,
                'operation.requestId': requestId,
                'operation.status': { $in: ['dispatching', 'failed', 'unknown'] },
            },
            {
                $set: {
                    'operation.status': 'unknown',
                    'operation.unknownAt': now,
                    'operation.failureReason': reason,
                    updatedAt: now,
                },
                $unset: { 'operation.failedAt': '' },
            },
            { returnDocument: 'after' },
        );
        if (updated) return updated;
        const current = await this.executions.findOne({ domainId, eventId });
        if (!current) throw new ExamNetworkExecutionError('execution_not_found');
        if (current.revision !== executionRevision || current.operation.requestId !== requestId) {
            throw new ExamNetworkExecutionError('revision_conflict');
        }
        return current;
    }

    async markFailed(
        domainId: string,
        eventId: ObjectId,
        executionRevision: number,
        requestId: string,
        reason: string,
    ): Promise<ExamNetworkExecutionDoc> {
        assertIdentity(domainId, eventId);
        assertRevision(executionRevision);
        if (!requestId || !reason) throw new TypeError('failed dispatch identity is invalid');
        const now = this.now();
        const updated = await this.executions.findOneAndUpdate(
            {
                domainId,
                eventId,
                revision: executionRevision,
                'operation.requestId': requestId,
                'operation.status': { $in: ['dispatching', 'unknown'] },
            },
            {
                $set: {
                    'operation.status': 'failed',
                    'operation.failedAt': now,
                    'operation.failureReason': reason,
                    updatedAt: now,
                },
                $unset: { 'operation.unknownAt': '' },
            },
            { returnDocument: 'after' },
        );
        if (updated) return updated;
        const current = await this.executions.findOne({ domainId, eventId });
        if (!current) throw new ExamNetworkExecutionError('execution_not_found');
        if (current.revision !== executionRevision || current.operation.requestId !== requestId) {
            throw new ExamNetworkExecutionError('revision_conflict');
        }
        return current;
    }

    async applyProjection(projection: VigilExamNetworkProjection): Promise<{ execution: ExamNetworkExecutionDoc; changed: boolean }> {
        if (!ObjectId.isValid(projection.eventId) || !ObjectId.isValid(projection.executionId)) {
            throw new ExamNetworkExecutionError('projection_identity_mismatch');
        }
        const eventId = new ObjectId(projection.eventId);
        const current = await this.executions.findOne({ domainId: projection.domainId, eventId });
        if (!current) throw new ExamNetworkExecutionError('execution_not_found');
        if (current._id.equals(projection.executionId) && projection.executionRevision < current.revision) {
            return { execution: current, changed: false };
        }
        if (
            !current._id.equals(projection.executionId) ||
            current.revision !== projection.executionRevision ||
            current.operation.executionRevision !== projection.executionRevision ||
            current.operation.requestId !== projection.requestId ||
            current.operation.idempotencyKey !== projection.idempotencyKey ||
            current.operation.kind !== projection.operation ||
            current.activityId !== projection.activityId ||
            current.networkPolicyRevision !== projection.networkPolicyRevision ||
            !sameRef(current.policyRef, {
                id: new ObjectId(projection.policyRef.id),
                revision: projection.policyRef.revision,
                fingerprint: projection.policyRef.fingerprint,
            }) ||
            !sameRef(current.targetRef, {
                id: new ObjectId(projection.targetRef.id),
                revision: projection.targetRef.revision,
                fingerprint: projection.targetRef.fingerprint,
            }) ||
            current.hardEndAt.toISOString() !== new Date(projection.hardEndAt).toISOString()
        ) {
            throw new ExamNetworkExecutionError('projection_identity_mismatch');
        }
        let canonicalEndpointIds: string[];
        try {
            canonicalEndpointIds = await this.targetEndpointResolver(current.domainId, current.targetRef, {
                eventId: current.eventId,
                schoolId: current.schoolId,
            });
        } catch (error) {
            if (error instanceof ExamNetworkConfigError) throw new ExamNetworkExecutionError('projection_target_mismatch');
            throw error;
        }
        const projectedEndpointIds = projection.items.map((item) => item.endpointId).sort();
        const canonicalEndpointSet = new Set(canonicalEndpointIds);
        const targetMismatch =
            projectedEndpointIds.some((endpointId) => !canonicalEndpointSet.has(endpointId)) ||
            (projection.dispatchStatus === 'complete' &&
                (canonicalEndpointIds.length !== projectedEndpointIds.length ||
                    canonicalEndpointIds.some((endpointId, index) => endpointId !== projectedEndpointIds[index])));
        if (targetMismatch) {
            throw new ExamNetworkExecutionError('projection_target_mismatch');
        }
        const fingerprint = projectionFingerprint(projection);
        if (current.projection && projection.projectionRevision < current.projection.revision) return { execution: current, changed: false };
        if (current.projection?.revision === projection.projectionRevision) {
            if (current.projection.fingerprint !== fingerprint) throw new ExamNetworkExecutionError('projection_revision_conflict');
            return { execution: current, changed: false };
        }
        const now = this.now();
        const updated = await this.executions.findOneAndUpdate(
            {
                domainId: projection.domainId,
                eventId,
                revision: projection.executionRevision,
                'operation.requestId': projection.requestId,
                ...(current.projection ? { 'projection.revision': current.projection.revision } : { projection: { $exists: false } }),
            },
            {
                $set: {
                    projection: {
                        revision: projection.projectionRevision,
                        fingerprint,
                        dispatchStatus: projection.dispatchStatus,
                        summary: { ...projection.summary },
                        items: projection.items.map((item) => ({
                            ...item,
                            networkPolicyState: item.networkPolicyState ? { ...item.networkPolicyState } : null,
                        })),
                        receivedAt: now,
                    },
                    'operation.status': projection.dispatchStatus === 'complete' ? 'received' : 'unknown',
                    ...(projection.dispatchStatus === 'complete'
                        ? { 'operation.receivedAt': now }
                        : { 'operation.unknownAt': now, 'operation.failureReason': 'vigil_dispatch_incomplete' }),
                    updatedAt: now,
                },
                ...(projection.dispatchStatus === 'complete'
                    ? { $unset: { 'operation.failedAt': '', 'operation.failureReason': '', 'operation.unknownAt': '' } }
                    : {}),
            },
            { returnDocument: 'after' },
        );
        if (updated) return { execution: updated, changed: true };
        const latest = await this.executions.findOne({ domainId: projection.domainId, eventId });
        if (!latest) throw new ExamNetworkExecutionError('execution_not_found');
        if (latest.revision !== projection.executionRevision || latest.operation.requestId !== projection.requestId) {
            throw new ExamNetworkExecutionError('revision_conflict');
        }
        if (latest.projection && latest.projection.revision > projection.projectionRevision) return { execution: latest, changed: false };
        if (latest.projection?.revision === projection.projectionRevision && latest.projection.fingerprint === fingerprint) {
            return { execution: latest, changed: false };
        }
        throw new ExamNetworkExecutionError('projection_revision_conflict');
    }
}

export const examNetworkExecutionColl = db.collection<ExamNetworkExecutionDoc>('exam.networkExecutions');
export const examNetworkExecutionService = new ExamNetworkExecutionService(examNetworkExecutionColl);

interface ExecutionModelContext {
    on(event: string, callback: (domainId: string) => Promise<void>): void;
}

export async function apply(ctx: ExecutionModelContext): Promise<void> {
    await examNetworkExecutionService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await examNetworkExecutionColl.deleteMany({ domainId });
    });
}

global.Hydro.model.examNetworkExecution = {
    examNetworkExecutionColl,
    examNetworkExecutionService,
};
