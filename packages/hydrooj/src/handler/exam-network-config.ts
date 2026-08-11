import { lookup } from 'node:dns/promises';
import { ObjectId } from 'mongodb';
import { Context, Handler, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { assertCanManageExamEvent, assertExamEventCollaborators, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import {
    assignmentAuditRef,
    configAuditRef,
    ExamEventNetworkConfigDoc,
    ExamNetworkConfigError,
    examNetworkConfigService,
    ExamPolicyTemplateDoc,
    ExamTargetAssignmentDoc,
    requireExamNetworkControlPlaneResolver,
    requireExamTargetResolver,
    TargetPreview,
    templateAuditRef,
} from '../model/exam-network-config';
import {
    ExamNetworkAuditContext,
    policyTemplateAuditFacts,
    runAuditedExamNetworkMutation,
    targetAssignmentAuditFacts,
} from '../model/exam-network-audit';
import { ExamNetworkPolicyError } from '../model/exam-network-policy';

function auditContext(handler: ExamNetworkBaseHandler): ExamNetworkAuditContext {
    return {
        domainId: String(handler.domain._id),
        actorUid: handler.user._id,
        operateIp: handler.request.ip,
        path: handler.request.path,
        referer: handler.request.headers?.referer,
        userAgent: handler.request.headers?.['user-agent'],
    };
}

function bodyObject(handler: Handler): Record<string, unknown> {
    const body = handler.request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('body');
    return body as Record<string, unknown>;
}

function requiredBodyField(body: Record<string, unknown>, field: string): unknown {
    if (!Object.hasOwn(body, field)) throw new ValidationError(field);
    return body[field];
}

function bodyObjectId(body: Record<string, unknown>, field: string): ObjectId {
    const value = requiredBodyField(body, field);
    if (value instanceof ObjectId) return value;
    if (typeof value !== 'string' || !ObjectId.isValid(value) || new ObjectId(value).toHexString() !== value.toLowerCase()) {
        throw new ValidationError(field);
    }
    return new ObjectId(value);
}

function optionalCollaborators(value: unknown): number[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((uid) => !Number.isSafeInteger(uid))) throw new ValidationError('collaboratorUids');
    return value as number[];
}

function serializeTemplate(template: ExamPolicyTemplateDoc) {
    return {
        templateId: template._id.toHexString(),
        schoolId: template.schoolId.toHexString(),
        name: template.name,
        ownerUid: template.ownerUid,
        collaboratorUids: [...template.collaboratorUids],
        status: template.status,
        revision: template.revision,
        auditRef: template.auditRef,
        draft: {
            version: template.draft.version,
            policy: template.draft.policy,
            fingerprint: template.draft.fingerprint,
            updatedAt: template.draft.updatedAt.toISOString(),
            updatedBy: template.draft.updatedBy,
        },
        revisions: template.revisions.map((revision) => ({
            ...revision,
            publishedAt: revision.publishedAt.toISOString(),
        })),
        latestPublishedRevision: template.latestPublishedRevision || null,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
    };
}

function serializeAssignment(assignment: ExamTargetAssignmentDoc) {
    return {
        assignmentId: assignment._id.toHexString(),
        eventId: assignment.eventId.toHexString(),
        schoolId: assignment.schoolId.toHexString(),
        revision: assignment.revision,
        auditRef: assignment.auditRef,
        draft: {
            ...assignment.draft,
            updatedAt: assignment.draft.updatedAt.toISOString(),
        },
        revisions: assignment.revisions.map((revision) => ({
            ...revision,
            publishedAt: revision.publishedAt.toISOString(),
        })),
        latestPublishedRevision: assignment.latestPublishedRevision || null,
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
    };
}

function serializeConfig(config: ExamEventNetworkConfigDoc | null) {
    if (!config) return null;
    const reference = (value: typeof config.policy) =>
        value ? { id: value.id.toHexString(), revision: value.revision, fingerprint: value.fingerprint } : null;
    return {
        eventId: config.eventId.toHexString(),
        revision: config.revision,
        auditRef: config.auditRef,
        policy: reference(config.policy),
        target: reference(config.target),
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
    };
}

function serializePreview(preview: TargetPreview) {
    return preview;
}

export function translateExamNetworkError(error: unknown): never {
    if (error instanceof ExamNetworkConfigError || error instanceof ExamNetworkPolicyError) {
        throw new ValidationError('examNetwork', null, error.reason);
    }
    throw error;
}

async function resolveHost(hostname: string): Promise<string[]> {
    return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function serializedExamEventWrite(_target: unknown, _key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = async function examEventWriteBoundary(this: ExamNetworkBaseHandler, ...args: unknown[]) {
        const eventId = args[1];
        if (!(eventId instanceof ObjectId)) return original.apply(this, args);
        return await withExamEventBoundary(String(this.domain._id), eventId, () => original.apply(this, args));
    };
    return descriptor;
}

abstract class ExamNetworkBaseHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user) && !this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) {
            throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        }
        await Promise.all([examEventService.ensureIndexes(), examNetworkConfigService.ensureIndexes()]);
    }

    protected async loadEvent(eventId: ObjectId): Promise<ExamEventDoc> {
        const event = await examEventService.get(String(this.domain._id), eventId);
        if (!event) throw new ValidationError('eventId');
        await assertCanManageExamEvent(String(this.domain._id), event, this.user);
        return event;
    }

    protected async loadTemplateForEvent(event: ExamEventDoc, templateId: ObjectId): Promise<ExamPolicyTemplateDoc> {
        const template = await examNetworkConfigService.getTemplate(event.domainId, templateId);
        if (!template) throw new ValidationError('templateId');
        if (!template.schoolId.equals(event.schoolId)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user) && template.ownerUid !== this.user._id && !template.collaboratorUids.includes(this.user._id)) {
            throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        }
        return template;
    }

    protected assertEventWritable(event: ExamEventDoc): void {
        if (event.lifecycle === 'archived') throw new ValidationError('eventId', null, 'archived');
    }
}

