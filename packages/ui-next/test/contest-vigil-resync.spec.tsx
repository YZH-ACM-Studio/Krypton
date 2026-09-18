import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { PRIV } from '../src/lib/perms.ts';

const workspace = resolve(import.meta.dirname, '../../..');
const EXAM_TREE = resolve(workspace, 'packages/ui-next/src/pages/contest-edit-exam.tsx');
const CONTEST_ID = '66bf00000000000000000101';

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pageData(pageName: string, tdoc: Record<string, unknown>) {
  return {
    page_name: pageName,
    tdoc,
    rules: { acm: 'ACM', exam: '考试' },
    duration: 3,
    pids: '',
    beginAt: typeof tdoc.beginAt === 'string' ? tdoc.beginAt : '',
    scopeSchools: [],
    scopeGroups: [],
    teamBatches: [],
  };
}

function bootstrap(priv: number, pageName: string, tdoc: Record<string, unknown>): KryptonBootstrap {
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
      data: pageData(pageName, tdoc),
    },
  };
}

function editAcmBootstrap(priv: number): KryptonBootstrap {
  return bootstrap(priv, 'contest_edit', {
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
  });
}

function createExamBootstrap(priv: number): KryptonBootstrap {
  return bootstrap(priv, 'contest_create', {
    rule: 'exam',
    _id: CONTEST_ID,
    docId: CONTEST_ID,
    vigilEnabled: true,
    entryMode: 'client_required',
    owner: 2,
    pids: [],
    files: [],
  });
}

async function renderContestEdit(pageBootstrap: KryptonBootstrap) {
  const { ContestEditPage } = await import('../src/pages/contest-manage.tsx');
  return render(
    <BootstrapProvider bootstrap={pageBootstrap}>
      <ContestEditPage />
    </BootstrapProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contest Vigil resync control', () => {
  it('keeps the existing PRIV_EDIT_SYSTEM resync route and does not surface tokens', () => {
    const manage = source('packages/ui-next/src/pages/contest-manage.tsx');
    const exam = existsSync(EXAM_TREE) ? source('packages/ui-next/src/pages/contest-edit-exam.tsx') : '';
    const ui = `${manage}\n${exam}`;
    const handler = source('packages/krypton-vigilguard/src/handler.ts');
    expect(ui).to.include('/api/admin/vigilguard/resync/');
    expect(ui).to.include('isSystemAdmin(bs.user.priv)');
    expect(ui).to.include('将已保存的比赛配置重新推送到 Vigil。未保存的修改不会包含在内。');
    expect(ui).not.to.include('serviceToken.');
    expect(ui).not.to.include('dashboardToken');
    expect(handler).to.include("ctx.Route('vigilguard_resync', '/api/admin/vigilguard/resync/:tid', VigilGuardResyncContestHandler, PRIV.PRIV_EDIT_SYSTEM)");
  });

  it('hides the resync control from contest teachers without PRIV_EDIT_SYSTEM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [] })),
    );
    await renderContestEdit(editAcmBootstrap(0));
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
    await renderContestEdit(editAcmBootstrap(PRIV.PRIV_EDIT_SYSTEM));
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
    await renderContestEdit(editAcmBootstrap(PRIV.PRIV_EDIT_SYSTEM));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '客户端与反作弊' }));
    await user.click(screen.getByRole('button', { name: '重新同步到 Vigil' }));
    expect(await screen.findByText('Vigil bridge: vigil.baseUrl not configured')).toBeInTheDocument();
  });
});

describe('exam create has no Vigil resync', () => {
  it('keeps ContestEditPage exam create chrome free of the resync control', () => {
    const manage = source('packages/ui-next/src/pages/contest-manage.tsx');
    const start = manage.indexOf('export function ContestEditPage');
    const end = manage.indexOf('function ContestEditAcmForm');
    expect(start).to.be.at.least(0);
    expect(end).to.be.greaterThan(start);
    const examChrome = manage.slice(start, end);
    expect(examChrome).not.to.include('VigilContestResyncControl');
    expect(examChrome).not.to.include('重新同步到 Vigil');
    expect(examChrome).not.to.include('/api/admin/vigilguard/resync/');
  });

  it('locks contest-edit-exam create path without resync when Vigil lives there', () => {
    expect(existsSync(EXAM_TREE)).to.equal(true);
    const exam = source('packages/ui-next/src/pages/contest-edit-exam.tsx');
    expect(exam).to.include('启用 Vigil 反作弊');
    expect(exam).to.include('{isEdit ? (');
    expect(exam).not.to.match(/!isEdit[\s\S]{0,800}(VigilContestResyncControl|重新同步到 Vigil|vigilguard\/resync)/);
    const resyncAt = ['VigilContestResyncControl', '重新同步到 Vigil', '/api/admin/vigilguard/resync/']
      .map((marker) => exam.indexOf(marker))
      .filter((index) => index >= 0);
    if (!resyncAt.length) return;
    const at = Math.min(...resyncAt);
    const before = exam.slice(0, at);
    expect(Math.max(before.lastIndexOf('{isEdit ? ('), before.lastIndexOf('{isEdit &&'))).to.be.at.least(0);
  });

  it('does not show resync on contest_create exam even for a system admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [], pdocs: [] })),
    );
    await renderContestEdit(createExamBootstrap(PRIV.PRIV_EDIT_SYSTEM));
    expect(screen.queryByText('重新同步到 Vigil')).to.equal(null);
    expect(screen.queryByRole('button', { name: '重新同步到 Vigil', hidden: true })).to.equal(null);
  });
});
