import problem from '../model/problem';

/** Normalize container JSON problem references without probing the problem table. */
export function normalizeProblemDocIds(values: unknown): number[] {
    if (!Array.isArray(values)) throw new TypeError('problem ids must be an array');
    const pids = values.map((value) => Number(value));
    if (!pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)) {
        throw new TypeError('problem ids must be positive numeric docIds');
    }
    return Array.from(new Set(pids));
}

/**
 * Resolve a container's already-known references, then apply the canonical
 * direct-view predicate. This preserves active verifier/maintainer access to
 * hidden problems while making a fence or revocation effective immediately.
 */
export async function getVisibleReferencedProblems(domainId: string, pids: number[], user: any) {
    const visible: Record<number, any> = {};
    for (const pid of pids) {
        // eslint-disable-next-line no-await-in-loop
        const pdoc = await problem.getViewableAuthorized(
            domainId, pid, user, problem.PROJECTION_PUBLIC,
        );
        if (!pdoc?.docId) continue;
        visible[pdoc.docId] = pdoc;
    }
    return visible;
}

/** This helper lives in handler/ and is therefore discovered by Hydro's loader. */
export function apply() { }
