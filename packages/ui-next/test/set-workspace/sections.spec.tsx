// A static import fails collection while src/pages/set-workspace/sections.tsx is absent.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type {
  SetWorkspace, WsAnnouncement, WsClarification, WsGroup, WsUrls,
} from '../../src/pages/set-workspace/model.ts';

process.env.TZ = 'Asia/Shanghai';

const sectionLoaders = import.meta.glob('../../src/pages/set-workspace/sections.tsx');
const SECTION_SOURCE = 'src/pages/set-workspace/sections.tsx';

const TID = '64b8000000000000000000a1';
const UID = 7;
const GENERATED_AT = '2026-10-18T16:00:00.000+08:00';
const RECORD_AT = '2026-10-18T14:12:00.000+08:00';
const RECORD_CLOCK = '14:12';
const RECORD_ID = `${Math.floor(Date.parse(RECORD_AT) / 1000).toString(16).padStart(8, '0')}aabbccddeeff0011`;
const RECORD_PID = 1007;
const RECORD_LABEL = '7-1';
const RECORD_TITLE = '环形链表检测';
const RECORD_SCORE = 15;
const CLARIFY_PID = 1002;
const CLARIFY_LABEL = '2-2';
const CLARIFY_TITLE = '二分查找';
const NOTICE_NEW = '2026-10-18T14:40:00.000+08:00';
const NOTICE_OLD = '2026-10-18T14:02:00.000+08:00';
const NOTICE_MID = '2026-10-18T14:20:00.000+08:00';
const QUESTION_AT = '2026-10-18T14:35:00.000+08:00';
const REPLY_AT = '2026-10-18T14:37:00.000+08:00';
const QUESTION = '是否向下取整？';
const REPLY = '是的，向下取整。';
const ASKED = '这道题的下标从 0 开始吗？';
const PRINT_URL = `/exam-mode/${TID}/print`;
const RECORDS_URL = `/record?tid=${TID}&uidOrName=${UID}`;
const RANKING_URL = `/contest/${TID}/scoreboard`;
const OUR_TEAM = '计科一队';
const OTHER_TEAM = '软工二队';
const CONTEST_SCORE = 40;
const PRACTICE_SCORE = 75;
const CLARIFY_URL = `/contest/${TID}/problems`;
const DETAIL_URL = `/record/__RID__?tid=${TID}`;

if (RECORD_ID.length !== 24) throw new Error(`record id length ${RECORD_ID.length}`);

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
interface SectionProps { ws: SetWorkspace }
type SectionComponent = (props: SectionProps) => ReactElement;

interface WorkspaceSections {
  RecordsSection: SectionComponent;
  RankingSection: SectionComponent;
  NoticeSection: SectionComponent;
  ClarifySection: SectionComponent;
  PrintSection: SectionComponent;
}

interface ScoreboardPart {
  value: string | number;
  raw?: string | number | null;
  score?: number;
}

interface ScoreboardTeam {
  name: string;
  captainUid: number;
  memberUids: number[];
}

interface ScoreboardCell {
  type: string;
  value: string | number;
  raw?: string | number | ScoreboardPart[];
  team?: ScoreboardTeam;
  /** Hydro first-blood marker. Not part of the displayed text. */
  style?: string;
  /** Problem score on a partial-credit cell. 100 with value "10" is 10/100, not full marks. */
  score?: number;
  /** 0–100 from annotateScoreboardPercentages. 100 is full marks even when the shown value is 15. */
  scorePercentage?: number;
}

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

function readComponent(imported: object, name: keyof WorkspaceSections): SectionComponent {
  const component = readField(imported, name);
  expect(typeof component, name).toBe('function');
  if (typeof component !== 'function') throw new TypeError(`${name} must be a function`);
  return component as SectionComponent;
}

