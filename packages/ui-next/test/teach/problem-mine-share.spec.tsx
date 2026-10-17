import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { ProblemMinePage } from '../../src/pages/problem-mine.tsx';

const MD_QUERY = '(min-width: 768px)';
const SCHOOL_BANK_PATH = '/problem/school-bank';
const SERVER_MESSAGE = '这些题目不能共享。';
const NAVIGATION_ERROR = 'Not implemented: navigation to another Document';

interface OwnedProblem {
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
  tag: string[];
  nAccept: number;
  nSubmit: number;
}

interface SchoolBankBody {
  docIds: number[];
  shared: boolean;
}

interface JsdomVirtualConsole {
  on(event: string, listener: (error: unknown) => void): void;
  off(event: string, listener: (error: unknown) => void): void;
}

interface WindowWithJsdom extends Window {
  _virtualConsole?: JsdomVirtualConsole;
}

let reloadCount = 0;
let stopReloadWatch: () => void = () => undefined;
let savedMatchMedia: typeof window.matchMedia;

function jsdomWindow(): WindowWithJsdom {
  return window;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

// jsdom 的 location.reload 不可配置，真实调用会在 virtual console 上报导航未实现。
function watchReloads(): () => void {
  const virtual = jsdomWindow()._virtualConsole;
  if (!virtual) throw new TypeError('jsdom virtual console is missing');
  const listener = (error: unknown) => {
    if (errorMessage(error) === NAVIGATION_ERROR) reloadCount += 1;
  };
  virtual.on('jsdomError', listener);
  return () => virtual.off('jsdomError', listener);
}

function matchMediaFor(desktop: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches: desktop && query === MD_QUERY,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function ownedProblem(docId: number, pid: string, title: string, hidden = true): OwnedProblem {
  return {
    docId,
    pid,
    title,
    hidden,
    tag: ['数据结构'],
    nAccept: 3,
    nSubmit: 8,
  };
}

function mineData(pdocs: OwnedProblem[], schoolBankDocIds?: number[]): Record<string, unknown> {
  const data: Record<string, unknown> = {
    pdocs,
    page: 1,
    pcount: pdocs.length,
    ppcount: 1,
    canCreate: true,
  };
  if (schoolBankDocIds !== undefined) data.schoolBankDocIds = schoolBankDocIds;
  return data;
}

function makeBootstrap(data: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-07-26T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'problem_mine.html', data },
  };
}

