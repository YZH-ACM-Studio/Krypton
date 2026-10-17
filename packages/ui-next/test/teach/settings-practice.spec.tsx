import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeachTab } from '@hydrooj/common';
import type { ComponentType } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { parsePracticeSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import type { TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import {
  LegacySnapshotProvider,
  useWorkbenchDirty,
  WorkbenchDirtyProvider,
} from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while settings-practice.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/settings-practice.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/settings-practice.tsx';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d4f';
const EDIT_PATH = `/problem-sets/${PRACTICE_ID}/edit`;
const SHARE_PATH = `/teach/practice/${PRACTICE_ID}/share`;
const TITLE = '链表专项练习';
const CONTENT = '阶段说明正文';
const MOUNT_DESCRIPTION = '旧简介';
const FRESH_DESCRIPTION = '服务端刚改的简介';
const NEXT_DESCRIPTION = '链表每天一道';
const BLURB_HINT = '列表里显示的一句话';
const PIN_LABEL = '置顶';
const PIN_DESCRIPTION = '在题集列表最前面显示。';

interface StageWire {
  _id: number;
  title: string;
  requireNids: number[];
  pids: number[];
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

interface FetchGate {
  fresh: boolean;
}

interface SettingsPracticeProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

const MOUNT_DAG: StageWire[] = [
  { _id: 1, title: '旧阶段', requireNids: [], pids: [99] },
];

const FRESH_DAG: StageWire[] = [
  { _id: 2, title: '链表基础', requireNids: [], pids: [11, 12] },
  { _id: 5, title: '链表进阶', requireNids: [2], pids: [21] },
];

const SHARE_DOCUMENT: Record<string, unknown> = {
  shared: null,
  canShare: true,
  ownHiddenUnshared: [],
  othersHiddenUnshared: [],
};

function editDocument(
  dag: StageWire[],
  description: string,
  audience: { public: boolean; groupIds: string[] },
): Record<string, unknown> {
  return {
    page_name: 'problem_set_edit',
    groups: [
      { _id: 'g-old', name: '计科 2401' },
      { _id: 'g-fresh', name: '计科 2402' },
      { _id: 'g-other', name: '软工 2501' },
    ],
    audience,
    dag,
    tdoc: {
      _id: PRACTICE_ID,
      title: TITLE,
      content: CONTENT,
      description,
      pin: 0,
    },
  };
}

const MOUNT_DOCUMENT = editDocument(MOUNT_DAG, MOUNT_DESCRIPTION, { public: false, groupIds: ['g-old'] });
const FRESH_DOCUMENT = editDocument(FRESH_DAG, FRESH_DESCRIPTION, {
  public: true,
  groupIds: ['g-fresh', 'g-other'],
});

function workbenchPayload(canPin: boolean): TeachWorkbenchPayload {
  return {
    container: {
      type: 'practice',
      id: PRACTICE_ID,
      rule: 'problem_set',
      title: TITLE,
      status: 'open',
      beginAt: null,
      endAt: null,
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'groups',
        groupNames: ['计科 2401'],
        schoolNames: [],
        boundStudentCount: 12,
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
        redemption: '/manage/redemption-codes',
      },
    },
    paper: {
      problems: [],
      stages: [{ id: 1, title: '旧阶段', requireIds: [], pids: [99] }],
      examPaperQuotas: null,
    },
    stats: {
      participantCount: 3,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: 12,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin,
    },
  };
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
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) return load;
  }
  return undefined;
}

async function loadTab(): Promise<ComponentType<SettingsPracticeProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  let imported: unknown;
  try {
    imported = await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('settings practice module must be an object');
  }
  const component = readField(imported, 'SettingsPracticeTab');
  expect(typeof component, 'SettingsPracticeTab').toBe('function');
  if (typeof component !== 'function') throw new TypeError('SettingsPracticeTab must be a function');
  return component as ComponentType<SettingsPracticeProps>;
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

