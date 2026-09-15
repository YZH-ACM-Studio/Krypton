import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError, localizedErrorText, ValidationError } from '../error';
import type { Tdoc, TrainingDoc, TrainingNode } from '../interface';
import * as contest from '../model/contest';
import * as document from '../model/document';

const logger = new Logger('course-exam');

export const COURSE_EXAM_GATES = ['percent', 'chapter', 'all'] as const;
export type CourseExamGateKind = (typeof COURSE_EXAM_GATES)[number];

export interface CourseExamBinding {
    contestId: ObjectId;
    gate: CourseExamGateKind;
    percent?: number;
    chapterId?: number;
}

const FORM_KEYS = ['contestId', 'gate', 'percent', 'chapterId'] as const;

function invalidCourseExamGate(): never {
    throw new ValidationError('courseExam', null, localizedErrorText`结业考试门槛无效`);
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function isCourseExamGateKind(value: unknown): value is CourseExamGateKind {
    return typeof value === 'string' && (COURSE_EXAM_GATES as readonly string[]).includes(value);
}

function parseObjectIdHex(raw: string): ObjectId {
    const trimmed = raw.trim();
    if (!ObjectId.isValid(trimmed) || new ObjectId(trimmed).toHexString() !== trimmed.toLowerCase()) {
        invalidCourseExamGate();
    }
    return new ObjectId(trimmed);
}

function parseFormInt(value: string | number): number {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value)) invalidCourseExamGate();
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^[+-]?[0-9]+$/.test(trimmed)) invalidCourseExamGate();
        const parsed = Number(trimmed);
        if (!Number.isSafeInteger(parsed)) invalidCourseExamGate();
        return parsed;
    }
    invalidCourseExamGate();
}

function readStoredInt(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
        invalidCourseExamGate();
    }
    return value;
}

function assertExactBinding(input: { contestId: ObjectId; gate: CourseExamGateKind; percent?: number; chapterId?: number }): CourseExamBinding {
    if (input.gate === 'percent') {
        if (input.percent === undefined || input.chapterId !== undefined) invalidCourseExamGate();
        if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) invalidCourseExamGate();
        return { contestId: input.contestId, gate: 'percent', percent: input.percent };
    }
    if (input.gate === 'chapter') {
        if (input.chapterId === undefined || input.percent !== undefined) invalidCourseExamGate();
        if (!Number.isInteger(input.chapterId) || input.chapterId < 1) invalidCourseExamGate();
        return { contestId: input.contestId, gate: 'chapter', chapterId: input.chapterId };
    }
    if (input.percent !== undefined || input.chapterId !== undefined) invalidCourseExamGate();
    return { contestId: input.contestId, gate: 'all' };
}

export function parseCourseExamForm(input: {
    contestId?: string;
    gate?: string;
    percent?: string | number;
    chapterId?: string | number;
}): CourseExamBinding | null {
    if (input == null || typeof input !== 'object' || Array.isArray(input)) invalidCourseExamGate();
    if (isBlank(input.contestId)) return null;
    const extra = Object.keys(input).filter((key) => !(FORM_KEYS as readonly string[]).includes(key));
    if (extra.length) invalidCourseExamGate();
    if (typeof input.contestId !== 'string') invalidCourseExamGate();
    if (!isCourseExamGateKind(input.gate)) invalidCourseExamGate();
    const percentPresent = !isBlank(input.percent);
    const chapterPresent = !isBlank(input.chapterId);
    return assertExactBinding({
        contestId: parseObjectIdHex(input.contestId),
        gate: input.gate,
        percent: percentPresent ? parseFormInt(input.percent as string | number) : undefined,
        chapterId: chapterPresent ? parseFormInt(input.chapterId as string | number) : undefined,
    });
}

export function readStoredCourseExam(raw: unknown): CourseExamBinding {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) invalidCourseExamGate();
    const value = raw as Record<string, unknown>;
    const extra = Object.keys(value).filter((key) => !(FORM_KEYS as readonly string[]).includes(key));
    if (extra.length) invalidCourseExamGate();
    if (!(value.contestId instanceof ObjectId) || !isCourseExamGateKind(value.gate)) invalidCourseExamGate();
    const percent = Object.hasOwn(value, 'percent') ? readStoredInt(value.percent) : undefined;
    const chapterId = Object.hasOwn(value, 'chapterId') ? readStoredInt(value.chapterId) : undefined;
    return assertExactBinding({
        contestId: value.contestId,
        gate: value.gate,
        percent,
        chapterId,
    });
}

export async function findCoursesBoundToExam(domainId: string, contestId: ObjectId): Promise<TrainingDoc[]> {
    return document.getMulti(domainId, document.TYPE_TRAINING, { kind: 'course', 'courseExam.contestId': contestId }).toArray();
}

export function isCourseExamDuplicateKey(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as {
        code?: unknown;
        keyPattern?: unknown;
        errmsg?: unknown;
        message?: unknown;
    };
    if (value.code !== 11000) return false;
    const keyPattern = value.keyPattern;
    if (keyPattern && typeof keyPattern === 'object' && !Array.isArray(keyPattern)) {
        const pattern = keyPattern as Record<string, unknown>;
        return Object.hasOwn(pattern, 'domainId') && Object.hasOwn(pattern, 'courseExam.contestId');
    }
    if (keyPattern != null) return false;
    const text = [value.errmsg, value.message].filter((part): part is string => typeof part === 'string').join('\n');
    return text.includes('courseExam.contestId');
}

export async function resolveCourseExamForSave(params: {
    domainId: string;
    courseId: ObjectId | null;
    dag: TrainingNode[];
    binding: CourseExamBinding;
}): Promise<CourseExamBinding> {
    const binding = readStoredCourseExam(params.binding);
    let tdoc: Tdoc;
    try {
        tdoc = await contest.get(params.domainId, binding.contestId);
    } catch (error) {
        if (error instanceof ContestNotFoundError) {
            logger.warn('Course exam binding rejected domain=%s contest=%s reason=contest-missing', params.domainId, binding.contestId);
            throw new ValidationError('courseExamContestId', null, localizedErrorText`该考试不是选择题考试`);
        }
        throw error;
    }
    if (tdoc.rule !== 'exam') {
        logger.warn('Course exam binding rejected domain=%s contest=%s rule=%s reason=not-exam', params.domainId, binding.contestId, tdoc.rule);
        throw new ValidationError('courseExamContestId', null, localizedErrorText`该考试不是选择题考试`);
    }
    if (binding.gate === 'chapter') {
        const chapterId = binding.chapterId;
        const found = (params.dag || []).some((node) => Number.isInteger(node._id) && node._id === chapterId);
        if (!found) {
            logger.warn(
                'Course exam binding rejected domain=%s course=%s chapter=%s reason=chapter-missing',
                params.domainId,
                params.courseId,
                chapterId,
            );
            throw new ValidationError('courseExamChapterId', null, localizedErrorText`指定章节不存在，无法设置观看门槛`);
        }
    }
    const bound = await findCoursesBoundToExam(params.domainId, binding.contestId);
    const conflict = bound.find((doc) => !params.courseId || !doc.docId.equals(params.courseId));
    if (conflict) {
        logger.warn(
            'Course exam contest already bound domain=%s contest=%s course=%s existing=%s',
            params.domainId,
            binding.contestId,
            params.courseId,
            conflict.docId,
        );
        throw new ValidationError('courseExamContestId', null, localizedErrorText`这场考试已绑定其它课程`);
    }
    return binding;
}
