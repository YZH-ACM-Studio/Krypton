import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');

const domainId = 'system';
const eventId = new ObjectId('66be00000000000000000101');
const schoolId = new ObjectId('66be00000000000000000102');
const classroomId = new ObjectId('66be00000000000000000103');
const assignmentId = new ObjectId('66be00000000000000000104');
const seatPlanId = new ObjectId('66be00000000000000000105');
const rosterId = new ObjectId('66be00000000000000000106');
const studentRecordId = new ObjectId('66be00000000000000000107');
const bindingId = new ObjectId('66be00000000000000000108');
const layoutFingerprint = '1'.repeat(64);
const profileFingerprint = '2'.repeat(64);
const assignmentFingerprint = '3'.repeat(64);
const seatPlanFingerprint = '4'.repeat(64);
const rosterFingerprint = '5'.repeat(64);
const contestId = new ObjectId('66be00000000000000000109');

class PlanError extends Error {}

let currentFacing: 'left' | 'right' = 'left';
let currentEnabled = true;
let currentBindingRevision = 3;
let currentEndpointId = 'ep_current';
let rosterChanged = false;
let audienceState: 'fixed' | 'public' = 'fixed';
let rosterSourceKind: 'contestAudience' | 'userbindGroups' = 'contestAudience';
let rosterDrift = {
    changed: false,
    sourceChangedWithoutParticipantDiff: false,
    items: [] as Array<Record<string, unknown>>,
};

const classroomRef = {
    classroomId,
    layoutRevision: 2,
    layoutFingerprint,
    profileRevision: 1,
    profileFingerprint,
    candidateSeatIds: ['seat-1'],
};

const seatPlan = {
    _id: seatPlanId,
    schemaVersion: 2,
    domainId,
    eventId,
    schoolId,
    revision: 2,
    roster: { rosterId, revision: 2, fingerprint: rosterFingerprint },
    classrooms: [classroomRef],
    fingerprint: seatPlanFingerprint,
};

const roster = {
    _id: rosterId,
    domainId,
    eventId,
    schoolId,
    revision: 2,
    fingerprint: rosterFingerprint,
};

const assignment = {
    _id: assignmentId,
    schemaVersion: 2,
    domainId,
    eventId,
    eventRevision: 3,
    schoolId,
    revision: 2,
    seatPlan: { seatPlanId, revision: 2, fingerprint: seatPlanFingerprint },
    roster: { rosterId, revision: 2, fingerprint: rosterFingerprint },
    classrooms: [classroomRef],
    participants: [{ boundUserId: 42, studentRecordId }],
    seatFacts: [
        {
            classroomId,
            sourceSeatId: 'seat-1',
            enabled: true,
            facing: 'left',
            bindingId,
            bindingRevision: 3,
            endpointId: 'ep_current',
        },
    ],
    assignments: [{ boundUserId: 42, seat: { classroomId, sourceSeatId: 'seat-1' } }],
    fingerprint: assignmentFingerprint,
};
const typedAssignment = assignment as import('../src/model/exam-seat-assignment').ExamSeatAssignmentV2Doc;

function loadReadiness() {
    const readinessPath = require.resolve('../src/model/exam-seat-assignment-readiness.ts');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === readinessPath && request === './exam-seat-assignment') {
            return {
                assertExamSeatAssignmentIntegrity: () => undefined,
                examSeatIdentityKey: (seat: { classroomId: ObjectId; sourceSeatId: string }) =>
                    `${seat.classroomId.toHexString()}\0${seat.sourceSeatId}`,
                isExamSeatAssignmentV2: (value: { schemaVersion?: number }) => value.schemaVersion === 2,
                seatPlanMatchesAssignmentRoster: () => true,
            };
        }
        if (parent?.filename === readinessPath && request === './exam-seat-plan') {
            return {
                assertExamRosterRevisionIntegrity: () => undefined,
                assertExamSeatPlanIntegrity: () => undefined,
                ExamSeatPlanError: PlanError,
                isExamSeatPlanV2: (value: { schemaVersion?: number }) => value.schemaVersion === 2,
                examSeatPlanService: {
                    getSeatPlanRevision: async () => seatPlan,
                    getRosterRevision: async () => ({
                        ...roster,
                        source: { kind: rosterSourceKind, contestId: rosterSourceKind === 'contestAudience' ? contestId : null },
                    }),
                },
            };
        }
        if (parent?.filename === readinessPath && request === './exam-roster-resolver') {
            return {
                getExamContestAudienceState: async () => audienceState,
                assertExamRosterCurrent: async () => {
                    if (rosterChanged) throw new PlanError('roster_source_changed');
                },
                inspectExamRosterDrift: async () => rosterDrift,
            };
        }
        if (parent?.filename === readinessPath && request === './exam-classroom') {
            return {
                examClassroomService: {
                    get: async () => ({ _id: classroomId, schoolId, layoutRevision: 2 }),
                    layout: () => ({ snapshot: { fingerprint: layoutFingerprint, seats: [{ sourceSeatId: 'seat-1' }] } }),
                },
            };
        }
        if (parent?.filename === readinessPath && request === './exam-seat-operational-profile') {
            return {
                examSeatOperationalProfileService: {
                    getCurrent: async () => ({
                        schoolId,
                        layoutRevision: 2,
                        layoutFingerprint,
                        entries: [{ sourceSeatId: 'seat-1', enabled: currentEnabled, facing: currentFacing }],
                    }),
                },
            };
        }
        if (parent?.filename === readinessPath && request === './endpoint-seat-binding') {
            return {
                endpointSeatBindingService: {
                    listClassroomBindings: async () => [
                        {
                            _id: bindingId,
                            status: 'active',
                            endpointId: currentEndpointId,
                            sourceSeatId: 'seat-1',
                            revision: currentBindingRevision,
                        },
                    ],
                },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[readinessPath];
        return require(readinessPath) as typeof import('../src/model/exam-seat-assignment-readiness');
    } finally {
        Module._load = originalLoad;
        delete require.cache[readinessPath];
    }
}

