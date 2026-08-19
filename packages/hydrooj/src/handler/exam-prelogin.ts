import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, OplogModel, param, PermissionError, requireServiceToken, Types, ValidationError } from 'hydrooj';
import { throwExamTeacherValidationError } from '../lib/exam-teacher-http-error';
import { PERM } from '../model/builtin';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { ExamNetworkConfigError } from '../model/exam-network-config';
import {
    ExamPreloginRetryReadinessError,
    loadExamPreloginDispatchRecovery,
    validateExamPreloginTicketCurrent,
    validateExamPreloginTicketsCurrent,
} from '../model/exam-prelogin-loader';
import { ExamPreloginWorkflowSnapshot, loadExamPreloginWorkflow, validateExamPreloginRetryWorkflow } from '../model/exam-prelogin-workflow';
import {
    ExamPreloginBatchDoc,
    ExamPreloginError,
    ExamPreloginPreparation,
    ExamPreloginProjection,
    ExamPreloginTicketDoc,
    ExamPreloginWorkflowBinding,
} from '../model/exam-prelogin';
import { examSeatAssignmentService, isExamSeatAssignmentV2 } from '../model/exam-seat-assignment';
import { ExamSeatAssignmentReadinessError } from '../model/exam-seat-assignment-readiness';
import { getExamPreloginService, isExamPreloginV2WriterEnabled, isExamPreloginWorkflowWriterEnabled } from '../service/exam-prelogin';
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
    if (error instanceof ExamPreloginRetryReadinessError) {
        const reasonCounts = new Map<string, number>();
        for (const failure of error.failures) {
            for (const diagnostic of failure.diagnostics) reasonCounts.set(diagnostic, (reasonCounts.get(diagnostic) ?? 0) + 1);
        }
        const reasons = [...reasonCounts]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([reason, count]) => `${reason}=${count}`)
            .join(',');
        const sample = JSON.stringify(error.failures.slice(0, 50));
        logger.warn(
            'Exam prelogin retry readiness rejected event=%s batch=%s total=%d reasons=%s items=%s',
            error.eventId,
            error.batchId,
            error.failures.length,
            reasons,
            sample,
        );
        throwExamTeacherValidationError('examPrelogin', `${error.reason}:${reasons}`);
    }
    if (error instanceof ExamSeatAssignmentReadinessError) {
        logger.warn(
            'Exam prelogin readiness rejected event=%s assignment=%s stage=%s reason=%s classroom=%s seat=%s uid=%s',
            error.eventId,
            error.assignmentId,
            error.stage,
            error.reason,
            error.detail.classroomId ?? '-',
            error.detail.sourceSeatId ?? '-',
            error.detail.uid ?? '-',
        );
        const location = [error.detail.classroomId, error.detail.sourceSeatId].filter(Boolean).join('/');
        const detail = [error.stage, location || null, error.detail.uid ? `uid=${error.detail.uid}` : null].filter(Boolean).join(':');
        throwExamTeacherValidationError('examPrelogin', `${error.reason}:${detail}`);
    }
    if (error instanceof ExamPreloginError || error instanceof ExamNetworkConfigError) {
        logger.warn('Exam prelogin rejected reason=%s', error.reason);
        throwExamTeacherValidationError('examPrelogin', error.reason);
    }
    if (error instanceof TypeError) {
        logger.warn('Exam prelogin rejected reason=%s', error.message);
        throwExamTeacherValidationError('examPrelogin', error.message);
    }
    throw error;
}

function serializeRevisionRef(reference: ExamPreloginWorkflowSnapshot['network']['policy']) {
    return { id: reference.id.toHexString(), revision: reference.revision, fingerprint: reference.fingerprint };
}

function workflowBinding(workflow: ExamPreloginWorkflowSnapshot): ExamPreloginWorkflowBinding {
    return {
        fingerprint: workflow.fingerprint,
        executionRevision: workflow.network.executionRevision,
        policy: { ...workflow.network.policy, id: new ObjectId(workflow.network.policy.id) },
        target: { ...workflow.network.target, id: new ObjectId(workflow.network.target.id) },
        targetCount: workflow.network.targetCount,
        startAt: new Date(workflow.network.startAt),
        hardEndAt: new Date(workflow.network.hardEndAt),
    };
}

