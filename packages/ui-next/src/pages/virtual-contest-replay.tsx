import { useEffect, useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import type { ContestReplayFrame } from '@hydrooj/common';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { contestProblemLetter } from '@/lib/competitive-companion';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

type Playback = { mode: 'live' } | { mode: 'paused' | 'playing'; at: number };
const sources = { official: '正式', virtual: '历史 VP', self: '本次 VP' };
const speeds = [1, 4, 16, 60];

function clockLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReplay(value: unknown): value is ContestReplayFrame {
  if (
    !object(value) ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.pids) ||
    !value.pids.every(finiteNumber) ||
    !finiteNumber(value.atMs) ||
    !finiteNumber(value.availableMs) ||
    !finiteNumber(value.durationMs) ||
    value.atMs < 0 ||
    value.atMs > value.availableMs ||
    value.availableMs > value.durationMs ||
    typeof value.ended !== 'boolean' ||
    typeof value.frozen !== 'boolean' ||
    !finiteNumber(value.incomplete) ||
    typeof value.hideTotals !== 'boolean' ||
    !['ioi', 'highest', 'acm'].includes(String(value.rule))
  ) {
    return false;
  }
  const columns = value.pids.length;
  return value.rows.every(
    (row: unknown) =>
      object(row) &&
      finiteNumber(row.uid) &&
      typeof row.name === 'string' &&
      (row.source === 'official' || row.source === 'self' || row.source === 'virtual') &&
      Array.isArray(row.cells) &&
      row.cells.length === columns &&
      row.cells.every((cell: unknown) => cell === null || finiteNumber(cell) || typeof cell === 'string') &&
      (value.hideTotals
        ? row.rank === undefined && row.score === undefined && row.maxPoints === undefined && row.passed === undefined && row.seconds === undefined
        : finiteNumber(row.rank) && finiteNumber(row.score) && (row.maxPoints === undefined || finiteNumber(row.maxPoints)) &&
          (value.rule !== 'ioi' || row.passed === null || finiteNumber(row.passed)) &&
          (value.rule === 'highest' || row.seconds === null || finiteNumber(row.seconds))),
  );
}

