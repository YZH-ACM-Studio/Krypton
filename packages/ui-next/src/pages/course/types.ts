export type CourseRecord = Record<string, any>;

export interface CourseChapter {
  _id: number;
  title: string;
  pids: number[];
  tids: string[];
  progress: number;
  doneCount: number;
  totalCount: number;
}

export interface ChapterDraft {
  _id: number;
  title: string;
  pids: string[];
  tids: string;
}
