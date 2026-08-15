import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { BSON, ObjectId } from 'mongodb';
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
const spatialModule = require('../src/model/exam-seat-spatial-allocation.ts') as typeof import('../src/model/exam-seat-spatial-allocation');
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

function spatialPlan(
    roomSeatCounts: number[],
    rosterDoc: import('../src/model/exam-seat-plan').ExamRosterRevisionDoc,
): import('../src/model/exam-seat-plan').ExamSeatPlanV2Doc {
    const classrooms = roomSeatCounts.map((count, roomIndex) => ({
        classroomId: new ObjectId(`66bc0000000000000001${(roomIndex + 1).toString(16).padStart(4, '0')}`),
        layoutRevision: 1,
        layoutFingerprint: (roomIndex + 1).toString(16).repeat(64).slice(0, 64),
        profileRevision: 0,
        profileFingerprint: (roomIndex + 9).toString(16).repeat(64).slice(0, 64),
        candidateSeatIds: Array.from({ length: count }, (_, index) => `seat-${String(index + 1).padStart(3, '0')}`),
    }));
    const availableSeatCount = roomSeatCounts.reduce((sum, count) => sum + count, 0);
    const base: Omit<import('../src/model/exam-seat-plan').ExamSeatPlanV2Doc, 'fingerprint'> = {
        _id: new ObjectId('66bc00000000000000000030'),
        schemaVersion: 2,
        domainId: 'system',
        eventId,
        eventRevision: 3,
        schoolId,
        revision: 2,
        auditRef: `exam-seat-plan:${eventId}:2`,
        roster: { rosterId: rosterDoc._id, revision: rosterDoc.revision, fingerprint: rosterDoc.fingerprint },
        classrooms,
        diagnostics:
            rosterDoc.entries.length > availableSeatCount
                ? [{ code: 'insufficient_seats', requiredSeatCount: rosterDoc.entries.length, availableSeatCount }]
                : [],
        createdAt: new Date('2026-08-12T00:12:00.000Z'),
        createdBy: 2,
    };
    return { ...base, fingerprint: seatPlanModule.planDocumentFingerprint(base) };
}

function spatialParticipants(
    rosterDoc: import('../src/model/exam-seat-plan').ExamRosterRevisionDoc,
    teamByUid: Map<number, { teamId: string; teamRole: 'captain' | 'member' }> = new Map(),
): import('../src/model/exam-seat-assignment').ExamSeatAssignmentParticipantFact[] {
    return rosterDoc.entries.map((entry) => ({
        boundUserId: entry.boundUserId,
        studentRecordId: entry.studentRecordId,
        studentId: entry.studentId,
        ...(teamByUid.get(entry.boundUserId) || { teamId: null, teamRole: null }),
    }));
}

function spatialTeamParticipants(
    rosterDoc: import('../src/model/exam-seat-plan').ExamRosterRevisionDoc,
    teamSizes: number[],
): import('../src/model/exam-seat-assignment').ExamSeatAssignmentParticipantFact[] {
    const teamByUid = new Map<number, { teamId: string; teamRole: 'captain' | 'member' }>();
    let entryIndex = 0;
    for (let teamIndex = 0; teamIndex < teamSizes.length; teamIndex++) {
        for (let memberIndex = 0; memberIndex < teamSizes[teamIndex]; memberIndex++) {
            const entry = rosterDoc.entries[entryIndex++];
            if (!entry) throw new Error('team fixture exceeds its roster');
            teamByUid.set(entry.boundUserId, {
                teamId: `team-${String.fromCharCode(97 + teamIndex)}`,
                teamRole: memberIndex === 0 ? 'captain' : 'member',
            });
        }
    }
    if (entryIndex !== rosterDoc.entries.length) throw new Error('team fixture does not cover its roster');
    return spatialParticipants(rosterDoc, teamByUid);
}

