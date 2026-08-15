import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ObjectId } from 'mongodb';

const domainId = 'system';
const eventId = new ObjectId('64b200000000000000000001');
const schoolId = new ObjectId('64b200000000000000000002');
const contestId = new ObjectId('64b200000000000000000003');
const assignmentId = new ObjectId('64b200000000000000000004');
const seatPlanId = new ObjectId('64b200000000000000000005');
const rosterId = new ObjectId('64b200000000000000000006');
const classroomId = new ObjectId('64b200000000000000000007');
const studentRecordId = new ObjectId('64b200000000000000000008');
const bindingId = new ObjectId('64b200000000000000000009');
const fingerprint = 'a'.repeat(64);

let assign: string[] = [];
let inviteCode = '';
let attended = true;
let groupNames: string[] = [];
let assignmentSchemaVersion: 1 | 2 = 1;
let seatPlanSchemaVersion: 1 | 2 = 1;
let v2FacingChanged = false;
let v2ReadinessChanged = false;
let bulkReadinessCalls = 0;
let ticketReadinessCalls = 0;

function stub(modulePath: string, exports: Record<string, unknown>): void {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeModule;
}

stub('../src/service/db.ts', { __esModule: true, default: { collection: () => ({}) } });
stub('../src/model/contest.ts', {
    __esModule: true,
    get: async () => ({
        _id: contestId,
        docId: contestId,
        domainId,
        beginAt: new Date('2026-08-12T01:30:00.000Z'),
        endAt: new Date('2026-08-12T03:00:00.000Z'),
        clientLoginBlockBeforeMinutes: 60,
        vigilEnabled: true,
        entryMode: 'client_required',
        participationMode: 'individual',
        assign,
        _code: inviteCode,
    }),
    getStatus: async () => ({ attend: attended ? 1 : 0 }),
    getParticipationMode: () => 'individual',
    isClientFinished: () => false,
    isTeamBatchFinalizationPending: () => false,
});
stub('../src/model/contest-team.ts', {
    __esModule: true,
    assertContestTeamEligibility: async () => undefined,
    getTeamByMember: async () => null,
});
stub('../src/model/exam-classroom.ts', {
    __esModule: true,
    examClassroomService: {
        get: async () => ({ schoolId, layoutRevision: 2 }),
        layout: () => ({ snapshot: { fingerprint } }),
    },
});
stub('../src/model/exam-seat-assignment.ts', {
    __esModule: true,
    assertExamSeatAssignmentIntegrity: () => undefined,
    examSeatIdentityKey: (seat: { classroomId: ObjectId; sourceSeatId: string }) => `${seat.classroomId.toHexString()}\0${seat.sourceSeatId}`,
    isExamSeatAssignmentV2: (assignment: { schemaVersion?: number }) => assignment.schemaVersion === 2,
    examSeatAssignmentService: {
        getRevision: async () => ({
            _id: assignmentId,
            ...(assignmentSchemaVersion === 2 ? { schemaVersion: 2 } : {}),
            revision: 2,
            schoolId,
            eventRevision: 3,
            seatPlan: { seatPlanId, revision: 2, fingerprint },
            roster: { rosterId, revision: 2, fingerprint },
            classroomId,
            layoutRevision: 2,
            layoutFingerprint: fingerprint,
            candidateSeatIds: ['seat-1'],
            ...(assignmentSchemaVersion === 2
                ? {
                      participants: [{ boundUserId: 42, studentRecordId }],
                      seatFacts: [
                          {
                              classroomId,
                              sourceSeatId: 'seat-1',
                              enabled: true,
                              bindingId,
                              bindingRevision: 3,
                              endpointId: 'ep_one',
                          },
                      ],
                      assignments: [{ boundUserId: 42, seat: { classroomId, sourceSeatId: 'seat-1' } }],
                  }
                : { assignments: [{ boundUserId: 42, sourceSeatId: 'seat-1' }] }),
            fingerprint,
        }),
        getPublication: async () => ({
            revision: 1,
            assignment: { assignmentId, revision: 2, fingerprint },
        }),
    },
});
stub('../src/model/exam-seat-assignment-readiness.ts', {
    __esModule: true,
    loadCurrentExamSeatAssignmentV2Facts: async () => {
        bulkReadinessCalls++;
        if (v2ReadinessChanged) throw new TypeError('exam_prelogin_assignment_reference_changed');
        return {
            mappings: [
                {
                    uid: 42,
                    studentRecordId,
                    classroomId,
                    sourceSeatId: 'seat-1',
                    seatKey: `${classroomId.toHexString()}\0seat-1`,
                    bindingId,
                    bindingRevision: 3,
                    endpointId: 'ep_one',
                    facingChanged: v2FacingChanged,
                },
            ],
        };
    },
    loadCurrentExamSeatAssignmentV2TicketFact: async () => {
        ticketReadinessCalls++;
        if (v2ReadinessChanged) throw new TypeError('exam_prelogin_assignment_reference_changed');
        return {
            uid: 42,
            studentRecordId,
            classroomId,
            sourceSeatId: 'seat-1',
            seatKey: `${classroomId.toHexString()}\0seat-1`,
            bindingId,
            bindingRevision: 3,
            endpointId: 'ep_one',
            facingChanged: v2FacingChanged,
        };
    },
});
stub('../src/model/exam-seat-plan.ts', {
    __esModule: true,
    assertExamRosterRevisionIntegrity: () => undefined,
    assertExamSeatPlanIntegrity: () => undefined,
    isExamSeatPlanV2: (seatPlan: { schemaVersion?: number }) => seatPlan.schemaVersion === 2,
    examSeatPlanService: {
        getSeatPlanRevision: async () => ({
            _id: seatPlanId,
            ...(seatPlanSchemaVersion === 2 ? { schemaVersion: 2 } : {}),
            fingerprint,
            classroomId,
            layoutRevision: 2,
            layoutFingerprint: fingerprint,
            candidateSeatIds: ['seat-1'],
        }),
        getRosterRevision: async () => ({
            _id: rosterId,
            fingerprint,
            source: { kind: 'contestAudience', contestId },
            entries: [{ boundUserId: 42, studentRecordId }],
        }),
    },
});
stub('../src/model/endpoint-seat-binding.ts', {
    __esModule: true,
    endpointSeatBindingService: {
        listClassroomBindings: async () => [
            {
                _id: bindingId,
                status: 'active',
                endpointId: 'ep_one',
                sourceSeatId: 'seat-1',
                revision: 3,
                schoolId,
            },
        ],
    },
});
stub('../src/model/user.ts', {
    __esModule: true,
    default: {
        getById: async () => ({ _id: 42, hasPerm: () => true }),
        listGroup: async () => groupNames.map((name) => ({ name })),
    },
});

