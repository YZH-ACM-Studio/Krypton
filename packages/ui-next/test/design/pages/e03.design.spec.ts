// @vitest-environment node
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ObjectiveAnswerPanel, type ObjectiveClientQuestion } from '@/components/objective-answer-panel';
import { OverviewSection } from '@/components/paper/sections';
import { cn } from '@/lib/cn';
import { expectExplicitButtonVariants, expectGateClean, readSource } from '../helpers.ts';

const SHELL = 'src/components/paper/paper-shell.tsx';
const SECTIONS = 'src/components/paper/sections.tsx';
const PANEL = 'src/components/objective-answer-panel.tsx';

const LANE_FILES = [SHELL, SECTIONS, PANEL] as const;

// 结构规格三份都是组件：不写 expectPageStructure。
// legacy-intents T01–T04 没有这三份源文件的条目。

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

function badgeBlocks(source: string): string[] {
  return [...source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
}

function badgeContaining(source: string, text: string): string {
  const found = badgeBlocks(source).find((block) => block.includes(text));
  expect(found, text).toEqual(expect.any(String));
  return found ?? '';
}

function hasTone(block: string, tone: string): boolean {
  return new RegExp(`\\btone\\s*=\\s*(?:"${tone}"|'${tone}'|\\{[^}]*["']${tone}["'][^}]*\\})`).test(block);
}

const RADIO = 'src/components/ui/radio-group.tsx';

const BRAND_COLOR = /^(?:[\w[\]&>.-]*:)?(?:bg|border|text|ring)-brand(?:[-/][\w./[\]]+)?$/;
const FOREIGN_COLOR = /^(?:[\w[\]&>.-]*:)?(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder)-(?:info|success|warning|danger|violet|orange|primary|secondary|sky|emerald|amber|rose|accent|destructive|muted|line)(?:[-/][\w./[\]]+)?$/;

function cnCallBody(source: string, needle: string): string {
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('cn(', from);
    if (at < 0) return '';
    let depth = 0;
    let quote: string | null = null;
    for (let index = at + 2; index < source.length; index += 1) {
      const char = source[index] ?? '';
      if (quote) {
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          const body = source.slice(at + 3, index);
          if (body.includes(needle)) return body;
          from = index + 1;
          break;
        }
      }
    }
    if (quote !== null || depth !== 0) return '';
  }
  return '';
}

function splitArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (quote) {
      current += char;
      if (char === '\\') {
        current += body[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function stringLiteral(expr: string): string | null {
  const match = /^(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)$/.exec(expr.trim());
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function splitTopLevelColon(expr: string): [string, string] | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    else if (char === ':' && depth === 0) return [expr.slice(0, index), expr.slice(index + 1)];
  }
  return null;
}

function flagValue(name: string, checked: boolean, disabled: boolean): boolean | null {
  if (name === 'checked') return checked;
  if (name === 'disabled') return disabled;
  return null;
}

function classFromArg(arg: string, checked: boolean, disabled: boolean, wrapperClassName: string | null): string {
  const text = arg.trim();
  const literal = stringLiteral(text);
  if (literal !== null) return literal;
  if (text === 'wrapperClassName' && wrapperClassName !== null) return wrapperClassName;

  const and = /^(!(?:checked|disabled)|checked|disabled)\s*&&\s*/.exec(text);
  if (and) {
    const flag = flagValue((and[1] ?? '').replace('!', ''), checked, disabled);
    const on = (and[1] ?? '').startsWith('!') ? flag === false : flag === true;
    if (!on) return '';
    const value = stringLiteral(text.slice(and[0].length).trim());
    expect(value, text).not.toBeNull();
    return value ?? '';
  }

  const tern = /^(!(?:checked|disabled)|checked|disabled)\s*\?\s*/.exec(text);
  if (tern) {
    const flag = flagValue((tern[1] ?? '').replace('!', ''), checked, disabled);
    const on = (tern[1] ?? '').startsWith('!') ? flag === false : flag === true;
    const branches = splitTopLevelColon(text.slice(tern[0].length));
    expect(branches, text).not.toBeNull();
    const chosen = (on ? branches?.[0] : branches?.[1]) ?? '';
    const value = stringLiteral(chosen.trim());
    expect(value, text).not.toBeNull();
    return value ?? '';
  }

  expect(text).toBe('a class literal or checked/disabled conditional');
  return '';
}

function mergedClass(body: string, wrapperClassName: string | null): string {
  return cn(...splitArgs(body).map((arg) => classFromArg(arg, true, false, wrapperClassName)).filter((value) => value.length > 0));
}

function mergedCheckedRow(rendererBody: string): string {
  const innerBody = cnCallBody(rendererBody, 'checked');
  expect(innerBody.length).toBeGreaterThan(0);
  const inner = mergedClass(innerBody, null);
  if (!rendererBody.includes('wrapperClassName={')) return inner;
  const outerBody = cnCallBody(readSource(RADIO), 'wrapperClassName');
  expect(outerBody.length).toBeGreaterThan(0);
  return mergedClass(outerBody, inner);
}

function expectBrandOnlySelected(merged: string): void {
  const tokens = merged.split(/\s+/).filter((token) => token.length > 0);
  expect(tokens.some((token) => BRAND_COLOR.test(token))).toBe(true);
  for (const token of tokens) {
    expect(token).not.toMatch(FOREIGN_COLOR);
  }
}

let domInstalled = false;

function assignGlobal(key: string, value: unknown): void {
  const current = Object.getOwnPropertyDescriptor(globalThis, key);
  if (current && current.writable !== true && current.set === undefined) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return;
  }
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}

function installDom(): void {
  if (domInstalled) return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const view = dom.window;
  assignGlobal('window', view);
  assignGlobal('document', view.document);
  assignGlobal('navigator', view.navigator);
  assignGlobal('HTMLElement', view.HTMLElement);
  assignGlobal('HTMLInputElement', view.HTMLInputElement);
  assignGlobal('HTMLButtonElement', view.HTMLButtonElement);
  assignGlobal('Element', view.Element);
  assignGlobal('Node', view.Node);
  assignGlobal('DocumentFragment', view.DocumentFragment);
  assignGlobal('SVGElement', view.SVGElement);
  assignGlobal('localStorage', view.localStorage);
  assignGlobal('MutationObserver', view.MutationObserver);
  assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
  assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  assignGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => view.setTimeout(() => callback(Date.now()), 0));
  assignGlobal('cancelAnimationFrame', (handle: number) => {
    view.clearTimeout(handle);
  });
  view.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof view.matchMedia;
  view.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof view.ResizeObserver;
  view.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof view.IntersectionObserver;
  view.Element.prototype.scrollIntoView = () => undefined;
  view.Element.prototype.hasPointerCapture = () => false;
  view.Element.prototype.setPointerCapture = () => undefined;
  view.Element.prototype.releasePointerCapture = () => undefined;
  assignGlobal('ResizeObserver', view.ResizeObserver);
  assignGlobal('IntersectionObserver', view.IntersectionObserver);
  domInstalled = true;
}

