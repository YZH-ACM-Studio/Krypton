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
    if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => same(item, right[index]));
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const leftEntries = Object.entries(left);
        const rightEntries = Object.entries(right);
        return (
            leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => same(value, (right as Record<string, unknown>)[key]))
        );
    }
    return left === right;
}

class MemoryCollection<T extends Record<string, unknown>> {
    docs: T[] = [];

    createIndex() {
        return Promise.resolve('index');
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

    async replaceOne(filter: Record<string, unknown>, replacement: T) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        this.docs[index] = cloneValue(replacement);
        return { matchedCount: 1, modifiedCount: 1 };
    }

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) => this.matches(doc, filter));
        const cursor = {
            sort: (spec: Record<string, number>) => {
                const [field, direction] = Object.entries(spec)[0];
                rows = [...rows].sort((left, right) => direction * (Number(left[field]) - Number(right[field])));
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
const seatPlanModule = require('../src/model/exam-seat-plan.ts') as typeof import('../src/model/exam-seat-plan');
const moduleUnderTest = require('../src/model/exam-seat-assignment.ts') as typeof import('../src/model/exam-seat-assignment');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const schoolId = new ObjectId('66bc00000000000000000001');
const eventId = new ObjectId('66bc00000000000000000002');
const classroomId = new ObjectId('66bc00000000000000000003');
const rosterId = new ObjectId('66bc00000000000000000004');
const seatPlanId = new ObjectId('66bc00000000000000000005');

function roster(count: number): import('../src/model/exam-seat-plan').ExamRosterRevisionDoc {
    const createdAt = new Date('2026-08-12T00:10:00.000Z');
    const base = {
        _id: rosterId,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 1,
        auditRef: `exam-roster:${eventId}:1`,
        source: {
            kind: 'userbindSchool' as const,
            schoolId,
            selectedGroupIds: [],
            contestId: null,
            sourceFingerprint: 'a'.repeat(64),
            groups: [],
        },
        entries: Array.from({ length: count }, (_, index) => ({
            studentRecordId: new ObjectId(`66bc0000000000000001${index.toString(16).padStart(4, '0')}`),
            schoolId,
            studentId: `S${(count - index).toString().padStart(4, '0')}`,
            realName: `学生${index + 1}`,
            boundUserId: index + 101,
            sourceGroupIds: [],
        })),
        exclusions: [],
        previousRevision: null,
        diff: { addedBoundUserIds: Array.from({ length: count }, (_, index) => index + 101), removedBoundUserIds: [] },
        counts: { total: count, included: count, excluded: 0 },
        createdAt,
        createdBy: 2,
    };
    return { ...base, fingerprint: seatPlanModule.rosterDocumentFingerprint(base) };
}

function plan(count: number, rosterDoc = roster(count)): import('../src/model/exam-seat-plan').ExamSeatPlanDoc {
    const createdAt = new Date('2026-08-12T00:11:00.000Z');
    const base = {
        _id: seatPlanId,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 1,
        auditRef: `exam-seat-plan:${eventId}:1`,
        roster: { rosterId, revision: 1, fingerprint: rosterDoc.fingerprint },
        classroomId,
        layoutRevision: 4,
        layoutFingerprint: 'b'.repeat(64),
        candidateSeatIds: Array.from({ length: count }, (_, index) => `seat-${String(index + 1).padStart(3, '0')}`),
        diagnostics: [],
        createdAt,
        createdBy: 2,
    };
    return { ...base, fingerprint: seatPlanModule.planDocumentFingerprint(base) };
}

function seatFacts(count: number, overrides: Record<string, Partial<import('../src/model/exam-seat-assignment').ExamAssignmentSeatFact>> = {}) {
    return Array.from({ length: count }, (_, index) => {
        const sourceSeatId = `seat-${String(index + 1).padStart(3, '0')}`;
        return {
            sourceSeatId,
            status: 'empty',
            bindingId: new ObjectId(`66bc0000000000000002${index.toString(16).padStart(4, '0')}`),
            bindingRevision: 1,
            endpointId: `ep_${String(index + 1).padStart(16, '0')}`,
            ...overrides[sourceSeatId],
        };
    });
}

const seedA = '1'.repeat(64);
const seedB = '2'.repeat(64);

async function failureReason(run: () => unknown | Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { reason?: string }).reason || null;
    }
}

