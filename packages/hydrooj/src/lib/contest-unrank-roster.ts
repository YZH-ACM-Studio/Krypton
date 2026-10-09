import { ValidationError } from '../error';

export type UnrankRosterState =
    | { kind: 'off' }
    | { kind: 'unlocked' }
    | { kind: 'locked'; uids: readonly number[] };

type RosterDoc = {
    unrankRosterEnabled?: unknown;
    unrankRosterUids?: unknown;
    rule?: unknown;
    participationMode?: unknown;
    participantScopeMode?: unknown;
    participantGroupIds?: unknown;
};

function rosterError(message: string) {
    return new ValidationError('unrankRoster', null, message);
}

function isCanonicalUidList(value: unknown): value is number[] {
    if (!Array.isArray(value)) return false;
    let previous = 0;
    for (const uid of value) {
        if (!Number.isSafeInteger(uid) || uid <= previous) return false;
        previous = uid;
    }
    return true;
}

/** Missing switch is off. A saved list must already be a strictly increasing uid list. */
export function readUnrankRoster(tdoc: RosterDoc | null | undefined): UnrankRosterState {
    const enabled = tdoc?.unrankRosterEnabled;
    const uids = tdoc?.unrankRosterUids;
    const hasUids = uids !== undefined && uids !== null;
    if (enabled === undefined || enabled === false) {
        if (hasUids) throw rosterError('打星名单数据不正确。');
        return { kind: 'off' };
    }
    if (enabled !== true) throw rosterError('打星名单数据不正确。');
    if (!hasUids) return { kind: 'unlocked' };
    if (!isCanonicalUidList(uids)) throw rosterError('打星名单数据不正确。');
    return { kind: 'locked', uids };
}

export function assertUnrankRosterCanEnable(rule: unknown, participationMode: unknown): void {
    const normalizedRule = typeof rule === 'string' ? rule.toLowerCase() : '';
    const mode = participationMode === 'team' ? 'team' : 'individual';
    if (mode !== 'individual' || (normalizedRule !== 'acm' && normalizedRule !== 'ioi')) {
        throw rosterError('只有个人 ACM 和个人 IOI 比赛可以指定打星名单。');
    }
}

export function canonicalizeRosterUids(raw: readonly unknown[]): number[] {
    const uids: number[] = [];
    for (const value of raw) {
        if (!Number.isSafeInteger(value) || Number(value) <= 0) throw rosterError('打星名单里有无效账号。');
        uids.push(Number(value));
    }
    return [...new Set(uids)].sort((left, right) => left - right);
}

export function rosterUidChanges(previous: readonly number[], next: readonly number[]): { added: number[]; removed: number[] } {
    const previousSet = new Set(previous);
    const nextSet = new Set(next);
    return {
        added: next.filter((uid) => !previousSet.has(uid)),
        removed: previous.filter((uid) => !nextSet.has(uid)),
    };
}

export function assertAddedRosterUids(added: readonly number[], eligible: ReadonlySet<number>, groupScope: boolean): void {
    if (!added.length) return;
    if (!groupScope) throw rosterError('当前参赛范围不是用户组，不能向打星名单加入新人。');
    const rejected = added.filter((uid) => !eligible.has(uid));
    if (rejected.length) {
        throw rosterError(`这些账号不在当前参赛用户组的已绑定学生里，不能加入打星名单：${rejected.join('、')}。`);
    }
}

/** Locked roster ignores the requested flag. Unlocked keeps the old self-star behavior. */
export function resolveAttendUnrank(state: UnrankRosterState, uid: number, requested: boolean): boolean | undefined {
    if (state.kind === 'locked') return state.uids.includes(uid);
    return requested ? true : undefined;
}

export function unrankUpdatesForRoster(
    rows: readonly { uid: number; unrank?: unknown }[],
    uids: ReadonlySet<number>,
): Array<{ uid: number; unrank: boolean }> {
    const updates: Array<{ uid: number; unrank: boolean }> = [];
    for (const row of rows) {
        if (!Number.isSafeInteger(row.uid) || row.uid <= 0) throw rosterError('参赛状态里有无效账号，不能改写打星。');
        if (row.unrank !== undefined && row.unrank !== null && typeof row.unrank !== 'boolean') {
            throw rosterError('参赛状态里的打星标记不正确，不能改写打星。');
        }
        const shouldStar = uids.has(row.uid);
        if ((row.unrank === true) !== shouldStar) updates.push({ uid: row.uid, unrank: shouldStar });
    }
    return updates;
}

export function publicUnrankRoster(tdoc: RosterDoc | null | undefined, uid: number): {
    enabled: boolean;
    saved: boolean;
    viewerIncluded: boolean;
} {
    const state = readUnrankRoster(tdoc);
    if (state.kind === 'off') return { enabled: false, saved: false, viewerIncluded: false };
    if (state.kind === 'unlocked') return { enabled: true, saved: false, viewerIncluded: false };
    return { enabled: true, saved: true, viewerIncluded: state.uids.includes(uid) };
}

export function contestHasGroupScope(tdoc: RosterDoc | null | undefined): boolean {
    return tdoc?.participantScopeMode === 'groups'
        && Array.isArray(tdoc.participantGroupIds)
        && tdoc.participantGroupIds.length > 0;
}
