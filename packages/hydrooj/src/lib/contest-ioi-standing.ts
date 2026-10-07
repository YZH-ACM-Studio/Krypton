import { formatSeconds } from '@hydrooj/utils/lib/utils';

/**
 * IOI board tie-break. OI and strict IOI keep score-only ranking.
 * A problem counts when the adopted submission's judge score is > 0.
 * Its time is that submission's timestamp, in whole seconds from the contest clock.
 */
export interface IoiBoardContest {
    pids: readonly number[];
    beginAt: Date;
    duration?: number;
    lockAt?: Date;
    unlocked?: boolean;
}

export interface IoiBoardCell {
    score?: number;
    rid?: { getTimestamp(): Date };
}

export interface IoiBoardStatus {
    uid?: number;
    score?: number;
    startAt?: Date;
    detail?: Record<string, unknown> | null;
    display?: Record<string, unknown> | null;
}

export interface IoiBoardConfig {
    lockAt?: Date;
}

export interface IoiBoardRankKey {
    score: number;
    passed: number;
    seconds: number;
    uid: number;
}

export interface IoiBoardStanding {
    passed: number;
    seconds: number;
    problemSeconds: ReadonlyMap<number, number>;
}

export interface IoiVirtualAttemptView {
    uid: number;
    score?: number;
    startAt: Date;
    status: string;
    detail?: Record<string, unknown> | null;
    display?: Record<string, unknown> | null;
}

function validDate(value: unknown): Date | null {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function usesFrozenCells(contest: IoiBoardContest, config: IoiBoardConfig, now: Date): boolean {
    if (!config.lockAt) return false;
    if (!(contest.lockAt instanceof Date) || Number.isNaN(contest.lockAt.getTime()) || contest.unlocked) return false;
    return contest.lockAt < now;
}

function cellRecord(source: Record<string, unknown> | null | undefined, pid: number): Record<string, unknown> | null {
    if (!source) return null;
    const value = source[pid] ?? source[String(pid)];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function submissionTimestamp(pid: number, rid: unknown): Date {
    if (!rid || typeof rid !== 'object' || typeof (rid as { getTimestamp?: unknown }).getTimestamp !== 'function') {
        throw new TypeError(`IOI standing is missing the submission id for problem ${pid}.`);
    }
    const timestamp = (rid as { getTimestamp(): Date }).getTimestamp();
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        throw new TypeError(`IOI standing submission time for problem ${pid} is invalid.`);
    }
    return timestamp;
}

export function ioiTimeOrigin(contest: IoiBoardContest, status: IoiBoardStatus): Date {
    const beginAt = validDate(contest.beginAt);
    if (!beginAt) throw new TypeError('IOI standing requires contest beginAt.');
    if (typeof contest.duration === 'number' && Number.isFinite(contest.duration) && contest.duration > 0) {
        return validDate(status.startAt) || beginAt;
    }
    return beginAt;
}

export function ioiElapsedSeconds(origin: Date, submittedAt: Date): number {
    return Math.floor((submittedAt.getTime() - origin.getTime()) / 1000);
}

export function formatIoiBoardTime(seconds: number): string {
    if (!Number.isSafeInteger(seconds)) throw new TypeError(`IOI standing time must be whole seconds, received ${String(seconds)}.`);
    return formatSeconds(seconds, true);
}

export function ioiProblemCellValue(value: string | number, seconds: number | null): string {
    if (seconds === null) return String(value);
    return `${value}\n${formatIoiBoardTime(seconds)}`;
}

export function ioiBoardStanding(contest: IoiBoardContest, status: IoiBoardStatus, config: IoiBoardConfig, now = new Date()): IoiBoardStanding {
    if (!Array.isArray(contest.pids)) throw new TypeError('IOI standing requires contest problem ids.');
    const frozen = usesFrozenCells(contest, config, now);
    const source = frozen ? status.display : status.detail;
    const problemSeconds = new Map<number, number>();
    let passed = 0;
    let seconds = 0;
    let origin: Date | null = null;
    for (const pid of contest.pids) {
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError(`IOI standing problem id ${String(pid)} is invalid.`);
        const cell = cellRecord(source, pid);
        if (!cell || cell.score == null) continue;
        if (typeof cell.score !== 'number' || !Number.isFinite(cell.score)) {
            throw new TypeError(`IOI standing score for problem ${pid} must be a finite number.`);
        }
        if (cell.score <= 0) continue;
        if (!origin) origin = ioiTimeOrigin(contest, status);
        const elapsed = ioiElapsedSeconds(origin, submissionTimestamp(pid, cell.rid));
        problemSeconds.set(pid, elapsed);
        passed += 1;
        seconds += elapsed;
    }
    return { passed, seconds, problemSeconds };
}

export function ioiBoardRankKey(contest: IoiBoardContest, status: IoiBoardStatus, config: IoiBoardConfig, now = new Date()): IoiBoardRankKey {
    const standing = ioiBoardStanding(contest, status, config, now);
    return {
        score: status.score || 0,
        passed: standing.passed,
        seconds: standing.seconds,
        uid: status.uid || 0,
    };
}

/** Higher score, then more passed problems, then less time. uid only stabilizes a full tie. */
export function compareIoiRankKey(left: IoiBoardRankKey, right: IoiBoardRankKey): number {
    if (left.score !== right.score) return left.score < right.score ? 1 : -1;
    if (left.passed !== right.passed) return left.passed < right.passed ? 1 : -1;
    if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
    return left.uid - right.uid;
}

export function ioiRankKeysTied(left: IoiBoardRankKey, right: IoiBoardRankKey): boolean {
    return left.score === right.score && left.passed === right.passed && left.seconds === right.seconds;
}

export function ioiVirtualBoardStatus(attempt: IoiVirtualAttemptView): IoiBoardStatus {
    const startAt = validDate(attempt.startAt);
    if (!startAt) throw new TypeError('IOI virtual standing requires attempt startAt.');
    return {
        uid: attempt.uid,
        score: attempt.score,
        startAt,
        detail: attempt.status === 'active' ? attempt.display || attempt.detail : attempt.detail,
    };
}

export function rankIoiVirtualAttempts<T extends IoiVirtualAttemptView>(
    pids: readonly number[],
    attempts: readonly T[],
    now = new Date(),
): Array<[number, T]> {
    const keyed = attempts.map((attempt) => ({
        attempt,
        key: ioiBoardRankKey({ pids, beginAt: attempt.startAt, duration: 1 }, ioiVirtualBoardStatus(attempt), {}, now),
    }));
    keyed.sort((left, right) => compareIoiRankKey(left.key, right.key));
    const ranked: Array<[number, T]> = [];
    for (let index = 0; index < keyed.length; index += 1) {
        const rank = index === 0 || !ioiRankKeysTied(keyed[index - 1].key, keyed[index].key) ? index + 1 : ranked[index - 1][0];
        ranked.push([rank, keyed[index].attempt]);
    }
    return ranked;
}
