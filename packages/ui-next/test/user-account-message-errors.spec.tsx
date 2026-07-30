import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { MessagesPanel } from '../src/pages/user-account';

const failureBody = JSON.stringify({
  error: {
    name: 'PermissionError',
    errorCode: 'PermissionError',
    code: 403,
    status: 403,
    params: [],
    message: '无权执行消息操作。',
  },
});

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
        messages: {
          3: {
            udoc: { _id: 3, uname: 'Alice' },
            messages: [
              {
                _id: '66a72f000000000000000001',
                from: 2,
                to: 3,
                content: '保留这条消息',
              },
            ],
          },
        },
      },
    },
  };
}

function renderPanel(messages = (bootstrap().page.data as { messages: unknown }).messages) {
  const data = bootstrap();
  data.page.data = { messages };
  return render(
    <BootstrapProvider bootstrap={data}>
      <MessagesPanel />
    </BootstrapProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('user account message failures', () => {
  it('shows the authoritative send error and keeps the draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(failureBody, { status: 403 })));
    renderPanel();

    const composer = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(composer, { target: { value: '不要丢失的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('无权执行消息操作。');
    expect(composer).toHaveValue('不要丢失的草稿');
  });

  it('shows the authoritative delete error and keeps the message locally', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(failureBody, { status: 403 })));
    renderPanel();

    fireEvent.click(screen.getByTitle('删除'));
    const deleteButtons = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('无权执行消息操作。');
    expect(screen.getAllByText('保留这条消息')).toHaveLength(2);
  });

  it('shows a polling error instead of silently serving stale messages and clears it after recovery', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const messages = bootstrap().page.data as { messages: unknown };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(failureBody, { status: 403 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ messages: messages.messages }), { status: 200 })),
    );
    renderPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('无权执行消息操作。');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a polling error when there is no active conversation', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(failureBody, { status: 403 })));
    renderPanel({});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('无权执行消息操作。');
    expect(screen.getByText('选择一个会话')).toBeInTheDocument();
  });
});
