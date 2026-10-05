/**
 * LivePlayerDialog — screen live view with an optional camera picture-in-picture.
 *
 * Opening the dialog takes a watch lease and closing, hiding, or unmounting
 * releases it. Playback is HTTP-FLV only; the lease supplies the stream URLs.
 * Watch mode offers 录制, manual mode offers 停止录制, record mode shows
 * 全程录制中, and legacy mode shows no recording control.
 * At most four dialogs may watch at once.
 *
 * Screenshot, lock, and message stay in the header so the proctor can act
 * without leaving the player.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import mpegts from 'mpegts.js';
import { AlertTriangle, Camera, Lock, MessageSquare, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';
import type { VigilStreamMode, VigilStudentCard, VigilWatchFailure, VigilWatchState } from '@/lib/vigil-api';
import { useStreamLease } from '@/pages/vigil/use-stream-lease';
import { cn } from '@/lib/cn';

const MAX_CONCURRENT_PLAYERS = 4;
const RECONNECT_DELAY_MS = 2000;
const RECORD_ERROR_DISMISS_MS = 3000;

// Module-level — survives React Strict-mode double mounts.
let liveOpenCount = 0;

type RecordingSwitch = 'start' | 'stop' | null;

interface LivePlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  student: VigilStudentCard;
  /** Kept for callers. Recording controls follow the lease mode, not this flag. */
  recordEnabled: boolean;
  /** Click on "📷 截屏" — caller wires to useProctorCommands. */
  onCaptureScreenshot?: () => void;
  /** Click on "🔒 锁屏". */
  onLockScreen?: () => void;
  /** Click on "💬 消息". */
  onSendMessage?: () => void;
}

function failureCopy(reason: VigilWatchFailure | null, detail: string): string {
  switch (reason) {
    case 'client_offline':
      return '考生离线，客户端重新连上后会自动恢复画面';
    case 'live_disabled':
      return '本场考试未开启直播';
    case 'no_media_node':
      return '无可用媒体节点，请联系管理员检查流媒体服务';
    case 'publish_failed':
      return `考生端推流启动失败：${detail || '未知原因'}`;
    case 'no_video_timeout':
      return '15 秒内未收到画面，可能是考生网络或客户端异常';
    case 'session_not_active':
      return '该考生当前没有进行中的考试';
    case null:
      return '直播失败';
    default: {
      const unexpected: never = reason;
      throw new Error(`未知直播失败原因：${String(unexpected)}`);
    }
  }
}

function startingCopy(state: VigilWatchState | null, recordingSwitch: RecordingSwitch): string {
  if (state?.status === 'starting' && recordingSwitch === 'start') return '正在切换到录制…';
  if (state?.status === 'starting' && recordingSwitch === 'stop') return '正在停止录制…';
  if (state?.status === 'starting' && (state.mode === 'watch' || state.mode === 'manual')) {
    return '正在连接考生画面…';
  }
  return '正在加载直播…';
}

function recordingErrorText(reason: unknown): string {
  if (reason instanceof Error && reason.message !== '') return `录制操作失败：${reason.message}`;
  if (typeof reason === 'string' && reason !== '') return `录制操作失败：${reason}`;
  return '录制操作失败：未知错误';
}

