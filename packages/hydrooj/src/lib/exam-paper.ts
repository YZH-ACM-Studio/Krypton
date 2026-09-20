import { randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
    drawExamPaperPids as drawExamPaperPidsWithRng,
    EXAM_ATTEMPT_PENDING_STATUSES,
    type ExamPaperQuotas,
    type ProblemKind,
} from '@hydrooj/common';

export {
    EXAM_ATTEMPT_PENDING_STATUSES,
    EXAM_PAPER_FINALIZE_GRACE_MS,
    EXAM_PAPER_HOUR_MS,
    asExamPaperDate,
    assertExamPaperPoolSatisfiesQuotas,
    assertExamPassScoreFitsPaper,
    canOpenExamPaperAfterFail,
    canRetakeExamPaper,
    canStartExamPaper,
    countExamPaperPoolByKind,
    examAttemptScore,
    examAttemptsUsed,
    examDefinitePaperMax,
    examDrawUnitContributions,
    examPaperContributions,
    examPaperDurationMs,
    examPaperPidsForCompletion,
    assignContestProblemScores,
    contestProblemScoreWeight,
    examScoresForPool,
    examShowsVerdict,
    examPaperPersonalEnd,
    isExamAttemptJudgePending,
    isExamAttemptPassed,
    minContributionsToReach,
    minProblemsToPass,
    minRemainingProblemsToPass,
    parseContestProblemScores,
    parseExamAttemptLimit,
    parseExamPassScore,
    readExamAttemptLimit,
    readExamPassScore,
    scaleByContestProblemScore,
    examPaperQuotaTotal,
    examPaperQuotasEqual,
    isExamPaperDrawEnabled,
    isExamPaperFinalized,
    isExamPaperInWindow,
    isExamPaperStarted,
    isExamPaperUnstartedClosed,
    isExamPaperWindowClosed,
    normalizeExamPaperPids,
    parseExamPaperQuotas,
    parseFrozenExamPaperPids,
    projectStudentContestTdoc,
    readExamPaperQuotas,
    resolveExamPaperPids,
    studentContestProblemPids,
} from '@hydrooj/common';
export type { ExamPaperContestClock, ExamPaperQuotas, ExamPaperStatusClock } from '@hydrooj/common';

export function examStatusAcceptsJournalRid(tsdoc: { examJournalAfter?: unknown } | null | undefined, rid: ObjectId): boolean {
    const floor = tsdoc?.examJournalAfter;
    if (!(floor instanceof ObjectId)) return true;
    return rid.toHexString() > floor.toHexString();
}

export function examJournalFloorFilter(tsdoc: { examJournalAfter?: unknown } | null | undefined): Record<string, unknown> {
    const floor = tsdoc?.examJournalAfter;
    if (floor instanceof ObjectId) return { examJournalAfter: floor };
    return { examJournalAfter: { $exists: false } };
}

export interface ExamJournalEntry {
    rid: ObjectId;
    pid: number;
    status: number;
    score: number;
    subtasks?: unknown;
    lang?: string;
    manual?: true;
}

export interface ExamJournalRecordFact {
    _id: ObjectId;
    uid: number;
    pid: unknown;
    status: unknown;
    score?: unknown;
    subtasks?: unknown;
    lang?: unknown;
    contest?: unknown;
}

export function isExamJournalPendingStatus(status: unknown): boolean {
    return typeof status === 'number' && (EXAM_ATTEMPT_PENDING_STATUSES as readonly number[]).includes(status);
}

function assertExamJournalPid(pid: unknown): asserts pid is number {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('exam_journal_pid_invalid');
}

function assertSameRid(left: ObjectId, right: ObjectId): void {
    if (!(left instanceof ObjectId) || !(right instanceof ObjectId) || !left.equals(right)) {
        throw new TypeError('exam_journal_rid_mismatch');
    }
}

