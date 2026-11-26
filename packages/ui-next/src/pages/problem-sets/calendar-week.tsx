import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/display';
import { calculateTooltipPosition } from '@/components/ui/tooltip-position';
import { cn } from '@/lib/cn';
import { weekBars, type CalendarState, type WeekBar } from './calendar-layout';
import { calendarRowView, type ContestRow } from './model';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CARD_GAP = 8;
/** A point in the last portion of the week would run its label off the track. */
const POINT_LABEL_FLIP = 0.78;
const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';
const META_DOT = ' \u00B7 ';

const STATE_LABEL: Record<CalendarState, string> = {
  run: '进行中',
  soon: '24 小时内截止',
  up: '未开始',
  end: '已结束',
};

const BAR_CLASS: Record<CalendarState, string> = {
  run: 'border-success-line bg-success-soft text-success-fg',
  soon: 'border-warning-line bg-warning-soft text-warning-fg',
  up: 'border-dashed border-line-strong bg-surface text-fg-muted',
  end: 'border-transparent bg-surface-active text-fg-subtle',
};

const KNOB_CLASS: Record<CalendarState, string> = {
  run: 'border-success bg-success',
  soon: 'border-warning bg-warning',
  up: 'border-line-strong bg-surface',
  end: 'border-line-strong bg-surface-active',
};

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

interface DayColumn {
  ms: number;
  weekday: string;
  day: number;
  today: boolean;
}

interface OpenCard {
  id: string;
  trigger: HTMLElement;
}

