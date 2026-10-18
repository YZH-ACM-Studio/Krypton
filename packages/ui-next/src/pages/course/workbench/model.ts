import type { DomainUserOption } from '@/components/domain-user-search';
import type { ChapterDraft, CourseAuthorVideo, CourseExamBinding, CourseFile, CourseRecord, GroupRefView, SectionDraft } from '../types';

export type CourseTab = 'chapters' | 'students' | 'exam' | 'mindmap' | 'videos' | 'settings';

const EXAM_GATE_BLOCK = '这一章是结业考试的解锁条件，先在「结业考试」里改掉';

export function parseCourseTab(value: unknown): CourseTab {
  if (
    value === 'chapters'
    || value === 'students'
    || value === 'exam'
    || value === 'mindmap'
    || value === 'videos'
    || value === 'settings'
  ) {
    return value;
  }
  return 'chapters';
}

/** Page payload copied from the previous course editor. Fields stay complete for the shell rewrite. */
export interface CourseEditorPageData {
  tdoc?: CourseRecord;
  chapters?: string;
  page_name: string;
  groupOptions: GroupRefView[];
  attachedGroups: GroupRefView[];
  canManageOwnGroups: boolean;
  canManageFiles: boolean;
  canCreate?: boolean;
  canCreateQuiz: boolean;
  canAssign?: boolean;
  expectedOwner?: number;
  ownerUser?: DomainUserOption;
  maintainerUsers?: DomainUserOption[];
  files: CourseFile[];
  mindmaps: Array<{ _id: string; title: string; visibility: 'public' }>;
  courseOwnedMindmap?: { _id: string; title: string; updatedAt: string };
  courseExamContest?: unknown;
}

export interface ChapterCounts {
  videos: number;
  problems: number;
  refs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function draftText(value: unknown): string {
  if (value) return String(value);
  return '';
}

function readAuthorVideos(raw: unknown): CourseAuthorVideo[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TypeError('Invalid course video payload');
  return raw.map((item) => {
    if (!isRecord(item)) throw new TypeError('Invalid course video payload');
    if (typeof item.id !== 'string' || typeof item.title !== 'string') throw new TypeError('Invalid course video payload');
    if (item.ext !== 'mp4' && item.ext !== 'webm') throw new TypeError('Invalid course video payload');
    return {
      id: item.id,
      title: item.title,
      filename: typeof item.filename === 'string' ? item.filename : 'video.mp4',
      ext: item.ext,
      size: typeof item.size === 'number' ? item.size : 0,
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
      confirmed: item.confirmed === true,
      contentRevision: typeof item.contentRevision === 'number' ? item.contentRevision : 1,
    };
  });
}

function readDraftMindmapSource(raw: Record<string, unknown>): { sourceMindmapNodeId?: string; sourceMindmapBody?: string } {
  const source: { sourceMindmapNodeId?: string; sourceMindmapBody?: string } = {};
  if (raw.sourceMindmapNodeId !== undefined) {
    if (typeof raw.sourceMindmapNodeId !== 'string' || !/^[a-f0-9]{24}$/.test(raw.sourceMindmapNodeId)) {
      throw new TypeError('Invalid course mindmap chapter link');
    }
    source.sourceMindmapNodeId = raw.sourceMindmapNodeId;
  }
  if (raw.sourceMindmapBody !== undefined) {
    if (typeof raw.sourceMindmapBody !== 'string') throw new TypeError('Invalid course mindmap chapter body');
    if (raw.sourceMindmapBody) source.sourceMindmapBody = raw.sourceMindmapBody;
  }
  return source;
}

export function initialChapterDrafts(raw: unknown): ChapterDraft[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw !== 'string') throw new TypeError('Invalid course chapter payload');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid course chapter payload');
  return parsed.map((chapter) => {
    if (!isRecord(chapter)) throw new TypeError('Invalid course chapter payload');
    const source = readDraftMindmapSource(chapter);
    return {
      _id: Number(chapter._id),
      title: draftText(chapter.title),
      content: draftText(chapter.content),
      pids: Array.isArray(chapter.pids) ? chapter.pids.map(String) : [],
      videos: readAuthorVideos(chapter.videos),
      files: readDraftFiles(chapter.files),
      sections: Array.isArray(chapter.sections)
        ? chapter.sections.map((section: unknown) => {
            if (!isRecord(section)) throw new TypeError('Invalid course chapter payload');
            const sectionSource = readDraftMindmapSource(section);
            return {
              _id: Number(section._id),
              title: draftText(section.title),
              content: draftText(section.content),
              pids: Array.isArray(section.pids) ? section.pids.map(String) : [],
              videos: readAuthorVideos(section.videos),
              ...sectionSource,
            };
          })
        : [],
      ...source,
      tids: Array.isArray(chapter.tids) ? chapter.tids.map(String).join(',') : '',
      problemSetId: draftText(chapter.problemSetId),
      stageIds: Array.isArray(chapter.stageIds) ? chapter.stageIds.map(String).join(',') : '',
    };
  });
}