async function loadSections(): Promise<WorkspaceSections> {
  const imported = await loadModule(sectionLoaders, SECTION_SOURCE);
  return {
    RecordsSection: readComponent(imported, 'RecordsSection'),
    RankingSection: readComponent(imported, 'RankingSection'),
    NoticeSection: readComponent(imported, 'NoticeSection'),
    ClarifySection: readComponent(imported, 'ClarifySection'),
    PrintSection: readComponent(imported, 'PrintSection'),
  };
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function requestKey(input: unknown): string {
  const url = requestUrl(input);
  return `${url.pathname}${url.search}`;
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

function installFetch(respond: (url: URL, init?: RequestInit) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input, init) => Promise.resolve(respond(requestUrl(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function postParams(fetchMock: FetchMock, path: string): URLSearchParams[] {
  const found: URLSearchParams[] = [];
  for (const call of fetchMock.mock.calls) {
    if (requestKey(call[0]) !== path) continue;
    const init = call[1];
    if (!init || init.method !== 'POST') continue;
    const body = init.body;
    if (body instanceof URLSearchParams) found.push(body);
    else if (typeof body === 'string') found.push(new URLSearchParams(body));
  }
  return found;
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: GENERATED_AT,
    user: {
      id: UID,
      name: '张三',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'student',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'set_workspace.html', data: {} },
  };
}

function urls(patch: Partial<WsUrls> = {}): WsUrls {
  return {
    back: '/training',
    manage: null,
    overview: `/homework/${TID}`,
    problem: null,
    submit: null,
    submitCode: null,
    recordDetail: DETAIL_URL,
    records: RECORDS_URL,
    ranking: null,
    clarify: null,
    print: null,
    start: null,
    attend: null,
    draftList: null,
    draftUpsert: null,
    submitKind: null,
    lockKind: null,
    finalize: null,
    virtual: null,
    practice: null,
    teamProblem: null,
    pretest: null,
    ...patch,
  };
}

function group(patch: Partial<WsGroup> & Pick<WsGroup, 'items'>): WsGroup {
  return {
    kind: 'programming',
    no: 7,
    name: '编程题',
    scoreEach: 25,
    ...patch,
  };
}

function workspace(patch: Partial<SetWorkspace> = {}): SetWorkspace {
  return {
    kind: 'homework',
    flavor: 'homework',
    tid: TID,
    title: '链表作业',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: {
      beginAt: '2026-10-16T08:00:00.000+08:00',
      endAt: '2026-10-20T23:59:00.000+08:00',
      dueAt: '2026-10-20T23:59:00.000+08:00',
      durationMinutes: null,
      startAt: null,
      personalEndAt: null,
      lockAt: null,
    },
    groups: [],
    totals: {
      problemCount: 1,
      maxScore: 25,
      answered: 1,
      score: RECORD_SCORE,
      accepted: null,
      showScore: true,
    },
    verdictVisible: true,
    team: null,
    paper: null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '240101' },
    action: {
      canStart: false,
      canFinalize: false,
      canAttend: false,
      canUnrank: false,
      canSubmit: true,
      attended: true,
      canRetake: false,
    },
    urls: urls(),
    ...patch,
    objectiveVerdictVisible: patch.objectiveVerdictVisible ?? true,
  };
}

function programmingGroup(): WsGroup {
  return group({
    items: [{
      pid: RECORD_PID,
      label: RECORD_LABEL,
      title: RECORD_TITLE,
      kind: 'programming',
      score: 25,
      state: 'partial',
      submits: 1,
      lastScore: RECORD_SCORE,
    }],
  });
}

function clarifyGroup(): WsGroup {
  return group({
    no: 2,
    name: '单选题',
    kind: 'single',
    scoreEach: 5,
    items: [{
      pid: CLARIFY_PID,
      label: CLARIFY_LABEL,
      title: CLARIFY_TITLE,
      kind: 'single',
      score: 5,
      state: 'empty',
      submits: 0,
      lastScore: null,
    }],
  });
}

function recordDocument(): Record<string, unknown> {
  return {
    _id: RECORD_ID,
    pid: RECORD_PID,
    uid: UID,
    status: 1,
    score: RECORD_SCORE,
  };
}

function recordsPayload(documents: Record<string, unknown>[]): Record<string, unknown> {
  return { rdocs: documents };
}

function board(header: ScoreboardCell[], body: ScoreboardCell[][], locked = false): Record<string, unknown> {
  return {
    rows: [header, ...body],
    udict: {
      8: { _id: 8, uname: '陈思远' },
      [UID]: { _id: UID, uname: '张三' },
    },
    currentUserId: UID,
    scoreboardLocked: locked,
  };
}

function acmBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'solved', value: '通过' },
    { type: 'time', value: '罚时' },
    { type: 'problem', value: 'A', raw: 1001 },
  ];
  const chen: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '陈思远', raw: 8 },
    { type: 'solved', value: 5 },
    { type: 'time', value: 412 },
    { type: 'record', value: '+', raw: 'rid-chen' },
  ];
  const self: ScoreboardCell[] = [
    { type: 'rank', value: 2 },
    { type: 'user', value: '张三', raw: UID },
    { type: 'solved', value: 3 },
    { type: 'time', value: 214 },
    { type: 'record', value: '-2', raw: 'rid-self' },
  ];
  return board(header, [chen, self], true);
}

function teamBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'string', value: '队伍' },
    { type: 'solved', value: '通过' },
    { type: 'time', value: '罚时' },
    { type: 'problem', value: 'A', raw: 1001 },
  ];
  const other: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    {
      type: 'string',
      value: OTHER_TEAM,
      raw: 'team-other',
      team: { name: OTHER_TEAM, captainUid: 9, memberUids: [9] },
    },
    { type: 'solved', value: 4 },
    { type: 'time', value: 300 },
    { type: 'record', value: '+', raw: 'rid-other' },
  ];
  const ours: ScoreboardCell[] = [
    { type: 'rank', value: 2 },
    {
      type: 'string',
      value: OUR_TEAM,
      raw: 'team-ours',
      team: { name: OUR_TEAM, captainUid: 8, memberUids: [8, UID] },
    },
    { type: 'solved', value: 3 },
    { type: 'time', value: 214 },
    { type: 'record', value: '+1', raw: 'rid-ours' },
  ];
  return {
    rows: [header, other, ours],
    udict: {
      8: { _id: 8, uname: '陈思远' },
      9: { _id: 9, uname: '林晓' },
      [UID]: { _id: UID, uname: '张三' },
    },
    scoreboardLocked: false,
  };
}

function oiRecordsBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'total_score', value: '总分' },
    { type: 'problem', value: 'A', raw: 1001 },
  ];
  const row: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '林晓', raw: 9 },
    { type: 'total_score', value: 115 },
    {
      type: 'records',
      value: '',
      raw: [
        { value: CONTEST_SCORE, raw: 'rid-contest', score: CONTEST_SCORE },
        { value: PRACTICE_SCORE, raw: 'rid-practice', score: PRACTICE_SCORE },
      ],
    },
  ];
  return {
    rows: [header, row],
    udict: { 9: { _id: 9, uname: '林晓' } },
    scoreboardLocked: false,
  };
}

function ioiBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'total_score', value: '总分' },
    { type: 'problem', value: 'A', raw: 1001 },
  ];
  const row: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '林晓', raw: 9 },
    { type: 'total_score', value: 360 },
    { type: 'record', value: 100, raw: 'rid-lin' },
  ];
  return board(header, [row], false);
}

function frozenBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'total_score', value: '总分' },
    { type: 'problem', value: 'A', raw: 1001 },
    { type: 'problem', value: 'B', raw: 1002 },
    { type: 'problem', value: 'C', raw: 1003 },
    { type: 'problem', value: 'D', raw: 1004 },
    { type: 'problem', value: 'E', raw: 1005 },
    { type: 'problem', value: 'F', raw: 1006 },
  ];
  const row: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '林晓', raw: 9 },
    { type: 'total_score', value: 80 },
    { type: 'record', value: '<span style="color:orange">+2</span>' },
    { type: 'record', value: '-2<span style="color:orange">+1</span>' },
    { type: 'record', value: '80<span style="color:orange">+1</span>' },
    { type: 'record', value: '<span class="icon icon-check"></span>' },
    { type: 'record', value: '+', style: 'background-color: rgb(217, 240, 199);' },
    { type: 'record', value: '10', score: 100 },
  ];
  return board(header, [row], true);
}

