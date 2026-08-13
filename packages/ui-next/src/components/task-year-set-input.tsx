import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface TaskYearSetInputProps {
  value: unknown;
  onChange: (years: number[]) => void;
  inputLabel: string;
  scopeKey: string;
}

function parseYear(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 1900 && year <= 2099 ? year : null;
}

function isYearList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 1900 && item <= 2099);
}

export function TaskYearSetInput({ value, onChange, inputLabel, scopeKey }: TaskYearSetInputProps) {
  const validationId = useId();
  const [draftState, setDraftState] = useState({ scopeKey, value: '' });
  const draft = draftState.scopeKey === scopeKey ? draftState.value : '';
  const years = value === undefined ? [] : isYearList(value) ? value : null;
  const year = parseYear(draft);

  function addYear() {
    if (year === null || years === null) return;
    if (!years.includes(year)) onChange([...years, year].sort((left, right) => left - right));
    setDraftState({ scopeKey, value: '' });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addYear();
  }

  if (years === null) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        现有年份配置格式无效；系统没有改写它。请删除并重新添加这个任务节点。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1900}
          max={2099}
          inputMode="numeric"
          aria-label={inputLabel}
          aria-invalid={Boolean(draft && year === null)}
          aria-describedby={draft && year === null ? validationId : undefined}
          value={draft}
          onChange={(event) => setDraftState({ scopeKey, value: event.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="例如 2023"
        />
        <Button type="button" size="sm" disabled={year === null} onClick={addYear} aria-label="添加入学年份">
          添加年份
        </Button>
      </div>
      {draft && year === null ? (
        <p id={validationId} className="text-xs text-destructive">
          请输入 1900–2099 之间的四位年份。
        </p>
      ) : null}
      {years.length ? (
        <div className="flex flex-wrap gap-2" aria-label="已添加的入学年份">
          {years.map((item, index) => (
            <Badge key={`${item}:${index}`} variant="secondary" className="gap-1 pr-1">
              <span>{item} 年</span>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-background/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`移除 ${item} 年`}
                onClick={() => onChange(years.filter((candidate) => candidate !== item))}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">尚未添加年份。</p>
      )}
    </div>
  );
}
