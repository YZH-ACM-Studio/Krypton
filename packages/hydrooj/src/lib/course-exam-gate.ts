import { ObjectId } from 'mongodb';
import { ContestNotFoundError, localizedErrorText, ValidationError } from '../error';
import * as contest from '../model/contest';
import { findCoursesBoundToExam, readStoredCourseExam, type CourseExamBinding } from './course-exam';
import { isCourseExamCompleteFromStatus } from './course-exam-complete';
import { isCourseVideoComplete, listCourseVideos, studentVisibleVideos } from './course-video';

export interface CourseExamWatchProgress {
    done: number;
    total: number;
    remaining: number;
    remainingTitles: string[];
    reason: 'no_confirmed_videos' | 'percent' | 'chapter' | 'all' | null;
    passed: boolean;
}

export interface CourseExamGateUser {
    _id: number;
    own(doc: any): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

export interface CourseExamGateContest {
    docId: any;
    rule?: string;
    owner: number;
    maintainer?: number[];
}

export function computeCourseExamWatchProgress(dag, progress, gate: CourseExamBinding): CourseExamWatchProgress {
    const listed = listCourseVideos(dag);
    const scoped = gate.gate === 'chapter'
        ? listed.filter((item) => item.chapterId === gate.chapterId)
        : listed;
    const videos = studentVisibleVideos(scoped.map((item) => item.video));
    const rows = new Map();
    for (const row of progress || []) {
        rows.set(`${row.videoId}:${row.contentRevision}`, row);
    }
    const incomplete = [];
    let done = 0;
    for (const video of videos) {
        const row = rows.get(`${video.id}:${video.contentRevision}`);
        const complete = Boolean(row?.completedAt) || (row ? isCourseVideoComplete(row.ranges || [], video.durationMs) : false);
        if (complete) done++;
        else incomplete.push(video);
    }
    const total = videos.length;
    if (total === 0) {
        return {
            done: 0,
            total,
            remaining: 0,
            remainingTitles: [],
            reason: 'no_confirmed_videos',
            passed: false,
        };
    }
    let passed = done === total;
    let remaining = total - done;
    if (gate.gate === 'percent') {
        passed = Math.floor((100 * done) / total) >= gate.percent;
        remaining = Math.max(0, Math.ceil((gate.percent * total) / 100) - done);
    } else if (gate.gate === 'all') {
        passed = done === total;
        remaining = total - done;
    }
    const useful = incomplete.slice(0, remaining).map((video) => video.title);
    return {
        done,
        total,
        remaining,
        remainingTitles: useful,
        reason: passed ? null : gate.gate === 'percent' ? 'percent' : gate.gate === 'chapter' ? 'chapter' : 'all',
        passed,
    };
}

export async function assertCourseExamWatchGate(params: {
    domainId: string;
    user: CourseExamGateUser;
    contest: CourseExamGateContest;
}): Promise<void> {
    const { PERM, PRIV } = require('../model/builtin');
    const { canManageCourse, courseAccessibleTo, courseUserGroupIds, isCourseHidden } = require('./course-access');
    const { loadUserCourseProgress } = require('../model/course-video-progress');
    const courses = await findCoursesBoundToExam(params.domainId, params.contest.docId);
    if (courses.length === 0) return;
    if (courses.length > 1) {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`这场考试已绑定其它课程`);
    }
    const course = courses[0];
    const binding = readStoredCourseExam(course.courseExam);
    if (params.contest.rule !== 'exam') {
        throw new ValidationError('courseExamContestId', null, localizedErrorText`该考试不是选择题考试`);
    }
    if (
        canManageCourse(params.user, course, PERM.PERM_EDIT_COURSE)
        || params.user.own(params.contest)
        || params.user.hasPerm(PERM.PERM_EDIT_CONTEST)
        || params.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
    ) return;
    if (isCourseHidden(course)) {
        throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
    }
    const groups = await courseUserGroupIds(params.domainId, params.user._id);
    if (!await courseAccessibleTo(params.domainId, params.user._id, course, groups, false)) {
        throw new ValidationError('tid', null, localizedErrorText`你不在该课程的可见范围内`);
    }
    const tsdoc = await contest.getStatus(params.domainId, params.contest.docId, params.user._id);
    if (tsdoc?.attend) return;
    const docs = await loadUserCourseProgress(params.domainId, course.docId, params.user._id);
    const progress = computeCourseExamWatchProgress(course.dag, docs, binding);
    if (!progress.passed) {
        if (progress.total === 0 || progress.reason === 'no_confirmed_videos') {
            throw new ValidationError('courseExam', null, localizedErrorText`还不能参加考试`);
        }
        throw new ValidationError('courseExam', null, localizedErrorText`还不能参加考试，还需看完 ${progress.remaining} 个视频`);
    }
}

export async function hasCompletedCourseExam(params: {
    domainId: string;
    contestId: ObjectId;
    uid: number;
}): Promise<boolean> {
    let tdoc;
    try {
        tdoc = await contest.get(params.domainId, params.contestId);
    } catch (error) {
        if (error instanceof ContestNotFoundError) return false;
        throw error;
    }
    const tsdoc = await contest.getStatus(params.domainId, params.contestId, params.uid);
    return isCourseExamCompleteFromStatus(tdoc, tsdoc);
}
