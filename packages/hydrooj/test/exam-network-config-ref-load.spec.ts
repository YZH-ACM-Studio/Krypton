import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamPolicyRevision, ExamTargetRevision } from '../src/model/exam-network-config';

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value) as T;
    if (Array.isArray(value)) return value.map(cloneValue) as T;
    if (value && typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])) as T;
}

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date || right instanceof Date) return Number(left) === Number(right);
    return left === right;
}

class MemoryCollection<T extends Record<string, unknown>> {
    docs: T[] = [];

    async createIndex() {
        return 'index';
    }

    async insertOne(doc: T) {
        this.docs.push(cloneValue(doc));
        return { insertedId: (doc as { _id: ObjectId })._id };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? cloneValue(found) : null;
    }

    async findOneAndUpdate() {
        return null;
    }

    async deleteMany() {
        return { deletedCount: 0 };
    }

    find() {
        return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) };
    }

    private getPath(doc: T, path: string): unknown {
        return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], doc);
    }

    private matches(doc: T, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => same(this.getPath(doc, field), expected));
    }
}

const collections = new Map<string, MemoryCollection<Record<string, unknown>>>();
const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection: (name: string) => {
                const collection = new MemoryCollection<Record<string, unknown>>();
                collections.set(name, collection);
                return collection;
            },
        },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const configModule = require('../src/model/exam-network-config.ts') as typeof import('../src/model/exam-network-config');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const schoolId = new ObjectId('66b800000000000000000901');
const otherSchoolId = new ObjectId('66b800000000000000000902');
const eventId = new ObjectId('66b800000000000000000903');
const otherEventId = new ObjectId('66b800000000000000000904');
const templateId = new ObjectId('66b800000000000000000905');
const assignmentId = new ObjectId('66b800000000000000000906');
const publishedAt = new Date('2026-08-11T01:00:00.000Z');
const policyFingerprint = 'a'.repeat(64);
const targetFingerprint = 'b'.repeat(64);
const sourceFingerprint = 'c'.repeat(64);

function policy(): ExamPolicyRevision['policy'] {
    return { hosts: ['judge.example.edu', 'vigil.example.edu'], ips: ['10.10.0.0/16'], ports: [80, 443, 1935] };
}

function policyRevision(overrides: Partial<ExamPolicyRevision> = {}): ExamPolicyRevision {
    return {
        revision: 1,
        policy: policy(),
        fingerprint: policyFingerprint,
        publishedAt,
        publishedBy: 1,
        ...overrides,
    };
}

function targetRevision(overrides: Partial<ExamTargetRevision> = {}): ExamTargetRevision {
    return {
        revision: 1,
        sources: [{ kind: 'endpoint', ids: ['ep_one'] }],
        sourceFingerprint,
        targetFingerprint,
        endpointIds: ['ep_one'],
        targetCount: 1,
        publishedAt,
        publishedBy: 1,
        ...overrides,
    };
}

function fixture() {
    const templates = new MemoryCollection<Record<string, unknown>>();
    const assignments = new MemoryCollection<Record<string, unknown>>();
    const configs = new MemoryCollection<Record<string, unknown>>();
    const service = new configModule.ExamNetworkConfigService(templates as never, assignments as never, configs as never);
    return { service, templates, assignments, configs };
}

async function seed(target: {
    templates: MemoryCollection<Record<string, unknown>>;
    assignments: MemoryCollection<Record<string, unknown>>;
}, extra?: { policyRevisions?: ExamPolicyRevision[]; targetRevisions?: ExamTargetRevision[]; schoolId?: ObjectId; eventId?: ObjectId }) {
    const policyRevisions = extra?.policyRevisions || [policyRevision()];
    const targetRevisions = extra?.targetRevisions || [targetRevision()];
    await target.templates.insertOne({
        _id: templateId,
        domainId: 'system',
        schoolId: extra?.schoolId || schoolId,
        name: 'Policy',
        ownerUid: 1,
        collaboratorUids: [],
        status: 'active',
        revision: 2,
        auditRef: `exam-policy-template:${templateId.toHexString()}:2`,
        draft: { version: 1, policy: policy(), fingerprint: policyFingerprint, updatedAt: publishedAt, updatedBy: 1 },
        revisions: policyRevisions,
        latestPublishedRevision: 1,
        createdAt: publishedAt,
        createdBy: 1,
        updatedAt: publishedAt,
        updatedBy: 1,
    });
    await target.assignments.insertOne({
        _id: assignmentId,
        domainId: 'system',
        eventId: extra?.eventId || eventId,
        schoolId: extra?.schoolId || schoolId,
        revision: 2,
        auditRef: `exam-target-assignment:${assignmentId.toHexString()}:2`,
        draft: { version: 1, sources: [{ kind: 'endpoint', ids: ['ep_one'] }], updatedAt: publishedAt, updatedBy: 1 },
        revisions: targetRevisions,
        latestPublishedRevision: 1,
        createdAt: publishedAt,
        createdBy: 1,
        updatedAt: publishedAt,
        updatedBy: 1,
    });
}

const policyRef = { id: templateId, revision: 1, fingerprint: policyFingerprint };
const targetRef = { id: assignmentId, revision: 1, fingerprint: targetFingerprint };

async function reason(run: () => unknown | Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { reason?: string }).reason || null;
    }
}

