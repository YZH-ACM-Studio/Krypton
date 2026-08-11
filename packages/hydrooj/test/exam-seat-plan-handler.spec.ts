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

    it('accepts only exact action-specific bodies and validates current classroom/layout/seat references', () => {
        expect(source).to.include("exactBody(this.request.body, ['action', 'groupIds', 'sourceKind'])");
        expect(source).to.include("exactBody(this.request.body, ['action', 'candidateSeatIds', 'classroomId', 'layoutRevision', 'rosterRevision'])");
        expect(source).to.include('classroom.layoutRevision !== layoutRevision');
        expect(source).to.include("throw new ExamSeatPlanError('candidate_seat_missing')");
        expect(source).to.include("requireRoster: current.type === 'krypton'");
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
});
