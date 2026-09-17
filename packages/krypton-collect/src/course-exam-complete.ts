/**
 * Optional collect gate: students must finish the bound course exam
 * before uploading 心得. Missing flag = off. Malformed bindings fail closed.
 */
import { Logger } from '@hydrooj/utils';
import {
    resolveCourseExamCompletion,
    TrainingModel,
    TrainingNotFoundError,
    tryReadStoredCourseExam,
} from 'hydrooj';
import { CollectForbiddenError } from './errors';
import type { CollectCourseRef, CollectRequestDoc } from './types';

const logger = new Logger('collect-exam-complete');

export const COLLECT_EXAM_COMPLETE_REQUIRED_MESSAGE = '须先完成课程结业考试才能提交';
export const COLLECT_EXAM_COMPLETE_CLOSED_MESSAGE = '考试已结束且未参加，无法提交';
export const COLLECT_EXAM_COMPLETE_SETTLE_FAILED_MESSAGE = '考试已结束且未能交卷，无法提交';
export const COLLECT_EXAM_COMPLETE_UNBOUND_MESSAGE = '该收集要求先完成结业考试，但课程未绑定考试';
export const COLLECT_EXAM_COMPLETE_NEED_COURSE_MESSAGE = '须先关联课程才能要求先完成结业考试';
export const COLLECT_EXAM_COMPLETE_NEED_EXAM_MESSAGE = '该课程未绑定结业考试，不能开启此门槛';

export interface CollectExamGateView {
    required: boolean;
    locked: boolean;
    examHref?: string;
    message?: string;
}

export interface CollectExamGateCache {
    completedByContest: Map<string, Promise<CollectExamGateView>>;
}

export interface CollectCourseExamCompletion {
    complete: boolean;
    lockKind: string;
}

export function mapCourseExamCompletionToCollectGate(
    result: CollectCourseExamCompletion,
    contestId: { toHexString(): string },
): CollectExamGateView {
    if (result.complete === true) {
        return { required: true, locked: false, examHref: examHrefFor(contestId) };
    }
    if (result.lockKind === 'missing_contest') return unboundGate();
    if (result.lockKind === 'never_attended_closed') {
        return {
            required: true,
            locked: true,
            message: COLLECT_EXAM_COMPLETE_CLOSED_MESSAGE,
        };
    }
    if (result.lockKind === 'closed_incomplete') {
        return {
            required: true,
            locked: true,
            message: COLLECT_EXAM_COMPLETE_SETTLE_FAILED_MESSAGE,
        };
    }
    if (result.lockKind === 'open') {
        return {
            required: true,
            locked: true,
            examHref: examHrefFor(contestId),
            message: COLLECT_EXAM_COMPLETE_REQUIRED_MESSAGE,
        };
    }
    throw new TypeError(`unsupported course exam lockKind: ${result.lockKind}`);
}

export function requestRequiresCourseExamComplete(
    request: Pick<CollectRequestDoc, 'requireCourseExamComplete'>,
): boolean {
    return request.requireCourseExamComplete === true;
}

function examHrefFor(contestId: { toHexString(): string }): string {
    return `/exam-mode/${contestId.toHexString()}`;
}

function unboundGate(): CollectExamGateView {
    return {
        required: true,
        locked: true,
        message: COLLECT_EXAM_COMPLETE_UNBOUND_MESSAGE,
    };
}

async function loadCourseExamBinding(domainId: string, courseId: CollectCourseRef['courseId']) {
    try {
        const course = await TrainingModel.get(domainId, courseId);
        if (course.kind !== 'course') return null;
        return tryReadStoredCourseExam(course.courseExam);
    } catch (error) {
        if (error instanceof TrainingNotFoundError) return null;
        throw error;
    }
}

export async function resolveCollectExamGate(
    domainId: string,
    uid: number,
    request: CollectRequestDoc,
    cache?: CollectExamGateCache,
): Promise<CollectExamGateView> {
    if (!requestRequiresCourseExamComplete(request)) {
        return { required: false, locked: false };
    }
    if (!request.courseRef) {
        logger.warn(
            'Collect exam gate unbound domain=%s request=%s uid=%d reason=missing-course-ref',
            domainId,
            String(request._id),
            uid,
        );
        return unboundGate();
    }
    const binding = await loadCourseExamBinding(domainId, request.courseRef.courseId);
    if (!binding) {
        logger.warn(
            'Collect exam gate unbound domain=%s request=%s uid=%d course=%s reason=course-exam-missing',
            domainId,
            String(request._id),
            uid,
            String(request.courseRef.courseId),
        );
        return unboundGate();
    }
    const contestKey = binding.contestId.toHexString();
    const completedByContest = cache?.completedByContest || new Map<string, Promise<CollectExamGateView>>();
    let pending = completedByContest.get(contestKey);
    if (!pending) {
        pending = loadContestExamGate(domainId, uid, binding.contestId);
        completedByContest.set(contestKey, pending);
        if (cache) cache.completedByContest = completedByContest;
    }
    return pending;
}

async function loadContestExamGate(
    domainId: string,
    uid: number,
    contestId: { toHexString(): string },
): Promise<CollectExamGateView> {
    const raw = await resolveCourseExamCompletion({ domainId, contestId, uid });
    if (!raw || typeof raw !== 'object' || typeof raw.complete !== 'boolean') {
        throw new TypeError('resolveCourseExamCompletion must return { complete, lockKind }');
    }
    return mapCourseExamCompletionToCollectGate({
        complete: raw.complete,
        lockKind: typeof raw.lockKind === 'string' ? raw.lockKind : '',
    }, contestId);
}

export async function assertCollectExamCompleteForStudent(
    domainId: string,
    uid: number,
    request: CollectRequestDoc,
): Promise<void> {
    const gate = await resolveCollectExamGate(domainId, uid, request);
    if (!gate.locked) return;
    logger.info(
        'Collect exam gate blocked domain=%s request=%s uid=%d reason=%s',
        domainId,
        String(request._id),
        uid,
        gate.message || COLLECT_EXAM_COMPLETE_REQUIRED_MESSAGE,
    );
    throw new CollectForbiddenError(gate.message || COLLECT_EXAM_COMPLETE_REQUIRED_MESSAGE);
}

export async function assertCanEnableRequireCourseExamComplete(
    domainId: string,
    courseRef: CollectCourseRef | null,
    enabled: boolean,
): Promise<void> {
    if (!enabled) return;
    if (!courseRef) throw new CollectForbiddenError(COLLECT_EXAM_COMPLETE_NEED_COURSE_MESSAGE);
    const binding = await loadCourseExamBinding(domainId, courseRef.courseId);
    if (!binding) throw new CollectForbiddenError(COLLECT_EXAM_COMPLETE_NEED_EXAM_MESSAGE);
}
