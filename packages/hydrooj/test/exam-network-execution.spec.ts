import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamNetworkExecutionDoc } from '../src/model/exam-network-execution';
import type { VigilExamNetworkProjection } from '../src/service/vigil-bridge';

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
    if (left instanceof Date || right instanceof Date) return Number(left) === Number(right);
    return left === right;
}

class MemoryCollection {
    docs: ExamNetworkExecutionDoc[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: ExamNetworkExecutionDoc) {
        this.docs.push(cloneValue(doc));
        return { insertedId: doc._id };
    }

    async deleteMany(filter: Record<string, unknown>) {
        this.docs = this.docs.filter((doc) => !this.matches(doc, filter));
        return { deletedCount: 0 };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? cloneValue(found) : null;
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return null;
        const next = cloneValue(this.docs[index]) as unknown as Record<string, unknown>;
        for (const [path, value] of Object.entries((update.$set as Record<string, unknown> | undefined) || {})) {
            this.setPath(next, path, cloneValue(value));
        }
        for (const path of Object.keys((update.$unset as Record<string, unknown> | undefined) || {})) {
            this.deletePath(next, path);
        }
        this.docs[index] = next as unknown as ExamNetworkExecutionDoc;
        return cloneValue(this.docs[index]);
    }

    private getPath(doc: unknown, path: string): unknown {
        return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], doc);
    }

    private setPath(doc: Record<string, unknown>, path: string, value: unknown): void {
        const pieces = path.split('.');
        const leaf = pieces.pop()!;
        const parent = pieces.reduce<Record<string, unknown>>((target, key) => target[key] as Record<string, unknown>, doc);
        parent[leaf] = value;
    }

    private deletePath(doc: Record<string, unknown>, path: string): void {
        const pieces = path.split('.');
        const leaf = pieces.pop()!;
        const parent = pieces.reduce<Record<string, unknown>>((target, key) => target[key] as Record<string, unknown>, doc);
        delete parent[leaf];
    }

    private matches(doc: ExamNetworkExecutionDoc, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => {
            const actual = this.getPath(doc, field);
            if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
                const operators = expected as Record<string, unknown>;
                if ('$exists' in operators) return (actual !== undefined) === operators.$exists;
                if ('$in' in operators) return (operators.$in as unknown[]).some((value) => same(actual, value));
            }
            return same(actual, expected);
        });
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
const productionCollection = new MemoryCollection();
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection: () => productionCollection,
        },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const executionModule = require('../src/model/exam-network-execution.ts') as typeof import('../src/model/exam-network-execution');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const eventId = new ObjectId('66b800000000000000000801');
const schoolId = new ObjectId('66b800000000000000000802');
const policyId = new ObjectId('66b800000000000000000803');
const targetId = new ObjectId('66b800000000000000000804');
const executionId = new ObjectId('66b800000000000000000805');
const policyRef = { id: policyId, revision: 1, fingerprint: 'a'.repeat(64) };
const targetRef = { id: targetId, revision: 1, fingerprint: 'b'.repeat(64) };

function fixture() {
    const collection = new MemoryCollection();
    let now = new Date('2026-08-11T02:00:00.000Z');
    const service = new executionModule.ExamNetworkExecutionService(
        collection as never,
        () => new Date(now),
        () => executionId,
        async () => ['ep_one'],
    );
    return { collection, service, setNow: (value: string) => (now = new Date(value)) };
}

async function create(service: InstanceType<typeof executionModule.ExamNetworkExecutionService>) {
    return await service.beginApply({
        executionId,
        domainId: 'system',
        eventId,
        schoolId,
        expectedRevision: 0,
        actorUid: 1,
        policyRef,
        targetRef,
        startAt: new Date('2026-08-11T06:00:00.000Z'),
        hardEndAt: new Date('2026-08-11T08:00:00.000Z'),
    });
}

