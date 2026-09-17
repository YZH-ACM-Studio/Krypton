import type { CourseChapter, CourseExamBinding, CourseStudentVideo } from './types';

export interface CourseExamWatchState {
  locked: boolean;
  remaining: number;
  remainingVideos: CourseStudentVideo[];
}

export const COURSE_EXAM_ENTER_GRACE_MS = 60_000;

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

export function canEnterCourseExam(params: {
  watchLocked: boolean;
  attend?: boolean;
  endAt?: string;
  missing?: boolean;
  now?: number;
}): boolean {
  if (params.missing === true) return false;
  const endMs = params.endAt ? Date.parse(params.endAt) : Number.NaN;
  const now = params.now ?? Date.now();
  const ended = Number.isFinite(endMs) && now >= endMs;
  const afterGrace = Number.isFinite(endMs) && now > endMs + COURSE_EXAM_ENTER_GRACE_MS;
  if (params.attend === true) return !afterGrace;
  if (ended) return false;
  return !params.watchLocked;
}
