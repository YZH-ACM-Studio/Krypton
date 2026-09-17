import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { PRIV } from '../src/lib/perms.ts';
import { ContestEditPage } from '../src/pages/contest-manage.tsx';

const workspace = resolve(import.meta.dirname, '../../..');
const CONTEST_ID = '66bf00000000000000000101';

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function editBootstrap(priv: number): KryptonBootstrap {
  const tdoc = {
    title: '2026 校赛',
    beginAt: '2026-08-20T01:00:00.000Z',
    endAt: '2026-08-20T04:00:00.000Z',
    _id: CONTEST_ID,
    docId: CONTEST_ID,
    rule: 'acm',
    owner: 2,
    pids: [],
    files: [],
    participationMode: 'individual',
    vigilEnabled: true,
    entryMode: 'client_required',
  };
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: { id: 2, name: 'operator', signedIn: true, priv } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      contests: '/contest',
      contestDetail: '/contest/:TID',
      problemDetail: '/p/:PID',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'contest_edit.html',
      data: {
        page_name: 'contest_edit',
        tdoc,
        rules: { acm: 'ACM' },
        duration: 3,
        pids: '',
        beginAt: tdoc.beginAt,
        scopeSchools: [],
        scopeGroups: [],
        teamBatches: [],
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contest Vigil resync control', () => {
  it('keeps the existing PRIV_EDIT_SYSTEM resync route and does not surface tokens', () => {
    const page = source('packages/ui-next/src/pages/contest-manage.tsx');
    const handler = source('packages/krypton-vigilguard/src/handler.ts');
    expect(page).to.include('/api/admin/vigilguard/resync/');
    expect(page).to.include('isSystemAdmin(bs.user.priv)');
    expect(page).to.include('将已保存的比赛配置重新推送到 Vigil。未保存的修改不会包含在内。');
    expect(page).not.to.include('serviceToken.');
    expect(page).not.to.include('dashboardToken');
    expect(handler).to.include("ctx.Route('vigilguard_resync', '/api/admin/vigilguard/resync/:tid', VigilGuardResyncContestHandler, PRIV.PRIV_EDIT_SYSTEM)");
  });

  it('hides the resync control from contest teachers without PRIV_EDIT_SYSTEM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [] })),
    );
    render(
      <BootstrapProvider bootstrap={editBootstrap(0)}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: '客户端与反作弊' }));
    expect(screen.queryByRole('button', { name: '重新同步到 Vigil' })).to.equal(null);
  });

  it('lets a system admin POST the existing resync route for the current contest', async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.includes('/api/admin/vigilguard/resync/')) {
          posts.push(url);
          return json({ ok: true, vigilEnabled: true });
        }
        return json({ events: [], schools: [] });
      }),
    );
    render(
      <BootstrapProvider bootstrap={editBootstrap(PRIV.PRIV_EDIT_SYSTEM)}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '客户端与反作弊' }));
    await user.click(screen.getByRole('button', { name: '重新同步到 Vigil' }));
    await waitFor(() => expect(posts).to.deep.equal([`/d/system/api/admin/vigilguard/resync/${CONTEST_ID}`]));
    expect(await screen.findByText('已将当前已保存的比赛配置重新推送到 Vigil。')).toBeInTheDocument();
  });

  it('shows the existing handler error when Vigil resync is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.includes('/api/admin/vigilguard/resync/')) {
          return json({ ok: false, error: 'Vigil bridge: vigil.baseUrl not configured' }, 502);
        }
        return json({ events: [], schools: [] });
      }),
    );
    render(
      <BootstrapProvider bootstrap={editBootstrap(PRIV.PRIV_EDIT_SYSTEM)}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '客户端与反作弊' }));
    await user.click(screen.getByRole('button', { name: '重新同步到 Vigil' }));
    expect(await screen.findByText('Vigil bridge: vigil.baseUrl not configured')).toBeInTheDocument();
  });
});
