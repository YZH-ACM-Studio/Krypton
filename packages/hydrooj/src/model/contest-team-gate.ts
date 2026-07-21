import type { ObjectId } from 'mongodb';

const contestTeamBoundaryTails = new Map<string, Promise<void>>();

/**
 * Serializes the short ContestTeam read/write boundary for one contest.
 *
 * This site runs one Hydro application process. Keeping the gate in-process
 * avoids a transaction or lock service while preventing readers and ordinary
 * team mutations from interleaving with P1.17's multi-document activation.
 */
export async function withContestTeamBoundary<T>(domainId: string, contestId: ObjectId, work: () => Promise<T>): Promise<T> {
    const key = `${domainId}:${contestId.toHexString()}`;
    const previous = contestTeamBoundaryTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    contestTeamBoundaryTails.set(key, current);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (contestTeamBoundaryTails.get(key) === current) contestTeamBoundaryTails.delete(key);
    }
}
