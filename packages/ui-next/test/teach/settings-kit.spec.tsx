import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TeachTab, TeachType } from '@hydrooj/common';
import {
  cleanup, render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactNode } from 'react';
import {
  describe, expect, it, vi,
} from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import { toast } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';

// A static import fails collection while settings-kit.tsx is absent.
const kitLoaders = import.meta.glob('../../src/pages/teach/settings-kit.tsx');

const KIT_SOURCE = 'src/pages/teach/settings-kit.tsx';
const KIT_FILE = resolve(import.meta.dirname, '../../src/pages/teach/settings-kit.tsx');
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d4f';
const EDIT_PATH = `/problem-sets/${PRACTICE_ID}/edit`;
const SHARE_PATH = `/teach/practice/${PRACTICE_ID}/share`;
const SERVER_MESSAGE = '标题不能为空。';
const SHARE_REJECTED = '这些题现在不能共享。';
const SHARE_PANEL_DESCRIPTION = '共享后，其他老师可以在「学校共享」里复制一份去用（题目、分值、设置），时间和学生由他们自己填。学生永远看不到。';
const SHARE_LABEL = '在学校内共享';
const SHARE_ON = '正在共享。关掉后已经复制走的不受影响。';
const SHARE_OFF = '没有共享。';
const SHARE_DISABLED = '只有所有者能共享这个题目集。';
const SHARE_STOPPED = '已停止共享，已经复制走的不受影响';
const SHARE_STALE = '题目集里的题刚刚有变化，请重新打开共享';
const FRESH_DIALOG_TITLE = '先把 1 道题共享到学校题库';
const OWN_DIALOG_TITLE = '先把 2 道题共享到学校题库';
const OWN_DIALOG_LEAD = '别的老师复制时要能选用这里的每一道题。下面 2 道是你自己的隐藏题，还没共享。';
const OWN_DIALOG_NOTE = '共享后所有老师都能预览、选用这些题，但不能修改；学生在题目集外仍然看不到。题目集里如果有别人的、没共享的隐藏题，这里会列出来，并且不能共享（D49）。';
const OTHERS_TITLE = '这个题目集还不能共享';
const OTHERS_NOTE = '这些是别人的隐藏题，需要他们先共享到学校题库。';
const COLLABORATOR_DESCRIPTION = '协作者能和你一样管理这个作业，但不能删除它。';
const DELETE_WARNING = '删除后不能恢复。';

const OWN_HIDDEN: Array<Record<string, unknown>> = [
  { docId: 11, pid: 'P5240', title: '顺序栈的入栈与出栈' },
  { docId: 12, pid: 'P5242', title: '循环队列的实现' },
];

const OTHER_HIDDEN: Record<string, unknown> = {
  docId: 21,
  pid: 'P1001',
  title: '别人的隐藏题',
  ownerName: '李老师',
};

const FRESH_HIDDEN: Record<string, unknown> = {
  docId: 31,
  pid: 'P5301',
  title: '新的隐藏题',
};

interface SnapshotValue {
  tid: string | null;
  state: { title?: string };
}

type AnyLegacySnapshot =
  | { kind: 'contest'; value: SnapshotValue }
  | { kind: 'homework'; value: SnapshotValue }
  | { kind: 'practice'; value: SnapshotValue };

interface LegacySnapshotController {
  status: 'loading' | 'ready' | 'error';
  snapshot: AnyLegacySnapshot | null;
  error: string | null;
  reload: () => Promise<void>;
  save: (build: (latest: AnyLegacySnapshot) => URLSearchParams) => Promise<void>;
}

interface DirtyController {
  dirtyTabs: ReadonlySet<TeachTab>;
  setTabDirty: (tab: TeachTab, dirty: boolean) => void;
}

