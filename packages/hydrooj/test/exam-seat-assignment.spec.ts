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

class MemoryCollection<T extends object> {
    docs: T[] = [];

    createIndex() {
        return Promise.resolve('index');
    }

    async insertOne(doc: T) {
        this.docs.push(cloneValue(doc));
        return { acknowledged: true, insertedId: (doc as { _id?: unknown })._id };
    }

    async deleteMany(filter: Record<string, unknown>) {
        this.docs = this.docs.filter((doc) => !this.matches(doc, filter));
        return { acknowledged: true, deletedCount: 0 };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? cloneValue(found) : null;
    }

    async replaceOne(filter: Record<string, unknown>, replacement: T) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
        this.docs[index] = cloneValue(replacement);
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
    }

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) => this.matches(doc, filter));
        const cursor = {
            sort: (spec: Record<string, number>) => {
                const [field, direction] = Object.entries(spec)[0];
                rows = [...rows].sort(
                    (left, right) =>
                        direction * (Number((left as Record<string, unknown>)[field]) - Number((right as Record<string, unknown>)[field])),
                );
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
        return Object.entries(filter).every(([field, expected]) => same((doc as Record<string, unknown>)[field], expected));
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

function roster(count: number, revision = 1, id = rosterId): import('../src/model/exam-seat-plan').ExamRosterRevisionDoc {
    const createdAt = new Date('2026-08-12T00:10:00.000Z');
    const base = {
        _id: id,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision,
        auditRef: `exam-roster:${eventId}:${revision}`,
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
        previousRevision: revision === 1 ? null : revision - 1,
        diff: { addedBoundUserIds: Array.from({ length: count }, (_, index) => index + 101), removedBoundUserIds: [] },
        counts: { total: count, included: count, excluded: 0 },
        createdAt,
        createdBy: 2,
    };
    return { ...base, fingerprint: seatPlanModule.rosterDocumentFingerprint(base) };
}

function plan(count: number, rosterDoc = roster(count)): import('../src/model/exam-seat-plan').ExamSeatPlanV1Doc {
    const createdAt = new Date('2026-08-12T00:11:00.000Z');
    const base = {
        _id: seatPlanId,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 1,
        auditRef: `exam-seat-plan:${eventId}:1`,
        roster: { rosterId: rosterDoc._id, revision: rosterDoc.revision, fingerprint: rosterDoc.fingerprint },
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

function v2Plan(rosterDoc = roster(2)): import('../src/model/exam-seat-plan').ExamSeatPlanV2Doc {
    const otherClassroomId = new ObjectId('66bc00000000000000000006');
    const base: Omit<import('../src/model/exam-seat-plan').ExamSeatPlanV2Doc, 'fingerprint'> = {
        _id: new ObjectId('66bc00000000000000000007'),
        schemaVersion: 2,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 2,
        auditRef: `exam-seat-plan:${eventId}:2`,
        roster: { rosterId: rosterDoc._id, revision: rosterDoc.revision, fingerprint: rosterDoc.fingerprint },
        classrooms: [
            {
                classroomId,
                layoutRevision: 4,
                layoutFingerprint: 'b'.repeat(64),
                profileRevision: 0,
                profileFingerprint: 'c'.repeat(64),
                candidateSeatIds: ['seat-001'],
            },
            {
                classroomId: otherClassroomId,
                layoutRevision: 5,
                layoutFingerprint: 'd'.repeat(64),
                profileRevision: 2,
                profileFingerprint: 'e'.repeat(64),
                candidateSeatIds: ['seat-001'],
            },
        ],
        diagnostics: [],
        createdAt: new Date('2026-08-12T00:12:00.000Z'),
        createdBy: 2,
    };
    return { ...base, fingerprint: seatPlanModule.planDocumentFingerprint(base) };
}

function v2Assignment(rosterDoc = roster(2)): import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2Doc {
    const seatPlan = v2Plan(rosterDoc);
    const participants = rosterDoc.entries.map((entry) => ({
        boundUserId: entry.boundUserId,
        studentRecordId: entry.studentRecordId,
        studentId: entry.studentId,
        teamId: null,
        teamRole: null,
    }));
    const frozenSeats = seatPlan.classrooms.map((classroom, index) => ({
        classroomId: classroom.classroomId,
        sourceSeatId: 'seat-001',
        label: `${index + 1}-1`,
        x: index * 100,
        y: 0,
        width: null,
        height: null,
        rotation: 0,
        layoutStatus: 'empty',
        enabled: true,
        facing: 'unset' as const,
        disabledReason: null,
        bindingId: new ObjectId(`66bc0000000000000000001${index}`),
        bindingRevision: 1,
        endpointId: `ep_room_${index + 1}`,
        endpointOnline: index === 0,
    }));
    const assignments = participants.map((participant, index) => ({
        boundUserId: participant.boundUserId,
        seat: { classroomId: frozenSeats[index].classroomId, sourceSeatId: frozenSeats[index].sourceSeatId },
    }));
    const base: Omit<import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2Doc, 'fingerprint'> = {
        _id: new ObjectId('66bc00000000000000000008'),
        schemaVersion: 2,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 2,
        auditRef: `exam-seat-assignment:${eventId}:2`,
        seatPlan: { seatPlanId: seatPlan._id, revision: seatPlan.revision, fingerprint: seatPlan.fingerprint },
        roster: { rosterId, revision: 1, fingerprint: rosterDoc.fingerprint },
        classrooms: seatPlan.classrooms,
        participants,
        seatFacts: frozenSeats,
        constraints: { strategy: 'minimizeClassrooms', lockedAssignments: [], manualAssignments: [] },
        seed: seedA,
        algorithmVersion: 'spatial-best-effort-v1',
        assignments,
        explanation: {
            classrooms: seatPlan.classrooms.map((classroom) => ({
                classroomId: classroom.classroomId,
                assignedCount: assignments.filter((assignment) => assignment.seat.classroomId.equals(classroom.classroomId)).length,
                eligibleSeatCount: 1,
            })),
            highRiskEdges: [],
            mediumRiskEdges: [],
            splitTeamIds: [],
            skippedSeats: [],
            offlineSeats: [{ classroomId: frozenSeats[1].classroomId, sourceSeatId: frozenSeats[1].sourceSeatId }],
            unsetFacingSeats: frozenSeats.map((seat) => ({ classroomId: seat.classroomId, sourceSeatId: seat.sourceSeatId })),
        },
        previousRevision: 1,
        createdAt: new Date('2026-08-12T00:13:00.000Z'),
        createdBy: 2,
    };
    return { ...base, fingerprint: moduleUnderTest.assignmentDocumentFingerprint(base) };
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

describe('P2.11 reader-first v1/v2 compatibility', () => {
    it('preserves the exact legacy v1 fingerprint bytes from the pre-P2.11 reader', async () => {
        const rosterDoc = roster(2);
        const legacyPlan = plan(2, rosterDoc);
        expect(legacyPlan.fingerprint).to.equal('9315b7ab11376d62eac725c2a9e37947e9b7b458a9df4ad1022e7d5df0318e0d');

        const service = new moduleUnderTest.ExamSeatAssignmentService(
            new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentRevisionDoc>() as never,
            new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentPublicationDoc>() as never,
            () => new Date('2026-08-12T00:13:00.000Z'),
            () => new ObjectId('66bc00000000000000000009'),
        );
        const result = await service.createRevision({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan: legacyPlan,
            seatFacts: seatFacts(2),
            mode: 'random',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.assignment?.fingerprint).to.equal('3225361eb2a2fe1ede8260df8bd5009cdb00aff438d6f1a223f840a5a5f11300');
    });

    it('accepts two classrooms that reuse the same sourceSeatId because the structured identities differ', () => {
        const rosterDoc = roster(2);
        const planDoc = v2Plan(rosterDoc);
        const assignment = v2Assignment(rosterDoc);
        expect(() => seatPlanModule.assertExamSeatPlanIntegrity(planDoc)).not.to.throw();
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(assignment)).not.to.throw();
        expect(seatPlanModule.isExamSeatPlanV2(planDoc)).to.equal(true);
        expect(moduleUnderTest.isExamSeatAssignmentV2(assignment)).to.equal(true);
        expect(assignment.assignments.map((row) => row.seat.sourceSeatId)).to.deep.equal(['seat-001', 'seat-001']);
        expect(new Set(assignment.assignments.map((row) => moduleUnderTest.examSeatIdentityKey(row.seat))).size).to.equal(2);
    });

    it('rejects duplicate classrooms, non-canonical seat order, endpoint reuse, and binding reuse in a v2 document', () => {
        const duplicateClassroom = cloneValue(v2Plan());
        duplicateClassroom.classrooms[1].classroomId = duplicateClassroom.classrooms[0].classroomId;
        expect(() => seatPlanModule.assertExamSeatPlanIntegrity(duplicateClassroom)).to.throw('seat_plan_classroom_duplicate');

        const nonCanonicalSeats = cloneValue(v2Plan());
        nonCanonicalSeats.classrooms[0].candidateSeatIds = ['seat-002', 'seat-001'];
        expect(() => seatPlanModule.assertExamSeatPlanIntegrity(nonCanonicalSeats)).to.throw('candidate_seats_invalid');

        const duplicateEndpoint = cloneValue(v2Assignment());
        duplicateEndpoint.seatFacts[1].endpointId = duplicateEndpoint.seatFacts[0].endpointId;
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(duplicateEndpoint)).to.throw('assignment_endpoint_duplicate');

        const duplicateBinding = cloneValue(v2Assignment());
        duplicateBinding.seatFacts[1].bindingId = duplicateBinding.seatFacts[0].bindingId;
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(duplicateBinding)).to.throw('assignment_binding_duplicate');
    });

    it('keeps zero-person assignments readable and preserves an unknown online observation for a bound seat', () => {
        const empty = v2Assignment(roster(0));
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(empty)).not.to.throw();
        expect(empty.participants).to.have.lengthOf(0);
        expect(empty.assignments).to.have.lengthOf(0);

        const unknownOnline = cloneValue(v2Assignment());
        unknownOnline.seatFacts[0].endpointOnline = null;
        unknownOnline.fingerprint = moduleUnderTest.assignmentDocumentFingerprint(unknownOnline);
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(unknownOnline)).not.to.throw();
    });

    it('requires the stored v2 plan and assignment to name the same immutable roster', () => {
        const rosterA = roster(2);
        const rosterB = roster(2, 2, new ObjectId('66bc0000000000000000000a'));
        const planA = v2Plan(rosterA);
        const assignmentB = v2Assignment(rosterB);
        assignmentB.seatPlan = { seatPlanId: planA._id, revision: planA.revision, fingerprint: planA.fingerprint };
        assignmentB.fingerprint = moduleUnderTest.assignmentDocumentFingerprint(assignmentB);

        expect(() => seatPlanModule.assertExamSeatPlanIntegrity(planA)).not.to.throw();
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(assignmentB)).not.to.throw();
        expect(moduleUnderTest.seatPlanMatchesAssignmentRoster(planA, assignmentB)).to.equal(false);
    });

    it('derives a frozen endpoint only from the exact retained binding history revision', () => {
        const assignment = v2Assignment();
        const fact = assignment.seatFacts[0];
        const boundAt = new Date('2026-08-12T00:05:00.000Z');
        const unboundAt = new Date('2026-08-12T00:06:00.000Z');
        const binding: import('../src/model/endpoint-seat-binding').EndpointSeatBindingDoc = {
            _id: fact.bindingId!,
            domainId: 'system',
            schoolId,
            classroomId: fact.classroomId,
            sourceSeatId: fact.sourceSeatId,
            status: 'unbound',
            revision: 2,
            history: [
                {
                    revision: 1,
                    action: 'bind',
                    endpointId: fact.endpointId!,
                    requestId: 'request_bind_0001',
                    actorUid: 2,
                    at: boundAt,
                    pairingWindowId: new ObjectId('66bc0000000000000000000b'),
                },
                {
                    revision: 2,
                    action: 'unbind',
                    previousEndpointId: fact.endpointId!,
                    requestId: 'request_unbind_01',
                    actorUid: 2,
                    at: unboundAt,
                    referenceFingerprint: 'f'.repeat(64),
                },
            ],
            createdBy: 2,
            createdAt: boundAt,
            updatedBy: 2,
            updatedAt: unboundAt,
        };
        expect(moduleUnderTest.seatFactMatchesBindingHistory('system', schoolId, fact, binding)).to.equal(true);

        const wrongSchool = { ...binding, schoolId: new ObjectId('66bc0000000000000000000c') };
        expect(moduleUnderTest.seatFactMatchesBindingHistory('system', schoolId, fact, wrongSchool)).to.equal(false);

        const wrongEndpoint = { ...fact, endpointId: 'ep_wrong_endpoint' };
        expect(moduleUnderTest.seatFactMatchesBindingHistory('system', schoolId, wrongEndpoint, binding)).to.equal(false);
    });

    it('validates v2 participant, constraint, and explanation references without assuming a manual prefix', () => {
        const manualSubset = cloneValue(v2Assignment());
        manualSubset.constraints.manualAssignments = [manualSubset.assignments[1]];
        manualSubset.fingerprint = moduleUnderTest.assignmentDocumentFingerprint(manualSubset);
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(manualSubset)).not.to.throw();

        const duplicateStudentRecord = cloneValue(v2Assignment());
        duplicateStudentRecord.participants[1].studentRecordId = duplicateStudentRecord.participants[0].studentRecordId;
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(duplicateStudentRecord)).to.throw('assignment_participants_invalid');

        const duplicateLock = cloneValue(v2Assignment());
        duplicateLock.constraints.lockedAssignments = [duplicateLock.assignments[0], duplicateLock.assignments[0]];
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(duplicateLock)).to.throw('assignment_mapping_invalid');

        const foreignExplanationSeat = cloneValue(v2Assignment());
        foreignExplanationSeat.explanation.offlineSeats = [
            { classroomId: foreignExplanationSeat.classrooms[0].classroomId, sourceSeatId: 'not-in-frozen-facts' },
        ];
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(foreignExplanationSeat)).to.throw('assignment_explanation_invalid');
    });

    it('keeps v1 bytes valid and refuses to append a v1 revision after v2 history exists', async () => {
        const rosterDoc = roster(2);
        const v1 = plan(2, rosterDoc);
        expect(Object.hasOwn(v1, 'schemaVersion')).to.equal(false);
        expect(() => seatPlanModule.assertExamSeatPlanIntegrity(v1)).not.to.throw();
        const revisions = new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentRevisionDoc>();
        const publications = new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentPublicationDoc>();
        revisions.docs.push(v2Assignment(rosterDoc));
        const service = new moduleUnderTest.ExamSeatAssignmentService(
            revisions as never,
            publications as never,
            () => new Date('2026-08-12T00:14:00.000Z'),
        );
        expect(
            await failureReason(() =>
                service.createRevision({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    expectedPreviousRevision: 2,
                    roster: rosterDoc,
                    seatPlan: v1,
                    seatFacts: seatFacts(2),
                    mode: 'random',
                    seed: seedA,
                    lockedAssignments: [],
                    manualAssignments: [],
                }),
            ),
        ).to.equal('assignment_v2_writer_required');
        expect(revisions.docs).to.have.lengthOf(1);
    });

    it('strictly validates an unknown latest seat-plan schema before a legacy writer can classify it', async () => {
        const rosters = new MemoryCollection<import('../src/model/exam-seat-plan').ExamRosterRevisionDoc>();
        const plans = new MemoryCollection<import('../src/model/exam-seat-plan').ExamSeatPlanDoc>();
        const unknown = { ...plan(2), revision: 2, schemaVersion: 3 };
        plans.docs.push(unknown as never);
        const service = new seatPlanModule.ExamSeatPlanService(rosters as never, plans as never);

        expect(await failureReason(() => service.latestSeatPlanRevision('system', eventId))).to.equal('seat_plan_document_invalid');
    });
});
