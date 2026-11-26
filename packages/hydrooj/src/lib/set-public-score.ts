/**
 * Course completion from a contest that already stores its chosen round.
 * Missing setConfig returns null so the caller keeps the legacy paper/journal branch.
 * setRoundClosedAt belongs to the selected formal round. tsdoc.score is its total.
 * settings.retake.passScore is the line; null means handing in is enough.
 */
import { readStoredSetConfig } from '@hydrooj/common';

export interface SetRoundStatus {
    setRoundId?: unknown;
    setRoundClosedAt?: unknown;
    setJudgePending?: unknown;
    paperFinalizedAt?: unknown;
    score?: unknown;
}

function roundHandedIn(tsdoc: SetRoundStatus | null | undefined): boolean {
    const value = tsdoc?.setRoundClosedAt;
    return tsdoc?.setRoundId != null && value instanceof Date && !Number.isNaN(value.getTime())
        && tsdoc.setJudgePending === false;
}

function chosenRoundTotal(tsdoc: SetRoundStatus | null | undefined): number | null {
    const score = tsdoc?.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    return score;
}

export function courseCompleteFromSet(tdoc: unknown, tsdoc: SetRoundStatus | null | undefined): boolean | null {
    let passScore: number | null;
    try {
        const config = readStoredSetConfig(tdoc);
        if (config.publication !== 'published') return false;
        passScore = config.settings.retake.passScore;
    } catch (error) {
        if (error instanceof TypeError && error.message === 'set_config_missing') return null;
        throw error;
    }
    if (!roundHandedIn(tsdoc)) return false;
    if (passScore === null) return true;
    const total = chosenRoundTotal(tsdoc);
    return total !== null && total >= passScore;
}
