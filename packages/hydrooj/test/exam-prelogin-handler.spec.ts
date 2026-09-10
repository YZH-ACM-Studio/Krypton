import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const sourcePath = resolve(__dirname, '../src/handler/exam-prelogin.ts');

describe('P2.6 exam pre-login HTTP boundaries', () => {
    it('keeps manager, trusted-service, and callback routes narrow and separate', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin/prepare'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin/confirm'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-batches/:batchId'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-batches'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-latest'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-requests/:requestId'");
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-batches/:batchId/retry'");
        expect(source).to.include("'/api/vigil/exam-prelogin/material'");
        expect(source).to.include("'/api/vigil/exam-prelogin/redeem'");
        expect(source).to.include("'/api/vigil/exam-prelogin/projection'");
        expect(source).to.include("requireServiceToken(this, 'vigil')");
    });

    it('recomputes the immutable preparation and P2.9 workflow inside the event boundary before dispatch', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include('withExamEventBoundary(domainId, eventId');
        expect(source).to.include('getBatchByRequest(domainId, eventId, requestId)');
        expect(source).to.include("existing?.state === 'dispatched'");
        expect(source).to.include('loadExamPreloginWorkflow(current, assignmentRevision)');
        expect(source).to.include('currentWorkflow.preparation.fingerprint !== preparationFingerprint');
        expect(source).to.include('currentWorkflow.fingerprint !== workflowFingerprint');
        expect(source).to.include('currentWorkflow.hardErrorCount > 0');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).to.include('service.confirm');
        expect(source).to.include('service.resumeDispatching(existing)');
        expect(source).to.include('loadExamPreloginDispatchRecovery(current, existing)');
        expect(source).to.include('service.resumeDispatching(existing, recovery)');
        expect(source).to.include('validateExamPreloginRetryWorkflow');
    });

    it('does not require userbind student-management, re-assert canonical events, or create indexes on every request', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include('PERM.PERM_CREATE_EXAM_EVENT');
        expect(source).to.include('isExamInfrastructureAdmin(this.user)');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).not.to.include('PERM_USERBIND_MANAGE_STUDENTS');
        expect(source).not.to.include('assertCanonicalEvent');
        expect(source).not.to.include('ensureIndexes()');
    });

    it('exposes the P2.14 compatibility gate and applies it only before a new v2 batch is written', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include('v2WriterEnabled: isExamPreloginV2WriterEnabled()');
        expect(source).to.include('!existing && isExamSeatAssignmentV2(currentAssignment) && !isExamPreloginV2WriterEnabled()');
        expect(source).to.include("throw new ExamPreloginError('prelogin_v2_writer_disabled')");
        expect(source.indexOf("existing?.state === 'dispatched'")).to.be.lessThan(source.indexOf('prelogin_v2_writer_disabled'));
    });

    it('accepts exact request schemas and never writes ticket material to logs or oplog', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include("exactBody(this.request.body, ['assignmentRevision'])");
        expect(source).to.include(
            "exactBody(this.request.body, ['assignmentRevision', 'preparationFingerprint', 'requestId', 'workflowFingerprint'])",
        );
        expect(source).to.include("exactBody(this.request.body, ['expectedProjectionRevision', 'requestId', 'ticketIds'])");
        expect(source).to.include("exactBody(this.request.body, ['batchId', 'endpointId', 'ticketId'])");
        expect(source).to.include("exactBody(this.request.body, ['batchId', 'endpointId', 'requestId', 'ticket'])");
        const logCalls = source.match(/(?:logger\.(?:info|warn|error)|OplogModel\.log)\([\s\S]*?\);/g) || [];
        expect(logCalls.join('\n')).not.to.match(/material\.ticket|input\.ticket|\bticket\s*:/);
    });

    it('redeems only after current assignment, user and seat facts are revalidated', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include('validateExamPreloginTicketCurrent');
        expect(source).to.include('ticket_batch_mismatch');
        expect(source).to.include('getExamPreloginService().applyProjection');
    });

    it('translates teacher-facing HTTP errors into Chinese and keeps reason codes in logs', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include("throwExamTeacherValidationError('examPrelogin'");
        expect(source).to.include('logger.warn');
        expect(source).to.include('reason=%s');
        expect(source).not.to.include('Invalid request:');
        expect(source).not.to.include('localizedErrorText`Invalid request');
    });
});
