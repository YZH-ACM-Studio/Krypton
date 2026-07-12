import type { PermitRole } from './types';

export type PermitSourceType = 'direct' | 'contest';
export type AclMutationStep = 'source' | 'canonical' | 'mirror' | 'verify';

export interface AclPair {
    domainId: string;
    pid: number;
    uid: number;
}

export interface PermitSource extends AclPair {
    sourceType: PermitSourceType;
    sourceId: string;
    role: PermitRole;
    active: true;
    grantedBy: number;
    grantedAt: Date;
    note: string;
}

export interface CanonicalPermit extends AclPair {
    role: PermitRole;
    active: true;
    grantedBy: number;
    grantedAt: Date;
    viaContest: string | null;
    note: string;
}

export interface AclMutationIntent {
    action?: 'set-source' | 'reconcile';
    sourceType: PermitSourceType;
    sourceId: string;
    role: PermitRole | null;
    grantedBy: number;
    note: string;
}

export interface AclMutationFence extends AclPair {
    requestId: string;
    from: PermitRole | null;
    to: PermitRole | null;
    intent: AclMutationIntent;
    completedSteps: AclMutationStep[];
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    /** Global ProblemDoc write claim that owns this ACL mutation, if any. */
    writeClaimRequestId?: string | null;
}

/**
 * Durable write latch embedded in the ProblemDoc. It is deliberately created
 * before the cross-collection fence so a failed fence insert still blocks
 * stale problem mutations and carries enough intent for same-request repair.
 */
export interface ProblemAclMutationLock extends AclPair {
    requestId: string;
    from: PermitRole | null;
    to: PermitRole | null;
    intent: AclMutationIntent;
    createdAt: Date;
    updatedAt: Date;
    writeClaimRequestId?: string | null;
}

export interface AclMutationInput extends AclPair {
    requestId: string;
    sourceType: PermitSourceType;
    sourceId: string;
    role: PermitRole | null;
    grantedBy: number;
    note?: string;
    reconcileOnly?: boolean;
    writeClaimRequestId?: string;
}

export interface AclRepository {
    getCanonical(pair: AclPair): Promise<CanonicalPermit | null>;
    getSources(pair: AclPair): Promise<PermitSource[]>;
    getFence(pair: AclPair): Promise<AclMutationFence | null>;
    getProblemAclMutationLock(pair: AclPair): Promise<ProblemAclMutationLock | null>;
    beginProblemAclMutation(lock: ProblemAclMutationLock): Promise<ProblemAclMutationLock>;
    clearProblemAclMutation(pair: AclPair, requestId: string): Promise<void>;
    createFence(fence: AclMutationFence): Promise<void>;
    updateFence(
        pair: AclPair,
        requestId: string,
        patch: Partial<AclMutationFence>,
    ): Promise<void>;
    applySource(fence: AclMutationFence): Promise<void>;
    writeCanonical(pair: AclPair, expected: CanonicalPermit | null): Promise<void>;
    writeMirror(pair: AclPair, maintain: boolean): Promise<void>;
    mirrorHas(pair: AclPair): Promise<boolean>;
    deleteFence(pair: AclPair, requestId: string): Promise<void>;
    withMutationTransaction?<T>(work: (transactional: AclRepository) => Promise<T>): Promise<T>;
}

export class AclMutationError extends Error {
    status = 500;

    constructor(
        message: string,
        public readonly pair: AclPair,
        public readonly requestId: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'AclMutationError';
    }
}

export class AclMutationConflictError extends AclMutationError {
    status = 409;

    constructor(pair: AclPair, requestId: string, activeRequestId: string) {
        super(
            `ACL pair is fenced by request ${activeRequestId}; request ${requestId} cannot proceed`,
            pair,
            requestId,
        );
        this.name = 'AclMutationConflictError';
    }
}

export function sameAclMutationIntent(a: AclMutationIntent, b: AclMutationIntent): boolean {
    return (a.action || 'set-source') === (b.action || 'set-source')
        && a.sourceType === b.sourceType
        && a.sourceId === b.sourceId
        && a.role === b.role
        && a.grantedBy === b.grantedBy
        && a.note === b.note;
}

