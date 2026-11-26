import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { UserDetailPage } from '../src/pages/user';

vi.mock('@/components/ui/echart', () => ({ EChart: () => null }));
afterEach(cleanup);

function renderProfile(profileStats: unknown) {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton', siteName: 'Krypton', locale: 'zh_CN', theme: 'light', generatedAt: '2026-10-28T00:00:00Z',
    user: { id: 2, name: 'viewer', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/', contestDetail: '/contest/__TID__', problemDetail: '/p/__PID__', userDetail: '/user/__UID__' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'user_detail.html',
      data: { udoc: { _id: 1371, uname: 'student' }, pdocs: [], profileStats },
    },
  };
  return render(createElement(BootstrapProvider, { bootstrap }, createElement(UserDetailPage)));
}

function stat(label: string) {
  return screen.getByText(label, { exact: true }).parentElement?.textContent;
}

describe('user profile statistics', () => {
  it('shows real counts even when serialized user statistics and visible problems are absent', () => {
    renderProfile({ nSubmit: 71, nAccept: 26, rp: 1, rank: 645 });
    expect(stat('提交')).toBe('提交71');
    expect(stat('通过')).toBe('通过26');
    expect(stat('RP')).toBe('RP1');
    expect(stat('排名')).toBe('排名#645');
  });

  it('shows explicit zero counts for a user without submissions', () => {
    renderProfile({ nSubmit: 0, nAccept: 0, rp: 0, rank: 0 });
    expect(stat('提交')).toBe('提交0');
    expect(stat('通过')).toBe('通过0');
    expect(stat('排名')).toBe('排名—');
  });

  it('rejects missing statistics instead of presenting missing data as zero submissions', () => {
    expect(() => renderProfile(undefined)).toThrow('user_profile_statistics_invalid');
  });

  it.each([
    { nSubmit: '71', nAccept: 26, rp: 1, rank: 645 },
    { nSubmit: 0, nAccept: 26, rp: 1, rank: 645 },
    { nSubmit: 71, nAccept: -1, rp: 1, rank: 645 },
    { nSubmit: 71, nAccept: 26, rp: Number.NaN, rank: 645 },
  ])('rejects malformed statistics: %j', (statistics) => {
    expect(() => renderProfile(statistics)).toThrow('user_profile_statistics_invalid');
  });
});
