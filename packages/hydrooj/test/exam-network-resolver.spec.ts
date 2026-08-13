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
    options: {
        assignment?: unknown;
        classrooms?: Map<string, unknown>;
        bindings?: unknown[];
        layouts?: Map<string, Array<{ sourceSeatId: string; [key: string]: unknown }>>;
        publication?: unknown;
    } = {},
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
        if (parent?.filename === resolverPath && request === '../model/exam-classroom') {
            return {
                examClassroomService: {
                    get: async (_domainId: string, classroomId: ObjectId) => options.classrooms?.get(classroomId.toHexString()) || null,
                    layout: (classroom: { _id: ObjectId }) => ({
                        snapshot: {
                            fingerprint: (classroom as { layoutFingerprint?: string }).layoutFingerprint || 'a'.repeat(64),
                            seats: options.layouts?.get(classroom._id.toHexString()) || [],
                        },
                    }),
                },
            };
        }
        if (parent?.filename === resolverPath && request === '../model/endpoint-seat-binding') {
            const bindings = (options.bindings || []) as Array<{
                _id: ObjectId;
                classroomId: ObjectId;
            }>;
            return {
                endpointSeatBindingService: {
                    listClassroomBindings: async (_domainId: string, classroomId: ObjectId) =>
                        bindings.filter((binding) => binding.classroomId.equals(classroomId)),
                    getBindingById: async (_domainId: string, bindingId: ObjectId) =>
                        bindings.find((binding) => binding._id.equals(bindingId)) || null,
                },
            };
        }
        if (parent?.filename === resolverPath && request === '../model/exam-seat-assignment') {
            return {
                examSeatAssignmentService: {
                    getPublication: async () => options.publication || null,
                    getRevision: async () => options.assignment || null,
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

function input(kind: 'classroom' | 'endpoint' | 'examSeat' | 'seat' | 'userbindGroup' = 'endpoint', ids = ['ep_one']) {
    return {
        domainId: 'system',
        eventId,
        schoolId,
        sources: [{ kind, ids }],
    };
}

describe('exam endpoint target resolver', () => {
    it('rejects a malformed ObjectId target source as a domain error before contacting Vigil', async () => {
        let preflightCalls = 0;
        const resolver = await loadResolver([], async () => {
            preflightCalls++;
            return [];
        });

        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input('examSeat', ['not-an-object-id']));
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('invalid_target_source');
        expect(preflightCalls).to.equal(0);
    });

    it('resolves only finalized domain-owned endpoints and preserves capability facts', async () => {
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a03'),
                    domainId: 'system',
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

    it('rejects an ownership finalization from the future before contacting Vigil', async () => {
        let calls = 0;
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a04'),
                    domainId: 'system',
                    claims: [
                        {
                            claimId: 'claim_future',
                            endpointId: 'ep_one',
                            finalizedAt: new Date('2099-01-01T00:00:00.000Z'),
                        },
                    ],
                },
            ],
            async () => {
                calls += 1;
                return [];
            },
        );
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input());
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('endpoint_not_owned');
        expect(calls).to.equal(0);
    });

    it('rejects duplicate finalized ownership across domains before contacting Vigil', async () => {
        let calls = 0;
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a05'),
                    domainId: 'system',
                    claims: [
                        {
                            claimId: 'claim_system',
                            endpointId: 'ep_one',
                            finalizedAt: new Date('2026-08-11T01:00:00.000Z'),
                        },
                    ],
                },
                {
                    _id: new ObjectId('66b800000000000000000a06'),
                    domainId: 'other',
                    claims: [
                        {
                            claimId: 'claim_other',
                            endpointId: 'ep_one',
                            finalizedAt: new Date('2026-08-11T01:00:00.000Z'),
                        },
                    ],
                },
            ],
            async () => {
                calls += 1;
                return [];
            },
        );
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input());
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('endpoint_not_owned');
        expect(calls).to.equal(0);
    });

    it('fails before remote resolution for unavailable future source kinds', async () => {
        let calls = 0;
        const resolver = await loadResolver([], async () => {
            calls += 1;
            return [];
        });
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input('userbindGroup'));
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('target_source_not_available');
        expect(calls).to.equal(0);
    });

    it('resolves a published exam-seat assignment through the current layout and active seat bindings', async () => {
        const classroomId = new ObjectId('66b800000000000000000a20');
        const assignmentId = new ObjectId('66b800000000000000000a21');
        const bindingOneId = new ObjectId('66b800000000000000000a22');
        const bindingTwoId = new ObjectId('66b800000000000000000a23');
        const assignmentFingerprint = 'b'.repeat(64);
        const layoutFingerprint = 'c'.repeat(64);
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a24'),
                    domainId: 'system',
                    claims: [
                        { claimId: 'claim_one', endpointId: 'ep_one', finalizedAt: new Date('2026-08-11T01:00:00.000Z') },
                        { claimId: 'claim_two', endpointId: 'ep_two', finalizedAt: new Date('2026-08-11T01:00:00.000Z') },
                    ],
                },
            ],
            async (endpointIds) =>
                endpointIds.map((endpointId) => ({
                    endpointId,
                    credentialStatus: 'active',
                    compatible: true,
                    capabilities: [{ name: 'network.policy', version: 1, commands: networkCommands }],
                })),
            {
                publication: {
                    revision: 4,
                    assignment: { assignmentId, revision: 7, fingerprint: assignmentFingerprint },
                },
                assignment: {
                    _id: assignmentId,
                    domainId: 'system',
                    eventId,
                    schoolId,
                    revision: 7,
                    fingerprint: assignmentFingerprint,
                    classroomId,
                    layoutRevision: 9,
                    layoutFingerprint,
                    assignments: [
                        { boundUserId: 42, sourceSeatId: 'seat-1' },
                        { boundUserId: 43, sourceSeatId: 'seat-2' },
                    ],
                },
                classrooms: new Map([[classroomId.toHexString(), { _id: classroomId, schoolId, layoutRevision: 9, layoutFingerprint }]]),
                layouts: new Map([[classroomId.toHexString(), [{ sourceSeatId: 'seat-1' }, { sourceSeatId: 'seat-2' }]]]),
                bindings: [
                    {
                        _id: bindingOneId,
                        domainId: 'system',
                        schoolId,
                        classroomId,
                        sourceSeatId: 'seat-1',
                        endpointId: 'ep_one',
                        status: 'active',
                        revision: 3,
                    },
                    {
                        _id: bindingTwoId,
                        domainId: 'system',
                        schoolId,
                        classroomId,
                        sourceSeatId: 'seat-2',
                        endpointId: 'ep_two',
                        status: 'active',
                        revision: 5,
                    },
                ],
            },
        );
        const result = await resolver.resolveExamTargetSources(input('examSeat', [assignmentId.toHexString()]));
        expect(result.sourceFingerprint).to.match(/^[a-f0-9]{64}$/);
        expect(result.endpoints.map((item) => item.endpointId)).to.deep.equal(['ep_one', 'ep_two']);
    });

    it('resolves classroom and physical-seat sources from canonical active bindings', async () => {
        const classroomId = new ObjectId('66b800000000000000000a10');
        const bindingOneId = new ObjectId('66b800000000000000000a11');
        const bindingTwoId = new ObjectId('66b800000000000000000a12');
        const bindings = [
            {
                _id: bindingOneId,
                domainId: 'system',
                schoolId,
                classroomId,
                sourceSeatId: 'seat-1',
                endpointId: 'ep_one',
                status: 'active',
                revision: 3,
            },
            {
                _id: bindingTwoId,
                domainId: 'system',
                schoolId,
                classroomId,
                sourceSeatId: 'seat-2',
                endpointId: 'ep_two',
                status: 'active',
                revision: 2,
            },
        ];
        const resolver = await loadResolver(
            [
                {
                    _id: new ObjectId('66b800000000000000000a13'),
                    domainId: 'system',
                    claims: [
                        { claimId: 'claim_one', endpointId: 'ep_one', finalizedAt: new Date('2026-08-11T01:00:00.000Z') },
                        { claimId: 'claim_two', endpointId: 'ep_two', finalizedAt: new Date('2026-08-11T01:00:00.000Z') },
                    ],
                },
            ],
            async (endpointIds) =>
                endpointIds.map((endpointId) => ({
                    endpointId,
                    credentialStatus: 'active',
                    compatible: true,
                    capabilities: [{ name: 'network.policy', version: 1, commands: networkCommands }],
                })),
            {
                classrooms: new Map([[classroomId.toHexString(), { _id: classroomId, schoolId, layoutRevision: 99 }]]),
                bindings,
                layouts: new Map([
                    [
                        classroomId.toHexString(),
                        [
                            { sourceSeatId: 'seat-1', x: 1 },
                            { sourceSeatId: 'seat-2', x: 2 },
                        ],
                    ],
                ]),
            },
        );
        const classroom = await resolver.resolveExamTargetSources(input('classroom', [classroomId.toHexString()]));
        expect(classroom.endpoints.map((item) => item.endpointId)).to.deep.equal(['ep_one', 'ep_two']);

        const seat = await resolver.resolveExamTargetSources(input('seat', [bindingOneId.toHexString()]));
        expect(seat.endpoints.map((item) => item.endpointId)).to.deep.equal(['ep_one']);
        expect(seat.sourceFingerprint).to.match(/^[a-f0-9]{64}$/);
    });

    it('rejects duplicate endpoints across source kinds before Vigil preflight', async () => {
        const classroomId = new ObjectId('66b800000000000000000a20');
        const bindingId = new ObjectId('66b800000000000000000a21');
        let calls = 0;
        const resolver = await loadResolver(
            [],
            async () => {
                calls += 1;
                return [];
            },
            {
                classrooms: new Map([[classroomId.toHexString(), { _id: classroomId, schoolId }]]),
                layouts: new Map([[classroomId.toHexString(), [{ sourceSeatId: 'seat-1' }]]]),
                bindings: [
                    {
                        _id: bindingId,
                        domainId: 'system',
                        schoolId,
                        classroomId,
                        sourceSeatId: 'seat-1',
                        endpointId: 'ep_one',
                        status: 'active',
                        revision: 1,
                    },
                ],
            },
        );
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources({
                ...input(),
                sources: [
                    { kind: 'classroom', ids: [classroomId.toHexString()] },
                    { kind: 'seat', ids: [bindingId.toHexString()] },
                ],
            });
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('duplicate_endpoint');
        expect(calls).to.equal(0);
    });

    it('rejects a binding whose physical seat is absent from the current canonical layout', async () => {
        const classroomId = new ObjectId('66b800000000000000000a30');
        const bindingId = new ObjectId('66b800000000000000000a31');
        let calls = 0;
        const resolver = await loadResolver(
            [],
            async () => {
                calls += 1;
                return [];
            },
            {
                classrooms: new Map([[classroomId.toHexString(), { _id: classroomId, schoolId }]]),
                layouts: new Map([[classroomId.toHexString(), [{ sourceSeatId: 'seat-present' }]]]),
                bindings: [
                    {
                        _id: bindingId,
                        domainId: 'system',
                        schoolId,
                        classroomId,
                        sourceSeatId: 'seat-missing',
                        endpointId: 'ep_one',
                        status: 'active',
                        revision: 1,
                    },
                ],
            },
        );
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input('seat', [bindingId.toHexString()]));
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('seat_binding_invalid');
        expect(calls).to.equal(0);
    });

    it('keeps the target fingerprint stable across label and geometry-only layout changes', async () => {
        const classroomId = new ObjectId('66b800000000000000000a40');
        const bindingId = new ObjectId('66b800000000000000000a41');
        const batches = [
            {
                _id: new ObjectId('66b800000000000000000a42'),
                domainId: 'system',
                claims: [
                    {
                        claimId: 'claim_one',
                        endpointId: 'ep_one',
                        finalizedAt: new Date('2026-08-11T01:00:00.000Z'),
                    },
                ],
            },
        ];
        const preflight = async () => [
            {
                endpointId: 'ep_one',
                credentialStatus: 'active',
                compatible: true,
                capabilities: [{ name: 'network.policy', version: 1, commands: networkCommands }],
            },
        ];
        const common = {
            classrooms: new Map([[classroomId.toHexString(), { _id: classroomId, schoolId }]]),
            bindings: [
                {
                    _id: bindingId,
                    domainId: 'system',
                    schoolId,
                    classroomId,
                    sourceSeatId: 'seat-1',
                    endpointId: 'ep_one',
                    status: 'active',
                    revision: 3,
                },
            ],
        };
        const before = await loadResolver(batches, preflight, {
            ...common,
            layouts: new Map([[classroomId.toHexString(), [{ sourceSeatId: 'seat-1', label: 'A1', x: 10, y: 20 }]]]),
        });
        const after = await loadResolver(batches, preflight, {
            ...common,
            layouts: new Map([[classroomId.toHexString(), [{ sourceSeatId: 'seat-1', label: '新标签', x: 90, y: 40 }]]]),
        });
        const source = input('seat', [bindingId.toHexString()]);
        expect((await after.resolveExamTargetSources(source)).sourceFingerprint).to.equal(
            (await before.resolveExamTargetSources(source)).sourceFingerprint,
        );
    });

    it('rejects unfinalized or inactive endpoint ownership', async () => {
        const resolver = await loadResolver([{ _id: new ObjectId(), claims: [{ claimId: 'claim_one', endpointId: 'ep_one' }] }], async () => []);
        let reason: string | null = null;
        try {
            await resolver.resolveExamTargetSources(input());
        } catch (error) {
            reason = (error as ConfigError).reason;
        }
        expect(reason).to.equal('endpoint_not_owned');
    });
});
