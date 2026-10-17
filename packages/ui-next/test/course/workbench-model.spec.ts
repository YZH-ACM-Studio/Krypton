// @vitest-environment node
// A static import fails collection while src/pages/course/workbench/model.ts is absent.
import { describe, expect, it } from 'vitest';
import type { ChapterDraft, CourseAuthorVideo, CourseExamBinding, SectionDraft } from '../../src/pages/course/types.ts';

const modelLoaders = import.meta.glob('../../src/pages/course/workbench/model.ts');
const MODEL_SOURCE = 'src/pages/course/workbench/model.ts';

const EXAM_GATE_BLOCK = '这一章是结业考试的解锁条件，先在「结业考试」里改掉';

/** Bytes from the old editor chaptersJson. Videos stay on the draft and are omitted here. */
const OLD_CHAPTERS_JSON = '[{"_id":1,"title":"绪论","content":"讲义一","pids":["P1001","P1002"],"sections":[{"_id":1,"title":"1.1 概念","content":"小节讲义","pids":["P2001"],"sourceMindmapNodeId":"aaaaaaaaaaaaaaaaaaaaaaaa","sourceMindmapBody":"节点正文"}],"sourceMindmapNodeId":"bbbbbbbbbbbbbbbbbbbbbbbb","sourceMindmapBody":"章节点正文","tids":["64b8000000000000000000a1","64b8000000000000000000a2"],"problemSetId":"64b8000000000000000000b1","stageIds":[1,2]},{"_id":3,"title":"空章","pids":[],"tids":[]}]';

const RAW_CHAPTERS: Record<string, unknown>[] = [
  {
    _id: 1,
    title: '绪论',
    content: '讲义一',
    pids: ['P1001', 'P1002'],
    videos: [
      {
        id: 'video-intro',
        title: '导论',
        filename: 'intro.mp4',
        ext: 'mp4',
        size: 1200,
        durationMs: 90000,
        confirmed: true,
        contentRevision: 2,
      },
    ],
    sections: [
      {
        _id: 1,
        title: '1.1 概念',
        content: '小节讲义',
        pids: ['P2001'],
        videos: [
          {
            id: 'video-concept',
            title: '概念片',
            filename: 'concept.webm',
            ext: 'webm',
            size: 800,
            durationMs: 45000,
            confirmed: false,
            contentRevision: 1,
          },
        ],
        sourceMindmapNodeId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        sourceMindmapBody: '节点正文',
      },
    ],
    sourceMindmapNodeId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    sourceMindmapBody: '章节点正文',
    tids: ['64b8000000000000000000a1', '64b8000000000000000000a2'],
    problemSetId: '64b8000000000000000000b1',
    stageIds: [1, 2],
  },
  {
    _id: 3,
    title: '空章',
    content: '',
    pids: [],
    videos: [
      {
        id: 'video-empty',
        title: '空章视频',
        filename: 'empty.mp4',
        ext: 'mp4',
        size: 4,
        durationMs: 10,
        confirmed: true,
        contentRevision: 1,
      },
    ],
    sections: [],
    tids: [],
    problemSetId: '   ',
    stageIds: [],
  },
];

type CourseTab = 'chapters' | 'students' | 'exam' | 'mindmap' | 'videos' | 'settings';

interface ChapterCounts {
  videos: number;
  problems: number;
  refs: number;
}

interface CourseSummary {
  chapters: number;
  videos: number;
  problemSets: number;
}

