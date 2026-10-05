/**
 * Paper components: question kind tabs, status cells, per-kind renderers,
 * countdown, save/lock/submit bars. Composed in pages/exam-mode/paper.tsx.
 *
 * The paper UI is fully controlled by parent state.
 */
import { AlertCircle, Check, Clock, Lock } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/cn';

export type QuestionKind =
  | 'true_false'
  | 'single'
  | 'multi'
  | 'blank'
  | 'fill_program'
  | 'program_fill_text'
  | 'program_fill_compile'
  | 'subjective'
  | 'function'
  | 'default'
  | 'submit_answer';

export interface PaperCell {
  pid: number;
  /** null for problem-level cells (default / program_fill / function). */
  questionKey: string | null;
  kind: QuestionKind;
  score: number;
  prompt?: string;
}

export type CellStatus = 'unanswered' | 'answered' | 'correct' | 'wrong' | 'partial';

/** 1-based order on the current paper surface (tab-local, matches CellNavigator). */
export function examPaperSurfaceTitle(order: number): string {
  if (!Number.isInteger(order) || order < 1) throw new TypeError('exam_paper_surface_order');
  return `第 ${order} 题`;
}

export const KIND_LABELS: Record<QuestionKind, string> = {
  true_false: '判断',
  single: '单选',
  multi: '多选',
  blank: '填空',
  fill_program: '程序填空',
  program_fill_text: '程序填空（文本）',
  program_fill_compile: '程序填空（编译）',
  subjective: '主观题',
  function: '代码实现题',
  default: '编程',
  submit_answer: '提交答案',
};

const KIND_SHORT: Record<QuestionKind, string> = {
  true_false: '判',
  single: '单',
  multi: '多',
  blank: '填',
  fill_program: '程',
  program_fill_text: '文',
  program_fill_compile: '编',
  subjective: '主',
  function: '码',
  default: '编',
  submit_answer: '答',
};

/** Group cells by kind, preserving cell order within each group. */
export function groupCellsByKind(cells: PaperCell[]): Map<QuestionKind, PaperCell[]> {
  const map = new Map<QuestionKind, PaperCell[]>();
  for (const cell of cells) {
    if (!map.has(cell.kind)) map.set(cell.kind, []);
    map.get(cell.kind)!.push(cell);
  }
  return map;
}

export const KIND_ORDER: QuestionKind[] = [
  'true_false',
  'single',
  'multi',
  'blank',
  'fill_program',
  'program_fill_text',
  'program_fill_compile',
  'subjective',
  'function',
  'default',
  'submit_answer',
];

export function firstPaperKind(groups: Map<QuestionKind, PaperCell[]>): QuestionKind | null {
  return KIND_ORDER.find((kind) => groups.has(kind)) ?? null;
}

const CELL_STATUS_CLASS: Record<CellStatus, string> = {
  unanswered: 'border-line bg-surface-active text-fg-subtle hover:bg-surface-hover',
  answered: 'border-info-line bg-info-soft text-info-fg',
  correct: 'border-success-line bg-success-soft text-success-fg',
  wrong: 'border-danger-line bg-danger-soft text-danger-fg',
  partial: 'border-warning-line bg-warning-soft text-warning-fg',
};

const CELL_STATUS_NAME: Record<CellStatus, string> = {
  unanswered: '未作答',
  answered: '已作答',
  correct: '正确',
  wrong: '错误',
  partial: '部分',
};

/** One character, so a square cell still shows the question number. */
const CELL_STATUS_MARK: Record<CellStatus, string> = {
  unanswered: '未',
  answered: '答',
  correct: '对',
  wrong: '错',
  partial: '部',
};

const ANSWER_STATUS_TONE = {
  answered: 'info',
  correct: 'success',
  wrong: 'danger',
  partial: 'warning',
} as const;

const ANSWER_STATUS_LABEL = {
  answered: '已作答',
  correct: '正确',
  wrong: '错误',
  partial: '部分',
} as const;

