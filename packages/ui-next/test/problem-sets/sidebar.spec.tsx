import { cleanup, render, screen, within } from '@testing-library/react';
import {
  afterEach, describe, expect, it,
} from 'vitest';
import { Sidebar } from '../../src/components/layout/sidebar.tsx';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUser } from '../../src/lib/bootstrap.tsx';

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

function groupAt(index: number): HTMLElement {
  const nav = screen.getByRole('navigation', { name: '主导航' });
  const group = [...nav.children].filter((node): node is HTMLElement => node instanceof HTMLElement)[index];
  if (!group) throw new TypeError(`navigation group ${index} must exist`);
  return group;
}

function linkLabels(scope: HTMLElement): string[] {
  return within(scope).getAllByRole('link').map((link) => link.textContent ?? '');
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

  it('adds 组队批次 after 我的用户组 for a teacher', () => {
    renderSidebar(true, 'main.html');
    const teaching = groupAt(0);
    expect(teaching.querySelector('p')?.textContent).toBe('教学');
    const labels = linkLabels(teaching);
    const groupsIndex = labels.indexOf('我的用户组');
    const batchIndex = labels.indexOf('组队批次');
    expect(groupsIndex).toBeGreaterThanOrEqual(0);
    expect(batchIndex).toBe(groupsIndex + 1);
    expect(within(teaching).getByRole('link', { name: '组队批次' })).toHaveAttribute('href', '/teams');
    expect(within(teaching).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/teach');
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

  it('marks 组队批次 current on batch management templates', () => {
    for (const templateName of BATCH_TEMPLATES) {
      cleanup();
      renderSidebar(true, templateName);
      const link = within(groupAt(0)).queryByRole('link', { name: '组队批次' });
      expect(link, templateName).not.toBeNull();
      if (!link) throw new TypeError(`${templateName} must show 组队批次`);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(link).toHaveAttribute('href', '/teams');
      expect(within(groupAt(1)).queryByRole('link', { name: '题目集' })).toBeNull();
    }
  });
});