export function examJournalEntryFromRecord(rdoc: ExamJournalRecordFact, manual?: boolean): ExamJournalEntry {
    if (!(rdoc._id instanceof ObjectId)) throw new TypeError('exam_journal_rid_invalid');
    assertExamJournalPid(rdoc.pid);
    if (typeof rdoc.status !== 'number' || !Number.isSafeInteger(rdoc.status)) {
        throw new TypeError('exam_journal_status_invalid');
    }
    return {
        rid: rdoc._id,
        pid: rdoc.pid,
        status: rdoc.status,
        score: typeof rdoc.score === 'number' && Number.isFinite(rdoc.score) ? rdoc.score : 0,
        ...(rdoc.subtasks !== undefined ? { subtasks: rdoc.subtasks } : {}),
        ...(typeof rdoc.lang === 'string' ? { lang: rdoc.lang } : {}),
        ...(manual === true ? { manual: true as const } : {}),
    };
}

export function mergeExamJournalEntry(existing: ExamJournalEntry | undefined, incoming: ExamJournalEntry): ExamJournalEntry {
    if (!incoming || !(incoming.rid instanceof ObjectId)) throw new TypeError('exam_journal_rid_invalid');
    assertExamJournalPid(incoming.pid);
    if (typeof incoming.status !== 'number' || !Number.isSafeInteger(incoming.status)) {
        throw new TypeError('exam_journal_status_invalid');
    }
    if (!existing) return incoming;
    assertSameRid(existing.rid, incoming.rid);
    if (isExamJournalPendingStatus(incoming.status) && !isExamJournalPendingStatus(existing.status)) {
        const pid = Number.isSafeInteger(existing.pid) && existing.pid > 0 ? existing.pid : incoming.pid;
        assertExamJournalPid(pid);
        return { ...existing, pid };
    }
    return incoming;
}

export function rebuildExamJournalFromRecords(
    tsdoc: { uid?: unknown; examJournalAfter?: unknown; journal?: unknown },
    records: readonly ExamJournalRecordFact[],
    expected: { uid: number; contestId: ObjectId },
): ExamJournalEntry[] {
    if (!Number.isSafeInteger(expected.uid) || expected.uid <= 0) throw new TypeError('exam_journal_uid_invalid');
    if (!(expected.contestId instanceof ObjectId)) throw new TypeError('exam_journal_contest_invalid');
    if (tsdoc.uid !== expected.uid) throw new TypeError('exam_journal_uid_mismatch');

    const byRid = new Map<string, ExamJournalRecordFact>();
    for (const rdoc of records) {
        if (!(rdoc._id instanceof ObjectId)) throw new TypeError('exam_journal_rid_invalid');
        if (rdoc.uid !== expected.uid) throw new TypeError('exam_journal_uid_mismatch');
        if (!(rdoc.contest instanceof ObjectId) || !rdoc.contest.equals(expected.contestId)) {
            throw new TypeError('exam_journal_contest_mismatch');
        }
        byRid.set(rdoc._id.toHexString(), rdoc);
    }

    const journal: ExamJournalEntry[] = [];
    const seen = new Set<string>();
    const existing = Array.isArray(tsdoc.journal) ? tsdoc.journal : [];
    for (const raw of existing) {
        if (!raw || typeof raw !== 'object') throw new TypeError('exam_journal_entry_invalid');
        const rid = (raw as { rid?: unknown }).rid;
        if (!(rid instanceof ObjectId)) throw new TypeError('exam_journal_rid_invalid');
        if (!examStatusAcceptsJournalRid(tsdoc, rid)) continue;
        const rdoc = byRid.get(rid.toHexString());
        if (!rdoc) throw new TypeError(`exam_journal_record_missing:${rid.toHexString()}`);
        journal.push(examJournalEntryFromRecord(rdoc, (raw as { manual?: unknown }).manual === true));
        seen.add(rid.toHexString());
    }
    for (const rdoc of records) {
        const hex = rdoc._id.toHexString();
        if (seen.has(hex)) continue;
        if (!examStatusAcceptsJournalRid(tsdoc, rdoc._id)) continue;
        journal.push(examJournalEntryFromRecord(rdoc));
    }
    return journal.sort(
        (left, right) =>
            left.rid.getTimestamp().getTime() - right.rid.getTimestamp().getTime()
            || left.rid.toHexString().localeCompare(right.rid.toHexString()),
    );
}

export function drawExamPaperPids(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
    quotas: ExamPaperQuotas,
    randomIntFn: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive),
): number[] {
    return drawExamPaperPidsWithRng(poolPids, kinds, quotas, randomIntFn);
}
