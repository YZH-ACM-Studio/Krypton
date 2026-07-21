export interface ContestProblemJournalStatus {
    pid: number;
    rid: unknown;
    status: number;
}

export interface ContestProblemStatusSnapshot {
    rid: unknown;
    status: number;
}

const STATUS_ACCEPTED = 1;

export function buildLatestContestProblemStatusByPid(
    journal: ContestProblemJournalStatus[],
    problemIds: number[],
): Record<number, ContestProblemStatusSnapshot> {
    if (!Array.isArray(journal)) throw new TypeError('Contest status journal must be an array.');
    if (!Array.isArray(problemIds) || problemIds.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new TypeError('Contest problem ids must be positive integers.');
    }
    const allowed = new Set(problemIds);
    const result: Record<number, ContestProblemStatusSnapshot> = {};
    for (const [index, entry] of journal.entries()) {
        if (!entry || !Number.isSafeInteger(entry.pid) || !Number.isInteger(entry.status) || entry.rid === null || entry.rid === undefined) {
            throw new TypeError(`Contest status journal entry ${index} is malformed.`);
        }
        if (!allowed.has(entry.pid) || result[entry.pid]?.status === STATUS_ACCEPTED) continue;
        result[entry.pid] = { rid: entry.rid, status: entry.status };
    }
    return result;
}
