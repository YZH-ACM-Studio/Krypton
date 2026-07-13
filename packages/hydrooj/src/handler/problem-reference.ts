import { Logger } from '@hydrooj/utils';
import problem from '../model/problem';

const logger = new Logger('problem-reference');

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
    const startedAt = Date.now();
    // Training/course cards need summary statistics, not statements, config,
    // or files. Avoid returning hundreds of full problem payloads.
    const projection = [...problem.PROJECTION_LIST, 'origStat'] as any;
    const visible = await problem.getListViewableAuthorized(domainId, pids, user, projection, false, true);
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