function hydroError(message: string, status = 404): Response {
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

function installFetch(gate: FetchGate): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    const call: RoutedCall = { method, url, body };
    calls.push({ method, pathname: url.pathname, body });
    if (method === 'GET' && url.pathname === EDIT_PATH) {
      return jsonResponse(gate.fresh ? FRESH_DOCUMENT : MOUNT_DOCUMENT);
    }
    if (method === 'GET' && url.pathname === SHARE_PATH) return jsonResponse(SHARE_DOCUMENT);
    if (method === 'POST' && url.pathname === EDIT_PATH) return jsonResponse({ ok: true });
    return hydroError(`不该请求 ${call.method} ${call.url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function assertFixtures(): void {
  const mounted = parsePracticeSnapshot(MOUNT_DOCUMENT);
  const fresh = parsePracticeSnapshot(FRESH_DOCUMENT);
  expect(mounted.state.description).toBe(MOUNT_DESCRIPTION);
  expect(mounted.state.audiencePublic).toBe(false);
  expect(mounted.state.audienceGroupIds).toEqual(['g-old']);
  expect(mounted.state.stages).toEqual([{ id: 1, title: '旧阶段', requireIds: [], pids: [99] }]);
  expect(fresh.state.description).toBe(FRESH_DESCRIPTION);
  expect(fresh.state.audiencePublic).toBe(true);
  expect(fresh.state.audienceGroupIds).toEqual(['g-fresh', 'g-other']);
  expect(fresh.state.stages).toEqual([
    { id: 2, title: '链表基础', requireIds: [], pids: [11, 12] },
    { id: 5, title: '链表进阶', requireIds: [2], pids: [21] },
  ]);
}

function DirtyMarker() {
  const { dirtyTabs } = useWorkbenchDirty();
  return <p data-testid="dirty-tabs">{[...dirtyTabs].sort().join(',')}</p>;
}

function fieldName(label: string): (name: string) => boolean {
  return (name) => name.replaceAll('*', '').trim() === label;
}

async function renderPractice(canPin: boolean, gate: FetchGate = { fresh: false }): Promise<RecordedCall[]> {
  assertFixtures();
  const Tab = await loadTab();
  const calls = installFetch(gate);
  const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type="practice" id={PRACTICE_ID}>
          <DirtyMarker />
          <Tab payload={workbenchPayload(canPin)} onNavigateTab={onNavigateTab} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
  return calls;
}

async function readyDescription(): Promise<HTMLElement> {
  const field = await screen.findByRole('textbox', { name: fieldName('简介') });
  expect(screen.getByRole('heading', { name: '基本信息' })).toBeTruthy();
  expect(screen.getByText(BLURB_HINT)).toBeTruthy();
  expect(screen.getByRole('heading', { name: '学校内共享' })).toBeTruthy();
  return field;
}

function editPosts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === 'POST' && call.pathname === EDIT_PATH);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('practice settings tab', () => {
  it('posts the edited description and the dag from the snapshot read at save time', async () => {
    const user = userEvent.setup();
    const gate: FetchGate = { fresh: false };
    const calls = await renderPractice(true, gate);
    const description = await readyDescription();
    expect(description).toHaveValue(MOUNT_DESCRIPTION);
    expect(screen.getByTestId('dirty-tabs').textContent).toBe('');

    await user.clear(description);
    await user.type(description, NEXT_DESCRIPTION);
    expect(description).toHaveValue(NEXT_DESCRIPTION);
    await waitFor(() => {
      expect(screen.getByTestId('dirty-tabs').textContent).toBe('settings');
    });

    // save() reads again. Stages and audience must follow that read, not the mount snapshot.
    gate.fresh = true;
    await user.click(await screen.findByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(editPosts(calls)).toHaveLength(1);
    });

    const params = new URLSearchParams(editPosts(calls)[0]?.body ?? '');
    const dagText = params.get('dag');
    expect(typeof dagText).toBe('string');
    if (typeof dagText !== 'string') throw new TypeError('dag');
    expect(params.get('description')).toBe(NEXT_DESCRIPTION);
    expect(JSON.parse(dagText)).toEqual(FRESH_DAG);
    expect(params.get('audiencePublic')).toBe('1');
    expect(params.get('audienceGroupIds')).toBe('g-fresh,g-other');
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.pathname)).toEqual([EDIT_PATH]);
  });

  it('does not render pin when the teacher cannot pin', async () => {
    await renderPractice(false);
    await readyDescription();
    expect(screen.queryByRole('switch', { name: fieldName(PIN_LABEL) })).toBeNull();
    expect(screen.queryByText(PIN_LABEL)).toBeNull();
    expect(screen.queryByText(PIN_DESCRIPTION)).toBeNull();
  });

  it('renders pin when the teacher can pin', async () => {
    await renderPractice(true);
    await readyDescription();
    expect(screen.getByRole('switch', { name: fieldName(PIN_LABEL) })).toBeTruthy();
    expect(screen.getByText(PIN_DESCRIPTION)).toBeTruthy();
  });

  it('does not render a collaborator panel', async () => {
    await renderPractice(true);
    await readyDescription();
    expect(screen.getByText('删除这个练习')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '协作者' })).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('协作者');
  });
});
