import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ContestEditPage, ContestExamSeatEntry } from '../src/pages/contest-manage.tsx';

const CONTEST_ID = '66bf00000000000000000101';
const SCHOOL_ONE = { schoolId: '66bf00000000000000000102', name: '北校区' };
const SCHOOL_TWO = { schoolId: '66bf00000000000000000103', name: '南校区' };
const GROUP_ONE = { _id: '66bf00000000000000000111', name: '一班', schoolId: SCHOOL_ONE.schoolId };
const GROUP_TWO = { _id: '66bf00000000000000000112', name: '二班', schoolId: SCHOOL_ONE.schoolId };
const GROUP_CROSS_SCHOOL = { _id: '66bf00000000000000000113', name: '南校班', schoolId: SCHOOL_TWO.schoolId };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function fixedContest() {
  return {
    title: '2026 校赛',
    beginAt: '2026-08-20T01:00:00.000Z',
    endAt: '2026-08-20T04:00:00.000Z',
    participationMode: 'individual',
    participantScopeMode: 'schools' as const,
    participantSchoolIds: [SCHOOL_ONE.schoolId],
  };
}

function event(eventId: string, title: string) {
  return {
    eventId,
    schoolId: SCHOOL_ONE.schoolId,
    title,
    type: 'krypton',
    contestId: CONTEST_ID,
    startAt: '2026-08-20T01:00:00.000Z',
    endAt: '2026-08-20T04:00:00.000Z',
  };
}

function pageBootstrap(
  pageName: 'contest_create' | 'contest_edit',
  rule: 'acm' | 'exam',
): KryptonBootstrap {
  const isEdit = pageName === 'contest_edit';
  const tdoc = {
    ...fixedContest(),
    ...(isEdit ? { _id: CONTEST_ID, docId: CONTEST_ID } : {}),
    rule,
    owner: 2,
    pids: [],
    files: [],
    participationMode: 'individual',
    vigilEnabled: isEdit,
    entryMode: isEdit ? 'client_required' : 'open',
  };
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      contests: '/contest',
      contestDetail: '/contest/:TID',
      problemDetail: '/p/:PID',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'contest_edit.html',
      data: {
        page_name: pageName,
        tdoc,
        rules: { acm: 'ACM', exam: '考试' },
        duration: 3,
        pids: '',
        beginAt: tdoc.beginAt,
        scopeSchools: [{ _id: SCHOOL_ONE.schoolId, name: SCHOOL_ONE.name }],
        scopeGroups: [],
        teamBatches: [],
      },
    },
  };
}

function editBootstrap(): KryptonBootstrap {
  return pageBootstrap('contest_edit', 'exam');
}

function createBootstrap(rule: 'acm' | 'exam' = 'exam'): KryptonBootstrap {
  return pageBootstrap('contest_create', rule);
}

function seatEntryCard() {
  const title = screen.getByText('机房座位与赛前预启动');
  const card = title.closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error('ContestExamSeatEntry card is missing');
  return card;
}

function withinSeatEntry() {
  return within(seatEntryCard());
}

