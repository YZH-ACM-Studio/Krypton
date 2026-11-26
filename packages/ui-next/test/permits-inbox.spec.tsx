import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { MyVerifyInboxPage } from '../src/pages/permits/inbox';

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

vi.mock('@/components/competitive-companion-bridge', () => ({
  SendProblemToCph: ({ href }: { href: string }) => (
    <button type="button" data-cph-href={href}>
      发送到 CPH
    </button>
  ),
}));

function makeBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-11-20T02:00:00.000Z',
    user: {
      id: 10,
      name: 'tester',
      mail: 'tester@example.test',
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
    page: { templateName: 'my_verify_inbox.html', data },
  };
}

function emptyInboxData() {
  return {
    permits: [],
    contributions: [],
    pdict: {},
    udict: {},
    tdict: {},
  };
}

function richInboxData() {
  return {
    permits: [
      {
        _id: 'permit-verifier',
        pid: 5012,
        uid: 10,
        role: 'verifier',
        grantedBy: 2,
        grantedAt: '2026-11-19T08:30:00.000Z',
        viaContest: null,
        note: '请测试 1000 ms 时限边界',
      },
      {
        _id: 'permit-managed-maintainer',
        pid: 5024,
        uid: 10,
        role: 'maintainer',
        grantedBy: 2,
        grantedAt: '2026-11-01T09:00:00.000Z',
        viaContest: null,
        note: '负责后续审核维护',
      },
      {
        _id: 'permit-contest-1',
        pid: 6001,
        uid: 10,
        role: 'verifier',
        grantedBy: 5,
        grantedAt: '2026-11-19T12:00:00.000Z',
        viaContest: 'contest-1',
        note: '开赛前验完标程',
      },
      {
        _id: 'permit-contest-2',
        pid: 6002,
        uid: 10,
        role: 'verifier',
        grantedBy: 5,
        grantedAt: '2026-11-19T12:00:00.000Z',
        viaContest: 'contest-1',
        note: '开赛前验完标程',
      },
    ],
    contributions: [
      {
        _id: 'contrib-data-pending',
        pid: 5012,
        uid: 10,
        scope: 'data',
        active: true,
        status: 'pending',
        note: '补充极限卡常数据',
        assignedBy: 2,
        assignedAt: '2026-11-20T01:00:00.000Z',
      },
      {
        _id: 'contrib-tag-done',
        pid: 5031,
        uid: 10,
        scope: 'tag',
        active: true,
        status: 'completed',
        note: '挂载图论节点',
        assignedBy: 5,
        assignedAt: '2026-11-02T02:00:00.000Z',
        firstCompletedAt: '2026-11-05T06:00:00.000Z',
      },
      {
        _id: 'contrib-inactive',
        pid: 5099,
        uid: 10,
        scope: 'data',
        active: false,
        status: 'pending',
        assignedBy: 2,
        assignedAt: '2026-11-10T00:00:00.000Z',
      },
    ],
    pdict: {
      5012: { docId: 5012, pid: 'P5012', title: '区间最小覆盖点数', hidden: true, difficulty: 3, authoringMode: 'managed' },
      5024: { docId: 5024, pid: 'P5024', title: '树上路径异或最大值', hidden: true, lockHidden: true, difficulty: 5, authoringMode: 'managed' },
      5031: { docId: 5031, pid: 'P5031', title: '双栈模拟队列', hidden: false, difficulty: 2, authoringMode: 'managed' },
      6001: { docId: 6001, pid: 'C1001', title: '有效打卡天数', hidden: true, lockHidden: true, difficulty: 1 },
      6002: { docId: 6002, pid: 'C1002', title: '环形最大子段和', hidden: true, difficulty: 3 },
    },
    udict: {
      2: { _id: 2, uname: '林老师' },
      5: { _id: 5, uname: '王教练' },
    },
    tdict: {
      'contest-1': { _id: 'contest-1', title: '2026 校赛热身赛' },
    },
  };
}

