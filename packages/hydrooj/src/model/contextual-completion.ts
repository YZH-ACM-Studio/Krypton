import { Collection, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { Context } from '../context';
import type { RecordDoc } from '../interface';
import db from '../service/db';
import { STATUS, STATUS_CODES } from './builtin';
import {
    assertTrustedPracticeContextBinding,
    type PracticeContainerKind,
    type PracticeScopeKind,
    type TrustedPracticeContextReference,
} from './practice-integrity';

const logger = new Logger('contextual-completion');

export interface ContextualCompletionDoc {
    _id: ObjectId;
    domainId: string;
    uid: number;
    pid: number;
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopeKind: PracticeScopeKind;
    scopeId: number;
    revisionId: ObjectId;
    revision: number;
    rid: ObjectId;
    contextId: ObjectId;
    completedAt: Date;
}

type CompletionCollection = Pick<Collection<ContextualCompletionDoc>, 'createIndex' | 'find' | 'updateOne' | 'deleteMany'>;

interface ContextualCompletionServiceOptions {
    completions: CompletionCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    logger?: CompletionLogger;
}

interface CompletionLogger {
    info(format: string, ...args: unknown[]): void;
    error(format: string, ...args: unknown[]): void;
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function assertTrustedReference(reference: TrustedPracticeContextReference, rdoc: RecordDoc): TrustedPracticeContextReference {
    if (!rdoc.domainId || !isPositiveInteger(rdoc.uid) || !isPositiveInteger(rdoc.pid)) {
        throw new TypeError(`invalid trusted practice context on record ${rdoc._id}`);
    }
    return assertTrustedPracticeContextBinding(reference, { domainId: rdoc.domainId, uid: rdoc.uid, pid: rdoc.pid });
}

const COMPLETION_IDENTITY_KEYS = ['domainId', 'uid', 'containerKind', 'containerId', 'scopeKind', 'scopeId', 'pid', 'revisionId'] as const;

function sameMongoValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

function isExactDuplicateIdentity(error: unknown, identity: Record<(typeof COMPLETION_IDENTITY_KEYS)[number], unknown>): boolean {
    if (!error || typeof error !== 'object') return false;
    const duplicate = error as { code?: unknown; keyPattern?: unknown; keyValue?: unknown };
    if (
        duplicate.code !== 11000 ||
        !duplicate.keyPattern ||
        typeof duplicate.keyPattern !== 'object' ||
        !duplicate.keyValue ||
        typeof duplicate.keyValue !== 'object'
    ) {
        return false;
    }
    const pattern = duplicate.keyPattern as Record<string, unknown>;
    const values = duplicate.keyValue as Record<string, unknown>;
    return (
        Object.keys(pattern).length === COMPLETION_IDENTITY_KEYS.length &&
        COMPLETION_IDENTITY_KEYS.every((key) => pattern[key] === 1 && Object.hasOwn(values, key) && sameMongoValue(values[key], identity[key]))
    );
}

function distinctErrors(results: PromiseSettledResult<void>[]): unknown[] {
    const errors: unknown[] = [];
    const seen = new Set<unknown>();
    for (const result of results) {
        if (result.status !== 'rejected') continue;
        const nested = result.reason instanceof AggregateError ? result.reason.errors : [result.reason];
        for (const error of nested) {
            if (seen.has(error)) continue;
            seen.add(error);
            errors.push(error);
        }
    }
    return errors;
}

export class ContextualCompletionService {
    private readonly completions: CompletionCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly logger: CompletionLogger;
    private indexesPromise?: Promise<void>;

    constructor(options: ContextualCompletionServiceOptions) {
        this.completions = options.completions;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.logger = options.logger || logger;
    }

    async ensureIndexes(): Promise<void> {
        if (!this.indexesPromise) {
            this.indexesPromise = Promise.all([
                this.completions.createIndex(
                    { domainId: 1, uid: 1, containerKind: 1, containerId: 1, scopeKind: 1, scopeId: 1, pid: 1, revisionId: 1 },
                    { name: 'contextualCompletionIdentity', unique: true },
                ),
                this.completions.createIndex(
                    { domainId: 1, uid: 1, containerKind: 1, containerId: 1, scopeKind: 1, scopeId: 1, pid: 1 },
                    { name: 'contextualCompletionProgress' },
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

    async recordJudge(rdoc: RecordDoc): Promise<void> {
        if (!rdoc.practiceContext) return;
        let practiceContext: TrustedPracticeContextReference;
        try {
            practiceContext = assertTrustedReference(rdoc.practiceContext, rdoc);
        } catch (error) {
            const rawContextId = rdoc.practiceContext.contextId instanceof ObjectId ? rdoc.practiceContext.contextId.toHexString() : 'invalid';
            this.logger.error(
                'Contextual completion rejected domain=%s rid=%s contextId=%s uid=%o pid=%o stage=context-validation result=failed error=%s',
                rdoc.domainId,
                rdoc._id,
                rawContextId,
                rdoc.uid,
                rdoc.pid,
                error instanceof Error ? error.name : 'unknown',
            );
            throw error;
        }
        const contextId = practiceContext.contextId.toHexString();
        const logTargets = (level: 'info' | 'error', result: string, error?: unknown) => {
            for (const target of practiceContext.targets) {
                this.logger[level](
                    `Contextual completion domain=%s rid=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revision=%d stage=judge-callback result=${result} status=%o${error ? ' error=%s' : ''}`,
                    rdoc.domainId,
                    rdoc._id,
                    contextId,
                    rdoc.uid,
                    target.containerKind,
                    target.containerId,
                    target.scopeKind,
                    target.scopeId,
                    rdoc.pid,
                    target.revision,
                    rdoc.status,
                    ...(error ? [error instanceof Error ? error.name : 'unknown'] : []),
                );
            }
        };
        if (typeof rdoc.status !== 'number' || !Number.isInteger(rdoc.status) || !Object.hasOwn(STATUS_CODES, rdoc.status)) {
            logTargets('error', 'unknown-status');
            throw new TypeError(`unknown judge status ${rdoc.status} on contextual record ${rdoc._id}`);
        }
        if (rdoc.contest) {
            if (rdoc.contest.equals(new ObjectId('000000000000000000000000'))) {
                logTargets('info', 'pretest');
                return;
            }
            const error = new TypeError(`contest record ${rdoc._id} unexpectedly carries a practice context`);
            logTargets('error', 'unexpected-contest', error);
            throw error;
        }
        if (practiceContext.mode === 'preview' || rdoc.status !== STATUS.STATUS_ACCEPTED) {
            logTargets('info', practiceContext.mode === 'preview' ? 'preview' : 'not-accepted');
            return;
        }
        const completedAt = this.now();
        const writes = practiceContext.targets.map(async (target) => {
            const identity = {
                domainId: rdoc.domainId,
                uid: rdoc.uid,
                containerKind: target.containerKind,
                containerId: target.containerId,
                scopeKind: target.scopeKind,
                scopeId: target.scopeId,
                pid: rdoc.pid,
                revisionId: target.revisionId,
            };
            const completion: ContextualCompletionDoc = {
                _id: this.idFactory(),
                ...identity,
                revision: target.revision,
                rid: rdoc._id,
                contextId: practiceContext.contextId,
                completedAt,
            };
            try {
                const result = await this.completions.updateOne(identity, { $setOnInsert: completion }, { upsert: true });
                this.logger.info(
                    'Contextual completion domain=%s rid=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revision=%d stage=completion-write result=%s',
                    rdoc.domainId,
                    rdoc._id,
                    contextId,
                    rdoc.uid,
                    target.containerKind,
                    target.containerId,
                    target.scopeKind,
                    target.scopeId,
                    rdoc.pid,
                    target.revision,
                    result.upsertedCount === 1 ? 'created' : 'duplicate',
                );
            } catch (error) {
                if (isExactDuplicateIdentity(error, identity)) {
                    this.logger.info(
                        'Contextual completion domain=%s rid=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revision=%d stage=completion-write result=duplicate',
                        rdoc.domainId,
                        rdoc._id,
                        contextId,
                        rdoc.uid,
                        target.containerKind,
                        target.containerId,
                        target.scopeKind,
                        target.scopeId,
                        rdoc.pid,
                        target.revision,
                    );
                    return;
                }
                this.logger.error(
                    'Contextual completion domain=%s rid=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revision=%d stage=completion-write result=failed error=%s',
                    rdoc.domainId,
                    rdoc._id,
                    contextId,
                    rdoc.uid,
                    target.containerKind,
                    target.containerId,
                    target.scopeKind,
                    target.scopeId,
                    rdoc.pid,
                    target.revision,
                    error instanceof Error ? error.name : 'unknown',
                );
                throw error;
            }
        });
        const errors = distinctErrors(await Promise.allSettled(writes));
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, `contextual completion failed for ${errors.length} targets`);
    }

    async getCompletedByScope(
        domainId: string,
        uid: number,
        containerKind: PracticeContainerKind,
        containerId: ObjectId,
    ): Promise<Map<number, Set<number>>> {
        const docs = await this.completions.find({ domainId, uid, containerKind, containerId }).project({ scopeId: 1, pid: 1 }).toArray();
        const result = new Map<number, Set<number>>();
        for (const doc of docs) {
            if (!isPositiveInteger(doc.scopeId) || !isPositiveInteger(doc.pid)) {
                throw new TypeError(`invalid contextual completion projection for ${domainId}/${containerId}`);
            }
            const pids = result.get(doc.scopeId) || new Set<number>();
            pids.add(doc.pid);
            result.set(doc.scopeId, pids);
        }
        return result;
    }

    async getCompletedCounts(
        domainId: string,
        uids: readonly number[],
        containerKind: PracticeContainerKind,
        containerId: ObjectId,
        currentScopePids?: ReadonlyMap<number, ReadonlySet<number>>,
    ): Promise<Map<number, number>> {
        if (!uids.length) return new Map();
        const docs = await this.completions
            .find({ domainId, uid: { $in: [...new Set(uids)] }, containerKind, containerId })
            .project({ uid: 1, scopeId: 1, pid: 1 })
            .toArray();
        const identities = new Map<number, Set<string>>();
        for (const doc of docs) {
            if (!isPositiveInteger(doc.uid) || !isPositiveInteger(doc.scopeId) || !isPositiveInteger(doc.pid)) {
                throw new TypeError(`invalid contextual completion count projection for ${domainId}/${containerId}`);
            }
            if (currentScopePids && !currentScopePids.get(doc.scopeId)?.has(doc.pid)) continue;
            const completed = identities.get(doc.uid) || new Set<string>();
            completed.add(`${doc.scopeId}:${doc.pid}`);
            identities.set(doc.uid, completed);
        }
        return new Map([...identities].map(([uid, completed]) => [uid, completed.size]));
    }

    async getCompletedPidsByUsers(
        domainId: string,
        uids: readonly number[],
        containerKind: PracticeContainerKind,
        containerId: ObjectId,
        currentScopePids?: ReadonlyMap<number, ReadonlySet<number>>,
    ): Promise<Map<number, Set<number>>> {
        if (!uids.length) return new Map();
        const docs = await this.completions
            .find({ domainId, uid: { $in: [...new Set(uids)] }, containerKind, containerId })
            .project({ uid: 1, scopeId: 1, pid: 1 })
            .toArray();
        const result = new Map<number, Set<number>>();
        for (const doc of docs) {
            if (!isPositiveInteger(doc.uid) || !isPositiveInteger(doc.scopeId) || !isPositiveInteger(doc.pid)) {
                throw new TypeError(`invalid contextual completion pid projection for ${domainId}/${containerId}`);
            }
            if (currentScopePids && !currentScopePids.get(doc.scopeId)?.has(doc.pid)) continue;
            const completed = result.get(doc.uid) || new Set<number>();
            completed.add(doc.pid);
            result.set(doc.uid, completed);
        }
        return result;
    }
}

export const contextualCompletionColl = db.collection<ContextualCompletionDoc>('practice.contextualCompletions');
export const contextualCompletionService = new ContextualCompletionService({ completions: contextualCompletionColl });

export async function apply(ctx: Context): Promise<void> {
    await contextualCompletionService.ensureIndexes();
    ctx.on('record/judge', async (rdoc: RecordDoc) => contextualCompletionService.recordJudge(rdoc));
    ctx.on('domain/delete', (domainId: string) => contextualCompletionColl.deleteMany({ domainId }));
}

global.Hydro.model.contextualCompletion = {
    contextualCompletionColl,
    contextualCompletionService,
};
