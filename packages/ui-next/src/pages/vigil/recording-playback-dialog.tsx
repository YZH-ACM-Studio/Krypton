/**
 * RecordingPlaybackDialog — DVR mp4 playback for a single student.
 *
 * Shows only when `contest.recordEnabled = true`. Pulls the full recording
 * index for the contest from vigil-server, lets the proctor:
 *   - flip between screen / camera streams
 *   - pick a 30-minute chunk from the dropdown (SRS dvr_duration = 1800s)
 *   - scrub via the standard `<video>` controls
 *
 * Recordings are served as static mp4 through Caddy's /vigil-hls/recordings/*
 * route (no HLS — these are single-file dvr segments, mp4 muxing is done by
 * SRS at segment close).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Film, Pause, Play, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  buildRecordingUrl, listContestRecordings,
  type VigilRecording, type VigilStudentCard, VigilOfflineError,
} from '@/lib/vigil-api';

interface RecordingPlaybackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  student: VigilStudentCard;
}

type StreamType = 'screen' | 'camera';

export function RecordingPlaybackDialog({
  open, onOpenChange, contestId, student,
}: RecordingPlaybackDialogProps) {
  const [streamType, setStreamType] = useState<StreamType>('screen');
  const [items, setItems] = useState<VigilRecording[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    listContestRecordings(contestId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof VigilOfflineError) {
          setErr('反作弊服务不可用，无法加载录屏。');
        } else {
          setErr(e?.message || '加载录屏列表失败');
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, contestId]);

  // Filter to this machine + selected stream type, sorted by startTs asc so
  // the dropdown reads naturally as "earliest → latest".
  const candidates = useMemo(() => (items || [])
    .filter((r) => r.machineId === student.machineId && r.streamType === streamType)
    .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime()), [items, student.machineId, streamType]);

  const totalBytes = useMemo(() => candidates.reduce((s, c) => s + (c.size || 0), 0), [candidates]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[80vw] max-w-[1200px] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              录屏回放 · {student.name}
              {student.studentId && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">{student.studentId}</span>
              )}
            </p>
          </div>
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

        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-2">
          <div className="inline-flex rounded-md border bg-background p-0.5">
            <button
              type="button"
              className={`rounded-sm px-3 py-1 text-xs transition-colors ${
                streamType === 'screen' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
              onClick={() => setStreamType('screen')}
            >
              屏幕
            </button>
            <button
              type="button"
              className={`rounded-sm px-3 py-1 text-xs transition-colors ${
                streamType === 'camera' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
              onClick={() => setStreamType('camera')}
            >
              摄像头
            </button>
          </div>

          {candidates.length > 0 && (
            <p className="ml-auto text-[11px] text-muted-foreground">
              {candidates.length} 段 · 连续时间轴 · {formatBytes(totalBytes)}
            </p>
          )}
        </div>

        <div className="relative flex-1 bg-black">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-white/60">
              加载录屏列表…
            </div>
          ) : err ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-white/70">
              <AlertCircle className="size-6 text-amber-400" />
              <p>{err}</p>
            </div>
          ) : !candidates.length ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-white/70">
              <Film className="size-8" />
              <p>此学生在当前比赛暂无 {streamType === 'screen' ? '屏幕' : '摄像头'} 录屏。</p>
            </div>
          ) : (
            <UnifiedTimelinePlayer chunks={candidates} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Probe an mp4's duration (seconds) via a throwaway metadata-only load. */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (val: number) => {
      v.removeAttribute('src');
      try { v.load(); } catch { /* ignore */ }
      resolve(Number.isFinite(val) && val > 0 ? val : 0);
    };
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(0);
    v.src = url;
  });
}

/**
 * Cross-chunk unified-timeline player (issue 2.3 "进阶"): presents all 30-min
 * DVR chunks of a stream as ONE continuous video with a single seek bar.
 * Scrubbing maps the global position → (chunk, in-chunk offset), swaps the
 * <video> src when the chunk changes, and auto-advances on chunk end. Durations
 * come from the API when present, else probed via <video> metadata (SRS leaves
 * durationMs = 0). The single <video> + faststart mp4 (now produced by the AV1
 * transcode) gives a working, seekable scrubber.
 */
