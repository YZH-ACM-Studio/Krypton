import type { TeachTab, TeachType } from '@hydrooj/common';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import {
  contestFormBody,
  homeworkFormBody,
  parseContestSnapshot,
  parseHomeworkSnapshot,
  parsePracticeSnapshot,
  practiceFormBody,
} from '../../src/pages/teach/legacy-forms.ts';
import type { TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider, WorkbenchDirtyProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while students.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/students.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/students.tsx';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d11';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d22';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d33';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d44';
const CLEAR_TOKEN = 'clear-token-f13';
const HOMEWORK_PATH = `/homework/${HOMEWORK_ID}/edit`;
const ACM_PATH = `/contest/${ACM_ID}/edit`;
const EXAM_PATH = `/contest/${EXAM_ID}/edit`;
const PRACTICE_PATH = `/problem-sets/${PRACTICE_ID}/edit`;
const MOUNT_TITLE = '一次函数作业';
const FRESH_TITLE = '一次函数作业-已刷新';
const TEAM_BACK_TITLE = '改回个人参赛？';
const TEAM_BACK_MESSAGE = '这场比赛已经有 3 支队伍，保存后会清空全部队伍。';
const TEAM_BACK_CONFIRM = '清空队伍并改回';
const GROUP_PLACEHOLDER = '搜索用户组';

interface StudentsTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
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

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) return load;
  }
  return undefined;
}

async function loadStudentsTab(): Promise<ComponentType<StudentsTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('students tab module must be an object');
  return asComponent<StudentsTabProps>(readField(imported, 'StudentsTab'), 'StudentsTab');
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

function installSnapshots(pathname: string, versions: Array<Record<string, unknown>>): RecordedCall[] {
  let reads = 0;
  return installFetch(({ method, url }) => {
    if (url.pathname !== pathname) return hydroError('不该请求这个地址。', 404);
    if (method === 'GET') {
      const version = versions[Math.min(reads, versions.length - 1)];
      reads += 1;
      if (!version) return hydroError('多余的读取。', 500);
      return jsonResponse(version);
    }
    if (method === 'POST') return jsonResponse({ ok: true });
    return hydroError('不该请求这个地址。', 405);
  });
}

function postBody(calls: RecordedCall[], pathname: string): URLSearchParams {
  const posts = calls.filter((call) => call.method === 'POST' && call.pathname === pathname);
  expect(posts).toHaveLength(1);
  const call = posts[0];
  if (!call) throw new TypeError('missing post');
  return new URLSearchParams(call.body);
}

function homeworkRaw(variant: 'mount' | 'fresh'): Record<string, unknown> {
  const fresh = variant === 'fresh';
  return {
    page_name: 'homework_edit',
    extensionDays: 2,
    penaltyRules: fresh ? { 5: 0.75 } : { 1: 0.9 },
    dateBeginText: '2026-10-17',
    timeBeginText: '08:00',
    datePenaltyText: '2026-10-24',
    timePenaltyText: '23:59',
    participantScopeMode: 'none',
    participantGroupIds: [],
    scopeGroups: [
      { _id: 'a', name: '甲班' },
      { _id: 'b', name: '乙班' },
    ],
    pids: '3,4',
    tdoc: {
      _id: HOMEWORK_ID,
      title: fresh ? FRESH_TITLE : MOUNT_TITLE,
      content: '请写出过程',
      pids: [3, 4],
      rated: false,
      participantScopeMode: 'none',
    },
  };
}

function contestRaw(kind: 'acm' | 'exam'): Record<string, unknown> {
  const acm = kind === 'acm';
  return {
    page_name: 'contest_edit',
    inviteCode: '',
    duration: 5,
    beginAt: '2026-10-16T06:00:00.000Z',
    participationRevision: 4,
    teamModeClearConfirmation: acm ? CLEAR_TOKEN : '',
    scopeSchools: [],
    scopeGroups: [],
    canAutoHideProblems: true,
    activeTeamCount: acm ? 3 : 0,
    recordCount: acm ? 1 : 0,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    pids: '8',
    tdoc: {
      _id: acm ? ACM_ID : EXAM_ID,
      title: acm ? '周赛' : '期中考试',
      content: acm ? '说明' : '闭卷',
      rule: acm ? 'acm' : 'exam',
      beginAt: '2026-10-16T06:00:00.000Z',
      pids: [8],
      rated: !acm,
      hidden: false,
      participantScopeMode: 'none',
      participationMode: acm ? 'team' : 'individual',
    },
  };
}

