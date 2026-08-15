import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const source = readFileSync(resolve(__dirname, '../src/handler/exam-seat-assignment.ts'), 'utf8');
const eventSource = readFileSync(resolve(__dirname, '../src/handler/exam-event.ts'), 'utf8');

describe('P2.5 seat assignment HTTP boundary', () => {
    it('registers one event-owned page/API without adding P2.6 ticket dispatch', () => {
        expect(source).to.include("'/admin/exam-infrastructure/events/:eventId/seats'");
        expect(source).to.include("'admin_exam_seats.html'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/seat-assignments'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/seat-assignment-classrooms/:classroomId'");
        expect(source).to.include('canManage: true');
        expect(source).not.to.match(/ticket|prelogin|dispatchExam/i);
    });

    it('re-reads event authorization and writable lifecycle inside the shared event boundary', () => {
        expect(source).to.include('withExamEventBoundary(domainId, eventId');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).to.include('PERM.PERM_USERBIND_MANAGE_STUDENTS');
        expect(source).to.include('this.assertWritableEvent(current)');
    });

    it('keeps legacy v1 writes disabled and owns all v2 rerandomization seeds on the server', () => {
        expect(source).not.to.include("exactBody(this.request.body, ['action', 'mode', 'seatPlanRevision'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'assignmentRevision', 'expectedPublicationRevision'])");
        expect(source).to.include('examSeatAssignmentService.newSeed()');
        expect(source).to.include("throw new ExamSeatAssignmentError('assignment_v2_writer_required')");
        expect(source).not.to.include("@param('seed'");
    });

    it('uses exact v2 actions for deterministic generation, cross-room adjustment and locked rerandomization', () => {
        expect(source).to.include("exactBody(this.request.body, ['action', 'expectedPreviousRevision', 'seatPlanRevision', 'strategy'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'baseAssignmentRevision', 'lockedUids', 'mappings'])");
        expect(source).to.include("action === 'generateV2' || action === 'adjustV2' || action === 'rerandomizeV2'");
        expect(source).to.include('manualAssignments = requestV2Mappings(mappings)');
        expect(source).to.include('lockedAssignments = base.constraints.lockedAssignments');
        expect(source).to.include('strategy: base.constraints.strategy');
        expect(source).to.include('examSeatAssignmentService.createRevisionV2');
        expect(source).to.include('(latest?.revision || 0) !== expectedPreviousRevision');
        expect(source).to.include('!latestPlan._id.equals(base.seatPlan.seatPlanId)');
        expect(source).to.include("throw new ExamSeatAssignmentError('seat_plan_v2_not_current')");
    });

    it('revalidates immutable roster/plan, current layout and active seat bindings before any revision write', () => {
        expect(source).to.include('assertExamSeatAssignmentIntegrity(assignment)');
        expect(source).to.include('JSON.stringify(rosterUids) !== JSON.stringify(assignedUids)');
        expect(source).to.include('assignment_publication_reference_drift');
        expect(source).to.include('classroom.layoutRevision !== seatPlan.layoutRevision');
        expect(source).to.include('layout.fingerprint !== seatPlan.layoutFingerprint');
        expect(source).to.include('endpointSeatBindingService.listClassroomBindings');
        expect(source).to.include('seatPlanMatchesAssignmentRoster(seatPlan, assignment)');
        expect(source).to.include('seatFactMatchesBindingHistory(domainId, event.schoolId, fact, binding || null)');
        expect(source).to.include("binding.status === 'active'");
        expect(source).to.include('examSeatAssignmentService.createRevisionV2');
    });

    it('freezes v2 team, profile, binding and live-status facts without making liveness a hard allocation gate', () => {
        expect(source).to.include("resolveExamRosterForEvent(event, { kind: 'contestAudience' })");
        expect(source).to.include('listContestTeams(event.domainId, event.contestId)');
        expect(source.indexOf('const currentRosterBeforeTeams = await resolveExamRosterForEvent')).to.be.lessThan(
            source.indexOf('const teams = await listContestTeams'),
        );
        expect(source.indexOf('const teams = await listContestTeams')).to.be.lessThan(
            source.indexOf('const currentRosterAfterTeams = await resolveExamRosterForEvent'),
        );
        expect(source).to.include("(await getExamContestAudienceState(event)) !== 'fixed'");
        expect(source).to.include('await assertExamContestAudienceRosterCurrent(event, roster)');
        expect(source).to.include('examSeatOperationalProfileService.getCurrent(domainId, classroomRef.classroomId)');
        expect(source).to.include('endpointSeatBindingService.listClassroomBindings(domainId, classroomRef.classroomId)');
        expect(source).to.include("throw new ExamSeatAssignmentError('assignment_endpoint_duplicate')");
        expect(source).to.include('endpointOnline: fact.endpointId');
        expect(source).to.include('onlineByEndpoint.get(fact.endpointId) ?? null');
        expect(source).to.include('Exam seat assignment v2 live status unavailable');
        expect(source).to.include('const failure = classifyVigilBridgeFailure(error)');
        expect(source).to.include('failure.httpStatus ??');
    });

    it('reuses the existing userbind read model for the fresh-event preparation step', () => {
        expect(source).to.include('userbind.listUserGroups(event.domainId, event.schoolId)');
        expect(source).to.include('examClassroomService.listDomain(domainId, false, 500)');
        expect(source).to.include('!classroom.schoolId.equals(event.schoolId)');
        expect(source).to.include('endpointSeatBindingService.listClassroomBindings(domainId, classroomId)');
        expect(source).to.include('rosterGroups,');
        expect(source).not.to.match(/background|scheduler|autoGenerate/);
    });

    it('renders an existing assignment from its exact historical seat-plan source instead of a newer draft plan', () => {
        expect(source).to.include('isExamSeatAssignmentV2(assignments[0])');
        expect(source).to.include('this.displaySourceFromV2(assignments[0])');
        expect(source).to.include('this.source(event, assignments[0].seatPlan.revision, false)');
        expect(source).to.include('if (isExamSeatPlanV2(latestPlan))');
        expect(source).to.include('latestPlanSource = await this.source(event, latestPlan.revision, false)');
        expect(source).to.include("? 'current'");
        expect(source).to.include(": 'layout-drift'");
        expect(source).to.include('else if (latestPlanSource) currentSource = this.displaySourceFromV1(latestPlanSource)');
    });

    it('blocks event school changes after assignment facts and logs only stable IDs/counts/fingerprints', () => {
        expect(eventSource).to.include('examSeatAssignmentService.assertEventSchoolChangeAllowed(domainId, eventId)');
        const loggerCalls = source.match(/logger\.info\([\s\S]*?\);/g) || [];
        expect(loggerCalls.join('\n')).not.to.match(/realName|studentId/);
    });

    it('publishes only the strict latest v2 assignment for the strict latest v2 plan', () => {
        expect(source).to.include('examSeatAssignmentService.latestRevision(domainId, eventId)');
        expect(source).to.include('examSeatPlanService.latestSeatPlanRevision(domainId, eventId)');
        expect(source).to.include('!latestAssignment._id.equals(assignment._id)');
        expect(source).to.include('!latestPlan._id.equals(assignment.seatPlan.seatPlanId)');
        expect(source).to.include("throw new ExamSeatAssignmentError('assignment_v2_not_current')");
    });
});
