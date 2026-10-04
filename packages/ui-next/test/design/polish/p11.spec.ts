// @vitest-environment node
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { expectGateClean, readSource } from '../helpers.ts';
import type { MindmapNode } from '../../../src/pages/mindmap/types.ts';

const LANE_FILES = [
  'src/pages/mindmap/canvas.tsx',
  'src/pages/mindmap/outline.tsx',
  'src/pages/mindmap/inspector.tsx',
  'src/pages/mindmap/index.tsx',
] as const;

const CANVAS = 'src/pages/mindmap/canvas.tsx';

const OPACITY_UTILITY = /\bopacity-\d/;

const OUTLINE_FOCUS = [
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-ring',
] as const;

interface RootColorInput {
  color?: string;
  isRoot?: boolean;
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function classNameBefore(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) return '';
  const classAt = source.lastIndexOf('className=', at);
  if (classAt < 0) return '';
  const slice = source.slice(classAt, at);
  const literal = /className="([^"]*)"/.exec(slice);
  if (literal?.[1] !== undefined) return literal[1];
  const expression = /className=\{([\s\S]*)\}/.exec(slice);
  return expression?.[1] ?? '';
}

function isRootNodeColor(value: unknown): value is (node: RootColorInput) => string {
  return typeof value === 'function';
}

function outlineNode(id: string, parentId: string | null, order: number, topic: string): MindmapNode {
  return {
    _id: id,
    mapId: 'map-a',
    parentId,
    topic,
    tags: [],
    problemIds: [],
    order,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function classTokens(element: Element): Set<string> {
  return new Set((element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0));
}

function installOutlineDom(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('navigator', win.navigator);
  vi.stubGlobal('HTMLElement', win.HTMLElement);
  vi.stubGlobal('Element', win.Element);
  vi.stubGlobal('Node', win.Node);
  vi.stubGlobal('DocumentFragment', win.DocumentFragment);
  vi.stubGlobal('MutationObserver', win.MutationObserver);
  vi.stubGlobal('getComputedStyle', win.getComputedStyle.bind(win));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return win.document;
}

async function rootNodeColor(node: RootColorInput): Promise<string> {
  const canvas = await import('../../../src/pages/mindmap/canvas.tsx');
  const pick: unknown = Reflect.get(canvas, 'rootNodeColor');
  expect(isRootNodeColor(pick), 'canvas.tsx 必须导出 rootNodeColor').toBe(true);
  if (!isRootNodeColor(pick)) {
    throw new TypeError('canvas.tsx 必须导出 rootNodeColor');
  }
  return pick(node);
}

describe('p11 mindmap node titles, root color, outline focus, muted nodes', () => {
  it('节点标题 class 含 line-clamp-2', () => {
    const title = classNameBefore(readSource(CANVAS), '{data.topic}');
    expect(title).toContain('line-clamp-2');
  });

  it('有保存色时根节点取色函数返回保存色', async () => {
    expect(await rootNodeColor({ color: 'rose', isRoot: true })).toBe('rose');
    expect(await rootNodeColor({ color: 'sky', isRoot: true })).toBe('sky');
    expect(await rootNodeColor({ color: 'gray', isRoot: true })).toBe('gray');
  });

  it('没有保存色时根节点默认不是已保存色', async () => {
    const fallback = await rootNodeColor({ isRoot: true });
    expect(fallback).not.toBe('rose');
    expect(fallback).not.toBe('sky');
    expect(fallback).not.toBe('gray');
  });

  it('画布读取节点颜色字段时调用取色函数', () => {
    const source = readSource(CANVAS);
    const view = functionBody(source, 'MindmapNodeView');
    expect(view).toContain('data.color');
    const calls = source.match(/\brootNodeColor\s*\(/g) ?? [];
    const defs = source.match(/function rootNodeColor\s*\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(defs.length);
  });

  it('大纲项键盘焦点可见，且 outline-none 不取消焦点环', async () => {
    const doc = installOutlineDom();
    const { createElement } = await import('react');
    const { cleanup, render } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const { MindmapOutline } = await import('../../../src/pages/mindmap/outline.tsx');
    try {
      const view = render(createElement(MindmapOutline, {
        nodes: [outlineNode('root', null, 0, '根节点')],
        rootId: 'root',
        selectedId: null,
        expanded: new Set<string>(),
        referenceCounts: {},
        busy: false,
        onSelect: () => {},
        onExpandedChange: () => {},
        onMove: () => {},
        onCreateChild: () => {},
        onCreateSibling: () => {},
        onDelete: () => {},
      }), { container: doc.body });
      const item = view.getByRole('treeitem');
      const user = userEvent.setup({ document: doc });
      for (let step = 0; step < 12 && doc.activeElement !== item; step += 1) {
        await user.tab();
      }
      expect(doc.activeElement, 'Tab 应落到大纲项').toBe(item);
      const tokens = classTokens(item);
      for (const token of OUTLINE_FOCUS) {
        expect(tokens.has(token), `聚焦的大纲项应含 ${token}`).toBe(true);
      }
      expect(tokens.has('outline-none'), 'outline-none 会把 focus-visible 焦点环消掉').toBe(false);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('四个文件不匹配 opacity-数字 工具类', () => {
    const hits = LANE_FILES.flatMap((file) => readSource(file).split('\n').flatMap((line, index) => (
      OPACITY_UTILITY.test(line) ? [`${file}:${index + 1} ${line.trim()}`] : []
    )));
    expect(hits).toEqual([]);
  });

  it('弱化节点使用 text-fg-subtle 与 border-line-subtle', () => {
    const source = readSource(CANVAS);
    expect(source.includes('text-fg-subtle'), '弱化节点应使用 text-fg-subtle').toBe(true);
    expect(source.includes('border-line-subtle'), '弱化节点应使用 border-line-subtle').toBe(true);
  });

  it('设计门禁对本 lane 文件为零违规', () => {
    expectGateClean([...LANE_FILES]);
  });
});
