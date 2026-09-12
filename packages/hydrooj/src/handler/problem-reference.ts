import type { Filter } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import problem, { type ProblemDoc } from '../model/problem';
import { PROBLEM_ACL_INTERNAL_FIELDS, readContextViewableProblems } from '../model/problem-access';

const logger = new Logger('problem-reference');

const STABLE_VIEW_AUTHORIZATION_FIELDS = ['domainId', 'docId', 'owner', 'hidden', 'authoringMode', 'pidNamespaceId', 'managedAuthoring'] as const;

/** Normalize container JSON problem references without probing the problem table. */
export function normalizeProblemDocIds(values: unknown): number[] {
    if (!Array.isArray(values)) throw new TypeError('problem ids must be an array');
    const pids = values.map((value) => Number(value));
    if (!pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)) {
        throw new TypeError('problem ids must be positive numeric docIds');
    }
    return Array.from(new Set(pids));
}

function problemDocsFromGetList(dict: Record<string | number, ProblemDoc>, pids: number[]) {
    const docs: ProblemDoc[] = [];
    const seen = new Set<number>();
    for (const pid of pids) {
        const pdoc = dict[pid];
        if (!pdoc || !Number.isSafeInteger(pdoc.docId) || seen.has(pdoc.docId)) continue;
        seen.add(pdoc.docId);
        docs.push(pdoc);
    }
    return docs;
}

function stripUnrequestedStableViewFields(pdoc: ProblemDoc, requested: ReadonlySet<string>) {
    for (const field of STABLE_VIEW_AUTHORIZATION_FIELDS) {
        if (!requested.has(field)) delete (pdoc as Record<string, unknown>)[field];
    }
    return pdoc;
}

/**
 * Resolve a container's already-known references, then apply the canonical
 * direct-view predicate. This preserves active verifier/maintainer access to
 * hidden problems while making a fence or revocation effective immediately.
 */
export async function getVisibleReferencedProblems(domainId: string, pids: number[], user: any) {
    const startedAt = Date.now();
    // Training/course cards need summary statistics, not statements, config,
    // or files. Avoid returning hundreds of full problem payloads.
    const projection = [...problem.PROJECTION_LIST, 'origStat'];
    const requested = new Set(projection);
    const readProjection = Array.from(new Set([...projection, ...STABLE_VIEW_AUTHORIZATION_FIELDS, ...PROBLEM_ACL_INTERNAL_FIELDS]));
    const docs = await readContextViewableProblems(
        domainId,
        user,
        pids,
        { kind: 'referenced-card' },
        {
            readDirectStable: async (filter: Filter<ProblemDoc>) => problem.getMulti(domainId, filter, readProjection).toArray(),
            readContainer: async (requestedPids) => {
                const dict = await problem.getList(domainId, requestedPids, true, false, projection, true);
                return problemDocsFromGetList(dict, requestedPids);
            },
        },
    );
    const visible: Record<number, ProblemDoc> = {};
    for (const pdoc of docs) visible[pdoc.docId] = stripUnrequestedStableViewFields(pdoc, requested);
    const elapsed = Date.now() - startedAt;
    if (elapsed >= 500) {
        logger.warn(
            'Slow referenced-problem batch domain=%s requested=%d visible=%d elapsedMs=%d',
            domainId,
            pids.length,
            Object.keys(visible).length,
            elapsed,
        );
    }
    return visible;
}

/** This helper lives in handler/ and is therefore discovered by Hydro's loader. */
export function apply() {}