/** Production cells: a 15-point problem at full marks is percentage 100, half is 50. */
function percentageBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'total_score', value: '总分' },
    { type: 'problem', value: 'A', raw: 101 },
    { type: 'problem', value: 'B', raw: 102 },
  ];
  const row: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '林晓', raw: 9 },
    { type: 'total_score', value: 22.5 },
    { type: 'record', value: '15', score: 15, scorePercentage: 100 },
    { type: 'record', value: '7.5', score: 7.5, scorePercentage: 50 },
  ];
  return {
    rows: [header, row],
    udict: { 9: { _id: 9, uname: '林晓' } },
    scoreboardLocked: false,
  };
}

function announcements(): WsAnnouncement[] {
  return [
    {
      id: 'ann-old',
      subject: '作业已开放',
      content: '开放后可以查看题目。',
      createdAt: NOTICE_OLD,
    },
    {
      id: 'ann-new',
      subject: '选项更正',
      content: '选项已更正，不影响作答。',
      createdAt: NOTICE_NEW,
    },
    {
      id: 'ann-mid',
      subject: '监考提醒',
      content: '请保持座位整洁。',
      createdAt: NOTICE_MID,
    },
  ];
}

function clarifications(): WsClarification[] {
  return [{
    id: 'clar-1',
    subject: CLARIFY_LABEL,
    content: QUESTION,
    createdAt: QUESTION_AT,
    replies: [{ content: REPLY, createdAt: REPLY_AT }],
  }];
}

function classText(node: Element): string {
  const value: unknown = node.className;
  return typeof value === 'string' ? value : '';
}

function shown(node: HTMLElement): string {
  return (node.textContent ?? '').replace(/\s+/g, '');
}

function expectFrame(container: HTMLElement): void {
  const nodes = [...container.querySelectorAll('*')];
  expect(nodes.some((node) => {
    const name = classText(node);
    return name.includes('overflow-y-auto') && name.includes('bg-surface-sunken');
  })).toBe(true);
  expect(nodes.some((node) => classText(node).includes('max-w-5xl'))).toBe(true);
  expect(container.querySelector('[data-slot="panel"]')).not.toBeNull();
}

function renderSection(Section: SectionComponent, ws: SetWorkspace) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <Section ws={ws} />
    </BootstrapProvider>,
  );
}

function recordHrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? '');
}

function scoreCellText(row: HTMLElement): string {
  const headers = screen.getAllByRole('columnheader');
  const index = headers.findIndex((header) => header.textContent === '得分');
  const cells = within(row).getAllByRole('cell');
  const cell = cells[index];
  if (!cell) throw new TypeError('score cell is missing');
  return cell.textContent ?? '';
}

function sameInstant(stored: string | null, iso: string): boolean {
  if (stored === null) return false;
  if (stored === iso) return true;
  const target = Date.parse(iso);
  if (/^\d+$/.test(stored)) return Number(stored) === target;
  return Date.parse(stored) === target;
}

function dialogSubmit(dialog: HTMLElement): HTMLElement {
  const buttons = [...dialog.querySelectorAll('button')].filter((button) => {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.trim();
    return label !== '关闭' && !label.includes('取消');
  });
  const submit = buttons.find((button) => button.type === 'submit') ?? buttons[0];
  if (!submit) throw new TypeError('dialog has no submit control');
  return submit;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rankingText(container: HTMLElement): string {
  return container.textContent ?? '';
}

/** D10's ranking area is one sunken, padded scroller. `p-4` is the required base padding. */
function sunkenRankingShell(container: HTMLElement): HTMLElement {
  const shell = [...container.querySelectorAll('*')].find((node) => {
    const tokens = classText(node).split(/\s+/);
    return tokens.includes('bg-surface-sunken') && tokens.includes('p-4');
  });
  expect(shell, 'ranking area should be bg-surface-sunken with p-4').toBeInstanceOf(HTMLElement);
  if (!(shell instanceof HTMLElement)) throw new TypeError('ranking shell is missing');
  return shell;
}

function borderedPanelAround(node: HTMLElement): HTMLElement {
  const panel = node.closest('[data-slot="panel"]');
  expect(panel, 'content should sit in a bordered panel').toBeInstanceOf(HTMLElement);
  if (!(panel instanceof HTMLElement)) throw new TypeError('ranking panel is missing');
  expect(classText(panel).split(/\s+/)).toContain('border');
  return panel;
}

function rankingSearchBox(): HTMLElement {
  const boxes = [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('searchbox')];
  const box = boxes.find((item) => /学号|姓名|用户名/.test(
    `${item.getAttribute('aria-label') ?? ''} ${item.getAttribute('placeholder') ?? ''}`,
  ));
  expect(box, 'ranking search should name 学号, 姓名, or 用户名').toBeTruthy();
  if (!box) throw new TypeError('ranking search is missing');
  return box;
}

function dataRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
}

function visibleViewerRow(): HTMLElement | null {
  const found = [...document.querySelectorAll('tr')].find((row) => {
    if (row.getAttribute('aria-hidden') === 'true') return false;
    return (row.textContent ?? '').includes('张三');
  });
  return found instanceof HTMLElement ? found : null;
}

function pinnedViewerRow(container: HTMLElement): HTMLElement | null {
  const found = [...container.querySelectorAll('tr')].find((row) => {
    return row.getAttribute('aria-hidden') === 'true' && (row.textContent ?? '').includes('张三');
  });
  return found instanceof HTMLElement ? found : null;
}

function ownClassTokens(node: Element): string[] {
  return classText(node).split(/\s+/).filter((token) => token.length > 0);
}

/** Tone classes live on the cell or the colored chip inside it. Match either, as whole tokens. */
function toneTokens(cell: HTMLElement): string[] {
  const tokens = new Set<string>();
  for (const node of [cell, ...cell.querySelectorAll('*')]) {
    for (const token of ownClassTokens(node)) tokens.add(token);
  }
  return [...tokens];
}

