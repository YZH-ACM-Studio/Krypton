import { paperMaximum, roundTotal, type CodeAttempt } from '@hydrooj/common';
import type { VirtualContestJournalEntry } from '../model/virtual-contest';
import { isJudgedSetStatus } from './set-judged-attempts';
import { setRoundDetail } from './set-score-projection';
import type { VirtualContestSnapshot } from './virtual-contest';

/** Compute a PTA VP using its issued paper and grading policy, on the participant's clock. */
export function virtualSetTotal(snapshot: VirtualContestSnapshot, startAt: Date, journal: readonly VirtualContestJournalEntry[],
    cutoff: number, pids = snapshot.pids) {
    if (!snapshot.judgedPids || !snapshot.setLate || (!snapshot.setCodePolicy && snapshot.rule !== 'ioi' && snapshot.rule !== 'acm')) {
        throw new TypeError('virtual_set_scoring_snapshot_invalid');
    }
    const judged = new Set(snapshot.judgedPids);
    const attempts: CodeAttempt[] = [];
    const answers = new Map<number, { pid: number; rawScore: number; acceptedAt: Date; rid: string; status: number }>();
    const late = snapshot.setLate.enabled ? { ...snapshot.setLate,
        onTimeAt: new Date(+startAt + (+snapshot.setLate.onTimeAt - +snapshot.sourceBeginAt)) } : snapshot.setLate;
    for (const entry of journal) {
        // ObjectId timestamps are whole seconds. A submission in the opening second belongs at time zero.
        const acceptedAt = new Date(Math.max(+startAt, +entry.rid.getTimestamp()));
        if (+acceptedAt > cutoff || !isJudgedSetStatus(entry.status)) continue;
        const id = entry.rid.toHexString();
        if (judged.has(entry.pid)) {
            attempts.push({ pid: entry.pid, acceptedAt, recordId: id, score: entry.score, status: entry.status, subtasks: entry.subtasks });
        } else {
            const previous = answers.get(entry.pid);
            if (!previous || id > previous.rid) {
                answers.set(entry.pid, { pid: entry.pid, acceptedAt, rid: id, rawScore: entry.score, status: entry.status });
            }
        }
    }
    return roundTotal({ codePolicy: snapshot.setCodePolicy ?? (snapshot.rule === 'acm' ? 'acm' : 'highest'), late }, pids, [...answers.values()], attempts,
        new Map(pids.map((pid) => [pid, snapshot.score[pid] ?? 100])), judged, startAt, snapshot.setPoints);
}

/** The standalone VP board consumes unweighted per-question cells and elapsed seconds. */
export function virtualSetStats(snapshot: VirtualContestSnapshot, startAt: Date, journal: readonly VirtualContestJournalEntry[],
    stopAt: Date, lockAt?: Date) {
    const full = virtualSetTotal(snapshot, startAt, journal, +stopAt);
    const shown = lockAt ? virtualSetTotal(snapshot, startAt, journal, Math.min(+lockAt, +stopAt)) : full;
    const cells = (result: typeof full) => Object.fromEntries(Object.values(setRoundDetail(result)).filter((cell) => cell.rid).map((cell) => {
        const weight = (snapshot.score[cell.pid] ?? 100) / 100;
        return [cell.pid, snapshot.rule === 'acm'
            ? { ...cell, score: cell.score * 100, time: (cell.real ?? 0) + (cell.penalty ?? 0) }
            : { ...cell, score: weight ? cell.score / weight : 0 }];
    }));
    const detail = cells(full);
    return { ...(snapshot.setPoints ? { maxPoints: paperMaximum(snapshot.setPoints, snapshot.pids) } : {}), score: shown.total, accept: shown.accept, time: shown.penaltySeconds, detail, display: shown === full ? detail : cells(shown) };
}