// ─── Mini Tab Bar (horizontal, lives at top of sub-sidebar) ──────────────
//
// Wraps the shared <MiniTabs> primitive — adds a lock icon for kinds whose
// "submit by kind" gate has been triggered. Renders in a thin card-tinted
// strip across the sub-sidebar so it visually anchors the cell grid below.

export function MiniTabBar({
  groups,
  current,
  onChange,
  lockedKinds,
}: {
  groups: Map<QuestionKind, PaperCell[]>;
  current: QuestionKind | null;
  onChange: (kind: QuestionKind) => void;
  lockedKinds: Set<QuestionKind>;
}) {
  const ordered = KIND_ORDER.filter((k) => groups.has(k));
  if (!ordered.length || !current) return null;
  return (
    <div className="flex min-w-0 justify-start overflow-x-auto border-b border-line bg-surface p-2 md:justify-center">
      <MiniTabs
        size="sm"
        value={current}
        onValueChange={(k) => onChange(k as QuestionKind)}
        items={ordered.map((kind) => ({
          value: kind,
          // Plain string so MiniTabs handles weight + colour uniformly; the
          // lock indicator rides on `icon` to keep the segmented look intact.
          label: KIND_SHORT[kind],
          count: groups.get(kind)!.length,
          icon: lockedKinds.has(kind) ? Lock : undefined,
        }))}
      />
    </div>
  );
}

// ─── Cell Navigator (grid of numbered squares with status) ───────────────

export function CellNavigator({
  cells,
  activeIndex,
  statuses,
  onJump,
  orientation = 'grid',
}: {
  cells: PaperCell[];
  activeIndex: number;
  statuses: CellStatus[];
  onJump: (index: number) => void;
  orientation?: 'grid' | 'row';
}) {
  const buttons = cells.map((_cell, i) => {
    const status = statuses[i] || 'unanswered';
    const active = i === activeIndex;
    return (
      <StatusButton
        key={i}
        index={i + 1}
        status={status}
        active={active}
        compact={orientation === 'row'}
        onClick={() => onJump(i)}
      />
    );
  });
  if (orientation === 'row') {
    return (
      <div className="min-w-0 overflow-x-auto scrollbar-none">
        <div className="flex w-max gap-2 p-2.5">{buttons}</div>
      </div>
    );
  }
  return <div className="grid grid-cols-5 gap-2 p-2.5">{buttons}</div>;
}

export function StatusButton({
  index,
  status,
  active,
  onClick,
  compact,
}: {
  index: number;
  status: CellStatus;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    // ds-allow DS005: 题号格要随列宽保持正方形，标准 Button 的固定高度会把五列导航压扁
    <button
      type="button"
      onClick={onClick}
      aria-label={`${index}，${CELL_STATUS_NAME[status]}`}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border text-xs font-semibold',
        'outline-none transition-colors duration-(--dur-1) ease-(--ease-standard)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        compact ? 'size-12 shrink-0' : 'w-full',
        CELL_STATUS_CLASS[status],
        active && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
      )}
    >
      <span className="tabular leading-none">{index}</span>
      <span className="text-2xs font-medium leading-none">{CELL_STATUS_MARK[status]}</span>
    </button>
  );
}

// ─── Single / Multi / Blank renderers ────────────────────────────────────

export function SingleChoiceRenderer({
  value,
  options,
  onChange,
  disabled,
  name,
}: {
  value: string | null;
  options: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  /** radio group 名——同页多道单选题时必须传（默认值保持既有考试页 DOM 不变） */
  name?: string;
}) {
  return (
    <RadioGroup>
      {options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const checked = value === letter;
        return (
          <RadioGroupItem
            key={letter}
            name={name || 'single-choice'}
            value={letter}
            checked={checked}
            disabled={disabled}
            onChange={() => onChange(letter)}
            wrapperClassName={cn(
              'w-full min-w-0 items-start gap-3 rounded-md border border-line p-3 text-sm',
              'transition-colors duration-(--dur-1) ease-(--ease-standard)',
              '[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1',
              checked && 'border-brand bg-brand-soft',
              !checked && 'hover:bg-surface-hover',
            )}
            label={(
              <span className="flex min-w-0 gap-3">
                <span className="shrink-0 font-mono text-xs text-fg-subtle">{letter}.</span>
                <span className="min-w-0 flex-1 break-words">{opt}</span>
              </span>
            )}
          />
        );
      })}
    </RadioGroup>
  );
}