function spatialSeatFacts(
    seatPlan: import('../src/model/exam-seat-plan').ExamSeatPlanV2Doc,
    change: (
        seat: import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2SeatFact,
        roomIndex: number,
        seatIndex: number,
    ) => Partial<import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2SeatFact> = () => ({}),
): import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2SeatFact[] {
    let factIndex = 0;
    return seatPlan.classrooms.flatMap((classroom, roomIndex) =>
        classroom.candidateSeatIds.map((sourceSeatId, seatIndex) => {
            const base: import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2SeatFact = {
                classroomId: classroom.classroomId,
                sourceSeatId,
                label: `${roomIndex + 1}-${seatIndex + 1}`,
                x: seatIndex % 25,
                y: Math.floor(seatIndex / 25),
                width: null,
                height: null,
                rotation: 0,
                layoutStatus: 'empty',
                enabled: true,
                facing: 'unset',
                disabledReason: null,
                bindingId: new ObjectId(`66bc0000000000000002${factIndex.toString(16).padStart(4, '0')}`),
                bindingRevision: 1,
                endpointId: `ep_spatial_${String(factIndex).padStart(4, '0')}`,
                endpointOnline: true,
            };
            factIndex += 1;
            return { ...base, ...change(base, roomIndex, seatIndex) };
        }),
    );
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

describe('P2.12 deterministic spatial best-effort allocation', () => {
    it('covers zero, one, and five hundred participants without dropping anyone', () => {
        for (const count of [0, 1, 500]) {
            const rosterDoc = roster(count);
            const seatPlan = spatialPlan([Math.max(1, count)], rosterDoc);
            const result = moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: spatialSeatFacts(seatPlan),
                strategy: 'minimizeClassrooms',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            });
            expect(result.ok).to.equal(true);
            expect(result.ok && result.assignments).to.have.lengthOf(count);
            expect(result.ok && new Set(result.assignments.map((mapping) => mapping.boundUserId)).size).to.equal(count);
            if (count === 500 && result.ok) {
                expect(result.explanation.highRiskEdges.length + result.explanation.mediumRiskEdges.length).to.be.at.most(4_000);
                expect(BSON.calculateObjectSize(result)).to.be.lessThan(16 * 1024 * 1024);
            }
        }
    });

    it('is byte-for-byte reproducible for one seed and uses the seed to break symmetric choices', () => {
        const rosterDoc = roster(20);
        const seatPlan = spatialPlan([10, 10], rosterDoc);
        const input = {
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan),
            strategy: 'maximizeSpacing' as const,
            lockedAssignments: [],
            manualAssignments: [],
        };
        const first = moduleUnderTest.buildExamSeatAssignmentV2({ ...input, seed: seedA });
        const retry = moduleUnderTest.buildExamSeatAssignmentV2({ ...input, seed: seedA });
        const rerandomized = moduleUnderTest.buildExamSeatAssignmentV2({ ...input, seed: seedB });
        expect(first).to.deep.equal(retry);
        expect(first.ok && rerandomized.ok && rerandomized.assignments).not.to.deep.equal(first.ok && first.assignments);
    });

    it('keeps the spatial-best-effort-v1 mapping and explanation golden stable', () => {
        const rosterDoc = roster(7);
        const seatPlan = spatialPlan([4, 4], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialTeamParticipants(rosterDoc, [3, 2, 2]),
            seatFacts: spatialSeatFacts(seatPlan, (_seat, roomIndex, seatIndex) => ({
                facing: (['left', 'right', 'up', 'down', 'unset'] as const)[(roomIndex * 4 + seatIndex) % 5],
            })),
            strategy: 'maximizeSpacing',
            seed: '0123456789abcdef'.repeat(4),
            lockedAssignments: [
                { boundUserId: 101, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' } },
            ],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(
            result.ok &&
                result.assignments.map(
                    (mapping) =>
                        `${mapping.boundUserId}@${mapping.seat.classroomId.toHexString()}/${mapping.seat.sourceSeatId}`,
                ),
        ).to.deep.equal([
            '101@66bc00000000000000010001/seat-001',
            '102@66bc00000000000000010001/seat-002',
            '103@66bc00000000000000010001/seat-003',
            '104@66bc00000000000000010002/seat-002',
            '105@66bc00000000000000010002/seat-001',
            '106@66bc00000000000000010002/seat-004',
            '107@66bc00000000000000010002/seat-003',
        ]);
        expect(
            result.ok && createHash('sha256').update(JSON.stringify(result.explanation), 'utf8').digest('hex'),
        ).to.equal('90dc79e44cddbffe9758481b530a4e1945ad980a09277e095c88df5ad8b0b39c');
    });

    it('still assigns a full 99-of-99 room and explains unavoidable risk instead of rejecting it', () => {
        const rosterDoc = roster(99);
        const seatPlan = spatialPlan([99], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan),
            strategy: 'minimizeClassrooms',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.assignments).to.have.lengthOf(99);
        expect(result.ok && result.explanation.highRiskEdges.length).to.be.greaterThan(0);
    });

    it('skips disabled, invalid-layout, and unbound seats while retaining offline and unknown-online bound seats', () => {
        const rosterDoc = roster(3);
        const seatPlan = spatialPlan([6], rosterDoc);
        const facts = spatialSeatFacts(seatPlan, (_seat, _roomIndex, seatIndex) => {
            if (seatIndex === 0) return { enabled: false, disabledReason: 'computer_failure' };
            if (seatIndex === 1) return { layoutStatus: 'decorative' };
            if (seatIndex === 2) {
                return { bindingId: null, bindingRevision: null, endpointId: null, endpointOnline: null };
            }
            if (seatIndex === 3) return { endpointOnline: false };
            if (seatIndex === 4) return { endpointOnline: null };
            return {};
        });
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: facts,
            strategy: 'minimizeClassrooms',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.assignments).to.have.lengthOf(3);
        expect(result.ok && result.explanation.skippedSeats.map((item) => item.reason)).to.deep.equal([
            'disabled',
            'layout_status',
            'unbound',
        ]);
        expect(result.ok && result.explanation.offlineSeats).to.have.lengthOf(2);
        expect(result.ok && result.seatFacts.find((seat) => seat.sourceSeatId === 'seat-005')?.endpointOnline).to.equal(null);
    });

    it('rejects coercible arrays and objects instead of accepting them as canonical enum strings', () => {
        const rosterDoc = roster(1);
        const seatPlan = spatialPlan([1], rosterDoc);
        const malformedFacing = spatialSeatFacts(seatPlan);
        (malformedFacing[0] as unknown as { facing: unknown }).facing = ['up'];
        expect(() =>
            moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: malformedFacing,
                strategy: 'minimizeClassrooms',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            }),
        ).to.throw('assignment_seat_fact_invalid');

        const malformedDisabledReason = spatialSeatFacts(seatPlan, () => ({ enabled: false, disabledReason: 'manual_reserve' }));
        (malformedDisabledReason[0] as unknown as { disabledReason: unknown }).disabledReason = ['manual_reserve'];
        expect(() =>
            moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: malformedDisabledReason,
                strategy: 'minimizeClassrooms',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            }),
        ).to.throw('assignment_seat_fact_invalid');

        const malformedRiskReason = cloneValue(v2Assignment());
        malformedRiskReason.explanation.highRiskEdges = [
            {
                left: malformedRiskReason.assignments[0].seat,
                right: malformedRiskReason.assignments[1].seat,
                distance: 1,
                reason: ['unset_facing'] as unknown as 'unset_facing',
            },
        ];
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(malformedRiskReason)).to.throw('assignment_risk_edge_invalid');

        const malformedSkippedReason = cloneValue(v2Assignment());
        malformedSkippedReason.explanation.skippedSeats = [
            {
                seat: malformedSkippedReason.seatFacts[0],
                reason: { toString: () => 'disabled' } as unknown as 'disabled',
            },
        ];
        expect(() => moduleUnderTest.assertExamSeatAssignmentIntegrity(malformedSkippedReason)).to.throw(
            'assignment_explanation_invalid',
        );
    });

    it('classifies unset and same facing as high risk, perpendicular as medium, and opposite as safe', () => {
        const cases = [
            { facing: ['unset', 'right'] as const, high: 'unset_facing', medium: null },
            { facing: ['right', 'right'] as const, high: 'same_facing', medium: null },
            { facing: ['up', 'right'] as const, high: null, medium: 'perpendicular_facing' },
            { facing: ['left', 'right'] as const, high: null, medium: null },
        ];
        for (const testCase of cases) {
            const rosterDoc = roster(2);
            const seatPlan = spatialPlan([2], rosterDoc);
            const result = moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: spatialSeatFacts(seatPlan, (_seat, _roomIndex, seatIndex) => ({ facing: testCase.facing[seatIndex] })),
                strategy: 'minimizeClassrooms',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            });
            expect(result.ok).to.equal(true);
            expect(result.ok && result.explanation.highRiskEdges[0]?.reason).to.equal(testCase.high || undefined);
            expect(result.ok && result.explanation.mediumRiskEdges[0]?.reason).to.equal(testCase.medium || undefined);
        }
    });

    it('uses the fewest allowed rooms by default and spreads across more rooms when spacing is preferred', () => {
        const rosterDoc = roster(2);
        const seatPlan = spatialPlan([2, 2], rosterDoc);
        const input = {
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan),
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        };
        const compact = moduleUnderTest.buildExamSeatAssignmentV2({ ...input, strategy: 'minimizeClassrooms' });
        const spaced = moduleUnderTest.buildExamSeatAssignmentV2({ ...input, strategy: 'maximizeSpacing' });
        expect(compact.ok && new Set(compact.assignments.map((mapping) => mapping.seat.classroomId.toHexString())).size).to.equal(1);
        expect(spaced.ok && new Set(spaced.assignments.map((mapping) => mapping.seat.classroomId.toHexString())).size).to.equal(2);
    });

    it('compares spatial risk between bounded alternatives that use the same minimum room count', () => {
        const rosterDoc = roster(2);
        const seatPlan = spatialPlan([2, 2], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan, (_seat, roomIndex, seatIndex) => ({
                facing: roomIndex === 0 ? 'unset' : seatIndex === 0 ? 'left' : 'right',
            })),
            strategy: 'minimizeClassrooms',
            seed: '0'.repeat(64),
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && new Set(result.assignments.map((mapping) => mapping.seat.classroomId.toHexString()))).to.deep.equal(
            new Set([seatPlan.classrooms[1].classroomId.toHexString()]),
        );
        expect(result.ok && result.explanation.highRiskEdges).to.have.lengthOf(0);
        expect(result.ok && result.explanation.mediumRiskEdges).to.have.lengthOf(0);
    });

    it('preserves valid locked and manual rows for every seed while filling the remaining participants', () => {
        const rosterDoc = roster(4);
        const seatPlan = spatialPlan([4], rosterDoc);
        const spatialFacts = spatialSeatFacts(seatPlan);
        const locked = { boundUserId: 101, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' } };
        const manual = { boundUserId: 102, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-004' } };
        for (const seed of [seedA, seedB]) {
            const result = moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: spatialFacts,
                strategy: 'minimizeClassrooms',
                seed,
                lockedAssignments: [locked],
                manualAssignments: [manual],
            });
            expect(result.ok).to.equal(true);
            expect(result.ok && result.assignments.find((mapping) => mapping.boundUserId === 101)).to.deep.equal(locked);
            expect(result.ok && result.assignments.find((mapping) => mapping.boundUserId === 102)).to.deep.equal(manual);
            expect(result.ok && result.assignments).to.have.lengthOf(4);
        }
    });

    it('clusters each team before isolating other teams and reports a lock-forced split', () => {
        const rosterDoc = roster(6);
        const seatPlan = spatialPlan([4, 4], rosterDoc);
        const teamByUid = new Map<number, { teamId: string; teamRole: 'captain' | 'member' }>([
            [101, { teamId: 'team-a', teamRole: 'captain' }],
            [102, { teamId: 'team-a', teamRole: 'member' }],
            [103, { teamId: 'team-a', teamRole: 'member' }],
            [104, { teamId: 'team-b', teamRole: 'captain' }],
            [105, { teamId: 'team-b', teamRole: 'member' }],
            [106, { teamId: 'team-b', teamRole: 'member' }],
        ]);
        const participants = spatialParticipants(rosterDoc, teamByUid);
        const spatialFacts = spatialSeatFacts(seatPlan);
        const clustered = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants,
            seatFacts: spatialFacts,
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(clustered.ok).to.equal(true);
        for (const teamId of ['team-a', 'team-b']) {
            const uids = new Set(participants.filter((participant) => participant.teamId === teamId).map((participant) => participant.boundUserId));
            expect(
                clustered.ok &&
                    new Set(
                        clustered.assignments
                            .filter((mapping) => uids.has(mapping.boundUserId))
                            .map((mapping) => mapping.seat.classroomId.toHexString()),
                    ).size,
            ).to.equal(1);
        }
        expect(clustered.ok && clustered.explanation.splitTeamIds).to.deep.equal([]);

        const forcedSplit = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants,
            seatFacts: spatialFacts,
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [
                { boundUserId: 101, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' } },
                { boundUserId: 102, seat: { classroomId: seatPlan.classrooms[1].classroomId, sourceSeatId: 'seat-001' } },
            ],
            manualAssignments: [],
        });
        expect(forcedSplit.ok).to.equal(true);
        expect(forcedSplit.ok && forcedSplit.explanation.splitTeamIds).to.deep.equal(['team-a']);
    });

    it('uses a feasible whole-team room packing before seat-level greed can fragment teams', () => {
        for (const testCase of [
            { capacities: [4, 3], teamSizes: [3, 2, 2], seed: 'b'.repeat(64) },
            { capacities: [6, 4], teamSizes: [3, 3, 2, 2], seed: '0'.repeat(64) },
        ]) {
            const rosterDoc = roster(testCase.teamSizes.reduce((sum, size) => sum + size, 0));
            const seatPlan = spatialPlan(testCase.capacities, rosterDoc);
            const result = moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialTeamParticipants(rosterDoc, testCase.teamSizes),
                seatFacts: spatialSeatFacts(seatPlan),
                strategy: 'maximizeSpacing',
                seed: testCase.seed,
                lockedAssignments: [],
                manualAssignments: [],
            });
            expect(result.ok).to.equal(true);
            expect(result.ok && result.explanation.splitTeamIds).to.deep.equal([]);
        }
    });

    it('keeps the maximum possible number of teams whole when some split is unavoidable', () => {
        const rosterDoc = roster(8);
        const seatPlan = spatialPlan([2, 2, 4], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialTeamParticipants(rosterDoc, [2, 3, 3]),
            seatFacts: spatialSeatFacts(seatPlan),
            strategy: 'maximizeSpacing',
            seed: '01'.repeat(32),
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.explanation.splitTeamIds).to.have.lengthOf(1);
    });

    it('packs partially fixed teams by completed-team count instead of team identifier order', () => {
        const rosterDoc = roster(7);
        const seatPlan = spatialPlan([5, 2], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialTeamParticipants(rosterDoc, [3, 2, 2]),
            seatFacts: spatialSeatFacts(seatPlan),
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [
                { boundUserId: 101, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' } },
                { boundUserId: 104, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-002' } },
                { boundUserId: 106, seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: 'seat-003' } },
            ],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.explanation.splitTeamIds).to.deep.equal(['team-a']);
    });

    it('keeps different intact teams in separate rooms when maximize-spacing has room to do so', () => {
        const rosterDoc = roster(4);
        const seatPlan = spatialPlan([4, 4], rosterDoc);
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialTeamParticipants(rosterDoc, [2, 2]),
            seatFacts: spatialSeatFacts(seatPlan),
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.explanation.splitTeamIds).to.deep.equal([]);
        expect(
            result.ok &&
                new Set(result.assignments.map((assignment) => assignment.seat.classroomId.toHexString())).size,
        ).to.equal(2);
        expect(result.ok && result.explanation.highRiskEdges).to.have.lengthOf(0);
    });

    it('persists the complete bounded local-neighbor risk graph for dense layouts', () => {
        const rosterDoc = roster(20);
        const seatPlan = spatialPlan([20], rosterDoc);
        const manualAssignments = rosterDoc.entries.map((entry, index) => ({
            boundUserId: entry.boundUserId,
            seat: { classroomId: seatPlan.classrooms[0].classroomId, sourceSeatId: `seat-${String(index + 1).padStart(3, '0')}` },
        }));
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan, () => ({ x: 0, y: 0, facing: 'unset' })),
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments,
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.explanation.highRiskEdges).to.have.lengthOf(124);
    });

    it('uses irregular geometry and seat size to avoid a nearby pair across the candidate layout', () => {
        const rosterDoc = roster(2);
        const seatPlan = spatialPlan([4], rosterDoc);
        const coordinates = [0, 1, 10, 11];
        const result = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(seatPlan, (_seat, _roomIndex, seatIndex) => ({
                x: coordinates[seatIndex],
                width: seatIndex % 2 === 0 ? 0.5 : 1,
                height: 1,
                facing: 'unset',
            })),
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(result.ok).to.equal(true);
        expect(result.ok && result.explanation.highRiskEdges).to.have.lengthOf(0);
    });

    it('uses seat footprint scale so a wide aisle lowers risk even in a two-seat room', () => {
        const rosterDoc = roster(2);
        const seatPlan = spatialPlan([2], rosterDoc);
        const buildAtDistance = (distance: number) =>
            moduleUnderTest.buildExamSeatAssignmentV2({
                roster: rosterDoc,
                seatPlan,
                participants: spatialParticipants(rosterDoc),
                seatFacts: spatialSeatFacts(seatPlan, (_seat, _roomIndex, seatIndex) => ({
                    x: seatIndex * distance,
                    width: 1,
                    height: 1,
                    facing: 'unset',
                })),
                strategy: 'minimizeClassrooms',
                seed: seedA,
                lockedAssignments: [],
                manualAssignments: [],
            });
        const adjacent = buildAtDistance(1);
        const acrossWideAisle = buildAtDistance(100);
        expect(adjacent.ok && adjacent.explanation.highRiskEdges).to.have.lengthOf(1);
        expect(acrossWideAisle.ok && acrossWideAisle.explanation.highRiskEdges).to.have.lengthOf(0);
    });

    it('returns only capacity and fixed-constraint hard failures without persisting a partial mapping', () => {
        const rosterDoc = roster(3);
        const shortPlan = spatialPlan([2], rosterDoc);
        const shortage = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan: shortPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: spatialSeatFacts(shortPlan),
            strategy: 'minimizeClassrooms',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(shortage.ok).to.equal(false);
        expect(!shortage.ok && shortage.diagnostics).to.deep.equal([
            { code: 'insufficient_seats', requiredSeatCount: 3, availableSeatCount: 2 },
        ]);

        const enoughPlan = spatialPlan([3], rosterDoc);
        const facts = spatialSeatFacts(enoughPlan, (_seat, _roomIndex, seatIndex) =>
            seatIndex === 0 ? { enabled: false, disabledReason: 'manual_reserve' } : {},
        );
        const invalidLock = moduleUnderTest.buildExamSeatAssignmentV2({
            roster: rosterDoc,
            seatPlan: enoughPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: facts,
            strategy: 'minimizeClassrooms',
            seed: seedA,
            lockedAssignments: [
                { boundUserId: 101, seat: { classroomId: enoughPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' } },
            ],
            manualAssignments: [],
        });
        expect(invalidLock.ok).to.equal(false);
        expect(!invalidLock.ok && invalidLock.diagnostics).to.deep.equal([
            {
                code: 'seat_skipped',
                seats: [
                    {
                        seat: { classroomId: enoughPlan.classrooms[0].classroomId, sourceSeatId: 'seat-001' },
                        reason: 'disabled',
                    },
                ],
            },
            { code: 'insufficient_seats', requiredSeatCount: 3, availableSeatCount: 2 },
            { code: 'constraint_conflict', reasons: ['locked_seat_unavailable'] },
        ]);
    });

    it('writes immutable v2 revisions with CAS and rejects a false mapping or explanation at publication', async () => {
        const rosterDoc = roster(4);
        const rosters = new MemoryCollection<import('../src/model/exam-seat-plan').ExamRosterRevisionDoc>();
        const plans = new MemoryCollection<import('../src/model/exam-seat-plan').ExamSeatPlanDoc>();
        rosters.docs.push(rosterDoc);
        plans.docs.push(plan(4, rosterDoc));
        const planTemplate = spatialPlan([3, 3], rosterDoc);
        const planService = new seatPlanModule.ExamSeatPlanService(
            rosters as never,
            plans as never,
            () => new Date('2026-08-12T00:13:00.000Z'),
            () => new ObjectId('66bc00000000000000000031'),
        );
        const seatPlan = await planService.createSeatPlanV2({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 1,
            roster: rosterDoc,
            classrooms: [...planTemplate.classrooms].reverse(),
            requireRoster: true,
        });
        expect(seatPlan.revision).to.equal(2);
        expect(seatPlan.classrooms.map((classroom) => classroom.classroomId.toHexString())).to.deep.equal(
            [...seatPlan.classrooms.map((classroom) => classroom.classroomId.toHexString())].sort(),
        );
        expect(
            await failureReason(() =>
                planService.createSeatPlanV2({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    expectedPreviousRevision: 1,
                    roster: rosterDoc,
                    classrooms: planTemplate.classrooms,
                    requireRoster: true,
                }),
            ),
        ).to.equal('seat_plan_revision_conflict');

        const revisions = new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentRevisionDoc>();
        const publications = new MemoryCollection<import('../src/model/exam-seat-assignment').ExamSeatAssignmentPublicationDoc>();
        const service = new moduleUnderTest.ExamSeatAssignmentService(
            revisions as never,
            publications as never,
            () => new Date('2026-08-12T00:14:00.000Z'),
            () => new ObjectId('66bc00000000000000000032'),
        );
        const assignmentSeatFacts = spatialSeatFacts(seatPlan, (_seat, roomIndex, seatIndex) =>
            roomIndex === 0 && seatIndex === 0 ? { enabled: false, disabledReason: 'manual_reserve' } : {},
        );
        const created = await service.createRevisionV2({
            domainId: 'system',
            eventId,
            eventRevision: 3,
            schoolId,
            actorUid: 2,
            expectedPreviousRevision: 0,
            roster: rosterDoc,
            seatPlan,
            participants: spatialParticipants(rosterDoc),
            seatFacts: assignmentSeatFacts,
            strategy: 'maximizeSpacing',
            seed: seedA,
            lockedAssignments: [],
            manualAssignments: [],
        });
        expect(created.assignment?.schemaVersion).to.equal(2);
        expect(created.assignment?.assignments).to.have.lengthOf(4);
        expect(revisions.docs).to.have.lengthOf(1);
        expect(
            await failureReason(() =>
                service.createRevisionV2({
                    domainId: 'system',
                    eventId,
                    eventRevision: 3,
                    schoolId,
                    actorUid: 2,
                    expectedPreviousRevision: 0,
                    roster: rosterDoc,
                    seatPlan,
                    participants: spatialParticipants(rosterDoc),
                    seatFacts: assignmentSeatFacts,
                    strategy: 'maximizeSpacing',
                    seed: seedA,
                    lockedAssignments: [],
                    manualAssignments: [],
                }),
            ),
        ).to.equal('assignment_revision_conflict');

        const forgedExplanation = cloneValue(created.assignment!);
        forgedExplanation.explanation.skippedSeats = [];
        forgedExplanation.fingerprint = moduleUnderTest.assignmentDocumentFingerprint(forgedExplanation);
        revisions.docs[0] = forgedExplanation;
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
        ).to.equal('assignment_algorithm_result_mismatch');

        const forgedMapping = cloneValue(created.assignment!);
        [forgedMapping.assignments[0].seat, forgedMapping.assignments[1].seat] = [
            forgedMapping.assignments[1].seat,
            forgedMapping.assignments[0].seat,
        ];
        forgedMapping.explanation = spatialModule.explainExamSeatSpatialAllocation({
            classrooms: forgedMapping.classrooms,
            participants: forgedMapping.participants,
            seatFacts: forgedMapping.seatFacts,
            assignments: forgedMapping.assignments,
        });
        forgedMapping.fingerprint = moduleUnderTest.assignmentDocumentFingerprint(forgedMapping);
        revisions.docs[0] = forgedMapping;
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
        ).to.equal('assignment_algorithm_result_mismatch');
    });
});