interface WorkbenchModel {
  parseCourseTab: (value: unknown) => CourseTab;
  initialChapterDrafts: (raw: unknown) => ChapterDraft[];
  chaptersJson: (chapters: ChapterDraft[]) => string;
  addChapter: (chapters: ChapterDraft[]) => ChapterDraft[];
  addSection: (chapters: ChapterDraft[], chapterId: number) => ChapterDraft[];
  moveChapter: (chapters: ChapterDraft[], chapterId: number, toIndex: number) => ChapterDraft[];
  moveSection: (chapters: ChapterDraft[], chapterId: number, sectionId: number, toIndex: number) => ChapterDraft[];
  removeChapter: (chapters: ChapterDraft[], chapterId: number) => ChapterDraft[];
  removeSection: (chapters: ChapterDraft[], chapterId: number, sectionId: number) => ChapterDraft[];
  chapterRemovalBlocker: (chapter: ChapterDraft, exam: CourseExamBinding | null) => string | null;
  chapterCounts: (chapter: ChapterDraft, sectionId: number | null) => ChapterCounts;
  courseSummary: (chapters: ChapterDraft[]) => CourseSummary;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

async function loadModel(): Promise<WorkbenchModel> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(modelLoaders)) {
    if (key.endsWith(MODEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return {
    parseCourseTab: asFunction<WorkbenchModel['parseCourseTab']>(readField(imported, 'parseCourseTab'), 'parseCourseTab'),
    initialChapterDrafts: asFunction<WorkbenchModel['initialChapterDrafts']>(readField(imported, 'initialChapterDrafts'), 'initialChapterDrafts'),
    chaptersJson: asFunction<WorkbenchModel['chaptersJson']>(readField(imported, 'chaptersJson'), 'chaptersJson'),
    addChapter: asFunction<WorkbenchModel['addChapter']>(readField(imported, 'addChapter'), 'addChapter'),
    addSection: asFunction<WorkbenchModel['addSection']>(readField(imported, 'addSection'), 'addSection'),
    moveChapter: asFunction<WorkbenchModel['moveChapter']>(readField(imported, 'moveChapter'), 'moveChapter'),
    moveSection: asFunction<WorkbenchModel['moveSection']>(readField(imported, 'moveSection'), 'moveSection'),
    removeChapter: asFunction<WorkbenchModel['removeChapter']>(readField(imported, 'removeChapter'), 'removeChapter'),
    removeSection: asFunction<WorkbenchModel['removeSection']>(readField(imported, 'removeSection'), 'removeSection'),
    chapterRemovalBlocker: asFunction<WorkbenchModel['chapterRemovalBlocker']>(readField(imported, 'chapterRemovalBlocker'), 'chapterRemovalBlocker'),
    chapterCounts: asFunction<WorkbenchModel['chapterCounts']>(readField(imported, 'chapterCounts'), 'chapterCounts'),
    courseSummary: asFunction<WorkbenchModel['courseSummary']>(readField(imported, 'courseSummary'), 'courseSummary'),
  };
}

function authorVideo(id: string, ext: 'mp4' | 'webm', confirmed: boolean): CourseAuthorVideo {
  return {
    id,
    title: id,
    filename: `${id}.${ext}`,
    ext,
    size: 1,
    durationMs: 1000,
    confirmed,
    contentRevision: 1,
  };
}

function sectionDraft(id: number, title: string, extras: Partial<Pick<SectionDraft, 'pids' | 'videos'>> = {}): SectionDraft {
  return {
    _id: id,
    title,
    content: '',
    pids: extras.pids ?? [],
    videos: extras.videos ?? [],
  };
}

function chapterDraft(overrides: { _id: number; title: string } & Partial<Omit<ChapterDraft, '_id' | 'title'>>): ChapterDraft {
  return {
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
    problemSetId: '',
    stageIds: '',
    ...overrides,
  };
}

function chapterIds(chapters: ChapterDraft[]): number[] {
  return chapters.map((chapter) => chapter._id);
}

function thrownRangeError(run: () => void): RangeError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RangeError);
    if (!(error instanceof RangeError)) throw new TypeError('expected RangeError');
    return error;
  }
  throw new Error('expected RangeError');
}

