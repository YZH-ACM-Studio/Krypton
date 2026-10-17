import { teachPath } from '@hydrooj/common';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import {
  parseTeachComposePayload,
  parseTeachListPayload,
  parseTeachNewPayload,
  parseTeachWorkbenchPayload,
  type TeachComposePayload,
  type TeachListPayload,
  type TeachNewPayload,
  type TeachWorkbenchPayload,
} from '../../src/pages/teach/model.ts';
import { paperFromPayload } from '../../src/pages/teach/paper.ts';
import { initialComposeState } from '../../src/pages/teach/compose/draft.ts';
import { PageResolver } from '../../src/pages/resolver.tsx';
import { Sidebar } from '../../src/components/layout/sidebar.tsx';

const redirectLoaders = import.meta.glob('../../src/pages/teach/legacy-redirect.tsx');

const REDIRECT_SOURCE = 'src/pages/teach/legacy-redirect.tsx';
const GENERATED_AT = '2024-06-15T04:00:00.000Z';
const BEGIN_AT = '2024-06-15T02:00:00.000Z';
const END_AT = '2024-06-15T06:00:00.000Z';
const CREATED_AT = '2024-06-01T00:00:00.000Z';
const CONTEST_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d12';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d15';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d11';
const OPENING = '正在打开新的编辑页…';
const OPEN_FAILED = '无法打开新的编辑页';

const TEACH_TEMPLATES = [
  'teach_main.html',
  'teach_new.html',
  'teach_workbench.html',
  'teach_compose.html',
] as const;

const COURSE_TEMPLATES = [
  'course_main.html',
  'course_detail.html',
  'course_edit.html',
  'course_mindmap_edit.html',
  'course_videos.html',
] as const;

const USER_GROUP_TEMPLATES = [
  'teacher_user_groups.html',
  'teacher_user_group_detail.html',
] as const;

const EDIT_TEMPLATES = [
  { templateName: 'contest_edit.html', previous: '比赛' },
  { templateName: 'homework_edit.html', previous: '作业' },
  { templateName: 'problem_set_edit.html', previous: '题集' },
] as const;

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

let restoreLocation: (() => void) | null = null;

function releaseLocation() {
  const restore = restoreLocation;
  restoreLocation = null;
  if (restore) restore();
}

function teacher(canTeach?: boolean): KryptonUser {
  return {
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
    canBrowseProblemBank: false,
    ...(canTeach === undefined ? {} : { canTeach }),
  };
}

function bootstrap(templateName: string, data: unknown, canTeach?: boolean): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: GENERATED_AT,
    user: teacher(canTeach),
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName, data },
  };
}

function renderSidebar(canTeach: boolean | undefined, templateName: string) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(templateName, {}, canTeach)}>
      <Sidebar open={false} onClose={() => undefined} collapsed={false} />
    </BootstrapProvider>,
  );
}

function navGroups(): HTMLElement[] {
  const nav = screen.getByRole('navigation', { name: '主导航' });
  return [...nav.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function redirectLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(redirectLoaders)) {
    if (key.endsWith(REDIRECT_SOURCE)) return load;
  }
  return undefined;
}

async function importRedirect(load: () => Promise<unknown>): Promise<unknown> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
}