async function renderInbox(data: unknown) {
  render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <MyVerifyInboxPage />
    </BootstrapProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe('permits inbox redesigned layout and interactions', () => {
  beforeEach(() => {
    fetchHydroResponse.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T02:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails fast with a visible alert on null or malformed bootstrap payloads', async () => {
    await renderInbox(null);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('协作数据加载异常');
    expect(screen.queryByText('还没有任何题目协作邀请')).toBeNull();
    expect(screen.queryByRole('tablist', { name: '协作分类' })).toBeNull();
  });

  it('rejects unknown permit roles and malformed viaContest values without silent coercion', async () => {
    const badRole = {
      ...emptyInboxData(),
      permits: [{ _id: 'p1', pid: 100, uid: 10, role: 'superadmin', grantedBy: 2, grantedAt: '', viaContest: null, note: '' }],
    };
    const { unmount } = render(
      <BootstrapProvider bootstrap={makeBootstrap(badRole)}>
        <MyVerifyInboxPage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('协作角色字段格式不正确');
    unmount();

    const badContest = {
      ...emptyInboxData(),
      permits: [{ _id: 'p2', pid: 100, uid: 10, role: 'verifier', grantedBy: 2, grantedAt: '', viaContest: 12345, note: '' }],
    };
    await renderInbox(badContest);
    expect(screen.getByRole('alert').textContent).toContain('比赛来源格式不正确');
  });

  it('renders empty state for a valid empty inbox payload', async () => {
    await renderInbox(emptyInboxData());
    expect(screen.getByText('还没有任何题目协作邀请')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: '协作分类' })).toBeNull();
  });

  it('renders category tabs, notes, subtle dividers, valid anchor buttons, badge caps, and 7-day timestamp formatting', async () => {
    await renderInbox(richInboxData());

    expect(screen.getByRole('heading', { level: 1, name: '我的出题协作' })).toBeInTheDocument();
    const tablist = screen.getByRole('tablist', { name: '协作分类' });
    expect(within(tablist).getByRole('tab', { name: /全部\s*6/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(tablist).getByRole('tab', { name: /贡献任务\s*2/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /直接邀请\s*2/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /比赛验题\s*2/ })).toBeInTheDocument();

    // Permit note and managed maintainer restriction are rendered
    expect(screen.getByText('请测试 1000 ms 时限边界')).toBeInTheDocument();
    expect(screen.getByText('需管理员撤销')).toBeInTheDocument();

    // Contest leave action appears once in the contest panel header rather than once per problem row
    expect(screen.getAllByRole('button', { name: '退出本场验题' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '进入比赛' })).toHaveAttribute('href', '/contest/contest-1');

    // No anchor tag should receive an invalid type="button" from Button asChild
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('type')).toBeNull();
    }

    // 4-badge direct row (P5024: 维护者 + 锁定 + 难度 + 隐藏) caps to 3 inline badges using +2
    expect(screen.getByText('+2')).toBeInTheDocument();
    // 3-badge contest row (C1001: 锁定 + 难度 + 隐藏) preserves 隐藏 alongside 锁定
    const contestRow = screen.getByRole('link', { name: '有效打卡天数' }).closest('li');
    expect(contestRow).not.toBeNull();
    expect(within(contestRow as HTMLElement).getByText('锁定')).toBeInTheDocument();
    expect(within(contestRow as HTMLElement).getByText('隐藏')).toBeInTheDocument();

    // > 7 day timestamp (2026-11-01T09:00Z = 17:00 CST) uses absolute datetime instead of relative
    expect(screen.getByText('2026-11-01 17:00')).toBeInTheDocument();

    // Inactive contribution is ignored
    expect(screen.queryByText('5099')).toBeNull();

    // Subtle hairline dividers are used on list containers
    const lists = document.querySelectorAll('ul');
    expect(lists.length).toBeGreaterThan(0);
    for (const ul of lists) {
      const tokens = ul.className.split(/\s+/);
      expect(tokens).toContain('divide-line-subtle');
      expect(tokens).not.toContain('divide-line');
    }
  });

  it('scopes roleFilter to direct tab, keeps toolbar summary accurate, and distinguishes empty tabs from filtered empty states', async () => {
    const user = userEvent.setup();
    await renderInbox({
      permits: [
        {
          _id: 'permit-verifier',
          pid: 5012,
          uid: 10,
          role: 'verifier',
          grantedBy: 2,
          grantedAt: '2026-11-19T08:30:00.000Z',
          viaContest: null,
          note: '',
        },
      ],
      contributions: [
        {
          _id: 'contrib-data-pending',
          pid: 5012,
          uid: 10,
          scope: 'data',
          active: true,
          status: 'pending',
          assignedBy: 2,
          assignedAt: '2026-11-20T01:00:00.000Z',
        },
      ],
      pdict: { 5012: { docId: 5012, pid: 'P5012', title: '区间最小覆盖点数' } },
      udict: { 2: { _id: 2, uname: '林老师' } },
      tdict: {},
    });

    // All tab shows 2 items and 1 pending contribution
    expect(screen.getByText('共 2 项 · 1 项贡献待完成')).toBeInTheDocument();

    // Switching to contests tab (empty, no active filter) shows category-empty copy without clear button
    await user.click(screen.getByRole('tab', { name: /比赛验题/ }));
    expect(screen.getByText('共 0 项')).toBeInTheDocument();
    expect(screen.queryByText(/贡献待完成/)).toBeNull();
    expect(screen.getByText('当前分类下还没有协作任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();

    // Selecting a non-matching role on direct tab must NOT leak into the all tab
    await user.click(screen.getByRole('tab', { name: /直接邀请/ }));
    expect(screen.getByText('共 1 项')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: '按角色筛选' }));
    await user.click(await screen.findByRole('option', { name: '出题人' }));
    expect(screen.getByText('没有匹配的协作任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument();

    // Switch back to all tab — direct verifier permit is visible again
    await user.click(screen.getByRole('tab', { name: /全部/ }));
    expect(screen.getByText('共 2 项 · 1 项贡献待完成')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '直接邀请' })).toBeInTheDocument();
  });

  it('switches tabs, filters by search query and scope, expands completed tasks on search, and clears filters', async () => {
    const user = userEvent.setup();
    await renderInbox(richInboxData());

    await user.click(screen.getByRole('tab', { name: /贡献任务/ }));
    expect(screen.queryByRole('heading', { name: '直接邀请' })).toBeNull();
    expect(screen.getByRole('heading', { name: '数据贡献任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '标签贡献任务' })).toBeInTheDocument();

    const scopeTabs = screen.getByRole('tablist', { name: '贡献类型' });
    await user.click(within(scopeTabs).getByRole('tab', { name: '标签' }));
    expect(screen.queryByText('数据贡献任务')).toBeNull();
    expect(screen.getByText('标签贡献任务')).toBeInTheDocument();
    expect(screen.getByText('共 1 项')).toBeInTheDocument();

    // Searching for a completed task automatically opens the completed details drawer
    const search = screen.getByRole('searchbox', { name: '搜索协作任务' });
    await user.type(search, '双栈模拟队列');
    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(true);

    // Search with no match shows filtered empty state, 0 pending summary, and clear button
    await user.clear(search);
    await user.type(search, '不存在的关键词');
    expect(screen.getByText('共 0 项')).toBeInTheDocument();
    expect(screen.getByText('没有匹配的协作任务')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('数据贡献任务')).toBeInTheDocument();
    expect(screen.getByText('标签贡献任务')).toBeInTheDocument();
  });

  it('adapts contest leave copy for maintainer role, shows filtered/total ratio, and handles missing dicts and invalid dates', async () => {
    const user = userEvent.setup();
    await renderInbox({
      permits: [
        {
          _id: 'permit-cm-1',
          pid: 7001,
          uid: 10,
          role: 'maintainer',
          grantedBy: 9,
          grantedAt: 'not-a-date',
          viaContest: 'contest-m',
          note: '整场维护附言',
        },
        {
          _id: 'permit-cm-2',
          pid: 7002,
          uid: 10,
          role: 'maintainer',
          grantedBy: 9,
          grantedAt: 'not-a-date',
          viaContest: 'contest-m',
          note: '第二题单独备注',
        },
      ],
      contributions: [],
      pdict: {
        7001: { pid: 'M7001', title: '图论构造', difficulty: 11 },
      },
      udict: {
        9: { _id: 9, uname: '' },
      },
      tdict: {},
    });

    // Contest falls back to tid when missing from tdict, uses maintainer leave copy, and omits invalid date/difficulty
    expect(screen.getByRole('button', { name: '退出本场维护' })).toBeInTheDocument();
    expect(screen.getByText('UID 9 邀请')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText('未评定')).toBeNull();
    expect(screen.getByText('第二题单独备注')).toBeInTheDocument();

    // Missing pdict entry (7002) is searchable by numeric pid and produces unique menu aria-label
    const search = screen.getByRole('searchbox', { name: '搜索协作任务' });
    await user.type(search, '7002');
    expect(screen.getByText('1 / 2 题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作：7002 题目' })).toBeInTheDocument();
  });

  it('keeps managed maintainer revoke disabled inside the row menu while exposing IDE/edit links', async () => {
    const user = userEvent.setup();
    await renderInbox(richInboxData());

    await user.click(screen.getByRole('tab', { name: /直接邀请/ }));
    expect(screen.getByRole('link', { name: 'IDE' })).toHaveAttribute('href', '/p/P5012?ide=1');
    expect(screen.getByRole('link', { name: '编辑' })).toHaveAttribute('href', '/p/P5024/edit');

    await user.click(screen.getByRole('button', { name: '更多操作：P5024 树上路径异或最大值' }));
    const disabledItem = await screen.findByRole('menuitem', { name: '托管维护者需管理员撤销' });
    expect(disabledItem).toBeDisabled();
    expect(screen.queryByRole('menuitem', { name: '退出此题协作' })).toBeNull();
  });

  it('keeps button label stable while loading and recovers cleanly when marking complete fails', async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    fetchHydroResponse.mockImplementationOnce(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    await renderInbox(richInboxData());

    const button = screen.getByRole('button', { name: '标记完成' });
    await user.click(button);

    await waitFor(() => {
      expect(fetchHydroResponse).toHaveBeenCalledWith(
        '/p/5012/contributions/status',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // Button keeps the same accessible label & width while loading (DESIGN.md §1 #6)
    expect(screen.getByRole('button', { name: '标记完成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '标记完成' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      rejectRequest?.(new TypeError('network down'));
      await Promise.resolve();
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network down');
    expect(screen.getByRole('button', { name: '标记完成' })).not.toBeDisabled();
  });
});
