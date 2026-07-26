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

export interface CourseChapter {
  _id: number;
  title: string;
  content: string;
  pids: number[];
  tids: string[];
  progress: number;
  doneCount: number;
  totalCount: number;
}

export interface ChapterDraft {
  _id: number;
  title: string;
  content: string;
  pids: string[];
  tids: string;
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