function sourceIdentity(source: Pick<PermitSource, 'sourceType' | 'sourceId'>): string {
    return `${source.sourceType}:${source.sourceId}`;
}

export function applyIntentToSources(
    sources: PermitSource[], pair: AclPair, intent: AclMutationIntent, now: Date,
): PermitSource[] {
    if (intent.action === 'reconcile') return sources.slice();
    const identity = `${intent.sourceType}:${intent.sourceId}`;
    const next = sources.filter((source) => sourceIdentity(source) !== identity);
    if (intent.role) {
        next.push({
            ...pair,
            sourceType: intent.sourceType,
            sourceId: intent.sourceId,
            role: intent.role,
            active: true,
            grantedBy: intent.grantedBy,
            grantedAt: now,
            note: intent.note,
        });
    }
    return next;
}

function sourceRank(source: PermitSource): number {
    if (source.sourceType === 'direct') return 3;
    if (source.role === 'maintainer') return 2;
    return 1;
}

export function deriveCanonicalPermit(
    pair: AclPair, sources: PermitSource[],
): CanonicalPermit | null {
    const selected = sources
        .filter((source) => source.active === true)
        .sort((a, b) => sourceRank(b) - sourceRank(a)
            || sourceIdentity(a).localeCompare(sourceIdentity(b)))[0];
    if (!selected) return null;
    return {
        ...pair,
        role: selected.role,
        active: true,
        grantedBy: selected.grantedBy,
        grantedAt: selected.grantedAt,
        viaContest: selected.sourceType === 'contest' ? selected.sourceId : null,
        note: selected.note,
    };
}

