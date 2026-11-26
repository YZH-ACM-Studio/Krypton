import {
    comparePaperScores, issuedPaperMaximum, paperMaximum, pointsForIssuedRound, readStoredSetConfig, roundPersonalEnd, roundTotal, selectRound, STATUS,
    type CodeAttempt, type ContestReplayFrame, type OfficialAnswer, type SetProblemFact, type SetSettings,
} from '@hydrooj/common';
import { formatSeconds } from '@hydrooj/utils/lib/utils';
import type { ObjectId } from 'mongodb';
import type { ContestRule, Tdoc } from '../interface';
import type { RoundDoc } from '../model/set-round';
import type { VirtualContestAttemptDoc, VirtualContestJournalEntry } from '../model/virtual-contest';
import { ioiBoardStanding } from './contest-ioi-standing';
import { rankSkippingUnofficial } from './contest-unrank';
import { virtualSetTotal } from './virtual-set-score';
import { getSetResultVisibility } from './set-result-visibility';
import { isContestGloballyEnded, virtualContestRule, virtualContestSnapshotFingerprint, type VirtualContestSnapshot } from './virtual-contest';

export function supportsContestReplay(tdoc: Tdoc) {
    const rule = virtualContestRule(tdoc);
    return (rule === 'ioi' || rule === 'acm') && tdoc.participationMode !== 'team'
        && (!tdoc.setConfig || readStoredSetConfig(tdoc).purpose === 'contest')
        && tdoc.allowVirtual !== false && isContestGloballyEnded(tdoc);
}

export function sameReplaySnapshot(source: VirtualContestSnapshot, attempt: VirtualContestSnapshot) {
    // Old snapshots recorded an opening freeze as null. The current source supplies that boundary.
    const lockOffsetMs = source.lockOffsetMs === 0 && attempt.lockOffsetMs === null ? 0 : attempt.lockOffsetMs;
    return +source.sourceBeginAt === +attempt.sourceBeginAt && +source.sourceEndAt === +attempt.sourceEndAt
        && (!attempt.setLate || JSON.stringify(source.setLate) === JSON.stringify(attempt.setLate))
        && virtualContestSnapshotFingerprint(source) === virtualContestSnapshotFingerprint({ ...attempt, lockOffsetMs });
}

export function replayOpponent(attempt: VirtualContestAttemptDoc, mine: VirtualContestAttemptDoc, source: VirtualContestSnapshot) {
    if (attempt._id.equals(mine._id) || !['active', 'ended'].includes(attempt.status)) return false;
    const finished = Math.min(attempt.endAt.getTime(), attempt.endedAt?.getTime() ?? Infinity);
    return finished <= mine.startAt.getTime() && sameReplaySnapshot(source, attempt.snapshot);
}

export function replayClock(mine: VirtualContestAttemptDoc, sourceLocked: boolean, requested: number | undefined, now: Date, lockOffsetMs: number | null) {
    const { durationMs } = mine.snapshot;
    const ended = mine.status === 'ended' || now >= mine.endAt;
    const availableMs = ended ? durationMs : Math.max(0, Math.min(durationMs, now.getTime() - mine.startAt.getTime()));
    if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 0)) throw new TypeError('virtual_replay_time_invalid');
    const atMs = Math.min(requested ?? availableMs, availableMs);
    const final = ended && atMs === durationMs && !sourceLocked;
    const frozen = lockOffsetMs !== null && atMs >= lockOffsetMs && !final;
    return { atMs, availableMs, durationMs, ended, final, frozen, scoreAtMs: frozen ? lockOffsetMs || -1 : atMs };
}

type Clock = ReturnType<typeof replayClock>;
type Cell = ContestReplayFrame['rows'][number]['cells'][number];
type Source = ContestReplayFrame['rows'][number]['source'];
interface Score { maxPoints?: number; score: number; passed: number | null; seconds: number | null; cells: Cell[] }
export interface ReplayEntry extends Score { uid: number; source: Source; unrank: boolean }
export interface LegacyReplayStatus {
    uid: number;
    unrank?: boolean;
    startAt?: Date;
    journal?: VirtualContestJournalEntry[];
    detail?: Record<number, { rid?: ObjectId; score?: number; status?: number; naccept?: number; real?: number; npending?: number }>;
    score?: number;
    accept?: number;
    time?: number;
}
export interface ReplayRound {
    round: RoundDoc;
    attempts: CodeAttempt[];
    answers: Pick<OfficialAnswer, 'pid' | 'version' | 'acceptedAt' | 'rawScore' | 'status' | 'rid'>[];
}
export interface ReplayPaper {
    pids: number[];
    weights: Map<number, number>;
    facts: Map<number, SetProblemFact>;
    codePids: Set<number>;
}

