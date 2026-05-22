/**
 * Paper components: question kind tabs, status cells, per-kind renderers,
 * countdown, save/lock/submit bars. Composed in pages/exam-mode/paper.tsx.
 *
 * The paper UI is fully controlled by parent state.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Clock, Lock, Minus, X as XIcon, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Checkbox } from '@/components/ui/checkbox';

export type QuestionKind = 'single' | 'multi' | 'blank' | 'fill_program' | 'fill_function' | 'default' | 'submit_answer';

export interface PaperCell {
  pid: number;
  /** null for problem-level cells (default / fill_function). */
  questionKey: string | null;
  kind: QuestionKind;
  score: number;
  prompt?: string;
}

export type CellStatus = 'unanswered' | 'answered' | 'correct' | 'wrong' | 'partial';

export const KIND_LABELS: Record<QuestionKind, string> = {
  single: '单选',
  multi: '多选',
  blank: '填空',
  fill_program: '程序填空',
  fill_function: '函数题',
  default: '编程',
  submit_answer: '提交答案',
};

const KIND_SHORT: Record<QuestionKind, string> = {
  single: '单',
  multi: '多',
  blank: '填',
  fill_program: '程',
  fill_function: '函',
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

const KIND_ORDER: QuestionKind[] = ['single', 'multi', 'blank', 'fill_program', 'fill_function', 'default', 'submit_answer'];

// ─── Mini Tab Bar (horizontal, lives at top of sub-sidebar) ──────────────
//
// Wraps the shared <MiniTabs> primitive — adds a lock icon for kinds whose
// "submit by kind" gate has been triggered. Renders in a thin card-tinted
// strip across the sub-sidebar so it visually anchors the cell grid below.

export function MiniTabBar({
  groups, current, onChange, lockedKinds,
}: {
  groups: Map<QuestionKind, PaperCell[]>;
  current: QuestionKind | null;
  onChange: (kind: QuestionKind) => void;
  lockedKinds: Set<QuestionKind>;
}) {
  const ordered = KIND_ORDER.filter((k) => groups.has(k));
  if (!ordered.length || !current) return null;
  return (
    <div className="flex justify-center border-b bg-card/50 p-2">
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
  cells, activeIndex, statuses, onJump,
}: {
  cells: PaperCell[];
  activeIndex: number;
  statuses: CellStatus[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2 p-2.5">
      {cells.map((_cell, i) => {
        const status = statuses[i] || 'unanswered';
        const active = i === activeIndex;
        return (
          <StatusButton
            key={i}
            index={i + 1}
            status={status}
            active={active}
            onClick={() => onJump(i)}
          />
        );
      })}
    </div>
  );
}

export function StatusButton({
  index, status, active, onClick,
}: {
  index: number; status: CellStatus; active: boolean; onClick: () => void;
}) {
  const base = 'relative flex aspect-square w-full items-center justify-center rounded-md text-xs font-semibold transition-colors';
  const palette: Record<CellStatus, string> = {
    unanswered: 'bg-muted/40 text-muted-foreground hover:bg-muted/60',
    answered:   'bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:text-sky-300',
    correct:    'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300',
    wrong:      'bg-rose-500/15 text-rose-700 hover:bg-rose-500/25 dark:text-rose-300',
    partial:    'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        palette[status],
        active && 'ring-2 ring-sky-500 ring-offset-2 ring-offset-background',
      )}
    >
      <CellStatusIcon status={status} fallback={String(index)} />
    </button>
  );
}

function CellStatusIcon({ status, fallback }: { status: CellStatus; fallback: string }) {
  if (status === 'correct') return <Check className="size-4" strokeWidth={3} />;
  if (status === 'wrong') return <XIcon className="size-4" strokeWidth={3} />;
  if (status === 'partial') return <Minus className="size-4" strokeWidth={3} />;
  if (status === 'answered') return <Minus className="size-4 opacity-60" strokeWidth={3} />;
  return <span>{fallback}</span>;
}