interface CardBox {
  left: number;
  top: number;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function civil(instant: number): CivilTime {
  if (!Number.isFinite(instant)) invalid('timestamp must be finite');
  const shifted = new Date(instant + SHANGHAI_OFFSET_MS);
  const utcDay = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: utcDay === 0 ? 6 : utcDay - 1,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(instant: number): string {
  const time = civil(instant);
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

function monthDay(instant: number): string {
  const time = civil(instant);
  return `${time.month}月${time.day}日`;
}

function weekdayName(instant: number): string {
  const label = WEEKDAY[civil(instant).weekday];
  if (label === undefined) invalid('weekday is outside Monday to Sunday');
  return label;
}

function sameDay(left: number, right: number): boolean {
  const a = civil(left);
  const b = civil(right);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function parsedInstant(iso: string, label: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) invalid(`${label} is not a timestamp`);
  return parsed;
}

function openRange(row: ContestRow): string {
  const begin = parsedInstant(row.beginAt, `${row.id} beginAt`);
  const end = parsedInstant(row.endAt, `${row.id} endAt`);
  const endText = sameDay(begin, end) ? clock(end) : `${monthDay(end)} ${clock(end)}`;
  return `${monthDay(begin)} ${clock(begin)} ${EN_DASH} ${endText}`;
}

function showsNow(weekStartMs: number, nowMs: number): boolean {
  return nowMs >= weekStartMs && nowMs < weekStartMs + WEEK_MS;
}

function weekDays(weekStartMs: number, nowMs: number): DayColumn[] {
  const now = civil(nowMs);
  const days: DayColumn[] = [];
  for (let index = 0; index < 7; index += 1) {
    const ms = weekStartMs + index * DAY_MS;
    const time = civil(ms);
    days.push({
      ms,
      weekday: weekdayName(ms),
      day: time.day,
      today: time.year === now.year && time.month === now.month && time.day === now.day,
    });
  }
  return days;
}

function metaLine(row: ContestRow, nowMs: number): string {
  const view = calendarRowView(row, nowMs);
  if (view.progress === null) return view.typeLabel;
  return `${view.typeLabel}${META_DOT}${view.progress.text}`;
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function WeekTrigger({
  id,
  className,
  style,
  state,
  onOpen,
  children,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  state?: CalendarState;
  onOpen: (id: string, trigger: HTMLElement) => void;
  children: ReactNode;
}): ReactElement {
  return (
    // ds-allow DS005: 行标题和时间条按一周比例定位，并排状态点、削边箭头和截断文字，固定高度的 Button 会裁掉这些内容。
    <button
      type="button"
      data-week-trigger=""
      data-state={state}
      style={style}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(id, event.currentTarget);
      }}
    >
      {children}
    </button>
  );
}

function WeekCard({
  bar,
  nowMs,
  trigger,
  onClose,
}: {
  bar: WeekBar;
  nowMs: number;
  trigger: HTMLElement;
  onClose: () => void;
}): ReactElement | null {
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<CardBox | null>(null);
  const view = calendarRowView(bar.row, nowMs);
  const action = view.action;
  const progress = view.progress?.text ?? EM_DASH;

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const next = calculateTooltipPosition(
        rect,
        { width: card.offsetWidth, height: card.offsetHeight },
        'bottom',
        CARD_GAP,
        { width: window.innerWidth, height: window.innerHeight },
      );
      setBox((current) => (
        current && current.left === next.left && current.top === next.top
          ? current
          : { left: next.left, top: next.top }
      ));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [bar, trigger]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onClick = (event: MouseEvent) => {
      const element = eventTargetElement(event.target);
      if (element?.closest('[role="dialog"]')) return;
      if (element?.closest('[data-week-trigger]')) return;
      onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll);
    // Scroll does not bubble. The page scroller is an inner viewport, so only the capture phase sees it.
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={bar.row.title}
      className="fixed z-50 flex w-75 flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4 shadow-pop"
      style={{ left: `${box?.left ?? 0}px`, top: `${box?.top ?? 0}px`, visibility: box ? 'visible' : 'hidden' }}
    >
      <div className="min-w-0">
        <Badge tone="neutral" variant="outline" size="sm">{view.typeLabel}</Badge>
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-md font-semibold text-balance">
          {bar.row.done ? <Check className="size-3.5 shrink-0 text-success-fg" aria-label="已完成" /> : null}
          <span className="min-w-0 truncate">{bar.row.title}</span>
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-subtle">状态</dt>
        <dd className="min-w-0 text-fg">{STATE_LABEL[bar.state]}</dd>
        <dt className="text-fg-subtle">{bar.row.kind === 'exam' ? '时段' : '开放'}</dt>
        <dd className="min-w-0 text-fg tabular">{openRange(bar.row)}</dd>
        <dt className="text-fg-subtle">{bar.row.teacherAction ? '题目' : '我的进度'}</dt>
        <dd className="min-w-0 text-fg tabular">{bar.row.teacherAction ? `${bar.row.problemCount} 题` : progress}</dd>
      </dl>
      {action ? (
        <div className="flex justify-end">
          <Button variant={action.variant} size="sm" asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function DayHeader({ day }: { day: DayColumn }): ReactElement {
  return (
    <div className={cn('flex items-baseline gap-1.5 border-l border-line-subtle px-2.5 py-2 text-xs text-fg-subtle', day.today && 'text-brand-fg')}>
      <span>{day.weekday}</span>
      <span
        className={cn(
          'text-sm font-semibold tabular text-fg',
          day.today && 'inline-grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-xs text-on-brand',
        )}
        aria-current={day.today ? 'date' : undefined}
      >
        {day.day}
      </span>
    </div>
  );
}

function BarEvent({ bar, onOpen }: { bar: WeekBar; onOpen: (id: string, trigger: HTMLElement) => void }): ReactElement {
  return (
    <WeekTrigger
      id={bar.row.id}
      state={bar.state}
      onOpen={onOpen}
      style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
      className={cn(
        'absolute top-1/2 z-10 flex h-8 min-w-2.5 -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-md border px-2.5 text-left text-xs font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        BAR_CLASS[bar.state],
        bar.clippedStart && 'rounded-l-none border-l-0',
        bar.clippedEnd && 'rounded-r-none border-r-0',
      )}
    >
      {bar.state === 'run' ? <StatusDot tone="success" pulse /> : null}
      {bar.clippedStart ? <ChevronLeft className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="min-w-0 truncate">{bar.label}</span>
      {bar.clippedEnd ? <ChevronRight className="ml-auto size-3.5 shrink-0" aria-hidden /> : null}
    </WeekTrigger>
  );
}

function PointEvent({ bar, onOpen }: { bar: WeekBar; onOpen: (id: string, trigger: HTMLElement) => void }): ReactElement {
  const reversed = bar.left > POINT_LABEL_FLIP;
  return (
    <WeekTrigger
      id={bar.row.id}
      state={bar.state}
      onOpen={onOpen}
      style={reversed ? { right: `${(1 - bar.left) * 100}%` } : { left: `${bar.left * 100}%` }}
      className={cn(
        'absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 text-left text-xs font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        reversed && 'flex-row-reverse',
        bar.state === 'end' ? 'text-fg-subtle' : 'text-fg',
      )}
    >
      <span className={cn('size-3 shrink-0 rounded-full border-2', reversed ? 'translate-x-1/2' : '-translate-x-1/2', KNOB_CLASS[bar.state])} />
      {bar.state === 'run' ? <StatusDot tone="success" pulse /> : null}
      <span className="rounded-sm bg-surface px-1.5 py-0.5">{bar.label}</span>
    </WeekTrigger>
  );
}

function WeekRow({
  bar,
  days,
  nowLeft,
  showNowLine,
  nowMs,
  last,
  onOpen,
}: {
  bar: WeekBar;
  days: readonly DayColumn[];
  nowLeft: string | null;
  showNowLine: boolean;
  nowMs: number;
  last: boolean;
  onOpen: (id: string, trigger: HTMLElement) => void;
}): ReactElement {
  return (
    <div className={cn('grid grid-cols-[auto_minmax(0,1fr)] border-t border-line-subtle', last && 'rounded-b-lg')}>
      <WeekTrigger
        id={bar.row.id}
        onOpen={onOpen}
        className={cn(
          'flex min-h-14 w-60 min-w-0 flex-col justify-center gap-0.5 px-4 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring 3xl:w-75',
          last && 'rounded-bl-lg',
        )}
      >
        <span className={cn('flex min-w-0 items-center gap-1.5 text-sm font-medium', bar.row.done && 'text-fg-muted')}>
          {bar.row.done ? <Check className="size-3.5 shrink-0 text-success-fg" aria-label="已完成" /> : null}
          <span className="min-w-0 truncate">{bar.row.title}</span>
        </span>
        <span className="min-w-0 truncate text-xs text-fg-subtle">{metaLine(bar.row, nowMs)}</span>
      </WeekTrigger>
      <div className={cn('relative min-h-14 min-w-0 overflow-hidden', last && 'rounded-br-lg')}>
        <div className="grid h-full grid-cols-7">
          {days.map((day) => (
            <span key={day.ms} className={cn('border-l border-line-subtle', day.today && 'bg-brand-soft')} />
          ))}
        </div>
        {bar.kind === 'point' ? <PointEvent bar={bar} onOpen={onOpen} /> : <BarEvent bar={bar} onOpen={onOpen} />}
        {showNowLine && nowLeft !== null ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-brand" style={{ left: nowLeft }} />
        ) : null}
      </div>
    </div>
  );
}

export function CalendarWeek({
  rows,
  weekStartMs,
  nowMs,
}: {
  rows: readonly ContestRow[];
  weekStartMs: number;
  nowMs: number;
}): ReactElement {
  const bars = weekBars(rows, weekStartMs, nowMs);
  const days = weekDays(weekStartMs, nowMs);
  const now = showsNow(weekStartMs, nowMs);
  const nowLeft = now ? `${((nowMs - weekStartMs) / WEEK_MS) * 100}%` : null;
  const [open, setOpen] = useState<OpenCard | null>(null);
  const closeCard = useCallback(() => setOpen(null), []);
  const openCard = useCallback((id: string, trigger: HTMLElement) => setOpen({ id, trigger }), []);
  const openBar = open === null ? null : bars.find((bar) => bar.row.id === open.id) ?? null;

  useEffect(() => {
    if (open !== null && openBar === null) setOpen(null);
  }, [open, openBar]);

  return (
    <section aria-label="本周题目集" className="min-w-0 rounded-lg border border-line bg-surface shadow-xs">
      <div className="sticky top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)] rounded-t-lg border-b border-line bg-surface-sunken">
        <div className="flex w-60 items-center px-4 py-2 text-xs font-medium text-fg-subtle 3xl:w-75">题目集</div>
        <div className="relative min-w-0">
          <div className="grid grid-cols-7">
            {days.map((day) => <DayHeader key={day.ms} day={day} />)}
          </div>
          {now && nowLeft !== null ? (
            <span className="pointer-events-none absolute top-full z-20 inline-flex h-5 -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-brand px-1.5 text-2xs font-semibold whitespace-nowrap text-on-brand tabular" style={{ left: nowLeft }}>
              {`此刻 ${clock(nowMs)}`}
            </span>
          ) : null}
        </div>
      </div>
      {bars.length === 0 ? (
        <p className="rounded-b-lg px-4 py-6 text-center text-sm text-fg-subtle">这一周没有考试和作业。</p>
      ) : (
        bars.map((bar, index) => (
          <WeekRow
            key={bar.row.id}
            bar={bar}
            days={days}
            nowLeft={nowLeft}
            showNowLine={now}
            nowMs={nowMs}
            last={index === bars.length - 1}
            onOpen={openCard}
          />
        ))
      )}
      {open && openBar ? <WeekCard bar={openBar} nowMs={nowMs} trigger={open.trigger} onClose={closeCard} /> : null}
    </section>
  );
}