async function loadRedirectPage(): Promise<ComponentType> {
  const load = redirectLoader();
  expect(typeof load, REDIRECT_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${REDIRECT_SOURCE} must exist`);
  const imported = await importRedirect(load);
  if (typeof imported !== 'object' || imported === null || !('LegacyEditRedirectPage' in imported)) {
    throw new TypeError('LegacyEditRedirectPage must be exported');
  }
  const component: unknown = imported.LegacyEditRedirectPage;
  expect(typeof component, 'LegacyEditRedirectPage').toBe('function');
  if (typeof component !== 'function') throw new TypeError('LegacyEditRedirectPage must be a function');
  return component as ComponentType;
}

function installLocation(href: string): ReturnType<typeof vi.fn> {
  const saved = window.location;
  const url = new URL(href, saved.origin);
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: '',
      assign: vi.fn(),
      replace,
      reload: vi.fn(),
      toString: () => url.href,
    },
  });
  restoreLocation = () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
  return replace;
}

function replacedUrl(replace: ReturnType<typeof vi.fn>): URL {
  expect(replace).toHaveBeenCalled();
  const target: unknown = replace.mock.calls[0]?.[0];
  expect(typeof target).toBe('string');
  if (typeof target !== 'string') throw new TypeError('location.replace target must be a string');
  return new URL(target, 'http://krypton.local');
}

async function renderRedirect(options: {
  templateName: string;
  pageName: string;
  href: string;
  tdoc?: Record<string, unknown>;
}): Promise<ReturnType<typeof vi.fn>> {
  const replace = installLocation(options.href);
  const Page = await loadRedirectPage();
  render(
    <BootstrapProvider bootstrap={bootstrap(options.templateName, {
      page_name: options.pageName,
      tdoc: options.tdoc ?? {},
    })}>
      <Page />
    </BootstrapProvider>,
  );
  return replace;
}

function workbenchData(): TeachWorkbenchPayload {
  return parseTeachWorkbenchPayload({
    container: {
      type: 'exam',
      id: EXAM_ID,
      rule: 'exam',
      title: '期中整卷考试',
      status: 'running',
      beginAt: BEGIN_AT,
      endAt: END_AT,
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null,
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
        studentView: `/student/${EXAM_ID}`,
        scoreboard: `/board/${EXAM_ID}`,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/files/${EXAM_ID}`,
        redemption: null,
      },
    },
    paper: {
      problems: [{
        docId: 101,
        pid: 'P101',
        title: '括号匹配',
        kind: 'programming',
        score: 20,
        hidden: false,
        mine: true,
        difficulty: null,
      }],
      stages: null,
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

function listData(): TeachListPayload {
  return parseTeachListPayload({
    scope: 'mine',
    canSeeAll: false,
    filter: { type: 'all', status: 'all', q: '' },
    typeCounts: { all: 0, practice: 0, quiz: 0, acm: 0, oi: 0 },
    page: 1,
    pageCount: 1,
    total: 0,
    rows: [],
    sharedRows: [],
    canCreate: {
      practice: true, homework: true, exam: true, acm: true, oi: true,
    },
  });
}

function newData(): TeachNewPayload {
  return parseTeachNewPayload({
    canCreate: {
      practice: true, homework: true, exam: true, acm: true, oi: true,
    },
    initialType: null,
    fromCourse: null,
    copy: null,
  });
}

function composeData(): TeachComposePayload {
  const data = parseTeachComposePayload({
    ...workbenchData(),
    examStartedCount: 0,
    knowledgeOptions: [],
    canCreateObjective: false,
  });
  initialComposeState(paperFromPayload(data.paper, data.container), data.container.status);
  return data;
}

function renderResolved(templateName: string, data: unknown, href: string) {
  window.history.replaceState(null, '', href);
  return render(
    <BootstrapProvider bootstrap={bootstrap(templateName, data, true)}>
      <PageResolver />
    </BootstrapProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  }))));
});

