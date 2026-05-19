/**
 * Paper components: tab bar, cell navigator, per-kind question renderers,
 * countdown, save/lock/submit bars. Composed in pages/exam-mode/paper.tsx.
 *
 * The paper UI is fully controlled by parent state: the parent holds the
 * draft store (per problem × per question key) and passes setters down.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, Lock, AlertCircle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export type QuestionKind = 'single' | 'multi' | 'blank' | 'fill_program' | 'fill_function' | 'default' | 'submit_answer';

export interface PaperCell {
  pid: number;
  /** null for problem-level cells (default / fill_function). */
  questionKey: string | null;
  kind: QuestionKind;
  score: number;
  prompt?: string;
}

const KIND_LABELS: Record<QuestionKind, string> = {
  single: '单选',
  multi: '多选',
  blank: '填空',
  fill_program: '程序填空',
  fill_function: '函数题',
  default: '编程',
  submit_answer: '提交答案',
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

// ─── Tab Bar ──────────────────────────────────────────────────────────────

export function TabBar({
  groups, current, onChange, lockedKinds,
}: {
  groups: Map<QuestionKind, PaperCell[]>;
  current: QuestionKind | null;
  onChange: (kind: QuestionKind) => void;
  lockedKinds: Set<QuestionKind>;
}) {
  const ordered = KIND_ORDER.filter((k) => groups.has(k));
  return (
    <div className="flex flex-wrap gap-2 border-b py-2">
      {ordered.map((kind) => {
        const count = groups.get(kind)!.length;
        const active = current === kind;
        const locked = lockedKinds.has(kind);
        return (
          <button
            key={kind}
            onClick={() => onChange(kind)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/40 text-foreground/80 hover:bg-muted',
            )}
          >
            <span>{KIND_LABELS[kind]}</span>
            <Badge variant={active ? 'secondary' : 'outline'} className="h-4 px-1 text-[10px]">
              {count}
            </Badge>
            {locked && <Lock className="size-3" />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Cell Navigator (numeric grid) ───────────────────────────────────────

export function CellNavigator({
  cells, activeIndex, onJump, answeredIndices, lockedKindForCell,
}: {
  cells: PaperCell[];
  activeIndex: number;
  onJump: (index: number) => void;
  answeredIndices: Set<number>;
  lockedKindForCell: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {cells.map((_cell, i) => {
        const answered = answeredIndices.has(i);
        const active = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md text-xs font-medium transition-colors',
              active && 'bg-primary text-primary-foreground',
              !active && answered && 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
              !active && !answered && 'bg-muted/40 text-muted-foreground hover:bg-muted',
              lockedKindForCell && 'opacity-60',
            )}
            title={lockedKindForCell ? '该类型已锁定' : undefined}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
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
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(letter);
                else next.delete(letter);
                onChange(Array.from(next).sort());
              }}
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
      'flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums',
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

export function PaperStatusPill({ saved, dirty }: { saved: boolean; dirty: boolean }) {
  if (dirty) {
    return <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertCircle className="size-3.5" />未保存</span>;
  }
  if (saved) {
    return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><ChevronRight className="size-3.5" />已保存</span>;
  }
  return null;
}

// ─── Section card wrapper ────────────────────────────────────────────────

export function CellCard({
  title, score, prompt, children, locked,
}: {
  title: string;
  score: number;
  prompt?: string;
  locked: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn(locked && 'border-amber-500/30 bg-amber-500/5')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <span>{title}</span>
            <Badge variant="secondary" className="text-[10px]">{score} 分</Badge>
            {locked && <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-3" />已锁定</Badge>}
          </div>
        </CardTitle>
        {prompt && <p className="pt-2 text-sm text-muted-foreground">{prompt}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