function controlDisabled(element: Element): boolean {
  if (!('disabled' in element)) return false;
  return (element as { disabled?: boolean }).disabled === true;
}

function renderPanel(props: {
  questions: ObjectiveClientQuestion[];
  submitUrl: string;
  storageKey: string;
  signedIn: boolean;
  previewOnly: boolean;
}) {
  installDom();
  window.localStorage.removeItem(props.storageKey);
  return render(createElement(ObjectiveAnswerPanel, props));
}

function renderOverview(
  now: number,
  begin: string,
  end: string,
  extra: { paperStarted?: boolean },
) {
  installDom();
  return render(createElement(OverviewSection, {
    data: {
      tdoc: { title: '结业考试', rule: 'exam', beginAt: begin, endAt: end },
      cells: [],
      owner: null,
      inWindow: false,
      now,
      signedInUser: { name: 'student' },
      paperStarted: extra.paperStarted === true,
      paperFinalized: false,
      paperPreview: false,
    },
    onEnterProblems: () => undefined,
  }));
}

function labelHost(container: HTMLElement, text: string): HTMLElement {
  const hosts = [...container.querySelectorAll<HTMLElement>('*')].filter((el) => (
    [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes(text))
  ));
  expect(hosts.length, text).toBeGreaterThan(0);
  return hosts[hosts.length - 1] ?? container;
}

function visibleDot(host: HTMLElement): Element | null {
  return [...host.querySelectorAll('span')].find((el) => {
    const className = el.getAttribute('class') ?? '';
    return className.includes('size-2') && className.includes('rounded-full') && className.includes('relative');
  }) ?? null;
}

function expectLifecycleDot(container: HTMLElement, text: string, toneClass: string, pulse: boolean): void {
  const host = labelHost(container, text);
  expect(host.closest('[data-slot="badge"]'), text).toBeNull();
  const dot = visibleDot(host);
  expect(dot, text).not.toBeNull();
  expect(dot?.getAttribute('class') ?? '', text).toContain(toneClass);
  const animated = host.querySelector('[class*="kr-pulse-dot"]');
  if (pulse) expect(animated, text).not.toBeNull();
  else expect(animated, text).toBeNull();
}

