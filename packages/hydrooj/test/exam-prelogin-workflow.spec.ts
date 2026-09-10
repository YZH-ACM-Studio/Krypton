import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import type { ExamEventDoc } from '../src/model/exam-event';
import type { ExamNetworkExecutionDoc } from '../src/model/exam-network-execution';
import type { ExamPreloginPreparation } from '../src/model/exam-prelogin';
import type { ExamPreloginWorkflowDependencies } from '../src/model/exam-prelogin-workflow';
import type { VigilMonitoringPreflightItem, VigilMonitoringWarning } from '../src/service/vigil-bridge';

(global as unknown as { Hydro: { model: Record<string, unknown>; module: Record<string, unknown>; ui: Record<string, unknown> } }).Hydro ||= {
    model: {},
    module: {},
    ui: {},
};
function stub(modulePath: string, exports: Record<string, unknown>): void {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeModule;
}
async function preflightExamPreloginOnVigil() {
    return [];
}
stub('../src/service/db.ts', { __esModule: true, default: { collection: () => ({}) } });
stub('../src/service/vigil-bridge.ts', {
    preflightExamMonitoringOnVigil: async () => [],
    preflightExamPreloginOnVigil,
});
stub('../src/model/exam-prelogin-loader.ts', { loadExamPreloginPreparation: async () => undefined });
const { createExamPreloginPreparation } = require('../src/model/exam-prelogin') as typeof import('../src/model/exam-prelogin');
const { loadExamPreloginWorkflow, validateExamPreloginRetryWorkflow } =
    require('../src/model/exam-prelogin-workflow') as typeof import('../src/model/exam-prelogin-workflow');

const eventId = new ObjectId('66c100000000000000000001');
const schoolId = new ObjectId('66c100000000000000000002');
const assignmentId = new ObjectId('66c100000000000000000003');
const studentRecordId = new ObjectId('66c100000000000000000004');
const bindingId = new ObjectId('66c100000000000000000005');
const policyId = new ObjectId('66c100000000000000000006');
const targetId = new ObjectId('66c100000000000000000007');
const executionPolicyId = new ObjectId('66c100000000000000000008');
const executionTargetId = new ObjectId('66c100000000000000000009');
const fingerprint = 'a'.repeat(64);

const event: ExamEventDoc = {
    _id: eventId,
    domainId: 'system',
    schoolId,
    title: 'P2.9 workflow test',
    type: 'krypton',
    contestId: new ObjectId('66c10000000000000000000a'),
    lifecycle: 'scheduled',
    startAt: new Date('2026-08-14T01:00:00.000Z'),
    endAt: new Date('2026-08-14T03:00:00.000Z'),
    ownerUid: 2,
    collaboratorUids: [],
    revision: 4,
    auditRef: 'exam-event:66c100000000000000000001:4',
    createdAt: new Date('2026-08-13T01:00:00.000Z'),
    createdBy: 2,
    updatedAt: new Date('2026-08-13T01:00:00.000Z'),
    updatedBy: 2,
};

function preparation(): ExamPreloginPreparation {
    return createExamPreloginPreparation({
        schemaVersion: 1,
        domainId: event.domainId,
        eventId,
        eventRevision: event.revision,
        assignment: { assignmentId, revision: 3, fingerprint },
        publicationRevision: 2,
        workspace: { kind: 'contest', contestId: event.contestId!.toHexString(), path: `/exam-mode/${event.contestId!.toHexString()}` },
        items: [
            {
                uid: 42,
                studentRecordId,
                sourceSeatId: 'seat-1',
                bindingId,
                bindingRevision: 5,
                endpointId: 'ep_one',
                ready: true,
                diagnostics: [],
                endpoint: {
                    online: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: null,
                },
            },
        ],
        hardErrorCount: 0,
        warningCount: 0,
    });
}