class ExamPolicyTemplateCollectionHandler extends ExamNetworkBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.loadEvent(eventId);
        const templates = await examNetworkConfigService
            .listTemplates(event.domainId, event.schoolId, isExamInfrastructureAdmin(this.user) ? undefined : this.user._id)
            .toArray();
        this.response.body = { templates: templates.map(serializeTemplate) };
    }

    @param('eventId', Types.ObjectId)
    @param('name', Types.String)
    @serializedExamEventWrite
    async post(_args: unknown, eventId: ObjectId, name: string) {
        const domainId = String(this.domain._id);
        const event = await this.loadEvent(eventId);
        this.assertEventWritable(event);
        const body = bodyObject(this);
        const collaborators = optionalCollaborators(body.collaboratorUids) || [];
        await assertExamEventCollaborators(domainId, event.schoolId, this.user._id, collaborators);
        const templateId = new ObjectId();
        try {
            const template = await runAuditedExamNetworkMutation(
                auditContext(this),
                'policy-template.create',
                {
                    eventId,
                    entityKind: 'policyTemplate',
                    entityId: templateId,
                    auditRef: templateAuditRef(templateId, 1),
                    expectedRevision: null,
                    observedRevision: null,
                    targetRevision: 1,
                },
                () =>
                    examNetworkConfigService.createTemplate({
                        templateId,
                        domainId,
                        schoolId: event.schoolId,
                        name,
                        ownerUid: this.user._id,
                        collaboratorUids: collaborators,
                        policy: requiredBodyField(body, 'policy'),
                    }),
                (result) => ({ schoolId: result.schoolId, fingerprint: result.draft.fingerprint }),
            );
            this.response.body = { template: serializeTemplate(template) };
        } catch (error) {
            translateExamNetworkError(error);
        }
    }
}

class ExamPolicyTemplateDetailHandler extends ExamNetworkBaseHandler {
    @param('eventId', Types.ObjectId)
    @param('templateId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId, templateId: ObjectId) {
        const event = await this.loadEvent(eventId);
        const template = await this.loadTemplateForEvent(event, templateId);
        this.response.body = { template: serializeTemplate(template) };
    }

