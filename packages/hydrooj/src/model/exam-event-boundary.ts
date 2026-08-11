import type { ObjectId } from 'mongodb';

const examEventBoundaryTails = new Map<string, Promise<void>>();

/**
 * Serializes the short cross-collection invariant boundary for one ExamEvent.
 *
 * This site runs one Hydro process. Event scope/lifecycle changes and their
 * network assignment/config writes share this gate so Mongo document-level
 * CAS cannot leave a new-school event pointing at old-school network facts.
 */
export async function withExamEventBoundary<T>(domainId: string, eventId: ObjectId, work: () => Promise<T>): Promise<T> {
    const key = `${domainId}\0${eventId.toHexString()}`;
    const previous = examEventBoundaryTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    examEventBoundaryTails.set(key, current);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (examEventBoundaryTails.get(key) === current) examEventBoundaryTails.delete(key);
    }
}
