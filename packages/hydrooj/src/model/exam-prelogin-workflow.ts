import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { ExamEventDoc } from './exam-event';
import {
    ExamNetworkConfigError,
    ExamNetworkRevisionRef,
    examNetworkConfigService,
    examPolicyTemplateColl,
    examTargetAssignmentColl,
} from './exam-network-config';
import { ExamNetworkExecutionDoc, examNetworkExecutionService } from './exam-network-execution';
import { ExamPreloginError, ExamPreloginPreparation, ExamPreloginWorkflowBinding } from './exam-prelogin';
import { loadExamPreloginPreparation } from './exam-prelogin-loader';
import { preflightExamMonitoringOnVigil, preflightExamPreloginOnVigil, VigilMonitoringPreflightItem } from '../service/vigil-bridge';

export interface ExamPreloginWorkflowNetworkIdentity {
    source: 'config' | 'execution';
    configRevision: number | null;
    executionRevision: number;
    policy: ExamNetworkRevisionRef;
    target: ExamNetworkRevisionRef;
    targetCount: number;
    startAt: Date;
    hardEndAt: Date;
    ready: boolean;
    reason: 'network_execution_expired' | 'network_execution_failed' | 'network_execution_not_active' | 'network_execution_pending' | 'ready';
    appliedCount: number;
    failedCount: number;
    pendingCount: number;
    preloginEndpointCount: number;
    coveredPreloginCount: number;
    missingPreloginEndpointIds: string[];
}

export interface ExamPreloginWorkflowSnapshot {
    schemaVersion: 1;
    preparation: ExamPreloginPreparation;
    network: ExamPreloginWorkflowNetworkIdentity;
    monitoring: {
        ready: boolean;
        items: VigilMonitoringPreflightItem[];
    };
    hardErrorCount: number;
    warningCount: number;
    fingerprint: string;
}

export interface ExamPreloginWorkflowDependencies {
    loadPreparation: typeof loadExamPreloginPreparation;
    getConfig: typeof examNetworkConfigService.getEventConfig;
    getExecution: typeof examNetworkExecutionService.get;
    loadNetworkReferences: (
        event: ExamEventDoc,
        policy: ExamNetworkRevisionRef,
        target: ExamNetworkRevisionRef,
    ) => Promise<{ endpointIds: string[]; targetCount: number }>;
    preflightMonitoring: typeof preflightExamMonitoringOnVigil;
    now: () => Date;
}

const defaultDependencies: ExamPreloginWorkflowDependencies = {
    loadPreparation: loadExamPreloginPreparation,
    getConfig: examNetworkConfigService.getEventConfig.bind(examNetworkConfigService),
    getExecution: examNetworkExecutionService.get.bind(examNetworkExecutionService),
    loadNetworkReferences,
    preflightMonitoring: preflightExamMonitoringOnVigil,
    now: () => new Date(),
};

function canonicalCompare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isExpectedExamPreflightDetectorWarning(warning: Pick<VigilMonitoringPreflightItem['warnings'][number], 'detector' | 'reason'>): boolean {
    return (
        (warning.detector === 'process' &&
            (warning.reason === 'process_path_partial_access_denied' || warning.reason === 'process_path_partial_query_failed')) ||
        (warning.detector === 'foreground' && warning.reason === 'foreground_interactive_session_required')
    );
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalRef(value: ExamNetworkRevisionRef, field: string): ExamNetworkRevisionRef {
    if (
        !value ||
        !(value.id instanceof ObjectId) ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 1 ||
        typeof value.fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.fingerprint)
    ) {
        throw new ExamPreloginError(`${field}_invalid`);
    }
    return { id: new ObjectId(value.id), revision: value.revision, fingerprint: value.fingerprint };
}

function canonicalWindow(startAt: unknown, hardEndAt: unknown): { startAt: Date; hardEndAt: Date } {
    if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) throw new ExamPreloginError('network_window_invalid');
    if (!(hardEndAt instanceof Date) || !Number.isFinite(hardEndAt.getTime()) || hardEndAt <= startAt) {
        throw new ExamPreloginError('network_window_invalid');
    }
    return { startAt: new Date(startAt), hardEndAt: new Date(hardEndAt) };
}

