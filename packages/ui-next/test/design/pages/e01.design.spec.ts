// @vitest-environment node
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUser } from '@/lib/bootstrap';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const FILE = 'src/components/layout/exam-shell.tsx';

// 结构规格是「组件：只要求门禁零违规」，不写 expectPageStructure。
// legacy-intents T01–T04 没有源文件 exam-shell.tsx，因此没有意图用例。

const SHELLS = ['ExamHomeShell', 'ExamDetailShell', 'ExamContestShell'] as const;
const THEME_LABELS = ['亮色', '暗色', '跟随系统'] as const;
const TOP_BAR = ['h-12', 'short:h-11', 'border-b', 'border-line', 'bg-bg'] as const;
const VIEWPORT_PADDING = 'p-4 sm:p-6 xl:p-8';
const BOTTOM_SAFE = 'pb-[max(.75rem,env(safe-area-inset-bottom))]';

function source(): string {
  return readSource(FILE);
}

function functionBody(text: string, name: string): string {
  const match = new RegExp(`function ${name}\\b`).exec(text);
  if (match === null || match.index === undefined) {
    return '';
  }
  const rest = text.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, match[0].length + next);
}

function quotedStrings(text: string): string[] {
  return [...text.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function hasClassTokens(text: string, tokens: readonly string[]): boolean {
  return quotedStrings(text).some((value) => {
    const present = new Set(value.split(/\s+/).filter((token) => token.length > 0));
    return tokens.every((token) => present.has(token));
  });
}

function hasWholeToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text);
}

function hasFiveMinuteCutoff(text: string): boolean {
  return /5\s*\*\s*60\s*\*\s*1_?000\b|5\s*\*\s*60_000\b|300_000\b|(?<![\d_])300000(?![\d_])/.test(text);
}

// `5 * 60 * 1000` contains the digits of one minute. One minute is a separate comparison.
function hasOneMinuteCutoff(text: string): boolean {
  return /(?<![\d_])1\s*\*\s*60\s*\*\s*1_?000(?![\d_])/.test(text)
    || /(?<![\d_*]\s*)(?<![\d_])60\s*\*\s*1_?000(?![\d_])/.test(text)
    || /(?<![\d_])60_000(?![\d_])/.test(text)
    || /(?<![\d_])60000(?![\d_])/.test(text);
}