// ─── Single / Multi / Blank renderers ────────────────────────────────────

export function SingleChoiceRenderer({
  value, options, onChange, disabled,
}: {
  value: string | null;
  options: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const checked = value === letter;
        return (
          <label key={letter} className={cn(
            'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
            checked && 'border-primary bg-primary/5',
            !checked && 'hover:bg-accent/50',
            disabled && 'cursor-not-allowed opacity-60',
          )}>
            <input
              type="radio"
              name="single-choice"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(letter)}
              className="mt-0.5 accent-primary"
            />
            <span className="font-mono text-xs text-muted-foreground">{letter}.</span>
            <span className="flex-1">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

export function MultiChoiceRenderer({
  value, options, onChange, disabled,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const set = new Set(value);
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const checked = set.has(letter);
        return (
          <label key={letter} className={cn(
            'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
            checked && 'border-primary bg-primary/5',
            !checked && 'hover:bg-accent/50',
            disabled && 'cursor-not-allowed opacity-60',
          )}>
            <Checkbox
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(letter);
                else next.delete(letter);
                onChange(Array.from(next).sort());
              }}
             />
            <span className="font-mono text-xs text-muted-foreground">{letter}.</span>
            <span className="flex-1">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

export function BlankRenderer({
  value, onChange, disabled, placeholder,
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

export function FillProgramRenderer({
  value, onChange, disabled, rows = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={rows}
      spellCheck={false}
      className="w-full rounded-md border bg-card p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
      placeholder="// 在此填入代码片段"
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
  const expired = remainingMs <= 0;
  useEffect(() => {
    if (expired && onExpire) onExpire();
  }, [expired, onExpire]);

  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const danger = remainingMs > 0 && remainingMs < 5 * 60 * 1000;

  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-md border px-3 py-1 font-mono text-sm tabular-nums',
      expired && 'border-destructive/30 bg-destructive/10 text-destructive',
      danger && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    )}>
      <Clock className="size-4" />
      {expired ? '已结束' : (
        <span>
          {h.toString().padStart(2, '0')}:
          {m.toString().padStart(2, '0')}:
          {s.toString().padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────

export function PaperStatusPill({ dirtyCount, saving }: { dirtyCount: number; saving?: boolean }) {
  if (saving) {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle className="size-3.5" />保存中…</span>;
  }
  if (dirtyCount > 0) {
    return <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertCircle className="size-3.5" />{dirtyCount} 道未保存</span>;
  }
  return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" />已保存</span>;
}

// ─── Section card wrapper ────────────────────────────────────────────────

export function CellCard({
  title, score, prompt, children, locked, status, id,
}: {
  title: string;
  score: number;
  prompt?: string;
  locked: boolean;
  status?: CellStatus;
  id?: string;
  children: ReactNode;
}) {
  const accent = {
    unanswered: '',
    answered: 'border-l-4 border-l-sky-500',
    correct: 'border-l-4 border-l-emerald-500',
    wrong: 'border-l-4 border-l-rose-500',
    partial: 'border-l-4 border-l-amber-500',
  }[status || 'unanswered'];
  return (
    <article
      id={id}
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-sm scroll-mt-20',
        accent,
        locked && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <Badge variant="secondary" className="text-[10px]">{score} 分</Badge>
          {locked && <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-3" />已锁定</Badge>}
        </div>
        {status && status !== 'unanswered' && (
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
            status === 'answered' && 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
            status === 'correct' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            status === 'wrong' && 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
            status === 'partial' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          )}>
            {status === 'answered' && '已作答'}
            {status === 'correct' && '正确'}
            {status === 'wrong' && '错误'}
            {status === 'partial' && '部分'}
          </span>
        )}
      </header>
      {prompt && <p className="border-b bg-card px-5 py-3 text-sm text-muted-foreground">{prompt}</p>}
      <div className="space-y-4 p-5">{children}</div>
    </article>
  );
}