describe('P2.5 deterministic seat assignment', () => {
    it('reproduces the same mapping for one seed and changes it only for a different seed', () => {
        const rosterDoc = roster(30);
        const input = { roster: rosterDoc, seatPlan: plan(30, rosterDoc), seatFacts: seatFacts(30), mode: 'random' as const };
        const first = moduleUnderTest.buildExamSeatAssignment({ ...input, seed: seedA, lockedAssignments: [], manualAssignments: [] });
        const retry = moduleUnderTest.buildExamSeatAssignment({ ...input, seed: seedA, lockedAssignments: [], manualAssignments: [] });
        const rerandomized = moduleUnderTest.buildExamSeatAssignment({ ...input, seed: seedB, lockedAssignments: [], manualAssignments: [] });

        expect(first.ok).to.equal(true);
        expect(retry).to.deep.equal(first);
        expect(rerandomized.ok).to.equal(true);
        expect(rerandomized.ok && first.ok && rerandomized.assignments).not.to.deep.equal(first.ok && first.assignments);
    });

    it('covers zero, one, and five hundred students without hidden pagination state', () => {
        for (const count of [0, 1, 500]) {
            const rosterDoc = roster(count);
            const result = moduleUnderTest.buildExamSeatAssignment({
                roster: rosterDoc,
                seatPlan: plan(count, rosterDoc),
                seatFacts: seatFacts(count),
                mode: 'studentId',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            });
            expect(result.ok).to.equal(true);
            expect(result.ok && result.assignments).to.have.lengthOf(count);
        }
    });

    it('uses locale-independent code-unit ordering for student and seat identifiers', () => {
        const original = roster(4);
        const { fingerprint: _fingerprint, ...base } = original;
        const studentIds = ['ä', 'Z', '中', 'a'];
        const canonicalRoster = {
            ...base,
            entries: base.entries.map((entry, index) => ({ ...entry, studentId: studentIds[index] })),
        };
        const rosterDoc = {
            ...canonicalRoster,
            fingerprint: seatPlanModule.rosterDocumentFingerprint(canonicalRoster),
        };
        const result = moduleUnderTest.buildExamSeatAssignment({
            roster: rosterDoc,
            seatPlan: plan(4, rosterDoc),
            seatFacts: seatFacts(4),
            mode: 'studentId',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        if (!result.ok) return;
        const mapping = new Map(result.assignments.map((row) => [row.boundUserId, row.sourceSeatId]));
        expect(mapping.get(102)).to.equal('seat-001');
        expect(mapping.get(104)).to.equal('seat-002');
        expect(mapping.get(101)).to.equal('seat-003');
        expect(mapping.get(103)).to.equal('seat-004');
    });

    it('excludes disabled and unbound seats with complete diagnostics and blocks shortages without a partial mapping', () => {
        const rosterDoc = roster(3);
        const facts = seatFacts(4, {
            'seat-001': { status: 'disabled' },
            'seat-002': { bindingId: null, bindingRevision: null, endpointId: null },
        });
        const result = moduleUnderTest.buildExamSeatAssignment({
            roster: rosterDoc,
            seatPlan: plan(4, rosterDoc),
            seatFacts: facts,
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });

        expect(result.ok).to.equal(false);
        expect(result.diagnostics).to.deep.equal([
            { code: 'seat_disabled', sourceSeatIds: ['seat-001'] },
            { code: 'seat_unbound', sourceSeatIds: ['seat-002'] },
            { code: 'insufficient_seats', requiredSeatCount: 3, availableSeatCount: 2 },
        ]);
        expect('assignments' in result).to.equal(false);
    });

    it('accepts a complete manual swap and preserves locked rows during explicit rerandomization', () => {
        const rosterDoc = roster(5);
        const seatPlan = plan(5, rosterDoc);
        const facts = seatFacts(5);
        const generated = moduleUnderTest.buildExamSeatAssignment({
            roster: rosterDoc,
            seatPlan,
            seatFacts: facts,
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(generated.ok).to.equal(true);
        if (!generated.ok) return;
        const swapped = generated.assignments.map((row) => ({ ...row }));
        [swapped[0].sourceSeatId, swapped[1].sourceSeatId] = [swapped[1].sourceSeatId, swapped[0].sourceSeatId];
        const manual = moduleUnderTest.buildExamSeatAssignment({
            roster: rosterDoc,
            seatPlan,
            seatFacts: facts,
            mode: 'random',
            seed: seedA,
            lockedAssignments: [swapped[0]],
            manualAssignments: swapped,
        });
        expect(manual.ok).to.equal(true);
        expect(manual.ok && manual.assignments).to.deep.equal(swapped.sort((left, right) => left.boundUserId - right.boundUserId));

        const rerandomized = moduleUnderTest.buildExamSeatAssignment({
            roster: rosterDoc,
            seatPlan,
            seatFacts: facts,
            mode: 'random',
            seed: seedB,
            lockedAssignments: [swapped[0]],
            manualAssignments: [],
        });
        expect(rerandomized.ok).to.equal(true);
        expect(rerandomized.ok && rerandomized.assignments.find((row) => row.boundUserId === swapped[0].boundUserId)).to.deep.equal(swapped[0]);
    });
});

describe('P2.5 immutable revisions and publication CAS', () => {
    function fixture() {
        const revisions = new MemoryCollection<Record<string, unknown>>();
        const publications = new MemoryCollection<Record<string, unknown>>();
        let sequence = 0x300;
        const service = new moduleUnderTest.ExamSeatAssignmentService(
            revisions as never,
            publications as never,
            () => new Date('2026-08-12T00:20:00.000Z'),
            () => new ObjectId(`66bc0000000000000000${(sequence++).toString(16).padStart(4, '0')}`),
        );
        return { service, revisions, publications };
    }

    it('appends adjustments, preserves the first revision, and rejects stale concurrent publication', async () => {
        const { service, revisions } = fixture();
        const rosterDoc = roster(3);
        const seatPlan = plan(3, rosterDoc);
        const first = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan,
            seatFacts: seatFacts(3),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(first.assignment?.revision).to.equal(1);
        if (!first.assignment) return;
        const manualAssignments = first.assignment.assignments.map((row) => ({ ...row }));
        [manualAssignments[0].sourceSeatId, manualAssignments[1].sourceSeatId] = [
            manualAssignments[1].sourceSeatId,
            manualAssignments[0].sourceSeatId,
        ];
        const second = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 1,
            roster: rosterDoc,
            seatPlan,
            seatFacts: seatFacts(3),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [manualAssignments[0]],
            manualAssignments,
        });

        expect(second.assignment?.revision).to.equal(2);
        expect(second.assignment?.previousRevision).to.equal(1);
        expect(revisions.docs[0].assignments as unknown[]).to.deep.equal(first.assignment.assignments);
        expect(
            await failureReason(() =>
                service.createRevision({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    expectedPreviousRevision: 1,
                    roster: rosterDoc,
                    seatPlan,
                    seatFacts: seatFacts(3),
                    mode: 'random',
                    seed: seedB,
                    lockedAssignments: [],
                    manualAssignments: [],
                }),
            ),
        ).to.equal('assignment_revision_conflict');
        const published = await service.publishRevision({
            domainId: 'system',
            eventId,
            assignmentRevision: 2,
            expectedPublicationRevision: 0,
            actorUid: 2,
        });
        expect(published.revision).to.equal(1);
        expect(published.assignment.revision).to.equal(2);
        expect(
            await failureReason(() =>
                service.publishRevision({
                    domainId: 'system',
                    eventId,
                    assignmentRevision: 1,
                    expectedPublicationRevision: 0,
                    actorUid: 3,
                }),
            ),
        ).to.equal('assignment_publication_conflict');
    });

    it('does not persist a blocked assignment and rejects canonical drift', async () => {
        const { service, revisions } = fixture();
        const rosterDoc = roster(2);
        const result = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan: plan(2, rosterDoc),
            seatFacts: seatFacts(2, { 'seat-001': { status: 'disabled' } }),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.assignment).to.equal(null);
        expect(revisions.docs).to.have.lengthOf(0);

        const ready = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan: plan(2, rosterDoc),
            seatFacts: seatFacts(2),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        if (!ready.assignment) return;
        const corrupted = cloneValue(ready.assignment) as unknown as Record<string, unknown>;
        corrupted.createdBy = 999;
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(corrupted)).to.throw(
            moduleUnderTest.ExamSeatAssignmentError,
            'assignment_fingerprint_mismatch',
        );

        const malformedArray = cloneValue(ready.assignment) as unknown as Record<string, unknown>;
        malformedArray.candidateSeatIds = 'seat-001';
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(malformedArray)).to.throw(
            moduleUnderTest.ExamSeatAssignmentError,
            'assignment_seats_invalid',
        );
    });

    it('rejects a clock rollback before appending or publishing immutable facts', async () => {
        const revisions = new MemoryCollection<Record<string, unknown>>();
        const publications = new MemoryCollection<Record<string, unknown>>();
        let now = new Date('2026-08-12T00:20:00.000Z');
        let sequence = 0x400;
        const service = new moduleUnderTest.ExamSeatAssignmentService(
            revisions as never,
            publications as never,
            () => new Date(now),
            () => new ObjectId(`66bc0000000000000000${(sequence++).toString(16).padStart(4, '0')}`),
        );
        const rosterDoc = roster(1);
        const created = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan: plan(1, rosterDoc),
            seatFacts: seatFacts(1),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(created.assignment).not.to.equal(null);
        now = new Date('2026-08-12T00:19:00.000Z');
        expect(
            await failureReason(() =>
                service.createRevision({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    expectedPreviousRevision: 1,
                    roster: rosterDoc,
                    seatPlan: plan(1, rosterDoc),
                    seatFacts: seatFacts(1),
                    mode: 'random',
                    seed: seedB,
                    lockedAssignments: [],
                    manualAssignments: [],
                }),
            ),
        ).to.equal('assignment_clock_rollback');
        expect(
            await failureReason(() =>
                service.publishRevision({
                    domainId: 'system',
                    eventId,
                    assignmentRevision: 1,
                    expectedPublicationRevision: 0,
                    actorUid: 2,
                }),
            ),
        ).to.equal('assignment_clock_rollback');
        expect(revisions.docs).to.have.lengthOf(1);
        expect(publications.docs).to.have.lengthOf(0);
    });
});
