// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const DETAIL = 'src/pages/course/detail.tsx';
const OUTLINE = 'src/pages/course/chapter-outline.tsx';
const VIDEO = 'src/pages/course/video-player.tsx';
const MINDMAP = 'src/pages/course/mindmap.tsx';

const LANE_FILES = [DETAIL, OUTLINE, VIDEO, MINDMAP] as const;

const TITLE_TOKENS = ['truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
// Toolbar 的 end 宿主是 ml-auto flex（不换行）。这些操作若堆在 end 里，小于 sm 会横向溢出。
const TEACHER_ACTIONS = ['编辑', '观看统计', '布置收集', '复制为新课程', '报名'] as const;
const DECORATIVE = /krypton-course-(?:hero|grain|spotlight|lift|rise)\b/;
const TYPE_CLASSES = /krypton-course-(?:meta|title|section|eyebrow)\b/;

function functionBody(source: string, name: string): string {
  const pattern = new RegExp(`function ${name}\\b`);
  const match = pattern.exec(source);
  if (match === null || match.index === undefined) return '';
  const rest = source.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, match[0].length + next);
}

function returnRootTag(body: string): string {
  const match = /return\s*\(\s*(<[\s\S]*?>)/.exec(body);
  return match?.[1] ?? '';
}

function detailRoot(): string {
  return returnRootTag(functionBody(readSource(DETAIL), 'CourseDetailPage'));
}

function splitTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

function pureString(expr: string): string | null {
  const match = /^(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)$/.exec(expr.trim());
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index] ?? '';
    if (quote !== null) {
      current += ch;
      if (ch === '\\') {
        current += input[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      depth += 1;
      current += ch;
      continue;
    }
    if ((ch === ')' || ch === '}' || ch === ']') && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

function classLists(source: string): string[][] {
  const lists: string[][] = [];
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    lists.push(splitTokens(match[1] ?? ''));
  }
  for (const match of source.matchAll(/className=\{\s*'([^']*)'\s*\}/g)) {
    lists.push(splitTokens(match[1] ?? ''));
  }
  for (const match of source.matchAll(/className=\{\s*"([^"]*)"\s*\}/g)) {
    lists.push(splitTokens(match[1] ?? ''));
  }
  for (const match of source.matchAll(/\bcn\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingParen(source, open);
    if (close < 0) continue;
    const tokens: string[] = [];
    for (const arg of splitTopLevelArgs(source.slice(open + 1, close))) {
      const text = pureString(arg);
      if (text === null) continue;
      tokens.push(...splitTokens(text));
    }
    if (tokens.length > 0) lists.push(tokens);
  }
  return lists;
}

function hasToken(list: readonly string[], token: string): boolean {
  return list.some((item) => item === token || item.endsWith(`:${token}`));
}

function isOutline(list: readonly string[]): boolean {
  return list.includes('w-72') || list.includes('lg:w-72');
}

function hidesBelowLg(list: readonly string[]): boolean {
  return list.includes('hidden') || list.includes('max-lg:hidden');
}

function columnsOnlyAtLg(list: readonly string[]): boolean {
  const stacked = list.includes('grid') || list.includes('flex-col');
  const atLg = list.some((token) => token.startsWith('lg:grid-cols-') || token === 'lg:flex-row');
  const unprefixed = list.some((token) => token.startsWith('grid-cols-') || token === 'flex-row');
  return stacked && atLg && !unprefixed;
}

function scrollsBelowLg(list: readonly string[]): boolean {
  return list.includes('overflow-y-auto') || list.includes('max-lg:overflow-y-auto');
}

function stopsScrollingAtLg(list: readonly string[]): boolean {
  if (list.includes('lg:overflow-hidden') || list.includes('lg:overflow-y-hidden')) return true;
  return list.includes('max-lg:overflow-y-auto') && !list.includes('overflow-y-auto') && !list.includes('lg:overflow-y-auto');
}

function scrollsAtLg(list: readonly string[]): boolean {
  return list.includes('overflow-y-auto') || list.includes('lg:overflow-y-auto');
}

function toolbarBlock(source: string, openText: string): string {
  const at = source.indexOf(openText);
  if (at < 0) return '';
  const close = source.indexOf('</Toolbar>', at + openText.length);
  return close < 0 ? '' : source.slice(at, close);
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        index += 1;
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
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function endProp(openTag: string): string {
  const at = openTag.search(/\bend\s*=\s*\{/);
  if (at < 0) return '';
  const brace = openTag.indexOf('{', at);
  if (brace < 0) return '';
  const close = matchingBrace(openTag, brace);
  return close < 0 ? '' : openTag.slice(brace, close + 1);
}

function toolbarOwnClasses(openTag: string): string[] {
  const endAt = openTag.search(/\bend\s*=/);
  const head = endAt < 0 ? openTag : openTag.slice(0, endAt);
  const tokens: string[] = [];
  for (const list of classLists(head)) tokens.push(...list);
  return tokens;
}

function isTeacherAction(label: string, text: string): boolean {
  if (label === '报名') return /(?<!已)报名/.test(text);
  return text.includes(label);
}

function openTagBefore(source: string, needle: string, tag: string): string {
  const at = source.indexOf(needle);
  if (at < 0) return '';
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  let last = '';
  for (const match of source.slice(0, at).matchAll(pattern)) {
    last = match[0] ?? '';
  }
  return last;
}

function rootTokens(): string[] {
  const tokens: string[] = [];
  for (const list of classLists(detailRoot())) tokens.push(...list);
  return tokens;
}

describe('s18 course detail workspace', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 detail.tsx', () => {
    expectPageStructure(DETAIL, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('detail.tsx 的根有静态 className，并带 w-full min-w-0', () => {
    const root = detailRoot();
    expect(root).toMatch(/\bclassName=/);
    const tokens = rootTokens();
    expect(tokens).toContain('w-full');
    expect(tokens).toContain('min-w-0');
  });

  it('detail.tsx 的根带 w-full', () => {
    expect(rootTokens()).toContain('w-full');
  });

  it('detail.tsx 的根带 min-w-0', () => {
    expect(rootTokens()).toContain('min-w-0');
  });

  it('detail.tsx 的根不带 mx-auto', () => {
    const root = detailRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/\bmx-auto\b/);
  });

  it('detail.tsx 的根不带 max-w-', () => {
    const root = detailRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/max-w-/);
  });

  it('课程详情不带 max-w-[76rem]', () => {
    expect(readSource(DETAIL)).not.toContain('max-w-[76rem]');
  });

  it('课程详情主体带 grid min-w-0 w-full', () => {
    const found = classLists(readSource(DETAIL)).some((list) => (
      list.includes('grid') && list.includes('min-w-0') && list.includes('w-full')
    ));
    expect(found).toBe(true);
  });

  it('课程详情目录 SheetContent 不带 overflow-y-auto', () => {
    const tags = findOpenTags(readSource(DETAIL), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag.text).not.toMatch(/overflow-y-auto/);
    }
  });

  it('详情页根元素是 Workspace', () => {
    expect(detailRoot().startsWith('<Workspace')).toBe(true);
  });

  it('课程详情删除 h-[calc(100dvh-…)] 与 100vh', () => {
    const src = readSource(DETAIL);
    expect(src).not.toMatch(/100vh/);
    expect(src).not.toMatch(/100dvh/);
    expect(src).not.toMatch(/h-\[calc\(100dvh-/);
  });

  it('原来的 h1 改为 Toolbar 最左侧的标题 span', () => {
    const src = readSource(DETAIL);
    const toolbars = findOpenTags(src, 'Toolbar');
    expect(toolbars.length).toBeGreaterThan(0);
    const bar = toolbars
      .map((tag) => toolbarBlock(src, tag.text))
      .find((text) => text.includes('course.title')) ?? '';
    expect(bar.length).toBeGreaterThan(0);
    const open = findOpenTags(bar, 'Toolbar')[0];
    expect(open).toBeDefined();
    const children = bar.slice(open?.text.length ?? 0).trimStart();
    expect(children.startsWith('<span')).toBe(true);
    const title = findOpenTags(children, 'span')[0];
    expect(title).toBeDefined();
    const tokens = classLists(title?.text ?? '').flat();
    for (const token of TITLE_TOKENS) {
      expect(tokens).toContain(token);
    }
    const spanClose = children.indexOf('</span>');
    expect(spanClose).toBeGreaterThan(0);
    expect(children.slice(0, spanClose)).toContain('course.title');
  });

  it('小于 sm 时教师操作随工具条换行，不堆进不换行的 end', () => {
    const src = readSource(DETAIL);
    const open = findOpenTags(src, 'Toolbar').find((tag) => toolbarBlock(src, tag.text).includes('course.title'));
    expect(open).toBeDefined();
    const tag = open?.text ?? '';
    const end = endProp(tag);
    const children = toolbarBlock(src, tag).slice(tag.length);
    expect(toolbarOwnClasses(tag).includes('flex-nowrap')).toBe(false);
    for (const label of TEACHER_ACTIONS) {
      expect(isTeacherAction(label, end)).toBe(false);
      expect(isTeacherAction(label, children)).toBe(true);
    }
  });

  it('小屏章节大纲与内容纵向排列，工作区主体统一滚动', () => {
    const lists = classLists(readSource(DETAIL));
    expect(lists.some(columnsOnlyAtLg)).toBe(true);
    const outline = lists.find(isOutline);
    expect(outline).toBeDefined();
    expect(hidesBelowLg(outline ?? [])).toBe(false);
    const unified = lists.some((list) => scrollsBelowLg(list) && stopsScrollingAtLg(list));
    expect(unified).toBe(true);
  });

  it('大屏左侧大纲 w-72 独立滚动，右侧内容独立滚动', () => {
    const lists = classLists(readSource(DETAIL));
    const outline = lists.find(isOutline);
    expect(outline).toBeDefined();
    const left = outline ?? [];
    expect(hasToken(left, 'min-h-0')).toBe(true);
    expect(scrollsAtLg(left)).toBe(true);
    const right = lists.some((list) => (
      !isOutline(list) && hasToken(list, 'min-h-0') && hasToken(list, 'overflow-y-auto')
    ));
    expect(right).toBe(true);
  });

  it('删除 krypton-course 装饰类，面板改用 Panel', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file)).not.toMatch(DECORATIVE);
    }
    expect(readSource(VIDEO)).not.toMatch(/krypton-course-panel\b/);
    expect(readSource(MINDMAP)).not.toMatch(/krypton-course-panel\b/);
    expect(readSource(VIDEO)).toMatch(/<Panel\b/);
    expect(readSource(MINDMAP)).toMatch(/<Panel\b/);
  });

  it('krypton-course 字号类改为阶梯字号', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file)).not.toMatch(TYPE_CLASSES);
    }
    const mindmap = readSource(MINDMAP);
    const outline = readSource(OUTLINE);
    const video = readSource(VIDEO);
    expect(openTagBefore(mindmap, '课程知识节点', 'p')).toMatch(/\btext-2xs\b/);
    expect(openTagBefore(mindmap, '课程知识节点', 'p')).toMatch(/\bfont-semibold\b/);
    const topic = openTagBefore(mindmap, '{selected.topic}', 'h2');
    expect(topic).toMatch(/\btext-xl\b/);
    expect(topic).toMatch(/\bfont-semibold\b/);
    expect(openTagBefore(mindmap, '选择一个节点', 'p')).toMatch(/\btext-xs\b/);
    expect(openTagBefore(video, '已看完', 'p')).toMatch(/\btext-xs\b/);
    expect(openTagBefore(outline, '{done}/{total}', 'span')).toMatch(/\btext-xs\b/);
    expect(openTagBefore(outline, '{sectionDone}/{sectionTotal}', 'span')).toMatch(/\btext-xs\b/);
  });
});
