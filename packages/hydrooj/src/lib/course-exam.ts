import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError, localizedErrorText, ValidationError } from '../error';
import type { Tdoc, TrainingDoc, TrainingNode } from '../interface';
import * as contest from '../model/contest';
import * as document from '../model/document';
import { listCourseVideos, studentVisibleVideos } from './course-video';

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

export function tryReadStoredCourseExam(raw: unknown): CourseExamBinding | null {
    if (raw == null) return null;
    return readStoredCourseExam(raw);
}

export async function findCoursesBoundToExam(domainId: string, contestId: ObjectId): Promise<TrainingDoc[]> {
    return document.getMulti(domainId, document.TYPE_TRAINING, { kind: 'course', 'courseExam.contestId': contestId }).toArray();
}

export type CourseExamBindRejectReason =
    | 'client_required'
    | 'assign_set'
    | 'empty_pids'
    | 'no_confirmed_videos'
    | 'no_chapter_confirmed_videos'
    | 'site_wide_scoped'
    | 'scope_uncovered';

function objectIdHex(value: ObjectId): string {
    if (!(value instanceof ObjectId)) {
        throw new TypeError('course exam group id must be an ObjectId');
    }
    return value.toHexString();
}

/** Pure bind-time client / video / scope decision. Does not touch Mongo. */
export function decideCourseExamBindConstraints(input: {
    isClientRequired: boolean;
    hasAssign: boolean;
    hasPids: boolean;
    studentVisibleCount: number;
    gate: CourseExamGateKind;
    courseGroupIds: readonly ObjectId[];
    participantScopeMode?: Tdoc['participantScopeMode'];
    participantGroupIds?: readonly ObjectId[];
}): CourseExamBindRejectReason | null {
    if (input.isClientRequired) return 'client_required';
    if (input.hasAssign) return 'assign_set';
    if (!input.hasPids) return 'empty_pids';
    if (!input.studentVisibleCount) {
        return input.gate === 'chapter' ? 'no_chapter_confirmed_videos' : 'no_confirmed_videos';
    }
    const courseGroupIds = input.courseGroupIds || [];
    const mode = input.participantScopeMode;
    if (mode !== 'schools' && mode !== 'groups') return null;
    if (!courseGroupIds.length) return 'site_wide_scoped';
    if (mode === 'schools') return 'scope_uncovered';
    const allowed = new Set((input.participantGroupIds || []).map(objectIdHex));
    for (const groupId of courseGroupIds) {
        if (!allowed.has(objectIdHex(groupId))) return 'scope_uncovered';
    }
    return null;
}

function throwCourseExamBindReason(reason: CourseExamBindRejectReason): never {
    if (reason === 'client_required') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`结业考试不能使用客户端入场`);
    }
    if (reason === 'assign_set') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`结业考试不能使用比赛分配名单`);
    }
    if (reason === 'empty_pids') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`结业考试不能绑定空试卷`);
    }
    if (reason === 'no_confirmed_videos') {
        throw new ValidationError('courseExam', null, localizedErrorText`课程还没有已确认视频，不能设置观看门槛`);
    }
    if (reason === 'no_chapter_confirmed_videos') {
        throw new ValidationError('courseExamChapterId', null, localizedErrorText`指定章节没有已确认视频，不能设置观看门槛`);
    }
    if (reason === 'site_wide_scoped') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`全站可见的课程不能绑定限定范围的结业考试`);
    }
    if (reason === 'scope_uncovered') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`结业考试的参赛范围必须覆盖课程可见班级`);
    }
    throw new ValidationError('courseExam', null, localizedErrorText`结业考试门槛无效`);
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
    courseGroupIds: ObjectId[];
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
    const listed = listCourseVideos(params.dag || []);
    const scoped = binding.gate === 'chapter' ? listed.filter((item) => item.chapterId === binding.chapterId) : listed;
    const reason = decideCourseExamBindConstraints({
        isClientRequired: contest.isClientRequired(tdoc),
        hasAssign: Array.isArray(tdoc.assign) && tdoc.assign.length > 0,
        hasPids: Array.isArray(tdoc.pids) && tdoc.pids.some((pid) => typeof pid === 'number' && Number.isSafeInteger(pid)),
        studentVisibleCount: studentVisibleVideos(scoped.map((item) => item.video)).length,
        gate: binding.gate,
        courseGroupIds: params.courseGroupIds || [],
        participantScopeMode: tdoc.participantScopeMode,
        participantGroupIds: tdoc.participantGroupIds,
    });
    if (reason) {
        logger.warn(
            'Course exam binding rejected domain=%s contest=%s course=%s reason=%s',
            params.domainId,
            binding.contestId,
            params.courseId,
            reason,
        );
        throwCourseExamBindReason(reason);
    }
    return binding;
}
