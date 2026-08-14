import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { Collection, Db, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type {
    EndpointSeatBindingDoc,
    EndpointSeatBindingService as EndpointSeatBindingServiceType,
    EndpointSeatPairingWindowDoc,
    EndpointSeatReferenceFact,
} from '../src/model/endpoint-seat-binding';
import { settleDeletedDomainOperations, withDomainLifecycleDeletion, withDomainLifecycleMutation } from '../src/model/domain-lifecycle-boundary';

(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => ({}) } },
} as NodeModule;
const endpointSeatBindingModule = require('../src/model/endpoint-seat-binding') as typeof import('../src/model/endpoint-seat-binding');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];
const EndpointSeatBindingError = endpointSeatBindingModule.EndpointSeatBindingError;
const EndpointSeatBindingService = endpointSeatBindingModule.EndpointSeatBindingService;
const assertEndpointSeatBindingIntegrity: typeof endpointSeatBindingModule.assertEndpointSeatBindingIntegrity =
    endpointSeatBindingModule.assertEndpointSeatBindingIntegrity;
const assertEndpointSeatPairingWindowIntegrity: typeof endpointSeatBindingModule.assertEndpointSeatPairingWindowIntegrity =
    endpointSeatBindingModule.assertEndpointSeatPairingWindowIntegrity;
const deleteEndpointSeatBindingDomainFacts: typeof endpointSeatBindingModule.deleteEndpointSeatBindingDomainFacts =
    endpointSeatBindingModule.deleteEndpointSeatBindingDomainFacts;

const schoolOne = new ObjectId('66b900000000000000000001');
const schoolTwo = new ObjectId('66b900000000000000000002');
const classroomOne = new ObjectId('66b900000000000000000011');
const classroomTwo = new ObjectId('66b900000000000000000012');
const fixedNow = new Date('2026-08-11T12:00:00.000Z');

interface SeatLocation {
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    sourceSeatId: string;
}

let mongo: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let bindings: Collection<EndpointSeatBindingDoc>;
let windows: Collection<EndpointSeatPairingWindowDoc>;
let now = fixedNow;
let codeCounter = 0;
const domains = new Set<string>();
const seats = new Map<string, SeatLocation>();
const endpoints = new Map<string, { domainId: string; replacesEndpointId?: string; automaticRegistration?: true }>();
let references: EndpointSeatReferenceFact[] = [];
let referenceResolutionCalls: Array<{ domainId: string; endpointIds: string[] }> = [];
let beforeResolveReferences: (() => Promise<void>) | undefined;
let beforeLoadEndpointOwnership: (() => Promise<void>) | undefined;

function seatKey(domainId: string, classroomId: ObjectId, sourceSeatId: string): string {
    return `${domainId}\0${classroomId.toHexString()}\0${sourceSeatId}`;
}

function addSeat(sourceSeatId: string, classroomId = classroomOne, schoolId = schoolOne, domainId = 'system'): void {
    seats.set(seatKey(domainId, classroomId, sourceSeatId), {
        domainId,
        schoolId: new ObjectId(schoolId),
        classroomId: new ObjectId(classroomId),
        sourceSeatId,
    });
}

function own(endpointId: string, domainId = 'system', replacesEndpointId?: string): void {
    endpoints.set(endpointId, { domainId, ...(replacesEndpointId ? { replacesEndpointId } : {}) });
}

function ownAutomatic(endpointId: string, domainId = 'system'): void {
    endpoints.set(endpointId, { domainId, automaticRegistration: true });
}

function makeService(
    windowStore: Collection<EndpointSeatPairingWindowDoc> = windows,
    codeFactory: () => string = () => (++codeCounter).toString(10).padStart(8, '0'),
): EndpointSeatBindingServiceType {
    return new EndpointSeatBindingService({
        bindings,
        windows: windowStore,
        domainExists: async (domainId) => domains.has(domainId),
        now: () => new Date(now),
        codeFactory,
        idFactory: () => new ObjectId(),
        windowIdFactory: () => new ObjectId(),
        loadClassroomSeats: async (domainId, classroomId) => {
            const current = [...seats.values()].filter((seat) => seat.domainId === domainId && seat.classroomId.equals(classroomId));
            if (!current.length) return null;
            return {
                domainId,
                schoolId: new ObjectId(current[0].schoolId),
                classroomId: new ObjectId(classroomId),
                sourceSeatIds: current.map((seat) => seat.sourceSeatId),
            };
        },
        loadEndpointOwnership: async (endpointId) => {
            await beforeLoadEndpointOwnership?.();
            return endpoints.get(endpointId) || null;
        },
        resolveActivityReferences: async (domainId, endpointIds) => {
            referenceResolutionCalls.push({ domainId, endpointIds: [...endpointIds] });
            await beforeResolveReferences?.();
            return references.filter((reference) => reference.domainId === domainId && endpointIds.includes(reference.endpointId));
        },
    });
}

