import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContestReplayFrame } from '@hydrooj/common';
import { VirtualContestReplay } from '../src/pages/virtual-contest-replay';

const path = '/d/school/contest/one/virtual/replay';
const durationMs = 3 * 3600_000;
const availableMs = 21 * 60_000;

function reply(at: number | null, ended = false, score = 1): Response {
  const available = ended ? durationMs : availableMs;
  const frame: ContestReplayFrame = {
    rule: 'acm',
    durationMs,
    availableMs: available,
    atMs: Math.min(at ?? available, available),
    ended,
    frozen: false,
    incomplete: 0,
    hideTotals: false,
    pids: [3],
    rows: (['official', 'self'] as const).map((source) => ({
      uid: 3,
      name: '选手甲',
      source,
      rank: 1,
      score,
      seconds: 60,
      cells: ['+'],
    })),
  };
  return new Response(JSON.stringify({ replay: frame }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('虚拟参赛榜单重放', () => {
  it('opens live, keeps duplicate identities, coalesces seeking and returns to the server clock', async () => {
    const asked: (number | null)[] = [];
    const fetch = vi.fn(async (input: URL) => {
      expect(input.pathname).toBe(path);
      const raw = input.searchParams.get('at');
      const at = raw === null ? null : Number(raw);
      asked.push(at);
      return reply(at);
    });
    vi.stubGlobal('fetch', fetch);
    render(<VirtualContestReplay url={path} />);
    await advance(0);
    expect(asked).toEqual([null]);
    expect(screen.getAllByText('选手甲')).toHaveLength(2);
    expect(screen.getByText('正式')).toBeVisible();
    expect(screen.getByText('本次 VP')).toBeVisible();
    const slider = screen.getByRole('slider', { name: '回放时间' });
    expect(slider).toHaveAttribute('max', String(availableMs));
    fireEvent.change(slider, { target: { value: '600000' } });
    fireEvent.change(slider, { target: { value: '610000' } });
    await advance(150);
    expect(asked).toEqual([null, 610_000]);
    await advance(6000);
    expect(asked).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await advance(2100);
    expect(asked.at(-1)).toBeGreaterThan(610_000);
    fireEvent.click(screen.getByRole('button', { name: '回到当前' }));
    await advance(0);
    expect(asked.at(-1)).toBe(null);
  });

  it('opens the full final after an early finish, and plays again from the start', async () => {
    vi.stubGlobal('fetch', async (input: URL) => {
      const at = input.searchParams.get('at');
      return reply(at === null ? null : Number(at), true);
    });
    render(<VirtualContestReplay url={path} />);
    await advance(0);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveValue(String(durationMs));
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await advance(10);
    expect(Number((slider as HTMLInputElement).value)).toBeLessThan(100);
  });

  it('keeps the clock beside the scores on the displayed frame while a seek is pending', async () => {
    let resolveSeek!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveSeek = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(null, true, 37)).mockReturnValueOnce(pending));
    render(<VirtualContestReplay url={path} />);
    await advance(0);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0' } });
    await advance(200);
    expect(slider).toHaveValue('0');
    expect(screen.getByText('回放时间 03:00:00 / 03:00:00')).toBeVisible();
    expect(screen.getAllByText('37')).toHaveLength(2);
    await act(async () => { resolveSeek(reply(0, true, 0)); });
    expect(screen.getByText('回放时间 00:00:00 / 03:00:00')).toBeVisible();
    expect(screen.queryByText('37')).toBeNull();
  });

  it('shows a historical final score with unknown tie-breakers', async () => {
    const archived = {
      rule: 'ioi', durationMs, availableMs: durationMs, atMs: durationMs, ended: true, frozen: false,
      incomplete: 1, hideTotals: false, pids: [3],
      rows: [{ uid: 4, source: 'official', name: '旧选手', cells: [null], score: 83, rank: 1, passed: null, seconds: null }],
    } satisfies ContestReplayFrame;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ replay: archived })));
    render(<VirtualContestReplay url={path} />);
    await advance(0);
    expect(screen.getByText('83')).toBeVisible();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('discards the old board on permission loss and permits retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(null))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              name: 'ContestScoreboardHiddenError',
              errorCode: 'ContestScoreboardHiddenError',
              code: 403,
              status: 403,
              params: [],
              message: '无榜单权限',
            },
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(reply(null));
    vi.stubGlobal('fetch', fetch);
    render(<VirtualContestReplay url={path} />);
    await advance(0);
    await advance(5001);
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await advance(0);
    expect(screen.getByRole('table', { name: '重放榜单' })).toBeVisible();
  });
});
