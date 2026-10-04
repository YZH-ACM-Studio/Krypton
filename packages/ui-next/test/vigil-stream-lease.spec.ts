import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VigilActor, VigilWatchState } from '@/lib/vigil-api';
import { useStreamLease } from '../src/pages/vigil/use-stream-lease.ts';

const NETWORK_ERROR = '与监考服务器的连接中断，正在重试…';

const api = vi.hoisted(() => {
  class VigilLeaseLostError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'VigilLeaseLostError';
    }
  }
  return {
    watchStudentStream: vi.fn(),
    renewStudentStream: vi.fn(),
    releaseStudentStream: vi.fn(),
    setManualRecording: vi.fn(),
    getMediaNodes: vi.fn(),
    VigilLeaseLostError,
  };
});

vi.mock('@/lib/vigil-api', () => api);

interface LeaseArgs {
  open: boolean;
  contestId: string;
  machineId: string;
  actor: VigilActor;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function watchState(overrides: Partial<VigilWatchState> = {}): VigilWatchState {
  return {
    leaseId: 'lease_1',
    status: 'starting',
    reason: null,
    detail: '',
    mode: 'watch',
    recording: false,
    streams: { screen: null, camera: null },
    renewAfterMs: 2000,
    leaseTtlMs: 45000,
    ...overrides,
  };
}

function actorOf(uid = 7, displayName = 'T'): VigilActor {
  return { uid, displayName };
}

async function flushAsync(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

async function settle() {
  await act(async () => {
    await flushAsync();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderLease(initialProps: LeaseArgs) {
  return renderHook(
    (props: LeaseArgs) => useStreamLease(props),
    { initialProps },
  );
}

async function mountOpen(overrides: Partial<LeaseArgs> = {}) {
  const actor = overrides.actor ?? actorOf();
  const initialProps: LeaseArgs = {
    open: true,
    contestId: 'c1',
    machineId: 'm1',
    ...overrides,
    actor,
  };
  const rendered = renderLease(initialProps);
  await settle();
  return { ...rendered, actor, initialProps };
}

describe('useStreamLease', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.watchStudentStream.mockReset();
    api.renewStudentStream.mockReset();
    api.releaseStudentStream.mockReset();
    api.setManualRecording.mockReset();
    api.getMediaNodes.mockReset();
    api.watchStudentStream.mockResolvedValue(watchState());
    api.renewStudentStream.mockResolvedValue(watchState({ status: 'live', renewAfterMs: 15_000 }));
    api.releaseStudentStream.mockResolvedValue(undefined);
    api.setManualRecording.mockResolvedValue({ ok: true, recording: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watches once when mounted open and stores the starting state', async () => {
    const actor = actorOf();
    const { result } = await mountOpen({ actor });

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(api.watchStudentStream).toHaveBeenCalledWith('c1', 'm1', actor);
    expect(result.current.state?.status).toBe('starting');
    expect(result.current.networkError).toBe(null);
    expect(result.current.recordingBusy).toBe(false);
  });

  it('watches when open flips from false to true and not before', async () => {
    const actor = actorOf();
    const props: LeaseArgs = { open: false, contestId: 'c1', machineId: 'm1', actor };
    const { result, rerender } = renderLease(props);
    await settle();
    await advance(60_000);

    expect(api.watchStudentStream).not.toHaveBeenCalled();
    expect(result.current.state).toBe(null);

    rerender({ ...props, open: true });
    await settle();

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(api.watchStudentStream).toHaveBeenCalledWith('c1', 'm1', actor);
    expect(result.current.state?.status).toBe('starting');
    expect(result.current.networkError).toBe(null);
  });

  it('renews only after renewAfterMs and passes the lease id', async () => {
    api.watchStudentStream.mockResolvedValue(watchState({ renewAfterMs: 2000, leaseId: 'lease_1' }));
    await mountOpen();

    await advance(1999);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_1');
  });

  it('schedules the next renew from the renewed renewAfterMs', async () => {
    api.renewStudentStream.mockResolvedValue(watchState({
      leaseId: 'lease_1',
      status: 'live',
      renewAfterMs: 15_000,
    }));
    const { result } = await mountOpen();

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_1');
    expect(result.current.state?.status).toBe('live');
    expect(result.current.networkError).toBe(null);

    await advance(14_999);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);
    expect(api.renewStudentStream).toHaveBeenLastCalledWith('lease_1');
  });

  it('watches again immediately when renew throws VigilLeaseLostError', async () => {
    api.watchStudentStream
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_1', renewAfterMs: 2000, status: 'starting' }))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_2', renewAfterMs: 15_000, status: 'starting' }));
    api.renewStudentStream.mockRejectedValueOnce(new api.VigilLeaseLostError('lease_not_found'));
    const actor = actorOf();
    const { result } = await mountOpen({ actor });

    await advance(2000);
    await settle();

    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_1');
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c1', 'm1', actor);
    expect(result.current.state?.leaseId).toBe('lease_2');
    expect(result.current.state?.status).toBe('starting');
    expect(result.current.networkError).toBe(null);

    await advance(14_999);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);
    expect(api.renewStudentStream).toHaveBeenLastCalledWith('lease_2');
  });

