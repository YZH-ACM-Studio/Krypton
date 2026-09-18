import {
  EXAM_PAPER_FINALIZE_GRACE_MS,
  asExamPaperDate,
  canStartExamPaper,
  isExamPaperStarted,
  isExamPaperUnstartedClosed,
  isExamPaperWindowClosed,
} from '@hydrooj/common';
import type { CourseChapter, CourseExamBinding, CourseStudentVideo } from './types';

export interface CourseExamWatchState {
  locked: boolean;
  remaining: number;
  remainingVideos: CourseStudentVideo[];
}

export const COURSE_EXAM_ENTER_GRACE_MS = EXAM_PAPER_FINALIZE_GRACE_MS;

function chapterVideos(chapter: CourseChapter): CourseStudentVideo[] {
  const videos = [...(chapter.videos || [])];
  for (const section of chapter.sections || []) {
    videos.push(...(section.videos || []));
  }
  return videos;
}

export function collectCourseExamVideos(chapters: CourseChapter[], exam: CourseExamBinding): CourseStudentVideo[] {
  if (exam.gate === 'chapter') {
    const chapter = chapters.find((item) => item._id === exam.chapterId);
    return chapter ? chapterVideos(chapter) : [];
  }
  const videos: CourseStudentVideo[] = [];
  for (const chapter of chapters) {
    videos.push(...chapterVideos(chapter));
  }
  return videos;
}

function requiredDoneForPercent(total: number, percent: number): number {
  return Math.ceil((percent * total) / 100);
}

export function computeCourseExamWatchState(videos: CourseStudentVideo[], exam: CourseExamBinding): CourseExamWatchState {
  const incomplete = videos.filter((video) => video.completed !== true);
  const total = videos.length;
  const done = total - incomplete.length;

  if (exam.gate === 'percent') {
    const percent = exam.percent ?? 100;
    if (total === 0) return { locked: true, remaining: 0, remainingVideos: [] };
    if (Math.floor((100 * done) / total) >= percent) {
      return { locked: false, remaining: 0, remainingVideos: [] };
    }
    const remaining = Math.max(0, requiredDoneForPercent(total, percent) - done);
    return { locked: true, remaining, remainingVideos: incomplete.slice(0, remaining) };
  }

  if (total === 0) return { locked: true, remaining: 0, remainingVideos: [] };
  if (incomplete.length === 0) return { locked: false, remaining: 0, remainingVideos: [] };
  return { locked: true, remaining: incomplete.length, remainingVideos: incomplete };
}

function examPaperClock(params: {
  beginAt?: string;
  endAt?: string;
  startAt?: string;
  durationHours?: number;
}) {
  return {
    tdoc: { beginAt: params.beginAt, endAt: params.endAt, duration: params.durationHours },
    tsdoc: { startAt: params.startAt },
  };
}

export function canEnterCourseExam(params: {
  watchLocked: boolean;
  attend?: boolean;
  endAt?: string;
  beginAt?: string;
  startAt?: string;
  durationHours?: number;
  missing?: boolean;
  now?: number;
}): boolean {
  if (params.missing === true) return false;
  const now = params.now ?? Date.now();
  const durationHours = params.durationHours;
  if (typeof durationHours === 'number' && durationHours > 0) {
    const nowDate = new Date(now);
    const { tdoc, tsdoc } = examPaperClock(params);
    if (params.attend === true && isExamPaperStarted(tsdoc)) {
      if (!asExamPaperDate(params.endAt)) return true;
      return !isExamPaperWindowClosed(tdoc, tsdoc, nowDate);
    }
    if (!canStartExamPaper(tdoc, nowDate)) return false;
    return params.attend === true || !params.watchLocked;
  }
  const endMs = params.endAt ? Date.parse(params.endAt) : Number.NaN;
  const ended = Number.isFinite(endMs) && now >= endMs;
  const afterGrace = Number.isFinite(endMs) && now > endMs + COURSE_EXAM_ENTER_GRACE_MS;
  if (params.attend === true) return !afterGrace;
  if (ended) return false;
  return !params.watchLocked;
}

export function isCourseExamEnterClosed(params: {
  attend?: boolean;
  endAt?: string;
  beginAt?: string;
  startAt?: string;
  durationHours?: number;
  missing?: boolean;
  now?: number;
}): boolean {
  if (params.missing === true) return false;
  const now = params.now ?? Date.now();
  const durationHours = params.durationHours;
  if (typeof durationHours === 'number' && durationHours > 0) {
    const nowDate = new Date(now);
    const { tdoc, tsdoc } = examPaperClock(params);
    if (params.attend === true && isExamPaperStarted(tsdoc)) {
      return asExamPaperDate(params.endAt) ? isExamPaperWindowClosed(tdoc, tsdoc, nowDate) : false;
    }
    return isExamPaperUnstartedClosed(tdoc, tsdoc, nowDate);
  }
  const endMs = params.endAt ? Date.parse(params.endAt) : Number.NaN;
  return Number.isFinite(endMs) && now >= endMs;
}
