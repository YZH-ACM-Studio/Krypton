import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';

export type PracticeContainerKind = 'course' | 'problemSet';
export type PracticeScopeKind = 'chapter' | 'stage';
export type PracticeContextMode = 'student' | 'preview';

export interface PracticeIntegrityPolicy {
    prohibitExternalCodeInjection: boolean;
    removeIndependentSubmitForm: boolean;
    antiAiCopyInjection: boolean;
}

export interface PracticeIntegrityRevisionDoc {
    _id: ObjectId;
    domainId: string;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    revision: number;
    state: 'draft' | 'published';
    draftVersion?: number;
    policy: PracticeIntegrityPolicy;
    createdBy: number;
    createdAt: Date;
    updatedBy: number;
    updatedAt: Date;
    publishedBy?: number;
    publishedAt?: Date;
}

export interface PracticeIntegrityRevisionRef {
    revisionId: ObjectId;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    revision: number;
}

export interface PracticeIntegrityContextTargetInput {
    revision: PracticeIntegrityRevisionDoc;
    scopeKind: PracticeScopeKind;
    scopeId: number;
}

export interface TrustedPracticeContextReference {
    contextId: ObjectId;
    domainId: string;
    uid: number;
    pid: number;
    mode: PracticeContextMode;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    targets: PracticeIntegrityRevisionRef[];
}

export interface PracticeContextDoc {
    _id: ObjectId;
    domainId: string;
    uid: number;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    pid: number;
    mode: PracticeContextMode;
    revisions: PracticeIntegrityRevisionRef[];
    policy: PracticeIntegrityPolicy;
    issuedAt: Date;
    expiresAt: Date;
}

type RevisionCollection = Pick<Collection<PracticeIntegrityRevisionDoc>, 'createIndex' | 'findOne' | 'find' | 'insertOne' | 'updateOne'>;
type ContextCollection = Pick<Collection<PracticeContextDoc>, 'createIndex' | 'findOne' | 'insertOne'>;

export class PracticeIntegrityConflictError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'PracticeIntegrityConflictError';
    }
}

export class PracticeIntegrityContextError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'PracticeIntegrityContextError';
    }
}

export function canonicalPracticePolicy(value: unknown): PracticeIntegrityPolicy {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('practice integrity policy must be an object');
    const record = value as Record<string, unknown>;
    const keys = ['antiAiCopyInjection', 'prohibitExternalCodeInjection', 'removeIndependentSubmitForm'];
    if (Object.keys(record).sort().join(',') !== [...keys].sort().join(',') || keys.some((key) => typeof record[key] !== 'boolean')) {
        throw new TypeError('practice integrity policy must contain exactly three boolean fields');
    }
    return {
        prohibitExternalCodeInjection: record.prohibitExternalCodeInjection as boolean,
        removeIndependentSubmitForm: record.removeIndependentSubmitForm as boolean,
        antiAiCopyInjection: record.antiAiCopyInjection as boolean,
    };
}

export function combinePracticePolicies(policies: readonly PracticeIntegrityPolicy[]): PracticeIntegrityPolicy {
    if (!policies.length) throw new TypeError('at least one published practice integrity policy is required');
    return policies.reduce<PracticeIntegrityPolicy>(
        (combined, policy) => ({
            prohibitExternalCodeInjection: combined.prohibitExternalCodeInjection || policy.prohibitExternalCodeInjection,
            removeIndependentSubmitForm: combined.removeIndependentSubmitForm || policy.removeIndependentSubmitForm,
            antiAiCopyInjection: combined.antiAiCopyInjection || policy.antiAiCopyInjection,
        }),
        { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: false, antiAiCopyInjection: false },
    );
}

interface PracticeIntegrityServiceOptions {
    revisions: RevisionCollection;
    contexts: ContextCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    contextTtlMs?: number;
}

interface ContainerIdentity {
    domainId: string;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
}

interface SaveDraftInput extends ContainerIdentity {
    policy: PracticeIntegrityPolicy;
    actorUid: number;
    expectedDraftVersion: number;
}

interface PublishDraftInput extends ContainerIdentity {
    actorUid: number;
    expectedDraftVersion: number;
}

interface IssueContextInput extends ContainerIdentity {
    uid: number;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    pid: number;
    mode: PracticeContextMode;
    targets: PracticeIntegrityContextTargetInput[];
}