export function LivePlayerDialog({
  open,
  onOpenChange,
  contestId,
  student,
  onCaptureScreenshot,
  onLockScreen,
  onSendMessage,
}: LivePlayerDialogProps) {
  const bs = useBootstrap();
  // The lease reads `open` in this render. A later effect would watch a fifth
  // dialog once, then release it. Re-check only when `open` changes so a dialog
  // that already holds a slot is not capped by its own count.
  const [overLimit, setOverLimit] = useState(() => open && liveOpenCount >= MAX_CONCURRENT_PLAYERS);
  const [trackedOpen, setTrackedOpen] = useState(open);
  let limit = overLimit;
  if (open !== trackedOpen) {
    setTrackedOpen(open);
    const nextLimit = open && liveOpenCount >= MAX_CONCURRENT_PLAYERS;
    if (nextLimit !== overLimit) setOverLimit(nextLimit);
    limit = nextLimit;
  }
  const lease = useStreamLease({
    open: open && !limit,
    contestId,
    machineId: student.machineId,
    actor: { uid: bs.user.id, displayName: bs.user.name },
  });
  const [recordingSwitch, setRecordingSwitch] = useState<RecordingSwitch>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const switchStatus = useRef<VigilWatchState['status'] | null>(null);
  const switchMoved = useRef(false);
  const attemptRef = useRef(0);
  const machineIdRef = useRef(student.machineId);
  const statusRef = useRef<VigilWatchState['status'] | null>(null);
  const { state, networkError, retry, setRecording, recordingBusy } = lease;
  machineIdRef.current = student.machineId;
  statusRef.current = state?.status ?? null;

  useEffect(() => {
    if (!open || overLimit) return undefined;
    if (liveOpenCount >= MAX_CONCURRENT_PLAYERS) {
      setOverLimit(true);
      return undefined;
    }
    liveOpenCount += 1;
    return () => {
      liveOpenCount = Math.max(0, liveOpenCount - 1);
    };
  }, [open, overLimit]);

  useEffect(() => {
    if (recordingSwitch === null) return;
    const status = state?.status ?? null;
    // The status already on screen at the click is not "becoming" live/failed.
    if (!switchMoved.current) {
      if (status === switchStatus.current) return;
      switchMoved.current = true;
    }
    if (status === 'live' || status === 'failed') setRecordingSwitch(null);
  }, [recordingSwitch, state?.status]);

  useEffect(() => {
    if (open) return;
    // The dialog stays mounted across close. A new open is a new watch, not
    // the recording switch that was in progress when the proctor closed it.
    attemptRef.current += 1;
    switchStatus.current = null;
    switchMoved.current = false;
    setRecordingSwitch(null);
  }, [open]);

  useEffect(() => {
    switchStatus.current = null;
    switchMoved.current = false;
    setRecordingSwitch(null);
    setRecordError(null);
  }, [contestId, student.machineId]);

  useEffect(() => {
    if (recordError === null) return undefined;
    const timer = window.setTimeout(() => {
      setRecordError(null);
    }, RECORD_ERROR_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [recordError]);

  const requestRecording = (enabled: boolean) => {
    const machineId = student.machineId;
    const attempt = attemptRef.current;
    switchMoved.current = false;
    switchStatus.current = state?.status ?? null;
    setRecordingSwitch(enabled ? 'start' : 'stop');
    const stillThisRequest = () => (
      attemptRef.current === attempt && machineIdRef.current === machineId
    );
    void setRecording(enabled).then(() => {
      if (!stillThisRequest()) return;
      setRecordError(null);
      // A renew that stays live or failed never entered the switch's starting
      // phase. Drop the label so a later reconnect is not called a recording change.
      if (statusRef.current !== 'starting') {
        switchMoved.current = false;
        switchStatus.current = null;
        setRecordingSwitch(null);
      }
    }, (reason: unknown) => {
      if (!stillThisRequest()) return;
      switchMoved.current = false;
      switchStatus.current = null;
      setRecordingSwitch(null);
      setRecordError(recordingErrorText(reason));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="max-sm:h-[85dvh]" showCloseButton={false}>
        <DialogHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate pr-0">
              直播 · {student.name}
              {student.studentId && <span className="ml-2 font-mono text-xs font-normal text-fg-subtle">{student.studentId}</span>}
            </DialogTitle>
            <p className="truncate font-mono text-2xs text-fg-subtle">{student.machineId}</p>
          </div>
          <div className="flex min-w-0 max-w-full flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <RecordingControl mode={state?.mode} recordingBusy={recordingBusy} onSetRecording={requestRecording} />
              <Button type="button" size="sm" variant="ghost" onClick={onCaptureScreenshot}>
                <Camera />
                截屏
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onLockScreen}>
                <Lock />
                锁屏
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onSendMessage}>
                <MessageSquare />
                消息
              </Button>
              <Button type="button" size="sm" variant="ghost" iconOnly aria-label="关闭" title="关闭" onClick={() => onOpenChange(false)}>
                <X />
              </Button>
            </div>
            {recordError !== null && (
              <p role="alert" className="w-full min-w-0 max-w-full break-words text-right text-sm text-danger-fg">{recordError}</p>
            )}
          </div>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {limit ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-surface-sunken p-10">
              <AlertTriangle className="size-10 text-warning-fg" />
              <p className="text-sm font-medium text-fg">已达 {MAX_CONCURRENT_PLAYERS} 路直播上限</p>
              <p className="max-w-md text-center text-xs text-fg-subtle">
                为保证机房网络稳定，同时打开的直播窗口数有限制。请先关闭其他直播窗口，再尝试打开新的直播。
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </div>
          ) : (
            <LiveVideoCanvas
              state={state}
              networkError={networkError}
              recordingSwitch={recordingSwitch}
              onRetry={retry}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function RecordingControl({
  mode,
  recordingBusy,
  onSetRecording,
}: {
  mode: VigilStreamMode | undefined;
  recordingBusy: boolean;
  onSetRecording: (enabled: boolean) => void;
}) {
  if (mode === 'record') {
    return <Badge tone="danger" dot>全程录制中</Badge>;
  }
  if (mode === 'watch') {
    return (
      <Button type="button" variant="ghost" size="sm" disabled={recordingBusy} onClick={() => onSetRecording(true)}>
        录制
      </Button>
    );
  }
  if (mode === 'manual') {
    return (
      <>
        <Button type="button" variant="ghost" size="sm" disabled={recordingBusy} onClick={() => onSetRecording(false)}>
          停止录制
        </Button>
        <Badge tone="danger" dot>录制中</Badge>
      </>
    );
  }
  return null;
}

/* ─── Internal video canvas ────────────────────────────────────────────── */

function LiveVideoCanvas({
  state,
  networkError,
  recordingSwitch,
  onRetry,
}: {
  state: VigilWatchState | null;
  networkError: string | null;
  recordingSwitch: RecordingSwitch;
  onRetry: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // PIP camera position — anchored to bottom-right by default, but user
  // can drag it anywhere inside the screen canvas. State is the
  // translation away from the bottom-right anchor so resizing the
  // dialog doesn't strand it.
  const [pipOffset, setPipOffset] = useState({ dx: 0, dy: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null);

  const onPipMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseDx: pipOffset.dx,
      baseDy: pipOffset.dy,
    };
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragRef.current) return;
      const { startX, startY, baseDx, baseDy } = dragRef.current;
      setPipOffset({
        dx: baseDx + (ev.clientX - startX),
        dy: baseDy + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onPipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = 24;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else return;
    event.preventDefault();
    setPipOffset((offset) => ({ dx: offset.dx + dx, dy: offset.dy + dy }));
  };

  const screenUrl = state?.status === 'live' ? state.streams.screen : null;
  const cameraUrl = state?.status === 'live' ? state.streams.camera : null;

  let body: ReactNode;
  if (state === null || state.status === 'starting') {
    body = (
      <div className="flex h-full w-full items-center justify-center px-6 text-center">
        <p className="max-w-md text-sm text-white">{startingCopy(state, recordingSwitch)}</p>
      </div>
    );
  } else if (state.status === 'failed') {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-md text-sm text-white">{failureCopy(state.reason, state.detail)}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>重试</Button>
      </div>
    );
  } else if (screenUrl !== null) {
    body = (
      <LiveVideo key={screenUrl} src={screenUrl} kind="screen" className="h-full w-full object-contain" />
    );
  } else {
    body = null;
  }

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black">
      {networkError !== null && (
        <p role="status" className="shrink-0 bg-warning-soft px-3 py-1.5 text-center text-sm text-fg">
          {networkError}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {body}
        {cameraUrl !== null && (
          <div
            role="group"
            tabIndex={0}
            aria-label="摄像头画中画，方向键可移动"
            className="group absolute right-4 bottom-4 aspect-[4/3] w-24 cursor-move overflow-hidden rounded-md border-2 border-white/30 bg-black shadow-pop select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-40 lg:w-56"
            style={{ transform: `translate(${pipOffset.dx}px, ${pipOffset.dy}px)` }}
            onMouseDown={onPipMouseDown}
            onKeyDown={onPipKeyDown}
            title="拖动可移动摄像头窗口"
          >
            <div className="pointer-events-none invisible absolute top-1 left-1 flex gap-0.5 group-hover:visible">
              <span className="size-1 rounded-full bg-white"></span>
              <span className="size-1 rounded-full bg-white"></span>
              <span className="size-1 rounded-full bg-white"></span>
            </div>
            <LiveVideo key={cameraUrl} src={cameraUrl} kind="camera" className="h-full w-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * HTTP-FLV monitor video. `key={src}` remounts when the lease URL changes.
 * An mpegts error destroys the player, shows a reconnect notice, and creates
 * a new player after 2 seconds for as long as the dialog stays open.
 */
function LiveVideo({ src, kind, className }: { src: string; kind: 'screen' | 'camera'; className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [brokenAttempt, setBrokenAttempt] = useState<number | null>(null);
  const supported = mpegts.getFeatureList().mseLivePlayback;
  const interrupted = brokenAttempt === attempt;

  useEffect(() => {
    if (!supported) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let player: ReturnType<typeof mpegts.createPlayer> | null = null;
    let reconnectTimer: number | null = null;
    let failed = false;

    const destroyPlayer = () => {
      const current = player;
      if (current === null) return;
      player = null;
      try {
        current.pause();
      } catch {
        /* ignore */
      }
      try {
        current.unload();
      } catch {
        /* ignore */
      }
      try {
        current.detachMediaElement();
      } catch {
        /* ignore */
      }
      try {
        current.destroy();
      } catch {
        /* ignore */
      }
    };

    const onError = () => {
      if (failed) return;
      failed = true;
      destroyPlayer();
      setBrokenAttempt(attempt);
      reconnectTimer = window.setTimeout(() => {
        setAttempt((current) => current + 1);
      }, RECONNECT_DELAY_MS);
    };

    try {
      player = mpegts.createPlayer(
        { type: 'flv', isLive: true, url: src, hasAudio: kind === 'camera', hasVideo: true },
        { enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false },
      );
      player.on(mpegts.Events.ERROR, onError);
      player.attachMediaElement(video);
      player.load();
      video.play().catch(() => {
        /* autoplay blocked */
      });
    } catch {
      onError();
    }

    return () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      destroyPlayer();
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [attempt, kind, src, supported]);

  if (!supported) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-black px-4 text-center text-sm text-white', className)}>
        <p>当前浏览器不支持直播播放，请使用最新版 Chrome 或 Edge</p>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <video
        ref={videoRef}
        autoPlay
        muted={kind === 'screen'}
        playsInline
        className={cn('h-full w-full', kind === 'camera' ? 'object-cover' : 'object-contain')}
        controls={false}
      />
      {interrupted && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-4 text-center text-sm text-white">
          <p>画面中断，正在重连…</p>
        </div>
      )}
    </div>
  );
}