function failNextBoundWindowMark(): Collection<EndpointSeatPairingWindowDoc> {
    let armed = true;
    return new Proxy(windows, {
        get(target, property) {
            if (property === 'replaceOne') {
                return async (...args: Parameters<Collection<EndpointSeatPairingWindowDoc>['replaceOne']>) => {
                    const replacement = args[1] as EndpointSeatPairingWindowDoc;
                    if (armed && replacement.entries.some((entry) => entry.status === 'bound')) {
                        armed = false;
                        throw new Error('injected_bound_mark_failure');
                    }
                    return target.replaceOne(...args);
                };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

async function rejectReason(work: Promise<unknown>, reason: string): Promise<void> {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(EndpointSeatBindingError);
        expect(error).to.have.property('reason', reason);
        return;
    }
    expect.fail(`expected ${reason}`);
}

async function openWindow(
    service: EndpointSeatBindingServiceType,
    sourceSeatIds: string[],
    replacementSeatIds: string[] = [],
    classroomId = classroomOne,
    expectedRevision = 0,
) {
    return service.openPairingWindow({
        domainId: 'system',
        classroomId,
        sourceSeatIds,
        replacementSeatIds,
        expectedRevision,
        requestId: `window_request_${codeCounter.toString().padStart(16, '0')}`,
        actorUid: 7,
        expiresAt: new Date(now.getTime() + 60_000),
    });
}

before(async () => {
    mongo = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongo.getUri());
});

after(async () => {
    await client.close();
    await mongo.stop();
});

beforeEach(async () => {
    database = client.db(`endpoint-seat-${new ObjectId().toHexString()}`);
    bindings = database.collection<EndpointSeatBindingDoc>('exam.endpointSeatBindings');
    windows = database.collection<EndpointSeatPairingWindowDoc>('exam.endpointSeatPairingWindows');
    now = new Date(fixedNow);
    codeCounter = 0;
    domains.clear();
    domains.add('system');
    seats.clear();
    endpoints.clear();
    references = [];
    referenceResolutionCalls = [];
    beforeResolveReferences = undefined;
    beforeLoadEndpointOwnership = undefined;
    addSeat('seat-1');
    addSeat('seat-2');
    addSeat('seat-x', classroomTwo, schoolTwo);
});

describe('P2.2 endpoint seat binding canonical and pairing state machine', () => {
    it('stores only code digests, binds once, and makes the same endpoint request idempotent', async () => {
        own('ep_first_1234567890');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        expect(opened.codes).to.have.length(1);
        expect(opened.codes[0].code).to.match(/^\d{8}$/);
        const storedWindow = await windows.findOne({ _id: opened.window._id });
        expect(storedWindow).not.to.equal(null);
        expect(Object.keys(storedWindow!.entries[0])).not.to.include('code');
        expect(storedWindow!.entries[0].codeDigest).to.equal(createHash('sha256').update(opened.codes[0].code).digest('hex'));

        const first = await service.redeemPairingCode({
            endpointId: 'ep_first_1234567890',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_request_first_0001',
        });
        const retry = await service.redeemPairingCode({
            endpointId: 'ep_first_1234567890',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_request_first_0001',
        });
        expect(first.status).to.equal('bound');
        expect(retry).to.deep.equal(first);
        const binding = await bindings.findOne({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });
        expect(binding).to.include({ status: 'active', endpointId: 'ep_first_1234567890', revision: 1 });
        expect(binding!.history).to.have.length(1);
        expect(await service.getActiveBindingForEndpoint('ep_first_1234567890')).to.deep.equal(binding);
        assertEndpointSeatBindingIntegrity(binding!);
        assertEndpointSeatPairingWindowIntegrity((await windows.findOne({ _id: opened.window._id }))!);
        const transportRetry = await service.redeemPairingCode({
            endpointId: 'ep_first_1234567890',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_request_replay_0002',
        });
        expect(transportRetry).to.deep.equal(first);
        own('ep_other_12345678901');
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_other_12345678901',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_request_other_0003',
            }),
            'pairing_code_used',
        );
    });

    it('builds one classroom read model and resolves all active endpoint references in one batch', async () => {
        own('ep_read_model_one_01');
        own('ep_read_model_two_02');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1', 'seat-2']);
        await service.redeemPairingCode({
            endpointId: 'ep_read_model_one_01',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_read_model_0001',
        });
        await service.redeemPairingCode({
            endpointId: 'ep_read_model_two_02',
            pairingCode: opened.codes[1].code,
            requestId: 'endpoint_read_model_0002',
        });
        references = [
            {
                kind: 'network-config',
                domainId: 'system',
                endpointId: 'ep_read_model_two_02',
                eventId: new ObjectId('66b900000000000000000041'),
                eventTitle: '教室读模型考试',
                eventState: 'future',
                startAt: new Date('2026-08-12T01:00:00.000Z'),
                endAt: new Date('2026-08-12T03:00:00.000Z'),
                targetId: new ObjectId('66b900000000000000000042'),
                targetRevision: 1,
                targetFingerprint: 'c'.repeat(64),
            },
        ];
        referenceResolutionCalls = [];

        const state = await service.getClassroomState('system', classroomOne);

        expect(state.bindings.map((binding) => binding.sourceSeatId)).to.deep.equal(['seat-1', 'seat-2']);
        expect(state.pairingWindow?.windowId).to.deep.equal(opened.window.windowId);
        expect(state.references).to.deep.equal(references);
        expect(referenceResolutionCalls).to.deep.equal([{ domainId: 'system', endpointIds: ['ep_read_model_one_01', 'ep_read_model_two_02'] }]);
    });

    it('allows exactly one winner when two authenticated endpoints race for one code', async () => {
        own('ep_racer_one_123456');
        own('ep_racer_two_123456');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        const settled = await Promise.allSettled([
            service.redeemPairingCode({
                endpointId: 'ep_racer_one_123456',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_race_request_0001',
            }),
            service.redeemPairingCode({
                endpointId: 'ep_racer_two_123456',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_race_request_0002',
            }),
        ]);
        expect(settled.filter((item) => item.status === 'fulfilled')).to.have.length(1);
        expect(settled.filter((item) => item.status === 'rejected')).to.have.length(1);
        expect((settled.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason).to.have.property('reason', 'pairing_code_used');
        expect(await bindings.countDocuments({ status: 'active' })).to.equal(1);
    });

    it('holds domain deletion until an in-flight redemption finishes and then removes every resulting fact', async () => {
        own('ep_domain_delete_12345');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        let releaseOwnership!: () => void;
        const ownershipBlocked = new Promise<void>((resolve) => {
            releaseOwnership = resolve;
        });
        let signalOwnership!: () => void;
        const ownershipEntered = new Promise<void>((resolve) => {
            signalOwnership = resolve;
        });
        beforeLoadEndpointOwnership = async () => {
            beforeLoadEndpointOwnership = undefined;
            signalOwnership();
            await ownershipBlocked;
        };
        const redemption = service.redeemPairingCode({
            endpointId: 'ep_domain_delete_12345',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_domain_delete_0001',
        });
        await ownershipEntered;
        let cleanupStarted = false;
        const deletion = withDomainLifecycleDeletion('system', async () => {
            cleanupStarted = true;
            domains.delete('system');
            await Promise.all([bindings.deleteMany({ domainId: 'system' }), windows.deleteMany({ domainId: 'system' })]);
        });
        await Promise.resolve();
        expect(cleanupStarted).to.equal(false);
        releaseOwnership();
        expect((await redemption).status).to.equal('bound');
        await deletion;
        expect(await bindings.countDocuments({ domainId: 'system' })).to.equal(0);
        expect(await windows.countDocuments({ domainId: 'system' })).to.equal(0);
    });

    it('makes a redemption arriving during domain deletion re-read after cleanup and fail without an orphan write', async () => {
        own('ep_domain_delete_late');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        let releaseCleanup!: () => void;
        const cleanupBlocked = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
        });
        let signalCleanup!: () => void;
        const cleanupEntered = new Promise<void>((resolve) => {
            signalCleanup = resolve;
        });
        const deletion = withDomainLifecycleDeletion('system', async () => {
            signalCleanup();
            await cleanupBlocked;
            domains.delete('system');
            await Promise.all([bindings.deleteMany({ domainId: 'system' }), windows.deleteMany({ domainId: 'system' })]);
        });
        await cleanupEntered;
        const redemption = rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_domain_delete_late',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_domain_delete_late',
            }),
            'domain_not_found',
        );
        releaseCleanup();
        await deletion;
        await redemption;
        expect(await bindings.countDocuments({ domainId: 'system' })).to.equal(0);
        expect(await windows.countDocuments({ domainId: 'system' })).to.equal(0);
    });

    it('keeps the domain barrier until both endpoint-seat cleanup writes settle after one fails', async () => {
        const cleanupFailure = new Error('injected_binding_cleanup_failure');
        let releaseWindowCleanup!: () => void;
        const windowCleanupBlocked = new Promise<void>((resolve) => {
            releaseWindowCleanup = resolve;
        });
        let signalWindowCleanup!: () => void;
        const windowCleanupStarted = new Promise<void>((resolve) => {
            signalWindowCleanup = resolve;
        });
        let windowCleanupSettled = false;
        const deletion = withDomainLifecycleDeletion('system', () =>
            deleteEndpointSeatBindingDomainFacts('system', {
                bindings: {
                    deleteMany: async () => {
                        throw cleanupFailure;
                    },
                },
                windows: {
                    deleteMany: async () => {
                        signalWindowCleanup();
                        await windowCleanupBlocked;
                        windowCleanupSettled = true;
                        return { acknowledged: true, deletedCount: 1 };
                    },
                },
            }),
        );
        const observedDeletion = deletion.then(
            () => null,
            (error: unknown) => error,
        );
        await windowCleanupStarted;

        let waitingMutationSettled = false;
        const waitingMutation = withDomainLifecycleMutation('system', async () => undefined).then(
            () => {
                waitingMutationSettled = true;
                return null;
            },
            (error: unknown) => {
                waitingMutationSettled = true;
                return error;
            },
        );
        await Promise.resolve();
        expect(waitingMutationSettled).to.equal(false);
        expect(windowCleanupSettled).to.equal(false);

        releaseWindowCleanup();
        expect(await observedDeletion).to.equal(cleanupFailure);
        expect(await waitingMutation).to.equal(cleanupFailure);
        expect(windowCleanupSettled).to.equal(true);
    });

    it('runs dependent cleanup and cache invalidation after user cleanup fails behind a deleted domain root', async () => {
        const userCleanupFailure = new Error('injected_domain_user_cleanup_failure');
        let releaseDependentCleanup!: () => void;
        const dependentCleanupBlocked = new Promise<void>((resolve) => {
            releaseDependentCleanup = resolve;
        });
        let signalDependentCleanup!: () => void;
        const dependentCleanupStarted = new Promise<void>((resolve) => {
            signalDependentCleanup = resolve;
        });
        let invalidated = false;
        let cleanupSettled = false;
        const cleanup = settleDeletedDomainOperations(
            'system',
            async () => {
                throw userCleanupFailure;
            },
            async () => {
                signalDependentCleanup();
                await dependentCleanupBlocked;
            },
            () => {
                invalidated = true;
            },
        ).then(
            () => null,
            (error: unknown) => error,
        );
        cleanup.finally(() => {
            cleanupSettled = true;
        });
        await dependentCleanupStarted;
        await Promise.resolve();
        expect(cleanupSettled).to.equal(false);
        expect(invalidated).to.equal(true);

        releaseDependentCleanup();
        expect(await cleanup).to.equal(userCleanupFailure);
        expect(cleanupSettled).to.equal(true);
    });

    it('rejects residual classroom and pairing facts after the domain root is gone', async () => {
        own('ep_deleted_domain_1234');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        domains.delete('system');

        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_deleted_domain_1234',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_deleted_domain_001',
            }),
            'domain_not_found',
        );
        expect(await bindings.countDocuments({ domainId: 'system' })).to.equal(0);
        expect((await windows.findOne({ _id: opened.window._id }))!.entries[0].status).to.equal('open');
    });

    it('keeps a new classroom window behind an in-flight redemption from the expiring window', async () => {
        own('ep_window_transition_123');
        let releaseClaim!: () => void;
        const claimBlocked = new Promise<void>((resolve) => {
            releaseClaim = resolve;
        });
        let signalClaim!: () => void;
        const claimEntered = new Promise<void>((resolve) => {
            signalClaim = resolve;
        });
        let armed = true;
        const pausedWindows = new Proxy(windows, {
            get(target, property) {
                if (property === 'replaceOne') {
                    return async (...args: Parameters<Collection<EndpointSeatPairingWindowDoc>['replaceOne']>) => {
                        const replacement = args[1] as EndpointSeatPairingWindowDoc;
                        if (armed && replacement.entries.some((entry) => entry.status === 'claimed')) {
                            armed = false;
                            signalClaim();
                            await claimBlocked;
                        }
                        return target.replaceOne(...args);
                    };
                }
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const service = makeService(pausedWindows);
        await service.ensureIndexes();
        const first = await openWindow(service, ['seat-2']);
        const redemption = service.redeemPairingCode({
            endpointId: 'ep_window_transition_123',
            pairingCode: first.codes[0].code,
            requestId: 'endpoint_window_transition_1',
        });
        await claimEntered;
        now = new Date(first.window.expiresAt.getTime() + 1);
        let openedLater = false;
        const later = openWindow(service, ['seat-1'], [], classroomOne, first.window.revision).then((result) => {
            openedLater = true;
            return result;
        });
        await Promise.resolve();
        expect(openedLater).to.equal(false);
        releaseClaim();
        expect((await redemption).status).to.equal('bound');
        await rejectReason(later, 'pairing_window_revision_conflict');
        expect((await windows.findOne({ _id: first.window._id }))!.entries[0].status).to.equal('bound');
        const settledFirst = (await service.getPairingWindow('system', classroomOne))!;
        const second = await openWindow(service, ['seat-1'], [], classroomOne, settledFirst.revision);
        expect((await service.getPairingWindow('system', classroomOne))!._id).to.equal(second.window._id);
    });

    it('reports a global code-digest collision without misclassifying it as a window revision race', async () => {
        const service = makeService();
        await service.ensureIndexes();
        await openWindow(service, ['seat-x'], [], classroomTwo);
        codeCounter = 0;
        await rejectReason(openWindow(service, ['seat-1']), 'pairing_code_collision');
        expect(await windows.countDocuments({ domainId: 'system', classroomId: classroomOne })).to.equal(0);
    });

    it('regenerates an in-window collision so every displayed eight-digit code is unique', async () => {
        const candidates = ['11111111', '11111111', '22222222'];
        const service = makeService(windows, () => candidates.shift() || '33333333');
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1', 'seat-2']);
        expect(opened.codes.map(({ code }) => code)).to.deep.equal(['11111111', '22222222']);
        expect(new Set(opened.codes.map(({ code }) => code)).size).to.equal(2);
    });

    it('rejects non-canonical pairing-code text without consuming the code', async () => {
        own('ep_canonical_code_123');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_canonical_code_123',
                pairingCode: `${opened.codes[0].code.slice(0, 4)}-${opened.codes[0].code.slice(4)}`,
                requestId: 'endpoint_bad_code_request_1',
            }),
            'pairing_code_invalid',
        );
        expect((await windows.findOne({ _id: opened.window._id }))!.entries[0].status).to.equal('open');
        expect(await bindings.countDocuments()).to.equal(0);
    });

    it('enforces one active seat per endpoint even when two different codes race', async () => {
        own('ep_single_machine_1234');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1', 'seat-2']);
        const settled = await Promise.allSettled(
            opened.codes.map((entry, index) =>
                service.redeemPairingCode({
                    endpointId: 'ep_single_machine_1234',
                    pairingCode: entry.code,
                    requestId: `endpoint_two_seats_${index.toString().padStart(16, '0')}`,
                }),
            ),
        );
        expect(settled.filter((item) => item.status === 'fulfilled')).to.have.length(1);
        expect(settled.filter((item) => item.status === 'rejected')).to.have.length(1);
        expect((settled.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason).to.have.property(
            'reason',
            'endpoint_already_bound',
        );
        expect(await bindings.countDocuments({ endpointId: 'ep_single_machine_1234', status: 'active' })).to.equal(1);
    });

    it('settles more simultaneous classroom codes than the internal CAS retry limit without starving a valid seat', async () => {
        const sourceSeatIds = Array.from({ length: 20 }, (_, index) => `bulk-seat-${index.toString().padStart(2, '0')}`);
        for (const sourceSeatId of sourceSeatIds) addSeat(sourceSeatId);
        const endpointIds = sourceSeatIds.map((_, index) => `ep_bulk_${index.toString().padStart(16, '0')}`);
        endpointIds.forEach((endpointId) => own(endpointId));
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, sourceSeatIds);
        const results = await Promise.all(
            opened.codes.map((entry, index) =>
                service.redeemPairingCode({
                    endpointId: endpointIds[index],
                    pairingCode: entry.code,
                    requestId: `endpoint_bulk_${index.toString().padStart(16, '0')}`,
                }),
            ),
        );
        expect(results.every((result) => result.status === 'bound')).to.equal(true);
        expect(await bindings.countDocuments({ domainId: 'system', classroomId: classroomOne, status: 'active' })).to.equal(20);
    });

    it('rejects expiry, cross-domain ownership, cross-school reuse, and a removed imported seat', async () => {
        own('ep_expired_123456789');
        own('ep_wrong_domain_12345', 'other');
        own('ep_cross_school_12345');
        const service = makeService();
        await service.ensureIndexes();
        const expired = await openWindow(service, ['seat-1']);
        now = new Date(expired.window.expiresAt);
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_expired_123456789',
                pairingCode: expired.codes[0].code,
                requestId: 'endpoint_expired_request_01',
            }),
            'pairing_code_expired',
        );

        now = new Date(fixedNow.getTime() + 120_000);
        const reopened = await openWindow(service, ['seat-1'], [], classroomOne, expired.window.revision);
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_wrong_domain_12345',
                pairingCode: reopened.codes[0].code,
                requestId: 'endpoint_domain_request_001',
            }),
            'endpoint_domain_mismatch',
        );
        seats.delete(seatKey('system', classroomOne, 'seat-1'));
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_expired_123456789',
                pairingCode: reopened.codes[0].code,
                requestId: 'endpoint_missing_seat_0001',
            }),
            'seat_not_found',
        );

        now = new Date(reopened.window.expiresAt.getTime() + 1);
        const secondService = makeService();
        const schoolTwoWindow = await openWindow(secondService, ['seat-x'], [], classroomTwo);
        seats.set(seatKey('system', classroomOne, 'seat-1'), {
            domainId: 'system',
            schoolId: schoolOne,
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
        });
        const schoolOneWindow = await openWindow(secondService, ['seat-1'], [], classroomOne, reopened.window.revision);
        await secondService.redeemPairingCode({
            endpointId: 'ep_cross_school_12345',
            pairingCode: schoolOneWindow.codes[0].code,
            requestId: 'endpoint_school_one_00001',
        });
        await rejectReason(
            secondService.redeemPairingCode({
                endpointId: 'ep_cross_school_12345',
                pairingCode: schoolTwoWindow.codes[0].code,
                requestId: 'endpoint_school_two_00002',
            }),
            'cross_school_endpoint',
        );
    });

    it('keeps a stable sourceSeatId binding when only imported label or geometry changes', async () => {
        own('ep_layout_1234567890');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        // The resolver still returns the same canonical seat identity; presentation fields are intentionally absent.
        seats.set(seatKey('system', classroomOne, 'seat-1'), {
            domainId: 'system',
            schoolId: schoolOne,
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
        });
        const result = await service.redeemPairingCode({
            endpointId: 'ep_layout_1234567890',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_layout_request_01',
        });
        expect(result.status).to.equal('bound');
    });

    it('fails every canonical read when a binding or pairing window no longer resolves to the current school seat', async () => {
        own('ep_read_integrity_1234');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_read_integrity_1234',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_read_integrity_1',
        });
        const binding = (await bindings.findOne({ sourceSeatId: 'seat-1' }))!;
        const window = (await windows.findOne({ _id: opened.window._id }))!;

        await bindings.replaceOne({ _id: binding._id }, { ...binding, schoolId: new ObjectId(schoolTwo) });
        await rejectReason(service.listClassroomBindings('system', classroomOne), 'seat_school_mismatch');
        await rejectReason(service.getBindingById('system', binding._id), 'seat_school_mismatch');
        await bindings.replaceOne({ _id: binding._id }, binding);

        await windows.replaceOne({ _id: window._id }, { ...window, schoolId: new ObjectId(schoolTwo) });
        await rejectReason(service.getPairingWindow('system', classroomOne), 'seat_school_mismatch');
        await windows.replaceOne({ _id: window._id }, window);

        seats.delete(seatKey('system', classroomOne, 'seat-1'));
        await rejectReason(service.listClassroomBindings('system', classroomOne), 'seat_not_found');
        await rejectReason(service.getBindingById('system', binding._id), 'seat_not_found');
        await rejectReason(service.getPairingWindow('system', classroomOne), 'seat_not_found');
    });

    it('rejects a wrong-school binding before every replacement mutation and leaves its window unchanged', async () => {
        own('ep_wrong_school_old_1');
        own('ep_wrong_school_new_1', 'system', 'ep_wrong_school_old_1');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_wrong_school_old_1',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_wrong_school_old_1',
        });
        const binding = (await bindings.findOne({ sourceSeatId: 'seat-1' }))!;
        const settledInitial = (await windows.findOne({ _id: initial.window._id }))!;
        const corruptBinding = { ...binding, schoolId: new ObjectId(schoolTwo) };
        await bindings.replaceOne({ _id: binding._id }, corruptBinding);
        now = new Date(initial.window.expiresAt.getTime() + 1);
        await rejectReason(openWindow(service, ['seat-1'], ['seat-1'], classroomOne, settledInitial.revision), 'seat_school_mismatch');
        expect(await windows.countDocuments({ domainId: 'system', classroomId: classroomOne })).to.equal(1);

        await bindings.replaceOne({ _id: binding._id }, binding);
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, settledInitial.revision);
        await bindings.replaceOne({ _id: binding._id }, corruptBinding);
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_wrong_school_new_1',
                pairingCode: replacement.codes[0].code,
                requestId: 'endpoint_wrong_school_new_1',
            }),
            'seat_school_mismatch',
        );
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0].status).to.equal('open');

        await bindings.replaceOne({ _id: binding._id }, binding);
        await service.redeemPairingCode({
            endpointId: 'ep_wrong_school_new_1',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_wrong_school_new_1',
        });
        const preview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        await bindings.replaceOne({ _id: binding._id }, corruptBinding);
        await rejectReason(
            service.confirmReplacement({
                domainId: 'system',
                classroomId: classroomOne,
                windowId: replacement.window.windowId,
                sourceSeatId: 'seat-1',
                expectedEntryRevision: preview.entryRevision,
                expectedBindingRevision: preview.bindingRevision,
                confirmationFingerprint: preview.confirmationFingerprint,
                actorUid: 7,
                requestId: 'admin_wrong_school_replace_1',
            }),
            'seat_school_mismatch',
        );
        expect(await bindings.findOne({ _id: binding._id })).to.deep.equal(corruptBinding);
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0].status).to.equal('claimed');
    });

    it('rejects a clock rollback behind the latest binding before opening another pairing window', async () => {
        own('ep_clock_guard_123456');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_clock_guard_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_clock_bind_0001',
        });
        now = new Date(initial.window.expiresAt.getTime() + 120_000);
        const preview = await service.previewUnbind({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });
        await service.unbind({
            domainId: 'system',
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
            expectedBindingRevision: 1,
            confirmationFingerprint: preview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_clock_unbind_0001',
        });
        const windowBefore = (await service.getPairingWindow('system', classroomOne))!;
        now = new Date(initial.window.expiresAt.getTime() + 1);
        await rejectReason(openWindow(service, ['seat-1'], [], classroomOne, windowBefore.revision), 'clock_rollback');
        expect(await service.getPairingWindow('system', classroomOne)).to.deep.equal(windowBefore);
    });

    it('requires an explicit credential replacement and fresh old/new activity preview before changing endpoint', async () => {
        own('ep_old_machine_123456');
        own('ep_new_machine_123456', 'system', 'ep_old_machine_123456');
        own('ep_unrelated_12345678');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_old_machine_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_initial_bind_0001',
        });
        const firstWindow = await windows.findOne({ _id: initial.window._id });
        now = new Date(firstWindow!.expiresAt.getTime() + 1);

        references = [
            {
                kind: 'network-config',
                domainId: 'system',
                endpointId: 'ep_old_machine_123456',
                eventId: new ObjectId('66b900000000000000000021'),
                eventTitle: '未来考试',
                eventState: 'future',
                startAt: new Date('2026-08-12T01:00:00.000Z'),
                endAt: new Date('2026-08-12T03:00:00.000Z'),
                targetId: new ObjectId('66b900000000000000000022'),
                targetRevision: 1,
                targetFingerprint: 'a'.repeat(64),
            },
        ];
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, firstWindow!.revision);
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_unrelated_12345678',
                pairingCode: replacement.codes[0].code,
                requestId: 'endpoint_wrong_replace_0001',
            }),
            'endpoint_not_replacement',
        );
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_new_machine_123456',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_replace_claim_0001',
        });
        expect(claimed.status).to.equal('replacement_confirmation_required');
        expect((await bindings.findOne({ sourceSeatId: 'seat-1' }))!.endpointId).to.equal('ep_old_machine_123456');

        const preview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        expect(preview).to.include({ oldEndpointId: 'ep_old_machine_123456', newEndpointId: 'ep_new_machine_123456' });
        expect(preview.references).to.have.length(1);
        references = [
            ...references,
            {
                ...references[0],
                kind: 'network-execution',
                targetRevision: 2,
                targetFingerprint: 'b'.repeat(64),
            },
        ];
        await rejectReason(
            service.confirmReplacement({
                domainId: 'system',
                classroomId: classroomOne,
                windowId: replacement.window.windowId,
                sourceSeatId: 'seat-1',
                expectedEntryRevision: claimed.entryRevision,
                expectedBindingRevision: 1,
                confirmationFingerprint: preview.confirmationFingerprint,
                actorUid: 7,
                requestId: 'admin_replace_confirm_0001',
            }),
            'replacement_confirmation_stale',
        );
        const refreshed = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        const bound = await service.confirmReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            expectedBindingRevision: 1,
            confirmationFingerprint: refreshed.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_replace_confirm_0002',
        });
        expect(bound.endpointId).to.equal('ep_new_machine_123456');
        expect(bound.revision).to.equal(2);
        expect(bound.history).to.have.length(2);
        expect(bound.history[1]).to.include({
            action: 'replace',
            previousEndpointId: 'ep_old_machine_123456',
            endpointId: 'ep_new_machine_123456',
        });
        expect(references).to.have.length(2);
    });

    it('lets an automatically registered machine use the existing administrator-confirmed replacement flow', async () => {
        own('ep_auto_replace_old_1234');
        ownAutomatic('ep_auto_replace_new_1234');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_auto_replace_old_1234',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_auto_initial_0001',
        });
        const firstWindow = (await windows.findOne({ _id: initial.window._id }))!;
        now = new Date(firstWindow.expiresAt.getTime() + 1);
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, firstWindow.revision);
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_auto_replace_new_1234',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_auto_replace_0001',
        });
        expect(claimed.status).to.equal('replacement_confirmation_required');
        const preview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        expect(preview).to.include({
            oldEndpointId: 'ep_auto_replace_old_1234',
            newEndpointId: 'ep_auto_replace_new_1234',
        });
        const bound = await service.confirmReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            expectedBindingRevision: 1,
            confirmationFingerprint: preview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_auto_replace_0001',
        });
        expect(bound.endpointId).to.equal('ep_auto_replace_new_1234');
        expect(bound.history[1]).to.include({
            action: 'replace',
            previousEndpointId: 'ep_auto_replace_old_1234',
            endpointId: 'ep_auto_replace_new_1234',
        });
    });

    it('requires a fresh reference fingerprint for unbind and preserves the entire endpoint history', async () => {
        own('ep_unbind_123456789');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        const result = await service.redeemPairingCode({
            endpointId: 'ep_unbind_123456789',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_unbind_bind_0001',
        });
        expect(result.status).to.equal('bound');
        const preview = await service.previewUnbind({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });
        references = [
            {
                kind: 'network-config',
                domainId: 'system',
                endpointId: 'ep_unbind_123456789',
                eventId: new ObjectId('66b900000000000000000031'),
                eventTitle: '新增未来考试',
                eventState: 'future',
                startAt: new Date('2026-08-13T01:00:00.000Z'),
                endAt: new Date('2026-08-13T03:00:00.000Z'),
                targetId: new ObjectId('66b900000000000000000032'),
                targetRevision: 1,
                targetFingerprint: 'c'.repeat(64),
            },
        ];
        await rejectReason(
            service.unbind({
                domainId: 'system',
                classroomId: classroomOne,
                sourceSeatId: 'seat-1',
                expectedBindingRevision: 1,
                confirmationFingerprint: preview.confirmationFingerprint,
                actorUid: 7,
                requestId: 'admin_unbind_request_0001',
            }),
            'unbind_confirmation_stale',
        );
        const refreshed = await service.previewUnbind({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });
        const unbound = await service.unbind({
            domainId: 'system',
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
            expectedBindingRevision: 1,
            confirmationFingerprint: refreshed.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_unbind_request_0002',
        });
        expect(unbound).to.include({ status: 'unbound', revision: 2 });
        expect(unbound).not.to.have.property('endpointId');
        expect(unbound.history).to.have.length(2);
        expect(unbound.history[1]).to.include({ action: 'unbind', previousEndpointId: 'ep_unbind_123456789' });
        const replay = await service.unbindWithOutcome({
            domainId: 'system',
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
            expectedBindingRevision: 1,
            confirmationFingerprint: refreshed.confirmationFingerprint,
            actorUid: 8,
            requestId: 'admin_unbind_request_0002',
        });
        expect(replay).to.deep.equal({ value: unbound, replayed: true, canonicalActorUid: 7 });
        assertEndpointSeatBindingIntegrity(unbound);
    });

    it('does not strand a claimed replacement: an administrator can cancel it and then close the window by CAS', async () => {
        own('ep_cancel_old_123456');
        own('ep_cancel_new_123456', 'system', 'ep_cancel_old_123456');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_cancel_old_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_cancel_bind_0001',
        });
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const current = (await service.getPairingWindow('system', classroomOne))!;
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, current.revision);
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_cancel_new_123456',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_cancel_claim_001',
        });
        expect(claimed.status).to.equal('replacement_confirmation_required');
        await rejectReason(
            service.closePairingWindow({
                domainId: 'system',
                classroomId: classroomOne,
                expectedRevision: (await service.getPairingWindow('system', classroomOne))!.revision,
                actorUid: 7,
                requestId: 'admin_close_pending_0001',
            }),
            'pairing_claim_pending',
        );
        const cancelled = await service.cancelPairingClaim({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            actorUid: 7,
            requestId: 'admin_cancel_pairing_0001',
        });
        expect(cancelled.entries[0]).to.include({ status: 'cancelled', decidedBy: 7 });
        await rejectReason(
            service.redeemPairingCode({
                endpointId: 'ep_cancel_new_123456',
                pairingCode: replacement.codes[0].code,
                requestId: 'endpoint_cancel_claim_001',
            }),
            'pairing_cancelled',
        );
        const closed = await service.closePairingWindow({
            domainId: 'system',
            classroomId: classroomOne,
            expectedRevision: cancelled.revision,
            actorUid: 7,
            requestId: 'admin_close_pairing_0002',
        });
        expect(closed).to.include({ status: 'closed', closedBy: 7 });
        expect(
            (
                await service.closePairingWindow({
                    domainId: 'system',
                    classroomId: classroomOne,
                    expectedRevision: cancelled.revision,
                    actorUid: 7,
                    requestId: 'admin_close_pairing_0002',
                })
            ).revision,
        ).to.equal(closed.revision);
    });

    it('serializes replacement confirmation with cancellation for the same physical seat', async () => {
        own('ep_race_old_12345678');
        own('ep_race_new_12345678', 'system', 'ep_race_old_12345678');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_race_old_12345678',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_race_bind_0001',
        });
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const current = (await service.getPairingWindow('system', classroomOne))!;
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, current.revision);
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_race_new_12345678',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_race_claim_0001',
        });
        const preview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });

        let releaseReferences!: () => void;
        let enteredReferences!: () => void;
        const referencesEntered = new Promise<void>((resolve) => {
            enteredReferences = resolve;
        });
        const referencesReleased = new Promise<void>((resolve) => {
            releaseReferences = resolve;
        });
        beforeResolveReferences = async () => {
            enteredReferences();
            await referencesReleased;
        };
        const confirming = service.confirmReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            expectedBindingRevision: 1,
            confirmationFingerprint: preview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_race_confirm_0001',
        });
        await referencesEntered;
        const cancelling = service.cancelPairingClaim({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            actorUid: 7,
            requestId: 'admin_race_cancel_0001',
        });
        releaseReferences();
        const [confirmed, cancelled] = await Promise.allSettled([confirming, cancelling]);
        expect(confirmed.status).to.equal('fulfilled');
        expect(cancelled.status).to.equal('rejected');
        expect((cancelled as PromiseRejectedResult).reason).to.have.property('reason', 'pairing_claim_changed');
        expect(await bindings.findOne({ sourceSeatId: 'seat-1' })).to.include({
            status: 'active',
            endpointId: 'ep_race_new_12345678',
            revision: 2,
        });
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0]).to.include({
            status: 'bound',
            bindingRevision: 2,
        });
    });

    it('serializes replacement-window creation behind an in-flight unbind', async () => {
        own('ep_window_race_123456');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_window_race_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_window_race_001',
        });
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const currentWindow = (await service.getPairingWindow('system', classroomOne))!;
        const preview = await service.previewUnbind({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });

        let releaseReferences!: () => void;
        let enteredReferences!: () => void;
        const referencesEntered = new Promise<void>((resolve) => {
            enteredReferences = resolve;
        });
        const referencesReleased = new Promise<void>((resolve) => {
            releaseReferences = resolve;
        });
        beforeResolveReferences = async () => {
            enteredReferences();
            await referencesReleased;
        };
        const unbinding = service.unbind({
            domainId: 'system',
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
            expectedBindingRevision: 1,
            confirmationFingerprint: preview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_window_unbind_001',
        });
        await referencesEntered;
        const opening = openWindow(service, ['seat-1'], ['seat-1'], classroomOne, currentWindow.revision);
        releaseReferences();
        const [unbound, opened] = await Promise.allSettled([unbinding, opening]);
        expect(unbound.status).to.equal('fulfilled');
        expect(opened.status).to.equal('rejected');
        expect((opened as PromiseRejectedResult).reason).to.have.property('reason', 'seat_not_bound');
        expect(await service.getPairingWindow('system', classroomOne)).to.deep.equal(currentWindow);
    });

    it('recovers an initial binding write whose pairing-window completion acknowledgement was lost', async () => {
        own('ep_recover_bind_12345');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        const faultingService = makeService(failNextBoundWindowMark());
        try {
            await faultingService.redeemPairingCode({
                endpointId: 'ep_recover_bind_12345',
                pairingCode: opened.codes[0].code,
                requestId: 'endpoint_recover_bind_001',
            });
            expect.fail('expected injected bound-mark failure');
        } catch (error) {
            expect(error).to.have.property('message', 'injected_bound_mark_failure');
        }
        const claimed = (await windows.findOne({ _id: opened.window._id }))!.entries[0];
        expect(claimed.status).to.equal('claimed');
        expect(await bindings.findOne({ sourceSeatId: 'seat-1' })).to.include({
            status: 'active',
            endpointId: 'ep_recover_bind_12345',
            revision: 1,
        });
        await rejectReason(
            service.cancelPairingClaim({
                domainId: 'system',
                classroomId: classroomOne,
                windowId: opened.window.windowId,
                sourceSeatId: 'seat-1',
                expectedEntryRevision: claimed.revision,
                actorUid: 7,
                requestId: 'admin_recover_cancel_001',
            }),
            'pairing_claim_changed',
        );
        expect((await windows.findOne({ _id: opened.window._id }))!.entries[0]).to.include({
            status: 'bound',
            bindingRevision: 1,
        });
    });

    it('retains settled windows so an old one-time code retry survives a newer classroom window', async () => {
        own('ep_old_code_replay_123');
        const service = makeService();
        await service.ensureIndexes();
        const first = await openWindow(service, ['seat-1']);
        const bound = await service.redeemPairingCode({
            endpointId: 'ep_old_code_replay_123',
            pairingCode: first.codes[0].code,
            requestId: 'endpoint_old_code_replay_1',
        });
        const settledFirst = (await windows.findOne({ _id: first.window._id }))!;
        now = new Date(first.window.expiresAt.getTime() + 1);
        const second = await openWindow(service, ['seat-2'], [], classroomOne, settledFirst.revision);

        const retry = await service.redeemPairingCode({
            endpointId: 'ep_old_code_replay_123',
            pairingCode: first.codes[0].code,
            requestId: 'endpoint_old_code_replay_1',
        });
        expect(retry).to.deep.equal(bound);
        expect(await windows.countDocuments({ domainId: 'system', classroomId: classroomOne })).to.equal(2);
        expect((await windows.findOne({ _id: first.window._id }))!.entries[0].status).to.equal('bound');
        expect((await service.getPairingWindow('system', classroomOne))!._id).to.equal(second.window._id);
    });

    it('replays completed replacement and close acknowledgements from retained historical windows', async () => {
        own('ep_history_old_123456');
        own('ep_history_new_123456', 'system', 'ep_history_old_123456');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_history_old_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_history_initial_1',
        });
        const settledInitial = (await windows.findOne({ _id: initial.window._id }))!;
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, settledInitial.revision);
        await service.redeemPairingCode({
            endpointId: 'ep_history_new_123456',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_history_replace_1',
        });
        const preview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        const confirmation = {
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: preview.entryRevision,
            expectedBindingRevision: preview.bindingRevision,
            confirmationFingerprint: preview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_history_replace_0001',
        };
        const confirmed = await service.confirmReplacement(confirmation);
        const settledReplacement = (await windows.findOne({ _id: replacement.window._id }))!;
        now = new Date(replacement.window.expiresAt.getTime() + 1);
        const later = await openWindow(service, ['seat-2'], [], classroomOne, settledReplacement.revision);
        const replacementReplay = await service.confirmReplacementWithOutcome({ ...confirmation, actorUid: 8 });
        expect(replacementReplay).to.deep.equal({ value: confirmed, replayed: true, canonicalActorUid: 7 });

        const closeInput = {
            domainId: 'system',
            classroomId: classroomOne,
            expectedRevision: later.window.revision,
            actorUid: 7,
            requestId: 'admin_history_close_00001',
        };
        const closed = await service.closePairingWindow(closeInput);
        const newest = await openWindow(service, ['seat-2'], [], classroomOne, closed.revision);
        const closeReplay = await service.closePairingWindowWithOutcome({ ...closeInput, actorUid: 8 });
        expect(closeReplay).to.deep.equal({ value: closed, replayed: true, canonicalActorUid: 7 });
        expect((await service.getPairingWindow('system', classroomOne))!._id).to.equal(newest.window._id);
        expect(await windows.countDocuments({ domainId: 'system', classroomId: classroomOne })).to.equal(4);
    });

    it('replays a cancelled replacement claim after a newer window becomes current', async () => {
        own('ep_cancel_history_old');
        own('ep_cancel_history_new', 'system', 'ep_cancel_history_old');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_cancel_history_old',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_cancel_history_old',
        });
        const settledInitial = (await windows.findOne({ _id: initial.window._id }))!;
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, settledInitial.revision);
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_cancel_history_new',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_cancel_history_new',
        });
        expect(claimed.status).to.equal('replacement_confirmation_required');
        const cancelInput = {
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
            expectedEntryRevision: claimed.entryRevision,
            actorUid: 7,
            requestId: 'admin_cancel_history_0001',
        };
        const cancelled = await service.cancelPairingClaim(cancelInput);
        now = new Date(replacement.window.expiresAt.getTime() + 1);
        const later = await openWindow(service, ['seat-2'], [], classroomOne, cancelled.revision);
        const cancelReplay = await service.cancelPairingClaimWithOutcome({ ...cancelInput, actorUid: 8 });
        expect(cancelReplay).to.deep.equal({ value: cancelled, replayed: true, canonicalActorUid: 7 });
        expect((await service.getPairingWindow('system', classroomOne))!._id).to.equal(later.window._id);
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0].decisionRequestId).to.equal(cancelInput.requestId);
    });

    it('reconciles a completed replacement before allowing a later unbind', async () => {
        own('ep_recover_old_123456');
        own('ep_recover_new_123456', 'system', 'ep_recover_old_123456');
        const service = makeService();
        await service.ensureIndexes();
        const initial = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_recover_old_123456',
            pairingCode: initial.codes[0].code,
            requestId: 'endpoint_recover_old_0001',
        });
        now = new Date(initial.window.expiresAt.getTime() + 1);
        const current = (await service.getPairingWindow('system', classroomOne))!;
        const replacement = await openWindow(service, ['seat-1'], ['seat-1'], classroomOne, current.revision);
        const claimed = await service.redeemPairingCode({
            endpointId: 'ep_recover_new_123456',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_recover_new_0001',
        });
        const replacementPreview = await service.previewReplacement({
            domainId: 'system',
            classroomId: classroomOne,
            windowId: replacement.window.windowId,
            sourceSeatId: 'seat-1',
        });
        const faultingService = makeService(failNextBoundWindowMark());
        try {
            await faultingService.confirmReplacement({
                domainId: 'system',
                classroomId: classroomOne,
                windowId: replacement.window.windowId,
                sourceSeatId: 'seat-1',
                expectedEntryRevision: claimed.entryRevision,
                expectedBindingRevision: 1,
                confirmationFingerprint: replacementPreview.confirmationFingerprint,
                actorUid: 7,
                requestId: 'admin_recover_replace_001',
            });
            expect.fail('expected injected bound-mark failure');
        } catch (error) {
            expect(error).to.have.property('message', 'injected_bound_mark_failure');
        }
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0].status).to.equal('claimed');
        const recovered = await service.redeemPairingCode({
            endpointId: 'ep_recover_new_123456',
            pairingCode: replacement.codes[0].code,
            requestId: 'endpoint_recover_new_0001',
        });
        expect(recovered.status).to.equal('bound');
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0]).to.include({
            status: 'bound',
            bindingRevision: 2,
        });
        const unbindPreview = await service.previewUnbind({ domainId: 'system', classroomId: classroomOne, sourceSeatId: 'seat-1' });
        const unbound = await service.unbind({
            domainId: 'system',
            classroomId: classroomOne,
            sourceSeatId: 'seat-1',
            expectedBindingRevision: 2,
            confirmationFingerprint: unbindPreview.confirmationFingerprint,
            actorUid: 7,
            requestId: 'admin_recover_unbind_001',
        });
        expect((await windows.findOne({ _id: replacement.window._id }))!.entries[0]).to.include({
            status: 'bound',
            bindingRevision: 2,
        });
        expect(unbound).to.include({ status: 'unbound', revision: 3 });
        expect(unbound.history.map((entry) => entry.action)).to.deep.equal(['bind', 'replace', 'unbind']);
    });

    it('rejects self-consistent unknown or malformed canonical fields instead of trusting BSON shape', async () => {
        own('ep_integrity_12345678');
        const service = makeService();
        await service.ensureIndexes();
        const opened = await openWindow(service, ['seat-1']);
        await service.redeemPairingCode({
            endpointId: 'ep_integrity_12345678',
            pairingCode: opened.codes[0].code,
            requestId: 'endpoint_integrity_bind_1',
        });
        const binding = (await bindings.findOne({ sourceSeatId: 'seat-1' }))!;
        expect(() => assertEndpointSeatBindingIntegrity({ ...binding, unknown: true } as EndpointSeatBindingDoc)).to.throw(EndpointSeatBindingError);
        expect(() => assertEndpointSeatBindingIntegrity({ ...binding, domainId: 7 })).to.throw(EndpointSeatBindingError);
        expect(() => assertEndpointSeatBindingIntegrity({ ...binding, domainId: 'sys\ntem' })).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatBindingIntegrity({
                ...binding,
                history: [{ ...binding.history[0], requestId: 42 }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatBindingIntegrity({
                ...binding,
                endpointId: 'ep_integrity_new_12345',
                revision: 2,
                history: [
                    ...binding.history,
                    {
                        revision: 2,
                        action: 'replace',
                        previousEndpointId: 'ep_integrity_wrong_123',
                        endpointId: 'ep_integrity_new_12345',
                        requestId: 'admin_integrity_replace_1',
                        endpointRequestId: 'endpoint_integrity_replace_1',
                        actorUid: 7,
                        at: new Date(binding.updatedAt),
                        pairingWindowId: opened.window.windowId,
                        referenceFingerprint: 'a'.repeat(64),
                    },
                ],
                updatedAt: new Date(binding.updatedAt),
            } as EndpointSeatBindingDoc),
        ).to.throw(EndpointSeatBindingError);
        const window = (await windows.findOne({ _id: opened.window._id }))!;
        expect(() =>
            assertEndpointSeatPairingWindowIntegrity({
                ...window,
                entries: [{ ...window.entries[0], codeDigest: 'not-a-digest' }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatPairingWindowIntegrity({
                ...window,
                entries: [{ ...window.entries[0], sourceSeatId: 7 }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatPairingWindowIntegrity({
                ...window,
                entries: [{ ...window.entries[0], codeHint: 12 }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatPairingWindowIntegrity({
                ...window,
                entries: [{ ...window.entries[0], claimRequestId: 42 }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() =>
            assertEndpointSeatPairingWindowIntegrity({
                ...window,
                entries: [{ ...window.entries[0], bindingRevision: window.entries[0].bindingRevision! + 1 }],
            }),
        ).to.throw(EndpointSeatBindingError);
        expect(() => assertEndpointSeatPairingWindowIntegrity({ ...window, _id: `${window._id}-wrong` })).to.throw(EndpointSeatBindingError);
    });
});