function dangerCoversRunningMinute(text: string): boolean {
  const assignment = /const tone =[\s\S]*?;/.exec(text)?.[0] ?? '';
  const dangerChoice = assignment.split('text-danger-fg')[0] ?? '';
  return /kind\s*===\s*['"]during['"]/.test(dangerChoice) && hasOneMinuteCutoff(dangerChoice);
}

function importsName(text: string, name: string, moduleId: string): boolean {
  return new RegExp(`import\\s*\\{[\\s\\S]*?\\b${name}\\b[\\s\\S]*?\\}\\s*from\\s*'${moduleId}'`).test(text);
}

function toastHosts(text: string): string[] {
  const names = [...text.matchAll(/\n(?:export )?function ([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1] ?? '');
  return names.filter((name) => {
    const body = functionBody(text, name);
    const providerAt = body.indexOf('<ToastProvider');
    const childrenAt = body.indexOf('{children}');
    return providerAt >= 0 && childrenAt > providerAt;
  });
}

function shellMountsToast(text: string, shell: string): boolean {
  const body = functionBody(text, shell);
  if (body.includes('<ToastProvider')) {
    return true;
  }
  return toastHosts(text).some((name) => name !== shell && new RegExp(`<${name}(?=[\\s/>])`).test(body));
}

const NARROW_WIDTH = 360;
const WIDE_WIDTH = 640;
const LONG_TITLE = '考试标题'.repeat(15);
const LONG_NAME = '考生姓名'.repeat(15);

const SPACE_PX: Record<string, number> = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  px: 1,
};

const FONT_PX: Record<string, number> = {
  'text-2xs': 11,
  'text-xs': 12,
  'text-sm': 13,
  'text-md': 14,
  'text-lg': 16,
};

interface ContentBox {
  min: number;
  max: number;
}

interface Placed {
  width: number;
  titleWidth: number | null;
  badgeStart: number | null;
  badgeEnd: number | null;
  statusStart: number | null;
  statusEnd: number | null;
}

function assignGlobal(name: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor?.configurable === false) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const view = dom.window;
  assignGlobal('window', view);
  assignGlobal('document', view.document);
  assignGlobal('navigator', view.navigator);
  assignGlobal('HTMLElement', view.HTMLElement);
  assignGlobal('Element', view.Element);
  assignGlobal('Node', view.Node);
  assignGlobal('DocumentFragment', view.DocumentFragment);
  assignGlobal('SVGElement', view.SVGElement);
  assignGlobal('SVGSVGElement', view.SVGSVGElement);
  assignGlobal('HTMLMetaElement', view.HTMLMetaElement);
  assignGlobal('HTMLButtonElement', view.HTMLButtonElement);
  assignGlobal('HTMLAnchorElement', view.HTMLAnchorElement);
  assignGlobal('HTMLDivElement', view.HTMLDivElement);
  assignGlobal('HTMLSpanElement', view.HTMLSpanElement);
  assignGlobal('HTMLImageElement', view.HTMLImageElement);
  assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
  const requestAnimationFrame = (callback: FrameRequestCallback): number => Number(setTimeout(() => callback(0), 0));
  const cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
  view.requestAnimationFrame = requestAnimationFrame;
  view.cancelAnimationFrame = cancelAnimationFrame;
  assignGlobal('requestAnimationFrame', requestAnimationFrame);
  assignGlobal('cancelAnimationFrame', cancelAnimationFrame);
  assignGlobal('localStorage', view.localStorage);
  assignGlobal('MutationObserver', view.MutationObserver);
  class QuietResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  }
  view.ResizeObserver = QuietResizeObserver;
  assignGlobal('ResizeObserver', QuietResizeObserver);
  const matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  view.matchMedia = matchMedia;
  assignGlobal('matchMedia', matchMedia);
  class QuietWebSocket {
    static CONNECTING = 0;

    static OPEN = 1;

    static CLOSING = 2;

    static CLOSED = 3;

    readyState = 0;

    onopen: ((event: unknown) => void) | null = null;

    onmessage: ((event: unknown) => void) | null = null;

    onerror: ((event: unknown) => void) | null = null;

    onclose: ((event: unknown) => void) | null = null;

    close() {
      this.readyState = 3;
    }

    send() {}

    addEventListener() {}

    removeEventListener() {}
  }
  view.WebSocket = QuietWebSocket as unknown as typeof WebSocket;
  assignGlobal('WebSocket', QuietWebSocket);
  assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasToken(tokens: readonly string[], token: string): boolean {
  return tokens.includes(token);
}

function responsiveHidden(tokens: readonly string[], viewport: number): boolean {
  const sm = viewport >= WIDE_WIDTH;
  const md = viewport >= 768;
  const shownAtSm = hasToken(tokens, 'sm:inline') || hasToken(tokens, 'sm:block') || hasToken(tokens, 'sm:flex') || hasToken(tokens, 'sm:inline-flex');
  const shownAtMd = hasToken(tokens, 'md:inline') || hasToken(tokens, 'md:block') || hasToken(tokens, 'md:flex') || hasToken(tokens, 'md:inline-flex');
  if (hasToken(tokens, 'hidden') && (!sm || !shownAtSm) && (!md || !shownAtMd)) return true;
  if (sm && hasToken(tokens, 'sm:hidden')) return true;
  if (!sm && hasToken(tokens, 'max-sm:hidden')) return true;
  return false;
}

function bareUtility(token: string, viewport: number): string | null {
  if (token.startsWith('sm:')) return viewport >= WIDE_WIDTH ? token.slice(3) : null;
  if (token.startsWith('md:')) return viewport >= 768 ? token.slice(3) : null;
  if (token.startsWith('max-sm:')) return viewport < WIDE_WIDTH ? token.slice(7) : null;
  return token;
}

function lengthPx(raw: string): number | null {
  if (raw === 'px') return 1;
  if (raw === 'full' || raw === 'screen' || raw === 'min' || raw === 'max' || raw === 'fit') return null;
  const known = SPACE_PX[raw];
  if (known !== undefined) return known;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw) * 4;
  return null;
}

function utilityValue(tokens: readonly string[], name: string, viewport: number): number | null {
  let value: number | null = null;
  let responsive = false;
  for (const token of tokens) {
    const bare = bareUtility(token, viewport);
    if (bare === null) continue;
    const isResponsive = token.startsWith('sm:') || token.startsWith('md:') || token.startsWith('max-sm:');
    if (responsive && !isResponsive) continue;
    if (bare === name) {
      value = SPACE_PX.px ?? 1;
      responsive = isResponsive;
      continue;
    }
    if (!bare.startsWith(`${name}-`)) continue;
    const parsed = lengthPx(bare.slice(name.length + 1));
    if (parsed === null) continue;
    value = parsed;
    responsive = isResponsive;
  }
  return value;
}

