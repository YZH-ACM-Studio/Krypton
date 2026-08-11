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
        expect(source).not.to.match(/ticket|prelogin|dispatchExam/i);
    });

    it('re-reads event authorization and writable lifecycle inside the shared event boundary', () => {
        expect(source).to.include('withExamEventBoundary(domainId, eventId');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).to.include('PERM.PERM_USERBIND_MANAGE_STUDENTS');
        expect(source).to.include('this.assertWritableEvent(current)');
    });

    it('uses exact action bodies and keeps rerandomization seed ownership on the server', () => {
        expect(source).to.include("exactBody(this.request.body, ['action', 'mode', 'seatPlanRevision'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'baseAssignmentRevision', 'lockedUids', 'mappings'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'baseAssignmentRevision'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'assignmentRevision', 'expectedPublicationRevision'])");
        expect(source).to.include('examSeatAssignmentService.newSeed()');
        expect(source).to.include("nextMode = 'random'");
        expect(source).to.include('seed: latest?.seed || examSeatAssignmentService.newSeed()');
        expect(source).to.include('latest.seatPlan.seatPlanId.equals(source.seatPlan._id)');
        expect(source).to.include('lockedAssignments: sameSeatPlan ? latest.constraints.lockedAssignments : []');
        expect(source).not.to.include("@param('seed'");
    });

    it('revalidates immutable roster/plan, current layout and active seat bindings before any revision write', () => {
        expect(source).to.include('assertExamSeatAssignmentIntegrity(assignment)');
        expect(source).to.include('JSON.stringify(rosterUids) !== JSON.stringify(assignedUids)');
        expect(source).to.include('assignment_publication_reference_drift');
        expect(source).to.include('classroom.layoutRevision !== seatPlan.layoutRevision');
        expect(source).to.include('layout.fingerprint !== seatPlan.layoutFingerprint');
        expect(source).to.include('endpointSeatBindingService.listClassroomBindings');
        expect(source).to.include("binding.status === 'active'");
        expect(source).to.include('examSeatAssignmentService.createRevision');
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
        expect(source).to.include('this.source(event, assignments[0].seatPlan.revision, false)');
        expect(source).to.include('latestPlanSource = await this.source(event, seatPlans[0].revision, false)');
        expect(source).to.include("? 'current'");
        expect(source).to.include(": 'layout-drift'");
        expect(source).to.include('else currentSource = latestPlanSource');
    });

    it('blocks event school changes after assignment facts and logs only stable IDs/counts/fingerprints', () => {
        expect(eventSource).to.include('examSeatAssignmentService.assertEventSchoolChangeAllowed(domainId, eventId)');
        const loggerCalls = source.match(/logger\.info\([\s\S]*?\);/g) || [];
        expect(loggerCalls.join('\n')).not.to.match(/realName|studentId/);
    });
});
