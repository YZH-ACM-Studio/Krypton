import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

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
    return left === right;
}

class MemoryCollection<T extends Record<string, unknown>> {
    docs: T[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: T) {
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

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) => this.matches(doc, filter));
        const cursor = {
            sort: (spec: Record<string, number>) => {
                const [field, direction] = Object.entries(spec)[0];
                rows = [...rows].sort((left, right) => direction * (Number(right[field]) - Number(left[field])));
                return cursor;
            },
            limit: (count: number) => {
                rows = rows.slice(0, count);
                return cursor;
            },
            toArray: async () => rows.map(cloneValue),
        };
        return cursor;
    }

    private matches(doc: T, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => same(doc[field], expected));
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
const moduleUnderTest = require('../src/model/exam-seat-plan.ts') as typeof import('../src/model/exam-seat-plan');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const schoolId = new ObjectId('66ba00000000000000000001');
const eventId = new ObjectId('66ba00000000000000000002');
const classroomId = new ObjectId('66ba00000000000000000003');
const groupAId = new ObjectId('66ba00000000000000000011');
const groupBId = new ObjectId('66ba00000000000000000012');

function student(index: number, boundUserId: number | null, groupIds = [groupAId]) {
    return {
        studentRecordId: new ObjectId(`66ba0000000000000000${(0x100 + index).toString(16).padStart(4, '0')}`),
        schoolId,
        studentId: `26${index.toString().padStart(4, '0')}`,
        realName: `学生${index}`,
        groupIds,
        boundUserId,
    };
}

function source(students: ReturnType<typeof student>[], fingerprint = 'a'.repeat(64)) {
    return {
        kind: 'userbindGroups' as const,
        schoolId,
        selectedGroupIds: [groupAId, groupBId],
        contestId: null,
        sourceFingerprint: fingerprint,
        groups: [
            { groupId: groupAId, schoolId, name: '一班', archivedAt: null, fingerprint: 'b'.repeat(64) },
            { groupId: groupBId, schoolId, name: '二班', archivedAt: null, fingerprint: 'c'.repeat(64) },
        ],
        students,
    };
}

async function failureReason(run: () => unknown | Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { reason?: string }).reason || null;
    }
}

describe('P2.4 stable roster resolution', () => {
    it('deduplicates multi-group records and reports unbound, duplicate, missing and inactive accounts', async () => {
        const snapshot = source([
            student(1, 101, [groupAId, groupBId]),
            student(2, null, [groupAId]),
            student(3, 103, [groupAId]),
            student(4, 104, [groupBId]),
            student(5, 105, [groupBId]),
            student(6, 105, [groupAId]),
        ]);
        const resolved = await moduleUnderTest.resolveStableExamRoster({
            schoolId,
            loadSource: async () => snapshot,
            loadUserStates: async () => [
                { uid: 101, active: true },
                { uid: 104, active: false },
                { uid: 105, active: true },
            ],
        });

        expect(resolved.entries.map((entry) => entry.boundUserId)).to.deep.equal([101]);
        expect(resolved.entries[0].sourceGroupIds.map(String)).to.deep.equal([String(groupAId), String(groupBId)]);
        expect(resolved.exclusions.map((entry) => entry.reason)).to.deep.equal([
            'unbound_oj_account',
            'oj_user_not_found',
            'inactive_oj_user',
            'duplicate_bound_user',
            'duplicate_bound_user',
        ]);
        expect(resolved.fingerprint).to.match(/^[a-f0-9]{64}$/);
    });

    it('fails before persistence when group membership changes between the two reads', async () => {
        let read = 0;
        const result = await failureReason(() =>
            moduleUnderTest.resolveStableExamRoster({
                schoolId,
                loadSource: async () => (read++ === 0 ? source([student(1, 101)]) : source([student(1, 101), student(2, 102)], 'd'.repeat(64))),
                loadUserStates: async (uids) => uids.map((uid) => ({ uid, active: true })),
            }),
        );
        expect(result).to.equal('roster_source_changed');
    });

    it('accepts the 500-student upper scenario without inventing pagination state', async () => {
        const students = Array.from({ length: 500 }, (_, index) => student(index + 1, index + 100));
        const resolved = await moduleUnderTest.resolveStableExamRoster({
            schoolId,
            loadSource: async () => source(students),
            loadUserStates: async (uids) => uids.map((uid) => ({ uid, active: true })),
        });
        expect(resolved.entries).to.have.lengthOf(500);
        expect(resolved.exclusions).to.have.lengthOf(0);
    });

    it('keeps an explicitly empty source as an auditable empty roster', async () => {
        const resolved = await moduleUnderTest.resolveStableExamRoster({
            schoolId,
            loadSource: async () => source([]),
            loadUserStates: async () => [],
        });
        expect(resolved.entries).to.deep.equal([]);
        expect(resolved.exclusions).to.deep.equal([]);
        expect(resolved.fingerprint).to.match(/^[a-f0-9]{64}$/);
    });
});