function tokenOn(tokens: readonly string[], name: string, viewport: number): boolean {
  return tokens.some((token) => bareUtility(token, viewport) === name);
}

function axis(tokens: readonly string[], viewport: number, both: string, start: string, end: string): number {
  const shared = utilityValue(tokens, both, viewport) ?? 0;
  return (utilityValue(tokens, start, viewport) ?? shared) + (utilityValue(tokens, end, viewport) ?? shared);
}

function fontPx(tokens: readonly string[], inherited: number): number {
  let size = inherited;
  for (const token of tokens) {
    const bare = token.startsWith('sm:') ? null : token;
    if (bare === null) continue;
    const next = FONT_PX[bare];
    if (next !== undefined) size = next;
  }
  return size;
}

function fixedOuter(tokens: readonly string[], viewport: number): number | null {
  const size = utilityValue(tokens, 'size', viewport);
  if (size !== null) return size;
  if (tokens.some((token) => bareUtility(token, viewport) === 'w-px')) return 1 + axis(tokens, viewport, 'mx', 'ml', 'mr');
  const width = utilityValue(tokens, 'w', viewport);
  if (width === null) return null;
  return width;
}

function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function textWidth(text: string, font: number, mono: boolean): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char.trim() === '') width += font * 0.33;
    else if (mono) width += font * 0.62;
    else if (code > 0xff) width += font;
    else width += font * 0.55;
  }
  return width;
}

function svgWidth(element: Element, ancestorTokens: readonly string[], viewport: number): number {
  const own = utilityValue(classTokens(element), 'size', viewport);
  if (own !== null) return own;
  for (const token of ancestorTokens) {
    const bare = bareUtility(token, viewport);
    if (bare === null) continue;
    const matched = /\[&_svg\]:size-(\d+(?:\.\d+)?)/.exec(bare);
    const raw = matched?.[1];
    if (raw === undefined) continue;
    const parsed = lengthPx(raw);
    if (parsed !== null) return parsed;
  }
  return 24;
}

function isSvgElement(element: Element): boolean {
  return element.tagName.toLowerCase() === 'svg';
}

function measuredChildren(element: Element): Element[] {
  return [...element.children].filter((child) => child instanceof HTMLElement || isSvgElement(child));
}

function boxPadding(tokens: readonly string[], viewport: number): { start: number; end: number } {
  const all = utilityValue(tokens, 'p', viewport);
  const x = utilityValue(tokens, 'px', viewport);
  const borderStart = hasToken(tokens, 'border') || hasToken(tokens, 'border-x') || hasToken(tokens, 'border-l') ? 1 : 0;
  const borderEnd = hasToken(tokens, 'border') || hasToken(tokens, 'border-x') || hasToken(tokens, 'border-r') ? 1 : 0;
  return {
    start: (utilityValue(tokens, 'pl', viewport) ?? x ?? all ?? 0) + borderStart,
    end: (utilityValue(tokens, 'pr', viewport) ?? x ?? all ?? 0) + borderEnd,
  };
}

function isRow(tokens: readonly string[], viewport: number): boolean {
  const flex = tokenOn(tokens, 'flex', viewport) || tokenOn(tokens, 'inline-flex', viewport);
  return flex && !tokenOn(tokens, 'flex-col', viewport);
}

function textCanShrink(tokens: readonly string[], viewport: number): boolean {
  return tokenOn(tokens, 'truncate', viewport)
    || tokenOn(tokens, 'overflow-hidden', viewport)
    || tokenOn(tokens, 'overflow-x-hidden', viewport)
    || tokens.some((token) => bareUtility(token, viewport)?.startsWith('line-clamp-') === true);
}

function capToMaxWidth(tokens: readonly string[], viewport: number, box: ContentBox): ContentBox {
  const cap = utilityValue(tokens, 'max-w', viewport);
  if (cap === null) return box;
  return { min: Math.min(box.min, cap), max: Math.min(box.max, cap) };
}

