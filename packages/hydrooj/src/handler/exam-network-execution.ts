import { lookup } from 'node:dns/promises';
import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, OplogModel, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { throwExamTeacherValidationError } from '../lib/exam-teacher-http-error';
import { PERM } from '../model/builtin';
import { resolveExamTargetSources } from '../lib/exam-network-resolver';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { ExamEventDoc, examEventDisplayStatus, examEventService } from '../model/exam-event';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { ExamNetworkAuditContext, runAuditedExamNetworkMutation } from '../model/exam-network-audit';
import { diffExamNetworkPolicies, ExamNetworkPolicyError, validateExamNetworkPolicyResolution } from '../model/exam-network-policy';
import {
    ExamNetworkConfigError,
    ExamNetworkRevisionRef,
    ExamPolicyRevision,
    ExamTargetRevision,
    examEventNetworkConfigColl,
    examPolicyTemplateColl,
    examTargetAssignmentColl,
    loadExamPolicyRevisionByFrozenRef,
    loadExamTargetRevisionByFrozenRef,
    registerExamNetworkControlPlaneResolver,
    registerExamTargetResolver,
    requireExamNetworkControlPlaneResolver,
} from '../model/exam-network-config';
import {
    ExamNetworkExecutionDoc,
    ExamNetworkExecutionError,
    examNetworkExecutionAuditRef,
    examNetworkExecutionService,
    isRetryableExamNetworkProjectionItem,
} from '../model/exam-network-execution';
import {
    classifyVigilBridgeFailure,
    dispatchExamNetworkOnVigil,
    getExamNetworkControlPlaneOnVigil,
    getExamNetworkRequestOnVigil,
    preflightExamNetworkOnVigil,
    VigilExamNetworkRequestPayload,
} from '../service/vigil-bridge';

interface ResolvedExecutionConfig {
    configRevision: number;
    policyRef: ExamNetworkRevisionRef;
    targetRef: ExamNetworkRevisionRef;
    policy: ExamPolicyRevision;
    target: ExamTargetRevision;
}

function auditContext(handler: Handler): ExamNetworkAuditContext {
    return {
        domainId: String(handler.domain._id),
        actorUid: handler.user._id,
        operateIp: handler.request.ip,
        path: handler.request.path,
        referer: handler.request.headers?.referer,
        userAgent: handler.request.headers?.['user-agent'],
    };
}

function serializeRef(value: ExamNetworkRevisionRef) {
    return { id: value.id.toHexString(), revision: value.revision, fingerprint: value.fingerprint };
}

function serializeExecution(execution: ExamNetworkExecutionDoc | null) {
    if (!execution) return null;
    return {
        executionId: execution._id.toHexString(),
        eventId: execution.eventId.toHexString(),
        schoolId: execution.schoolId.toHexString(),
        activityId: execution.activityId,
        revision: execution.revision,
        networkPolicyRevision: execution.networkPolicyRevision,
        desiredState: execution.desiredState,
        policyRef: serializeRef(execution.policyRef),
        targetRef: serializeRef(execution.targetRef),
        startAt: execution.startAt.toISOString(),
        hardEndAt: execution.hardEndAt.toISOString(),
        operation: {
            ...execution.operation,
            requestedAt: execution.operation.requestedAt.toISOString(),
            receivedAt: execution.operation.receivedAt?.toISOString() || null,
            failedAt: execution.operation.failedAt?.toISOString() || null,
            unknownAt: execution.operation.unknownAt?.toISOString() || null,
            failureReason: execution.operation.failureReason || null,
        },
        projection: execution.projection
            ? {
                  ...execution.projection,
                  receivedAt: execution.projection.receivedAt.toISOString(),
              }
            : null,
        auditRef: execution.auditRef,
        createdAt: execution.createdAt.toISOString(),
        updatedAt: execution.updatedAt.toISOString(),
    };
}

function sameRevisionRef(left: ExamNetworkRevisionRef, right: ExamNetworkRevisionRef): boolean {
    return left.id.equals(right.id) && left.revision === right.revision && left.fingerprint === right.fingerprint;
}

