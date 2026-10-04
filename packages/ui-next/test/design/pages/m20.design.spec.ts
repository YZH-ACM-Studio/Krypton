// @vitest-environment node
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap.tsx';
import {
  AdminUserbindGroupDetailPage,
  AdminUserbindRequestsPage,
  AdminUserbindStudentsImportPage,
} from '../../../src/pages/userbind/index.tsx';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/userbind/index.tsx';
const MODULE_WORKSPACE = 'src/components/management/module-workspace.tsx';
const LANE_FILES = [PAGE] as const;

const EMPTY_COPY = '没有符合当前条件的学生，请调整或清空筛选。';

const ADMIN_PAGES = [
  'AdminUserbindOverviewPage',
  'AdminUserbindSchoolsPage',
  'AdminUserbindSchoolDetailPage',
  'AdminUserbindGroupsPage',
  'AdminUserbindGroupDetailPage',
  'AdminUserbindStudentsPage',
  'AdminUserbindStudentsImportPage',
  'AdminUserbindTokensPage',
  'AdminUserbindRequestsPage',
] as const;

type StudentWidth = 'form' | 'wide' | 'either';

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function pageWidthOk(tag: string, width: StudentWidth): boolean {
  const form = tag.includes('width="form"');
  const wide = tag.includes('width="wide"');
  if (width === 'form') {
    return form;
  }
  if (width === 'wide') {
    return wide;
  }
  return form || wide;
}

function renderUserbind(templateName: string, page: ReactElement, data: Record<string, unknown>): string {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true, priv: 1 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
  };
  return renderToStaticMarkup(createElement(BootstrapProvider, { bootstrap }, page));
}