function canonicalMatches(
    actual: CanonicalPermit | null, expected: CanonicalPermit | null,
): boolean {
    if (!actual || !expected) return actual === expected;
    return actual.domainId === expected.domainId
        && actual.pid === expected.pid
        && actual.uid === expected.uid
        && actual.active === true
        && actual.role === expected.role
        && actual.grantedBy === expected.grantedBy
        && actual.viaContest === expected.viaContest
        && actual.note === expected.note;
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function createAclCoordinator(
    repo: AclRepository,
    options: { now?: () => Date } = {},
) {
    const now = options.now || (() => new Date());

    async function createOrResumeFence(input: AclMutationInput): Promise<AclMutationFence> {
        const pair: AclPair = { domainId: input.domainId, pid: input.pid, uid: input.uid };
        const intent: AclMutationIntent = {
            action: input.reconcileOnly ? 'reconcile' : 'set-source',
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            role: input.role,
            grantedBy: input.grantedBy,
            note: input.note || '',
        };
        let [existing, problemLock] = await Promise.all([
            repo.getFence(pair),
            repo.getProblemAclMutationLock(pair),
        ]);
        const validateOwnerAndIntent = (
            marker: Pick<AclMutationFence, 'requestId' | 'intent' | 'writeClaimRequestId'>,
        ) => {
            if (marker.requestId !== input.requestId) {
                throw new AclMutationConflictError(pair, input.requestId, marker.requestId);
            }
            if (!sameAclMutationIntent(marker.intent, intent)) {
                throw new AclMutationError(
                    `requestId ${input.requestId} was reused with a different ACL intent`,
                    pair,
                    input.requestId,
                );
            }
            if ((marker.writeClaimRequestId || null) !== (input.writeClaimRequestId || null)) {
                throw new AclMutationError(
                    `requestId ${input.requestId} was reused with a different problem write claim`,
                    pair,
                    input.requestId,
                );
            }
        };
        if (existing) validateOwnerAndIntent(existing);
        if (problemLock) validateOwnerAndIntent(problemLock);

        let fence = existing;
        if (!fence) {
            if (problemLock) {
                fence = {
                    ...problemLock,
                    completedSteps: [],
                    lastError: null,
                };
            } else {
                const [canonical, sources] = await Promise.all([
                    repo.getCanonical(pair),
                    repo.getSources(pair),
                ]);
                const createdAt = now();
                const target = deriveCanonicalPermit(
                    pair,
                    applyIntentToSources(sources, pair, intent, createdAt),
                );
                fence = {
                    ...pair,
                    requestId: input.requestId,
                    from: canonical?.role || null,
                    to: target?.role || null,
                    intent,
                    completedSteps: [],
                    lastError: null,
                    createdAt,
                    updatedAt: createdAt,
                    writeClaimRequestId: input.writeClaimRequestId || null,
                };
            }
        }

        if (!problemLock) {
            const lock: ProblemAclMutationLock = {
                domainId: fence.domainId,
                pid: fence.pid,
                uid: fence.uid,
                requestId: fence.requestId,
                from: fence.from,
                to: fence.to,
                intent: fence.intent,
                createdAt: fence.createdAt,
                updatedAt: now(),
                writeClaimRequestId: fence.writeClaimRequestId || null,
            };
            try {
                problemLock = await repo.beginProblemAclMutation(lock);
            } catch (error) {
                problemLock = await repo.getProblemAclMutationLock(pair);
                if (problemLock) validateOwnerAndIntent(problemLock);
                else throw error;
            }
        }

        if (existing) return existing;
        try {
            await repo.createFence(fence);
            return fence;
        } catch (error) {
            existing = await repo.getFence(pair);
            if (existing?.requestId === input.requestId
                && sameAclMutationIntent(existing.intent, intent)) {
                return existing;
            }
            if (existing) {
                throw new AclMutationConflictError(pair, input.requestId, existing.requestId);
            }
            throw error;
        }
    }

    async function mutate(input: AclMutationInput): Promise<CanonicalPermit | null> {
        const pair: AclPair = { domainId: input.domainId, pid: input.pid, uid: input.uid };
        let fence: AclMutationFence | null = null;
        try {
            fence = await createOrResumeFence(input);
            const runSteps = async (activeRepo: AclRepository) => {
                const completed = [...fence!.completedSteps];
                const complete = async (step: AclMutationStep) => {
                    if (!completed.includes(step)) completed.push(step);
                    await activeRepo.updateFence(pair, input.requestId, {
                        completedSteps: completed,
                        lastError: null,
                        updatedAt: now(),
                    });
                };

                if (!completed.includes('source')) {
                    await activeRepo.applySource(fence!);
                    await complete('source');
                }

                let expected = deriveCanonicalPermit(pair, await activeRepo.getSources(pair));
                if (!completed.includes('canonical')) {
                    await activeRepo.writeCanonical(pair, expected);
                    await complete('canonical');
                }

                if (!completed.includes('mirror')) {
                    await activeRepo.writeMirror(pair, expected?.role === 'maintainer');
                    await complete('mirror');
                }

                if (!completed.includes('verify')) {
                    expected = deriveCanonicalPermit(pair, await activeRepo.getSources(pair));
                    const [actual, mirror] = await Promise.all([
                        activeRepo.getCanonical(pair),
                        activeRepo.mirrorHas(pair),
                    ]);
                    if (!canonicalMatches(actual, expected)) {
                        throw new Error('canonical permit does not match active source precedence');
                    }
                    if (mirror !== (expected?.role === 'maintainer')) {
                        throw new Error('legacy maintainer mirror does not match canonical maintainer role');
                    }
                    await complete('verify');
                }
                return expected;
            };
            const expected = repo.withMutationTransaction
                ? await repo.withMutationTransaction(runSteps)
                : await runSteps(repo);
            // Verification is complete before either deny marker is cleared.
            // Clear the cross-collection fence first. If clearing the embedded
            // ProblemDoc lock fails, the remaining lock still blocks both ACL
            // reads and global problem writes and is resumable by requestId.
            await repo.deleteFence(pair, input.requestId);
            await repo.clearProblemAclMutation(pair, input.requestId);
            return expected;
        } catch (error) {
            if (fence) {
                try {
                    await repo.updateFence(pair, input.requestId, {
                        lastError: errorText(error),
                        updatedAt: now(),
                    });
                } catch (fenceError) {
                    throw new AclMutationError(
                        `${errorText(error)}; additionally failed to persist fence error: ${errorText(fenceError)}`,
                        pair,
                        input.requestId,
                        { cause: error },
                    );
                }
            }
            if (error instanceof AclMutationError) throw error;
            throw new AclMutationError(
                `ACL mutation ${input.requestId} failed: ${errorText(error)}`,
                pair,
                input.requestId,
                { cause: error },
            );
        }
    }

    return { mutate };
}
