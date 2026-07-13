export interface LoadedProblemAcl {
    permitPids: Set<number>;
    authoredPids: Set<number>;
    maintainedPids: Set<number>;
    fencedPids: Set<number>;
}

/** Atomically replaces request-scoped ACL state; errors leave a deny state. */
export async function preloadProblemAcl(
    user: any,
    domainId: string | undefined,
    load: (domainId: string, uid: number) => Promise<LoadedProblemAcl>,
    onError: (error: unknown) => void,
): Promise<void> {
    user._permitPids = new Set<number>();
    user._authoredPids = new Set<number>();
    user._maintainedPids = new Set<number>();
    user._aclFencedPids = new Set<number>();
    user._problemAclLoaded = false;
    user._problemAclDomainId = undefined;
    const uid = user?._id;
    if (!uid || uid <= 0) {
        user._problemAclDomainId = domainId;
        user._problemAclLoaded = true;
        return;
    }
    if (!domainId) {
        onError(new Error(`ACL preload refused: missing domain uid=${uid}`));
        return;
    }
    try {
        const loaded = await load(domainId, uid);
        user._permitPids = loaded.permitPids;
        user._authoredPids = loaded.authoredPids;
        user._maintainedPids = loaded.maintainedPids;
        user._aclFencedPids = loaded.fencedPids;
        user._problemAclDomainId = domainId;
        user._problemAclLoaded = true;
    } catch (error) {
        onError(error);
    }
}
