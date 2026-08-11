import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExamPreloginDispatchPayload } from '../src/model/exam-prelogin';

const Module = require('module');
(global as unknown as { Hydro: { model: Record<string, unknown>; module: Record<string, unknown> } }).Hydro ||= { model: {}, module: {} };

function request(): ExamPreloginDispatchPayload {
    return {
        schemaVersion: 1,
        requestId: 'prelogin_request_1',
        idempotencyKey: 'exam-prelogin:64b200000000000000000001',
        batchId: '64b200000000000000000001',
        domainId: 'system',
        eventId: '64b200000000000000000002',
        eventRevision: 3,
        assignment: { assignmentId: '64b200000000000000000003', revision: 2, fingerprint: 'a'.repeat(64) },
        publicationRevision: 1,
        items: [
            {
                ticketId: '64b200000000000000000004',
                ticketDigest: 'b'.repeat(64),
                uid: 42,
                endpointId: 'ep_one',
                workspace: { kind: 'contest', contestId: '64b200000000000000000005', path: '/exam-mode/64b200000000000000000005' },
                expiresAt: '2026-08-12T01:05:00.000Z',
            },
        ],
    };
}

function projection() {
    return {
        requestId: 'prelogin_request_1',
        batchId: '64b200000000000000000001',
        dispatchStatus: 'complete',
        projectionRevision: 1,
        summary: { queued: 1 },
        items: [
            {
                ticketId: '64b200000000000000000004',
                endpointId: 'ep_one',
                commandId: 'prelogin_command_1',
                status: 'queued',
                stage: 'dispatch',
                failureReason: null,
            },
        ],
    };
}

async function withBridge<T>(fetcher: typeof fetch, run: (bridge: typeof import('../src/service/vigil-bridge')) => Promise<T>): Promise<T> {
    const bridgePath = require.resolve('../src/service/vigil-bridge.ts');
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    Module._load = function load(moduleRequest: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === bridgePath && moduleRequest === '../model/system') {
            return {
                __esModule: true,
                default: { get: (key: string) => (key === 'vigil.baseUrl' ? 'https://vigil.example.edu/' : 'oj-service-token') },
            };
        }
        return originalLoad.call(this, moduleRequest, parent, isMain);
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

test('prelogin preflight accepts only the exact requested endpoint and capability contract', async () => {
    await withBridge(
        async () =>
            new Response(
                JSON.stringify({
                    ready: true,
                    items: [
                        {
                            endpointId: 'ep_one',
                            online: true,
                            compatible: true,
                            serviceVersion: '0.5.0',
                            protocolVersion: 2,
                            capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                            activeSessionId: null,
                            resumableSessionId: null,
                            reason: 'ready',
                        },
                    ],
                }),
                { status: 200 },
            ),
        async (bridge) => {
            const result = await bridge.preflightExamPreloginOnVigil([{ endpointId: 'ep_one', uid: 42, contestId: '64b200000000000000000005' }]);
            assert.equal(result[0].endpointId, 'ep_one');
            assert.equal(result[0].capabilities[0].name, 'exam.prelogin');
        },
    );
});

test('prelogin retry preflight preserves and verifies the exact ticket-session context', async () => {
    const retry = { batchId: '64b200000000000000000001', ticketId: '64b200000000000000000004' };
    await withBridge(
        async (_input, init) => {
            assert.deepEqual(JSON.parse(String(init?.body)), {
                items: [{ endpointId: 'ep_one', uid: 42, contestId: '64b200000000000000000005', retry }],
            });
            return new Response(
                JSON.stringify({
                    ready: true,
                    items: [
                        {
                            endpointId: 'ep_one',
                            online: true,
                            compatible: true,
                            serviceVersion: '0.5.0',
                            protocolVersion: 2,
                            capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                            activeSessionId: 'session_exact',
                            resumableSessionId: 'session_exact',
                            reason: 'ready',
                        },
                    ],
                }),
                { status: 200 },
            );
        },
        async (bridge) => {
            const result = await bridge.preflightExamPreloginOnVigil([
                { endpointId: 'ep_one', uid: 42, contestId: '64b200000000000000000005', retry },
            ]);
            assert.equal(result[0].resumableSessionId, 'session_exact');
        },
    );
});

test('prelogin dispatch retries an identical idempotent body and rejects projection identity drift', async () => {
    let calls = 0;
    const bodies: string[] = [];
    await withBridge(
        async (_input, init) => {
            calls += 1;
            bodies.push(String(init?.body));
            if (calls === 1) throw new TypeError('response lost');
            return new Response(JSON.stringify(projection()), { status: 200 });
        },
        async (bridge) => {
            const result = await bridge.dispatchExamPreloginOnVigil(request());
            assert.equal(result.items[0].commandId, 'prelogin_command_1');
            assert.equal(calls, 2);
            assert.equal(bodies[0], bodies[1]);
        },
    );

    const drift = projection();
    drift.items[0].endpointId = 'ep_other';
    await withBridge(
        async () => new Response(JSON.stringify(drift), { status: 200 }),
        async (bridge) => {
            await assert.rejects(bridge.dispatchExamPreloginOnVigil(request()), /malformed|match/i);
        },
    );
});

test('prelogin projection rejects unknown fields and secret-shaped payloads', async () => {
    const malformed = projection() as ReturnType<typeof projection> & { ticket?: string };
    malformed.ticket = 'KPT1.must-not-cross';
    await withBridge(
        async () => new Response(JSON.stringify(malformed), { status: 200 }),
        async (bridge) => {
            assert.throws(() => bridge.parseVigilExamPreloginProjection(malformed), /malformed/i);
        },
    );
});
