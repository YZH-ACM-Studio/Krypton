import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObjectId } from 'mongodb';

const tails = new Map<string, Promise<void>>();
interface Ownership {
    active: boolean;
    nested: number;
    idle?: () => void;
}
const owned = new AsyncLocalStorage<ReadonlyMap<string, Ownership>>();

/** Serialize answer, score and correction writes for one formal participant. */
export async function withSetParticipantBoundary<T>(
    domainId: string,
    tid: ObjectId | string,
    participantKey: string,
    work: () => Promise<T>,
): Promise<T> {
    const key = JSON.stringify([domainId, tid.toString(), participantKey]);
    const inherited = owned.getStore()?.get(key);
    if (inherited?.active) {
        inherited.nested++;
        try {
            return await work();
        } finally {
            inherited.nested--;
            if (!inherited.nested) inherited.idle?.();
        }
    }
    const previous = tails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    tails.set(key, current);
    if (previous) await previous;
    const ownership: Ownership = { active: true, nested: 0 };
    try {
        return await owned.run(new Map([...(owned.getStore() ?? []), [key, ownership]]), work);
    } finally {
        while (ownership.nested) await new Promise<void>((resolve) => { ownership.idle = resolve; });
        ownership.active = false;
        release();
        if (tails.get(key) === current) tails.delete(key);
    }
}