(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = {
    model: {
        userbind: {
            findStudentByUserId: async () => ({ _id: studentRecordId, schoolId, boundUserId: 42 }),
        },
        vigilguard: { hitsParticipantScope: async () => true },
    },
};

const { loadExamPreloginDispatchRecovery, loadExamPreloginPreparation, validateExamPreloginTicketCurrent, validateExamPreloginTicketsCurrent } =
    require('../src/model/exam-prelogin-loader.ts') as typeof import('../src/model/exam-prelogin-loader');
const { examPreloginTicketId } = require('../src/model/exam-prelogin.ts') as typeof import('../src/model/exam-prelogin');

function event() {
    return {
        _id: eventId,
        domainId,
        schoolId,
        type: 'krypton' as const,
        contestId,
        lifecycle: 'scheduled' as const,
        startAt: new Date('2026-08-12T01:30:00.000Z'),
        endAt: new Date('2026-08-12T03:00:00.000Z'),
        revision: 3,
    } as import('../src/model/exam-event').ExamEventDoc;
}

async function prepare() {
    return loadExamPreloginPreparation(
        event(),
        2,
        async () => [
            {
                endpointId: 'ep_one',
                online: true,
                compatible: true,
                serviceVersion: '0.5.0',
                protocolVersion: 2,
                capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                activeSessionId: null,
                resumableSessionId: null,
            },
        ],
        new Date('2026-08-12T01:00:00.000Z'),
    );
}

beforeEach(() => {
    assign = [];
    inviteCode = '';
    attended = true;
    groupNames = [];
    assignmentSchemaVersion = 1;
    seatPlanSchemaVersion = 1;
    v2FacingChanged = false;
    v2ReadinessChanged = false;
    bulkReadinessCalls = 0;
    ticketReadinessCalls = 0;
});

test('v2 pre-login preserves the structured seat identity and reports facing drift as a warning', async () => {
    assignmentSchemaVersion = 2;
    v2FacingChanged = true;
    const result = await prepare();

    assert.equal(result.items[0].ready, true);
    assert.deepEqual(result.items[0].diagnostics, [{ code: 'seat_facing_changed', severity: 'warning' }]);
    assert.equal(result.items[0].sourceSeatId, 'seat-1');
    assert.equal(result.items[0].bindingId?.toHexString(), bindingId.toHexString());
});

test('v2 pre-login blocks the whole preparation when current assignment facts drift', async () => {
    assignmentSchemaVersion = 2;
    v2ReadinessChanged = true;
    await assert.rejects(prepare(), /exam_prelogin_assignment_reference_changed/);
});

test('v2 redemption rechecks only the exact ticket endpoint instead of repeating the whole batch preflight', async () => {
    assignmentSchemaVersion = 2;
    const batchId = new ObjectId('64b20000000000000000000b');
    const ticketId = examPreloginTicketId(batchId, 'ep_one');
    const ticket: import('../src/model/exam-prelogin').ExamPreloginTicketDoc = {
        _id: ticketId,
        batchId,
        domainId,
        eventId,
        eventRevision: 3,
        assignment: { assignmentId, revision: 2, fingerprint },
        publicationRevision: 1,
        uid: 42,
        studentRecordId,
        sourceSeatId: 'seat-1',
        bindingId,
        bindingRevision: 3,
        endpointId: 'ep_one',
        workspace: { kind: 'contest', contestId: contestId.toHexString(), path: `/exam-mode/${contestId.toHexString()}` },
        nonce: 'b'.repeat(32),
        ticketDigest: 'c'.repeat(64),
        issuedAt: new Date('2026-08-12T00:55:00.000Z'),
        expiresAt: new Date('2026-08-12T01:05:00.000Z'),
        state: 'issued',
        redemptionRequestId: null,
        redeemedAt: null,
        fingerprint: 'd'.repeat(64),
    };
    await validateExamPreloginTicketCurrent(
        event(),
        ticket,
        fingerprint,
        async (subjects) => {
            assert.deepEqual(subjects, [{ endpointId: 'ep_one', uid: 42, contestId: contestId.toHexString() }]);
            return [
                {
                    endpointId: 'ep_one',
                    online: true,
                    compatible: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: null,
                    resumableSessionId: null,
                },
            ];
        },
        new Date('2026-08-12T01:00:00.000Z'),
    );

    assert.equal(ticketReadinessCalls, 1);
    assert.equal(bulkReadinessCalls, 0);
});

test('partial v2 ticket recovery rebuilds only immutable assignment and roster facts', async () => {
    assignmentSchemaVersion = 2;
    v2ReadinessChanged = true;
    const batchId = new ObjectId('64b20000000000000000000b');
    const ticketId = examPreloginTicketId(batchId, 'ep_one');
    const currentEvent = { ...event(), contestId: new ObjectId('64b20000000000000000000c'), revision: 9 };
    const recovery = await loadExamPreloginDispatchRecovery(currentEvent, {
        _id: batchId,
        domainId,
        eventId,
        eventRevision: 3,
        assignment: { assignmentId, revision: 2, fingerprint },
        publicationRevision: 1,
        requestId: 'prelogin_partial_recovery',
        preparationFingerprint: fingerprint,
        workflow: {
            fingerprint,
            executionRevision: 1,
            policy: { id: new ObjectId(), revision: 1, fingerprint },
            target: { id: new ObjectId(), revision: 1, fingerprint },
            targetCount: 1,
            startAt: new Date('2026-08-12T00:30:00.000Z'),
            hardEndAt: new Date('2026-08-12T03:00:00.000Z'),
        },
        state: 'dispatching',
        revision: 1,
        ticketIds: [ticketId],
        projection: null,
        createdAt: new Date('2026-08-12T01:00:00.000Z'),
        createdBy: 7,
        updatedAt: new Date('2026-08-12T01:00:00.000Z'),
        fingerprint,
    });

    assert.equal(recovery?.workspace.contestId, contestId.toHexString());
    assert.equal(recovery?.items[0].ticketId.toHexString(), ticketId.toHexString());
    assert.equal(recovery?.items[0].bindingId.toHexString(), bindingId.toHexString());
    assert.equal(recovery?.items[0].endpointId, 'ep_one');
});

test('v1 pre-login rejects a v2 seat plan reference', async () => {
    assignmentSchemaVersion = 1;
    seatPlanSchemaVersion = 2;
    await assert.rejects(prepare(), /exam_prelogin_assignment_reference_changed/);
});

test('pre-login rechecks legacy contest assignment groups', async () => {
    assign = ['eligible-group'];
    groupNames = ['other-group'];

    const result = await prepare();

    assert.equal(result.items[0].ready, false);
    assert.deepEqual(result.items[0].diagnostics, [{ code: 'contest_not_enterable', severity: 'error' }]);
});

test('pre-login rechecks invite-code attendance', async () => {
    inviteCode = 'invite-required';
    attended = false;

    const result = await prepare();

    assert.equal(result.items[0].ready, false);
    assert.deepEqual(result.items[0].diagnostics, [{ code: 'contest_not_enterable', severity: 'error' }]);
});

test('retry accepts only the active session linked to the exact redeemed ticket', async () => {
    const ticketId = new ObjectId('64b20000000000000000000a');
    const batchId = new ObjectId('64b20000000000000000000b');
    const ticket: import('../src/model/exam-prelogin').ExamPreloginTicketDoc = {
        _id: ticketId,
        batchId,
        domainId,
        eventId,
        eventRevision: 3,
        assignment: { assignmentId, revision: 2, fingerprint },
        publicationRevision: 1,
        uid: 42,
        studentRecordId,
        sourceSeatId: 'seat-1',
        bindingId,
        bindingRevision: 3,
        endpointId: 'ep_one',
        workspace: { kind: 'contest', contestId: contestId.toHexString(), path: `/exam-mode/${contestId.toHexString()}` },
        nonce: 'b'.repeat(32),
        ticketDigest: 'c'.repeat(64),
        issuedAt: new Date('2026-08-12T00:55:00.000Z'),
        expiresAt: new Date('2026-08-12T01:05:00.000Z'),
        state: 'redeemed',
        redemptionRequestId: 'prelogin_redeem_exact',
        redeemedAt: new Date('2026-08-12T00:59:00.000Z'),
        fingerprint: 'd'.repeat(64),
    };
    const observedAt = new Date('2026-08-12T01:00:00.000Z');
    const resume = await validateExamPreloginTicketsCurrent(
        event(),
        [ticket],
        async (subjects) => {
            assert.deepEqual(subjects[0].retry, { batchId: batchId.toHexString(), ticketId: ticketId.toHexString() });
            return [
                {
                    endpointId: 'ep_one',
                    online: true,
                    compatible: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: 'session_exact',
                    resumableSessionId: 'session_exact',
                },
            ];
        },
        observedAt,
    );
    assert.deepEqual(resume, { [ticketId.toHexString()]: 'session_exact' });

    await assert.rejects(
        validateExamPreloginTicketsCurrent(
            event(),
            [ticket],
            async () => [
                {
                    endpointId: 'ep_one',
                    online: true,
                    compatible: true,
                    serviceVersion: '0.5.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: 'session_other',
                    resumableSessionId: 'session_exact',
                },
            ],
            observedAt,
        ),
        /exam_prelogin_resume_session_invalid/,
    );
});
