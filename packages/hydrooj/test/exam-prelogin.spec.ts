import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import type {
    ExamPreloginBatchDoc,
    ExamPreloginPreparation,
    ExamPreloginRetryPayload,
    ExamPreloginTicketDoc,
    ExamPreloginWorkflowBinding,
} from '../src/model/exam-prelogin';

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value) as T;
    if (Array.isArray(value)) return value.map(cloneValue) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
    }
    return value;
}

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date || right instanceof Date) {
        return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => same(item, right[index]));
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const leftEntries = Object.entries(left);
        return (
            leftEntries.length === Object.keys(right).length &&
            leftEntries.every(([key, value]) => same(value, (right as Record<string, unknown>)[key]))
        );
    }
    return left === right;
}

function pathValue(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[key];
    }, value);
}

function legacyBatchFingerprint(doc: Omit<ExamPreloginBatchDoc, 'fingerprint'>): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                _id: doc._id.toHexString(),
                domainId: doc.domainId,
                eventId: doc.eventId.toHexString(),
                eventRevision: doc.eventRevision,
                assignment: {
                    assignmentId: doc.assignment.assignmentId.toHexString(),
                    revision: doc.assignment.revision,
                    fingerprint: doc.assignment.fingerprint,
                },
                publicationRevision: doc.publicationRevision,
                requestId: doc.requestId,
                preparationFingerprint: doc.preparationFingerprint,
                state: doc.state,
                revision: doc.revision,
                ticketIds: doc.ticketIds.map((id) => id.toHexString()),
                projection: doc.projection,
                createdAt: doc.createdAt.toISOString(),
                createdBy: doc.createdBy,
                updatedAt: doc.updatedAt.toISOString(),
            }),
            'utf8',
        )
        .digest('hex');
}

class MemoryCollection<T extends { _id: ObjectId }> {
    docs: T[] = [];

    async createIndex() {
        return 'index';
    }

    async findOne(filter: Record<string, unknown>): Promise<T | null> {
        return (
            this.docs.find((doc) =>
                Object.entries(filter).every(([key, value]) => {
                    const actual = pathValue(doc, key);
                    if (actual instanceof ObjectId && value instanceof ObjectId) return actual.equals(value);
                    return actual === value;
                }),
            ) || null
        );
    }

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) =>
            Object.entries(filter).every(([key, value]) => {
                const actual = pathValue(doc, key);
                if (actual instanceof ObjectId && value instanceof ObjectId) return actual.equals(value);
                return actual === value;
            }),
        );
        const cursor = {
            sort: (spec: Record<string, 1 | -1>) => {
                rows = [...rows].sort((left, right) => {
                    for (const [key, direction] of Object.entries(spec)) {
                        const leftValue = (left as unknown as Record<string, unknown>)[key];
                        const rightValue = (right as unknown as Record<string, unknown>)[key];
                        const leftComparable =
                            leftValue instanceof Date
                                ? leftValue.toISOString()
                                : leftValue instanceof ObjectId
                                  ? leftValue.toHexString()
                                  : String(leftValue);
                        const rightComparable =
                            rightValue instanceof Date
                                ? rightValue.toISOString()
                                : rightValue instanceof ObjectId
                                  ? rightValue.toHexString()
                                  : String(rightValue);
                        if (leftComparable === rightComparable) continue;
                        return (leftComparable! < rightComparable! ? -1 : 1) * direction;
                    }
                    return 0;
                });
                return cursor;
            },
            limit: (limit: number) => {
                rows = rows.slice(0, limit);
                return cursor;
            },
            toArray: async () => rows,
        };
        return cursor;
    }

    async insertOne(doc: T) {
        if (this.docs.some((item) => item._id.equals(doc._id))) {
            const error = new Error('duplicate key') as Error & { code: number };
            error.code = 11000;
            throw error;
        }
        this.docs.push(cloneValue(doc));
        return { insertedId: doc._id };
    }

    async replaceOne(expected: T, target: T) {
        const index = this.docs.findIndex((doc) => same(doc, expected));
        if (index < 0) return { matchedCount: 0 };
        this.docs[index] = cloneValue(target);
        return { matchedCount: 1 };
    }

    async deleteMany(filter: Record<string, unknown>) {
        this.docs = this.docs.filter(
            (doc) =>
                !Object.entries(filter).every(([key, value]) => {
                    const actual = pathValue(doc, key);
                    if (actual instanceof ObjectId && value instanceof ObjectId) return actual.equals(value);
                    return actual === value;
                }),
        );
        return { deletedCount: 0 };
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: { collection: () => new MemoryCollection() },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const moduleUnderTest = require('../src/model/exam-prelogin.ts') as typeof import('../src/model/exam-prelogin');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];
const { createExamPreloginDispatchRecovery, ExamPreloginError, ExamPreloginService, createExamPreloginPreparation } = moduleUnderTest;

