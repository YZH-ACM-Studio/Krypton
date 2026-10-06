import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamHomeShell } from '@/components/layout/exam-shell';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap';
import { examServerClock } from '@/lib/exam-server-clock';

const SERVER = Date.parse('2026-10-06T12:00:00.000Z');

function bootstrap(generatedAt: string): KryptonBootstrap {
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
          endAt: new Date(SERVER + 30 * 60_000).toISOString(),
        },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
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
});