function UnifiedTimelinePlayer({ chunks }: { chunks: VigilRecording[] }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [globalTime, setGlobalTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Probe chunk durations (metadata only; cheap). Prefer the API value.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of chunks) {
        if (cancelled) return;
        const seconds = c.durationMs > 0
          ? c.durationMs / 1000
          // eslint-disable-next-line no-await-in-loop
          : await probeDuration(buildRecordingUrl(c.filename));
        if (cancelled) return;
        setDurations((d) => (d[c.recordingId] != null ? d : { ...d, [c.recordingId]: seconds }));
      }
    })();
    return () => { cancelled = true; };
  }, [chunks]);

  const layout = useMemo(() => {
    let acc = 0;
    const segs = chunks.map((c) => {
      const dur = durations[c.recordingId] ?? 0;
      const seg = { chunk: c, start: acc, dur };
      acc += dur;
      return seg;
    });
    return { segs, total: acc };
  }, [chunks, durations]);

  // Reset to the start when the chunk set (stream type) changes.
  useEffect(() => { setActiveIdx(0); setGlobalTime(0); setPlaying(false); }, [chunks]);

  const seekToGlobal = useCallback((t: number) => {
    const total = layout.total || 0;
    const clamped = Math.max(0, Math.min(t, total));
    let idx = layout.segs.findIndex((s) => clamped < s.start + s.dur);
    if (idx < 0) idx = Math.max(0, layout.segs.length - 1);
    const offset = clamped - (layout.segs[idx]?.start ?? 0);
    setGlobalTime(clamped);
    if (idx !== activeIdx) {
      pendingSeekRef.current = offset;
      setActiveIdx(idx);
    } else if (videoRef.current) {
      try { videoRef.current.currentTime = offset; } catch { /* not ready */ }
    }
  }, [layout, activeIdx]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }, []);

  const activeChunk = chunks[activeIdx];
  const activeStart = layout.segs[activeIdx]?.start ?? 0;
  if (!chunks.length) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          key={activeChunk?.recordingId}
          src={activeChunk ? buildRecordingUrl(activeChunk.filename) : undefined}
          playsInline
          className="h-full w-full object-contain"
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (!v) return;
            if (pendingSeekRef.current != null) {
              try { v.currentTime = pendingSeekRef.current; } catch { /* ignore */ }
              pendingSeekRef.current = null;
            }
            if (playing) v.play().catch(() => {});
          }}
          onTimeUpdate={() => {
            const v = videoRef.current;
            if (v) setGlobalTime(activeStart + v.currentTime);
          }}
          onEnded={() => {
            if (activeIdx < chunks.length - 1) {
              pendingSeekRef.current = 0;
              setActiveIdx(activeIdx + 1);
            } else {
              setPlaying(false);
            }
          }}
          onClick={togglePlay}
        />
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 bg-black/60 px-4 py-2">
        <button type="button" onClick={togglePlay} className="text-white/90 hover:text-white" title={playing ? '暂停' : '播放'}>
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-white/80">{formatClock(globalTime)}</span>
        <div
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/20"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seekToGlobal(ratio * (layout.total || 0));
          }}
          title="点击跳转（跨分片连续时间轴）"
        >
          {layout.segs.slice(1).map((s) => (
            <span
              key={s.chunk.recordingId}
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/40"
              style={{ left: `${layout.total ? (s.start / layout.total) * 100 : 0}%` }}
            />
          ))}
          <span
            className="absolute left-0 top-0 h-full rounded-full bg-primary"
            style={{ width: `${layout.total ? Math.min(100, (globalTime / layout.total) * 100) : 0}%` }}
          />
        </div>
        <span className="w-16 shrink-0 font-mono text-[11px] text-white/60">{formatClock(layout.total)}</span>
      </div>
    </div>
  );
}

/* ─── Formatting helpers ───────────────────────────────────────────────── */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