describe('e03 paper shell, sections and objective answer panel', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('sections.tsx 的 h1 改为 h2 text-lg font-semibold', () => {
    const src = readSource(SECTIONS);
    expect(src).not.toMatch(/<h1(?=[\s>/])/);
    expect(src).toMatch(/<h2\s+className="text-lg font-semibold"\s*>\s*\{tdoc\.title\}\s*<\/h2>/);
  });

  it('考试开始入口保留 h-14 w-full', () => {
    expect(readSource(SECTIONS)).toContain('h-14 w-full');
  });

  it('保存状态改为 Badge，三态 tone 为 neutral、warning、success', () => {
    // emerald→success，amber→warning，muted→neutral（DESIGN §2.5）。
    // 文案仍是保存状态：调用方只传 dirtyCount/saving，不在本 lane。
    const body = functionBody(readSource(SHELL), 'PaperStatusPill');
    expect(body.length).toBeGreaterThan(0);
    expect(hasTone(badgeContaining(body, '保存中'), 'neutral')).toBe(true);
    expect(hasTone(badgeContaining(body, '道未保存'), 'warning')).toBe(true);
    expect(hasTone(badgeContaining(body, '已保存'), 'success')).toBe(true);
  });

  it('题目卡片改为 Panel，并继续交出 id', () => {
    const body = functionBody(readSource(SHELL), 'CellCard');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<Panel\b/);
    expect(body).toMatch(/\bid=\{id\}/);
  });

  it('单选和判断使用 RadioGroup 或 MiniTabs，选中态只用 brand，并保留 name', () => {
    const body = functionBody(readSource(SHELL), 'SingleChoiceRenderer');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<(?:RadioGroupItem|RadioGroup|MiniTabs)\b/);
    expect(body).not.toMatch(/<input\b/);
    expect(body).toMatch(/name=\{name \|\| ['"]single-choice['"]\}/);
    // 选中态看 cn() 合并后的 class，不能只看 checked 字面量里有没有 brand。
    expectBrandOnlySelected(mergedCheckedRow(body));
  });

  it('多选使用 Checkbox 或 MiniTabs，选中态只用 brand', () => {
    const body = functionBody(readSource(SHELL), 'MultiChoiceRenderer');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<(?:Checkbox|MiniTabs)\b/);
    expect(body).not.toMatch(/<input\b/);
    expectBrandOnlySelected(mergedCheckedRow(body));
  });

  it('客观题面板保留 name、提交和本机自动保存', () => {
    const src = readSource(PANEL);
    expect(src).toMatch(/name=\{`objective-\$\{q\.key \|\| idx\}`\}/);
    expect(src).toContain("lang: '_'");
    expect(src).toContain('window.localStorage.getItem(storageKey)');
    expect(src).toContain('window.localStorage.setItem(storageKey, JSON.stringify(next))');
  });

  it('只读预览不能清空，也不能编辑填空', () => {
    const question: ObjectiveClientQuestion = { key: '1', kind: 'blank', score: 5 };
    const view = renderPanel({
      questions: [question],
      submitUrl: '/p/1/submit',
      storageKey: 'e03-preview-blank',
      signedIn: true,
      previewOnly: true,
    });
    const clear = view.getByRole('button', { name: '清空' });
    const blank = view.getByPlaceholderText('在此输入你的答案');
    expect(controlDisabled(clear)).toBe(true);
    expect(controlDisabled(blank)).toBe(true);
    view.unmount();
  });

  it('概览的即将开始、已结束和答题中使用 StatusDot', () => {
    // §7.4：即将开始 info、已结束默认 neutral、进行中 success 且 pulse。文案仍是「答题中」。
    const begin = '2026-08-01T00:00:00.000Z';
    const end = '2026-08-02T00:00:00.000Z';
    const upcoming = renderOverview(Date.parse('2026-07-01T00:00:00.000Z'), begin, end, {});
    expectLifecycleDot(upcoming.container, '即将开始', 'bg-info', false);
    upcoming.unmount();

    const ended = renderOverview(Date.parse('2026-09-01T00:00:00.000Z'), begin, end, {});
    expectLifecycleDot(ended.container, '已结束', 'bg-fg-subtle', false);
    ended.unmount();

    const answering = renderOverview(Date.parse('2026-08-01T01:00:00.000Z'), begin, end, {
      paperStarted: true,
    });
    expectLifecycleDot(answering.container, '答题中', 'bg-success', true);
    answering.unmount();
  });

  it('窄屏题号行隐藏滚动条，选中环贴着 surface', () => {
    const navigator = functionBody(readSource(SHELL), 'CellNavigator');
    const row = /orientation === 'row'[\s\S]*?<div className="([^"]+)"/.exec(navigator);
    expect(row?.[1] ?? '').toContain('overflow-x-auto');
    expect(row?.[1] ?? '').toContain('scrollbar-none');
    const button = functionBody(readSource(SHELL), 'StatusButton');
    expect(button).toContain('ring-offset-surface');
    expect(button).not.toContain('ring-offset-bg');
    const multi = functionBody(readSource(SHELL), 'MultiChoiceRenderer');
    expect(multi).toContain('opacity-45');
  });
});
