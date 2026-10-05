// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const OBJECTIVE = 'src/pages/basic-objective-editors.tsx';
const CODE = 'src/pages/structured-code-editors.tsx';
const SUBJECTIVE = 'src/pages/subjective-editor.tsx';
const AUTHOR = 'src/components/structured-region-author-editor.tsx';
const INPUTS = 'src/components/structured-region-inputs.tsx';
const WORKSPACE = 'src/components/problem-editor-workspace.tsx';

const LANE_FILES = [OBJECTIVE, CODE, SUBJECTIVE, AUTHOR, INPUTS, WORKSPACE] as const;

const LINE_CLASSES = [
  'krypton-structured-line-invalid',
  'krypton-structured-line-public',
  'krypton-structured-line-answer',
] as const;

const INLINE_BLANK = ['h-9', 'min-h-9', 'min-w-0', 'w-full', 'font-mono'] as const;
const TITLE_TOKENS = ['min-w-0', 'truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
const ACTION_TESTID = 'data-testid="structured-author-stage-actions"';
const SAFE_PADDING = 'pb-[max(0.5rem,env(safe-area-inset-bottom))]';
const NAV_COLUMNS = 'lg:grid-cols-[15rem_minmax(0,1fr)]';

// legacy-intents-T02 的两处视口高度（阶段面板 min-h-[min(32rem,calc(100dvh-12rem))]、
// 选择器 h-[min(32rem,calc(100dvh-12rem))]）与本 lane「删除满高写法」、结构规则里的
// 100dvh，以及 DS004 的 [calc( 冲突。新规范不保留，下面改为断言删除。

const ROOTS = [
  { file: CODE, name: 'StructuredCodeEditor', label: 'structured-code-editors.tsx 的 main 根' },
  { file: WORKSPACE, name: 'ProblemEditorWorkspace', label: 'problem-editor-workspace.tsx 的 section 根' },
] as const;

function functionBody(source: string, name: string): string {
  const pattern = new RegExp(`function ${name}\\b`);
  const match = pattern.exec(source);
  if (match === null || match.index === undefined) {
    return '';
  }
  const rest = source.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, match[0].length + next);
}

function returnRootTag(body: string): string {
  const match = /return\s*\(\s*(<[\s\S]*?>)/.exec(body);
  return match?.[1] ?? '';
}

function staticClass(tag: string): string {
  return /\bclassName="([^"]*)"/.exec(tag)?.[1] ?? '';
}

function tokens(className: string): string[] {
  return className.split(/\s+/).filter((token) => token.length > 0);
}

function rootTag(file: string, name: string): string {
  const tag = returnRootTag(functionBody(readSource(file), name));
  expect(tag.length, name).toBeGreaterThan(0);
  return tag;
}

function rootClass(file: string, name: string): string {
  const className = staticClass(rootTag(file, name));
  expect(className.length, `${name} static className`).toBeGreaterThan(0);
  return className;
}

/** Page 的根 class 在 page.tsx 里由 cn(固定串, CONTENT_WIDTH[width], className) 决定。 */
function renderedRootClass(file: string, name: string): string {
  const tag = rootTag(file, name);
  const own = staticClass(tag);
  const tagName = /^<([A-Za-z]\w*)/.exec(tag)?.[1] ?? '';
  if (tagName !== 'Page') {
    expect(own.length, name).toBeGreaterThan(0);
    return own;
  }
  const pageSource = readSource('src/components/ui/page.tsx');
  const base = /className=\{cn\(\s*'([^']*)'/.exec(functionBody(pageSource, 'Page'))?.[1] ?? '';
  expect(base.length, 'Page cn base').toBeGreaterThan(0);
  const width = /\bwidth="(prose|form|wide|full)"/.exec(tag)?.[1] ?? 'wide';
  const widthBlock = /export const CONTENT_WIDTH = \{([\s\S]*?)\} as const/.exec(pageSource)?.[1] ?? '';
  const widthClass = new RegExp(`\\b${width}\\s*:\\s*'([^']*)'`).exec(widthBlock)?.[1] ?? '';
  expect(widthClass.length, width).toBeGreaterThan(0);
  return cn(base, widthClass, own);
}

function classStrings(source: string): string[] {
  return [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1] ?? '');
}

