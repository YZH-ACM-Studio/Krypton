import { createHash } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import {
    canonicalExamNetworkPolicy,
    ExamNetworkControlPlane,
    ExamNetworkPolicy,
    examNetworkPolicyFingerprint,
    validateExamNetworkPolicyResolution,
} from './exam-network-policy';

export type ExamPolicyTemplateStatus = 'active' | 'archived';
export type ExamTargetSourceKind = 'classroom' | 'endpoint' | 'examSeat' | 'seat' | 'userbindGroup';

export interface ExamPolicyRevision {
    revision: number;
    policy: ExamNetworkPolicy;
    fingerprint: string;
    publishedAt: Date;
    publishedBy: number;
}

export interface ExamPolicyTemplateDoc {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    ownerUid: number;
    collaboratorUids: number[];
    status: ExamPolicyTemplateStatus;
    revision: number;
    auditRef: string;
    draft: {
        version: number;
        policy: ExamNetworkPolicy;
        fingerprint: string;
        updatedAt: Date;
        updatedBy: number;
    };
    revisions: ExamPolicyRevision[];
    latestPublishedRevision?: number;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
    archivedAt?: Date;
    archivedBy?: number;
}

export interface ExamTargetSource {
    kind: ExamTargetSourceKind;
    ids: string[];
}

export interface ExamResolvedEndpoint {
    endpointId: string;
    schoolId: ObjectId;
    capabilities: Array<{ name: string; version: number; commands: string[] }>;
}

export interface ExamTargetResolution {
    sourceFingerprint: string;
    endpoints: ExamResolvedEndpoint[];
}

export interface ExamTargetResolverInput {
    domainId: string;
    schoolId: ObjectId;
    eventId: ObjectId;
    sources: ExamTargetSource[];
}

export type ExamTargetResolver = (input: ExamTargetResolverInput) => Promise<ExamTargetResolution>;
export type ExamNetworkControlPlaneResolver = () => Promise<ExamNetworkControlPlane>;

const REQUIRED_NETWORK_POLICY_COMMANDS = ['apply_network_policy', 'get_network_policy_status', 'stop_network_policy'] as const;

export interface ExamTargetRevision {
    revision: number;
    sources: ExamTargetSource[];
    sourceFingerprint: string;
    targetFingerprint: string;
    endpointIds: string[];
    targetCount: number;
    publishedAt: Date;
    publishedBy: number;
}

export interface ExamTargetAssignmentDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    schoolId: ObjectId;
    revision: number;
    auditRef: string;
    draft: {
        version: number;
        sources: ExamTargetSource[];
        sourceFingerprint?: string;
        previewFingerprint?: string;
        updatedAt: Date;
        updatedBy: number;
    };
    revisions: ExamTargetRevision[];
    latestPublishedRevision?: number;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
}

export interface ExamNetworkRevisionRef {
    id: ObjectId;
    revision: number;
    fingerprint: string;
}

export interface ExamEventNetworkConfigDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    revision: number;
    auditRef: string;
    policy?: ExamNetworkRevisionRef;
    target?: ExamNetworkRevisionRef;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
}

type PolicyCollection = Pick<Collection<ExamPolicyTemplateDoc>, 'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'findOneAndUpdate' | 'insertOne'>;
type TargetCollection = Pick<Collection<ExamTargetAssignmentDoc>, 'createIndex' | 'deleteMany' | 'findOne' | 'findOneAndUpdate' | 'insertOne'>;
type ConfigCollection = Pick<Collection<ExamEventNetworkConfigDoc>, 'createIndex' | 'deleteMany' | 'findOne' | 'findOneAndUpdate' | 'insertOne'>;

export class ExamNetworkConfigError extends Error {
    constructor(
        public readonly reason: string,
        public readonly detail: {
            assignmentId?: string;
            classroomId?: string;
            eventId?: string;
            sourceSeatId?: string;
            stage?: string;
            uid?: number;
        } | null = null,
    ) {
        super(reason);
        this.name = 'ExamNetworkConfigError';
    }
}

