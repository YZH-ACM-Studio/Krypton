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
const DOT = '\u00B7';
const DASH = '\u2014';

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

const initialReview = {
  rule: { enabled: true, minutes: 8, minProblems: 4 }, revision: 0,
  signals: { 10: { passed: 4, total: 6, roundNo: 2, seconds: 312, fromStart: true } },
};

function installFetch(
  respond: (url: URL) => Response | Promise<Response>,
  rapidReview = (_request?: RequestInit) => jsonResponse(initialReview),
): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input, init) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/rapid-passes')) return Promise.resolve(rapidReview(init));
      return Promise.resolve(respond(url));
    },
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
    urls: { records: '/record', home: '/' } as KryptonBootstrap['urls'],
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

function problem(docId: number, kind: ProblemKind, score: number | null, title = `题目 ${docId}`): TeachPaper['problems'][number] {
  return {
    docId,
    pid: `P${docId}`,
    title,
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
  problems?: Record<string, { submits: number; late: boolean }>;
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
    problems: partial.problems ?? {},
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
        problems: { 202: { submits: 1, late: false } },
      }),
      participant({
        uid: 11,
        uname: 'wang',
        studentId: '2401020203',
        realName: '王浩然',
        groupIds: ['g2'],
        problems: { 202: { submits: 2, late: false } },
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
    pdict: { 202: { nAccept: 1, nSubmit: 5 } },
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
        { type: 'record', value: '5', score: 5, hover: '', problemCounts: { nAccept: 1, nSubmit: 3 } },
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

function headerText(pattern: RegExp): string {
  return screen.getByRole('columnheader', { name: pattern }).textContent ?? '';
}

function fullStat(got: number, total: number, average: string): string {
  return `满分 ${got}/${total} ${DOT} 均 ${average}`;
}

function rowByName(name: string): HTMLTableRowElement {
  const cell = screen.getByRole('cell', { name: new RegExp(name) });
  const row = cell.closest('tr');
  if (!(row instanceof HTMLTableRowElement)) throw new TypeError(`missing row ${name}`);
  return row;
}

function stickyLeft(node: Element | null | undefined): boolean {
  const markup = node instanceof HTMLElement ? node.innerHTML : '';
  const blob = `${node?.className ?? ''} ${markup}`;
  return blob.includes('sticky') && blob.includes('left-0');
}

function painted(cell: HTMLElement, token: string): string {
  const nodes = [cell, ...cell.querySelectorAll('*')];
  const found = nodes.find((node) => node instanceof HTMLElement && node.className.split(/\s+/).includes(token));
  return found?.textContent ?? '';
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

async function openExam(rapidReview?: (init?: RequestInit) => Response): Promise<Opened> {
  const Tab = await loadGradesTab();
  const user = userEvent.setup();
  const fetchMock = installFetch((url) => {
    if (url.pathname === `/teach/exam/${EXAM_ID}/participants`) return jsonResponse(examParticipants());
    if (url.pathname === `/contest/${EXAM_ID}/scoreboard`) return jsonResponse(examBoard());
    return hydroError(`未知请求 ${url.pathname}`, 404);
  }, rapidReview);
  renderGrades(Tab, examPayload());
  await screen.findByRole('cell', { name: /陈思远/ });
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

  it('shows the speed flag and its evidence on the matching student only', async () => {
    await openExam();
    const badge = await screen.findByText('短时多题通过 · 待核查');
    expect(badge.closest('tr')).toHaveTextContent('陈思远');
    expect(badge.closest('tr')).toHaveTextContent('第2轮 · 开始后5分12秒通过 4/6 题');
    expect(screen.getByRole('cell', { name: /王浩然/ })).not.toHaveTextContent('待核查');
  });

  it('saves the teacher threshold on blur and updates the flag without changing the grade row', async () => {
    const { user, fetchMock } = await openExam((request) => {
      if (request?.method !== 'POST') return jsonResponse(initialReview);
      const body: unknown = JSON.parse(String(request.body));
      expect(body).toEqual({ revision: 0, rule: { enabled: true, minutes: 3, minProblems: 4 } });
      return jsonResponse({ rule: { ...initialReview.rule, minutes: 3 }, revision: 1, signals: {} });
    });
    await screen.findByText('短时多题通过 · 待核查');
    await user.click(screen.getByText('作答速度提示'));
    const input = screen.getByRole('spinbutton', { name: '时间窗口（分钟）' });
    await user.clear(input);
    await user.type(input, '3');
    await user.tab();
    expect(await screen.findByText('3 分钟内至少通过 4 题')).toBeInTheDocument();
    expect(screen.queryByText('短时多题通过 · 待核查')).toBeNull();
    expect(screen.getByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('filters by group and by student id or name', async () => {
    const { user, fetchMock } = await openExam();
    expect(new Set(paths(fetchMock))).toEqual(new Set([
      `/teach/exam/${EXAM_ID}/participants`,
      `/contest/${EXAM_ID}/scoreboard`,
      `/teach/exam/${EXAM_ID}/rapid-passes`,
    ]));
    expect(headerText(/单选题/)).toContain('2-1~2-1');
    expect(headerTexts()[0]).toContain('学生');
    expect(headerTexts().some((text) => text.includes('交卷时间'))).toBe(true);
    expect(screen.queryByRole('columnheader', { name: '状态' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '学号' })).toBeNull();
    expect(headerText(/2-1~2-1/)).toContain(fullStat(1, 2, '2.5'));
    expect(headerText(/2-1~2-1/)).toContain('全场通过 1 · 提交 5 次');
    expect(screen.getByPlaceholderText('学号或姓名')).toBeInTheDocument();
    const groupSelect = screen.getByRole('combobox', { name: '用户组' });
    expect(groupSelect).toHaveTextContent('全部用户组');
    expect(groupSelect).toHaveClass('w-48');
    const table = document.querySelector('[data-slot="data-table"] table');
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
    expect(document.querySelector('[data-slot="data-table"]')?.getAttribute('data-mobile')).toBe('scroll');
    const firstHeader = screen.getAllByRole('columnheader')[0];
    expect(stickyLeft(firstHeader)).toBe(true);
    expect(dataRowCount()).toBe(2);
    expect(footerText()).toBe('2 人');
    expect(marked(peopleFooter())).toContain('text-sm');
    expect(marked(peopleFooter())).toContain('text-fg-subtle');

    const chen = rowByName('陈思远');
    expect(chen.textContent).toContain('2401010112');
    expect(within(chen).getByRole('link', { name: /陈思远/ })).toHaveAttribute('href', `/teach/exam/${EXAM_ID}?tab=records&uidOrName=10`);
    expect(stickyLeft(chen.querySelector('td'))).toBe(true);
    const chenScore = within(chen).getByRole('cell', { name: /3 次/ });
    expect(chenScore.textContent).toContain('5');
    expect(painted(chenScore, 'text-success-fg')).toContain('5');
    expect(chenScore.textContent).not.toContain('迟');
    expect(within(chen).getByRole('cell', { name: /15:40/ })).toBeInTheDocument();
    const wang = rowByName('王浩然');
    const wangScore = within(wang).getByRole('cell', { name: /2 次/ });
    expect(wangScore.textContent).toContain('0');
    expect(painted(wangScore, 'text-danger-fg')).toContain('0');
    expect(wang.textContent).not.toContain('未开考');

    await user.click(groupSelect);
    await user.click(screen.getByRole('option', { name: '计科 2402' }));
    expect(screen.queryByRole('cell', { name: /陈思远/ })).toBeNull();
    expect(screen.getByRole('cell', { name: /王浩然/ })).toBeInTheDocument();
    expect(headerText(/2-1~2-1/)).toContain(fullStat(0, 1, '0.0'));
    expect(dataRowCount()).toBe(1);
    expect(footerText()).toBe('1 人');

    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    await user.click(screen.getByRole('option', { name: '全部用户组' }));
    expect(screen.getByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /王浩然/ })).toBeInTheDocument();

    const search = screen.getByPlaceholderText('学号或姓名');
    await user.type(search, '2401010112');
    expect(screen.getByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /王浩然/ })).toBeNull();
    expect(headerText(/2-1~2-1/)).toContain(fullStat(1, 1, '5.0'));
    expect(footerText()).toBe('1 人');
    await user.clear(search);
    expect(screen.getByRole('cell', { name: /王浩然/ })).toBeInTheDocument();
    await user.type(search, '王浩然');
    expect(screen.queryByRole('cell', { name: /陈思远/ })).toBeNull();
    expect(screen.getByRole('cell', { name: /王浩然/ })).toBeInTheDocument();
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
    expect(body.split('\n')[0]).toBe('学生,单选题(2-1~2-1),总分,交卷时间');
    expect(body).toContain('2401010112');
    expect(body).toContain('2401020203');
    expect(body).not.toContain('次');
    expect(body).not.toContain('状态');
    const anchor = clickedAnchors.at(-1);
    expect(anchor?.getAttribute('download')).toBe('期中整卷-成绩.csv');
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('offers grading inside the workbench alongside existing management actions', async () => {
    await openExam();
    const grading = screen.getByRole('tab', { name: '批改' });
    const rescore = screen.getByRole('link', { name: '批量改分' });
    const board = screen.getByRole('link', { name: '查看排行榜' });
    expect(grading).toHaveAttribute('aria-selected', 'false');
    expect(rescore).toHaveAttribute('href', `/contest/${EXAM_ID}/management`);
    expect(board).toHaveAttribute('href', `/contest/${EXAM_ID}/scoreboard`);
    expect(screen.queryByRole('link', { name: '主观题阅卷' })).toBeNull();
    expect(rescore).toHaveAttribute('data-variant', 'secondary');
    expect(board).toHaveAttribute('data-variant', 'secondary');
  });

  it('shows the homework matrix with late marks and filtered full-score stats', async () => {
    const trueFalse = Array.from({ length: 10 }, (_, index) => problem(101 + index, 'true_false', 2));
    const docIds = [601, ...trueFalse.map((item) => item.docId)];
    const zhaoFacts: Record<string, { submits: number; late: boolean }> = {};
    for (let docId = 101; docId <= 110; docId += 1) {
      let submits = 1;
      if (docId === 108) submits = 2;
      if (docId === 109) submits = 4;
      zhaoFacts[String(docId)] = { submits, late: docId === 109 || docId === 110 };
    }
    zhaoFacts['601'] = { submits: 3, late: false };
    const chenFacts: Record<string, { submits: number; late: boolean }> = {};
    for (let docId = 101; docId <= 110; docId += 1) chenFacts[String(docId)] = { submits: 1, late: false };
    chenFacts['601'] = { submits: 2, late: false };
    const scoreLine = (scores: Record<number, string>) => docIds.map((docId) => ({
      type: 'record',
      value: scores[docId] ?? '0',
      score: Number(scores[docId] ?? 0),
      hover: '',
    }));
    const zhaoScores: Record<number, string> = { 601: '25' };
    const chenScores: Record<number, string> = { 601: '0' };
    for (let docId = 101; docId <= 110; docId += 1) {
      zhaoScores[docId] = docId <= 107 ? '2' : '0';
      chenScores[docId] = '2';
    }
    const Tab = await loadGradesTab();
    const user = userEvent.setup();
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
              late: true,
              problems: zhaoFacts,
            }),
            participant({
              uid: 1,
              uname: 'chen',
              studentId: '240002',
              realName: '陈思远',
              groupIds: ['g1'],
              problems: chenFacts,
            }),
            participant({
              uid: 3,
              uname: 'lin',
              studentId: '240001',
              realName: '林雨桐',
              groupIds: ['g2'],
            }),
          ],
          groups: [
            { id: 'g1', name: '计科 2401' },
            { id: 'g2', name: '计科 2402' },
          ],
        });
      }
      if (url.pathname === `/homework/${HOMEWORK_ID}/scoreboard`) {
        return jsonResponse({
          rows: [
            [
              { type: 'rank', value: 'Rank' },
              { type: 'user', value: 'User' },
              { type: 'total_score', value: 'Score' },
              ...docIds.map((docId) => ({ type: 'problem', value: String(docId), raw: docId })),
            ],
            [
              { type: 'rank', value: '' },
              { type: 'user', value: 'zhao', raw: 2 },
              { type: 'string', value: 39 },
              ...scoreLine(zhaoScores),
            ],
            [
              { type: 'rank', value: '' },
              { type: 'user', value: 'chen', raw: 1 },
              { type: 'string', value: 20 },
              ...scoreLine(chenScores),
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
        problems: [problem(601, 'function', 25, '删除倒数第 k 个'), ...trueFalse],
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

    expect(await screen.findByRole('cell', { name: /赵一鸣/ })).toBeInTheDocument();
    expect(new Set(paths(fetchMock))).toEqual(new Set([
      `/teach/homework/${HOMEWORK_ID}/participants`,
      `/homework/${HOMEWORK_ID}/scoreboard`,
      `/teach/homework/${HOMEWORK_ID}/rapid-passes`,
    ]));
    const texts = headerTexts();
    const judgeAt = texts.findIndex((text) => text.includes('1-1~1-10'));
    const functionAt = texts.findIndex((text) => text.includes('6-1'));
    const totalAt = texts.findIndex((text) => text.includes('总分'));
    const lateAt = texts.findIndex((text) => text.includes('迟交'));
    expect(texts[0]).toContain('学生');
    expect(judgeAt).toBeGreaterThan(0);
    expect(functionAt).toBeGreaterThan(judgeAt);
    expect(totalAt).toBeGreaterThan(functionAt);
    expect(lateAt).toBe(texts.length - 1);
    expect(texts.filter((text) => text.includes('1-1') || text.includes('1-2')).length).toBe(1);
    expect(headerText(/6-1/)).toContain('删除倒数第 k 个');
    expect(headerText(/6-1/)).not.toContain('~');
    expect(headerText(/1-1~1-10/)).toContain(fullStat(1, 3, '11.3'));
    expect(headerText(/6-1/)).toContain(fullStat(1, 3, '8.3'));

    const zhao = rowByName('赵一鸣');
    const zhaoJudge = within(zhao).getByRole('cell', { name: /14 次/ });
    expect(zhaoJudge.textContent).toContain('14');
    expect(zhaoJudge.textContent).toContain(` ${DOT} 迟`);
    expect(painted(zhaoJudge, 'text-fg')).toContain('14');
    expect(painted(zhaoJudge, 'text-success-fg')).toBe('');
    expect(painted(zhaoJudge, 'text-danger-fg')).toBe('');
    expect(painted(zhaoJudge, 'text-warning-fg')).toContain('迟');
    const zhaoFunction = within(zhao).getByRole('cell', { name: /3 次/ });
    expect(zhaoFunction.textContent).toContain('25');
    expect(zhaoFunction.textContent).not.toContain('迟');
    expect(painted(zhaoFunction, 'text-success-fg')).toContain('25');
    expect(within(zhao).getByRole('cell', { name: /^2$/ })).toBeInTheDocument();

    const chen = rowByName('陈思远');
    const chenJudge = within(chen).getByRole('cell', { name: /10 次/ });
    expect(chenJudge.textContent).not.toContain('迟');
    expect(painted(chenJudge, 'text-success-fg')).toContain('20');
    const chenFunction = within(chen).getByRole('cell', { name: /2 次/ });
    expect(painted(chenFunction, 'text-danger-fg')).toContain('0');

    const lin = rowByName('林雨桐');
    const blanks = within(lin).getAllByRole('cell').filter((cell) => (cell.textContent ?? '').includes(DASH));
    expect(blanks.length).toBeGreaterThan(0);
    for (const cell of blanks) {
      expect(cell.textContent).not.toContain('次');
      expect(painted(cell, 'text-fg-subtle')).toContain(DASH);
    }
    expect(footerText()).toBe('3 人');

    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    await user.click(screen.getByRole('option', { name: '计科 2402' }));
    expect(headerText(/1-1~1-10/)).toContain(fullStat(0, 1, '0.0'));
    expect(footerText()).toBe('1 人');
    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    await user.click(screen.getByRole('option', { name: '计科 2401' }));
    expect(headerText(/1-1~1-10/)).toContain(fullStat(1, 2, '17.0'));
    expect(headerText(/6-1/)).toContain(fullStat(1, 2, '12.5'));

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
          rosterProblems: [101, 102],
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
    expect(await screen.findByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expect(participantCalls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
