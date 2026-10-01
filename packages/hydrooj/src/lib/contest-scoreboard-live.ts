import type { ScoreboardNode, ScoreboardRow, Tdoc } from '../interface';

const REVEAL_RULES = new Set(['acm', 'oi', 'ioi']);

interface JournalEntry {
    rid: { getTimestamp(): Date; toHexString(): string };
    pid?: number;
}

interface StatusDoc {
    uid?: number;
    journal?: JournalEntry[];
    [key: string]: unknown;
}

interface ContestRuleStat {
    statusSort: Record<string, 1 | -1>;
    stat: (tdoc: Tdoc, journal: JournalEntry[]) => Record<string, unknown>;
}

export function supportsLockedRealtime(rule: string): boolean {
    return REVEAL_RULES.has(rule);
}

export function scoreboardLockView(input: { realtime: boolean; locked: boolean; rule: string; allowed: boolean; team?: boolean }): {
    revealLocked: boolean;
    lockAtActive: boolean;
    canToggle: boolean;
} {
    const canToggle = input.locked && input.allowed && !input.team && supportsLockedRealtime(input.rule);
    const revealLocked = Boolean(input.realtime && canToggle);
    return {
        revealLocked,
        lockAtActive: Boolean(input.locked && !revealLocked),
        canToggle,
    };
}

export function sortContestJournal<T extends JournalEntry>(journal: T[] | undefined): T[] {
    return [...(journal || [])].sort((left, right) => {
        const delta = left.rid.getTimestamp().getTime() - right.rid.getTimestamp().getTime();
        if (delta !== 0) return delta;
        return left.rid.toHexString().localeCompare(right.rid.toHexString());
    });
}

export function compareByStatusSort(sort: Record<string, 1 | -1>) {
    const keys = Object.keys(sort);
    return (left: StatusDoc, right: StatusDoc) => {
        for (const key of keys) {
            const direction = sort[key];
            const leftValue = left[key] ?? 0;
            const rightValue = right[key] ?? 0;
            if (leftValue === rightValue) continue;
            if (typeof leftValue !== 'number' || typeof rightValue !== 'number') continue;
            if (direction === -1) return leftValue < rightValue ? 1 : -1;
            return leftValue < rightValue ? -1 : 1;
        }
        return (left.uid || 0) - (right.uid || 0);
    };
}

/** Read-time projection. `live` ignores the lock. `frozen` uses the contest as stored. */
export function projectContestStatus<T extends StatusDoc>(rule: ContestRuleStat, tdoc: Tdoc, tsdoc: T, mode: 'live' | 'frozen'): T {
    const journal = sortContestJournal(tsdoc.journal);
    const view = mode === 'live' ? { ...tdoc, unlocked: true } : tdoc;
    const projected = rule.stat(view, journal);
    return { ...tsdoc, ...projected, journal };
}

function cellSignature(cell: ScoreboardNode | undefined): string {
    if (!cell) return '';
    const raw = cell.raw as { toHexString?: () => string } | string | number | null | undefined;
    const rid = raw && typeof raw === 'object' && typeof raw.toHexString === 'function' ? raw.toHexString() : raw ?? '';
    return `${cell.value ?? ''}|${cell.score ?? ''}|${String(rid)}`;
}

const DIVERGENCE_TYPES = new Set(['record', 'records', 'total_score', 'solved', 'time']);

function rowIdentity(header: ScoreboardRow, row: ScoreboardRow): string {
    const index = header.findIndex((cell) => cell.type === 'user');
    if (index < 0) return '';
    return String(row[index]?.raw ?? '');
}

/** Marks live cells whose displayed submission differs from the student board. */
export function markStudentDivergence(liveRows: ScoreboardRow[], frozenRows: ScoreboardRow[]): void {
    const header = liveRows[0];
    const frozenHeader = frozenRows[0];
    if (!header || !frozenHeader) return;
    const frozenByUser = new Map<string, ScoreboardRow>();
    for (const row of frozenRows.slice(1)) {
        const identity = rowIdentity(frozenHeader, row);
        if (identity) frozenByUser.set(identity, row);
    }
    for (const row of liveRows.slice(1)) {
        const frozen = frozenByUser.get(rowIdentity(header, row));
        for (let column = 0; column < header.length; column += 1) {
            const liveCell = row[column];
            const kind = liveCell?.type;
            if (!liveCell || !kind || !DIVERGENCE_TYPES.has(kind)) continue;
            const frozenCell = frozen?.[column];
            if (cellSignature(liveCell) !== cellSignature(frozenCell)) liveCell.studentDivergence = true;
        }
    }
}
