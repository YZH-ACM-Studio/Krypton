import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamNetworkExecutionDoc } from '../src/model/exam-network-execution';

(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => ({}) } },
} as NodeModule;
const { deriveEndpointPolicyStatus } = require('../src/model/exam-network-execution.ts') as typeof import('../src/model/exam-network-execution');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const eventId = new ObjectId('66b900000000000000000901');
const schoolId = new ObjectId('66b900000000000000000902');
const policyId = new ObjectId('66b900000000000000000903');
const targetId = new ObjectId('66b900000000000000000904');
const executionId = new ObjectId('66b900000000000000000905');
const now = new Date('2026-08-11T02:00:00.000Z');

type ProjectionItem = NonNullable<ExamNetworkExecutionDoc['projection']>['items'][number];

function item(overrides: Partial<ProjectionItem> = {}): ProjectionItem {
    return {
        commandId: 'examnet_1',
        endpointId: 'ep_one',
        executionSessionId: 'session_one',
        commandRevision: 1,
        command: 'apply_network_policy',
        previousPolicyRevision: null,
        expectedPolicyRevision: 3,
        appliedPolicyRevision: null,
        status: 'sent',
        failureReason: null,
        online: true,
        networkPolicyState: { state: 'inactive', reason: 'initialized', permitRuleCount: 0 },
        ...overrides,
    };
}

function execution(overrides: Partial<ExamNetworkExecutionDoc> = {}): ExamNetworkExecutionDoc {
    return {
        _id: executionId,
        domainId: 'system',
        eventId,
        schoolId,
        activityId: `exam:${eventId.toHexString()}`,
        revision: 1,
        networkPolicyRevision: 3,
        desiredState: 'active',
        policyRef: { id: policyId, revision: 1, fingerprint: 'a'.repeat(64) },
        targetRef: { id: targetId, revision: 1, fingerprint: 'b'.repeat(64) },
        startAt: new Date('2026-08-11T06:00:00.000Z'),
        hardEndAt: new Date('2026-08-11T08:00:00.000Z'),
        operation: {
            kind: 'apply',
            requestId: 'exam-network:test',
            idempotencyKey: 'exam-network:test',
            executionRevision: 1,
            status: 'received',
            requestedAt: now,
            requestedBy: 1,
            receivedAt: now,
        },
        projection: {
            revision: 1,
            fingerprint: 'c'.repeat(64),
            dispatchStatus: 'complete',
            summary: {},
            items: [item()],
            receivedAt: now,
        },
        auditRef: 'exam-network-execution:test:1',
        createdAt: now,
        createdBy: 1,
        updatedAt: now,
        updatedBy: 1,
        ...overrides,
    };
}

function withItems(items: ProjectionItem[], extra: Partial<NonNullable<ExamNetworkExecutionDoc['projection']>> = {}) {
    const current = execution();
    return execution({
        projection: {
            ...current.projection!,
            items,
            ...extra,
        },
    });
}

describe('exam network endpoint policy status', () => {
    it('keeps sent command facts pending even when heartbeat reports the expected revision', () => {
        const snapshot = deriveEndpointPolicyStatus(
            withItems([
                item({
                    status: 'sent',
                    appliedPolicyRevision: null,
                    networkPolicyState: { state: 'active', policyRevision: 3, reason: 'heartbeat_observed' },
                }),
            ]),
            ['ep_one'],
        );
        expect(snapshot).to.include({
            desiredState: 'active',
            operationStatus: 'received',
            dispatchStatus: 'complete',
            expectedPolicyRevision: 3,
            ready: false,
            appliedCount: 0,
            failedCount: 0,
            pendingCount: 1,
        });
        expect(snapshot.endpoints).to.have.length(1);
        expect(snapshot.endpoints[0]).to.include({
            endpointId: 'ep_one',
            status: 'pending',
            expectedPolicyRevision: 3,
            appliedPolicyRevision: null,
            commandStatus: 'sent',
            failureReason: null,
        });
        expect(snapshot.endpoints[0].heartbeat).to.deep.equal({
            state: 'active',
            policyRevision: 3,
            reason: 'heartbeat_observed',
        });
    });

    it('classifies applied only from the command revision, not a mismatched heartbeat', () => {
        const snapshot = deriveEndpointPolicyStatus(
            withItems([
                item({
                    status: 'applied',
                    appliedPolicyRevision: 3,
                    networkPolicyState: { state: 'inactive', policyRevision: 99, reason: 'stale_heartbeat' },
                }),
            ]),
            ['ep_one'],
        );
        expect(snapshot).to.include({
            desiredState: 'active',
            operationStatus: 'received',
            dispatchStatus: 'complete',
            ready: true,
            appliedCount: 1,
            failedCount: 0,
            pendingCount: 0,
        });
        expect(snapshot.endpoints[0]).to.include({
            status: 'applied',
            expectedPolicyRevision: 3,
            appliedPolicyRevision: 3,
            commandStatus: 'applied',
        });
        expect(snapshot.endpoints[0].heartbeat).to.include({ policyRevision: 99 });
    });

    it('fills missing frozen endpoints as pending and ignores extra projection items', () => {
        const snapshot = deriveEndpointPolicyStatus(
            withItems([
                item({
                    endpointId: 'ep_one',
                    status: 'applied',
                    appliedPolicyRevision: 3,
                }),
                item({
                    endpointId: 'ep_extra',
                    commandId: 'examnet_extra',
                    status: 'applied',
                    appliedPolicyRevision: 3,
                }),
            ]),
            ['ep_one', 'ep_two'],
        );
        expect(snapshot.endpoints.map((endpoint) => endpoint.endpointId)).to.deep.equal(['ep_one', 'ep_two']);
        expect(snapshot.endpoints[0]).to.include({ status: 'applied', appliedPolicyRevision: 3, commandStatus: 'applied' });
        expect(snapshot.endpoints[1]).to.include({
            status: 'pending',
            expectedPolicyRevision: 3,
            appliedPolicyRevision: null,
            commandStatus: null,
            failureReason: null,
            heartbeat: null,
        });
        expect(snapshot).to.include({
            ready: false,
            appliedCount: 1,
            failedCount: 0,
            pendingCount: 1,
        });
    });

    it('treats failed command statuses and applied revision mismatches as the prelogin buckets', () => {
        const snapshot = deriveEndpointPolicyStatus(
            withItems([
                item({
                    endpointId: 'ep_fail',
                    status: 'offline',
                    failureReason: 'endpoint_offline',
                    networkPolicyState: { state: 'active', policyRevision: 3 },
                }),
                item({
                    endpointId: 'ep_stale',
                    status: 'applied',
                    appliedPolicyRevision: 2,
                    networkPolicyState: { state: 'active', policyRevision: 3 },
                }),
            ]),
            ['ep_fail', 'ep_stale'],
        );
        expect(snapshot.endpoints[0]).to.include({
            status: 'failed',
            commandStatus: 'offline',
            appliedPolicyRevision: null,
            failureReason: 'endpoint_offline',
        });
        expect(snapshot.endpoints[1]).to.include({
            status: 'pending',
            commandStatus: 'applied',
            appliedPolicyRevision: 2,
        });
        expect(snapshot).to.include({
            ready: false,
            appliedCount: 0,
            failedCount: 1,
            pendingCount: 1,
        });
    });
});
