import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import {
  formatTeachWindow,
  parseTeachListPayload,
  type TeachListPayload,
  type TeachListRow,
  type TeachSharedRow,
} from '../../src/pages/teach/model.ts';

// A static import fails collection while copy-dialog.tsx is absent.
const dialogLoaders = import.meta.glob('../../src/pages/teach/copy-dialog.tsx');

const DIALOG_SOURCE = 'src/pages/teach/copy-dialog.tsx';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d4f';
const SHARED_ID = '64b7c3a2e4b0f96d1a2c3d50';
const EXAM_TITLE = '栈与队列小测';
const PRACTICE_TITLE = '链表练习';
const SHARED_TITLE = '共享的整卷考试';
const SHARER = '王老师';
const SERVER_MESSAGE = '这份列表现在打不开。';
const LIST_LOAD_FAILED = '题目集列表加载失败。';
const EXAM_BEGIN = '2026-10-24T06:00:00.000Z';
const EXAM_END = '2026-10-24T08:00:00.000Z';
const SHARED_BEGIN = '2026-10-20T01:00:00.000Z';
const SHARED_END = '2026-10-20T03:00:00.000Z';
const MINE_EMPTY = '还没有可以复制的题目集';
const SHARED_EMPTY = '还没有老师共享题目集';
const LIST_HINT = '只显示最近 20 个，可以搜索。';
const DIALOG_TITLE = '从已有题目集复制';
const DIALOG_DESCRIPTION = '新建一个同类型的题目集，带上题目、分值和设置。时间和学生要重新填。';
const FOCUS_RING = [
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-ring',
] as const;

interface CopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element, tokens: readonly string[]) {
  const actual = classTokens(element);
  for (const token of tokens) {
    expect(actual, actual.join(' ')).toContain(token);
  }
}

function ancestorHasToken(element: HTMLElement, token: string): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (classTokens(current).includes(token)) return true;
    current = current.parentElement;
  }
  return false;
}

function dialogLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(dialogLoaders)) {
    if (key.endsWith(DIALOG_SOURCE)) return load;
  }
  return undefined;
}