interface AssertContextInput extends ContainerIdentity {
    contextId: string;
    uid: number;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    pid: number;
    mode: PracticeContextMode;
}

interface AssertSubmissionContextInput {
    contextId: string;
    domainId: string;
    uid: number;
    pid: number;
}

function samePracticePolicy(left: PracticeIntegrityPolicy, right: PracticeIntegrityPolicy): boolean {
    return (
        left.prohibitExternalCodeInjection === right.prohibitExternalCodeInjection &&
        left.removeIndependentSubmitForm === right.removeIndependentSubmitForm &&
        left.antiAiCopyInjection === right.antiAiCopyInjection
    );
}

function assertContainerIdentity(input: ContainerIdentity): void {
    if (!input.domainId || !['course', 'problemSet'].includes(input.containerKind)) throw new TypeError('invalid practice container identity');
    if (!(input.containerId instanceof ObjectId)) throw new TypeError('practice container id must be an ObjectId');
}

function assertPositiveInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive integer`);
}

function hasValidPracticeScope(containerKind: PracticeContainerKind, scopeKind: PracticeScopeKind): boolean {
    return (containerKind === 'course' && scopeKind === 'chapter') || (containerKind === 'problemSet' && scopeKind === 'stage');
}

function assertRevisionRef(ref: PracticeIntegrityRevisionRef): void {
    if (
        !(ref?.revisionId instanceof ObjectId) ||
        !(ref.containerId instanceof ObjectId) ||
        !['course', 'problemSet'].includes(ref.containerKind) ||
        !['chapter', 'stage'].includes(ref.scopeKind) ||
        !hasValidPracticeScope(ref.containerKind, ref.scopeKind) ||
        !Number.isSafeInteger(ref.scopeId) ||
        ref.scopeId <= 0 ||
        !Number.isSafeInteger(ref.revision) ||
        ref.revision <= 0
    ) {
        throw new PracticeIntegrityContextError('revision_integrity_mismatch');
    }
}

function assertPracticeContextTargetTopology(
    primary: ContainerIdentity & { scopeKind: PracticeScopeKind; scopeId: number },
    refs: readonly PracticeIntegrityRevisionRef[],
): void {
    const isPrimary = (ref: PracticeIntegrityRevisionRef) =>
        ref.containerKind === primary.containerKind &&
        ref.containerId.equals(primary.containerId) &&
        ref.scopeKind === primary.scopeKind &&
        ref.scopeId === primary.scopeId;
    if (!refs.some(isPrimary)) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
    if (primary.containerKind === 'problemSet') {
        if (refs.length !== 1 || !isPrimary(refs[0])) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        return;
    }
    if (refs.some((ref) => ref.containerKind === 'course' && !isPrimary(ref))) {
        throw new PracticeIntegrityContextError('revision_integrity_mismatch');
    }
}

function isExpectedDraftCreateConflict(error: unknown, draft: PracticeIntegrityRevisionDoc): boolean {
    if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== 11000) return false;
    const keyPattern = (error as { keyPattern?: unknown }).keyPattern;
    const keyValue = (error as { keyValue?: unknown }).keyValue;
    if (
        !keyPattern ||
        typeof keyPattern !== 'object' ||
        Array.isArray(keyPattern) ||
        !keyValue ||
        typeof keyValue !== 'object' ||
        Array.isArray(keyValue)
    ) {
        return false;
    }
    const keys = Object.keys(keyPattern).sort().join(',');
    const values = keyValue as Record<string, unknown>;
    const sameContainer =
        values.domainId === draft.domainId &&
        values.containerKind === draft.containerKind &&
        String(values.containerId) === draft.containerId.toHexString();
    if (!sameContainer) return false;
    if (keys === ['containerId', 'containerKind', 'domainId', 'revision'].sort().join(',')) return values.revision === draft.revision;
    if (keys === ['containerId', 'containerKind', 'domainId', 'state'].sort().join(',')) return values.state === 'draft';
    return false;
}

export class PracticeIntegrityService {
    private readonly revisions: RevisionCollection;
    private readonly contexts: ContextCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly contextTtlMs: number;
    private indexesPromise?: Promise<void>;

    constructor(options: PracticeIntegrityServiceOptions) {
        this.revisions = options.revisions;
        this.contexts = options.contexts;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.contextTtlMs = options.contextTtlMs ?? 15 * 60_000;
        if (!Number.isSafeInteger(this.contextTtlMs) || this.contextTtlMs <= 0) throw new TypeError('practice context TTL must be positive');
    }

    async ensureIndexes(): Promise<void> {
        if (!this.indexesPromise) {
            this.indexesPromise = Promise.all([
                this.revisions.createIndex(
                    { domainId: 1, containerKind: 1, containerId: 1, revision: 1 },
                    { name: 'practiceIntegrityRevisionIdentity', unique: true },
                ),
                this.revisions.createIndex(
                    { domainId: 1, containerKind: 1, containerId: 1, state: 1 },
                    {
                        name: 'practiceIntegritySingleDraft',
                        unique: true,
                        partialFilterExpression: { state: 'draft' },
                    },
                ),
                this.revisions.createIndex(
                    { domainId: 1, containerKind: 1, containerId: 1, state: 1, revision: -1 },
                    { name: 'practiceIntegrityPublishedLookup' },
                ),
                this.contexts.createIndex({ expiresAt: 1 }, { name: 'practiceContextExpiry', expireAfterSeconds: 0 }),
                this.contexts.createIndex(
                    { domainId: 1, uid: 1, containerKind: 1, containerId: 1, pid: 1, expiresAt: -1 },
                    { name: 'practiceContextLookup' },
                ),
            ])
                .then(() => undefined)
                .catch((error) => {
                    this.indexesPromise = undefined;
                    throw error;
                });
        }
        await this.indexesPromise;
    }

    async getLatestPublished(
        domainId: string,
        containerKind: PracticeContainerKind,
        containerId: ObjectId,
    ): Promise<PracticeIntegrityRevisionDoc | null> {
        assertContainerIdentity({ domainId, containerKind, containerId });
        return await this.revisions.find({ domainId, containerKind, containerId, state: 'published' }).sort({ revision: -1 }).limit(1).next();
    }

    async listLatestPublished(domainId: string): Promise<PracticeIntegrityRevisionDoc[]> {
        if (!domainId) throw new TypeError('invalid practice container identity');
        const published = await this.revisions.find({ domainId, state: 'published' }).sort({ revision: -1 }).toArray();
        const latest = new Map<string, PracticeIntegrityRevisionDoc>();
        for (const revision of published) {
            if (!['course', 'problemSet'].includes(revision.containerKind) || !(revision.containerId instanceof ObjectId)) {
                throw new TypeError(`invalid published practice integrity revision ${revision._id}`);
            }
            const key = `${revision.containerKind}:${revision.containerId.toHexString()}`;
            if (!latest.has(key)) latest.set(key, revision);
        }
        return [...latest.values()];
    }

    async getPolicyState(domainId: string, containerKind: PracticeContainerKind, containerId: ObjectId) {
        assertContainerIdentity({ domainId, containerKind, containerId });
        const [published, draft] = await Promise.all([
            this.getLatestPublished(domainId, containerKind, containerId),
            this.revisions.findOne({ domainId, containerKind, containerId, state: 'draft' }),
        ]);
        return { published, draft };
    }

    async saveDraft(input: SaveDraftInput): Promise<PracticeIntegrityRevisionDoc> {
        assertContainerIdentity(input);
        assertPositiveInteger(input.actorUid, 'actorUid');
        if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 0) {
            throw new TypeError('expectedDraftVersion must be a non-negative integer');
        }
        const policy = canonicalPracticePolicy(input.policy);
        const { published, draft } = await this.getPolicyState(input.domainId, input.containerKind, input.containerId);
        const revision = (published?.revision || 0) + 1;
        const now = this.now();
        if (draft) {
            if (draft.revision !== revision || draft.draftVersion !== input.expectedDraftVersion) {
                throw new PracticeIntegrityConflictError('draft_version_mismatch');
            }
            const result = await this.revisions.updateOne(
                { _id: draft._id, state: 'draft', draftVersion: input.expectedDraftVersion },
                { $set: { policy, updatedBy: input.actorUid, updatedAt: now }, $inc: { draftVersion: 1 } },
            );
            if (result.modifiedCount !== 1) throw new PracticeIntegrityConflictError('draft_version_mismatch');
            const updated = await this.revisions.findOne({ _id: draft._id, state: 'draft' });
            if (!updated) throw new Error(`practice integrity draft disappeared after update: ${draft._id}`);
            return updated;
        }
        if (input.expectedDraftVersion !== 0) throw new PracticeIntegrityConflictError('draft_missing');
        const created: PracticeIntegrityRevisionDoc = {
            _id: this.idFactory(),
            domainId: input.domainId,
            containerKind: input.containerKind,
            containerId: input.containerId,
            revision,
            state: 'draft',
            draftVersion: 1,
            policy,
            createdBy: input.actorUid,
            createdAt: now,
            updatedBy: input.actorUid,
            updatedAt: now,
        };
        try {
            await this.revisions.insertOne(created);
        } catch (error) {
            if (isExpectedDraftCreateConflict(error, created)) throw new PracticeIntegrityConflictError('draft_create_race');
            throw error;
        }
        return created;
    }

    async publishDraft(input: PublishDraftInput): Promise<PracticeIntegrityRevisionDoc> {
        assertContainerIdentity(input);
        assertPositiveInteger(input.actorUid, 'actorUid');
        assertPositiveInteger(input.expectedDraftVersion, 'expectedDraftVersion');
        const draft = await this.revisions.findOne({
            domainId: input.domainId,
            containerKind: input.containerKind,
            containerId: input.containerId,
            state: 'draft',
        });
        if (!draft || draft.draftVersion !== input.expectedDraftVersion) {
            throw new PracticeIntegrityConflictError(draft ? 'draft_version_mismatch' : 'draft_missing');
        }
        const now = this.now();
        const result = await this.revisions.updateOne(
            { _id: draft._id, state: 'draft', draftVersion: input.expectedDraftVersion },
            {
                $set: {
                    state: 'published',
                    updatedBy: input.actorUid,
                    updatedAt: now,
                    publishedBy: input.actorUid,
                    publishedAt: now,
                },
                $unset: { draftVersion: '' },
            },
        );
        if (result.modifiedCount !== 1) throw new PracticeIntegrityConflictError('publish_race');
        const published = await this.revisions.findOne({ _id: draft._id, state: 'published' });
        if (!published) throw new Error(`practice integrity revision disappeared after publish: ${draft._id}`);
        return published;
    }

    private async resolveCanonicalRevisions(
        domainId: string,
        refs: readonly PracticeIntegrityRevisionRef[],
    ): Promise<{ revisions: PracticeIntegrityRevisionDoc[]; policy: PracticeIntegrityPolicy }> {
        if (!refs.length) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        const revisionIds = new Set<string>();
        const containers = new Set<string>();
        const revisions: PracticeIntegrityRevisionDoc[] = [];
        for (const ref of refs) {
            assertRevisionRef(ref);
            const revisionId = ref.revisionId.toHexString();
            const containerIdentity = `${ref.containerKind}:${ref.containerId.toHexString()}`;
            if (revisionIds.has(revisionId) || containers.has(containerIdentity)) {
                throw new PracticeIntegrityContextError('revision_integrity_mismatch');
            }
            revisionIds.add(revisionId);
            containers.add(containerIdentity);
            const revision = await this.revisions.findOne({
                _id: ref.revisionId,
                domainId,
                containerKind: ref.containerKind,
                containerId: ref.containerId,
                revision: ref.revision,
                state: 'published',
            });
            if (!revision || !(revision.publishedAt instanceof Date)) {
                throw new PracticeIntegrityContextError('revision_integrity_mismatch');
            }
            let policy: PracticeIntegrityPolicy;
            try {
                policy = canonicalPracticePolicy(revision.policy);
            } catch {
                throw new PracticeIntegrityContextError('revision_integrity_mismatch');
            }
            revisions.push({ ...revision, policy });
        }
        return { revisions, policy: combinePracticePolicies(revisions.map((revision) => revision.policy)) };
    }

    private async assertLatestPublished(revisions: readonly PracticeIntegrityRevisionDoc[]): Promise<void> {
        const latest = await Promise.all(
            revisions.map((revision) =>
                this.revisions
                    .find({
                        domainId: revision.domainId,
                        containerKind: revision.containerKind,
                        containerId: revision.containerId,
                        state: 'published',
                    })
                    .sort({ revision: -1 })
                    .limit(1)
                    .next(),
            ),
        );
        if (
            latest.some(
                (current, index) =>
                    !current ||
                    !current._id.equals(revisions[index]._id) ||
                    current.revision !== revisions[index].revision ||
                    !(current.publishedAt instanceof Date),
            )
        ) {
            throw new PracticeIntegrityContextError('stale_revision');
        }
    }

    async issueContext(input: IssueContextInput): Promise<PracticeContextDoc> {
        assertContainerIdentity(input);
        assertPositiveInteger(input.uid, 'uid');
        assertPositiveInteger(input.scopeId, 'scopeId');
        assertPositiveInteger(input.pid, 'pid');
        if (!['chapter', 'stage'].includes(input.scopeKind) || !['student', 'preview'].includes(input.mode)) {
            throw new TypeError('invalid practice context scope or mode');
        }
        if (!hasValidPracticeScope(input.containerKind, input.scopeKind)) {
            throw new PracticeIntegrityContextError('scope_container_mismatch');
        }
        const refs = input.targets.map(({ revision, scopeKind, scopeId }) => ({
            revisionId: revision._id,
            containerKind: revision.containerKind,
            containerId: revision.containerId,
            scopeKind,
            scopeId,
            revision: revision.revision,
        }));
        const canonical = await this.resolveCanonicalRevisions(input.domainId, refs);
        assertPracticeContextTargetTopology(input, refs);
        const issuedAt = this.now();
        await this.assertLatestPublished(canonical.revisions);
        const context: PracticeContextDoc = {
            _id: this.idFactory(),
            domainId: input.domainId,
            uid: input.uid,
            containerKind: input.containerKind,
            containerId: input.containerId,
            scopeKind: input.scopeKind,
            scopeId: input.scopeId,
            pid: input.pid,
            mode: input.mode,
            revisions: refs.map((ref) => ({ ...ref })),
            policy: canonical.policy,
            issuedAt,
            expiresAt: new Date(issuedAt.getTime() + this.contextTtlMs),
        };
        await this.contexts.insertOne(context);
        return context;
    }

    async assertContext(input: AssertContextInput): Promise<PracticeContextDoc> {
        assertContainerIdentity(input);
        if (!hasValidPracticeScope(input.containerKind, input.scopeKind)) {
            throw new PracticeIntegrityContextError('scope_container_mismatch');
        }
        let contextId: ObjectId;
        try {
            contextId = new ObjectId(input.contextId);
            if (contextId.toHexString() !== input.contextId.toLowerCase()) throw new Error('non-canonical context id');
        } catch {
            throw new PracticeIntegrityContextError('invalid_context_id');
        }
        const context = await this.contexts.findOne({ _id: contextId });
        if (!context) throw new PracticeIntegrityContextError('context_not_found');
        if (!(context.expiresAt instanceof Date) || context.expiresAt.getTime() <= this.now().getTime()) {
            throw new PracticeIntegrityContextError('expired');
        }
        if (!hasValidPracticeScope(context.containerKind, context.scopeKind)) {
            throw new PracticeIntegrityContextError('context_integrity_mismatch');
        }
        const matches =
            context.domainId === input.domainId &&
            context.uid === input.uid &&
            context.containerKind === input.containerKind &&
            context.containerId.equals(input.containerId) &&
            context.scopeKind === input.scopeKind &&
            context.scopeId === input.scopeId &&
            context.pid === input.pid &&
            context.mode === input.mode;
        if (!matches) throw new PracticeIntegrityContextError('identity_mismatch');
        if (!Array.isArray(context.revisions)) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        const canonical = await this.resolveCanonicalRevisions(context.domainId, context.revisions);
        assertPracticeContextTargetTopology(context, context.revisions);
        let storedPolicy: PracticeIntegrityPolicy;
        try {
            storedPolicy = canonicalPracticePolicy(context.policy);
        } catch {
            throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        }
        if (!samePracticePolicy(storedPolicy, canonical.policy)) {
            throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        }
        return context;
    }

    async assertSubmissionContext(input: AssertSubmissionContextInput): Promise<PracticeContextDoc> {
        assertPositiveInteger(input.uid, 'uid');
        assertPositiveInteger(input.pid, 'pid');
        let contextId: ObjectId;
        try {
            contextId = new ObjectId(input.contextId);
            if (contextId.toHexString() !== input.contextId.toLowerCase()) throw new Error('non-canonical context id');
        } catch {
            throw new PracticeIntegrityContextError('invalid_context_id');
        }
        const context = await this.contexts.findOne({ _id: contextId });
        if (!context) throw new PracticeIntegrityContextError('context_not_found');
        return await this.assertContext({
            contextId: input.contextId,
            domainId: input.domainId,
            uid: input.uid,
            containerKind: context.containerKind,
            containerId: context.containerId,
            scopeKind: context.scopeKind,
            scopeId: context.scopeId,
            pid: input.pid,
            mode: context.mode,
        });
    }
}

export function trustedPracticeContextReference(context: PracticeContextDoc): TrustedPracticeContextReference {
    return canonicalTrustedPracticeContextReference({
        contextId: new ObjectId(context._id),
        domainId: context.domainId,
        uid: context.uid,
        pid: context.pid,
        mode: context.mode,
        containerKind: context.containerKind,
        containerId: new ObjectId(context.containerId),
        scopeKind: context.scopeKind,
        scopeId: context.scopeId,
        targets: context.revisions.map((ref) => ({
            ...ref,
            revisionId: new ObjectId(ref.revisionId),
            containerId: new ObjectId(ref.containerId),
        })),
    });
}

export function canonicalTrustedPracticeContextReference(value: unknown): TrustedPracticeContextReference {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PracticeIntegrityContextError('context_integrity_mismatch');
    }
    const reference = value as TrustedPracticeContextReference;
    if (
        !(reference.contextId instanceof ObjectId) ||
        !(reference.containerId instanceof ObjectId) ||
        typeof reference.domainId !== 'string' ||
        !reference.domainId ||
        !Number.isSafeInteger(reference.uid) ||
        reference.uid <= 0 ||
        !Number.isSafeInteger(reference.pid) ||
        reference.pid <= 0 ||
        !['student', 'preview'].includes(reference.mode) ||
        !['course', 'problemSet'].includes(reference.containerKind) ||
        !['chapter', 'stage'].includes(reference.scopeKind) ||
        !hasValidPracticeScope(reference.containerKind, reference.scopeKind) ||
        !Number.isSafeInteger(reference.scopeId) ||
        reference.scopeId <= 0 ||
        !Array.isArray(reference.targets) ||
        !reference.targets.length
    ) {
        throw new PracticeIntegrityContextError('context_integrity_mismatch');
    }
    const containers = new Set<string>();
    let primary = false;
    const targets = reference.targets.map((target) => {
        assertRevisionRef(target);
        const containerIdentity = `${target.containerKind}:${target.containerId.toHexString()}`;
        if (containers.has(containerIdentity)) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
        containers.add(containerIdentity);
        if (
            target.containerKind === reference.containerKind &&
            target.containerId.equals(reference.containerId) &&
            target.scopeKind === reference.scopeKind &&
            target.scopeId === reference.scopeId
        ) {
            primary = true;
        }
        return {
            ...target,
            revisionId: new ObjectId(target.revisionId),
            containerId: new ObjectId(target.containerId),
        };
    });
    if (!primary) throw new PracticeIntegrityContextError('revision_integrity_mismatch');
    assertPracticeContextTargetTopology(reference, targets);
    return {
        ...reference,
        contextId: new ObjectId(reference.contextId),
        containerId: new ObjectId(reference.containerId),
        targets,
    };
}

export function assertTrustedPracticeContextBinding(
    value: unknown,
    identity: { domainId: string; uid: number; pid: number },
): TrustedPracticeContextReference {
    const reference = canonicalTrustedPracticeContextReference(value);
    if (reference.domainId !== identity.domainId || reference.uid !== identity.uid || reference.pid !== identity.pid) {
        throw new PracticeIntegrityContextError('identity_mismatch');
    }
    return reference;
}

export const practiceIntegrityRevisionColl = db.collection<PracticeIntegrityRevisionDoc>('practice.integrityRevisions');
export const practiceContextColl = db.collection<PracticeContextDoc>('practice.contexts');
export const practiceIntegrityService = new PracticeIntegrityService({
    revisions: practiceIntegrityRevisionColl,
    contexts: practiceContextColl,
});

export async function apply(ctx: any): Promise<void> {
    await practiceIntegrityService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => practiceIntegrityRevisionColl.deleteMany({ domainId }),
            () => practiceContextColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.practiceIntegrity = {
    assertTrustedPracticeContextBinding,
    canonicalPracticePolicy,
    combinePracticePolicies,
    practiceIntegrityRevisionColl,
    practiceContextColl,
    practiceIntegrityService,
    canonicalTrustedPracticeContextReference,
    trustedPracticeContextReference,
};