function contentBox(element: Element, viewport: number, inheritedFont: number): ContentBox {
  const tokens = classTokens(element);
  if (responsiveHidden(tokens, viewport) || tokenOn(tokens, 'absolute', viewport) || tokenOn(tokens, 'fixed', viewport)) {
    return { min: 0, max: 0 };
  }
  if (isSvgElement(element)) {
    const width = svgWidth(element, [], viewport);
    return { min: width, max: width };
  }
  const fixed = fixedOuter(tokens, viewport);
  if (fixed !== null) return capToMaxWidth(tokens, viewport, { min: fixed, max: fixed });
  const font = fontPx(tokens, inheritedFont);
  const pad = boxPadding(tokens, viewport).start + boxPadding(tokens, viewport).end;
  const children = measuredChildren(element);
  if (isRow(tokens, viewport) && children.length > 0) {
    const gap = utilityValue(tokens, 'gap', viewport) ?? 0;
    let min = 0;
    let max = 0;
    let visible = 0;
    for (const child of children) {
      if (isSvgElement(child)) {
        const width = svgWidth(child, tokens, viewport);
        if (width <= 0) continue;
        min += width;
        max += width;
        visible += 1;
        continue;
      }
      const box = contentBox(child, viewport, font);
      if (box.max <= 0 && box.min <= 0) continue;
      const shrink0 = tokenOn(classTokens(child), 'shrink-0', viewport);
      min += shrink0 ? box.max : box.min;
      max += box.max;
      visible += 1;
    }
    if (visible > 1) {
      min += gap * (visible - 1);
      max += gap * (visible - 1);
    }
    return capToMaxWidth(tokens, viewport, { min: min + pad, max: max + pad });
  }
  const text = textWidth(ownText(element), font, hasToken(tokens, 'font-mono'));
  let min = pad + (textCanShrink(tokens, viewport) ? 0 : text);
  let max = pad + text;
  for (const child of children) {
    if (isSvgElement(child)) {
      const width = svgWidth(child, tokens, viewport);
      min += width;
      max += width;
      continue;
    }
    const box = contentBox(child, viewport, font);
    min = Math.max(min, box.min + pad);
    max = Math.max(max, box.max + pad);
  }
  return capToMaxWidth(tokens, viewport, { min, max });
}

interface FlexItem {
  min: number;
  max: number;
  base: number;
  shrink: number;
  grow: number;
}

function flexSpec(tokens: readonly string[], box: ContentBox, viewport: number): FlexItem {
  const pad = boxPadding(tokens, viewport).start + boxPadding(tokens, viewport).end;
  const cap = utilityValue(tokens, 'max-w', viewport);
  const shrink0 = tokenOn(tokens, 'shrink-0', viewport) || tokenOn(tokens, 'flex-none', viewport);
  const flex1 = tokenOn(tokens, 'flex-1', viewport) || tokenOn(tokens, 'basis-0', viewport);
  const flexMin = tokenOn(tokens, 'min-w-0', viewport) ? pad : box.min;
  const max = Math.max(flexMin, cap ?? Number.POSITIVE_INFINITY);
  let base = box.max;
  if (flex1) base = 0;
  else if (tokenOn(tokens, 'w-min', viewport) || tokenOn(tokens, 'basis-min', viewport)) base = box.min;
  else if (fixedOuter(tokens, viewport) !== null) base = fixedOuter(tokens, viewport) ?? box.max;
  const min = Math.min(flexMin, max);
  return {
    min,
    max,
    base: Math.min(Math.max(base, min), max),
    shrink: shrink0 ? 0 : 1,
    grow: shrink0 ? 0 : (flex1 || tokenOn(tokens, 'flex-auto', viewport) || tokenOn(tokens, 'grow', viewport) ? 1 : 0),
  };
}

function resolveFlexWidths(items: readonly FlexItem[], inner: number, gaps: number): number[] {
  const widths = items.map((item) => item.base);
  const used = () => widths.reduce((sum, width) => sum + width, 0) + gaps;
  let free = inner - used();
  for (let guard = 0; free < -0.01 && guard < 8; guard += 1) {
    const factors = items.map((item, index) => {
      const room = (widths[index] ?? 0) - item.min;
      return room > 0.01 && item.shrink > 0 && item.base > 0 ? item.base * item.shrink : 0;
    });
    const factorSum = factors.reduce((sum, factor) => sum + factor, 0);
    if (factorSum <= 0) break;
    let consumed = 0;
    for (let index = 0; index < factors.length; index += 1) {
      const factor = factors[index] ?? 0;
      if (factor <= 0) continue;
      const room = (widths[index] ?? 0) - (items[index]?.min ?? 0);
      const cut = Math.min(room, (-free) * (factor / factorSum));
      widths[index] = (widths[index] ?? 0) - cut;
      consumed += cut;
    }
    if (consumed <= 0.01) break;
    free += consumed;
  }
  if (free > 0.01) {
    const growers = items.map((item, index) => (item.grow > 0 && (widths[index] ?? 0) < item.max ? item.grow : 0));
    const growSum = growers.reduce((sum, grow) => sum + grow, 0);
    if (growSum > 0) {
      growers.forEach((grow, index) => {
        if (grow <= 0) return;
        const item = items[index];
        const current = widths[index] ?? 0;
        const room = item === undefined ? 0 : item.max - current;
        widths[index] = current + Math.min(room, free * (grow / growSum));
      });
    }
  }
  return widths;
}