function dependencies(monitoringWarnings: VigilMonitoringWarning[] = []): ExamPreloginWorkflowDependencies {
    return {
        loadPreparation: async (_event, _revision, preflight) => {
            assert.equal(preflight.name, 'preflightExamPreloginOnVigil');
            return preparation();
        },
        getConfig: async () => ({
            _id: new ObjectId('66c10000000000000000000b'),
            domainId: event.domainId,
            eventId,
            revision: 7,
            auditRef: 'exam-network-config:66c100000000000000000001:7',
            policy: { id: policyId, revision: 2, fingerprint },
            target: { id: targetId, revision: 3, fingerprint },
            createdAt: event.createdAt,
            createdBy: 2,
            updatedAt: event.updatedAt,
            updatedBy: 2,
        }),
        getExecution: async () => null,
        loadNetworkReferences: async () => ({
            endpointIds: ['ep_one', ...Array.from({ length: 97 }, (_, index) => `ep_network_${index}`)],
            targetCount: 98,
        }),
        preflightMonitoring: async (endpointIds) => {
            assert.deepEqual(endpointIds, ['ep_one']);
            return [
                {
                    endpointId: 'ep_one',
                    ready: true,
                    reason: 'ready',
                    credentialStatus: 'active',
                    online: true,
                    compatible: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [
                        { name: 'exam.monitoring', version: 1, commands: ['start_monitoring', 'stop_monitoring', 'get_monitoring_status'] },
                    ],
                    warnings: monitoringWarnings,
                },
            ];
        },
        now: () => new Date('2026-08-13T00:00:00.000Z'),
    };
}

function monitoringItem(overrides: Partial<VigilMonitoringPreflightItem> = {}): VigilMonitoringPreflightItem {
    return {
        endpointId: 'ep_one',
        ready: true,
        reason: 'ready',
        credentialStatus: 'active',
        online: true,
        compatible: true,
        serviceVersion: '0.5.0',
        protocolVersion: 2,
        capabilities: [
            { name: 'exam.monitoring', version: 1, commands: ['start_monitoring', 'stop_monitoring', 'get_monitoring_status'] },
        ],
        warnings: [],
        ...overrides,
    };
}

function activeExecution(projection: ExamNetworkExecutionDoc['projection']): ExamNetworkExecutionDoc {
    return {
        _id: new ObjectId('66c10000000000000000000c'),
        domainId: event.domainId,
        eventId,
        schoolId,
        activityId: `exam:${eventId.toHexString()}`,
        revision: 9,
        networkPolicyRevision: 3,
        desiredState: 'active',
        policyRef: { id: executionPolicyId, revision: 4, fingerprint: 'b'.repeat(64) },
        targetRef: { id: executionTargetId, revision: 5, fingerprint: 'c'.repeat(64) },
        startAt: new Date('2026-08-14T00:30:00.000Z'),
        hardEndAt: new Date('2026-08-14T03:30:00.000Z'),
        operation: {
            kind: 'apply',
            requestId: 'exam-network:test',
            idempotencyKey: 'exam-network:test',
            executionRevision: 9,
            status: 'received',
            requestedAt: event.updatedAt,
            requestedBy: 2,
            receivedAt: event.updatedAt,
        },
        projection,
        auditRef: 'exam-network-execution:66c10000000000000000000c:9',
        createdAt: event.createdAt,
        createdBy: 2,
        updatedAt: event.updatedAt,
        updatedBy: 2,
    };
}

function appliedProjection(): NonNullable<ExamNetworkExecutionDoc['projection']> {
    return {
        revision: 1,
        fingerprint: 'd'.repeat(64),
        dispatchStatus: 'complete',
        summary: { applied: 1 },
        items: [
            {
                commandId: 'network-command-1',
                endpointId: 'ep_one',
                executionSessionId: 'session-1',
                commandRevision: 9,
                command: 'apply_network_policy',
                previousPolicyRevision: null,
                expectedPolicyRevision: 3,
                appliedPolicyRevision: 3,
                status: 'applied',
                failureReason: null,
                online: true,
                networkPolicyState: { state: 'active', activityId: `exam:${eventId.toHexString()}`, policyRevision: 3 },
            },
        ],
        receivedAt: event.updatedAt,
    };
}

async function loadWorkflowWithExecution(execution: ExamNetworkExecutionDoc) {
    const frozen = dependencies();
    frozen.getExecution = async () => execution;
    frozen.loadNetworkReferences = async () => ({ endpointIds: ['ep_one'], targetCount: 1 });
    return loadExamPreloginWorkflow(event, 3, frozen);
}