describe('course workbench model', () => {
  it('serializes a chapter fixture to the old chaptersJson bytes', async () => {
    const model = await loadModel();
    expect(model.chaptersJson(model.initialChapterDrafts(''))).toBe('[]');
    expect(model.chaptersJson(model.initialChapterDrafts(undefined))).toBe('[]');

    const drafts = model.initialChapterDrafts(JSON.stringify(RAW_CHAPTERS));
    expect(drafts[0]?.videos.map((video) => video.id)).toEqual(['video-intro']);
    expect(drafts[0]?.videos[0]?.confirmed).toBe(true);
    expect(drafts[0]?.videos[0]?.ext).toBe('mp4');
    expect(drafts[0]?.sections[0]?.videos.map((video) => video.id)).toEqual(['video-concept']);
    expect(drafts[0]?.sections[0]?.videos[0]?.confirmed).toBe(false);
    expect(drafts[0]?.sections[0]?.videos[0]?.ext).toBe('webm');
    expect(drafts[1]?.videos.map((video) => video.id)).toEqual(['video-empty']);
    expect(model.chaptersJson(drafts)).toBe(OLD_CHAPTERS_JSON);
  });

  it('moves the third chapter to the first position without changing ids', async () => {
    const model = await loadModel();
    const chapters = [
      chapterDraft({ _id: 1, title: '第 1 章' }),
      chapterDraft({ _id: 2, title: '第 2 章' }),
      chapterDraft({ _id: 3, title: '第 3 章' }),
    ];
    const moved = model.moveChapter(chapters, 3, 0);
    expect(chapterIds(moved)).toEqual([3, 1, 2]);
    expect(moved.map((chapter) => chapter.title)).toEqual(['第 3 章', '第 1 章', '第 2 章']);
    expect(chapterIds(chapters)).toEqual([1, 2, 3]);
  });

  it('refuses to remove the last chapter', async () => {
    const model = await loadModel();
    const only = chapterDraft({
      _id: 2,
      title: '第 2 章',
      sections: [sectionDraft(1, '仅有的小节')],
    });
    const error = thrownRangeError(() => {
      model.removeChapter([only], only._id);
    });
    expect(error.message).toBe('course_last_chapter');

    const chapters = [chapterDraft({ _id: 1, title: '甲' }), chapterDraft({ _id: 2, title: '乙' })];
    expect(chapterIds(model.removeChapter(chapters, 1))).toEqual([2]);
    expect(chapterIds(chapters)).toEqual([1, 2]);
  });

  it('blocks removal of the exam gate chapter', async () => {
    const model = await loadModel();
    const gate: CourseExamBinding = {
      contestId: '64b8000000000000000000c1',
      gate: 'chapter',
      chapterId: 2,
    };
    const second = chapterDraft({ _id: 2, title: '第 2 章' });
    expect(model.chapterRemovalBlocker(second, gate)).toBe(EXAM_GATE_BLOCK);
    expect(model.chapterRemovalBlocker(chapterDraft({ _id: 1, title: '第 1 章' }), gate)).toBeNull();
    expect(model.chapterRemovalBlocker(chapterDraft({ _id: 8, title: '第 2 章' }), gate)).toBeNull();
    expect(model.chapterRemovalBlocker(second, null)).toBeNull();
    expect(model.chapterRemovalBlocker(second, { contestId: gate.contestId, gate: 'all' })).toBeNull();
    expect(model.chapterRemovalBlocker(second, { contestId: gate.contestId, gate: 'percent', percent: 80 })).toBeNull();
    expect(model.chapterRemovalBlocker(second, { contestId: gate.contestId, gate: 'chapter', chapterId: 9 })).toBeNull();
  });

  it('counts only that section videos and problems', async () => {
    const model = await loadModel();
    const chapter = chapterDraft({
      _id: 2,
      title: '第 2 章',
      pids: ['P1', 'P2', 'P3'],
      videos: [authorVideo('chapter-a', 'mp4', true), authorVideo('chapter-b', 'mp4', true)],
      sections: [sectionDraft(7, '2.1', { pids: ['P9', 'P8'], videos: [authorVideo('section-a', 'webm', false)] })],
      tids: 'hw-1,exam-2',
      problemSetId: 'ps-1',
      stageIds: '1,2',
    });
    const counts = model.chapterCounts(chapter, 7);
    expect(counts.videos).toBe(1);
    expect(counts.problems).toBe(2);
  });

  it('names a new chapter and section by outline position', async () => {
    const model = await loadModel();
    const chapters = [
      chapterDraft({ _id: 4, title: '甲' }),
      chapterDraft({
        _id: 9,
        title: '乙',
        sections: [sectionDraft(5, '已有')],
      }),
    ];
    const withChapter = model.addChapter(chapters);
    expect(withChapter).toHaveLength(3);
    expect(withChapter[2]?.title).toBe('第 3 章');
    expect(chapterIds(withChapter).slice(0, 2)).toEqual([4, 9]);
    expect(chapters).toHaveLength(2);

    const withSection = model.addSection(chapters, 9);
    const target = withSection.find((chapter) => chapter._id === 9);
    expect(target?.sections).toHaveLength(2);
    expect(target?.sections[1]?.title).toBe('2.2 新小节');
    expect(target?.sections[0]?._id).toBe(5);
    expect(withSection[0]?.sections).toEqual([]);
    expect(chapters[1]?.sections).toHaveLength(1);
  });

  it('keeps known course tabs and falls back to chapters', async () => {
    const model = await loadModel();
    const tabs: CourseTab[] = ['chapters', 'students', 'exam', 'mindmap', 'videos', 'settings'];
    for (const tab of tabs) expect(model.parseCourseTab(tab)).toBe(tab);
    const illegal: unknown[] = [null, undefined, '', 'chapter', 'VIDEOS', 1, { tab: 'exam' }];
    for (const value of illegal) expect(model.parseCourseTab(value)).toBe('chapters');
  });

  it('moves and removes a section within its chapter', async () => {
    const model = await loadModel();
    const chapters = [
      chapterDraft({
        _id: 2,
        title: '第 2 章',
        sections: [sectionDraft(1, '一'), sectionDraft(2, '二'), sectionDraft(3, '三')],
      }),
      chapterDraft({ _id: 4, title: '第 4 章', sections: [sectionDraft(1, '别章')] }),
    ];
    const moved = model.moveSection(chapters, 2, 3, 0);
    expect(moved[0]?.sections.map((section) => section._id)).toEqual([3, 1, 2]);
    expect(moved[0]?.sections.map((section) => section.title)).toEqual(['三', '一', '二']);
    expect(moved[1]?.sections.map((section) => section._id)).toEqual([1]);
    expect(chapters[0]?.sections.map((section) => section._id)).toEqual([1, 2, 3]);

    const removed = model.removeSection(chapters, 2, 2);
    expect(removed[0]?.sections.map((section) => section._id)).toEqual([1, 3]);
    expect(removed[1]?.sections.map((section) => section.title)).toEqual(['别章']);
    expect(chapters[0]?.sections).toHaveLength(3);
  });

  it('reports the number of chapters', async () => {
    const model = await loadModel();
    const chapters = [chapterDraft({ _id: 1, title: '甲' }), chapterDraft({ _id: 2, title: '乙' })];
    expect(model.courseSummary(chapters).chapters).toBe(2);
  });
});
