import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { manageTabFromLocation, ContestManagePage } from '../src/pages/contest-manage';
import { CourseVideoStatsPage } from '../src/pages/course/video-stats';

const groupA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const groupB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function bootstrap(templateName: string, pageData: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-09-22T10:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      contests: '/contest',
      contestDetail: '/contest/__TID__',
      records: '/record',
      discussionNode: '/discuss/__TYPE__/__NAME__',
      homework: '/homework',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data: pageData },
  };
}

describe('stats group filter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('reads the contest management tab from the query', () => {
    expect(manageTabFromLocation('')).toBe('score');
    expect(manageTabFromLocation('?tab=stats&groupIds=abc')).toBe('stats');
    expect(manageTabFromLocation('?tab=nope')).toBe('score');
  });

  it('filters course watch stats by the selected user groups', () => {
    render(
      <BootstrapProvider
        bootstrap={bootstrap('course_videos.html', {
          tdoc: { docId: 'course1', title: '程序设计' },
          videos: [],
          members: [
            { uid: 2, studentId: '2401', realName: '张三', uname: 'zs', done: 0, total: 0, videos: [] },
          ],
          groups: [
            { _id: groupA, name: '一班', archivedAt: null },
            { _id: groupB, name: '二班', archivedAt: null },
          ],
          groupIds: [groupA],
        })}
      >
        <CourseVideoStatsPage />
      </BootstrapProvider>,
    );

    const form = screen.getByRole('group', { name: '用户组' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/course/course1/videos');
    expect(screen.getByText('一班')).toBeTruthy();
    expect(screen.getByText('已按所选用户组过滤，共 1 名已绑定学生。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '导出 CSV' }).getAttribute('href')).toBe(
      `/course/course1/videos.csv?groupIds=${encodeURIComponent(groupA)}`,
    );
  });

  it('shows the contest submission stats filter and keeps the tab after reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: [], schools: [] }), { status: 200 })));
    window.history.replaceState(null, '', '/contest/acm1/management?tab=stats');
    render(
      <BootstrapProvider
        bootstrap={bootstrap('contest_manage.html', {
          tdoc: { docId: 'acm1', title: '校赛', rule: 'acm', owner: 2, pids: [1] },
          pdict: { 1: { title: 'A + B', pid: 'P1001' } },
          files: [],
          privateFiles: [],
          submissionStats: {
            total: 4,
            accepted: 1,
            participants: 2,
            participantUnit: 'user',
            byProblem: [],
            byHour: [],
          },
          statsGroups: [{ _id: groupB, name: '二班', archivedAt: null }],
          statsGroupIds: [groupB],
          statsGroupMemberCount: 18,
        })}
      >
        <ContestManagePage />
      </BootstrapProvider>,
    );

    const form = screen.getByRole('group', { name: '用户组' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/contest/acm1/management');
    expect(form?.querySelector('input[name="tab"]')?.getAttribute('value')).toBe('stats');
    expect(screen.getByText('二班')).toBeTruthy();
    expect(screen.getByText('已按所选用户组过滤，共 18 名已绑定学生。')).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /题目分值/ }));
    expect(screen.queryByRole('group', { name: '用户组' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /提交统计/ }));
    expect(screen.getByRole('group', { name: '用户组' })).toBeTruthy();
  });
});