test('workflow derives endpoint monitoring from the published preparation and excludes warnings from its drift fingerprint', async () => {
    const clean = await loadExamPreloginWorkflow(event, 3, dependencies());
    const warned = await loadExamPreloginWorkflow(event, 3, dependencies([{ kind: 'usb_storage_detected', detector: null, reason: null }]));
    assert.equal(clean.network.source, 'config');
    assert.equal(clean.network.configRevision, 7);
    assert.equal(clean.network.executionRevision, 0);
    assert.equal(clean.network.targetCount, 98);
    assert.equal(clean.network.preloginEndpointCount, 1);
    assert.equal(clean.network.coveredPreloginCount, 1);
    assert.deepEqual(clean.network.missingPreloginEndpointIds, []);
    assert.equal(clean.network.reason, 'network_execution_not_active');
    assert.equal(clean.hardErrorCount, 1);
    assert.equal(warned.warningCount, 1);
    assert.equal(warned.fingerprint, clean.fingerprint);
});

test('workflow hides expected session-0 detector noise from warning counts', async () => {
    const noisy = await loadExamPreloginWorkflow(
        event,
        3,
        dependencies([
            { kind: 'detector_degraded', detector: 'process', reason: 'process_path_partial_query_failed' },
            { kind: 'detector_failed', detector: 'foreground', reason: 'foreground_interactive_session_required' },
        ]),
    );
    const real = await loadExamPreloginWorkflow(
        event,
        3,
        dependencies([{ kind: 'detector_failed', detector: 'process', reason: 'process_snapshot_failed_5' }]),
    );
    assert.equal(noisy.warningCount, 0);
    assert.deepEqual(noisy.monitoring.items[0].warnings, []);
    assert.equal(real.warningCount, 1);
    assert.equal(real.monitoring.items[0].warnings[0].reason, 'process_snapshot_failed_5');
    assert.equal(noisy.fingerprint, real.fingerprint);
});

test('workflow hard readiness and network identity participate in the fingerprint', async () => {
    const readyDependencies = dependencies();
    const ready = await loadExamPreloginWorkflow(event, 3, readyDependencies);
    const offlineDependencies = dependencies();
    offlineDependencies.preflightMonitoring = async () => [
        monitoringItem({ ready: false, reason: 'endpoint_offline', online: false, capabilities: [] }),
    ];
    const offline = await loadExamPreloginWorkflow(event, 3, offlineDependencies);
    assert.equal(offline.hardErrorCount, 2);
    assert.equal(offline.monitoring.ready, false);
    assert.notEqual(offline.fingerprint, ready.fingerprint);
});

test('workflow fingerprint ignores Vigil display listings while network.ready still binds confirm', async () => {
    const baseline = await loadExamPreloginWorkflow(event, 3, dependencies());
    const displayDependencies = dependencies();
    displayDependencies.preflightMonitoring = async () => [
        monitoringItem({
            credentialStatus: 'pending',
            online: false,
            compatible: false,
            serviceVersion: '0.9.9',
            protocolVersion: 1,
            capabilities: [
                { name: 'network.policy', version: 1, commands: ['apply'] },
                { name: 'exam.monitoring', version: 9, commands: ['get_monitoring_status'] },
            ],
        }),
    ];
    const display = await loadExamPreloginWorkflow(event, 3, displayDependencies);
    assert.equal(display.monitoring.items[0].serviceVersion, '0.9.9');
    assert.equal(display.monitoring.items[0].ready, true);
    assert.equal(display.fingerprint, baseline.fingerprint);

    const applied = await loadWorkflowWithExecution(activeExecution(appliedProjection()));
    const pending = await loadWorkflowWithExecution(activeExecution(undefined));
    assert.equal(applied.network.ready, true);
    assert.equal(applied.network.reason, 'ready');
    assert.equal(pending.network.ready, false);
    assert.equal(pending.network.reason, 'network_execution_pending');
    assert.equal(applied.network.executionRevision, pending.network.executionRevision);
    assert.notEqual(pending.fingerprint, applied.fingerprint);
});

