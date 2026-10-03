import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { UserDetailPage } from '../src/pages/user';

vi.mock('@/components/ui/echart', async () => {
  const { createElement: h } = await import('react');
  return {
    EChart({ option, className }: { option: unknown; className?: string }) {
      return h(
        'div',
        { 'data-testid': 'krypton-echart', className },
        JSON.stringify(option, (_key, value) => (typeof value === 'function' ? undefined : value)),
      );
    },
  };
});

const profileSource = readFileSync(resolve(import.meta.dirname, '../src/pages/user.tsx'), 'utf8');

function makeBootstrap(data: Record<string, unknown>, viewerId = 2): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-09-20T00:00:00.000Z',
    user: { id: viewerId, name: 'viewer', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      contestDetail: '/contest/__TID__',
      problemDetail: '/p/__PID__',
      userDetail: '/user/__UID__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'user_detail.html', data },
  };
}

function renderProfile(data: Record<string, unknown>, viewerId = 2) {
  return render(createElement(BootstrapProvider, { bootstrap: makeBootstrap(data, viewerId) }, createElement(UserDetailPage)));
}

function ratingRow() {
  const title = screen.getByText('外站 Rating');
  const card = title.closest('[data-slot="card"]');
  expect(card, '外站 Rating should render inside a Card').not.to.equal(null);
  return card!.querySelector('[data-slot="card-content"]');
}

describe('user profile external rating source', () => {
  it('keeps the two-site rating row full width without max-w-xl', () => {
    expect(profileSource).to.include("from '@/components/ui/echart'");
    expect(profileSource).to.include('visibleExternalRatingSites.length > 1');
    expect(profileSource).not.to.include('echarts.init');
    expect(profileSource).not.to.include('codeforces.com/api');
  });

  it('renders EChart only when a visible site history array length >= 1', () => {
    expect(profileSource).to.include('history.length >= 1');
    expect(profileSource).to.include('externalRatingHistory');
  });
});

describe('user profile external rating view', () => {
  it('uses a full-width two-site rating row with no max-w-xl', () => {
    renderProfile({
      udoc: { _id: 9, uname: 'alice', rp: 12, nAccept: 3, nSubmit: 8 },
      externalRating: {
        codeforces: { handle: 'alice-cf', rating: 1712, fetchedAt: '2026-01-02T00:00:00.000Z', publicShow: true },
        nowcoder: { handle: 'alice-nk', rating: 2100, fetchedAt: '2026-01-03T00:00:00.000Z', publicShow: true },
      },
    });
    const row = ratingRow();
    expect(row).not.to.equal(null);
    expect(row!.className).to.include('w-full');
    expect(screen.getByText('alice-cf')).not.to.equal(null);
    expect(screen.getByText('alice-nk')).not.to.equal(null);
  });

  it('keeps a single visible site full width instead of max-w-xl', () => {
    renderProfile({
      udoc: { _id: 9, uname: 'alice', rp: 12 },
      externalRating: {
        codeforces: { handle: 'alice-cf', rating: 1712, fetchedAt: '2026-01-02T00:00:00.000Z', publicShow: true },
      },
    });
    const row = ratingRow();
    expect(row).not.to.equal(null);
    expect(row!.className).to.include('w-full');
    expect(screen.queryByTestId('krypton-echart')).to.equal(null);
  });

  it('renders EChart when history has at least one point', () => {
    renderProfile({
      udoc: { _id: 9, uname: 'alice', rp: 12 },
      externalRating: {
        codeforces: { handle: 'alice-cf', rating: 1712, fetchedAt: '2026-01-02T00:00:00.000Z', publicShow: true },
      },
      externalRatingHistory: {
        codeforces: [{ ratedAt: '2026-01-01T00:00:00.000Z', rating: 1680, contestName: 'Codeforces Round 999' }],
      },
    });
    const chart = screen.getByTestId('krypton-echart');
    expect(chart).not.to.equal(null);
    expect(chart.textContent).to.include('Codeforces Round 999');
    expect(chart.textContent).to.include('1680');
  });

  it('shows snapshot only and does not mount EChart when history is empty', () => {
    renderProfile({
      udoc: { _id: 9, uname: 'alice', rp: 12 },
      externalRating: {
        codeforces: { handle: 'alice-cf', rating: 1712, fetchedAt: '2026-01-02T00:00:00.000Z', publicShow: true },
        nowcoder: { handle: 'alice-nk', rating: 2100, fetchedAt: '2026-01-03T00:00:00.000Z', publicShow: true },
      },
      externalRatingHistory: { codeforces: [], nowcoder: [] },
    });
    expect(screen.getByText('1712')).not.to.equal(null);
    expect(screen.getByText('2100')).not.to.equal(null);
    expect(screen.queryByTestId('krypton-echart')).to.equal(null);
  });

  it('renders EChart for a privileged viewer when handle is unset but history remains', () => {
    renderProfile(
      {
        udoc: { _id: 9, uname: 'alice', rp: 12 },
        viewerIsSelf: true,
        externalRating: {
          codeforces: { handle: '', rating: null, fetchedAt: null, lastError: null, publicShow: false },
        },
        externalRatingHistory: {
          codeforces: [{ ratedAt: '2026-01-01T00:00:00.000Z', rating: 1680, contestName: 'Codeforces Round 999' }],
        },
      },
      9,
    );
    const chart = screen.getByTestId('krypton-echart');
    expect(chart).not.to.equal(null);
    expect(chart.textContent).to.include('Codeforces Round 999');
    expect(chart.textContent).to.include('1680');
    expect(screen.getByText('外站 Rating')).not.to.equal(null);
  });

  it('does not leak a hidden public site snapshot or history to strangers', () => {
    renderProfile(
      {
        udoc: { _id: 9, uname: 'alice', rp: 12 },
        externalRating: {
          codeforces: { handle: 'alice-cf', rating: 1712, fetchedAt: '2026-01-02T00:00:00.000Z', publicShow: true },
          nowcoder: {
            handle: 'nowcoder-hidden-handle',
            rating: 3333,
            fetchedAt: '2026-01-03T00:00:00.000Z',
            publicShow: false,
            lastError: 'not_found',
          },
        },
        externalRatingHistory: {
          codeforces: [{ ratedAt: '2026-01-01T00:00:00.000Z', rating: 1680, contestName: 'Codeforces Round 999' }],
          nowcoder: [{ ratedAt: '2026-01-04T00:00:00.000Z', rating: 3333, contestName: 'nowcoder-hidden-contest' }],
        },
      },
      2,
    );
    expect(screen.getByText('alice-cf')).not.to.equal(null);
    expect(screen.queryByText('nowcoder-hidden-handle')).to.equal(null);
    expect(screen.queryByText('nowcoder-hidden-contest')).to.equal(null);
    expect(screen.queryByText('3333')).to.equal(null);
    expect(screen.queryByText('未公开')).to.equal(null);
    expect(screen.queryByText('未找到该用户')).to.equal(null);
    expect(screen.getAllByTestId('krypton-echart')).to.have.length(1);
  });
});
