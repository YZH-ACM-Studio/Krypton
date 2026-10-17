import { useState, type ComponentType } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import type { ChapterDraft, SectionDraft } from '../../src/pages/course/types.ts';
import type { TeachListPayload, TeachListRow } from '../../src/pages/teach/model.ts';

// A static import fails collection while src/pages/course/workbench/add-content.tsx is absent.
const menuLoaders = import.meta.glob('../../src/pages/course/workbench/add-content.tsx');

const MENU_SOURCE = 'src/pages/course/workbench/add-content.tsx';
const ORIGIN = 'http://krypton.local';
const COURSE_ID = '64b8000000000000000000c1';
const CHAPTER_ID = 2;
const OLD_SET_ID = '64b8000000000000000000b1';
const NEW_SET_ID = '64b8000000000000000000b2';
const BLANK_SET_ID = '64b8000000000000000000b3';
const PAGE1_SET_ID = '64b8000000000000000000b4';
const HOMEWORK_ID = '64b8000000000000000000d1';
const OLD_TITLE = '链表专项练习';
const NEW_TITLE = '树的遍历练习';
const PAGE1_TITLE = '第一页练习';
const BLANK_TITLE = '空阶段练习';
const HOMEWORK_TITLE = '线性表作业';
const COLLECT_HREF = `/admin/collect/create?fromCourse=${COURSE_ID}&chapter=${CHAPTER_ID}`;
const SAVE_FIRST = '先保存课程修改';
const STAGE_A = '阶段甲';
const STAGE_B = '阶段乙';
const REPLACE_MESSAGE = `这一章只能引用一个练习，原来的「${OLD_TITLE}」会被换掉。`;
const PRACTICE_HREF = `/teach/new?type=practice&fromCourse=${COURSE_ID}&chapter=${CHAPTER_ID}`;
const HOMEWORK_HREF = `/teach/new?type=homework&fromCourse=${COURSE_ID}&chapter=${CHAPTER_ID}`;

interface AddContentMenuProps {
  courseId: string;
  saved: boolean;
  dirty: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  onChange: (next: ChapterDraft) => void;
}

type ChangeFn = ReturnType<typeof vi.fn<(next: ChapterDraft) => void>>;
type User = ReturnType<typeof userEvent.setup>;

interface RenderedMenu {
  user: User;
  onChange: ChangeFn;
}

const CHAPTER_ONLY = ['引用已有题目集', '新建题目集并挂到这里', '文件收集'] as const;

