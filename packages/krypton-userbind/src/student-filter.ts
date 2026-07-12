import type { Filter, ObjectId } from 'hydrooj';
import type { StudentRecord } from './types';

export type StudentBindingStatus = 'all' | 'bound' | 'unbound';
export type StudentTimeField = 'boundAt' | 'createdAt';

export interface ListStudentsFilter {
    schoolId?: ObjectId;
    groupId?: ObjectId;
    boundOnly?: boolean;
    unboundOnly?: boolean;
    query?: string;
    enrollmentYear?: number;
    bindingStatus?: StudentBindingStatus;
    timeField?: StudentTimeField;
    /** Inclusive UTC boundary. */
    from?: Date;
    /** Exclusive UTC boundary. */
    to?: Date;
    limit?: number;
    skip?: number;
}

export interface StudentFilterQueryInput {
    enrollmentYear?: unknown;
    bindingStatus?: unknown;
    timeField?: unknown;
    from?: unknown;
    to?: unknown;
}

export interface StudentFilterUrlValues {
    enrollmentYear: string;
    bindingStatus: StudentBindingStatus;
    timeField: StudentTimeField;
    from: string;
    to: string;
}

export interface ParsedStudentFilterQuery {
    enrollmentYear?: number;
    bindingStatus: StudentBindingStatus;
    timeField: StudentTimeField;
    from?: Date;
    to?: Date;
    values: StudentFilterUrlValues;
}

export class StudentFilterValidationError extends Error {
    constructor(
        public readonly field: string,
        message: string,
    ) {
        super(message);
        this.name = 'StudentFilterValidationError';
    }
}

function optionalString(value: unknown, field: string): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
        throw new StudentFilterValidationError(field, `${field} 参数格式非法`);
    }
    return value.trim();
}

function assertValidDate(date: Date, field: string): void {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        throw new StudentFilterValidationError(field, `${field} 日期格式非法`);
    }
}

/**
 * Parse a strict YYYY-MM-DD natural day in Asia/Shanghai.
 * `from` is that day's 00:00 inclusive; `to` is the next day's 00:00 exclusive.
 */
export function parseShanghaiNaturalDate(value: string, boundary: 'from' | 'to'): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        throw new StudentFilterValidationError(boundary, '日期必须为 YYYY-MM-DD');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
        throw new StudentFilterValidationError(boundary, '日期不是有效的日历日期');
    }

    const dayOffset = boundary === 'to' ? 1 : 0;
    const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
    return new Date(Date.UTC(year, month - 1, day + dayOffset) - shanghaiOffsetMs);
}

export function parseStudentFilterQuery(input: StudentFilterQueryInput): ParsedStudentFilterQuery {
    const enrollmentYearValue = optionalString(input.enrollmentYear, 'enrollmentYear');
    const bindingStatusValue = optionalString(input.bindingStatus, 'bindingStatus') || 'all';
    const timeFieldValue = optionalString(input.timeField, 'timeField') || 'boundAt';
    const fromValue = optionalString(input.from, 'from');
    const toValue = optionalString(input.to, 'to');

    if (enrollmentYearValue && !/^(?:19\d{2}|20\d{2})$/.test(enrollmentYearValue)) {
        throw new StudentFilterValidationError('enrollmentYear', '入学年必须是 1900–2099 的四位十进制年份');
    }
    if (!['all', 'bound', 'unbound'].includes(bindingStatusValue)) {
        throw new StudentFilterValidationError('bindingStatus', '绑定状态参数非法');
    }
    if (!['boundAt', 'createdAt'].includes(timeFieldValue)) {
        throw new StudentFilterValidationError('timeField', '时间字段参数非法');
    }

    const from = fromValue ? parseShanghaiNaturalDate(fromValue, 'from') : undefined;
    const to = toValue ? parseShanghaiNaturalDate(toValue, 'to') : undefined;
    if (from && to && from >= to) {
        throw new StudentFilterValidationError('from', '开始日期不能晚于结束日期');
    }

    const bindingStatus = bindingStatusValue as StudentBindingStatus;
    const timeField = timeFieldValue as StudentTimeField;
    return {
        enrollmentYear: enrollmentYearValue ? Number(enrollmentYearValue) : undefined,
        bindingStatus,
        timeField,
        from,
        to,
        values: {
            enrollmentYear: enrollmentYearValue,
            bindingStatus,
            timeField,
            from: fromValue,
            to: toValue,
        },
    };
}

