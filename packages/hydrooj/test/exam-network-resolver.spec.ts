import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

const Module = require('module');

class ConfigError extends Error {
    constructor(readonly reason: string) {
        super(reason);
    }
}

async function loadResolver(
    batches: unknown[],
    preflight: (endpointIds: string[]) => Promise<unknown[]>,
) {
    const resolverPath = require.resolve('../src/lib/exam-network-resolver.ts');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === resolverPath && request === '../model/exam-network-config') {
            return { ExamNetworkConfigError: ConfigError };
        }
        if (parent?.filename === resolverPath && request === '../model/endpoint-enrollment') {
            return {
                endpointEnrollmentBatchColl: {
                    find: () => ({ toArray: async () => batches }),
                },
            };
        }
        if (parent?.filename === resolverPath && request === '../service/vigil-bridge') {
            return { preflightExamNetworkOnVigil: preflight };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[resolverPath];
        return require(resolverPath) as typeof import('../src/lib/exam-network-resolver');
    } finally {
        Module._load = originalLoad;
        delete require.cache[resolverPath];
    }
}

const eventId = new ObjectId('66b800000000000000000a01');
const schoolId = new ObjectId('66b800000000000000000a02');
const networkCommands = ['apply_network_policy', 'get_network_policy_status', 'stop_network_policy'];

function input(kind: 'classroom' | 'endpoint' = 'endpoint') {
    return {
        domainId: 'system',
        eventId,
        schoolId,
        sources: [{ kind, ids: ['ep_one'] }],
    };
}

describe('exam endpoint target resolver', () => {
    it('resolves only finalized domain-owned endpoints and preserves capability facts', async () => {
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a03'),
                    claims: [
                        {
                            claimId: 'claim_one',
                            endpointId: 'ep_one',
                            finalizedAt: new Date('2026-08-11T01:00:00.000Z'),
                        },
                    ],
                },
            ],
            async () => [
                {
                    endpointId: 'ep_one',
                    ready: false,
                    reason: 'endpoint_offline',
                    credentialStatus: 'active',
                    online: false,
                    compatible: true,
                    serviceVersion: '0.3.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'network.policy', version: 1, commands: networkCommands }],
                },
            ],
        );
        const result = await resolver.resolveExamTargetSources(input());
        expect(result.sourceFingerprint).to.match(/^[a-f0-9]{64}$/);
        expect(result.endpoints).to.deep.equal([
            {
                endpointId: 'ep_one',
                schoolId,
                capabilities: [{ name: 'network.policy', version: 1, commands: networkCommands }],
            },
        ]);
    });

    it('fails before remote resolution for unavailable future source kinds', async () => {
        let calls = 0;
        const resolver = await loadResolver([], async () => {
            calls += 1;
            return [];
        });
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input('classroom'));
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('target_source_not_available');
        expect(calls).to.equal(0);
    });

    it('rejects unfinalized or inactive endpoint ownership', async () => {
        const resolver = await loadResolver(
            [{ _id: new ObjectId(), claims: [{ claimId: 'claim_one', endpointId: 'ep_one' }] }],
            async () => [],
        );
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input());
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('endpoint_not_owned');
    });
});