function acmCell(solved: boolean, wrong: number, real: number): string {
    return solved ? `+${wrong || ''}\n${formatSeconds(real, false)}` : `-${wrong}`;
}

const bySubmission = (a: VirtualContestJournalEntry, b: VirtualContestJournalEntry) => a.rid.toHexString().localeCompare(b.rid.toHexString());

export function incompleteLegacyScore(tdoc: Tdoc, status: LegacyReplayStatus, rule: ContestRule): boolean {
    const journal = status.journal ?? [];
    const archived = status.detail ?? {};
    if (tdoc.duration && !status.startAt && (journal.length || Object.keys(archived).length || status.score || status.accept || status.time)) return true;
    const fields = tdoc.rule === 'acm' ? ['accept', 'time'] as const : ['score'] as const;
    if (!Object.keys(archived).length && fields.every((field) => status[field] === undefined)) return false;
    const reproduced: LegacyReplayStatus = rule.stat(tdoc, [...journal].sort(bySubmission));
    if (fields.some((field) => status[field] !== undefined && Math.abs(status[field]! - (reproduced[field] ?? 0)) > 1e-6)) return true;
    return Object.entries(archived).some(([pid, cell]) => {
        const actual = reproduced.detail?.[Number(pid)];
        if (!actual) {
            return Boolean(cell.rid || cell.score || cell.naccept || cell.real || cell.npending
                || (cell.status !== undefined && cell.status !== STATUS.STATUS_WAITING));
        }
        if (cell.rid && !cell.rid.equals(actual.rid)) return true;
        if (!cell.rid && cell.score) return true;
        return (['score', 'status', 'naccept', 'real'] as const).some((key) => cell[key] !== undefined && cell[key] !== actual[key]);
    });
}

function replayIoiStanding(tdoc: Tdoc, status: LegacyReplayStatus, detail: NonNullable<LegacyReplayStatus['detail']>, origin: Date, finalOnly: boolean) {
    if (finalOnly) {
        const scored = tdoc.pids.filter((pid) => (detail[pid]?.score ?? 0) > 0);
        const knownScore = scored.reduce((total, pid) => total + detail[pid].score! * ((tdoc.score?.[pid] || 100) / 100), 0);
        if (Math.abs(knownScore - (status.score ?? 0)) > 1e-6) return { passed: null, seconds: null };
        if ((tdoc.duration && !status.startAt) || scored.some((pid) => !detail[pid].rid)) {
            return { passed: scored.length, seconds: scored.length ? null : 0 };
        }
    }
    return ioiBoardStanding({ pids: tdoc.pids, beginAt: origin }, { detail }, {});
}

export function legacyReplayScore(
    tdoc: Tdoc, status: LegacyReplayStatus, origin: Date, scoringOrigin: Date,
    clock: Clock, rule: ContestRule, columns: number[], finalOnly = false, stopAt?: Date, publicLockAt?: Date,
): Score {
    const end = Math.min(stopAt?.getTime() ?? tdoc.endAt.getTime(), clock.final ? Infinity : origin.getTime() + clock.atMs);
    // Official journals are appended in judge-completion order. The source rules consume submission order.
    const journal = (status.journal ?? []).filter((entry) => entry.rid.getTimestamp().getTime() <= end)
        .sort(bySubmission);
    const lock = Math.min(clock.frozen ? (clock.scoreAtMs < 0 ? Math.floor(+origin / 1000) * 1000 - 1 : +origin + clock.scoreAtMs) : Infinity,
        publicLockAt?.getTime() ?? Infinity);
    const lockAt = lock <= end ? new Date(lock) : undefined;
    const doc = { ...tdoc, beginAt: scoringOrigin, lockAt, unlocked: !lockAt };
    const stats: LegacyReplayStatus & { display?: LegacyReplayStatus['detail'] } = finalOnly ? status : rule.stat(doc, journal);
    const detail = (lockAt ? stats.display : stats.detail) ?? {};
    const acm = tdoc.rule === 'acm';
    const standing = acm ? { passed: 0, seconds: stats.time ?? (stats.accept ? null : 0) }
        : replayIoiStanding(tdoc, status, detail, origin, finalOnly);
    const cells = columns.map((pid) => {
        const cell = detail[pid];
        if (!cell) return null;
        const value = acm ? cell.rid ? acmCell(cell.status === STATUS.STATUS_ACCEPTED, cell.naccept ?? 0, cell.real ?? 0) : null
            : cell.score === undefined ? null : cell.score * ((tdoc.score?.[pid] || 100) / 100);
        return cell.npending ? `${value ?? ''} ?${cell.npending}`.trim() : value;
    });
    return { score: (acm ? stats.accept : stats.score) ?? 0, passed: standing.passed, seconds: standing.seconds, cells };
}

