// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { KryptonBootstrap } from '../../../src/lib/bootstrap.tsx';
import { expectGateClean, readSource } from '../helpers.ts';

const OBJECTIVE = 'src/pages/basic-objective-editors.tsx';
const SUBJECTIVE = 'src/pages/subjective-editor.tsx';
const CODE = 'src/pages/structured-code-editors.tsx';
const AUTHOR = 'src/components/structured-region-author-editor.tsx';
const ACTION_TESTID = 'data-testid="structured-author-stage-actions"';
const HOST_REF = 'ref={hostRef}';
const LANE_FILES = [OBJECTIVE, SUBJECTIVE, CODE, AUTHOR] as const;

interface JsxFrame {
  name: string;
  openTag: string;
}

interface ActionBarHit {
  openTag: string;
  ancestors: string[];
}

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

function exportedFunctions(source: string): string[] {
  return [...source.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((match) => match[1] ?? '');
}

function returnedTagName(body: string): string {
  const match = /return\s*(?:\(\s*)?<([A-Za-z][\w.]*)/.exec(body);
  return match?.[1] ?? '';
}

function pageRootTag(source: string, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) {
    return '';
  }
  seen.add(name);
  const tag = returnedTagName(functionBody(source, name));
  if (tag.length === 0) {
    return '';
  }
  if (/^[A-Z]/.test(tag) && new RegExp(`(?:^|\\n)(?:export )?function ${tag}\\b`).test(source)) {
    return pageRootTag(source, tag, seen);
  }
  return tag;
}

function isIdentChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function sliceBraces(text: string, openIndex: number): string {
  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (quote !== '') {
      if ((quote === '`' || depth > 1) && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return '';
}

function attributeExpression(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(tag);
  if (match === null || match.index === undefined) {
    return '';
  }
  const start = match.index + match[0].length;
  const opener = tag[start] ?? '';
  if (opener === '"' || opener === "'") {
    const end = tag.indexOf(opener, start + 1);
    return end < 0 ? '' : tag.slice(start + 1, end);
  }
  if (opener === '{') return sliceBraces(tag, start);
  return '';
}

function classTokens(tag: string): string[] {
  const raw = attributeExpression(tag, 'className');
  const literals = /['"`]/.test(raw) ? [...raw.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '') : [raw];
  return literals.join(' ').split(/\s+/).filter((token) => token.length > 0);
}

function readOpenTag(source: string, start: number): { end: number; selfClosing: boolean } | null {
  let depth = 0;
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote !== '') {
      if ((quote === '`' || depth > 0) && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === '>' && depth === 0) {
      let look = index - 1;
      while (look > start && /\s/.test(source[look] ?? '')) look -= 1;
      return { end: index, selfClosing: source[look] === '/' };
    }
  }
  return null;
}

// 操作条是否落在 overflow-y-auto 祖先里，按 JSX 开闭标签切片，不看字符串里的同名文本。
function actionBars(source: string): ActionBarHit[] {
  const body = functionBody(source, 'StructuredCodeEditor');
  const origin = body.indexOf('<Workspace');
  expect(origin, 'StructuredCodeEditor <Workspace').toBeGreaterThanOrEqual(0);
  const hits: ActionBarHit[] = [];
  const stack: JsxFrame[] = [];
  let quote = '';
  let index = origin;
  while (index < body.length) {
    const char = body[index] ?? '';
    if (quote !== '') {
      if (quote === '`' && char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '/' && body[index + 1] === '/') {
      const newline = body.indexOf('\n', index);
      index = newline < 0 ? body.length : newline + 1;
      continue;
    }
    if (char === '/' && body[index + 1] === '*') {
      const end = body.indexOf('*/', index + 2);
      index = end < 0 ? body.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '<' && !isIdentChar(body[index - 1])) {
      const rest = body.slice(index);
      const close = /^<\/([A-Za-z][\w.]*)\s*>|^<\/>/.exec(rest);
      if (close !== null) {
        const name = close[1] ?? '';
        const top = stack[stack.length - 1];
        expect(top?.name ?? '', `JSX 闭合 ${close[0]}`).toBe(name);
        stack.pop();
        index += close[0].length;
        if (stack.length === 0) break;
        continue;
      }
      const opened = /^<([A-Za-z][\w.]*)|^<>/.exec(rest);
      if (opened !== null) {
        const read = readOpenTag(body, index);
        expect(read, 'JSX 开标签未结束').not.toBeNull();
        if (read === null) return hits;
        const openTag = body.slice(index, read.end + 1);
        if (openTag.includes(ACTION_TESTID)) {
          hits.push({ openTag, ancestors: stack.map((frame) => frame.openTag) });
        }
        if (!read.selfClosing) stack.push({ name: opened[1] ?? '', openTag });
        index = read.end + 1;
        continue;
      }
    }
    index += 1;
  }
  return hits;
}

function hostOpenTag(source: string): string {
  const at = source.indexOf(HOST_REF);
  expect(at, HOST_REF).toBeGreaterThanOrEqual(0);
  const start = source.lastIndexOf('<', at);
  expect(start).toBeGreaterThanOrEqual(0);
  const read = readOpenTag(source, start);
  expect(read, '编辑器宿主开标签').not.toBeNull();
  if (read === null) return '';
  return source.slice(start, read.end + 1);
}

const HEIGHT_CHAIN = ['flex', 'min-h-0', 'flex-1', 'flex-col'] as const;
const SCROLL_TOKENS = ['overflow-y-auto', 'overflow-auto', 'overflow-y-scroll'] as const;
const CLIP_TOKENS = ['overflow-hidden', 'overflow-y-hidden'] as const;
const MARKER_BUTTONS = ['公开给学生', '设为作答区', '设为私有'] as const;

function renderedClassTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectHeightChain(element: Element, label: string): void {
  const tokens = renderedClassTokens(element);
  for (const token of HEIGHT_CHAIN) {
    expect(tokens, label).toContain(token);
  }
}

// 800px 阶段里，overflow-hidden 会先于滚动祖先裁掉标记按钮。命中滚动类则按钮仍可滚动。
function clippingClass(element: HTMLElement): string {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const tokens = renderedClassTokens(node);
    if (SCROLL_TOKENS.some((token) => tokens.includes(token))) return '';
    if (CLIP_TOKENS.some((token) => tokens.includes(token))) return node.getAttribute('class') ?? '';
    node = node.parentElement;
  }
  return '';
}

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

async function installDom(): Promise<void> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window;
  defineGlobal('window', win);
  defineGlobal('document', win.document);
  defineGlobal('Window', win.Window);
  defineGlobal('HTMLElement', win.HTMLElement);
  defineGlobal('Element', win.Element);
  defineGlobal('Node', win.Node);
  defineGlobal('DocumentFragment', win.DocumentFragment);
  defineGlobal('SVGElement', win.SVGElement);
  defineGlobal('Range', win.Range);
  defineGlobal('MutationObserver', win.MutationObserver);
  defineGlobal('NodeFilter', win.NodeFilter);
  defineGlobal('FormData', win.FormData);
  defineGlobal('getComputedStyle', win.getComputedStyle.bind(win));
  defineGlobal('requestAnimationFrame', win.requestAnimationFrame.bind(win));
  defineGlobal('cancelAnimationFrame', win.cancelAnimationFrame.bind(win));
  defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  win.HTMLElement.prototype.scrollTo = () => {};
  if (!win.matchMedia) {
    win.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof win.matchMedia;
  }
  if (!win.ResizeObserver) {
    win.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof win.ResizeObserver;
  }
  defineGlobal('ResizeObserver', win.ResizeObserver);
  if (!win.IntersectionObserver) {
    win.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as typeof win.IntersectionObserver;
  }
  defineGlobal('IntersectionObserver', win.IntersectionObserver);
  if (!win.Range.prototype.getClientRects) {
    win.Range.prototype.getClientRects = function getClientRects() {
      return {
        length: 0,
        item: () => null,
        [Symbol.iterator]: () => [][Symbol.iterator](),
      } as DOMRectList;
    };
  }
  if (!win.Range.prototype.getBoundingClientRect) {
    win.Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return new win.DOMRect();
    };
  }
}

function editorBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-05T00:00:00.000Z',
    user: {
      id: 1,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'default',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/', problems: '/p' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'problem_edit_function.html',
      data: {
        page_name: 'problem_edit_function.html',
        pdoc: { docId: 1, pid: 'P1001', title: '函数题', content: '题面' },
        structuredConfig: {
          main: {
            mode: 'function',
            lang: 'cc.cc20',
            source: 'int solve() {\n  return 0;\n}\n',
            publicRanges: [],
            regions: [],
            cases: [],
          },
        },
        testdata: [],
        langRange: { 'cc.cc20': 'C++20' },
        knowledgeMaps: [],
        knowledgeMindmapOptions: [],
        canUseCustomPid: false,
        problemAuthoringCapabilities: { canArchive: false, canDelete: false },
      },
    },
  };
}

