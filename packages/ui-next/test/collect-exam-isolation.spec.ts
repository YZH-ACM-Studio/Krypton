// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(uiRoot, '../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function isCollectSourceFile(path: string): boolean {
  const name = path.split('/').pop() || '';
  return /(^|[-_])collect/i.test(name) && /\.(ts|tsx)$/.test(name);
}

function standaloneTemplates(routerSource: string): string[] {
  const match = /const STANDALONE_TEMPLATES = new Set\(\[([\s\S]*?)\]\)/.exec(routerSource);
  expect(match, 'STANDALONE_TEMPLATES declaration').to.not.equal(null);
  return [...(match?.[1].matchAll(/'([^']+)'/g) ?? [])].map((item) => item[1]);
}

describe('file-collect exam isolation', () => {
  it('keeps collect templates out of the exam standalone shell', () => {
    const router = source('packages/ui-next/src/router.tsx');
    const templates = standaloneTemplates(router);
    expect(templates.some((template) => template.toLowerCase().includes('collect'))).to.equal(false);
    expect(templates).to.include('exam_mode_home.html');

    const appShellStart = router.indexOf('function AppShell()');
    const defaultShellStart = router.indexOf('function DefaultAppShell()');
    expect(appShellStart).to.be.greaterThan(-1);
    expect(defaultShellStart).to.be.greaterThan(appShellStart);
    expect(router.slice(appShellStart, defaultShellStart)).to.include('STANDALONE_TEMPLATES.has');
    expect(router.slice(appShellStart, defaultShellStart)).to.not.include('CollectPendingBadge');
    expect(router.slice(defaultShellStart)).to.include('CollectPendingBadge');
  });

  it('does not mount collect pages under exam-mode or ExamShell', () => {
    const resolver = source('packages/ui-next/src/pages/resolver.tsx');
    expect(resolver).to.include("'collect_main.html': CollectListPage");
    expect(resolver).to.include("'collect_detail.html': CollectDetailPage");
    expect(resolver).to.include("'admin_collect.html': AdminCollectListPage");
    expect(resolver).to.include("'admin_collect_edit.html': AdminCollectEditPage");
    expect(resolver).to.include("'admin_collect_stats.html': AdminCollectStatsPage");
    expect(resolver).to.not.match(/'[^']*collect[^']*'\s*:\s*Exam\w+/);

    const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
    expect(sidebar).to.include("href: '/collect'");
    expect(sidebar).to.include("href: '/admin/collect'");
    expect(sidebar).to.not.include('/exam-mode/collect');
    expect(sidebar).to.not.include('/paper/collect');

    const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');
    expect(examShell).to.not.include('/collect');
    expect(examShell).to.not.include('collect-home-block');
    expect(examShell).to.not.include('collect-pending-badge');
    expect(examShell).to.not.include('CollectHomeBlock');
    expect(examShell).to.not.include('CollectPendingBadge');

    for (const file of listFiles(resolve(uiRoot, 'src/pages/exam-mode'))) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(workspaceRoot, file);
      expect(text, rel).to.not.include('/collect');
      expect(text, rel).to.not.include('collect-home-block');
      expect(text, rel).to.not.include('collect-pending-badge');
      expect(text, rel).to.not.include('CollectHomeBlock');
      expect(text, rel).to.not.include('CollectPendingBadge');
    }

    const collectUiFiles = [
      ...listFiles(resolve(uiRoot, 'src/pages')),
      ...listFiles(resolve(uiRoot, 'src/components')),
    ].filter(isCollectSourceFile);
    expect(collectUiFiles.length).to.be.greaterThan(0);
    for (const file of collectUiFiles) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(workspaceRoot, file);
      expect(text, rel).to.not.match(/from ['"][^'"]*exam-shell['"]/);
      expect(text, rel).to.not.include('ExamHomeShell');
      expect(text, rel).to.not.include('ExamDetailShell');
      expect(text, rel).to.not.include('ExamContestShell');
      expect(text, rel).to.not.include('/exam-mode');
    }

    const handlerPath = resolve(workspaceRoot, 'packages/krypton-collect/src/handler.ts');
    if (existsSync(handlerPath)) {
      const handler = readFileSync(handlerPath, 'utf8');
      expect(handler).to.include("'/collect'");
      expect(handler).to.include("'/admin/collect'");
      expect(handler).to.include("'/api/collect/pending'");
      expect(handler).to.not.include('/exam-mode');
      expect(handler).to.not.include('/paper/');
    }
  });
});