async function loadNetworkReferences(
    event: ExamEventDoc,
    policyRef: ExamNetworkRevisionRef,
    targetRef: ExamNetworkRevisionRef,
): Promise<{ endpointIds: string[]; targetCount: number }> {
    const policy = canonicalRef(policyRef, 'network_policy_reference');
    const target = canonicalRef(targetRef, 'network_target_reference');
    const [template, assignment] = await Promise.all([
        examPolicyTemplateColl.findOne({ domainId: event.domainId, _id: policy.id, schoolId: event.schoolId }),
        examTargetAssignmentColl.findOne({ domainId: event.domainId, _id: target.id, eventId: event._id, schoolId: event.schoolId }),
    ]);
    const policyRevision = template?.revisions.filter((revision) => revision.revision === policy.revision) || [];
    const targetRevision = assignment?.revisions.filter((revision) => revision.revision === target.revision) || [];
    if (policyRevision.length !== 1 || policyRevision[0].fingerprint !== policy.fingerprint) {
        throw new ExamNetworkConfigError('policy_revision_not_found');
    }
    if (targetRevision.length !== 1 || targetRevision[0].targetFingerprint !== target.fingerprint) {
        throw new ExamNetworkConfigError('target_revision_not_found');
    }
    const endpoints = targetRevision[0].endpointIds;
    if (
        !Array.isArray(endpoints) ||
        !endpoints.length ||
        endpoints.length > 500 ||
        new Set(endpoints).size !== endpoints.length ||
        endpoints.some(
            (endpointId) => typeof endpointId !== 'string' || !endpointId || endpointId !== endpointId.trim() || endpointId.length > 128,
        ) ||
        targetRevision[0].targetCount !== endpoints.length
    ) {
        throw new ExamNetworkConfigError('target_revision_invalid');
    }
    return { endpointIds: [...endpoints], targetCount: endpoints.length };
}

function assertExecutionIdentity(event: ExamEventDoc, execution: ExamNetworkExecutionDoc): void {
    if (
        execution.domainId !== event.domainId ||
        !execution.eventId.equals(event._id) ||
        !execution.schoolId.equals(event.schoolId) ||
        !Number.isSafeInteger(execution.revision) ||
        execution.revision < 1 ||
        (execution.desiredState !== 'active' && execution.desiredState !== 'stopped') ||
        !execution.operation ||
        execution.operation.executionRevision !== execution.revision
    ) {
        throw new ExamPreloginError('network_execution_invalid');
    }
}

function activeExecutionReadiness(
    execution: ExamNetworkExecutionDoc,
    endpointIds: string[],
): Pick<ExamPreloginWorkflowNetworkIdentity, 'appliedCount' | 'failedCount' | 'pendingCount' | 'ready' | 'reason'> {
    if (execution.operation.kind !== 'apply') throw new ExamPreloginError('network_execution_invalid');
    if (!execution.projection) {
        return {
            ready: false,
            reason: 'network_execution_pending',
            appliedCount: 0,
            failedCount: 0,
            pendingCount: endpointIds.length,
        };
    }
    if (
        !Number.isSafeInteger(execution.projection.revision) ||
        execution.projection.revision < 1 ||
        (execution.projection.dispatchStatus !== 'complete' && execution.projection.dispatchStatus !== 'dispatching') ||
        !Array.isArray(execution.projection.items)
    ) {
        throw new ExamPreloginError('network_execution_invalid');
    }
    const endpointSet = new Set(endpointIds);
    if (
        execution.projection.items.length > endpointIds.length ||
        new Set(execution.projection.items.map((item) => item.endpointId)).size !== execution.projection.items.length ||
        execution.projection.items.some(
            (item) =>
                !endpointSet.has(item.endpointId) ||
                item.command !== 'apply_network_policy' ||
                item.expectedPolicyRevision !== execution.networkPolicyRevision,
        ) ||
        (execution.projection.dispatchStatus === 'complete' && execution.projection.items.length !== endpointIds.length)
    ) {
        throw new ExamPreloginError('network_execution_invalid');
    }
    const appliedCount = execution.projection.items.filter(
        (item) => item.status === 'applied' && item.appliedPolicyRevision === execution.networkPolicyRevision,
    ).length;
    const failedCount = execution.projection.items.filter(
        (item) => item.status === 'expired' || item.status === 'failed' || item.status === 'offline' || item.status === 'rejected',
    ).length;
    const pendingCount = endpointIds.length - appliedCount - failedCount;
    const ready =
        execution.operation.status === 'received' && execution.projection.dispatchStatus === 'complete' && appliedCount === endpointIds.length;
    return {
        ready,
        reason: ready ? 'ready' : failedCount ? 'network_execution_failed' : 'network_execution_pending',
        appliedCount,
        failedCount,
        pendingCount,
    };
}

