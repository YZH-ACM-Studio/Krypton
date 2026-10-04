import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VigilStreamMode, VigilStudentCard, VigilWatchFailure, VigilWatchState } from '../src/lib/vigil-api.ts';
import { LivePlayerDialog } from '../src/pages/vigil/live-player-dialog.tsx';

const CONTEST_ID = 'c1';
const MACHINE_ID = 'm_1';
const SCREEN_URL = '/vigil-flv/live-nodvr/a_screen.flv';
const CAMERA_URL = '/vigil-flv/live-nodvr/a_camera.flv';
const NETWORK_ERROR = '与监考服务器的连接中断，正在重试…';
const RECORD_ERROR = '录制操作失败：没有权限';

interface LeaseArgs {
  open: boolean;
  contestId: string;
  machineId: string;
  actor: { uid: number; displayName: string };
}

const lease = vi.hoisted(() => ({
  calls: [] as LeaseArgs[],
  state: null as VigilWatchState | null,
  networkError: null as string | null,
  retry: vi.fn<() => void>(),
  setRecording: vi.fn<(enabled: boolean) => Promise<void>>(),
  recordingBusy: false,
}));

vi.mock('@/pages/vigil/use-stream-lease', () => ({
  useStreamLease: (args: LeaseArgs) => {
    lease.calls.push({
      open: args.open,
      contestId: args.contestId,
      machineId: args.machineId,
      actor: { uid: args.actor.uid, displayName: args.actor.displayName },
    });
    return {
      state: lease.state,
      networkError: lease.networkError,
      retry: lease.retry,
      setRecording: lease.setRecording,
      recordingBusy: lease.recordingBusy,
    };
  },
}));

vi.mock('@/lib/bootstrap', () => ({
  useBootstrap: () => ({ user: { id: 7, name: 'T' } }),
}));

