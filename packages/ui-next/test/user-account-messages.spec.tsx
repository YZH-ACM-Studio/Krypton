import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { MessagesPanel } from '../src/pages/user-account';

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
});