function expectPinnedRowSticks(row: HTMLElement): void {
  const cells = [...row.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'TD');
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    const tokens = ownClassTokens(cell);
    const label = (cell.textContent ?? '').trim();
    expect(tokens, label).toContain('sticky');
    expect(tokens, label).toContain('bottom-0');
  }
  const rank = cells.find((cell) => (cell.textContent ?? '').trim() === '2');
  const name = cells.find((cell) => (cell.textContent ?? '').includes('张三'));
  if (!rank || !name) throw new TypeError('pinned identity cells are missing');
  expect(ownClassTokens(rank)).toContain('left-0');
  expect(ownClassTokens(name)).toContain('left-16');
}

function expectHeaderSticks(): void {
  const headers = screen.getAllByRole('columnheader');
  expect(headers.length).toBeGreaterThan(0);
  for (const header of headers) {
    const tokens = ownClassTokens(header);
    const label = (header.textContent ?? '').trim();
    expect(tokens, label).toContain('sticky');
    expect(tokens, label).toContain('top-0');
  }
  expect(ownClassTokens(screen.getByRole('columnheader', { name: '名次' }))).toContain('left-0');
}

function visibilityEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  const rect = target.getBoundingClientRect();
  return {
    target,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: rect,
    intersectionRect: isIntersecting ? rect : new DOMRect(),
    rootBounds: null,
    time: 0,
  };
}

class RankingVisibilityObserver {
  static latest: RankingVisibilityObserver | null = null;

  readonly root: Element | Document | null = null;

  readonly rootMargin = '';

  readonly thresholds: readonly number[] = [];

  readonly observed: Element[] = [];

  private readonly onEntries: IntersectionObserverCallback;

  constructor(onEntries: IntersectionObserverCallback) {
    this.onEntries = onEntries;
    RankingVisibilityObserver.latest = this;
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    const index = this.observed.indexOf(element);
    if (index >= 0) this.observed.splice(index, 1);
  }

