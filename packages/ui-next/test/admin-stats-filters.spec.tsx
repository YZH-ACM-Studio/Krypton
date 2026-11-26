import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { PRIV } from '../src/lib/perms';
import { AdminStatsPage } from '../src/pages/admin-stats';

function renderStats() {
  const bootstrap = {
    appName: 'Krypton', siteName: 'Krypton', locale: 'zh-CN', theme: 'light', generatedAt: '2026-11-02T00:00:00Z',
    user: { id: 2, name: 'admin', signedIn: true, priv: PRIV.PRIV_EDIT_SYSTEM },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' }, urls: {}, udict: {},
    page: { templateName: 'admin_stats.html', data: {
      view: 'homework', contests: [], homeworks: [{ docId: 'hw1', title: '链表作业' }], trainings: [],
      selectedContest: { docId: 'hw1', title: '链表作业', pids: [] }, selectedTraining: null, selectedUser: null,
      stats: null, problems: [], groups: [], userSearchResults: [], groupIds: [], groupMemberCount: null,
      q: '', range: 0, from: '2026-10-01', to: '2026-10-31', tag: '', maxTimeMs: 5000,
    } },
  } as KryptonBootstrap;
  return render(<BootstrapProvider bootstrap={bootstrap}><AdminStatsPage /></BootstrapProvider>);
}

describe('statistics time and homework filters', () => {
  it('restores custom dates, preserves homework and dates in both forms and dimension links', () => {
    renderStats();
    const from = screen.getByLabelText('开始日期（北京时间）');
    expect(from).toHaveValue('2026-10-01');
    const form = from.closest('form')!;
    expect(new FormData(form).get('contestId')).toBe('hw1');
    expect(new FormData(form).get('view')).toBe('homework');
    expect(screen.getByLabelText('结束日期（含当天）')).toHaveValue('2026-10-31');
    const homework = screen.getByRole('combobox', { name: '选择作业' });
    expect(homework).toHaveTextContent('链表作业');
    expect(new FormData(homework.closest('form')!).get('from')).toBe('2026-10-01');
    expect(screen.getByRole('tab', { name: '大盘' })).toHaveAttribute('href', '/admin/stats?view=dashboard&range=0&from=2026-10-01&to=2026-10-31');
  });

  it('clears custom dates when a quick range is chosen', async () => {
    const user = userEvent.setup();
    renderStats();
    await user.click(screen.getByRole('combobox', { name: '统计时间' }));
    await user.click(screen.getByRole('option', { name: '近 7 天' }));
    const form = screen.getByRole('button', { name: '应用时间筛选' }).closest('form')!;
    const values = new FormData(form);
    expect(values.get('range')).toBe('7');
    expect(values.has('from')).toBe(false);
    expect(values.has('to')).toBe(false);
  });
});
