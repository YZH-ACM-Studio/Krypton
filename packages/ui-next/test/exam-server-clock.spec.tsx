import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamHomeShell } from '@/components/layout/exam-shell';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap';
import { examServerClock } from '@/lib/exam-server-clock';

const SERVER = Date.parse('2026-10-06T12:00:00.000Z');

function bootstrap(generatedAt: string, endOffsetMs = 30 * 60_000, examMode: Record<string, unknown> = {}): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt,
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'exam_contest.html',
      data: {
        tdoc: {
          title: '考试',
          beginAt: new Date(SERVER - 60_000).toISOString(),
          endAt: new Date(SERVER + endOffsetMs).toISOString(),
        },
        examMode,
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('exam server clock', () => {
  it('anchors once to the page server time and then advances locally', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 10 * 60_000);
    const clock = examServerClock(new Date(SERVER).toISOString());
    expect(clock.now()).toBe(SERVER);
    vi.setSystemTime(SERVER + 10 * 60_000 + 5_000);
    expect(clock.now()).toBe(SERVER + 5_000);
  });

  it('rejects a page that did not bring a server timestamp', () => {
    expect(() => examServerClock('not-a-time')).toThrow(/server timestamp/);
  });

  it('shows the server remaining time when the classroom clock is fast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 10 * 60_000);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString())}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    expect(screen.getByTitle(/剩余时间/)).toHaveTextContent('00:30:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTitle(/剩余时间/)).toHaveTextContent('00:29:55');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns the countdown into 已结束 instead of staying at zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), -1_000)}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    const clock = screen.getByTitle('比赛已结束');
    expect(clock).toHaveTextContent('已结束');
    expect(clock).not.toHaveTextContent('00:00:00');
  });

  it('warns at five minutes and one minute, and enlarges the last minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const five = render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), 4 * 60_000)}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 5 分钟' })).toBeInTheDocument();
    five.unmount();

    vi.setSystemTime(SERVER);
    render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), 45_000)}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 1 分钟' })).toBeInTheDocument();
    expect(screen.getByTitle(/剩余时间/).querySelector('.exam-countdown-blink')).not.toBeNull();
  });

  it('shows each countdown warning once across remounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const fiveMinutesLeft = bootstrap(new Date(SERVER).toISOString(), 4 * 60_000);
    const first = render(
      <BootstrapProvider bootstrap={fiveMinutesLeft}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 5 分钟' })).toBeInTheDocument();
    first.unmount();

    const again = render(
      <BootstrapProvider bootstrap={fiveMinutesLeft}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('dialog', { name: '还剩 5 分钟' })).toBeNull();
    again.unmount();

    const oneMinuteLeft = bootstrap(new Date(SERVER + 3.5 * 60_000).toISOString(), 4 * 60_000);
    const third = render(
      <BootstrapProvider bootstrap={oneMinuteLeft}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 1 分钟' })).toBeInTheDocument();
    third.unmount();

    render(
      <BootstrapProvider bootstrap={oneMinuteLeft}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('warns again for another contest that ends at the same time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const firstContest = bootstrap(new Date(SERVER).toISOString(), 4 * 60_000, { tid: 'exam-a' });
    const first = render(
      <BootstrapProvider bootstrap={firstContest}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 5 分钟' })).toBeInTheDocument();
    first.unmount();

    render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), 4 * 60_000, { tid: 'exam-b' })}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog', { name: '还剩 5 分钟' })).toBeInTheDocument();
  });

  it('shows the contest switcher only when the workspace is not locked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const open = render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), 30 * 60_000, {
        exclusive: false,
        switchContests: [{ id: 'abc', title: '另一场比赛' }],
      })}
      >
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    expect(screen.getByRole('button', { name: '切换比赛' })).toBeInTheDocument();
    open.unmount();

    render(
      <BootstrapProvider bootstrap={bootstrap(new Date(SERVER).toISOString(), 30 * 60_000, { exclusive: true })}>
        <ExamHomeShell>考试</ExamHomeShell>
      </BootstrapProvider>,
    );
    expect(screen.queryByRole('button', { name: '切换比赛' })).toBeNull();
  });
});
