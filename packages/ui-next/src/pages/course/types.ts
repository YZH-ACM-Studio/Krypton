import type { KnowledgeMap, MindmapNode } from '../mindmap/types';

export type CourseRecord = Record<string, any>;

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