function hasTokens(source: string, names: readonly string[]): boolean {
  return classStrings(source).some((value) => {
    const parts = tokens(value);
    return names.every((name) => parts.includes(name));
  });
}

function actionBarClass(source: string): string {
  const at = source.indexOf(ACTION_TESTID);
  expect(at, ACTION_TESTID).toBeGreaterThanOrEqual(0);
  const open = source.lastIndexOf('<', at);
  const close = source.indexOf('>', at);
  expect(open).toBeGreaterThanOrEqual(0);
  expect(close).toBeGreaterThan(at);
  return staticClass(source.slice(open, close + 1));
}

function toolbarInner(source: string): string {
  const body = functionBody(source, 'StructuredCodeEditor');
  const open = findOpenTags(body, 'Toolbar')[0];
  if (open === undefined) {
    return '';
  }
  const at = body.indexOf(open.text);
  if (at < 0) {
    return '';
  }
  const close = body.indexOf('</Toolbar>', at + open.text.length);
  if (close < 0) {
    return '';
  }
  return body.slice(at + open.text.length, close).trimStart();
}

describe('m14 objective and structured problem editors', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 basic-objective-editors.tsx', () => {
    expectPageStructure(OBJECTIVE, {
      widths: ['full'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 structured-code-editors.tsx', () => {
    expectPageStructure(CODE, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('页面结构 subjective-editor.tsx', () => {
    expectPageStructure(SUBJECTIVE, {
      widths: ['full'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('客观题编辑器返回根是 Page，且不再有外层 main', () => {
    const source = readSource(OBJECTIVE);
    expect(returnRootTag(functionBody(source, 'ObjectiveEditorShell')).startsWith('<Page')).toBe(true);
    expect(source).not.toContain('<main');
  });

  it('主观题编辑器返回根是 Page，且不再有外层 main', () => {
    const source = readSource(SUBJECTIVE);
    expect(returnRootTag(functionBody(source, 'SubjectiveProblemEditorPage')).startsWith('<Page')).toBe(true);
    expect(source).not.toContain('<main');
  });

  for (const root of ROOTS) {
    it(`${root.label}有一段静态 className 并带 w-full`, () => {
      expect(tokens(rootClass(root.file, root.name))).toContain('w-full');
    });

    it(`${root.label}占满内容宽度`, () => {
      expect(tokens(rootClass(root.file, root.name))).toContain('w-full');
    });

    it(`${root.label}不带 mx-auto`, () => {
      expect(renderedRootClass(root.file, root.name)).not.toMatch(/(?:^|\s)mx-auto(?:\s|$)/);
    });

    it(`${root.label}不带 max-w-`, () => {
      expect(renderedRootClass(root.file, root.name)).not.toMatch(/(?:^|\s)max-w-\S+/);
    });
  }

  it('problem-editor-workspace.tsx 的 section 根保持 section', () => {
    const tag = returnRootTag(functionBody(readSource(WORKSPACE), 'ProblemEditorWorkspace'));
    expect(tag.startsWith('<section')).toBe(true);
  });

  it('structured-code-editors 的根元素是 Workspace', () => {
    const tag = returnRootTag(functionBody(readSource(CODE), 'StructuredCodeEditor'));
    expect(tag.startsWith('<Workspace')).toBe(true);
  });

  it('structured-code-editors 删除满高写法', () => {
    const src = readSource(CODE);
    expect(src).not.toMatch(/100dvh|100vh/);
    expect(src).not.toMatch(/\[calc\(/);
  });

  it('工作区标题在 Toolbar 最左侧', () => {
    const inner = toolbarInner(readSource(CODE));
    expect(inner.startsWith('<span')).toBe(true);
    const span = findOpenTags(inner, 'span')[0];
    expect(span).toBeDefined();
    const className = staticClass(span?.text ?? '');
    for (const token of TITLE_TOKENS) {
      expect(tokens(className)).toContain(token);
    }
    const close = inner.indexOf('</span>');
    expect(close).toBeGreaterThan(0);
    expect(inner.slice(0, close)).toContain('pdoc.title');
  });

  it('阶段面板不得带 min-h-[32rem]', () => {
    expect(readSource(CODE)).not.toContain('min-h-[32rem]');
  });

  it('操作条在滚动区之外、是 Workspace 列的最后一个子元素', () => {
    const body = functionBody(readSource(CODE), 'StructuredCodeEditor');
    const open = body.indexOf('<Workspace');
    const close = body.lastIndexOf('</Workspace>');
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    const column = body.slice(open, close);
    const action = column.lastIndexOf(ACTION_TESTID);
    const scroll = column.indexOf('overflow-y-auto');
    expect(action).toBeGreaterThanOrEqual(0);
    expect(scroll).toBeGreaterThanOrEqual(0);
    expect(scroll).toBeLessThan(action);
    const footerClose = column.indexOf('</footer>', action);
    expect(footerClose).toBeGreaterThan(action);
    expect(column.slice(footerClose + '</footer>'.length).trim()).toBe('');
  });

  it('底部操作条为安全区留出 pb-safe', () => {
    expect(tokens(actionBarClass(readSource(CODE)))).toContain('pb-safe');
  });

  it('底部操作条内边距吃掉系统安全区', () => {
    expect(tokens(actionBarClass(readSource(CODE)))).toContain(SAFE_PADDING);
  });

  it('作者端选择器不再使用视口高度', () => {
    const src = readSource(AUTHOR);
    expect(src).not.toMatch(/100dvh|100vh/);
    expect(src).not.toContain('h-[min(32rem,calc(100dvh-12rem))]');
    const at = src.indexOf('ref={hostRef}');
    expect(at).toBeGreaterThanOrEqual(0);
    const start = src.lastIndexOf('<', at);
    const end = src.indexOf('>', at);
    const className = staticClass(src.slice(start, end + 1));
    expect(tokens(className)).toContain('flex-1');
    expect(tokens(className)).toContain('min-h-80');
  });

  it('作者端选择器不得带 min-h-[32rem]', () => {
    expect(readSource(AUTHOR)).not.toContain('min-h-[32rem]');
  });

  it('保留 krypton-structured-line 装饰类名', () => {
    const src = readSource(AUTHOR);
    for (const name of LINE_CLASSES) {
      expect(src).toContain(name);
    }
  });

  it('连续代码行可以横向滚动', () => {
    const pres = [...readSource(INPUTS).matchAll(/<pre\b([^>]*)>/g)].map((match) => match[1] ?? '');
    expect(pres.length).toBeGreaterThan(0);
    expect(pres.some((attrs) => tokens(staticClass(attrs)).includes('overflow-x-auto'))).toBe(true);
  });

  it('行内填空是可收缩的等宽单行输入', () => {
    expect(hasTokens(readSource(INPUTS), INLINE_BLANK)).toBe(true);
  });

  it('行内代码保持预格式空白并横向滚动', () => {
    expect(hasTokens(readSource(INPUTS), ['overflow-x-auto', 'whitespace-pre'])).toBe(true);
  });

  it('行内填空不得带 min-w-[18rem]', () => {
    expect(readSource(INPUTS)).not.toContain('min-w-[18rem]');
  });

  it('编程题工作区在 lg 起使用 15rem 导航轨', () => {
    expect(hasTokens(readSource(WORKSPACE), [NAV_COLUMNS])).toBe(true);
  });

  it('窄屏导航从 lg 起隐藏', () => {
    const navs = findOpenTags(readSource(WORKSPACE), 'nav');
    expect(navs.length).toBeGreaterThan(0);
    expect(navs.some((tag) => tokens(staticClass(tag.text)).includes('lg:hidden'))).toBe(true);
  });

  it('工作区导航不得再用 sticky top-12', () => {
    expect(readSource(WORKSPACE)).not.toContain('sticky top-12');
  });

  it('工作区不得使用 backdrop-blur', () => {
    expect(readSource(WORKSPACE)).not.toContain('backdrop-blur');
  });

  it('工作区不得裁剪横向溢出', () => {
    expect(readSource(WORKSPACE)).not.toContain('overflow-x-clip');
  });

  it('导航贴在 top-2', () => {
    expect(hasTokens(readSource(WORKSPACE), ['sticky', 'top-2'])).toBe(true);
  });

  it('problem-editor-workspace 的 h1 改为 h2', () => {
    const src = readSource(WORKSPACE);
    expect(src).not.toMatch(/<h1(?=[\s>])/);
    const headings = findOpenTags(src, 'h2');
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.some((tag) => staticClass(tag.text) === 'text-lg font-semibold')).toBe(true);
  });
});
