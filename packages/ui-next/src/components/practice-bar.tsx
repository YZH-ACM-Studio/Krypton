import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PracticeBar {
  title: string;
  href: string;
  stageTitle: string;
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
  doneCount: number;
  totalCount: number;
}

const PRACTICE_BAR_FIELDS = [
  'title',
  'href',
  'stageTitle',
  'index',
  'total',
  'prevHref',
  'nextHref',
  'doneCount',
  'totalCount',
] as const;

const PRACTICE_BAR_FIELD_SET = new Set<string>(PRACTICE_BAR_FIELDS);

function practiceBarObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('practiceBar must be an object');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PRACTICE_BAR_FIELD_SET.has(key)) throw new TypeError(`practiceBar.${key} is not a practice bar field`);
  }
  for (const field of PRACTICE_BAR_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new TypeError(`practiceBar.${field} is missing`);
  }
  return record;
}

function practiceBarText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`practiceBar.${field} must be a string`);
  return value;
}

function practiceBarLink(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`practiceBar.${field} must be a non-empty string`);
  }
  return value;
}

function practiceBarHref(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`practiceBar.${field} must be a non-empty string or null`);
  }
  return value;
}

function practiceBarCount(value: unknown, field: string, min: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`practiceBar.${field} must be an integer`);
  }
  if (value < min || (max !== undefined && value > max)) {
    throw new TypeError(`practiceBar.${field} is out of range`);
  }
  return value;
}

/** `undefined` means the page has no bar. Any other shape is a contract error. */
export function parsePracticeBar(raw: unknown): PracticeBar | null {
  if (raw === undefined) return null;
  const record = practiceBarObject(raw);
  const total = practiceBarCount(record.total, 'total', 1);
  const totalCount = practiceBarCount(record.totalCount, 'totalCount', 0);
  return {
    title: practiceBarText(record.title, 'title'),
    href: practiceBarLink(record.href, 'href'),
    stageTitle: practiceBarText(record.stageTitle, 'stageTitle'),
    index: practiceBarCount(record.index, 'index', 1, total),
    total,
    prevHref: practiceBarHref(record.prevHref, 'prevHref'),
    nextHref: practiceBarHref(record.nextHref, 'nextHref'),
    doneCount: practiceBarCount(record.doneCount, 'doneCount', 0, totalCount),
    totalCount,
  };
}

function PracticeStep({ label, href }: { label: '上一题' | '下一题'; href: string | null }) {
  const icon = label === '上一题' ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />;
  if (href === null) {
    return (
      <Button type="button" variant="ghost" size="sm" iconOnly disabled aria-label={label}>
        {icon}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="sm" iconOnly asChild aria-label={label}>
      <a href={href}>{icon}</a>
    </Button>
  );
}

export function PracticeBarStrip({ bar }: { bar: PracticeBar }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-line bg-surface px-3">
      <a href={bar.href} className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium text-fg">
        <ArrowLeft aria-hidden className="shrink-0" />
        <span className="truncate">{bar.title}</span>
      </a>
      <span className="hidden min-w-0 truncate text-sm text-fg-muted sm:inline">{bar.stageTitle}</span>
      <PracticeStep label="上一题" href={bar.prevHref} />
      <span className="shrink-0 whitespace-nowrap text-sm tabular">{`第 ${bar.index} / ${bar.total} 题`}</span>
      <PracticeStep label="下一题" href={bar.nextHref} />
      <div className="ml-auto flex shrink-0 items-baseline gap-1.5">
        <span className="text-xs text-fg-subtle">已完成</span>
        <span className="text-sm font-medium tabular">{`${bar.doneCount} / ${bar.totalCount}`}</span>
      </div>
    </div>
  );
}
