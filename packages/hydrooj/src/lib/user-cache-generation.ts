import { localizedErrorText, AccountStateConflictError } from '../error';

export function cacheKeyMatchesIdentity(cacheKey: string, identities: string[]) {
    const domainSeparator = cacheKey.lastIndexOf('/');
    return domainSeparator > 0 && identities.includes(cacheKey.slice(0, domainSeparator));
}

export class UserCacheGenerationTracker {
    private all = 0;
    private readonly domains = new Map<string, number>();
    private readonly identities = new Map<string, number>();

    snapshot(identity: string, domainId: string) {
        return `${this.all}/${this.domains.get(domainId) || 0}/${this.identities.get(identity) || 0}`;
    }

    invalidateIdentities(identities: string[]) {
        for (const identity of identities) this.identities.set(identity, (this.identities.get(identity) || 0) + 1);
    }

    invalidateDomain(domainId: string) {
        this.domains.set(domainId, (this.domains.get(domainId) || 0) + 1);
    }

    invalidateAll() {
        this.all++;
    }
}

/**
 * Load and synchronously commit a cache candidate only when no invalidation
 * occurred during its asynchronous construction. A single retry handles the
 * normal identity-update race; continued churn fails with an explicit conflict.
 */
export async function loadAndCommitWhenGenerationIsStable<T, R>(
    getGeneration: () => string,
    load: () => Promise<T>,
    commit: (candidate: T) => R,
): Promise<R | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const generation = getGeneration();
        const candidate = await load();
        if (generation !== getGeneration()) continue;
        return commit(candidate);
    }
    throw new AccountStateConflictError(localizedErrorText`用户资料在读取期间发生变化，请重试`);
}
