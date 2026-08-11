import { allSettledOrThrow } from '../lib/all-settled';

const activeDomainMutations = new Map<string, Set<Promise<void>>>();
const domainDeletionOperations = new Map<string, Promise<unknown>>();

/** A domain cleanup listener must not abandon sibling writes after one fails. */
export function settleDomainCleanupOperations(domainId: string, operations: ReadonlyArray<() => unknown>): Promise<void> {
    return allSettledOrThrow(operations, `Multiple cleanup operations failed for domain ${domainId}`);
}

/** After the domain root is gone, dependent cleanup and cache invalidation must run even if user cleanup fails. */
export async function settleDeletedDomainOperations(
    domainId: string,
    deleteUsers: () => unknown,
    deleteDependents: () => unknown,
    invalidateCache: () => unknown,
): Promise<void> {
    const userCleanup = Promise.resolve().then(deleteUsers);
    await allSettledOrThrow(
        [
            () => userCleanup,
            async () => {
                await userCleanup.catch(() => undefined);
                await deleteDependents();
            },
            invalidateCache,
        ],
        `Multiple post-root cleanup operations failed for domain ${domainId}`,
    );
}

/**
 * Allows unrelated domain mutations to run concurrently while making domain
 * deletion an exclusive lifecycle transition. A mutation that arrives after
 * deletion starts waits for cleanup and must then re-read its canonical roots.
 */
export async function withDomainLifecycleMutation<T>(domainId: string, work: () => Promise<T>): Promise<T> {
    for (;;) {
        const deletion = domainDeletionOperations.get(domainId);
        if (deletion) {
            await deletion;
            continue;
        }

        let release!: () => void;
        const completion = new Promise<void>((resolve) => {
            release = resolve;
        });
        const active = activeDomainMutations.get(domainId) || new Set<Promise<void>>();
        active.add(completion);
        activeDomainMutations.set(domainId, active);

        const racedDeletion = domainDeletionOperations.get(domainId);
        if (racedDeletion) {
            active.delete(completion);
            if (!active.size) activeDomainMutations.delete(domainId);
            release();
            await racedDeletion;
            continue;
        }

        try {
            return await work();
        } finally {
            active.delete(completion);
            if (!active.size) activeDomainMutations.delete(domainId);
            release();
        }
    }
}

/**
 * Publishes the deletion barrier before waiting for in-flight mutations, then
 * keeps it held through the domain row delete and every registered cleanup.
 */
export async function withDomainLifecycleDeletion<T>(domainId: string, work: () => Promise<T>): Promise<T> {
    const previous = domainDeletionOperations.get(domainId);
    const operation = (async () => {
        if (previous) await previous;
        const active = activeDomainMutations.get(domainId);
        if (active?.size) await Promise.all([...active]);
        return work();
    })();
    domainDeletionOperations.set(domainId, operation);
    try {
        return await operation;
    } finally {
        if (domainDeletionOperations.get(domainId) === operation) domainDeletionOperations.delete(domainId);
    }
}
