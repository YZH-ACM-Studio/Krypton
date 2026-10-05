// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONTENT_WIDTH } from '../../../src/components/ui/page';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/problem-edit.tsx';
const RENDERER = 'src/components/markdown-renderer.tsx';
const STYLES = 'src/styles.css';
const FORBIDDEN_CLASSES = ['min-h-9', 'sm:w-52', 'min-h-40'] as const;
const MEASURE_UTILITY = /(?:^|\s)max-w-prose(?:\s|$)/;
const CONTAINER_TONE = /(?<![\w-])bg-(?:danger|warning)-soft(?![\w-])/;

function maskButtonOpenTags(source: string): string {
  let masked = source;
  for (const tag of findOpenTags(source, 'Button')) {
    const at = masked.indexOf(tag.text);
    if (at < 0) continue;
    masked = `${masked.slice(0, at)}${' '.repeat(tag.text.length)}${masked.slice(at + tag.text.length)}`;
  }
  return masked;
}

function lineHits(source: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (pattern.test(line)) hits.push(`${index + 1}:${line.trim()}`);
  }
  return hits;
}

function classTokenPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
}

function elementBlocks(source: string, tag: string): string[] {
  const blocks: string[] = [];
  const closeNeedle = `</${tag}>`;
  let from = 0;
  for (const open of findOpenTags(source, tag)) {
    const start = source.indexOf(open.text, from);
    if (start < 0) continue;
    const close = source.indexOf(closeNeedle, start + open.text.length);
    if (close < 0) continue;
    blocks.push(source.slice(start, close + closeNeedle.length));
    from = start + open.text.length;
  }
  return blocks;
}

function proseClassName(): string {
  const match = /const PROSE_CLASS = ['"]([^'"]+)['"]/.exec(readSource(RENDERER));
  expect(match?.[1], 'markdown-renderer PROSE_CLASS').toBeTruthy();
  return match?.[1] ?? '';
}

function proseRuleSetsMeasure(css: string, proseClass: string): boolean {
  const token = `.${proseClass}`;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = match[2] ?? '';
    const selectors = (match[1] ?? '').split(',');
    for (const selector of selectors) {
      const trimmed = selector.trim();
      if (trimmed !== token && !new RegExp(`^\\.${proseClass}(?::[\\w-]+(?:\\([^)]*\\))?)*$`).test(trimmed)) continue;
      if (/max-width\s*:\s*(?:\d+(?:\.\d+)?(?:ch|rem|em|px)|var\(--[^)]+\))/.test(body)) return true;
    }
  }
  return false;
}

function literalClassName(openTag: string): string | undefined {
  const quoted = /className=(?:"([^"]*)"|'([^']*)')/.exec(openTag);
  if (quoted) return quoted[1] ?? quoted[2] ?? '';
  expect(openTag.includes('className='), openTag).toBe(false);
  return undefined;
}

/** helpers 依赖 design-gate 的 file URL，本文件保持 node；只有行宽断言临时挂 DOM。 */
async function renderedClassText(className: string | undefined, proseClass: string): Promise<string> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const { window } = dom;
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'getComputedStyle'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globals) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('HTMLElement', window.HTMLElement);
  define('Element', window.Element);
  define('Node', window.Node);
  define('DocumentFragment', window.DocumentFragment);
  define('MutationObserver', window.MutationObserver);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
  try {
    const react = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { MarkdownView } = await import('../../../src/components/markdown-renderer');
    const host = window.document.createElement('div');
    window.document.body.append(host);
    const root = createRoot(host);
    await react.act(async () => {
      root.render(react.createElement(MarkdownView, { content: '题面段落', className }));
    });
    const view = host.firstElementChild;
    expect(view, 'MarkdownView root').not.toBeNull();
    const prose = view?.classList.contains(proseClass) === true ? view : view?.querySelector(`.${proseClass}`) ?? null;
    expect(prose, `rendered ${proseClass}`).not.toBeNull();
    const text = `${view?.className ?? ''} ${prose?.className ?? ''}`;
    await react.act(async () => {
      root.unmount();
    });
    return text;
  } finally {
    dom.window.close();
    for (const key of globals) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
}