interface SaveBarProps {
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

interface SwitchRowProps {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string | null;
}

interface CollaboratorsPanelProps {
  noun: string;
  value: number[];
  onChange: (next: number[]) => void;
}

interface SharePanelProps {
  type: TeachType;
  id: string;
  canShare: boolean;
}

interface DangerPanelProps {
  type: TeachType;
  id: string;
  title: string;
  noun: string;
  canDelete: boolean;
}

interface SettingsKit {
  LegacySnapshotProvider: ComponentType<{ type: TeachType; id: string; children: ReactNode }>;
  useLegacySnapshot: () => LegacySnapshotController;
  WorkbenchDirtyProvider: ComponentType<{ children: ReactNode }>;
  useWorkbenchDirty: () => DirtyController;
  SaveBar: ComponentType<SaveBarProps>;
  SwitchRow: ComponentType<SwitchRowProps>;
  countChangedKeys: (base: Record<string, unknown>, draft: Record<string, unknown>, keys: readonly string[]) => number;
  CollaboratorsPanel: ComponentType<CollaboratorsPanelProps>;
  SharePanel: ComponentType<SharePanelProps>;
  DangerPanel: ComponentType<DangerPanelProps>;
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

type SaveResult = { ok: true } | { ok: false; message: string };

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function kitLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(kitLoaders)) {
    if (key.endsWith(KIT_SOURCE)) return load;
  }
  return undefined;
}

