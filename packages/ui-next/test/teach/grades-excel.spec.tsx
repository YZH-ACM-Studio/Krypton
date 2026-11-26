// grades-load.ts is the new module and may be absent until the export lands.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { GradesTab } from '../../src/pages/teach/tabs/grades.tsx';
import type { GradeColumn, GradeRow } from '../../src/pages/teach/grades-model.ts';
import type { TeachPaper, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';

const gradeLoaders = import.meta.glob('../../src/pages/teach/grades-load.ts');
const GRADES_LOAD_SOURCE = 'src/pages/teach/grades-load.ts';

const downloadBlob = vi.hoisted(() => vi.fn<(filename: string, blob: Blob) => void>());
const buildXlsx = vi.hoisted(() => vi.fn<(sheets: readonly unknown[]) => Promise<Blob>>());

vi.mock('@/lib/download-zip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/download-zip')>();
  return { ...actual, downloadBlob };
});

vi.mock('@/lib/xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xlsx')>();
  return { ...actual, buildXlsx };
});

const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d53';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d52';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d55';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d54';
const OI_ID = '64b7c3a2e4b0f96d1a2c3d56';
const DASH = '\u2014';
const HOMEWORK_TITLE = '循环作业';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
type SheetCell = string | number | null;
type GradesSheet = (title: string, columns: GradeColumn[], rows: GradeRow[]) => unknown;

interface BuiltSheet {
  name: string;
  rows: SheetCell[][];
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
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

function gradesSheetOf(value: unknown): GradesSheet {
  if (typeof value !== 'function') throw new TypeError('gradesSheet must be a function');
  return value as GradesSheet;
}

function cellValue(value: unknown, where: string): SheetCell {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new TypeError(`${where} must be text, a number, or null`);
}

function readSheet(value: unknown): BuiltSheet {
  if (typeof value !== 'object' || value === null) throw new TypeError('grades sheet is missing');
  const name = Reflect.get(value, 'name');
  const rows = Reflect.get(value, 'rows');
  if (typeof name !== 'string') throw new TypeError('grades sheet name is missing');
  if (!Array.isArray(rows)) throw new TypeError('grades sheet rows are missing');
  return {
    name,
    rows: rows.map((row, rowIndex) => {
      if (!Array.isArray(row)) throw new TypeError(`grades sheet row ${rowIndex + 1} is not an array`);
      return row.map((cell, columnIndex) => cellValue(cell, `grades sheet row ${rowIndex + 1} column ${columnIndex + 1}`));
    }),
  };
}

function readBuiltSheets(value: unknown): BuiltSheet[] {
  if (!Array.isArray(value)) throw new TypeError('buildXlsx expected a list of sheets');
  return value.map((sheet) => readSheet(sheet));
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
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

function installHomeworkFetch(): void {
  installFetch((url) => {
    if (url.pathname === `/teach/homework/${HOMEWORK_ID}/participants`) return jsonResponse(homeworkParticipants());
    if (url.pathname === `/homework/${HOMEWORK_ID}/scoreboard`) return jsonResponse(homeworkBoard());
    return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
  });
}

function installFetch(respond: (url: URL) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/rapid-passes')) {
        return Promise.resolve(jsonResponse({
          rule: { enabled: true, minutes: 8, minProblems: 4 }, revision: 0,
          signals: { 2: { roundNo: 1, passed: 4, total: 4, seconds: 240, fromStart: true } },
        }));
      }
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
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function renderGrades(payload: TeachWorkbenchPayload) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <GradesTab payload={payload} onNavigateTab={() => undefined} />
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
        groupNames: ['计科 2401'],
        schoolNames: [],
        boundStudentCount: 1,
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
      participantCount: 1,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: 1,
      problemStats: null,
    },
    capabilities: {
      canDelete: false,
      canShare: false,
      canGrade: false,
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
  problems?: Record<string, { submits: number; late: boolean }>;
}) {
  return {
    uid: partial.uid,
    uname: partial.uname,
    studentId: partial.studentId,
    realName: partial.realName,
    groupIds: partial.groupIds,
    attended: true,
    startAt: null,
    finalizedAt: null,
    lastSubmitAt: null,
    late: false,
    problems: partial.problems ?? {},
  };
}

