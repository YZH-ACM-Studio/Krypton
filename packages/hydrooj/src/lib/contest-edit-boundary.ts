import type { ObjectId } from 'mongodb';

const contestEditBoundaryTails = new Map<string, Promise<void>>();

export async function withContestEditBoundary<T>(domainId: string, contestId: ObjectId | string, work: (waited: boolean) => Promise<T>): Promise<T> {
    const key = `${domainId}:${contestId.toString()}`;
    const previous = contestEditBoundaryTails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    contestEditBoundaryTails.set(key, current);
    if (previous) await previous;
    try {
        return await work(!!previous);
    } finally {
        release();
        if (contestEditBoundaryTails.get(key) === current) contestEditBoundaryTails.delete(key);
    }
}
