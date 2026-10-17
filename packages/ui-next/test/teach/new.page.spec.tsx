import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { timeWindowFromIso } from '../../src/components/teach/time-window-field.tsx';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { parseTeachNewPayload } from '../../src/pages/teach/model.ts';

// A static import fails collection while new.tsx is absent.
const pageLoaders = import.meta.glob('../../src/pages/teach/new.tsx');

const PAGE_SOURCE = 'src/pages/teach/new.tsx';
const GROUP_ID = 'g-cs2401';
const GROUP_NAME = '计科 2401';
const SCHOOL_ID = 's-cauc';
const SCHOOL_NAME = '中国民航大学';
const COPY_ID = '64b7c3a2e4b0f96d1a2c3d53';
const COURSE_ID = '64b7c3a2e4b0f96d1a2c3d70';
const ACM_TID = '64b7c3a2e4b0f96d1a2c3d61';
const EXAM_TID = '64b7c3a2e4b0f96d1a2c3d62';
const HOMEWORK_TID = '64b7c3a2e4b0f96d1a2c3d63';
const PRACTICE_TID = '64b7c3a2e4b0f96d1a2c3d64';
const COPY_TITLE = '期中整卷考试';
const QUIZ_PLACEHOLDER = '例如：数据结构 小测 4';
const ACM_PLACEHOLDER = '例如：第十三届程序设计校赛';
const PRACTICE_PLACEHOLDER = '例如：二叉树专项练习';
const MODE_ERROR = '请选择作答方式。';
const COURSE_LOCK = '跟随课程班级';
const COURSE_TITLE = '数据结构';
const CHAPTER_TITLE = '栈';
const PRACTICE_COURSE_INFO = `这是课程《${COURSE_TITLE}》${CHAPTER_TITLE} 的练习：创建后自动挂到这一章。`;
const PRACTICE_COURSE_BLOCKED = '这一章已经引用了题集，不能再挂。';
const ATTACH_ERROR = '章节不存在';
const ATTACH_TOAST = `练习已创建，但没能挂到课程：${ATTACH_ERROR}`;
const SAME_TIME_TITLE = '时间和原题目集一模一样，确定吗？';
const SAME_TIME_CONFIRM = '确定，用这个时间';
const COPY_LOCK = /和原题目集一样，不能改/;
// F9 acceptance posts this shell. The legacy create snapshot's stage title is 「阶段 1」.
const EMPTY_STAGE = '[{"_id":1,"title":"","requireNids":[],"pids":[]}]';
const COPY_BEGIN_AT = new Date(2026, 9, 24, 14, 0, 0, 0).toISOString();
const COPY_END_AT = new Date(2026, 9, 24, 16, 0, 0, 0).toISOString();
const HOMEWORK_COPY_ID = '64b7c3a2e4b0f96d1a2c3d74';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOMEWORK_BEGIN_AT = new Date(2026, 10, 3, 8, 0, 0, 0).toISOString();
const HOMEWORK_DEADLINE_AT = new Date(2026, 10, 10, 23, 59, 0, 0).toISOString();
const HOMEWORK_END_AT = new Date(new Date(HOMEWORK_DEADLINE_AT).getTime() + DAY_MS).toISOString();
// Copy settings `penaltyRules: {}` means the legacy defaults. An empty list throws once extensionDays stays 1.
const DEFAULT_PENALTY_BODY = [
  '1: 0.9',
  '3: 0.8',
  '12: 0.75',
  '9999: 0.5',
].join('\n');

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

interface PostedCall {
  url: URL;
  form: URLSearchParams | null;
  json: Record<string, unknown> | null;
}

let forceCourse = false;
let rejectCourseAttach = false;
let restoreLocation: (() => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageBootstrap(data: Record<string, unknown>): KryptonBootstrap {
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
    page: { templateName: 'teach_new.html', data },
  };
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) return load;
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

