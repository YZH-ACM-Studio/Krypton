import { describe, it } from 'node:test';
import { expect } from 'chai';

const Module = require('module');
(global as unknown as { Hydro: { model: Record<string, unknown>; module: Record<string, unknown> } }).Hydro ||= { model: {}, module: {} };

function validProjection() {
    return {
        requestId: 'exam-network:execution:1:apply',
        idempotencyKey: 'exam-network:execution:1:apply',
        domainId: 'system',
        eventId: '66b800000000000000000901',
        executionId: '66b800000000000000000902',
        executionRevision: 1,
        operation: 'apply',
        activityId: 'exam:66b800000000000000000901',
        networkPolicyRevision: 1,
        policyRef: { id: '66b800000000000000000903', revision: 1, fingerprint: 'a'.repeat(64) },
        targetRef: { id: '66b800000000000000000904', revision: 1, fingerprint: 'b'.repeat(64) },
        hardEndAt: '2026-08-11T08:00:00.000Z',
        projectionRevision: 1,
        dispatchStatus: 'complete',
        summary: { sent: 1 },
        items: [
            {
                commandId: 'examnet_1',
                endpointId: 'ep_one',
                executionSessionId: 'session_one',
                commandRevision: 1,
                command: 'apply_network_policy',
                previousPolicyRevision: null,
                expectedPolicyRevision: 1,
                appliedPolicyRevision: null,
                status: 'sent',
                createdAt: '2026-08-11T02:00:00+00:00',
                updatedAt: '2026-08-11T02:00:00+00:00',
                expiresAt: '2026-08-11T02:01:00+00:00',
                sentAt: '2026-08-11T02:00:00+00:00',
                appliedAt: null,
                failedAt: null,
                failureReason: null,
                online: true,
                networkPolicyState: { endpointId: 'ep_one', state: 'inactive', reason: 'initialized', permitRuleCount: 0 },
            },
        ],
    };
}

function validRequest(): import('../src/service/vigil-bridge').VigilExamNetworkRequestPayload {
    const projection = validProjection();
    return {
        requestId: projection.requestId,
        idempotencyKey: projection.idempotencyKey,
        domainId: projection.domainId,
        eventId: projection.eventId,
        executionId: projection.executionId,
        executionRevision: projection.executionRevision,
        operation: 'apply',
        activityId: projection.activityId,
        networkPolicyRevision: projection.networkPolicyRevision,
        policyRef: projection.policyRef,
        targetRef: projection.targetRef,
        endpointIds: ['ep_one'],
        startAt: '2026-08-11T06:00:00.000Z',
        hardEndAt: projection.hardEndAt,
        policy: { hosts: ['oj.example.edu'], ips: [], ports: [443] },
    };
}

