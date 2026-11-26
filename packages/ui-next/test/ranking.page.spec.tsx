import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { RankingPage, rankingUrl } from '../src/pages/ranking.tsx';

function makeBootstrap(data: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-09-20T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/', ranking: '/ranking', userDetail: '/user/{UID}' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'ranking.html', data },
  };
}

function renderRanking(data: Record<string, unknown>) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <RankingPage />
    </BootstrapProvider>,
  );
}

describe('ranking page external rating columns', () => {
  it('keeps CF and Nowcoder headers on a later page with no public scores', () => {
    renderRanking({
      page: 2,
      upcount: 3,
      udocs: [
        { _id: 101, uname: 'page2-a', rp: 10, nAccept: 1, externalRating: {} },
        { _id: 102, uname: 'page2-b', rp: 8, nAccept: 0, externalRating: {} },
      ],
      externalRatingByUid: { 101: {}, 102: {} },
    });

    expect(screen.getByRole('columnheader', { name: 'CF' })).not.to.equal(null);
    expect(screen.getByRole('columnheader', { name: '牛客' })).not.to.equal(null);
    expect(screen.getByText('page2-a')).not.to.equal(null);
  });

  it('hides CF and Nowcoder headers when ranking inject is absent', () => {
    renderRanking({
      page: 1,
      upcount: 1,
      udocs: [{ _id: 2, uname: 'alice', rp: 20, nAccept: 3 }],
    });

    expect(screen.queryByRole('columnheader', { name: 'CF' })).to.equal(null);
    expect(screen.queryByRole('columnheader', { name: '牛客' })).to.equal(null);
  });
});

const SCHOOL_A = '111111111111111111111111';
const SCHOOL_B = '222222222222222222222222';
const GROUP_A = '333333333333333333333333';
const GROUP_B = '444444444444444444444444';

describe('ranking sorting and administrator filters', () => {
  const users = [{ _id: 101, uname: 'alice', rp: 10, nAccept: 1, rank: 5, rpInfo: { problem: 8, contest: 2 } }];

  it('makes every visible header sortable and reports the current direction', () => {
    renderRanking({ canFilterRanking: true, sort: 'rp:contest', order: 'asc', rpDefinitions: { problem: {}, contest: {} },
      externalRatingByUid: {}, studentDict: {}, udocs: users });
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(10);
    for (const header of headers) expect(within(header).getByRole('button')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '比赛 RP' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button', { name: '学号 / 姓名' })).toBeTruthy();
  });

  it('does not render private filters or identities for ordinary viewers', () => {
    renderRanking({ udocs: users, studentDict: { 101: { studentId: '2026001', realName: '不应公开' } }, schools: [{ id: SCHOOL_A, name: '私有学校' }] });
    expect(screen.queryByRole('form', { name: '排名筛选' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '学号 / 姓名' })).toBeNull();
    expect(screen.queryByText('不应公开')).toBeNull();
    expect(screen.queryByText('私有学校')).toBeNull();
  });

  it('preserves applied filters and sorting across pages and clears only filters', () => {
    renderRanking({ canFilterRanking: true, page: 1, upcount: 3, sort: 'ac', order: 'desc', udocs: users,
      filters: { q: '李 同学', schoolId: SCHOOL_A, groupId: GROUP_A, binding: 'bound' } });
    const href = screen.getByRole('link', { name: '下一页' }).getAttribute('href');
    const url = new URL(href!, 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ sort: 'ac', order: 'desc', q: '李 同学', schoolId: SCHOOL_A, groupId: GROUP_A, binding: 'bound', page: '2' });
    expect(screen.getByRole('link', { name: '清除筛选' }).getAttribute('href')).toBe('/ranking?sort=ac&order=desc');
    const form = screen.getByRole('form', { name: '排名筛选' });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索排名用户' }), { target: { value: '2026001' } });
    expect(new FormData(form as HTMLFormElement).get('q')).toBe('2026001');
    expect(new FormData(form as HTMLFormElement).has('page')).toBe(false);
  });

  it('limits groups to the selected school and clears an incompatible selected group', async () => {
    const user = userEvent.setup();
    renderRanking({ canFilterRanking: true, udocs: users, filters: { schoolId: SCHOOL_A, groupId: GROUP_A },
      schools: [{ id: SCHOOL_A, name: '学校甲' }, { id: SCHOOL_B, name: '学校乙' }],
      groups: [{ id: GROUP_A, schoolId: SCHOOL_A, name: '甲班' }, { id: GROUP_B, schoolId: SCHOOL_B, name: '乙班' }] });
    await user.click(screen.getByRole('combobox', { name: '学校' }));
    await user.click(screen.getByRole('option', { name: '学校乙' }));
    const form = screen.getByRole('form', { name: '排名筛选' });
    expect(new FormData(form as HTMLFormElement).get('groupId')).toBe('');
    await user.click(screen.getByRole('combobox', { name: '用户组' }));
    expect(screen.queryByRole('option', { name: '甲班' })).toBeNull();
    expect(screen.getByRole('option', { name: '乙班' })).toBeTruthy();
  });

  it('shows the filtered empty state and keeps administrator controls available', () => {
    renderRanking({ canFilterRanking: true, filters: { q: '不存在' }, udocs: [], ucount: 0 });
    expect(screen.getByText('没有匹配的用户')).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByText('共 0 人')).toBeTruthy();
  });

  it('builds a sort URL under the current domain, resetting page without losing filters', () => {
    const result = rankingUrl(`/d/course/ranking?page=9&schoolId=${SCHOOL_B}`, { key: 'student', dir: 'asc' }, { q: '张 同学', schoolId: SCHOOL_A });
    const url = new URL(result, 'https://example.test');
    expect(url.pathname).toBe('/d/course/ranking');
    expect(Object.fromEntries(url.searchParams)).toEqual({ schoolId: SCHOOL_A, sort: 'student', order: 'asc', q: '张 同学' });
  });
});