describe('Exam network frozen revision loading', () => {
    it('returns immutable policy and target revisions for exact frozen refs', async () => {
        const { service, templates, assignments } = fixture();
        await seed({ templates, assignments });
        const loaded = await service.loadRevisionsByFrozenRefs({
            domainId: 'system',
            eventId,
            schoolId,
            policy: policyRef,
            target: targetRef,
        });
        expect(loaded.policy).to.deep.equal(policyRevision());
        expect(loaded.target.endpointIds).to.deep.equal(['ep_one']);
        expect(loaded.target.targetCount).to.equal(1);
        expect(loaded.target.targetFingerprint).to.equal(targetFingerprint);
        loaded.policy.policy.hosts.push('mutated.example.edu');
        loaded.target.endpointIds.push('ep_mutated');
        const storedPolicy = await templates.findOne({ _id: templateId });
        const storedTarget = await assignments.findOne({ _id: assignmentId });
        expect((storedPolicy as { revisions: ExamPolicyRevision[] }).revisions[0].policy.hosts).to.deep.equal(policy().hosts);
        expect((storedTarget as { revisions: ExamTargetRevision[] }).revisions[0].endpointIds).to.deep.equal(['ep_one']);

        await configModule.examPolicyTemplateColl.insertOne((await templates.findOne({ _id: templateId }))!);
        await configModule.examTargetAssignmentColl.insertOne((await assignments.findOne({ _id: assignmentId }))!);
        const exported = await configModule.loadExamNetworkRevisionsByFrozenRefs({
            domainId: 'system',
            eventId,
            schoolId,
            policy: policyRef,
            target: targetRef,
        });
        expect(exported.policy.fingerprint).to.equal(policyFingerprint);
        expect(exported.target.endpointIds).to.deep.equal(['ep_one']);
    });

    it('rejects a fingerprint mismatch on the frozen policy or target ref', async () => {
        const { service, templates, assignments } = fixture();
        await seed({ templates, assignments });
        expect(
            await reason(() =>
                service.loadPolicyRevisionByFrozenRef({
                    domainId: 'system',
                    schoolId,
                    reference: { ...policyRef, fingerprint: 'd'.repeat(64) },
                }),
            ),
        ).to.equal('policy_revision_not_found');
        expect(
            await reason(() =>
                service.loadTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: { ...targetRef, fingerprint: 'e'.repeat(64) },
                }),
            ),
        ).to.equal('target_revision_not_found');
    });

    it('rejects a missing published revision and duplicate revision identities', async () => {
        const missing = fixture();
        await seed(missing);
        expect(
            await reason(() =>
                missing.service.loadPolicyRevisionByFrozenRef({
                    domainId: 'system',
                    schoolId,
                    reference: { ...policyRef, revision: 2 },
                }),
            ),
        ).to.equal('policy_revision_not_found');
        expect(
            await reason(() =>
                missing.service.loadTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: { ...targetRef, revision: 2 },
                }),
            ),
        ).to.equal('target_revision_not_found');

        const duplicated = fixture();
        await seed(duplicated, {
            policyRevisions: [policyRevision(), policyRevision()],
            targetRevisions: [targetRevision(), targetRevision()],
        });
        expect(
            await reason(() =>
                duplicated.service.loadPolicyRevisionByFrozenRef({
                    domainId: 'system',
                    schoolId,
                    reference: policyRef,
                }),
            ),
        ).to.equal('policy_revision_not_found');
        expect(
            await reason(() =>
                duplicated.service.loadTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: targetRef,
                }),
            ),
        ).to.equal('target_revision_not_found');
    });

    it('fails closed when the frozen document belongs to another school or event', async () => {
        const otherSchool = fixture();
        await seed(otherSchool, { schoolId: otherSchoolId });
        expect(
            await reason(() =>
                otherSchool.service.loadPolicyRevisionByFrozenRef({
                    domainId: 'system',
                    schoolId,
                    reference: policyRef,
                }),
            ),
        ).to.equal('policy_revision_not_found');
        expect(
            await reason(() =>
                otherSchool.service.loadTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: targetRef,
                }),
            ),
        ).to.equal('target_revision_not_found');

        const otherEvent = fixture();
        await seed(otherEvent, { eventId: otherEventId });
        expect(
            await reason(() =>
                otherEvent.service.loadTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: targetRef,
                }),
            ),
        ).to.equal('target_revision_not_found');
        expect(
            await otherEvent.service.loadPolicyRevisionByFrozenRef({
                domainId: 'system',
                schoolId,
                reference: policyRef,
            }),
        ).to.deep.include({ revision: 1, fingerprint: policyFingerprint });
    });

    it('keeps the legacy endpoint-id loader scoped only to domain and target ref', async () => {
        await configModule.examTargetAssignmentColl.insertOne({
            _id: new ObjectId('66b800000000000000000907'),
            domainId: 'system',
            eventId: otherEventId,
            schoolId: otherSchoolId,
            revision: 1,
            auditRef: 'exam-target-assignment:legacy:1',
            draft: { version: 1, sources: [{ kind: 'endpoint', ids: ['ep_legacy'] }], updatedAt: publishedAt, updatedBy: 1 },
            revisions: [targetRevision({ endpointIds: ['ep_legacy'], targetCount: 1 })],
            latestPublishedRevision: 1,
            createdAt: publishedAt,
            createdBy: 1,
            updatedAt: publishedAt,
            updatedBy: 1,
        });
        expect(
            await configModule.loadExamTargetRevisionEndpointIds('system', {
                id: new ObjectId('66b800000000000000000907'),
                revision: 1,
                fingerprint: targetFingerprint,
            }),
        ).to.deep.equal(['ep_legacy']);
        expect(
            await reason(() =>
                configModule.loadExamTargetRevisionByFrozenRef({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    reference: { id: new ObjectId('66b800000000000000000907'), revision: 1, fingerprint: targetFingerprint },
                }),
            ),
        ).to.equal('target_revision_not_found');
    });
});
