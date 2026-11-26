import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/display';
import { useBreakpoint, useMediaQuery } from '@/components/ui/media';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { useMotionTokens } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { getJson } from '@/pages/teach/api';
import { CalendarAgenda } from './calendar-agenda';
import {
  calendarHeadline,
  monthGrid,
  weekAgenda,
  type CalendarHeadline,
} from './calendar-layout';
import { CalendarMonth } from './calendar-month';
import { CalendarWeek } from './calendar-week';
import {
  parseStudentCalendar,
  schoolWeekStart,
  studentCalendarUrl,
  type ContestRow,
  type StudentCalendar,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SLIDE_PX = 24;
const CALENDAR_FAILED = '日历暂时打不开。';
const FOOTER = '练习没有时间，不在日历里；去「列表 › 练习」查看。组队没有时间，留在「列表 › 进行中」置顶。';
const PREVIOUS = '\u2039';
const NEXT = '\u203A';
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const LEGEND = [
  { label: '进行中', swatch: 'bg-success-soft' },
  { label: '24 小时内截止', swatch: 'bg-warning-soft' },
  { label: '未开始', swatch: 'border border-dashed border-line bg-surface' },
  { label: '已结束', swatch: 'bg-surface-sunken' },
] as const;

type CalendarMode = 'week' | 'month';
type SlideDirection = -1 | 0 | 1;

interface CalendarRange {
  fromMs: number;
  toMs: number;
}

interface CalendarSnapshot {
  mode: CalendarMode;
  offset: number;
  fromMs: number;
  toMs: number;
  rows: ContestRow[];
}

class CalendarPayloadError extends TypeError {}

function calendarRange(mode: CalendarMode, offset: number, nowMs: number): CalendarRange {
  if (mode === 'week') {
    const fromMs = schoolWeekStart(nowMs) + offset * WEEK_MS;
    return { fromMs, toMs: fromMs + WEEK_MS };
  }
  const grid = monthGrid([], offset, nowMs);
  return { fromMs: grid.fromMs, toMs: grid.toMs };
}

function acceptCalendar(raw: unknown, fromMs: number, toMs: number): StudentCalendar {
  let parsed: StudentCalendar;
  try {
    parsed = parseStudentCalendar(raw);
  } catch (error) {
    if (error instanceof TypeError) throw new CalendarPayloadError(error.message, { cause: error });
    throw error;
  }
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  if (parsed.from !== from || parsed.to !== to) {
    throw new CalendarPayloadError(`calendar response bounds ${parsed.from}..${parsed.to} do not match ${from}..${to}`);
  }
  return parsed;
}

function requestFailure(error: unknown): string {
  if (error instanceof Error && error.message !== '' && !(error instanceof CalendarPayloadError)) return error.message;
  return CALENDAR_FAILED;
}

function weekOffsetFor(weekStartMs: number, nowMs: number): number {
  const offset = (weekStartMs - schoolWeekStart(nowMs)) / WEEK_MS;
  if (!Number.isInteger(offset)) {
    throw new TypeError(`week start ${String(weekStartMs)} is not aligned to a school week`);
  }
  return offset;
}

/** A loaded month already covers this week when now sits in [fromMs, toMs). Otherwise keep the grid's first week. */
function projectNarrow(snapshot: CalendarSnapshot, nowMs: number): CalendarSnapshot {
  if (snapshot.mode === 'week') return snapshot;
  const coversNow = nowMs >= snapshot.fromMs && nowMs < snapshot.toMs;
  const weekStartMs = coversNow ? schoolWeekStart(nowMs) : snapshot.fromMs;
  const offset = weekOffsetFor(weekStartMs, nowMs);
  return {
    mode: 'week',
    offset,
    fromMs: weekStartMs,
    toMs: weekStartMs + WEEK_MS,
    rows: snapshot.rows,
  };
}

function sameView(snapshot: CalendarSnapshot, mode: CalendarMode, offset: number, range: CalendarRange): boolean {
  return snapshot.mode === mode
    && snapshot.offset === offset
    && snapshot.fromMs === range.fromMs
    && snapshot.toMs === range.toMs;
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
      {LEGEND.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 shrink-0 rounded-sm', item.swatch)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function RollingNumber({ value }: { value: number }) {
  const motion = useMotionTokens();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`calendar count must be a non-negative integer, received ${String(value)}`);
  }
  const digits = String(value).split('');
  const ease = motion.state.ease.join(',');
  return (
    <span className="inline-flex items-stretch text-3xl leading-none font-semibold tracking-tight text-fg tabular" aria-label={String(value)}>
      {digits.map((digit, index) => {
        const offset = Number(digit);
        if (!Number.isInteger(offset) || offset < 0 || offset > 9) {
          throw new TypeError(`calendar count digit must be 0-9, received ${digit}`);
        }
        return (
          <span key={digits.length - index} aria-hidden className="inline-block overflow-hidden" style={{ height: '1em' }}>
            <span
              className="flex flex-col"
              style={{
                transform: `translateY(-${offset}em)`,
                transitionProperty: reduced ? 'none' : 'transform',
                transitionDuration: `${motion.enter.duration}s`,
                transitionTimingFunction: `cubic-bezier(${ease})`,
              }}
            >
              {DIGITS.map((item) => (
                <span key={item} className="block" style={{ height: '1em', lineHeight: 1 }}>{item}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Headline({ headline }: { headline: CalendarHeadline }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <p className="flex items-baseline gap-2">
        <RollingNumber value={headline.count} />
        <span className="text-sm text-fg-muted">{headline.caption}</span>
      </p>
      <p className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold text-fg">{headline.relative}</span>
        {headline.range !== null ? <span className="text-fg-subtle">{headline.range}</span> : null}
      </p>
      {headline.remaining !== null ? (
        <p className="text-sm text-fg-muted">
          还有 <span className="font-semibold text-warning-fg tabular">{headline.remaining}</span> 项没完成
        </p>
      ) : null}
    </div>
  );
}

function slideStyle(shift: number, visible: boolean, reduced: boolean, duration: number, ease: string): CSSProperties {
  return {
    transform: `translateX(${shift}px)`,
    opacity: visible ? 1 : 0,
    transitionProperty: reduced ? 'none' : 'transform, opacity',
    transitionDuration: `${duration}s`,
    transitionTimingFunction: `cubic-bezier(${ease})`,
  };
}

function SlidingPane({ direction, children }: { direction: SlideDirection; children: ReactNode }) {
  const motion = useMotionTokens();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [entered, setEntered] = useState(reduced || direction === 0);
  useEffect(() => {
    if (reduced || direction === 0) return undefined;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [direction, reduced]);
  const shift = reduced || entered || direction === 0 ? 0 : direction * SLIDE_PX;
  return (
    <div style={slideStyle(shift, reduced || entered, reduced, motion.enter.duration, motion.enter.ease.join(','))}>
      {children}
    </div>
  );
}

function CalendarBody({
  snapshot,
  wide,
  now,
  onPickWeek,
}: {
  snapshot: CalendarSnapshot;
  wide: boolean;
  now: number;
  onPickWeek: (weekStartMs: number) => void;
}) {
  if (!wide) {
    return <CalendarAgenda groups={weekAgenda(snapshot.rows, snapshot.fromMs, now)} nowMs={now} />;
  }
  if (snapshot.mode === 'week') {
    return <CalendarWeek rows={snapshot.rows} weekStartMs={snapshot.fromMs} nowMs={now} />;
  }
  return <CalendarMonth cells={monthGrid(snapshot.rows, snapshot.offset, now).cells} onPickWeek={onPickWeek} />;
}

export function CalendarView({ endpoint = '/problem-sets', teacher = false }: { endpoint?: string; teacher?: boolean }) {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const wide = useBreakpoint('sm');
  const [mode, setMode] = useState<CalendarMode>('week');
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<SlideDirection>(0);
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);
  const shown = snapshot === null || wide || snapshot.mode === 'week' ? snapshot : projectNarrow(snapshot, now);
  const range = calendarRange(mode, offset, now);

  useEffect(() => {
    if (wide || snapshot === null || snapshot.mode !== 'month') return;
    const projected = projectNarrow(snapshot, now);
    setDirection(0);
    setMode('week');
    setOffset(projected.offset);
    setSnapshot(projected);
    // The clock ticks every second; the week of a loaded month changes only when the snapshot does.
  }, [wide, snapshot]);

  useEffect(() => {
    if (snapshot !== null && sameView(snapshot, mode, offset, range)) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    let active = true;
    setLoading(true);
    const requestedMode = mode;
    const requestedOffset = offset;
    const { fromMs, toMs } = range;
    getJson(studentCalendarUrl(fromMs, toMs, endpoint), CALENDAR_FAILED)
      .then((raw) => {
        const parsed = acceptCalendar(raw, fromMs, toMs);
        if (!active || requestSeq.current !== seq) return;
        setSnapshot({
          mode: requestedMode,
          offset: requestedOffset,
          fromMs,
          toMs,
          rows: parsed.rows,
        });
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active || requestSeq.current !== seq) return;
        setError(requestFailure(caught));
        if (snapshot !== null && (snapshot.mode !== requestedMode || snapshot.offset !== requestedOffset)) {
          setDirection(0);
          setMode(snapshot.mode);
          setOffset(snapshot.offset);
        }
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, offset, range.fromMs, range.toMs, snapshot, endpoint]);

  function pagingBase(): { mode: CalendarMode; offset: number } {
    // In-flight ‹/›/今天 follow state. Shown is the base only before a narrow month projection is written back.
    if (!wide && shown !== null && shown.mode !== mode) return { mode: shown.mode, offset: shown.offset };
    return { mode, offset };
  }

  function move(delta: SlideDirection) {
    if (delta === 0) return;
    const base = pagingBase();
    setDirection(delta);
    if (base.mode !== mode) setMode(base.mode);
    setOffset(base.offset + delta);
  }

  function goToday() {
    const base = pagingBase();
    setDirection(base.offset === 0 ? 0 : base.offset > 0 ? -1 : 1);
    if (base.mode !== mode) setMode(base.mode);
    setOffset(0);
  }

  function changeMode(next: CalendarMode) {
    if (next === mode) return;
    setDirection(next === 'month' ? 1 : -1);
    setMode(next);
    setOffset(0);
  }

  function pickWeek(weekStartMs: number) {
    if (!Number.isFinite(weekStartMs)) {
      throw new TypeError(`picked week must be finite, received ${String(weekStartMs)}`);
    }
    const next = (weekStartMs - schoolWeekStart(now)) / WEEK_MS;
    if (!Number.isInteger(next)) {
      throw new TypeError(`picked week ${String(weekStartMs)} is not aligned to a school week`);
    }
    setDirection(next > offset ? 1 : -1);
    setMode('week');
    setOffset(next);
  }

  const headline = shown === null
    ? null
    : calendarHeadline(shown.rows, shown.mode, shown.offset, shown.fromMs, shown.toMs, now);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => move(-1)}>{PREVIOUS}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={goToday}>今天</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => move(1)}>{NEXT}</Button>
        {wide ? (
          <MiniTabs
            size="sm"
            aria-label="日历范围"
            value={mode}
            onValueChange={changeMode}
            items={[
              { value: 'week', label: '周' },
              { value: 'month', label: '月' },
            ]}
          />
        ) : null}
        <span className="min-w-0 flex-1" />
        {loading && snapshot !== null ? <Spinner className="size-3.5 shrink-0 text-fg-subtle" /> : null}
        {wide ? <Legend /> : null}
      </div>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {headline !== null ? <Headline headline={teacher ? { ...headline, remaining: null } : headline} /> : null}
      {shown !== null ? (
        <SlidingPane key={`${shown.mode}:${shown.offset}`} direction={direction}>
          <CalendarBody snapshot={shown} wide={wide} now={now} onPickWeek={pickWeek} />
        </SlidingPane>
      ) : null}
      <p className="text-xs text-fg-subtle">{teacher ? '练习没有时间，不在日历里；去「列表 › 练习」查看。' : FOOTER}</p>
    </div>
  );
}
