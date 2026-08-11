import { ObjectId } from 'mongodb';
import { Context, Handler, localizedErrorText, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { AUDITED_EVENT_FIELDS, ExamEventAuditContext, runAuditedExamEventMutation } from '../model/exam-event-audit';
import {
    assertCanManageExamEvent,
    assertExamEventCollaborators,
    assertExamEventContestAccess,
    assertExamEventSchoolAccess,
    isExamInfrastructureAdmin,
    resolveExamEventSchoolScope,
} from '../model/exam-event-access';
import {
    canonicalCollaboratorUids,
    ExamEventDoc,
    ExamEventError,
    examEventDisplayStatus,
    examEventService,
    ExamEventType,
} from '../model/exam-event';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { EXAM_EVENT_PATCH_FIELDS, parseExamEventUpdatePatch } from '../model/exam-event-request';
import { examNetworkConfigService, ExamNetworkConfigError } from '../model/exam-network-config';
import { ExamSeatPlanError, examSeatPlanService } from '../model/exam-seat-plan';

function auditContext(handler: ExamEventBaseHandler): ExamEventAuditContext {
    return {
        domainId: String(handler.domain._id),
        actorUid: handler.user._id,
        operateIp: handler.request.ip,
        path: handler.request.path,
        referer: handler.request.headers?.referer,
        userAgent: handler.request.headers?.['user-agent'],
    };
}

function parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) throw new ValidationError(field);
    return date;
}

function serializeEvent(event: ExamEventDoc) {
    return {
        eventId: event._id.toHexString(),
        domainId: event.domainId,
        schoolId: event.schoolId.toHexString(),
        title: event.title,
        type: event.type,
        contestId: event.contestId?.toHexString() || null,
        lifecycle: event.lifecycle,
        status: examEventDisplayStatus(event),
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        ownerUid: event.ownerUid,
        collaboratorUids: [...event.collaboratorUids],
        revision: event.revision,
        auditRef: event.auditRef,
        createdAt: event.createdAt.toISOString(),
        createdBy: event.createdBy,
        updatedAt: event.updatedAt.toISOString(),
        updatedBy: event.updatedBy,
        archivedAt: event.archivedAt?.toISOString() || null,
        archivedBy: event.archivedBy || null,
    };
}

export function translateExamEventError(error: unknown): never {
    if (error instanceof ExamNetworkConfigError) throw new ValidationError('examEvent', null, error.reason);
    if (error instanceof ExamSeatPlanError) {
        throw new ValidationError('examEvent', null, localizedErrorText`Invalid request: ${error.reason}`);
    }
    if (!(error instanceof ExamEventError)) throw error;
    throw new ValidationError('examEvent', null, error.reason);
}

async function availableSchools(domainId: string, actor: typeof Handler.prototype.user) {
    const userbind = global.Hydro.model.userbind;
    if (!userbind || typeof userbind.listSchools !== 'function' || typeof userbind.getSchool !== 'function') {
        throw new TypeError('userbind school bridge is unavailable');
    }
    const schools = isExamInfrastructureAdmin(actor)
        ? await userbind.listSchools(domainId)
        : await Promise.all((await resolveExamEventSchoolScope(domainId, actor)).map((schoolId) => userbind.getSchool(domainId, schoolId)));
    return schools
        .filter((school): school is NonNullable<typeof school> => school !== null)
        .map((school) => ({
            schoolId: school._id.toHexString(),
            name: school.name,
        }));
}

abstract class ExamEventBaseHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user) && !this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) {
            throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        }
        await examEventService.ensureIndexes();
    }
}

class ExamEventCollectionHandler extends ExamEventBaseHandler {
    async get() {
        const domainId = String(this.domain._id);
        const admin = isExamInfrastructureAdmin(this.user);
        const schoolIds = admin ? undefined : await resolveExamEventSchoolScope(domainId, this.user);
        const visible = await examEventService.list(domainId, schoolIds, 200, admin ? undefined : this.user._id).toArray();
        await Promise.all(visible.map((event) => assertCanManageExamEvent(domainId, event, this.user)));
        this.response.body = {
            events: visible.map(serializeEvent),
            schools: await availableSchools(domainId, this.user),
            capability: { canManageAll: admin, canCreate: true },
        };
    }

    @param('schoolId', Types.ObjectId)
    @param('title', Types.String)
    @param('type', Types.Range(['krypton', 'external']))
    @param('contestId', Types.ObjectId, true)
    @param('startAt', Types.String)
    @param('endAt', Types.String)
    @param('collaboratorUids', Types.NumericArray, true)
    async post(
        _args: unknown,
        schoolId: ObjectId,
        title: string,
        type: ExamEventType,
        contestId: ObjectId | undefined,
        startAt: string,
        endAt: string,
        collaboratorUids: number[] = [],
    ) {
        const domainId = String(this.domain._id);
        try {
            await assertExamEventSchoolAccess(domainId, schoolId, this.user);
            if (contestId) await assertExamEventContestAccess(domainId, contestId, this.user);
            const collaborators = canonicalCollaboratorUids(this.user._id, collaboratorUids);
            await assertExamEventCollaborators(domainId, schoolId, this.user._id, collaborators);
            const eventId = new ObjectId();
            const event = await runAuditedExamEventMutation(
                auditContext(this),
                'create',
                {
                    eventId,
                    expectedRevision: null,
                    observedRevision: null,
                    targetRevision: 1,
                    requestedFields: [...AUDITED_EVENT_FIELDS],
                    before: null,
                },
                () =>
                    examEventService.create({
                        eventId,
                        domainId,
                        schoolId,
                        title,
                        type,
                        ...(contestId ? { contestId } : {}),
                        startAt: parseDate(startAt, 'startAt'),
                        endAt: parseDate(endAt, 'endAt'),
                        ownerUid: this.user._id,
                        collaboratorUids: collaborators,
                    }),
            );
            this.response.body = { event: serializeEvent(event) };
        } catch (error) {
            translateExamEventError(error);
        }
    }
}

