import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, OplogModel, param, PermissionError, requireServiceToken, Types, ValidationError } from 'hydrooj';
import type { ExamClassroomDoc } from '../lib/classsignin-classroom-migration';
import { PERM } from '../model/builtin';
import { examClassroomService } from '../model/exam-classroom';
import { isExamInfrastructureAdmin } from '../model/exam-event-access';
import { preflightExamNetworkOnVigil } from '../service/vigil-bridge';
import {
    EndpointSeatBindingDoc,
    EndpointSeatBindingError,
    EndpointSeatPairingRedemption,
    EndpointSeatPairingWindowDoc,
    EndpointSeatReferenceFact,
    endpointSeatBindingService,
} from '../model/endpoint-seat-binding';

const logger = new Logger('endpoint-seat-binding');

function exactBody(value: unknown, keys: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('body');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) {
        throw new ValidationError('body');
    }
}

function parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) throw new ValidationError(field);
    return date;
}

function serializeReference(reference: EndpointSeatReferenceFact) {
    return {
        kind: reference.kind,
        endpointId: reference.endpointId,
        eventId: reference.eventId.toHexString(),
        eventTitle: reference.eventTitle,
        eventState: reference.eventState,
        startAt: reference.startAt.toISOString(),
        endAt: reference.endAt.toISOString(),
        targetId: reference.targetId.toHexString(),
        targetRevision: reference.targetRevision,
        targetFingerprint: reference.targetFingerprint,
    };
}

function serializeHistory(entry: EndpointSeatBindingDoc['history'][number]) {
    return {
        revision: entry.revision,
        action: entry.action,
        requestId: entry.requestId,
        actorUid: entry.actorUid,
        at: entry.at.toISOString(),
        endpointId: entry.action === 'unbind' ? null : entry.endpointId,
        previousEndpointId: entry.action === 'bind' ? null : entry.previousEndpointId,
        pairingWindowId: entry.action === 'unbind' ? null : entry.pairingWindowId.toHexString(),
        endpointRequestId: entry.action === 'replace' ? entry.endpointRequestId : null,
        referenceFingerprint: entry.action === 'bind' ? null : entry.referenceFingerprint,
    };
}

function serializeBinding(binding: EndpointSeatBindingDoc) {
    return {
        bindingId: binding._id.toHexString(),
        domainId: binding.domainId,
        schoolId: binding.schoolId.toHexString(),
        classroomId: binding.classroomId.toHexString(),
        sourceSeatId: binding.sourceSeatId,
        status: binding.status,
        endpointId: binding.endpointId || null,
        revision: binding.revision,
        history: binding.history.map(serializeHistory),
        createdBy: binding.createdBy,
        createdAt: binding.createdAt.toISOString(),
        updatedBy: binding.updatedBy,
        updatedAt: binding.updatedAt.toISOString(),
    };
}

function serializeWindow(window: EndpointSeatPairingWindowDoc) {
    return {
        windowId: window.windowId.toHexString(),
        domainId: window.domainId,
        schoolId: window.schoolId.toHexString(),
        classroomId: window.classroomId.toHexString(),
        status: window.status,
        revision: window.revision,
        requestId: window.requestId,
        expiresAt: window.expiresAt.toISOString(),
        entries: window.entries.map((entry) => ({
            sourceSeatId: entry.sourceSeatId,
            mode: entry.mode,
            status: entry.status,
            revision: entry.revision,
            codeHint: entry.codeHint,
            expectedBindingRevision: entry.expectedBindingRevision,
            claimedEndpointId: entry.claimedEndpointId || null,
            claimRequestId: entry.claimRequestId || null,
            claimedAt: entry.claimedAt?.toISOString() || null,
            bindingRevision: entry.bindingRevision || null,
            completedAt: entry.completedAt?.toISOString() || null,
            decisionRequestId: entry.decisionRequestId || null,
            decidedBy: entry.decidedBy || null,
        })),
        createdBy: window.createdBy,
        createdAt: window.createdAt.toISOString(),
        updatedActor: { ...window.updatedActor },
        updatedAt: window.updatedAt.toISOString(),
        closedBy: window.closedBy || null,
        closedAt: window.closedAt?.toISOString() || null,
        closedRequestId: window.closedRequestId || null,
    };
}

