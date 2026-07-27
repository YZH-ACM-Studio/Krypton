export interface ScoreboardPercentageCell {
    type?: string;
    value?: string | number;
    raw?: unknown;
    score?: number;
    scorePercentage?: number;
    style?: string;
}

interface ScoreboardProblemScore {
    config?: unknown;
}

interface ScoreboardContestScore {
    pids: number[];
    score?: Record<number, number>;
}

interface ScoreScale {
    rawMaximum: number;
    displayMaximum: number;
}

const FULL_SCORE_EPSILON = 1e-9;

function configuredMaximum(problem: ScoreboardProblemScore | undefined, pid: number): number {
    if (!problem?.config || typeof problem.config !== 'object' || Array.isArray(problem.config)) {
        throw new TypeError(`Cannot normalize scoreboard scores for problem ${pid}: parsed config object is missing`);
    }
    const rawMaximum = (problem.config as { maxScore?: unknown }).maxScore;
    const maximum = Number(rawMaximum);
    if (!Number.isFinite(maximum) || maximum <= 0) {
        throw new TypeError(`Cannot normalize scoreboard scores for problem ${pid}: invalid parsed config.maxScore ${String(rawMaximum)}`);
    }
    return maximum;
}

function scoreScale(tdoc: ScoreboardContestScore, pdict: Record<number, ScoreboardProblemScore>, pid: number): ScoreScale {
    const rawMaximum = configuredMaximum(pdict[pid], pid);
    const rawWeight = tdoc.score?.[pid] || 100;
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight <= 0) {
        throw new TypeError(`Cannot normalize scoreboard scores for problem ${pid}: invalid contest score weight ${String(rawWeight)}`);
    }
    return {
        rawMaximum,
        displayMaximum: (rawMaximum * weight) / 100,
    };
}

function numericScore(score: unknown): number | undefined {
    if (score === null || score === undefined || score === '') return undefined;
    const numeric = Number(score);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function displayedScore(value: unknown): number | undefined {
    const numeric = numericScore(value);
    if (numeric !== undefined) return numeric;
    if (typeof value !== 'string') return undefined;
    const ratio = value.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\//);
    return ratio ? Number(ratio[1]) : undefined;
}

function percentage(score: number | undefined, maximum: number): number | undefined {
    if (score === undefined) return undefined;
    const normalized = (score / maximum) * 100;
    if (Math.abs(normalized - 100) < FULL_SCORE_EPSILON) return 100;
    return Math.min(100, Math.max(0, normalized));
}

function annotateCell(cell: ScoreboardPercentageCell, scale: ScoreScale): void {
    if (cell.type === 'records' && Array.isArray(cell.raw)) {
        for (const record of cell.raw) {
            if (record && typeof record === 'object' && !Array.isArray(record)) {
                annotateCell(record as ScoreboardPercentageCell, scale);
            }
        }
        return;
    }
    const displayValue = displayedScore(cell.value);
    const normalized =
        displayValue === undefined ? percentage(numericScore(cell.score), scale.rawMaximum) : percentage(displayValue, scale.displayMaximum);
    if (normalized !== undefined) cell.scorePercentage = normalized;
}

export function annotateScoreboardPercentages(
    tdoc: ScoreboardContestScore,
    rows: ScoreboardPercentageCell[][],
    pdict: Record<number, ScoreboardProblemScore>,
): void {
    const header = rows[0];
    if (!header) return;

    const scaleByPid = new Map(tdoc.pids.map((pid) => [pid, scoreScale(tdoc, pdict, pid)]));
    const problemScaleByColumn = header.map((cell, column) => {
        if (cell.type !== 'problem') return undefined;
        const pid = Number(cell.raw);
        if (!Number.isSafeInteger(pid)) {
            throw new TypeError(`Cannot normalize scoreboard column ${column}: invalid problem id ${String(cell.raw)}`);
        }
        const scale = scaleByPid.get(pid);
        if (!scale) throw new Error(`Cannot normalize scoreboard column ${column}: problem ${pid} is not in the contest`);
        return scale;
    });
    const totalMaximum = Array.from(scaleByPid.values()).reduce((sum, scale) => sum + scale.displayMaximum, 0);
    const totalScale = { rawMaximum: totalMaximum, displayMaximum: totalMaximum };

    for (const row of rows.slice(1)) {
        for (let column = 0; column < header.length; column++) {
            const cell = row[column];
            if (!cell) continue;
            if (header[column].type === 'problem') {
                const scale = problemScaleByColumn[column];
                if (scale) annotateCell(cell, scale);
            } else if (header[column].type === 'total_score' && totalMaximum > 0) {
                annotateCell(cell, totalScale);
            }
        }
    }
}