function hasLineMeasure(classText: string, proseClass: string): boolean {
  const tokens = classText.split(/\s+/).filter((token) => token.length > 0);
  if (proseRuleSetsMeasure(readSource(STYLES), proseClass) && tokens.includes(proseClass)) return true;
  if (MEASURE_UTILITY.test(classText)) return true;
  return tokens.includes(CONTENT_WIDTH.prose);
}

function buttonParts(block: string): { open: string; body: string }[] {
  const parts: { open: string; body: string }[] = [];
  let from = 0;
  for (const tag of findOpenTags(block, 'Button')) {
    const start = block.indexOf(tag.text, from);
    if (start < 0) continue;
    const openEnd = start + tag.text.length;
    const close = block.indexOf('</Button>', openEnd);
    parts.push({ open: tag.text, body: close < 0 ? '' : block.slice(openEnd, close) });
    from = openEnd;
  }
  return parts;
}

describe('q08 problem edit panels, danger zone, alerts, save', () => {
  it('button 开标签之外没有 bg-danger-soft 或 bg-warning-soft 容器背景', () => {
    const hits = lineHits(maskButtonOpenTags(readSource(PAGE)), CONTAINER_TONE);
    expect(hits).toEqual([]);
  });

  it('含 title="危险操作"', () => {
    expect(readSource(PAGE).includes('title="危险操作"')).toBe(true);
  });

  it('不含 min-h-9、sm:w-52、min-h-40', () => {
    const source = readSource(PAGE);
    const hits = FORBIDDEN_CLASSES.flatMap((token) => lineHits(source, classTokenPattern(token)));
    expect(hits).toEqual([]);
  });

  it('题面 MarkdownView 渲染后的 class 有行宽，而不是空的 prose 或 max-w-none', async () => {
    const proseClass = proseClassName();
    const tags = findOpenTags(readSource(PAGE), 'MarkdownView');
    expect(tags.length).toBeGreaterThanOrEqual(2);
    for (const tag of tags) {
      const className = literalClassName(tag.text);
      const rendered = await renderedClassText(className, proseClass);
      expect(rendered.split(/\s+/).includes('max-w-none'), rendered).toBe(false);
      expect(hasLineMeasure(rendered, proseClass), rendered).toBe(true);
    }
  });

  it('页脚文本含「保存」的按钮开标签是 variant="primary"，且不含 canSubmitProblem ?', () => {
    // 可见文案保持「保存修改」；验收里的「保存」指这个页脚动作，不要求改成恰好两个字。
    const opens = elementBlocks(readSource(PAGE), 'footer').flatMap((footer) => (
      buttonParts(footer).filter((part) => part.body.includes('保存')).map((part) => part.open)
    ));
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) {
      expect(open).toContain('variant="primary"');
      expect(open).not.toContain('canSubmitProblem ?');
    }
  });

  it('alert 至少 4 次，保存失败仍在，且 saveError 不与 text-danger-fg 同一 JSX 行', () => {
    const source = readSource(PAGE);
    expect(findOpenTags(source, 'Alert').length).toBeGreaterThanOrEqual(4);
    expect(elementBlocks(source, 'Alert').some((block) => block.includes('{saveError}') && block.includes('tone="danger"'))).toBe(true);
    expect(source).toContain('保存失败');
    const collisions = source.split('\n').flatMap((line, index) => {
      const jsx = line.includes('<') || line.includes('{') || line.includes('}');
      if (jsx && line.includes('text-danger-fg') && line.includes('saveError')) return [`${index + 1}:${line.trim()}`];
      return [];
    });
    expect(collisions).toEqual([]);
  });

  it('设计门禁对本 lane 文件退出码为 0', () => {
    expectGateClean([PAGE]);
  });
});