    @param('eventId', Types.ObjectId)
    @param('templateId', Types.ObjectId)
    @param('action', Types.Range(['saveDraft', 'publish', 'archive']))
    @param('expectedRevision', Types.PositiveInt)
    @serializedExamEventWrite
    async post(_args: unknown, eventId: ObjectId, templateId: ObjectId, action: 'saveDraft' | 'publish' | 'archive', expectedRevision: number) {
        const domainId = String(this.domain._id);
        const event = await this.loadEvent(eventId);
        this.assertEventWritable(event);
        const current = await this.loadTemplateForEvent(event, templateId);
        const body = bodyObject(this);
        try {
            if (action !== 'saveDraft' && ['name', 'policy', 'collaboratorUids'].some((field) => Object.hasOwn(body, field))) {
                throw new ExamNetworkConfigError('unexpected_fields');
            }
            const collaborators = optionalCollaborators(body.collaboratorUids);
            if (collaborators) await assertExamEventCollaborators(domainId, event.schoolId, current.ownerUid, collaborators);
            if (Object.hasOwn(body, 'name') && typeof body.name !== 'string') throw new ExamNetworkConfigError('invalid_name');
            const targetRevision = expectedRevision + 1;
            const result = await runAuditedExamNetworkMutation(
                auditContext(this),
                `policy-template.${action}`,
                {
                    eventId,
                    entityKind: 'policyTemplate',
                    entityId: templateId,
                    auditRef: templateAuditRef(templateId, targetRevision),
                    expectedRevision,
                    observedRevision: current.revision,
                    targetRevision,
                    fingerprint: current.draft.fingerprint,
                },
                async () => {
                    if (action === 'publish') {
                        const controlPlane = await requireExamNetworkControlPlaneResolver()();
                        return examNetworkConfigService.publishTemplate({
                            domainId,
                            templateId,
                            expectedRevision,
                            actorUid: this.user._id,
                            resolveHost,
                            controlPlane,
                        });
                    }
                    if (action === 'archive') {
                        return examNetworkConfigService.archiveTemplate({
                            domainId,
                            templateId,
                            expectedRevision,
                            actorUid: this.user._id,
                        });
                    }
                    return examNetworkConfigService.saveTemplateDraft({
                        domainId,
                        templateId,
                        expectedRevision,
                        actorUid: this.user._id,
                        ...(Object.hasOwn(body, 'name') ? { name: body.name as string } : {}),
                        ...(Object.hasOwn(body, 'policy') ? { policy: body.policy } : {}),
                        ...(collaborators ? { collaboratorUids: collaborators } : {}),
                    });
                },
                (template) => policyTemplateAuditFacts(action, template),
            );
            this.response.body = { template: serializeTemplate(result) };
        } catch (error) {
            translateExamNetworkError(error);
        }
    }
}

class ExamTargetAssignmentHandler extends ExamNetworkBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.loadEvent(eventId);
        const [assignment, config] = await Promise.all([
            examNetworkConfigService.getAssignment(event.domainId, eventId),
            examNetworkConfigService.getEventConfig(event.domainId, eventId),
        ]);
        this.response.body = { assignment: assignment ? serializeAssignment(assignment) : null, config: serializeConfig(config) };
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['saveDraft', 'preview', 'publish']))
    @param('expectedRevision', Types.UnsignedInt)
    @serializedExamEventWrite
    async post(_args: unknown, eventId: ObjectId, action: 'saveDraft' | 'preview' | 'publish', expectedRevision: number) {
        const event = await this.loadEvent(eventId);
        this.assertEventWritable(event);
        const body = bodyObject(this);
        const domainId = event.domainId;
        try {
            if (action === 'preview') {
                const preview = await examNetworkConfigService.previewTargets({
                    domainId,
                    eventId,
                    schoolId: event.schoolId,
                    expectedRevision,
                    resolver: requireExamTargetResolver(),
                });
                this.response.body = { preview: serializePreview(preview) };
                return;
            }
            const current = await examNetworkConfigService.getAssignment(domainId, eventId);
            const assignmentId = current?._id || new ObjectId();
            const targetRevision = expectedRevision + 1;
            const confirmationFingerprint = typeof body.confirmationFingerprint === 'string' ? body.confirmationFingerprint : undefined;
            if (action === 'publish' && !confirmationFingerprint) throw new ExamNetworkConfigError('confirmation_required');
            const result = await runAuditedExamNetworkMutation(
                auditContext(this),
                `target-assignment.${action}`,
                {
                    eventId,
                    entityKind: 'targetAssignment',
                    entityId: assignmentId,
                    auditRef: assignmentAuditRef(assignmentId, targetRevision),
                    expectedRevision,
                    observedRevision: current?.revision || null,
                    targetRevision,
                    ...(confirmationFingerprint ? { fingerprint: confirmationFingerprint } : {}),
                },
                () =>
                    action === 'publish'
                        ? examNetworkConfigService.publishTargets({
                              domainId,
                              eventId,
                              schoolId: event.schoolId,
                              expectedRevision,
                              confirmationFingerprint: confirmationFingerprint!,
                              actorUid: this.user._id,
                              resolver: requireExamTargetResolver(),
                          })
                        : examNetworkConfigService.saveTargetDraft({
                              assignmentId,
                              domainId,
                              eventId,
                              schoolId: event.schoolId,
                              expectedRevision,
                              actorUid: this.user._id,
                              sources: requiredBodyField(body, 'sources'),
                          }),
                (assignment) => targetAssignmentAuditFacts(action, assignment),
            );
            this.response.body = { assignment: serializeAssignment(result) };
        } catch (error) {
            translateExamNetworkError(error);
        }
    }
}