async function resolveUpdatePreview(domainId: string, eventId: ObjectId, execution: ExamNetworkExecutionDoc | null) {
    if (!execution) return null;
    const config = await examEventNetworkConfigColl.findOne({ domainId, eventId });
    if (!config?.policy || !config.target) return null;
    const [running, configured] = await Promise.all([
        resolveConfig(domainId, eventId, { policyRef: execution.policyRef, targetRef: execution.targetRef }),
        resolveConfig(domainId, eventId),
    ]);
    const policyChanged = !sameRevisionRef(execution.policyRef, configured.policyRef);
    const targetChanged = !sameRevisionRef(execution.targetRef, configured.targetRef);
    if (!policyChanged && !targetChanged) return null;
    const runningEndpoints = new Set(running.target.endpointIds);
    const configuredEndpoints = new Set(configured.target.endpointIds);
    return {
        executionRevision: execution.revision,
        configRevision: configured.configRevision,
        fromPolicyRef: serializeRef(execution.policyRef),
        toPolicyRef: serializeRef(configured.policyRef),
        fromTargetRef: serializeRef(execution.targetRef),
        toTargetRef: serializeRef(configured.targetRef),
        previousNetworkPolicyRevision: execution.networkPolicyRevision,
        expectedNetworkPolicyRevision: execution.networkPolicyRevision + 1,
        policyDiff: diffExamNetworkPolicies(running.policy.policy, configured.policy.policy),
        targetDiff: {
            beforeCount: running.target.targetCount,
            afterCount: configured.target.targetCount,
            addedEndpointIds: configured.target.endpointIds.filter((endpointId) => !runningEndpoints.has(endpointId)),
            removedEndpointIds: running.target.endpointIds.filter((endpointId) => !configuredEndpoints.has(endpointId)),
        },
        requiresStop: execution.desiredState === 'active' && targetChanged,
    };
}

function assertExactBody(handler: Handler, allowed: string[]): void {
    const body = handler.request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('body');
    const keys = Object.keys(body);
    if (keys.some((key) => !allowed.includes(key))) throw new ValidationError('body');
}

export function readUnsignedIntBody(handler: Handler, key: string): number | undefined {
    const body = handler.request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, key)) return undefined;
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ValidationError(key);
    return value;
}

async function resolveConfig(
    domainId: string,
    eventId: ObjectId,
    refs?: { policyRef: ExamNetworkRevisionRef; targetRef: ExamNetworkRevisionRef },
): Promise<ResolvedExecutionConfig> {
    const config = await examEventNetworkConfigColl.findOne({ domainId, eventId });
    const policyRef = refs?.policyRef || config?.policy;
    const targetRef = refs?.targetRef || config?.target;
    if (!config || !policyRef || !targetRef) throw new ExamNetworkExecutionError('network_configuration_incomplete');
    const [template, assignment] = await Promise.all([
        examPolicyTemplateColl.findOne({ domainId, _id: policyRef.id }),
        examTargetAssignmentColl.findOne({ domainId, _id: targetRef.id, eventId }),
    ]);
    if (!template) throw new ExamNetworkExecutionError('policy_revision_not_found');
    if (!assignment) throw new ExamNetworkExecutionError('target_revision_not_found');
    let policy: ExamPolicyRevision;
    let target: ExamTargetRevision;
    try {
        // Keep the handler's unscoped-school success set: frozen loaders use stored document schoolIds.
        [policy, target] = await Promise.all([
            loadExamPolicyRevisionByFrozenRef({
                domainId,
                schoolId: template.schoolId,
                reference: policyRef,
            }),
            loadExamTargetRevisionByFrozenRef({
                domainId,
                eventId,
                schoolId: assignment.schoolId,
                reference: targetRef,
            }),
        ]);
    } catch (error) {
        if (error instanceof ExamNetworkConfigError) {
            if (error.reason === 'target_revision_invalid') {
                const matched = assignment.revisions.find((revision) => revision.revision === targetRef.revision);
                if (!matched?.endpointIds?.length) throw new ExamNetworkExecutionError('empty_target');
            }
            throw new ExamNetworkExecutionError(error.reason);
        }
        throw error;
    }
    return {
        configRevision: config.revision,
        policyRef: { id: new ObjectId(policyRef.id), revision: policyRef.revision, fingerprint: policyRef.fingerprint },
        targetRef: { id: new ObjectId(targetRef.id), revision: targetRef.revision, fingerprint: targetRef.fingerprint },
        policy,
        target,
    };
}

