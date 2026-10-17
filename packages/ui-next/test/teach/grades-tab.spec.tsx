// A static import fails collection while src/pages/teach/tabs/grades.tsx is absent.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemKind, TeachTab, TeachType } from '@hydrooj/common';
import type { ReactElement } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { TeachPaper, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';

const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/grades.tsx');
const TAB_SOURCE = 'src/pages/teach/tabs/grades.tsx';

const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d53';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d52';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d55';
const SERVER_MESSAGE = '成绩暂时读不出来。';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
type GradesTabType = (props: { payload: TeachWorkbenchPayload; onNavigateTab: (tab: TeachTab) => void }) => ReactElement;

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let capturedBlobs: Blob[] = [];
let clickedAnchors: HTMLAnchorElement[] = [];

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadModule(loaders: object, source: string): Promise<object> {
  const load = moduleLoader(loaders, source);
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

async function loadGradesTab(): Promise<GradesTabType> {
  const imported = await loadModule(tabLoaders, TAB_SOURCE);
  const component = readField(imported, 'GradesTab');
  expect(typeof component, 'GradesTab').toBe('function');
  if (typeof component !== 'function') throw new TypeError('GradesTab must be a function');
  return component as GradesTabType;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function paths(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map((call) => requestUrl(call[0]).pathname);
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

function installFetch(respond: (url: URL) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => Promise.resolve(respond(requestUrl(input))),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T00:00:00.000Z',
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

function renderGrades(Tab: GradesTabType, payload: TeachWorkbenchPayload) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <Tab payload={payload} onNavigateTab={() => undefined} />
    </BootstrapProvider>,
  );
}

function problem(docId: number, kind: ProblemKind, score: number | null): TeachPaper['problems'][number] {
  return {
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind,
    score,
    hidden: false,
    mine: false,
    difficulty: null,
  };
}

function links(overrides: Partial<TeachWorkbenchPayload['container']['links']>): TeachWorkbenchPayload['container']['links'] {
  return {
    studentView: '/',
    scoreboard: null,
    manage: null,
    users: null,
    clarification: null,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: '/',
    redemption: null,
    ...overrides,
  };
}

function workbench(input: {
  type: TeachType;
  rule: string;
  id: string;
  title: string;
  paper: TeachPaper;
  canGrade: boolean;
  link: TeachWorkbenchPayload['container']['links'];
}): TeachWorkbenchPayload {
  return {
    container: {
      type: input.type,
      id: input.id,
      rule: input.rule,
      title: input.title,
      status: input.type === 'practice' ? 'open' : 'ended',
      beginAt: input.type === 'practice' ? null : '2026-10-24T06:00:00.000Z',
      endAt: input.type === 'practice' ? null : '2026-10-24T08:00:00.000Z',
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'groups',
        groupNames: ['计科 2401', '计科 2402'],
        schoolNames: [],
        boundStudentCount: 2,
      },
      owner: { uid: 7, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: input.link,
    },
    paper: input.paper,
    stats: {
      participantCount: 2,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: 2,
      problemStats: null,
    },
    capabilities: {
      canDelete: false,
      canShare: false,
      canGrade: input.canGrade,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function participant(partial: {
  uid: number;
  uname: string;
  studentId: string;
  realName: string;
  groupIds: string[];
  startAt?: string | null;
  finalizedAt?: string | null;
  lastSubmitAt?: string | null;
  late?: boolean;
}) {
  return {
    uid: partial.uid,
    uname: partial.uname,
    studentId: partial.studentId,
    realName: partial.realName,
    groupIds: partial.groupIds,
    attended: true,
    startAt: partial.startAt ?? null,
    finalizedAt: partial.finalizedAt ?? null,
    lastSubmitAt: partial.lastSubmitAt ?? null,
    late: partial.late ?? false,
  };
}

function examParticipants() {
  return {
    participants: [
      participant({
        uid: 10,
        uname: 'chen',
        studentId: '2401010112',
        realName: '陈思远',
        groupIds: ['g1'],
        startAt: '2026-10-24T06:10:00.000Z',
        finalizedAt: '2026-10-24T07:40:00.000Z',
      }),
      participant({
        uid: 11,
        uname: 'wang',
        studentId: '2401020203',
        realName: '王浩然',
        groupIds: ['g2'],
      }),
    ],
    groups: [
      { id: 'g1', name: '计科 2401' },
      { id: 'g2', name: '计科 2402' },
    ],
  };
}

function examBoard() {
  return {
    rows: [
      [
        { type: 'rank', value: '#' },
        { type: 'user', value: 'User' },
        { type: 'total_score', value: 'Total Score' },
        { type: 'problem', value: 'A', raw: 202 },
      ],
      [
        { type: 'rank', value: '1' },
        { type: 'user', value: 'chen', raw: 10 },
        { type: 'total_score', value: 5 },
        { type: 'record', value: '5', score: 5, hover: '' },
      ],
      [
        { type: 'rank', value: '2' },
        { type: 'user', value: 'wang', raw: 11 },
        { type: 'total_score', value: 0 },
        { type: 'record', value: '0', score: 0, hover: '' },
      ],
    ],
  };
}

function examPayload(): TeachWorkbenchPayload {
  return workbench({
    type: 'exam',
    rule: 'exam',
    id: EXAM_ID,
    title: '期中整卷',
    paper: {
      problems: [problem(202, 'single', 5)],
      stages: null,
      examPaperQuotas: null,
    },
    canGrade: true,
    link: links({
      studentView: `/contest/${EXAM_ID}`,
      scoreboard: `/contest/${EXAM_ID}/scoreboard`,
      manage: `/contest/${EXAM_ID}/management`,
      grading: `/manage/grading/${EXAM_ID}`,
      files: `/contest/${EXAM_ID}/management`,
    }),
  });
}

function headerTexts(): string[] {
  return screen.getAllByRole('columnheader').map((node) => node.textContent ?? '');
}

function rowByName(name: string): HTMLTableRowElement {
  const cell = screen.getByRole('cell', { name });
  const row = cell.closest('tr');
  if (!(row instanceof HTMLTableRowElement)) throw new TypeError(`missing row ${name}`);
  return row;
}

function marked(node: HTMLElement): string {
  return `${node.className} ${node.innerHTML}`;
}

function peopleFooter(): HTMLElement {
  const footer = document.querySelector('[data-slot="panel"] footer');
  if (!(footer instanceof HTMLElement)) throw new TypeError('missing grades footer');
  return footer;
}

function footerText(): string {
  return (peopleFooter().textContent ?? '').replace(/\s+/g, ' ').trim();
}

function dataRowCount(): number {
  return screen.getAllByRole('row').length - 1;
}

interface Opened {
  user: ReturnType<typeof userEvent.setup>;
  fetchMock: FetchMock;
}

async function openExam(): Promise<Opened> {
  const Tab = await loadGradesTab();
  const user = userEvent.setup();
  const fetchMock = installFetch((url) => {
    if (url.pathname === `/teach/exam/${EXAM_ID}/participants`) return jsonResponse(examParticipants());
    if (url.pathname === `/contest/${EXAM_ID}/scoreboard`) return jsonResponse(examBoard());
    return hydroError(`未知请求 ${url.pathname}`, 404);
  });
  renderGrades(Tab, examPayload());
  await screen.findByRole('cell', { name: '陈思远' });
  return { user, fetchMock };
}

describe('teach grades tab', () => {
  beforeEach(() => {
    capturedBlobs = [];
    clickedAnchors = [];
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) capturedBlobs.push(object);
      return `blob:grades-${capturedBlobs.length}`;
    };
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedAnchors.push(this);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('filters by group and by student id or name', async () => {
    const { user, fetchMock } = await openExam();
    expect(new Set(paths(fetchMock))).toEqual(new Set([
      `/teach/exam/${EXAM_ID}/participants`,
      `/contest/${EXAM_ID}/scoreboard`,
    ]));
    expect(headerTexts()).toEqual(['学号', '姓名', '用户组', '单选题', '总分', '状态']);
    expect(screen.getByPlaceholderText('学号或姓名')).toBeInTheDocument();
    const groupSelect = screen.getByRole('combobox', { name: '用户组' });
    expect(groupSelect).toHaveTextContent('全部用户组');
    expect(groupSelect).toHaveClass('w-48');
    expect(document.querySelector('[data-slot="data-table"]')?.getAttribute('data-mobile')).toBe('scroll');
    expect(screen.getAllByRole('columnheader')[0]?.className).toContain('sticky');
    expect(dataRowCount()).toBe(2);
    expect(footerText()).toBe('2 人');
    expect(marked(peopleFooter())).toContain('text-sm');
    expect(marked(peopleFooter())).toContain('text-fg-subtle');

    const chen = rowByName('陈思远');
    expect(marked(within(chen).getByRole('cell', { name: '2401010112' }))).toContain('font-mono');
    expect(marked(within(chen).getByRole('cell', { name: '2401010112' }))).toContain('text-xs');
    expect(marked(within(chen).getByRole('cell', { name: '计科 2401' }))).toContain('text-fg-muted');
    expect(within(chen).getByRole('cell', { name: '已交卷' })).toBeInTheDocument();
    const fullMarks = within(chen).getAllByRole('cell', { name: '5' });
    expect(fullMarks.length).toBeGreaterThan(0);
    for (const cell of fullMarks) {
      expect(cell.className).toContain('text-center');
      expect(marked(cell)).toContain('tabular');
      expect(marked(cell)).toContain('text-success-fg');
    }
    const wang = rowByName('王浩然');
    expect(within(wang).getByRole('cell', { name: '未开考' })).toBeInTheDocument();
    for (const cell of within(wang).getAllByRole('cell', { name: '0' })) {
      expect(marked(cell)).toContain('text-danger-fg');
    }

    await user.click(groupSelect);
    await user.click(screen.getByRole('option', { name: '计科 2402' }));
    expect(screen.queryByRole('cell', { name: '陈思远' })).toBeNull();
    expect(screen.getByRole('cell', { name: '王浩然' })).toBeInTheDocument();
    expect(dataRowCount()).toBe(1);
    expect(footerText()).toBe('1 人');

    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    await user.click(screen.getByRole('option', { name: '全部用户组' }));
    expect(screen.getByRole('cell', { name: '陈思远' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '王浩然' })).toBeInTheDocument();

    const search = screen.getByPlaceholderText('学号或姓名');
    await user.type(search, '2401010112');
    expect(screen.getByRole('cell', { name: '陈思远' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '王浩然' })).toBeNull();
    expect(footerText()).toBe('1 人');
    await user.clear(search);
    expect(screen.getByRole('cell', { name: '王浩然' })).toBeInTheDocument();
    await user.type(search, '王浩然');
    expect(screen.queryByRole('cell', { name: '陈思远' })).toBeNull();
    expect(screen.getByRole('cell', { name: '王浩然' })).toBeInTheDocument();
    expect(footerText()).toBe('1 人');
  });

  it('exports a csv blob that starts with a bom', async () => {
    const { user } = await openExam();
    await user.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(capturedBlobs.length).toBeGreaterThan(0);
    const blob = capturedBlobs.at(-1);
    if (!(blob instanceof Blob)) throw new TypeError('export blob');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes[3]).not.toBe(0xef);
    const body = new TextDecoder().decode(bytes.subarray(3));
    expect(body.startsWith('学号')).toBe(true);
    expect(body).toContain('2401010112');
    expect(body).toContain('2401020203');
    const anchor = clickedAnchors.at(-1);
    expect(anchor?.getAttribute('download')).toBe('期中整卷-成绩.csv');
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('points exam actions at the existing pages', async () => {
    await openExam();
    const grading = screen.getByRole('link', { name: '主观题阅卷' });
    const rescore = screen.getByRole('link', { name: '批量改分' });
    const board = screen.getByRole('link', { name: '查看排行榜' });
    expect(grading).toHaveAttribute('href', `/manage/grading/${EXAM_ID}`);
    expect(rescore).toHaveAttribute('href', `/contest/${EXAM_ID}/management`);
    expect(board).toHaveAttribute('href', `/contest/${EXAM_ID}/scoreboard`);
    expect(grading).toHaveAttribute('data-variant', 'secondary');
    expect(rescore).toHaveAttribute('data-variant', 'secondary');
    expect(board).toHaveAttribute('data-variant', 'secondary');
  });

  it('shows a late submit and omits exam-only actions', async () => {
    const Tab = await loadGradesTab();
    const fetchMock = installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_ID}/participants`) {
        return jsonResponse({
          participants: [
            participant({
              uid: 2,
              uname: 'zhao',
              studentId: '240003',
              realName: '赵一鸣',
              groupIds: ['g1'],
              lastSubmitAt: '2026-10-21T02:00:00.000Z',
              late: true,
            }),
            participant({
              uid: 3,
              uname: 'lin',
              studentId: '240001',
              realName: '林雨桐',
              groupIds: ['g1'],
            }),
          ],
          groups: [{ id: 'g1', name: '计科 2401' }],
        });
      }
      if (url.pathname === `/homework/${HOMEWORK_ID}/scoreboard`) {
        return jsonResponse({
          rows: [
            [
              { type: 'rank', value: 'Rank' },
              { type: 'user', value: 'User' },
              { type: 'total_score', value: 'Score' },
              { type: 'time', value: 'Total Time' },
              { type: 'problem', value: 'A', raw: 302 },
            ],
            [
              { type: 'rank', value: '1' },
              { type: 'user', value: 'zhao', raw: 2 },
              { type: 'string', value: 8 },
              { type: 'time', value: '00:20' },
              { type: 'record', value: '8', score: 8, hover: '' },
            ],
          ],
        });
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderGrades(Tab, workbench({
      type: 'homework',
      rule: 'homework',
      id: HOMEWORK_ID,
      title: '栈与队列作业',
      paper: {
        problems: [problem(302, 'programming', 10)],
        stages: null,
        examPaperQuotas: null,
      },
      canGrade: true,
      link: links({
        studentView: `/homework/${HOMEWORK_ID}`,
        scoreboard: `/homework/${HOMEWORK_ID}/scoreboard`,
        grading: `/manage/grading/${HOMEWORK_ID}`,
        files: `/homework/${HOMEWORK_ID}/file`,
      }),
    }));

    expect(await screen.findByRole('cell', { name: '赵一鸣' })).toBeInTheDocument();
    expect(new Set(paths(fetchMock))).toEqual(new Set([
      `/teach/homework/${HOMEWORK_ID}/participants`,
      `/homework/${HOMEWORK_ID}/scoreboard`,
    ]));
    expect(within(rowByName('赵一鸣')).getByText(/迟交/)).toBeInTheDocument();
    expect(within(rowByName('林雨桐')).getByText('未提交')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看排行榜' })).toHaveAttribute('href', `/homework/${HOMEWORK_ID}/scoreboard`);
    expect(screen.queryByRole('link', { name: '主观题阅卷' })).toBeNull();
    expect(screen.queryByRole('link', { name: '批量改分' })).toBeNull();
    expect(screen.queryByRole('button', { name: '批量改分' })).toBeNull();
  });

  it('loads the roster as progress and does not request a scoreboard', async () => {
    const Tab = await loadGradesTab();
    const fetchMock = installFetch((url) => {
      if (url.pathname === `/problem-sets/${PRACTICE_ID}/roster`) {
        return jsonResponse({
          members: [
            {
              uid: 10,
              uname: 'chen',
              realName: '陈思远',
              studentId: '2401010112',
              groups: ['计科 2401'],
              groupIds: ['g1'],
              done: 0,
              total: 2,
              completedPids: [],
            },
            {
              uid: 11,
              uname: 'wang',
              realName: '王浩然',
              studentId: '2401020203',
              groups: ['计科 2402'],
              groupIds: ['g2'],
              done: 2,
              total: 2,
              completedPids: [101, 102],
            },
          ],
          membersTruncated: false,
          canViewRoster: true,
          rosterProblems: [],
        });
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderGrades(Tab, workbench({
      type: 'practice',
      rule: 'problem_set',
      id: PRACTICE_ID,
      title: '链表专项',
      paper: {
        problems: [problem(101, 'programming', null), problem(102, 'programming', null)],
        stages: [
          { id: 1, title: '链表基础', requireIds: [], pids: [101] },
          { id: 2, title: '综合', requireIds: [], pids: [102] },
        ],
        examPaperQuotas: null,
      },
      canGrade: false,
      link: links({
        studentView: `/problem-sets/${PRACTICE_ID}`,
        files: `/problem-sets/${PRACTICE_ID}/file`,
      }),
    }));

    expect(await screen.findByRole('cell', { name: '陈思远' })).toBeInTheDocument();
    expect(paths(fetchMock).every((path) => path === `/problem-sets/${PRACTICE_ID}/roster`)).toBe(true);
    expect(paths(fetchMock).length).toBeGreaterThan(0);
    expect(headerTexts()).toEqual(['学号', '姓名', '用户组', '当前阶段', '完成', '进度']);
    expect(screen.queryByRole('columnheader', { name: '最近提交' })).toBeNull();
    expect(within(rowByName('陈思远')).getByText('链表基础')).toBeInTheDocument();
    expect(within(rowByName('陈思远')).getByText('0 / 2')).toBeInTheDocument();
    expect(within(rowByName('王浩然')).getByText('综合')).toBeInTheDocument();
    expect(within(rowByName('王浩然')).getByText('2 / 2')).toBeInTheDocument();
    const fresh = within(rowByName('陈思远')).getByRole('progressbar');
    const done = within(rowByName('王浩然')).getByRole('progressbar');
    expect(fresh).toHaveAttribute('aria-valuenow', '0');
    expect(done).toHaveAttribute('aria-valuenow', '100');
    const doneFill = done.querySelector('div');
    const freshFill = fresh.querySelector('div');
    if (!(doneFill instanceof HTMLElement) || !(freshFill instanceof HTMLElement)) throw new TypeError('missing progress fill');
    expect(doneFill.className).toContain('bg-success');
    expect(freshFill.className).not.toContain('bg-success');
    expect(screen.queryByRole('link', { name: '查看排行榜' })).toBeNull();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeInTheDocument();
    expect(footerText()).toBe('2 人');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    expect(screen.getByRole('option', { name: '计科 2401' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '计科 2402' })).toBeInTheDocument();
  });

  it('shows the server message and retries', async () => {
    const Tab = await loadGradesTab();
    let participantCalls = 0;
    installFetch((url) => {
      if (url.pathname === `/teach/exam/${EXAM_ID}/participants`) {
        participantCalls += 1;
        if (participantCalls === 1) return hydroError(SERVER_MESSAGE);
        return jsonResponse(examParticipants());
      }
      if (url.pathname === `/contest/${EXAM_ID}/scoreboard`) return jsonResponse(examBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderGrades(Tab, examPayload());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain(SERVER_MESSAGE);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('cell', { name: '陈思远' })).toBeInTheDocument();
    expect(participantCalls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