function visibleProblem(settings: SetSettings, fact: SetProblemFact, now: Date, endAt: Date, closedAt: Date | null) {
    const visibility = getSetResultVisibility(settings, fact, { now, endAt, roundClosedAt: closedAt });
    return visibility.score || (settings.codePolicy === 'acm' && visibility.verdict);
}

export function setReplayScore(
    tdoc: Tdoc, settings: SetSettings, rounds: ReplayRound[], origin: Date,
    clock: Clock, paper: ReplayPaper, now: Date, publicLockAt?: Date,
): Score {
    const acm = settings.codePolicy === 'acm';
    const cutoff = new Date(Math.min(tdoc.endAt.getTime(), publicLockAt?.getTime() ?? Infinity,
        clock.final ? Infinity : origin.getTime() + clock.scoreAtMs));
    const scored = rounds.filter(({ round }) => round.startedAt <= cutoff).map(({ round, attempts, answers }) => {
        const closedAt = round.closedAt ?? roundPersonalEnd(settings, tdoc.endAt, round.startedAt);
        const closed = closedAt <= cutoff;
        const pids = round.paperPids.filter((pid) => {
            const fact = paper.facts.get(pid);
            if (!fact) throw new Error(`virtual_replay_problem_missing:${pid}`);
            return visibleProblem(settings, fact, cutoff, tdoc.endAt, closed ? closedAt : null)
                && visibleProblem(settings, fact, now, tdoc.endAt, closedAt <= now ? closedAt : null);
        });
        const cells = new Map<number, Cell>();
        let total: number;
        let penaltySeconds: number;
        if (round.legacy?.scoreLocked) {
            const allowed = new Set(pids);
            const detail = Object.values(round.detail ?? {}).filter((cell) => allowed.has(cell.pid));
            for (const cell of detail) {
                cells.set(cell.pid, acm
                    ? cell.rid ? acmCell(cell.score === 1, cell.naccept ?? 0, cell.real ?? 0) : null : cell.score);
            }
            const allVisible = pids.length === round.paperPids.length;
            total = allVisible ? round.total : detail.reduce((sum, cell) => sum + cell.score, 0);
            penaltySeconds = allVisible ? round.penaltySeconds ?? 0 : detail.reduce((sum, cell) =>
                sum + (cell.score === 1 ? (cell.real ?? 0) + (cell.penalty ?? 0) : 0), 0);
        } else {
            const latest = new Map<number, ReplayRound['answers'][number]>();
            for (const answer of answers) {
                if (answer.acceptedAt <= cutoff && answer.version > (latest.get(answer.pid)?.version ?? 0)) latest.set(answer.pid, answer);
            }
            const result = roundTotal(settings, pids, [...latest.values()],
                attempts.filter((item) => item.acceptedAt <= cutoff), paper.weights, paper.codePids, round.scoreStartedAt ?? round.startedAt, pointsForIssuedRound(tdoc.setPoints, round));
            total = result.total;
            penaltySeconds = result.penaltySeconds;
            for (const problem of result.problems) {
                cells.set(problem.pid, problem.acceptedAt === null ? null : acm
                    ? acmCell(problem.score === 1, problem.wrongAttempts ?? 0, problem.elapsedSeconds ?? 0) : problem.score);
            }
        }
        const maxPoints = tdoc.setPoints && !acm ? issuedPaperMaximum(tdoc, round, (pid) => tdoc.setPoints?.[pid]?.rawMax) : undefined;
        return { ...round, maxPoints, state: closed ? 'closed' as const : 'open' as const, total, penaltySeconds, cells };
    });
    const selected = selectRound(settings, scored);
    return { ...(selected?.maxPoints != null ? { maxPoints: selected.maxPoints } : {}), score: selected?.total ?? 0, passed: 0, seconds: selected?.penaltySeconds ?? 0,
        cells: paper.pids.map((pid) => selected?.cells.get(pid) ?? null) };
}

