// A static import fails collection while src/pages/course/workbench/chapter-panel.tsx is absent.
import { useState, type ComponentType, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterDraft, CourseAuthorVideo, SectionDraft } from '../../src/pages/course/types.ts';

const panelLoaders = import.meta.glob('../../src/pages/course/workbench/chapter-panel.tsx');

const PANEL_SOURCE = 'src/pages/course/workbench/chapter-panel.tsx';
const COURSE_ID = '64b8000000000000000000c1';
const SET_ID = '64b8000000000000000000b1';
const HOMEWORK_ID = '64b8000000000000000000a1';
const EXAM_ID = '64b8000000000000000000a2';
const ACM_ID = '64b8000000000000000000a3';
const DOT = '\u00B7';
const STAGE_RANGE = '阶段 1\u20132';
const EMPTY_TITLE = '这一章还没有内容';
const EMPTY_DESCRIPTION = '点「添加内容」加视频、题目或题目集。';
const CONTENT_DESCRIPTION = '学生按这个顺序看到。组内可以拖动调整。';
const GROUP_CLASS = ['text-xs', 'font-medium', 'text-fg-subtle', 'px-4', 'pt-3'] as const;
const ROOT_CLASS = ['flex', 'min-w-0', 'flex-col', 'gap-6'] as const;
const SET_TITLE = '链表专项';
const HOMEWORK_TITLE = '线性表第二次';
const EXAM_TITLE = '期中卷';
const ACM_TITLE = '周末排位';
const PROBLEM_TITLES: Record<string, string> = {
  P1001: '单链表的建立',
  P1002: '顺序表的删除',
  P2001: '小节题甲',
  P2002: '小节题乙',
};
const STORED_DOC_ID = '5101';
const DISPLAY_PID = 'P5101';
const DISPLAY_TITLE = '单链表的建立';

interface TrainingStage {
  _id: number;
  title: string;
}

const DEFAULT_STAGES: TrainingStage[] = [
  { _id: 1, title: '入门' },
  { _id: 2, title: '链表' },
];
const ORDINAL_STAGES: TrainingStage[] = [
  { _id: 2, title: '入门' },
  { _id: 9, title: '链表' },
];
const GAP_STAGES: TrainingStage[] = [
  { _id: 4, title: '入门' },
  { _id: 7, title: '链表' },
  { _id: 11, title: '栈' },
];
const STAGE_GAP = '阶段 1\u30013';
const STAGE_SPAN = '阶段 1\u20133';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
type User = ReturnType<typeof userEvent.setup>;

interface ChapterPanelProps {
  courseId: string;
  saved: boolean;
  dirty: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  onChange: (next: ChapterDraft) => void;
  addContent: ReactNode;
}

interface RenderedPanel {
  user: User;
  drafts: ChapterDraft[];
  root: HTMLElement;
}

interface RenderOptions {
  chapter: ChapterDraft;
  sectionId?: number | null;
  saved?: boolean;
}

const dragBoxes = new Map<HTMLElement, DOMRect>();
let fetchMock: FetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let restoreRects: (() => void) | null = null;
let failProblemTitles = false;
let problemLookups = 0;
let trainingStages: TrainingStage[] = DEFAULT_STAGES;

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent(value: unknown): ComponentType<ChapterPanelProps> {
  if (typeof value !== 'function') throw new TypeError('ChapterPanel must be a function');
  return value as ComponentType<ChapterPanelProps>;
}