function practiceRaw(): Record<string, unknown> {
  return {
    page_name: 'problem_set_edit',
    groups: [{ _id: 'g1', name: '软工 2501' }],
    audience: { public: false, groupIds: ['g1'] },
    dag: [{ _id: 1, title: '阶段 1', requireNids: [], pids: [11] }],
    tdoc: {
      _id: PRACTICE_ID,
      title: '链表练习',
      content: '看完链表再做题',
      description: '一句话简介',
      pin: false,
    },
  };
}

function workbench(
  type: TeachType,
  id: string,
  rule: string,
  participationMode: 'individual' | 'team',
): TeachWorkbenchPayload {
  return {
    container: {
      type,
      id,
      rule,
      title: '题目集',
      status: type === 'practice' ? 'open' : 'upcoming',
      beginAt: type === 'practice' ? null : '2026-10-16T06:00:00.000Z',
      endAt: type === 'practice' ? null : '2026-10-16T11:00:00.000Z',
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 4, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode,
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: `/contest/${id}`,
        scoreboard: null,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/contest/${id}/management`,
        redemption: type === 'practice' ? '/manage/redemption-codes' : null,
      },
    },
    paper: { problems: [], stages: type === 'practice' ? [] : null, examPaperQuotas: null },
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
      canPin: false,
    },
  };
}

function renderTab(StudentsTab: ComponentType<StudentsTabProps>, payload: TeachWorkbenchPayload) {
  render(
    <WorkbenchDirtyProvider>
      <LegacySnapshotProvider type={payload.container.type} id={payload.container.id}>
        <StudentsTab payload={payload} onNavigateTab={() => undefined} />
      </LegacySnapshotProvider>
      <DialogHost />
    </WorkbenchDirtyProvider>,
  );
}

async function chooseTwoGroups(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /指定用户组/ }));
  await user.click(screen.getByPlaceholderText(GROUP_PLACEHOLDER));
  await user.click(screen.getByRole('button', { name: '甲班' }));
  await user.click(screen.getByRole('button', { name: '乙班' }));
}

describe('students tab', () => {
  it('posts two homework groups without a school choice and keeps the refreshed snapshot', async () => {
    const user = userEvent.setup();
    const mounted = parseHomeworkSnapshot(homeworkRaw('mount'));
    const refreshed = parseHomeworkSnapshot(homeworkRaw('fresh'));
    const expected = homeworkFormBody({
      ...refreshed.state,
      participantScopeMode: 'groups',
      participantGroupIds: ['a', 'b'],
    });
    const stale = homeworkFormBody(mounted.state);
    expect(mounted.state.title).toBe(MOUNT_TITLE);
    expect(refreshed.state.title).toBe(FRESH_TITLE);
    expect(expected.get('participantScopeMode')).toBe('groups');
    expect(expected.get('participantGroupIds')).toBe('a,b');
    expect(expected.get('penaltyRules')).not.toBe(stale.get('penaltyRules'));
    expect(expected.get('penaltyRules')).toBe('5: 0.75');

    const StudentsTab = await loadStudentsTab();
    const calls = installSnapshots(HOMEWORK_PATH, [homeworkRaw('mount'), homeworkRaw('fresh')]);
    renderTab(StudentsTab, workbench('homework', HOMEWORK_ID, 'homework', 'individual'));

    const everyone = await screen.findByRole('radio', { name: /所有人/ });
    await waitFor(() => {
      expect(everyone).toBeChecked();
    });
    expect(screen.queryByRole('radio', { name: /指定学校/ })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    await chooseTwoGroups(user);
    await user.click(await screen.findByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const params = postBody(calls, HOMEWORK_PATH);
    expect(params.get('participantScopeMode')).toBe('groups');
    expect(params.get('participantGroupIds')).toBe('a,b');
    expect(params.get('penaltyRules')).toBe(expected.get('penaltyRules'));
    expect(params.get('title')).toBe(FRESH_TITLE);
    expect(params.toString()).toBe(expected.toString());
  });

  it('asks before leaving team mode when three teams exist and posts the snapshot token', async () => {
    const user = userEvent.setup();
    const parsed = parseContestSnapshot(contestRaw('acm'));
    expect(parsed.extras.activeTeamCount).toBe(3);
    expect(parsed.extras.teamModeClearToken).toBe(CLEAR_TOKEN);
    expect(parsed.state.participationMode).toBe('team');
    expect(parsed.state.teamModeClearConfirmation).toBe('');
    const expected = contestFormBody({
      ...parsed.state,
      participationMode: 'individual',
      teamModeClearConfirmation: parsed.extras.teamModeClearToken,
    });
    expect(expected.get('teamModeClearConfirmation')).toBe(CLEAR_TOKEN);
    expect(expected.get('participationMode')).toBe('individual');

    const StudentsTab = await loadStudentsTab();
    const calls = installSnapshots(ACM_PATH, [contestRaw('acm')]);
    renderTab(StudentsTab, workbench('acm', ACM_ID, 'acm', 'team'));

    const team = await screen.findByRole('switch', { name: '组队参赛' });
    await waitFor(() => {
      expect(team).toBeChecked();
    });
    await user.click(team);

    const cancelled = await screen.findByRole('dialog', { name: TEAM_BACK_TITLE });
    await user.click(within(cancelled).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('switch', { name: '组队参赛' })).toBeChecked();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    await user.click(screen.getByRole('switch', { name: '组队参赛' }));

    const dialog = await screen.findByRole('dialog', { name: TEAM_BACK_TITLE });
    expect(within(dialog).getByText(TEAM_BACK_MESSAGE)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: TEAM_BACK_CONFIRM }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    await user.click(await screen.findByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const params = postBody(calls, ACM_PATH);
    expect(params.get('teamModeClearConfirmation')).toBe(CLEAR_TOKEN);
    expect(params.get('participationMode')).toBe('individual');
    expect(params.get('title')).toBe('周赛');
    expect(params.toString()).toBe(expected.toString());
  });

  it('shows an error and does not post when the invite code is left empty', async () => {
    const user = userEvent.setup();
    const parsed = parseContestSnapshot(contestRaw('exam'));
    expect(parsed.state.code).toBe('');
    expect(parsed.state.rule).toBe('exam');

    const StudentsTab = await loadStudentsTab();
    const calls = installSnapshots(EXAM_PATH, [contestRaw('exam')]);
    renderTab(StudentsTab, workbench('exam', EXAM_ID, 'exam', 'individual'));

    const invite = await screen.findByRole('switch', { name: '需要邀请码' });
    await waitFor(() => {
      expect(invite).not.toBeChecked();
    });
    expect(screen.queryByRole('textbox', { name: /邀请码/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(invite);

    const input = screen.getByRole('textbox', { name: /邀请码/ });
    expect(input).toHaveValue('');
    await user.click(await screen.findByRole('button', { name: '保存' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => (node.textContent ?? '').trim() !== '')).toBe(true);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('posts audiencePublic when a practice is saved for everyone', async () => {
    const user = userEvent.setup();
    const parsed = parsePracticeSnapshot(practiceRaw());
    expect(parsed.state.audiencePublic).toBe(false);
    expect(parsed.state.audienceGroupIds).toEqual(['g1']);
    const expected = practiceFormBody({ ...parsed.state, audiencePublic: true });
    expect(expected.get('audiencePublic')).toBe('1');

    const StudentsTab = await loadStudentsTab();
    const calls = installSnapshots(PRACTICE_PATH, [practiceRaw()]);
    renderTab(StudentsTab, workbench('practice', PRACTICE_ID, 'problem_set', 'individual'));

    const groups = await screen.findByRole('radio', { name: /指定用户组/ });
    await waitFor(() => {
      expect(groups).toBeChecked();
    });
    await user.click(screen.getByRole('radio', { name: /所有人/ }));
    await user.click(await screen.findByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const params = postBody(calls, PRACTICE_PATH);
    expect(params.get('audiencePublic')).toBe('1');
    expect(params.get('title')).toBe(expected.get('title'));
    expect(params.get('dag')).toBe(expected.get('dag'));
    expect(params.get('content')).toBe(expected.get('content'));
    // Mode all has no group list. An empty value is still present and the server reads it as [''].
    expect(params.has('audienceGroupIds')).toBe(false);
  });
});
