// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers';

const FILES = [
  'src/pages/problems.tsx',
  'src/components/problem-bank-nav.tsx',
];

const PROBLEMS = 'src/pages/problems.tsx';

const FILTER_NAMES = [
  'q',
  'kind',
  'contest',
  'pidNamespaceId',
  'tag',
  'owner',
  'managedReview',
  'visibility',
  'lifecycle',
  'sort',
] as const;

const SELECT_NAMES = [
  'kind',
  'contest',
  'pidNamespaceId',
  'managedReview',
  'visibility',
  'lifecycle',
  'sort',
] as const;

function openTags(source: string, tag: string): string[] {
  return [...source.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function staticMainClass(source: string): string | null {
  const open = /<main\b([^>]*)>/.exec(source);
  if (open === null) {
    return null;
  }
  const className = /\bclassName="([^"]*)"/.exec(open[1] ?? '');
  return className?.[1] ?? null;
}

function requireStaticMainClass(source: string): string {
  const className = staticMainClass(source);
  expect(className).not.toBeNull();
  if (className === null) {
    return '';
  }
  return className;
}

function around(source: string, index: number, radius: number): string {
  return source.slice(Math.max(0, index - radius), index + radius);
}

function stackRoleAt(source: string, role: 'title' | 'meta'): number {
  const needles = [
    `stackRole: '${role}'`,
    `stackRole: "${role}"`,
    `stackRole="${role}"`,
    `stackRole='${role}'`,
    `stackRole={'${role}'}`,
    `stackRole={"${role}"}`,
  ];
  let found = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle);
    if (index !== -1 && (found === -1 || index < found)) {
      found = index;
    }
  }
  return found;
}

function hasStackMobile(source: string): boolean {
  return source.includes('mobile="stack"')
    || source.includes("mobile={'stack'}")
    || source.includes('mobile={"stack"}');
}

function matchBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function columnObject(source: string, key: string): string | null {
  const at = source.indexOf(`key: '${key}'`);
  const quoted = source.indexOf(`key: "${key}"`);
  const keyAt = at === -1 ? quoted : (quoted === -1 ? at : Math.min(at, quoted));
  if (keyAt < 0) return null;
  let open = keyAt - 1;
  while (open >= 0 && (source[open] === ' ' || source[open] === '\n' || source[open] === '\t')) open -= 1;
  if (source[open] !== '{') return null;
  const close = matchBrace(source, open);
  if (close < 0) return null;
  return source.slice(open, close + 1);
}

function isTagBoundary(source: string, at: number, token: string): boolean {
  const next = source[at + token.length];
  return next === undefined || next === ' ' || next === '\n' || next === '\t' || next === '>' || next === '/';
}

function findTagOpen(source: string, token: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const at = source.indexOf(token, i);
    if (at < 0) return -1;
    if (isTagBoundary(source, at, token)) return at;
    i = at + token.length;
  }
  return -1;
}

function sliceUntilClose(source: string, contentStart: number, tag: string): string {
  const openToken = `<${tag}`;
  const closeToken = `</${tag}>`;
  let depth = 1;
  let i = contentStart;
  while (i < source.length && depth > 0) {
    const nextOpen = findTagOpen(source, openToken, i);
    const nextClose = source.indexOf(closeToken, i);
    if (nextClose < 0) return source.slice(contentStart);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const gt = source.indexOf('>', nextOpen);
      if (gt < 0) return source.slice(contentStart);
      if (!source.slice(nextOpen, gt + 1).endsWith('/>')) depth += 1;
      i = gt + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return source.slice(contentStart, nextClose);
    i = nextClose + closeToken.length;
  }
  return source.slice(contentStart);
}

function staticClassName(openTag: string): string | null {
  const marker = 'className="';
  const at = openTag.indexOf(marker);
  if (at < 0) return null;
  const start = at + marker.length;
  const end = openTag.indexOf('"', start);
  if (end < 0) return null;
  return openTag.slice(start, end);
}

function flexRowBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const tag of ['div', 'span']) {
    const token = `<${tag}`;
    let from = 0;
    while (from < source.length) {
      const at = findTagOpen(source, token, from);
      if (at < 0) break;
      const gt = source.indexOf('>', at);
      if (gt < 0) break;
      const open = source.slice(at, gt + 1);
      from = gt + 1;
      if (open.endsWith('/>')) continue;
      const className = staticClassName(open);
      if (className === null) continue;
      const tokens = className.split(/\s+/);
      if (!tokens.includes('flex') || !tokens.includes('items-center')) continue;
      bodies.push(sliceUntilClose(source, gt + 1, tag));
    }
  }
  return bodies;
}