function event() {
    return {
        _id: eventId,
        domainId,
        schoolId,
        revision: 3,
        type: 'krypton',
        contestId,
    } as import('../src/model/exam-event').ExamEventDoc;
}

beforeEach(() => {
    currentFacing = 'left';
    currentEnabled = true;
    currentBindingRevision = 3;
    currentEndpointId = 'ep_current';
    rosterChanged = false;
    audienceState = 'fixed';
    rosterSourceKind = 'contestAudience';
    rosterDrift = { changed: false, sourceChangedWithoutParticipantDiff: false, items: [] };
});

test('current v2 assignment facts preserve identity and expose facing-only drift as a warning fact', async () => {
    currentFacing = 'right';
    const readiness = loadReadiness();

    const result = await readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment);

    assert.equal(result.mappings.length, 1);
    assert.equal(result.mappings[0].seatKey, `${classroomId.toHexString()}\0seat-1`);
    assert.equal(result.mappings[0].endpointId, 'ep_current');
    assert.equal(result.mappings[0].facingChanged, true);
});

test('single-ticket v2 readiness validates only the requested frozen seat and preserves facing drift', async () => {
    currentFacing = 'right';
    const readiness = loadReadiness();

    const result = await readiness.loadCurrentExamSeatAssignmentV2TicketFact(event(), typedAssignment, 42);

    assert.equal(result.uid, 42);
    assert.equal(result.seatKey, `${classroomId.toHexString()}\0seat-1`);
    assert.equal(result.bindingId.toHexString(), bindingId.toHexString());
    assert.equal(result.endpointId, 'ep_current');
    assert.equal(result.facingChanged, true);
});

test('current v2 assignment facts fail closed when an assigned seat is disabled', async () => {
    currentEnabled = false;
    const readiness = loadReadiness();

    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'seat_disabled' &&
            error.detail.classroomId === classroomId.toHexString() &&
            error.detail.sourceSeatId === 'seat-1' &&
            error.detail.uid === 42,
    );
});

test('current v2 assignment facts fail closed when a binding or endpoint changes', async () => {
    currentBindingRevision = 4;
    currentEndpointId = 'ep_replaced';
    const readiness = loadReadiness();

    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'binding',
    );
});

test('current v2 assignment facts fail closed when the frozen roster source changes', async () => {
    rosterChanged = true;
    const readiness = loadReadiness();

    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'roster',
    );
});

test('Krypton v2 readiness rejects a historical userbind subset while keeping it available to read-only drift inspection', async () => {
    rosterSourceKind = 'userbindGroups';
    const readiness = loadReadiness();

    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'roster',
    );
    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2TicketFact(event(), typedAssignment, 42),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'roster',
    );
    assert.deepEqual(await readiness.inspectCurrentExamSeatAssignmentV2Roster(event(), typedAssignment), rosterDrift);
});

test('current v2 assignment facts fail closed when the Contest audience becomes public', async () => {
    audienceState = 'public';
    const readiness = loadReadiness();

    await assert.rejects(
        readiness.loadCurrentExamSeatAssignmentV2Facts(event(), typedAssignment),
        (error: unknown) =>
            error instanceof readiness.ExamSeatAssignmentReadinessError &&
            error.reason === 'assignment_reference_changed' &&
            error.stage === 'contest_audience',
    );
});

test('published v2 roster inspection remains readable when the current Contest audience becomes public', async () => {
    audienceState = 'public';
    const readiness = loadReadiness();

    const result = await readiness.inspectCurrentExamSeatAssignmentV2Roster(event(), typedAssignment);

    assert.deepEqual(result, { changed: true, sourceChangedWithoutParticipantDiff: true, items: [] });
});

test('published v2 roster inspection returns exact participant drift without weakening the hard gate', async () => {
    rosterDrift = {
        changed: true,
        sourceChangedWithoutParticipantDiff: false,
        items: [{ boundUserId: 42, studentId: '20260042', realName: '学生', kind: 'team_changed' }],
    };
    const readiness = loadReadiness();

    const result = await readiness.inspectCurrentExamSeatAssignmentV2Roster(event(), typedAssignment);

    assert.equal(result.changed, true);
    assert.deepEqual(result.items, rosterDrift.items);
});