const now = new Date('2026-08-12T01:00:00.000Z');
const eventId = new ObjectId('64b000000000000000000001');
const assignmentId = new ObjectId('64b000000000000000000002');
const studentRecordId = new ObjectId('64b000000000000000000003');
const bindingId = new ObjectId('64b000000000000000000004');
const secondStudentRecordId = new ObjectId('64b000000000000000000006');
const secondBindingId = new ObjectId('64b000000000000000000007');

function workflowBinding(overrides: Partial<ExamPreloginWorkflowBinding> = {}): ExamPreloginWorkflowBinding {
    return {
        fingerprint: 'f'.repeat(64),
        executionRevision: 8,
        policy: { id: new ObjectId('64b000000000000000000008'), revision: 2, fingerprint: 'b'.repeat(64) },
        target: { id: new ObjectId('64b000000000000000000009'), revision: 3, fingerprint: 'c'.repeat(64) },
        targetCount: 2,
        startAt: new Date('2026-08-12T00:30:00.000Z'),
        hardEndAt: new Date('2026-08-12T03:00:00.000Z'),
        ...overrides,
    };
}

function confirmInput(preparationValue: ExamPreloginPreparation, requestId: string, actorUid = 7) {
    return { preparation: preparationValue, workflow: workflowBinding(), requestId, actorUid };
}