async function loadCopyDialog(): Promise<ComponentType<CopyDialogProps>> {
  const load = dialogLoader();
  expect(typeof load, DIALOG_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${DIALOG_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('copy dialog module must be an object');
  }
  if (!('CopyDialog' in imported)) {
    throw new TypeError('CopyDialog must be exported');
  }
  const component: unknown = imported.CopyDialog;
  expect(typeof component, 'CopyDialog').toBe('function');
  if (typeof component !== 'function') {
    throw new TypeError('CopyDialog must be a function');
  }
  return component as ComponentType<CopyDialogProps>;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function listUrls(fetchMock: FetchMock): URL[] {
  return fetchMock.mock.calls.map((call) => requestUrl(call[0]));
}

function scopesOf(fetchMock: FetchMock): string[] {
  return listUrls(fetchMock).map((url) => url.searchParams.get('scope') ?? '');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status = 400): Response {
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
    practice: false,
    homework: false,
    exam: false,
    acm: false,
    oi: false,
  };
}

function examRow(): TeachListRow {
  return {
    type: 'exam',
    id: EXAM_ID,
    rule: 'exam',
    title: EXAM_TITLE,
    status: 'upcoming',
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: null,
    audience: '所有人',
    problemCount: 8,
    drawCount: null,
    stageCount: null,
    participantCount: 12,
    role: 'owner',
    shared: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function mineRows(count: number): TeachListRow[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index.toString(16).padStart(2, '0');
    return {
      ...examRow(),
      id: `64b7c3a2e4b0f96d1a2c3d${suffix}`,
      title: `题目集 ${index}`,
    };
  });
}

function practiceRow(): TeachListRow {
  return {
    type: 'practice',
    id: PRACTICE_ID,
    rule: 'problem_set',
    title: PRACTICE_TITLE,
    status: 'open',
    beginAt: null,
    endAt: null,
    durationMinutes: null,
    audience: '指定用户组',
    problemCount: 3,
    drawCount: null,
    stageCount: 1,
    participantCount: 4,
    role: 'maintainer',
    shared: false,
    createdAt: '2026-10-02T00:00:00.000Z',
  };
}

function sharedRow(): TeachSharedRow {
  return {
    type: 'exam',
    id: SHARED_ID,
    rule: 'exam',
    title: SHARED_TITLE,
    ownerUid: 9,
    ownerName: SHARER,
    problemCount: 6,
    drawCount: null,
    beginAt: SHARED_BEGIN,
    endAt: SHARED_END,
    durationMinutes: null,
    sharedAt: '2026-10-03T00:00:00.000Z',
  };
}

function minePayload(query: string, rows: TeachListRow[], pageCount = 1): TeachListPayload {
  const total = pageCount > 1 ? 21 : rows.length;
  return parseTeachListPayload({
    scope: 'mine',
    canSeeAll: false,
    filter: { type: 'all', status: 'all', q: query },
    typeCounts: {
      all: total, practice: 0, quiz: 0, acm: 0, oi: 0,
    },
    page: 1,
    pageCount,
    total,
    rows,
    sharedRows: [],
    canCreate: canCreate(),
  });
}

function sharedPayload(query: string, sharedRows: TeachSharedRow[]): TeachListPayload {
  return parseTeachListPayload({
    scope: 'shared',
    canSeeAll: false,
    filter: { type: 'all', status: 'all', q: query },
    typeCounts: {
      all: sharedRows.length, practice: 0, quiz: 0, acm: 0, oi: 0,
    },
    page: 1,
    pageCount: 1,
    total: sharedRows.length,
    rows: [],
    sharedRows,
    canCreate: canCreate(),
  });
}

const READY_MINE = minePayload('', [examRow(), practiceRow()], 2);
const READY_SHARED = sharedPayload('', [sharedRow()]);
const READY_EMPTY_MINE = minePayload('', []);
const READY_EMPTY_SHARED = sharedPayload('', []);

function respondRows(url: URL): Response {
  const shared = url.searchParams.get('scope') === 'shared';
  const query = url.searchParams.get('q') ?? '';
  if (query === '') return jsonResponse(shared ? READY_SHARED : READY_MINE);
  if (shared) return jsonResponse(sharedPayload(query, [sharedRow()]));
  return jsonResponse(minePayload(query, [examRow(), practiceRow()], 2));
}

function respondEmpty(url: URL): Response {
  const shared = url.searchParams.get('scope') === 'shared';
  const query = url.searchParams.get('q') ?? '';
  if (query === '') return jsonResponse(shared ? READY_EMPTY_SHARED : READY_EMPTY_MINE);
  return jsonResponse(shared ? sharedPayload(query, []) : minePayload(query, []));
}

function installFetch(respond: (url: URL) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => Promise.resolve(respond(requestUrl(input))),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function expectFirstPage(fetchMock: FetchMock) {
  const urls = listUrls(fetchMock);
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url.pathname).toBe('/teach');
    const page = url.searchParams.get('page');
    expect(page === null || page === '1').toBe(true);
  }
}

function examWindow(): string {
  return formatTeachWindow({
    type: 'exam',
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: null,
  }, new Date());
}

function sharedWindow(): string {
  return formatTeachWindow({
    type: 'exam',
    beginAt: SHARED_BEGIN,
    endAt: SHARED_END,
    durationMinutes: null,
  }, new Date());
}

function linkByHref(href: string): HTMLAnchorElement {
  const found = screen.getAllByRole('link').filter((node) => node.getAttribute('href') === href);
  expect(found).toHaveLength(1);
  const link = found[0];
  if (!(link instanceof HTMLAnchorElement)) throw new TypeError(`missing link ${href}`);
  return link;
}

function visibleText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function expectListPayloadFailure() {
  const alert = await screen.findByRole('alert');
  const text = visibleText(alert);
  expect(text).toBe(LIST_LOAD_FAILED);
  expect(text).not.toContain('teach_payload_invalid');
  expect(screen.queryByText(EXAM_TITLE)).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
}