function place(element: Element, viewport: number, x: number, limit: number | null, inheritedFont: number): Placed {
  const tokens = classTokens(element);
  if (responsiveHidden(tokens, viewport) || tokenOn(tokens, 'absolute', viewport) || tokenOn(tokens, 'fixed', viewport)) {
    return { width: 0, titleWidth: null, badgeStart: null, badgeEnd: null, statusStart: null, statusEnd: null };
  }
  if (isSvgElement(element)) {
    const width = limit ?? svgWidth(element, [], viewport);
    return { width, titleWidth: null, badgeStart: null, badgeEnd: null, statusStart: null, statusEnd: null };
  }
  const font = fontPx(tokens, inheritedFont);
  const box = contentBox(element, viewport, inheritedFont);
  const width = limit === null ? box.max : limit;
  const visible = measuredChildren(element).filter((child) => {
    const childTokens = classTokens(child);
    return !responsiveHidden(childTokens, viewport) && !tokenOn(childTokens, 'absolute', viewport) && !tokenOn(childTokens, 'fixed', viewport);
  });
  // The title itself contains 考, so strip it before looking for the badge text.
  const text = element.textContent ?? '';
  const outsideTitle = text.split(LONG_TITLE).join('');
  const holdsTitle = text.includes(LONG_TITLE) && !outsideTitle.includes('考');
  let titleWidth: number | null = holdsTitle ? width : null;
  let badgeStart: number | null = null;
  let badgeEnd: number | null = null;
  let statusStart: number | null = null;
  let statusEnd: number | null = null;
  const mark = outsideTitle.includes('考') && hasToken(tokens, 'border') && isRow(tokens, viewport);
  // max-sm:hidden and hidden sm:inline both drop this word out of the 360px flex.
  const statusWord = ownText(element) === '开赛倒计时';
  if (!isRow(tokens, viewport) || visible.length === 0) {
    if (mark) {
      badgeStart = x;
      badgeEnd = x + width;
    }
    if (statusWord) {
      statusStart = x;
      statusEnd = x + width;
    }
    return { width, titleWidth, badgeStart, badgeEnd, statusStart, statusEnd };
  }
  const gap = utilityValue(tokens, 'gap', viewport) ?? 0;
  const pad = boxPadding(tokens, viewport);
  const inner = Math.max(0, width - pad.start - pad.end);
  const items = visible.map((child) => {
    if (isSvgElement(child)) {
      const svg = svgWidth(child, tokens, viewport);
      return { min: svg, max: svg, base: svg, shrink: 0, grow: 0 };
    }
    return flexSpec(classTokens(child), contentBox(child, viewport, font), viewport);
  });
  const widths = resolveFlexWidths(items, inner, gap * Math.max(0, items.length - 1));
  let cursor = x + pad.start;
  visible.forEach((child, index) => {
    const childWidth = widths[index] ?? 0;
    const placed = place(child, viewport, cursor, childWidth, font);
    if (placed.titleWidth !== null) titleWidth = placed.titleWidth;
    if (placed.badgeStart !== null) {
      badgeStart = placed.badgeStart;
      badgeEnd = placed.badgeEnd;
    }
    if (placed.statusStart !== null) {
      statusStart = placed.statusStart;
      statusEnd = placed.statusEnd;
    }
    cursor += childWidth + gap;
  });
  if (mark) {
    badgeStart = x;
    badgeEnd = x + width;
  }
  if (statusWord) {
    statusStart = x;
    statusEnd = x + width;
  }
  return { width, titleWidth, badgeStart, badgeEnd, statusStart, statusEnd };
}

function topBarFit(container: ParentNode, viewport: number): {
  titleWidth: number;
  badgeClipped: boolean;
  statusWidth: number;
  statusClipped: boolean;
  detail: string;
} {
  const header = container.querySelector('header');
  expect(header, 'header').toBeInstanceOf(HTMLElement);
  const bar = header as HTMLElement;
  const pad = boxPadding(classTokens(bar), viewport);
  const placed = place(bar, viewport, 0, viewport, 14);
  const titleWidth = placed.titleWidth ?? 0;
  const contentRight = viewport - pad.end;
  const badgeEnd = placed.badgeEnd ?? -1;
  const badgeClipped = badgeEnd > contentRight + 0.5;
  const statusStart = placed.statusStart;
  const statusEnd = placed.statusEnd ?? -1;
  const statusWidth = statusStart === null ? 0 : statusEnd - statusStart;
  const statusClipped = statusWidth <= 0 || statusEnd > contentRight + 0.5;
  return {
    titleWidth,
    badgeClipped,
    statusWidth,
    statusClipped,
    detail: `viewport ${viewport} content ${contentRight} title ${titleWidth} badge ${placed.badgeStart ?? -1}..${badgeEnd} status ${statusStart ?? -1}..${statusEnd}`,
  };
}

