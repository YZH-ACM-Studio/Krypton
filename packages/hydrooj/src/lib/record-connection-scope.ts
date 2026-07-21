export const RECORD_PRETEST_CONTEST_ID = '000000000000000000000000';
export const RECORD_GENERATE_CONTEST_ID = '000000000000000000000001';

interface RecordConnectionScope {
    domainId: string;
    tid?: string;
    lang?: string;
    status?: number;
    pretest: boolean;
    all: boolean;
    allDomain: boolean;
}

interface RecordConnectionCandidate {
    domainId: string;
    contestId?: string;
    lang?: string;
    status?: number;
    input?: unknown;
}

export function matchesRecordConnectionScope(candidate: RecordConnectionCandidate, scope: RecordConnectionScope): boolean {
    if (scope.pretest) {
        return candidate.domainId === scope.domainId && candidate.contestId === RECORD_PRETEST_CONTEST_ID;
    }
    if (!scope.allDomain && candidate.domainId !== scope.domainId) return false;
    if ([RECORD_PRETEST_CONTEST_ID, RECORD_GENERATE_CONTEST_ID].includes(candidate.contestId || '')) return false;
    if (typeof candidate.input === 'string') return false;
    if (scope.lang && candidate.lang !== scope.lang) return false;
    if (typeof scope.status === 'number' && candidate.status !== scope.status) return false;
    if (scope.allDomain || scope.all) return true;
    if (scope.tid) return candidate.contestId === scope.tid;
    return candidate.contestId === undefined;
}
