import { cleanup, render, screen, within } from '@testing-library/react';
import {
  afterEach, describe, expect, it,
} from 'vitest';
import { Sidebar } from '../../src/components/layout/sidebar.tsx';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { PageResolver } from '../../src/pages/resolver.tsx';

const COURSE_LIST_DESCRIPTION = '你创建或协作管理的课程。';
const COURSE_TEMPLATES = [
  'course_main.html',
  'course_detail.html',
  'course_edit.html',
  'course_mindmap_edit.html',
  'course_videos.html',
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

function user(canTeach: boolean): KryptonUser {
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
    role: canTeach ? 'teacher' : 'default',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: false,
    canTeach,
  };
}

function bootstrap(templateName: string, data: unknown, canTeach: boolean): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T00:00:00.000Z',
    user: user(canTeach),
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName, data },
  };
}

function courseListData(): Record<string, unknown> {
  return {
    scope: 'mine',
    canSeeAll: false,
    canCreate: false,
    q: '',
    rows: [],
  };
}

function renderSidebar(canTeach: boolean, templateName: string) {
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

function groupAt(index: number): HTMLElement {
  const group = navGroups()[index];
  if (!group) throw new TypeError(`navigation group ${index} must exist`);
  return group;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('course list registration and sidebar', () => {
  it('points the teaching course link to /teach/courses when canTeach is true', () => {
    renderSidebar(true, 'main.html');

    const teaching = groupAt(0);
    expect(teaching.querySelector('p')?.textContent).toBe('教学');
    expect(within(teaching).getByRole('link', { name: '课程' })).toHaveAttribute('href', '/teach/courses');
    expect(within(groupAt(1)).queryByRole('link', { name: '课程' })).toBeNull();
  });

  it('keeps the student course link at /course', () => {
    renderSidebar(false, 'course_main.html');

    expect(screen.queryByText('教学')).toBeNull();
    const main = groupAt(0);
    expect(main.querySelector('p')).toBeNull();
    expect(within(main).getByRole('link', { name: '课程' })).toHaveAttribute('href', '/course');
  });

  it('highlights the teaching course link on teach_courses.html', () => {
    renderSidebar(true, 'teach_courses.html');

    const course = within(groupAt(0)).getByRole('link', { name: '课程' });
    expect(course).toHaveAttribute('aria-current', 'page');
    expect(course).toHaveAttribute('href', '/teach/courses');
  });

  it('keeps the original course templates on the teaching course link', () => {
    for (const templateName of COURSE_TEMPLATES) {
      cleanup();
      renderSidebar(true, templateName);
      const course = within(groupAt(0)).getByRole('link', { name: '课程' });
      expect(course).toHaveAttribute('aria-current', 'page');
      expect(course).toHaveAttribute('href', '/teach/courses');
    }
  });

  it('renders the teacher course list for teach_courses.html', () => {
    window.history.replaceState(null, '', '/teach/courses');
    render(
      <BootstrapProvider bootstrap={bootstrap('teach_courses.html', courseListData(), true)}>
        <PageResolver />
      </BootstrapProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: '课程' })).toBeInTheDocument();
    expect(screen.getByText(COURSE_LIST_DESCRIPTION)).toBeInTheDocument();
  });
});
