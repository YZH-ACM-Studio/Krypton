import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap';
import { MyVerifyInboxPage } from '../../../src/pages/permits/inbox';

// 桩打在页面调用的 fetchHydroResponse 上。真实 helper 会把 fetch 的 TypeError 改写成 fallback。
const { fetchHydroResponse } = vi.hoisted(() => ({
  fetchHydroResponse: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock('@/lib/error-presenter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/error-presenter')>('@/lib/error-presenter');
  return {
    ...actual,
    fetchHydroResponse,
  };
});

interface InboxPermit {
  _id: string;
  pid: number;
  uid: number;
  role: 'verifier' | 'author' | 'maintainer';
  grantedBy: number;
  grantedAt: string;
  viaContest: string | null;
  note: string;
}

interface InboxData {
  permits: InboxPermit[];
  contributions: [];
  pdict: Record<string, { docId: number; pid: string; title: string }>;
  udict: Record<string, { _id: number; uname: string }>;
  tdict: Record<string, { _id: string; title: string }>;
}

function makeBootstrap(data: InboxData): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: {
      id: 2,
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
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { problemDetail: '/p/__PID__' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'permits_inbox.html', data },
  };
}

function directInbox(): InboxData {
  return {
    permits: [
      {
        _id: 'permit-direct',
        pid: 42,
        uid: 2,
        role: 'author',
        grantedBy: 9,
        grantedAt: '2026-10-01T00:00:00.000Z',
        viaContest: null,
        note: '',
      },
    ],
    contributions: [],
    pdict: { 42: { docId: 42, pid: 'P0042', title: '最短路' } },
    udict: { 9: { _id: 9, uname: 'teacher' } },
    tdict: {},
  };
}

function contestInbox(): InboxData {
  return {
    permits: [
      {
        _id: 'permit-contest',
        pid: 7,
        uid: 2,
        role: 'verifier',
        grantedBy: 9,
        grantedAt: '2026-10-01T00:00:00.000Z',
        viaContest: 'school-2026',
        note: '',
      },
    ],
    contributions: [],
    pdict: { 7: { docId: 7, pid: 'P0007', title: '迷宫' } },
    udict: { 9: { _id: 9, uname: 'teacher' } },
    tdict: { 'school-2026': { _id: 'school-2026', title: '校赛' } },
  };
}

async function renderInbox(data: InboxData) {
  render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <MyVerifyInboxPage />
    </BootstrapProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function confirmLeave(message: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '退出' }));
  const dialog = await screen.findByRole('dialog', { name: '确认' });
  expect(visibleText(dialog)).toContain(message);
  await user.click(screen.getByRole('button', { name: '确认' }));
}

async function expectNetworkFailureAlert(url: string) {
  await waitFor(() => {
    expect(fetchHydroResponse).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST' }));
  });
  const alert = await screen.findByRole('alert');
  expect(visibleText(alert)).toContain('Failed to fetch');
  const leave = screen.getByRole('button', { name: '退出' });
  expect(leave.hasAttribute('disabled')).toBe(false);
  expect(leave.getAttribute('aria-disabled')).not.toBe('true');
}

describe('q12 permits inbox leave request network failure', () => {
  beforeEach(() => {
    fetchHydroResponse.mockReset();
    fetchHydroResponse.mockRejectedValue(new TypeError('Failed to fetch'));
  });

  it('直接邀请的退出在断网时显示 alert，按钮恢复可点击', async () => {
    await renderInbox(directInbox());
    expect(screen.queryByRole('alert')).toBeNull();
    await confirmLeave('退出该题目的协作角色？');
    await expectNetworkFailureAlert('/p/42/permits/revoke');
  });

  it('比赛验题的退出在断网时显示 alert，按钮恢复可点击', async () => {
    await renderInbox(contestInbox());
    expect(screen.queryByRole('alert')).toBeNull();
    await confirmLeave('退出该比赛的验题角色？');
    await expectNetworkFailureAlert('/contest/school-2026/verifiers/remove');
  });
});