function serializeWorkflowBinding(binding: ExamPreloginWorkflowBinding) {
    return {
        fingerprint: binding.fingerprint,
        executionRevision: binding.executionRevision,
        policy: serializeRevisionRef(binding.policy),
        target: serializeRevisionRef(binding.target),
        targetCount: binding.targetCount,
        startAt: binding.startAt.toISOString(),
        hardEndAt: binding.hardEndAt.toISOString(),
    };
}

function serializeWorkflow(workflow: ExamPreloginWorkflowSnapshot) {
    return {
        schemaVersion: workflow.schemaVersion,
        network: {
            source: workflow.network.source,
            configRevision: workflow.network.configRevision,
            executionRevision: workflow.network.executionRevision,
            policy: serializeRevisionRef(workflow.network.policy),
            target: serializeRevisionRef(workflow.network.target),
            targetCount: workflow.network.targetCount,
            startAt: workflow.network.startAt.toISOString(),
            hardEndAt: workflow.network.hardEndAt.toISOString(),
            ready: workflow.network.ready,
            reason: workflow.network.reason,
            appliedCount: workflow.network.appliedCount,
            failedCount: workflow.network.failedCount,
            pendingCount: workflow.network.pendingCount,
            preloginEndpointCount: workflow.network.preloginEndpointCount,
            coveredPreloginCount: workflow.network.coveredPreloginCount,
            missingPreloginEndpointIds: [...workflow.network.missingPreloginEndpointIds],
        },
        monitoring: {
            ready: workflow.monitoring.ready,
            items: workflow.monitoring.items.map((item) => ({
                endpointId: item.endpointId,
                ready: item.ready,
                reason: item.reason,
                credentialStatus: item.credentialStatus,
                online: item.online,
                compatible: item.compatible,
                serviceVersion: item.serviceVersion,
                protocolVersion: item.protocolVersion,
                capabilities: item.capabilities.map((capability) => ({ ...capability, commands: [...capability.commands] })),
                warnings: item.warnings.map((warning) => ({ ...warning })),
            })),
        },
        hardErrorCount: workflow.hardErrorCount,
        warningCount: workflow.warningCount,
        fingerprint: workflow.fingerprint,
    };
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

async function serializeBatch(batch: ExamPreloginBatchDoc) {
    const tickets = await getExamPreloginService().listBatchTickets(batch);
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
        workflow: batch.workflow ? serializeWorkflowBinding(batch.workflow) : null,
        state: batch.state,
        revision: batch.revision,
        ticketCount: batch.ticketIds.length,
        subjects: tickets.map((ticket) => ({
            ticketId: ticket._id.toHexString(),
            uid: ticket.uid,
            studentRecordId: ticket.studentRecordId.toHexString(),
            sourceSeatId: ticket.sourceSeatId,
            bindingId: ticket.bindingId.toHexString(),
            bindingRevision: ticket.bindingRevision,
            endpointId: ticket.endpointId,
            expiresAt: ticket.expiresAt.toISOString(),
            state: ticket.state,
            redeemedAt: ticket.redeemedAt?.toISOString() || null,
        })),
        projection: serializeProjection(batch.projection),
        retryableTicketIds,
        createdAt: batch.createdAt.toISOString(),
        createdBy: batch.createdBy,
        updatedAt: batch.updatedAt.toISOString(),
        fingerprint: batch.fingerprint,
    };
}