  it('keeps the old state and retries renew 3000ms after a plain error', async () => {
    const starting = watchState({ leaseId: 'lease_1', status: 'starting', renewAfterMs: 2000 });
    api.watchStudentStream.mockResolvedValue(starting);
    api.renewStudentStream
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_1', status: 'live', renewAfterMs: 15_000 }));
    const { result } = await mountOpen();

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.networkError).toBe(NETWORK_ERROR);
    expect(result.current.state).toEqual(starting);

    await advance(2999);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);
    expect(api.renewStudentStream).toHaveBeenLastCalledWith('lease_1');
    expect(result.current.networkError).toBe(null);
    expect(result.current.state?.status).toBe('live');
  });

  it('sets the same networkError when watch fails and retries watch after 3000ms', async () => {
    const actor = actorOf();
    const recovered = watchState({ leaseId: 'lease_9', status: 'starting', renewAfterMs: 2000 });
    api.watchStudentStream
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(recovered);
    const { result } = await mountOpen({ actor });

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(api.watchStudentStream).toHaveBeenCalledWith('c1', 'm1', actor);
    expect(result.current.state).toBe(null);
    expect(result.current.networkError).toBe(NETWORK_ERROR);

    await advance(2999);
    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c1', 'm1', actor);
    expect(result.current.networkError).toBe(null);
    expect(result.current.state).toEqual(recovered);

    await advance(1999);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_9');
  });

  it('releases the lease and stops renewing when open becomes false', async () => {
    const releasePending = deferred<void>();
    api.releaseStudentStream.mockReturnValue(releasePending.promise);
    const actor = actorOf();
    const { result, rerender, initialProps } = await mountOpen({ actor });

    rerender({ ...initialProps, open: false });

    expect(api.releaseStudentStream).toHaveBeenCalledTimes(1);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');
    expect(result.current.state).toBe(null);

    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    releasePending.resolve();
    await settle();
    expect(result.current.state).toBe(null);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
  });

  it('releases on unmount and does not renew afterwards', async () => {
    const { unmount } = await mountOpen();
    unmount();

    expect(api.releaseStudentStream).toHaveBeenCalledTimes(1);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');

    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
  });

  it('does not renew or release an empty lease, including on unmount', async () => {
    api.watchStudentStream.mockResolvedValue(watchState({
      leaseId: '',
      status: 'failed',
      reason: 'session_not_active',
      detail: '',
      renewAfterMs: 2000,
    }));
    const { result, unmount } = await mountOpen();

    expect(result.current.state?.leaseId).toBe('');
    expect(result.current.state?.reason).toBe('session_not_active');

    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    unmount();
    expect(api.releaseStudentStream).not.toHaveBeenCalled();
  });

  it('does not schedule another renew when a renewed state has an empty lease', async () => {
    api.renewStudentStream.mockResolvedValue(watchState({
      leaseId: '',
      status: 'failed',
      reason: 'session_not_active',
      renewAfterMs: 2000,
    }));
    const { result } = await mountOpen();

    await advance(2000);
    await settle();
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.state?.leaseId).toBe('');

    await advance(60_000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
  });

  it('releases the current lease on pagehide', async () => {
    await mountOpen();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(api.releaseStudentStream).toHaveBeenCalledTimes(1);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');
  });

  it('does not watch again when renew loses the lease after pagehide', async () => {
    const { result } = await mountOpen();
    api.renewStudentStream.mockRejectedValue(new api.VigilLeaseLostError('lease_not_found'));
    api.watchStudentStream.mockResolvedValue(watchState({
      leaseId: 'lease_after_hide',
      status: 'starting',
      renewAfterMs: 2000,
    }));

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.releaseStudentStream).toHaveBeenCalledTimes(1);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');

    await advance(2000);
    await settle();

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.state?.leaseId).not.toBe('lease_after_hide');
    expect(api.releaseStudentStream).not.toHaveBeenCalledWith('lease_after_hide');
  });

  it('releases a watch lease that resolves after pagehide and does not renew it', async () => {
    const pending = deferred<VigilWatchState>();
    api.watchStudentStream.mockImplementation(() => pending.promise);
    const { result } = await mountOpen();

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe(null);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    pending.resolve(watchState({ leaseId: 'lease_late', renewAfterMs: 2000, status: 'starting' }));
    await settle();

    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_late');
    expect(result.current.state?.leaseId).not.toBe('lease_late');
    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
  });

  it('does not release on pagehide when the lease id is empty', async () => {
    api.watchStudentStream.mockResolvedValue(watchState({
      leaseId: '',
      status: 'failed',
      reason: 'live_disabled',
    }));
    await mountOpen();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(api.releaseStudentStream).not.toHaveBeenCalled();
  });

  it('removes the pagehide listener on unmount', async () => {
    const { unmount } = await mountOpen();
    unmount();
    api.releaseStudentStream.mockClear();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(api.releaseStudentStream).not.toHaveBeenCalled();
  });

  it('retry releases the old lease, clears timers, and watches again', async () => {
    const second = deferred<VigilWatchState>();
    api.watchStudentStream
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_1', renewAfterMs: 2000 }))
      .mockImplementationOnce(() => second.promise);
    const actor = actorOf();
    const { result } = await mountOpen({ actor });

    act(() => {
      result.current.retry();
    });

    expect(api.releaseStudentStream).toHaveBeenCalledTimes(1);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');
    expect(result.current.state).toBe(null);
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c1', 'm1', actor);

    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    second.resolve(watchState({ leaseId: 'lease_2', status: 'starting', renewAfterMs: 2000 }));
    await settle();
    expect(result.current.state?.leaseId).toBe('lease_2');
    expect(result.current.networkError).toBe(null);

    await advance(1999);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
    await advance(1);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_2');
  });

  it('retry with an empty lease does not release and watches again', async () => {
    api.watchStudentStream.mockResolvedValue(watchState({
      leaseId: '',
      status: 'failed',
      reason: 'session_not_active',
    }));
    const { result } = await mountOpen();

    act(() => {
      result.current.retry();
    });
    await settle();

    expect(api.releaseStudentStream).not.toHaveBeenCalled();
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
  });

  it('setRecording reports busy, then renews immediately and drops the old timer', async () => {
    const pending = deferred<{ ok: boolean; recording: boolean }>();
    api.setManualRecording.mockImplementation(() => pending.promise);
    api.renewStudentStream.mockResolvedValue(watchState({
      leaseId: 'lease_1',
      status: 'live',
      renewAfterMs: 15_000,
    }));
    const actor = actorOf();
    const { result } = await mountOpen({ actor });
    expect(result.current.recordingBusy).toBe(false);

    let done!: Promise<void>;
    act(() => {
      done = result.current.setRecording(true);
    });

    expect(api.setManualRecording).toHaveBeenCalledTimes(1);
    expect(api.setManualRecording).toHaveBeenCalledWith('c1', 'm1', true, actor);
    expect(result.current.recordingBusy).toBe(true);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ ok: true, recording: true });
      await done;
    });

    expect(result.current.recordingBusy).toBe(false);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_1');

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    await advance(13_000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);
  });

  it('keeps the setRecording renew when an older renew resolves later', async () => {
    const older = deferred<VigilWatchState>();
    const newer = deferred<VigilWatchState>();
    api.renewStudentStream
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result } = await mountOpen();

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);

    const recording = deferred<{ ok: boolean; recording: boolean }>();
    api.setManualRecording.mockImplementation(() => recording.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.setRecording(true);
    });
    await act(async () => {
      recording.resolve({ ok: true, recording: true });
      await flushAsync();
    });
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve(watchState({
        leaseId: 'lease_1',
        status: 'live',
        mode: 'manual',
        recording: true,
        renewAfterMs: 15_000,
      }));
      await done;
      await flushAsync();
    });
    expect(result.current.state?.recording).toBe(true);
    expect(result.current.state?.mode).toBe('manual');

    await act(async () => {
      older.resolve(watchState({
        leaseId: 'lease_1',
        status: 'live',
        mode: 'watch',
        recording: false,
        renewAfterMs: 15_000,
      }));
      await flushAsync();
    });
    expect(result.current.state?.recording).toBe(true);
    expect(result.current.state?.mode).toBe('manual');
    expect(api.releaseStudentStream).not.toHaveBeenCalled();
  });

  it('does not watch twice when an older renew loses the lease during setRecording', async () => {
    const older = deferred<VigilWatchState>();
    const newer = deferred<VigilWatchState>();
    api.renewStudentStream
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    api.watchStudentStream
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_1' }))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_2', mode: 'manual', recording: true }));
    const { result } = await mountOpen();

    await advance(2000);
    let done!: Promise<void>;
    act(() => {
      done = result.current.setRecording(true);
    });
    await settle();
    expect(api.renewStudentStream).toHaveBeenCalledTimes(2);

    await act(async () => {
      older.reject(new api.VigilLeaseLostError('lease_not_found'));
      newer.reject(new api.VigilLeaseLostError('lease_not_found'));
      await done;
      await flushAsync();
    });

    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(result.current.state?.leaseId).toBe('lease_2');
    expect(api.releaseStudentStream).not.toHaveBeenCalledWith('lease_2');
  });

  it('clears networkError on close and at the start of retry', async () => {
    api.renewStudentStream.mockRejectedValueOnce(new Error('offline'));
    const { result, rerender, initialProps } = await mountOpen();

    await advance(2000);
    await settle();
    expect(result.current.networkError).toBe(NETWORK_ERROR);

    rerender({ ...initialProps, open: false });
    expect(result.current.state).toBe(null);
    expect(result.current.networkError).toBe(null);

    const failedWatch = deferred<VigilWatchState>();
    api.watchStudentStream.mockImplementationOnce(() => failedWatch.promise);
    rerender({ ...initialProps, open: true });
    await act(async () => {
      failedWatch.reject(new Error('offline'));
      await flushAsync();
    });
    expect(result.current.networkError).toBe(NETWORK_ERROR);

    const nextWatch = deferred<VigilWatchState>();
    api.watchStudentStream.mockImplementationOnce(() => nextWatch.promise);
    act(() => {
      result.current.retry();
    });
    expect(result.current.networkError).toBe(null);
    expect(result.current.state).toBe(null);

    await act(async () => {
      nextWatch.resolve(watchState({ leaseId: 'lease_3', status: 'live' }));
      await flushAsync();
    });
    expect(result.current.networkError).toBe(null);
    expect(result.current.state?.leaseId).toBe('lease_3');
  });

  it('rethrows setRecording failures, clears busy, and does not renew', async () => {
    const pending = deferred<{ ok: boolean; recording: boolean }>();
    api.setManualRecording.mockImplementation(() => pending.promise);
    const { result } = await mountOpen();
    let captured: unknown;

    act(() => {
      const pendingCall = result.current.setRecording(false);
      pendingCall.then(
        () => {
          captured = new Error('setRecording should have rejected');
        },
        (error: unknown) => {
          captured = error;
        },
      );
    });
    expect(result.current.recordingBusy).toBe(true);

    await act(async () => {
      pending.reject(new Error('录制被拒绝'));
      await flushAsync();
    });

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('录制被拒绝');
    expect(result.current.recordingBusy).toBe(false);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
    expect(result.current.state?.leaseId).toBe('lease_1');
  });

  it('does not renew after setRecording succeeds without a lease', async () => {
    api.watchStudentStream.mockResolvedValue(watchState({
      leaseId: '',
      status: 'failed',
      reason: 'live_disabled',
    }));
    const actor = actorOf();
    const { result } = await mountOpen({ actor });

    await act(async () => {
      await result.current.setRecording(true);
    });

    expect(api.setManualRecording).toHaveBeenCalledWith('c1', 'm1', true, actor);
    expect(result.current.recordingBusy).toBe(false);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
  });

  it('does not watch again when only the actor object changes', async () => {
    const actor = actorOf(7, 'T');
    const nextActor = actorOf(8, 'U');
    const { result, rerender, initialProps } = await mountOpen({ actor });

    rerender({ ...initialProps, actor: nextActor });
    await settle();
    await advance(60_000);

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(api.watchStudentStream).toHaveBeenCalledWith('c1', 'm1', actor);

    await act(async () => {
      await result.current.setRecording(true);
    });

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(api.setManualRecording).toHaveBeenCalledWith('c1', 'm1', true, nextActor);
  });

  it('re-watches and releases the previous lease when contestId or machineId changes', async () => {
    const actor = actorOf();
    api.watchStudentStream
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_a' }))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_b' }))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_c' }));
    const view = await mountOpen({ actor });

    view.rerender({ open: true, contestId: 'c2', machineId: 'm1', actor });
    await settle();
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_a');
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c2', 'm1', actor);
    expect(view.result.current.state?.leaseId).toBe('lease_b');

    view.rerender({ open: true, contestId: 'c2', machineId: 'm2', actor });
    await settle();
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_b');
    expect(api.watchStudentStream).toHaveBeenCalledTimes(3);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c2', 'm2', actor);
    expect(view.result.current.state?.leaseId).toBe('lease_c');
  });

  it('drops an in-flight watch that resolves after close without scheduling renew', async () => {
    const pending = deferred<VigilWatchState>();
    api.watchStudentStream.mockImplementation(() => pending.promise);
    const actor = actorOf();
    const { result, rerender, initialProps } = await mountOpen({ actor });

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe(null);

    rerender({ ...initialProps, open: false });
    pending.resolve(watchState({ leaseId: 'lease_late', renewAfterMs: 2000 }));
    await settle();

    expect(result.current.state).toBe(null);
    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();
  });

  it('does not schedule another renew when an in-flight renew settles after unmount', async () => {
    const pending = deferred<VigilWatchState>();
    api.renewStudentStream.mockImplementation(() => pending.promise);
    const { unmount } = await mountOpen();

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);

    unmount();
    pending.resolve(watchState({ leaseId: 'lease_1', status: 'live', renewAfterMs: 1000 }));
    await settle();
    await advance(60_000);

    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
  });

  it('ignores a watch response for the previous contest after contestId changes', async () => {
    const first = deferred<VigilWatchState>();
    const second = deferred<VigilWatchState>();
    api.watchStudentStream
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const actor = actorOf();
    const { result, rerender } = await mountOpen({ actor });

    rerender({ open: true, contestId: 'c2', machineId: 'm1', actor });
    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenNthCalledWith(1, 'c1', 'm1', actor);
    expect(api.watchStudentStream).toHaveBeenNthCalledWith(2, 'c2', 'm1', actor);

    await act(async () => {
      first.resolve(watchState({ leaseId: 'lease_old', renewAfterMs: 2000, status: 'starting' }));
      await flushAsync();
    });
    expect(result.current.state).toBe(null);
    expect(result.current.networkError).toBe(null);

    await advance(60_000);
    expect(api.renewStudentStream).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve(watchState({ leaseId: 'lease_new', renewAfterMs: 2000, status: 'live' }));
      await flushAsync();
    });
    expect(result.current.state?.leaseId).toBe('lease_new');
    expect(result.current.state?.status).toBe('live');
    expect(result.current.networkError).toBe(null);
  });

  it('rewatches with the latest actor after a lost lease', async () => {
    const actor = actorOf(7, 'T');
    const nextActor = actorOf(8, 'U');
    api.watchStudentStream
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_1', renewAfterMs: 2000, status: 'starting' }))
      .mockResolvedValueOnce(watchState({ leaseId: 'lease_2', renewAfterMs: 2000, status: 'starting' }));
    api.renewStudentStream.mockRejectedValueOnce(new api.VigilLeaseLostError('lease_not_found'));
    const { rerender, initialProps } = await mountOpen({ actor });

    rerender({ ...initialProps, actor: nextActor });
    await settle();
    await advance(2000);
    await settle();

    expect(api.watchStudentStream).toHaveBeenCalledTimes(2);
    expect(api.watchStudentStream).toHaveBeenNthCalledWith(1, 'c1', 'm1', actor);
    expect(api.watchStudentStream).toHaveBeenLastCalledWith('c1', 'm1', nextActor);
  });

  it('does not set networkError or retry watch when watch rejects after close', async () => {
    const pending = deferred<VigilWatchState>();
    api.watchStudentStream.mockImplementation(() => pending.promise);
    const { result, rerender, initialProps } = await mountOpen();

    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe(null);

    rerender({ ...initialProps, open: false });
    expect(result.current.state).toBe(null);
    expect(result.current.networkError).toBe(null);

    await act(async () => {
      pending.reject(new Error('offline'));
      await flushAsync();
    });

    expect(result.current.networkError).toBe(null);
    expect(result.current.state).toBe(null);

    await advance(3_000);
    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
  });

  it('does not set networkError or retry renew when renew rejects after close', async () => {
    const pending = deferred<VigilWatchState>();
    api.renewStudentStream.mockReturnValue(pending.promise);
    const { result, rerender, initialProps } = await mountOpen();

    await advance(2000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.renewStudentStream).toHaveBeenCalledWith('lease_1');

    rerender({ ...initialProps, open: false });
    expect(result.current.state).toBe(null);
    expect(result.current.networkError).toBe(null);
    expect(api.releaseStudentStream).toHaveBeenCalledWith('lease_1');

    await act(async () => {
      pending.reject(new Error('socket hang up'));
      await flushAsync();
    });

    expect(result.current.networkError).toBe(null);
    expect(result.current.state).toBe(null);

    await advance(3_000);
    expect(api.renewStudentStream).toHaveBeenCalledTimes(1);
    expect(api.watchStudentStream).toHaveBeenCalledTimes(1);
  });
});