async function loadKit(): Promise<SettingsKit> {
  const load = kitLoader();
  expect(typeof load, KIT_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${KIT_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('settings kit module must be an object');
  return {
    LegacySnapshotProvider: asComponent(readField(imported, 'LegacySnapshotProvider'), 'LegacySnapshotProvider'),
    useLegacySnapshot: asFunction(readField(imported, 'useLegacySnapshot'), 'useLegacySnapshot'),
    WorkbenchDirtyProvider: asComponent(readField(imported, 'WorkbenchDirtyProvider'), 'WorkbenchDirtyProvider'),
    useWorkbenchDirty: asFunction(readField(imported, 'useWorkbenchDirty'), 'useWorkbenchDirty'),
    SaveBar: asComponent(readField(imported, 'SaveBar'), 'SaveBar'),
    SwitchRow: asComponent(readField(imported, 'SwitchRow'), 'SwitchRow'),
    countChangedKeys: asFunction(readField(imported, 'countChangedKeys'), 'countChangedKeys'),
    CollaboratorsPanel: asComponent(readField(imported, 'CollaboratorsPanel'), 'CollaboratorsPanel'),
    SharePanel: asComponent(readField(imported, 'SharePanel'), 'SharePanel'),
    DangerPanel: asComponent(readField(imported, 'DangerPanel'), 'DangerPanel'),
  };
}

function kitSource(): string {
  if (!existsSync(KIT_FILE)) return '';
  return readFileSync(KIT_FILE, 'utf8');
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

function practicePayload(title: string): Record<string, unknown> {
  return {
    page_name: 'problem_set_edit',
    groups: [],
    audience: { public: false, groupIds: ['g1'] },
    dag: [{ _id: 1, title: '阶段 1', requireNids: [], pids: [11] }],
    tdoc: {
      _id: PRACTICE_ID,
      title,
      content: '正文',
      description: '简介',
      pin: false,
    },
  };
}

function sharePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shared: null,
    canShare: true,
    ownHiddenUnshared: [],
    othersHiddenUnshared: [],
    ...overrides,
  };
}

function sharedStamp(): Record<string, unknown> {
  return { sharedAt: '2026-10-16T08:00:00.000Z', sharedByName: '王老师' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonBody(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TypeError(`expected json body, received ${body}`);
  }
  if (!isRecord(parsed)) throw new TypeError('share body must be an object');
  return parsed;
}

function shareGets(calls: RecordedCall[]): number {
  return calls.filter((call) => call.method === 'GET' && call.pathname === SHARE_PATH).length;
}

function postsSharedTrue(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => {
    if (call.method !== 'POST') return false;
    if (/"shared"\s*:\s*true/.test(call.body)) return true;
    return new URLSearchParams(call.body).get('shared') === 'true';
  });
}

function titleOf(snapshot: AnyLegacySnapshot | null): string {
  if (!snapshot) return '';
  const state: unknown = snapshot.value.state;
  if (typeof state !== 'object' || state === null) return '';
  const title = Reflect.get(state, 'title');
  return typeof title === 'string' ? title : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-16T00:00:00.000Z',
    user: {
      id: 4,
      name: 'wang',
      mail: 'wang@example.com',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh',
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
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
      ranking: '/ranking',
      discussions: '/discuss',
      domains: '/domains',
      messages: '/messages',
      login: '/login',
      register: '/register',
      logout: '/logout',
      settings: '/settings',
      security: '/security',
      files: '/files',
      records: '/records',
      domainDashboard: '/domain',
      domainPermission: '/domain/perm',
      manage: '/manage',
      status: '/status',
      problemDetail: '/p/:pid',
      contestDetail: '/contest/:tid',
      homeworkDetail: '/homework/:tid',
      trainingDetail: '/training/:tid',
      discussionDetail: '/discuss/:did',
      discussionNode: '/discuss/node/:node',
      userDetail: '/user/:uid',
      recordDetail: '/record/:rid',
    },
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function labeledSwitch(label: string): HTMLInputElement {
  const labels = [...document.querySelectorAll('label')].filter((node) => node.textContent?.trim() === label);
  expect(labels, label).toHaveLength(1);
  const owner = labels[0];
  if (!(owner instanceof HTMLLabelElement)) throw new TypeError(`label ${label}`);
  expect(owner.htmlFor, label).not.toBe('');
  const control = document.getElementById(owner.htmlFor);
  if (!(control instanceof HTMLInputElement)) throw new TypeError(`switch for ${label}`);
  return control;
}

function withDialog(children: ReactNode) {
  return (
    <>
      {children}
      <DialogHost />
    </>
  );
}

function SnapshotProbe({
  useSnapshot,
  build,
  onDone,
}: {
  useSnapshot: SettingsKit['useLegacySnapshot'];
  build: (latest: AnyLegacySnapshot) => URLSearchParams;
  onDone: (result: SaveResult) => void;
}) {
  const snapshot = useSnapshot();
  return (
    <>
      <p data-testid="snapshot-state">{`${snapshot.status}:${titleOf(snapshot.snapshot)}`}</p>
      <button
        type="button"
        onClick={() => {
          void Promise.resolve()
            .then(() => snapshot.save(build))
            .then(
              () => onDone({ ok: true }),
              (error: unknown) => onDone({ ok: false, message: errorText(error) }),
            );
        }}
      >
        保存快照
      </button>
    </>
  );
}

function DirtyProbe({ useDirty }: { useDirty: SettingsKit['useWorkbenchDirty'] }) {
  const dirty = useDirty();
  const names = [...dirty.dirtyTabs].sort().join(',');
  return (
    <>
      <p data-testid="dirty-tabs">{names}</p>
      <button type="button" onClick={() => dirty.setTabDirty('settings', true)}>标设置</button>
      <button type="button" onClick={() => dirty.setTabDirty('students', true)}>标学生</button>
      <button type="button" onClick={() => dirty.setTabDirty('settings', false)}>清设置</button>
    </>
  );
}

function openDeferred(): { promise: Promise<SaveResult>; settle: (result: SaveResult) => void } {
  let settle: (result: SaveResult) => void = () => {
    throw new Error('save result is unset');
  };
  const promise = new Promise<SaveResult>((accept) => {
    settle = accept;
  });
  return { promise, settle };
}

async function renderSnapshot(
  kit: SettingsKit,
  titles: string[],
  post: () => Response,
): Promise<{ calls: RecordedCall[]; seen: string[]; done: Promise<SaveResult> }> {
  const seen: string[] = [];
  let index = 0;
  const calls = installFetch(({ method, url }) => {
    if (method === 'GET' && url.pathname === EDIT_PATH) {
      const title = titles[index];
      index += 1;
      if (!title) return hydroError('多余的读取。', 500);
      return jsonResponse(practicePayload(title));
    }
    if (method === 'POST' && url.pathname === EDIT_PATH) return post();
    return hydroError('不该请求这个地址。', 404);
  });
  const gate = openDeferred();
  const build = (latest: AnyLegacySnapshot) => {
    seen.push(`${latest.kind}:${titleOf(latest)}`);
    const body = new URLSearchParams();
    body.set('title', titleOf(latest));
    return body;
  };
  render(
    <kit.LegacySnapshotProvider type="practice" id={PRACTICE_ID}>
      <SnapshotProbe useSnapshot={kit.useLegacySnapshot} build={build} onDone={gate.settle} />
    </kit.LegacySnapshotProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('snapshot-state').textContent).toBe('ready:mount-title');
  });
  return { calls, seen, done: gate.promise };
}