function executionPayload(execution: ExamNetworkExecutionDoc, config: ResolvedExecutionConfig): VigilExamNetworkRequestPayload {
    return {
        requestId: execution.operation.requestId,
        idempotencyKey: execution.operation.idempotencyKey,
        domainId: execution.domainId,
        eventId: execution.eventId.toHexString(),
        executionId: execution._id.toHexString(),
        executionRevision: execution.revision,
        operation: execution.operation.kind,
        activityId: execution.activityId,
        networkPolicyRevision: execution.networkPolicyRevision,
        policyRef: serializeRef(execution.policyRef),
        targetRef: serializeRef(execution.targetRef),
        endpointIds: [...config.target.endpointIds],
        startAt: execution.startAt.toISOString(),
        hardEndAt: execution.hardEndAt.toISOString(),
        ...(execution.operation.kind === 'apply' ? { policy: config.policy.policy } : {}),
    };
}

const logger = new Logger('exam-network-execution');

function translateExecutionError(error: unknown): never {
    if (
        error instanceof ExamNetworkExecutionError
        || error instanceof ExamNetworkConfigError
        || error instanceof ExamNetworkPolicyError
    ) {
        logger.warn('Exam network execution rejected reason=%s', error.reason);
        throwExamTeacherValidationError('examNetworkExecution', error.reason);
    }
    throw error;
}

abstract class ExamNetworkExecutionBaseHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user) && !this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) {
            throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        }
    }

    protected async loadEvent(eventId: ObjectId): Promise<ExamEventDoc> {
        const domainId = String(this.domain._id);
        const event = await examEventService.get(domainId, eventId);
        if (!event) throw new ValidationError('eventId');
        await assertCanManageExamEvent(domainId, event, this.user);
        return event;
    }
}

