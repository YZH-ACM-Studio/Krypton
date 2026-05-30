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
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Film, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
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
  const [activeId, setActiveId] = useState<string | null>(null);

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

  // Pick the first chunk by default when items / filter change.
  useEffect(() => {
    if (!candidates.length) {
      setActiveId(null);
      return;
    }
    if (!candidates.find((c) => c.recordingId === activeId)) {
      setActiveId(candidates[0].recordingId);
    }
  }, [candidates, activeId]);

  const active = candidates.find((c) => c.recordingId === activeId) || null;

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

          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">分片</label>
            <SimpleSelect
              size="sm"
              className="w-72"
              value={activeId || ''}
              onValueChange={(v) => setActiveId(v)}
              placeholder={candidates.length ? '选择分片' : '无可用分片'}
              disabled={!candidates.length}
              options={candidates.map((c) => ({
                value: c.recordingId,
                label: formatChunkLabel(c),
              }))}
            />
          </div>

          {active && (
            <p className="ml-auto text-[11px] text-muted-foreground">
              {formatBytes(active.size)} · {formatDuration(active.durationMs)}
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
          ) : active ? (
            <video
              key={active.recordingId /* force reset between chunks */}
              src={buildRecordingUrl(active.filename)}
              controls
              autoPlay={false}
              playsInline
              className="h-full w-full object-contain"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Formatting helpers ───────────────────────────────────────────────── */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatChunkLabel(c: VigilRecording): string {
  const start = new Date(c.startTs);
  const end = new Date(c.endTs);
  return `${pad2(start.getHours())}:${pad2(start.getMinutes())} - ${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}分${pad2(s)}秒`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
