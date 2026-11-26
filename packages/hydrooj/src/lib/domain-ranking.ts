import { serializeRanking } from '../../../krypton-external-rating/src/serialize';
import { parseUserExternalRatingState } from '../../../krypton-external-rating/src/types';

export interface RankingQuery {
    sort: string;
    order: 'asc' | 'desc';
    q: string;
    schoolId: string;
    groupId: string;
    binding: '' | 'bound' | 'unbound';
}

export class RankingQueryError extends Error {
    constructor(readonly field: string, readonly forbidden = false) {
        super(`Invalid ranking query: ${field}`);
    }
}

export function rankingQuery(raw: Record<string, unknown>, canFilter: boolean, rpKeys: string[]): RankingQuery {
    const value = (key: string, fallback = '') => {
        const input = raw[key];
        if (input === undefined) return fallback;
        if (typeof input !== 'string') throw new RankingQueryError(key);
        return input.trim();
    };
    const sort = value('sort', 'rp');
    const order = value('order', 'desc');
    const q = value('q');
    const schoolId = value('schoolId');
    const groupId = value('groupId');
    const binding = value('binding');
    if (!canFilter && (q || schoolId || groupId || binding || sort === 'student')) throw new RankingQueryError('filters', true);
    const allowed = ['rank', 'user', 'student', 'rp', 'ac', 'bio', 'codeforces', 'nowcoder', ...rpKeys.map((key) => `rp:${key}`)];
    if (!allowed.includes(sort)) throw new RankingQueryError('sort');
    if (order !== 'asc' && order !== 'desc') throw new RankingQueryError('order');
    if (q.length > 200) throw new RankingQueryError('q');
    for (const [key, id] of [['schoolId', schoolId], ['groupId', groupId]]) {
        if (id && !/^[a-f0-9]{24}$/.test(id)) throw new RankingQueryError(key);
    }
    if (binding !== '' && binding !== 'bound' && binding !== 'unbound') throw new RankingQueryError('binding');
    return { sort, order, q, schoolId, groupId, binding };
}

export interface RankingStudent {
    studentId: string;
    realName: string;
    schoolId: string;
    groupIds: string[];
}

export interface RankingEntry {
    uid: number;
    uname: string;
    bio: string;
    rp: number;
    rpInfo?: Record<string, unknown>;
    rank: number;
    nAccept: number;
    nSubmit?: number;
    student?: RankingStudent;
    ratings: ReturnType<typeof serializeRanking>;
}

/** Use the same opt-in projection as the displayed columns, including for administrators. */
export function rankingPublicRatings(snapshot: unknown) {
    return serializeRanking(parseUserExternalRatingState(snapshot ?? null));
}

export function hasRankingFilters(query: RankingQuery): boolean {
    return !!(query.q || query.schoolId || query.groupId || query.binding);
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function compareValue(left: unknown, right: unknown, direction: number): number {
    const a = typeof left === 'number' && Number.isFinite(left) ? left : typeof left === 'string' && left.trim() ? left : null;
    const b = typeof right === 'number' && Number.isFinite(right) ? right : typeof right === 'string' && right.trim() ? right : null;
    // Missing values stay at the end for both directions; zero is a real score.
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return direction * (typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b)));
}

function sortValue(row: RankingEntry, key: string): unknown {
    if (key.startsWith('rp:')) {
        const value = row.rpInfo?.[key.slice(3)];
        return typeof value === 'number' ? value : null;
    }
    switch (key) {
        case 'rank': return row.rank;
        case 'user': return row.uname;
        case 'student': return row.student?.studentId;
        case 'rp': return row.rp;
        case 'ac': return row.nAccept;
        case 'bio': return row.bio;
        case 'codeforces': return row.ratings.codeforces;
        case 'nowcoder': return row.ratings.nowcoder;
        default: throw new RankingQueryError('sort');
    }
}

export function selectRankingPage(entries: RankingEntry[], query: RankingQuery, page: number, pageSize: number) {
    if (!Number.isSafeInteger(page) || page < 1) throw new RankingQueryError('page');
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RankingQueryError('pageSize');
    const needle = query.q.toLocaleLowerCase('zh-CN');
    const rows = entries.filter((row) => {
        if (needle && String(row.uid) !== needle && ![row.uname, row.student?.studentId, row.student?.realName]
            .some((text) => text?.toLocaleLowerCase('zh-CN').includes(needle))) return false;
        if (query.schoolId && row.student?.schoolId !== query.schoolId) return false;
        if (query.groupId && !row.student?.groupIds.includes(query.groupId)) return false;
        if (query.binding === 'bound' && !row.student) return false;
        if (query.binding === 'unbound' && row.student) return false;
        return true;
    });
    const direction = query.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => compareValue(sortValue(a, query.sort), sortValue(b, query.sort), direction)
        || (query.sort === 'student' ? compareValue(a.student?.realName, b.student?.realName, direction) : 0)
        || a.uid - b.uid);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), count: rows.length, pages: Math.ceil(rows.length / pageSize) };
}