class ExamEventNetworkConfigHandler extends ExamNetworkBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.loadEvent(eventId);
        const config = await examNetworkConfigService.getEventConfig(event.domainId, eventId);
        this.response.body = { config: serializeConfig(config) };
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['assignPolicy', 'assignTarget']))
    @param('expectedRevision', Types.UnsignedInt)
    @serializedExamEventWrite
    async post(_args: unknown, eventId: ObjectId, action: 'assignPolicy' | 'assignTarget', expectedRevision: number) {
        const event = await this.loadEvent(eventId);
        this.assertEventWritable(event);
        const body = bodyObject(this);
        const current = await examNetworkConfigService.getEventConfig(event.domainId, eventId);
        const targetRevision = expectedRevision + 1;
        try {
            const idField = action === 'assignPolicy' ? 'templateId' : 'assignmentId';
            const id = bodyObjectId(body, idField);
            const revisionValue = requiredBodyField(body, 'revision');
            if (!Number.isSafeInteger(revisionValue) || Number(revisionValue) < 1) throw new ExamNetworkConfigError('invalid_revision');
            if (action === 'assignPolicy') await this.loadTemplateForEvent(event, id);
            const config = await runAuditedExamNetworkMutation(
                auditContext(this),
                `config.${action}`,
                {
                    eventId,
                    entityKind: 'config',
                    entityId: eventId,
                    auditRef: configAuditRef(eventId, targetRevision),
                    expectedRevision,
                    observedRevision: current?.revision || null,
                    targetRevision,
                },
                () =>
                    examNetworkConfigService.assignRevision({
                        domainId: event.domainId,
                        eventId,
                        schoolId: event.schoolId,
                        expectedRevision,
                        actorUid: this.user._id,
                        ...(action === 'assignPolicy'
                            ? { policy: { templateId: id, revision: Number(revisionValue) } }
                            : { target: { assignmentId: id, revision: Number(revisionValue) } }),
                    }),
                (result) => ({
                    schoolId: event.schoolId,
                    policyFingerprint: result.policy?.fingerprint || null,
                    targetFingerprint: result.target?.fingerprint || null,
                }),
            );
            this.response.body = { config: serializeConfig(config) };
        } catch (error) {
            translateExamNetworkError(error);
        }
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_policy_templates', '/api/admin/exam-policy-templates', ExamPolicyTemplateCollectionHandler);
    ctx.Route('exam_policy_template', '/api/admin/exam-policy-templates/:templateId', ExamPolicyTemplateDetailHandler);
    ctx.Route('exam_target_assignment', '/api/admin/exam-events/:eventId/target-assignment', ExamTargetAssignmentHandler);
    ctx.Route('exam_event_network_config', '/api/admin/exam-events/:eventId/network-config', ExamEventNetworkConfigHandler);
}