const mpegts = vi.hoisted(() => {
  type Handler = () => void;
  interface FakePlayer {
    destroy: ReturnType<typeof vi.fn>;
    handlers: Map<string, Handler[]>;
  }
  const players: FakePlayer[] = [];
  const feature = { mseLivePlayback: true };
  const Events = { ERROR: 'error' };
  const createPlayer = vi.fn((_media: { url?: string } | string) => {
    const handlers = new Map<string, Handler[]>();
    const player: FakePlayer = {
      handlers,
      destroy: vi.fn(),
    };
    const api = {
      ...player,
      on: (event: string, handler: Handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      attachMediaElement: vi.fn(),
      detachMediaElement: vi.fn(),
      load: vi.fn(),
      unload: vi.fn(),
      pause: vi.fn(),
    };
    players.push(player);
    return api;
  });
  return {
    players,
    feature,
    Events,
    createPlayer,
    getFeatureList: vi.fn(() => feature),
  };
});

vi.mock('mpegts.js', () => ({ default: mpegts }));

vi.mock('hls.js', () => {
  class Hls {
    static isSupported(): boolean {
      return false;
    }

    static Events = { MEDIA_ATTACHED: 'hlsMediaAttached', ERROR: 'hlsError' };

    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', OTHER_ERROR: 'otherError' };

    attachMedia(): void {}

    on(): void {}

    destroy(): void {}

    loadSource(): void {}

    startLoad(): void {}

    recoverMediaError(): void {}
  }
  return { default: Hls };
});

const FAILURES: Array<{ reason: VigilWatchFailure; detail: string; text: string }> = [
  { reason: 'client_offline', detail: '', text: '考生离线，客户端重新连上后会自动恢复画面' },
  { reason: 'live_disabled', detail: '', text: '本场考试未开启直播' },
  { reason: 'no_media_node', detail: '', text: '无可用媒体节点，请联系管理员检查流媒体服务' },
  { reason: 'publish_failed', detail: 'Connection refused', text: '考生端推流启动失败：Connection refused' },
  { reason: 'publish_failed', detail: '', text: '考生端推流启动失败：未知原因' },
  { reason: 'no_video_timeout', detail: '', text: '15 秒内未收到画面，可能是考生网络或客户端异常' },
  { reason: 'session_not_active', detail: '', text: '该考生当前没有进行中的考试' },
];

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

function student(overrides: Partial<VigilStudentCard> = {}): VigilStudentCard {
  return {
    machineId: MACHINE_ID,
    examSessionId: 'sess-1',
    uid: 42,
    name: '张三',
    studentId: '20231001',
    status: 'online',
    eventCount: 0,
    examSeconds: 0,
    recentScreenshotUrl: null,
    ...overrides,
  };
}

function playerElement(overrides: Partial<VigilStudentCard> = {}) {
  return (
    <LivePlayerDialog
      open
      onOpenChange={vi.fn()}
      contestId={CONTEST_ID}
      student={student(overrides)}
      recordEnabled={false}
    />
  );
}

function renderPlayer(overrides: Partial<VigilStudentCard> = {}) {
  return render(playerElement(overrides));
}

function buttonNamed(name: string) {
  return screen.getByRole('button', { name });
}

function queryButtonNamed(name: string) {
  return screen.queryByRole('button', { name });
}

function playedUrls(): string[] {
  return mpegts.createPlayer.mock.calls.map((call) => {
    const media = call[0];
    if (typeof media === 'string') return media;
    return media.url ?? '';
  });
}

function expectBeforeScreenshot(node: Element) {
  const shot = buttonNamed('截屏');
  expect(Boolean(node.compareDocumentPosition(shot) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

function expectNoRecordingControls() {
  expect(queryButtonNamed('录制')).toBeNull();
  expect(queryButtonNamed('停止录制')).toBeNull();
  expect(screen.queryByText('全程录制中')).toBeNull();
  expect(screen.queryByText('录制中')).toBeNull();
}

function stubMediaElement() {
  const proto = HTMLMediaElement.prototype;
  if (typeof proto.play !== 'function') proto.play = () => Promise.resolve();
  if (typeof proto.pause !== 'function') proto.pause = () => {};
  if (typeof proto.load !== 'function') proto.load = () => {};
  vi.spyOn(proto, 'play').mockResolvedValue(undefined);
  vi.spyOn(proto, 'pause').mockImplementation(() => {});
  vi.spyOn(proto, 'load').mockImplementation(() => {});
}

describe('live player dialog on stream leases', () => {
  beforeEach(() => {
    lease.calls.length = 0;
    lease.state = null;
    lease.networkError = null;
    lease.recordingBusy = false;
    lease.retry.mockReset();
    lease.setRecording.mockReset();
    lease.setRecording.mockResolvedValue(undefined);
    mpegts.players.length = 0;
    mpegts.feature.mseLivePlayback = true;
    mpegts.createPlayer.mockClear();
    stubMediaElement();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 正在加载直播… before the first watch result and does not open a player', () => {
    lease.state = null;
    renderPlayer();
    expect(screen.getByText('正在加载直播…')).toBeInTheDocument();
    expect(screen.queryByText('正在连接考生画面…')).toBeNull();
    expectNoRecordingControls();
    expect(playedUrls()).toEqual([]);
  });

  it('passes the bootstrap actor into the lease and keeps watch open under the limit', () => {
    renderPlayer();
    const last = lease.calls[lease.calls.length - 1];
    expect(last).toEqual({
      open: true,
      contestId: CONTEST_ID,
      machineId: MACHINE_ID,
      actor: { uid: 7, displayName: 'T' },
    });
  });

  it('does not watch while the dialog is closed', () => {
    render(
      <LivePlayerDialog
        open={false}
        onOpenChange={vi.fn()}
        contestId={CONTEST_ID}
        student={student()}
        recordEnabled={false}
      />,
    );
    const last = lease.calls[lease.calls.length - 1];
    expect(last).toEqual({
      open: false,
      contestId: CONTEST_ID,
      machineId: MACHINE_ID,
      actor: { uid: 7, displayName: 'T' },
    });
  });

  it('does not watch when a fifth live dialog is over the concurrent limit', () => {
    const views = [];
    for (let index = 0; index < 5; index += 1) {
      views.push(renderPlayer({ machineId: `m_${index}`, name: `学生${index}` }));
    }
    expect(screen.getByText('已达 4 路直播上限')).toBeInTheDocument();
    const fifthOpens = lease.calls
      .filter((call) => call.machineId === 'm_4')
      .map((call) => call.open);
    expect(fifthOpens.length).toBeGreaterThan(0);
    expect(fifthOpens).toEqual(fifthOpens.map(() => false));
    for (const view of views) view.unmount();
  });

  it('shows 正在连接考生画面… while a watch or manual lease is starting', () => {
    lease.state = watchState({ status: 'starting', mode: 'watch' });
    const watch = renderPlayer();
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在加载直播…')).toBeNull();
    expect(playedUrls()).toEqual([]);
    watch.unmount();

    lease.state = watchState({ status: 'starting', mode: 'manual' });
    const manual = renderPlayer();
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    manual.unmount();
  });

  it('does not play while starting even when the lease already has stream urls', () => {
    lease.state = watchState({
      status: 'starting',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: CAMERA_URL },
    });
    renderPlayer();
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('画面中断，正在重连…')).toBeNull();
    expect(screen.queryByTitle('拖动可移动摄像头窗口')).toBeNull();
    expect(playedUrls()).toEqual([]);
  });

  it('shows 正在加载直播… while record or legacy playback is starting', () => {
    for (const mode of ['record', 'legacy'] as const satisfies readonly VigilStreamMode[]) {
      lease.state = watchState({ status: 'starting', mode });
      const view = renderPlayer();
      expect(screen.getByText('正在加载直播…')).toBeInTheDocument();
      expect(screen.queryByText('正在连接考生画面…')).toBeNull();
      expect(playedUrls()).toEqual([]);
      view.unmount();
      mpegts.createPlayer.mockClear();
    }
  });

  it.each(FAILURES)('explains $reason ($detail) and retries from the canvas', ({ reason, detail, text }) => {
    lease.state = watchState({ status: 'failed', mode: 'watch', reason, detail });
    renderPlayer();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('正在加载直播…')).toBeNull();
    expect(screen.queryByText('正在连接考生画面…')).toBeNull();
    expect(playedUrls()).toEqual([]);
    const retry = buttonNamed('重试');
    expect(retry.getAttribute('data-size')).toBe('sm');
    // outline is the legacy alias Button renders as secondary.
    expect(retry.getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(retry);
    expect(lease.retry).toHaveBeenCalledTimes(1);
  });

  it('does not play a failed lease even when stream urls are already present', () => {
    lease.state = watchState({
      status: 'failed',
      mode: 'watch',
      reason: 'client_offline',
      detail: 'should-not-appear',
      streams: { screen: SCREEN_URL, camera: CAMERA_URL },
    });
    renderPlayer();
    expect(screen.getByText('考生离线，客户端重新连上后会自动恢复画面')).toBeInTheDocument();
    expect(screen.queryByText('should-not-appear')).toBeNull();
    expect(screen.queryByTitle('拖动可移动摄像头窗口')).toBeNull();
    expect(playedUrls()).toEqual([]);
    expect(buttonNamed('重试')).toBeEnabled();
  });

  it('plays the lease screen url once when camera is absent', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer({ streamState: { screen: 'started', camera: 'started' } });
    expect(playedUrls()).toEqual([SCREEN_URL]);
    view.unmount();
    expect(mpegts.players[0]?.destroy).toHaveBeenCalled();
  });

  it('plays screen and camera when the lease includes a camera url', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: CAMERA_URL },
    });
    renderPlayer({ streamState: { screen: 'stopped', camera: 'stopped' } });
    expect(playedUrls()).toHaveLength(2);
    expect(playedUrls()).toContain(SCREEN_URL);
    expect(playedUrls()).toContain(CAMERA_URL);
  });

  it('recreates the player when the screen url changes', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    expect(playedUrls()).toEqual([SCREEN_URL]);
    const next = '/vigil-flv/live-nodvr/b_screen.flv';
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: next, camera: null },
    });
    view.rerender(playerElement());
    expect(playedUrls()).toEqual([SCREEN_URL, next]);
  });

  it('shows 录制 for watch mode and calls setRecording(true)', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    const record = buttonNamed('录制');
    expect(record.getAttribute('data-variant')).toBe('ghost');
    expect(record.getAttribute('data-size')).toBe('sm');
    expect(record).toBeEnabled();
    expectBeforeScreenshot(record);
    expect(queryButtonNamed('停止录制')).toBeNull();
    expect(screen.queryByText('全程录制中')).toBeNull();
    expect(screen.queryByText('录制中')).toBeNull();
    fireEvent.click(record);
    expect(lease.setRecording).toHaveBeenCalledTimes(1);
    expect(lease.setRecording).toHaveBeenCalledWith(true);
  });

  it('shows 停止录制 and 录制中 for manual mode and calls setRecording(false)', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'manual',
      recording: true,
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    const stop = buttonNamed('停止录制');
    expect(stop.getAttribute('data-variant')).toBe('ghost');
    expect(stop.getAttribute('data-size')).toBe('sm');
    expectBeforeScreenshot(stop);
    const badge = screen.getByText('录制中');
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-tone')).toBe('danger');
    expect(badge.querySelector('span')).not.toBeNull();
    expect(queryButtonNamed('录制')).toBeNull();
    expect(screen.queryByText('全程录制中')).toBeNull();
    fireEvent.click(stop);
    expect(lease.setRecording).toHaveBeenCalledWith(false);
  });

  it('shows 全程录制中 and no record button in record mode', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'record',
      recording: true,
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    const badge = screen.getByText('全程录制中');
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-tone')).toBe('danger');
    expect(badge.querySelector('span')).not.toBeNull();
    expectBeforeScreenshot(badge);
    expect(queryButtonNamed('录制')).toBeNull();
    expect(queryButtonNamed('停止录制')).toBeNull();
    expect(screen.queryByText('录制中')).toBeNull();
  });

  it('shows no recording controls in legacy mode', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'legacy',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    expectNoRecordingControls();
    expect(playedUrls()).toEqual([SCREEN_URL]);
  });

  it('disables the recording button while recordingBusy is true', () => {
    lease.recordingBusy = true;
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const watch = renderPlayer();
    expect(buttonNamed('录制')).toBeDisabled();
    watch.unmount();

    lease.state = watchState({
      status: 'live',
      mode: 'manual',
      recording: true,
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    expect(buttonNamed('停止录制')).toBeDisabled();
  });

  it('shows 正在切换到录制… once status becomes starting after a live 录制 click, then clears it', async () => {
    let resolveRecording: () => void = () => {};
    lease.setRecording.mockImplementation(() => new Promise((fulfill) => {
      resolveRecording = fulfill;
    }));
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    expect(lease.setRecording).toHaveBeenCalledWith(true);
    lease.state = watchState({ status: 'starting', mode: 'watch' });
    view.rerender(playerElement());
    expect(screen.getByText('正在切换到录制…')).toBeInTheDocument();
    expect(screen.queryByText('正在连接考生画面…')).toBeNull();

    await act(async () => {
      resolveRecording();
    });
    expect(screen.getByText('正在切换到录制…')).toBeInTheDocument();

    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    view.rerender(playerElement());
    expect(screen.queryByText('正在切换到录制…')).toBeNull();
  });

  it('shows 正在停止录制… once status becomes starting after a failed 停止录制 click, then clears it', async () => {
    let resolveRecording: () => void = () => {};
    lease.setRecording.mockImplementation(() => new Promise((fulfill) => {
      resolveRecording = fulfill;
    }));
    lease.state = watchState({
      status: 'failed',
      mode: 'manual',
      reason: 'client_offline',
      detail: '',
    });
    const view = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('停止录制'));
    });
    expect(lease.setRecording).toHaveBeenCalledWith(false);
    lease.state = watchState({ status: 'starting', mode: 'manual' });
    view.rerender(playerElement());
    expect(screen.getByText('正在停止录制…')).toBeInTheDocument();
    expect(screen.queryByText('正在连接考生画面…')).toBeNull();

    await act(async () => {
      resolveRecording();
    });
    expect(screen.getByText('正在停止录制…')).toBeInTheDocument();

    lease.state = watchState({
      status: 'failed',
      mode: 'manual',
      reason: 'client_offline',
      detail: '',
    });
    view.rerender(playerElement());
    expect(screen.queryByText('正在停止录制…')).toBeNull();
  });

  it('drops the recording-switch copy when setRecording fails while playback is still starting', async () => {
    lease.state = watchState({ status: 'starting', mode: 'watch' });
    lease.setRecording.mockRejectedValue(new TypeError('没有权限'));
    const view = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RECORD_ERROR);
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在切换到录制…')).toBeNull();
    view.unmount();

    lease.state = watchState({ status: 'starting', mode: 'manual' });
    lease.setRecording.mockRejectedValue(new TypeError('没有权限'));
    renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('停止录制'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RECORD_ERROR);
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在停止录制…')).toBeNull();
  });

  it('shows 录制操作失败 on the alert and clears it after 3 seconds', async () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    lease.setRecording.mockRejectedValue(new Error('没有权限'));
    renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    expect(lease.setRecording).toHaveBeenCalledWith(true);
    expect(screen.getByRole('alert')).toHaveTextContent(RECORD_ERROR);
    const started = Date.now();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    }, { timeout: 4500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2800);
  });

  it('shows networkError in a status line without stopping playback', () => {
    lease.networkError = NETWORK_ERROR;
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    expect(screen.getByText(NETWORK_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(NETWORK_ERROR);
    expect(playedUrls()).toEqual([SCREEN_URL]);
  });

  it('keeps the recording error for 3 seconds, then clears it', async () => {
    vi.useFakeTimers();
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    lease.setRecording.mockRejectedValue(new TypeError('没有权限'));
    renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RECORD_ERROR);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RECORD_ERROR);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows 画面中断，正在重连… and recreates the player after 2 seconds', async () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    expect(playedUrls()).toEqual([SCREEN_URL]);
    const player = mpegts.players[0];
    const handlers = player?.handlers.get(mpegts.Events.ERROR) ?? [];
    expect(handlers).toHaveLength(1);
    const started = Date.now();
    await act(async () => {
      handlers[0]?.();
    });
    expect(player?.destroy).toHaveBeenCalled();
    expect(screen.getByText('画面中断，正在重连…')).toBeInTheDocument();
    expect(playedUrls()).toEqual([SCREEN_URL]);
    await waitFor(() => {
      expect(playedUrls()).toEqual([SCREEN_URL, SCREEN_URL]);
    }, { timeout: 3500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
  });

  it('remounts a fresh player when the screen url changes during reconnect', async () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    const handlers = mpegts.players[0]?.handlers.get(mpegts.Events.ERROR) ?? [];
    await act(async () => {
      handlers[0]?.();
    });
    expect(screen.getByText('画面中断，正在重连…')).toBeInTheDocument();
    const next = '/vigil-flv/live-nodvr/b_screen.flv';
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: next, camera: null },
    });
    view.rerender(playerElement());
    expect(screen.queryByText('画面中断，正在重连…')).toBeNull();
    expect(playedUrls()).toEqual([SCREEN_URL, next]);
  });

  it('recreates the player only after 2 seconds, and only once if ERROR fires twice', async () => {
    vi.useFakeTimers();
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    const handlers = mpegts.players[0]?.handlers.get(mpegts.Events.ERROR) ?? [];
    expect(handlers).toHaveLength(1);
    await act(async () => {
      handlers[0]?.();
      handlers[0]?.();
    });
    expect(screen.getByText('画面中断，正在重连…')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(playedUrls()).toEqual([SCREEN_URL]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(playedUrls()).toEqual([SCREEN_URL, SCREEN_URL]);
    expect(screen.queryByText('画面中断，正在重连…')).toBeNull();
  });

  it('reconnects again after the replacement player errors', async () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    const first = mpegts.players[0];
    await act(async () => {
      first?.handlers.get(mpegts.Events.ERROR)?.[0]?.();
    });
    await waitFor(() => {
      expect(playedUrls()).toEqual([SCREEN_URL, SCREEN_URL]);
    }, { timeout: 3500 });
    const second = mpegts.players[1];
    await act(async () => {
      second?.handlers.get(mpegts.Events.ERROR)?.[0]?.();
    });
    expect(screen.getByText('画面中断，正在重连…')).toBeInTheDocument();
    await waitFor(() => {
      expect(playedUrls()).toEqual([SCREEN_URL, SCREEN_URL, SCREEN_URL]);
    }, { timeout: 3500 });
  });

  it('removes the media src when the player unmounts', () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) {
      throw new TypeError('missing video');
    }
    const removeAttribute = vi.spyOn(video, 'removeAttribute');
    view.unmount();
    expect(removeAttribute).toHaveBeenCalledWith('src');
    removeAttribute.mockRestore();
  });

  it('does not label a later starting as a recording switch when renew stayed live', async () => {
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    mpegts.createPlayer.mockClear();
    lease.state = watchState({
      status: 'starting',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    view.rerender(playerElement());
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在切换到录制…')).toBeNull();
    expect(playedUrls()).toEqual([]);
  });

  it('drops the recording-switch copy when the dialog closes before the next watch', async () => {
    lease.setRecording.mockImplementation(() => new Promise(() => {}));
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = render(
      <LivePlayerDialog
        open
        onOpenChange={vi.fn()}
        contestId={CONTEST_ID}
        student={student()}
        recordEnabled={false}
      />,
    );
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    lease.state = null;
    view.rerender(
      <LivePlayerDialog
        open={false}
        onOpenChange={vi.fn()}
        contestId={CONTEST_ID}
        student={student()}
        recordEnabled={false}
      />,
    );
    mpegts.createPlayer.mockClear();
    lease.state = watchState({
      status: 'starting',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    view.rerender(
      <LivePlayerDialog
        open
        onOpenChange={vi.fn()}
        contestId={CONTEST_ID}
        student={student()}
        recordEnabled={false}
      />,
    );
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在切换到录制…')).toBeNull();
    expect(playedUrls()).toEqual([]);
  });

  it('does not paint a recording failure onto the student opened while the request is in flight', async () => {
    let rejectRecording: (reason?: unknown) => void = () => {};
    lease.setRecording.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRecording = reject;
    }));
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    const view = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    view.rerender(playerElement({
      machineId: 'm2',
      examSessionId: 'sess-2',
      uid: 43,
      name: '李四',
      studentId: '20231002',
    }));
    expect(screen.getByText('直播 · 李四')).toBeInTheDocument();
    await act(async () => {
      rejectRecording(new Error('没有权限'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(RECORD_ERROR)).toBeNull();
  });

  it('does not restore a recording switch after the lease leaves starting', async () => {
    lease.state = watchState({ status: 'starting', mode: 'watch' });
    const startView = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('录制'));
    });
    expect(screen.getByText('正在切换到录制…')).toBeInTheDocument();
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    startView.rerender(playerElement());
    lease.state = watchState({ status: 'starting', mode: 'watch' });
    startView.rerender(playerElement());
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在切换到录制…')).toBeNull();
    startView.unmount();

    lease.state = watchState({ status: 'starting', mode: 'manual' });
    const stopView = renderPlayer();
    await act(async () => {
      fireEvent.click(buttonNamed('停止录制'));
    });
    expect(screen.getByText('正在停止录制…')).toBeInTheDocument();
    lease.state = watchState({
      status: 'failed',
      mode: 'manual',
      reason: 'client_offline',
      detail: '',
    });
    stopView.rerender(playerElement());
    lease.state = watchState({ status: 'starting', mode: 'manual' });
    stopView.rerender(playerElement());
    expect(screen.getByText('正在连接考生画面…')).toBeInTheDocument();
    expect(screen.queryByText('正在停止录制…')).toBeNull();
  });

  it('shows the unsupported-browser copy when mse live playback is unavailable', () => {
    mpegts.feature.mseLivePlayback = false;
    lease.state = watchState({
      status: 'live',
      mode: 'watch',
      streams: { screen: SCREEN_URL, camera: null },
    });
    renderPlayer();
    expect(screen.getByText('当前浏览器不支持直播播放，请使用最新版 Chrome 或 Edge')).toBeInTheDocument();
    expect(playedUrls()).toEqual([]);
  });

  it('does not reference hls.js or buildHlsStreamUrl', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/vigil/live-player-dialog.tsx'), 'utf8');
    expect(source.includes('hls.js')).toBe(false);
    expect(source.includes('buildHlsStreamUrl')).toBe(false);
  });
});
