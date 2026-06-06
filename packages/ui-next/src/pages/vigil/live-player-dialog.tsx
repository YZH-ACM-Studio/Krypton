/**
 * LivePlayerDialog — picture-in-picture screen + camera live view.
 *
 * Layout (CLIENT_PROCTOR_MONITORING_DESIGN §8.4):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 直播 · 张三 · 学号                                       [✕]  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ [📷 截屏] [🔒 锁屏] [💬 消息]                                  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │                                                              │
 *   │           <video> screen (full-bleed, HLS.js)                │
 *   │                                                              │
 *   │                                              ┌──────────┐    │
 *   │                                              │ camera   │    │
 *   │                                              │  PIP     │    │
 *   │                                              └──────────┘    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * HLS handling:
 *   - hls.js handles MPEG-TS over m3u8 in all browsers that don't natively
 *     support it (most desktops in 2026 still need this).
 *   - On close we *must* run `hls.destroy() + video.pause() + video.src=''`
 *     so the browser releases the TCP connection and stops decoding. Failing
 *     to do this leaves the network tab in a "200 [pending]" state and pegs
 *     the GPU.
 *
 * Concurrency:
 *   §0.4 / Q17 → max 4 open live players at once (network bandwidth ceiling).
 *   We track open count in a module-level counter so it survives unmount/remount
 *   from drawer interactions. If a 5th open is attempted, the dialog renders
 *   a friendly "已达上限" notice instead of starting HLS.
 *
 * The proctor command shortcuts (screenshot / lock / message) live in this
 * dialog as a mirror of the drawer — the user typically opens the player
 * full-screen and doesn't want to lose context to act.
 */
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Camera, Lock, MessageSquare, X, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { buildFlvStreamUrl, buildHlsStreamUrl, type VigilStudentCard } from '@/lib/vigil-api';
import { cn } from '@/lib/cn';

const MAX_CONCURRENT_PLAYERS = 4;

// Module-level — survives React Strict-mode double mounts.
let liveOpenCount = 0;

interface LivePlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  student: VigilStudentCard;
  /** Whether SRS dvr is on for this contest — picks the right HLS app. */
  recordEnabled: boolean;
  /** Click on "📷 截屏" — caller wires to useProctorCommands. */
  onCaptureScreenshot?: () => void;
  /** Click on "🔒 锁屏". */
  onLockScreen?: () => void;
  /** Click on "💬 消息". */
  onSendMessage?: () => void;
}