interface StageFixture {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

const NAMED_STAGES: StageFixture[] = [
  { id: 1, title: STAGE_A, requireIds: [], pids: [] },
  { id: 2, title: STAGE_B, requireIds: [], pids: [] },
];
const BLANK_STAGES: StageFixture[] = [
  { id: 1, title: '', requireIds: [], pids: [] },
];

let captured: string[] = [];
let listFixture: 'paged' | 'blank' = 'paged';
let oldPracticeMissing = false;

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent(value: unknown): ComponentType<AddContentMenuProps> {
  expect(typeof value, 'AddContentMenu').toBe('function');
  if (typeof value !== 'function') throw new TypeError('AddContentMenu must be a function');
  return value as ComponentType<AddContentMenuProps>;
}

async function loadAddContentMenu(): Promise<ComponentType<AddContentMenuProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(menuLoaders)) {
    if (key.endsWith(MENU_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MENU_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MENU_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${MENU_SOURCE} must be a module`);
  return asComponent(readField(imported, 'AddContentMenu'));
}

function chapterDraft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    _id: CHAPTER_ID,
    title: '第 2 章 线性表',
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

function sectionDraft(overrides: Partial<SectionDraft> = {}): SectionDraft {
  return {
    _id: 1,
    title: '2.1 顺序表',
    content: '',
    pids: [],
    videos: [],
    ...overrides,
  };
}

function compactText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, '');
}

function isNewSetChoice(element: HTMLElement, label: '练习' | '作业'): boolean {
  const text = compactText(element);
  if (!text.startsWith(label)) return false;
  const rest = text.slice(label.length);
  if (label === '作业' && rest.startsWith('与')) return false;
  if (rest.includes('题目集') || rest.includes('文件收集') || rest.includes('引用') || rest.includes('视频')) return false;
  return true;
}

function choice(label: '练习' | '作业'): HTMLElement | null {
  for (const role of ['menuitem', 'link', 'button'] as const) {
    const found = screen.queryAllByRole(role).find((item) => isNewSetChoice(item, label));
    if (found) return found;
  }
  return null;
}

function choicePair(): { practice: HTMLElement; homework: HTMLElement } | null {
  const practice = choice('练习');
  const homework = choice('作业');
  if (!practice || !homework) return null;
  return { practice, homework };
}

function controlStarting(label: string): HTMLElement | null {
  for (const role of ['menuitem', 'button'] as const) {
    const found = screen.queryAllByRole(role).find((item) => compactText(item).startsWith(label));
    if (found) return found;
  }
  return null;
}

function described(item: HTMLElement): string {
  return [
    item.textContent ?? '',
    item.getAttribute('title') ?? '',
    item.getAttribute('aria-description') ?? '',
  ].join(' ');
}

function destination(item: HTMLElement): string | null {
  const own = item.getAttribute('href');
  if (own) return own;
  return within(item).queryByRole('link')?.getAttribute('href') ?? null;
}

function lastDraft(onChange: ChangeFn): ChapterDraft {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error('onChange was not called');
  return call[0];
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, ORIGIN);
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status = 404): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'ValidationError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function canCreate(): TeachListPayload['canCreate'] {
  return {
    practice: true,
    homework: true,
    exam: true,
    acm: true,
    oi: true,
  };
}

function practiceRow(id: string, title: string): TeachListRow {
  return {
    type: 'practice',
    id,
    rule: 'problem_set',
    title,
    status: 'open',
    beginAt: null,
    endAt: null,
    durationMinutes: null,
    audience: '指定用户组',
    problemCount: 3,
    drawCount: null,
    stageCount: 2,
    participantCount: 4,
    role: 'owner',
    shared: false,
    createdAt: '2026-10-02T00:00:00.000Z',
  };
}

function listPayload(
  type: 'practice' | 'quiz',
  rows: TeachListRow[],
  page: number,
  pageCount: number,
  total: number,
): TeachListPayload {
  return {
    scope: 'mine',
    canSeeAll: false,
    filter: { type, status: 'all', q: '' },
    typeCounts: {
      all: total,
      practice: type === 'practice' ? total : 0,
      quiz: type === 'quiz' ? total : 0,
      acm: 0,
      oi: 0,
    },
    page,
    pageCount,
    total,
    rows,
    sharedRows: [],
    canCreate: canCreate(),
  };
}

function practiceDocument(id: string, title: string, stages: readonly StageFixture[]): Record<string, unknown> {
  return {
    type: 'practice',
    id,
    title,
    content: '',
    description: '',
    ownerUid: 1,
    ownerName: '王老师',
    mine: true,
    rule: 'problem_set',
    beginAt: null,
    endAt: null,
    durationMinutes: null,
    pids: [],
    problems: [],
    scores: {},
    examPaperQuotas: null,
    stages: stages.map((stage) => ({ ...stage })),
    settings: { kind: 'practice' },
    unusablePids: [],
    tdoc: {
      _id: id,
      title,
      dag: stages.map((stage) => ({ _id: stage.id, title: stage.title })),
    },
  };
}

function stagesFor(id: string): readonly StageFixture[] {
  if (id === BLANK_SET_ID) return BLANK_STAGES;
  return NAMED_STAGES;
}

function knownPractice(id: string): { id: string; title: string } | null {
  if (id === OLD_SET_ID) return { id, title: OLD_TITLE };
  if (id === NEW_SET_ID) return { id, title: NEW_TITLE };
  if (id === PAGE1_SET_ID) return { id, title: PAGE1_TITLE };
  if (id === BLANK_SET_ID) return { id, title: BLANK_TITLE };
  return null;
}

function requestedPage(url: URL): number {
  const raw = url.searchParams.get('page');
  if (raw === null || raw === '') return 1;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
}

function homeworkRow(): TeachListRow {
  return {
    ...practiceRow(HOMEWORK_ID, HOMEWORK_TITLE),
    type: 'homework',
    rule: 'homework',
    stageCount: null,
  };
}

function bankItem(docId: number, pid: string, title: string): Record<string, unknown> {
  return {
    docId,
    pid,
    title,
    kind: 'programming',
    difficulty: 2,
    tags: ['图'],
    nSubmit: 8,
    nAccept: 3,
    hidden: false,
    mine: true,
    schoolShared: false,
    ownerName: '王老师',
    courseId: 'algo',
    nodePath: ['图论'],
  };
}

function route(url: URL): Response {
  if (url.pathname === '/teach-api/knowledge-tree') {
    return jsonResponse({
      courses: [
        {
          id: 'algo',
          title: '算法知识图谱',
          hidden: false,
          total: 2,
          nodes: [{ id: 'graph', title: '图论', count: 2, children: [] }],
        },
      ],
    });
  }
  if (url.pathname === '/teach-api/bank') {
    const page = Number(url.searchParams.get('page') ?? '1');
    return jsonResponse({
      items: [bankItem(11, 'P0011', '图的遍历'), bankItem(12, 'P0012', '最短路')],
      page,
      pageCount: 1,
      total: 2,
    });
  }
  if (url.pathname === '/teach') {
    const scope = url.searchParams.get('scope');
    const type = url.searchParams.get('type');
    if (scope === 'mine' && type === 'practice') return jsonResponse(practiceList(requestedPage(url)));
    if (scope === 'mine' && type === 'quiz') return jsonResponse(quizList(requestedPage(url)));
    return hydroError(`未桩的题目集列表 ${url.search}`);
  }
  const practice = /^\/teach\/practice\/([a-fA-F0-9]{24})\/copyable$/.exec(url.pathname);
  const practiceId = practice?.[1];
  if (practiceId) {
    if (oldPracticeMissing && practiceId === OLD_SET_ID) return hydroError(`练习不存在 ${practiceId}`);
    const known = knownPractice(practiceId);
    if (!known) return hydroError(`未桩的练习 ${practiceId}`);
    return jsonResponse(practiceDocument(known.id, known.title, stagesFor(known.id)));
  }
  return hydroError(`未桩的请求 ${url.pathname}${url.search}`);
}

function practiceList(page: number): TeachListPayload {
  if (listFixture === 'blank') {
    const rows = page === 1 ? [practiceRow(BLANK_SET_ID, BLANK_TITLE)] : [];
    return listPayload('practice', rows, page, 1, 1);
  }
  if (page === 1) return listPayload('practice', [practiceRow(PAGE1_SET_ID, PAGE1_TITLE)], 1, 2, 2);
  if (page === 2) return listPayload('practice', [practiceRow(NEW_SET_ID, NEW_TITLE)], 2, 2, 2);
  return listPayload('practice', [], page, 2, 2);
}

function quizList(page: number): TeachListPayload {
  if (page === 1) return listPayload('quiz', [homeworkRow()], 1, 1, 1);
  return listPayload('quiz', [], page, 1, 1);
}

function installFetch() {
  captured = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    captured.push(`${url.pathname}${url.search}`);
    return Promise.resolve(route(url));
  });
}

function Host({
  Menu,
  saved,
  dirty,
  initial,
  section,
  onChange,
}: {
  Menu: ComponentType<AddContentMenuProps>;
  saved: boolean;
  dirty: boolean;
  initial: ChapterDraft;
  section: SectionDraft | null;
  onChange: (next: ChapterDraft) => void;
}) {
  const [chapter, setChapter] = useState(initial);
  return (
    <ToastProvider>
      <DialogHost />
      <Menu
        courseId={COURSE_ID}
        saved={saved}
        dirty={dirty}
        chapter={chapter}
        section={section}
        onChange={(next) => {
          onChange(next);
          setChapter(next);
        }}
      />
    </ToastProvider>
  );
}

async function renderMenu(options: {
  saved: boolean;
  dirty: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
}): Promise<RenderedMenu> {
  const Menu = await loadAddContentMenu();
  const user = userEvent.setup();
  const onChange = vi.fn<(next: ChapterDraft) => void>();
  render(
    <Host
      Menu={Menu}
      saved={options.saved}
      dirty={options.dirty}
      initial={options.chapter}
      section={options.section}
      onChange={onChange}
    />,
  );
  return { user, onChange };
}

async function openAddMenu(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: '添加内容' }));
  return screen.findByRole('menu');
}

async function newSetChoices(user: User): Promise<{ practice: HTMLElement; homework: HTMLElement }> {
  const immediate = choicePair();
  if (immediate) return immediate;
  const parent = controlStarting('新建题目集并挂到这里');
  expect(parent, '新建题目集并挂到这里').not.toBeNull();
  if (!parent) throw new TypeError('新建题目集并挂到这里 is missing');
  await user.hover(parent);
  const hovered = choicePair();
  if (hovered) return hovered;
  await user.click(parent);
  return waitFor(() => {
    const found = choicePair();
    expect(found).not.toBeNull();
    if (!found) throw new TypeError('new problem set choices are missing');
    return found;
  });
}

async function openReferenceDialog(user: User): Promise<HTMLElement> {
  await openAddMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /引用已有题目集/ }));
  return screen.findByRole('dialog', { name: '引用已有题目集' });
}

async function showPracticeTab(user: User, dialog: HTMLElement) {
  const practiceTab = within(dialog).queryByRole('tab', { name: '练习' });
  if (practiceTab && practiceTab.getAttribute('aria-selected') !== 'true') {
    await user.click(practiceTab);
  }
}

async function pickTwoProblems(user: User, dialogName: string) {
  await openAddMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /^题目/ }));
  const sheet = await screen.findByRole('dialog', { name: dialogName });
  await user.click(await within(sheet).findByRole('button', { name: '图论' }));
  await user.click(await within(sheet).findByRole('button', { name: '加入 P0011' }));
  await user.click(await within(sheet).findByRole('button', { name: '加入 P0012' }));
}

async function referenceWholeSet(user: User, onChange: ChangeFn, setId: string) {
  const stageField = await screen.findByPlaceholderText('选择阶段');
  await user.click(stageField);
  await user.click(screen.getByRole('button', { name: '引用' }));
  await waitFor(() => {
    const next = lastDraft(onChange);
    expect(next.problemSetId).toBe(setId);
    expect(next.stageIds).toBe('');
  });
}

beforeEach(() => {
  listFixture = 'paged';
  oldPracticeMissing = false;
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('course add content menu', () => {
  it('omits chapter-only entries from a section menu', async () => {
    const section = sectionDraft();
    const { user } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft({
        sections: [section],
        problemSetId: OLD_SET_ID,
        tids: NEW_SET_ID,
      }),
      section,
    });

    const menu = await openAddMenu(user);
    const text = menu.textContent ?? '';
    expect(text).toContain('视频');
    expect(text).toContain('题目');
    for (const label of CHAPTER_ONLY) {
      expect(text, label).not.toContain(label);
    }
  });

  it('disables new problem set choices while the editor is dirty', async () => {
    const { user } = await renderMenu({
      saved: true,
      dirty: true,
      chapter: chapterDraft(),
      section: null,
    });

    await openAddMenu(user);
    const { practice, homework } = await newSetChoices(user);

    expect(practice).toBeDisabled();
    expect(homework).toBeDisabled();
    expect(described(practice)).toContain(SAVE_FIRST);
    expect(described(homework)).toContain(SAVE_FIRST);
  });

  it('links saved course chapters to the new problem set page', async () => {
    const { user } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft(),
      section: null,
    });

    await openAddMenu(user);
    const { practice, homework } = await newSetChoices(user);

    expect(practice).toBeEnabled();
    expect(homework).toBeEnabled();
    expect(destination(practice)).toBe(PRACTICE_HREF);
    expect(destination(homework)).toBe(HOMEWORK_HREF);
  });

  it('appends two problems picked in the problem sheet', async () => {
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft({ pids: ['101', '102'] }),
      section: null,
    });

    await pickTwoProblems(user, '给本章挂题');

    await waitFor(() => {
      // Course chapters store numeric document ids. BankPane's onAdd items expose those as docId.
      expect(lastDraft(onChange).pids).toEqual(['101', '102', '11', '12']);
    });
    expect(screen.getAllByText(/已加入 [12] 道/).length).toBeGreaterThan(0);
    const bankCall = captured.find((entry) => entry.startsWith('/teach-api/bank'));
    expect(bankCall, captured.join('\n')).toBeDefined();
    if (!bankCall) throw new TypeError('bank was not requested');
    expect(new URL(bankCall, ORIGIN).searchParams.get('type')).toBe('homework');
  });

  it('appends problems onto the section and leaves chapter pids unchanged', async () => {
    const section = sectionDraft({ pids: ['7'] });
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft({ pids: ['101', '102'], sections: [section] }),
      section,
    });

    await pickTwoProblems(user, '给本节挂题');

    await waitFor(() => {
      const next = lastDraft(onChange);
      const nextSection = next.sections.find((item) => item._id === section._id);
      expect(nextSection?.pids).toEqual(['7', '11', '12']);
      expect(next.pids).toEqual(['101', '102']);
    });
  });

  it('appends a homework once and refuses the same row', async () => {
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft(),
      section: null,
    });

    const dialog = await openReferenceDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: '作业与考试' }));
    await user.click(await within(dialog).findByRole('button', { name: /线性表作业/ }));
    await waitFor(() => {
      expect(lastDraft(onChange).tids).toBe(HOMEWORK_ID);
    });

    const again = await openReferenceDialog(user);
    await user.click(within(again).getByRole('tab', { name: '作业与考试' }));
    await user.click(await within(again).findByRole('button', { name: /线性表作业/ }));
    expect(await screen.findByText('已经在这一章里')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastDraft(onChange).tids).toBe(HOMEWORK_ID);
  });

  it('opens file collection for this chapter in a new tab', async () => {
    const { user } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft(),
      section: null,
    });

    const menu = await openAddMenu(user);
    const link = within(menu).getByRole('menuitem', { name: /文件收集/ });
    expect(link).toHaveAttribute('href', COLLECT_HREF);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('lists a practice that is not on the first page', async () => {
    const { user } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft(),
      section: null,
    });

    const dialog = await openReferenceDialog(user);
    await showPracticeTab(user, dialog);
    expect(await within(dialog).findByRole('button', { name: /树的遍历练习/ })).toBeInTheDocument();
  });

  it('confirms before replacing a chapter practice', async () => {
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft({ problemSetId: OLD_SET_ID, stageIds: '1' }),
      section: null,
    });

    const dialog = await openReferenceDialog(user);
    await showPracticeTab(user, dialog);
    await user.click(await within(dialog).findByRole('button', { name: /第一页练习/ }));

    const confirm = await screen.findByRole('dialog', { name: `换成「${PAGE1_TITLE}」？` });
    expect(within(confirm).getByText(REPLACE_MESSAGE)).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: '替换' })).toBeInTheDocument();
    expect(screen.queryByText(STAGE_A)).toBeNull();
    expect(screen.queryByText(STAGE_B)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: '替换' }));
    const stageField = await screen.findByPlaceholderText('选择阶段');
    await user.click(stageField);
    expect(await screen.findByRole('button', { name: '阶段甲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '阶段乙' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await referenceWholeSet(user, onChange, PAGE1_SET_ID);
    expect(captured).toContain(`/teach/practice/${PAGE1_SET_ID}/copyable`);
  });

  it('confirms replacement when the old practice cannot be loaded', async () => {
    oldPracticeMissing = true;
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft({ problemSetId: OLD_SET_ID, stageIds: '1' }),
      section: null,
    });

    const dialog = await openReferenceDialog(user);
    await showPracticeTab(user, dialog);
    await user.click(await within(dialog).findByRole('button', { name: /第一页练习/ }));

    const confirm = await screen.findByRole('dialog', { name: `换成「${PAGE1_TITLE}」？` });
    await user.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('references the whole practice when a stage title is empty', async () => {
    listFixture = 'blank';
    const { user, onChange } = await renderMenu({
      saved: true,
      dirty: false,
      chapter: chapterDraft(),
      section: null,
    });

    const dialog = await openReferenceDialog(user);
    await showPracticeTab(user, dialog);
    await user.click(await within(dialog).findByRole('button', { name: /空阶段练习/ }));
    await referenceWholeSet(user, onChange, BLANK_SET_ID);
  });
});