function projection(execution: ExamNetworkExecutionDoc, projectionRevision = 1): VigilExamNetworkProjection {
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
        policyRef: { id: execution.policyRef.id.toHexString(), revision: execution.policyRef.revision, fingerprint: execution.policyRef.fingerprint },
        targetRef: { id: execution.targetRef.id.toHexString(), revision: execution.targetRef.revision, fingerprint: execution.targetRef.fingerprint },
        hardEndAt: execution.hardEndAt.toISOString(),
        projectionRevision,
        dispatchStatus: 'complete',
        summary: { sent: 1 },
        items: [
            {
                commandId: 'examnet_1',
                endpointId: 'ep_one',
                executionSessionId: 'session_one',
                commandRevision: 1,
                command: execution.operation.kind === 'apply' ? 'apply_network_policy' : 'stop_network_policy',
                expectedPolicyRevision: execution.networkPolicyRevision,
                appliedPolicyRevision: null,
                status: 'sent',
                failureReason: null,
                online: true,
                networkPolicyState: { state: 'inactive', reason: 'initialized', permitRuleCount: 0 },
            },
        ],
    };
}

async function reason(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        expect(error).to.be.instanceOf(executionModule.ExamNetworkExecutionError);
        return (error as InstanceType<typeof executionModule.ExamNetworkExecutionError>).reason;
    }
}