function floorWidth(element: Element, viewport: number): number {
  const tokens = classTokens(element);
  const minW = utilityValue(tokens, 'min-w', viewport);
  const box = contentBox(element, viewport, 11);
  return Math.max(minW ?? 0, box.max);
}

function bottomExamNav(container: ParentNode): HTMLElement | null {
  return [...container.querySelectorAll('nav')].find((nav) => {
    const tokens = classTokens(nav);
    return hasToken(tokens, 'md:hidden') && hasToken(tokens, BOTTOM_SAFE);
  }) ?? null;
}

function iconRail(container: ParentNode): HTMLElement {
  const rails = [...container.querySelectorAll('aside')].filter((aside) => aside.querySelector('nav[aria-label="考试导航"]') !== null);
  expect(rails, 'icon rail').toHaveLength(1);
  const rail = rails[0];
  if (!(rail instanceof HTMLElement)) {
    throw new TypeError('icon rail');
  }
  return rail;
}

function navControls(container: ParentNode, label: string): HTMLElement[] {
  return [...container.querySelectorAll('a,button')].filter((element): element is HTMLElement => {
    return element instanceof HTMLElement
      && element.getAttribute('data-slot') === 'button'
      && (element.textContent ?? '').replace(/\s+/g, '') === label;
  });
}

function countdownDigits(container: ParentNode): HTMLElement {
  const nodes = [...container.querySelectorAll('span')].filter((span) => /^\d{2}:\d{2}:\d{2}$/.test((span.textContent ?? '').trim()));
  expect(nodes, 'countdown digits').toHaveLength(1);
  const node = nodes[0];
  if (!(node instanceof HTMLElement)) {
    throw new TypeError('countdown digits');
  }
  return node;
}

function horizontalScroller(root: HTMLElement): HTMLElement | null {
  if (hasToken(classTokens(root), 'overflow-x-auto')) return root;
  const nested = [...root.querySelectorAll('*')].find((el) => el instanceof HTMLElement && hasToken(classTokens(el), 'overflow-x-auto'));
  return nested instanceof HTMLElement ? nested : null;
}

function scrollTrackWidth(scroller: HTMLElement, viewport: number): { width: number; labels: string[] } {
  const row = [...scroller.children].find((child) => child instanceof HTMLElement && hasToken(classTokens(child), 'min-w-max')) ?? scroller;
  const tokens = classTokens(row);
  const items = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  const gap = utilityValue(tokens, 'gap', viewport) ?? 0;
  const pad = boxPadding(tokens, viewport);
  const widths = items.map((item) => floorWidth(item, viewport));
  const gaps = gap * Math.max(0, widths.length - 1);
  const width = widths.reduce((sum, item) => sum + item, 0) + gaps + pad.start + pad.end;
  return { width, labels: items.map((item) => (item.textContent ?? '').replace(/\s+/g, '').trim()) };
}

interface ContestBarOptions {
  allowPrint?: boolean;
  beginAt?: string;
  endAt?: string;
}

function contestBootstrap(options?: ContestBarOptions): KryptonBootstrap {
  // Future beginAt keeps the status word on「开赛倒计时」, not the shorter「剩余」.
  const beginAt = options?.beginAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endAt = options?.endAt ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const user: KryptonUser = {
    id: 7,
    name: 'student',
    mail: 'student@example.test',
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
  };
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-05T00:00:00.000Z',
    user,
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
      ranking: '/ranking',
      discussions: '/discuss',
      domains: '/domains',
      messages: '/messages',
      login: '/login',
      register: '/register',
      logout: '/logout',
      settings: '/settings',
      security: '/settings/security',
      files: '/files',
      records: '/records',
      domainDashboard: '/domain',
      domainPermission: '/domain/permission',
      manage: '/manage',
      status: '/status',
      problemDetail: '/p/:PID',
      contestDetail: '/contest/:TID',
      homeworkDetail: '/homework/:TID',
      trainingDetail: '/training/:TID',
      discussionDetail: '/discuss/:DID',
      discussionNode: '/discuss/node/:NID',
      userDetail: '/user/:UID',
      recordDetail: '/record/:RID',
    },
    udict: {},
    page: {
      templateName: 'exam_contest.html',
      data: {
        examMode: {
          title: LONG_TITLE,
          beginAt,
          endAt,
          allowPrint: options?.allowPrint === true,
          tid: 'exam-shell-layout',
          section: 'overview',
          teamId: '507f1f77bcf86cd799439011',
          teamRole: 'captain',
          teamInfo: {
            teamId: '507f1f77bcf86cd799439011',
            name: '布局队',
            captainUid: 7,
            memberUids: [7],
            revision: 1,
          },
          canBrowseProblems: true,
          canViewTeamRecords: true,
          canEditCode: true,
          canRun: true,
          canSubmit: true,
          canUseVirtualPrint: false,
          student: { realName: LONG_NAME, studentId: '20260001' },
          urls: { teamCodeSnapshots: '/api/team-code-snapshots' },
        },
      },
    },
  };
}