test('an active execution freezes the running policy, target and hard deadline instead of following newer config refs', async () => {
    const frozenDependencies = dependencies();
    frozenDependencies.getExecution = async () => ({
        _id: new ObjectId('66c10000000000000000000c'),
        domainId: event.domainId,
        eventId,
        schoolId,
        activityId: `exam:${eventId.toHexString()}`,
        revision: 9,
        networkPolicyRevision: 3,
        desiredState: 'active',
        policyRef: { id: executionPolicyId, revision: 4, fingerprint: 'b'.repeat(64) },
        targetRef: { id: executionTargetId, revision: 5, fingerprint: 'c'.repeat(64) },
        startAt: new Date('2026-08-14T00:30:00.000Z'),
        hardEndAt: new Date('2026-08-14T03:30:00.000Z'),
        operation: {
            kind: 'apply',
            requestId: 'exam-network:test',
            idempotencyKey: 'exam-network:test',
            executionRevision: 9,
            status: 'received',
            requestedAt: event.updatedAt,
            requestedBy: 2,
            receivedAt: event.updatedAt,
        },
        projection: {
            revision: 1,
            fingerprint: 'd'.repeat(64),
            dispatchStatus: 'complete',
            summary: { applied: 1 },
            items: [
                {
                    commandId: 'network-command-1',
                    endpointId: 'ep_one',
                    executionSessionId: 'session-1',
                    commandRevision: 9,
                    command: 'apply_network_policy',
                    previousPolicyRevision: null,
                    expectedPolicyRevision: 3,
                    appliedPolicyRevision: 3,
                    status: 'applied',
                    failureReason: null,
                    online: true,
                    networkPolicyState: { state: 'active', activityId: `exam:${eventId.toHexString()}`, policyRevision: 3 },
                },
            ],
            receivedAt: event.updatedAt,
        },
        auditRef: 'exam-network-execution:66c10000000000000000000c:9',
        createdAt: event.createdAt,
        createdBy: 2,
        updatedAt: event.updatedAt,
        updatedBy: 2,
    });
    let observedPolicy = '';
    let observedTarget = '';
    frozenDependencies.loadNetworkReferences = async (_event, policy, target) => {
        observedPolicy = policy.id.toHexString();
        observedTarget = target.id.toHexString();
        return { endpointIds: ['ep_one'], targetCount: 1 };
    };
    const workflow = await loadExamPreloginWorkflow(event, 3, frozenDependencies);
    assert.equal(workflow.network.source, 'execution');
    assert.equal(workflow.network.configRevision, null);
    assert.equal(workflow.network.executionRevision, 9);
    assert.equal(workflow.network.ready, true);
    assert.equal(workflow.network.reason, 'ready');
    assert.equal(observedPolicy, executionPolicyId.toHexString());
    assert.equal(observedTarget, executionTargetId.toHexString());
    assert.equal(workflow.network.hardEndAt.toISOString(), '2026-08-14T03:30:00.000Z');

    const binding = {
        fingerprint: workflow.fingerprint,
        executionRevision: workflow.network.executionRevision,
        policy: workflow.network.policy,
        target: workflow.network.target,
        targetCount: workflow.network.targetCount,
        startAt: workflow.network.startAt,
        hardEndAt: workflow.network.hardEndAt,
    };
    await validateExamPreloginRetryWorkflow(event, binding, ['ep_one'], frozenDependencies);
    const stoppedDependencies = { ...frozenDependencies };
    stoppedDependencies.getExecution = async () => ({
        ...(await frozenDependencies.getExecution(event.domainId, eventId))!,
        desiredState: 'stopped',
    });
    await assert.rejects(validateExamPreloginRetryWorkflow(event, binding, ['ep_one'], stoppedDependencies), /network_execution_changed/);
    const failedMonitoringDependencies = { ...frozenDependencies };
    failedMonitoringDependencies.preflightMonitoring = async () => [
        {
            endpointId: 'ep_one',
            ready: false,
            reason: 'monitoring_state_failed',
            credentialStatus: 'active',
            online: true,
            compatible: true,
            serviceVersion: '0.5.0',
            protocolVersion: 2,
            capabilities: [{ name: 'exam.monitoring', version: 1, commands: ['start_monitoring', 'stop_monitoring', 'get_monitoring_status'] }],
            warnings: [],
        },
    ];
    await assert.rejects(validateExamPreloginRetryWorkflow(event, binding, ['ep_one'], failedMonitoringDependencies), /monitoring_preflight_blocked/);
});

test('workflow blocks prelogin when the frozen network target omits a prepared endpoint', async () => {
    const uncovered = dependencies();
    uncovered.loadNetworkReferences = async () => ({ endpointIds: ['ep_other'], targetCount: 1 });
    const workflow = await loadExamPreloginWorkflow(event, 3, uncovered);
    assert.equal(workflow.network.preloginEndpointCount, 1);
    assert.equal(workflow.network.coveredPreloginCount, 0);
    assert.deepEqual(workflow.network.missingPreloginEndpointIds, ['ep_one']);
    assert.equal(workflow.hardErrorCount, 2);
});