class ExamEventDetailHandler extends ExamEventBaseHandler {
    private async load(eventId: ObjectId): Promise<ExamEventDoc> {
        const event = await examEventService.get(String(this.domain._id), eventId);
        if (!event) throw new ValidationError('eventId');
        await assertCanManageExamEvent(String(this.domain._id), event, this.user);
        return event;
    }

    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.load(eventId);
        this.response.body = {
            event: serializeEvent(event),
            schools: await availableSchools(String(this.domain._id), this.user),
            capability: { canManageAll: isExamInfrastructureAdmin(this.user) },
        };
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['update', 'schedule', 'archive']))
    @param('expectedRevision', Types.PositiveInt)
    async post(_args: unknown, eventId: ObjectId, action: 'update' | 'schedule' | 'archive', expectedRevision: number) {
        const domainId = String(this.domain._id);
        try {
            const event = await withExamEventBoundary(domainId, eventId, async () => {
                const current = await this.load(eventId);
                const body = this.request.body || {};
                let requestedFields: string[];
                let mutation: () => Promise<ExamEventDoc>;
                if (action === 'archive') {
                    if (EXAM_EVENT_PATCH_FIELDS.some((field) => Object.hasOwn(body, field))) throw new ValidationError('action');
                    requestedFields = ['lifecycle'];
                    mutation = () => examEventService.archive(domainId, eventId, expectedRevision, this.user._id);
                } else if (action === 'schedule') {
                    if (EXAM_EVENT_PATCH_FIELDS.some((field) => Object.hasOwn(body, field))) throw new ValidationError('action');
                    requestedFields = ['lifecycle'];
                    mutation = () => examEventService.schedule(domainId, eventId, expectedRevision, this.user._id);
                } else {
                    const patch = parseExamEventUpdatePatch(body);
                    const { schoolId, title, type, contestId, startAt, endAt, collaboratorUids } = patch;
                    requestedFields = patch.requestedFields;
                    if (contestId) await assertExamEventContestAccess(domainId, contestId, this.user);
                    const nextSchoolId = schoolId || current.schoolId;
                    await assertExamEventSchoolAccess(domainId, nextSchoolId, this.user);
                    if (schoolId && !schoolId.equals(current.schoolId)) {
                        await Promise.all([
                            examNetworkConfigService.assertEventSchoolChangeAllowed(domainId, eventId),
                            examSeatPlanService.assertEventSchoolChangeAllowed(domainId, eventId),
                        ]);
                    }
                    const collaborators = collaboratorUids === undefined ? undefined : canonicalCollaboratorUids(current.ownerUid, collaboratorUids);
                    await assertExamEventCollaborators(
                        domainId,
                        nextSchoolId,
                        current.ownerUid,
                        collaborators === undefined ? current.collaboratorUids : collaborators,
                    );
                    mutation = () =>
                        examEventService.update({
                            domainId,
                            eventId,
                            expectedRevision,
                            actorUid: this.user._id,
                            ...(schoolId ? { schoolId } : {}),
                            ...(title !== undefined ? { title } : {}),
                            ...(type !== undefined ? { type } : {}),
                            ...(contestId !== undefined ? { contestId } : {}),
                            ...(startAt !== undefined ? { startAt } : {}),
                            ...(endAt !== undefined ? { endAt } : {}),
                            ...(collaborators !== undefined ? { collaboratorUids: collaborators } : {}),
                        });
                }
                return await runAuditedExamEventMutation(
                    auditContext(this),
                    action,
                    {
                        eventId,
                        expectedRevision,
                        observedRevision: current.revision,
                        targetRevision: expectedRevision + 1,
                        requestedFields,
                        before: current,
                    },
                    mutation,
                );
            });
            this.response.body = { event: serializeEvent(event) };
        } catch (error) {
            translateExamEventError(error);
        }
    }
}

class ExamInfrastructurePageHandler extends ExamEventBaseHandler {
    async get() {
        this.response.template = 'admin_exam_infrastructure.html';
        this.response.body = { eventId: null };
    }
}

class ExamInfrastructureDetailPageHandler extends ExamEventBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        await examEventService.ensureIndexes();
        const event = await examEventService.get(String(this.domain._id), eventId);
        if (!event) throw new ValidationError('eventId');
        await assertCanManageExamEvent(String(this.domain._id), event, this.user);
        this.response.template = 'admin_exam_event.html';
        this.response.body = { eventId: eventId.toHexString() };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_event_collection', '/api/admin/exam-events', ExamEventCollectionHandler);
    ctx.Route('exam_event_detail', '/api/admin/exam-events/:eventId', ExamEventDetailHandler);
    ctx.Route('exam_infrastructure_page', '/admin/exam-infrastructure', ExamInfrastructurePageHandler);
    ctx.Route('exam_infrastructure_detail_page', '/admin/exam-infrastructure/events/:eventId', ExamInfrastructureDetailPageHandler);
}