export function MultiChoiceRenderer({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const set = new Set(value);
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const checked = set.has(letter);
        return (
          <label
            key={letter}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-md border border-line p-3 text-sm text-fg',
              'transition-colors duration-(--dur-1) ease-(--ease-standard)',
              checked && 'border-brand bg-brand-soft',
              !checked && !disabled && 'hover:bg-surface-hover',
              disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
            )}
          >
            <Checkbox
              className="mt-0.5 shrink-0"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(letter);
                else next.delete(letter);
                onChange(Array.from(next).sort());
              }}
            />
            <span className="shrink-0 font-mono text-xs text-fg-subtle">{letter}.</span>
            <span className="min-w-0 flex-1 break-words">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

export function BlankRenderer({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder || '在此输入你的答案'}
    />
  );
}

export function FillProgramRenderer({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]/g, ''))}
      disabled={disabled}
      className="font-mono"
      placeholder="在此填入一行代码"
    />
  );
}

// ─── Countdown ────────────────────────────────────────────────────────────

export function Countdown({ endAt, onExpire }: { endAt: number; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const remainingMs = Math.max(0, endAt - now);
  const expired = now > endAt;
  useEffect(() => {
    if (expired && onExpire) onExpire();
  }, [expired, onExpire]);

  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const danger = remainingMs > 0 && remainingMs < 5 * 60 * 1000;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-line px-3 py-1 font-mono text-sm text-fg tabular',
        expired && 'border-danger-line bg-danger-soft text-danger-fg',
        danger && 'border-warning-line bg-warning-soft text-warning-fg',
      )}
    >
      <Clock className="size-4 shrink-0" />
      {expired ? (
        '已结束'
      ) : (
        <span>
          {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────

export function PaperStatusPill({ dirtyCount, saving }: { dirtyCount: number; saving?: boolean }) {
  if (saving) {
    return (
      <Badge tone="neutral" variant="soft">
        <AlertCircle className="size-3.5" />
        保存中…
      </Badge>
    );
  }
  if (dirtyCount > 0) {
    return (
      <Badge tone="warning" variant="soft">
        <AlertCircle className="size-3.5" />
        {dirtyCount} 道未保存
      </Badge>
    );
  }
  return (
    <Badge tone="success" variant="soft">
      <Check className="size-3.5" />
      已保存
    </Badge>
  );
}

// ─── Section card wrapper ────────────────────────────────────────────────

export function CellCard({
  title,
  score,
  kindLabel,
  prompt,
  children,
  locked,
  status,
  id,
  belowTitle,
}: {
  title: string;
  score: number;
  kindLabel?: string;
  prompt?: string;
  locked: boolean;
  status?: CellStatus;
  id?: string;
  belowTitle?: ReactNode;
  children: ReactNode;
}) {
  const answerStatus = status && status !== 'unanswered' ? status : null;
  return (
    <div id={id} className="min-w-0 scroll-mt-20">
      <Panel className={locked ? 'border-warning-line' : undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-md font-semibold text-fg">{title}</h3>
              <Badge variant="outline" size="sm">{score} 分</Badge>
              {kindLabel ? (
                <Badge variant="outline" size="sm">{kindLabel}</Badge>
              ) : null}
              {locked ? (
                <Badge variant="outline" tone="warning" size="sm">
                  <Lock className="size-3" />
                  已锁定
                </Badge>
              ) : null}
            </div>
            {answerStatus ? (
              <Badge tone={ANSWER_STATUS_TONE[answerStatus]} variant="soft" size="sm">
                {ANSWER_STATUS_LABEL[answerStatus]}
              </Badge>
            ) : null}
          </div>
          {belowTitle}
          {prompt ? <p className="break-words text-sm text-fg-muted">{prompt}</p> : null}
          <div className="flex flex-col gap-4">{children}</div>
        </div>
      </Panel>
    </div>
  );
}