function serializeRedemption(result: EndpointSeatPairingRedemption) {
    if (result.status === 'bound') {
        return {
            status: result.status,
            bindingId: result.binding._id.toHexString(),
            classroomId: result.binding.classroomId.toHexString(),
            sourceSeatId: result.binding.sourceSeatId,
            bindingRevision: result.binding.revision,
            entryRevision: result.entryRevision,
        };
    }
    return {
        status: result.status,
        windowId: result.windowId.toHexString(),
        classroomId: result.classroomId.toHexString(),
        sourceSeatId: result.sourceSeatId,
        entryRevision: result.entryRevision,
    };
}

function serializeLayout(classroom: ExamClassroomDoc) {
    const layout = examClassroomService.layout(classroom, classroom.layoutRevision).snapshot;
    return {
        schemaVersion: layout.schemaVersion,
        sourceFormat: layout.sourceFormat,
        coordinateSystem: layout.coordinateSystem,
        rows: layout.rows || null,
        cols: layout.cols || null,
        fingerprint: layout.fingerprint,
        seats: layout.seats.map((seat) => ({ ...seat })),
        decorations: layout.decorations.map((decoration) => ({ ...decoration })),
    };
}

function errorStatus(reason: string): number {
    if (reason.endsWith('_invalid') || reason === 'pairing_code_invalid' || reason === 'request_invalid') return 400;
    if (reason === 'pairing_code_expired') return 410;
    if (reason === 'domain_not_found' || reason === 'seat_not_found' || reason === 'pairing_window_not_found' || reason === 'endpoint_not_owned') {
        return 404;
    }
    if (reason === 'endpoint_domain_mismatch' || reason === 'cross_school_endpoint') return 403;
    return 409;
}

function translate(error: unknown): never {
    if (!(error instanceof EndpointSeatBindingError)) throw error;
    throw new ValidationError('endpointSeatBinding', null, error.reason);
}

abstract class EndpointSeatAdminHandler extends Handler {
    async prepare() {
        if (!this.user || !isExamInfrastructureAdmin(this.user)) throw new PermissionError(PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE);
        await Promise.all([endpointSeatBindingService.ensureIndexes(), examClassroomService.ensureIndexes()]);
    }

    protected async classroom(classroomId: ObjectId) {
        const classroom = await examClassroomService.get(String(this.domain._id), classroomId);
        if (!classroom) throw new ValidationError('classroomId');
        return classroom;
    }
}

class EndpointSeatClassroomStateHandler extends EndpointSeatAdminHandler {
    @param('classroomId', Types.ObjectId)
    async get(_args: unknown, classroomId: ObjectId) {
        const classroom = await this.classroom(classroomId);
        const state = await endpointSeatBindingService.getClassroomState(String(this.domain._id), classroomId);
        const endpointIds = state.bindings
            .filter((binding) => binding.status === 'active' && binding.endpointId)
            .map((binding) => binding.endpointId!)
            .sort();
        let endpointPreflight: {
            state: 'available' | 'not-required' | 'unavailable';
            items: Awaited<ReturnType<typeof preflightExamNetworkOnVigil>>;
        };
        if (!endpointIds.length) endpointPreflight = { state: 'not-required', items: [] };
        else {
            try {
                endpointPreflight = { state: 'available', items: await preflightExamNetworkOnVigil(endpointIds) };
            } catch (error) {
                logger.warn(
                    'Endpoint seat live status unavailable classroom=%s stage=preflight reason=%s',
                    classroomId.toHexString(),
                    error instanceof Error ? error.message : 'unknown_error',
                );
                endpointPreflight = { state: 'unavailable', items: [] };
            }
        }
        this.response.body = {
            classroom: {
                classroomId: classroom._id.toHexString(),
                schoolId: classroom.schoolId.toHexString(),
                name: classroom.name,
                layoutRevision: classroom.layoutRevision,
                layout: serializeLayout(classroom),
            },
            bindings: state.bindings.map(serializeBinding),
            pairingWindow: state.pairingWindow ? serializeWindow(state.pairingWindow) : null,
            references: state.references.map(serializeReference),
            endpointPreflight,
        };
    }
}

