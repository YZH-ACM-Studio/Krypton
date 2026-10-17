import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeachTab } from '@hydrooj/common';
import { Component, type ComponentType, type ReactNode } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { paperFromPayload, paperNumbering } from '../../src/pages/teach/paper.ts';
import type { TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';

// A static import fails collection while the records tab is absent.
const pageLoaders = import.meta.glob('../../src/pages/teach/tabs/records.tsx');

const RECORDS_SOURCE = 'src/pages/teach/tabs/records.tsx';
const TID = '64b7c3a2e4b0f96d1a2c3d4e';
const SERVER = Date.parse('2020-01-15T12:00:00.000Z');
const TODAY_MS = Date.parse('2020-01-15T12:00:07.000Z');
const OLDER_MS = Date.parse('2020-01-13T12:00:00.000Z');
const KNOWN_UID = 11;
const UNKNOWN_UID = 22;
const PAGE_TWO_UID = 33;
const FIRST_DOC = 1001;
const SECOND_DOC = 1002;
const KNOWN_UNAME = 'chen';
const UNKNOWN_UNAME = 'liming';
const PAGE_TWO_UNAME = 'page2user';
const KNOWN_STUDENT_ID = '2401010112';
const KNOWN_NAME = '陈思远';
const FIRST_TITLE = '两数之和';
const SECOND_TITLE = '链表反转';
const PARTICIPANT_ERROR = '现在读不到学生名单。';
const EMPTY_TITLE = '还没有提交记录';
const HIDDEN_MARK = '\u2014';
const RESULT_LABELS = ['全部结果', '通过', '答案错误', '时间超限', '内存超限', '运行时错误', '编译错误', '评测中'] as const;
// 答案错误 is STATUS_DISPLAY status 2. The lane lists these Chinese names, not the English labels.
const WRONG_ANSWER = '2';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

interface FailureState {
  failed: boolean;
  message: string;
}

interface RecordDoc {
  _id: string;
  uid: number;
  pid: number;
  status: number;
  score: number;
  lang: string;
  time: number;
}

interface SeenRequest {
  url: URL;
  init: RequestInit | undefined;
}

interface RecordsTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

class RecordFailureBoundary extends Component<{ children: ReactNode }, FailureState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): FailureState {
    const message = error instanceof Error && error.message !== '' ? error.message : 'unknown render error';
    return { failed: true, message };
  }

  render(): ReactNode {
    if (this.state.failed) return <div role="alert">{this.state.message}</div>;
    return this.props.children;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function objectIdAt(ms: number): string {
  return `${Math.floor(ms / 1000).toString(16).padStart(8, '0')}aabbccddeeff0011`;
}

function clockText(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dayText(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const TODAY_ID = objectIdAt(TODAY_MS);
const OLDER_ID = objectIdAt(OLDER_MS);
const PAGE_TWO_ID = objectIdAt(TODAY_MS + 60_000);

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: new Date(SERVER).toISOString(),
    user: {
      id: 7,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function workbench(): TeachWorkbenchPayload {
  return {
    container: {
      type: 'homework',
      id: TID,
      rule: 'homework',
      title: '栈与队列作业',
      status: 'running',
      beginAt: '2020-01-15T00:00:00.000Z',
      endAt: '2020-01-20T00:00:00.000Z',
      durationMinutes: null,
      penaltySince: '2020-01-20T00:00:00.000Z',
      lockAt: null,
      audience: {
        mode: 'groups',
        groupNames: ['计科 2401'],
        schoolNames: [],
        boundStudentCount: 40,
      },
      owner: { uid: 7, name: '王老师' },
      maintainers: [],
      createdAt: '2020-01-10T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: `/homework/${TID}`,
        scoreboard: `/homework/${TID}/scoreboard`,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/homework/${TID}/file`,
        redemption: null,
      },
    },
    paper: {
      problems: [
        {
          docId: FIRST_DOC,
          pid: 'P1001',
          title: FIRST_TITLE,
          kind: 'programming',
          score: 100,
          hidden: false,
          mine: true,
          difficulty: null,
        },
        {
          docId: SECOND_DOC,
          pid: 'P1002',
          title: SECOND_TITLE,
          kind: 'programming',
          score: 100,
          hidden: false,
          mine: true,
          difficulty: null,
        },
      ],
      stages: null,
      examPaperQuotas: null,
    },
    stats: {
      participantCount: 2,
      startedCount: null,
      finalizedCount: null,
      submittedCount: 2,
      recordCount: 2,
      audienceCount: 40,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function problemLabel(docId: number): string {
  const payload = workbench();
  const numbers = paperNumbering(paperFromPayload(payload.paper, payload.container));
  const number = numbers.get(docId);
  const problem = payload.paper.problems.find((item) => item.docId === docId);
  if (number === undefined || problem === undefined) throw new TypeError(`problem ${docId}`);
  return `${number} ${problem.title}`;
}

function unameFor(uid: number): string {
  if (uid === KNOWN_UID) return KNOWN_UNAME;
  if (uid === UNKNOWN_UID) return UNKNOWN_UNAME;
  if (uid === PAGE_TWO_UID) return PAGE_TWO_UNAME;
  throw new TypeError(`uid ${uid}`);
}

function problemSummary(docId: number): Record<string, unknown> {
  const problem = workbench().paper.problems.find((item) => item.docId === docId);
  if (problem === undefined) throw new TypeError(`problem ${docId}`);
  return { docId, pid: problem.pid, title: problem.title };
}

function recordResponse(rows: readonly RecordDoc[]): Record<string, unknown> {
  const udict: Record<string, unknown> = {};
  const pdict: Record<string, unknown> = {};
  const rdocs: Record<string, unknown>[] = [];
  for (const row of rows) {
    udict[String(row.uid)] = { _id: row.uid, uname: unameFor(row.uid) };
    pdict[String(row.pid)] = problemSummary(row.pid);
    rdocs.push({
      _id: row._id,
      uid: row.uid,
      pid: row.pid,
      status: row.status,
      score: row.score,
      lang: row.lang,
      time: row.time,
      memory: 2048,
    });
  }
  return {
    rdocs,
    udict,
    pdict,
    langs: {
      'cc.cc17': { display: 'C++17' },
    },
  };
}

function pageOneRows(): RecordDoc[] {
  return [
    {
      _id: TODAY_ID,
      uid: KNOWN_UID,
      pid: FIRST_DOC,
      status: 1,
      score: 100,
      lang: 'cc.cc17',
      time: 31,
    },
    {
      _id: OLDER_ID,
      uid: UNKNOWN_UID,
      pid: SECOND_DOC,
      status: 2,
      score: 40,
      lang: 'Python3',
      time: 1200,
    },
  ];
}

function participantsResponse(): Record<string, unknown> {
  return {
    participants: [
      {
        uid: KNOWN_UID,
        uname: KNOWN_UNAME,
        studentId: KNOWN_STUDENT_ID,
        realName: KNOWN_NAME,
        groupIds: ['g1'],
        attended: true,
        startAt: null,
        finalizedAt: null,
        lastSubmitAt: '2020-01-15T12:00:07.000Z',
        late: false,
      },
    ],
    groups: [{ id: 'g1', name: '计科 2401' }],
  };
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

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function seenRequests(fetchMock: FetchMock): SeenRequest[] {
  return fetchMock.mock.calls.map((call) => ({
    url: requestUrl(call[0]),
    init: call[1],
  }));
}

function recordRequests(fetchMock: FetchMock): SeenRequest[] {
  return seenRequests(fetchMock).filter((request) => request.url.pathname === '/record');
}

function participantRequests(fetchMock: FetchMock): SeenRequest[] {
  return seenRequests(fetchMock).filter((request) => request.url.pathname === `/teach/homework/${TID}/participants`);
}

function expectGetJson(request: SeenRequest) {
  const init = request.init ?? {};
  expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
  expect(init.credentials).toBe('same-origin');
  expect(new Headers(init.headers).get('Accept')).toBe('application/json');
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(RECORDS_SOURCE)) return load;
  }
  return undefined;
}

function readExport(imported: object, key: string): unknown {
  if (!(key in imported)) return undefined;
  return Reflect.get(imported, key) as unknown;
}

async function loadRecordsTab(): Promise<ComponentType<RecordsTabProps>> {
  const load = pageLoader();
  expect(typeof load, RECORDS_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${RECORDS_SOURCE} must exist`);
  let imported: unknown;
  try {
    imported = await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
  if (typeof imported !== 'object' || imported === null) throw new TypeError('records tab module must be an object');
  const component = readExport(imported, 'RecordsTab');
  expect(typeof component, 'RecordsTab').toBe('function');
  if (typeof component !== 'function') throw new TypeError('RecordsTab must be a function');
  return component as ComponentType<RecordsTabProps>;
}

function installFetch(respond: (url: URL) => Response): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => Promise.resolve(respond(requestUrl(input))),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installRecords(options?: { participants?: 'fail' | Record<string, unknown>; record?: (url: URL) => Record<string, unknown> }): FetchMock {
  return installFetch((url) => {
    if (url.pathname === `/teach/homework/${TID}/participants`) {
      if (options?.participants === 'fail') return hydroError(PARTICIPANT_ERROR);
      return jsonResponse(options?.participants ?? participantsResponse());
    }
    if (url.pathname === '/record') {
      return jsonResponse(options?.record ? options.record(url) : recordResponse(pageOneRows()));
    }
    return hydroError(`unexpected ${url.pathname}`, 404);
  });
}

async function renderRecords(boundary = false): Promise<void> {
  const RecordsTab = await loadRecordsTab();
  const tab = <RecordsTab payload={workbench()} onNavigateTab={vi.fn()} />;
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      {boundary ? <RecordFailureBoundary>{tab}</RecordFailureBoundary> : tab}
    </BootstrapProvider>,
  );
}

function combobox(names: readonly string[]): HTMLElement {
  for (const name of names) {
    const found = screen.queryByRole('combobox', { name });
    if (found) return found;
  }
  const available = screen.queryAllByRole('combobox').map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' | ');
  expect.fail(`missing combobox ${names.join(' / ')} among ${available}`);
}

function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => (option.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function expectText(text: string) {
  const found = screen.getAllByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.childElementCount > 0) return false;
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim() === text
      || (element.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim() === text;
  });
  expect(found.length).toBeGreaterThan(0);
}

function expectTokens(text: string, tokens: readonly string[]) {
  const nodes = screen.getAllByText(text);
  const matched = nodes.some((node) => {
    let current: HTMLElement | null = node;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const classes = new Set((current.getAttribute('class') ?? '').split(/\s+/));
      if (tokens.every((token) => classes.has(token))) return true;
      current = current.parentElement;
    }
    return false;
  });
  expect(matched, `${text} classes`).toBe(true);
}

function expectHref(id: string) {
  expect(document.querySelectorAll(`a[href="/record/${id}"]`).length).toBeGreaterThan(0);
}

function ghostButton(name: string): HTMLElement {
  const button = screen.getByRole('button', { name });
  expect(button).toHaveAttribute('data-variant', 'ghost');
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('records tab', () => {
  it('requests the first page, then the selected problem by doc id', async () => {
    const user = userEvent.setup();
    const fetchMock = installRecords();
    await renderRecords();

    await waitFor(() => {
      expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1`)).toBe(true);
      expect(participantRequests(fetchMock)).toHaveLength(1);
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
    });
    const first = recordRequests(fetchMock).find((request) => request.url.search === `?tid=${TID}&page=1`);
    const participants = participantRequests(fetchMock)[0];
    if (first === undefined || participants === undefined) throw new TypeError('missing first records request');
    expectGetJson(first);
    expectGetJson(participants);

    await user.click(combobox(['题目', '全部题目']));
    await waitFor(() => {
      expect(optionLabels()).toEqual(['全部题目', problemLabel(FIRST_DOC), problemLabel(SECOND_DOC)]);
    });
    await user.click(screen.getByRole('option', { name: problemLabel(FIRST_DOC) }));

    await waitFor(() => {
      expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1&pid=${FIRST_DOC}`)).toBe(true);
    });
  });

  it('shows a student id and name, or the username when there is no identity', async () => {
    const fetchMock = installRecords();
    await renderRecords();

    await waitFor(() => {
      expect(screen.getAllByText(KNOWN_NAME).length).toBeGreaterThan(0);
    });
    expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1`)).toBe(true);
    expectText(KNOWN_STUDENT_ID);
    expectTokens(KNOWN_STUDENT_ID, ['font-mono', 'text-xs', 'text-fg-subtle']);
    expect(screen.queryByText(KNOWN_UNAME)).toBeNull();
    expect(screen.getAllByText(UNKNOWN_UNAME).length).toBeGreaterThan(0);
    expectText(problemLabel(FIRST_DOC));
    expectText(problemLabel(SECOND_DOC));
    expect(screen.getAllByText('AC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WA').length).toBeGreaterThan(0);
    expect(screen.queryByText('Accepted')).toBeNull();
    expect(screen.queryByText('Wrong Answer')).toBeNull();
    expect(document.querySelector('[data-status="1"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-status="2"]')).toBeInstanceOf(HTMLElement);
    expectTokens('100', ['tabular']);
    expectTokens('40', ['tabular']);
    expect(screen.getAllByText('C++17').length).toBeGreaterThan(0);
    expect(screen.queryByText('cc.cc17')).toBeNull();
    expect(screen.getAllByText('Python3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('31 ms').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1200 ms').length).toBeGreaterThan(0);
    expect(screen.getAllByText(clockText(TODAY_MS)).length).toBeGreaterThan(0);
    expect(screen.queryByText(dayText(TODAY_MS))).toBeNull();
    expectTokens(clockText(TODAY_MS), ['tabular']);
    expect(screen.getAllByText(dayText(OLDER_MS)).length).toBeGreaterThan(0);
    expect(screen.queryByText(clockText(OLDER_MS))).toBeNull();
    expectHref(TODAY_ID);
    expectHref(OLDER_ID);
    for (const header of ['时间', '学生', '题目', '结果', '分数', '语言', '用时']) {
      expect(screen.getAllByRole('columnheader', { name: header }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('combobox', { name: '用户组' })).toBeNull();
    expect(screen.queryByText('全部用户组')).toBeNull();
    expect(screen.queryByPlaceholderText('学号或姓名')).toBeNull();
    expect(screen.getByPlaceholderText('用户名或 UID')).toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    const table = document.querySelector('[data-slot="data-table"]');
    expect(table).toBeInstanceOf(HTMLElement);
    if (table instanceof HTMLElement) expect(table).toHaveAttribute('data-mobile', 'stack');
    const panel = document.querySelector('[data-slot="panel"]');
    expect(panel).toBeInstanceOf(HTMLElement);
    if (panel instanceof HTMLElement) {
      const body = panel.firstElementChild;
      expect(body).toBeInstanceOf(HTMLElement);
      if (body instanceof HTMLElement) {
        expect(new Set((body.getAttribute('class') ?? '').split(/\s+/)).has('p-4')).toBe(false);
      }
    }
    expect(ghostButton('刷新')).toBeInTheDocument();
  });

  it('disables the previous page on page 1 and moves to the next page', async () => {
    const user = userEvent.setup();
    const fetchMock = installRecords({
      record: (url) => (url.searchParams.get('page') === '2'
        ? recordResponse([{
          _id: PAGE_TWO_ID,
          uid: PAGE_TWO_UID,
          pid: FIRST_DOC,
          status: 1,
          score: 80,
          lang: 'cc.cc17',
          time: 20,
        }])
        : recordResponse(pageOneRows())),
    });
    await renderRecords();

    await waitFor(() => {
      expect(screen.getAllByText(KNOWN_NAME).length).toBeGreaterThan(0);
    });
    const previous = ghostButton('上一页');
    const next = ghostButton('下一页');
    expect(previous).toBeDisabled();
    expect(previous).toHaveAttribute('data-size', 'sm');
    expect(next).toBeEnabled();
    expect(next).toHaveAttribute('data-size', 'sm');
    expect(screen.getByText('第 1 页')).toBeInTheDocument();

    await user.click(next);
    await waitFor(() => {
      expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=2`)).toBe(true);
      expect(screen.getAllByText(PAGE_TWO_UNAME).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    expect(ghostButton('上一页')).toBeEnabled();
    expect(ghostButton('下一页')).toBeEnabled();
    expectHref(PAGE_TWO_ID);

    await user.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => {
      expect(screen.getAllByText(KNOWN_NAME).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
  });

  it('disables the next page and shows the empty state when the page is empty', async () => {
    const fetchMock = installRecords({ record: () => recordResponse([]) });
    await renderRecords();

    await waitFor(() => {
      expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    });
    expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1`)).toBe(true);
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    const title = screen.getByText(EMPTY_TITLE);
    let compact = false;
    let current: HTMLElement | null = title;
    while (current) {
      const classes = new Set((current.getAttribute('class') ?? '').split(/\s+/));
      if (classes.has('py-8') && classes.has('gap-2')) compact = true;
      current = current.parentElement;
    }
    expect(compact).toBe(true);
  });

  it('applies the result filter and the username only after enter, then refreshes', async () => {
    const user = userEvent.setup();
    const fetchMock = installRecords();
    await renderRecords();
    await waitFor(() => {
      expect(screen.getAllByText(KNOWN_NAME).length).toBeGreaterThan(0);
    });

    await user.click(combobox(['结果', '全部结果']));
    await waitFor(() => {
      expect(optionLabels()).toEqual([...RESULT_LABELS]);
    });
    await user.click(screen.getByRole('option', { name: '答案错误' }));
    await waitFor(() => {
      expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1&status=${WRONG_ANSWER}`)).toBe(true);
    });

    const beforeName = recordRequests(fetchMock).length;
    await user.type(screen.getByPlaceholderText('用户名或 UID'), UNKNOWN_UNAME);
    expect(recordRequests(fetchMock)).toHaveLength(beforeName);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(recordRequests(fetchMock).some((request) => request.url.search === `?tid=${TID}&page=1&status=${WRONG_ANSWER}&uidOrName=${UNKNOWN_UNAME}`)).toBe(true);
    });

    const beforeRefresh = recordRequests(fetchMock).length;
    await user.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => {
      expect(recordRequests(fetchMock)).toHaveLength(beforeRefresh + 1);
    });
    const refreshed = recordRequests(fetchMock)[beforeRefresh];
    expect(refreshed?.url.search).toBe(`?tid=${TID}&page=1&status=${WRONG_ANSWER}&uidOrName=${UNKNOWN_UNAME}`);
  });

  it('shows the participant error above the table and falls back to usernames', async () => {
    installRecords({ participants: 'fail' });
    await renderRecords();

    await waitFor(() => {
      expect(screen.getAllByText(KNOWN_UNAME).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(UNKNOWN_UNAME).length).toBeGreaterThan(0);
    expect(screen.queryByText(KNOWN_STUDENT_ID)).toBeNull();
    expect(screen.queryByText(KNOWN_NAME)).toBeNull();
    const alert = screen.getAllByRole('status').find((node) => (node.textContent ?? '').includes(PARTICIPANT_ERROR));
    expect(alert).toBeInstanceOf(HTMLElement);
    if (!(alert instanceof HTMLElement)) throw new TypeError('participant alert');
    const classes = new Set((alert.getAttribute('class') ?? '').split(/\s+/));
    expect(classes.has('border-line')).toBe(true);
    expect(classes.has('bg-surface-sunken')).toBe(true);
    expect(classes.has('bg-danger-soft')).toBe(false);
    const table = document.querySelector('[data-slot="data-table"]');
    expect(table).toBeInstanceOf(HTMLElement);
    if (!(table instanceof HTMLElement)) throw new TypeError('records table');
    expect(table.contains(alert)).toBe(false);
    expect(alert.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('does not render a submission when the record payload has the wrong shape', async () => {
    installRecords({
      record: () => ({
        rdocs: [{
          _id: TODAY_ID,
          uid: KNOWN_UID,
          pid: FIRST_DOC,
          score: 40,
          lang: 'C++17',
          time: 31,
        }],
        udict: { [String(KNOWN_UID)]: { _id: KNOWN_UID, uname: 'partialuser' } },
      }),
    });
    await renderRecords(true);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText('partialuser')).toBeNull();
    expect(screen.queryByText(KNOWN_STUDENT_ID)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('keeps a projected contest row when status, score, and time are absent', async () => {
    // Ongoing OI and exam applyProjection removes those three fields and leaves lang, udict, and pdict.
    installRecords({
      record: () => ({
        rdocs: [{
          _id: TODAY_ID,
          uid: UNKNOWN_UID,
          pid: FIRST_DOC,
          lang: 'C++17',
        }],
        udict: { [String(UNKNOWN_UID)]: { _id: UNKNOWN_UID, uname: UNKNOWN_UNAME } },
        pdict: { [String(FIRST_DOC)]: problemSummary(FIRST_DOC) },
      }),
    });
    await renderRecords(true);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      const row = screen.getAllByText(UNKNOWN_UNAME).find((node) => {
        const host = node.closest('tr') ?? node.closest('li');
        return host !== null && (host.textContent ?? '').includes(HIDDEN_MARK);
      });
      expect(row).toBeInstanceOf(HTMLElement);
    });
    expect(document.querySelector('[data-slot="data-table"]')).toBeInstanceOf(HTMLElement);
  });
});
