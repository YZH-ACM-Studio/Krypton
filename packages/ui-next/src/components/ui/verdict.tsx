import { cn } from '@/lib/cn';
import { Badge, type BadgeTone } from './badge';
import { Spinner, StatusDot } from './display';

export interface StatusDisplay {
  label: string;
  short: string;
  tone: BadgeTone;
  live: 'none' | 'pulse' | 'spin';
}

export interface DifficultyLevel {
  value: number;
  label: string;
  tone: BadgeTone;
}

const VERDICT_FG: Record<BadgeTone, string> = {
  neutral: 'text-fg-muted',
  brand: 'text-brand-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
  violet: 'text-violet-fg',
  orange: 'text-orange-fg',
};

const MINUS = '\u2212';

/** Hydro status codes. Labels are the records page copy; color comes only from this table. */
export const STATUS_DISPLAY: Record<number, StatusDisplay> = {
  0: { label: '等待评测', short: '等待', tone: 'neutral', live: 'pulse' },
  1: { label: 'Accepted', short: 'AC', tone: 'success', live: 'none' },
  2: { label: 'Wrong Answer', short: 'WA', tone: 'danger', live: 'none' },
  3: { label: 'Time Exceeded', short: 'TLE', tone: 'warning', live: 'none' },
  4: { label: 'Memory Exceeded', short: 'MLE', tone: 'warning', live: 'none' },
  5: { label: 'Output Exceeded', short: 'OLE', tone: 'warning', live: 'none' },
  6: { label: 'Runtime Error', short: 'RE', tone: 'violet', live: 'none' },
  7: { label: 'Compile Error', short: 'CE', tone: 'orange', live: 'none' },
  8: { label: 'System Error', short: 'SE', tone: 'neutral', live: 'none' },
  9: { label: 'Canceled', short: 'IGN', tone: 'neutral', live: 'none' },
  10: { label: 'Unknown Error', short: 'UKE', tone: 'danger', live: 'none' },
  11: { label: 'Hacked', short: 'HK', tone: 'danger', live: 'none' },
  12: { label: '人工已评分', short: 'MG', tone: 'success', live: 'none' },
  20: { label: 'Running', short: '评测中', tone: 'info', live: 'spin' },
  21: { label: 'Compiling', short: '编译中', tone: 'info', live: 'spin' },
  22: { label: 'Fetched', short: '已取题', tone: 'info', live: 'spin' },
  30: { label: 'Ignored', short: 'IGN', tone: 'neutral', live: 'none' },
  31: { label: 'Format Error', short: 'FE', tone: 'danger', live: 'none' },
  32: { label: 'Hack Successful', short: 'HS', tone: 'success', live: 'none' },
  33: { label: 'Hack Unsuccessful', short: 'HU', tone: 'danger', live: 'none' },
};

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = [
  { value: 0, label: '未评定', tone: 'neutral' },
  { value: 1, label: '入门', tone: 'success' },
  { value: 2, label: `普及${MINUS}`, tone: 'info' },
  { value: 3, label: `普及/提高${MINUS}`, tone: 'info' },
  { value: 4, label: '普及+/提高', tone: 'warning' },
  { value: 5, label: `提高+/省选${MINUS}`, tone: 'warning' },
  { value: 6, label: `省选/NOI${MINUS}`, tone: 'orange' },
  { value: 7, label: '省选/NOI', tone: 'orange' },
  { value: 8, label: 'NOI/NOI+', tone: 'danger' },
  { value: 9, label: 'NOI+/CTSC', tone: 'danger' },
  { value: 10, label: 'CTSC/IOI', tone: 'violet' },
];

function knownStatus(status: number): StatusDisplay | undefined {
  if (!Object.hasOwn(STATUS_DISPLAY, status)) {
    return undefined;
  }
  return STATUS_DISPLAY[status];
}

export function statusDisplay(status: number, texts?: Record<string, string>): StatusDisplay {
  const known = knownStatus(status);
  const base: StatusDisplay = known ?? {
    label: `Status ${status}`,
    short: '?',
    tone: 'neutral',
    live: 'none',
  };
  const custom = texts?.[String(status)];
  if (typeof custom === 'string' && custom.length > 0) {
    return {
      label: custom,
      short: base.short,
      tone: base.tone,
      live: base.live,
    };
  }
  return base;
}

export function scoreTone(score: number, full = 100): 'danger' | 'warning' | 'success' {
  if (Number.isNaN(score) || score <= 0) {
    return 'danger';
  }
  if (score >= full) {
    return 'success';
  }
  return 'warning';
}

export interface VerdictProps {
  status: number;
  texts?: Record<string, string>;
  compact?: boolean;
  score?: number;
  size?: 'md' | 'lg';
}

export function Verdict({
  status,
  texts,
  compact = false,
  score,
  size = 'md',
}: VerdictProps) {
  const display = statusDisplay(status, texts);
  const large = size === 'lg';
  return (
    <span
      data-status={status}
      data-tone={display.tone}
      className={cn(
        'inline-flex items-center gap-1.5',
        VERDICT_FG[display.tone],
        large ? 'text-md font-semibold' : 'text-sm font-medium',
      )}
    >
      {display.live === 'spin'
        ? <Spinner className="size-3.5" />
        : <StatusDot tone={display.tone} pulse={display.live === 'pulse'} />}
      <span>{compact ? display.short : display.label}</span>
      {typeof score === 'number' ? <span className="tabular text-fg-subtle">{score}</span> : null}
    </span>
  );
}

function difficultyLevel(level: number | null | undefined): DifficultyLevel {
  const numeric = Number(level);
  const value = Number.isInteger(numeric) && numeric >= 0 && numeric <= 10 ? numeric : 0;
  const row = DIFFICULTY_LEVELS.find((entry) => entry.value === value);
  if (row === undefined) {
    throw new Error(`DIFFICULTY_LEVELS is missing level ${value}`);
  }
  return row;
}

export function Difficulty({ level }: { level: number | null | undefined }) {
  const row = difficultyLevel(level);
  return (
    <Badge
      variant="outline"
      size="sm"
      tone={row.tone}
      data-difficulty={row.value}
    >
      {row.label}
    </Badge>
  );
}