async function loadPanel(): Promise<ComponentType<ChapterPanelProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(panelLoaders)) {
    if (key.endsWith(PANEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${PANEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PANEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PANEL_SOURCE} must be a module`);
  return asComponent(readField(imported, 'ChapterPanel'));
}

function authorVideo(fields: {
  id: string;
  title: string;
  filename: string;
  confirmed: boolean;
  durationMs: number;
}): CourseAuthorVideo {
  return {
    id: fields.id,
    title: fields.title,
    filename: fields.filename,
    ext: fields.filename.endsWith('.webm') ? 'webm' : 'mp4',
    size: 1200,
    durationMs: fields.durationMs,
    confirmed: fields.confirmed,
    contentRevision: 1,
  };
}

function makeChapter(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    _id: 2,
    title: '第 2 章 线性表',
    content: '线性表是有限序列。',
    pids: ['P1001', 'P1002'],
    videos: [
      authorVideo({
        id: 'video-seq',
        title: '顺序表的插入与删除',
        filename: 'list.mp4',
        durationMs: 1_122_000,
        confirmed: true,
      }),
      authorVideo({
        id: 'video-link',
        title: '单链表入门',
        filename: 'link.mp4',
        durationMs: 1_450_000,
        confirmed: false,
      }),
    ],
    sections: [],
    tids: `${HOMEWORK_ID},${EXAM_ID},${ACM_ID}`,
    problemSetId: SET_ID,
    stageIds: '1,2',
    ...overrides,
  };
}

function makeSection(overrides: Partial<SectionDraft> = {}): SectionDraft {
  return {
    _id: 1,
    title: '2.1 顺序存储',
    content: '小节讲义',
    pids: ['P2001', 'P2002'],
    videos: [
      authorVideo({
        id: 'video-sec',
        title: '概念片',
        filename: 'concept.webm',
        durationMs: 45_000,
        confirmed: true,
      }),
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, window.location.origin);
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url, window.location.origin);
  throw new TypeError('unexpected fetch input');
}

function pathId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes('/')) return null;
  return decodeURIComponent(rest);
}

function installFetch() {
  fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = requestUrl(input);
    if (url.pathname === '/p') {
      problemLookups += 1;
      if (failProblemTitles) throw new TypeError('Failed to fetch');
      const query = url.searchParams.get('q') ?? '';
      if (query === STORED_DOC_ID) {
        return jsonResponse({
          pdocs: [{ docId: 5101, pid: DISPLAY_PID, title: DISPLAY_TITLE }],
        });
      }
      const title = PROBLEM_TITLES[query];
      if (!title) return jsonResponse({ pdocs: [] });
      return jsonResponse({
        pdocs: [{ docId: Number(query.replace(/\D/g, '')) || 1, pid: query, title }],
      });
    }
    const trainingId = pathId(url.pathname, '/training/');
    if (trainingId) {
      return jsonResponse({
        tdoc: {
          _id: trainingId,
          title: SET_TITLE,
          dag: trainingStages.map((stage) => ({ _id: stage._id, title: stage.title })),
        },
      });
    }
    const homeworkId = pathId(url.pathname, '/homework/');
    if (homeworkId) {
      if (homeworkId !== HOMEWORK_ID) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ tdoc: { _id: homeworkId, title: HOMEWORK_TITLE, rule: 'homework' } });
    }
    const contestId = pathId(url.pathname, '/contest/');
    if (contestId === EXAM_ID) return jsonResponse({ tdoc: { _id: contestId, title: EXAM_TITLE, rule: 'exam' } });
    if (contestId === ACM_ID) return jsonResponse({ tdoc: { _id: contestId, title: ACM_TITLE, rule: 'acm' } });
    if (contestId) return jsonResponse({ error: 'not found' }, 404);
    return jsonResponse({ error: 'unexpected' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function installDragRects(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boundingClientRect() {
    return dragBoxes.get(this) ?? new DOMRect(0, 0, 0, 0);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasAll(element: Element, tokens: readonly string[]): boolean {
  const actual = classTokens(element);
  return tokens.every((token) => actual.includes(token));
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function lastDraft(drafts: readonly ChapterDraft[]): ChapterDraft {
  const draft = drafts[drafts.length - 1];
  if (!draft) throw new TypeError('onChange was not called');
  return draft;
}

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === '';
}

function refList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kindLine(kind: string, title: string): string {
  return `${kind} ${DOT} ${title}`;
}

function ChapterHarness({
  Panel,
  initial,
  sectionId,
  saved,
  drafts,
}: {
  Panel: ComponentType<ChapterPanelProps>;
  initial: ChapterDraft;
  sectionId: number | null;
  saved: boolean;
  drafts: ChapterDraft[];
}) {
  const [chapter, setChapter] = useState(initial);
  const section = sectionId == null ? null : chapter.sections.find((item) => item._id === sectionId) ?? null;
  return (
    <Panel
      courseId={COURSE_ID}
      saved={saved}
      dirty={false}
      chapter={chapter}
      section={section}
      onChange={(next) => {
        drafts.push(next);
        setChapter(next);
      }}
      addContent={<button type="button">添加内容</button>}
    />
  );
}

async function renderPanel(options: RenderOptions): Promise<RenderedPanel> {
  const Panel = await loadPanel();
  const drafts: ChapterDraft[] = [];
  const user = userEvent.setup({ delay: null });
  const view = render(
    <ChapterHarness
      Panel={Panel}
      initial={options.chapter}
      sectionId={options.sectionId ?? null}
      saved={options.saved ?? true}
      drafts={drafts}
    />,
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new TypeError('chapter panel root is missing');
  return { user, drafts, root };
}

function lectureEditor(): HTMLTextAreaElement {
  const nodes = document.querySelectorAll('textarea.krypton-markdown-editor');
  if (nodes.length !== 1 || !(nodes[0] instanceof HTMLTextAreaElement)) {
    throw new TypeError('lecture editor is missing');
  }
  return nodes[0];
}

function contentHeader(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const header = heading.closest('header');
  if (!(header instanceof HTMLElement)) throw new TypeError(`${title} header is missing`);
  return header;
}

function groupHeading(name: string): HTMLElement {
  const matches = [...document.querySelectorAll('body *')].filter((element) => (
    element instanceof HTMLElement
    && (element.textContent ?? '').trim() === name
    && hasAll(element, GROUP_CLASS)
  ));
  if (matches.length !== 1 || !(matches[0] instanceof HTMLElement)) {
    throw new TypeError(`missing group heading ${name}`);
  }
  return matches[0];
}

function badgeByText(text: string): HTMLElement {
  const label = screen.getByText(text);
  const badge = label.closest('[data-slot="badge"]');
  if (!(badge instanceof HTMLElement)) throw new TypeError(`missing badge ${text}`);
  return badge;
}

function workbenchLink(href: string): HTMLAnchorElement {
  const link = screen.getAllByRole('link', { name: '打开工作台' }).find((item) => item.getAttribute('href') === href);
  if (!(link instanceof HTMLAnchorElement)) throw new TypeError(`missing workbench link ${href}`);
  return link;
}

function rowAround(start: HTMLElement): HTMLElement {
  let current = start;
  while (current.parentElement) {
    const parent = current.parentElement;
    const parentLinks = (parent.textContent ?? '').split('打开工作台').length;
    const currentLinks = (current.textContent ?? '').split('打开工作台').length;
    if (parentLinks > currentLinks) break;
    current = parent;
  }
  return current;
}

function problemRow(pid: string, pids: readonly string[]): HTMLElement {
  const button = screen.getByRole('button', { name: new RegExp(`移出\\s*${escapeRegExp(pid)}`) });
  let node: HTMLElement | null = button;
  let match: HTMLElement | null = null;
  while (node) {
    const text = node.textContent ?? '';
    const hasOther = pids.some((other) => other !== pid && text.includes(other));
    if (hasOther) break;
    if (text.includes(pid)) match = node;
    node = node.parentElement;
  }
  if (!match) throw new TypeError(`missing problem row ${pid}`);
  return match;
}

function dragHandle(row: HTMLElement, removeName: RegExp): HTMLElement {
  if (row.hasAttribute('aria-roledescription')) return row;
  const described = row.querySelector('[aria-roledescription]');
  if (described instanceof HTMLElement) return described;
  const handle = within(row).getAllByRole('button').find((button) => !removeName.test(button.getAttribute('aria-label') ?? button.textContent ?? ''));
  if (handle) return handle;
  return row;
}

function placeRows(rows: readonly HTMLElement[]) {
  dragBoxes.clear();
  rows.forEach((row, index) => {
    const rect = new DOMRect(16, 120 + index * 72, 480, 56);
    dragBoxes.set(row, rect);
    for (const child of row.querySelectorAll('*')) {
      if (child instanceof HTMLElement) dragBoxes.set(child, rect);
    }
  });
}

interface PointerPoint {
  clientX: number;
  clientY: number;
}

function pointerInit(point: PointerPoint): PointerEventInit {
  return {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: point.clientX,
    clientY: point.clientY,
  };
}

function dragOnto(handle: HTMLElement, from: DOMRect, to: DOMRect) {
  const start = { clientX: from.x + 28, clientY: from.y + from.height / 2 };
  const nudge = { clientX: start.clientX, clientY: start.clientY + 24 };
  const drop = { clientX: to.x + to.width / 2, clientY: to.y + to.height / 4 };
  fireEvent.pointerDown(handle, pointerInit(start));
  fireEvent.pointerMove(document, pointerInit(nudge));
  fireEvent.pointerMove(document, pointerInit(drop));
  fireEvent.pointerUp(document, pointerInit(drop));
}

function stubVideoUpload(video: CourseAuthorVideo): () => void {
  const original = window.XMLHttpRequest;
  const payload = JSON.stringify({ video });
  class UploadXHR {
    status = 200;
    statusText = 'OK';
    responseText = payload;
    responseType = '';
    withCredentials = false;
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {}
    setRequestHeader() {}
    abort() {}
    send() {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }
  window.XMLHttpRequest = UploadXHR as unknown as typeof XMLHttpRequest;
  return () => {
    window.XMLHttpRequest = original;
  };
}

function expectLayersIcon(scope: ParentNode) {
  const icons = [...scope.querySelectorAll('svg')].filter((svg) => (svg.getAttribute('class') ?? '').includes('lucide-layers'));
  expect(icons).toHaveLength(1);
  const icon = icons[0];
  if (!icon) throw new TypeError('missing Layers icon');
  expect(icon.tagName.toLowerCase()).toBe('svg');
}

beforeEach(() => {
  failProblemTitles = false;
  problemLookups = 0;
  trainingStages = DEFAULT_STAGES.map((stage) => ({ _id: stage._id, title: stage.title }));
  dragBoxes.clear();
  installFetch();
  restoreRects = installDragRects();
});

afterEach(async () => {
  await new Promise((done) => {
    setTimeout(done, 60);
  });
  restoreRects?.();
  restoreRects = null;
  dragBoxes.clear();
  vi.unstubAllGlobals();
});

describe('chapter panel', () => {
  it('reports a new chapter title and lecture', async () => {
    const chapter = makeChapter();
    const { user, drafts, root } = await renderPanel({ chapter });

    expect(hasAll(root, ROOT_CLASS)).toBe(true);
    expect(screen.getByText('可选')).toBeInTheDocument();
    expect(screen.getByText('Markdown')).toBeInTheDocument();
    const shell = lectureEditor().closest('.krypton-md-shell');
    if (!(shell instanceof HTMLElement)) throw new TypeError('lecture editor shell is missing');
    expect(shell.style.getPropertyValue('--md-shell-h')).toBe('160px');

    const title = screen.getByRole('textbox', { name: '章节标题' });
    await user.clear(title);
    await user.type(title, '线性结构');
    expect(lastDraft(drafts).title).toBe('线性结构');
    expect(lastDraft(drafts).pids).toEqual(chapter.pids);
    expect(lastDraft(drafts)._id).toBe(chapter._id);

    await user.clear(lectureEditor());
    await user.type(lectureEditor(), '新讲义');
    expect(lastDraft(drafts).content).toBe('新讲义');
    expect(lastDraft(drafts).title).toBe('线性结构');
  });

  it('groups videos, problems, and the referenced set in that order', async () => {
    await renderPanel({ chapter: makeChapter() });

    expect(screen.getByText(CONTENT_DESCRIPTION)).toBeInTheDocument();
    expect(within(contentHeader('本章内容')).getByRole('button', { name: '添加内容' })).toBeInTheDocument();
    await screen.findByText(PROBLEM_TITLES.P1001 ?? '');
    await waitFor(() => {
      expect(bodyText()).toContain(kindLine('练习', SET_TITLE));
      expect(bodyText()).toContain(STAGE_RANGE);
      expect(bodyText()).toContain(kindLine('作业', HOMEWORK_TITLE));
      expect(bodyText()).toContain(kindLine('考试', EXAM_TITLE));
      expect(bodyText()).toContain(kindLine('比赛', ACM_TITLE));
    });

    const videos = groupHeading('视频');
    const problems = groupHeading('题目');
    const sets = groupHeading('题目集与作业');
    expect(videos.compareDocumentPosition(problems) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(problems.compareDocumentPosition(sets) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText('文件收集')).toBeNull();

    expect(bodyText()).toContain('顺序表的插入与删除');
    expect(bodyText()).toContain('18:42');
    expect(bodyText()).toContain('单链表入门');
    expect(bodyText()).toContain('24:10');
    const confirmed = badgeByText('已确认片长');
    const pending = badgeByText('待确认');
    expect(confirmed.getAttribute('data-tone')).toBe('success');
    expect(classTokens(confirmed)).toContain('h-4.5');
    expect(pending.getAttribute('data-tone')).toBe('neutral');
    expect(classTokens(pending)).toContain('h-4.5');

    expect(bodyText()).toContain('P1001');
    expect(bodyText()).toContain(PROBLEM_TITLES.P1002 ?? '');
    expect(screen.getByRole('button', { name: /移出\s*P1001/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /移出\s*P1002/ })).toBeInTheDocument();

    const setLink = workbenchLink(`/teach/practice/${SET_ID}`);
    const setRow = rowAround(setLink);
    expectLayersIcon(setRow);
    expect(workbenchLink(`/teach/homework/${HOMEWORK_ID}`)).toBeInTheDocument();
    expect(workbenchLink(`/teach/exam/${EXAM_ID}`)).toBeInTheDocument();
    expect(workbenchLink(`/teach/acm/${ACM_ID}`)).toBeInTheDocument();

    const panel = screen.getByRole('heading', { name: '本章内容' }).closest('[data-slot="panel"]');
    const body = panel?.querySelector(':scope > div');
    expect(body?.getAttribute('class') ?? '').not.toContain('p-4');
  });

  it('reorders problems when a row is dragged', async () => {
    const pids = ['P1001', 'P1002'];
    const { drafts } = await renderPanel({
      chapter: makeChapter({
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
        pids,
      }),
    });
    await screen.findByText(PROBLEM_TITLES.P1001 ?? '');
    await screen.findByText(PROBLEM_TITLES.P1002 ?? '');

    const first = problemRow('P1001', pids);
    const second = problemRow('P1002', pids);
    placeRows([first, second]);
    const secondRect = dragBoxes.get(second);
    const firstRect = dragBoxes.get(first);
    if (!secondRect || !firstRect) throw new TypeError('missing problem row box');
    dragOnto(dragHandle(second, /移出\s*P1002/), secondRect, firstRect);

    expect(lastDraft(drafts).pids).toEqual(['P1002', 'P1001']);
  });

  it('reorders homework when a row is dragged', async () => {
    const { drafts } = await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        problemSetId: '',
        stageIds: '',
        content: '',
        tids: `${HOMEWORK_ID},${ACM_ID}`,
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain(kindLine('作业', HOMEWORK_TITLE));
      expect(bodyText()).toContain(kindLine('比赛', ACM_TITLE));
    });

    const homework = rowAround(workbenchLink(`/teach/homework/${HOMEWORK_ID}`));
    const contest = rowAround(workbenchLink(`/teach/acm/${ACM_ID}`));
    placeRows([homework, contest]);
    const contestRect = dragBoxes.get(contest);
    const homeworkRect = dragBoxes.get(homework);
    if (!contestRect || !homeworkRect) throw new TypeError('missing activity row box');
    dragOnto(dragHandle(contest, /移出/), contestRect, homeworkRect);

    expect(refList(lastDraft(drafts).tids)).toEqual([ACM_ID, HOMEWORK_ID]);
    expect(isBlank(lastDraft(drafts).problemSetId)).toBe(true);
  });

  it('shows the catalog pid for a stored docId and keeps that docId on remove', async () => {
    const { user, drafts } = await renderPanel({
      chapter: makeChapter({
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
        pids: [STORED_DOC_ID],
      }),
    });

    expect(await screen.findByText(DISPLAY_PID)).toBeInTheDocument();
    expect(screen.getByText(DISPLAY_TITLE)).toBeInTheDocument();
    expect(drafts.some((draft) => draft.pids.includes(DISPLAY_PID))).toBe(false);

    await user.click(screen.getByRole('button', { name: /移出/ }));
    expect(lastDraft(drafts).pids).toEqual([]);
    expect(drafts.some((draft) => draft.pids.includes(DISPLAY_PID))).toBe(false);
  });

  it('shows only the stored docId when that problem lookup fails', async () => {
    failProblemTitles = true;
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
        pids: [STORED_DOC_ID],
      }),
    });
    await waitFor(() => {
      expect(problemLookups).toBeGreaterThan(0);
    });
    await new Promise((done) => {
      setTimeout(done, 0);
    });
    expect(screen.getByText(STORED_DOC_ID)).toBeInTheDocument();
    expect(screen.queryByText(DISPLAY_PID)).toBeNull();
    expect(screen.queryByText(DISPLAY_TITLE)).toBeNull();
  });

  it('removes a problem from the chapter', async () => {
    const pids = ['P1001', 'P1002'];
    const { user, drafts } = await renderPanel({
      chapter: makeChapter({
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
        pids,
      }),
    });
    await screen.findByText(PROBLEM_TITLES.P1001 ?? '');
    await user.click(screen.getByRole('button', { name: /移出\s*P1001/ }));

    expect(lastDraft(drafts).pids).toEqual(['P1002']);
    expect(lastDraft(drafts).title).toBe('第 2 章 线性表');
  });

  it('clears the problem set and its stages', async () => {
    const { user, drafts } = await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain(kindLine('练习', SET_TITLE));
      expect(bodyText()).toContain(STAGE_RANGE);
    });
    const row = rowAround(workbenchLink(`/teach/practice/${SET_ID}`));
    await user.click(within(row).getByRole('button', { name: /移出/ }));

    const next = lastDraft(drafts);
    expect(isBlank(next.problemSetId)).toBe(true);
    expect(isBlank(next.stageIds)).toBe(true);
    expect(next.title).toBe('第 2 章 线性表');
    expect(next.pids).toEqual([]);
  });

  it('numbers selected stages by their order in the set', async () => {
    trainingStages = ORDINAL_STAGES.map((stage) => ({ _id: stage._id, title: stage.title }));
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
        stageIds: '9,2',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain(STAGE_RANGE);
    });
    expect(bodyText()).not.toContain('阶段 9\u20132');
    expect(bodyText()).not.toContain('阶段 2\u20139');
  });

  it('lists non-adjacent stages instead of filling the gap', async () => {
    trainingStages = GAP_STAGES.map((stage) => ({ _id: stage._id, title: stage.title }));
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
        stageIds: '11,4',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain(STAGE_GAP);
    });
    expect(bodyText()).not.toContain(STAGE_SPAN);
    expect(bodyText()).not.toContain(STAGE_RANGE);
  });

  it('numbers one selected stage by its order in the set', async () => {
    trainingStages = ORDINAL_STAGES.map((stage) => ({ _id: stage._id, title: stage.title }));
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
        stageIds: '9',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain('阶段 2');
    });
    expect(bodyText()).not.toContain('阶段 9');
  });

  it('keeps an empty stage list as the whole problem set', async () => {
    trainingStages = ORDINAL_STAGES.map((stage) => ({ _id: stage._id, title: stage.title }));
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
        stageIds: '',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain('整个题目集');
    });
    expect(bodyText()).not.toContain(STAGE_RANGE);
    expect(bodyText()).not.toContain('阶段 9');
  });

  it('names an unstaged reference as the whole problem set', async () => {
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        pids: [],
        sections: [],
        tids: '',
        content: '',
        stageIds: '',
      }),
    });
    await waitFor(() => {
      expect(bodyText()).toContain(kindLine('练习', SET_TITLE));
      expect(bodyText()).toContain('整个题目集');
    });
    expect(bodyText()).not.toContain(STAGE_RANGE);
    expect(workbenchLink(`/teach/practice/${SET_ID}`)).toBeInTheDocument();
  });

  it('hides problem sets and homework on a section', async () => {
    const section = makeSection();
    const { user, drafts } = await renderPanel({
      chapter: makeChapter({ sections: [section] }),
      sectionId: section._id,
    });

    expect(screen.getByRole('textbox', { name: '小节标题' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '章节标题' })).toBeNull();
    expect(screen.getByRole('heading', { name: '本节内容' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '本章内容' })).toBeNull();
    expect(screen.getByText(CONTENT_DESCRIPTION)).toBeInTheDocument();
    expect(within(contentHeader('本节内容')).getByRole('button', { name: '添加内容' })).toBeInTheDocument();
    expect(screen.queryByText('题目集与作业')).toBeNull();
    expect(screen.queryByRole('link', { name: '打开工作台' })).toBeNull();
    expect(bodyText()).not.toContain(SET_TITLE);
    expect(bodyText()).not.toContain(HOMEWORK_TITLE);

    expect(await screen.findByText('小节题甲')).toBeInTheDocument();
    expect(screen.queryByText('单链表的建立')).toBeNull();
    expect(bodyText()).toContain('概念片');
    expect(bodyText()).not.toContain('顺序表的插入与删除');
    expect(groupHeading('视频').compareDocumentPosition(groupHeading('题目')) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const title = screen.getByRole('textbox', { name: '小节标题' });
    await user.clear(title);
    await user.type(title, '链式存储');
    const next = lastDraft(drafts);
    expect(next.title).toBe('第 2 章 线性表');
    expect(next.sections.find((item) => item._id === section._id)?.title).toBe('链式存储');
    expect(next.problemSetId).toBe(SET_ID);
  });

  it('uses the chapter empty copy for an empty section', async () => {
    const section = makeSection({
      _id: 3,
      title: '2.2 空小节',
      content: '',
      pids: [],
      videos: [],
    });
    await renderPanel({
      chapter: makeChapter({ sections: [section] }),
      sectionId: section._id,
    });

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText('题目集与作业')).toBeNull();
    expect(bodyText()).not.toContain('顺序表的插入与删除');
    expect(within(contentHeader('本节内容')).getByRole('button', { name: '添加内容' })).toBeInTheDocument();
  });

  it('shows the empty state and keeps add content in the header', async () => {
    const { root } = await renderPanel({
      chapter: makeChapter({
        title: '空章',
        content: '',
        pids: [],
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
      }),
    });

    expect(hasAll(root, ROOT_CLASS)).toBe(true);
    expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('空章');
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
    const title = screen.getByText(EMPTY_TITLE);
    let compact: HTMLElement | null = title instanceof HTMLElement ? title : null;
    while (compact && !hasAll(compact, ['gap-2', 'px-4', 'py-8'])) compact = compact.parentElement;
    if (!(compact instanceof HTMLElement)) throw new TypeError('compact empty state is missing');
    expect(screen.queryByText('题目集与作业')).toBeNull();
    expect(within(contentHeader('本章内容')).getByRole('button', { name: '添加内容' })).toBeInTheDocument();
    expect(screen.getByText(CONTENT_DESCRIPTION)).toBeInTheDocument();
  });

  it('opens the chapter video sheet with the existing editor', async () => {
    const { user } = await renderPanel({
      chapter: makeChapter({
        pids: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
      }),
    });
    await user.click(screen.getByText('顺序表的插入与删除'));

    const sheet = await screen.findByRole('dialog', { name: '本章视频' });
    expect(sheet.getAttribute('data-side')).toBe('right');
    expect(within(sheet).getByText('list.mp4')).toBeInTheDocument();
    expect(within(sheet).getByText('link.mp4')).toBeInTheDocument();
  });

  it('keeps a title edited after the video sheet opens when a video is added', async () => {
    const chapter = makeChapter({ sections: [], content: '讲义' });
    const added = authorVideo({
      id: 'video-added',
      title: '新视频',
      filename: 'added.mp4',
      confirmed: false,
      durationMs: 8000,
    });
    const { user, drafts } = await renderPanel({ chapter });
    await user.click(screen.getByText('顺序表的插入与删除'));
    const sheet = await screen.findByRole('dialog', { name: '本章视频' });
    expect(within(sheet).getByText('list.mp4')).toBeInTheDocument();

    const title = screen.getByRole('textbox', { name: '章节标题' });
    await user.clear(title);
    await user.type(title, '新标题');
    expect(title).toHaveValue('新标题');

    const fileInput = sheet.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) throw new TypeError('video file input is missing');
    const restoreUpload = stubVideoUpload(added);
    try {
      await user.upload(fileInput, new File(['video'], 'added.mp4', { type: 'video/mp4' }));
      await waitFor(() => {
        expect(lastDraft(drafts).videos.some((video) => video.id === added.id)).toBe(true);
      });
    } finally {
      restoreUpload();
    }

    const next = lastDraft(drafts);
    expect(next.title).toBe('新标题');
    expect(next.videos.map((video) => video.id)).toEqual([...chapter.videos.map((video) => video.id), added.id]);
    expect(next.pids).toEqual(chapter.pids);
    expect(next.problemSetId).toBe(chapter.problemSetId);
    expect(next.stageIds).toBe(chapter.stageIds);
  });

  it('opens the section video sheet for that section only', async () => {
    const section = makeSection();
    const { user } = await renderPanel({
      chapter: makeChapter({ sections: [section] }),
      sectionId: section._id,
    });
    await user.click(screen.getByText('概念片'));

    const sheet = await screen.findByRole('dialog', { name: '本章视频' });
    expect(sheet.getAttribute('data-side')).toBe('right');
    expect(within(sheet).getByText('concept.webm')).toBeInTheDocument();
    expect(within(sheet).queryByText('list.mp4')).toBeNull();
  });

  it('locks the video editor until the course is saved', async () => {
    const { user } = await renderPanel({
      saved: false,
      chapter: makeChapter({
        pids: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
      }),
    });
    await user.click(screen.getByText('顺序表的插入与删除'));

    const sheet = await screen.findByRole('dialog', { name: '本章视频' });
    expect(within(sheet).getByText('先保存课程，再上传视频')).toBeInTheDocument();
    expect(within(sheet).queryByText('list.mp4')).toBeNull();
  });

  it('shows only the problem number when title lookup fails', async () => {
    failProblemTitles = true;
    await renderPanel({
      chapter: makeChapter({
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
        content: '',
        pids: ['P1001'],
      }),
    });
    await waitFor(() => {
      expect(problemLookups).toBeGreaterThan(0);
    });
    await new Promise((done) => {
      setTimeout(done, 0);
    });
    expect(screen.getByText(/P1001/)).toBeInTheDocument();
    expect(screen.queryByText('单链表的建立')).toBeNull();
  });
});
