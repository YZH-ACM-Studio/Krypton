import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExamContestShell } from '../src/components/layout/exam-shell';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../src/lib/bootstrap';
import { ContestDetailPage } from '../src/pages/contests';
import { ProblemDetailPage } from '../src/pages/problem-detail';

const PROBLEM_PID = 'P1002';
const PROBLEM_URL = `/p/${PROBLEM_PID}`;
const CONTEST_TID = '64b8000000000000000000c1';
const CONTEST_URL = `/contest/${CONTEST_TID}`;
const CONTEST_DISCUSSION = `/discuss/contest/${CONTEST_TID}`;
const EXAM_TID = '64b8000000000000000000e4';
const EXAM_OVERVIEW = `/exam-mode/${EXAM_TID}`;
const EXAM_DISCUSSION = `/exam-mode/${EXAM_TID}/discussion`;
const EXAM_SECTIONS = ['概览', '题目', '公告', '讨论', '排名'] as const;
const DISCUSSION_COPY = '发起讨论';
const DISCUSSION_TITLE = '二分图讨论';

const URLS: KryptonUrls = {
  home: '/',
  problems: '/p',
  contests: '/contest',
  homework: '/homework',
  training: '/problem-sets',
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
  records: '/record',
  domainDashboard: '/domain/dashboard',
  domainPermission: '/domain/permission',
  manage: '/manage',
  status: '/status',
  problemDetail: '/p/__PID__',
  contestDetail: '/contest/__TID__',
  homeworkDetail: '/homework/__TID__',
  trainingDetail: '/problem-sets/__TID__',
  discussionDetail: '/discuss/__DID__',
  discussionNode: '/discuss/__TYPE__/__NAME__',
  userDetail: '/user/__UID__',
  recordDetail: '/record/__RID__',
};

function user(canViewDiscussion?: boolean): KryptonUser {
  const account: KryptonUser = {
    id: 7,
    name: 'student',
    mail: '',
    signedIn: true,
    theme: 'light',
    viewLang: 'zh_CN',
    unreadMessages: 0,
    rp: 0,
    bio: '',
    priv: 0,
    role: 'default',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: false,
  };
  if (canViewDiscussion !== undefined) account.canViewDiscussion = canViewDiscussion;
  return account;
}

function bootstrap(templateName: string, data: unknown, canViewDiscussion?: boolean): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-21T06:32:00.000Z',
    user: user(canViewDiscussion),
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName, data },
  };
}

function renderProblem(canViewDiscussion?: boolean) {
  window.history.replaceState(null, '', PROBLEM_URL);
  return render(
    <BootstrapProvider
      bootstrap={bootstrap('problem_detail.html', {
        mode: 'normal',
        discussionCount: 2,
        pdoc: {
          docId: 1002,
          pid: PROBLEM_PID,
          title: 'A+B Problem',
          content: '计算 A 与 B 的和。',
        },
      }, canViewDiscussion)}
    >
      <ProblemDetailPage />
    </BootstrapProvider>,
  );
}

function expectProblemCompanions() {
  expect(screen.getByRole('link', { name: '题解 (0)' })).toHaveAttribute('href', `${PROBLEM_URL}/solution`);
  expect(screen.getByRole('link', { name: '统计' })).toHaveAttribute('href', `${PROBLEM_URL}/statistics`);
  expect(screen.getByRole('link', { name: '附件' })).toHaveAttribute('href', `${PROBLEM_URL}/files`);
  expect(screen.getAllByRole('link', { name: '提交记录' }).length).toBeGreaterThan(0);
}

function contestPage() {
  const now = Date.parse('2026-10-21T06:32:00.000Z');
  return {
    tdoc: {
      docId: CONTEST_TID,
      title: '校赛',
      rule: 'acm',
      beginAt: new Date(now - 3_600_000).toISOString(),
      endAt: new Date(now + 3_600_000).toISOString(),
      attend: 4,
    },
    tsdoc: {},
    pids: [1],
    attended: false,
  };
}

function renderContest(canViewDiscussion?: boolean) {
  return render(
    <BootstrapProvider bootstrap={bootstrap('contest_detail.html', contestPage(), canViewDiscussion)}>
      <ContestDetailPage />
    </BootstrapProvider>,
  );
}

function hrefCount(href: string): number {
  return screen.getAllByRole('link').filter((link) => link.getAttribute('href') === href).length;
}

function renderExam(canViewDiscussion: boolean | undefined, section: 'overview' | 'discussion') {
  window.history.replaceState(null, '', section === 'discussion' ? EXAM_DISCUSSION : EXAM_OVERVIEW);
  return render(
    <BootstrapProvider
      bootstrap={bootstrap('contest_workspace.html', {
        tdoc: { title: '校赛' },
        examMode: {
          title: '校赛',
          tid: EXAM_TID,
          section,
          exclusive: true,
        },
      }, canViewDiscussion)}
    >
      <ExamContestShell>
        {section === 'discussion' ? (
          <>
            <h1>{DISCUSSION_COPY}</h1>
            <p>{DISCUSSION_TITLE}</p>
          </>
        ) : (
          <p>考试正文</p>
        )}
      </ExamContestShell>
    </BootstrapProvider>,
  );
}