function homeworkPayload(): TeachWorkbenchPayload {
  return workbench({
    type: 'homework',
    rule: 'homework',
    id: HOMEWORK_ID,
    title: HOMEWORK_TITLE,
    paper: {
      problems: [problem(101, 'true_false', 95, '判断循环')],
      stages: null,
      examPaperQuotas: null,
    },
    link: links({
      studentView: `/homework/${HOMEWORK_ID}`,
      scoreboard: `/homework/${HOMEWORK_ID}/scoreboard`,
      files: `/homework/${HOMEWORK_ID}/file`,
    }),
  });
}

function homeworkParticipants() {
  return {
    participants: [
      participant({
        uid: 2,
        uname: 'zhao',
        studentId: '240003',
        realName: '赵一鸣',
        groupIds: ['g1'],
        problems: { 101: { submits: 1, late: false } },
      }),
      participant({
        uid: 1,
        uname: 'chen',
        studentId: '240002',
        realName: '陈思远',
        groupIds: ['g1'],
        problems: { 101: { submits: 1, late: false } },
      }),
    ],
    groups: [{ id: 'g1', name: '计科 2401' }],
  };
}

function homeworkBoard() {
  return {
    rows: [
      [
        { type: 'rank', value: 'Rank' },
        { type: 'user', value: 'User' },
        { type: 'total_score', value: 'Score' },
        { type: 'problem', value: '101', raw: 101 },
      ],
      [
        { type: 'rank', value: '' },
        { type: 'user', value: 'zhao', raw: 2 },
        { type: 'string', value: 95 },
        { type: 'record', value: '95', score: 95, hover: '' },
      ],
      [
        { type: 'rank', value: '' },
        { type: 'user', value: 'chen', raw: 1 },
        { type: 'string', value: 0 },
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
    link: links({
      studentView: `/contest/${EXAM_ID}`,
      scoreboard: `/contest/${EXAM_ID}/scoreboard`,
      files: `/contest/${EXAM_ID}/management`,
    }),
  });
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
        problems: { 202: { submits: 1, late: false } },
      }),
    ],
    groups: [{ id: 'g1', name: '计科 2401' }],
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
    ],
  };
}

function contestPayload(type: 'acm' | 'oi', id: string, title: string): TeachWorkbenchPayload {
  return workbench({
    type,
    rule: type,
    id,
    title,
    paper: {
      problems: [problem(101, 'programming', type === 'oi' ? 100 : null)],
      stages: null,
      examPaperQuotas: null,
    },
    link: links({
      studentView: `/contest/${id}`,
      scoreboard: `/contest/${id}/scoreboard`,
      files: `/contest/${id}`,
    }),
  });
}

function contestParticipants() {
  return {
    participants: [
      participant({
        uid: 10,
        uname: 'chen',
        studentId: '2401010112',
        realName: '陈思远',
        groupIds: ['g1'],
      }),
    ],
    groups: [{ id: 'g1', name: '计科 2401' }],
  };
}

function acmBoard() {
  return {
    rows: [
      [
        { type: 'rank', value: '#' },
        { type: 'user', value: 'User' },
        { type: 'solved', value: 'Solved\nTotal Time' },
        { type: 'problem', value: 'A', raw: 101 },
      ],
      [
        { type: 'rank', value: '1' },
        { type: 'user', value: 'chen', raw: 10 },
        { type: 'time', value: '1\n12' },
        { type: 'record', value: '+', score: 100, hover: '' },
      ],
    ],
  };
}

function oiBoard() {
  return {
    rows: [
      [
        { type: 'rank', value: '#' },
        { type: 'user', value: 'User' },
        { type: 'total_score', value: 'Score' },
        { type: 'problem', value: 'A', raw: 101 },
      ],
      [
        { type: 'rank', value: '1' },
        { type: 'user', value: 'chen', raw: 10 },
        { type: 'string', value: 95 },
        { type: 'record', value: '95', score: 95, hover: '' },
      ],
    ],
  };
}

function practicePayload(): TeachWorkbenchPayload {
  return workbench({
    type: 'practice',
    rule: 'problem_set',
    id: PRACTICE_ID,
    title: '链表专项',
    paper: {
      problems: [problem(101, 'programming', null)],
      stages: [{ id: 1, title: '链表基础', requireIds: [], pids: [101] }],
      examPaperQuotas: null,
    },
    link: links({
      studentView: `/problem-sets/${PRACTICE_ID}`,
      files: `/problem-sets/${PRACTICE_ID}/file`,
    }),
  });
}

