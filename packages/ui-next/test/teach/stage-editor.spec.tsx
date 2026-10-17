import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toast } from '../../src/components/ui/toast.tsx';
import { parsePracticeSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import type { TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while stage-editor.tsx is absent.
const editorLoaders = import.meta.glob('../../src/pages/teach/advanced/stage-editor.tsx');

const EDITOR_SOURCE = 'src/pages/teach/advanced/stage-editor.tsx';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d4f';
const EDIT_PATH = `/problem-sets/${PRACTICE_ID}/edit`;
const MOVE_PROBLEMS = '先在「编辑题目」里把这一阶段的题移走';
const TITLE_PLACEHOLDER = '阶段名称';
const PREREQ_PLACEHOLDER = '无先修';
const SAVE_REJECTED = '阶段结构不合法';
const SAVED_EMPTY_TITLE = '已保存的空阶段';
const REFRESH_FAILED = '题目集设置刚刚没有读回来。';
const REFRESH_FALLBACK = '题目集设置没有加载出来。';

interface DagNode {
  _id: number;
  title: string;
  requireNids: number[];
  pids: number[];
}

interface PracticeFields {
  title: string;
  content: string;
  description: string;
  pin: boolean;
  audiencePublic: boolean;
  audienceGroupIds: string[];
  stages: DagNode[];
}

interface StageEditorProps {
  payload: TeachWorkbenchPayload;
}

interface StageEditorModule {
  StageEditorSection: ComponentType<StageEditorProps>;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

interface RoutedCall {
  method: string;
  url: URL;
  body: string;
}

interface FetchSession {
  calls: RecordedCall[];
  setDocument: (next: Record<string, unknown>) => void;
  failSave: (message: string) => void;
  failRefresh: (message: string) => void;
}

// ids are not list order: a later row with a smaller id is still not an earlier stage.
const THREE_STAGES: DagNode[] = [
  { _id: 2, title: '入门', requireNids: [], pids: [11, 12] },
  { _id: 9, title: '进阶', requireNids: [], pids: [13] },
  { _id: 4, title: '综合', requireNids: [], pids: [] },
];

const TWO_STAGES: DagNode[] = [
  { _id: 2, title: '入门', requireNids: [], pids: [11, 12] },
  { _id: 9, title: '进阶', requireNids: [], pids: [13] },
];

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function editorLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(editorLoaders)) {
    if (key.endsWith(EDITOR_SOURCE)) return load;
  }
  return undefined;
}

async function loadEditor(): Promise<StageEditorModule> {
  const load = editorLoader();
  expect(typeof load, EDITOR_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${EDITOR_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('stage editor module must be an object');
  return {
    StageEditorSection: asComponent<StageEditorProps>(readField(imported, 'StageEditorSection'), 'StageEditorSection'),
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

async function readRequestBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  if (body instanceof Blob) return body.text();
  return '';
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

function installFetch(handler: (call: RoutedCall) => Response | Promise<Response>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    calls.push({ method, pathname: url.pathname, body });
    return handler({ method, url, body });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function baseFields(stages: DagNode[]): PracticeFields {
  return {
    title: '图论练习',
    content: '旧正文',
    description: '旧简介',
    pin: false,
    audiencePublic: false,
    audienceGroupIds: ['g1'],
    stages,
  };
}

function practiceDocument(fields: PracticeFields): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    page_name: 'problem_set_edit',
    groups: [],
    audience: { public: fields.audiencePublic, groupIds: [...fields.audienceGroupIds] },
    dag: fields.stages.map((stage) => ({
      _id: stage._id,
      title: stage.title,
      requireNids: [...stage.requireNids],
      pids: [...stage.pids],
    })),
    tdoc: {
      _id: PRACTICE_ID,
      title: fields.title,
      content: fields.content,
      description: fields.description,
      pin: fields.pin,
    },
  };
  parsePracticeSnapshot(raw);
  return raw;
}

function workbenchPayload(): TeachWorkbenchPayload {
  return {
    container: {
      type: 'practice',
      id: PRACTICE_ID,
      rule: 'problem_set',
      title: '载荷标题',
      status: 'open',
      beginAt: null,
      endAt: null,
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'groups',
        groupNames: ['一班'],
        schoolNames: [],
        boundStudentCount: 30,
      },
      owner: { uid: 4, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
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
      },
    },
    paper: {
      problems: [],
      stages: [
        { id: 100, title: '载荷甲', requireIds: [], pids: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      ],
      examPaperQuotas: null,
    },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: true,
    },
  };
}

function installPracticeFetch(initial: Record<string, unknown>): FetchSession {
  let document = initial;
  let saveError: string | null = null;
  let refreshError: string | null = null;
  let posted = false;
  const calls = installFetch(({ method, url }) => {
    if (url.pathname !== EDIT_PATH) return hydroError('不该请求这个地址。', 404);
    if (method === 'GET') {
      if (posted && refreshError) return hydroError(refreshError, 400);
      if (posted && saveError) return jsonResponse(practiceDocument(savedEmptyDocument()));
      return jsonResponse(document);
    }
    if (method === 'POST') {
      posted = true;
      if (saveError) return hydroError(saveError, 400);
      return jsonResponse({ ok: true });
    }
    return hydroError('不该请求这个地址。', 404);
  });
  return {
    calls,
    setDocument(next) {
      document = next;
    },
    failSave(message) {
      saveError = message;
    },
    failRefresh(message) {
      refreshError = message;
    },
  };
}

function savedEmptyDocument(): PracticeFields {
  return {
    title: '图论练习',
    content: '旧正文',
    description: '旧简介',
    pin: false,
    audiencePublic: false,
    audienceGroupIds: ['g1'],
    stages: [
      { _id: 2, title: '入门', requireNids: [], pids: [11, 12] },
      { _id: 9, title: '进阶', requireNids: [], pids: [13] },
      { _id: 10, title: SAVED_EMPTY_TITLE, requireNids: [], pids: [] },
    ],
  };
}

async function renderEditor(fields: PracticeFields): Promise<FetchSession> {
  const session = installPracticeFetch(practiceDocument(fields));
  const editor = await loadEditor();
  render(
    <LegacySnapshotProvider type="practice" id={PRACTICE_ID}>
      <editor.StageEditorSection payload={workbenchPayload()} />
    </LegacySnapshotProvider>,
  );
  await screen.findByRole('button', { name: '删除阶段 1' });
  return session;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function stageRow(index: number): HTMLElement {
  const button = screen.getByRole('button', { name: `删除阶段 ${index}` });
  let node: HTMLElement = button;
  while (node.parentElement) {
    const parent = node.parentElement;
    if (within(parent).getAllByRole('button', { name: /^删除阶段 \d+$/ }).length > 1) return node;
    node = parent;
  }
  return node;
}

function deleteButton(index: number): HTMLButtonElement {
  const button = within(stageRow(index)).getByRole('button', { name: `删除阶段 ${index}` });
  if (!(button instanceof HTMLButtonElement)) throw new TypeError(`delete stage ${index}`);
  return button;
}

function stageOptionTexts(): string[] {
  return screen.queryAllByRole('button')
    .map((button) => normalized(button.textContent))
    .filter((text) => /阶段 \d+/.test(text) && !text.includes('删除') && !text.includes('加一个'));
}

function mentionsStage(texts: readonly string[], index: number): boolean {
  const pattern = new RegExp(`阶段 ${index}(?!\\d)`);
  return texts.some((text) => pattern.test(text));
}

function prereqSearch(index: number): HTMLElement {
  const row = stageRow(index);
  const search = within(row).getAllByRole('textbox').find((box) => box.getAttribute('placeholder') !== TITLE_PLACEHOLDER);
  if (!search) throw new TypeError(`prereq search ${index}`);
  return search;
}

async function openPrereq(user: UserEvent, index: number): Promise<string[]> {
  await user.click(prereqSearch(index));
  return stageOptionTexts();
}

async function closePrereq(user: UserEvent): Promise<void> {
  await user.keyboard('{Escape}');
  expect(stageOptionTexts()).toEqual([]);
}

function expectIcon(button: HTMLElement, iconClass: string): void {
  const icon = button.querySelector('svg');
  expect(icon, iconClass).toBeTruthy();
  expect(icon?.getAttribute('class') ?? '').toContain(iconClass);
}

function postedParams(calls: RecordedCall[]): URLSearchParams {
  const posts = calls.filter((call) => call.method === 'POST' && call.pathname === EDIT_PATH);
  expect(posts).toHaveLength(1);
  const post = posts[0];
  if (!post) throw new TypeError('missing save post');
  return new URLSearchParams(post.body);
}

describe('practice stage editor', () => {
  it('offers only earlier stages in the prerequisite menu', async () => {
    const user = userEvent.setup();
    await renderEditor(baseFields(THREE_STAGES));

    expect(within(stageRow(1)).getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('入门');
    expect(within(stageRow(1)).getByPlaceholderText(PREREQ_PLACEHOLDER)).toBeTruthy();
    expect(within(stageRow(2)).getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('进阶');
    expect(within(stageRow(3)).getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('综合');
    expect(screen.queryByDisplayValue('载荷甲')).toBeNull();
    expect(normalized(stageRow(1).textContent)).toMatch(/2\s*道题/);
    expect(normalized(stageRow(2).textContent)).toMatch(/1\s*道题/);
    expect(normalized(stageRow(3).textContent)).toMatch(/0\s*道题/);
    const divided = stageRow(1).closest('.divide-y');
    expect(divided?.contains(stageRow(2))).toBe(true);
    expect(divided?.contains(stageRow(3))).toBe(true);

    const save = screen.getByRole('button', { name: '保存阶段' });
    const add = screen.getByRole('button', { name: '加一个阶段' });
    expect(classTokens(save)).toContain('bg-surface');
    expect(classTokens(save)).not.toContain('bg-brand');
    expect(classTokens(add)).toEqual(expect.arrayContaining(['text-fg-muted', 'text-xs']));
    expectIcon(add, 'lucide-plus');
    expect(classTokens(deleteButton(1))).toEqual(expect.arrayContaining(['text-fg-muted', 'text-xs', 'px-0']));
    expectIcon(deleteButton(1), 'lucide-trash-2');
    expect(screen.queryByRole('button', { name: '拖动以重排' })).toBeNull();

    const stageTwo = await openPrereq(user, 2);
    expect(stageTwo).toHaveLength(1);
    expect(mentionsStage(stageTwo, 1)).toBe(true);
    expect(mentionsStage(stageTwo, 2)).toBe(false);
    expect(mentionsStage(stageTwo, 3)).toBe(false);
    await closePrereq(user);

    const stageThree = await openPrereq(user, 3);
    expect(stageThree).toHaveLength(2);
    expect(mentionsStage(stageThree, 1)).toBe(true);
    expect(mentionsStage(stageThree, 2)).toBe(true);
    expect(mentionsStage(stageThree, 3)).toBe(false);
    await closePrereq(user);

    const stageOne = await openPrereq(user, 1);
    expect(stageOne).toEqual([]);
  });

  it('disables deleting a stage that still has problems', async () => {
    const user = userEvent.setup();
    const session = await renderEditor(baseFields(THREE_STAGES));

    expect(deleteButton(1)).toBeDisabled();
    expect(deleteButton(2)).toBeDisabled();
    expect(deleteButton(3)).toBeEnabled();
    const firstHint = within(stageRow(1)).getByText(MOVE_PROBLEMS);
    const secondHint = within(stageRow(2)).getByText(MOVE_PROBLEMS);
    expect(classTokens(firstHint)).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
    expect(classTokens(secondHint)).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
    expect(within(stageRow(3)).queryByText(MOVE_PROBLEMS)).toBeNull();

    await user.click(deleteButton(3));
    await waitFor(() => {
      expect(screen.queryByDisplayValue('综合')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: '删除阶段 3' })).toBeNull();
    expect(deleteButton(1)).toBeDisabled();
    expect(deleteButton(2)).toBeDisabled();
    expect(within(stageRow(1)).getByText(MOVE_PROBLEMS)).toBeTruthy();
    expect(within(stageRow(2)).getByText(MOVE_PROBLEMS)).toBeTruthy();
    expect(session.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('disables deleting the only remaining stage', async () => {
    const user = userEvent.setup();
    await renderEditor(baseFields([
      { _id: 3, title: '唯一阶段', requireNids: [], pids: [] },
    ]));
    expect(deleteButton(1)).toBeDisabled();
    expect(normalized(stageRow(1).textContent)).toMatch(/0\s*道题/);
    expect(screen.queryByText(MOVE_PROBLEMS)).toBeNull();

    await user.click(screen.getByRole('button', { name: '加一个阶段' }));
    expect(screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)).toHaveLength(2);
    expect(screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)[1]).toHaveValue('');
    expect(deleteButton(1)).toBeEnabled();
    expect(deleteButton(2)).toBeEnabled();

    await user.click(deleteButton(2));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '删除阶段 2' })).toBeNull();
    });
    expect(deleteButton(1)).toBeDisabled();
    expect(screen.queryByText(MOVE_PROBLEMS)).toBeNull();
  });

  it('saves an added stage with empty pids and keeps snapshot pids', async () => {
    const user = userEvent.setup();
    const session = await renderEditor(baseFields(TWO_STAGES));
    const firstTitle = within(stageRow(1)).getByPlaceholderText(TITLE_PLACEHOLDER);
    const secondTitle = within(stageRow(2)).getByPlaceholderText(TITLE_PLACEHOLDER);
    await user.clear(firstTitle);
    await user.type(firstTitle, '基础');
    await user.clear(secondTitle);
    await user.type(secondTitle, '提高');

    const choices = await openPrereq(user, 2);
    expect(choices).toHaveLength(1);
    expect(mentionsStage(choices, 1)).toBe(true);
    const choice = screen.getAllByRole('button').find((button) => /阶段 1(?!\d)/.test(normalized(button.textContent)));
    if (!choice) throw new TypeError('stage 1 prerequisite option');
    await user.click(choice);

    await user.click(screen.getByRole('button', { name: '加一个阶段' }));
    const titles = screen.getAllByPlaceholderText(TITLE_PLACEHOLDER);
    expect(titles).toHaveLength(3);
    expect(titles[2]).toHaveValue('');
    expect(normalized(stageRow(3).textContent)).toMatch(/0\s*道题/);

    session.setDocument(practiceDocument({
      title: '图论练习修订',
      content: '新正文',
      description: '新简介',
      pin: true,
      audiencePublic: true,
      audienceGroupIds: ['g1', 'g2'],
      stages: [
        { _id: 2, title: '服务端入门', requireNids: [], pids: [11, 12, 21] },
        { _id: 9, title: '服务端进阶', requireNids: [], pids: [13, 22] },
      ],
    }));
    await user.click(screen.getByRole('button', { name: '保存阶段' }));
    await waitFor(() => {
      expect(session.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    const params = postedParams(session.calls);
    const dag = params.get('dag');
    if (dag == null) throw new TypeError('missing dag');
    expect(JSON.parse(dag)).toEqual([
      { _id: 2, title: '基础', requireNids: [], pids: [11, 12, 21] },
      { _id: 9, title: '提高', requireNids: [2], pids: [13, 22] },
      { _id: 10, title: '', requireNids: [], pids: [] },
    ]);
    expect(params.get('title')).toBe('图论练习修订');
    expect(params.get('content')).toBe('新正文');
    expect(params.get('description')).toBe('新简介');
    expect(params.get('pin')).toBe('1');
    expect(params.get('audiencePublic')).toBe('1');
    expect(params.get('audienceGroupIds')).toBe('g1,g2');
  });

  it('keeps a prerequisite that points at a later stage', async () => {
    const user = userEvent.setup();
    const session = await renderEditor(baseFields([
      { _id: 2, title: '入门', requireNids: [9], pids: [11, 12] },
      { _id: 9, title: '进阶', requireNids: [], pids: [13] },
    ]));
    const row = stageRow(1);
    expect(within(row).getByRole('button', { name: '移除' })).toBeTruthy();
    expect(within(row).getByText('阶段 2')).toBeTruthy();

    const options = await openPrereq(user, 1);
    expect(options).toEqual([]);
    expect(mentionsStage(options, 2)).toBe(false);
    await closePrereq(user);

    const title = within(row).getByPlaceholderText(TITLE_PLACEHOLDER);
    await user.clear(title);
    await user.type(title, '基础');
    session.setDocument(practiceDocument({
      ...baseFields([
        { _id: 2, title: '服务端入门', requireNids: [9], pids: [11, 12, 21] },
        { _id: 9, title: '服务端进阶', requireNids: [], pids: [13, 22] },
      ]),
      title: '图论练习修订',
      content: '新正文',
      description: '新简介',
      pin: true,
      audiencePublic: true,
      audienceGroupIds: ['g1', 'g2'],
    }));
    await user.click(screen.getByRole('button', { name: '保存阶段' }));
    await waitFor(() => {
      expect(session.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    const params = postedParams(session.calls);
    const dag = params.get('dag');
    if (dag == null) throw new TypeError('missing dag');
    expect(JSON.parse(dag)).toEqual([
      { _id: 2, title: '基础', requireNids: [9], pids: [11, 12, 21] },
      { _id: 9, title: '进阶', requireNids: [], pids: [13, 22] },
    ]);
  });

  it('shows the server message when saving stages fails', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    const session = await renderEditor(baseFields(TWO_STAGES));
    await user.click(screen.getByRole('button', { name: '加一个阶段' }));
    expect(screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)[2]).toHaveValue('');
    session.failSave(SAVE_REJECTED);
    await user.click(screen.getByRole('button', { name: '保存阶段' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SAVE_REJECTED);
    expect(classTokens(alert)).toContain('border-danger-line');
    expect(screen.getByRole('button', { name: '保存阶段' })).toBeEnabled();
    expect(session.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const postIndex = session.calls.findIndex((call) => call.method === 'POST');
    expect(session.calls.slice(postIndex + 1).some((call) => call.method === 'GET')).toBe(false);
    expect(screen.queryByDisplayValue(SAVED_EMPTY_TITLE)).toBeNull();
    expect(screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)[2]).toHaveValue('');
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText('阶段已保存')).toBeNull();
  });

  it('keeps stage titles and a retry when the refresh after save fails', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    const session = await renderEditor(baseFields(TWO_STAGES));
    const title = screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)[0];
    if (!title) throw new TypeError('stage title');
    await user.clear(title);
    await user.type(title, '基础');
    session.failRefresh(REFRESH_FAILED);
    await user.click(screen.getByRole('button', { name: '保存阶段' }));

    await waitFor(() => {
      const postIndex = session.calls.findIndex((call) => call.method === 'POST');
      expect(postIndex).toBeGreaterThanOrEqual(0);
      expect(session.calls.slice(postIndex + 1).some((call) => call.method === 'GET')).toBe(true);
    });
    const alert = await screen.findByRole('alert');
    const alertText = alert.textContent ?? '';
    expect(alertText.includes(REFRESH_FAILED) || alertText.includes(REFRESH_FALLBACK)).toBe(true);
    expect(screen.getByDisplayValue('基础')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText('阶段已保存')).toBeNull();
    const titleAgain = screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)[0];
    if (!titleAgain) throw new TypeError('stage title');
    await user.clear(titleAgain);
    await user.type(titleAgain, '入门');
    const link = document.createElement('a');
    link.href = '/teach';
    link.textContent = '返回题目集';
    document.body.appendChild(link);
    await user.click(link);
    expect(await screen.findByRole('dialog', { name: '放弃未保存的更改？' })).toBeInTheDocument();
  });
});
