import type { KnowledgeMap, MindmapNode } from '../mindmap/types';

export interface CourseRecord {
  _id?: string | number;
  docId?: string | number;
  title?: string;
  term?: string;
  description?: string;
  content?: string;
  courseGroupIds?: Array<string | number>;
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

export interface CourseSection {
  _id: number;
  title: string;
  content: string;
  pids: number[];
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
}

export interface ChapterDraft {
  _id: number;
  title: string;
  content: string;
  pids: string[];
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
