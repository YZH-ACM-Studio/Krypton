const tails = new Map<string, Promise<unknown>>();

export async function withCollectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const next = previous.then(() => gate, () => gate);
    tails.set(key, next);
    await previous.catch(() => undefined);
    try {
        return await fn();
    } finally {
        release();
        if (tails.get(key) === next) tails.delete(key);
    }
}

export function collectUserLockKey(domainId: string, requestId: string, uid: number): string {
    return `collect:${domainId}:${requestId}:uid:${uid}`;
}

export function collectRequestLockKey(domainId: string, requestId: string): string {
    return `collect:${domainId}:${requestId}:request`;
}
