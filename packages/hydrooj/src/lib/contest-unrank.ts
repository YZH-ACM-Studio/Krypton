import { localizedErrorText, ValidationError } from '../error';

/** Missing or false is official. Any non-boolean value fails closed. */
export function isContestUnofficial(unrank: unknown): boolean {
    if (unrank === undefined || unrank === null) return false;
    if (typeof unrank === 'boolean') return unrank;
    throw new ValidationError('unrank', null, localizedErrorText`打星标记必须是布尔值。`);
}

/**
 * Unique ranking point for official contest places.
 * Unofficial rows keep display rank 0 (`*`) and do not occupy 1..n.
 */
export function rankSkippingUnofficial<T>(docs: T[], equ: (a: T, b: T) => boolean): Array<[number, T]> {
    let last: T | null = null;
    let r = 0;
    let count = 0;
    const results: Array<[number, T]> = [];
    for (const doc of docs) {
        if (isContestUnofficial((doc as { unrank?: unknown }).unrank)) {
            results.push([0, doc]);
            continue;
        }
        count++;
        if (!last || !equ(last, doc)) r = count;
        last = doc;
        results.push([r, doc]);
    }
    return results;
}

export function contestRpRatingInput<T extends { uid: number; unrank?: unknown }>(
    ranked: Array<[number, T]>,
    udict: Record<number, number>,
): Array<{ uid: number; rank: number; old: number }> {
    const users: Array<{ uid: number; rank: number; old: number }> = [];
    for (const [rank, tsdoc] of ranked) {
        if (isContestUnofficial(tsdoc.unrank)) continue;
        if (!Number.isInteger(rank) || rank <= 0) {
            throw new Error(`Official contest RP input has invalid rank ${rank} for uid ${tsdoc.uid}.`);
        }
        if (!Number.isSafeInteger(tsdoc.uid) || tsdoc.uid <= 0) {
            throw new Error(`Official contest RP input is missing a valid uid for rank ${rank}.`);
        }
        users.push({ uid: tsdoc.uid, rank, old: udict[tsdoc.uid] });
    }
    return users;
}

export function contestScoreboardRankValue(rank: number): string {
    return rank === 0 ? '*' : String(rank);
}

export function assertIndividualContestUnrankAllowed(rule: string, participationMode: string): void {
    if (participationMode === 'team') {
        throw new ValidationError('unrank', null, localizedErrorText`团队比赛不能按个人打星，请由队长或管理员整队设置。`);
    }
    if (rule !== 'acm' && rule !== 'oi' && rule !== 'ioi' && rule !== 'strictioi') {
        throw new ValidationError('unrank', null, localizedErrorText`只有个人 ACM、OI、IOI 和严格 IOI 比赛允许打星。`);
    }
}