export function LivePlayerDialog({
  open, onOpenChange, contestId, student, recordEnabled,
  onCaptureScreenshot, onLockScreen, onSendMessage,
}: LivePlayerDialogProps) {
  const [overLimit, setOverLimit] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    if (liveOpenCount >= MAX_CONCURRENT_PLAYERS) {
      setOverLimit(true);
      return undefined;
    }
    liveOpenCount += 1;
    setOverLimit(false);
    return () => {
      liveOpenCount = Math.max(0, liveOpenCount - 1);
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              直播 · {student.name}
              {student.studentId && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">{student.studentId}</span>
              )}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{student.machineId}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onCaptureScreenshot}>
              <Camera className="size-3.5" />截屏
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onLockScreen}>
              <Lock className="size-3.5" />锁屏
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onSendMessage}>
              <MessageSquare className="size-3.5" />消息
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onOpenChange(false)}
              title="关闭"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {overLimit ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-muted/20 p-10">
            <AlertTriangle className="size-10 text-amber-500" />
            <p className="text-sm font-medium">已达 {MAX_CONCURRENT_PLAYERS} 路直播上限</p>
            <p className="max-w-md text-center text-xs text-muted-foreground">
              为保证机房网络稳定，同时打开的直播窗口数有限制。请先关闭其他直播窗口，再尝试打开新的直播。
            </p>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        ) : (
          <LiveVideoCanvas
            contestId={contestId}
            machineId={student.machineId}
            recordEnabled={recordEnabled}
            cameraEnabled={student.streamState?.camera === 'started'}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Internal video canvas ────────────────────────────────────────────── */

function LiveVideoCanvas({
  contestId, machineId, recordEnabled, cameraEnabled,
}: {
  contestId: string;
  machineId: string;
  recordEnabled: boolean;
  cameraEnabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // PIP camera position — anchored to bottom-right by default, but user
  // can drag it anywhere inside the screen canvas. State is the
  // translation away from the bottom-right anchor so resizing the
  // dialog doesn't strand it.
  const [pipOffset, setPipOffset] = useState({ dx: 0, dy: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null);

  const onPipMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only drag with primary button + when clicking the chrome (border),
    // not on the inner video pixels.
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseDx: pipOffset.dx,
      baseDy: pipOffset.dy,
    };
    const onMove = (ev: MouseEvent) => {
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

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-black"
    >
      <LiveVideo
        flvSrc={buildFlvStreamUrl(contestId, machineId, 'screen', recordEnabled)}
        hlsSrc={buildHlsStreamUrl(contestId, machineId, 'screen', recordEnabled)}
        kind="screen"
        className="h-full w-full object-contain"
      />
      {cameraEnabled && (
        <div
          className="group absolute bottom-4 right-4 aspect-[4/3] w-56 cursor-move overflow-hidden rounded-md border-2 border-white/20 bg-black shadow-xl select-none"
          // Translate by user-drag offset relative to the bottom-right anchor.
          // Negative dy moves up, negative dx moves left (since the anchor is
          // bottom-right, positive deltas move outside the container).
          style={{ transform: `translate(${pipOffset.dx}px, ${pipOffset.dy}px)` }}
          onMouseDown={onPipMouseDown}
          title="拖动可移动摄像头窗口"
        >
          {/* Drag handle hint — small grip dots on hover */}
          <div className="pointer-events-none absolute left-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-60">
            <span className="size-1 rounded-full bg-white"></span>
            <span className="size-1 rounded-full bg-white"></span>
            <span className="size-1 rounded-full bg-white"></span>
          </div>
          {/* video pixels themselves don't initiate drag (pointer-events-none
              would break HLS rendering); pixels still receive mousedown via
              the parent — that's fine, just don't propagate from video */}
          <LiveVideo
            flvSrc={buildFlvStreamUrl(contestId, machineId, 'camera', recordEnabled)}
            hlsSrc={buildHlsStreamUrl(contestId, machineId, 'camera', recordEnabled)}
            kind="camera"
            className="h-full w-full object-cover"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Live monitor video. Primary path = HTTP-FLV via mpegts.js (~1-3s glass-to-
 * glass), the low-latency win over the old HLS-only path (~10s). HLS (hls.js,
 * or native on iOS Safari) is kept ONLY as a fallback for browsers without
 * MSE-FLV or when the FLV stream errors. Screen track is muted (silent); the
 * camera track is left unmuted so the newly-added microphone audio plays.
 */
function LiveVideo({ flvSrc, hlsSrc, kind, className }: {
  flvSrc: string; hlsSrc: string; kind: 'screen' | 'camera'; className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Latch to HLS once FLV proves unusable so we don't ping-pong between them.
  const [useHls, setUseHls] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    // ── Path A: HTTP-FLV via mpegts.js (low latency, primary) ──
    if (!useHls && mpegts.getFeatureList().mseLivePlayback) {
      const player = mpegts.createPlayer(
        { type: 'flv', isLive: true, url: flvSrc, hasAudio: kind === 'camera', hasVideo: true },
        // Disable the stash buffer + chase the live edge to keep latency low.
        { enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false },
      );
      let flvFailed = false;
      const fallback = () => {
        if (flvFailed) return;
        flvFailed = true;
        try { player.destroy(); } catch { /* ignore */ }
        setUseHls(true); // re-run effect on the HLS branch
      };
      player.on(mpegts.Events.ERROR, fallback);
      try {
        player.attachMediaElement(video);
        player.load();
        video.play().catch(() => { /* autoplay block; user can click */ });
      } catch { fallback(); }
      return () => {
        try { player.pause(); } catch { /* ignore */ }
        try { player.unload(); } catch { /* ignore */ }
        try { player.detachMediaElement(); } catch { /* ignore */ }
        try { player.destroy(); } catch { /* ignore */ }
        if (video) {
          try { video.pause(); } catch { /* ignore */ }
          video.removeAttribute('src');
          video.load();
        }
      };
    }

    // ── Path B: HLS fallback (MSE-FLV unavailable, or FLV errored) ──
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 2,
        liveMaxLatencyDuration: 6,
        maxBufferLength: 8,
        manifestLoadingTimeOut: 8_000,
        manifestLoadingMaxRetry: 3,
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => { hls!.loadSource(hlsSrc); });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            setError('网络错误，正在重试…');
            hls?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            setError('媒体解码错误，正在恢复…');
            hls?.recoverMediaError();
            break;
          default:
            setError(`无法播放：${data.details}`);
            hls?.destroy();
            break;
        }
      });
      video.play().catch(() => { /* autoplay block */ });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsSrc; // iOS Safari native HLS
      video.play().catch(() => { /* autoplay block; user can tap */ });
    } else {
      setError('当前浏览器不支持直播播放');
    }

    return () => {
      if (hls) { try { hls.destroy(); } catch { /* ignore */ } }
      if (video) {
        try { video.pause(); } catch { /* ignore */ }
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [flvSrc, hlsSrc, useHls, kind]);

  return (
    <div className={cn('relative', className)}>
      <video
        ref={videoRef}
        autoPlay
        muted={kind === 'screen'}
        playsInline
        className="h-full w-full"
        controls={false}
      />
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-xs text-white">
          <AlertTriangle className="size-6 text-amber-400" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
