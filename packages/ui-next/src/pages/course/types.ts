import type { KnowledgeMap, MindmapNode } from '../mindmap/types';

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
  courseVideoDueAt?: string | Date | null;
  dag?: unknown[];
  enroll?: boolean;
  pid?: string | number;
  rule?: string;
  uname?: string;
  mindmapId?: string | number;
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
