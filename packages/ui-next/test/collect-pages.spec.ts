import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCollectManagementCapability } from '../collect-capabilities.ts';

const PRIV_EDIT_SYSTEM = 1;
const PERM_CREATE_COLLECT = 2n;
const PERM_MANAGE_COLLECT = 4n;

function capability(
  user: any,
  onError: (error: unknown) => void = (error) => {
    throw error;
  },
) {
  return resolveCollectManagementCapability({
    user,
    editSystemPriv: PRIV_EDIT_SYSTEM,
    createCollectPerm: PERM_CREATE_COLLECT,
    manageCollectPerm: PERM_MANAGE_COLLECT,
    onError,
  });
}

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

function walkTsFiles(dir: string, acc: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
}

function collectPageSources(): string[] {
  const pagesRoot = resolve(workspaceRoot, 'packages/ui-next/src/pages');
  const files: string[] = [];
  walkTsFiles(resolve(pagesRoot, 'collect'), files);
  walkTsFiles(resolve(pagesRoot, 'admin-collect'), files);
  for (const name of ['collect.tsx', 'collect.ts', 'admin-collect.tsx', 'admin-collect.ts']) {
    const full = resolve(pagesRoot, name);
    if (existsSync(full)) files.push(full);
  }
  return files;
}

describe('collect management capability', () => {
  it('allows system editors, domain collect managers, and domain collect creators', () => {
    expect(capability({ hasPriv: () => true, hasPerm: () => false })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_MANAGE_COLLECT })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_CREATE_COLLECT })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: () => false })).to.equal(false);
  });

  it('fails closed and reports missing or failing permission checks', () => {
    expect(capability(undefined)).to.equal(false);
    const observed: unknown[] = [];
    expect(capability({ hasPriv: () => false }, (error) => observed.push(error))).to.equal(false);
    expect(observed[0]).to.be.instanceOf(TypeError);

    const failure = new Error('permission lookup failed');
    expect(
      capability(
        {
          hasPriv: () => {
            throw failure;
          },
          hasPerm: () => true,
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[1]).to.equal(failure);

    const permissionFailure = new Error('domain permission lookup failed');
    expect(
      capability(
        {
          hasPriv: () => false,
          hasPerm: () => {
            throw permissionFailure;
          },
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[2]).to.equal(permissionFailure);
  });
});

describe('collect page wiring contracts', () => {
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const bootstrapServer = source('packages/ui-next/index.ts');
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const prepare = source('build/prepare.js');
  const collectPages = collectPageSources();

  it('keeps one public 文件收集 entry and one capability-gated management entry', () => {
    expect(sidebar.match(/label: '文件收集'/g) || []).to.have.lengthOf(2);
    expect(sidebar).to.match(
      /label: '任务'[\s\S]*?href: '\/tasks'[\s\S]*?label: '文件收集'[\s\S]*?href: '\/collect'[\s\S]*?'collect_main\.html', 'collect_detail\.html'[\s\S]*?label: '协作'/,
    );
    expect(sidebar).to.include('bs.user.canManageCollect');
    expect(sidebar).to.match(/canManageCollect[\s\S]*?label: '文件收集'[\s\S]*?href: '\/admin\/collect'/);
    for (const template of ['admin_collect.html', 'admin_collect_edit.html', 'admin_collect_stats.html']) {
      expect(sidebar, `sidebar collect management entry missing ${template}`).to.include(template);
    }
  });

  it('registers collect PAGE_MAP keys without exam-mode templates', () => {
    expect(resolver).to.include("from '@/pages/collect'");
    expect(resolver).to.include("from '@/pages/admin-collect'");
    expect(resolver).to.include("'collect_main.html': CollectListPage");
    expect(resolver).to.include("'collect_detail.html': CollectDetailPage");
    expect(resolver).to.include("'admin_collect.html': AdminCollectListPage");
    expect(resolver).to.include("'admin_collect_edit.html': AdminCollectEditPage");
    expect(resolver).to.include("'admin_collect_stats.html': AdminCollectStatsPage");
    expect(resolver).not.to.match(/'collect_[^']+\.html':\s*\w*Exam/);
  });

  it('publishes canManageCollect from the server-computed collect capability', () => {
    expect(bootstrapServer).to.include('resolveCollectManagementCapability');
    expect(bootstrapServer).to.include('editSystemPriv: PRIV.PRIV_EDIT_SYSTEM');
    expect(bootstrapServer).to.include('createCollectPerm: PERM.PERM_CREATE_COLLECT');
    expect(bootstrapServer).to.include('manageCollectPerm: PERM.PERM_MANAGE_COLLECT');
    expect(bootstrapServer).to.include("'[ui-next] collect management capability resolution failed:'");
    expect(bootstrapServer).to.include('canManageCollect,');
    expect(bootstrapTypes).to.include('canManageCollect?: boolean');
  });

  it('includes collect-capabilities in all three prepare.js typecheck surfaces', () => {
    expect(prepare).to.include('packages/ui-next/collect-capabilities.${ext}');
    expect(prepare).to.include("'packages/ui-next/collect-capabilities.ts'");
    expect(prepare).to.include("'collect-capabilities.ts'");
  });

  it('does not register legacy admin navigation or import ExamShell from collect pages', () => {
    for (const file of collectPages) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.to.include('registerAdminNavSection');
      expect(text, file).not.to.include('ExamShell');
      expect(text, file).not.to.match(/from ['"]@\/components\/layout\/exam-shell['"]/);
    }
  });
});

describe('collect exam isolation contracts', () => {
  const router = source('packages/ui-next/src/router.tsx');
  const lockout = source('packages/krypton-vigilguard/src/lockout.ts');
  const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');

  it('keeps collect templates out of STANDALONE_TEMPLATES', () => {
    const standalone = router.match(/const STANDALONE_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(standalone).to.include('exam_mode_home.html');
    expect(standalone).not.to.match(/collect_[\w-]*\.html/);
    for (const template of ['collect_main.html', 'collect_detail.html', 'admin_collect.html', 'admin_collect_edit.html', 'admin_collect_stats.html']) {
      expect(standalone, `STANDALONE_TEMPLATES must not include ${template}`).not.to.include(template);
    }
  });

  it('does not whitelist /collect for lockout or bound Client sessions', () => {
    const whitelist = sliceBetween(lockout, 'const WHITELIST_PATHS', 'function matchesWhitelist');
    expect(whitelist).not.to.include('/collect');
    const allowed = sliceBetween(lockout, 'function isBoundClientRequestAllowed', 'function domainPath');
    expect(allowed).not.to.include('/collect');
  });

  it('keeps ExamShell free of collect navigation', () => {
    expect(examShell).not.to.include('/collect');
    expect(examShell).not.to.include('CollectListPage');
    expect(examShell).not.to.include('canManageCollect');
    expect(examShell).not.to.include('CollectHomeBlock');
  });
});

describe('collect teacher payload contracts', () => {
  const handler = source('packages/krypton-collect/src/handler.ts');
  const admin = source('packages/ui-next/src/pages/admin-collect/index.tsx');
  const homeBlock = source('packages/ui-next/src/components/collect-home-block.tsx');

  it('binds edit/stats/list pages to request, canEdit, hasFiles, and prefillSchoolId', () => {
    expect(handler).to.include('this.response.body = {');
    expect(handler).to.include('request: requestView');
    expect(handler).to.include('hasFiles');
    expect(handler).to.include("canNudge: request.status === 'published' || request.status === 'closed'");
    expect(handler).to.include('canPack: true');
    expect(handler).to.include('serializeRequest(request, { canEdit })');
    expect(admin).to.include('rec.prefillSchoolId');
    expect(admin).not.to.include('prefillSchoolId: rec.schoolId');
    expect(admin).to.include('hasFiles: optionalBoolean(rec.hasFiles');
    expect(admin).to.include('!item.hasFiles');
    expect(admin).to.include('item.hasFiles && item.status');
  });

  it('uses locked product copy on the homepage pending block', () => {
    expect(homeBlock).to.include('未交文件');
    expect(homeBlock).to.include('去交文件');
    expect(homeBlock).not.to.include('待提交文件');
    expect(homeBlock).not.to.include('去提交');
  });

  it('labels the student pending tab as 未交文件', () => {
    const student = source('packages/ui-next/src/pages/collect/index.tsx');
    expect(student).to.include("label: '未交文件'");
    expect(student).not.to.include("label: '待交文件'");
    expect(student).to.include('open = !closed && data.member');
  });
});
