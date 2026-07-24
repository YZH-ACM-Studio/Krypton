export interface LoadedProblemAcl {
    permitPids: Set<number>;
    authoredPids: Set<number>;
    maintainedPids: Set<number>;
    dataContributionPids: Set<number>;
    tagContributionPids: Set<number>;
    fencedPids: Set<number>;
    ownsLegacyProblems: boolean;
}

export interface LoadedPidNamespaceAcl {
    authorNamespaceIds: Set<string>;
    managerNamespaceIds: Set<string>;
    editAllNamespaceIds: Set<string>;
}

/** Atomically replaces request-scoped ACL state; errors leave a deny state. */
export async function preloadProblemAcl(
    user: any,
    domainId: string | undefined,
    loadProblemAcl: (domainId: string, uid: number) => Promise<LoadedProblemAcl>,
    loadPidNamespaceAcl: (domainId: string, uid: number) => Promise<LoadedPidNamespaceAcl>,
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
    user._pidNamespaceAuthorIds = new Set<string>();
    user._pidNamespaceManagerIds = new Set<string>();
    user._pidNamespaceEditAllIds = new Set<string>();
    user._pidNamespaceAclLoaded = false;
    user._pidNamespaceAclDomainId = undefined;
    const uid = user?._id;
    if (!uid || uid <= 0) {
        user._problemAclDomainId = domainId;
        user._problemAclLoaded = true;
        user._pidNamespaceAclDomainId = domainId;
        user._pidNamespaceAclLoaded = true;
        return;
    }
    if (!domainId) {
        onError(new Error(`ACL preload refused: missing domain uid=${uid}`));
        return;
    }
    try {
        const [loaded, namespaceAcl] = await Promise.all([loadProblemAcl(domainId, uid), loadPidNamespaceAcl(domainId, uid)]);
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
        if (
            !(namespaceAcl?.authorNamespaceIds instanceof Set) ||
            !(namespaceAcl?.managerNamespaceIds instanceof Set) ||
            !(namespaceAcl?.editAllNamespaceIds instanceof Set)
        ) {
            throw new TypeError('PID namespace ACL preload returned an invalid snapshot');
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
        user._pidNamespaceAuthorIds = namespaceAcl.authorNamespaceIds;
        user._pidNamespaceManagerIds = namespaceAcl.managerNamespaceIds;
        user._pidNamespaceEditAllIds = namespaceAcl.editAllNamespaceIds;
        user._pidNamespaceAclDomainId = domainId;
        user._pidNamespaceAclLoaded = true;
    } catch (error) {
        onError(error);
    }
}
