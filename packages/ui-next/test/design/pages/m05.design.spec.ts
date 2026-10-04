// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers';

const LANE_FILES = [
  'src/pages/system-manage.tsx',
  'src/pages/domain-manage.tsx',
  'src/pages/domain-misc.tsx',
] as const;

const SYSTEM = 'src/pages/system-manage.tsx';
const DOMAIN = 'src/pages/domain-manage.tsx';
const MISC = 'src/pages/domain-misc.tsx';

const SYSTEM_TITLES = ['系统设置', '系统配置', '运行脚本', '导入用户', '用户权限'] as const;
const DOMAIN_TITLES = ['编辑域', '域用户', '用户组'] as const;

const FORM_PAGES = [
  {
    start: 'export function DomainCreatePage(',
    end: 'export function DomainJoinPage(',
    title: '创建域',
  },
  {
    start: 'export function DomainJoinPage(',
    end: 'export function DomainJoinApplicationsPage(',
    title: '加入域',
  },
  {
    start: 'export function ContestModePage(',
    end: null,
    title: '比赛模式',
  },
] as const;

function section(source: string, startLabel: string, endLabel: string | null): string {
  const start = source.indexOf(startLabel);
  if (start < 0) {
    return '';
  }
  if (endLabel === null) {
    return source.slice(start);
  }
  const end = source.indexOf(endLabel, start + startLabel.length);
  if (end < 0) {
    return '';
  }
  return source.slice(start, end);
}

function hasQuotedAttr(tag: string, name: string, value: string): boolean {
  return tag.includes(`${name}="${value}"`)
    || tag.includes(`${name}={'${value}'}`)
    || tag.includes(`${name}={"${value}"}`);
}

function adminPagesCarryTitles(source: string, titles: readonly string[]): boolean {
  const tags = findOpenTags(source, 'AdminPage');
  return titles.every((title) => tags.some((tag) => tag.text.includes(title)));
}

/** YAML/文本配置编辑器：等宽 Textarea，或已有的 MarkdownEditor，不能留下原生 textarea。 */
function usesMonospaceTextareaOrExistingEditor(region: string): boolean {
  if (findOpenTags(region, 'textarea').length > 0) {
    return false;
  }
  const textareas = findOpenTags(region, 'Textarea');
  const monospace = textareas.filter((tag) => tag.text.includes('font-mono'));
  if (textareas.length > 0 && monospace.length === textareas.length) {
    return true;
  }
  return findOpenTags(region, 'MarkdownEditor').length > 0 && textareas.length === 0;
}

describe('m05 system and domain management', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 system-manage.tsx', () => {
    expectPageStructure(SYSTEM, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 domain-manage.tsx', () => {
    expectPageStructure(DOMAIN, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 domain-misc.tsx', () => {
    expectPageStructure(MISC, {
      widths: ['form', 'wide'],
      workspace: 'forbidden',
      minPageHeaders: 3,
    });
  });

  it('系统管理用 AdminPage 的 props 取代 ManageShell', () => {
    const src = readSource(SYSTEM);
    const pages = findOpenTags(src, 'AdminPage');
    expect(src).not.toMatch(/function ManageShell\b/);
    expect(findOpenTags(src, 'ManageShell').length).toBe(0);
    expect(pages.length).toBeGreaterThanOrEqual(SYSTEM_TITLES.length);
    expect(pages.every((tag) => tag.text.includes('bypassPrivGate'))).toBe(true);
    expect(adminPagesCarryTitles(src, SYSTEM_TITLES)).toBe(true);
  });

  it('系统设置布尔开关只提交 setting.key，不新增 booleanKeys 隐藏域', () => {
    const src = readSource(SYSTEM);
    const page = section(src, 'export function ManageSettingPage(', 'export function ManageConfigPage(');
    expect(page.length).toBeGreaterThan(0);
    const postForm = findOpenTags(page, 'form').find((tag) => /method=(?:"post"|'post'|\{["']post["']\})/.test(tag.text));
    expect(postForm).toBeDefined();
    const formAt = postForm ? page.indexOf(postForm.text) : -1;
    expect(formAt).toBeGreaterThanOrEqual(0);
    expect(page.slice(formAt)).toMatch(/<SettingField\b/);

    const field = section(src, 'function SettingField(', 'function rangeOptions(');
    const booleanBranch = section(
      field,
      "setting.type === 'boolean' || setting.type === 'checkbox'",
      "setting.type === 'select'",
    );
    expect(booleanBranch.length).toBeGreaterThan(0);
    expect(findOpenTags(booleanBranch, 'Switch').some((tag) => tag.text.includes('name={setting.key}'))).toBe(true);
    // D20：基线布尔分支没有 booleanKeys。隐藏域会改未勾选时的落库，验收没有要求新增。
    expect(booleanBranch.includes('booleanKeys')).toBe(false);
  });

  it('域管理用 AdminPage 的 props 取代 DomainAdminShell', () => {
    const src = readSource(DOMAIN);
    const pages = findOpenTags(src, 'AdminPage');
    expect(src).not.toMatch(/function DomainAdminShell\b/);
    expect(findOpenTags(src, 'DomainAdminShell').length).toBe(0);
    expect(pages.length).toBeGreaterThanOrEqual(DOMAIN_TITLES.length);
    expect(pages.every((tag) => tag.text.includes('bypassPrivGate'))).toBe(true);
    expect(adminPagesCarryTitles(src, DOMAIN_TITLES)).toBe(true);
  });

  it('系统配置的 YAML 与文本编辑使用等宽 Textarea 或现有编辑器', () => {
    const src = readSource(SYSTEM);
    const regions = [
      section(src, 'function SchemaField(', 'function SchemaSection('),
      section(src, 'export function ManageConfigPage(', 'export function ManageScriptPage('),
    ];
    expect(regions.every((region) => region.length > 0)).toBe(true);
    expect(regions.every((region) => usesMonospaceTextareaOrExistingEditor(region))).toBe(true);
  });

  it('创建域、加入域和比赛模式使用 form 页与 PageHeader', () => {
    const src = readSource(MISC);
    for (const page of FORM_PAGES) {
      const body = section(src, page.start, page.end);
      expect(body.length).toBeGreaterThan(0);
      const pages = findOpenTags(body, 'Page');
      expect(pages.some((tag) => hasQuotedAttr(tag.text, 'width', 'form'))).toBe(true);
      const headers = findOpenTags(body, 'PageHeader');
      expect(headers.some((tag) => hasQuotedAttr(tag.text, 'title', page.title))).toBe(true);
    }
  });

  it('入域申请保持 AdminPage', () => {
    const body = section(
      readSource(MISC),
      'export function DomainJoinApplicationsPage(',
      'export function ContestModePage(',
    );
    const pages = findOpenTags(body, 'AdminPage');
    expect(body.length).toBeGreaterThan(0);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((tag) => tag.text.includes('bypassPrivGate'))).toBe(true);
    expect(pages.some((tag) => tag.text.includes('入域申请'))).toBe(true);
    expect(findOpenTags(body, 'Page').length).toBe(0);
    expect(findOpenTags(body, 'PageHeader').length).toBe(0);
  });
});
