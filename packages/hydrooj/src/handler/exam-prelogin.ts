import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, localizedErrorText, OplogModel, param, PermissionError, requireServiceToken, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { loadExamPreloginPreparation, validateExamPreloginTicketCurrent, validateExamPreloginTicketsCurrent } from '../model/exam-prelogin-loader';
import {
    ExamPreloginBatchDoc,
    ExamPreloginError,
    ExamPreloginPreparation,
    ExamPreloginProjection,
    ExamPreloginTicketDoc,
} from '../model/exam-prelogin';
import { examSeatAssignmentService } from '../model/exam-seat-assignment';
import { getExamPreloginService } from '../service/exam-prelogin';
import { parseVigilExamPreloginProjection, preflightExamPreloginOnVigil } from '../service/vigil-bridge';

const logger = new Logger('exam-prelogin');

function exactBody(value: unknown, keys: readonly string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('body');
    const body = value as Record<string, unknown>;
    const actual = Object.keys(body).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new ValidationError('body');
}

function assertCanonicalEvent(event: ExamEventDoc, domainId: string, eventId: ObjectId): void {
    if (
        event.domainId !== domainId ||
        !event._id.equals(eventId) ||
        !(event.schoolId instanceof ObjectId) ||
        !['external', 'krypton'].includes(event.type) ||
        !['archived', 'draft', 'scheduled'].includes(event.lifecycle) ||
        !(event.startAt instanceof Date) ||
        !Number.isFinite(event.startAt.getTime()) ||
        !(event.endAt instanceof Date) ||
        !Number.isFinite(event.endAt.getTime()) ||
        event.endAt <= event.startAt ||
        !Number.isSafeInteger(event.revision) ||
        event.revision < 1
    ) {
        throw new ExamPreloginError('event_canonical_invalid');
    }
}

function translate(error: unknown): never {
    if (error instanceof ExamPreloginError) {
        throw new ValidationError('examPrelogin', null, localizedErrorText`Invalid request: ${error.reason}`);
    }
    if (error instanceof TypeError) {
        throw new ValidationError('examPrelogin', null, localizedErrorText`Invalid request: ${error.message}`);
    }
    throw error;
}

function serializePreparation(preparation: ExamPreloginPreparation) {
    return {
        schemaVersion: preparation.schemaVersion,
        domainId: preparation.domainId,
        eventId: preparation.eventId.toHexString(),
        eventRevision: preparation.eventRevision,
        assignment: {
            assignmentId: preparation.assignment.assignmentId.toHexString(),
            revision: preparation.assignment.revision,
            fingerprint: preparation.assignment.fingerprint,
        },
        publicationRevision: preparation.publicationRevision,
        workspace: preparation.workspace,
        items: preparation.items.map((item) => ({
            uid: item.uid,
            studentRecordId: item.studentRecordId.toHexString(),
            sourceSeatId: item.sourceSeatId,
            bindingId: item.bindingId?.toHexString() || null,
            bindingRevision: item.bindingRevision,
            endpointId: item.endpointId,
            ready: item.ready,
            diagnostics: item.diagnostics.map((diagnostic) => ({ ...diagnostic })),
            endpoint: {
                ...item.endpoint,
                capabilities: item.endpoint.capabilities.map((capability) => ({ ...capability, commands: [...capability.commands] })),
            },
        })),
        hardErrorCount: preparation.hardErrorCount,
        warningCount: preparation.warningCount,
        fingerprint: preparation.fingerprint,
    };
}

function serializeProjection(projection: ExamPreloginProjection | null) {
    if (!projection) return null;
    return {
        ...projection,
        summary: { ...projection.summary },
        items: projection.items.map((item) => ({ ...item })),
    };
}

function serializeBatch(batch: ExamPreloginBatchDoc) {
    const retryableTicketIds = (batch.projection?.items || [])
        .filter((item) => item.status === 'expired' || item.status === 'failed' || item.status === 'offline' || item.status === 'rejected')
        .map((item) => item.ticketId)
        .sort();
    return {
        batchId: batch._id.toHexString(),
        eventId: batch.eventId.toHexString(),
        eventRevision: batch.eventRevision,
        assignment: {
            assignmentId: batch.assignment.assignmentId.toHexString(),
            revision: batch.assignment.revision,
            fingerprint: batch.assignment.fingerprint,
        },
        publicationRevision: batch.publicationRevision,
        requestId: batch.requestId,
        preparationFingerprint: batch.preparationFingerprint,
        state: batch.state,
        revision: batch.revision,
        ticketCount: batch.ticketIds.length,
        projection: serializeProjection(batch.projection),
        retryableTicketIds,
        createdAt: batch.createdAt.toISOString(),
        createdBy: batch.createdBy,
        updatedAt: batch.updatedAt.toISOString(),
        fingerprint: batch.fingerprint,
    };
}

