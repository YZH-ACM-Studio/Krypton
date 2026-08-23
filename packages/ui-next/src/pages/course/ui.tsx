/**
 * Shared visual primitives for the course workspace.
 *
 * The course pages previously carried every section label at the same
 * `text-sm font-semibold`, so nothing ranked against anything else. These
 * primitives define the three levels the pages are allowed to use —
 * display (the subject), section (a block inside it), and meta — plus the
 * progress and identity marks that give each surface a focal point.
 */
import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

type CssVarStyle<K extends string> = CSSProperties & Record<K, string | number>;

/**
 * Deterministic accent for a course identity mark, kept inside one cool
 * band around the shared primary hue (199) so a wall of courses stays
 * scannable without turning into a rainbow of competing accents.
 */
const MARK_HUES = [168, 182, 195, 205, 216, 226] as const;

function stableHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function courseMarkHue(seed: string): number {
  return MARK_HUES[stableHash(seed) % MARK_HUES.length];
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
  const style: CssVarStyle<'--mark-h'> = { '--mark-h': courseMarkHue(seed) };
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('krypton-course-mark grid shrink-0 place-items-center rounded-xl font-semibold', className)}
    >
      <span className={cn('translate-y-px leading-none', glyphClassName)}>{courseMarkGlyph(title)}</span>
    </span>
  );
}

/**
 * Ring gauge. Used where progress is the focal point of a surface — the
 * old 1.5px inline bar made the most motivating number on the page the
 * smallest thing on it.
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
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-muted" />
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
            'transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none',
            complete ? 'stroke-emerald-500' : 'stroke-primary',
          )}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[0.6875rem] font-semibold tabular-nums leading-none">{clamped}</span>
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
      className={cn('h-1 overflow-hidden rounded-full bg-muted', trackClassName, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label || `完成进度 ${clamped}%`}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
          clamped >= 100 ? 'bg-emerald-500' : 'bg-primary',
        )}
        style={style}
      />
    </div>
  );
}

/**
 * One section header treatment for the whole workspace. Sits exactly one
 * level under the display title, so blocks read as siblings of each other
 * and children of the subject.
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
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-[3px] shrink-0 rounded-full bg-primary/70" />
          <Heading id={id} className="krypton-course-section min-w-0 truncate">
            {title}
          </Heading>
          {count !== undefined && count !== null ? (
            <span className="krypton-course-meta rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-4">{count}</span>
          ) : null}
        </div>
        {description ? <p className="krypton-course-meta mt-1 pl-[11px] text-pretty">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