function renderMine(data: Record<string, unknown>, layout: 'desktop' | 'phone') {
  window.matchMedia = matchMediaFor(layout === 'desktop');
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={makeBootstrap(data)}>
        <ProblemMinePage />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

function surfaceFor(title: string): HTMLElement {
  const link = screen.getByRole('link', { name: title });
  const surface = link.closest('tr, li');
  if (!(surface instanceof HTMLElement)) throw new TypeError(`missing surface for ${title}`);
  return surface;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status = 403): Response {
  return jsonResponse({
    error: {
      name: 'PermissionError',
      errorCode: 'permission',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSchoolBankBody(raw: string): SchoolBankBody {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new TypeError('school bank body is not an object');
  expect(Object.keys(parsed).sort()).toEqual(['docIds', 'shared']);
  const { docIds, shared } = parsed;
  if (!Array.isArray(docIds) || typeof shared !== 'boolean') {
    throw new TypeError('school bank body has the wrong shape');
  }
  const ids: number[] = [];
  for (const id of docIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new TypeError('school bank docId is not an integer');
    ids.push(id);
  }
  return { docIds: ids, shared };
}

function installFetch(responder: () => Promise<Response>) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => responder());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function postedSchoolBank(fetchMock: ReturnType<typeof installFetch>): Promise<SchoolBankBody> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = fetchMock.mock.calls[0];
  if (!call) throw new TypeError('missing school bank request');
  const [input, init] = call;
  let url = '';
  let method = 'GET';
  let rawBody = '';
  if (typeof input === 'string' || input instanceof URL) {
    url = input instanceof URL ? input.href : input;
    method = init?.method ?? 'GET';
    if (typeof init?.body !== 'string') throw new TypeError('school bank body is not text');
    rawBody = init.body;
  } else {
    url = input.url;
    method = input.method;
    rawBody = await input.clone().text();
  }
  expect(new URL(url, 'http://krypton.local').pathname).toBe(SCHOOL_BANK_PATH);
  expect(method.toUpperCase()).toBe('POST');
  return parseSchoolBankBody(rawBody);
}

function expectDocIds(actual: number[], expected: number[]) {
  const ordered = (ids: number[]) => [...ids].sort((left, right) => left - right);
  expect(ordered(actual)).toEqual(ordered(expected));
}

const sharedHidden = ownedProblem(12, 'CAUC0012', '已共享的隐藏题');
const plainHidden = ownedProblem(15, 'CAUC0015', '未共享的隐藏题');
const thirdHidden = ownedProblem(18, 'CAUC0018', '第三道隐藏题');

beforeEach(() => {
  reloadCount = 0;
  savedMatchMedia = window.matchMedia;
  stopReloadWatch = watchReloads();
});

afterEach(() => {
  stopReloadWatch();
  window.matchMedia = savedMatchMedia;
  vi.unstubAllGlobals();
});

describe('problem mine school bank sharing', () => {
  it('shows 已共享 after the hidden badge when schoolBankDocIds lists that problem', () => {
    renderMine(mineData([sharedHidden, plainHidden], [12]), 'desktop');

    expect(screen.getByRole('table')).toBeInTheDocument();
    const sharedRow = surfaceFor('已共享的隐藏题');
    const status = within(sharedRow).getAllByRole('cell').find((cell) => within(cell).queryByText('隐藏'));
    if (!status) throw new TypeError('missing status cell');
    const hidden = within(status).getByText('隐藏');
    const shared = within(status).getByText('已共享');
    expect(shared).toHaveAttribute('data-slot', 'badge');
    expect(shared.className).toContain('text-2xs');
    expect(hidden.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(surfaceFor('未共享的隐藏题')).queryByText('已共享')).not.toBeInTheDocument();

    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    const firstHeader = headers[0];
    if (!firstHeader) throw new TypeError('missing header cell');
    expect(within(firstHeader).getByRole('checkbox')).toBeInTheDocument();
    const firstCell = within(sharedRow).getAllByRole('cell')[0];
    if (!firstCell) throw new TypeError('missing first cell');
    expect(within(firstCell).getByRole('checkbox', { name: '选择 CAUC0012' })).toBeInTheDocument();
    expect(within(surfaceFor('未共享的隐藏题')).getByRole('checkbox', { name: '选择 CAUC0015' })).toBeInTheDocument();
  });

  it('shows the same checkbox and 已共享 badge on the phone card', () => {
    renderMine(mineData([sharedHidden, plainHidden], [12]), 'phone');

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const sharedCard = surfaceFor('已共享的隐藏题');
    expect(within(sharedCard).getByRole('checkbox', { name: '选择 CAUC0012' })).toBeInTheDocument();
    const shared = within(sharedCard).getByText('已共享');
    expect(shared).toHaveAttribute('data-slot', 'badge');
    expect(shared.className).toContain('text-2xs');
    expect(within(sharedCard).getByText('隐藏')).toBeInTheDocument();
    expect(within(surfaceFor('未共享的隐藏题')).queryByText('已共享')).not.toBeInTheDocument();
    expect(within(surfaceFor('未共享的隐藏题')).getByRole('checkbox', { name: '选择 CAUC0015' })).toBeInTheDocument();
  });

  it('treats a missing schoolBankDocIds field as an empty list', () => {
    renderMine(mineData([sharedHidden]), 'desktop');

    expect(screen.getByText('隐藏')).toBeInTheDocument();
    expect(screen.queryByText('已共享')).not.toBeInTheDocument();
  });

  it('shows no 已共享 badge when schoolBankDocIds is empty', () => {
    renderMine(mineData([sharedHidden], []), 'phone');

    expect(screen.getByText('隐藏')).toBeInTheDocument();
    expect(screen.queryByText('已共享')).not.toBeInTheDocument();
  });

  it('hides the share actions until a problem is selected', () => {
    renderMine(mineData([sharedHidden, plainHidden], [12]), 'desktop');

    expect(screen.queryByRole('button', { name: '共享到学校题库' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消共享' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^已选 \d+ 道$/)).not.toBeInTheDocument();
  });

  it('posts the selected docIds when sharing two problems to the school bank', async () => {
    const fetchMock = installFetch(async () => jsonResponse({ changed: [12, 18], unchanged: [] }));
    const user = userEvent.setup();
    renderMine(mineData([sharedHidden, plainHidden, thirdHidden], []), 'desktop');

    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0012' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0018' }));

    const selected = screen.getByText('已选 2 道');
    expect(selected.className).toContain('text-sm');
    expect(selected.className).toContain('text-fg-muted');
    const share = screen.getByRole('button', { name: '共享到学校题库' });
    const unshare = screen.getByRole('button', { name: '取消共享' });
    expect(share).toHaveAttribute('data-variant', 'secondary');
    expect(share).toHaveAttribute('data-size', 'sm');
    expect(unshare).toHaveAttribute('data-variant', 'ghost');
    expect(unshare).toHaveAttribute('data-size', 'sm');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(share);

    expect(await screen.findByText('已共享 2 道')).toBeInTheDocument();
    const body = await postedSchoolBank(fetchMock);
    expect(body.shared).toBe(true);
    expectDocIds(body.docIds, [12, 18]);
    await waitFor(() => {
      expect(reloadCount).toBe(1);
    });
  });

  it('posts shared false and confirms when cancelling the share', async () => {
    const fetchMock = installFetch(async () => jsonResponse({ changed: [12, 15], unchanged: [] }));
    const user = userEvent.setup();
    renderMine(mineData([sharedHidden, plainHidden], [12]), 'desktop');

    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0012' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0015' }));
    await user.click(screen.getByRole('button', { name: '取消共享' }));

    expect(await screen.findByText('已取消共享 2 道')).toBeInTheDocument();
    const body = await postedSchoolBank(fetchMock);
    expect(body.shared).toBe(false);
    expectDocIds(body.docIds, [12, 15]);
    await waitFor(() => {
      expect(reloadCount).toBe(1);
    });
  });

  it('shows the server message and does not reload when sharing fails', async () => {
    const fetchMock = installFetch(async () => hydroError(SERVER_MESSAGE));
    const user = userEvent.setup();
    renderMine(mineData([plainHidden, thirdHidden], []), 'desktop');

    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0015' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0018' }));
    await user.click(screen.getByRole('button', { name: '共享到学校题库' }));

    expect(await screen.findByText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^已共享 \d+ 道$/)).not.toBeInTheDocument();
    expect(reloadCount).toBe(0);
  });

  it('selects every problem on the page from the header checkbox', async () => {
    const fetchMock = installFetch(async () => jsonResponse({ changed: [12, 15, 18], unchanged: [] }));
    const user = userEvent.setup();
    renderMine(mineData([sharedHidden, plainHidden, thirdHidden], []), 'desktop');

    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    const firstHeader = headers[0];
    if (!firstHeader) throw new TypeError('missing header cell');
    await user.click(within(firstHeader).getByRole('checkbox'));

    expect(screen.getByRole('checkbox', { name: '选择 CAUC0012' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0015' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0018' })).toBeChecked();
    expect(screen.getByText('已选 3 道')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '共享到学校题库' }));

    const body = await postedSchoolBank(fetchMock);
    expect(body.shared).toBe(true);
    expectDocIds(body.docIds, [12, 15, 18]);
  });

  it('clears the page selection when the header checkbox is turned off', async () => {
    const user = userEvent.setup();
    renderMine(mineData([sharedHidden, plainHidden, thirdHidden], []), 'desktop');

    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    const firstHeader = headers[0];
    if (!firstHeader) throw new TypeError('missing header cell');
    const header = within(firstHeader).getByRole('checkbox', { name: '选择本页全部题目' });
    await user.click(header);
    expect(screen.getByText('已选 3 道')).toBeInTheDocument();

    await user.click(header);
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0012' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0015' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0018' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: '共享到学校题库' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消共享' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^已选 \d+ 道$/)).not.toBeInTheDocument();
  });

  it('treats a null schoolBankDocIds value as an empty list', () => {
    const data = mineData([sharedHidden]);
    data.schoolBankDocIds = null;
    renderMine(data, 'desktop');

    expect(screen.getByText('隐藏')).toBeInTheDocument();
    expect(screen.queryByText('已共享')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0012' })).toBeInTheDocument();
  });

  it('rejects a schoolBankDocIds value that is not a list', () => {
    const data = mineData([sharedHidden]);
    data.schoolBankDocIds = '12';
    expect(() => renderMine(data, 'desktop')).toThrow(/学校题库共享标记格式不正确/);
  });

  it('posts only the problems that stay checked after one is unchecked', async () => {
    const fetchMock = installFetch(async () => jsonResponse({ changed: [18], unchanged: [] }));
    const user = userEvent.setup();
    renderMine(mineData([sharedHidden, plainHidden, thirdHidden], []), 'desktop');

    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0012' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0018' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0012' }));

    expect(screen.getByRole('checkbox', { name: '选择 CAUC0012' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 CAUC0018' })).toBeChecked();
    expect(screen.getByText('已选 1 道')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '共享到学校题库' }));

    expect(await screen.findByText('已共享 1 道')).toBeInTheDocument();
    const body = await postedSchoolBank(fetchMock);
    expect(body.shared).toBe(true);
    expectDocIds(body.docIds, [18]);
  });

  it('does not reload when the school bank response omits changed and unchanged', async () => {
    const fetchMock = installFetch(async () => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    renderMine(mineData([plainHidden], []), 'desktop');

    await user.click(screen.getByRole('checkbox', { name: '选择 CAUC0015' }));
    await user.click(screen.getByRole('button', { name: '共享到学校题库' }));

    expect(await screen.findByText('学校题库响应格式不正确')).toBeInTheDocument();
    expect(screen.queryByText(/^已共享 \d+ 道$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^已取消共享 \d+ 道$/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reloadCount).toBe(0);
    expect(screen.getByRole('button', { name: '共享到学校题库' })).toBeEnabled();
  });

  it('shows 已共享 after the visible badge when a visible problem is in the school bank', () => {
    const sharedVisible = ownedProblem(21, 'CAUC0021', '已共享的可见题', false);
    renderMine(mineData([sharedVisible], [21]), 'desktop');

    const row = surfaceFor('已共享的可见题');
    const status = within(row).getAllByRole('cell').find((cell) => within(cell).queryByText('可见'));
    if (!status) throw new TypeError('missing status cell');
    const visible = within(status).getByText('可见');
    const shared = within(status).getByText('已共享');
    expect(shared).toHaveAttribute('data-slot', 'badge');
    expect(shared.className).toContain('text-2xs');
    expect(visible.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