class EndpointSeatClassroomCollectionHandler extends EndpointSeatAdminHandler {
    async get() {
        const classrooms = await examClassroomService.listDomain(String(this.domain._id), false, 500).toArray();
        this.response.body = {
            classrooms: classrooms.map((classroom) => ({
                classroomId: classroom._id.toHexString(),
                schoolId: classroom.schoolId.toHexString(),
                name: classroom.name,
                layoutRevision: classroom.layoutRevision,
                seatCount: examClassroomService.layout(classroom, classroom.layoutRevision).snapshot.seats.length,
            })),
        };
    }
}

class EndpointSeatClassroomPageHandler extends EndpointSeatAdminHandler {
    @param('classroomId', Types.ObjectId)
    async get(_args: unknown, classroomId: ObjectId) {
        await this.classroom(classroomId);
        this.response.template = 'admin_exam_classroom.html';
        this.response.body = { classroomId: classroomId.toHexString() };
    }
}

class EndpointSeatPairingWindowHandler extends EndpointSeatAdminHandler {
    @param('classroomId', Types.ObjectId)
    @param('action', Types.Range(['open', 'close']))
    @param('expectedRevision', Types.UnsignedInt)
    @param('requestId', Types.String)
    @param('expiresAt', Types.String, true)
    @param('sourceSeatIds', Types.ArrayOf(Types.String), true)
    @param('replacementSeatIds', Types.ArrayOf(Types.String), true)
    async post(
        _args: unknown,
        classroomId: ObjectId,
        action: 'open' | 'close',
        expectedRevision: number,
        requestId: string,
        expiresAt = '',
        sourceSeatIds: string[] = [],
        replacementSeatIds: string[] = [],
    ) {
        await this.classroom(classroomId);
        try {
            if (action === 'open') {
                exactBody(this.request.body, ['action', 'expectedRevision', 'expiresAt', 'replacementSeatIds', 'requestId', 'sourceSeatIds']);
                const opened = await endpointSeatBindingService.openPairingWindow({
                    domainId: String(this.domain._id),
                    classroomId,
                    sourceSeatIds,
                    replacementSeatIds,
                    expectedRevision,
                    requestId,
                    actorUid: this.user._id,
                    expiresAt: parseDate(expiresAt, 'expiresAt'),
                });
                await OplogModel.log(this, 'endpoint.seat_pairing_window.open', {
                    classroomId,
                    windowId: opened.window.windowId,
                    revision: opened.window.revision,
                    requestId,
                    seatCount: opened.codes.length,
                    replacementSeatCount: replacementSeatIds.length,
                    expiresAt: opened.window.expiresAt,
                    replayed: false,
                    canonicalActorUid: opened.window.createdBy,
                });
                this.response.body = {
                    pairingWindow: serializeWindow(opened.window),
                    codes: opened.codes,
                };
                return;
            }
            exactBody(this.request.body, ['action', 'expectedRevision', 'requestId']);
            const outcome = await endpointSeatBindingService.closePairingWindowWithOutcome({
                domainId: String(this.domain._id),
                classroomId,
                expectedRevision,
                actorUid: this.user._id,
                requestId,
            });
            const closed = outcome.value;
            await OplogModel.log(this, outcome.replayed ? 'endpoint.seat_pairing_window.close.replay' : 'endpoint.seat_pairing_window.close', {
                classroomId,
                windowId: closed.windowId,
                revision: closed.revision,
                requestId,
                replayed: outcome.replayed,
                canonicalActorUid: outcome.canonicalActorUid,
            });
            this.response.body = { pairingWindow: serializeWindow(closed) };
        } catch (error) {
            translate(error);
        }
    }
}

