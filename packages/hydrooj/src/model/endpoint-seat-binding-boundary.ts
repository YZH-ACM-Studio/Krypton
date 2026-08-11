import type { ObjectId } from 'mongodb';
import { withDomainLifecycleMutation } from './domain-lifecycle-boundary';

const activeClassroomMutations = new Map<string, Set<Promise<void>>>();
const classroomWindowTransitions = new Map<string, Promise<void>>();
const endpointSeatMutationTails = new Map<string, Promise<void>>();
const endpointSeatWindowDocumentTails = new Map<string, Promise<void>>();

function classroomKey(domainId: string, classroomId: ObjectId): string {
    return `${domainId}\0${classroomId.toHexString()}`;
}

async function withClassroomMutation<T>(key: string, work: () => Promise<T>): Promise<T> {
    for (;;) {
        const transition = classroomWindowTransitions.get(key);
        if (transition) {
            await transition;
            continue;
        }
        let release!: () => void;
        const completion = new Promise<void>((resolve) => {
            release = resolve;
        });
        const active = activeClassroomMutations.get(key) || new Set<Promise<void>>();
        active.add(completion);
        activeClassroomMutations.set(key, active);
        const racedTransition = classroomWindowTransitions.get(key);
        if (racedTransition) {
            active.delete(completion);
            if (!active.size) activeClassroomMutations.delete(key);
            release();
            await racedTransition;
            continue;
        }
        try {
            return await work();
        } finally {
            active.delete(completion);
            if (!active.size) activeClassroomMutations.delete(key);
            release();
        }
    }
}

async function withClassroomWindowTransition<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = classroomWindowTransitions.get(key);
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
        release = resolve;
    });
    classroomWindowTransitions.set(key, completion);
    if (previous) await previous;
    const active = activeClassroomMutations.get(key);
    if (active?.size) await Promise.all([...active]);
    try {
        return await work();
    } finally {
        release();
        if (classroomWindowTransitions.get(key) === completion) classroomWindowTransitions.delete(key);
    }
}

/**
 * Serializes one physical seat while allowing independent seats in the same
 * classroom to proceed concurrently. Window open/close transitions are an
 * exclusive classroom phase, so they cannot cross a binding/window recovery.
 */
export async function withEndpointSeatMutationBoundary<T>(
    domainId: string,
    classroomId: ObjectId,
    sourceSeatId: string,
    work: () => Promise<T>,
): Promise<T> {
    return withDomainLifecycleMutation(domainId, () =>
        withClassroomMutation(classroomKey(domainId, classroomId), async () => {
            const key = `${classroomKey(domainId, classroomId)}\0${sourceSeatId}`;
            const previous = endpointSeatMutationTails.get(key) || Promise.resolve();
            let release!: () => void;
            const current = new Promise<void>((resolve) => {
                release = resolve;
            });
            endpointSeatMutationTails.set(key, current);
            await previous;
            try {
                return await work();
            } finally {
                release();
                if (endpointSeatMutationTails.get(key) === current) endpointSeatMutationTails.delete(key);
            }
        }),
    );
}

export async function withEndpointSeatWindowTransitionBoundary<T>(domainId: string, classroomId: ObjectId, work: () => Promise<T>): Promise<T> {
    return withDomainLifecycleMutation(domainId, () => withClassroomWindowTransition(classroomKey(domainId, classroomId), work));
}

/** Serializes only the short whole-document CAS section for one retained window. */
export async function withEndpointSeatWindowDocumentBoundary<T>(windowId: ObjectId, work: () => Promise<T>): Promise<T> {
    const key = windowId.toHexString();
    const previous = endpointSeatWindowDocumentTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    endpointSeatWindowDocumentTails.set(key, current);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (endpointSeatWindowDocumentTails.get(key) === current) endpointSeatWindowDocumentTails.delete(key);
    }
}