describe('legacy snapshot save', () => {
  it('posts the body built from the snapshot read after mount and before the post', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const { calls, seen, done } = await renderSnapshot(
      kit,
      ['mount-title', 'fresh-title', 'saved-title'],
      () => jsonResponse({ ok: true }),
    );

    await user.click(screen.getByRole('button', { name: '保存快照' }));
    await expect(done).resolves.toEqual({ ok: true });
    await waitFor(() => {
      expect(screen.getByTestId('snapshot-state').textContent).toBe('ready:saved-title');
    });

    expect(calls.map((call) => `${call.method} ${call.pathname}`)).toEqual([
      `GET ${EDIT_PATH}`,
      `GET ${EDIT_PATH}`,
      `POST ${EDIT_PATH}`,
      `GET ${EDIT_PATH}`,
    ]);
    expect(seen).toEqual(['practice:fresh-title']);
    const posted = calls.find((call) => call.method === 'POST');
    const params = new URLSearchParams(posted?.body ?? '');
    expect(params.get('title')).toBe('fresh-title');
    expect(posted?.body ?? '').not.toContain('mount-title');
    expect(posted?.body ?? '').not.toContain('saved-title');
  });

  it('throws the server sentence when the save post is rejected', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const { calls, done } = await renderSnapshot(
      kit,
      ['mount-title', 'fresh-title'],
      () => hydroError(SERVER_MESSAGE, 400),
    );

    await user.click(screen.getByRole('button', { name: '保存快照' }));
    await expect(done).resolves.toEqual({ ok: false, message: SERVER_MESSAGE });
    expect(calls.map((call) => `${call.method} ${call.pathname}`)).toEqual([
      `GET ${EDIT_PATH}`,
      `GET ${EDIT_PATH}`,
      `POST ${EDIT_PATH}`,
    ]);
  });
});