export function escapeRegexLiteral(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBindingStatus(filter: ListStudentsFilter): StudentBindingStatus {
    if (filter.boundOnly && filter.unboundOnly) {
        throw new StudentFilterValidationError('bindingStatus', 'boundOnly 与 unboundOnly 不能同时启用');
    }

    const legacyStatus = filter.boundOnly ? 'bound' : filter.unboundOnly ? 'unbound' : undefined;
    const requestedStatus = filter.bindingStatus;
    if (requestedStatus && !['all', 'bound', 'unbound'].includes(requestedStatus)) {
        throw new StudentFilterValidationError('bindingStatus', '绑定状态参数非法');
    }
    if (legacyStatus && requestedStatus && requestedStatus !== legacyStatus) {
        throw new StudentFilterValidationError('bindingStatus', '新旧绑定状态参数互相冲突');
    }
    return requestedStatus || legacyStatus || 'all';
}

export function buildStudentsMongoFilter(domainId: string, filter: ListStudentsFilter = {}): Filter<StudentRecord> {
    const mongoFilter: Filter<StudentRecord> = { domainId };
    if (filter.schoolId) mongoFilter.schoolId = filter.schoolId;
    if (filter.groupId) mongoFilter.groupIds = filter.groupId;

    if (filter.enrollmentYear !== undefined) {
        if (!Number.isInteger(filter.enrollmentYear) || filter.enrollmentYear < 1900 || filter.enrollmentYear > 2099) {
            throw new StudentFilterValidationError('enrollmentYear', '入学年必须是 1900–2099 的整数');
        }
        mongoFilter.enrollmentYear = filter.enrollmentYear;
    }

    const bindingStatus = normalizeBindingStatus(filter);
    if (bindingStatus === 'bound') mongoFilter.boundUserId = { $gt: 0 };
    else if (bindingStatus === 'unbound') mongoFilter.boundUserId = null;

    const timeField = filter.timeField || 'boundAt';
    if (timeField !== 'boundAt' && timeField !== 'createdAt') {
        throw new StudentFilterValidationError('timeField', '时间字段参数非法');
    }
    if (filter.from) assertValidDate(filter.from, 'from');
    if (filter.to) assertValidDate(filter.to, 'to');
    if (filter.from && filter.to && filter.from > filter.to) {
        throw new StudentFilterValidationError('from', '开始日期不能晚于结束日期');
    }
    if (filter.from || filter.to) {
        const timeRange: { $gte?: Date; $lt?: Date } = {};
        if (filter.from) timeRange.$gte = filter.from;
        if (filter.to) timeRange.$lt = filter.to;
        (mongoFilter as Record<string, unknown>)[timeField] = timeRange;
    }

    const query = (filter.query || '').trim();
    if (query) {
        const escaped = escapeRegexLiteral(query);
        mongoFilter.$or = [{ studentId: { $regex: escaped, $options: 'i' } }, { realName: { $regex: escaped, $options: 'i' } }];
    }
    return mongoFilter;
}

interface StudentListCursor {
    sort(spec: Record<string, 1 | -1>): StudentListCursor;
    skip(value: number): StudentListCursor;
    limit(value: number): StudentListCursor;
    toArray(): Promise<StudentRecord[]>;
}

export interface StudentListCollection {
    countDocuments(filter: Filter<StudentRecord>): Promise<number>;
    find(filter: Filter<StudentRecord>): StudentListCursor;
}

export async function listStudentsFromCollection(
    collection: StudentListCollection,
    domainId: string,
    filter: ListStudentsFilter = {},
): Promise<{ docs: StudentRecord[]; total: number }> {
    const mongoFilter = buildStudentsMongoFilter(domainId, filter);
    const total = await collection.countDocuments(mongoFilter);
    const docs = await collection
        .find(mongoFilter)
        .sort({ studentId: 1, _id: 1 })
        .skip(filter.skip || 0)
        .limit(filter.limit || 100)
        .toArray();
    return { docs, total };
}