test('workflow rejects an otherwise applied execution after its hard deadline', async () => {
    const expired = dependencies();
    const active = dependencies();
    active.getExecution = async () => ({
        _id: new ObjectId('66c10000000000000000000d'),
        domainId: event.domainId,
        eventId,
        schoolId,
        activityId: `exam:${eventId.toHexString()}`,
        revision: 2,
        networkPolicyRevision: 1,
        desiredState: 'active',
        policyRef: { id: executionPolicyId, revision: 1, fingerprint },
        targetRef: { id: executionTargetId, revision: 1, fingerprint },
        startAt: new Date('2026-08-13T00:00:00.000Z'),
        hardEndAt: new Date('2026-08-13T01:00:00.000Z'),
        operation: {
            kind: 'apply',
            requestId: 'exam-network:expired',
            idempotencyKey: 'exam-network:expired',
            executionRevision: 2,
            status: 'received',
            requestedAt: event.updatedAt,
            requestedBy: 2,
            receivedAt: event.updatedAt,
        },
        projection: {
            revision: 1,
            fingerprint: 'd'.repeat(64),
            dispatchStatus: 'complete',
            summary: { applied: 1 },
            items: [
                {
                    commandId: 'network-command-expired',
                    endpointId: 'ep_one',
                    executionSessionId: 'session-expired',
                    commandRevision: 2,
                    command: 'apply_network_policy',
                    previousPolicyRevision: null,
                    expectedPolicyRevision: 1,
                    appliedPolicyRevision: 1,
                    status: 'applied',
                    failureReason: null,
                    online: true,
                    networkPolicyState: { state: 'active', activityId: `exam:${eventId.toHexString()}`, policyRevision: 1 },
                },
            ],
            receivedAt: event.updatedAt,
        },
        auditRef: 'exam-network-execution:expired:2',
        createdAt: event.createdAt,
        createdBy: 2,
        updatedAt: event.updatedAt,
        updatedBy: 2,
    });
    active.loadNetworkReferences = async () => ({ endpointIds: ['ep_one'], targetCount: 1 });
    active.now = () => new Date('2026-08-13T01:00:00.000Z');
    Object.assign(expired, active);
    const workflow = await loadExamPreloginWorkflow(event, 3, expired);
    assert.equal(workflow.network.ready, false);
    assert.equal(workflow.network.reason, 'network_execution_expired');
    assert.equal(workflow.hardErrorCount, 1);
});

test('workflow keeps one canonical 500-endpoint preparation without client-side chunking', async () => {
    const large = dependencies();
    const endpointIds = Array.from({ length: 500 }, (_, index) => `ep_${String(index).padStart(3, '0')}`);
    large.loadPreparation = async () =>
        createExamPreloginPreparation({
            schemaVersion: 1,
            domainId: event.domainId,
            eventId,
            eventRevision: event.revision,
            assignment: { assignmentId, revision: 3, fingerprint },
            publicationRevision: 2,
            workspace: { kind: 'contest', contestId: event.contestId!.toHexString(), path: `/exam-mode/${event.contestId!.toHexString()}` },
            items: endpointIds.map((endpointId, index) => ({
                uid: index + 2,
                studentRecordId: new ObjectId((0x1000 + index).toString(16).padStart(24, '0')),
                sourceSeatId: `seat-${index}`,
                bindingId: new ObjectId((0x2000 + index).toString(16).padStart(24, '0')),
                bindingRevision: 1,
                endpointId,
                ready: true,
                diagnostics: [],
                endpoint: {
                    online: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: null,
                },
            })),
            hardErrorCount: 0,
            warningCount: 0,
        });
    large.loadNetworkReferences = async () => ({ endpointIds, targetCount: endpointIds.length });
    let monitoringCalls = 0;
    large.preflightMonitoring = async (requested) => {
        monitoringCalls += 1;
        assert.deepEqual(requested, endpointIds);
        return requested.map((endpointId) => ({
            endpointId,
            ready: true,
            reason: 'ready',
            credentialStatus: 'active',
            online: true,
            compatible: true,
            serviceVersion: '0.5.0',
            protocolVersion: 2,
            capabilities: [{ name: 'exam.monitoring', version: 1, commands: ['start_monitoring', 'stop_monitoring', 'get_monitoring_status'] }],
            warnings: [],
        }));
    };
    const workflow = await loadExamPreloginWorkflow(event, 3, large);
    assert.equal(workflow.preparation.items.length, 500);
    assert.equal(workflow.monitoring.items.length, 500);
    assert.equal(monitoringCalls, 1);
});