function showsHiddenPid(source: string): boolean {
  const marker = 'md:hidden';
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(marker, from);
    if (at < 0) return false;
    const gt = source.indexOf('>', at);
    if (gt < 0) return false;
    if (!source.slice(at, gt).includes('<')) {
      let i = gt + 1;
      while (source[i] === ' ' || source[i] === '\n' || source[i] === '\t') i += 1;
      const rest = source.slice(i);
      if (
        rest.startsWith('{displayPid}')
        || rest.startsWith('{pdoc.pid')
        || rest.startsWith('{row.pid')
        || rest.startsWith('{String(pdoc.pid')
        || rest.startsWith('{String(row.pid')
      ) {
        return true;
      }
    }
    from = at + marker.length;
  }
  return false;
}

function titleRowShowsPid(column: string): boolean {
  return flexRowBodies(column).some((body) => (
    showsHiddenPid(body)
    && (body.includes('{pdoc.title') || body.includes('{row.title'))
  ));
}

describe('lane S02 problem list', () => {
  it('门禁零违规', () => {
    expectGateClean(FILES);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants(FILES);
  });

  it('页面结构 problems.tsx', () => {
    expectPageStructure(PROBLEMS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('题库抽屉的 SheetContent 不得带 overflow-y-auto', () => {
    const tags = openTags(readSource(PROBLEMS), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).not.toContain('overflow-y-auto');
    }
  });

  it('problems.tsx 的 main 根有一段静态 className 并带 w-full', () => {
    const className = requireStaticMainClass(readSource(PROBLEMS));
    expect(className).toMatch(/(?:^|\s)w-full(?:\s|$)/);
  });

  it('problems.tsx 的 main 根占满内容宽度', () => {
    const className = requireStaticMainClass(readSource(PROBLEMS));
    expect(className).toMatch(/(?:^|\s)w-full(?:\s|$)/);
  });

  it('problems.tsx 的 main 根不带 mx-auto', () => {
    const className = requireStaticMainClass(readSource(PROBLEMS));
    expect(className).not.toMatch(/(?:^|\s)mx-auto(?:\s|$)/);
  });

  it('problems.tsx 的 main 根不带 max-w-', () => {
    const className = requireStaticMainClass(readSource(PROBLEMS));
    expect(className).not.toMatch(/(?:^|\s)max-w-\S+/);
  });

  it('表格改为 DataTable mobile="stack"，标题列 title、难度列 meta，卡片模式题号与标题同行', () => {
    const src = readSource(PROBLEMS);
    expect(src).toContain('<DataTable');
    expect(hasStackMobile(src)).toBe(true);
    const titleAt = stackRoleAt(src, 'title');
    const metaAt = stackRoleAt(src, 'meta');
    expect(titleAt).toBeGreaterThanOrEqual(0);
    expect(metaAt).toBeGreaterThanOrEqual(0);
    const titleColumn = columnObject(src, 'title');
    expect(titleColumn).not.toBeNull();
    expect(titleRowShowsPid(titleColumn ?? '')).toBe(true);
  });

  it('难度一律用 Difficulty', () => {
    const src = readSource(PROBLEMS);
    expect(openTags(src, 'Difficulty').some((tag) => tag.includes('level='))).toBe(true);
    const metaAt = stackRoleAt(src, 'meta');
    expect(metaAt).toBeGreaterThanOrEqual(0);
    expect(around(src, metaAt, 2000)).toContain('<Difficulty');
  });

  it('已通过标记用 CheckCircle2', () => {
    const tags = openTags(readSource(PROBLEMS), 'CheckCircle2');
    const passed = tags.filter((tag) => tag.includes('aria-label="已通过"'));
    expect(passed.length).toBeGreaterThan(0);
    for (const tag of passed) {
      expect(tag).toContain('text-success-fg');
      expect(tag).toContain('size-4');
      expect(tag).toContain('aria-label="已通过"');
    }
  });

  it('筛选表单保持 get 与字段名，控件换成 SearchInput、SimpleSelect、Button，外层用 Toolbar', () => {
    const src = readSource(PROBLEMS);
    expect(src).toContain('<Toolbar');
    expect(openTags(src, 'SearchInput').some((tag) => tag.includes('name="q"'))).toBe(true);
    expect(openTags(src, 'form').some((tag) => tag.includes('method="get"'))).toBe(true);
    expect(openTags(src, 'Input').some((tag) => tag.includes('name="owner"') && tag.includes('type="number"'))).toBe(true);
    for (const name of FILTER_NAMES) {
      expect(src).toContain(`name="${name}"`);
    }
    const selects = openTags(src, 'SimpleSelect');
    for (const name of SELECT_NAMES) {
      expect(selects.some((tag) => tag.includes(`name="${name}"`))).toBe(true);
    }
    expect(src).toContain('<Button');
  });

  it('分页用 Pagination，current、total、baseUrl 取自现有变量', () => {
    const src = readSource(PROBLEMS);
    const tags = openTags(src, 'Pagination');
    expect(tags.length).toBeGreaterThan(0);
    const pagination = tags.find((tag) => tag.includes('current={page}')
      && tag.includes('total={ppcount}')
      && tag.includes('baseUrl={problemsBaseUrl}'));
    expect(pagination).toBeDefined();
  });
});
