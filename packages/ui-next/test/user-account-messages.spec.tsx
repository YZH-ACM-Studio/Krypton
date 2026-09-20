import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { MessagesPanel, NARROW_QUERY } from '../src/pages/user-account';
import { DUAL_PANE_TW } from '../src/pages/messages/viewport';

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

const aliceMessage = {
  _id: '66a72f000000000000000001',
  from: 2,
  to: 3,
  content: 'Alice 的线程消息',
};

const bobUnreadMessage = {
  _id: '66a72f100000000000000002',
  from: 4,
  to: 2,
  flag: 1,
  content: 'Bob 的未读消息',
};

function twoConversations() {
  return {
    3: {
      udoc: { _id: 3, uname: 'Alice' },
      messages: [aliceMessage],
    },
    4: {
      udoc: { _id: 4, uname: 'Bob' },
      messages: [bobUnreadMessage],
    },
  };
}

function renderPanel(messages: unknown) {
  const data = bootstrap();
  data.page.data = { messages };
  return render(
    <BootstrapProvider bootstrap={data}>
      <MessagesPanel />
    </BootstrapProvider>,
  );
}

function resetClientState() {
  window.history.replaceState({}, '', '/home/messages');
  sessionStorage.clear();
  localStorage.clear();
}

function emptyCopy() {
  return screen.queryByText('暂无消息') ?? screen.queryByText('选择一个会话');
}

function stubMatchMedia(narrow: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === NARROW_QUERY ? narrow : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return matchMedia;
}

function postFormData(fetchMock: ReturnType<typeof vi.fn>): FormData[] {
  return fetchMock.mock.calls.flatMap((call) => {
    const init = call[1] as RequestInit | undefined;
    return init?.method === 'POST' && init.body instanceof FormData ? [init.body] : [];
  });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('user account messages', () => {
  it('selects the existing conversation from ?target=', () => {
    window.history.replaceState({}, '', '/home/messages?target=3');
    renderPanel(twoConversations());

    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Bob/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /资料/ })).toHaveAttribute('href', '/user/3');
    expect(screen.getAllByText('Alice 的线程消息').length).toBeGreaterThanOrEqual(1);
  });

  it('selects the existing conversation from ?uid=', () => {
    window.history.replaceState({}, '', '/home/messages?uid=4');
    renderPanel(twoConversations());

    expect(screen.getByRole('button', { name: /Bob/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /资料/ })).toHaveAttribute('href', '/user/4');
  });

  it('creates a pending composer for an unknown ?target=', () => {
    window.history.replaceState({}, '', '/home/messages?target=9');
    renderPanel(twoConversations());

    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
    expect(screen.getAllByText('UID 9').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument();
  });

  it('posts operation=send when Enter is pressed in the composer', async () => {
    const messages = {
      3: {
        udoc: { _id: 3, uname: 'Alice' },
        messages: [aliceMessage],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/home/messages?target=3');
    renderPanel(messages);

    const composer = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(composer, { target: { value: '回车发送这条' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(postFormData(fetchMock).length).toBeGreaterThan(0);
    });
    const form = postFormData(fetchMock)[0];
    expect(form.get('operation')).toBe('send');
    expect(form.get('uid')).toBe('3');
    expect(form.get('content')).toBe('回车发送这条');
  });

  it('filters the conversation list by search name', () => {
    window.history.replaceState({}, '', '/home/messages?target=3');
    renderPanel(twoConversations());

    fireEvent.change(screen.getByPlaceholderText(/搜索用户/), { target: { value: 'Alice' } });

    expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
  });

  it('filters to unread conversations with incoming FLAG_UNREAD', () => {
    window.history.replaceState({}, '', '/home/messages?target=3');
    renderPanel(twoConversations());

    fireEvent.click(screen.getByRole('button', { name: '未读' }));

    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alice/ })).not.toBeInTheDocument();
  });

  it('keeps a long last-message preview inside a truncating list row', () => {
    const long = '新的绑定申请 申请人：world2018（UID 1047）还附带很长一段说明文字不要撑破会话列表';
    renderPanel({
      8: {
        udoc: { _id: 8, uname: 'System' },
        messages: [{ _id: '66a72f200000000000000003', from: 1, to: 2, content: long }],
      },
    });
    const preview = screen.getAllByText(long).find((node) => node.classList.contains('truncate'));
    expect(preview).toBeTruthy();
    expect(preview?.className).toMatch(/\bmin-w-0\b/);
    expect(preview?.className).toMatch(/\bflex-1\b/);
    const list = screen.getByRole('list', { name: '会话' });
    expect(list.className).toMatch(/\bmin-w-0\b/);
    expect(list.parentElement?.parentElement?.getAttribute('data-radix-scroll-area-viewport')).toBe('');
  });

  it('does not throw when messages is null or an empty array', () => {
    let view: ReturnType<typeof renderPanel> | undefined;
    expect(() => {
      view = renderPanel(null);
    }).not.toThrow();
    expect(emptyCopy()).toBeInTheDocument();
    view?.unmount();

    expect(() => renderPanel([])).not.toThrow();
    expect(emptyCopy()).toBeInTheDocument();
  });

  it('keeps JS matchMedia on the same OR query as the CSS dual-pane complement', () => {
    expect(NARROW_QUERY).toBe('(max-width: 767px), (max-height: 540px)');
    expect(DUAL_PANE_TW).toBe('[@media(min-width:768px)_and_(min-height:541px)]');
    const panel = readFileSync(resolve(import.meta.dirname, '../src/pages/messages/panel.tsx'), 'utf8');
    const viewport = readFileSync(resolve(import.meta.dirname, '../src/pages/messages/viewport.ts'), 'utf8');
    expect(viewport).toContain(NARROW_QUERY);
    expect(viewport).toContain('(min-width:768px)_and_(min-height:541px)');
    expect(viewport).toContain('max-md');
    expect(viewport).toContain('[@media(max-height:540px)]');
    expect(panel).toContain('matchMedia(NARROW_QUERY)');
    expect(panel).toContain('dualPaneTw');
    expect(panel).not.toContain('min-h-[480px]');
    expect(panel).toMatch(/flex-1/);
    expect(panel).toMatch(/min-h-0/);
  });

  it('subscribes to the shared narrow query', () => {
    const matchMedia = stubMatchMedia(false);
    renderPanel(twoConversations());
    expect(matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
  });

  it('keeps dual pane without a back control when the viewport is wide and tall', () => {
    stubMatchMedia(false);
    renderPanel(twoConversations());

    expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveAttribute('rows', '3');
  });

  it('starts on the conversation list when the viewport is narrow and no target is set', () => {
    stubMatchMedia(true);
    renderPanel(twoConversations());

    expect(screen.getByRole('button', { name: /Alice/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /Bob/ })).not.toHaveAttribute('aria-current');
    expect(screen.queryByPlaceholderText(/输入消息/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });

  it('opens a conversation as a second level with back on a narrow viewport', () => {
    stubMatchMedia(true);
    renderPanel(twoConversations());

    fireEvent.click(screen.getByRole('button', { name: /Alice/ }));

    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveAttribute('rows', '1');
    expect(screen.getByRole('link', { name: /资料/ })).toHaveAttribute('href', '/user/3');

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.queryByPlaceholderText(/输入消息/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice/ })).not.toHaveAttribute('aria-current');
  });

  it('returns to the list on Escape when the viewport is narrow', () => {
    stubMatchMedia(true);
    window.history.replaceState({}, '', '/home/messages?target=3');
    renderPanel(twoConversations());

    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/输入消息/)).not.toBeInTheDocument();
  });
});