  disconnect(): void {
    this.observed.splice(0, this.observed.length);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  report(isIntersecting: boolean): void {
    const targets = new Set<Element>(this.observed);
    const self = visibleViewerRow();
    if (self) targets.add(self);
    const entries = [...targets].map((target) => visibilityEntry(target, isIntersecting));
    this.onEntries(entries, this as unknown as IntersectionObserver);
  }
}

function installVisibilityObserver(): () => void {
  const previous = window.IntersectionObserver;
  window.IntersectionObserver = RankingVisibilityObserver as unknown as typeof window.IntersectionObserver;
  RankingVisibilityObserver.latest = null;
  return () => {
    window.IntersectionObserver = previous;
    RankingVisibilityObserver.latest = null;
  };
}

function deferredResponse(): { promise: Promise<Response>; finish: (value: Response) => void } {
  let finish: ((value: Response) => void) | null = null;
  const promise = new Promise<Response>((done) => {
    finish = done;
  });
  return {
    promise,
    finish: (value) => {
      if (!finish) throw new TypeError('ranking response is unsettled');
      finish(value);
    },
  };
}

function scoreSelfBoard(): Record<string, unknown> {
  const header: ScoreboardCell[] = [
    { type: 'rank', value: '名次' },
    { type: 'user', value: '选手' },
    { type: 'total_score', value: '总分' },
    { type: 'problem', value: 'A', raw: 1001 },
  ];
  const self: ScoreboardCell[] = [
    { type: 'rank', value: 1 },
    { type: 'user', value: '张三', raw: UID },
    { type: 'total_score', value: 88 },
    { type: 'record', value: 88, raw: 'rid-score' },
  ];
  return board(header, [self], false);
}

function rankingContest(patch: Partial<SetWorkspace> = {}): SetWorkspace {
  return workspace({
    kind: 'contest',
    flavor: 'acm',
    numbering: 'letter',
    urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    ...patch,
  });
}

describe('set workspace sections', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    installFetch(() => hydroError('未准备的请求。', 404));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders safe configured record fields without inventing a missing verdict or reapplying the current round policy', async () => {
    const { RecordsSection } = await loadSections();
    const record = recordDocument();
    delete record.status;
    installFetch(() => jsonResponse(recordsPayload([record])));
    const fillGroup = programmingGroup();
    fillGroup.kind = 'program_fill';
    fillGroup.items = fillGroup.items.map((item) => ({ ...item, kind: 'program_fill', feedback: { score: false, verdict: false, details: false } }));
    renderSection(RecordsSection, workspace({ officialRound: null, objectiveVerdictVisible: false, groups: [fillGroup] }));
    const row = await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(scoreCellText(row)).toBe(String(RECORD_SCORE));
    expect(row).not.toHaveTextContent('待评测');
    expect(row).not.toHaveTextContent('Waiting');
    const columns = screen.getAllByRole('columnheader');
    const index = columns.findIndex((header) => header.textContent === '结果');
    expect(within(row).getAllByRole('cell')[index]).toHaveTextContent('—');
  });

  it('restores a participant and date filters from the workspace URL and keeps them on page links', async () => {
    window.history.replaceState(null, '', `/contest/${TID}?section=records&uidOrName=8&pid=${RECORD_PID}&status=1&lang=cc.cc17&from=2026-10-01&to=2026-10-31`);
    const { RecordsSection } = await loadSections();
    const fetchMock = installFetch(() => jsonResponse({ ...recordsPayload([recordDocument()]), udict: { [UID]: { uname: '张三' } }, langs: { 'cc.cc17': { display: 'C++17' } } }));
    renderSection(RecordsSection, workspace({ groups: [programmingGroup()] }));
    await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    const request = new URL(requestKey(fetchMock.mock.calls[0][0]), window.location.origin);
    expect(request.searchParams.get('uidOrName')).toBe('8');
    expect(request.searchParams.get('lang')).toBe('cc.cc17');
    const language = screen.getByRole('combobox', { name: '语言' });
    expect(new FormData(language.closest('form')!).get('lang')).toBe('cc.cc17');
    expect(request.searchParams.get('from')).toBe('2026-10-01');
    expect(request.searchParams.get('to')).toBe('2026-10-31');
    const next = new URL(screen.getByRole('link', { name: '下一页' }).getAttribute('href')!, window.location.origin);
    expect(next.searchParams.get('uidOrName')).toBe('8');
    expect(next.searchParams.get('page')).toBe('2');
    expect(screen.getByLabelText('开始日期（北京时间）')).toHaveValue('2026-10-01');
    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  it('links a browser ranking participant to filtered workspace submissions', async () => {
    const { RankingSection } = await loadSections();
    installFetch(() => jsonResponse(acmBoard()));
    renderSection(RankingSection, rankingContest());
    const participant = await screen.findByRole('link', { name: '陈思远' });
    expect(participant).toHaveAttribute('href', `/contest/${TID}?section=records&uidOrName=8`);
  });

  it('renders a browser record with its problem label and a detail link', async () => {
    const { RecordsSection } = await loadSections();
    const fetchMock = installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) return jsonResponse(recordsPayload([recordDocument()]));
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RecordsSection, workspace({ groups: [programmingGroup()] }));
    expectFrame(view.container);
    const row = await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(row).toHaveTextContent(RECORD_CLOCK);
    expect(row).toHaveTextContent(RECORD_LABEL);
    expect(row).toHaveTextContent(RECORD_TITLE);
    expect(row).toHaveTextContent(String(RECORD_SCORE));
    expect(screen.getByRole('columnheader', { name: '时间' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '题目' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '结果' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '得分' })).toBeInTheDocument();
    expect(screen.queryByText('Accepted') ?? screen.queryByText('AC')).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => requestKey(call[0]) === RECORDS_URL)).toBe(true);
    expect(recordHrefs(view.container).some((href) => href.includes(`/record/${RECORD_ID}`) && href.includes(`tid=${TID}`))).toBe(true);
  });

  it('shows an empty records message when the student has no submissions', async () => {
    const { RecordsSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) return jsonResponse(recordsPayload([]));
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RecordsSection, workspace({ groups: [programmingGroup()] }));
    expect(await screen.findByText('还没有提交')).toBeInTheDocument();
    expect(screen.queryByText(RECORD_TITLE)).toBeNull();
    expectFrame(view.container);
  });

  it('does not link record rows in client mode', async () => {
    const { RecordsSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) return jsonResponse(recordsPayload([recordDocument()]));
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RecordsSection, workspace({
      mode: 'client',
      groups: [programmingGroup()],
      urls: urls({ overview: `/exam-mode/${TID}`, back: null }),
    }));
    const row = await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(row).toHaveTextContent(RECORD_LABEL);
    expect(row).toHaveTextContent(RECORD_TITLE);
    expect(recordHrefs(view.container).some((href) => href.includes(RECORD_ID))).toBe(false);
    expect(view.container.querySelector('a')).toBeNull();
  });

  it('hides the verdict and the record link when a paper keeps results private', async () => {
    const { RecordsSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) return jsonResponse(recordsPayload([recordDocument()]));
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RecordsSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      verdictVisible: false,
      groups: [group({
        kind: 'single',
        name: '单选题',
        no: 2,
        items: [{
          pid: RECORD_PID,
          label: RECORD_LABEL,
          title: RECORD_TITLE,
          kind: 'single',
          score: 5,
          state: 'empty',
          submits: 0,
          lastScore: null,
        }],
      })],
      urls: urls({ overview: `/paper/${TID}` }),
    }));
    const row = await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(row).toHaveTextContent(String(RECORD_SCORE));
    expect(within(row).queryByText('Accepted')).toBeNull();
    expect(within(row).queryByText('AC')).toBeNull();
    expect(within(row).queryByText('Wrong Answer')).toBeNull();
    expect(recordHrefs(view.container).some((href) => href.includes(RECORD_ID))).toBe(false);
  });

  it('links a programming record when a paper hides objective verdicts', async () => {
    const { RecordsSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) return jsonResponse(recordsPayload([recordDocument()]));
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RecordsSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      verdictVisible: false,
      groups: [programmingGroup()],
      urls: urls({ overview: `/paper/${TID}` }),
    }));
    const row = await screen.findByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(row).toHaveTextContent(String(RECORD_SCORE));
    expect(screen.queryByText('Accepted') ?? screen.queryByText('AC')).toBeTruthy();
    expect(recordHrefs(view.container).some((href) => href.includes(RECORD_ID))).toBe(true);
  });

  it('renders a projected record that omits status and score', async () => {
    const { RecordsSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RECORDS_URL) {
        return jsonResponse(recordsPayload([{ _id: RECORD_ID, pid: RECORD_PID }]));
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RecordsSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      groups: [programmingGroup()],
      urls: urls({ overview: `/paper/${TID}` }),
    }));
    await waitFor(() => {
      expect(screen.queryByText(RECORD_TITLE) ?? screen.queryByText(/必须是整数/)).toBeTruthy();
    });
    expect(screen.queryByText(/必须是整数/)).toBeNull();
    expect(screen.getByText(RECORD_LABEL)).toBeInTheDocument();
    expect(screen.getByText(RECORD_TITLE)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: new RegExp(RECORD_TITLE) });
    expect(scoreCellText(row)).toBe('—');
  });

  it('shows the ranking empty state without requesting a board', async () => {
    const { RankingSection } = await loadSections();
    const fetchMock = installFetch(() => hydroError('不应该请求排名。', 404));
    const view = renderSection(RankingSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      urls: urls({ ranking: null, overview: `/paper/${TID}` }),
    }));
    expect(await screen.findByText('成绩公布后才能看到排名')).toBeInTheDocument();
    expect(screen.getByText('考试结束后公布')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.container.querySelector('.max-w-5xl')).toBeNull();
  });

  it('keeps ranking order, highlights the current user, and shows a locked board', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse({ ...acmBoard(), pdict: { 1001: { nAccept: 1, nSubmit: 3 } } });
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    expect(view.container.querySelector('.max-w-5xl')).toBeNull();
    expect(await screen.findByRole('columnheader', { name: '名次' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '选手' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '通过' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '罚时' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /A/ })).toHaveTextContent('1/3');
    expect(screen.queryByRole('columnheader', { name: '总分' })).toBeNull();
    expectHeaderSticks();
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const chen = rows.findIndex((text) => text.includes('陈思远'));
    const self = rows.findIndex((text) => text.includes('张三'));
    expect(chen).toBeGreaterThanOrEqual(0);
    expect(self).toBeGreaterThan(chen);
    const rendered = screen.getAllByRole('row');
    expect(classText(rendered[self] ?? rendered[0])).toContain('bg-brand-soft');
    expect(classText(rendered[chen] ?? rendered[0])).not.toContain('bg-brand-soft');
    expect(screen.getByText('封榜中')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
  });

  it('shows student id and name on a teacher ranking', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) {
        return jsonResponse({
          ...acmBoard(),
          studentDict: {
            8: { studentId: '250340008', realName: '陈思远' },
            [UID]: { studentId: '250340001', realName: '张三' },
          },
        });
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    expect(await screen.findByRole('columnheader', { name: '学号' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '姓名' })).toBeInTheDocument();
    expect(screen.getByText('250340008')).toBeInTheDocument();
    expect(screen.getByText('250340001')).toBeInTheDocument();
  });

  it('renders a non-acm board with a total score column', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(ioiBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'ioi',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    expect(await screen.findByRole('columnheader', { name: '总分' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '名次' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '选手' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '罚时' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '通过' })).toBeNull();
    expect(screen.getByText('林晓')).toBeInTheDocument();
    expect(screen.getByText('360')).toBeInTheDocument();
    expect(screen.queryByText('封榜中')).toBeNull();
  });

  it('renders frozen pending cells as question marks and keeps a check mark', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(frozenBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'ioi',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    const row = await screen.findByRole('row', { name: /林晓/ });
    const cells = within(row).getAllByRole('cell');
    const pending = cells[3];
    const penalty = cells[4];
    const kept = cells[5];
    const accepted = cells[6];
    if (!pending || !penalty || !kept || !accepted) throw new TypeError('frozen cells are missing');
    const pendingText = shown(pending);
    const penaltyText = shown(penalty);
    const keptText = shown(kept);
    const acceptedText = shown(accepted);
    expect(pendingText).toBe('?');
    expect(pendingText).not.toContain('+2');
    expect(penaltyText).toContain('-2');
    expect(penaltyText).toContain('?');
    expect(penaltyText).not.toContain('+1');
    expect(keptText).toContain('80');
    expect(keptText).toContain('?');
    expect(keptText).not.toContain('+1');
    expect(acceptedText).toContain('✓');
    expect(acceptedText).not.toContain('icon-check');
    expect(toneTokens(pending)).toContain('bg-info-soft');
    expect(toneTokens(accepted)).toContain('bg-success-soft');
    expect(toneTokens(accepted)).not.toContain('bg-success');
    const firstBlood = cells.find((cell) => shown(cell) === '+');
    const partial = cells.find((cell) => shown(cell) === '10');
    if (!firstBlood || !partial) throw new TypeError('tone cells are missing');
    expect(toneTokens(firstBlood)).toContain('bg-success');
    expect(toneTokens(firstBlood)).toContain('text-on-success');
    expect(toneTokens(firstBlood)).not.toContain('bg-success-soft');
    expect(toneTokens(partial)).toContain('bg-warning-soft');
  });

  it('colors a 15 point full score as success and a half score as warning', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(percentageBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'ioi',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    const row = await screen.findByRole('row', { name: /林晓/ });
    const cells = within(row).getAllByRole('cell');
    const full = cells.find((cell) => shown(cell) === '15');
    const half = cells.find((cell) => shown(cell) === '7.5');
    if (!full || !half) throw new TypeError('percentage cells are missing');
    expect(toneTokens(full)).toContain('bg-success-soft');
    expect(toneTokens(full)).not.toContain('bg-warning-soft');
    expect(toneTokens(half)).toContain('bg-warning-soft');
    expect(toneTokens(half)).not.toContain('bg-success-soft');
  });

  it('highlights a team row when the signed-in student is a member', async () => {
    const { RankingSection } = await loadSections();
    const payload = teamBoard();
    expect(Object.hasOwn(payload, 'currentUserId')).toBe(false);
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(payload);
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      team: { teamName: OUR_TEAM, role: 'member' },
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    expect(await screen.findByText(OUR_TEAM)).toBeInTheDocument();
    const texts = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const other = texts.findIndex((text) => text.includes(OTHER_TEAM));
    const ours = texts.findIndex((text) => text.includes(OUR_TEAM));
    expect(other).toBeGreaterThanOrEqual(0);
    expect(ours).toBeGreaterThan(other);
    const rendered = screen.getAllByRole('row');
    const ourRow = rendered[ours];
    const otherRow = rendered[other];
    if (!ourRow || !otherRow) throw new TypeError('team rows are missing');
    expect(classText(ourRow)).toContain('bg-brand-soft');
    expect(classText(otherRow)).not.toContain('bg-brand-soft');
  });

  it('shows both scores separated by a slash in an oi records cell', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(oiRecordsBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, workspace({
      kind: 'contest',
      flavor: 'oi',
      numbering: 'letter',
      urls: urls({ ranking: RANKING_URL, overview: `/contest/${TID}` }),
    }));
    expect(await screen.findByText('林晓')).toBeInTheDocument();
    const scored = screen.getAllByRole('cell').find((cell) => {
      const text = cell.textContent ?? '';
      return text.includes(String(CONTEST_SCORE)) && text.includes(String(PRACTICE_SCORE));
    });
    expect(scored, 'records cell should show both scores').toBeTruthy();
    expect(scored?.textContent ?? '').toContain('/');
  });

  it.each(['homework', 'paper'] as const)('shows ACM ranking for a configured %s', async (kind) => {
    const { RankingSection } = await loadSections();
    installFetch(() => jsonResponse(acmBoard()));
    const view = renderSection(RankingSection, rankingContest({ kind, flavor: kind, codePolicy: 'acm' }));
    await screen.findByRole('columnheader', { name: '名次' });
    const text = rankingText(view.container);
    expect(text).toContain('解题');
    expect(text).toContain('罚时');
    expect(text).not.toContain('按总分排名');
  });

  it('shows the signed-in acm rank, solved count, penalty, and frozen badge', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(acmBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, rankingContest());
    expect(await screen.findByRole('columnheader', { name: '名次' })).toBeInTheDocument();
    const text = rankingText(view.container);
    expect(text).toContain('我的名次');
    expect(text).toMatch(/\/\s*2(?!\d)/);
    expect(text).toContain('解题');
    expect(text).toMatch(/214\s*分钟/);
    expect(text).toMatch(/16:00\s*更新/);
    expect(text).toMatch(/共\s*2\s*人/);
    expect(text).toContain('「*」是打星选手，不计名次');
    expect(text).toContain('封榜后别人的新提交显示为「?」');
    const frozen = screen.getByText('封榜中');
    expect(frozen.closest('[data-slot="badge"]')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByRole('button', { name: '定位到我' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toHaveAttribute('data-variant', 'ghost');
    expect(rankingSearchBox()).toBeInTheDocument();
    expect(view.container.querySelector('.max-w-5xl')).toBeNull();
  });

  it('hides personal rank when the viewer is absent and still offers search and refresh', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(ioiBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, rankingContest({ flavor: 'ioi' }));
    expect(await screen.findByText('林晓')).toBeInTheDocument();
    const text = rankingText(view.container);
    expect(text).not.toContain('我的名次');
    expect(text).not.toContain('解题');
    expect(text).not.toContain('得分');
    expect(screen.queryByRole('button', { name: '定位到我' })).toBeNull();
    expect(rankingSearchBox()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(text).toMatch(/共\s*1\s*人/);
    expect(text).toContain('按总分排名，同分同名次');
    expect(text).not.toContain('「*」是打星选手，不计名次');
  });

  it('filters ranking rows by name without changing the rank text', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(acmBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    renderSection(RankingSection, rankingContest());
    expect(await screen.findByText('陈思远')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(rankingSearchBox(), ' 陈 ');
    await waitFor(() => {
      const names = dataRows().map((row) => row.textContent ?? '');
      expect(names.some((item) => item.includes('张三'))).toBe(false);
      expect(names.some((item) => item.includes('陈思远'))).toBe(true);
    });
    const chen = dataRows().find((row) => (row.textContent ?? '').includes('陈思远'));
    if (!chen) throw new TypeError('filtered row is missing');
    expect(within(chen).getAllByRole('cell')[0]).toHaveTextContent(/^1$/);
    await user.clear(rankingSearchBox());
    await waitFor(() => {
      expect(dataRows().some((row) => (row.textContent ?? '').includes('张三'))).toBe(true);
    });
    const self = dataRows().find((row) => (row.textContent ?? '').includes('张三'));
    if (!self) throw new TypeError('viewer row is missing');
    expect(within(self).getAllByRole('cell')[0]).toHaveTextContent(/^2$/);
  });

  it('requests the ranking url again and marks refresh as loading', async () => {
    const { RankingSection } = await loadSections();
    const pending = deferredResponse();
    let calls = 0;
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) {
        calls += 1;
        if (calls === 1) return jsonResponse(acmBoard());
        return pending.promise;
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const user = userEvent.setup();
    renderSection(RankingSection, rankingContest());
    expect(await screen.findByRole('columnheader', { name: '名次' })).toBeInTheDocument();
    const seen = calls;
    await user.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(calls).toBeGreaterThan(seen));
    expect(screen.getByRole('button', { name: '刷新' })).toHaveAttribute('aria-busy', 'true');
    pending.finish(jsonResponse(acmBoard()));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '刷新' })).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('places unpublished ranking inside a padded sunken panel', async () => {
    const { RankingSection } = await loadSections();
    const fetchMock = installFetch(() => hydroError('不应该请求排名。', 404));
    const view = renderSection(RankingSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      urls: urls({ ranking: null, overview: `/paper/${TID}` }),
    }));
    const title = await screen.findByText('成绩公布后才能看到排名');
    expect(screen.getByText('考试结束后公布')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const shell = sunkenRankingShell(view.container);
    const panel = borderedPanelAround(title);
    expect(shell.contains(panel)).toBe(true);
    expect(view.container.querySelector('.max-w-5xl')).toBeNull();
  });

  it('wraps a ranking load failure in a bordered panel', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return hydroError('排名暂时不可用。', 500);
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, rankingContest());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('排名暂时不可用。');
    const shell = sunkenRankingShell(view.container);
    const panel = borderedPanelAround(alert);
    expect(shell.contains(panel)).toBe(true);
    expect(view.container.querySelector('.max-w-5xl')).toBeNull();
  });

  it('wraps an empty ranking board in a bordered panel', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse({ rows: [], currentUserId: UID });
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, rankingContest());
    const title = await screen.findByText('还没有排名');
    const shell = sunkenRankingShell(view.container);
    const panel = borderedPanelAround(title);
    expect(shell.contains(panel)).toBe(true);
  });

  it('shows a score without a full mark when the full mark is unknown', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(scoreSelfBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const view = renderSection(RankingSection, rankingContest({ flavor: 'ioi' }));
    expect(await screen.findByRole('columnheader', { name: '总分' })).toBeInTheDocument();
    const text = rankingText(view.container);
    expect(text).toContain('我的名次');
    expect(text).toMatch(/\/\s*1(?!\d)/);
    expect(text).toContain('得分');
    expect(text).toMatch(/得分[\s\S]{0,24}88/);
    expect(text).not.toMatch(/得分[\s\S]{0,24}88\s*\//);
    expect(text).not.toContain('解题');
    expect(text).toMatch(/共\s*1\s*人/);
    expect(text).toContain('按总分排名，同分同名次');
    expect(screen.queryByText('封榜中')).toBeNull();
  });

  it('scrolls the signed-in row to the center', async () => {
    const { RankingSection } = await loadSections();
    installFetch((url) => {
      if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(acmBoard());
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const scrolled: Array<{ node: Element; options: unknown }> = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollTo(this: Element, options?: boolean | ScrollIntoViewOptions) {
      scrolled.push({ node: this, options });
    });
    try {
      const user = userEvent.setup();
      renderSection(RankingSection, rankingContest());
      expect(await screen.findByText('张三')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '定位到我' }));
      expect(scrolled.some((call) => (call.node.textContent ?? '').includes('张三') && isPlainRecord(call.options) && call.options.block === 'center')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('pins an aria-hidden copy while the signed-in row is outside the viewport', async () => {
    const restore = installVisibilityObserver();
    try {
      const { RankingSection } = await loadSections();
      installFetch((url) => {
        if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(acmBoard());
        return hydroError(`未知请求 ${url.pathname}`, 404);
      });
      const view = renderSection(RankingSection, rankingContest());
      expect(await screen.findByText('张三')).toBeInTheDocument();
      const observer = RankingVisibilityObserver.latest;
      expect(observer, 'ranking should observe whether the signed-in row is visible').not.toBeNull();
      if (!observer) throw new TypeError('visibility observer is missing');
      act(() => {
        observer.report(false);
      });
      await waitFor(() => expect(pinnedViewerRow(view.container)).not.toBeNull());
      const pinned = pinnedViewerRow(view.container);
      if (!pinned) throw new TypeError('pinned row is missing');
      expect(pinned.closest('table')).not.toBeNull();
      expect(pinned.textContent ?? '').toContain('2');
      expectPinnedRowSticks(pinned);
      const rows = [...(pinned.closest('table')?.querySelectorAll('tr') ?? [])];
      expect(rows[rows.length - 1]).toBe(pinned);
      expect(visibleViewerRow()).not.toBeNull();
      act(() => {
        observer.report(true);
      });
      await waitFor(() => expect(pinnedViewerRow(view.container)).toBeNull());
    } finally {
      restore();
    }
  });

  it('does not pin a row when intersection observer is missing', async () => {
    const previous = window.IntersectionObserver;
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      const { RankingSection } = await loadSections();
      installFetch((url) => {
        if (`${url.pathname}${url.search}` === RANKING_URL) return jsonResponse(acmBoard());
        return hydroError(`未知请求 ${url.pathname}`, 404);
      });
      const view = renderSection(RankingSection, rankingContest());
      expect(await screen.findByText('张三')).toBeInTheDocument();
      expect(pinnedViewerRow(view.container)).toBeNull();
    } finally {
      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        writable: true,
        value: previous,
      });
    }
  });

  it('renders announcements and stores the latest notice time', async () => {
    const { NoticeSection } = await loadSections();
    const view = renderSection(NoticeSection, workspace({
      kind: 'paper',
      flavor: 'paper',
      announcements: announcements(),
      urls: urls({ overview: `/paper/${TID}` }),
    }));
    expectFrame(view.container);
    expect(screen.getByText('选项更正')).toBeInTheDocument();
    expect(screen.getByText('作业已开放')).toBeInTheDocument();
    expect(screen.getByText('监考提醒')).toBeInTheDocument();
    expect(screen.getByText('选项已更正，不影响作答。')).toBeInTheDocument();
    expect(screen.getByText('14:40')).toBeInTheDocument();
    expect(screen.getByText('14:02')).toBeInTheDocument();
    expect(screen.getByText('14:20')).toBeInTheDocument();
    await waitFor(() => {
      expect(sameInstant(localStorage.getItem(`ws-notice:${TID}`), NOTICE_NEW)).toBe(true);
    });
  });

  it('shows an empty notice message when there are no announcements', async () => {
    const { NoticeSection } = await loadSections();
    const view = renderSection(NoticeSection, workspace({ announcements: [] }));
    expect(screen.getByText('还没有公告')).toBeInTheDocument();
    expectFrame(view.container);
  });

  it('lists a clarification and posts the existing clarification fields', async () => {
    const { ClarifySection } = await loadSections();
    const fetchMock = installFetch((url, init) => {
      if (init?.method === 'POST' && `${url.pathname}${url.search}` === CLARIFY_URL) return jsonResponse({ ok: true });
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const user = userEvent.setup();
    const view = renderSection(ClarifySection, workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      groups: [clarifyGroup()],
      clarifications: clarifications(),
      urls: urls({ clarify: CLARIFY_URL, overview: `/contest/${TID}` }),
    }));
    expectFrame(view.container);
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    expect(screen.getByText('14:35')).toBeInTheDocument();
    expect(screen.getByText('14:37')).toBeInTheDocument();
    const ask = screen.getByRole('button', { name: '提问' });
    expect(ask).toHaveAttribute('data-variant', 'secondary');
    await user.click(ask);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[name="subject"]')).not.toBeNull();
    const content = dialog.querySelector('textarea[name="content"]');
    if (!(content instanceof HTMLTextAreaElement)) throw new TypeError('content textarea is missing');
    await user.click(within(dialog).getByRole('combobox'));
    const problemOption = (await screen.findAllByRole('option')).find((option) => {
      const text = option.textContent ?? '';
      return text.includes(CLARIFY_LABEL) || text.includes(CLARIFY_TITLE);
    });
    if (!problemOption) throw new TypeError('problem subject option is missing');
    await user.click(problemOption);
    await user.type(content, ASKED);
    await user.click(dialogSubmit(dialog));
    await waitFor(() => {
      expect(postParams(fetchMock, CLARIFY_URL).length).toBeGreaterThan(0);
    });
    const params = postParams(fetchMock, CLARIFY_URL)[0];
    if (!params) throw new TypeError('clarification body is missing');
    expect([...params.keys()].sort()).toEqual(['content', 'operation', 'subject']);
    expect(params.get('operation')).toBe('clarification');
    expect(params.get('subject')).toBe(String(CLARIFY_PID));
    expect(params.get('content')).toBe(ASKED);
  });

  it('hides the ask button when clarification is closed', async () => {
    const { ClarifySection } = await loadSections();
    renderSection(ClarifySection, workspace({
      clarifications: clarifications(),
      urls: urls({ clarify: null }),
    }));
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提问' })).toBeNull();
  });

  it('links print to the existing print page', async () => {
    const { PrintSection } = await loadSections();
    const view = renderSection(PrintSection, workspace({
      mode: 'client',
      urls: urls({ print: PRINT_URL, overview: `/exam-mode/${TID}`, back: null }),
    }));
    expectFrame(view.container);
    expect(screen.getByText('打印件由监考老师送到座位。')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '打开打印' });
    expect(link).toHaveAttribute('href', PRINT_URL);
    expect(link).toHaveAttribute('data-variant', 'secondary');
  });
});