class EndpointSeatBindingDetailHandler extends EndpointSeatAdminHandler {
    @param('classroomId', Types.ObjectId)
    @param('sourceSeatId', Types.String)
    @param('action', Types.Range(['previewUnbind', 'unbind', 'previewReplacement', 'confirmReplacement', 'cancelPairing']))
    @param('windowId', Types.ObjectId, true)
    @param('expectedEntryRevision', Types.PositiveInt, true)
    @param('expectedBindingRevision', Types.PositiveInt, true)
    @param('confirmationFingerprint', Types.String, true)
    @param('requestId', Types.String, true)
    async post(
        _args: unknown,
        classroomId: ObjectId,
        sourceSeatId: string,
        action: 'previewUnbind' | 'unbind' | 'previewReplacement' | 'confirmReplacement' | 'cancelPairing',
        windowId?: ObjectId,
        expectedEntryRevision?: number,
        expectedBindingRevision?: number,
        confirmationFingerprint = '',
        requestId = '',
    ) {
        await this.classroom(classroomId);
        const identity = { domainId: String(this.domain._id), classroomId, sourceSeatId };
        try {
            if (action === 'previewUnbind') {
                exactBody(this.request.body, ['action']);
                const preview = await endpointSeatBindingService.previewUnbind(identity);
                this.response.body = {
                    preview: {
                        bindingRevision: preview.bindingRevision,
                        endpointId: preview.endpointId,
                        references: preview.references.map(serializeReference),
                        confirmationFingerprint: preview.confirmationFingerprint,
                    },
                };
                return;
            }
            if (action === 'previewReplacement') {
                exactBody(this.request.body, ['action', 'windowId']);
                if (!windowId) throw new ValidationError('windowId');
                const preview = await endpointSeatBindingService.previewReplacement({ ...identity, windowId });
                this.response.body = {
                    preview: {
                        ...preview,
                        windowId: preview.windowId.toHexString(),
                        classroomId: preview.classroomId.toHexString(),
                        references: preview.references.map(serializeReference),
                    },
                };
                return;
            }
            if (action === 'unbind') {
                exactBody(this.request.body, ['action', 'confirmationFingerprint', 'expectedBindingRevision', 'requestId']);
                if (!expectedBindingRevision || !requestId) throw new ValidationError('expectedBindingRevision');
                const outcome = await endpointSeatBindingService.unbindWithOutcome({
                    ...identity,
                    expectedBindingRevision,
                    confirmationFingerprint,
                    actorUid: this.user._id,
                    requestId,
                });
                const binding = outcome.value;
                await OplogModel.log(this, outcome.replayed ? 'endpoint.seat_binding.unbind.replay' : 'endpoint.seat_binding.unbind', {
                    classroomId,
                    sourceSeatId,
                    bindingId: binding._id,
                    revision: binding.revision,
                    requestId,
                    replayed: outcome.replayed,
                    canonicalActorUid: outcome.canonicalActorUid,
                });
                this.response.body = { binding: serializeBinding(binding) };
                return;
            }
            if (!windowId || !expectedEntryRevision || !requestId) throw new ValidationError('windowId');
            if (action === 'cancelPairing') {
                exactBody(this.request.body, ['action', 'expectedEntryRevision', 'requestId', 'windowId']);
                const outcome = await endpointSeatBindingService.cancelPairingClaimWithOutcome({
                    ...identity,
                    windowId,
                    expectedEntryRevision,
                    actorUid: this.user._id,
                    requestId,
                });
                const window = outcome.value;
                await OplogModel.log(this, outcome.replayed ? 'endpoint.seat_pairing.cancel.replay' : 'endpoint.seat_pairing.cancel', {
                    classroomId,
                    sourceSeatId,
                    windowId,
                    revision: window.revision,
                    requestId,
                    replayed: outcome.replayed,
                    canonicalActorUid: outcome.canonicalActorUid,
                });
                this.response.body = { pairingWindow: serializeWindow(window) };
                return;
            }
            exactBody(this.request.body, [
                'action',
                'confirmationFingerprint',
                'expectedBindingRevision',
                'expectedEntryRevision',
                'requestId',
                'windowId',
            ]);
            if (!expectedBindingRevision) throw new ValidationError('expectedBindingRevision');
            const outcome = await endpointSeatBindingService.confirmReplacementWithOutcome({
                ...identity,
                windowId,
                expectedEntryRevision,
                expectedBindingRevision,
                confirmationFingerprint,
                actorUid: this.user._id,
                requestId,
            });
            const binding = outcome.value;
            await OplogModel.log(this, outcome.replayed ? 'endpoint.seat_binding.replace.replay' : 'endpoint.seat_binding.replace', {
                classroomId,
                sourceSeatId,
                bindingId: binding._id,
                endpointId: binding.endpointId,
                revision: binding.revision,
                requestId,
                replayed: outcome.replayed,
                canonicalActorUid: outcome.canonicalActorUid,
            });
            this.response.body = { binding: serializeBinding(binding) };
        } catch (error) {
            translate(error);
        }
    }
}