afterEach(() => {
  cleanup();
  releaseLocation();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('teach sidebar', () => {
  it('puts teaching first and drops the main course link when canTeach is true', () => {
    renderSidebar(true, 'main.html');

    const [teaching, main] = navGroups();
    expect(teaching?.querySelector('p')?.textContent).toBe('教学');
    expect(within(teaching).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/teach');
    expect(within(teaching).getByRole('link', { name: '课程' })).toHaveAttribute('href', '/teach/courses');
    expect(within(teaching).getByRole('link', { name: '我的用户组' })).toHaveAttribute('href', '/user-groups');
    expect(within(main).queryByRole('link', { name: '课程' })).toBeNull();
    expect(within(main).getByRole('link', { name: '首页' })).toBeInTheDocument();
  });

  it('keeps the course link in the main group when canTeach is absent', () => {
    renderSidebar(undefined, 'course_main.html');

    expect(screen.queryByText('教学')).toBeNull();
    const [main] = navGroups();
    expect(main?.querySelector('p')).toBeNull();
    expect(within(main).getByRole('link', { name: '课程' })).toHaveAttribute('href', '/course');
    expect(within(main).getByRole('link', { name: '课程' })).toHaveAttribute('aria-current', 'page');
  });

  it('highlights teaching entries for teach, course, group, and legacy edit templates', () => {
    for (const templateName of TEACH_TEMPLATES) {
      cleanup();
      renderSidebar(true, templateName);
      expect(screen.getByRole('link', { name: '题目集' })).toHaveAttribute('aria-current', 'page');
    }
    for (const templateName of COURSE_TEMPLATES) {
      cleanup();
      renderSidebar(true, templateName);
      expect(screen.getByRole('link', { name: '课程' })).toHaveAttribute('aria-current', 'page');
      expect(within(navGroups()[1]).queryByRole('link', { name: '课程' })).toBeNull();
    }
    for (const templateName of USER_GROUP_TEMPLATES) {
      cleanup();
      renderSidebar(true, templateName);
      expect(screen.getByRole('link', { name: '我的用户组' })).toHaveAttribute('aria-current', 'page');
    }
    for (const item of EDIT_TEMPLATES) {
      cleanup();
      renderSidebar(true, item.templateName);
      expect(screen.getByRole('link', { name: '题目集' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: item.previous }).hasAttribute('aria-current')).toBe(false);
    }
  });
});

describe('teach page registration', () => {
  it('renders the list, new, workbench, and compose pages from their templates', () => {
    renderResolved('teach_main.html', listData(), '/teach');
    expect(screen.getByRole('heading', { level: 1, name: '题目集' })).toBeInTheDocument();

    cleanup();
    renderResolved('teach_new.html', newData(), '/teach/new');
    expect(screen.getByRole('heading', { level: 1, name: '新建题目集' })).toBeInTheDocument();

    cleanup();
    renderResolved('teach_workbench.html', workbenchData(), `/teach/exam/${EXAM_ID}?tab=grades`);
    expect(screen.getByRole('tab', { name: '成绩' })).toHaveAttribute('aria-selected', 'true');

    cleanup();
    renderResolved('teach_compose.html', composeData(), `/teach/exam/${EXAM_ID}/compose`);
    expect(screen.getByRole('button', { name: '返回工作台' })).toBeInTheDocument();
  });

  it('renders the legacy redirect for contest, homework, and problem set edit templates', () => {
    const pages = [
      { templateName: 'contest_edit.html', pageName: 'contest_edit', href: `/contest/${CONTEST_ID}/edit` },
      { templateName: 'homework_edit.html', pageName: 'homework_edit', href: `/homework/${HOMEWORK_ID}/edit` },
      { templateName: 'problem_set_edit.html', pageName: 'problem_set_edit', href: `/problem-sets/${PRACTICE_ID}/edit` },
    ];
    for (const page of pages) {
      cleanup();
      releaseLocation();
      installLocation(page.href);
      render(
        <BootstrapProvider bootstrap={bootstrap(page.templateName, {
          page_name: page.pageName,
          tdoc: { rule: 'acm', docId: CONTEST_ID, title: '旧编辑页' },
          rules: { acm: 'ACM' },
          duration: 2,
          pids: '',
          pdict: {},
          beginAt: '',
          scopeSchools: [],
          scopeGroups: [],
          teamBatches: [],
          groups: [],
          audience: { public: true, groupIds: [] },
        }, true)}>
          <PageResolver />
        </BootstrapProvider>,
      );
      expect(screen.getByText(OPENING)).toBeInTheDocument();
      expect(document.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'form');
    }
  });
});

describe('legacy edit redirect', () => {
  it('sends an ioi contest edit to the oi workbench settings tab', async () => {
    const replace = await renderRedirect({
      templateName: 'contest_edit.html',
      pageName: 'contest_edit',
      href: `/contest/${CONTEST_ID}/edit`,
      tdoc: { rule: 'ioi', docId: CONTEST_ID, title: 'IOI 模拟' },
    });

    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'form');
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });
    const url = replacedUrl(replace);
    expect(`${url.pathname}${url.search}`).toBe(`/teach/oi/${CONTEST_ID}?tab=settings`);
    expect(`${url.pathname}${url.search}`).toBe(teachPath('oi', CONTEST_ID, 'settings'));
  });

  it('keeps fromCourse and chapter when opening homework create', async () => {
    const replace = await renderRedirect({
      templateName: 'homework_edit.html',
      pageName: 'homework_create',
      href: '/homework/create?fromCourse=a&chapter=2',
    });

    expect(screen.getByText(OPENING)).toBeInTheDocument();
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });
    const url = replacedUrl(replace);
    expect(url.pathname).toBe('/teach/new');
    expect(url.searchParams.get('type')).toBe('homework');
    expect(url.searchParams.get('fromCourse')).toBe('a');
    expect(url.searchParams.get('chapter')).toBe('2');
  });

  it('sends contest create to exam or acm from the rule query', async () => {
    const exam = await renderRedirect({
      templateName: 'contest_edit.html',
      pageName: 'contest_create',
      href: '/contest/create?rule=exam',
    });
    await waitFor(() => {
      expect(exam).toHaveBeenCalled();
    });
    const examUrl = replacedUrl(exam);
    expect(`${examUrl.pathname}${examUrl.search}`).toBe('/teach/new?type=exam');

    cleanup();
    releaseLocation();
    const acm = await renderRedirect({
      templateName: 'contest_edit.html',
      pageName: 'contest_create',
      href: '/contest/create',
    });
    await waitFor(() => {
      expect(acm).toHaveBeenCalled();
    });
    const acmUrl = replacedUrl(acm);
    expect(`${acmUrl.pathname}${acmUrl.search}`).toBe('/teach/new?type=acm');
  });

  it('sends homework and problem set edits to settings and practice create to the new form', async () => {
    const homework = await renderRedirect({
      templateName: 'homework_edit.html',
      pageName: 'homework_edit',
      href: `/homework/${HOMEWORK_ID}/edit`,
      tdoc: { docId: HOMEWORK_ID, title: '作业' },
    });
    await waitFor(() => {
      expect(homework).toHaveBeenCalled();
    });
    const homeworkUrl = replacedUrl(homework);
    expect(`${homeworkUrl.pathname}${homeworkUrl.search}`).toBe(teachPath('homework', HOMEWORK_ID, 'settings'));

    cleanup();
    releaseLocation();
    const practice = await renderRedirect({
      templateName: 'problem_set_edit.html',
      pageName: 'problem_set_edit',
      href: `/problem-sets/${PRACTICE_ID}/edit`,
      tdoc: { docId: PRACTICE_ID, title: '练习' },
    });
    await waitFor(() => {
      expect(practice).toHaveBeenCalled();
    });
    const practiceUrl = replacedUrl(practice);
    expect(`${practiceUrl.pathname}${practiceUrl.search}`).toBe(teachPath('practice', PRACTICE_ID, 'settings'));

    cleanup();
    releaseLocation();
    const created = await renderRedirect({
      templateName: 'problem_set_edit.html',
      pageName: 'problem_set_create',
      href: '/problem-sets/create',
    });
    await waitFor(() => {
      expect(created).toHaveBeenCalled();
    });
    const createdUrl = replacedUrl(created);
    expect(`${createdUrl.pathname}${createdUrl.search}`).toBe('/teach/new?type=practice');
  });

  it('stays on the page and explains when the edit target is missing', async () => {
    const replace = await renderRedirect({
      templateName: 'contest_edit.html',
      pageName: 'contest_edit',
      href: '/contest/edit',
      tdoc: { title: '缺少目标' },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent ?? '').toContain(OPEN_FAILED);
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/teach')).toBe(true);
  });
});