async function loadTeachNewPage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${PAGE_SOURCE} must exist`);
  }
  const imported = await importPageModule(load);
  if (!isRecord(imported) || !('TeachNewPage' in imported)) {
    throw new TypeError('TeachNewPage must be exported');
  }
  const component: unknown = imported.TeachNewPage;
  expect(typeof component, 'TeachNewPage').toBe('function');
  if (typeof component !== 'function') {
    throw new TypeError('TeachNewPage must be a function');
  }
  return component as ComponentType;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function methodOf(init: RequestInit | undefined): string {
  return (init?.method ?? 'GET').toUpperCase();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function courseAttachError(): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'validation',
      code: 400,
      status: 400,
      params: [],
      message: ATTACH_ERROR,
    },
  }, 400);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('expected json object');
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) record[key] = item;
  return record;
}

function formBody(init: RequestInit | undefined): URLSearchParams | null {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body;
  if (typeof body !== 'string' || body.startsWith('{') || body.startsWith('[')) return null;
  return new URLSearchParams(body);
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> | null {
  const body = init?.body;
  if (typeof body !== 'string' || !body.startsWith('{')) return null;
  return jsonObject(JSON.parse(body) as unknown);
}

function postedCalls(fetchMock: FetchMock): PostedCall[] {
  const calls: PostedCall[] = [];
  for (const call of fetchMock.mock.calls) {
    const init = call[1];
    if (methodOf(init) !== 'POST') continue;
    calls.push({
      url: requestUrl(call[0]),
      form: formBody(init),
      json: jsonBody(init),
    });
  }
  return calls;
}

function getUrls(fetchMock: FetchMock): URL[] {
  const urls: URL[] = [];
  for (const call of fetchMock.mock.calls) {
    if (methodOf(call[1]) !== 'GET') continue;
    urls.push(requestUrl(call[0]));
  }
  return urls;
}

function catalogGroup(): Record<string, unknown> {
  return { _id: GROUP_ID, name: GROUP_NAME };
}

function catalogSchool(): Record<string, unknown> {
  return { _id: SCHOOL_ID, name: SCHOOL_NAME };
}

function contestCreatePayload(): Record<string, unknown> {
  return {
    page_name: 'contest_create',
    rules: { exam: '考试', acm: 'ACM', oi: 'OI' },
    pdict: {},
    files: [],
    duration: 2,
    pids: '',
    beginAt: '2026-10-24T06:00:00.000Z',
    participationRevision: 0,
    teamModeClearConfirmation: '',
    inviteCode: '',
    scopeSchools: [catalogSchool()],
    scopeGroups: [catalogGroup()],
    canAutoHideProblems: true,
    activeTeamCount: 0,
    recordCount: 0,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
  };
}

function homeworkCreatePayload(url: URL): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    page_name: 'homework_create',
    extensionDays: 1,
    dateBeginText: '2026-10-24',
    timeBeginText: '08:00',
    datePenaltyText: '2026-10-24',
    timePenaltyText: '18:00',
    penaltyRules: {},
    scopeGroups: [catalogGroup()],
    pids: '',
    participantScopeMode: 'none',
    participantGroupIds: [],
  };
  const courseId = url.searchParams.get('fromCourse');
  const chapter = url.searchParams.get('chapter');
  if (forceCourse || (courseId !== null && chapter !== null)) {
    payload.fromCourse = courseId || COURSE_ID;
    payload.chapter = chapter === null ? 2 : Number(chapter);
    payload.courseContext = { courseTitle: '数据结构', chapterTitle: '栈' };
  }
  return payload;
}

function practiceCreatePayload(): Record<string, unknown> {
  return {
    page_name: 'problem_set_create',
    groups: [catalogGroup()],
    audience: { public: true, groupIds: [] },
  };
}

function snapshotFor(url: URL): Record<string, unknown> {
  if (url.pathname === '/contest/create') return contestCreatePayload();
  if (url.pathname === '/homework/create') return homeworkCreatePayload(url);
  if (url.pathname === '/problem-sets/create') return practiceCreatePayload();
  throw new TypeError(`unexpected GET ${url.pathname}${url.search}`);
}

function contestTid(form: URLSearchParams | null): string {
  const rule = form?.get('rule');
  if (rule === 'acm') return ACM_TID;
  return EXAM_TID;
}

function postResult(url: URL, init: RequestInit | undefined): Record<string, unknown> {
  if (url.pathname.endsWith('/provenance')) return { ok: true };
  if (url.pathname === '/contest/create') return { tid: contestTid(formBody(init)) };
  if (url.pathname === '/homework/create') return { tid: HOMEWORK_TID };
  if (url.pathname === '/problem-sets/create') return { tid: PRACTICE_TID };
  if (url.pathname === `/course/${COURSE_ID}/edit`) return { ok: true };
  throw new TypeError(`unexpected POST ${url.pathname}`);
}

function installFetch(): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input, init) => {
      const url = requestUrl(input);
      const method = methodOf(init);
      if (method === 'GET') return Promise.resolve(jsonResponse(snapshotFor(url)));
      if (method === 'POST') {
        if (rejectCourseAttach && url.pathname === `/course/${COURSE_ID}/edit`) {
          return Promise.resolve(courseAttachError());
        }
        return Promise.resolve(jsonResponse(postResult(url, init)));
      }
      return Promise.reject(new TypeError(`unexpected method ${method}`));
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...saved, assign },
  });
  restoreLocation = () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
  return assign;
}

function canCreate(): Record<string, boolean> {
  return {
    practice: true,
    homework: true,
    exam: true,
    acm: true,
    oi: true,
  };
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

function examCopy(): Record<string, unknown> {
  return {
    type: 'exam',
    id: COPY_ID,
    title: COPY_TITLE,
    content: '闭卷。',
    description: '',
    ownerUid: 11,
    ownerName: '郑老师',
    mine: false,
    rule: 'exam',
    beginAt: COPY_BEGIN_AT,
    endAt: COPY_END_AT,
    durationMinutes: null,
    pids: [8, 9],
    problems: [
      { docId: 8, pid: 'P2008', title: '队列选择', kind: 'single' },
      { docId: 9, pid: 'P2009', title: '不能使用的题', kind: 'single' },
    ],
    scores: { 8: 5, 9: 20 },
    examPaperQuotas: { single: 2 },
    stages: null,
    settings: { ...contestSettings(), examPassScore: 6, examAttemptLimit: 3 },
    unusablePids: [9],
  };
}

function homeworkCopy(): Record<string, unknown> {
  return {
    type: 'homework',
    id: HOMEWORK_COPY_ID,
    title: '栈与队列作业',
    content: '按顺序完成。',
    description: '',
    ownerUid: 9,
    ownerName: '王老师',
    mine: false,
    rule: 'homework',
    beginAt: HOMEWORK_BEGIN_AT,
    endAt: HOMEWORK_END_AT,
    durationMinutes: null,
    pids: [8],
    problems: [
      { docId: 8, pid: 'P2008', title: '队列选择', kind: 'single' },
    ],
    scores: { 8: 5 },
    examPaperQuotas: null,
    stages: null,
    settings: {
      kind: 'homework',
      rated: false,
      langs: [],
      extensionDays: 1,
      penaltyRules: {},
    },
    unusablePids: [],
  };
}

function newPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    canCreate: canCreate(),
    initialType: null,
    fromCourse: null,
    copy: null,
    ...overrides,
  };
  parseTeachNewPayload(raw);
  return raw;
}

function rememberLocation(data: Record<string, unknown>) {
  const params = new URLSearchParams();
  if (typeof data.initialType === 'string') params.set('type', data.initialType);
  if (isRecord(data.fromCourse) && typeof data.fromCourse.courseId === 'string' && typeof data.fromCourse.chapterId === 'number') {
    params.set('fromCourse', data.fromCourse.courseId);
    params.set('chapter', String(data.fromCourse.chapterId));
  }
  if (isRecord(data.copy) && typeof data.copy.type === 'string' && typeof data.copy.id === 'string') {
    params.set('copy', `${data.copy.type}:${data.copy.id}`);
  }
  const query = params.toString();
  window.history.replaceState(null, '', query === '' ? '/teach/new' : `/teach/new?${query}`);
}

async function renderNew(data: Record<string, unknown>) {
  rememberLocation(data);
  const Page = await loadTeachNewPage();
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={pageBootstrap(data)}>
        <Page />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

function practiceFromCourse(chapterHasProblemSet: boolean): Record<string, unknown> {
  return {
    courseId: COURSE_ID,
    chapterId: 2,
    courseTitle: COURSE_TITLE,
    chapterTitle: CHAPTER_TITLE,
    chapterHasProblemSet,
  };
}

function statusAlert(text: HTMLElement): HTMLElement {
  const alert = text.closest('[role="status"]');
  if (!(alert instanceof HTMLElement)) throw new TypeError('course practice alert');
  return alert;
}

async function renderCoursePractice(chapterHasProblemSet: boolean) {
  const fetchMock = installFetch();
  const assign = installLocationAssign();
  await renderNew(newPayload({
    initialType: 'practice',
    fromCourse: practiceFromCourse(chapterHasProblemSet),
  }));
  return { fetchMock, assign };
}

async function submitCoursePractice(fetchMock: FetchMock) {
  await fillTitle(PRACTICE_PLACEHOLDER, '栈练习');
  await chooseEveryone();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));
  await waitFor(() => {
    expect(postedCalls(fetchMock)).toHaveLength(2);
  });
}

function attachForm(fetchMock: FetchMock): URLSearchParams {
  const posts = postedCalls(fetchMock);
  expect(posts.map((call) => call.url.pathname)).toEqual([
    '/problem-sets/create',
    `/course/${COURSE_ID}/edit`,
  ]);
  const attach = posts[1];
  return requireForm(attach, `/course/${COURSE_ID}/edit`);
}

async function chooseType(name: RegExp) {
  const user = userEvent.setup();
  const next = screen.getByRole('button', { name: '下一步' });
  await user.click(screen.getByRole('radio', { name }));
  expect(next).toBeEnabled();
  await user.click(next);
  return user;
}

async function waitForGet(fetchMock: FetchMock, pathname: string, rule?: string) {
  await waitFor(() => {
    const hit = getUrls(fetchMock).some((url) => {
      if (url.pathname !== pathname) return false;
      if (rule === undefined) return true;
      return url.searchParams.get('rule') === rule;
    });
    expect(hit).toBe(true);
  });
}

function labeled(name: string): HTMLElement {
  return screen.getByLabelText(name);
}

function fillWindow(
  begin: { date: string; time: string },
  end: { date: string; time: string },
  endLabel = '结束',
) {
  fireEvent.change(labeled('开始日期'), { target: { value: begin.date } });
  fireEvent.change(labeled('开始时间'), { target: { value: begin.time } });
  fireEvent.change(labeled(`${endLabel}日期`), { target: { value: end.date } });
  fireEvent.change(labeled(`${endLabel}时间`), { target: { value: end.time } });
  expect(labeled('开始日期')).toHaveValue(begin.date);
  expect(labeled('开始时间')).toHaveValue(begin.time);
  expect(labeled(`${endLabel}日期`)).toHaveValue(end.date);
  expect(labeled(`${endLabel}时间`)).toHaveValue(end.time);
}

async function fillTitle(placeholder: string, title: string) {
  const input = await screen.findByPlaceholderText(placeholder);
  if (!(input instanceof HTMLInputElement)) throw new TypeError('title input');
  if (input.value.trim() !== '') return;
  fireEvent.change(input, { target: { value: title } });
  expect(input).toHaveValue(title);
}

async function chooseEveryone() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: /所有人/ }));
  expect(screen.getByRole('radio', { name: /所有人/ })).toBeChecked();
}

async function chooseGroup() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: /指定用户组/ }));
  await user.click(await screen.findByPlaceholderText('搜索用户组'));
  await user.click(await screen.findByRole('button', { name: GROUP_NAME }));
  await user.keyboard('{Escape}');
}

async function submitHomework(fetchMock: FetchMock, personalMinutes: string | null): Promise<URLSearchParams> {
  await renderNew(newPayload());
  const user = await chooseType(/作业与考试/);
  await user.click(await screen.findByRole('radio', { name: /逐题作答/ }));
  await waitForGet(fetchMock, '/homework/create');
  await fillTitle(QUIZ_PLACEHOLDER, personalMinutes === null ? '不限时作业' : '限时九十分钟');
  fillWindow(
    { date: '2026-11-03', time: '08:00' },
    { date: '2026-11-10', time: '23:59' },
    '截止',
  );
  if (personalMinutes !== null) {
    fireEvent.change(screen.getByRole('spinbutton', { name: /个人限时/ }), { target: { value: personalMinutes } });
  }
  await chooseEveryone();
  await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));
  await waitFor(() => {
    expect(postedCalls(fetchMock).some((call) => call.url.pathname === '/homework/create')).toBe(true);
  });
  return requireForm(
    postedCalls(fetchMock).find((call) => call.url.pathname === '/homework/create'),
    '/homework/create',
  );
}

function requireForm(call: PostedCall | undefined, pathname: string): URLSearchParams {
  expect(call, pathname).toBeTruthy();
  if (!call) throw new TypeError(`missing POST ${pathname}`);
  expect(call.url.pathname).toBe(pathname);
  if (!(call.form instanceof URLSearchParams)) throw new TypeError(`missing form body ${pathname}`);
  return call.form;
}

beforeEach(() => {
  forceCourse = false;
  rejectCourseAttach = false;
});

afterEach(() => {
  restoreLocation?.();
  restoreLocation = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('teach new page', () => {
  it('keeps next disabled until a type is chosen and shows an unselected answer mode', async () => {
    installFetch();
    await renderNew(newPayload());

    const next = screen.getByRole('button', { name: '下一步' });
    expect(next).toBeDisabled();
    await chooseType(/作业与考试/);

    expect(await screen.findByRole('radio', { name: /逐题作答/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /整卷作答/ })).not.toBeChecked();
  });

  it('asks for an answer mode and does not post when quiz mode is empty', async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    await renderNew(newPayload());
    await chooseType(/作业与考试/);

    await user.click(await screen.findByRole('button', { name: '创建并进入工作台' }));

    expect(await screen.findByText(MODE_ERROR)).toBeInTheDocument();
    expect(postedCalls(fetchMock)).toHaveLength(0);
  });

  it('loads an exam snapshot with schools and a homework snapshot without schools', async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    await renderNew(newPayload());
    await chooseType(/作业与考试/);

    const beforeExam = fetchMock.mock.calls.length;
    await user.click(await screen.findByRole('radio', { name: /整卷作答/ }));
    await waitFor(() => {
      const added = fetchMock.mock.calls.slice(beforeExam);
      const hit = added.some((call) => {
        const url = requestUrl(call[0]);
        return url.pathname === '/contest/create' && url.searchParams.get('rule') === 'exam';
      });
      expect(hit).toBe(true);
    });
    expect(await screen.findByRole('radio', { name: /指定学校/ })).toBeInTheDocument();

    const beforeHomework = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('radio', { name: /逐题作答/ }));
    await waitFor(() => {
      const added = fetchMock.mock.calls.slice(beforeHomework);
      const hit = added.some((call) => requestUrl(call[0]).pathname === '/homework/create');
      expect(hit).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole('radio', { name: /指定学校/ })).not.toBeInTheDocument();
    });
  });

  it('posts an acm contest for the chosen group and opens the problems tab', async () => {
    const fetchMock = installFetch();
    const assign = installLocationAssign();
    await renderNew(newPayload());
    await chooseType(/ACM 比赛/);
    await waitForGet(fetchMock, '/contest/create', 'acm');
    await fillTitle(ACM_PLACEHOLDER, '校赛热身');
    fillWindow({ date: '2026-11-02', time: '09:00' }, { date: '2026-11-02', time: '14:00' });
    await chooseGroup();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    expect(assign).toHaveBeenCalledWith(`/teach/acm/${ACM_TID}?tab=problems`);
    const creates = postedCalls(fetchMock).filter((call) => call.url.pathname === '/contest/create');
    expect(creates).toHaveLength(1);
    const form = requireForm(creates[0], '/contest/create');
    expect(form.get('rule')).toBe('acm');
    expect(form.get('participantScopeMode')).toBe('groups');
    expect(form.get('participantGroupIds')).toBe(GROUP_ID);
  });

  it('copies an exam without unusable problems after confirming the same time', async () => {
    const fetchMock = installFetch();
    const assign = installLocationAssign();
    await renderNew(newPayload({ copy: examCopy() }));

    expect(screen.queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
    expect(await screen.findByText(COPY_LOCK)).toBeInTheDocument();
    expect(screen.getByText(/整卷作答/)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /逐题作答/ })).not.toBeInTheDocument();
    await waitForGet(fetchMock, '/contest/create', 'exam');
    await fillTitle(QUIZ_PLACEHOLDER, COPY_TITLE);
    const sourceWindow = timeWindowFromIso(COPY_BEGIN_AT, COPY_END_AT, null);
    fillWindow(
      { date: sourceWindow.beginDate, time: sourceWindow.beginTime },
      { date: sourceWindow.endDate, time: sourceWindow.endTime },
    );
    await chooseEveryone();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));
    const dialog = await screen.findByRole('dialog', { name: SAME_TIME_TITLE });
    expect(dialog).toHaveTextContent('原题目集是');
    expect(postedCalls(fetchMock).some((call) => call.url.pathname === '/contest/create')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: SAME_TIME_CONFIRM }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`/teach/exam/${EXAM_TID}?tab=problems`);
    });
    const posts = postedCalls(fetchMock);
    const form = requireForm(posts.find((call) => call.url.pathname === '/contest/create'), '/contest/create');
    expect(form.getAll('pids')).toEqual(['8']);
    // One single scored 5 remains, so the copied quota of 2 is too high and pass score 6 is above that full score.
    expect(jsonObject(JSON.parse(form.get('examPaperQuotas') ?? '') as unknown)).toEqual({ single: 1 });
    expect(form.get('examPassScore') ?? '').toBe('');
    expect(form.get('examAttemptLimit') ?? '').toBe('');
    expect(screen.getByText(/单选题每人抽题数从 2 改为 1/)).toBeInTheDocument();
    expect(screen.getByText(/及格线 6 分高于剩下的满分 5 分，不会带上/)).toBeInTheDocument();
    const provenance = posts.find((call) => call.url.pathname === `/teach/exam/${EXAM_TID}/provenance`);
    expect(provenance?.json).toEqual({ sourceType: 'exam', sourceId: COPY_ID });
  });

  it('confirms a copied homework against the original deadline and keeps empty penalty rules', async () => {
    const fetchMock = installFetch();
    const assign = installLocationAssign();
    const open = timeWindowFromIso(HOMEWORK_BEGIN_AT, HOMEWORK_DEADLINE_AT, null);
    const late = timeWindowFromIso(HOMEWORK_BEGIN_AT, HOMEWORK_END_AT, null);
    expect(`${open.endDate} ${open.endTime}`).not.toBe(`${late.endDate} ${late.endTime}`);
    await renderNew(newPayload({ copy: homeworkCopy() }));

    const lockedMode = await screen.findByText(COPY_LOCK);
    expect(lockedMode.textContent ?? '').toContain('逐题作答');
    expect(screen.queryByRole('radio', { name: /逐题作答/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /整卷作答/ })).not.toBeInTheDocument();
    await waitForGet(fetchMock, '/homework/create');
    await fillTitle(QUIZ_PLACEHOLDER, '栈与队列作业');
    fillWindow(
      { date: open.beginDate, time: open.beginTime },
      { date: open.endDate, time: open.endTime },
      '截止',
    );
    await chooseEveryone();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));
    const dialog = await screen.findByRole('dialog', { name: SAME_TIME_TITLE });
    expect(postedCalls(fetchMock).some((call) => call.url.pathname === '/homework/create')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: SAME_TIME_CONFIRM }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`/teach/homework/${HOMEWORK_TID}?tab=problems`);
    });
    const form = requireForm(
      postedCalls(fetchMock).find((call) => call.url.pathname === '/homework/create'),
      '/homework/create',
    );
    expect(form.get('extensionDays')).toBe('1');
    expect(form.get('penaltySinceDate')).toBe(open.endDate);
    expect(form.get('penaltySinceTime')).toBe(open.endTime);
    expect(form.get('penaltyRules')).toBe(DEFAULT_PENALTY_BODY);
  });

  it('turns off the default late days only when a personal limit is filled', async () => {
    installLocationAssign();
    const openFetch = installFetch();
    const open = await submitHomework(openFetch, null);
    expect(open.get('extensionDays')).toBe('1');
    expect(open.get('contestDuration')).toBe('');

    cleanup();
    const limitedFetch = installFetch();
    const limited = await submitHomework(limitedFetch, '90');
    expect(limited.get('contestDuration')).toBe('1.5');
    expect(limited.get('extensionDays')).toBe('0');
  });

  it('locks course quiz audience and posts the course chapter', async () => {
    forceCourse = true;
    const fetchMock = installFetch();
    installLocationAssign();
    await renderNew(newPayload({
      initialType: 'homework',
      fromCourse: { courseId: COURSE_ID, chapterId: 2 },
    }));

    expect(await screen.findByText(COURSE_LOCK)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /所有人/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /指定用户组/ })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: /指定学校/ })).not.toBeInTheDocument();
    await fillTitle(QUIZ_PLACEHOLDER, '第三章测验');
    fillWindow(
      { date: '2026-11-03', time: '08:00' },
      { date: '2026-11-10', time: '23:59' },
      '截止',
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));

    await waitFor(() => {
      expect(postedCalls(fetchMock).some((call) => call.url.pathname === '/homework/create')).toBe(true);
    });
    const form = requireForm(
      postedCalls(fetchMock).find((call) => call.url.pathname === '/homework/create'),
      '/homework/create',
    );
    expect(form.get('fromCourse')).toBe(COURSE_ID);
    expect(form.get('chapter')).toBe('2');
  });

  it('posts a practice with one empty stage', async () => {
    const fetchMock = installFetch();
    installLocationAssign();
    await renderNew(newPayload());
    await chooseType(/练习/);
    await waitForGet(fetchMock, '/problem-sets/create');
    await fillTitle(PRACTICE_PLACEHOLDER, '链表练习');
    await chooseEveryone();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));

    await waitFor(() => {
      expect(postedCalls(fetchMock).some((call) => call.url.pathname === '/problem-sets/create')).toBe(true);
    });
    const form = requireForm(
      postedCalls(fetchMock).find((call) => call.url.pathname === '/problem-sets/create'),
      '/problem-sets/create',
    );
    expect(form.get('dag')).toBe(EMPTY_STAGE);
  });

  it('posts an attach after creating a course practice', async () => {
    const { fetchMock, assign } = await renderCoursePractice(false);
    const info = await screen.findByText(PRACTICE_COURSE_INFO);
    expect(statusAlert(info)).toHaveClass('border-info-line', 'bg-info-soft');
    expect(screen.queryByText(PRACTICE_COURSE_BLOCKED)).not.toBeInTheDocument();

    await submitCoursePractice(fetchMock);

    const form = attachForm(fetchMock);
    expect(form.get('operation')).toBe('attach_problem_set');
    expect(form.get('problemSetId')).toBe(PRACTICE_TID);
    expect(form.get('chapter')).toBe('2');
    expect(assign).toHaveBeenCalledWith(`/teach/practice/${PRACTICE_TID}?tab=problems`);
  });

  it('disables creating a course practice when the chapter already cites a problem set', async () => {
    await renderCoursePractice(true);
    expect(screen.getByRole('button', { name: '创建并进入工作台' })).toBeDisabled();
    const warning = await screen.findByText(PRACTICE_COURSE_BLOCKED);
    expect(statusAlert(warning)).toHaveClass('border-warning-line', 'bg-warning-soft');
    expect(screen.queryByText(PRACTICE_COURSE_INFO)).not.toBeInTheDocument();
  });

  it('opens the practice workbench when attaching the course practice fails', async () => {
    rejectCourseAttach = true;
    const { fetchMock, assign } = await renderCoursePractice(false);
    const info = await screen.findByText(PRACTICE_COURSE_INFO);
    expect(statusAlert(info)).toHaveClass('border-info-line', 'bg-info-soft');

    await submitCoursePractice(fetchMock);

    const form = attachForm(fetchMock);
    expect(form.get('operation')).toBe('attach_problem_set');
    expect(form.get('problemSetId')).toBe(PRACTICE_TID);
    expect(form.get('chapter')).toBe('2');
    expect(await screen.findByRole('alert')).toHaveTextContent(ATTACH_TOAST);
    expect(assign).toHaveBeenCalledWith(`/teach/practice/${PRACTICE_TID}?tab=problems`);
  });
});