/** Count buttons that this render actually paints as primary, not source tokens that share a file. */
function primaryButtonLabels(markup: string): string[] {
  const labels: string[] = [];
  for (const match of markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attrs = match[2] ?? '';
    if (!attrs.includes('data-variant="primary"')) continue;
    const text = (match[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    labels.push(text);
  }
  return labels;
}

/** hrefs from one render, with HTML escapes decoded, so a query is one link rather than two nearby strings. */
function renderedHrefs(markup: string): string[] {
  return [...markup.matchAll(/\bhref="([^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));
}

function expectStudentPage(source: string, name: string, width: StudentWidth, title: string | null): void {
  const body = functionBody(source, name);
  const pages = findOpenTags(body, 'Page');
  const headers = findOpenTags(body, 'PageHeader');
  expect(body.length, name).toBeGreaterThan(0);
  expect(pages.length, name).toBeGreaterThan(0);
  expect(pages.every((tag) => pageWidthOk(tag.text, width)), name).toBe(true);
  expect(headers.length, name).toBeGreaterThan(0);
  if (title !== null) {
    expect(headers.some((tag) => tag.text.includes(title)), name).toBe(true);
  }
  expect(findOpenTags(body, 'h1').length, name).toBe(0);
  expect(findOpenTags(body, 'ModuleWorkspace').length, name).toBe(0);
  expect(findOpenTags(body, 'Workspace').length, name).toBe(0);
}

describe('m20 student binding administration and binding pages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('批量导入页同一屏只有一个 primary', () => {
    const markup = renderUserbind(
      'admin_userbind_students_import.html',
      createElement(AdminUserbindStudentsImportPage),
      {
        schools: [{ _id: 'school-1', name: '中国民航大学' }],
        groups: [{ _id: 'group-1', name: '计网1班', schoolId: 'school-1' }],
        report: null,
        preflightInvalid: null,
        targetKind: 'school',
      },
    );
    const primaries = primaryButtonLabels(markup);
    expect(primaries, primaries.join(' | ')).toEqual(['开始导入']);
  });

  it('用户组添加人员同一屏只有一个 primary', () => {
    const groups = [
      { _id: 'group-1', name: '计网1班', ownerUid: null, ownerName: null, teacherAttachable: false },
      { _id: 'group-2', name: '老师班', ownerUid: 12, ownerName: '张老师', teacherAttachable: false },
    ] as const;
    for (const group of groups) {
      const markup = renderUserbind(
        'admin_userbind_group_detail.html',
        createElement(AdminUserbindGroupDetailPage),
        {
          group,
          school: { _id: 'school-1', name: '中国民航大学' },
          members: [],
          memberTotal: 0,
          page: 1,
          membersLimit: 50,
          unboundMemberCount: 0,
          groupTokens: [],
          searchResults: [],
          q: '',
          importReport: null,
          tab: 'add',
        },
      );
      const primaries = primaryButtonLabels(markup);
      expect(primaries, `${group.name}: ${primaries.join(' | ')}`).toEqual(['加入用户组']);
    }
  });

  it('页面结构 userbind/index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['form', 'wide'],
      workspace: 'forbidden',
      minPageHeaders: 5,
    });
  });

  it('九个管理页保持 AdminPage', () => {
    // 既有契约要求恰好九个 ModuleWorkspace，且本文件不得出现 AdminPage；
    // ModuleWorkspace 内部渲染 AdminPage。
    expect(readSource(MODULE_WORKSPACE)).toMatch(/<AdminPage\b/);
    const src = readSource(PAGE);
    expect(findOpenTags(src, 'AdminPage').length).toBe(0);
    expect(findOpenTags(src, 'ModuleWorkspace').length).toBe(ADMIN_PAGES.length);
    for (const name of ADMIN_PAGES) {
      const body = functionBody(src, name);
      expect(body.length, name).toBeGreaterThan(0);
      expect(findOpenTags(body, 'ModuleWorkspace').length, name).toBe(1);
      expect(findOpenTags(body, 'Page').length, name).toBe(0);
      expect(findOpenTags(body, 'PageHeader').length, name).toBe(0);
    }
  });

  it('绑定表单 UserBindPage 使用 Page width="form" 与 PageHeader', () => {
    expectStudentPage(readSource(PAGE), 'UserBindPage', 'form', '绑定学生身份');
  });

  it('申请列表 UserBindApplicationsPage 使用 Page width="wide" 与 PageHeader', () => {
    expectStudentPage(readSource(PAGE), 'UserBindApplicationsPage', 'wide', '我的申请');
  });

  it('邀请落地页 UserBindLandingPage 使用 Page 与 PageHeader', () => {
    expectStudentPage(readSource(PAGE), 'UserBindLandingPage', 'either', null);
  });

  it('绑定成功页 UserBindSuccessPage 使用 Page 与 PageHeader', () => {
    expectStudentPage(readSource(PAGE), 'UserBindSuccessPage', 'either', null);
  });

  it('认领页 UserBindClaimPage 使用 Page 与 PageHeader', () => {
    expectStudentPage(readSource(PAGE), 'UserBindClaimPage', 'either', '认领临时账号');
  });

  it('局部 StudentListEmptyState 改为 EmptyState', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bStudentListEmptyState\b/);
    expect(src).not.toMatch(/function EmptyState\b/);
    expect(src).toMatch(/from ['"]@\/components\/ui\/empty-state['"]/);
    const sites = [
      ['AdminUserbindSchoolDetailPage', 'schoolStudentsClearHref'],
      ['AdminUserbindStudentsPage', 'clearHref'],
    ] as const;
    for (const [name, href] of sites) {
      const body = functionBody(src, name);
      const matched = findOpenTags(body, 'EmptyState').filter((tag) => (
        tag.text.includes(EMPTY_COPY)
        && tag.text.includes('清空筛选')
        && tag.text.includes(href)
      ));
      expect(matched.length, name).toBeGreaterThan(0);
    }
  });

  it('promptDialog 用法保持', () => {
    const body = functionBody(readSource(PAGE), 'AdminUserbindRequestsPage');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/promptDialog\(\s*['"]驳回理由（必填）：['"]\s*\)/);
    expect(body).toMatch(/reason\s*===\s*null/);
    expect(body).toMatch(/alertDialog\(\s*['"]请填写驳回理由['"]\s*\)/);
  });

  it('绑定申请超过一页时渲染第 2 页链接', () => {
    // 服务端 list 的 limit 是 30，并下发 pageSize。total>30 必须能打开第 2 页，且保留 status。
    const markup = renderUserbind(
      'admin_userbind_requests.html',
      createElement(AdminUserbindRequestsPage),
      {
        requests: [{
          _id: 'req-1',
          userId: 7,
          studentIdInput: '20230001',
          realNameInput: '张三',
          schoolId: 'school-1',
          status: 'pending',
          createdAt: '2026-10-01T00:00:00.000Z',
          claimTempUserId: null,
          rejectReason: null,
          sourceTokenId: null,
          targetUserGroupId: null,
        }],
        total: 31,
        page: 1,
        pageSize: 30,
        status: 'pending',
        schoolMap: { 'school-1': '中国民航大学' },
      },
    );
    expect(renderedHrefs(markup)).toContain('/admin/userbind/requests?status=pending&page=2');
  });
});
