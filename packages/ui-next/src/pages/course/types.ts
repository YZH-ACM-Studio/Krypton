import type { KnowledgeMap, MindmapNode } from '../mindmap/types';

export type CourseExamGate = 'percent' | 'chapter' | 'all';

export interface CourseExamBinding {
  contestId?: string;
  gate?: CourseExamGate;
  percent?: number;
  chapterId?: number;
}

export interface CourseExamContestPreview {
  docId: string;
  title: string;
  endAt?: string;
  beginAt?: string;
  startAt?: string;
  paperFinalizedAt?: string;
  duration?: number;
  attend?: boolean;
  complete?: boolean;
  missing?: boolean;
}

export interface CourseRecord {
  _id?: string | number;
  docId?: string | number;
  owner?: number;
  maintainer?: number[];
  title?: string;
  term?: string;
  description?: string;
  content?: string;
  courseGroupIds?: Array<string | number>;
  courseHidden?: boolean;
  courseExam?: CourseExamBinding;
  courseVideoDueAt?: string | Date | null;
  dag?: unknown[];
  enroll?: boolean;
  pid?: string | number;
  rule?: string;
  uname?: string;
  mindmapId?: string | number;
}

export function courseAssignsUserGroups(course: Pick<CourseRecord, 'courseGroupIds'>): boolean {
  return (course.courseGroupIds || []).length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept a hex string or Mongo extended-JSON `{ $oid }`. */
export function readCourseExamDocumentId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (isPlainRecord(value) && typeof value.$oid === 'string' && value.$oid.trim()) return value.$oid.trim();
  throw new TypeError('缺少有效 id');
}

export function readCourseExam(value: unknown): CourseExamBinding | null {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value)) throw new TypeError('courseExam must be an object');
  const contestId = readCourseExamDocumentId(value.contestId);
  const gate = value.gate;
  if (gate !== 'percent' && gate !== 'chapter' && gate !== 'all') {
    throw new TypeError('courseExam.gate is invalid');
  }
  if (gate === 'percent') {
    const percent = value.percent;
    if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100) {
      throw new TypeError('courseExam.percent is invalid');
    }
    return { contestId, gate, percent };
  }
  if (gate === 'chapter') {
    const chapterId = value.chapterId;
    if (typeof chapterId !== 'number' || !Number.isSafeInteger(chapterId)) {
      throw new TypeError('courseExam.chapterId is invalid');
    }
    return { contestId, gate, chapterId };
  }
  return { contestId, gate };
}

export function readCourseExamContest(value: unknown): CourseExamContestPreview | null {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value)) throw new TypeError('courseExamContest must be an object');
  const docId = readCourseExamDocumentId(value.docId ?? value._id);
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '结业考试';
  const endAt = typeof value.endAt === 'string' && value.endAt.trim() ? value.endAt.trim() : undefined;
  const beginAt = typeof value.beginAt === 'string' && value.beginAt.trim() ? value.beginAt.trim() : undefined;
  const startAt = typeof value.startAt === 'string' && value.startAt.trim() ? value.startAt.trim() : undefined;
  const paperFinalizedAt = typeof value.paperFinalizedAt === 'string' && value.paperFinalizedAt.trim()
    ? value.paperFinalizedAt.trim()
    : undefined;
  if (value.duration !== undefined && typeof value.duration !== 'number') {
    throw new TypeError('courseExamContest.duration is invalid');
  }
  const duration = typeof value.duration === 'number' && value.duration > 0 ? value.duration : undefined;
  const attend = value.attend === true;
  const complete = value.complete === true;
  const missing = value.missing === true;
  return {
    docId,
    title,
    ...(endAt ? { endAt } : {}),
    ...(beginAt ? { beginAt } : {}),
    ...(startAt ? { startAt } : {}),
    ...(paperFinalizedAt ? { paperFinalizedAt } : {}),
    ...(duration ? { duration } : {}),
    ...(attend ? { attend: true } : {}),
    ...(complete ? { complete: true } : {}),
    ...(missing ? { missing: true } : {}),
  };
}

export interface CourseFile {
  name: string;
  size?: number;
}

export interface CourseStudentVideo {
  id: string;
  title: string;
  durationMs: number;
  contentRevision: number;
  playUrl: string;
  lastPosition: number;
  coverageRatio: number;
  completed: boolean;
  completedAt: string | null;
}

export interface CourseAuthorVideo {
  id: string;
  title: string;
  filename: string;
  ext: 'mp4' | 'webm';
  size: number;
  durationMs: number;
  confirmed: boolean;
  contentRevision: number;
}

export interface CourseSection {
  _id: number;
  title: string;
  content: string;
  pids: number[];
  videos?: CourseStudentVideo[];
  completedPids: number[];
  progress: number;
  doneCount: number;
  totalCount: number;
}

export interface CourseChapter {
  _id: number;
  title: string;
  content: string;
  pids: number[];
  /** Unsectioned chapter problems plus live-referenced set members. */
  loosePids: number[];
  videos?: CourseStudentVideo[];
  sections: CourseSection[];
  /**
   * Chapter problems the viewer has finished, from the same scoped source
   * that produced `doneCount`. Under a published integrity policy this is
   * the contextual completion set, never global `ProblemStatus`.
   */
  completedPids: number[];
  tids: string[];
  problemSetId?: string;
  stageIds?: number[];
  progress: number;
  doneCount: number;
  totalCount: number;
}

export interface SectionDraft {
  _id: number;
  title: string;
  content: string;
  pids: string[];
  videos: CourseAuthorVideo[];
}

export interface ChapterDraft {
  _id: number;
  title: string;
  content: string;
  pids: string[];
  videos: CourseAuthorVideo[];
  sections: SectionDraft[];
  tids: string;
  problemSetId?: string;
  stageIds?: string;
}

export interface CourseMindmapProblem {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  nodeIds: string[];
  chapters: Array<{ id: number; title: string }>;
}

export interface CourseMindmapData {
  config: KnowledgeMap;
  nodes: MindmapNode[];
  problems: CourseMindmapProblem[];
  usedNodeIds: string[];
}
