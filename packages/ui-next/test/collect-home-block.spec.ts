import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectHomeBlock } from '../src/components/collect-home-block.tsx';
import * as errorPresenter from '../src/lib/error-presenter.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function pendingResponse(body: unknown) {
  return { json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collect home block contracts', () => {
  const home = source('packages/ui-next/src/pages/home.tsx');
  const block = source('packages/ui-next/src/components/collect-home-block.tsx');
  const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');
  const examHome = source('packages/ui-next/src/pages/exam-mode/index.tsx');
  const router = source('packages/ui-next/src/router.tsx');

  it('sits under the homepage personal card and stays off the exam shell', () => {
    expect(home).to.include("import { CollectHomeBlock } from '@/components/collect-home-block'");
    const personal = home.indexOf("title={bs.user.signedIn ? '个人' : '账号'}");
    const collectBlock = home.indexOf('<CollectHomeBlock />');
    const ranking = home.indexOf('{/* Ranking */}');
    expect(personal).to.be.at.least(0);
    expect(collectBlock).to.be.greaterThan(personal);
    expect(ranking).to.be.greaterThan(collectBlock);

    expect(block).to.include("fetchHydroResponse('/api/collect/pending'");
    expect(block).to.include('if (!loaded || count === 0) return null');
    expect(block).to.include('function parsePendingPayload(body: unknown)');
    expect(block).to.include('if (!isRecord(body)) return { count: 0, docs: [] }');
    expect(block).not.to.include('ExamShell');
    expect(block).not.to.match(/from ['"]@\/components\/layout\/exam-shell['"]/);
    expect(examShell).not.to.include('CollectHomeBlock');
    expect(examHome).not.to.include('CollectHomeBlock');
    expect(examHome).not.to.include('/collect');
  });

  it('keeps the pending topbar badge on the ordinary AppShell', () => {
    expect(router).to.include("import { CollectPendingBadge } from '@/components/collect-pending-badge'");
    expect(router).to.include('<CollectPendingBadge />');
    const standalone = router.match(/const STANDALONE_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(standalone).not.to.match(/collect_[\w-]*\.html/);
    const defaultShell = router.slice(router.indexOf('function DefaultAppShell'));
    expect(defaultShell).to.include('<CollectPendingBadge />');
  });

  it('enlarges 去交文件 without making the pending row a link', () => {
    const row = block.slice(block.indexOf('{docs.slice(0, 3)'), block.indexOf('查看全部'));
    expect(row).to.include('{doc.title}');
    expect(row).to.include('去交文件');
    expect(row).to.include('inline-flex min-h-11 shrink-0 items-center px-2');
    expect(row.indexOf('{doc.title}')).to.be.lessThan(row.indexOf('href={`/collect/${doc._id}`}'));
    expect(row).to.include('<p className="truncate text-sm font-medium">{doc.title}</p>');
    expect(block).to.include("fetchHydroResponse('/api/collect/pending'");
  });
});

describe('collect home block pending payload', () => {
  it('renders nothing for empty or malformed pending payloads', async () => {
    vi.spyOn(errorPresenter, 'fetchHydroResponse').mockResolvedValue(pendingResponse({ docs: 'nope' }));
    const { container } = render(createElement(CollectHomeBlock));
    await waitFor(() => expect(errorPresenter.fetchHydroResponse).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).to.equal('');
  });

  it('links pending items to ordinary /collect routes', async () => {
    vi.spyOn(errorPresenter, 'fetchHydroResponse').mockResolvedValue(
      pendingResponse({
        count: 1,
        docs: [{ _id: '66b800000000000000000701', title: '实验报告', dueAt: '2026-10-01T12:00:00.000Z' }],
      }),
    );
    render(createElement(CollectHomeBlock));
    expect(await screen.findByText('未交文件')).not.to.equal(null);
    expect(screen.getByRole('link', { name: '去交文件' }).getAttribute('href')).to.equal('/collect/66b800000000000000000701');
    expect(screen.getByRole('link', { name: /查看全部/ }).getAttribute('href')).to.equal('/collect');
    expect(screen.getByRole('link', { name: '去交文件' }).className).to.match(/(?:^|\s)min-h-11(?:\s|$)/);
    expect(screen.getByText('实验报告').closest('a')).to.equal(null);
  });
});
