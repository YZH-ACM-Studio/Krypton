export interface LoadedProblemAcl {
    permitPids: Set<number>;
    authoredPids: Set<number>;
    maintainedPids: Set<number>;
    dataContributionPids: Set<number>;
    tagContributionPids: Set<number>;
    fencedPids: Set<number>;
    ownsLegacyProblems: boolean;
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
    user._dataContributionPids = new Set<number>();
    user._tagContributionPids = new Set<number>();
    user._aclFencedPids = new Set<number>();
    user._ownsLegacyProblems = false;
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
        if (
            !(loaded?.permitPids instanceof Set) ||
            !(loaded?.authoredPids instanceof Set) ||
            !(loaded?.maintainedPids instanceof Set) ||
            !(loaded?.dataContributionPids instanceof Set) ||
            !(loaded?.tagContributionPids instanceof Set) ||
            !(loaded?.fencedPids instanceof Set) ||
            typeof loaded?.ownsLegacyProblems !== 'boolean'
        ) {
            throw new TypeError('ACL preload returned an invalid snapshot');
        }
        user._permitPids = loaded.permitPids;
        user._authoredPids = loaded.authoredPids;
        user._maintainedPids = loaded.maintainedPids;
        user._dataContributionPids = loaded.dataContributionPids;
        user._tagContributionPids = loaded.tagContributionPids;
        user._aclFencedPids = loaded.fencedPids;
        user._ownsLegacyProblems = loaded.ownsLegacyProblems;
        user._problemAclDomainId = domainId;
        user._problemAclLoaded = true;
    } catch (error) {
        onError(error);
    }
}