async function serializeRedemption(ticket: ExamPreloginTicketDoc) {
    if (ticket.state !== 'redeemed' || !ticket.redeemedAt) throw new ExamPreloginError('ticket_not_redeemed');
    const userbind = (global as { Hydro?: { model?: { userbind?: { findStudentByUserId?: (domainId: string, uid: number) => Promise<unknown> } } } }).Hydro?.model?.userbind;
    if (!userbind || typeof userbind.findStudentByUserId !== 'function') {
        throw new ExamPreloginError('userbind_student_resolver_unavailable');
    }
    const student = await userbind.findStudentByUserId(ticket.domainId, ticket.uid) as {
        _id?: unknown;
        boundUserId?: unknown;
        studentId?: unknown;
        realName?: unknown;
    } | null;
    if (
        !student
        || student.boundUserId !== ticket.uid
        || !(student._id instanceof ObjectId)
        || !student._id.equals(ticket.studentRecordId)
    ) {
        throw new ExamPreloginError('student_record_mismatch');
    }
    const studentId = typeof student.studentId === 'string' ? student.studentId.trim() : '';
    const realName = typeof student.realName === 'string' ? student.realName.trim() : '';
    if (!studentId || !realName) throw new ExamPreloginError('student_identity_missing');
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
        studentId,
        realName,
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
            const workflow = await loadExamPreloginWorkflow(event, assignmentRevision);
            this.response.body = {
                preparation: serializePreparation(workflow.preparation),
                workflow: serializeWorkflow(workflow),
                v2WriterEnabled: isExamPreloginV2WriterEnabled(),
                workflowWriterEnabled: isExamPreloginWorkflowWriterEnabled(),
            };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginConfirmHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('assignmentRevision', Types.PositiveInt)
    @param('preparationFingerprint', Types.String)
    @param('workflowFingerprint', Types.String)
    @param('requestId', Types.String)
    async post(
        _args: unknown,
        eventId: ObjectId,
        assignmentRevision: number,
        preparationFingerprint: string,
        workflowFingerprint: string,
        requestId: string,
    ) {
        exactBody(this.request.body, ['assignmentRevision', 'preparationFingerprint', 'requestId', 'workflowFingerprint']);
        const domainId = String(this.domain._id);
        try {
            const { mode, result, workflow } = await withExamEventBoundary(domainId, eventId, async () => {
                const current = await this.event(eventId);
                const service = getExamPreloginService();
                const existing = await service.getBatchByRequest(domainId, eventId, requestId);
                if (existing?.state === 'dispatched') {
                    if (
                        existing.assignment.revision !== assignmentRevision ||
                        existing.preparationFingerprint !== preparationFingerprint ||
                        !existing.workflow ||
                        existing.workflow.fingerprint !== workflowFingerprint ||
                        !existing.projection
                    ) {
                        throw new ExamPreloginError('request_id_conflict');
                    }
                    return { mode: 'replayed' as const, result: { batch: existing, projection: existing.projection }, workflow: null };
                }
                if (existing?.state === 'dispatching') {
                    if (
                        existing.assignment.revision !== assignmentRevision ||
                        existing.preparationFingerprint !== preparationFingerprint ||
                        !existing.workflow ||
                        existing.workflow.fingerprint !== workflowFingerprint
                    ) {
                        throw new ExamPreloginError('request_id_conflict');
                    }
                    const tickets = await service.listBatchTickets(existing);
                    if (tickets.length === existing.ticketIds.length) {
                        return { mode: 'recovered' as const, result: await service.resumeDispatching(existing), workflow: null };
                    }
                    const recovery = await loadExamPreloginDispatchRecovery(current, existing);
                    if (recovery) {
                        return { mode: 'recovered' as const, result: await service.resumeDispatching(existing, recovery), workflow: null };
                    }
                }
                if (!existing && !isExamPreloginWorkflowWriterEnabled()) throw new ExamPreloginError('workflow_writer_disabled');
                const currentWorkflow = await loadExamPreloginWorkflow(current, assignmentRevision);
                const currentAssignment = await examSeatAssignmentService.getRevision(domainId, eventId, assignmentRevision);
                if (!currentAssignment) throw new ExamPreloginError('assignment_not_found');
                if (!existing && isExamSeatAssignmentV2(currentAssignment) && !isExamPreloginV2WriterEnabled()) {
                    throw new ExamPreloginError('prelogin_v2_writer_disabled');
                }
                if (currentWorkflow.preparation.fingerprint !== preparationFingerprint) {
                    throw new ExamPreloginError('preparation_fingerprint_changed');
                }
                if (currentWorkflow.fingerprint !== workflowFingerprint) throw new ExamPreloginError('workflow_fingerprint_changed');
                if (currentWorkflow.network.source !== 'execution' || !currentWorkflow.network.ready) {
                    throw new ExamPreloginError('network_execution_not_ready');
                }
                if (currentWorkflow.hardErrorCount > 0) throw new ExamPreloginError('workflow_not_ready');
                return {
                    mode: 'created' as const,
                    result: await service.confirm({
                        preparation: currentWorkflow.preparation,
                        workflow: workflowBinding(currentWorkflow),
                        requestId,
                        actorUid: this.user._id,
                    }),
                    workflow: currentWorkflow,
                };
            });
            if (mode === 'created' && workflow) {
                await OplogModel.log(this, 'exam.prelogin.confirm', {
                    eventId,
                    batchId: result.batch._id,
                    assignmentRevision,
                    requestId,
                    preparationFingerprint,
                    workflowFingerprint,
                    network: {
                        source: workflow.network.source,
                        configRevision: workflow.network.configRevision,
                        executionRevision: workflow.network.executionRevision,
                        policy: serializeRevisionRef(workflow.network.policy),
                        target: serializeRevisionRef(workflow.network.target),
                        hardEndAt: workflow.network.hardEndAt,
                    },
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
            } else if (mode === 'recovered') {
                await OplogModel.log(this, 'exam.prelogin.confirm.recovery', {
                    eventId,
                    batchId: result.batch._id,
                    requestId,
                    canonicalActorUid: result.batch.createdBy,
                    recoveryActorUid: this.user._id,
                    projectionRevision: result.projection.projectionRevision,
                });
                logger.info(
                    'Exam pre-login dispatch recovered event=%s batch=%s request=%s projectionRevision=%d',
                    eventId.toHexString(),
                    result.batch._id.toHexString(),
                    requestId,
                    result.projection.projectionRevision,
                );
            }
            this.response.body = { batch: await serializeBatch(result.batch) };
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
            this.response.body = { batch: await serializeBatch(batch) };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginRequestHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    @param('requestId', Types.String)
    async get(_args: unknown, eventId: ObjectId, requestId: string) {
        try {
            await this.event(eventId);
            const batch = await getExamPreloginService().getBatchByRequest(String(this.domain._id), eventId, requestId);
            this.response.body = { batch: batch ? await serializeBatch(batch) : null };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginLatestHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        try {
            await this.event(eventId);
            const batch = await getExamPreloginService().getLatestBatch(String(this.domain._id), eventId);
            this.response.body = { batch: batch ? await serializeBatch(batch) : null };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamPreloginBatchCollectionHandler extends ExamPreloginManagerHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        try {
            await this.event(eventId);
            const batches = await getExamPreloginService().listBatches(String(this.domain._id), eventId);
            this.response.body = { batches: await Promise.all(batches.map(serializeBatch)) };
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
                    validateCurrent: async (tickets) => {
                        if (batch.workflow) {
                            await validateExamPreloginRetryWorkflow(
                                current,
                                batch.workflow,
                                tickets.map((ticket) => ticket.endpointId),
                            );
                        }
                        return validateExamPreloginTicketsCurrent(current, tickets, preflightExamPreloginOnVigil);
                    },
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
            this.response.body = { batch: await serializeBatch(result.batch) };
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
            this.response.body = { redemption: await serializeRedemption(redeemed), requestId };
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
    ctx.Route('exam_prelogin_batches', '/api/admin/exam-events/:eventId/prelogin-batches', ExamPreloginBatchCollectionHandler);
    ctx.Route('exam_prelogin_latest', '/api/admin/exam-events/:eventId/prelogin-latest', ExamPreloginLatestHandler);
    ctx.Route('exam_prelogin_request', '/api/admin/exam-events/:eventId/prelogin-requests/:requestId', ExamPreloginRequestHandler);
    ctx.Route('exam_prelogin_retry', '/api/admin/exam-events/:eventId/prelogin-batches/:batchId/retry', ExamPreloginRetryHandler);
    ctx.Route('vigil_exam_prelogin_material', '/api/vigil/exam-prelogin/material', VigilExamPreloginMaterialHandler);
    ctx.Route('vigil_exam_prelogin_redeem', '/api/vigil/exam-prelogin/redeem', VigilExamPreloginRedeemHandler);
    ctx.Route('vigil_exam_prelogin_projection', '/api/vigil/exam-prelogin/projection', VigilExamPreloginProjectionHandler);
}