async function withBridge<T>(fetcher: typeof fetch, run: (bridge: typeof import('../src/service/vigil-bridge')) => Promise<T>): Promise<T> {
    const bridgePath = require.resolve('../src/service/vigil-bridge.ts');
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === bridgePath && request === '../model/system') {
            return {
                __esModule: true,
                default: {
                    get: (key: string) => (key === 'vigil.baseUrl' ? 'https://vigil.example.edu/' : 'oj-service-token'),
                },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    global.fetch = fetcher;
    try {
        delete require.cache[bridgePath];
        return await run(require(bridgePath));
    } finally {
        Module._load = originalLoad;
        global.fetch = originalFetch;
        delete require.cache[bridgePath];
    }
}

describe('Vigil exam network bridge', () => {
    it('parses only the minimal execution projection and rejects unknown fields', async () => {
        await withBridge(
            async () => new Response(JSON.stringify(validProjection()), { status: 200 }),
            async (bridge) => {
                const projection = await bridge.getExamNetworkRequestOnVigil(validRequest());
                expect(projection.items[0]).to.deep.equal({
                    commandId: 'examnet_1',
                    endpointId: 'ep_one',
                    executionSessionId: 'session_one',
                    commandRevision: 1,
                    command: 'apply_network_policy',
                    previousPolicyRevision: null,
                    expectedPolicyRevision: 1,
                    appliedPolicyRevision: null,
                    status: 'sent',
                    failureReason: null,
                    online: true,
                    networkPolicyState: { state: 'inactive', reason: 'initialized', permitRuleCount: 0 },
                });
                const malformed = validProjection();
                (malformed as Record<string, unknown>).dashboardToken = 'must-not-cross-service-scope';
                let protocolError: unknown;
                try {
                    bridge.parseVigilExamNetworkProjection(malformed);
                } catch (error) {
                    protocolError = error;
                }
                expect(bridge.classifyVigilBridgeFailure(protocolError)).to.include({
                    deliveryUnknown: true,
                    reason: 'vigil_protocol_invalid',
                });
                const wrongCommand = validProjection();
                wrongCommand.items[0].command = 'stop_network_policy';
                expect(() => bridge.parseVigilExamNetworkProjection(wrongCommand)).to.throw('malformed');
                const impossiblePreviousRevision = validProjection();
                impossiblePreviousRevision.items[0].previousPolicyRevision = 2;
                expect(() => bridge.parseVigilExamNetworkProjection(impossiblePreviousRevision)).to.throw('malformed');
                const rejected = validProjection();
                rejected.summary = { rejected: 1 } as unknown as typeof rejected.summary;
                rejected.items[0] = {
                    ...rejected.items[0],
                    commandId: null,
                    executionSessionId: null,
                    commandRevision: null,
                    expectedPolicyRevision: 1,
                    status: 'rejected',
                    failureReason: 'endpoint_offline',
                };
                expect(bridge.parseVigilExamNetworkProjection(rejected).items[0].expectedPolicyRevision).to.equal(1);
                rejected.items[0].expectedPolicyRevision = null;
                expect(() => bridge.parseVigilExamNetworkProjection(rejected)).to.throw('malformed');
            },
        );
    });

    it('retries the same idempotent request after a lost response', async () => {
        let calls = 0;
        const bodies: string[] = [];
        await withBridge(
            async (_input, init) => {
                calls += 1;
                bodies.push(String(init?.body));
                if (calls === 1) throw new TypeError('connection reset after dispatch');
                return new Response(JSON.stringify(validProjection()), { status: 200 });
            },
            async (bridge) => {
                const projection = validProjection();
                await bridge.dispatchExamNetworkOnVigil({
                    requestId: projection.requestId,
                    idempotencyKey: projection.idempotencyKey,
                    domainId: projection.domainId,
                    eventId: projection.eventId,
                    executionId: projection.executionId,
                    executionRevision: projection.executionRevision,
                    operation: projection.operation as 'apply',
                    activityId: projection.activityId,
                    networkPolicyRevision: projection.networkPolicyRevision,
                    policyRef: projection.policyRef,
                    targetRef: projection.targetRef,
                    endpointIds: ['ep_one'],
                    startAt: '2026-08-11T06:00:00.000Z',
                    hardEndAt: projection.hardEndAt,
                    policy: { hosts: ['oj.example.edu'], ips: [], ports: [443] },
                });
                expect(calls).to.equal(2);
                expect(bodies[0]).to.equal(bodies[1]);
            },
        );
    });

    it('does not retry an explicit 4xx response', async () => {
        let calls = 0;
        await withBridge(
            async () => {
                calls += 1;
                return new Response('{"detail":"conflict"}', { status: 409 });
            },
            async (bridge) => {
                let error: Error | null = null;
                try {
                    await bridge.getExamNetworkRequestOnVigil(validRequest());
                } catch (caught) {
                    error = caught as Error;
                }
                expect(error?.message).to.include('409');
                expect(bridge.classifyVigilBridgeFailure(error)).to.include({
                    deliveryUnknown: false,
                    reason: 'vigil_http_rejected',
                    httpStatus: 409,
                });
                expect(calls).to.equal(1);
            },
        );
    });

    it('rejects a dispatch projection whose endpoint set differs from the request', async () => {
        const mismatched = validProjection();
        mismatched.items[0].endpointId = 'ep_other';
        await withBridge(
            async () => new Response(JSON.stringify(mismatched), { status: 200 }),
            async (bridge) => {
                let error: unknown;
                try {
                    await bridge.dispatchExamNetworkOnVigil(validRequest());
                } catch (caught) {
                    error = caught;
                }
                expect(bridge.classifyVigilBridgeFailure(error)).to.include({
                    deliveryUnknown: true,
                    reason: 'vigil_protocol_invalid',
                });
            },
        );
    });

    it('rejects a structurally valid projection whose request identity drifts', async () => {
        const mismatched = validProjection();
        mismatched.requestId = 'exam-network:other-execution:1:apply';
        await withBridge(
            async () => new Response(JSON.stringify(mismatched), { status: 200 }),
            async (bridge) => {
                let error: unknown;
                try {
                    await bridge.dispatchExamNetworkOnVigil(validRequest());
                } catch (caught) {
                    error = caught;
                }
                expect(bridge.classifyVigilBridgeFailure(error)).to.include({
                    deliveryUnknown: true,
                    reason: 'vigil_protocol_invalid',
                });
            },
        );
    });

    it('fails closed when preflight identity or capability shape drifts', async () => {
        await withBridge(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: true,
                        items: [
                            {
                                endpointId: 'ep_other',
                                ready: true,
                                reason: 'ready',
                                credentialStatus: 'active',
                                online: true,
                                compatible: true,
                                serviceVersion: '0.3.0',
                                protocolVersion: 2,
                                capabilities: [{ name: 'network.policy', version: 1, commands: ['apply_network_policy'] }],
                                networkPolicyState: null,
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            async (bridge) => {
                let error: Error | null = null;
                try {
                    await bridge.preflightExamNetworkOnVigil(['ep_requested']);
                } catch (caught) {
                    error = caught as Error;
                }
                expect(error?.message).to.include('did not match');
            },
        );
    });
});
