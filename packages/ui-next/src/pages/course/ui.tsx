/**
 * Shared course primitives. Marks use one brand color; section headers
 * match Panel. Hue is no longer derived from the course title.
 */
import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

type CssVarStyle<K extends string> = CSSProperties & Record<K, string | number>;

/** Signature kept for callers. Color is no longer chosen from the seed. */
export function courseMarkHue(seed: string): number {
  void seed;
  return 0;
}

/** First meaningful glyph of a title, used as the course monogram. */
export function courseMarkGlyph(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '课';
  return [...trimmed][0];
}

export function CourseMark({
  seed,
  title,
  className,
  glyphClassName,
}: {
  seed: string;
  title: string;
  className?: string;
  glyphClassName?: string;
}) {
  void seed;
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center bg-brand-soft text-brand-fg rounded-lg font-semibold', className)}
    >
      <span className={cn('leading-none', glyphClassName)}>{courseMarkGlyph(title)}</span>
    </span>
  );
}

/**
 * Ring gauge for a single progress focal point.
 */
export function CourseProgressRing({
  value,
  size = 56,
  thickness = 5,
  label,
  className,
}: {
  value: number;
  size?: number;
  thickness?: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const complete = clamped >= 100;
  return (
    <div
      className={cn('relative grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label || `完成进度 ${clamped}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-current text-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={cn(
            'stroke-current transition-[stroke-dashoffset] duration-(--dur-4) ease-(--ease-out) motion-reduce:transition-none',
            complete ? 'text-success' : 'text-brand',
          )}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-2xs font-semibold tabular leading-none">{clamped}</span>
    </div>
  );
}

/** Slim gauge for repeated rows, where a ring per item would be noise. */
export function CourseProgressBar({
  value,
  label,
  className,
  trackClassName,
}: {
  value: number;
  label?: string;
  className?: string;
  trackClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const style: CSSProperties = { width: `${clamped}%` };
  return (
    <div
      className={cn('h-1 overflow-hidden rounded-full bg-surface-active', trackClassName, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label || `完成进度 ${clamped}%`}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-(--dur-4) ease-(--ease-out) motion-reduce:transition-none',
          clamped >= 100 ? 'bg-success' : 'bg-brand',
        )}
        style={style}
      />
    </div>
  );
}

/**
 * Section header aligned with Panel: title, optional count, description, action.
 */
export function CourseSectionHeader({
  id,
  title,
  description,
  count,
  action,
  className,
  level = 3,
}: {
  id?: string;
  title: string;
  description?: string;
  count?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * Document depth of this block. Pages own their own outline, so the
   * heading level is passed in rather than baked into the component.
   */
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-2.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Heading id={id} className="min-w-0 truncate text-sm font-semibold text-fg">
            {title}
          </Heading>
          {count !== undefined && count !== null ? (
            <span className="rounded-sm bg-surface-active px-1.5 text-2xs text-fg-subtle tabular">{count}</span>
          ) : null}
        </div>
        {description ? <p className="text-xs text-fg-subtle text-pretty">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Cursor-tracked edge light. One listener, applied only to focal surfaces. */
export function useSpotlight() {
  const [active, setActive] = useState(false);
  const [point, setPoint] = useState({ x: 50, y: 0 });

  const onMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setPoint({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

  const style = useMemo<CssVarStyle<'--spot-x' | '--spot-y'>>(
    () => ({ '--spot-x': `${point.x}%`, '--spot-y': `${point.y}%` }),
    [point.x, point.y],
  );

  return {
    spotlightProps: {
      onMouseMove,
      onMouseEnter: () => setActive(true),
      onMouseLeave: () => setActive(false),
      'data-spotlight': active ? 'on' : 'off',
      style,
    },
  };
}

/** Staggered entry delay, capped so long lists don't crawl in. */
export function riseStyle(index: number, step = 45, cap = 8): CssVarStyle<'--rise-delay'> {
  return { '--rise-delay': `${Math.min(index, cap) * step}ms` };
}
