import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { RankingPage } from '../src/pages/ranking.tsx';

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
      externalRatingByUid: { '101': {}, '102': {} },
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