function expectFormPageRoot(file: string): void {
  const source = readSource(file);
  const names = exportedFunctions(source);
  expect(names.length, file).toBeGreaterThan(0);
  for (const name of names) {
    expect(pageRootTag(source, name), name).toBe('Page');
  }
  expect(source, file).not.toContain('<main');
}

describe('q11 editor shell, sticky footer, and editor height', () => {
  it('客观题表单页源码不含 main，导出函数的返回根是 Page', () => {
    expectFormPageRoot(OBJECTIVE);
  });

  it('主观题表单页源码不含 main，导出函数的返回根是 Page', () => {
    expectFormPageRoot(SUBJECTIVE);
  });

  it('结构化代码编辑器的操作条不在 overflow-y-auto 内，且 className 含 shrink-0', () => {
    const hits = actionBars(readSource(CODE));
    expect(hits.length, ACTION_TESTID).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(classTokens(hit.openTag), '操作条 className').toContain('shrink-0');
      const scrolling = hit.ancestors.filter((tag) => classTokens(tag).includes('overflow-y-auto'));
      expect(scrolling.map((tag) => attributeExpression(tag, 'className'))).toEqual([]);
    }
  });

  it('作者端编辑器宿主 className 含 flex-1、min-h-0 与 min-h-80', () => {
    expect(classTokens(hostOpenTag(readSource(AUTHOR)))).toEqual(expect.arrayContaining(['flex-1', 'min-h-0', 'min-h-80']));
  });

  it('800px 模板阶段的标记按钮不被 overflow-hidden 裁切，最终高度链仍可滚动', async () => {
    await installDom();
    const { createElement } = await import('react');
    const { fireEvent, render } = await import('@testing-library/react');
    const { BootstrapProvider } = await import('../../../src/lib/bootstrap.tsx');
    const { FunctionProblemEditorPage } = await import('../../../src/pages/structured-code-editors.tsx');
    const view = render(createElement(BootstrapProvider, { bootstrap: editorBootstrap() }, createElement(FunctionProblemEditorPage)));
    fireEvent.click(view.getByRole('button', { name: /模板与作答区/ }));
    const panel = view.container.querySelector('[data-testid="structured-author-stage-panel"]');
    const stage = view.container.querySelector('[data-stage="template"]');
    const form = view.container.querySelector('#structured-code-form');
    const host = view.container.querySelector('[aria-label^="私有完整模板编辑器"]');
    expect(panel, '阶段面板').not.toBeNull();
    expect(stage, '模板阶段').not.toBeNull();
    expect(form, '表单').not.toBeNull();
    expect(host, '编辑器宿主').not.toBeNull();
    if (panel === null || stage === null || form === null || host === null) return;
    expect(panel).toBeInstanceOf(globalThis.HTMLElement);
    if (panel instanceof globalThis.HTMLElement) panel.style.height = '800px';
    expectHeightChain(form, 'form');
    expectHeightChain(panel, 'stage panel');
    expectHeightChain(stage, 'section');
    expect(renderedClassTokens(host)).toEqual(expect.arrayContaining(['flex-1', 'min-h-0', 'min-h-80']));
    for (const label of MARKER_BUTTONS) {
      expect(clippingClass(view.getByRole('button', { name: label })), label).toBe('');
    }
  });

  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });
});
