// Same glob load as teach/grades-model.spec.ts and teach/grades-tab.spec.tsx.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemKind, TeachTab, TeachType } from '@hydrooj/common';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { TeachPaper, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';

const modelLoaders = import.meta.glob('../../src/pages/teach/grades-model.ts');
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/grades.tsx');
const MODEL_SOURCE = 'src/pages/teach/grades-model.ts';
const TAB_SOURCE = 'src/pages/teach/tabs/grades.tsx';

const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d55';
const DOT = '\u00B7';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
type GradesTabType = (props: { payload: TeachWorkbenchPayload; onNavigateTab: (tab: TeachTab) => void }) => ReactElement;

interface RosterMember {
  uid: number;
  uname: string;
  realName: string;
  studentId: string;
  groups: string[];
  groupIds: string[];
  done: number;
  total: number;
  completedPids: number[];
}

interface PracticeProblem {
  pid: number;
  label: string;
  title: string;
}

interface PassCount extends PracticeProblem {
  count: number;
}

interface ModelApi {
  parsePracticeRoster: (raw: unknown) => {
    rosterProblemIds: number[];
    rosterProblems: PracticeProblem[];
  };
  practicePassCounts: (members: readonly RosterMember[], problems: readonly PracticeProblem[]) => PassCount[];
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

async function loadParser(): Promise<ModelApi['parsePracticeRoster']> {
  const model = await loadModule(modelLoaders, MODEL_SOURCE);
  return asFunction<ModelApi['parsePracticeRoster']>(readField(model, 'parsePracticeRoster'), 'parsePracticeRoster');
}

async function loadPassCounts(): Promise<ModelApi['practicePassCounts']> {
  const model = await loadModule(modelLoaders, MODEL_SOURCE);
  return asFunction<ModelApi['practicePassCounts']>(readField(model, 'practicePassCounts'), 'practicePassCounts');
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

function problem(docId: number, kind: ProblemKind, title: string): TeachPaper['problems'][number] {
  return {
    docId,
    pid: `P${docId}`,
    title,
    kind,
    score: null,
    hidden: false,
    mine: false,
    difficulty: null,
  };
}

function member(input: {
  uid: number;
  realName: string;
  completedPids: number[];
  groupId: string;
  groupName: string;
}): RosterMember {
  return {
    uid: input.uid,
    uname: `user${input.uid}`,
    realName: input.realName,
    studentId: String(240000 + input.uid),
    groups: [input.groupName],
    groupIds: [input.groupId],
    done: input.completedPids.length,
    total: 2,
    completedPids: input.completedPids.slice(),
  };
}

function practiceMembers(): RosterMember[] {
  return [
    member({
      uid: 10,
      realName: '陈思远',
      completedPids: [101, 102],
      groupId: 'g1',
      groupName: '计科 2401',
    }),
    member({
      uid: 11,
      realName: '王浩然',
      completedPids: [101],
      groupId: 'g2',
      groupName: '计科 2402',
    }),
  ];
}

function practiceRoster(problems: unknown) {
  return {
    members: practiceMembers(),
    membersTruncated: false,
    canViewRoster: true,
    rosterProblems: problems,
  };
}

function practicePayload(): TeachWorkbenchPayload {
  const link = {
    studentView: `/problem-sets/${PRACTICE_ID}`,
    scoreboard: null,
    manage: null,
    users: null,
    clarification: null,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: `/problem-sets/${PRACTICE_ID}/file`,
    redemption: null,
  };
  return {
    container: {
      type: 'practice' satisfies TeachType,
      id: PRACTICE_ID,
      rule: 'problem_set',
      title: '链表专项',
      status: 'open',
      beginAt: null,
      endAt: null,
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
      links: link,
    },
    paper: {
      problems: [problem(101, 'programming', 'A+B'), problem(102, 'programming', '求和')],
      stages: [
        { id: 1, title: '链表基础', requireIds: [], pids: [101] },
        { id: 2, title: '综合', requireIds: [], pids: [102] },
      ],
      examPaperQuotas: null,
    },
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
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function visible(node: HTMLElement): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function passPanel(): HTMLElement {
  const heading = screen.getByRole('heading', { name: '每题通过人数' });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError('missing pass count panel');
  return panel;
}

function rowAt(text: string, label: string, title: string, count: number, from: number): number {
  const needle = `${label} ${DOT} ${title}`;
  const at = text.indexOf(needle, from);
  if (at < 0) return -1;
  const rest = text.slice(at + needle.length).replace(/^\s+/, '');
  const digits = String(count);
  if (!rest.startsWith(digits)) return -1;
  const next = rest.charAt(digits.length);
  if (next !== '' && next >= '0' && next <= '9') return -1;
  return at;
}

function expectPassState(
  people: number,
  rows: ReadonlyArray<readonly [string, string, number]>,
  bars: readonly string[],
) {
  const panel = passPanel();
  expect(within(panel).getByText(`共 ${people} 人`)).toBeInTheDocument();
  const text = visible(panel);
  let cursor = 0;
  for (const [label, title, count] of rows) {
    const at = rowAt(text, label, title, count, cursor);
    expect(at, `${label} ${DOT} ${title} ${count}`).toBeGreaterThanOrEqual(cursor);
    cursor = at + 1;
  }
  const values = within(panel).getAllByRole('progressbar').map((node) => node.getAttribute('aria-valuenow'));
  expect(values).toEqual([...bars]);
}

function expectPanelFollowsTable() {
  const table = document.querySelector('[data-slot="data-table"]');
  if (!(table instanceof HTMLElement)) throw new TypeError('missing grades table');
  const following = Node.DOCUMENT_POSITION_FOLLOWING;
  expect(table.compareDocumentPosition(passPanel()) & following).toBe(following);
}

async function chooseGroup(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: '用户组' }));
  await user.click(screen.getByRole('option', { name }));
}

describe('practice pass counts', () => {
  it('parses a numeric roster problem list into labels', async () => {
    const parsePracticeRoster = await loadParser();
    const parsed = parsePracticeRoster(practiceRoster([101, 102]));
    expect(parsed.rosterProblemIds).toEqual([101, 102]);
    expect(parsed.rosterProblems).toEqual([
      { pid: 101, label: '101', title: '' },
      { pid: 102, label: '102', title: '' },
    ]);
  });

  it('parses an object roster problem into its label and title', async () => {
    const parsePracticeRoster = await loadParser();
    const parsed = parsePracticeRoster(practiceRoster([
      { pid: 101, title: 'A+B', pidLabel: 'P1000' },
      { pid: 102, title: '求和', pidLabel: 'P1001' },
    ]));
    expect(parsed.rosterProblemIds).toEqual([101, 102]);
    expect(parsed.rosterProblems).toEqual([
      { pid: 101, label: 'P1000', title: 'A+B' },
      { pid: 102, label: 'P1001', title: '求和' },
    ]);
  });

  it('rejects a roster problem whose pid is not an integer', async () => {
    const parsePracticeRoster = await loadParser();
    expect(() => parsePracticeRoster(practiceRoster([{ pid: 'x' }]))).toThrow(TypeError);
  });

  it('counts each member once per problem, even when a completed ID repeats', async () => {
    const practicePassCounts = await loadPassCounts();
    const members = practiceMembers();
    members[0]!.completedPids.push(101);
    const counts = practicePassCounts(members, [
      { pid: 101, label: 'P1000', title: 'A+B' },
      { pid: 102, label: 'P1001', title: '求和' },
    ]);
    expect(counts).toEqual([
      { pid: 101, label: 'P1000', title: 'A+B', count: 2 },
      { pid: 102, label: 'P1001', title: '求和', count: 1 },
    ]);
  });

  it('shows pass counts under the table and follows the group and the search', async () => {
    const Tab = await loadGradesTab();
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.pathname === `/problem-sets/${PRACTICE_ID}/roster`) {
        return jsonResponse(practiceRoster([
          { pid: 101, title: 'A+B', pidLabel: 'P1000' },
          { pid: 102, title: '求和', pidLabel: 'P1001' },
        ]));
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderGrades(Tab, practicePayload());
    expect(await screen.findByRole('cell', { name: '陈思远' })).toBeInTheDocument();
    expectPanelFollowsTable();
    expectPassState(2, [
      ['P1000', 'A+B', 2],
      ['P1001', '求和', 1],
    ], ['100', '50']);

    const search = screen.getByRole('searchbox', { name: '学号或姓名' });
    await user.type(search, '陈思远');
    expectPassState(1, [
      ['P1000', 'A+B', 1],
      ['P1001', '求和', 1],
    ], ['100', '100']);

    await user.clear(search);
    expectPassState(2, [
      ['P1000', 'A+B', 2],
      ['P1001', '求和', 1],
    ], ['100', '50']);

    await chooseGroup(user, '计科 2402');
    expectPassState(1, [
      ['P1000', 'A+B', 1],
      ['P1001', '求和', 0],
    ], ['100', '0']);
  });
});