function practiceRoster() {
  return {
    members: [
      {
        uid: 10,
        uname: 'chen',
        realName: '陈思远',
        studentId: '2401010112',
        groups: ['计科 2401'],
        groupIds: ['g1'],
        done: 0,
        total: 1,
        completedPids: [],
      },
    ],
    membersTruncated: false,
    rosterProblems: [101],
  };
}

function dataRowCount(): number {
  return screen.getAllByRole('row').length - 1;
}

function expectExcelButton() {
  const csv = screen.getByRole('button', { name: '导出 CSV' });
  const excel = screen.getByRole('button', { name: '导出 Excel' });
  expect(excel).toHaveAttribute('data-variant', 'secondary');
  expect(csv.compareDocumentPosition(excel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

function expectNoExcelButton() {
  expect(screen.getByRole('button', { name: '导出 CSV' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '导出 Excel' })).toBeNull();
}

function gradeRow(partial: {
  key: string;
  studentId: string;
  name: string;
  cells: Record<string, string>;
}): GradeRow {
  return {
    key: partial.key,
    studentId: partial.studentId,
    name: partial.name,
    groupNames: partial.cells.group ?? '',
    groupIds: [],
    searchText: '',
    cells: partial.cells,
    tones: {},
    attempts: {},
  };
}

describe('teach grades excel export', () => {
  beforeEach(() => {
    downloadBlob.mockReset();
    buildXlsx.mockReset();
    buildXlsx.mockResolvedValue(new Blob(['grades-xlsx']));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports the filtered homework grades as one excel sheet', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['grades-xlsx']);
    buildXlsx.mockResolvedValue(blob);
    installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_ID}/participants`) return jsonResponse(homeworkParticipants());
      if (url.pathname === `/homework/${HOMEWORK_ID}/scoreboard`) return jsonResponse(homeworkBoard());
      return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
    });
    renderGrades(homeworkPayload());

    expect(await screen.findByRole('cell', { name: /赵一鸣/ })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('学号或姓名'), '赵一鸣');
    expect(screen.queryByRole('cell', { name: /陈思远/ })).toBeNull();
    expect(screen.getByText('1 人')).toBeInTheDocument();
    const filteredCount = dataRowCount();
    expect(filteredCount).toBe(1);

    expectExcelButton();
    await user.click(screen.getByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith(`${HOMEWORK_TITLE}-成绩.xlsx`, blob);
    expect(buildXlsx).toHaveBeenCalledTimes(1);
    const sheets = readBuiltSheets(buildXlsx.mock.calls[0]?.[0]);
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    if (!sheet) throw new TypeError('missing grades sheet');
    expect(sheet.rows.length).toBe(filteredCount + 1);
    expect(sheet).toEqual({
      name: HOMEWORK_TITLE,
      rows: [
        ['学生', '判断题(1-1~1-1)', '总分', '迟交'],
        ['赵一鸣 240003', 95, 95, 0],
      ],
    });
  });

  it('shows excel export on an exam grades tab', async () => {
    installFetch((url) => {
      if (url.pathname === `/teach/exam/${EXAM_ID}/participants`) return jsonResponse(examParticipants());
      if (url.pathname === `/contest/${EXAM_ID}/scoreboard`) return jsonResponse(examBoard());
      return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
    });
    renderGrades(examPayload());
    expect(await screen.findByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expectExcelButton();
  });

  it('does not offer excel export for acm', async () => {
    installFetch((url) => {
      if (url.pathname === `/teach/acm/${ACM_ID}/participants`) return jsonResponse(contestParticipants());
      if (url.pathname === `/contest/${ACM_ID}/scoreboard`) return jsonResponse(acmBoard());
      return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
    });
    renderGrades(contestPayload('acm', ACM_ID, '新生赛'));
    expect(await screen.findByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expectNoExcelButton();
  });

  it('does not offer excel export for practice or oi', async () => {
    installFetch((url) => {
      if (url.pathname === `/problem-sets/${PRACTICE_ID}/roster`) return jsonResponse(practiceRoster());
      return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
    });
    const practice = renderGrades(practicePayload());
    expect(await screen.findByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expectNoExcelButton();
    practice.unmount();

    installFetch((url) => {
      if (url.pathname === `/teach/oi/${OI_ID}/participants`) return jsonResponse(contestParticipants());
      if (url.pathname === `/contest/${OI_ID}/scoreboard`) return jsonResponse(oiBoard());
      return jsonResponse({ error: { message: `未知请求 ${url.pathname}` } }, 404);
    });
    renderGrades(contestPayload('oi', OI_ID, 'OI 选拔'));
    expect(await screen.findByRole('cell', { name: /陈思远/ })).toBeInTheDocument();
    expectNoExcelButton();
  });

  it('maps grade columns to a sheet and turns numeric text into numbers', async () => {
    const imported = await loadModule(gradeLoaders, GRADES_LOAD_SOURCE);
    expect(typeof readField(imported, 'loadGrades'), 'loadGrades').toBe('function');
    const gradesSheet = gradesSheetOf(readField(imported, 'gradesSheet'));
    const columns: GradeColumn[] = [
      { key: 'studentId', header: '学号', align: 'left' },
      { key: 'name', header: '姓名', align: 'left' },
      { key: 'group', header: '用户组', align: 'left' },
      { key: 'total', header: '总分', align: 'right' },
      { key: 'status', header: '状态', align: 'left' },
    ];
    const rows = [
      gradeRow({
        key: 'a',
        studentId: '2401',
        name: '张三',
        cells: {
          studentId: '2401',
          name: '张三',
          group: '计科 2401',
          total: '95',
          status: '已交卷',
        },
      }),
      gradeRow({
        key: 'b',
        studentId: '',
        name: '李四',
        cells: {
          studentId: '',
          name: '李四',
          group: '',
          total: '87.5',
          status: DASH,
        },
      }),
      gradeRow({
        key: 'c',
        studentId: 'S2403',
        name: '王五',
        cells: {
          studentId: 'S2403',
          name: '王五',
          group: '计科 2402',
          total: '未提交',
          status: '',
        },
      }),
    ];

    const sheet = readSheet(gradesSheet('期中整卷', columns, rows));
    expect(sheet.rows[0]).toEqual(columns.map((column) => column.header));
    expect(sheet).toEqual({
      name: '期中整卷',
      rows: [
        ['学号', '姓名', '用户组', '总分', '状态'],
        [2401, '张三', '计科 2401', 95, '已交卷'],
        [null, '李四', null, 87.5, null],
        ['S2403', '王五', '计科 2402', '未提交', null],
      ],
    });
  });

  it('drops characters excel forbids from the grades sheet name', async () => {
    const imported = await loadModule(gradeLoaders, GRADES_LOAD_SOURCE);
    const gradesSheet = gradesSheetOf(readField(imported, 'gradesSheet'));
    const columns: GradeColumn[] = [{ key: 'total', header: '总分', align: 'right' }];
    const rows = [
      gradeRow({
        key: 'a',
        studentId: '2401',
        name: '张三',
        cells: { total: '95' },
      }),
    ];
    const sheet = readSheet(gradesSheet('第一章：循环/数组[期中]', columns, rows));
    expect(sheet.name).toBe('第一章循环数组期中');
    expect(sheet.rows).toEqual([['总分'], [95]]);
  });

  it('shows the export failure and does not download', async () => {
    const user = userEvent.setup();
    buildXlsx.mockRejectedValue(new Error('工作簿没有生成。'));
    installHomeworkFetch();
    renderGrades(homeworkPayload());
    expect(await screen.findByRole('cell', { name: /赵一鸣/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出 Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('工作簿没有生成。');
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '导出 Excel' })).toBeEnabled();
  });

  it('downloads again after the first excel export finishes', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['grades-xlsx']);
    buildXlsx.mockResolvedValue(blob);
    installHomeworkFetch();
    renderGrades(homeworkPayload());
    expect(await screen.findByRole('cell', { name: /赵一鸣/ })).toBeInTheDocument();
    const excel = screen.getByRole('button', { name: '导出 Excel' });
    await user.click(excel);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(excel).toBeEnabled();
    await user.click(excel);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    expect(downloadBlob).toHaveBeenNthCalledWith(1, `${HOMEWORK_TITLE}-成绩.xlsx`, blob);
    expect(downloadBlob).toHaveBeenNthCalledWith(2, `${HOMEWORK_TITLE}-成绩.xlsx`, blob);
  });
});
