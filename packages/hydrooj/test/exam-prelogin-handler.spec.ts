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
        expect(source).to.include("'/api/admin/exam-events/:eventId/prelogin-batches/:batchId/retry'");
        expect(source).to.include("'/api/vigil/exam-prelogin/material'");
        expect(source).to.include("'/api/vigil/exam-prelogin/redeem'");
        expect(source).to.include("'/api/vigil/exam-prelogin/projection'");
        expect(source).to.include("requireServiceToken(this, 'vigil')");
    });

    it('recomputes the immutable preparation inside the event boundary before dispatch', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include('withExamEventBoundary(domainId, eventId');
        expect(source).to.include('loadExamPreloginPreparation(current, assignmentRevision, preflightExamPreloginOnVigil)');
        expect(source).to.include('preparation.fingerprint !== preparationFingerprint');
        expect(source).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(source).to.include('getExamPreloginService().confirm');
    });

    it('accepts exact request schemas and never writes ticket material to logs or oplog', () => {
        const source = readFileSync(sourcePath, 'utf8');
        expect(source).to.include("exactBody(this.request.body, ['assignmentRevision'])");
        expect(source).to.include("exactBody(this.request.body, ['assignmentRevision', 'preparationFingerprint', 'requestId'])");
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
});
