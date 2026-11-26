import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { teachPath, type TeachType } from '@hydrooj/common';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { formatRelativeTime } from '../../src/lib/format.ts';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { GradeColumn, GradeRow } from '../../src/pages/teach/grades-model.ts';
import type { ReadyGrades } from '../../src/pages/teach/grades-load.ts';
import {
  formatTeachWindow,
  parseTeachCopySource,
  parseTeachListPayload,
  parseTeachWorkbenchPayload,
  type TeachListPayload,
  type TeachListRow,
  type TeachSharedRow,
  type TeachWorkbenchPayload,
} from '../../src/pages/teach/model.ts';

const downloadBlob = vi.hoisted(() => vi.fn<(filename: string, blob: Blob) => void>());
const buildXlsx = vi.hoisted(() => vi.fn<(sheets: readonly unknown[]) => Promise<Blob>>());
const loadGrades = vi.hoisted(() => vi.fn<(payload: TeachWorkbenchPayload) => Promise<ReadyGrades>>());

vi.mock('@/lib/download-zip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/download-zip')>();
  return { ...actual, downloadBlob };
});

vi.mock('@/lib/xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xlsx')>();
  return { ...actual, buildXlsx };
});

vi.mock('@/pages/teach/grades-load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/teach/grades-load')>();
  return { ...actual, loadGrades };
});

// A static import fails collection while list.tsx is absent.
const pageLoaders = import.meta.glob('../../src/pages/teach/list.tsx');

const LIST_SOURCE = 'src/pages/teach/list.tsx';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d54';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d55';
const ENDED_ID = '64b7c3a2e4b0f96d1a2c3d56';
const OI_ID = '64b7c3a2e4b0f96d1a2c3d57';
const HOMEWORK_A = '64b7c3a2e4b0f96d1a2c3d51';
const HOMEWORK_B = '64b7c3a2e4b0f96d1a2c3d52';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d53';
const ACM_TITLE = '第十二届程序设计校赛';
const PRACTICE_TITLE = '链表专项练习';
const ENDED_TITLE = '已结束的作业';
const OI_TITLE = 'CSP-J 模拟赛';
const HOMEWORK_A_TITLE = '栈与队列作业';
const HOMEWORK_B_TITLE = '线性表作业';
const EXAM_TITLE = '期中整卷考试';
const SHARER = '王老师';
const EXAM_SHARER = '李老师';
const SERVER_MESSAGE = '这份题目集现在预览不了。';
const MINE_DESCRIPTION = '你创建或协作管理的练习、作业、考试和比赛。';
const SHARED_DESCRIPTION = '其他老师在学校内共享的题目集。点「使用」会复制一份完全属于你的，时间和学生要重新填。';
const COPY_DIALOG_TITLE = '从已有题目集复制';
const COPY_DIALOG_DESCRIPTION = '新建一个同类型的题目集，带上题目、分值和设置。时间和学生要重新填。';
const EMPTY_TITLE = '还没有题目集';
const EMPTY_DESCRIPTION = '新建一个练习、作业、考试或比赛。';
const FILTERED_TITLE = '没有匹配的题目集';
const SHARED_EMPTY = '还没有老师共享题目集';
const CREATED_AT = '2026-10-11T12:00:00.000Z';
const ACM_BEGIN = '2026-10-11T01:00:00.000Z';
const ACM_END = '2026-10-11T06:00:00.000Z';
const SHARED_BEGIN = '2026-10-13T00:00:00.000Z';
const SHARED_END = '2026-10-20T15:59:00.000Z';
const EXAM_BEGIN = '2026-10-24T06:00:00.000Z';
const EXAM_END = '2026-10-24T08:00:00.000Z';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

interface DeferredResponse {
  promise: Promise<Response>;
  finish: (response: Response) => void;
}

function pageBootstrap(data: TeachListPayload, generatedAt = '2026-10-17T00:00:00.000Z'): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt,
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
    page: { templateName: 'teach_main.html', data },
  };
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(LIST_SOURCE)) return load;
  }
  return undefined;
}

async function importPageModule(load: () => Promise<unknown>): Promise<unknown> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
}

