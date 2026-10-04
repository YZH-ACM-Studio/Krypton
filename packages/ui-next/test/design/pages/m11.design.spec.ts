// @vitest-environment node
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { StructuredProblemMetadataPanel } from '@/components/structured-problem-metadata-panel';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/components/structured-problem-metadata-panel.tsx',
  'src/components/managed-programming-authority.tsx',
  'src/components/practice-integrity-policy-panel.tsx',
  'src/components/problem-data-write-guard.tsx',
  'src/components/problem-authoring-state.tsx',
] as const;

const METADATA = 'src/components/structured-problem-metadata-panel.tsx';
const AUTHORITY = 'src/components/managed-programming-authority.tsx';
const WRITE_GUARD = 'src/components/problem-data-write-guard.tsx';

/** PLAN M11：难度值保持字符串 '0'…'10'，由 String(level.value) 生成。 */
const DIFFICULTY_FROM_LEVELS = /DIFFICULTY_LEVELS\.map\(\(([A-Za-z_$][\w$]*)\)=>\(\{value:String\(\1\.value\),label:\1\.label\}\)\)/;

function usesDifficultyLevels(source: string): boolean {
  return DIFFICULTY_FROM_LEVELS.test(source.replaceAll(/\s+/g, ''));
}

const ALERT_TONE = /\btone\s*=\s*(?:"(warning|neutral)"|'(warning|neutral)'|\{\s*['"](warning|neutral)['"]\s*\})/;

function alertTone(openTag: string): 'warning' | 'neutral' | null {
  const match = ALERT_TONE.exec(openTag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (value === 'warning' || value === 'neutral') return value;
  return null;
}

function allowedAlertBodies(source: string): string[] {
  const bodies: string[] = [];
  let searchFrom = 0;
  for (const tag of findOpenTags(source, 'Alert')) {
    const start = source.indexOf(tag.text, searchFrom);
    if (start < 0) continue;
    const after = start + tag.text.length;
    searchFrom = after;
    if (tag.text.endsWith('/>') || alertTone(tag.text) === null) continue;
    const close = source.indexOf('</Alert>', after);
    if (close < 0) continue;
    bodies.push(source.slice(after, close));
  }
  return bodies;
}

function expectHintInAlert(file: string, hint: string): void {
  const source = readSource(file);
  expect(source.includes(hint), hint).toBe(true);
  const hit = allowedAlertBodies(source).some((body) => body.includes(hint));
  expect(hit, `${file} ${hint}`).toBe(true);
}

function assignGlobal(name: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor?.configurable === false) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** 设计测试文件保持 node，避免 design-gate 的 import.meta.url 在 jsdom 下失效。 */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const view = dom.window;
  assignGlobal('window', view);
  assignGlobal('document', view.document);
  assignGlobal('navigator', view.navigator);
  assignGlobal('HTMLElement', view.HTMLElement);
  assignGlobal('HTMLFormElement', view.HTMLFormElement);
  assignGlobal('HTMLInputElement', view.HTMLInputElement);
  assignGlobal('Element', view.Element);
  assignGlobal('Node', view.Node);
  assignGlobal('SVGElement', view.SVGElement);
  assignGlobal('DocumentFragment', view.DocumentFragment);
  assignGlobal('MutationObserver', view.MutationObserver);
  assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
  assignGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  assignGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  assignGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  assignGlobal('IntersectionObserver', class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  });
  assignGlobal('matchMedia', (query: string) => ({
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
  }));
  assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const elementProto = view.Element.prototype;
  if (!elementProto.scrollIntoView) elementProto.scrollIntoView = () => {};
  if (!elementProto.hasPointerCapture) elementProto.hasPointerCapture = () => false;
  if (!elementProto.setPointerCapture) elementProto.setPointerCapture = () => {};
  if (!elementProto.releasePointerCapture) elementProto.releasePointerCapture = () => {};
}

/** 与客观题编辑器保存相同：FormData 再编成 URLSearchParams。未勾选的 checkbox 不会出现。 */
function saveBody(container: ParentNode): URLSearchParams {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new TypeError('expected a form');
  }
  const data = new window.FormData(form);
  return new URLSearchParams(Array.from(data, ([key, value]) => [key, String(value)]));
}

describe('m11 problem metadata and authoring panels', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('删除 DIFFICULTY_OPTIONS 并改用字符串难度值', () => {
    const src = readSource(METADATA);
    expect(src).not.toMatch(/\bDIFFICULTY_OPTIONS\b/);
    expect(usesDifficultyLevels(src)).toBe(true);
  });

  it('结构锁定提示使用 Alert', () => {
    expectHintInAlert(METADATA, '题目结构已锁定；本侧元数据仍可保存，但题号不可修改。');
    expectHintInAlert(METADATA, '{visibilityLockedReason}');
    expectHintInAlert(METADATA, '当前表单有未保存修改，请先保存或撤销后再切换导图。');
  });

  it('只读审核说明使用 Alert', () => {
    expectHintInAlert(AUTHORITY, '该题已完成审核确认；当前来源、标签和所属训练均为只读。');
  });

  it('赛中写入锁定提示使用 Alert', () => {
    expectHintInAlert(WRITE_GUARD, '此题正在比赛或考试中使用');
    expectHintInAlert(WRITE_GUARD, '当前角色不能在比赛或考试进行中修改');
  });

  it('取消隐藏题目后保存请求仍带 hidden=false', async () => {
    installDom();
    const { cleanup, render, within } = await import('@testing-library/react');
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const view = render(createElement(
      'form',
      { method: 'post' },
      createElement(StructuredProblemMetadataPanel, {
        pdoc: { docId: 1, title: '已隐藏题', hidden: true, difficulty: 0 },
        isCreate: false,
        locked: false,
        knowledgeMaps: [],
        mindmapOptions: [],
        canUseCustomPid: false,
        formDirty: false,
        onMetadataChange: () => undefined,
      }),
    ));
    try {
      const toggle = within(view.container).getByRole('switch', { name: '隐藏题目' });
      expect(toggle).toBeChecked();
      await user.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(saveBody(view.container).get('hidden')).toBe('false');
    } finally {
      view.unmount();
      cleanup();
    }
  });
});