describe('exam network execution canonical facts', () => {
    it('creates a deterministic idempotent operation and exact indexes', async () => {
        const { collection, service } = fixture();
        await service.ensureIndexes();
        const execution = await create(service);
        expect(execution).to.include({ revision: 1, networkPolicyRevision: 1, desiredState: 'active' });
        expect(execution.operation).to.include({
            kind: 'apply',
            requestId: `exam-network:${executionId}:1:apply`,
            idempotencyKey: `exam-network:${executionId}:1:apply`,
            status: 'dispatching',
        });
        expect(collection.indexes[0]).to.deep.equal({
            key: { domainId: 1, eventId: 1 },
            options: { name: 'examNetworkExecutionEvent', unique: true },
        });
    });

    it('recovers an unknown response and applies only monotonic matching projections', async () => {
        const { service, setNow } = fixture();
        const execution = await create(service);
        setNow('2026-08-11T02:01:00.000Z');
        const unknown = await service.markUnknown('system', eventId, 1, execution.operation.requestId, 'vigil_response_unknown');
        expect(unknown.operation.status).to.equal('unknown');

        const first = await service.applyProjection(projection(execution));
        expect(first.changed).to.equal(true);
        expect(first.execution.operation.status).to.equal('received');
        expect(first.execution.projection?.revision).to.equal(1);
        expect((await service.applyProjection(projection(execution))).changed).to.equal(false);

        const conflicting = projection(execution);
        conflicting.summary = { applied: 1 };
        expect(await reason(() => service.applyProjection(conflicting))).to.equal('projection_revision_conflict');

        const stale = projection(execution, 0);
        expect((await service.applyProjection(stale)).changed).to.equal(false);
        expect((await service.get('system', eventId))?.projection?.revision).to.equal(1);
    });

    it('rejects projections whose endpoint set differs from the immutable target revision', async () => {
        const { service } = fixture();
        const execution = await create(service);
        const missing = projection(execution);
        missing.items = [];
        missing.summary = {};
        missing.dispatchStatus = 'dispatching';
        expect((await service.applyProjection(missing)).execution.operation.status).to.equal('unknown');
        missing.dispatchStatus = 'complete';
        missing.projectionRevision = 2;
        expect(await reason(() => service.applyProjection(missing))).to.equal('projection_target_mismatch');

        const extra = projection(execution);
        extra.items.push({ ...extra.items[0], commandId: 'examnet_2', endpointId: 'ep_two' });
        extra.summary = { sent: 2 };
        expect(await reason(() => service.applyProjection(extra))).to.equal('projection_target_mismatch');
    });

    it('allows a delivery-unknown operation to converge to a definite failure', async () => {
        const { service } = fixture();
        const execution = await create(service);
        const unknown = await service.markUnknown('system', eventId, 1, execution.operation.requestId, 'vigil_delivery_unknown');
        expect(unknown.operation.status).to.equal('unknown');
        const failed = await service.markFailed('system', eventId, 1, execution.operation.requestId, 'vigil_http_rejected');
        expect(failed.operation.status).to.equal('failed');
        expect(failed.operation.failureReason).to.equal('vigil_http_rejected');
        expect(failed.operation.unknownAt).to.equal(undefined);
        const retriedUnknown = await service.markUnknown(
            'system',
            eventId,
            1,
            execution.operation.requestId,
            'vigil_delivery_unknown',
        );
        expect(retriedUnknown.operation.status).to.equal('unknown');
        expect(retriedUnknown.operation.failureReason).to.equal('vigil_delivery_unknown');
        expect(retriedUnknown.operation.failedAt).to.equal(undefined);
        const failedAgain = await service.markFailed('system', eventId, 1, execution.operation.requestId, 'vigil_http_rejected');
        expect(failedAgain.operation.failedAt).to.be.instanceOf(Date);
        const recovered = await service.applyProjection(projection(execution));
        expect(recovered.execution.operation.status).to.equal('received');
        expect(recovered.execution.operation.failedAt).to.equal(undefined);
    });

    it('ignores an older operation callback after a newer policy revision starts', async () => {
        const { service } = fixture();
        const first = await create(service);
        await service.applyProjection(projection(first));
        const second = await service.beginApply({
            executionId,
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 1,
            actorUid: 1,
            policyRef: { id: policyId, revision: 2, fingerprint: 'c'.repeat(64) },
            targetRef,
            startAt: first.startAt,
            hardEndAt: first.hardEndAt,
        });
        expect(second).to.include({ revision: 2, networkPolicyRevision: 2 });
        const stale = await service.applyProjection(projection(first, 2));
        expect(stale.changed).to.equal(false);
        expect(stale.execution.revision).to.equal(2);
        expect(stale.execution.projection).to.equal(undefined);
    });

    it('stops the immutable target with a new execution revision', async () => {
        const { service } = fixture();
        const active = await create(service);
        const stopped = await service.beginStop({
            domainId: 'system',
            eventId,
            expectedRevision: 1,
            actorUid: 1,
        });
        expect(stopped).to.include({ revision: 2, networkPolicyRevision: 1, desiredState: 'stopped' });
        expect(stopped.operation).to.include({ kind: 'stop', status: 'dispatching' });
        expect(stopped.policyRef).to.deep.equal(active.policyRef);
        expect(stopped.targetRef).to.deep.equal(active.targetRef);

        const nextTargetRef = { id: targetId, revision: 2, fingerprint: 'd'.repeat(64) };
        expect(
            await reason(() =>
                service.beginApply({
                    executionId,
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 2,
                    actorUid: 1,
                    policyRef,
                    targetRef: nextTargetRef,
                    startAt: active.startAt,
                    hardEndAt: active.hardEndAt,
                }),
            ),
        ).to.equal('target_release_unconfirmed');
        const released = projection(stopped);
        released.items[0].status = 'applied';
        released.items[0].appliedPolicyRevision = stopped.networkPolicyRevision;
        released.summary = { applied: 1 };
        await service.applyProjection(released);
        const restarted = await service.beginApply({
            executionId,
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 2,
            actorUid: 1,
            policyRef,
            targetRef: nextTargetRef,
            startAt: active.startAt,
            hardEndAt: active.hardEndAt,
        });
        expect(restarted).to.include({ revision: 3, networkPolicyRevision: 2, desiredState: 'active' });
        expect(restarted.targetRef).to.deep.equal(nextTargetRef);
    });

    it('rejects changing an active target snapshot or an unchanged policy', async () => {
        const { service } = fixture();
        const active = await create(service);
        expect(
            await reason(() =>
                service.beginApply({
                    executionId,
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 1,
                    actorUid: 1,
                    policyRef,
                    targetRef,
                    startAt: active.startAt,
                    hardEndAt: active.hardEndAt,
                }),
            ),
        ).to.equal('network_policy_unchanged');
        expect(
            await reason(() =>
                service.beginApply({
                    executionId,
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 1,
                    actorUid: 1,
                    policyRef: { id: policyId, revision: 2, fingerprint: 'c'.repeat(64) },
                    targetRef: { id: targetId, revision: 2, fingerprint: 'd'.repeat(64) },
                    startAt: active.startAt,
                    hardEndAt: active.hardEndAt,
                }),
            ),
        ).to.equal('target_change_requires_stop');
    });
});