async function loadNetworkIdentity(
    event: ExamEventDoc,
    dependencies: ExamPreloginWorkflowDependencies,
): Promise<{ network: ExamPreloginWorkflowNetworkIdentity; targetEndpointIds: string[] }> {
    const [config, execution] = await Promise.all([
        dependencies.getConfig(event.domainId, event._id),
        dependencies.getExecution(event.domainId, event._id),
    ]);
    if (execution) assertExecutionIdentity(event, execution);
    if (execution?.desiredState === 'active') {
        const policy = canonicalRef(execution.policyRef, 'network_policy_reference');
        const target = canonicalRef(execution.targetRef, 'network_target_reference');
        const window = canonicalWindow(execution.startAt, execution.hardEndAt);
        const references = await dependencies.loadNetworkReferences(event, policy, target);
        const observedAt = dependencies.now();
        if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw new ExamPreloginError('workflow_time_invalid');
        const readiness = activeExecutionReadiness(execution, references.endpointIds);
        if (window.hardEndAt <= observedAt) {
            readiness.ready = false;
            readiness.reason = 'network_execution_expired';
        }
        return {
            network: {
                source: 'execution',
                configRevision: null,
                executionRevision: execution.revision,
                policy,
                target,
                targetCount: references.targetCount,
                ...readiness,
                preloginEndpointCount: 0,
                coveredPreloginCount: 0,
                missingPreloginEndpointIds: [],
                ...window,
            },
            targetEndpointIds: references.endpointIds,
        };
    }
    if (
        !config ||
        config.domainId !== event.domainId ||
        !config.eventId.equals(event._id) ||
        !Number.isSafeInteger(config.revision) ||
        config.revision < 1 ||
        !config.policy ||
        !config.target
    ) {
        throw new ExamPreloginError('network_configuration_incomplete');
    }
    const policy = canonicalRef(config.policy, 'network_policy_reference');
    const target = canonicalRef(config.target, 'network_target_reference');
    const references = await dependencies.loadNetworkReferences(event, policy, target);
    return {
        network: {
            source: 'config',
            configRevision: config.revision,
            executionRevision: execution?.revision || 0,
            policy,
            target,
            targetCount: references.targetCount,
            ready: false,
            reason: 'network_execution_not_active',
            appliedCount: 0,
            failedCount: 0,
            pendingCount: references.targetCount,
            preloginEndpointCount: 0,
            coveredPreloginCount: 0,
            missingPreloginEndpointIds: [],
            ...canonicalWindow(event.startAt, event.endAt),
        },
        targetEndpointIds: references.endpointIds,
    };
}

function workflowFingerprint(input: Omit<ExamPreloginWorkflowSnapshot, 'fingerprint'>): string {
    return sha256({
        schemaVersion: input.schemaVersion,
        preparationFingerprint: input.preparation.fingerprint,
        network: {
            source: input.network.source,
            configRevision: input.network.configRevision,
            executionRevision: input.network.executionRevision,
            policy: {
                id: input.network.policy.id.toHexString(),
                revision: input.network.policy.revision,
                fingerprint: input.network.policy.fingerprint,
            },
            target: {
                id: input.network.target.id.toHexString(),
                revision: input.network.target.revision,
                fingerprint: input.network.target.fingerprint,
            },
            targetCount: input.network.targetCount,
            startAt: input.network.startAt.toISOString(),
            hardEndAt: input.network.hardEndAt.toISOString(),
            ready: input.network.ready,
            reason: input.network.reason,
            missingPreloginEndpointIds: input.network.missingPreloginEndpointIds,
            preloginEndpointCount: input.network.preloginEndpointCount,
            coveredPreloginCount: input.network.coveredPreloginCount,
        },
        monitoring: input.monitoring.items.map((item) => ({
            endpointId: item.endpointId,
            ready: item.ready,
            reason: item.reason,
        })),
    });
}