async function fetchFrame(path: string, at: number | undefined, signal: AbortSignal) {
  const url = new URL(path, window.location.href);
  if (at !== undefined) url.searchParams.set('at', String(Math.floor(at)));
  const response = await fetchHydroResponse(
    url,
    {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    '读取重放榜单失败',
  );
  if (!response.ok) throw new Error(await readHydroResponseError(response, '读取重放榜单失败'));
  const data: unknown = await response.json();
  if (!object(data) || !isReplay(data.replay)) throw new Error('榜单重放数据格式错误');
  return data.replay;
}

export function VirtualContestReplay({ url }: { url: string }) {
  const [frame, setFrame] = useState<ContestReplayFrame | null>(null);
  const [playback, setPlayback] = useState<Playback>({ mode: 'live' });
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    const started = performance.now();
    const update = async () => {
      if (document.hidden || fetching) return;
      fetching = true;
      const at = playback.mode === 'live' ? undefined : playback.at + (playback.mode === 'playing' ? (performance.now() - started) * speed : 0);
      try {
        const next = await fetchFrame(url, at, controller.signal);
        if (controller.signal.aborted) return;
        setFrame(next);
        setError('');
        if (playback.mode === 'playing' && next.atMs >= next.availableMs) {
          setPlayback(next.ended ? { mode: 'paused', at: next.durationMs } : { mode: 'live' });
        } else if (playback.mode === 'playing' || (playback.mode === 'live' && !next.ended)) {
          timer = setTimeout(
            () => {
              void update();
            },
            playback.mode === 'live' ? 5000 : 1000,
          );
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFrame(null);
        setError(cause instanceof Error ? cause.message : '读取重放榜单失败');
      } finally {
        fetching = false;
      }
    };
    // Coalesce slider movement and keep at most one request in flight per player.
    timer = setTimeout(
      () => {
        void update();
      },
      playback.mode === 'paused' ? 140 : 0,
    );
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void update();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, playback, speed, retry]);

  if (error) {
    return (
      <Alert
        tone="danger"
        title={error}
        action={
          <Button size="sm" variant="secondary" onClick={() => setRetry(retry + 1)}>
            重试
          </Button>
        }
      />
    );
  }
  if (!frame) {
    return (
      <p role="status" className="text-sm text-fg-muted">
        正在读取榜单…
      </p>
    );
  }
  const at = playback.mode === 'paused' ? Math.min(playback.at, frame.availableMs) : frame.atMs;
  const playing = playback.mode === 'playing' || (playback.mode === 'live' && !frame.ended);
  return (
    <div className="min-w-0 space-y-4">
      <Panel>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tabular text-sm font-semibold">
              回放时间 {clockLabel(frame.atMs)} / {clockLabel(frame.durationMs)}
            </span>
            {frame.frozen ? <Badge tone="warning">已封榜</Badge> : null}
          </div>
          <Input
            aria-label="回放时间"
            aria-valuetext={clockLabel(at)}
            type="range"
            min={0}
            max={frame.availableMs}
            step="any"
            value={at}
            disabled={!frame.availableMs}
            className="cursor-pointer accent-brand"
            onChange={(event) => setPlayback({ mode: 'paused', at: Math.round(event.currentTarget.valueAsNumber) })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPlayback(playing ? { mode: 'paused', at } : { mode: 'playing', at: at >= frame.durationMs ? 0 : at })}
            >
              {playing ? <Pause /> : <Play />}
              {playing ? '暂停' : '播放'}
            </Button>
            <Select
              value={String(speed)}
              onValueChange={(value) => {
                setSpeed(Number(value));
                if (playback.mode === 'playing') setPlayback({ mode: 'playing', at });
              }}
            >
              <SelectTrigger size="sm" className="w-24" aria-label="播放倍速">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {speeds.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" disabled={playback.mode === 'live'} onClick={() => setPlayback({ mode: 'live' })}>
              <Radio />
              {frame.ended ? '最终榜' : playback.mode === 'live' ? '实时跟随' : '回到当前'}
            </Button>
          </div>
        </div>
      </Panel>
      {frame.incomplete > 0 ? <Alert tone="info">有 {frame.incomplete} 份旧成绩缺少过程明细，只计入公开的最终榜。</Alert> : null}
      <Panel flush>
        <Table density="compact" aria-label="重放榜单">
          <TableHeader>
            <TableRow>
              {!frame.hideTotals && <TableHead>名次</TableHead>}
              <TableHead>选手</TableHead>
              {!frame.hideTotals && <TableHead>{frame.rule === 'acm' ? '通过' : '得分'}</TableHead>}
              {!frame.hideTotals && frame.rule === 'ioi' && <TableHead>得分题数</TableHead>}
              {!frame.hideTotals && frame.rule !== 'highest' && <TableHead>{frame.rule === 'acm' ? '罚时' : '总用时'}</TableHead>}
              {frame.pids.map((pid, i) => (
                <TableHead key={pid} className="text-center">
                  {contestProblemLetter(i)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {frame.rows.map((row) => (
              <TableRow key={`${row.source}-${row.uid}`} className={row.source === 'self' ? 'bg-brand-soft' : undefined}>
                {!frame.hideTotals && <TableCell className="tabular">{row.rank || '*'}</TableCell>}
                <TableCell>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    {row.name}
                    <Badge tone={row.source === 'self' ? 'brand' : 'neutral'}>{sources[row.source]}</Badge>
                  </div>
                </TableCell>
                {!frame.hideTotals && <TableCell className="tabular">{row.maxPoints == null ? row.score : `${row.score}/${row.maxPoints}`}</TableCell>}
                {!frame.hideTotals && frame.rule === 'ioi' && <TableCell className="tabular">{row.passed ?? '—'}</TableCell>}
                {!frame.hideTotals && frame.rule !== 'highest' && (
                  <TableCell className="tabular">{typeof row.seconds === 'number' ? clockLabel(row.seconds * 1000) : '—'}</TableCell>
                )}
                {row.cells.map((cell, i) => (
                  <TableCell key={frame.pids[i]} className="whitespace-pre text-center tabular">
                    {cell ?? '—'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