class ExamNetworkExecutionHandler extends ExamNetworkExecutionBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const domainId = String(this.domain._id);
        await this.loadEvent(eventId);
        try {
            const execution = await examNetworkExecutionService.get(domainId, eventId);
            this.response.body = {
                execution: serializeExecution(execution),
                updatePreview: await resolveUpdatePreview(domainId, eventId, execution),
            };
        } catch (error) {
            translateExecutionError(error);
        }
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['preflight', 'refresh', 'retry', 'retryFailed', 'start', 'stop']))
    async post(_args: unknown, eventId: ObjectId, action: 'preflight' | 'refresh' | 'retry' | 'retryFailed' | 'start' | 'stop') {
        assertExactBody(
            this,
            action === 'preflight'
                ? ['action']
                : action === 'start'
                  ? ['action', 'expectedRevision', 'expectedConfigRevision']
                  : ['action', 'expectedRevision'],
        );
        const expectedRevision = readUnsignedIntBody(this, 'expectedRevision');
        const expectedConfigRevision = readUnsignedIntBody(this, 'expectedConfigRevision');
        const domainId = String(this.domain._id);
        try {
            const result = await withExamEventBoundary(domainId, eventId, async () => {
                const event = await this.loadEvent(eventId);
                if (
                    (action === 'preflight' || action === 'start') &&
                    (event.lifecycle !== 'scheduled' || examEventDisplayStatus(event) === 'ended')
                ) {
                    throw new ExamNetworkExecutionError('event_not_runnable');
                }
                const current = await examNetworkExecutionService.get(domainId, eventId);
                if (action === 'preflight') {
                    const configured = await resolveConfig(domainId, eventId);
                    return {
                        preflight: await preflightExamNetworkOnVigil(configured.target.endpointIds),
                        preflightConfig: {
                            revision: configured.configRevision,
                            policy: serializeRef(configured.policyRef),
                            target: serializeRef(configured.targetRef),
                        },
                        execution: current,
                    };
                }
                if (expectedRevision === undefined) throw new ExamNetworkExecutionError('expected_revision_required');
                if (action !== 'start' && expectedRevision < 1) throw new ExamNetworkExecutionError('invalid_revision');
                let execution: ExamNetworkExecutionDoc;
                if (action === 'start') {
                    if (expectedConfigRevision === undefined || expectedConfigRevision < 1) {
                        throw new ExamNetworkExecutionError('expected_config_revision_required');
                    }
                    const configured = await resolveConfig(domainId, eventId);
                    if (configured.configRevision !== expectedConfigRevision) {
                        throw new ExamNetworkExecutionError('config_revision_conflict');
                    }
                    const controlPlane = await requireExamNetworkControlPlaneResolver()();
                    await validateExamNetworkPolicyResolution(
                        configured.policy.policy,
                        async (hostname) =>
                            (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address),
                        controlPlane,
                    );
                    let startPreflight;
                    try {
                        startPreflight = await preflightExamNetworkOnVigil(configured.target.endpointIds);
                    } catch (error) {
                        const failure = classifyVigilBridgeFailure(error);
                        await OplogModel.log(this, 'exam.network.execution.preflight_failed', {
                            eventId,
                            configRevision: configured.configRevision,
                            targetRef: serializeRef(configured.targetRef),
                            stage: 'start',
                            failureReason: failure.reason,
                            errorName: failure.errorName,
                            ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
                        });
                        throw new ExamNetworkExecutionError(failure.reason);
                    }
                    await OplogModel.log(this, 'exam.network.execution.preflight', {
                        eventId,
                        configRevision: configured.configRevision,
                        targetRef: serializeRef(configured.targetRef),
                        targetCount: startPreflight.length,
                        readyCount: startPreflight.filter((item) => item.ready).length,
                        unready: startPreflight.filter((item) => !item.ready).map((item) => ({ endpointId: item.endpointId, reason: item.reason })),
                        stage: 'start',
                    });
                    const executionId = current?._id || new ObjectId();
                    const targetRevision = expectedRevision + 1;
                    execution = await runAuditedExamNetworkMutation(
                        auditContext(this),
                        'execution.apply',
                        {
                            eventId,
                            entityKind: 'execution',
                            entityId: executionId,
                            auditRef: examNetworkExecutionAuditRef(executionId, targetRevision),
                            expectedRevision,
                            observedRevision: current?.revision || null,
                            targetRevision,
                            fingerprint: configured.policyRef.fingerprint,
                            targetCount: configured.target.targetCount,
                        },
                        () =>
                            examNetworkExecutionService.beginApply({
                                executionId,
                                domainId,
                                eventId,
                                schoolId: event.schoolId,
                                expectedRevision,
                                actorUid: this.user._id,
                                policyRef: configured.policyRef,
                                targetRef: configured.targetRef,
                                startAt: event.startAt,
                                hardEndAt: event.endAt,
                            }),
                        (created) => ({
                            operation: created.operation.kind,
                            requestId: created.operation.requestId,
                            policyRef: serializeRef(created.policyRef),
                            targetRef: serializeRef(created.targetRef),
                        }),
                    );
                } else if (action === 'stop') {
                    if (!current) throw new ExamNetworkExecutionError('execution_not_found');
                    const targetRevision = expectedRevision + 1;
                    execution = await runAuditedExamNetworkMutation(
                        auditContext(this),
                        'execution.stop',
                        {
                            eventId,
                            entityKind: 'execution',
                            entityId: current._id,
                            auditRef: examNetworkExecutionAuditRef(current._id, targetRevision),
                            expectedRevision,
                            observedRevision: current.revision,
                            targetRevision,
                            fingerprint: current.policyRef.fingerprint,
                        },
                        () =>
                            examNetworkExecutionService.beginStop({
                                domainId,
                                eventId,
                                expectedRevision,
                                actorUid: this.user._id,
                            }),
                        (stopped) => ({ operation: stopped.operation.kind, requestId: stopped.operation.requestId }),
                    );
                } else if (action === 'retryFailed') {
                    if (!current) throw new ExamNetworkExecutionError('execution_not_found');
                    if (event.lifecycle === 'archived') throw new ExamNetworkExecutionError('event_archived');
                    if (current.desiredState === 'active') {
                        const configured = await resolveConfig(domainId, eventId);
                        if (!sameRevisionRef(current.policyRef, configured.policyRef) || !sameRevisionRef(current.targetRef, configured.targetRef)) {
                            throw new ExamNetworkExecutionError('retry_requires_current_config');
                        }
                    }
                    const retryEndpointIds =
                        current.projection?.items.filter(isRetryableExamNetworkProjectionItem).map((item) => item.endpointId) || [];
                    const targetRevision = expectedRevision + 1;
                    execution = await runAuditedExamNetworkMutation(
                        auditContext(this),
                        `execution.retry_${current.operation.kind}`,
                        {
                            eventId,
                            entityKind: 'execution',
                            entityId: current._id,
                            auditRef: examNetworkExecutionAuditRef(current._id, targetRevision),
                            expectedRevision,
                            observedRevision: current.revision,
                            targetRevision,
                            fingerprint: current.policyRef.fingerprint,
                            targetCount: current.projection?.items.length,
                        },
                        () =>
                            examNetworkExecutionService.beginRetry({
                                domainId,
                                eventId,
                                expectedRevision,
                                actorUid: this.user._id,
                            }),
                        (retried) => ({
                            operation: retried.operation.kind,
                            requestId: retried.operation.requestId,
                            networkPolicyRevision: retried.networkPolicyRevision,
                            retryMode: 'full_target',
                            retryEndpointIds,
                        }),
                    );
                } else {
                    if (!current) throw new ExamNetworkExecutionError('execution_not_found');
                    if (current.revision !== expectedRevision) throw new ExamNetworkExecutionError('revision_conflict');
                    execution = current;
                }
                let projection;
                try {
                    const payload = executionPayload(
                        execution,
                        await resolveConfig(domainId, eventId, {
                            policyRef: execution.policyRef,
                            targetRef: execution.targetRef,
                        }),
                    );
                    projection = action === 'refresh' ? await getExamNetworkRequestOnVigil(payload) : await dispatchExamNetworkOnVigil(payload);
                } catch (error) {
                    if (error instanceof ExamNetworkConfigError || error instanceof ExamNetworkExecutionError) throw error;
                    const failure = classifyVigilBridgeFailure(error);
                    if (failure.deliveryUnknown) {
                        await examNetworkExecutionService.markUnknown(
                            domainId,
                            eventId,
                            execution.revision,
                            execution.operation.requestId,
                            failure.reason,
                        );
                    } else {
                        await examNetworkExecutionService.markFailed(
                            domainId,
                            eventId,
                            execution.revision,
                            execution.operation.requestId,
                            failure.reason,
                        );
                    }
                    await OplogModel.log(this, `exam.network.execution.dispatch_${failure.deliveryUnknown ? 'unknown' : 'failed'}`, {
                        eventId,
                        executionId: execution._id,
                        executionRevision: execution.revision,
                        auditRef: execution.auditRef,
                        requestId: execution.operation.requestId,
                        operation: execution.operation.kind,
                        stage: action,
                        failureReason: failure.reason,
                        errorName: failure.errorName,
                        ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
                    });
                    throw new ExamNetworkExecutionError(failure.reason);
                }
                const applied = await examNetworkExecutionService.applyProjection(projection);
                await OplogModel.log(this, 'exam.network.execution.projection', {
                    eventId,
                    executionId: execution._id,
                    executionRevision: execution.revision,
                    auditRef: applied.execution.auditRef,
                    requestId: execution.operation.requestId,
                    projectionRevision: projection.projectionRevision,
                    changed: applied.changed,
                    stage: action,
                });
                return { execution: applied.execution };
            });
            this.response.body = {
                ...(result.preflight ? { preflight: result.preflight } : {}),
                ...(result.preflightConfig ? { preflightConfig: result.preflightConfig } : {}),
                execution: serializeExecution(result.execution),
            };
        } catch (error) {
            translateExecutionError(error);
        }
    }
}

export async function apply(ctx: Context) {
    ctx.effect(() => {
        const disposeTarget = registerExamTargetResolver(resolveExamTargetSources);
        const disposeControlPlane = registerExamNetworkControlPlaneResolver(getExamNetworkControlPlaneOnVigil);
        return () => {
            disposeControlPlane();
            disposeTarget();
        };
    });
    ctx.Route('exam_network_execution', '/api/admin/exam-events/:eventId/network-execution', ExamNetworkExecutionHandler);
}