describe('period and growth rankings', () => {
  const activity = {
    board: 'solves', period: 'week', date: '2026-11-25', today: '2026-11-25',
    window: { from: '2026-11-23', through: '2026-11-29', previous: '2026-11-22', next: '2026-11-30' },
    earliest: '2026-01-01', updatedAt: '2026-11-25T00:30:00.000Z', count: 21, page: 1, pages: 2,
    rows: [{ uid: 7, uname: '小林', rank: 1, activeDays: 2, solves: 5 }],
    mine: { uid: 2, rank: 21, activeDays: 1, solves: 1 },
  };

  it('shows personal rank outside the page, Beijing update time, and the four board links', () => {
    renderRanking({ activity });
    const tabs = screen.getByRole('tablist', { name: '榜单类型' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(4);
    expect(within(tabs).getByRole('tab', { name: '过题榜', selected: true })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: 'RP 总榜' }).getAttribute('href')).toBe('/ranking?board=rp');
    expect(screen.getByRole('tab', { name: '本周', selected: true })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '新过题数' })).toBeTruthy();
    expect(screen.getByText('第 21 名')).toBeTruthy();
    expect(screen.getByText('2026-11-25 08:30')).toBeTruthy();
    expect(screen.getByRole('link', { name: '下一页' }).getAttribute('href')).toContain('board=solves&period=week&page=2');
    expect(screen.getByRole('button', { name: '下一周期' })).toBeDisabled();
  });

  it('keeps a historical date across board and period switches and jumps back to the current period', () => {
    const date = '2026-11-02';
    renderRanking({ activity: { ...activity, board: 'newcomers', period: 'day', date,
      window: { from: date, through: date, previous: '2026-11-01', next: '2026-11-03' } } });
    const href = (name: string) => screen.getByRole('tab', { name }).getAttribute('href');
    expect(href('坚持榜')).toBe('/ranking?board=consistency&period=week&date=2026-11-02');
    expect(href('月榜')).toBe('/ranking?board=newcomers&period=month&date=2026-11-02');
    expect(screen.getByRole('link', { name: '回到今日' }).getAttribute('href')).toBe('/ranking?board=newcomers&period=day');
    const form = screen.getByRole('form', { name: '查看历史榜单' });
    expect(new FormData(form as HTMLFormElement).get('board')).toBe('newcomers');
    expect(screen.getByLabelText('榜单日期')).toHaveAttribute('max', activity.today);
  });

  it('shows both reference solves and ranked days on the consistency board, and a clear empty period', () => {
    const view = renderRanking({ activity: { ...activity, board: 'consistency' } });
    expect(screen.queryByRole('tab', { name: '今日' })).toBeNull();
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual(['名次', '用户', '过题天数', '新过题数']);
    view.unmount();
    renderRanking({ activity: { ...activity, rows: [], mine: null, pages: 0, count: 0 } });
    expect(screen.getByText('这段时间暂无上榜用户')).toBeTruthy();
    expect(screen.getByText('未上榜')).toBeTruthy();
    expect(screen.queryByRole('form', { name: '排名筛选' })).toBeNull();
  });
});
