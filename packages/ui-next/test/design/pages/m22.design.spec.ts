// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const EDITOR = 'src/pages/course/editor.tsx';
const ASSIGN = 'src/pages/course/assign.tsx';
const VIDEO_EDITOR = 'src/pages/course/video-editor.tsx';
const VIDEO_STATS = 'src/pages/course/video-stats.tsx';
const MINDMAP = 'src/pages/course/mindmap-editor.tsx';
const EXAM_SETTINGS = 'src/pages/course/course-exam-settings.tsx';

const LANE_FILES = [EDITOR, ASSIGN, VIDEO_EDITOR, VIDEO_STATS, MINDMAP, EXAM_SETTINGS] as const;

const TITLE_TOKENS = ['truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
const TAB_VALUES = ['video', 'notes', 'problems', 'links'] as const;

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

function editorRoot(): string {
  return returnRootTag(functionBody(readSource(EDITOR), 'CourseEditPage'));
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

function rootTokens(): string[] {
  const tokens: string[] = [];
  for (const list of classLists(editorRoot())) tokens.push(...list);
  return tokens;
}

function toolbarBlock(source: string, openText: string): string {
  const at = source.indexOf(openText);
  if (at < 0) return '';
  const close = source.indexOf('</Toolbar>', at + openText.length);
  return close < 0 ? '' : source.slice(at, close);
}

function hasValueBranch(source: string, name: string): boolean {
  return new RegExp(`===\\s*['"]${name}['"]\\s*\\?[\\s\\S]*?:\\s*null`).test(source);
}

function hasEditArea(source: string): boolean {
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    const tokens = splitTokens(match[1] ?? '');
    if (!tokens.includes('min-w-0') || !tokens.includes('space-y-5')) continue;
    const rest = source.slice(match.index ?? 0);
    const intro = rest.indexOf('课程简介');
    const chapters = rest.indexOf('章节内容');
    if (intro >= 0 && chapters > intro) return true;
  }
  return false;
}

describe('m22 course editor', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 editor.tsx', () => {
    expectPageStructure(EDITOR, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('页面结构 video-stats.tsx', () => {
    expectPageStructure(VIDEO_STATS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 mindmap-editor.tsx', () => {
    expectPageStructure(MINDMAP, {
      widths: ['wide', 'full'],
      workspace: 'allowed',
      minPageHeaders: 1,
    });
  });

  it('editor.tsx 的根有静态 className，并带 w-full min-w-0', () => {
    const root = editorRoot();
    expect(root).toMatch(/\bclassName="/);
    expect(rootTokens()).toContain('w-full');
    expect(rootTokens()).toContain('min-w-0');
  });

  it('editor.tsx 的根带 w-full', () => {
    expect(rootTokens()).toContain('w-full');
  });

  it('editor.tsx 的根带 min-w-0', () => {
    expect(rootTokens()).toContain('min-w-0');
  });

  it('editor.tsx 的根不带 mx-auto', () => {
    const root = editorRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/\bmx-auto\b/);
  });

  it('editor.tsx 的根不带 max-w-', () => {
    const root = editorRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/max-w-/);
  });

  it('课程编辑器简介不带 col-span-full', () => {
    expect(readSource(EDITOR)).not.toContain('col-span-full');
  });

  it('课程编辑区带 min-w-0 space-y-5', () => {
    expect(hasEditArea(readSource(EDITOR))).toBe(true);
  });

  it('课程观看名单不带 min-w-[48rem]', () => {
    expect(readSource(VIDEO_STATS)).not.toContain('min-w-[48rem]');
  });

  it('课程编辑器目录 SheetContent 不带 overflow-y-auto', () => {
    const tags = findOpenTags(readSource(EDITOR), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag.text).not.toMatch(/overflow-y-auto/);
    }
  });

  it('课程编辑器根元素是 Workspace', () => {
    expect(editorRoot().startsWith('<Workspace')).toBe(true);
  });

  it('课程编辑器删除满高写法', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/100dvh/);
    expect(src).not.toMatch(/100vh/);
  });

  it('原来的 h1 改为 Toolbar 最左侧的标题 span', () => {
    const src = readSource(EDITOR);
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

  it('章节页签改为受控 PageTabs，内容按 value 条件渲染', () => {
    const src = readSource(EDITOR);
    expect(src).toMatch(/import\s*\{[^}]*\bPageTabs\b[^}]*\}\s*from\s*['"]@\/components\/ui\/page-tabs['"]/);
    expect(src).not.toMatch(/tabs-compound/);
    expect(src).not.toMatch(/<TabsContent(?=[\s>/])/);
    expect(src).not.toMatch(/<TabsList(?=[\s>/])/);
    expect(src).not.toMatch(/<TabsTrigger(?=[\s>/])/);
    expect(src).not.toMatch(/<Tabs(?=[\s>/])/);
    const tabs = findOpenTags(src, 'PageTabs');
    expect(tabs.length).toBeGreaterThan(0);
    for (const tag of tabs) {
      expect(tag.text).toMatch(/\bvalue=/);
      expect(tag.text).toMatch(/\bonValueChange=/);
      expect(tag.text).toMatch(/\bitems=/);
      expect(tag.text).not.toMatch(/\bdefaultValue=/);
    }
    for (const name of TAB_VALUES) {
      expect(hasValueBranch(src, name), name).toBe(true);
    }
  });

  it('删除 krypton-course 装饰类引用', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file), file).not.toMatch(/krypton-course-/);
    }
  });
});