function examNavLinks(label: string): HTMLAnchorElement[] {
  return screen.getAllByRole('navigation', { name: '考试导航' }).flatMap((nav) => (
    within(nav).queryAllByRole('link', { name: label })
  )).filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
}

// The shell's only current-section signal is bg-surface-active on the nav link.
function currentExamSections(): string[] {
  return EXAM_SECTIONS.filter((label) => {
    const links = examNavLinks(label);
    return links.length > 0 && links.every((link) => link.classList.contains('bg-surface-active'));
  });
}

function expectOtherExamSections() {
  for (const label of ['概览', '题目', '公告', '排名'] as const) {
    expect(examNavLinks(label)).toHaveLength(2);
  }
}

function expectDiscussionPartitionHidden() {
  expect(examNavLinks('讨论')).toHaveLength(0);
  expect(screen.queryByRole('heading', { name: DISCUSSION_COPY })).toBeNull();
  expect(screen.queryByText(DISCUSSION_TITLE)).toBeNull();
  expect(currentExamSections()).toEqual(['概览']);
  expectOtherExamSections();
  const path = window.location.pathname;
  expect(path === EXAM_DISCUSSION || path === EXAM_OVERVIEW).toBe(true);
}

describe('discussion entries follow canViewDiscussion', () => {
  describe('problem quick links', () => {
    it('links 讨论 to the problem discuss address when the capability is true', () => {
      renderProblem(true);

      expect(screen.getByRole('link', { name: '讨论 (2)' })).toHaveAttribute('href', `${PROBLEM_URL}/discuss`);
      expectProblemCompanions();
    });

    it('hides 讨论 and keeps 题解 and 统计 when the capability is false', () => {
      renderProblem(false);

      expect(screen.queryByRole('link', { name: /讨论/ })).toBeNull();
      expect(hrefCount(`${PROBLEM_URL}/discuss`)).toBe(0);
      expectProblemCompanions();
    });

    it('hides 讨论 when the capability is omitted', () => {
      renderProblem();

      expect(screen.queryByRole('link', { name: /讨论/ })).toBeNull();
      expect(hrefCount(`${PROBLEM_URL}/discuss`)).toBe(0);
      expectProblemCompanions();
    });
  });

  describe('contest detail', () => {
    it('links to the contest discussion when the capability is true', () => {
      renderContest(true);

      expect(hrefCount(CONTEST_DISCUSSION)).toBe(2);
      expect(hrefCount(`${CONTEST_URL}/scoreboard`)).toBeGreaterThan(0);
    });

    it('has no contest discussion link when the capability is false', () => {
      renderContest(false);

      expect(hrefCount(CONTEST_DISCUSSION)).toBe(0);
      expect(hrefCount(`${CONTEST_URL}/scoreboard`)).toBeGreaterThan(0);
    });

    it('has no contest discussion link when the capability is omitted', () => {
      renderContest();

      expect(hrefCount(CONTEST_DISCUSSION)).toBe(0);
      expect(hrefCount(`${CONTEST_URL}/scoreboard`)).toBeGreaterThan(0);
    });
  });

  describe('exam shell navigation', () => {
    it('shows 讨论 in the exam navigation when the capability is true', () => {
      renderExam(true, 'overview');

      const discussion = examNavLinks('讨论');
      expect(discussion).toHaveLength(2);
      expect(discussion.every((link) => link.getAttribute('href') === EXAM_DISCUSSION)).toBe(true);
      expectOtherExamSections();
    });

    it('omits 讨论 from the exam navigation when the capability is false', () => {
      renderExam(false, 'overview');

      expect(examNavLinks('讨论')).toHaveLength(0);
      expectOtherExamSections();
    });

    it('omits 讨论 from the exam navigation when the capability is omitted', () => {
      renderExam(undefined, 'overview');

      expect(examNavLinks('讨论')).toHaveLength(0);
      expectOtherExamSections();
    });

    it('shows 概览 and does not render the discussion partition when the capability is false', () => {
      renderExam(false, 'discussion');

      expectDiscussionPartitionHidden();
    });

    it('shows 概览 and does not render the discussion partition when the capability is omitted', () => {
      renderExam(undefined, 'discussion');

      expectDiscussionPartitionHidden();
    });

    it('keeps 讨论 current when discussion is requested with the capability', () => {
      renderExam(true, 'discussion');

      expect(examNavLinks('讨论')).toHaveLength(2);
      expect(currentExamSections()).toEqual(['讨论']);
      expect(screen.getByRole('heading', { name: DISCUSSION_COPY })).toBeTruthy();
      expect(screen.getByText(DISCUSSION_TITLE)).toBeTruthy();
    });
  });
});