export async function loadExamPreloginWorkflow(
    event: ExamEventDoc,
    assignmentRevision: number,
    dependencies: ExamPreloginWorkflowDependencies = defaultDependencies,
): Promise<ExamPreloginWorkflowSnapshot> {
    const preparation = await dependencies.loadPreparation(event, assignmentRevision, preflightExamPreloginOnVigil);
    const loadedNetwork = await loadNetworkIdentity(event, dependencies);
    const endpointIds = preparation.items.map((item) => item.endpointId).filter((endpointId): endpointId is string => endpointId !== null);
    if (new Set(endpointIds).size !== endpointIds.length) throw new ExamPreloginError('preparation_endpoint_duplicate');
    const targetEndpointSet = new Set(loadedNetwork.targetEndpointIds);
    const missingPreloginEndpointIds = endpointIds.filter((endpointId) => !targetEndpointSet.has(endpointId)).sort(canonicalCompare);
    const network: ExamPreloginWorkflowNetworkIdentity = {
        ...loadedNetwork.network,
        preloginEndpointCount: endpointIds.length,
        coveredPreloginCount: endpointIds.length - missingPreloginEndpointIds.length,
        missingPreloginEndpointIds,
    };
    const monitoringItems = endpointIds.length ? await dependencies.preflightMonitoring(endpointIds) : [];
    if (monitoringItems.length !== endpointIds.length || monitoringItems.some((item, index) => item.endpointId !== endpointIds[index])) {
        throw new ExamPreloginError('monitoring_preflight_identity_mismatch');
    }
    const visibleMonitoringItems = monitoringItems.map((item) => ({
        ...item,
        warnings: item.warnings.filter((warning) => !isExpectedExamPreflightDetectorWarning(warning)),
    }));
    const monitoring = { ready: visibleMonitoringItems.every((item) => item.ready), items: visibleMonitoringItems };
    const hardErrorCount =
        preparation.hardErrorCount +
        visibleMonitoringItems.filter((item) => !item.ready).length +
        (network.ready ? 0 : 1) +
        missingPreloginEndpointIds.length;
    const warningCount = preparation.warningCount + visibleMonitoringItems.reduce((count, item) => count + item.warnings.length, 0);
    const canonical: Omit<ExamPreloginWorkflowSnapshot, 'fingerprint'> = {
        schemaVersion: 1,
        preparation,
        network,
        monitoring,
        hardErrorCount,
        warningCount,
    };
    return { ...canonical, fingerprint: workflowFingerprint(canonical) };
}

export async function validateExamPreloginRetryWorkflow(
    event: ExamEventDoc,
    binding: ExamPreloginWorkflowBinding,
    endpointIds: string[],
    dependencies: ExamPreloginWorkflowDependencies = defaultDependencies,
): Promise<void> {
    if (!endpointIds.length || endpointIds.length > 500 || new Set(endpointIds).size !== endpointIds.length) {
        throw new ExamPreloginError('retry_endpoint_identity_invalid');
    }
    const execution = await dependencies.getExecution(event.domainId, event._id);
    if (!execution) throw new ExamPreloginError('network_execution_not_active');
    assertExecutionIdentity(event, execution);
    if (execution.desiredState !== 'active' || execution.revision !== binding.executionRevision) {
        throw new ExamPreloginError('network_execution_changed');
    }
    const policy = canonicalRef(execution.policyRef, 'network_policy_reference');
    const target = canonicalRef(execution.targetRef, 'network_target_reference');
    const window = canonicalWindow(execution.startAt, execution.hardEndAt);
    if (
        !policy.id.equals(binding.policy.id) ||
        policy.revision !== binding.policy.revision ||
        policy.fingerprint !== binding.policy.fingerprint ||
        !target.id.equals(binding.target.id) ||
        target.revision !== binding.target.revision ||
        target.fingerprint !== binding.target.fingerprint ||
        window.startAt.getTime() !== binding.startAt.getTime() ||
        window.hardEndAt.getTime() !== binding.hardEndAt.getTime()
    ) {
        throw new ExamPreloginError('network_execution_changed');
    }
    const references = await dependencies.loadNetworkReferences(event, policy, target);
    const targetEndpointIds = new Set(references.endpointIds);
    if (references.targetCount !== binding.targetCount || endpointIds.some((endpointId) => !targetEndpointIds.has(endpointId))) {
        throw new ExamPreloginError('network_target_changed');
    }
    const observedAt = dependencies.now();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw new ExamPreloginError('workflow_time_invalid');
    if (window.hardEndAt <= observedAt) throw new ExamPreloginError('network_execution_expired');
    if (!activeExecutionReadiness(execution, references.endpointIds).ready) throw new ExamPreloginError('network_execution_not_ready');
    const monitoringItems = await dependencies.preflightMonitoring(endpointIds);
    if (
        monitoringItems.length !== endpointIds.length ||
        monitoringItems.some((item, index) => item.endpointId !== endpointIds[index]) ||
        monitoringItems.some((item) => !item.ready)
    ) {
        throw new ExamPreloginError('monitoring_preflight_blocked');
    }
}