describe('share panel', () => {
  it('asks to share two own hidden problems and posts both ids', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const calls = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) {
        return jsonResponse(sharePayload({ ownHiddenUnshared: OWN_HIDDEN }));
      }
      if (method === 'POST' && url.pathname === SHARE_PATH) {
        return jsonResponse(sharePayload({ shared: sharedStamp() }));
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));

    expect(await screen.findByRole('heading', { name: '学校内共享' })).toBeTruthy();
    expect(screen.getByText(SHARE_PANEL_DESCRIPTION)).toBeTruthy();
    expect(screen.getByText(SHARE_OFF)).toBeTruthy();
    await user.click(labeledSwitch(SHARE_LABEL));

    const dialog = await screen.findByRole('dialog', { name: OWN_DIALOG_TITLE });
    expect(dialog.className).toContain('sm:max-w-sm');
    expect(within(dialog).getByText(OWN_DIALOG_LEAD)).toBeTruthy();
    expect(within(dialog).getByText(OWN_DIALOG_NOTE)).toBeTruthy();
    expect(within(dialog).getByText('P5240')).toBeTruthy();
    expect(within(dialog).getByText('顺序栈的入栈与出栈')).toBeTruthy();
    expect(within(dialog).getByText('P5242')).toBeTruthy();
    expect(within(dialog).getByText('循环队列的实现')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    const confirm = within(dialog).getByRole('button', { name: '一并共享并开启' });
    expect(confirm).toHaveAttribute('data-variant', 'primary');
    await user.click(confirm);

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const posted = jsonBody(calls.find((call) => call.method === 'POST')?.body ?? '');
    expect(posted.shared).toBe(true);
    expect(posted.shareOwnProblems).toBe(true);
    expect(posted.expectedOwnDocIds).toEqual([11, 12]);
  });

  it('reloads hidden problems after a rejected share confirmation and posts the new ids', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    let reads = 0;
    const calls = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) {
        reads += 1;
        const ownHiddenUnshared = reads === 1 ? OWN_HIDDEN : [FRESH_HIDDEN];
        return jsonResponse(sharePayload({ ownHiddenUnshared }));
      }
      if (method === 'POST' && url.pathname === SHARE_PATH) {
        if (calls.filter((call) => call.method === 'POST').length === 1) return hydroError(SHARE_STALE, 400);
        return jsonResponse(sharePayload({ shared: sharedStamp() }));
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    await user.click(await screen.findByRole('switch', { name: SHARE_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: OWN_DIALOG_TITLE });
    await user.click(within(dialog).getByRole('button', { name: '一并共享并开启' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const stalePost = jsonBody(calls.find((call) => call.method === 'POST')?.body ?? '');
    expect(stalePost.shared).toBe(true);
    expect(stalePost.shareOwnProblems).toBe(true);
    expect(stalePost.expectedOwnDocIds).toEqual([11, 12]);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(SHARE_STALE);
    expect(labeledSwitch(SHARE_LABEL).checked).toBe(false);

    const getsBeforeReopen = shareGets(calls);
    await user.click(labeledSwitch(SHARE_LABEL));
    await waitFor(() => {
      expect(shareGets(calls)).toBeGreaterThan(getsBeforeReopen);
    });
    const nextDialog = await screen.findByRole('dialog', { name: FRESH_DIALOG_TITLE });
    expect(within(nextDialog).getByText('P5301')).toBeTruthy();
    expect(within(nextDialog).getByText('新的隐藏题')).toBeTruthy();
    expect(within(nextDialog).queryByText('P5240')).toBeNull();
    await user.click(within(nextDialog).getByRole('button', { name: '一并共享并开启' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    });
    const posts = calls.filter((call) => call.method === 'POST');
    const freshPost = jsonBody(posts[posts.length - 1]?.body ?? '');
    expect(freshPost.shared).toBe(true);
    expect(freshPost.shareOwnProblems).toBe(true);
    expect(freshPost.expectedOwnDocIds).toEqual([31]);
  });

  it('does not post sharing when another teacher owns an unshared hidden problem', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const calls = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) {
        return jsonResponse(sharePayload({ othersHiddenUnshared: [OTHER_HIDDEN] }));
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    await user.click(await screen.findByRole('switch', { name: SHARE_LABEL }));

    const dialog = await screen.findByRole('dialog', { name: OTHERS_TITLE });
    expect(within(dialog).getByText('P1001')).toBeTruthy();
    expect(within(dialog).getByText('别人的隐藏题')).toBeTruthy();
    expect(within(dialog).getByText('李老师')).toBeTruthy();
    expect(within(dialog).getByText(OTHERS_NOTE)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '知道了' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(postsSharedTrue(calls)).toHaveLength(0);
    expect(labeledSwitch(SHARE_LABEL).checked).toBe(false);
  });

  it('posts shared true directly when nothing blocks sharing', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const pending: { release: ((response: Response) => void) | null } = { release: null };
    const calls = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) return jsonResponse(sharePayload());
      if (method === 'POST' && url.pathname === SHARE_PATH) {
        return new Promise<Response>((accept) => {
          pending.release = accept;
        });
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    await user.click(await screen.findByRole('switch', { name: SHARE_LABEL }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    expect(labeledSwitch(SHARE_LABEL)).toBeDisabled();
    const posted = jsonBody(calls.find((call) => call.method === 'POST')?.body ?? '');
    expect(posted.shared).toBe(true);
    expect(posted.shareOwnProblems).not.toBe(true);
    expect(posted.expectedOwnDocIds).toBeUndefined();
    if (!pending.release) throw new Error('share post did not start');
    pending.release(jsonResponse(sharePayload({ shared: sharedStamp() })));
    await waitFor(() => {
      expect(labeledSwitch(SHARE_LABEL)).toBeEnabled();
      expect(labeledSwitch(SHARE_LABEL).checked).toBe(true);
    });
    expect(screen.getByText(SHARE_ON)).toBeTruthy();
  });

  it('closes the own-problem dialog without posting when the teacher cancels', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const calls = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) {
        return jsonResponse(sharePayload({ ownHiddenUnshared: OWN_HIDDEN }));
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    await user.click(await screen.findByRole('switch', { name: SHARE_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: OWN_DIALOG_TITLE });
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(labeledSwitch(SHARE_LABEL).checked).toBe(false);
  });

  it('stops sharing with a toast and restores the switch when the post fails', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    const success = vi.spyOn(toast, 'success');
    const calls = installFetch(({ method, url, body }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) {
        return jsonResponse(sharePayload({ shared: sharedStamp() }));
      }
      if (method === 'POST' && url.pathname === SHARE_PATH) {
        const posted = jsonBody(body);
        if (posted.shared === false) return jsonResponse(sharePayload());
        return hydroError(SHARE_REJECTED, 400);
      }
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    const toggle = await screen.findByRole('switch', { name: SHARE_LABEL });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    expect(screen.getByText(SHARE_ON)).toBeTruthy();
    await user.click(toggle);
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    expect(jsonBody(calls.find((call) => call.method === 'POST')?.body ?? '').shared).toBe(false);
    expect(success.mock.calls.some((args) => args[0] === SHARE_STOPPED)).toBe(true);
    await waitFor(() => {
      expect(labeledSwitch(SHARE_LABEL).checked).toBe(false);
    });

    cleanup();
    const failed = installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) return jsonResponse(sharePayload());
      if (method === 'POST' && url.pathname === SHARE_PATH) return hydroError(SHARE_REJECTED, 400);
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare />));
    await user.click(await screen.findByRole('switch', { name: SHARE_LABEL }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SHARE_REJECTED);
    await waitFor(() => {
      expect(labeledSwitch(SHARE_LABEL)).toBeEnabled();
      expect(labeledSwitch(SHARE_LABEL).checked).toBe(false);
    });
    expect(failed.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('disables sharing for someone who is not the owner', async () => {
    const kit = await loadKit();
    installFetch(({ method, url }) => {
      if (method === 'GET' && url.pathname === SHARE_PATH) return jsonResponse(sharePayload({ canShare: false }));
      return hydroError('不该请求这个地址。', 404);
    });
    render(<kit.SharePanel type="practice" id={PRACTICE_ID} canShare={false} />);
    const toggle = await screen.findByRole('switch', { name: SHARE_LABEL });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(SHARE_LABEL)).toBeTruthy();
    expect(screen.getByText(SHARE_DISABLED)).toBeTruthy();
    expect(screen.queryByText(SHARE_OFF)).toBeNull();
  });
});

describe('danger panel', () => {
  async function confirmDelete(
    kit: SettingsKit,
    type: TeachType,
    pathname: string,
    title: string,
    noun: string,
  ) {
    cleanup();
    const calls = installFetch(({ method, url }) => {
      if (method === 'POST' && url.pathname === pathname) return jsonResponse({ ok: true });
      return hydroError('不该请求这个地址。', 404);
    });
    render(withDialog(
      <kit.DangerPanel type={type} id={PRACTICE_ID} title={title} noun={noun} canDelete />,
    ));
    expect(screen.getByRole('heading', { name: '危险操作' })).toBeTruthy();
    expect(screen.getByText(`删除这个${noun}`)).toBeTruthy();
    expect(screen.getByText(DELETE_WARNING)).toBeTruthy();
    const remove = screen.getByRole('button', { name: '删除' });
    expect(remove).toHaveAttribute('data-variant', 'danger-soft');
    const user = userEvent.setup();
    await user.click(remove);
    const dialog = await screen.findByRole('dialog', { name: `删除「${title}」？` });
    expect(within(dialog).getByText(DELETE_WARNING)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const posted = calls.find((call) => call.method === 'POST');
    expect(posted?.pathname).toBe(pathname);
    expect(new URLSearchParams(posted?.body ?? '').get('operation')).toBe('delete');
  }

  it('posts a practice delete and leaves for the teach list', async () => {
    const kit = await loadKit();
    await confirmDelete(kit, 'practice', `/problem-sets/${PRACTICE_ID}`, '链表练习', '练习');
    await confirmDelete(kit, 'homework', `/homework/${PRACTICE_ID}/edit`, '一次函数', '作业');
    await confirmDelete(kit, 'exam', `/contest/${PRACTICE_ID}/edit`, '期末考试', '考试');
    expect(kitSource()).toMatch(/location\.assign\(\s*(['"`])\/teach\1\s*\)/);
  });

  it('does not render the danger panel when the teacher cannot delete', async () => {
    const kit = await loadKit();
    const { container } = render(
      <kit.DangerPanel type="practice" id={PRACTICE_ID} title="链表练习" noun="练习" canDelete={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: '危险操作' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  });
});

describe('save bar and switch row', () => {
  it('hides the save bar when nothing is dirty and shows it while saving', async () => {
    const kit = await loadKit();
    const onSave = vi.fn<() => void>();
    const onDiscard = vi.fn<() => void>();
    const hidden = render(
      <kit.SaveBar dirtyCount={0} saving={false} onSave={onSave} onDiscard={onDiscard} />,
    );
    expect(hidden.container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    hidden.unmount();

    const user = userEvent.setup();
    const shown = render(
      <kit.SaveBar dirtyCount={2} saving={false} onSave={onSave} onDiscard={onDiscard} />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('2 项修改未保存');
    expect(screen.getByRole('button', { name: '放弃' })).toHaveAttribute('data-variant', 'ghost');
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toHaveAttribute('data-variant', 'primary');
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '放弃' }));
    await user.click(save);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    shown.unmount();

    render(<kit.SaveBar dirtyCount={1} saving onSave={onSave} onDiscard={onDiscard} />);
    const busy = screen.getByRole('button', { name: '保存' });
    expect(busy).toBeDisabled();
    expect(busy.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('1 项修改未保存');
  });

  it('keeps the switch label when the row is disabled', async () => {
    const kit = await loadKit();
    const onCheckedChange = vi.fn<(next: boolean) => void>();
    render(
      <>
        <kit.SwitchRow
          id="share-off"
          label={SHARE_LABEL}
          description={SHARE_OFF}
          checked={false}
          onCheckedChange={onCheckedChange}
          disabled
          disabledReason={SHARE_DISABLED}
        />
        <kit.SwitchRow
          id="share-on"
          label={SHARE_LABEL}
          description={SHARE_ON}
          checked
          onCheckedChange={onCheckedChange}
          disabled
          disabledReason={SHARE_DISABLED}
        />
      </>,
    );
    const labels = [...document.querySelectorAll('label')].map((node) => node.textContent?.trim());
    expect(labels).toEqual([SHARE_LABEL, SHARE_LABEL]);
    expect(screen.getAllByText(SHARE_DISABLED)).toHaveLength(2);
    expect(screen.queryByText(SHARE_OFF)).toBeNull();
    expect(screen.queryByText(SHARE_ON)).toBeNull();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    const off = switches[0];
    const on = switches[1];
    if (!(off instanceof HTMLInputElement) || !(on instanceof HTMLInputElement)) {
      throw new TypeError('switch must be an input');
    }
    expect(off).toBeDisabled();
    expect(on).toBeDisabled();
    expect(off.checked).toBe(false);
    expect(on.checked).toBe(true);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('collaborators and dirty tabs', () => {
  it('shows collaborator names and falls back to uid when lookup fails', async () => {
    const kit = await loadKit();
    installFetch(({ method, url }) => {
      if (method === 'POST' && url.pathname === '/d/system/api/users') {
        return jsonResponse([{ _id: 7, uname: 'wang', displayName: '王老师' }]);
      }
      return hydroError('用户资料加载失败', 500);
    });
    const loaded = render(
      <BootstrapProvider bootstrap={pageBootstrap()}>
        <kit.CollaboratorsPanel noun="作业" value={[7]} onChange={vi.fn()} />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '协作者' })).toBeTruthy();
    expect(screen.getByText(COLLABORATOR_DESCRIPTION)).toBeTruthy();
    expect(await screen.findByText('王老师')).toBeTruthy();
    loaded.unmount();

    installFetch(() => hydroError('用户资料加载失败', 500));
    render(
      <BootstrapProvider bootstrap={pageBootstrap()}>
        <kit.CollaboratorsPanel noun="作业" value={[7]} onChange={vi.fn()} />
      </BootstrapProvider>,
    );
    expect(await screen.findByText('UID 7')).toBeTruthy();
    expect(screen.queryByText('王老师')).toBeNull();
  });

  it('records which tabs are dirty and counts changed keys by json text', async () => {
    const user = userEvent.setup();
    const kit = await loadKit();
    render(
      <kit.WorkbenchDirtyProvider>
        <DirtyProbe useDirty={kit.useWorkbenchDirty} />
      </kit.WorkbenchDirtyProvider>,
    );
    expect(screen.getByTestId('dirty-tabs').textContent).toBe('');
    await user.click(screen.getByRole('button', { name: '标设置' }));
    await user.click(screen.getByRole('button', { name: '标学生' }));
    await user.click(screen.getByRole('button', { name: '标设置' }));
    expect(screen.getByTestId('dirty-tabs').textContent).toBe('settings,students');
    await user.click(screen.getByRole('button', { name: '清设置' }));
    expect(screen.getByTestId('dirty-tabs').textContent).toBe('students');

    const base: Record<string, unknown> = { title: '甲', hours: 1, tags: ['a', 'b'], vigil: { hosts: 'a', ports: '1' } };
    const same: Record<string, unknown> = { title: '甲', hours: 1, tags: ['a', 'b'], vigil: { hosts: 'a', ports: '1' } };
    const draft: Record<string, unknown> = { title: '乙', hours: 1, tags: ['b', 'a'], vigil: { ports: '1', hosts: 'a' } };
    expect(kit.countChangedKeys(base, same, ['title', 'hours', 'tags', 'vigil'])).toBe(0);
    expect(kit.countChangedKeys(base, draft, ['title', 'hours', 'tags', 'vigil'])).toBe(3);
    expect(kit.countChangedKeys(base, draft, ['hours'])).toBe(0);
  });
});
