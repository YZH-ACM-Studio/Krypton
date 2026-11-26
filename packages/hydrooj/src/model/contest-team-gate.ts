import type { ObjectId } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';

const contestTeamBoundaryTails = new Map<string, Promise<void>>();
interface Ownership {
    active: boolean;
    nested: number;
    idle?: () => void;
}
const owned = new AsyncLocalStorage<ReadonlyMap<string, Ownership>>();

/**
 * Serializes the short ContestTeam read/write boundary for one contest.
 *
 * This site runs one Hydro application process. Keeping the gate in-process
 * avoids a transaction or lock service while preventing readers and ordinary
 * team mutations from interleaving with P1.17's multi-document activation.
 */
export async function withContestTeamBoundary<T>(domainId: string, contestId: ObjectId, work: () => Promise<T>): Promise<T> {
    const key = `${domainId}:${contestId.toHexString()}`;
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
    const previous = contestTeamBoundaryTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    contestTeamBoundaryTails.set(key, current);
    await previous;
    const ownership: Ownership = { active: true, nested: 0 };
    try {
        return await owned.run(new Map([...(owned.getStore() ?? []), [key, ownership]]), work);
    } finally {
        while (ownership.nested) await new Promise<void>((resolve) => { ownership.idle = resolve; });
        ownership.active = false;
        release();
        if (contestTeamBoundaryTails.get(key) === current) contestTeamBoundaryTails.delete(key);
    }
}