async function renderContestBar(options?: ContestBarOptions): Promise<{ container: HTMLElement; unmount: () => void }> {
  installDom();
  const { render } = await import('@testing-library/react');
  const { ExamContestShell } = await import('@/components/layout/exam-shell');
  const view = render(createElement(
    BootstrapProvider,
    { bootstrap: contestBootstrap(options) },
    createElement(ExamContestShell, null, createElement('div', null, '试卷')),
  ));
  return { container: view.container, unmount: view.unmount };
}

describe('e01 exam shell', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('删除主题副本，三态切换同 AppShell', () => {
    const src = source();
    expect(src).not.toMatch(/\buseDark\b/);
    expect(src).not.toMatch(/\bTHEME_KEY\b/);
    expect(importsName(src, 'useThemePreference', '@/lib/theme')).toBe(true);
    expect(src).toMatch(/useThemePreference\(\s*bs\.theme\s*\)/);
    const tabs = findOpenTags(src, 'MiniTabs');
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((tag) => /\bsize=["']sm["']/.test(tag.text) || tag.text.includes('size={"sm"}'))).toBe(true);
    for (const label of THEME_LABELS) {
      const asProp = src.includes(`ariaLabel: '${label}'`) || src.includes(`ariaLabel: "${label}"`);
      const asAttr = src.includes(`aria-label="${label}"`) || src.includes(`aria-label='${label}'`);
      expect(asProp || asAttr, label).toBe(true);
    }
  });

  it('三个壳的根部挂 ToastProvider', () => {
    const src = source();
    expect(importsName(src, 'ToastProvider', '@/components/ui/toast')).toBe(true);
    for (const shell of SHELLS) {
      expect(shellMountsToast(src, shell), shell).toBe(true);
    }
  });

  it('顶栏是一条 h-12 short:h-11 的线框栏', async () => {
    const src = source();
    expect([...src.matchAll(/<header\b/g)].length).toBe(1);
    expect(hasClassTokens(src, TOP_BAR)).toBe(true);
    expect(src).not.toMatch(/\banimate-pulse\b|\banimate-ping\b/);
    const view = await renderContestBar();
    try {
      const bar = view.container.querySelector('header');
      expect(bar, 'header').toBeInstanceOf(HTMLElement);
      const text = bar?.textContent ?? '';
      expect(text, 'countdown').toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(text, '开赛倒计时').toContain('开赛倒计时');
      expect(bar?.querySelector('[role="tablist"]'), 'theme tabs').not.toBeNull();
      expect(bar?.querySelector('[aria-label="代码快照"]'), 'team snapshot').not.toBeNull();
      expect(text, 'student name').toContain(LONG_NAME);
      for (const viewport of [NARROW_WIDTH, WIDE_WIDTH]) {
        const fit = topBarFit(view.container, viewport);
        expect(fit.titleWidth, fit.detail).toBeGreaterThan(0);
        expect(fit.badgeClipped, fit.detail).toBe(false);
        expect(fit.statusWidth, fit.detail).toBeGreaterThan(0);
        expect(fit.statusClipped, fit.detail).toBe(false);
      }
    } finally {
      view.unmount();
    }
  });

  it('导航保留 md 图标轨和窄屏底栏，选中项用 surface-active', async () => {
    const src = source();
    expect(hasClassTokens(src, ['hidden', 'w-20', 'md:flex'])).toBe(true);
    expect(hasClassTokens(src, ['bg-surface-active', 'text-fg'])).toBe(true);
    const view = await renderContestBar({ allowPrint: true });
    try {
      const railTokens = classTokens(iconRail(view.container));
      expect(railTokens, 'hidden until md').toEqual(expect.arrayContaining(['hidden', 'w-20', 'md:flex']));
      const selected = navControls(view.container, '概览');
      expect(selected, 'selected overview in rail and bottom bar').toHaveLength(2);
      for (const item of selected) {
        const tokens = classTokens(item);
        expect(item.getAttribute('data-variant'), 'nav variant').toBe('ghost');
        expect(tokens, 'merged active class').toEqual(expect.arrayContaining(['bg-surface-active', 'text-fg']));
        expect(tokens, 'ghost text-fg-muted must lose to the active color').not.toContain('text-fg-muted');
      }
      const idle = navControls(view.container, '题目');
      expect(idle, 'idle problem item').toHaveLength(2);
      for (const item of idle) {
        const tokens = classTokens(item);
        expect(tokens, 'idle item').not.toContain('bg-surface-active');
        expect(tokens, 'idle item').not.toContain('text-fg');
      }
      const bottom = bottomExamNav(view.container);
      expect(bottom, 'bottom nav').toBeInstanceOf(HTMLElement);
      const scroller = horizontalScroller(bottom as HTMLElement);
      expect(scroller, 'horizontal scroller').toBeInstanceOf(HTMLElement);
      const scrollerTokens = classTokens(scroller as HTMLElement);
      expect(scrollerTokens, 'scrollbar-none on the scroll container').toContain('scrollbar-none');
      const track = scrollTrackWidth(scroller as HTMLElement, NARROW_WIDTH);
      expect(track.labels).toEqual(['概览', '题目', '公告', '讨论', '排名', '打印']);
      expect(track.width, track.labels.join(' ')).toBeGreaterThan(NARROW_WIDTH);
    } finally {
      view.unmount();
    }
  });

  it('主内容 ScrollArea 去掉 2xl 横向内边距', () => {
    const src = source();
    expect(src).toContain(VIEWPORT_PADDING);
    expect(src).not.toContain('2xl:px-10');
    expect([...src.matchAll(/viewportClassName=/g)].length).toBeGreaterThan(0);
  });

  it('计时颜色随剩余时间切换且不闪烁不弹窗', async () => {
    const body = functionBody(source(), 'ExamCountdown');
    expect(body.length).toBeGreaterThan(0);
    expect(hasFiveMinuteCutoff(body)).toBe(true);
    expect(hasOneMinuteCutoff(body)).toBe(true);
    expect(dangerCoversRunningMinute(body)).toBe(true);
    expect(hasWholeToken(body, 'text-fg')).toBe(true);
    expect(hasWholeToken(body, 'text-warning-fg')).toBe(true);
    expect(hasWholeToken(body, 'text-danger-fg')).toBe(true);
    expect(body).not.toMatch(/\banimate-pulse\b|\banimate-ping\b|\banimate-bounce\b|<Dialog\b|window\.alert\s*\(|\bconfirm\s*\(/);
    const tones = [
      { remainingMs: 10 * 60 * 1000, tone: 'text-fg' },
      { remainingMs: 3 * 60 * 1000, tone: 'text-warning-fg' },
      { remainingMs: 30 * 1000, tone: 'text-danger-fg' },
    ] as const;
    for (const item of tones) {
      const now = Date.now();
      const view = await renderContestBar({
        beginAt: new Date(now - 60 * 60 * 1000).toISOString(),
        endAt: new Date(now + item.remainingMs).toISOString(),
      });
      try {
        const tokens = classTokens(countdownDigits(view.container));
        expect(tokens, item.tone).toContain(item.tone);
        for (const other of ['text-fg', 'text-warning-fg', 'text-danger-fg'] as const) {
          if (other !== item.tone) expect(tokens, other).not.toContain(other);
        }
      } finally {
        view.unmount();
      }
    }
  });

  it('保留 hash 同步、用户链接拦截、代码快照抽屉和 examMode 读取', () => {
    const src = source();
    expect(src).toMatch(/export function ExamHomeShell\b/);
    expect(src).toMatch(/export function ExamDetailShell\b/);
    expect(src).toMatch(/export function ExamContestShell\b/);
    expect(src).toMatch(/export type ExamSection\b/);
    const section = functionBody(src, 'useExamSection');
    expect(section).toContain('hashchange');
    expect(section).toContain('replaceState');
    expect(section).toMatch(/location\.hash/);
    expect(src).toContain("pathname.startsWith('/user/')");
    expect(src).toContain('preventDefault()');
    expect(src).toContain('onClickCapture={stopUserProfileLinks}');
    expect(src).toContain('<TeamCodeSnapshotDrawer');
    expect(src).toContain('bs.page.data');
    expect(src).toMatch(/\.examMode\b/);
  });
});