function readDraftFiles(value: unknown): CourseFile[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('Invalid course chapter files');
  return value.map((file) => {
    if (!isRecord(file)) throw new TypeError('Invalid course chapter files');
    const name = file.name;
    if (typeof name !== 'string' || name === '') throw new TypeError('Invalid course chapter files');
    const size = file.size;
    if (size !== undefined && typeof size !== 'number') throw new TypeError('Invalid course chapter files');
    return { name, ...(typeof size === 'number' ? { size } : {}) };
  });
}

function parseRefs(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Same object shape and key order as the previous editor's hidden `chapters` field. Videos stay on the draft. */
export function chaptersJson(chapters: ChapterDraft[]): string {
  return JSON.stringify(
    chapters.map((chapter) => ({
      _id: chapter._id,
      title: chapter.title,
      ...(chapter.content ? { content: chapter.content } : {}),
      pids: chapter.pids,
      ...(chapter.sections.length
        ? {
            sections: chapter.sections.map((section) => ({
              _id: section._id,
              title: section.title,
              ...(section.content ? { content: section.content } : {}),
              pids: section.pids,
              ...(section.sourceMindmapNodeId ? { sourceMindmapNodeId: section.sourceMindmapNodeId } : {}),
              ...(section.sourceMindmapBody ? { sourceMindmapBody: section.sourceMindmapBody } : {}),
            })),
          }
        : {}),
      ...(chapter.sourceMindmapNodeId ? { sourceMindmapNodeId: chapter.sourceMindmapNodeId } : {}),
      ...(chapter.sourceMindmapBody ? { sourceMindmapBody: chapter.sourceMindmapBody } : {}),
      tids: parseRefs(chapter.tids),
      ...((chapter.problemSetId || '').trim() ? { problemSetId: (chapter.problemSetId || '').trim() } : {}),
      ...(parseRefs(chapter.stageIds || '').length ? { stageIds: parseRefs(chapter.stageIds || '').map(Number) } : {}),
    })),
  );
}

function blankChapter(id: number, title: string): ChapterDraft {
  return {
    _id: id,
    title,
    content: '',
    pids: [],
    videos: [],
    files: [],
    sections: [],
    tids: '',
    problemSetId: '',
    stageIds: '',
  };
}

function nextId(ids: readonly number[]): number {
  return Math.max(0, ...ids) + 1;
}

function chapterIndex(chapters: readonly ChapterDraft[], chapterId: number): number {
  const index = chapters.findIndex((chapter) => chapter._id === chapterId);
  if (index < 0) throw new RangeError(`course chapter ${chapterId} not found`);
  return index;
}

function moveAt<T>(items: readonly T[], from: number, toIndex: number): T[] {
  if (!Number.isInteger(from) || from < 0 || from >= items.length) {
    throw new RangeError(`course move index ${from} is out of range`);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= items.length) {
    throw new RangeError(`course move index ${toIndex} is out of range`);
  }
  const next = items.slice();
  if (from === toIndex) return next;
  const [item] = next.splice(from, 1);
  if (item === undefined) throw new RangeError(`course move index ${from} is out of range`);
  next.splice(toIndex, 0, item);
  return next;
}

export function addChapter(chapters: ChapterDraft[]): ChapterDraft[] {
  return [...chapters, blankChapter(nextId(chapters.map((chapter) => chapter._id)), `第 ${chapters.length + 1} 章`)];
}

export function addSection(chapters: ChapterDraft[], chapterId: number): ChapterDraft[] {
  const index = chapterIndex(chapters, chapterId);
  const chapter = chapters[index];
  if (!chapter) throw new RangeError(`course chapter ${chapterId} not found`);
  const section: SectionDraft = {
    _id: nextId(chapter.sections.map((item) => item._id)),
    title: `${index + 1}.${chapter.sections.length + 1} 新小节`,
    content: '',
    pids: [],
    videos: [],
  };
  const next = chapters.slice();
  next[index] = { ...chapter, sections: [...chapter.sections, section] };
  return next;
}

export function moveChapter(chapters: ChapterDraft[], chapterId: number, toIndex: number): ChapterDraft[] {
  return moveAt(chapters, chapterIndex(chapters, chapterId), toIndex);
}

export function moveSection(chapters: ChapterDraft[], chapterId: number, sectionId: number, toIndex: number): ChapterDraft[] {
  const index = chapterIndex(chapters, chapterId);
  const chapter = chapters[index];
  if (!chapter) throw new RangeError(`course chapter ${chapterId} not found`);
  const from = chapter.sections.findIndex((section) => section._id === sectionId);
  if (from < 0) throw new RangeError(`course section ${sectionId} not found`);
  const next = chapters.slice();
  next[index] = { ...chapter, sections: moveAt(chapter.sections, from, toIndex) };
  return next;
}

export function removeChapter(chapters: ChapterDraft[], chapterId: number): ChapterDraft[] {
  if (chapters.length <= 1) throw new RangeError('course_last_chapter');
  const index = chapterIndex(chapters, chapterId);
  return chapters.filter((_, itemIndex) => itemIndex !== index);
}

export function removeSection(chapters: ChapterDraft[], chapterId: number, sectionId: number): ChapterDraft[] {
  const index = chapterIndex(chapters, chapterId);
  const chapter = chapters[index];
  if (!chapter) throw new RangeError(`course chapter ${chapterId} not found`);
  const sectionIndex = chapter.sections.findIndex((section) => section._id === sectionId);
  if (sectionIndex < 0) throw new RangeError(`course section ${sectionId} not found`);
  const next = chapters.slice();
  next[index] = { ...chapter, sections: chapter.sections.filter((_, itemIndex) => itemIndex !== sectionIndex) };
  return next;
}

export function chapterRemovalBlocker(chapter: ChapterDraft, exam: CourseExamBinding | null): string | null {
  if (exam === null || exam.gate !== 'chapter' || exam.chapterId !== chapter._id) return null;
  return EXAM_GATE_BLOCK;
}

function referenceCount(chapter: ChapterDraft): number {
  const problemSet = (chapter.problemSetId || '').trim() ? 1 : 0;
  return problemSet + parseRefs(chapter.tids).length;
}

export function chapterCounts(chapter: ChapterDraft, sectionId: number | null): ChapterCounts {
  if (sectionId !== null) {
    const section = chapter.sections.find((item) => item._id === sectionId);
    if (!section) throw new RangeError(`course section ${sectionId} not found`);
    return { videos: section.videos.length, problems: section.pids.length, refs: 0 };
  }
  let videos = chapter.videos.length;
  let problems = chapter.pids.length;
  for (const section of chapter.sections) {
    videos += section.videos.length;
    problems += section.pids.length;
  }
  return { videos, problems, refs: referenceCount(chapter) };
}

export function courseSummary(chapters: ChapterDraft[]): { chapters: number; videos: number; problemSets: number } {
  let videos = 0;
  let problemSets = 0;
  for (const chapter of chapters) {
    const counts = chapterCounts(chapter, null);
    videos += counts.videos;
    problemSets += counts.refs;
  }
  return { chapters: chapters.length, videos, problemSets };
}
