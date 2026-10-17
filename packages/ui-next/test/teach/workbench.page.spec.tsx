// A static import fails collection while workbench.tsx is absent.
import type { TeachTab, TeachType } from '@hydrooj/common';
import { teachTabsFor } from '@hydrooj/common';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { examServerClock } from '../../src/lib/exam-server-clock.ts';
import {
  formatTeachWindow,
  OI_RULE_LABEL,
  parseTeachWorkbenchPayload,
  TEACH_STATUS_LABEL,
  TEACH_TYPE_LABEL,
  type TeachWorkbenchPayload,
} from '../../src/pages/teach/model.ts';

// Tab bodies stay out of this shell test. OverviewTab marks itself dirty
// through the real workbench context so a tab click can show the confirm.
vi.mock('../../src/pages/teach/tabs/overview.tsx', async () => {
  const { createElement, useEffect } = await import('react');
  const { useWorkbenchDirty } = await import('../../src/pages/teach/settings-kit.tsx');
  function OverviewTab() {
    const { setTabDirty } = useWorkbenchDirty();
    useEffect(() => {
      setTabDirty('overview', true);
      return () => {
        setTabDirty('overview', false);
      };
    }, [setTabDirty]);
    return createElement('div', null, '页签-概况');
  }
  return { OverviewTab };
});

vi.mock('../../src/pages/teach/tabs/problems.tsx', () => ({
  ProblemsTab: () => <div>页签-题目</div>,
}));

vi.mock('../../src/pages/teach/tabs/students.tsx', () => ({
  StudentsTab: () => <div>页签-学生</div>,
}));

vi.mock('../../src/pages/teach/tabs/settings-contest.tsx', () => ({
  SettingsContestTab: () => <div>设置-比赛</div>,
}));

vi.mock('../../src/pages/teach/tabs/settings-homework.tsx', () => ({
  SettingsHomeworkTab: () => <div>设置-作业</div>,
}));

vi.mock('../../src/pages/teach/tabs/settings-practice.tsx', () => ({
  SettingsPracticeTab: () => <div>设置-练习</div>,
}));

vi.mock('../../src/pages/teach/tabs/grades.tsx', () => ({
  GradesTab: () => <div>页签-成绩</div>,
}));

vi.mock('../../src/pages/teach/tabs/records.tsx', () => ({
  RecordsTab: () => <div>页签-提交</div>,
}));

vi.mock('../../src/pages/teach/tabs/advanced.tsx', () => ({
  AdvancedTab: () => <div>页签-高级</div>,
}));

const pageLoaders = import.meta.glob('../../src/pages/teach/workbench.tsx');

const WORKBENCH_SOURCE = 'src/pages/teach/workbench.tsx';
const GENERATED_AT = '2024-06-15T04:00:00.000Z';
const BEGIN_AT = '2024-06-15T02:00:00.000Z';
const END_AT = '2024-06-15T06:00:00.000Z';
const CREATED_AT = '2024-06-01T00:00:00.000Z';
const PROBLEM_COUNT = 2;
const DISCARD_TITLE = '放弃未保存的修改？';
const DISCARD_MESSAGE = '切换页签会丢掉还没保存的修改。';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d11';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d12';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d13';
const OI_ID = '64b7c3a2e4b0f96d1a2c3d14';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d15';
const EXAM_TITLE = '期中整卷考试';
const OI_TITLE = 'CSP-J 模拟赛';
const PRACTICE_TITLE = '链表专项练习';

const TAB_LABEL: Record<TeachTab, string> = {
  overview: '概况',
  problems: '题目',
  students: '学生',
  settings: '设置',
  grades: '成绩',
  records: '提交',
  advanced: '高级',
};

const URLS: KryptonBootstrap['urls'] = {
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
  domainDashboard: '/domain/dashboard',
  domainPermission: '/domain/permission',
  manage: '/manage',
  status: '/status',
  problemDetail: '/p/:PID',
  contestDetail: '/contest/:TID',
  homeworkDetail: '/homework/:TID',
  trainingDetail: '/training/:TID',
  discussionDetail: '/discuss/:DID',
  discussionNode: '/discuss/node/:NID',
  userDetail: '/user/:UID',
  recordDetail: '/record/:RID',
};

