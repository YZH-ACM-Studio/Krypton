/**
 * CACC result rules: stages, awards, ordering, parsing, import decisions.
 *
 * Pure module — runtime imports are forbidden (type-only imports allowed).
 * Existing specs stub `./db` for handler/presets and load this file for real.
 */
import type { CaccAward, CaccScoreDoc, CaccStage } from './types';

export const CACC_STAGES: readonly CaccStage[] = ['regional', 'final'];
/** Highest first. */
export const CACC_AWARDS: readonly CaccAward[] = ['first', 'second', 'third', 'participant'];

export const CACC_STAGE_LABELS: Readonly<Record<CaccStage, string>> = { regional: '区域赛', final: '决赛' };
export const CACC_AWARD_LABELS: Readonly<Record<CaccAward, string>> = {
    first: '一等奖',
    second: '二等奖',
    third: '三等奖',
    participant: '参赛',
};

export const CACC_STAGE_OPTIONS = CACC_STAGES.map((value) => ({ value, label: CACC_STAGE_LABELS[value] }));
export const CACC_AWARD_OPTIONS = CACC_AWARDS.map((value) => ({ value, label: CACC_AWARD_LABELS[value] }));

export const CACC_YEAR_MIN = 2000;
export const CACC_YEAR_MAX = 2099;

const AWARD_RANK: Readonly<Record<CaccAward, number>> = { first: 4, second: 3, third: 2, participant: 1 };

const STAGE_ALIASES: Readonly<Record<string, CaccStage>> = {
    regional: 'regional',
    final: 'final',
    区域赛: 'regional',
    决赛: 'final',
};

const AWARD_ALIASES: Readonly<Record<string, CaccAward>> = {
    first: 'first',
    second: 'second',
    third: 'third',
    participant: 'participant',
    一等奖: 'first',
    二等奖: 'second',
    三等奖: 'third',
    一等: 'first',
    二等: 'second',
    三等: 'third',
    参赛: 'participant',
};

export function isCaccStage(value: unknown): value is CaccStage {
    return typeof value === 'string' && (CACC_STAGES as readonly string[]).includes(value);
}

export function isCaccAward(value: unknown): value is CaccAward {
    return typeof value === 'string' && (CACC_AWARDS as readonly string[]).includes(value);
}

export function isCaccYear(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= CACC_YEAR_MIN && value <= CACC_YEAR_MAX;
}

/** Accepts regional/final (any case), 区域赛/决赛. Returns null otherwise. */
export function parseCaccStage(raw: string): CaccStage | null {
    const key = raw.trim().toLowerCase();
    return Object.hasOwn(STAGE_ALIASES, key) ? STAGE_ALIASES[key] : null;
}

/** Accepts first/second/third/participant (any case), 一等奖/二等奖/三等奖, 一等/二等/三等, 参赛. */
export function parseCaccAward(raw: string): CaccAward | null {
    const key = raw.trim().toLowerCase();
    return Object.hasOwn(AWARD_ALIASES, key) ? AWARD_ALIASES[key] : null;
}

/** Import-row year: exactly four digits, within range. */
export function parseCaccYear(raw: string): number | null {
    const text = raw.trim();
    if (!/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    return isCaccYear(year) ? year : null;
}

export function caccAwardAtLeast(actual: CaccAward, min: CaccAward): boolean {
    return AWARD_RANK[actual] >= AWARD_RANK[min];
}

export type CaccImportDecision = 'insert' | 'upgrade' | 'unchanged' | 'skip';

/** Bulk import never lowers an existing award. */
export function decideCaccImport(existing: CaccAward | null, incoming: CaccAward): CaccImportDecision {
    if (existing === null) return 'insert';
    if (AWARD_RANK[incoming] > AWARD_RANK[existing]) return 'upgrade';
    if (incoming === existing) return 'unchanged';
    return 'skip';
}

/** Best record: higher award first, then the later year. Null when empty. */
export function bestCaccScore<T extends Pick<CaccScoreDoc, 'award' | 'year'>>(docs: readonly T[]): T | null {
    let best: T | null = null;
    for (const doc of docs) {
        if (
            !best ||
            AWARD_RANK[doc.award] > AWARD_RANK[best.award] ||
            (doc.award === best.award && doc.year > best.year)
        ) {
            best = doc;
        }
    }
    return best;
}