class VigilEndpointSeatPairingRedeemHandler extends Handler {
    noCheckPermView = true;

    async prepare() {
        requireServiceToken(this, 'vigil');
        await endpointSeatBindingService.ensureIndexes();
    }

    @param('endpointId', Types.String)
    @param('pairingCode', Types.String)
    @param('requestId', Types.String)
    async post(_args: unknown, endpointId: string, pairingCode: string, requestId: string) {
        exactBody(this.request.body, ['endpointId', 'pairingCode', 'requestId']);
        try {
            const result = await endpointSeatBindingService.redeemPairingCode({ endpointId, pairingCode, requestId });
            const serialized = serializeRedemption(result);
            logger.info(
                'Endpoint seat pairing settled endpoint=%s request=%s status=%s classroom=%s seat=%s',
                endpointId,
                requestId,
                result.status,
                serialized.classroomId,
                serialized.sourceSeatId,
            );
            this.response.body = { ...serialized, requestId };
        } catch (error) {
            if (!(error instanceof EndpointSeatBindingError)) throw error;
            logger.warn('Endpoint seat pairing rejected stage=redeem reason=%s', error.reason);
            this.response.status = errorStatus(error.reason);
            this.response.body = { error: error.reason, requestId };
        }
    }
}

class VigilEndpointSeatBindingStatusHandler extends Handler {
    noCheckPermView = true;

    async prepare() {
        requireServiceToken(this, 'vigil');
        await endpointSeatBindingService.ensureIndexes();
    }

    @param('endpointId', Types.String)
    @param('requestId', Types.String)
    async post(_args: unknown, endpointId: string, requestId: string) {
        exactBody(this.request.body, ['endpointId', 'requestId']);
        if (!/^[A-Za-z0-9_-]{16,96}$/.test(requestId)) throw new ValidationError('requestId');
        try {
            const binding = await endpointSeatBindingService.getActiveBindingForEndpoint(endpointId);
            if (!binding) {
                this.response.body = { status: 'unbound', requestId };
                return;
            }
            this.response.body = {
                status: 'bound',
                bindingId: binding._id.toHexString(),
                classroomId: binding.classroomId.toHexString(),
                sourceSeatId: binding.sourceSeatId,
                bindingRevision: binding.revision,
                requestId,
            };
        } catch (error) {
            if (!(error instanceof EndpointSeatBindingError)) throw error;
            logger.warn('Endpoint seat binding status rejected stage=status reason=%s', error.reason);
            this.response.status = errorStatus(error.reason);
            this.response.body = { error: error.reason, requestId };
        }
    }
}

export async function apply(ctx: Context) {
    ctx.Route('endpoint_seat_classroom_collection', '/api/admin/exam-infrastructure/classrooms', EndpointSeatClassroomCollectionHandler);
    ctx.Route(
        'endpoint_seat_classroom_state',
        '/api/admin/exam-infrastructure/classrooms/:classroomId/seat-bindings',
        EndpointSeatClassroomStateHandler,
    );
    ctx.Route(
        'endpoint_seat_pairing_window',
        '/api/admin/exam-infrastructure/classrooms/:classroomId/seat-pairing-window',
        EndpointSeatPairingWindowHandler,
    );
    ctx.Route(
        'endpoint_seat_binding_detail',
        '/api/admin/exam-infrastructure/classrooms/:classroomId/seat-bindings/:sourceSeatId',
        EndpointSeatBindingDetailHandler,
    );
    ctx.Route('endpoint_seat_classroom_page', '/admin/exam-infrastructure/classrooms/:classroomId', EndpointSeatClassroomPageHandler);
    ctx.Route('vigil_endpoint_seat_pairing_redeem', '/api/vigil/endpoint-seat-pairing/redeem', VigilEndpointSeatPairingRedeemHandler);
    ctx.Route('vigil_endpoint_seat_binding_status', '/api/vigil/endpoint-seat-binding/status', VigilEndpointSeatBindingStatusHandler);
}
