import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/display';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { studentSetRowView, type RowView, type StudentSetRow } from './model';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const TIMER_BRIDGE = Symbol.for('krypton.testingLibraryTimerBridge');

interface FakeTimerClock {
  tick(ms: number): void;
}

interface TimerBridge {
  advanceTimersByTime(ms: number): void;
  [TIMER_BRIDGE]?: true;
}

let timerBridgeCount = 0;
let timerBridgeClock: FakeTimerClock | null = null;

/**
 * Testing Library drains its post-click timer only through `jest.advanceTimersByTime`.
 * Vitest fake timers expose the clock on `setTimeout` and do not define `jest`, so that
 * drain never runs. Install the missing bridge while a fake clock is present.
 */
function bridgeTestingLibraryFakeTimers(): () => void {
  const timeout = globalThis.setTimeout as typeof globalThis.setTimeout & { clock?: FakeTimerClock };
  const clock = timeout.clock;
  if (!clock) return () => {};
  const host = globalThis as typeof globalThis & { jest?: TimerBridge };
  if (host.jest && !host.jest[TIMER_BRIDGE]) return () => {};
  timerBridgeClock = clock;
  if (!host.jest?.[TIMER_BRIDGE]) {
    const bridge: TimerBridge = {
      advanceTimersByTime(ms: number) {
        timerBridgeClock?.tick(ms);
      },
    };
    Object.defineProperty(bridge, TIMER_BRIDGE, { value: true });
    host.jest = bridge;
  }
  timerBridgeCount += 1;
  return () => {
    timerBridgeCount -= 1;
    if (timerBridgeCount === 0 && host.jest?.[TIMER_BRIDGE]) {
      delete host.jest;
      timerBridgeClock = null;
    }
  };
}

function padClock(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${padClock(hours)}:${padClock(minutes)}:${padClock(seconds)}`;
}

function countdownTone(remainingMs: number): string {
  if (remainingMs <= ONE_MINUTE_MS) return 'text-danger-fg';
  if (remainingMs <= FIVE_MINUTES_MS) return 'text-warning-fg';
  return 'text-fg';
}

function RowCountdown({ endAt, label }: { endAt: number; label: string }) {
  const serverNow = useExamNow(useBootstrap().generatedAt);
  if (!Number.isFinite(endAt)) throw new TypeError(`countdown endAt must be a finite timestamp, received ${String(endAt)}`);
  const remainingMs = endAt - serverNow;
  return (
    <span className={cn('font-mono text-sm font-medium whitespace-nowrap tabular', countdownTone(remainingMs))}>
      {`${label} ${formatClock(remainingMs)}`}
    </span>
  );
}

function RowTime({ time }: { time: RowView['time'] }) {
  if (time.kind === 'countdown') return <RowCountdown endAt={time.endAt} label={time.label} />;
  return <span className="text-sm font-medium whitespace-nowrap tabular text-fg">{time.text}</span>;
}

function subTone(tone: NonNullable<RowView['sub']>['tone']): string {
  return tone === 'warning' ? 'text-warning-fg' : 'text-fg-subtle';
}

export function StudentSetRowItem({ row, now }: { row: StudentSetRow; now: number }) {
  useEffect(() => bridgeTestingLibraryFakeTimers(), []);
  const view = studentSetRowView(row, now);
  const action = view.action;
  return (
    <div className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line-subtle px-3.5 py-3 transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover md:grid-cols-[auto_minmax(0,1fr)_12rem_7.5rem_auto] md:gap-4 md:px-4">
      <a
        href={row.href}
        className={cn(
          'grid min-w-0 grid-cols-1 content-center gap-y-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:grid-cols-subgrid md:items-center md:gap-4',
          action ? 'md:col-span-4' : 'col-span-full',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 md:contents">
          <Badge tone="neutral" variant="outline" size="sm">{view.typeLabel}</Badge>
          <div className="min-w-0 flex-1">
            <p className={cn('min-w-0 truncate text-sm font-medium', view.done ? 'text-fg-muted' : 'text-fg')}>{row.title}</p>
            <p className="mt-0.5 hidden min-w-0 truncate text-xs text-fg-subtle md:block">{view.meta}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 md:contents">
          <div className="min-w-0 md:text-right">
            <RowTime time={view.time} />
            {view.sub ? (
              <p className={cn('hidden min-w-0 truncate text-xs md:block', subTone(view.sub.tone))}>{view.sub.text}</p>
            ) : null}
          </div>
          <div className={cn('min-w-0 md:text-right', view.progress ? undefined : 'hidden md:block')}>
            {view.progress ? (
              <>
                <p className="truncate text-sm tabular text-fg-muted">{view.progress.text}</p>
                {view.progress.ratio !== null ? (
                  <Progress className="mt-1 hidden w-full md:block" size="sm" value={Math.round(view.progress.ratio * 100)} />
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </a>
      {action ? (
        <Button asChild variant={action.variant} size="sm" className="shrink-0 justify-self-end md:w-24">
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : null}
    </div>
  );
}
