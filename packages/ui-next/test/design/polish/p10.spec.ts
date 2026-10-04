// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap';
import { MessagesPanel } from '../../../src/pages/user-account';

const LANE_FILES = [
  'src/pages/messages/thread.tsx',
  'src/pages/messages/panel.tsx',
  'src/pages/messages/composer.tsx',
] as const;

const LIST_TOKENS = ['min-h-0', 'flex-1', 'overflow-y-auto'] as const;

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-07-30T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      userDetail: '/user/__UID__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'home_messages.html',
      data: {
        messages: {},
      },
    },
  };
}

function messageId(index: number): string {
  return `${(0x66a72f00 + index).toString(16).padStart(8, '0')}0000000000000000`;
}

function messagesPayload(count: number): Record<string, unknown> {
  return {
    3: {
      udoc: { _id: 3, uname: 'Alice' },
      messages: Array.from({ length: count }, (_, offset) => {
        const index = offset + 1;
        return {
          _id: messageId(index),
          from: 3,
          to: 2,
          content: `线程消息 ${index}`,
        };
      }),
    },
  };
}

function renderPanel(messages: unknown) {
  const data = bootstrap();
  data.page.data = { messages };
  return render(createElement(BootstrapProvider, { bootstrap: data }, createElement(MessagesPanel)));
}

function resetClientState(): void {
  window.history.replaceState({}, '', '/home/messages?target=3');
  sessionStorage.clear();
  localStorage.clear();
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasListTokens(element: Element): boolean {
  const present = new Set(classTokens(element));
  return LIST_TOKENS.every((token) => present.has(token));
}

/** The message list is the scroller: it holds the thread text and not the composer. */
function messageLists(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('*')].filter((element) => {
    if (!hasListTokens(element)) return false;
    if (!(element.textContent ?? '').includes('线程消息 1')) return false;
    return element.querySelector('textarea') === null;
  });
}

function composerArea(container: HTMLElement): HTMLElement {
  const field = container.querySelector('textarea');
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new TypeError('输入框不存在');
  }
  const send = screen.getByRole('button', { name: '发送' });
  const ancestors = new Set<HTMLElement>();
  let node: HTMLElement | null = field;
  while (node) {
    ancestors.add(node);
    node = node.parentElement;
  }
  node = send;
  while (node) {
    if (ancestors.has(node)) return node;
    node = node.parentElement;
  }
  throw new TypeError('输入区不存在');
}

function innermostMessageList(container: HTMLElement): HTMLElement {
  const matches = messageLists(container);
  const leaves = matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
  expect(leaves.map(() => LIST_TOKENS.join(' '))).toContain(LIST_TOKENS.join(' '));
  const list = leaves[0];
  if (!(list instanceof HTMLElement)) {
    throw new TypeError('消息列表不存在');
  }
  return list;
}

function setScrollBox(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
}

function uiNextRoot(): string {
  const url = import.meta.url;
  if (url.startsWith('file:')) {
    return resolve(dirname(fileURLToPath(url)), '../../..');
  }
  return process.cwd();
}

beforeEach(() => {
  resetClientState();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: {} }), { status: 200 })),
  );
});

afterEach(() => {
  resetClientState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('p10 messages thread layout', () => {
  it('消息列表同时含 min-h-0、flex-1、overflow-y-auto，输入区含 shrink-0', () => {
    const view = renderPanel(messagesPayload(1));
    const lists = messageLists(view.container);
    const input = composerArea(view.container);
    const inputClass = input.getAttribute('class') ?? '';
    expect([
      lists.length > 0 ? LIST_TOKENS.join(' ') : 'list:missing',
      classTokens(input).includes('shrink-0') ? 'input:shrink-0' : `input:${inputClass}`,
    ]).toEqual([LIST_TOKENS.join(' '), 'input:shrink-0']);
  });

  it('渲染 30 条消息、把列表 scrollTop 设为 0 后追加一条，出现新消息提示', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: messagesPayload(31) }), { status: 200 })),
    );
    const view = renderPanel(messagesPayload(30));
    const list = innermostMessageList(view.container);
    setScrollBox(list, 4000, 400);
    // Mount schedules a stick-to-bottom frame; let it run before the user scrolls up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    list.scrollTop = 0;
    fireEvent.scroll(list);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getAllByText('线程消息 31').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /新消息/ })).toBeInTheDocument();
  });

  it('thread、panel、composer 设计门禁为零违规', () => {
    const root = uiNextRoot();
    for (const file of LANE_FILES) {
      execFileSync('node', ['scripts/design-gate.mjs', '--file', file], { cwd: root, stdio: 'pipe' });
    }
  });
});
