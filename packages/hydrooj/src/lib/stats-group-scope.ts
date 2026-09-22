import { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';

const GROUP_ID_PATTERN = /^[a-f0-9]{24}$/;

export interface StatsGroupOption {
    _id: string;
    name: string;
    archivedAt: string | null;
}

export function normalizeRequestedGroupIds(requested: readonly string[] | undefined): string[] {
    if (!requested?.length) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of requested) {
        const token = value.trim().toLowerCase();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        ids.push(token);
    }
    return ids;
}

/**
 * Empty request means no group filter.
 * Any token that is not a canonical group id in `allowedIds` fails closed.
 */
export function parseStatsGroupIds(requested: readonly string[] | undefined, allowedIds: ReadonlySet<string>): ObjectId[] | null {
    const tokens = normalizeRequestedGroupIds(requested);
    if (!tokens.length) return null;
    const allowed = new Set([...allowedIds].map((id) => id.toLowerCase()));
    const ids: ObjectId[] = [];
    for (const token of tokens) {
        if (!GROUP_ID_PATTERN.test(token) || !allowed.has(token)) {
            throw new ValidationError('groupIds', null, localizedErrorText`所选用户组无效`);
        }
        ids.push(new ObjectId(token));
    }
    return ids;
}

export function boundUserIdsForStats(students: readonly { boundUserId?: number | null }[]): number[] {
    const seen = new Set<number>();
    const uids: number[] = [];
    for (const student of students) {
        const uid = Number(student.boundUserId);
        if (!Number.isSafeInteger(uid) || uid < 2 || seen.has(uid)) continue;
        seen.add(uid);
        uids.push(uid);
    }
    return uids;
}

export function statsGroupOption(group: { _id: unknown; name?: unknown; archivedAt?: unknown }): StatsGroupOption {
    const id = String(group._id).toLowerCase();
    const name = typeof group.name === 'string' && group.name.trim() ? group.name.trim() : id;
    let archivedAt: string | null = null;
    if (group.archivedAt instanceof Date && !Number.isNaN(group.archivedAt.getTime())) archivedAt = group.archivedAt.toISOString();
    else if (typeof group.archivedAt === 'string' && group.archivedAt.trim()) archivedAt = group.archivedAt.trim();
    return { _id: id, name, archivedAt };
}

export function courseStatsQueryGroupIds(courseGroupIds: readonly unknown[], selected: readonly ObjectId[] | null): ObjectId[] {
    if (selected) return [...selected];
    return courseGroupIds.map((id) => (id instanceof ObjectId ? id : new ObjectId(String(id))));
}