interface PayloadSpec {
  type: TeachType;
  id: string;
  title: string;
  rule?: string;
  durationMinutes?: number | null;
  studentView: string;
  scoreboard: string | null;
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(WORKBENCH_SOURCE)) return load;
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

async function loadWorkbenchPage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, WORKBENCH_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${WORKBENCH_SOURCE} must exist`);
  const imported = await importPageModule(load);
  if (typeof imported !== 'object' || imported === null || !('TeachWorkbenchPage' in imported)) {
    throw new TypeError('TeachWorkbenchPage must be exported');
  }
  const component: unknown = imported.TeachWorkbenchPage;
  expect(typeof component, 'TeachWorkbenchPage').toBe('function');
  if (typeof component !== 'function') throw new TypeError('TeachWorkbenchPage must be a function');
  return component as ComponentType;
}

function pageBootstrap(data: TeachWorkbenchPayload): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: GENERATED_AT,
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
      canTeach: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName: 'teach_workbench.html', data },
  };
}

function defaultRule(type: TeachType): string {
  if (type === 'practice') return 'problem_set';
  return type;
}

function workbenchPayload(spec: PayloadSpec): TeachWorkbenchPayload {
  const type = spec.type;
  const timed = type !== 'practice';
  const problems = [101, 102].map((docId) => ({
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind: 'programming',
    score: type === 'acm' || type === 'practice' ? null : 20,
    hidden: false,
    mine: true,
    difficulty: null,
  }));
  return parseTeachWorkbenchPayload({
    container: {
      type,
      id: spec.id,
      rule: spec.rule ?? defaultRule(type),
      title: spec.title,
      status: timed ? 'running' : 'open',
      beginAt: timed ? BEGIN_AT : null,
      endAt: timed ? END_AT : null,
      durationMinutes: spec.durationMinutes === undefined ? null : spec.durationMinutes,
      penaltySince: type === 'homework' ? END_AT : null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 7, name: '陈老师' },
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
        studentView: spec.studentView,
        scoreboard: spec.scoreboard,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/files/${spec.id}`,
        redemption: null,
      },
    },
    paper: {
      problems,
      stages: type === 'practice'
        ? [{ id: 1, title: '阶段一', requireIds: [], pids: [101, 102] }]
        : null,
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
      canDelete: false,
      canShare: false,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  });
}

function examPayload(durationMinutes: number | null = null): TeachWorkbenchPayload {
  return workbenchPayload({
    type: 'exam',
    id: EXAM_ID,
    title: EXAM_TITLE,
    durationMinutes,
    studentView: `/student/${EXAM_ID}`,
    scoreboard: `/board/${EXAM_ID}`,
  });
}

function setLocation(type: TeachType, id: string, tab?: string) {
  const search = tab ? `?tab=${tab}` : '';
  window.history.replaceState(null, '', `/teach/${type}/${id}${search}`);
}

async function renderWorkbench(data: TeachWorkbenchPayload, tab?: string) {
  setLocation(data.container.type, data.container.id, tab);
  const Page = await loadWorkbenchPage();
  const user = userEvent.setup();
  const view = render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <Page />
    </BootstrapProvider>,
  );
  return { user, ...view };
}

function header(): HTMLElement {
  const node = document.querySelector('[data-slot="page-header"]');
  expect(node).toBeInstanceOf(HTMLElement);
  if (!(node instanceof HTMLElement)) throw new TypeError('page header missing');
  return node;
}

function tabNamed(label: string): HTMLElement {
  const found = screen.getAllByRole('tab').find((tab) => (tab.textContent ?? '').includes(label));
  expect(found, label).toBeInstanceOf(HTMLElement);
  if (!(found instanceof HTMLElement)) throw new TypeError(`missing tab ${label}`);
  return found;
}