function serializeRedemption(ticket: ExamPreloginTicketDoc) {
    if (ticket.state !== 'redeemed' || !ticket.redeemedAt) throw new ExamPreloginError('ticket_not_redeemed');
    return {
        ticketId: ticket._id.toHexString(),
        batchId: ticket.batchId.toHexString(),
        domainId: ticket.domainId,
        eventId: ticket.eventId.toHexString(),
        eventRevision: ticket.eventRevision,
        assignment: {
            assignmentId: ticket.assignment.assignmentId.toHexString(),
            revision: ticket.assignment.revision,
            fingerprint: ticket.assignment.fingerprint,
        },
        publicationRevision: ticket.publicationRevision,
        uid: ticket.uid,
        endpointId: ticket.endpointId,
        workspace: { ...ticket.workspace },
        redeemedAt: ticket.redeemedAt.toISOString(),
    };
}

abstract class ExamPreloginManagerHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user)) {
            if (!this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
            if (!this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
                throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
            }
        }
        await Promise.all([examEventService.ensureIndexes(), examSeatAssignmentService.ensureIndexes(), getExamPreloginService().ensureIndexes()]);
    }

    protected async event(eventId: ObjectId): Promise<ExamEventDoc> {
        const domainId = String(this.domain._id);
        const event = await examEventService.get(domainId, eventId);
        if (!event) throw new ValidationError('eventId');
        assertCanonicalEvent(event, domainId, eventId);
        await assertCanManageExamEvent(domainId, event, this.user);
        return event;
    }
}

class ExamPreloginPrepareHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('assignmentRevision', Types.PositiveInt)
    async post(_args: unknown, eventId: ObjectId, assignmentRevision: number) {
        exactBody(this.request.body, ['assignmentRevision']);
        try {
            const event = await this.event(eventId);
            const preparation = await loadExamPreloginPreparation(event, assignmentRevision, preflightExamPreloginOnVigil);
            this.response.body = { preparation: serializePreparation(preparation) };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginConfirmHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('assignmentRevision', Types.PositiveInt)
    @param('preparationFingerprint', Types.String)
    @param('requestId', Types.String)
    async post(_args: unknown, eventId: ObjectId, assignmentRevision: number, preparationFingerprint: string, requestId: string) {
        exactBody(this.request.body, ['assignmentRevision', 'preparationFingerprint', 'requestId']);
        const domainId = String(this.domain._id);
        try {
            const result = await withExamEventBoundary(domainId, eventId, async () => {
                const current = await this.event(eventId);
                const preparation = await loadExamPreloginPreparation(current, assignmentRevision, preflightExamPreloginOnVigil);
                if (preparation.fingerprint !== preparationFingerprint) throw new ExamPreloginError('preparation_fingerprint_changed');
                return getExamPreloginService().confirm({ preparation, requestId, actorUid: this.user._id });
            });
            await OplogModel.log(this, 'exam.prelogin.confirm', {
                eventId,
                batchId: result.batch._id,
                assignmentRevision,
                requestId,
                preparationFingerprint,
                ticketCount: result.batch.ticketIds.length,
                projectionRevision: result.projection.projectionRevision,
            });
            logger.info(
                'Exam pre-login dispatch accepted event=%s batch=%s request=%s items=%d projectionRevision=%d',
                eventId.toHexString(),
                result.batch._id.toHexString(),
                requestId,
                result.batch.ticketIds.length,
                result.projection.projectionRevision,
            );
            this.response.body = { batch: serializeBatch(result.batch) };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginBatchHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('batchId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId, batchId: ObjectId) {
        try {
            await this.event(eventId);
            const batch = await getExamPreloginService().getBatch(String(this.domain._id), eventId, batchId);
            if (!batch) throw new ValidationError('batchId');
            this.response.body = { batch: serializeBatch(batch) };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginRetryHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('batchId', Types.ObjectId)
    @param('expectedProjectionRevision', Types.PositiveInt)
    @param('requestId', Types.String)
    @param('ticketIds', Types.ArrayOf(Types.ObjectId))
    async post(_args: unknown, eventId: ObjectId, batchId: ObjectId, expectedProjectionRevision: number, requestId: string, ticketIds: ObjectId[]) {
        exactBody(this.request.body, ['expectedProjectionRevision', 'requestId', 'ticketIds']);
        const domainId = String(this.domain._id);
        try {
            const result = await withExamEventBoundary(domainId, eventId, async () => {
                const current = await this.event(eventId);
                const service = getExamPreloginService();
                const batch = await service.getBatch(domainId, eventId, batchId);
                if (!batch) throw new ExamPreloginError('batch_not_found');
                return service.retry({
                    domainId,
                    eventId,
                    batchId,
                    expectedProjectionRevision,
                    requestId,
                    actorUid: this.user._id,
                    ticketIds,
                    validateCurrent: (tickets) => validateExamPreloginTicketsCurrent(current, tickets, preflightExamPreloginOnVigil),
                });
            });
            await OplogModel.log(this, 'exam.prelogin.retry', {
                eventId,
                batchId,
                requestId,
                expectedProjectionRevision,
                ticketIds: result.ticketIds,
                projectionRevision: result.projection.projectionRevision,
            });
            logger.info(
                'Exam pre-login retry accepted event=%s batch=%s request=%s items=%d projectionRevision=%d',
                eventId.toHexString(),
                batchId.toHexString(),
                requestId,
                result.ticketIds.length,
                result.projection.projectionRevision,
            );
            this.response.body = { batch: serializeBatch(result.batch) };
        } catch (error) {
            translate(error);
        }
    }
}

abstract class VigilExamPreloginHandler extends Handler {
    noCheckPermView = true;

    async prepare() {
        requireServiceToken(this, 'vigil');
        await getExamPreloginService().ensureIndexes();
    }
}

class VigilExamPreloginMaterialHandler extends VigilExamPreloginHandler {
    @param('batchId', Types.ObjectId)
    @param('endpointId', Types.String)
    @param('ticketId', Types.ObjectId)
    async post(_args: unknown, batchId: ObjectId, endpointId: string, ticketId: ObjectId) {
        exactBody(this.request.body, ['batchId', 'endpointId', 'ticketId']);
        try {
            const material = await getExamPreloginService().materialize({ batchId, ticketId, endpointId });
            this.response.addHeader('Cache-Control', 'no-store');
            logger.info('Exam pre-login material issued batch=%s ticketId=%s endpoint=%s', batchId.toHexString(), ticketId.toHexString(), endpointId);
            this.response.body = { ticket: material.ticket, expiresAt: material.expiresAt.toISOString() };
        } catch (error) {
            translate(error);
        }
    }
}

class VigilExamPreloginRedeemHandler extends VigilExamPreloginHandler {
    @param('batchId', Types.ObjectId)
    @param('endpointId', Types.String)
    @param('requestId', Types.String)
    @param('ticket', Types.String)
    async post(_args: unknown, batchId: ObjectId, endpointId: string, requestId: string, ticket: string) {
        exactBody(this.request.body, ['batchId', 'endpointId', 'requestId', 'ticket']);
        try {
            const service = getExamPreloginService();
            const redeemed = await service.redeem({
                ticket,
                batchId,
                endpointId,
                requestId,
                validateCurrent: async (currentTicket) => {
                    if (!currentTicket.batchId.equals(batchId)) throw new ExamPreloginError('ticket_batch_mismatch');
                    const batch = await service.getBatch(currentTicket.domainId, currentTicket.eventId, currentTicket.batchId);
                    if (!batch || !batch.ticketIds.some((ticketId) => ticketId.equals(currentTicket._id))) {
                        throw new ExamPreloginError('ticket_batch_mismatch');
                    }
                    await withExamEventBoundary(currentTicket.domainId, currentTicket.eventId, async () => {
                        const current = await examEventService.get(currentTicket.domainId, currentTicket.eventId);
                        if (!current) throw new ExamPreloginError('event_not_found');
                        assertCanonicalEvent(current, currentTicket.domainId, currentTicket.eventId);
                        await validateExamPreloginTicketCurrent(current, currentTicket, batch.preparationFingerprint, preflightExamPreloginOnVigil);
                    });
                },
            });
            logger.info(
                'Exam pre-login ticket redeemed batch=%s ticketId=%s endpoint=%s request=%s',
                batchId.toHexString(),
                redeemed._id.toHexString(),
                endpointId,
                requestId,
            );
            this.response.body = { redemption: serializeRedemption(redeemed), requestId };
        } catch (error) {
            translate(error);
        }
    }
}

class VigilExamPreloginProjectionHandler extends VigilExamPreloginHandler {
    async post() {
        let projection: ExamPreloginProjection;
        try {
            projection = parseVigilExamPreloginProjection(this.request.body);
            const batchId = new ObjectId(projection.batchId);
            const batch = await getExamPreloginService().getBatchById(batchId);
            if (!batch) throw new ExamPreloginError('batch_not_found');
            const result = await getExamPreloginService().applyProjection(batch.domainId, batch.eventId, batchId, projection);
            logger.info(
                'Exam pre-login projection received batch=%s request=%s revision=%d changed=%s',
                projection.batchId,
                projection.requestId,
                projection.projectionRevision,
                result.changed,
            );
            this.response.body = { ok: true, changed: result.changed };
        } catch (error) {
            translate(error);
        }
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_prelogin_prepare', '/api/admin/exam-events/:eventId/prelogin/prepare', ExamPreloginPrepareHandler);
    ctx.Route('exam_prelogin_confirm', '/api/admin/exam-events/:eventId/prelogin/confirm', ExamPreloginConfirmHandler);
    ctx.Route('exam_prelogin_batch', '/api/admin/exam-events/:eventId/prelogin-batches/:batchId', ExamPreloginBatchHandler);
    ctx.Route('exam_prelogin_retry', '/api/admin/exam-events/:eventId/prelogin-batches/:batchId/retry', ExamPreloginRetryHandler);
    ctx.Route('vigil_exam_prelogin_material', '/api/vigil/exam-prelogin/material', VigilExamPreloginMaterialHandler);
    ctx.Route('vigil_exam_prelogin_redeem', '/api/vigil/exam-prelogin/redeem', VigilExamPreloginRedeemHandler);
    ctx.Route('vigil_exam_prelogin_projection', '/api/vigil/exam-prelogin/projection', VigilExamPreloginProjectionHandler);
}