describe('P2.4 immutable roster and seat plan revisions', () => {
    function fixture() {
        const rosters = new MemoryCollection<Record<string, unknown>>();
        const plans = new MemoryCollection<Record<string, unknown>>();
        let sequence = 0x200;
        const service = new moduleUnderTest.ExamSeatPlanService(
            rosters as never,
            plans as never,
            () => new Date('2026-08-11T12:00:00.000Z'),
            () => new ObjectId(`66ba0000000000000000${(sequence++).toString(16).padStart(4, '0')}`),
        );
        return { service, rosters, plans };
    }

    async function resolved(students: ReturnType<typeof student>[]) {
        return moduleUnderTest.resolveStableExamRoster({
            schoolId,
            loadSource: async () => source(students),
            loadUserStates: async (uids) => uids.map((uid) => ({ uid, active: true })),
        });
    }

    it('creates a new immutable roster revision on refresh and records exact uid diff after the event has started', async () => {
        const { service, rosters } = fixture();
        const first = await service.createRosterRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            resolved: await resolved([student(1, 101), student(2, 102)]),
        });
        const second = await service.createRosterRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            resolved: await resolved([student(2, 102), student(3, 103)]),
        });

        expect(first.revision).to.equal(1);
        expect(second.revision).to.equal(2);
        expect(second.previousRevision).to.equal(1);
        expect(second.diff).to.deep.equal({ addedBoundUserIds: [103], removedBoundUserIds: [101] });
        expect((rosters.docs[0].entries as Array<{ boundUserId: number }>).map((entry) => entry.boundUserId)).to.deep.equal([101, 102]);
    });

    it('allows an external exam plan without a roster and keeps zero candidates canonical', async () => {
        const { service } = fixture();
        const plan = await service.createSeatPlan({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            roster: null,
            classroomId,
            layoutRevision: 1,
            layoutFingerprint: 'e'.repeat(64),
            candidateSeatIds: [],
            requireRoster: false,
        });
        expect(plan.roster).to.equal(null);
        expect(plan.candidateSeatIds).to.deep.equal([]);
        expect(plan.diagnostics).to.deep.equal([]);
    });

    it('rejects a Krypton plan without a roster and records seat shortage without generating an assignment', async () => {
        const { service } = fixture();
        expect(
            await failureReason(() =>
                service.createSeatPlan({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    roster: null,
                    classroomId,
                    layoutRevision: 1,
                    layoutFingerprint: 'e'.repeat(64),
                    candidateSeatIds: ['seat-1'],
                    requireRoster: true,
                }),
            ),
        ).to.equal('roster_required');

        const roster = await service.createRosterRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            resolved: await resolved([student(1, 101), student(2, 102)]),
        });
        const plan = await service.createSeatPlan({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            roster,
            classroomId,
            layoutRevision: 1,
            layoutFingerprint: 'e'.repeat(64),
            candidateSeatIds: ['seat-1'],
            requireRoster: true,
        });
        expect(plan.diagnostics).to.deep.equal([{ code: 'insufficient_seats', requiredSeatCount: 2, availableSeatCount: 1 }]);
    });

    it('rejects a self-consistent-looking stored document after canonical fields drift', async () => {
        const { service } = fixture();
        const roster = await service.createRosterRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            resolved: await resolved([student(1, 101)]),
        });
        const corrupted = cloneValue(roster) as unknown as Record<string, unknown>;
        (corrupted.counts as Record<string, number>).included = 2;
        expect(() => moduleUnderTest.assertExamRosterRevisionIntegrity(corrupted)).to.throw(
            moduleUnderTest.ExamSeatPlanError,
            'roster_counts_invalid',
        );

        const wrongNumericType = cloneValue(roster) as unknown as Record<string, unknown>;
        wrongNumericType.revision = String(roster.revision);
        expect(() => moduleUnderTest.assertExamRosterRevisionIntegrity(wrongNumericType)).to.throw(TypeError, 'revision is invalid');

        const forgedActor = cloneValue(roster) as unknown as Record<string, unknown>;
        forgedActor.createdBy = 999;
        expect(() => moduleUnderTest.assertExamRosterRevisionIntegrity(forgedActor)).to.throw(
            moduleUnderTest.ExamSeatPlanError,
            'roster_fingerprint_mismatch',
        );
    });
});