function expectNoSeatWorkflow() {
  expect(screen.queryByText('机房座位与赛前预启动')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '进入座位工作台' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '进入所选活动' })).not.toBeInTheDocument();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contest exam seat entry', () => {
  it('does not offer the seat workflow on the create page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [SCHOOL_ONE], pdocs: [] })),
    );

    const { unmount } = render(
      <BootstrapProvider bootstrap={createBootstrap('exam')}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    await waitFor(() => expectNoSeatWorkflow());
    unmount();

    render(
      <BootstrapProvider bootstrap={createBootstrap('acm')}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    await waitFor(() => expectNoSeatWorkflow());
  });

  it('keeps the seat workflow beside the contest editor instead of a narrow stacked card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [SCHOOL_ONE] })),
    );

    render(
      <BootstrapProvider bootstrap={pageBootstrap('contest_edit', 'acm')}>
        <ContestEditPage />
      </BootstrapProvider>,
    );

    const seat = await screen.findByText('机房座位与赛前预启动');
    const card = seat.closest('[data-slot="card"]');
    const layout = card?.parentElement;
    expect(layout?.className).toContain('gap-6');
    expect(layout?.className).toContain('2xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]');
    expect(layout?.querySelector('.max-w-5xl')).toBeNull();
  });

  it('loads contest maintainers into the searchable user picker', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/users') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { args?: { ids?: number[] } };
          expect(body.args?.ids).toEqual([168, 8]);
          return json([
            { _id: 8, uname: 'other', displayName: '另一位' },
            { _id: 168, uname: 'wang', displayName: '王新凯', studentId: '240240001', realName: '王新凯' },
          ]);
        }
        return json({ events: [], schools: [SCHOOL_ONE] });
      }),
    );
    const bootstrap = pageBootstrap('contest_edit', 'acm');
    const data = bootstrap.page.data as { tdoc: { maintainer?: number[] } };
    data.tdoc.maintainer = [168, 8];

    render(
      <BootstrapProvider bootstrap={bootstrap}>
        <ContestEditPage />
      </BootstrapProvider>,
    );

    await user.click(screen.getByRole('button', { name: '访问控制' }));
    expect(await screen.findByText('王新凯')).toBeInTheDocument();
    expect(screen.getByText('另一位')).toBeInTheDocument();
    expect(screen.getByText('#168')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('UID，逗号分隔')).not.toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="maintainer"]')?.value).toBe('168,8');
  });

  it('shows ContestExamSeatEntry on the exam edit page as a chrome sibling', async () => {
    const linked = event('66bf00000000000000000109', '创建后的机房场次');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [linked], schools: [SCHOOL_ONE], pdocs: [] })),
    );

    render(
      <BootstrapProvider bootstrap={editBootstrap()}>
        <ContestEditPage />
      </BootstrapProvider>,
    );

    expect(await screen.findByText('机房座位与赛前预启动')).toBeInTheDocument();
    const seat = withinSeatEntry();
    expect(await seat.findByRole('button', { name: '进入座位工作台' })).toBeInTheDocument();
    expect(seat.getByText('创建后的机房场次')).toBeInTheDocument();
    expect(screen.getByText('返回考试详情')).toBeInTheDocument();
    expect([...document.querySelectorAll('form')].some((form) => form.contains(seatEntryCard()))).toBe(false);
  });

  it('prefills and explicitly creates the only missing exam event from a fixed contest audience', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const posts: Record<string, unknown>[] = [];
    const created = event('66bf00000000000000000104', '2026 校赛');
    const gets: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ event: created });
        }
        gets.push(String(input));
        return json({ events: [], schools: [SCHOOL_ONE, SCHOOL_TWO] });
      }),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} onNavigate={navigate} />);

    const seat = withinSeatEntry();
    expect(await seat.findByText('2026 校赛')).toBeInTheDocument();
    expect(seat.getByRole('combobox', { name: '考试活动学校' })).toHaveTextContent(SCHOOL_ONE.name);
    await user.click(seat.getByRole('button', { name: '创建考试活动并安排座位' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      schoolId: SCHOOL_ONE.schoolId,
      title: '2026 校赛',
      type: 'krypton',
      contestId: CONTEST_ID,
      startAt: '2026-08-20T01:00:00.000Z',
      endAt: '2026-08-20T04:00:00.000Z',
      collaboratorUids: [],
    });
    expect(gets).toEqual([`/api/admin/exam-events?contestId=${CONTEST_ID}`]);
    expect(navigate).toHaveBeenCalledWith(`/admin/exam-infrastructure/events/${created.eventId}/seats`);
  });

  it('opens the only linked event directly', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const linked = event('66bf00000000000000000105', '机房场次 A');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [linked], schools: [SCHOOL_ONE] })),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} onNavigate={navigate} />);

    const seat = withinSeatEntry();
    expect(await seat.findByText('机房场次 A')).toBeInTheDocument();
    expect(seat.getByText(SCHOOL_ONE.name)).toBeInTheDocument();
    await user.click(await seat.findByRole('button', { name: '进入座位工作台' }));
    expect(navigate).toHaveBeenCalledWith(`/admin/exam-infrastructure/events/${linked.eventId}/seats`);
  });

  it('requires an explicit choice when several linked events exist', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const first = event('66bf00000000000000000106', '同名机房场次');
    const second = { ...event('66bf00000000000000000107', '同名机房场次'), schoolId: SCHOOL_TWO.schoolId };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [first, second], schools: [SCHOOL_ONE, SCHOOL_TWO] })),
    );
    render(
      <ContestExamSeatEntry
        tdoc={{ ...fixedContest(), participantScopeMode: 'none', participantSchoolIds: [], assign: ['20260001'] }}
        contestId={CONTEST_ID}
        onNavigate={navigate}
      />,
    );

    const enter = await screen.findByRole('button', { name: '进入所选活动' });
    expect(enter).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: '选择考试活动' }));
    expect(await screen.findByRole('option', { name: /同名机房场次 · 北校区 · .* → / })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /同名机房场次 · 南校区 · .* → / }));
    await user.click(enter);
    expect(navigate).toHaveBeenCalledWith(`/admin/exam-infrastructure/events/${second.eventId}/seats`);
  });

  it('does not offer automatic seating for an invite-only changing audience', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [SCHOOL_ONE] })),
    );
    render(
      <ContestExamSeatEntry
        tdoc={{ ...fixedContest(), participantScopeMode: 'none', participantSchoolIds: [], _code: 'invite' }}
        contestId={CONTEST_ID}
      />,
    );

    expect(await screen.findByText(/完全公开、仅邀请码或尚未定版的团队比赛名单仍会变化/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  });

  it('keeps every linked event hidden when the Contest audience is not fixed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [event('66bf00000000000000000108', '旧机房场次')], schools: [SCHOOL_ONE] })),
    );
    render(<ContestExamSeatEntry tdoc={{ ...fixedContest(), participantScopeMode: 'none', participantSchoolIds: [] }} contestId={CONTEST_ID} />);

    expect(await screen.findByText(/完全公开、仅邀请码或尚未定版的团队比赛名单仍会变化/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '进入座位工作台' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  });

  it('does not treat an unreadable linked-event list as an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    expect(await screen.findByRole('button', { name: '重新读取关联活动' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  });

  it('does not treat a known 4xx create validation as an unknown outcome', async () => {
    const user = userEvent.setup();
    let gets = 0;
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts++;
          return new Response(
            JSON.stringify({
              error: {
                name: 'ValidationError',
                errorCode: 'ValidationError',
                code: 400,
                status: 400,
                params: [],
                message: '时间窗口无效',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        gets++;
        return json({ events: [], schools: [SCHOOL_ONE] });
      }),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    await user.click(await screen.findByRole('button', { name: '创建考试活动并安排座位' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('时间窗口无效');
    expect(screen.queryByRole('button', { name: '再次重读关联活动' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建考试活动并安排座位' })).toBeEnabled();
    expect(posts).toBe(1);
    expect(gets).toBe(1);
  });

  it('treats a 5xx create response as an unknown outcome', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              error: {
                name: 'ServiceUnavailableError',
                errorCode: 'service_unavailable',
                code: 503,
                status: 503,
                params: [],
                message: '考试活动服务暂时不可用',
              },
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return json({ events: [], schools: [SCHOOL_ONE] });
      }),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    await user.click(await screen.findByRole('button', { name: '创建考试活动并安排座位' }));

    expect(await screen.findByRole('button', { name: '再次重读关联活动' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/创建结果仍未知/);
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  });

  it('keeps an already-loaded event entry when a later linked-event refresh fails', async () => {
    const linked = event('66bf0000000000000000010e', '机房场次 A');
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        if (call === 1) return json({ events: [linked], schools: [SCHOOL_ONE] });
        return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { rerender } = render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);
    expect(await screen.findByRole('button', { name: '进入座位工作台' })).toBeInTheDocument();

    rerender(<ContestExamSeatEntry tdoc={fixedContest()} contestId="66bf00000000000000000199" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/加载比赛考试活动失败|暂时不可用|无法解析/);
    expect(screen.getByRole('button', { name: '进入座位工作台' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新读取关联活动' })).not.toBeInTheDocument();
  });

  it('keeps creation blocked when a lost create response is followed by an empty recovery read', async () => {
    const user = userEvent.setup();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        call++;
        if (init?.method === 'POST') throw new TypeError('create response lost');
        return json({ events: [], schools: [SCHOOL_ONE] });
      }),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    await user.click(await screen.findByRole('button', { name: '创建考试活动并安排座位' }));

    expect(await screen.findByRole('button', { name: '再次重读关联活动' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/创建结果仍未知/);
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
    expect(call).toBe(3);
  });

  it('converges a lost create response to the canonical linked event without allowing a duplicate', async () => {
    const user = userEvent.setup();
    const linked = event('66bf0000000000000000010a', '已创建机房场次');
    let getCount = 0;
    let postCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCount++;
          throw new TypeError('create response lost');
        }
        getCount++;
        return json({ events: getCount === 1 ? [] : [linked], schools: [SCHOOL_ONE] });
      }),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    await user.click(await screen.findByRole('button', { name: '创建考试活动并安排座位' }));

    expect(await screen.findByRole('button', { name: '进入座位工作台' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
    expect(postCount).toBe(1);
  });

  it('filters wrong-school historical events and keeps the fixed school creation path available', async () => {
    const wrongSchoolEvent = { ...event('66bf0000000000000000010b', '南校区旧场次'), schoolId: SCHOOL_TWO.schoolId };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [wrongSchoolEvent], schools: [SCHOOL_ONE, SCHOOL_TWO] })),
    );
    render(<ContestExamSeatEntry tdoc={fixedContest()} contestId={CONTEST_ID} />);

    expect(await screen.findByText(/已忽略 1 个学校与当前固定参赛范围不一致/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '考试活动学校' })).toHaveTextContent(SCHOOL_ONE.name);
    expect(screen.getByRole('button', { name: '创建考试活动并安排座位' })).toBeEnabled();
  });

  it('derives one fixed school from same-school participant groups', async () => {
    const wrongSchoolEvent = { ...event('66bf0000000000000000010c', '南校区旧场次'), schoolId: SCHOOL_TWO.schoolId };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [wrongSchoolEvent], schools: [SCHOOL_ONE, SCHOOL_TWO] })),
    );
    render(
      <ContestExamSeatEntry
        tdoc={{
          ...fixedContest(),
          participantScopeMode: 'groups',
          participantSchoolIds: [],
          participantGroupIds: [GROUP_ONE._id, GROUP_TWO._id],
        }}
        contestId={CONTEST_ID}
        scopeGroups={[GROUP_ONE, GROUP_TWO]}
      />,
    );

    expect(await screen.findByText(/已忽略 1 个学校与当前固定参赛范围不一致/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '考试活动学校' })).toHaveTextContent(SCHOOL_ONE.name);
    expect(screen.getByRole('button', { name: '创建考试活动并安排座位' })).toBeEnabled();
  });

  it('blocks a cross-school participant-group scope before creating or opening an unusable event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [event('66bf0000000000000000010d', '北校区旧场次')], schools: [SCHOOL_ONE, SCHOOL_TWO] })),
    );
    render(
      <ContestExamSeatEntry
        tdoc={{
          ...fixedContest(),
          participantScopeMode: 'groups',
          participantSchoolIds: [],
          participantGroupIds: [GROUP_ONE._id, GROUP_CROSS_SCHOOL._id],
        }}
        contestId={CONTEST_ID}
        scopeGroups={[GROUP_ONE, GROUP_CROSS_SCHOOL]}
      />,
    );

    expect(await screen.findByText(/当前参赛组无法从组目录唯一归属到同一学校/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '进入座位工作台' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建考试活动并安排座位' })).not.toBeInTheDocument();
  });
});
