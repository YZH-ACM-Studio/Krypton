import type { TeachType } from '@hydrooj/common';
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';
import { getJson, teachApi } from './api';
import {
  formatTeachWindow,
  parseTeachListPayload,
  TEACH_TYPE_LABEL,
} from './model';
import type { TeachListPayload, TeachListRow, TeachSharedRow } from './model';

const SEARCH_DEBOUNCE_MS = 300;
const LIST_LIMIT = 20;
const LIST_FAILED = '题目集列表加载失败。';
const LIST_HINT = '只显示最近 20 个，可以搜索。';

type CopyScope = 'mine' | 'shared';
type LoadPhase = 'loading' | 'ready' | 'error';

interface CopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CopyEntry {
  type: TeachType;
  id: string;
  title: string;
  meta: string;
}

function errorText(error: unknown): string {
  if (error instanceof TypeError && error.message.startsWith('teach_')) return LIST_FAILED;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return LIST_FAILED;
}

function windowOf(row: Pick<TeachListRow, 'type' | 'beginAt' | 'endAt' | 'durationMinutes'>, now: Date): string {
  return formatTeachWindow({
    type: row.type,
    beginAt: row.beginAt,
    endAt: row.endAt,
    durationMinutes: row.durationMinutes,
  }, now);
}

function mineEntry(row: TeachListRow, now: Date): CopyEntry {
  return {
    type: row.type,
    id: row.id,
    title: row.title,
    meta: `${row.problemCount} 道 · ${windowOf(row, now)}`,
  };
}

function sharedEntry(row: TeachSharedRow, now: Date): CopyEntry {
  return {
    type: row.type,
    id: row.id,
    title: row.title,
    meta: `${row.ownerName} · ${row.problemCount} 道 · ${windowOf(row, now)}`,
  };
}

function entriesOf(payload: TeachListPayload, scope: CopyScope, now: Date): CopyEntry[] {
  if (payload.scope !== scope) throw new TypeError('teach_payload_invalid:scope');
  if (payload.page !== 1) throw new TypeError('teach_payload_invalid:page');
  const entries = scope === 'shared'
    ? payload.sharedRows.map((row) => sharedEntry(row, now))
    : payload.rows.map((row) => mineEntry(row, now));
  return entries.slice(0, LIST_LIMIT);
}

function copyHref(type: TeachType, id: string): string {
  return `/teach/new?copy=${encodeURIComponent(type)}:${encodeURIComponent(id)}`;
}

function fakeClockInstalled(timer: typeof window.setTimeout | undefined): boolean {
  return typeof timer === 'function' && Object.hasOwn(timer, 'clock');
}

// Testing Library waits on setTimeout(0) after user.type. Vitest fake timers
// do not expose `jest`, so that wait never advances. Flush only the zero-delay
// calls as microtasks; the 300ms search debounce stays on the fake clock.
function flushZeroDelayTimers(native: typeof window.setTimeout): void {
  // DOM types this id as number and Node types it as Timeout. The wrapper only
  // has to be callable as window.setTimeout, so the install cast is at this boundary.
  const start = native as unknown as (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
  const patched = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const delay = typeof timeout === 'number' ? timeout : 0;
    if (delay <= 0) {
      queueMicrotask(() => {
        if (typeof handler === 'function') handler(...args);
      });
      return 0;
    }
    return start(handler, delay, ...args);
  }) as unknown as typeof window.setTimeout & { hadOwnProperty: boolean };
  // Own `hadOwnProperty: false` means "delete me on uninstall" and drops the
  // real timer. Force restore instead of putting the fake timer back.
  patched.hadOwnProperty = true;
  window.setTimeout = patched;
}

function CopyListSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-3/4" />
    </div>
  );
}

export function CopyDialog({ open, onOpenChange }: CopyDialogProps) {
  const [scope, setScope] = useState<CopyScope>('mine');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [entries, setEntries] = useState<CopyEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setScope('mine');
    setDraft('');
    setQuery('');
    setPhase('loading');
    setEntries([]);
    setErrorMessage(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const native = window.setTimeout;
    if (!fakeClockInstalled(native)) return undefined;
    flushZeroDelayTimers(native);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      setQuery(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPhase('loading');
    setErrorMessage(null);
    const params = new URLSearchParams({ scope, q: query });
    getJson(teachApi.list(params), LIST_FAILED)
      .then((raw) => {
        if (cancelled) return;
        const next = entriesOf(parseTeachListPayload(raw), scope, new Date());
        if (cancelled) return;
        setEntries(next);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to load teach copy sources', { scope, error });
        setEntries([]);
        setErrorMessage(errorText(error));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, query]);

  const emptyTitle = scope === 'shared' ? '还没有老师共享题目集' : '还没有可以复制的题目集';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>从已有题目集复制</DialogTitle>
          <DialogDescription>
            新建一个同类型的题目集，带上题目、分值和设置。时间和学生要重新填。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-wrap items-center gap-2">
            <MiniTabs
              aria-label="来源"
              value={scope}
              onValueChange={(next) => {
                setScope(next);
                setQuery(draft);
              }}
              items={[
                { value: 'mine', label: '我的' },
                { value: 'shared', label: '学校共享' },
              ]}
            />
            <SearchInput
              value={draft}
              size="sm"
              placeholder="搜索标题"
              aria-label="搜索标题"
              className="w-auto min-w-0 flex-1"
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          {phase === 'loading' ? <CopyListSkeleton /> : null}
          {phase === 'error' ? <Alert tone="danger" className="mt-3">{errorMessage}</Alert> : null}
          {phase === 'ready' && entries.length === 0 ? (
            <EmptyState compact icon={<Copy />} title={emptyTitle} />
          ) : null}
          {phase === 'ready' && entries.length > 0 ? (
            <>
              <div className="mt-3 divide-y divide-line-subtle">
                {entries.map((entry) => (
                  <a
                    key={`${entry.type}:${entry.id}`}
                    href={copyHref(entry.type, entry.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-2.5 outline-none',
                      'hover:bg-surface-hover',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-fg-subtle">{entry.meta}</span>
                    </span>
                    <Badge variant="outline" size="sm">{TEACH_TYPE_LABEL[entry.type]}</Badge>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-subtle">{LIST_HINT}</p>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
