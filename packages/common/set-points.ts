import type { ProblemKind } from './problem-kind';
import { contestProblemScoreWeight, type ExamPaperQuotas } from './exam-paper';

/** Each entry belongs to one paper. The raw scale is fixed when its point value is assigned. */
export interface SetProblemPoints {
    points: number;
    rawMax: number;
    excluded?: true;
    /** Copied from a legacy weight when another question on the set was edited. */
    fromLegacyWeight?: true;
}

export type SetPaperPoints = Record<number, SetProblemPoints>;

export function roundPaperPoints(value: number): number {
    const cents = value * 100;
    if (!Number.isFinite(cents)) throw new TypeError('set_points_invalid');
    return Math.round(cents + Number.EPSILON * Math.abs(cents)) / 100;
}

export function validPaperPoints(value: unknown): value is number {
    return typeof value === 'number' && value > 0 && value <= 1000 && roundPaperPoints(value) === value;
}

export function paperPointEntry(points: SetPaperPoints, pid: number): SetProblemPoints {
    const entry = points[pid];
    if (!entry || !Number.isFinite(entry.points) || entry.points < 0 || !Number.isFinite(entry.rawMax)
        || entry.rawMax < 0 || (entry.rawMax === 0 && entry.points !== 0)) throw new TypeError(`set_points_missing:${pid}`);
    return entry;
}

export function judgePointMaximum(kind: string, config: unknown): number {
    if (!config || typeof config !== 'object' || !('maxScore' in config) || typeof config.maxScore !== 'number'
        || !Number.isFinite(config.maxScore) || config.maxScore < 0) throw new TypeError('set_judge_max_invalid');
    if (kind === 'subjective' || ('type' in config && config.type === 'program_fill' && 'mode' in config && config.mode === 'text')) return 100;
    return config.maxScore;
}

export function paperProblemMaximum(doc: { score?: unknown; setPoints?: SetPaperPoints }, pid: number, rawMax: number): number {
    if (doc.setPoints) return paperPointEntry(doc.setPoints, pid).points;
    return rawMax * contestProblemScoreWeight(doc, pid) / 100;
}

export function paperAward(entry: SetProblemPoints, raw: number): number {
    if (entry.excluded || (entry.rawMax === 0 && raw === 0)) return 0;
    return roundPaperPoints(raw / entry.rawMax * entry.points);
}

export function paperMaximum(points: SetPaperPoints, pids: readonly number[]): number {
    return roundPaperPoints(pids.reduce((sum, pid) => {
        const entry = paperPointEntry(points, pid);
        return sum + (entry.excluded ? 0 : entry.points);
    }, 0));
}

export function activePaperPids(pids: readonly number[], points?: SetPaperPoints): number[] {
    return points ? pids.filter((pid) => !paperPointEntry(points, pid).excluded) : [...pids];
}

/** Regrading another draw must preserve the original precision of an untouched legacy paper. */
export function pointsForIssuedRound(points: SetPaperPoints | undefined, round: { paperPids: number[]; issuedWithPaperPoints?: true }) {
    if (points && (round.issuedWithPaperPoints || round.paperPids.some((pid) => !paperPointEntry(points, pid).fromLegacyWeight))) return points;
    return undefined;
}

/** The smallest and largest totals a newly issued paper can actually have. */
export function drawnPaperRange(items: readonly { kind: ProblemKind; points: number }[], quotas: ExamPaperQuotas | null) {
    if (!quotas) {
        const total = roundPaperPoints(items.reduce((sum, item) => sum + item.points, 0));
        return { min: total, max: total };
    }
    let min = 0;
    let max = 0;
    for (const [kind, need] of Object.entries(quotas)) {
        const values = items.filter((item) => item.kind === kind).map((item) => item.points).sort((a, b) => a - b);
        if (need > values.length) return null;
        for (let i = 0; i < need; i++) {
            min += values[i];
            max += values[values.length - 1 - i];
        }
    }
    return { min: roundPaperPoints(min), max: roundPaperPoints(max) };
}

export function issuedPaperMaximum(doc: { score?: unknown; setPoints?: SetPaperPoints },
    round: { paperPids: number[]; maxPoints?: number; legacy?: { scoreLocked?: boolean } },
    rawMaximum: (pid: number) => number | undefined): number {
    if (doc.setPoints && !round.legacy?.scoreLocked) return paperMaximum(doc.setPoints, round.paperPids);
    if (round.maxPoints !== undefined) return round.maxPoints;
    return roundPaperPoints(round.paperPids.reduce((sum, pid) => {
        const raw = doc.setPoints?.[pid]?.rawMax ?? rawMaximum(pid);
        if (raw === undefined) throw new TypeError(`set_judge_max_missing:${pid}`);
        return sum + paperProblemMaximum({ score: doc.score }, pid, raw);
    }, 0));
}

/** Compare the actual total, including sub-cent legacy scores, without rounding the rates. */
export function comparePaperScores(left: { score: number; maxPoints?: number }, right: { score: number; maxPoints?: number }): number {
    if (!left.maxPoints || !right.maxPoints || left.maxPoints === right.maxPoints) return right.score - left.score;
    const a = right.score * left.maxPoints;
    const b = left.score * right.maxPoints;
    const difference = a - b;
    return Math.abs(difference) <= Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)) ? 0 : difference;
}