/** Apply the source's result visibility to each VP, then use the policy with which that attempt was scored. */
export function virtualReplayScore(tdoc: Tdoc, settings: SetSettings, attempt: VirtualContestAttemptDoc,
    clock: Clock, paper: ReplayPaper, now: Date, rule: ContestRule): Score {
    const { snapshot, startAt } = attempt;
    const stopped = Math.min(+attempt.endAt, attempt.endedAt?.getTime() ?? Infinity);
    const cutoff = +startAt + clock.scoreAtMs;
    const sourceCutoff = new Date(+tdoc.beginAt + clock.scoreAtMs);
    const sourceClosed = new Date(+tdoc.beginAt + stopped - +startAt);
    const closed = attempt.status === 'ended' || stopped <= +now;
    const pids = snapshot.pids.filter((pid) => {
        const fact = paper.facts.get(pid);
        if (!fact) throw new Error(`virtual_replay_problem_missing:${pid}`);
        return visibleProblem(settings, fact, sourceCutoff, tdoc.endAt, closed && sourceClosed <= sourceCutoff ? sourceClosed : null)
            && visibleProblem(settings, fact, now, tdoc.endAt, closed ? sourceClosed : null);
    });
    if (!snapshot.judgedPids) {
        const doc = { ...tdoc, rule: snapshot.rule, pids, score: snapshot.score };
        return legacyReplayScore(doc, { uid: attempt.uid, journal: attempt.journal }, startAt, startAt,
            clock, rule, paper.pids, false, new Date(stopped));
    }
    const result = virtualSetTotal(snapshot, startAt, attempt.journal, Math.min(cutoff, stopped), pids);
    const cells = new Map(result.problems.map((problem) => [problem.pid, problem]));
    return { ...(snapshot.setPoints ? { maxPoints: paperMaximum(snapshot.setPoints, snapshot.pids) } : {}), score: result.total, passed: 0, seconds: result.penaltySeconds, cells: paper.pids.map((pid) => {
        const cell = cells.get(pid);
        if (!cell?.acceptedAt) return null;
        return snapshot.rule === 'acm' ? acmCell(cell.score === 1, cell.wrongAttempts ?? 0, cell.elapsedSeconds ?? 0) : cell.score;
    }) };
}

export function publicReplayRows(entries: ReplayEntry[], rule: ContestReplayFrame['rule'], hideTotals: boolean,
    names: ReadonlyMap<number, string>): ContestReplayFrame['rows'] {
    const compare = (a: Score, b: Score) => comparePaperScores(a, b)
        || (rule === 'ioi' ? (b.passed ?? -1) - (a.passed ?? -1) : 0)
        || (rule !== 'highest' ? (a.seconds ?? Number.MAX_SAFE_INTEGER) - (b.seconds ?? Number.MAX_SAFE_INTEGER) : 0);
    entries.sort((a, b) => (hideTotals ? 0 : compare(a, b)) || a.uid - b.uid || a.source.localeCompare(b.source));
    return rankSkippingUnofficial(entries, (a, b) => compare(a, b) === 0).map(([rank, entry]) => ({
        uid: entry.uid, name: names.get(entry.uid) ?? `UID ${entry.uid}`, source: entry.source, cells: entry.cells,
        ...(hideTotals ? {} : { rank, score: entry.score, ...(entry.maxPoints != null ? { maxPoints: entry.maxPoints } : {}), ...(rule === 'ioi' ? { passed: entry.passed } : {}),
            ...(rule !== 'highest' ? { seconds: entry.seconds } : {}) }),
    }));
}
