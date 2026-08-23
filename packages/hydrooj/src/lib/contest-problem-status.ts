export interface ContestProblemJournalStatus {
    pid: number;
    rid: unknown;
    status: number;
}

export interface ContestProblemStatusSnapshot {
    rid: unknown;
    status: number;
}

export interface PersonalPracticeStatusSnapshot extends ContestProblemStatusSnapshot {
    phase: 'before' | 'after' | 'other';
}

export interface PersonalPracticeRecord {
    _id: unknown;
    pid: number;
    status: number;
    contest?: unknown;
    contestTeamId?: unknown;
    virtualAttemptId?: unknown;
    hackTarget?: unknown;
    input?: unknown;
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

function recordTimestamp(rid: unknown, pid: number): Date {
    if (!rid || typeof (rid as any).getTimestamp !== 'function') {
        throw new TypeError(`Personal problem status for pid ${pid} is malformed.`);
    }
    const timestamp = (rid as any).getTimestamp();
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        throw new TypeError(`Personal problem status for pid ${pid} has an invalid record timestamp.`);
    }
    return timestamp;
}

export function buildPersonalPracticeRecordQuery(uid: number, problemIds: number[]) {
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new TypeError('Personal practice uid must be a positive integer.');
    if (!Array.isArray(problemIds) || problemIds.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new TypeError('Contest problem ids must be positive integers.');
    }
    return {
        uid,
        pid: { $in: Array.from(new Set(problemIds)) },
        contest: { $exists: false },
        contestTeamId: { $exists: false },
        virtualAttemptId: { $exists: false },
        hackTarget: { $exists: false },
        input: { $exists: false },
    };
}

function isNewerRecord(candidate: PersonalPracticeRecord, current: PersonalPracticeRecord | undefined): boolean {
    if (!current) return true;
    const candidateTime = recordTimestamp(candidate._id, candidate.pid).getTime();
    const currentTime = recordTimestamp(current._id, current.pid).getTime();
    if (candidateTime !== currentTime) return candidateTime > currentTime;
    return String(candidate._id) > String(current._id);
}

export function buildPersonalPracticeStatusByPid(
    records: PersonalPracticeRecord[],
    problemIds: number[],
    beginAt: Date,
    endAt: Date,
): Record<number, PersonalPracticeStatusSnapshot> {
    if (!Array.isArray(records)) throw new TypeError('Personal practice records must be an array.');
    if (!Array.isArray(problemIds) || problemIds.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new TypeError('Contest problem ids must be positive integers.');
    }
    if (!(beginAt instanceof Date) || Number.isNaN(beginAt.getTime()) || !(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
        throw new TypeError('Contest practice boundaries must be valid Dates.');
    }
    if (beginAt >= endAt) throw new TypeError('Contest practice beginAt must be before endAt.');

    const allowed = new Set(problemIds);
    const latestByPid = new Map<number, PersonalPracticeRecord>();
    const acceptedByPid = new Map<number, PersonalPracticeRecord>();
    for (const [index, record] of records.entries()) {
        if (
            !record ||
            !Number.isSafeInteger(record.pid) ||
            !allowed.has(record.pid) ||
            !Number.isInteger(record.status) ||
            record._id === null ||
            record._id === undefined
        ) {
            throw new TypeError(`Personal practice record ${index} is malformed.`);
        }
        if (
            Object.hasOwn(record, 'contest') ||
            Object.hasOwn(record, 'contestTeamId') ||
            Object.hasOwn(record, 'virtualAttemptId') ||
            Object.hasOwn(record, 'hackTarget') ||
            Object.hasOwn(record, 'input')
        ) {
            throw new TypeError(`Personal practice record ${index} is not an ordinary personal submission.`);
        }
        recordTimestamp(record._id, record.pid);
        if (isNewerRecord(record, latestByPid.get(record.pid))) latestByPid.set(record.pid, record);
        if (record.status === STATUS_ACCEPTED && isNewerRecord(record, acceptedByPid.get(record.pid))) {
            acceptedByPid.set(record.pid, record);
        }
    }

    const result: Record<number, PersonalPracticeStatusSnapshot> = {};
    for (const pid of problemIds) {
        const selected = acceptedByPid.get(pid) || latestByPid.get(pid);
        if (!selected) continue;
        const timestamp = recordTimestamp(selected._id, pid);
        let phase: PersonalPracticeStatusSnapshot['phase'];
        if (timestamp < beginAt) phase = 'before';
        else if (timestamp >= endAt) phase = 'after';
        else phase = 'other';

        if (selected.status !== STATUS_ACCEPTED && phase !== 'after') continue;
        result[pid] = {
            rid: selected._id,
            status: selected.status,
            phase,
        };
    }
    return result;
}
