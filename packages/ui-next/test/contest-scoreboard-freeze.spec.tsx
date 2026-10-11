import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ContestScoreboardPage } from '../src/pages/contests';

function renderBoard(overrides: Record<string, unknown> = {}) {
  const bootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-11T13:00:00Z',
    user: { id: 7, name: 'me', signedIn: true },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { contests: '/contest', contestDetail: '/contest/__TID__', problemDetail: '/p/__PID__', recordDetail: '/record/__RID__' },
    udict: {},
    page: {
      templateName: 'contest_scoreboard.html',
      data: {
        tdoc: { docId: 'freeze-fixture', title: 'IOI', rule: 'ioi', lockAt: '2026-10-11T12:50:00Z', unlocked: false },
        scoreboardLocked: true,
        scoreboardSnapshotMode: 'frozen',
        currentUserId: 7,
        examMode: { enabled: true, urls: { ranking: '/exam-mode/freeze-fixture/ranking' } },
        pdict: { 11: { title: 'A' }, 12: { title: 'B' } },
        udict: { 7: { uname: 'me' }, 8: { uname: 'other' } },
        rows: [
          [{ type: 'rank', value: '#' }, { type: 'user', value: '用户' }, { type: 'total_score', value: '总分' }, { type: 'problem', value: 'A', raw: 11 }, { type: 'problem', value: 'B', raw: 12 }],
          [{ type: 'rank', value: '1' }, { type: 'user', value: 'other', raw: 8 }, { type: 'total_score', value: 80 }, { type: 'record', value: '80<span style="color:orange">+1</span>', score: 80 }, { type: 'record', value: '-<span style="color:orange">+1</span>' }],
          [{ type: 'rank', value: '2' }, { type: 'user', value: 'me', raw: 7 }, { type: 'total_score', value: 200, selfVisible: true }, { type: 'record', value: '100\n02:40:00', score: 100, selfVisible: true }, { type: 'record', value: '100\n02:41:00', score: 100, selfVisible: true }],
        ],
        ...overrides,
      },
    },
  } as KryptonBootstrap;
  return render(<BootstrapProvider bootstrap={bootstrap}><ContestScoreboardPage /></BootstrapProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('frozen IOI scoreboard presentation', () => {
  it('shows the personal score and both problem results without changing the public rank or the other pending cells', () => {
    renderBoard();
    const own = screen.getByText('个人实时成绩').closest('tr');
    expect(own).not.to.equal(null);
    const cells = within(own!).getAllByRole('cell');
    expect(cells[0].textContent).to.equal('2');
    expect(cells[2].textContent).to.equal('200');
    expect(cells[3].textContent).to.include('100');
    expect(cells[4].textContent).to.include('100');
    expect(within(own!).queryByText('?')).to.equal(null);
    const other = screen.getByText('other').closest('tr');
    expect(within(other!).getAllByText('?')).to.have.length(2);
    expect(within(other!).getAllByText('80')).to.have.length(2);
    expect(screen.getByText('你可查看自己的真实成绩；其他人的结果与公开排名保持封榜。')).not.to.equal(null);
    expect(screen.queryByRole('link', { name: '实时榜' })).to.equal(null);
    expect(screen.queryByRole('button', { name: '解除封榜' })).to.equal(null);
  });

  it('does not show the early freeze banner just because lockAt has been configured', () => {
    renderBoard({ scoreboardLocked: false });
    expect(screen.queryByText('你可查看自己的真实成绩；其他人的结果与公开排名保持封榜。')).to.equal(null);
    expect(screen.queryByText('排行榜已封榜，封榜后的提交可能会暂时显示为待定。')).to.equal(null);
  });

  it('keeps the administrator frozen/live switches and does not present switching as unlocking', () => {
    renderBoard({ canViewLockedRealtime: true, examMode: { enabled: false }, rows: [] });
    const live = screen.getByRole('link', { name: '实时榜' });
    expect(live.getAttribute('href')).to.include('realtime=true');
    expect(screen.getByRole('link', { name: '学生榜' }).getAttribute('aria-current')).to.equal('page');
    expect(screen.queryByRole('button', { name: '解除封榜' })).to.equal(null);
  });

  it('labels the administrator live view separately from personal results and allows returning to the frozen view', () => {
    window.history.replaceState(null, '', '/contest/freeze-fixture/scoreboard?realtime=true');
    renderBoard({ canViewLockedRealtime: true, scoreboardSnapshotMode: 'realtime', rows: [] });
    expect(screen.getByText('这是实时榜，名次和分数包含封榜后的提交。')).not.to.equal(null);
    expect(screen.getByRole('link', { name: '实时榜' }).getAttribute('aria-current')).to.equal('page');
    expect(screen.getByRole('link', { name: '学生榜' }).getAttribute('href')).not.to.include('realtime=true');
    expect(screen.queryByText('个人实时成绩')).to.equal(null);
  });
});