function expectTabOrder(type: TeachType) {
  const expected = teachTabsFor(type).map((tab) => TAB_LABEL[tab]);
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(expected.length);
  expected.forEach((label, index) => {
    expect(tabs[index]?.textContent ?? '').toContain(label);
  });
}

function serverWindow(type: TeachType, durationMinutes: number | null): string {
  return formatTeachWindow({
    type,
    beginAt: type === 'practice' ? null : BEGIN_AT,
    endAt: type === 'practice' ? null : END_AT,
    durationMinutes,
  }, new Date(examServerClock(GENERATED_AT).now()));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  }))));
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('teach workbench page', () => {
  it('selects the grades tab from the query', async () => {
    const data = examPayload();
    await renderWorkbench(data, 'grades');

    expect(document.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'wide');
    expect(screen.getByRole('heading', { level: 1, name: EXAM_TITLE })).toBeInTheDocument();
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumb).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/teach');
    expect(within(crumb).getByText(EXAM_TITLE)).toBeInTheDocument();
    expect(tabNamed('成绩')).toHaveAttribute('aria-selected', 'true');
    expect(tabNamed('概况')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('页签-成绩')).toBeInTheDocument();
  });

  it('returns a practice records query to the overview tab', async () => {
    const data = workbenchPayload({
      type: 'practice',
      id: PRACTICE_ID,
      title: PRACTICE_TITLE,
      studentView: `/student/${PRACTICE_ID}`,
      scoreboard: null,
    });
    await renderWorkbench(data, 'records');

    expect(tabNamed('概况')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('页签-概况')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '提交' })).toBeNull();
  });

  it('omits the records tab on a practice set and counts problems', async () => {
    const data = workbenchPayload({
      type: 'practice',
      id: PRACTICE_ID,
      title: PRACTICE_TITLE,
      studentView: `/student/${PRACTICE_ID}`,
      scoreboard: null,
    });
    await renderWorkbench(data);

    expectTabOrder('practice');
    expect(screen.queryByRole('tab', { name: '提交' })).toBeNull();
    expect(tabNamed('题目').textContent ?? '').toContain(String(PROBLEM_COUNT));
    expect(header().textContent ?? '').toContain(TEACH_TYPE_LABEL.practice);
    expect(header().textContent ?? '').toContain(serverWindow('practice', null));
  });

  it('asks before leaving a dirty tab and stays when the teacher cancels', async () => {
    const data = examPayload();
    const { user } = await renderWorkbench(data);

    expect(tabNamed('概况')).toHaveAttribute('aria-selected', 'true');
    await user.click(tabNamed('题目'));
    const dialog = await screen.findByRole('dialog', { name: DISCARD_TITLE });
    expect(within(dialog).getByText(DISCARD_MESSAGE)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '放弃修改' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: DISCARD_TITLE })).toBeNull();
    });
    expect(tabNamed('概况')).toHaveAttribute('aria-selected', 'true');
    expect(tabNamed('题目')).toHaveAttribute('aria-selected', 'false');
    expect(window.location.search).toBe('');
    expect(screen.getByText('页签-概况')).toBeInTheDocument();
  });

  it('writes the tab query after the teacher discards unsaved edits', async () => {
    const data = examPayload();
    const { user } = await renderWorkbench(data);

    await user.click(tabNamed('成绩'));
    const dialog = await screen.findByRole('dialog', { name: DISCARD_TITLE });
    await user.click(within(dialog).getByRole('button', { name: '放弃修改' }));

    await waitFor(() => {
      expect(tabNamed('成绩')).toHaveAttribute('aria-selected', 'true');
    });
    expect(window.location.pathname).toBe(`/teach/exam/${EXAM_ID}`);
    expect(window.location.search).toBe('?tab=grades');
    expect(screen.getByText('页签-成绩')).toBeInTheDocument();

    await user.click(tabNamed('概况'));
    await waitFor(() => {
      expect(tabNamed('概况')).toHaveAttribute('aria-selected', 'true');
    });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('dialog', { name: DISCARD_TITLE })).toBeNull();
  });

  it('opens the student view from the payload link in a new tab', async () => {
    const data = examPayload();
    await renderWorkbench(data);

    const student = screen.getByRole('link', { name: '学生视角' });
    expect(student).toHaveAttribute('href', data.container.links.studentView);
    expect(student).toHaveAttribute('target', '_blank');
  });

  it('copies into a new set and shows the scoreboard only when one exists', async () => {
    const exam = examPayload();
    const { user } = await renderWorkbench(exam);
    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(await screen.findByRole('menuitem', { name: '复制为新题目集' })).toHaveAttribute('href', `/teach/new?copy=exam:${EXAM_ID}`);
    expect(screen.getByRole('menuitem', { name: '查看排行榜' })).toHaveAttribute('href', exam.container.links.scoreboard);

    cleanup();
    const practice = workbenchPayload({
      type: 'practice',
      id: PRACTICE_ID,
      title: PRACTICE_TITLE,
      studentView: `/student/${PRACTICE_ID}`,
      scoreboard: null,
    });
    const again = await renderWorkbench(practice);
    await again.user.click(screen.getByRole('button', { name: '更多' }));
    expect(await screen.findByRole('menuitem', { name: '复制为新题目集' })).toHaveAttribute('href', `/teach/new?copy=practice:${PRACTICE_ID}`);
    expect(screen.queryByRole('menuitem', { name: '查看排行榜' })).toBeNull();
  });

  it('shows the type badge, status, and server time window', async () => {
    const windowLabel = serverWindow('exam', 90);
    await renderWorkbench(examPayload(90));

    expect(header().textContent ?? '').toContain(TEACH_TYPE_LABEL.exam);
    expect(header().textContent ?? '').toContain(TEACH_STATUS_LABEL.running);
    expect(header().textContent ?? '').toContain(windowLabel);
    expect(screen.getByText(windowLabel).className).toContain('tabular');

    cleanup();
    const oi = workbenchPayload({
      type: 'oi',
      id: OI_ID,
      title: OI_TITLE,
      rule: 'ioi',
      studentView: `/student/${OI_ID}`,
      scoreboard: `/board/${OI_ID}`,
    });
    await renderWorkbench(oi);
    expect(header().textContent ?? '').toContain(`${TEACH_TYPE_LABEL.oi} · ${OI_RULE_LABEL.ioi}`);
  });

  it('mounts the settings tab that matches the set type', async () => {
    const cases: Array<{ data: TeachWorkbenchPayload; marker: string }> = [
      { data: examPayload(), marker: '设置-比赛' },
      {
        data: workbenchPayload({
          type: 'acm',
          id: ACM_ID,
          title: '校赛',
          studentView: `/student/${ACM_ID}`,
          scoreboard: `/board/${ACM_ID}`,
        }),
        marker: '设置-比赛',
      },
      {
        data: workbenchPayload({
          type: 'oi',
          id: OI_ID,
          title: OI_TITLE,
          rule: 'strictioi',
          studentView: `/student/${OI_ID}`,
          scoreboard: `/board/${OI_ID}`,
        }),
        marker: '设置-比赛',
      },
      {
        data: workbenchPayload({
          type: 'homework',
          id: HOMEWORK_ID,
          title: '栈与队列作业',
          studentView: `/student/${HOMEWORK_ID}`,
          scoreboard: `/board/${HOMEWORK_ID}`,
        }),
        marker: '设置-作业',
      },
      {
        data: workbenchPayload({
          type: 'practice',
          id: PRACTICE_ID,
          title: PRACTICE_TITLE,
          studentView: `/student/${PRACTICE_ID}`,
          scoreboard: null,
        }),
        marker: '设置-练习',
      },
    ];

    for (const item of cases) {
      cleanup();
      await renderWorkbench(item.data, 'settings');
      expect(tabNamed('设置')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(item.marker)).toBeInTheDocument();
    }
  });
});