function assertDomainId(domainId: string): void {
    if (!domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
}

function assertUid(uid: number): void {
    if (!Number.isSafeInteger(uid) || uid < 1) throw new TypeError('actorUid is invalid');
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new TypeError(`${field} must be an ObjectId`);
}

function assertRevision(revision: number, allowZero = false): void {
    if (!Number.isSafeInteger(revision) || revision < (allowZero ? 0 : 1)) throw new TypeError('revision is invalid');
}

function canonicalName(value: string): string {
    const name = value.trim();
    if (!name || name.length > 120) throw new ExamNetworkConfigError('invalid_name');
    return name;
}

function clonePolicy(policy: ExamNetworkPolicy): ExamNetworkPolicy {
    return { hosts: [...policy.hosts], ips: [...policy.ips], ports: [...policy.ports] };
}

function cloneSources(sources: ExamTargetSource[]): ExamTargetSource[] {
    return sources.map((source) => ({ kind: source.kind, ids: [...source.ids] }));
}

function exactObject(value: unknown, keys: string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamNetworkConfigError(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
        throw new ExamNetworkConfigError(reason);
    }
    return record;
}

function canonicalSourceId(value: unknown): string {
    if (typeof value !== 'string') throw new ExamNetworkConfigError('invalid_target_source');
    const id = value.trim();
    if (!id || id.length > 128 || [...id].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) {
        throw new ExamNetworkConfigError('invalid_target_source');
    }
    return id;
}

export function canonicalExamTargetSources(value: unknown): ExamTargetSource[] {
    if (!Array.isArray(value) || value.length > 100) throw new ExamNetworkConfigError('invalid_target_sources');
    const sources = value.map((item) => {
        const source = exactObject(item, ['kind', 'ids'], 'invalid_target_source');
        if (!['classroom', 'endpoint', 'examSeat', 'seat', 'userbindGroup'].includes(String(source.kind))) {
            throw new ExamNetworkConfigError('invalid_target_source');
        }
        if (!Array.isArray(source.ids) || !source.ids.length || source.ids.length > 500) {
            throw new ExamNetworkConfigError('invalid_target_source');
        }
        const ids = source.ids.map(canonicalSourceId).sort();
        if (new Set(ids).size !== ids.length) throw new ExamNetworkConfigError('duplicate_target_source');
        return { kind: source.kind as ExamTargetSourceKind, ids };
    });
    sources.sort((left, right) => `${left.kind}\0${left.ids.join('\0')}`.localeCompare(`${right.kind}\0${right.ids.join('\0')}`));
    const identities = sources.map((source) => JSON.stringify(source));
    if (new Set(identities).size !== identities.length) throw new ExamNetworkConfigError('duplicate_target_source');
    return sources;
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function examTargetSourcesFingerprint(sources: ExamTargetSource[]): string {
    return sha256({ sources });
}

function canonicalCollaborators(ownerUid: number, values: number[]): number[] {
    if (!Array.isArray(values) || values.length > 50) throw new ExamNetworkConfigError('invalid_collaborators');
    const result = Array.from(new Set(values));
    if (result.some((uid) => !Number.isSafeInteger(uid) || uid < 1)) throw new ExamNetworkConfigError('invalid_collaborators');
    return result.filter((uid) => uid !== ownerUid).sort((left, right) => left - right);
}

export function templateAuditRef(templateId: ObjectId, revision: number): string {
    return `exam-policy-template:${templateId.toHexString()}:${revision}`;
}

export function assignmentAuditRef(assignmentId: ObjectId, revision: number): string {
    return `exam-target-assignment:${assignmentId.toHexString()}:${revision}`;
}

export function configAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-event-network-config:${eventId.toHexString()}:${revision}`;
}

function eventUniqueDuplicate(error: unknown, domainId: string, eventId: ObjectId): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as {
        code?: unknown;
        keyPattern?: Record<string, unknown>;
        keyValue?: Record<string, unknown>;
    };
    return (
        value.code === 11000 &&
        value.keyPattern?.domainId === 1 &&
        value.keyPattern?.eventId === 1 &&
        value.keyValue?.domainId === domainId &&
        String(value.keyValue?.eventId) === eventId.toHexString()
    );
}

export interface TargetPreview {
    sources: ExamTargetSource[];
    sourceFingerprint: string;
    previewFingerprint: string;
    endpointIds: string[];
    targetCount: number;
    addedEndpointIds: string[];
    removedEndpointIds: string[];
}

export class ExamNetworkConfigService {
    private indexesPromise?: Promise<void>;

    constructor(
        private readonly templates: PolicyCollection,
        private readonly assignments: TargetCollection,
        private readonly configs: ConfigCollection,
        private readonly now: () => Date = () => new Date(),
        private readonly idFactory: () => ObjectId = () => new ObjectId(),
    ) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.templates.createIndex({ domainId: 1, schoolId: 1, status: 1, updatedAt: -1 }, { name: 'examPolicySchoolStatus' }),
            this.templates.createIndex({ domainId: 1, ownerUid: 1, updatedAt: -1 }, { name: 'examPolicyOwner' }),
            this.templates.createIndex({ domainId: 1, collaboratorUids: 1, updatedAt: -1 }, { name: 'examPolicyCollaborator' }),
            this.assignments.createIndex({ domainId: 1, eventId: 1 }, { name: 'examTargetEvent', unique: true }),
            this.configs.createIndex({ domainId: 1, eventId: 1 }, { name: 'examNetworkConfigEvent', unique: true }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    async createTemplate(input: {
        domainId: string;
        schoolId: ObjectId;
        name: string;
        ownerUid: number;
        collaboratorUids: number[];
        policy: unknown;
        templateId?: ObjectId;
    }): Promise<ExamPolicyTemplateDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.schoolId, 'schoolId');
        if (input.templateId !== undefined) assertObjectId(input.templateId, 'templateId');
        assertUid(input.ownerUid);
        const policy = canonicalExamNetworkPolicy(input.policy);
        const now = this.now();
        const _id = input.templateId ? new ObjectId(input.templateId) : this.idFactory();
        const doc: ExamPolicyTemplateDoc = {
            _id,
            domainId: input.domainId,
            schoolId: new ObjectId(input.schoolId),
            name: canonicalName(input.name),
            ownerUid: input.ownerUid,
            collaboratorUids: canonicalCollaborators(input.ownerUid, input.collaboratorUids),
            status: 'active',
            revision: 1,
            auditRef: templateAuditRef(_id, 1),
            draft: {
                version: 1,
                policy,
                fingerprint: examNetworkPolicyFingerprint(policy),
                updatedAt: now,
                updatedBy: input.ownerUid,
            },
            revisions: [],
            createdAt: now,
            createdBy: input.ownerUid,
            updatedAt: now,
            updatedBy: input.ownerUid,
        };
        await this.templates.insertOne(doc);
        return doc;
    }

    getTemplate(domainId: string, templateId: ObjectId): Promise<ExamPolicyTemplateDoc | null> {
        assertDomainId(domainId);
        assertObjectId(templateId, 'templateId');
        return this.templates.findOne({ domainId, _id: templateId });
    }

    listTemplates(domainId: string, schoolId: ObjectId, actorUid?: number) {
        assertDomainId(domainId);
        assertObjectId(schoolId, 'schoolId');
        if (actorUid !== undefined) assertUid(actorUid);
        return this.templates
            .find({
                domainId,
                schoolId,
                ...(actorUid === undefined ? {} : { $or: [{ ownerUid: actorUid }, { collaboratorUids: actorUid }] }),
            })
            .sort({ updatedAt: -1 })
            .limit(200);
    }

    async saveTemplateDraft(input: {
        domainId: string;
        templateId: ObjectId;
        expectedRevision: number;
        actorUid: number;
        name?: string;
        collaboratorUids?: number[];
        policy?: unknown;
    }): Promise<ExamPolicyTemplateDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.templateId, 'templateId');
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const current = await this.templates.findOne({ domainId: input.domainId, _id: input.templateId });
        if (!current) throw new ExamNetworkConfigError('template_not_found');
        if (current.status === 'archived') throw new ExamNetworkConfigError('template_archived');
        if (input.name === undefined && input.collaboratorUids === undefined && input.policy === undefined) {
            throw new ExamNetworkConfigError('empty_update');
        }
        const policy = input.policy === undefined ? current.draft.policy : canonicalExamNetworkPolicy(input.policy);
        const now = this.now();
        const revision = input.expectedRevision + 1;
        const updated = await this.templates.findOneAndUpdate(
            { domainId: input.domainId, _id: input.templateId, revision: input.expectedRevision, status: 'active' },
            {
                $set: {
                    name: input.name === undefined ? current.name : canonicalName(input.name),
                    collaboratorUids:
                        input.collaboratorUids === undefined
                            ? current.collaboratorUids
                            : canonicalCollaborators(current.ownerUid, input.collaboratorUids),
                    draft: {
                        version: current.draft.version + 1,
                        policy,
                        fingerprint: examNetworkPolicyFingerprint(policy),
                        updatedAt: now,
                        updatedBy: input.actorUid,
                    },
                    revision,
                    auditRef: templateAuditRef(input.templateId, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    async publishTemplate(input: {
        domainId: string;
        templateId: ObjectId;
        expectedRevision: number;
        actorUid: number;
        resolveHost: (hostname: string) => Promise<string[]>;
        controlPlane: ExamNetworkControlPlane;
    }): Promise<ExamPolicyTemplateDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.templateId, 'templateId');
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const current = await this.templates.findOne({ domainId: input.domainId, _id: input.templateId });
        if (!current) throw new ExamNetworkConfigError('template_not_found');
        if (current.status === 'archived') throw new ExamNetworkConfigError('template_archived');
        if (current.revision !== input.expectedRevision) throw new ExamNetworkConfigError('revision_conflict');
        await validateExamNetworkPolicyResolution(current.draft.policy, input.resolveHost, input.controlPlane);
        const now = this.now();
        const publishedRevision = (current.latestPublishedRevision || 0) + 1;
        const revision = input.expectedRevision + 1;
        const published: ExamPolicyRevision = {
            revision: publishedRevision,
            policy: clonePolicy(current.draft.policy),
            fingerprint: current.draft.fingerprint,
            publishedAt: now,
            publishedBy: input.actorUid,
        };
        const updated = await this.templates.findOneAndUpdate(
            { domainId: input.domainId, _id: input.templateId, revision: input.expectedRevision, status: 'active' },
            {
                $set: {
                    latestPublishedRevision: publishedRevision,
                    revision,
                    auditRef: templateAuditRef(input.templateId, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
                $push: { revisions: published },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    async archiveTemplate(input: {
        domainId: string;
        templateId: ObjectId;
        expectedRevision: number;
        actorUid: number;
    }): Promise<ExamPolicyTemplateDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.templateId, 'templateId');
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const now = this.now();
        const revision = input.expectedRevision + 1;
        const updated = await this.templates.findOneAndUpdate(
            { domainId: input.domainId, _id: input.templateId, revision: input.expectedRevision, status: 'active' },
            {
                $set: {
                    status: 'archived',
                    revision,
                    auditRef: templateAuditRef(input.templateId, revision),
                    archivedAt: now,
                    archivedBy: input.actorUid,
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    getAssignment(domainId: string, eventId: ObjectId): Promise<ExamTargetAssignmentDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        return this.assignments.findOne({ domainId, eventId });
    }

    async saveTargetDraft(input: {
        domainId: string;
        eventId: ObjectId;
        schoolId: ObjectId;
        expectedRevision: number;
        actorUid: number;
        sources: unknown;
        assignmentId?: ObjectId;
    }): Promise<ExamTargetAssignmentDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertObjectId(input.schoolId, 'schoolId');
        if (input.assignmentId !== undefined) assertObjectId(input.assignmentId, 'assignmentId');
        assertRevision(input.expectedRevision, true);
        assertUid(input.actorUid);
        const sources = canonicalExamTargetSources(input.sources);
        const current = await this.assignments.findOne({ domainId: input.domainId, eventId: input.eventId });
        const now = this.now();
        if (!current) {
            if (input.expectedRevision !== 0) throw new ExamNetworkConfigError('revision_conflict');
            const _id = input.assignmentId ? new ObjectId(input.assignmentId) : this.idFactory();
            const doc: ExamTargetAssignmentDoc = {
                _id,
                domainId: input.domainId,
                eventId: new ObjectId(input.eventId),
                schoolId: new ObjectId(input.schoolId),
                revision: 1,
                auditRef: assignmentAuditRef(_id, 1),
                draft: { version: 1, sources, updatedAt: now, updatedBy: input.actorUid },
                revisions: [],
                createdAt: now,
                createdBy: input.actorUid,
                updatedAt: now,
                updatedBy: input.actorUid,
            };
            try {
                await this.assignments.insertOne(doc);
            } catch (error) {
                if (eventUniqueDuplicate(error, input.domainId, input.eventId)) throw new ExamNetworkConfigError('revision_conflict');
                throw error;
            }
            return doc;
        }
        if (!current.schoolId.equals(input.schoolId)) throw new ExamNetworkConfigError('event_school_mismatch');
        const revision = input.expectedRevision + 1;
        const updated = await this.assignments.findOneAndUpdate(
            { domainId: input.domainId, eventId: input.eventId, revision: input.expectedRevision, schoolId: input.schoolId },
            {
                $set: {
                    draft: { version: current.draft.version + 1, sources, updatedAt: now, updatedBy: input.actorUid },
                    revision,
                    auditRef: assignmentAuditRef(current._id, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    async previewTargets(input: {
        domainId: string;
        eventId: ObjectId;
        schoolId: ObjectId;
        expectedRevision?: number;
        resolver: ExamTargetResolver;
    }): Promise<TargetPreview> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertObjectId(input.schoolId, 'schoolId');
        if (input.expectedRevision !== undefined) assertRevision(input.expectedRevision);
        const assignment = await this.assignments.findOne({ domainId: input.domainId, eventId: input.eventId });
        if (!assignment) throw new ExamNetworkConfigError('target_assignment_not_found');
        if (input.expectedRevision !== undefined && assignment.revision !== input.expectedRevision) {
            throw new ExamNetworkConfigError('revision_conflict');
        }
        if (!assignment.schoolId.equals(input.schoolId)) throw new ExamNetworkConfigError('event_school_mismatch');
        if (!assignment.draft.sources.length) throw new ExamNetworkConfigError('empty_target_source');
        const resolution = await input.resolver({
            domainId: input.domainId,
            schoolId: new ObjectId(input.schoolId),
            eventId: new ObjectId(input.eventId),
            sources: cloneSources(assignment.draft.sources),
        });
        if (!/^[a-f0-9]{64}$/.test(resolution.sourceFingerprint)) throw new ExamNetworkConfigError('invalid_source_fingerprint');
        if (!Array.isArray(resolution.endpoints) || !resolution.endpoints.length) throw new ExamNetworkConfigError('empty_target');
        if (resolution.endpoints.length > 500) throw new ExamNetworkConfigError('target_limit');
        const endpointIds: string[] = [];
        for (const endpoint of resolution.endpoints) {
            if (!endpoint || typeof endpoint.endpointId !== 'string' || !endpoint.endpointId || endpoint.endpointId.length > 128) {
                throw new ExamNetworkConfigError('invalid_endpoint');
            }
            if (!(endpoint.schoolId instanceof ObjectId) || !endpoint.schoolId.equals(input.schoolId)) {
                throw new ExamNetworkConfigError('cross_school_endpoint');
            }
            if (!Array.isArray(endpoint.capabilities)) throw new ExamNetworkConfigError('endpoint_capability_incomplete');
            const capability = endpoint.capabilities.find((item) => item?.name === 'network.policy');
            if (!capability) throw new ExamNetworkConfigError('endpoint_capability_missing');
            if (
                capability.version !== 1 ||
                !Array.isArray(capability.commands) ||
                !capability.commands.every((command) => typeof command === 'string' && command.length > 0) ||
                !REQUIRED_NETWORK_POLICY_COMMANDS.every((command) => capability.commands.includes(command))
            ) {
                throw new ExamNetworkConfigError('endpoint_capability_incomplete');
            }
            endpointIds.push(endpoint.endpointId);
        }
        endpointIds.sort();
        if (new Set(endpointIds).size !== endpointIds.length) throw new ExamNetworkConfigError('duplicate_endpoint');
        const targetFingerprint = sha256({ endpointIds });
        const previewFingerprint = sha256({
            assignmentRevision: assignment.revision,
            sources: assignment.draft.sources,
            sourceFingerprint: resolution.sourceFingerprint,
            targetFingerprint,
        });
        const previous = assignment.revisions.find((item) => item.revision === assignment.latestPublishedRevision)?.endpointIds || [];
        const next = new Set(endpointIds);
        const old = new Set(previous);
        return {
            sources: cloneSources(assignment.draft.sources),
            sourceFingerprint: resolution.sourceFingerprint,
            previewFingerprint,
            endpointIds,
            targetCount: endpointIds.length,
            addedEndpointIds: endpointIds.filter((endpointId) => !old.has(endpointId)),
            removedEndpointIds: previous.filter((endpointId) => !next.has(endpointId)),
        };
    }

    async publishTargets(input: {
        domainId: string;
        eventId: ObjectId;
        schoolId: ObjectId;
        expectedRevision: number;
        confirmationFingerprint: string;
        actorUid: number;
        resolver: ExamTargetResolver;
    }): Promise<ExamTargetAssignmentDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertObjectId(input.schoolId, 'schoolId');
        assertRevision(input.expectedRevision);
        assertUid(input.actorUid);
        const current = await this.assignments.findOne({ domainId: input.domainId, eventId: input.eventId });
        if (!current) throw new ExamNetworkConfigError('target_assignment_not_found');
        if (current.revision !== input.expectedRevision) throw new ExamNetworkConfigError('revision_conflict');
        const preview = await this.previewTargets(input);
        if (preview.previewFingerprint !== input.confirmationFingerprint) throw new ExamNetworkConfigError('target_confirmation_stale');
        const now = this.now();
        const publishedRevision = (current.latestPublishedRevision || 0) + 1;
        const revision = input.expectedRevision + 1;
        const published: ExamTargetRevision = {
            revision: publishedRevision,
            sources: preview.sources,
            sourceFingerprint: preview.sourceFingerprint,
            targetFingerprint: sha256({ endpointIds: preview.endpointIds }),
            endpointIds: [...preview.endpointIds],
            targetCount: preview.targetCount,
            publishedAt: now,
            publishedBy: input.actorUid,
        };
        const updated = await this.assignments.findOneAndUpdate(
            { domainId: input.domainId, eventId: input.eventId, revision: input.expectedRevision, schoolId: input.schoolId },
            {
                $set: {
                    latestPublishedRevision: publishedRevision,
                    'draft.sourceFingerprint': preview.sourceFingerprint,
                    'draft.previewFingerprint': preview.previewFingerprint,
                    revision,
                    auditRef: assignmentAuditRef(current._id, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
                $push: { revisions: published },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    getEventConfig(domainId: string, eventId: ObjectId): Promise<ExamEventNetworkConfigDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        return this.configs.findOne({ domainId, eventId });
    }

    async assignRevision(input: {
        domainId: string;
        eventId: ObjectId;
        schoolId: ObjectId;
        expectedRevision: number;
        actorUid: number;
        policy?: { templateId: ObjectId; revision: number };
        target?: { assignmentId: ObjectId; revision: number };
    }): Promise<ExamEventNetworkConfigDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertObjectId(input.schoolId, 'schoolId');
        assertRevision(input.expectedRevision, true);
        assertUid(input.actorUid);
        if (Boolean(input.policy) === Boolean(input.target)) throw new ExamNetworkConfigError('single_reference_required');
        let field: 'policy' | 'target';
        let reference: ExamNetworkRevisionRef;
        if (input.policy) {
            assertObjectId(input.policy.templateId, 'templateId');
            assertRevision(input.policy.revision);
            const template = await this.templates.findOne({ domainId: input.domainId, _id: input.policy.templateId });
            if (!template) throw new ExamNetworkConfigError('template_not_found');
            if (!template.schoolId.equals(input.schoolId)) throw new ExamNetworkConfigError('event_school_mismatch');
            const revision = template.revisions.find((item) => item.revision === input.policy?.revision);
            if (!revision) throw new ExamNetworkConfigError('policy_revision_not_found');
            field = 'policy';
            reference = { id: new ObjectId(template._id), revision: revision.revision, fingerprint: revision.fingerprint };
        } else {
            const target = input.target!;
            assertObjectId(target.assignmentId, 'assignmentId');
            assertRevision(target.revision);
            const assignment = await this.assignments.findOne({ domainId: input.domainId, _id: target.assignmentId, eventId: input.eventId });
            if (!assignment) throw new ExamNetworkConfigError('target_revision_not_found');
            if (!assignment.schoolId.equals(input.schoolId)) throw new ExamNetworkConfigError('event_school_mismatch');
            const revision = assignment.revisions.find((item) => item.revision === target.revision);
            if (!revision) throw new ExamNetworkConfigError('target_revision_not_found');
            field = 'target';
            reference = { id: new ObjectId(assignment._id), revision: revision.revision, fingerprint: revision.targetFingerprint };
        }
        const current = await this.configs.findOne({ domainId: input.domainId, eventId: input.eventId });
        const now = this.now();
        if (!current) {
            if (input.expectedRevision !== 0) throw new ExamNetworkConfigError('revision_conflict');
            const _id = this.idFactory();
            const doc: ExamEventNetworkConfigDoc = {
                _id,
                domainId: input.domainId,
                eventId: new ObjectId(input.eventId),
                revision: 1,
                auditRef: configAuditRef(input.eventId, 1),
                [field]: reference,
                createdAt: now,
                createdBy: input.actorUid,
                updatedAt: now,
                updatedBy: input.actorUid,
            };
            try {
                await this.configs.insertOne(doc);
            } catch (error) {
                if (eventUniqueDuplicate(error, input.domainId, input.eventId)) throw new ExamNetworkConfigError('revision_conflict');
                throw error;
            }
            return doc;
        }
        const revision = input.expectedRevision + 1;
        const updated = await this.configs.findOneAndUpdate(
            { domainId: input.domainId, eventId: input.eventId, revision: input.expectedRevision },
            {
                $set: {
                    [field]: reference,
                    revision,
                    auditRef: configAuditRef(input.eventId, revision),
                    updatedAt: now,
                    updatedBy: input.actorUid,
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamNetworkConfigError('revision_conflict');
        return updated;
    }

    async assertEventSchoolChangeAllowed(domainId: string, eventId: ObjectId): Promise<void> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        const [assignment, config] = await Promise.all([
            this.assignments.findOne({ domainId, eventId }),
            this.configs.findOne({ domainId, eventId }),
        ]);
        if (assignment || config) throw new ExamNetworkConfigError('network_configuration_exists');
    }
}

export const examPolicyTemplateColl = db.collection<ExamPolicyTemplateDoc>('exam.policyTemplates');
export const examTargetAssignmentColl = db.collection<ExamTargetAssignmentDoc>('exam.targetAssignments');
export const examEventNetworkConfigColl = db.collection<ExamEventNetworkConfigDoc>('exam.eventNetworkConfigs');
export const examNetworkConfigService = new ExamNetworkConfigService(examPolicyTemplateColl, examTargetAssignmentColl, examEventNetworkConfigColl);

export async function loadExamTargetRevisionEndpointIds(domainId: string, reference: ExamNetworkRevisionRef): Promise<string[]> {
    assertDomainId(domainId);
    assertObjectId(reference.id, 'targetRef.id');
    assertRevision(reference.revision);
    if (!/^[a-f0-9]{64}$/.test(reference.fingerprint)) throw new TypeError('targetRef.fingerprint is invalid');
    const assignment = await examTargetAssignmentColl.findOne({ domainId, _id: reference.id });
    const revision = assignment?.revisions.find((item) => item.revision === reference.revision);
    if (!revision || revision.targetFingerprint !== reference.fingerprint) {
        throw new ExamNetworkConfigError('target_revision_not_found');
    }
    return [...revision.endpointIds].sort();
}

let targetResolver: ExamTargetResolver | undefined;
let controlPlaneResolver: ExamNetworkControlPlaneResolver | undefined;

export function registerExamTargetResolver(resolver: ExamTargetResolver): () => void {
    if (targetResolver) throw new Error('Exam target resolver is already registered');
    targetResolver = resolver;
    return () => {
        if (targetResolver !== resolver) throw new Error('Exam target resolver registration changed unexpectedly');
        targetResolver = undefined;
    };
}

export function requireExamTargetResolver(): ExamTargetResolver {
    if (!targetResolver) throw new ExamNetworkConfigError('target_resolver_unavailable');
    return targetResolver;
}

export function registerExamNetworkControlPlaneResolver(resolver: ExamNetworkControlPlaneResolver): () => void {
    if (controlPlaneResolver) throw new Error('Exam network control-plane resolver is already registered');
    controlPlaneResolver = resolver;
    return () => {
        if (controlPlaneResolver !== resolver) throw new Error('Exam network control-plane resolver registration changed unexpectedly');
        controlPlaneResolver = undefined;
    };
}

export function requireExamNetworkControlPlaneResolver(): ExamNetworkControlPlaneResolver {
    if (!controlPlaneResolver) throw new ExamNetworkConfigError('control_plane_resolver_unavailable');
    return controlPlaneResolver;
}

export async function apply(ctx: any): Promise<void> {
    await examNetworkConfigService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => examPolicyTemplateColl.deleteMany({ domainId }),
            () => examTargetAssignmentColl.deleteMany({ domainId }),
            () => examEventNetworkConfigColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.examNetworkConfig = {
    examPolicyTemplateColl,
    examTargetAssignmentColl,
    examEventNetworkConfigColl,
    examNetworkConfigService,
    loadExamTargetRevisionEndpointIds,
    registerExamTargetResolver,
    requireExamTargetResolver,
    registerExamNetworkControlPlaneResolver,
    requireExamNetworkControlPlaneResolver,
};
