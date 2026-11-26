import { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';

/** Date controls use the site's Beijing calendar; the end day is inclusive. */
export function recordDateRange(from = '', to = ''): { $gte?: ObjectId; $lt?: ObjectId } | undefined {
    function midnight(value: string, field: string): number {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(field);
        const utc = Date.parse(`${value}T00:00:00Z`);
        if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== value || utc < 86400000 || utc > Date.UTC(2099, 11, 31)) {
            throw new ValidationError(field);
        }
        return utc - 8 * 60 * 60 * 1000;
    }
    const start = from ? midnight(from, 'from') : undefined;
    const end = to ? midnight(to, 'to') + 86400000 : undefined;
    if (start !== undefined && end !== undefined && start >= end) {
        throw new ValidationError('to', null, localizedErrorText`结束日期不能早于开始日期。`);
    }
    if (start === undefined && end === undefined) return undefined;
    return {
        ...(start === undefined ? {} : { $gte: ObjectId.createFromTime(start / 1000) }),
        ...(end === undefined ? {} : { $lt: ObjectId.createFromTime(end / 1000) }),
    };
}

export async function resolveRecordUserIds(
    value: string,
    lookupAccount: (query: string) => Promise<{ _id: number } | null>,
    searchStudents?: (query: string) => Promise<Array<{ boundUserId: number }>>,
): Promise<number[]> {
    const query = value.trim();
    if (!query || query.length > 100) throw new ValidationError('uidOrName');
    const account = await lookupAccount(query);
    // An explicit account identifies one person, even if its UID also occurs in a student ID.
    if (account) return [account._id];
    if (!searchStudents) return [];
    return [...new Set((await searchStudents(query)).map((student) => student.boundUserId))];
}
