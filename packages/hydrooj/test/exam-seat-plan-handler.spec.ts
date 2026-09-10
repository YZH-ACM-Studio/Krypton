import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const source = readFileSync(resolve(__dirname, '../src/handler/exam-seat-plan.ts'), 'utf8');
const eventSource = readFileSync(resolve(__dirname, '../src/handler/exam-event.ts'), 'utf8');

describe('P2.4 roster and seat-plan HTTP boundary', () => {
    it('uses one narrow authenticated API and does not add the P2.5 page or allocation algorithm', () => {
        expect(source).to.include("'/api/admin/exam-events/:eventId/seat-plans'");
        expect(source).not.to.include('admin_exam_seats.html');
        expect(source).not.to.match(/shuffle|random|assignment/i);
        expect(source).not.to.include('setInterval');
    });

    it('re-reads authorization and event facts inside the shared ExamEvent boundary', () => {
        expect(source).to.include('withExamEventBoundary(domainId, eventId');
        expect(source).to.include('const current = await this.event(eventId)');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).to.include('PERM.PERM_USERBIND_MANAGE_STUDENTS');
        expect(source).not.to.include('ensureIndexes()');
        expect(source).to.include('this.assertWritableEvent(current)');
        expect(source).to.include("['krypton', 'external'].includes(event.type)");
        expect(source).to.include("['draft', 'scheduled', 'archived'].includes(event.lifecycle)");
    });

    it('keeps archived snapshots readable while rejecting new writes inside the event boundary', () => {
        const eventLoader = source.slice(source.indexOf('protected async event'), source.indexOf('protected assertWritableEvent'));
        const getHandler = source.slice(source.indexOf('async get('), source.indexOf("@param('action'"));
        expect(eventLoader).not.to.include("event.lifecycle === 'archived'");
        expect(getHandler).not.to.include('assertWritableEvent');
        expect(source.match(/this\.assertWritableEvent\(current\)/g)).to.have.length(2);
        expect(source).to.include("event.lifecycle === 'archived'");
    });

    it('accepts only exact v2 action bodies and keeps the legacy v1 writer fail closed', () => {
        expect(source).to.include("exactBody(this.request.body, ['action', 'groupIds', 'sourceKind'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'classroomIds', 'expectedPreviousRevision', 'rosterRevision'])");
        expect(source).not.to.include(
            "exactBody(this.request.body, ['action', 'candidateSeatIds', 'classroomId', 'layoutRevision', 'rosterRevision'])",
        );
        expect(source).to.include("throw new ExamSeatPlanError('seat_plan_v2_writer_required')");
    });

    it('creates v2 plans from an exact classroom set and the current layout/profile facts under CAS', () => {
        expect(source).to.include("exactBody(this.request.body, ['action', 'classroomIds', 'expectedPreviousRevision', 'rosterRevision'])");
        expect(source).to.include('new Set(classroomIds.map((id) => id.toHexString())).size !== classroomIds.length');
        expect(source).to.include('examSeatOperationalProfileService.getCurrent(domainId, selectedClassroomId)');
        expect(source).to.include('profile.layoutRevision !== classroom.layoutRevision');
        expect(source).to.include('profile.layoutFingerprint !== layout.fingerprint');
        expect(source).to.include("(await getExamContestAudienceState(current)) !== 'fixed'");
        expect(source).to.include("throw new ExamSeatPlanError('contest_audience_not_fixed')");
        expect(source).to.include('await assertExamContestAudienceRosterCurrent(current, roster)');
        expect(source).to.include('expectedPreviousRevision,');
        expect(source).to.include('examSeatPlanService.createSeatPlanV2');
        expect(source).to.include("requireRoster: current.type === 'krypton'");
        expect(source).to.match(/candidateSeatIds:\s*layout\.seats\.map\(\(seat\) => seat\.sourceSeatId\)\.sort\(\)/);
    });

    it('records revision, counts, diagnostics and fingerprints without student PII in operational logs', () => {
        expect(source).to.include("'exam.roster.create'");
        expect(source).to.include("'exam.seat_plan.create'");
        expect(source).to.include('includedCount: roster.counts.included');
        expect(source).to.include('excludedCount: roster.counts.excluded');
        expect(source).to.include('diagnosticCodes: plan.diagnostics.map');
        const loggerCalls = source.match(/logger\.info\([\s\S]*?\);/g) || [];
        expect(loggerCalls.join('\n')).not.to.match(/realName|studentId|boundUserId/);
    });

    it('blocks event school changes once immutable roster or plan facts exist', () => {
        expect(eventSource).to.include('examSeatPlanService.assertEventSchoolChangeAllowed(domainId, eventId)');
        expect(eventSource).to.include('examNetworkConfigService.assertEventSchoolChangeAllowed(domainId, eventId)');
    });

    it('translates teacher-facing HTTP errors into Chinese and keeps reason codes in logs', () => {
        expect(source).to.include("throwExamTeacherValidationError('examSeatPlan'");
        expect(source).to.include("throwExamTeacherValidationError('eventId', 'event_canonical_invalid')");
        expect(source).to.include("throwExamTeacherValidationError('eventId', 'event_archived')");
        expect(source).to.include('logger.warn(\'Exam seat plan rejected reason=%s\'');
        expect(source).not.to.include('Invalid request:');
    });

    it('lists historical roster and plan revisions from stored fields and only re-walks the latest plan layout', () => {
        const getHandler = source.slice(source.indexOf('async get('), source.indexOf("@param('action'"));
        expect(getHandler).not.to.include('for (const roster of rosters)');
        expect(getHandler).not.to.include('for (const plan of plans)');
        expect(getHandler).not.to.include('examClassroomService.get');
        expect(getHandler).to.include('const latestRoster = rosters[0]');
        expect(getHandler).to.include('const latestPlan = plans[0]');
        expect(getHandler).to.include('assertExamRosterRevisionIntegrity(latestRoster)');
        expect(getHandler).to.include('assertExamSeatPlanIntegrity(latestPlan)');
        expect(getHandler).to.include('await this.assertStoredSeatPlanReferences(event, latestPlan)');
        expect(getHandler).to.include('rosterRevisions: rosters.map((roster) => serializeRoster(roster, event.revision))');
        expect(getHandler).to.include('seatPlans: plans.map((plan) => serializePlan(plan, event.revision))');
        expect(source).to.include('examClassroomService.get(event.domainId, classroomRef.classroomId, true)');
        expect(source).to.include('examClassroomService.layout(classroom, classroomRef.layoutRevision)');
        expect(source).to.include('examSeatOperationalProfileService.getRevision');
        expect(source).to.include("throw new ExamSeatPlanError('seat_plan_layout_drift')");
        expect(source).to.include('examSeatOperationalProfileService.getCurrent(domainId, selectedClassroomId)');
    });
});
