import { cleanup, render, screen, within } from '@testing-library/react';
import {
  afterEach, describe, expect, it,
} from 'vitest';
import { Sidebar } from '../../src/components/layout/sidebar.tsx';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { PRIV } from '../../src/lib/perms.ts';

const TRAINING_HREF = '/problem-sets';

const STUDENT_SET_TEMPLATES = [
  'student_sets.html',
  'contest_detail.html',
  'contest_teams.html',
  'contest_scoreboard.html',
  'xcpcio_board.html',
  'contest_problemlist.html',
  'contest_user.html',
  'contest_balloon.html',
  'contest_clarification.html',
  'contest_print.html',
  'contest_virtual.html',
  'contest_virtual_scoreboard.html',
  'homework_detail.html',
  'homework_files.html',
  'problem_set_detail.html',
  'problem_set_files.html',
  'problem_set_roster.html',
  'team_batch_detail.html',
] as const;

const BATCH_TEMPLATES = ['team_batches.html', 'team_batch_manage.html'] as const;

const REMOVED_LABELS = ['比赛', '队伍', '作业', '题集'] as const;

const URLS: KryptonBootstrap['urls'] = {
  home: '/',
  problems: '/p',
  contests: '/contest',
  homework: '/homework',
  training: TRAINING_HREF,
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

interface SidebarIdentity {
  canTeach?: boolean;
  role?: string;
  priv?: number;
  canViewDiscussion?: boolean;
  canManageDomainPermissions?: boolean;
  canManageAnnouncements?: boolean;
  name?: string;
}

function user(canTeach: boolean | undefined): KryptonUser {
  return {
    id: 7,
    name: canTeach ? 'teacher' : 'student',
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
    ...(canTeach === undefined ? {} : { canTeach }),
  };
}

function identity(options: SidebarIdentity): KryptonUser {
  const role = options.role ?? 'default';
  return {
    id: 7,
    name: options.name ?? role,
    mail: '',
    signedIn: true,
    theme: 'light',
    viewLang: 'zh_CN',
    unreadMessages: 0,
    rp: 0,
    bio: '',
    priv: options.priv ?? 0,
    role,
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: false,
    ...(options.canTeach === undefined ? {} : { canTeach: options.canTeach }),
    ...(options.canViewDiscussion === undefined ? {} : { canViewDiscussion: options.canViewDiscussion }),
    ...(options.canManageDomainPermissions === undefined ? {} : { canManageDomainPermissions: options.canManageDomainPermissions }),
    ...(options.canManageAnnouncements === undefined ? {} : { canManageAnnouncements: options.canManageAnnouncements }),
  };
}

function bootstrap(templateName: string, canTeach: boolean | undefined): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T06:00:00.000Z',
    user: user(canTeach),
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName, data: {} },
  };
}

function renderSidebar(canTeach: boolean | undefined, templateName: string) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(templateName, canTeach)}>
      <Sidebar open={false} onClose={() => undefined} collapsed={false} />
    </BootstrapProvider>,
  );
}