function preparation(overrides: Partial<ExamPreloginPreparation> = {}): ExamPreloginPreparation {
    const base: Omit<ExamPreloginPreparation, 'fingerprint'> = {
        schemaVersion: 1,
        domainId: 'system',
        eventId,
        eventRevision: 4,
        assignment: { assignmentId, revision: 2, fingerprint: 'a'.repeat(64) },
        publicationRevision: 1,
        workspace: { kind: 'contest', contestId: '64b000000000000000000005', path: '/exam-mode/64b000000000000000000005' },
        items: [
            {
                uid: 42,
                studentRecordId,
                sourceSeatId: 'seat-1',
                bindingId,
                bindingRevision: 3,
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
    };
    const { fingerprint: _ignored, ...withoutFingerprint } = overrides;
    return createExamPreloginPreparation({ ...base, ...withoutFingerprint });
}

function twoStudentPreparation(): ExamPreloginPreparation {
    const first = preparation();
    return createExamPreloginPreparation({
        ...first,
        items: [
            first.items[0],
            {
                ...first.items[0],
                uid: 43,
                studentRecordId: secondStudentRecordId,
                sourceSeatId: 'seat-2',
                bindingId: secondBindingId,
                endpointId: 'ep_two',
            },
        ],
    });
}

function service(
    dispatches: unknown[] = [],
    clock = { now: new Date(now) },
    retry: (payload: ExamPreloginRetryPayload) => Promise<unknown> = async () => {
        throw new Error('unexpected retry');
    },
    dispatch?: (payload: import('../src/model/exam-prelogin').ExamPreloginDispatchPayload) => Promise<unknown>,
) {
    const batches = new MemoryCollection<ExamPreloginBatchDoc>();
    const tickets = new MemoryCollection<ExamPreloginTicketDoc>();
    return {
        batches,
        tickets,
        value: new ExamPreloginService(batches, tickets, {
            now: () => new Date(clock.now),
            ticketKey: '01'.repeat(32),
            dispatch:
                dispatch ||
                (async (payload) => {
                    dispatches.push(structuredClone(payload));
                    return {
                        requestId: payload.requestId,
                        batchId: payload.batchId,
                        dispatchStatus: 'complete',
                        projectionRevision: 1,
                        summary: { queued: payload.items.length },
                        items: payload.items.map((item, index) => ({
                            ticketId: item.ticketId,
                            endpointId: item.endpointId,
                            commandId: `prelogin_command_${index + 1}`,
                            status: 'queued',
                            stage: 'dispatch',
                            failureReason: null,
                        })),
                    };
                }),
            retry,
        }),
    };
}

test('facing-only presentation warnings do not invalidate the preparation authorization fingerprint', () => {
    const original = preparation();
    const { fingerprint: _originalFingerprint, ...facts } = original;
    const facingChanged = createExamPreloginPreparation({
        ...facts,
        items: facts.items.map((item) => ({
            ...item,
            diagnostics: [{ code: 'seat_facing_changed' as const, severity: 'warning' as const }],
        })),
        warningCount: 1,
    });
    const hardChanged = createExamPreloginPreparation({
        ...facts,
        items: facts.items.map((item) => ({
            ...item,
            ready: false,
            diagnostics: [{ code: 'assignment_reference_changed' as const, severity: 'error' as const }],
        })),
        hardErrorCount: 1,
    });

    assert.equal(facingChanged.fingerprint, original.fingerprint);
    assert.notEqual(hardChanged.fingerprint, original.fingerprint);
});

test('confirm persists only ticket digests and replays one request without duplicate dispatch identity', async () => {
    const dispatches: unknown[] = [];
    const { value, batches, tickets } = service(dispatches);
    const input = confirmInput(preparation(), 'prelogin_request_1');

    const first = await value.confirm(input);
    const replay = await value.confirm(input);

    assert.equal(first.batch._id.toHexString(), replay.batch._id.toHexString());
    assert.equal(batches.docs.length, 1);
    assert.equal(tickets.docs.length, 1);
    assert.equal(dispatches.length, 1);
    assert.match(tickets.docs[0].ticketDigest, /^[a-f0-9]{64}$/);
    const persisted = JSON.stringify({ batches: batches.docs, tickets: tickets.docs, dispatches });
    assert.doesNotMatch(persisted, /KPT1\./);
    assert.equal(first.batch.state, 'dispatched');
    await assert.rejects(
        value.confirm({ ...input, workflow: workflowBinding({ executionRevision: 9 }) }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'request_id_conflict',
    );
    await assert.rejects(
        value.confirm({ ...input, requestId: 'prelogin_request_2' }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'assignment_already_confirmed',
    );
    assert.equal(dispatches.length, 1);
});

test('immutable v2 recovery facts complete partially persisted tickets after a crash', async () => {
    const dispatches: unknown[] = [];
    const { value, batches, tickets } = service(dispatches);
    const originalInsert = tickets.insertOne.bind(tickets);
    let insertAttempt = 0;
    tickets.insertOne = async (doc) => {
        insertAttempt++;
        if (insertAttempt === 2) throw new Error('simulated_ticket_insert_crash');
        return originalInsert(doc);
    };

    const input = confirmInput(twoStudentPreparation(), 'prelogin_partial_ticket_claim');
    await assert.rejects(value.confirm(input), /simulated_ticket_insert_crash/);
    assert.equal(batches.docs[0].state, 'dispatching');
    assert.equal(Object.hasOwn(batches.docs[0], 'dispatchClaim'), false);
    assert.equal(tickets.docs.length, 1);

    tickets.insertOne = originalInsert;
    const recovery = createExamPreloginDispatchRecovery(input.preparation, batches.docs[0].ticketIds);
    const recovered = await value.resumeDispatching(batches.docs[0], recovery);

    assert.equal(recovered.batch.state, 'dispatched');
    assert.equal(tickets.docs.length, 2);
    assert.equal(dispatches.length, 1);
});

test('manager recovery resolves a batch by request id and returns its safe ticket identities in batch order', async () => {
    const { value } = service();
    const confirmed = await value.confirm(confirmInput(twoStudentPreparation(), 'prelogin_recovery_request'));

    const recovered = await value.getBatchByRequest('system', eventId, 'prelogin_recovery_request');
    assert.equal(recovered?._id.toHexString(), confirmed.batch._id.toHexString());
    assert.equal(await value.getBatchByRequest('system', eventId, 'prelogin_missing_request'), null);

    const subjects = await value.listBatchTickets(confirmed.batch);
    assert.deepEqual(
        subjects.map((ticket) => ({
            ticketId: ticket._id.toHexString(),
            uid: ticket.uid,
            sourceSeatId: ticket.sourceSeatId,
            endpointId: ticket.endpointId,
        })),
        [
            { ticketId: confirmed.batch.ticketIds[0].toHexString(), uid: 42, sourceSeatId: 'seat-1', endpointId: 'ep_one' },
            { ticketId: confirmed.batch.ticketIds[1].toHexString(), uid: 43, sourceSeatId: 'seat-2', endpointId: 'ep_two' },
        ],
    );
    assert.doesNotMatch(JSON.stringify(subjects), /KPT1\./);
    assert.equal((await value.getLatestBatch('system', eventId))?._id.toHexString(), confirmed.batch._id.toHexString());
});

test('batch history is stable and preserves strict legacy batches without a workflow field', async () => {
    const clock = { now: new Date(now) };
    const { value, batches } = service([], clock);
    const first = await value.confirm(confirmInput(preparation(), 'prelogin_history_request_1'));
    const legacy = cloneValue(first.batch);
    delete legacy.workflow;
    const { fingerprint: _fingerprint, ...legacyWithoutFingerprint } = legacy;
    legacy.fingerprint = legacyBatchFingerprint(legacyWithoutFingerprint);
    batches.docs[0] = cloneValue(legacy);

    assert.equal((await value.getBatch('system', eventId, legacy._id))?.workflow, undefined);
    clock.now = new Date(clock.now.getTime() + 1000);
    const secondPreparation = preparation({
        assignment: { assignmentId: new ObjectId('64b00000000000000000000a'), revision: 3, fingerprint: 'd'.repeat(64) },
        publicationRevision: 2,
    });
    const second = await value.confirm(confirmInput(secondPreparation, 'prelogin_history_request_2'));
    const history = await value.listBatches('system', eventId);

    assert.deepEqual(
        history.map((batch) => batch._id.toHexString()),
        [second.batch._id.toHexString(), legacy._id.toHexString()],
    );
    assert.equal(history[1].workflow, undefined);
});

test('root administrator uid 1 may confirm a prepared batch', async () => {
    const { value } = service();
    const result = await value.confirm(confirmInput(preparation(), 'prelogin_root_request', 1));
    assert.equal(result.batch.createdBy, 1);
});

test('confirm converges after dispatch response loss even when the endpoint already redeemed its ticket', async () => {
    let attempts = 0;
    const clock = { now: new Date(now) };
    const { value, batches, tickets } = service([], clock, undefined, async (payload) => {
        attempts++;
        if (attempts === 1) throw new Error('dispatch_response_lost');
        return {
            requestId: payload.requestId,
            batchId: payload.batchId,
            dispatchStatus: 'complete',
            projectionRevision: 1,
            summary: { sent: 1 },
            items: payload.items.map((item) => ({
                ticketId: item.ticketId,
                endpointId: item.endpointId,
                commandId: 'prelogin_response_loss_command',
                status: 'sent',
                stage: 'redeemed',
                failureReason: null,
            })),
        };
    });
    const input = confirmInput(preparation(), 'prelogin_response_loss_1');

    await assert.rejects(value.confirm(input), /dispatch_response_lost/);
    const material = await value.materialize({
        batchId: batches.docs[0]._id,
        ticketId: batches.docs[0].ticketIds[0],
        endpointId: 'ep_one',
    });
    await value.redeem({
        ticket: material.ticket,
        batchId: batches.docs[0]._id,
        endpointId: 'ep_one',
        requestId: 'redeem_response_loss_1',
        validateCurrent: async () => undefined,
    });

    const recovered = await value.confirm(input);
    assert.equal(recovered.batch.state, 'dispatched');
    assert.equal(attempts, 2);
    assert.equal(tickets.docs[0].state, 'redeemed');
    assert.equal(tickets.docs[0].redemptionRequestId, 'redeem_response_loss_1');
});

test('confirm blocks the whole batch before persistence when preparation contains a hard error', async () => {
    const { value, batches, tickets } = service();
    const blocked = preparation({
        hardErrorCount: 1,
        items: [
            {
                ...preparation().items[0],
                ready: false,
                diagnostics: [{ code: 'endpoint_offline', severity: 'error' }],
            },
        ],
    });

    await assert.rejects(
        value.confirm(confirmInput(blocked, 'prelogin_request_2')),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'preparation_blocked',
    );
    assert.equal(batches.docs.length, 0);
    assert.equal(tickets.docs.length, 0);
});

test('ticket material is endpoint-bound and redemption is one-shot but response-loss replay is idempotent', async () => {
    const clock = { now: new Date(now) };
    const { value, tickets } = service([], clock);
    const confirmed = await value.confirm(confirmInput(preparation(), 'prelogin_request_3'));
    const ticketId = confirmed.batch.ticketIds[0];

    await assert.rejects(
        value.materialize({ batchId: confirmed.batch._id, ticketId, endpointId: 'ep_other' }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'ticket_endpoint_mismatch',
    );
    const material = await value.materialize({ batchId: confirmed.batch._id, ticketId, endpointId: 'ep_one' });
    assert.match(material.ticket, /^KPT1\.[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(tickets.docs).includes(material.ticket), false);

    const redeemed = await value.redeem({
        ticket: material.ticket,
        batchId: confirmed.batch._id,
        endpointId: 'ep_one',
        requestId: 'redeem_request_1',
        validateCurrent: async () => undefined,
    });
    const replay = await value.redeem({
        ticket: material.ticket,
        batchId: confirmed.batch._id,
        endpointId: 'ep_one',
        requestId: 'redeem_request_1',
        validateCurrent: async () => undefined,
    });
    assert.deepEqual(replay, redeemed);
    const recoveredMaterial = await value.materialize({
        batchId: confirmed.batch._id,
        ticketId,
        endpointId: 'ep_one',
    });
    assert.deepEqual(recoveredMaterial, material);
    await assert.rejects(
        value.redeem({
            ticket: material.ticket,
            batchId: confirmed.batch._id,
            endpointId: 'ep_one',
            requestId: 'redeem_request_1',
            validateCurrent: async () => {
                throw new ExamPreloginError('seat_binding_changed');
            },
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'seat_binding_changed',
    );
    clock.now = new Date(tickets.docs[0].expiresAt);
    await assert.rejects(
        value.redeem({
            ticket: material.ticket,
            batchId: confirmed.batch._id,
            endpointId: 'ep_one',
            requestId: 'redeem_request_1',
            validateCurrent: async () => undefined,
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'ticket_expired',
    );
    clock.now = new Date(now);
    await assert.rejects(
        value.redeem({
            ticket: material.ticket,
            batchId: confirmed.batch._id,
            endpointId: 'ep_one',
            requestId: 'redeem_request_2',
            validateCurrent: async () => undefined,
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'ticket_already_redeemed',
    );
});

test('ticket expiry and current-fact drift fail before redemption mutation', async () => {
    const clock = { now: new Date(now) };
    const { value, tickets } = service([], clock);
    const confirmed = await value.confirm(confirmInput(preparation(), 'prelogin_request_4'));
    const ticketId = confirmed.batch.ticketIds[0];
    const material = await value.materialize({ batchId: confirmed.batch._id, ticketId, endpointId: 'ep_one' });
    const before = cloneValue(tickets.docs[0]);

    await assert.rejects(
        value.redeem({
            ticket: material.ticket,
            batchId: confirmed.batch._id,
            endpointId: 'ep_one',
            requestId: 'redeem_request_3',
            validateCurrent: async () => {
                throw new ExamPreloginError('user_binding_changed');
            },
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'user_binding_changed',
    );
    assert.deepEqual(tickets.docs[0], before);

    clock.now = new Date(tickets.docs[0].expiresAt);
    await assert.rejects(
        value.redeem({
            ticket: material.ticket,
            batchId: confirmed.batch._id,
            endpointId: 'ep_one',
            requestId: 'redeem_request_4',
            validateCurrent: async () => undefined,
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'ticket_expired',
    );
});

test('stored batch and ticket documents reject unknown canonical fields', async () => {
    const first = service();
    const confirmed = await first.value.confirm(confirmInput(preparation(), 'prelogin_request_5'));
    Object.assign(first.batches.docs[0], { unknownBatchFact: true });
    await assert.rejects(
        first.value.getBatch('system', eventId, confirmed.batch._id),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'batch_schema_invalid',
    );

    const second = service();
    const issued = await second.value.confirm(confirmInput(preparation(), 'prelogin_request_6'));
    Object.assign(second.tickets.docs[0], { unknownTicketFact: true });
    await assert.rejects(
        second.value.materialize({ batchId: issued.batch._id, ticketId: issued.batch.ticketIds[0], endpointId: 'ep_one' }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'ticket_schema_invalid',
    );
});

test('projection callbacks advance monotonically and same revision conflicts fail closed', async () => {
    const { value } = service();
    const confirmed = await value.confirm(confirmInput(preparation(), 'prelogin_request_7'));
    const next = {
        ...confirmed.projection,
        dispatchStatus: 'complete' as const,
        projectionRevision: 2,
        summary: { applied: 1 },
        items: confirmed.projection.items.map((item) => ({
            ...item,
            status: 'applied' as const,
            stage: 'page_ready' as const,
        })),
    };

    const applied = await value.applyProjection('system', eventId, confirmed.batch._id, next);
    assert.equal(applied.changed, true);
    assert.equal(applied.batch.projection?.projectionRevision, 2);
    const replay = await value.applyProjection('system', eventId, confirmed.batch._id, next);
    assert.equal(replay.changed, false);

    await assert.rejects(
        value.applyProjection('system', eventId, confirmed.batch._id, {
            ...next,
            summary: { failed: 1 },
            items: next.items.map((item) => ({ ...item, status: 'failed' as const, failureReason: 'different' })),
        }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'projection_revision_conflict',
    );
    await assert.rejects(
        value.applyProjection('system', eventId, confirmed.batch._id, { ...confirmed.projection, projectionRevision: 1 }),
        (error: unknown) => error instanceof ExamPreloginError && error.reason === 'projection_revision_stale',
    );
});

test('retry derives the exact terminal failure set and preserves successful command facts', async () => {
    let failedProjection: import('../src/model/exam-prelogin').ExamPreloginProjection;
    const retryPayloads: ExamPreloginRetryPayload[] = [];
    const clock = { now: new Date(now) };
    const { value, tickets } = service([], clock, async (payload) => {
        retryPayloads.push(structuredClone(payload));
        return {
            ...failedProjection,
            projectionRevision: failedProjection.projectionRevision + 1,
            summary: { applied: 1, queued: 1 },
            items: failedProjection.items.map((item, index) =>
                index === 0 ? item : { ...item, commandId: 'prelogin_retry_command_2', status: 'queued', failureReason: null },
            ),
        };
    });
    const confirmed = await value.confirm({
        ...confirmInput(twoStudentPreparation(), 'prelogin_request_retry_base'),
    });
    failedProjection = {
        ...confirmed.projection,
        projectionRevision: 2,
        summary: { applied: 1, offline: 1 },
        items: confirmed.projection.items.map((item, index) => ({
            ...item,
            status: index === 0 ? 'applied' : 'offline',
            failureReason: index === 0 ? null : 'endpoint_offline_before_send',
        })),
    };
    await value.applyProjection('system', eventId, confirmed.batch._id, failedProjection);
    const validated: string[] = [];
    const retryInput = {
        domainId: 'system',
        eventId,
        batchId: confirmed.batch._id,
        expectedProjectionRevision: 2,
        requestId: 'prelogin_retry_request_1',
        actorUid: 7,
        ticketIds: [new ObjectId(failedProjection.items[1].ticketId)],
        validateCurrent: async (ticketSet) => {
            validated.push(...ticketSet.map((ticket) => ticket._id.toHexString()));
            return Object.fromEntries(ticketSet.map((ticket) => [ticket._id.toHexString(), null]));
        },
    };
    const retried = await value.retry(retryInput);
    clock.now = new Date(tickets.docs.find((ticket) => ticket._id.equals(retryInput.ticketIds[0]))!.expiresAt);
    const replayedAfterSavedResponseLoss = await value.retry(retryInput);

    assert.deepEqual(retryPayloads[0].ticketIds, [failedProjection.items[1].ticketId]);
    assert.equal(retryPayloads.length, 2);
    assert.deepEqual(retryPayloads[1], retryPayloads[0]);
    assert.deepEqual(validated, [failedProjection.items[1].ticketId, failedProjection.items[1].ticketId]);
    assert.equal(retried.projection.items[0].status, 'applied');
    assert.equal(retried.projection.items[0].commandId, failedProjection.items[0].commandId);
    assert.equal(retried.projection.items[1].commandId, 'prelogin_retry_command_2');
    assert.deepEqual(replayedAfterSavedResponseLoss.projection, retried.projection);
});

test('retry renews only an expired failed ticket and sends its exact new digest to Vigil', async () => {
    let expiredProjection: import('../src/model/exam-prelogin').ExamPreloginProjection;
    const retryPayloads: ExamPreloginRetryPayload[] = [];
    const clock = { now: new Date(now) };
    const { value, tickets } = service([], clock, async (payload) => {
        retryPayloads.push(structuredClone(payload));
        return {
            ...expiredProjection,
            projectionRevision: expiredProjection.projectionRevision + 1,
            summary: { queued: 1 },
            items: expiredProjection.items.map((item) => ({
                ...item,
                commandId: 'prelogin_renewed_command',
                status: 'queued',
                stage: 'dispatch',
                failureReason: null,
            })),
        };
    });
    const confirmed = await value.confirm(confirmInput(preparation(), 'prelogin_renewal_base'));
    expiredProjection = {
        ...confirmed.projection,
        projectionRevision: 2,
        summary: { expired: 1 },
        items: confirmed.projection.items.map((item) => ({
            ...item,
            status: 'expired',
            failureReason: 'command_expired',
        })),
    };
    await value.applyProjection('system', eventId, confirmed.batch._id, expiredProjection);
    const previous = cloneValue(tickets.docs[0]);
    clock.now = new Date(previous.expiresAt);

    await value.retry({
        domainId: 'system',
        eventId,
        batchId: confirmed.batch._id,
        expectedProjectionRevision: 2,
        requestId: 'prelogin_renewal_retry_1',
        actorUid: 7,
        ticketIds: [previous._id],
        validateCurrent: async (ticketSet) => Object.fromEntries(ticketSet.map((ticket) => [ticket._id.toHexString(), null])),
    });

    assert.equal(retryPayloads.length, 1);
    assert.deepEqual(retryPayloads[0].ticketIds, [previous._id.toHexString()]);
    assert.equal(retryPayloads[0].tickets[0].ticketId, previous._id.toHexString());
    assert.notEqual(retryPayloads[0].tickets[0].ticketDigest, previous.ticketDigest);
    assert.equal(retryPayloads[0].tickets[0].ticketDigest, tickets.docs[0].ticketDigest);
    assert.ok(tickets.docs[0].issuedAt >= previous.expiresAt);
    assert.equal(tickets.docs[0].state, 'issued');
});

test('retry resumes the exact redeemed session without renewing the expired ticket', async () => {
    let failedProjection: import('../src/model/exam-prelogin').ExamPreloginProjection;
    const retryPayloads: ExamPreloginRetryPayload[] = [];
    const clock = { now: new Date(now) };
    const { value, tickets } = service([], clock, async (payload) => {
        retryPayloads.push(structuredClone(payload));
        if (retryPayloads.length === 1) throw new Error('resume_response_lost');
        return {
            ...failedProjection,
            projectionRevision: failedProjection.projectionRevision + 1,
            summary: { queued: 1 },
            items: failedProjection.items.map((item) => ({
                ...item,
                commandId: 'prelogin_resume_command',
                status: 'queued',
                stage: 'dispatch',
                failureReason: null,
            })),
        };
    });
    const confirmed = await value.confirm(confirmInput(preparation(), 'prelogin_resume_base'));
    const ticketId = confirmed.batch.ticketIds[0];
    const material = await value.materialize({ batchId: confirmed.batch._id, ticketId, endpointId: 'ep_one' });
    await value.redeem({
        ticket: material.ticket,
        batchId: confirmed.batch._id,
        endpointId: 'ep_one',
        requestId: 'prelogin_resume_redeem',
        validateCurrent: async () => undefined,
    });
    failedProjection = {
        ...confirmed.projection,
        projectionRevision: 2,
        summary: { failed: 1 },
        items: confirmed.projection.items.map((item) => ({
            ...item,
            status: 'failed',
            stage: 'redeemed',
            failureReason: 'page_launch_failed',
        })),
    };
    await value.applyProjection('system', eventId, confirmed.batch._id, failedProjection);
    const redeemed = cloneValue(tickets.docs[0]);
    clock.now = new Date(redeemed.expiresAt.getTime() + 1);

    const retryInput = {
        domainId: 'system',
        eventId,
        batchId: confirmed.batch._id,
        expectedProjectionRevision: 2,
        requestId: 'prelogin_resume_retry',
        actorUid: 7,
        ticketIds: [ticketId],
        validateCurrent: async (ticketSet) => ({ [ticketSet[0]._id.toHexString()]: 'session_exact' }),
    };
    await assert.rejects(value.retry(retryInput), /resume_response_lost/);
    await value.retry(retryInput);

    assert.deepEqual(tickets.docs[0], redeemed);
    assert.equal(retryPayloads.length, 2);
    assert.deepEqual(retryPayloads[1], retryPayloads[0]);
    assert.equal(retryPayloads[0].tickets[0].ticketDigest, redeemed.ticketDigest);
    assert.equal(retryPayloads[0].tickets[0].expiresAt, redeemed.expiresAt.toISOString());
    assert.equal(retryPayloads[0].tickets[0].resumeSessionId, 'session_exact');
});
