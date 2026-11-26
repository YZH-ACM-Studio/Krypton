import type { TeachTab, TeachType } from '@hydrooj/common';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { legacyEditPath, parseContestSnapshot, parseHomeworkSnapshot, parsePracticeSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import type { TeachCapabilities, TeachLinks, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider, WorkbenchDirtyProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while advanced.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/advanced.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/advanced.tsx';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d40';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d41';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d42';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d43';
const OI_ID = '64b7c3a2e4b0f96d1a2c3d44';
const SCHOOL_ID = '64b7c3a2e4b0f96d1a2c3d50';
const SEAT_INVITE_CODE = 'seat-invite';
const CREATE_SEAT_LABEL = '创建考试活动并安排座位';

interface AdvancedTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface RecordedCall {
  method: string;
  pathname: string;
  search: string;
}

interface RoutedCall {
  method: string;
  url: URL;
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
    if (!key.endsWith(TAB_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadAdvancedTab(): Promise<ComponentType<AdvancedTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('advanced tab module must be an object');
  return asComponent<AdvancedTabProps>(readField(imported, 'AdvancedTab'), 'AdvancedTab');
}

function requestUrl(input: RequestInfo | URL): URL {
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

function installFetch(documents: Record<string, Record<string, unknown>>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, pathname: url.pathname, search: url.search });
    return routeFetch(documents, { method, url });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function routeFetch(documents: Record<string, Record<string, unknown>>, call: RoutedCall): Response {
  if (call.method === 'GET' && call.url.pathname.startsWith('/practice-integrity/')) {
    return jsonResponse({ published: null, draft: null });
  }
  if (call.method === 'GET' && call.url.pathname === '/api/admin/exam-events') {
    return jsonResponse({ events: [], schools: [] });
  }
  const document = documents[call.url.pathname];
  if (call.method === 'GET' && document) return jsonResponse(document);
  if (call.method === 'POST' && document) return jsonResponse({ ok: true });
  return jsonResponse(
    {
      error: { message: `不该请求 ${call.method} ${call.url.pathname}` },
    },
    404,
  );
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

interface SeatAudienceFixture {
  inviteCode: string;
  participantScopeMode: 'schools';
  participantSchoolIds: string[];
}

function contestDocument(id: string, rule: string, team: boolean, manageBatches: boolean, seat?: SeatAudienceFixture): Record<string, unknown> {
  // Serialized contest edit JSON drops tdoc._code. The invite code is only the top-level inviteCode.
  const tdoc: Record<string, unknown> = {
    _id: id,
    title: '题目集',
    content: '说明',
    rule,
    beginAt: '2026-10-20T01:00:00.000Z',
    endAt: '2026-10-20T03:00:00.000Z',
    pids: [11],
    participationMode: team ? 'team' : 'individual',
    vigilEnabled: false,
  };
  if (seat) {
    tdoc.participantScopeMode = seat.participantScopeMode;
    tdoc.participantSchoolIds = [...seat.participantSchoolIds];
  }
  const raw: Record<string, unknown> = {
    page_name: 'contest_edit',
    inviteCode: seat?.inviteCode ?? 'keep-invite',
    duration: 2,
    pids: [11],
    beginAt: '2026-10-20T01:00:00.000Z',
    participationRevision: 1,
    teamModeClearConfirmation: '',
    scopeSchools: [],
    scopeGroups: [],
    canAutoHideProblems: false,
    activeTeamCount: 0,
    recordCount: 0,
    canManageTeamBatches: manageBatches,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    tdoc,
  };
  parseContestSnapshot(raw);
  return raw;
}

function homeworkDocument(id: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    page_name: 'homework_edit',
    extensionDays: 0,
    penaltyRules: {},
    dateBeginText: '2026-10-20',
    timeBeginText: '09:00',
    datePenaltyText: '2026-10-27',
    timePenaltyText: '23:59',
    participantScopeMode: 'none',
    participantGroupIds: [],
    scopeGroups: [],
    tdoc: {
      _id: id,
      title: '题目集',
      content: '说明',
      pids: [11],
    },
  };
  parseHomeworkSnapshot(raw);
  return raw;
}

function practiceDocument(id: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    page_name: 'problem_set_edit',
    groups: [],
    audience: { public: false, groupIds: ['g1'] },
    dag: [{ _id: 2, title: '入门', requireNids: [], pids: [11] }],
    tdoc: {
      _id: id,
      title: '题目集',
      content: '说明',
      description: '简介',
      pin: false,
    },
  };
  parsePracticeSnapshot(raw);
  return raw;
}

function baseLinks(type: TeachType, id: string): TeachLinks {
  if (type === 'practice') {
    return {
      studentView: `/problem-sets/${id}`,
      scoreboard: null,
      manage: null,
      users: null,
      clarification: null,
      grading: null,
      teams: null,
      balloon: null,
      print: null,
      code: null,
      files: `/problem-sets/${id}/file`,
      redemption: null,
    };
  }
  if (type === 'homework') {
    return {
      studentView: `/homework/${id}`,
      scoreboard: `/homework/${id}/scoreboard`,
      manage: null,
      users: null,
      clarification: null,
      grading: null,
      teams: null,
      balloon: null,
      print: null,
      code: null,
      files: `/homework/${id}/file`,
      redemption: null,
    };
  }
  return {
    studentView: `/contest/${id}`,
    scoreboard: `/contest/${id}/scoreboard`,
    manage: `/contest/${id}/management`,
    users: `/contest/${id}/user`,
    clarification: `/contest/${id}/clarification`,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: `/contest/${id}/management`,
    redemption: null,
  };
}

function capabilities(manageBatches: boolean): TeachCapabilities {
  return {
    canDelete: true,
    canShare: true,
    canGrade: false,
    canManageTeamBatches: manageBatches,
    isSystemAdmin: false,
    canPin: false,
  };
}

function workbench(options: {
  type: TeachType;
  id: string;
  rule: string;
  team?: boolean;
  manageBatches?: boolean;
  links?: Partial<TeachLinks>;
}): TeachWorkbenchPayload {
  const team = options.team ?? false;
  const manageBatches = options.manageBatches ?? false;
  return {
    container: {
      type: options.type,
      id: options.id,
      rule: options.rule,
      title: '题目集',
      status: options.type === 'practice' ? 'open' : 'upcoming',
      beginAt: options.type === 'practice' ? null : '2026-10-20T01:00:00.000Z',
      endAt: options.type === 'practice' ? null : '2026-10-20T03:00:00.000Z',
      durationMinutes: null,
      penaltySince: options.type === 'homework' ? '2026-10-27T15:59:00.000Z' : null,
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
      participationMode: team ? 'team' : 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: { ...baseLinks(options.type, options.id), ...options.links },
    },
    paper: {
      problems: [],
      stages: options.type === 'practice' ? [{ id: 2, title: '入门', requireIds: [], pids: [11] }] : null,
      examPaperQuotas: null,
    },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: options.type === 'practice' ? null : 0,
      recordCount: options.type === 'practice' ? null : 0,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: capabilities(manageBatches),
  };
}

function editDocument(value: TeachWorkbenchPayload, snapshotManageBatches: boolean): Record<string, unknown> {
  const { type, id, rule } = value.container;
  const team = value.container.participationMode === 'team';
  if (type === 'practice') return practiceDocument(id);
  if (type === 'homework') return homeworkDocument(id);
  return contestDocument(id, rule, team, snapshotManageBatches);
}

function renderTab(
  AdvancedTab: ComponentType<AdvancedTabProps>,
  value: TeachWorkbenchPayload,
  snapshotManageBatches = value.capabilities.canManageTeamBatches,
  editRaw?: Record<string, unknown>,
): RecordedCall[] {
  const calls = installFetch({
    [legacyEditPath(value.container.type, value.container.id)]: editRaw ?? editDocument(value, snapshotManageBatches),
  });
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type={value.container.type} id={value.container.id}>
          <AdvancedTab payload={value} onNavigateTab={() => undefined} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
  return calls;
}

async function select(name: string) {
  await userEvent.setup().click(await screen.findByRole('tab', { name }));
}
describe('advanced settings categories', () => {
  it('preserves the accepted legacy snapshots', () => {
    parseHomeworkSnapshot(homeworkDocument(HOMEWORK_ID));
    parsePracticeSnapshot(practiceDocument(PRACTICE_ID));
    parseContestSnapshot(contestDocument(ACM_ID, 'acm', true, true));
  });
  it('keeps homework management tools without unrelated printing or grading links', async () => {
    const value = workbench({
      type: 'homework',
      id: HOMEWORK_ID,
      rule: 'homework',
      links: { grading: `/manage/grading/${HOMEWORK_ID}`, print: '/print', code: '/code' },
    });
    renderTab(await loadAdvancedTab(), value);
    await select('管理工具');
    expect(screen.getByRole('link', { name: /附件文件/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /打印服务|主观题阅卷|导出代码/ })).toBeNull();
  });
  it('switches between practice stages, integrity and tools', async () => {
    const value = workbench({ type: 'practice', id: PRACTICE_ID, rule: 'problem_set', links: { redemption: '/manage/redemption-codes' } });
    const calls = renderTab(await loadAdvancedTab(), value);
    await select('阶段与先修');
    expect(await screen.findByPlaceholderText('阶段名称')).toBeVisible();
    await select('真实性训练策略');
    expect(await screen.findByText('禁止粘贴或拖入外部代码')).toBeVisible();
    expect(screen.queryByPlaceholderText('阶段名称')).not.toBeVisible();
    await waitFor(() => expect(calls.some((call) => call.pathname === `/practice-integrity/problemSet/${PRACTICE_ID}`)).toBe(true));
    await select('管理工具');
    expect(screen.getByRole('link', { name: /兑换码/ })).toHaveAttribute('href', '/manage/redemption-codes');
  });
  it('omits unavailable management links', async () => {
    renderTab(await loadAdvancedTab(), workbench({ type: 'practice', id: PRACTICE_ID, rule: 'problem_set' }));
    await select('管理工具');
    expect(screen.queryByRole('link', { name: /兑换码/ })).toBeNull();
  });
  it.each([false, true])('only exposes team-batch management with capability %s', async (manageBatches) => {
    renderTab(await loadAdvancedTab(), workbench({ type: 'acm', id: ACM_ID, rule: 'acm', team: true, manageBatches }), manageBatches);
    await screen.findByRole('tab', { name: '其它设置' });
    if (manageBatches) {
      await select('队伍批次预绑定');
      expect(await screen.findByText('赛前组队批次')).toBeVisible();
    } else expect(screen.queryByRole('tab', { name: '队伍批次预绑定' })).toBeNull();
  });
  it('explains the team prerequisite for individual contests', async () => {
    renderTab(await loadAdvancedTab(), workbench({ type: 'acm', id: ACM_ID, rule: 'acm', team: false, manageBatches: true }), true);
    await select('队伍批次预绑定');
    expect(await screen.findByText(/先在「学生」里打开组队参赛/)).toBeVisible();
  });
  it('keeps invitation-only exams out of automatic seating', async () => {
    const value = workbench({ type: 'exam', id: EXAM_ID, rule: 'exam' });
    const edit = contestDocument(EXAM_ID, 'exam', false, false, {
      inviteCode: SEAT_INVITE_CODE,
      participantScopeMode: 'schools',
      participantSchoolIds: [SCHOOL_ID],
    });
    renderTab(await loadAdvancedTab(), value, false, edit);
    await select('座位与机房');
    expect(await screen.findByText(/仅邀请码/)).toBeVisible();
    expect(screen.queryByRole('button', { name: CREATE_SEAT_LABEL })).toBeNull();
  });
  it('does not show exam seating or team batches for OI', async () => {
    renderTab(await loadAdvancedTab(), workbench({ type: 'oi', id: OI_ID, rule: 'oi', team: true, manageBatches: true }), true);
    await screen.findByRole('tab', { name: '其它设置' });
    expect(screen.queryByRole('tab', { name: '座位与机房' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '队伍批次预绑定' })).toBeNull();
  });
});