function renderOpen(CopyDialog: ComponentType<CopyDialogProps>) {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const view = render(<CopyDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange, ...view };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('copy dialog', () => {
  it('requests mine when the dialog opens and shared after switching source', async () => {
    const fetchMock = installFetch(respondRows);
    const user = userEvent.setup();
    const CopyDialog = await loadCopyDialog();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const view = render(<CopyDialog open={false} onOpenChange={onOpenChange} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    view.rerender(<CopyDialog open onOpenChange={onOpenChange} />);

    expect(screen.getByRole('dialog', { name: DIALOG_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: DIALOG_TITLE })).toBeInTheDocument();
    expect(screen.getByText(DIALOG_DESCRIPTION)).toBeInTheDocument();
    expect(scopesOf(fetchMock).length).toBeGreaterThan(0);
    expect(scopesOf(fetchMock).every((scope) => scope === 'mine')).toBe(true);
    expectFirstPage(fetchMock);
    expect(screen.getByRole('tab', { name: '我的' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '学校共享' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByPlaceholderText('搜索标题')).toBeInTheDocument();
    expectTokens(screen.getByRole('dialog'), ['sm:max-w-lg']);

    const dialog = screen.getByRole('dialog');
    const secondary = within(dialog).getAllByRole('button').filter((button) => button.getAttribute('data-variant') === 'secondary');
    expect(secondary).toHaveLength(1);
    expect(secondary[0]).toHaveAccessibleName('取消');
    expect(within(dialog).getAllByRole('button').some((button) => button.getAttribute('data-variant') === 'primary')).toBe(false);

    await user.click(screen.getByRole('tab', { name: '学校共享' }));

    expect(scopesOf(fetchMock).includes('shared')).toBe(true);
    expect(screen.getByRole('tab', { name: '学校共享' })).toHaveAttribute('aria-selected', 'true');
    expectFirstPage(fetchMock);

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requests the typed title 300ms after typing stops', async () => {
    const CopyDialog = await loadCopyDialog();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const user = userEvent.setup({ delay: null });
    const fetchMock = installFetch(respondRows);
    renderOpen(CopyDialog);

    const search = screen.getByPlaceholderText('搜索标题');
    await user.type(search, '栈');

    expect(listUrls(fetchMock).some((url) => url.searchParams.get('q') === '栈')).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(listUrls(fetchMock).some((url) => url.searchParams.get('q') === '栈')).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const matched = listUrls(fetchMock).filter((url) => url.searchParams.get('q') === '栈');
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((url) => url.pathname === '/teach' && url.searchParams.get('scope') === 'mine')).toBe(true);
    expect(matched.every((url) => {
      const page = url.searchParams.get('page');
      return page === null || page === '1';
    })).toBe(true);
  });

  it('links each row to a same-type copy on the new page', async () => {
    installFetch(respondRows);
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    expect(await screen.findByRole('link', { name: new RegExp(EXAM_TITLE) })).toBeInTheDocument();

    const exam = linkByHref(`/teach/new?copy=exam:${EXAM_ID}`);
    const practice = linkByHref(`/teach/new?copy=practice:${PRACTICE_ID}`);
    const list = exam.parentElement;
    expect(list).toBe(practice.parentElement);
    if (!(list instanceof HTMLElement)) throw new TypeError('row list');
    expectTokens(list, ['divide-y', 'divide-line-subtle']);
    expect([...list.children].every((child) => child.tagName === 'A')).toBe(true);

    expectTokens(exam, FOCUS_RING);
    expectTokens(practice, FOCUS_RING);
    expectTokens(within(exam).getByText(EXAM_TITLE), ['truncate', 'font-medium']);
    expectTokens(within(practice).getByText(PRACTICE_TITLE), ['truncate', 'font-medium']);
    expect(exam.textContent ?? '').toContain(`8 道 · ${examWindow()}`);
    expect(practice.textContent ?? '').toContain('3 道 · 不限时');

    const examBadge = within(exam).getByText('作业与考试 · 整卷');
    const practiceBadge = within(practice).getByText('练习');
    expect(examBadge).toHaveAttribute('data-slot', 'badge');
    expect(examBadge).toHaveAttribute('data-variant', 'outline');
    expectTokens(examBadge, ['h-4.5']);
    expect(practiceBadge).toHaveAttribute('data-variant', 'outline');
    expectTokens(practiceBadge, ['h-4.5']);
    expectTokens(screen.getByText(LIST_HINT), ['text-xs', 'text-fg-subtle']);
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    expect(screen.queryByRole('link', { name: '下一页' })).toBeNull();
  });

  it('shows the sharer, problem count and time on a shared row', async () => {
    installFetch(respondRows);
    const user = userEvent.setup();
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    await user.click(screen.getByRole('tab', { name: '学校共享' }));

    expect(await screen.findByText(SHARED_TITLE)).toBeInTheDocument();
    const link = linkByHref(`/teach/new?copy=exam:${SHARED_ID}`);
    expect(link.textContent ?? '').toContain(`${SHARER} · 6 道 · ${sharedWindow()}`);
    expectTokens(within(link).getByText(SHARED_TITLE), ['truncate', 'font-medium']);
    expect(within(link).getByText('作业与考试 · 整卷')).toHaveAttribute('data-variant', 'outline');
    expect(screen.queryByText(EXAM_TITLE)).toBeNull();
  });

  it('shows an empty state for mine and for school sharing', async () => {
    installFetch(respondEmpty);
    const user = userEvent.setup();
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    const mineEmpty = await screen.findByText(MINE_EMPTY);
    expect(ancestorHasToken(mineEmpty, 'py-8')).toBe(true);
    expect(screen.queryByText(SHARED_EMPTY)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();

    await user.click(screen.getByRole('tab', { name: '学校共享' }));

    const sharedEmpty = await screen.findByText(SHARED_EMPTY);
    expect(ancestorHasToken(sharedEmpty, 'py-8')).toBe(true);
    expect(screen.queryByText(MINE_EMPTY)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the server message when loading the list fails', async () => {
    installFetch(() => hydroError(SERVER_MESSAGE));
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_MESSAGE);
    expect(screen.queryByText(MINE_EMPTY)).toBeNull();
    expect(screen.queryByText(EXAM_TITLE)).toBeNull();
    expect(screen.getByRole('heading', { name: DIALOG_TITLE })).toBeInTheDocument();
  });

  it('shows a skeleton until the first page arrives', async () => {
    let finish: (response: Response) => void = () => {
      throw new Error('list response was not armed');
    };
    const pending = new Promise<Response>((done) => {
      finish = done;
    });
    installFetch(() => pending);
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    expect(document.querySelector('.skeleton')).not.toBeNull();
    expect(screen.queryByText(EXAM_TITLE)).toBeNull();
    expect(screen.queryByText(MINE_EMPTY)).toBeNull();
    expect(screen.getByPlaceholderText('搜索标题')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的' })).toBeInTheDocument();

    finish(jsonResponse(READY_MINE));

    expect(await screen.findByText(EXAM_TITLE)).toBeInTheDocument();
    expect(document.querySelector('.skeleton')).toBeNull();
  });

  it('shows at most twenty rows from the first page', async () => {
    const rows = mineRows(21);
    installFetch(() => jsonResponse(minePayload('', rows)));
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    expect(await screen.findByRole('link', { name: /题目集 0/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(20);
    expect(screen.getByText('题目集 19')).toBeInTheDocument();
    expect(screen.queryByText('题目集 20')).toBeNull();
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
    expect(screen.queryByRole('link', { name: '下一页' })).toBeNull();
  });

  it('does not list rows when the payload is not the first page', async () => {
    const first = minePayload('', [examRow()]);
    installFetch(() => jsonResponse(parseTeachListPayload({ ...first, page: 2 })));
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    await expectListPayloadFailure();
  });

  it('does not list rows when the payload scope is not the one requested', async () => {
    const first = minePayload('', [examRow()]);
    installFetch(() => jsonResponse(parseTeachListPayload({ ...first, scope: 'shared' })));
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    await expectListPayloadFailure();
  });

  it('keeps the shared rows when an earlier mine response arrives late', async () => {
    let finishMine: (response: Response) => void = () => {
      throw new Error('mine response was not armed');
    };
    const minePending = new Promise<Response>((done) => {
      finishMine = done;
    });
    installFetch((url) => {
      if (url.searchParams.get('scope') === 'shared') return jsonResponse(READY_SHARED);
      return minePending;
    });
    const user = userEvent.setup();
    const CopyDialog = await loadCopyDialog();
    renderOpen(CopyDialog);

    await user.click(screen.getByRole('tab', { name: '学校共享' }));
    expect(await screen.findByText(SHARED_TITLE)).toBeInTheDocument();

    await act(async () => {
      finishMine(jsonResponse(READY_MINE));
    });

    expect(screen.getByText(SHARED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(EXAM_TITLE)).toBeNull();
    expect(screen.queryByText(PRACTICE_TITLE)).toBeNull();
    expect(screen.getByRole('tab', { name: '学校共享' })).toHaveAttribute('aria-selected', 'true');
  });

  it('requests mine when the dialog opens again', async () => {
    const fetchMock = installFetch(respondRows);
    const user = userEvent.setup();
    const CopyDialog = await loadCopyDialog();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const view = render(<CopyDialog open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('tab', { name: '学校共享' }));
    expect(await screen.findByText(SHARED_TITLE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    const seen = fetchMock.mock.calls.length;
    view.rerender(<CopyDialog open={false} onOpenChange={onOpenChange} />);
    view.rerender(<CopyDialog open onOpenChange={onOpenChange} />);

    expect(await screen.findByText(EXAM_TITLE)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(SHARED_TITLE)).toBeNull();
    const reopened = listUrls(fetchMock).slice(seen);
    expect(reopened.length).toBeGreaterThan(0);
    expect(reopened.every((url) => url.pathname === '/teach' && url.searchParams.get('scope') === 'mine')).toBe(true);
    for (const url of reopened) {
      const page = url.searchParams.get('page');
      expect(page === null || page === '1').toBe(true);
    }
  });
});