function renderIdentity(viewer: KryptonUser, templateName: string) {
  return render(
    <BootstrapProvider bootstrap={{ ...bootstrap(templateName, false), user: viewer }}>
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

function groupLabeled(label: string): HTMLElement {
  const group = navGroups().find((node) => node.querySelector('p')?.textContent === label);
  if (!group) throw new TypeError(`navigation group ${label} must exist`);
  return group;
}

function mainGroup(): HTMLElement {
  const group = navGroups().find((node) => node.querySelector('p') === null);
  if (!group) throw new TypeError('main navigation group must exist');
  return group;
}

function linkLabels(scope: HTMLElement): string[] {
  return within(scope).getAllByRole('link').map((link) => (link.textContent ?? '').trim());
}

afterEach(() => {
  cleanup();
});

describe('student sets sidebar entries', () => {
  it('places 题目集 after 导图 and before 课程 when the user cannot teach', () => {
    for (const canTeach of [false, undefined] as const) {
      cleanup();
      renderSidebar(canTeach, 'main.html');
      const main = groupAt(0);
      expect(main.querySelector('p')).toBeNull();
      const labels = linkLabels(main);
      const mapIndex = labels.indexOf('导图');
      const setsIndex = labels.indexOf('题目集');
      const courseIndex = labels.indexOf('课程');
      expect(mapIndex).toBeGreaterThanOrEqual(0);
      expect(setsIndex).toBe(mapIndex + 1);
      expect(courseIndex).toBe(setsIndex + 1);
      expect(within(main).getByRole('link', { name: '题目集' })).toHaveAttribute('href', TRAINING_HREF);
    }
  });

  it('removes 比赛, 队伍, 作业 and 题集 from the student sidebar', () => {
    renderSidebar(false, 'main.html');
    for (const label of REMOVED_LABELS) {
      expect(screen.queryByRole('link', { name: label }), label).toBeNull();
    }
    expect(screen.queryByRole('link', { name: '组队批次' })).toBeNull();
  });

  it('marks 题目集 current on student set templates', () => {
    for (const templateName of STUDENT_SET_TEMPLATES) {
      cleanup();
      renderSidebar(false, templateName);
      const link = screen.queryByRole('link', { name: '题目集' });
      expect(link, templateName).not.toBeNull();
      if (!link) throw new TypeError(`${templateName} must show 题目集`);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(link).toHaveAttribute('href', TRAINING_HREF);
    }
  });

  it('adds 组队批次 after 我的用户组 when canTeach is true and the role is not teacher', () => {
    renderIdentity(identity({ canTeach: true, role: 'default', name: 'admin' }), 'main.html');
    const teaching = groupAt(0);
    expect(teaching.querySelector('p')?.textContent).toBe('教学');
    const labels = linkLabels(teaching);
    expect(labels).toEqual(['题目集', '课程', '我的用户组', '组队批次']);
    const groupsIndex = labels.indexOf('我的用户组');
    const batchIndex = labels.indexOf('组队批次');
    expect(groupsIndex).toBeGreaterThanOrEqual(0);
    expect(batchIndex).toBe(groupsIndex + 1);
    expect(within(teaching).getByRole('link', { name: '组队批次' })).toHaveAttribute('href', '/teams');
    expect(within(teaching).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/teach');
    expect(within(mainGroup()).getByRole('link', { name: '协作' })).toHaveAttribute('href', '/permits/inbox');
  });

  it('omits 题目集 and the old entries from the teacher main group', () => {
    renderSidebar(true, 'main.html');
    const main = groupAt(1);
    for (const label of REMOVED_LABELS) {
      expect(within(main).queryByRole('link', { name: label }), label).toBeNull();
    }
    expect(within(main).queryByRole('link', { name: '题目集' })).toBeNull();
    expect(within(main).queryByRole('link', { name: '组队批次' })).toBeNull();
  });

  it('marks 组队批次 current on batch management templates for a non-teacher', () => {
    const viewer = identity({ canTeach: true, role: 'default', name: 'admin' });
    for (const templateName of BATCH_TEMPLATES) {
      cleanup();
      renderIdentity(viewer, templateName);
      const link = within(groupAt(0)).queryByRole('link', { name: '组队批次' });
      expect(link, templateName).not.toBeNull();
      if (!link) throw new TypeError(`${templateName} must show 组队批次`);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(link).toHaveAttribute('href', '/teams');
      expect(within(groupAt(1)).queryByRole('link', { name: '题目集' })).toBeNull();
    }
  });
});

describe('sidebar entry gates', () => {
  it('shows no link named 公告 for any identity', () => {
    const viewers = [
      identity({ canTeach: false, role: 'default', name: 'student' }),
      identity({ canTeach: undefined, role: 'default', name: 'student' }),
      identity({ canTeach: true, role: 'teacher', name: 'teacher' }),
      identity({
        canTeach: true,
        role: 'default',
        name: 'admin',
        priv: PRIV.PRIV_EDIT_SYSTEM,
        canManageDomainPermissions: true,
        canManageAnnouncements: true,
        canViewDiscussion: true,
      }),
    ];
    for (const viewer of viewers) {
      for (const templateName of ['main.html', 'announce_list.html', 'announce_detail.html'] as const) {
        cleanup();
        renderIdentity(viewer, templateName);
        expect(screen.queryByRole('link', { name: '公告' }), `${viewer.role} ${templateName}`).toBeNull();
      }
    }

    cleanup();
    renderIdentity(identity({
      role: 'default',
      priv: PRIV.PRIV_EDIT_SYSTEM,
      canManageAnnouncements: true,
    }), 'main.html');
    expect(screen.queryByRole('link', { name: '公告' })).toBeNull();
    expect(screen.getByRole('link', { name: '公告管理' })).toHaveAttribute('href', '/admin/announce');
  });

  it('shows 讨论 only when canViewDiscussion is true', () => {
    expect(URLS.discussions).toBe('/discuss');
    const hidden = [
      identity({ canTeach: false, role: 'default', canViewDiscussion: false, name: 'student' }),
      identity({ canTeach: false, role: 'default', name: 'student' }),
      identity({ canTeach: true, role: 'teacher', canViewDiscussion: false, name: 'teacher' }),
      identity({ canTeach: true, role: 'teacher', name: 'teacher' }),
      identity({ canTeach: true, role: 'default', canViewDiscussion: false, name: 'admin' }),
    ];
    for (const viewer of hidden) {
      cleanup();
      renderIdentity(viewer, 'main.html');
      expect(within(mainGroup()).queryByRole('link', { name: '讨论' }), viewer.role).toBeNull();
      expect(screen.queryByRole('link', { name: '讨论' }), viewer.role).toBeNull();
    }

    cleanup();
    renderIdentity(identity({ canTeach: false, role: 'default', canViewDiscussion: true, name: 'student' }), 'main.html');
    expect(within(mainGroup()).getByRole('link', { name: '讨论' })).toHaveAttribute('href', URLS.discussions);

    cleanup();
    renderIdentity(identity({ canTeach: true, role: 'teacher', canViewDiscussion: true, name: 'teacher' }), 'main.html');
    expect(within(mainGroup()).getByRole('link', { name: '讨论' })).toHaveAttribute('href', '/discuss');
  });

  it('hides 组队批次 and 协作 from a teacher and keeps the teaching entries', () => {
    renderSidebar(true, 'main.html');
    const teaching = groupAt(0);
    expect(teaching.querySelector('p')?.textContent).toBe('教学');
    expect(linkLabels(teaching)).toEqual(['题目集', '课程', '我的用户组']);
    expect(within(teaching).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/teach');
    expect(within(teaching).getByRole('link', { name: '课程' })).toHaveAttribute('href', '/teach/courses');
    expect(within(teaching).getByRole('link', { name: '我的用户组' })).toHaveAttribute('href', '/user-groups');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).queryByRole('link', { name: '组队批次' })).toBeNull();
    expect(within(mainGroup()).queryByRole('link', { name: '协作' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: '协作' })).toBeNull();
  });

  it('keeps 协作 for a student who is not a teacher', () => {
    for (const canTeach of [false, undefined] as const) {
      cleanup();
      renderSidebar(canTeach, 'main.html');
      expect(within(mainGroup()).getByRole('link', { name: '协作' })).toHaveAttribute('href', '/permits/inbox');
      expect(screen.queryByRole('link', { name: '组队批次' })).toBeNull();
    }
  });

  it('adds 教师 after 权限管理 for a system admin and hides it from a teacher', () => {
    renderIdentity(identity({
      role: 'default',
      canTeach: false,
      priv: PRIV.PRIV_EDIT_SYSTEM,
      canManageDomainPermissions: true,
      canManageAnnouncements: true,
      name: 'root',
    }), 'main.html');
    const admin = groupLabeled('管理');
    const labels = linkLabels(admin);
    const permissionIndex = labels.indexOf('权限管理');
    const teachersIndex = labels.indexOf('教师');
    const announceIndex = labels.indexOf('公告管理');
    expect(permissionIndex).toBeGreaterThanOrEqual(0);
    expect(teachersIndex).toBe(permissionIndex + 1);
    expect(announceIndex).toBe(teachersIndex + 1);
    expect(within(admin).getByRole('link', { name: '教师' })).toHaveAttribute('href', '/admin/teachers');
    expect(within(admin).getByRole('link', { name: '教师' })).not.toHaveAttribute('aria-current');

    cleanup();
    renderIdentity(identity({
      role: 'default',
      priv: PRIV.PRIV_EDIT_SYSTEM,
      name: 'root',
    }), 'main.html');
    expect(screen.queryByRole('link', { name: '权限管理' })).toBeNull();
    expect(screen.getByRole('link', { name: '教师' })).toHaveAttribute('href', '/admin/teachers');

    cleanup();
    renderSidebar(true, 'main.html');
    expect(screen.queryByRole('link', { name: '教师' })).toBeNull();

    cleanup();
    renderIdentity(identity({
      role: 'default',
      priv: 0,
      canManageDomainPermissions: true,
      name: 'domain-admin',
    }), 'main.html');
    expect(screen.getByRole('link', { name: '权限管理' })).toHaveAttribute('href', URLS.domainPermission);
    expect(screen.queryByRole('link', { name: '教师' })).toBeNull();
  });

  it('marks 教师 current on admin_teachers.html', () => {
    renderIdentity(identity({
      role: 'default',
      priv: PRIV.PRIV_EDIT_SYSTEM,
      canManageDomainPermissions: true,
      name: 'root',
    }), 'admin_teachers.html');
    const link = screen.queryByRole('link', { name: '教师' });
    expect(link).not.toBeNull();
    if (!link) throw new TypeError('admin_teachers.html must show 教师');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('href', '/admin/teachers');
  });
});