async function loadTeachListPage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, LIST_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${LIST_SOURCE} must exist`);
  }
  const imported = await importPageModule(load);
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('teach list module must be an object');
  }
  if (!('TeachListPage' in imported)) {
    throw new TypeError('TeachListPage must be exported');
  }
  const component: unknown = imported.TeachListPage;
  expect(typeof component, 'TeachListPage').toBe('function');
  if (typeof component !== 'function') {
    throw new TypeError('TeachListPage must be a function');
  }
  return component as ComponentType;
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

function deferredResponse(): DeferredResponse {
  let finish: (response: Response) => void = () => {
    throw new Error('preview response was not armed');
  };
  const promise = new Promise<Response>((done) => {
    finish = done;
  });
  return { promise, finish };
}

function installFetch(respond: (url: URL) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => Promise.resolve(respond(requestUrl(input))),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function canCreate(open: boolean): TeachListPayload['canCreate'] {
  return {
    practice: open,
    homework: open,
    exam: open,
    acm: open,
    oi: open,
  };
}

function counts(all: number, practice: number, homework: number, exam: number, contest: number): TeachListPayload['typeCounts'] {
  return {
    all, practice, homework, exam, contest,
  };
}

function listPayload(raw: Record<string, unknown>): TeachListPayload {
  return parseTeachListPayload(raw);
}

function rememberLocation(payload: TeachListPayload) {
  const params = new URLSearchParams();
  params.set('scope', payload.scope);
  params.set('type', payload.filter.type);
  params.set('status', payload.filter.status);
  if (payload.filter.q !== '') params.set('q', payload.filter.q);
  params.set('page', String(payload.page));
  window.history.replaceState(null, '', `/teach?${params.toString()}`);
}

function localDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function hrefUrl(element: Element): URL {
  const href = element.getAttribute('href');
  if (href === null || href === '') throw new TypeError('missing href');
  return new URL(href, 'http://krypton.local');
}

function tablistOf(name: string | RegExp): HTMLElement {
  const tab = screen.getByRole('tab', { name });
  const list = tab.closest('[role="tablist"]');
  if (!(list instanceof HTMLElement)) throw new TypeError('tablist');
  return list;
}

function tableRow(title: string): HTMLElement {
  const nodes = screen.getAllByText(title);
  for (const node of nodes) {
    const row = node.closest('tr');
    if (row instanceof HTMLElement) return row;
  }
  throw new TypeError(`missing table row for ${title}`);
}

function stackAnchor(title: string): HTMLAnchorElement {
  const lists = document.querySelectorAll('[data-slot="data-table"] ul');
  for (const list of lists) {
    for (const item of list.querySelectorAll(':scope > li')) {
      if (!(item instanceof HTMLElement)) continue;
      if (!(item.textContent ?? '').includes(title)) continue;
      const anchor = item.querySelector(':scope > a');
      if (anchor instanceof HTMLAnchorElement) return anchor;
    }
  }
  throw new TypeError(`missing stack card for ${title}`);
}

function columnText(row: HTMLElement, header: string): string {
  const table = row.closest('table');
  if (!(table instanceof HTMLTableElement)) throw new TypeError('table');
  const headers = [...table.querySelectorAll('thead th')].map((cell) => (cell.textContent ?? '').trim());
  const index = headers.indexOf(header);
  if (index < 0) throw new TypeError(`missing column ${header}`);
  const cell = [...row.querySelectorAll('td')][index];
  if (!(cell instanceof HTMLElement)) throw new TypeError(`missing cell ${header}`);
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function badgeOf(row: HTMLElement, text: string): HTMLElement {
  const node = within(row).getByText(text);
  const badge = node.getAttribute('data-slot') === 'badge' ? node : node.closest('[data-slot="badge"]');
  if (!(badge instanceof HTMLElement)) throw new TypeError(`badge ${text}`);
  return badge;
}

function statusCell(row: HTMLElement, label: string): HTMLElement {
  const nodes = within(row).getAllByText(label);
  for (const node of nodes) {
    const cell = node.closest('td');
    if (!(cell instanceof HTMLElement)) continue;
    if (cell.querySelector('.tabular')) continue;
    return cell;
  }
  throw new TypeError(`missing status cell ${label}`);
}

function primaryControls(): HTMLElement[] {
  return [...document.querySelectorAll('[data-variant="primary"]')].filter((node): node is HTMLElement => {
    return node instanceof HTMLElement;
  });
}

function outsideDialog(nodes: HTMLElement[]): HTMLElement[] {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  return nodes.filter((node) => dialogs.every((dialog) => !dialog.contains(node)));
}

function namedIn(row: HTMLElement, name: string): HTMLElement {
  const found = [
    ...within(row).queryAllByRole('link', { name }),
    ...within(row).queryAllByRole('button', { name }),
  ];
  expect(found, name).toHaveLength(1);
  const control = found[0];
  if (!(control instanceof HTMLElement)) throw new TypeError(name);
  return control;
}

function expectMediumTitle(link: HTMLElement, title: string) {
  const titled = link.className.split(/\s+/).includes('font-medium') ? link : link.querySelector('.font-medium');
  if (!(titled instanceof HTMLElement)) throw new TypeError(`font-medium title ${title}`);
  expect(titled.className.split(/\s+/)).toContain('font-medium');
  expect(titled.textContent ?? '').toContain(title);
}

async function expectNewTab(
  user: ReturnType<typeof userEvent.setup>,
  opened: { mock: { calls: unknown[][] } },
  href: string,
) {
  const item = screen.getByRole('menuitem', { name: '学生视角' });
  const link = item instanceof HTMLAnchorElement ? item : item.querySelector('a');
  if (link instanceof HTMLAnchorElement) {
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    return;
  }
  await user.click(item);
  const matched = opened.mock.calls.some((args) => args[0] === href && args[1] === '_blank');
  expect(matched).toBe(true);
}

function detailFor(dialog: HTMLElement, term: string): string {
  const terms = within(dialog).getAllByRole('term');
  const node = terms.find((item) => item.textContent === term);
  if (!node) throw new TypeError(`missing term ${term}`);
  const value = node.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new TypeError(`missing detail ${term}`);
  return (value.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function studentHref(type: TeachType, id: string): string {
  if (type === 'practice') return `/problem-sets/${id}`;
  if (type === 'homework') return `/homework/${id}`;
  return `/contest/${id}`;
}

function contestSettings(): Record<string, unknown> {
  return {
    kind: 'contest',
    rated: false,
    autoHide: false,
    hidden: false,
    lockMinutes: null,
    allowViewCode: false,
    allowPrint: false,
    keepScoreboardHidden: false,
    allowVirtual: null,
    allowPostContestPractice: null,
    allowPostContestView: null,
    allowPostContestSubmit: null,
    langs: [],
    examShowVerdict: null,
    examPassScore: null,
    examAttemptLimit: null,
  };
}

function copySource(raw: Record<string, unknown>): Record<string, unknown> {
  parseTeachCopySource(raw);
  return raw;
}

function homeworkSource(id: string, title: string): Record<string, unknown> {
  return copySource({
    type: 'homework',
    id,
    title,
    content: '按顺序完成。',
    description: '',
    ownerUid: 9,
    ownerName: SHARER,
    mine: false,
    rule: 'homework',
    beginAt: SHARED_BEGIN,
    endAt: SHARED_END,
    durationMinutes: null,
    pids: [8, 9],
    problems: [
      { docId: 8, pid: 'P2001', title: '队列选择', kind: 'single' },
      { docId: 9, pid: 'P2002', title: '括号匹配', kind: 'programming' },
    ],
    scores: { 8: 5, 9: 20 },
    examPaperQuotas: null,
    stages: null,
    settings: {
      kind: 'homework', rated: false, langs: [], extensionDays: 0, penaltyRules: {},
    },
    unusablePids: [],
  });
}

function examSource(): Record<string, unknown> {
  return copySource({
    type: 'exam',
    id: EXAM_ID,
    title: EXAM_TITLE,
    content: '闭卷。',
    description: '',
    ownerUid: 11,
    ownerName: EXAM_SHARER,
    mine: false,
    rule: 'exam',
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: 90,
    pids: [8, 9],
    problems: [
      { docId: 8, pid: 'P2001', title: '队列选择', kind: 'single' },
      { docId: 9, pid: 'P2002', title: '括号匹配', kind: 'programming' },
    ],
    scores: { 8: 5, 9: 20 },
    examPaperQuotas: { single: 1 },
    stages: null,
    settings: contestSettings(),
    unusablePids: [],
  });
}

function acmRow(): TeachListRow {
  return {
    type: 'acm',
    id: ACM_ID,
    rule: 'acm',
    title: ACM_TITLE,
    status: 'running',
    beginAt: ACM_BEGIN,
    endAt: ACM_END,
    durationMinutes: null,
    audience: '本校学生',
    problemCount: 10,
    drawCount: null,
    stageCount: null,
    participantCount: 214,
    role: 'maintainer',
    shared: true,
    createdAt: CREATED_AT,
  };
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
    audience: '所有人',
    problemCount: 18,
    drawCount: null,
    stageCount: 3,
    participantCount: 53,
    role: 'owner',
    shared: false,
    createdAt: CREATED_AT,
  };
}

function endedRow(): TeachListRow {
  return {
    type: 'homework',
    id: ENDED_ID,
    rule: 'homework',
    title: ENDED_TITLE,
    status: 'ended',
    beginAt: SHARED_BEGIN,
    endAt: SHARED_END,
    durationMinutes: null,
    audience: '计科 2401',
    problemCount: 4,
    drawCount: null,
    stageCount: null,
    participantCount: 71,
    role: 'admin',
    shared: false,
    createdAt: CREATED_AT,
  };
}

function drawRow(): TeachListRow {
  return {
    type: 'exam',
    id: EXAM_ID,
    rule: 'exam',
    title: EXAM_TITLE,
    status: 'upcoming',
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: 90,
    audience: '软工 2501',
    problemCount: 2,
    drawCount: 1,
    stageCount: null,
    participantCount: 0,
    role: 'owner',
    shared: false,
    createdAt: CREATED_AT,
  };
}

function oiRow(): TeachListRow {
  return {
    type: 'oi',
    id: OI_ID,
    rule: 'ioi',
    title: OI_TITLE,
    status: 'upcoming',
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: null,
    audience: 'ACM 集训队',
    problemCount: 4,
    drawCount: null,
    stageCount: null,
    participantCount: 28,
    role: 'owner',
    shared: false,
    createdAt: CREATED_AT,
  };
}

function sharedHomework(id: string, title: string, sharedAt?: string): TeachSharedRow {
  return {
    type: 'homework',
    id,
    rule: 'homework',
    title,
    ownerUid: 9,
    ownerName: SHARER,
    problemCount: 9,
    drawCount: null,
    beginAt: SHARED_BEGIN,
    endAt: SHARED_END,
    durationMinutes: null,
    sharedAt: sharedAt ?? new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
  };
}

function sharedExam(): TeachSharedRow {
  return {
    type: 'exam',
    id: EXAM_ID,
    rule: 'exam',
    title: EXAM_TITLE,
    ownerUid: 11,
    ownerName: EXAM_SHARER,
    problemCount: 2,
    drawCount: 1,
    beginAt: EXAM_BEGIN,
    endAt: EXAM_END,
    durationMinutes: 90,
    sharedAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
  };
}

function shell(options: {
  scope?: TeachListPayload['scope'];
  canSeeAll?: boolean;
  type?: TeachListPayload['filter']['type'];
  status?: TeachListPayload['filter']['status'];
  q?: string;
  page?: number;
  pageCount?: number;
  rows?: TeachListRow[];
  sharedRows?: TeachSharedRow[];
  creatable?: boolean;
  typeCounts?: TeachListPayload['typeCounts'];
}): TeachListPayload {
  const rows = options.rows ?? [];
  const sharedRows = options.sharedRows ?? [];
  const total = options.scope === 'shared' ? sharedRows.length : rows.length;
  return listPayload({
    scope: options.scope ?? 'mine',
    canSeeAll: options.canSeeAll ?? false,
    filter: {
      type: options.type ?? 'all',
      status: options.status ?? 'all',
      q: options.q ?? '',
    },
    typeCounts: options.typeCounts ?? counts(total, 0, 0, 0, 0),
    page: options.page ?? 1,
    pageCount: options.pageCount ?? 1,
    total,
    rows,
    sharedRows,
    canCreate: canCreate(options.creatable ?? true),
  });
}

function mineFixture(): TeachListPayload {
  return shell({
    rows: [acmRow(), practiceRow()],
    typeCounts: counts(2, 1, 0, 1, 0),
  });
}

function installLocationAssign(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: saved.href, assign },
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, 'location', { configurable: true, value: saved });
    },
  };
}

async function renderList(payload: TeachListPayload, generatedAt?: string) {
  rememberLocation(payload);
  const Page = await loadTeachListPage();
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(payload, generatedAt)}>
      <Page />
    </BootstrapProvider>,
  );
}

async function openPreview(fetchMock: FetchMock, title: string, pathname: string) {
  const user = userEvent.setup();
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(namedIn(tableRow(title), '预览'));
  await waitFor(() => {
    expect(listUrls(fetchMock).some((url) => url.pathname === pathname)).toBe(true);
  });
  return user;
}

function checkboxesWithin(root: HTMLElement): HTMLInputElement[] {
  return within(root).queryAllByRole('checkbox').filter((node): node is HTMLInputElement => {
    return node instanceof HTMLInputElement;
  });
}

function stackCard(title: string): HTMLElement {
  const card = stackAnchor(title).closest('li');
  if (!(card instanceof HTMLElement)) throw new TypeError(`missing stack card for ${title}`);
  return card;
}

function enabledCheckboxes(root: HTMLElement): HTMLInputElement[] {
  return checkboxesWithin(root).filter((box) => !box.disabled);
}

function disabledCheckboxes(root: HTMLElement): HTMLInputElement[] {
  return checkboxesWithin(root).filter((box) => box.disabled);
}

function usableCheckbox(title: string): HTMLInputElement {
  const enabled = enabledCheckboxes(tableRow(title));
  expect(enabled, title).toHaveLength(1);
  const box = enabled[0];
  if (box === undefined) throw new TypeError(title);
  return box;
}

function expectUsableStackCheckbox(title: string) {
  expect(enabledCheckboxes(stackCard(title)), title).toHaveLength(1);
}

function expectNoUsableCheckbox(title: string) {
  const row = tableRow(title);
  const card = stackCard(title);
  expect(enabledCheckboxes(row), title).toHaveLength(0);
  expect(enabledCheckboxes(card), title).toHaveLength(0);
  expect(disabledCheckboxes(row), `${title} table`).toHaveLength(1);
  expect(disabledCheckboxes(card), `${title} card`).toHaveLength(1);
}

function gradedRow(type: 'homework' | 'exam', id: string, title: string): TeachListRow {
  const base = type === 'exam' ? drawRow() : endedRow();
  return {
    ...base,
    type,
    id,
    title,
    rule: type,
    role: 'owner',
    shared: false,
    status: 'running',
  };
}

function expectBarAboveTable(label: string) {
  const bar = screen.getByText(label);
  const table = document.querySelector('[data-slot="data-table"]');
  if (!(table instanceof HTMLElement)) throw new TypeError('table');
  expect(bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

const SUMMARY_COLUMNS: GradeColumn[] = [
  { key: 'studentId', header: '学号', align: 'left' },
  { key: 'name', header: '姓名', align: 'left' },
  { key: 'total', header: '总分', align: 'right' },
];

function summaryGradeRow(studentId: string, name: string, total: string): GradeRow {
  return {
    key: `${studentId}:${name}:${total}`,
    studentId,
    name,
    groupNames: '',
    groupIds: [],
    searchText: `${studentId}\n${name}`,
    cells: { studentId, name, total },
    tones: {},
    attempts: {},
  };
}

function summaryGrades(rows: GradeRow[]): ReadyGrades {
  return {
    columns: SUMMARY_COLUMNS,
    rows,
    groups: [],
    truncated: false,
    practice: null,
  };
}

function workbenchBody(type: 'homework' | 'exam', id: string, title: string): Record<string, unknown> {
  return {
    container: {
      type,
      id,
      rule: type,
      title,
      status: 'running',
      beginAt: '2026-10-17T00:00:00.000Z',
      endAt: '2026-10-18T00:00:00.000Z',
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'groups', groupNames: ['计科 2401'], schoolNames: [], boundStudentCount: 3,
      },
      owner: { uid: 7, name: '王老师' },
      maintainers: [],
      createdAt: CREATED_AT,
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: type === 'homework' ? `/homework/${id}` : `/contest/${id}`,
        scoreboard: type === 'homework' ? `/homework/${id}/scoreboard` : `/contest/${id}/scoreboard`,
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
      },
    },
    paper: { problems: [], stages: null, examPaperQuotas: null },
    stats: {
      participantCount: 3,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: 3,
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

function loadedPayload(call: unknown[] | undefined): TeachWorkbenchPayload {
  const payload = call?.[0];
  if (typeof payload !== 'object' || payload === null || !('container' in payload)) {
    throw new TypeError('loadGrades payload');
  }
  return payload as TeachWorkbenchPayload;
}

function readBuiltSheets(value: unknown): Array<{ name: string; rows: unknown[][] }> {
  if (!Array.isArray(value)) throw new TypeError('buildXlsx expected a list of sheets');
  return value.map((sheet) => {
    if (typeof sheet !== 'object' || sheet === null) throw new TypeError('summary sheet is missing');
    const name = Reflect.get(sheet, 'name');
    const rows = Reflect.get(sheet, 'rows');
    if (typeof name !== 'string' || !Array.isArray(rows)) throw new TypeError('summary sheet is incomplete');
    return {
      name,
      rows: rows.map((row) => {
        if (!Array.isArray(row)) throw new TypeError('summary sheet row is not an array');
        return row;
      }),
    };
  });
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('teach list page', () => {
  it('switches to the shared calendar component and back without changing student preference', async () => {
    localStorage.setItem('krypton:problem-sets-view', 'list');
    const requests: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
      requests.push(url);
      return new Response(JSON.stringify({
        view: 'calendar', from: url.searchParams.get('from'), to: url.searchParams.get('to'), rows: [],
      }), { headers: { 'Content-Type': 'application/json' } });
    }));
    await renderList(mineFixture());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: '日历' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.pathname).toBe('/teach');
    expect(requests[0]?.searchParams.get('view')).toBe('calendar');
    expect(requests[0]?.searchParams.get('scope')).toBe('mine');
    expect(screen.queryByRole('table')).toBeNull();
    expect(localStorage.getItem('krypton:teach-sets-view')).toBe('calendar');
    expect(localStorage.getItem('krypton:problem-sets-view')).toBe('list');
    await user.click(screen.getByRole('tab', { name: '列表' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('labels a configured contest preset by purpose while keeping its existing workbench route', async () => {
    const row = { ...acmRow(), type: 'exam' as const, rule: 'contest', setPurpose: 'contest' as const };
    await renderList(shell({ rows: [row], typeCounts: counts(1, 0, 1, 0, 0) }));
    const rendered = tableRow(ACM_TITLE);
    expect(badgeOf(rendered, '比赛')).toBeInTheDocument();
    expect(within(rendered).getByRole('link', { name: ACM_TITLE })).toHaveAttribute('href', `/teach/exam/${ACM_ID}`);
  });

  it('links mine rows to the workbench and shows collaborator and owner roles', async () => {
    const payload = mineFixture();
    await renderList(payload);

    expect(screen.getByRole('heading', { level: 1, name: '题目集' })).toBeInTheDocument();
    expect(screen.getByText(MINE_DESCRIPTION)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'wide');
    expect(document.querySelector('[data-slot="data-table"]')).toHaveAttribute('data-mobile', 'stack');

    const acm = tableRow(ACM_TITLE);
    const practice = tableRow(PRACTICE_TITLE);
    const acmLink = within(acm).getByRole('link', { name: ACM_TITLE });
    const practiceLink = within(practice).getByRole('link', { name: PRACTICE_TITLE });
    expect(acmLink).toHaveAttribute('href', `/teach/acm/${ACM_ID}`);
    expect(practiceLink).toHaveAttribute('href', `/teach/practice/${PRACTICE_ID}`);
    expectMediumTitle(acmLink, ACM_TITLE);
    expectMediumTitle(practiceLink, PRACTICE_TITLE);
    expect(within(acm).getByText('协作者')).toBeInTheDocument();
    expect(within(practice).getByText('所有者')).toBeInTheDocument();

    const acmBadge = badgeOf(acm, '比赛');
    expect(acmBadge).toHaveAttribute('data-variant', 'outline');
    expect(acmBadge.className).toContain('h-4.5');
    expect(badgeOf(practice, '练习')).toHaveAttribute('data-variant', 'outline');
    expect(badgeOf(acm, '学校共享中').className).toContain('h-4.5');
    expect(within(practice).queryByText('学校共享中')).toBeNull();
    expect(within(acm).getByText(`创建于 ${localDay(CREATED_AT)}`)).toBeInTheDocument();
    expect(within(practice).getByText(`创建于 ${localDay(CREATED_AT)}`)).toBeInTheDocument();

    const running = statusCell(acm, '进行中');
    expect(running.querySelector('.bg-success')).not.toBeNull();
    expect(running.querySelector('[class*="kr-pulse-dot"]')).not.toBeNull();
    const openCell = statusCell(practice, '不限时');
    expect(openCell.querySelector('.size-2')).toBeNull();
    expect(openCell.textContent?.replace(/\s+/g, ' ').trim()).toBe('不限时');

    const acmWindow = formatTeachWindow({
      type: 'acm',
      beginAt: ACM_BEGIN,
      endAt: ACM_END,
      durationMinutes: null,
    }, new Date());
    const time = within(acm).getByText(acmWindow);
    expect(time.className).toContain('tabular');
    expect(time.className).toContain('text-fg-muted');
    const audience = within(acm).getByText('本校学生');
    expect(audience.className).toContain('truncate');
    expect(within(acm).getByText('10')).toBeInTheDocument();
    expect(within(acm).getByText('214 人')).toBeInTheDocument();
    expect(within(practice).getByText('18 · 3 个阶段')).toBeInTheDocument();
    expect(within(practice).getByText('53 人')).toBeInTheDocument();
    expect(within(practice).getByText('所有人')).toBeInTheDocument();
  });

  it('keeps status and the other query params, and drops page, on the quiz filter', async () => {
    const user = userEvent.setup();
    const payload = shell({
      scope: 'all',
      canSeeAll: true,
      status: 'running',
      q: '图',
      page: 2,
      pageCount: 3,
      rows: [acmRow()],
      creatable: true,
      typeCounts: counts(14, 2, 7, 1, 4),
    });
    await renderList(payload);

    const typeList = tablistOf(/作业/);
    expect(within(typeList).getAllByRole('tab')).toHaveLength(5);
    const expectedType: Record<string, string> = {
      全部: 'all',
      练习: 'practice',
      作业: 'homework',
      考试: 'exam',
      比赛: 'contest',
    };
    const expectedCount: Record<string, string> = {
      全部: '14',
      练习: '2',
      作业: '7',
      考试: '1',
      比赛: '4',
    };
    for (const [label, type] of Object.entries(expectedType)) {
      const tab = within(typeList).getByRole('tab', { name: new RegExp(label) });
      const url = hrefUrl(tab);
      expect(url.pathname).toBe('/teach');
      expect(url.searchParams.get('status')).toBe('running');
      expect(url.searchParams.get('scope')).toBe('all');
      expect(url.searchParams.get('q')).toBe('图');
      expect(url.searchParams.has('page')).toBe(false);
      if (label === '全部') {
        const current = url.searchParams.get('type');
        expect(current === null || current === 'all').toBe(true);
      } else {
        expect(url.searchParams.get('type')).toBe(type);
      }
      const count = within(tab).getByText(expectedCount[label] ?? '');
      expect(count.className.split(/\s+/)).toContain('w-5');
      expect(count.className.split(/\s+/)).toContain('tabular');
    }

    const scopeList = tablistOf('我的');
    expect(within(scopeList).getAllByRole('tab')).toHaveLength(3);
    expect(within(scopeList).getByRole('tab', { name: '全部' })).toBeInTheDocument();

    const search = screen.getByPlaceholderText('搜索标题');
    expect(search).toHaveAttribute('name', 'q');
    expect(search).toHaveValue('图');
    const form = search.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new TypeError('search form');
    expect(form.method).toBe('get');
    expect(form.querySelector('input[name="scope"]')).toHaveValue('all');
    expect(form.querySelector('input[name="type"]')).toHaveValue('all');
    expect(form.querySelector('input[name="status"]')).toHaveValue('running');

    const previous = hrefUrl(screen.getByRole('link', { name: '上一页' }));
    const next = hrefUrl(screen.getByRole('link', { name: '下一页' }));
    expect(previous.searchParams.getAll('page')).toEqual(['1']);
    expect(next.searchParams.getAll('page')).toEqual(['3']);
    expect(next.searchParams.get('status')).toBe('running');
    expect(next.searchParams.get('scope')).toBe('all');
    expect(next.searchParams.get('q')).toBe('图');
    const nextType = next.searchParams.get('type');
    expect(nextType === null || nextType === 'all').toBe(true);

    const select = screen.getByRole('combobox', { name: '状态' });
    expect(select.className).toContain('w-32');
    await user.click(select);
    for (const label of ['全部状态', '即将开始', '进行中', '已结束', '不限时']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('shows only mine and shared scope tabs when the viewer cannot see all', async () => {
    await renderList(shell({
      canSeeAll: false,
      status: 'ended',
      page: 2,
      pageCount: 2,
      rows: [practiceRow()],
    }));

    const scopeList = tablistOf('我的');
    expect(within(scopeList).getAllByRole('tab')).toHaveLength(2);
    expect(within(scopeList).queryByRole('tab', { name: '全部' })).toBeNull();
    const mine = hrefUrl(within(scopeList).getByRole('tab', { name: '我的' }));
    const shared = hrefUrl(within(scopeList).getByRole('tab', { name: '学校共享' }));
    expect(mine.searchParams.get('scope')).toBe('mine');
    expect(shared.searchParams.get('scope')).toBe('shared');
    expect(mine.searchParams.has('page')).toBe(false);
    expect(shared.searchParams.has('page')).toBe(false);
    expect(shared.searchParams.get('status')).toBe('ended');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('links each shared homework to copy and previews that set', async () => {
    const pending = deferredResponse();
    const fetchMock = installFetch((url) => {
      expect(url.pathname).toBe(`/teach/homework/${HOMEWORK_A}/copyable`);
      return pending.promise;
    });
    const firstShared = sharedHomework(HOMEWORK_A, HOMEWORK_A_TITLE);
    const secondShared = sharedHomework(HOMEWORK_B, HOMEWORK_B_TITLE);
    const previewSource = homeworkSource(HOMEWORK_A, HOMEWORK_A_TITLE);
    await renderList(shell({
      scope: 'shared',
      sharedRows: [firstShared, secondShared],
      typeCounts: counts(2, 0, 2, 0, 0),
    }));

    expect(screen.getByText(SHARED_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    const first = tableRow(HOMEWORK_A_TITLE);
    const second = tableRow(HOMEWORK_B_TITLE);
    expect(namedIn(first, '使用这个题目集')).toHaveAttribute('href', `/teach/new?copy=homework:${HOMEWORK_A}`);
    expect(namedIn(second, '使用这个题目集')).toHaveAttribute('href', `/teach/new?copy=homework:${HOMEWORK_B}`);
    expect(badgeOf(first, '作业')).toHaveAttribute('data-variant', 'outline');
    expect(screen.queryAllByRole('link').some((link) => link.getAttribute('href') === `/teach/homework/${HOMEWORK_A}`)).toBe(false);
    expect(screen.queryAllByRole('link').some((link) => link.getAttribute('href') === `/teach/homework/${HOMEWORK_B}`)).toBe(false);
    expect(within(first).getByText(SHARER)).toBeInTheDocument();
    expect(within(first).getByText('9')).toBeInTheDocument();
    const sharedWindow = formatTeachWindow({
      type: 'homework',
      beginAt: SHARED_BEGIN,
      endAt: SHARED_END,
      durationMinutes: null,
    }, new Date());
    expect(within(first).getByText(sharedWindow)).toBeInTheDocument();
    expect(compact(first.textContent ?? '')).toContain(compact(formatRelativeTime(firstShared.sharedAt, 'zh_CN')));

    const dialogsBefore = screen.queryByRole('dialog');
    expect(dialogsBefore).toBeNull();
    await openPreview(fetchMock, HOMEWORK_A_TITLE, `/teach/homework/${HOMEWORK_A}/copyable`);
    const loading = screen.getByRole('dialog');
    expect(loading.querySelector('.skeleton')).not.toBeNull();

    pending.finish(jsonResponse(previewSource));

    const dialog = await screen.findByRole('dialog', { name: HOMEWORK_A_TITLE });
    expect(dialog.className).toContain('sm:max-w-lg');
    expect(within(dialog).getByText(`${SHARER} 共享 · 作业`)).toBeInTheDocument();
    expect(detailFor(dialog, '类型')).toBe('作业');
    expect(detailFor(dialog, '原来的时间')).toBe(sharedWindow);
    expect(detailFor(dialog, '题目数')).toContain('2');
    expect(within(dialog).getByText('单选题')).toBeInTheDocument();
    expect(within(dialog).getByText('编程题')).toBeInTheDocument();
    expect(within(dialog).getByText('P2001')).toBeInTheDocument();
    expect(within(dialog).getByText('队列选择')).toBeInTheDocument();
    expect(within(dialog).getByText('P2002')).toBeInTheDocument();
    expect(within(dialog).getByText('括号匹配')).toBeInTheDocument();
    expect(dialog.querySelector('.skeleton')).toBeNull();
    const useIt = [...dialog.querySelectorAll('[data-variant="primary"]')];
    expect(useIt).toHaveLength(1);
    expect(useIt[0]).toHaveAttribute('href', `/teach/new?copy=homework:${HOMEWORK_A}`);
    expect(useIt[0]).toHaveAccessibleName('使用这个题目集');
    const closes = within(dialog).getAllByRole('button', { name: '关闭' });
    expect(closes.some((button) => button.getAttribute('data-variant') === 'secondary')).toBe(true);
    expect(outsideDialog(primaryControls())).toHaveLength(1);
  });

  it('shows an absolute timestamp when a set was shared more than seven days ago', async () => {
    const sharedAt = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)).toISOString();
    const aged = sharedHomework(HOMEWORK_B, HOMEWORK_B_TITLE, sharedAt);
    await renderList(shell({
      scope: 'shared',
      sharedRows: [aged],
      typeCounts: counts(1, 0, 1, 0, 0),
    }));

    const text = columnText(tableRow(HOMEWORK_B_TITLE), '共享于');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(text.includes('天前')).toBe(false);
    expect(text.includes('个月')).toBe(false);
  });

  it('shows the draw sentence in the shared exam preview', async () => {
    const pending = deferredResponse();
    const fetchMock = installFetch(() => pending.promise);
    const previewSource = examSource();
    await renderList(shell({
      scope: 'shared',
      sharedRows: [sharedExam()],
      typeCounts: counts(1, 0, 1, 0, 0),
    }));

    expect(within(tableRow(EXAM_TITLE)).getByText('题库 2 · 每人 1')).toBeInTheDocument();
    expect(namedIn(tableRow(EXAM_TITLE), '使用这个题目集')).toHaveAttribute('href', `/teach/new?copy=exam:${EXAM_ID}`);
    await openPreview(fetchMock, EXAM_TITLE, `/teach/exam/${EXAM_ID}/copyable`);
    pending.finish(jsonResponse(previewSource));

    const dialog = await screen.findByRole('dialog', { name: EXAM_TITLE });
    expect(within(dialog).getByText(`${EXAM_SHARER} 共享 · 考试`)).toBeInTheDocument();
    const examWindow = formatTeachWindow({
      type: 'exam',
      beginAt: EXAM_BEGIN,
      endAt: EXAM_END,
      durationMinutes: 90,
    }, new Date());
    expect(detailFor(dialog, '原来的时间')).toBe(examWindow);
    expect(detailFor(dialog, '题目数')).toBe('题库 2 道，每人 1 道');
    const useIt = [...dialog.querySelectorAll('[data-variant="primary"]')];
    expect(useIt).toHaveLength(1);
    expect(useIt[0]).toHaveAttribute('href', `/teach/new?copy=exam:${EXAM_ID}`);
  });

  it('shows a danger alert when the shared preview fails', async () => {
    const pending = deferredResponse();
    const fetchMock = installFetch(() => pending.promise);
    await renderList(shell({
      scope: 'shared',
      sharedRows: [sharedHomework(HOMEWORK_A, HOMEWORK_A_TITLE)],
    }));

    await openPreview(fetchMock, HOMEWORK_A_TITLE, `/teach/homework/${HOMEWORK_A}/copyable`);
    pending.finish(hydroError(SERVER_MESSAGE));

    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(SERVER_MESSAGE);
    expect(dialog.querySelector('.skeleton')).toBeNull();
    expect(within(dialog).queryByText('队列选择')).toBeNull();
  });

  it('shows one primary button while the preview dialog is closed', async () => {
    await renderList(mineFixture());

    expect(screen.queryByRole('dialog')).toBeNull();
    const primary = outsideDialog(primaryControls());
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAccessibleName('新建题目集');
    expect(primary[0]).toHaveAttribute('href', '/teach/new');
    expect(primary[0]).toHaveAttribute('data-variant', 'primary');
    const copy = screen.getByRole('button', { name: '从已有复制' });
    expect(copy).toHaveAttribute('data-variant', 'secondary');
  });

  it('hides the create button when every type is closed', async () => {
    await renderList(shell({
      rows: [practiceRow()],
      creatable: false,
    }));

    expect(primaryControls()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: '新建题目集' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建题目集' })).toBeNull();
    expect(screen.getByRole('button', { name: '从已有复制' })).toBeInTheDocument();
    expect(screen.getByText(PRACTICE_TITLE)).toBeInTheDocument();
  });

  it('shows the empty state and a secondary create action when nothing exists', async () => {
    await renderList(shell({ rows: [] }));

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(FILTERED_TITLE)).toBeNull();
    const created = screen.getAllByRole('link', { name: '新建题目集' });
    expect(created).toHaveLength(2);
    expect(created.every((link) => link.getAttribute('href') === '/teach/new')).toBe(true);
    const variants = created.map((link) => link.getAttribute('data-variant'));
    expect(variants.filter((variant) => variant === 'primary')).toHaveLength(1);
    expect(variants.filter((variant) => variant === 'secondary')).toHaveLength(1);
  });

  it('clears the active filters back to the current scope', async () => {
    await renderList(shell({
      scope: 'all',
      canSeeAll: true,
      q: '栈',
      rows: [],
    }));

    expect(screen.getByText(FILTERED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    const clear = screen.getByRole('link', { name: '清除筛选' });
    expect(clear).toHaveAttribute('href', '/teach?scope=all');
    expect(clear).toHaveAttribute('data-variant', 'secondary');
  });

  it('shows the shared empty state without the mine empty copy', async () => {
    await renderList(shell({
      scope: 'shared',
      sharedRows: [],
    }));

    expect(screen.getByText(SHARED_EMPTY)).toBeInTheDocument();
    expect(screen.getByText(SHARED_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(FILTERED_TITLE)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('opens the copy dialog from the header', async () => {
    const fetchMock = installFetch(() => jsonResponse(shell({ rows: [] })));
    const user = userEvent.setup();
    await renderList(mineFixture());

    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '从已有复制' }));
    const dialog = await screen.findByRole('dialog', { name: COPY_DIALOG_TITLE });
    expect(within(dialog).getByText(COPY_DIALOG_DESCRIPTION)).toBeInTheDocument();
    await waitFor(() => {
      expect(listUrls(fetchMock).some((url) => url.pathname === '/teach' && url.searchParams.get('scope') === 'mine')).toBe(true);
    });
    expect(outsideDialog(primaryControls())).toHaveLength(1);
    expect([...dialog.querySelectorAll('[data-variant="primary"]')]).toHaveLength(0);
  });

  it('offers the workbench, a new-tab student view, and copy from the row menu', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderList(mineFixture());

    const menuButton = namedIn(tableRow(ACM_TITLE), '更多操作');
    const raised = menuButton.closest('.relative.z-10');
    expect(raised).toBeTruthy();
    expect(raised?.querySelector('a.absolute.inset-0')).toBeNull();
    await user.click(menuButton);
    expect(await screen.findByRole('menuitem', { name: '打开工作台' })).toHaveAttribute('href', `/teach/acm/${ACM_ID}`);
    expect(screen.getByRole('menuitem', { name: '复制为新题目集' })).toHaveAttribute('href', `/teach/new?copy=acm:${ACM_ID}`);
    await expectNewTab(user, opened, studentHref('acm', ACM_ID));

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: '打开工作台' })).toBeNull();
    });
    await user.click(namedIn(tableRow(PRACTICE_TITLE), '更多操作'));
    expect(await screen.findByRole('menuitem', { name: '打开工作台' })).toHaveAttribute('href', `/teach/practice/${PRACTICE_ID}`);
    expect(screen.getByRole('menuitem', { name: '复制为新题目集' })).toHaveAttribute('href', `/teach/new?copy=practice:${PRACTICE_ID}`);
    await expectNewTab(user, opened, studentHref('practice', PRACTICE_ID));
  });

  it('opens the student view from the stacked card without activating the card link', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const practice = practiceRow();
    const homework = endedRow();
    const acm = acmRow();
    await renderList(shell({
      rows: [practice, homework, acm],
      typeCounts: counts(3, 1, 1, 1, 0),
    }));

    const cases: Array<{ title: string; type: TeachType; id: string }> = [
      { title: practice.title, type: 'practice', id: practice.id },
      { title: homework.title, type: 'homework', id: homework.id },
      { title: acm.title, type: 'acm', id: acm.id },
    ];
    for (const item of cases) {
      const anchor = stackAnchor(item.title);
      expect(anchor.closest('tr')).toBeNull();
      expect(anchor).toHaveAttribute('href', teachPath(item.type, item.id));
      const trigger = anchor.querySelector('button[aria-label="更多操作"]');
      expect(trigger).toBeInstanceOf(HTMLButtonElement);
      if (!(trigger instanceof HTMLButtonElement)) throw new TypeError('更多操作');
      const spy = vi.fn();
      anchor.addEventListener('click', spy);
      await user.click(trigger);
      expect(spy).not.toHaveBeenCalled();
      expect(await screen.findByRole('menuitem', { name: '学生视角' })).toBeInTheDocument();
      await user.click(screen.getByRole('menuitem', { name: '学生视角' }));
      expect(spy).not.toHaveBeenCalled();
      const call = opened.mock.calls.at(-1);
      expect(call?.[0]).toBe(studentHref(item.type, item.id));
      expect(call?.[1]).toBe('_blank');
      opened.mockClear();
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('menuitem', { name: '学生视角' })).toBeNull();
      });
      anchor.removeEventListener('click', spy);
    }
  });

  it('shows upcoming and ended status marks, the admin role, and the draw count', async () => {
    await renderList(shell({
      rows: [drawRow(), endedRow()],
      typeCounts: counts(2, 0, 2, 0, 0),
    }));

    const upcoming = statusCell(tableRow(EXAM_TITLE), '即将开始');
    expect(upcoming.querySelector('.bg-info')).not.toBeNull();
    expect(upcoming.querySelector('[class*="kr-pulse-dot"]')).toBeNull();
    const ended = statusCell(tableRow(ENDED_TITLE), '已结束');
    expect(ended.querySelector('.rounded-full.bg-fg-subtle')).not.toBeNull();
    expect(ended.querySelector('[class*="kr-pulse-dot"]')).toBeNull();
    expect(within(tableRow(ENDED_TITLE)).getByText('管理员')).toBeInTheDocument();
    expect(within(tableRow(EXAM_TITLE)).getByText('题库 2 · 每人 1')).toBeInTheDocument();
    const limited = formatTeachWindow({
      type: 'exam',
      beginAt: EXAM_BEGIN,
      endAt: EXAM_END,
      durationMinutes: 90,
    }, new Date());
    expect(within(tableRow(EXAM_TITLE)).getByText(limited)).toBeInTheDocument();
  });

  it('labels legacy programming contests by purpose', async () => {
    await renderList(shell({
      rows: [oiRow()],
      typeCounts: counts(1, 0, 0, 0, 1),
    }));

    expect(badgeOf(tableRow(OI_TITLE), '比赛')).toHaveAttribute('data-variant', 'outline');
  });

  it('shows the create button when only one type can be created', async () => {
    await renderList(listPayload({
      scope: 'mine',
      canSeeAll: false,
      filter: { type: 'all', status: 'all', q: '' },
      typeCounts: counts(1, 1, 0, 0, 0),
      page: 1,
      pageCount: 1,
      total: 1,
      rows: [practiceRow()],
      sharedRows: [],
      canCreate: {
        practice: true,
        homework: false,
        exam: false,
        acm: false,
        oi: false,
      },
    }));

    const primary = outsideDialog(primaryControls());
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAccessibleName('新建题目集');
    expect(primary[0]).toHaveAttribute('href', '/teach/new');
  });

  it('treats a status filter as active when the list is empty', async () => {
    await renderList(shell({
      scope: 'mine',
      status: 'ended',
      rows: [],
    }));

    expect(screen.getByText(FILTERED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_DESCRIPTION)).toBeNull();
    const clear = screen.getByRole('link', { name: '清除筛选' });
    expect(clear).toHaveAttribute('href', '/teach?scope=mine');
    expect(clear).toHaveAttribute('data-variant', 'secondary');
  });

  it('opens the homework student view in a new tab', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderList(shell({ rows: [endedRow()] }));

    await user.click(namedIn(tableRow(ENDED_TITLE), '更多操作'));
    expect(await screen.findByRole('menuitem', { name: '打开工作台' })).toHaveAttribute('href', `/teach/homework/${ENDED_ID}`);
    await expectNewTab(user, opened, studentHref('homework', ENDED_ID));
  });

  it('keeps the search text when the status filter changes', async () => {
    const user = userEvent.setup();
    await renderList(shell({
      scope: 'all',
      canSeeAll: true,
      type: 'homework',
      status: 'running',
      q: '图',
      page: 2,
      pageCount: 3,
      rows: [endedRow()],
    }));
    const navigation = installLocationAssign();
    try {
      await user.click(screen.getByRole('combobox', { name: '状态' }));
      await user.click(screen.getByRole('option', { name: '已结束' }));

      expect(navigation.assign).toHaveBeenCalledTimes(1);
      const target = navigation.assign.mock.calls[0]?.[0];
      if (typeof target !== 'string') throw new TypeError('status navigation target');
      const url = new URL(target, 'http://krypton.local');
      expect(url.pathname).toBe('/teach');
      expect(url.searchParams.get('scope')).toBe('all');
      expect(url.searchParams.get('type')).toBe('homework');
      expect(url.searchParams.get('status')).toBe('ended');
      expect(url.searchParams.get('q')).toBe('图');
      expect(url.searchParams.has('page')).toBe(false);
    } finally {
      navigation.restore();
    }
  });

  it('shows only the problem count for a single-stage practice', async () => {
    const row = practiceRow();
    row.title = '单阶段练习';
    row.problemCount = 7;
    row.stageCount = 1;
    row.participantCount = 3;
    await renderList(shell({
      rows: [row],
      typeCounts: counts(1, 1, 0, 0, 0),
    }));

    const line = tableRow('单阶段练习');
    expect(within(line).getByText('7')).toBeInTheDocument();
    expect(within(line).queryByText('7 · 1 个阶段')).toBeNull();
    expect(within(line).queryByText(/个阶段/)).toBeNull();
  });

  it('sums every draw quota in the shared preview', async () => {
    const pending = deferredResponse();
    const fetchMock = installFetch(() => pending.promise);
    const previewSource = examSource();
    previewSource.examPaperQuotas = { single: 2, programming: 3 };
    parseTeachCopySource(previewSource);
    await renderList(shell({
      scope: 'shared',
      sharedRows: [sharedExam()],
      typeCounts: counts(1, 0, 1, 0, 0),
    }));

    await openPreview(fetchMock, EXAM_TITLE, `/teach/exam/${EXAM_ID}/copyable`);
    pending.finish(jsonResponse(previewSource));

    const dialog = await screen.findByRole('dialog', { name: EXAM_TITLE });
    expect(detailFor(dialog, '题目数')).toBe('题库 2 道，每人 5 道');
  });
});

const EXPORT_SERVER_INSTANT = '2026-10-17T12:00:00.000Z';
const EXPORT_SERVER_DAY = '20261017';
const EXPORT_DENIED = '没有权限导出这份成绩。';

describe('teach list summary export', () => {
  beforeEach(() => {
    sessionStorage.clear();
    downloadBlob.mockReset();
    buildXlsx.mockReset();
    loadGrades.mockReset();
    buildXlsx.mockResolvedValue(new Blob(['summary-xlsx']));
  });

  it('does not offer a usable checkbox on acm, practice, or oi rows', async () => {
    await renderList(shell({
      rows: [acmRow(), practiceRow(), oiRow(), gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), gradedRow('exam', EXAM_ID, EXAM_TITLE)],
      typeCounts: counts(5, 1, 2, 1, 1),
    }));

    expectNoUsableCheckbox(ACM_TITLE);
    expectNoUsableCheckbox(PRACTICE_TITLE);
    expectNoUsableCheckbox(OI_TITLE);
    expect(usableCheckbox(HOMEWORK_A_TITLE)).not.toBeChecked();
    expect(usableCheckbox(EXAM_TITLE)).not.toBeChecked();
    expectUsableStackCheckbox(HOMEWORK_A_TITLE);
    expectUsableStackCheckbox(EXAM_TITLE);
    expect(screen.queryByRole('button', { name: '导出总表' })).toBeNull();
    expect(screen.queryByText(/已选/)).toBeNull();
  });

  it('shows the selection bar for two graded sets and clears it', async () => {
    const user = userEvent.setup();
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), gradedRow('exam', EXAM_ID, EXAM_TITLE), acmRow()],
      typeCounts: counts(3, 0, 2, 1, 0),
    }));

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    expect(screen.getByText('已选 1 项')).toBeInTheDocument();
    await user.click(usableCheckbox(EXAM_TITLE));
    expectBarAboveTable('已选 2 项');
    const exportButton = screen.getByRole('button', { name: '导出总表' });
    expect(exportButton).toHaveAttribute('data-variant', 'primary');
    const clear = screen.getByRole('button', { name: '清除' });
    expect(clear).toHaveAttribute('data-variant', 'ghost');

    await user.click(clear);
    expect(screen.queryByText(/已选/)).toBeNull();
    expect(screen.queryByRole('button', { name: '导出总表' })).toBeNull();
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
    expect(usableCheckbox(HOMEWORK_A_TITLE)).not.toBeChecked();
    expect(usableCheckbox(EXAM_TITLE)).not.toBeChecked();
  });

  it('keeps the selection after the list page unmounts and still exports that set', async () => {
    const user = userEvent.setup();
    const pageOne = shell({
      page: 1,
      pageCount: 2,
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), acmRow()],
      typeCounts: counts(3, 0, 2, 1, 0),
    });
    const first = await renderList(pageOne);
    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    expect(screen.getByText('已选 1 项')).toBeInTheDocument();
    first.unmount();

    const body = workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE);
    parseTeachWorkbenchPayload(body);
    const fetchMock = installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_A}`) return jsonResponse(body);
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    loadGrades.mockResolvedValue(summaryGrades([summaryGradeRow('S2024001', '李四', '80')]));
    const pageTwo = shell({
      page: 2,
      pageCount: 2,
      rows: [gradedRow('exam', EXAM_ID, EXAM_TITLE)],
      typeCounts: counts(3, 0, 2, 1, 0),
    });
    await renderList(pageTwo);

    expect(screen.queryByText(HOMEWORK_A_TITLE)).toBeNull();
    expect(screen.getByText('已选 1 项')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出总表' }));
    await waitFor(() => {
      expect(listUrls(fetchMock).map((url) => url.pathname)).toContain(`/teach/homework/${HOMEWORK_A}`);
    });
  });

  it('does not download when the second set returns 403 and names that set', async () => {
    const user = userEvent.setup();
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_A}`) return first.promise;
      if (url.pathname === `/teach/homework/${HOMEWORK_B}`) return second.promise;
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    parseTeachWorkbenchPayload(workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE));
    loadGrades.mockImplementation(async (payload) => {
      if (payload.container.id !== HOMEWORK_A) throw new Error(`unexpected grades load ${payload.container.id}`);
      return summaryGrades([
        summaryGradeRow('S2024003', '张三', '90'),
        summaryGradeRow('S2024001', '李四', '80'),
      ]);
    });
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), gradedRow('homework', HOMEWORK_B, HOMEWORK_B_TITLE)],
      typeCounts: counts(2, 0, 2, 0, 0),
    }), EXPORT_SERVER_INSTANT);

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    await user.click(usableCheckbox(HOMEWORK_B_TITLE));
    const exportButton = screen.getByRole('button', { name: '导出总表' });
    const clicked = user.click(exportButton);
    try {
      await waitFor(() => {
        expect(listUrls(fetchMock).some((url) => url.pathname === `/teach/homework/${HOMEWORK_A}`)).toBe(true);
      });
      expect(exportButton).toHaveAttribute('aria-busy', 'true');
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(buildXlsx).not.toHaveBeenCalled();
    } finally {
      first.finish(jsonResponse(workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE)));
      second.finish(hydroError(EXPORT_DENIED, 403));
    }
    await clicked;

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`${HOMEWORK_B_TITLE}：${EXPORT_DENIED}`);
    expect(alert).not.toHaveTextContent(HOMEWORK_A_TITLE);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(buildXlsx).not.toHaveBeenCalled();
    expect(exportButton).toBeEnabled();
    expect(exportButton).not.toHaveAttribute('aria-busy', 'true');
  });

  it('downloads one workbook named with the server date after both sets load', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['summary-xlsx']);
    buildXlsx.mockResolvedValue(blob);
    const bodyA = workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE);
    const bodyB = workbenchBody('homework', HOMEWORK_B, HOMEWORK_B_TITLE);
    parseTeachWorkbenchPayload(bodyA);
    parseTeachWorkbenchPayload(bodyB);
    const fetchMock = installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_A}`) return jsonResponse(bodyA);
      if (url.pathname === `/teach/homework/${HOMEWORK_B}`) return jsonResponse(bodyB);
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    const gradesA = summaryGrades([
      summaryGradeRow('S2024003', '张三', '90'),
      summaryGradeRow('S2024001', '李四', '80'),
    ]);
    const gradesB = summaryGrades([
      summaryGradeRow('S2024002', '王五', '60'),
      summaryGradeRow('S2024003', '张三', '70'),
    ]);
    loadGrades.mockImplementation(async (payload) => {
      if (payload.container.id === HOMEWORK_A) return gradesA;
      if (payload.container.id === HOMEWORK_B) return gradesB;
      throw new Error(`unexpected grades load ${payload.container.id}`);
    });
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), gradedRow('homework', HOMEWORK_B, HOMEWORK_B_TITLE)],
      typeCounts: counts(2, 0, 2, 0, 0),
    }), EXPORT_SERVER_INSTANT);

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    await user.click(usableCheckbox(HOMEWORK_B_TITLE));
    await user.click(screen.getByRole('button', { name: '导出总表' }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith(`题目集总表-${EXPORT_SERVER_DAY}.xlsx`, blob);
    expect(listUrls(fetchMock).map((url) => url.pathname)).toEqual([
      `/teach/homework/${HOMEWORK_A}`,
      `/teach/homework/${HOMEWORK_B}`,
    ]);
    expect(loadGrades).toHaveBeenCalledTimes(2);
    expect(loadedPayload(loadGrades.mock.calls[0]).container).toMatchObject({ id: HOMEWORK_A, title: HOMEWORK_A_TITLE, type: 'homework' });
    expect(loadedPayload(loadGrades.mock.calls[1]).container).toMatchObject({ id: HOMEWORK_B, title: HOMEWORK_B_TITLE, type: 'homework' });
    const sheets = readBuiltSheets(buildXlsx.mock.calls[0]?.[0]);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['总表', HOMEWORK_A_TITLE, HOMEWORK_B_TITLE]);
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', HOMEWORK_A_TITLE, HOMEWORK_B_TITLE, '合计'],
      ['S2024001', '李四', 80, null, 80],
      ['S2024002', '王五', null, 60, 60],
      ['S2024003', '张三', 90, 70, 160],
    ]);
    expect(screen.getByRole('button', { name: '导出总表' })).toBeEnabled();
  });

  it('unchecks one selected set and keeps the other selected', async () => {
    const user = userEvent.setup();
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE), gradedRow('exam', EXAM_ID, EXAM_TITLE)],
      typeCounts: counts(2, 0, 1, 1, 0),
    }));

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    await user.click(usableCheckbox(EXAM_TITLE));
    expect(screen.getByText('已选 2 项')).toBeInTheDocument();

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    expect(screen.getByText('已选 1 项')).toBeInTheDocument();
    expect(usableCheckbox(HOMEWORK_A_TITLE)).not.toBeChecked();
    expect(usableCheckbox(EXAM_TITLE)).toBeChecked();
    expect(screen.getByRole('button', { name: '导出总表' })).toBeInTheDocument();
  });

  it('names the workbook with the Shanghai calendar date of the server clock', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['summary-xlsx']);
    buildXlsx.mockResolvedValue(blob);
    const body = workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE);
    parseTeachWorkbenchPayload(body);
    installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_A}`) return jsonResponse(body);
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    loadGrades.mockResolvedValue(summaryGrades([summaryGradeRow('S1', '张三', '90')]));
    // The page is generated at 23:30 in Shanghai; the export happens two hours later, past midnight.
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE)],
      typeCounts: counts(1, 0, 1, 0, 0),
    }), '2026-10-17T15:30:00.000Z');

    await user.click(usableCheckbox(HOMEWORK_A_TITLE));
    const realNow = Date.now.bind(Date);
    const later = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 2 * 60 * 60 * 1000);
    try {
      await user.click(screen.getByRole('button', { name: '导出总表' }));
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    } finally {
      later.mockRestore();
    }
    expect(downloadBlob).toHaveBeenCalledWith('题目集总表-20261018.xlsx', blob);
  });

  it('locks the selection checkboxes while the summary is exporting', async () => {
    const user = userEvent.setup();
    let release: ((response: Response) => void) | null = null;
    const body = workbenchBody('homework', HOMEWORK_A, HOMEWORK_A_TITLE);
    installFetch((url) => {
      if (url.pathname === `/teach/homework/${HOMEWORK_A}`) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return hydroError(`未知请求 ${url.pathname}`, 404);
    });
    loadGrades.mockResolvedValue(summaryGrades([summaryGradeRow('S1', '张三', '90')]));
    buildXlsx.mockResolvedValue(new Blob(['summary-xlsx']));
    await renderList(shell({
      rows: [gradedRow('homework', HOMEWORK_A, HOMEWORK_A_TITLE)],
      typeCounts: counts(1, 0, 1, 0, 0),
    }));

    const box = usableCheckbox(HOMEWORK_A_TITLE);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: '导出总表' }));

    await waitFor(() => expect(release).not.toBeNull());
    expect(enabledCheckboxes(tableRow(HOMEWORK_A_TITLE))).toHaveLength(0);
    const finish = release as ((response: Response) => void) | null;
    finish?.(jsonResponse(body));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(enabledCheckboxes(tableRow(HOMEWORK_A_TITLE))).toHaveLength(1));
  });
});
