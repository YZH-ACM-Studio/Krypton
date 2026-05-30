/**
 * `<ProblemPicker>` — convenience wrapper around `<MultiSelect>` for
 * problem-id arrays. External value/onChange use `string[]` so consumers
 * don't have to worry about the rich `ProblemOption` shape. Titles are
 * filled in async after mount.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  fetchProblemsByIds, problemKey, type ProblemOption, searchProblems,
} from '@/lib/multi-select-presets';

export interface ProblemPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Hidden input name for native form submit (CSV by default). */
  name?: string;
  /** Repeat the hidden input per id (for Hydro `Types.CommaSeperatedArray` etc). */
  valueFormat?: 'csv' | 'repeated';
  placeholder?: string;
  maxItems?: number;
  disabled?: boolean;
  className?: string;
  minHeight?: number;
}

export function ProblemPicker({
  value, onChange, name, valueFormat = 'csv',
  placeholder, maxItems, disabled, className, minHeight = 48,
}: ProblemPickerProps) {
  // Local state — kept in ProblemOption[] form for richer chip rendering.
  const [items, setItems] = useState<ProblemOption[]>(() => value.map((id) => ({
    docId: Number(id) || 0, pid: id, title: '',
  })));

  // Fill titles in for the initial id list once.
  useEffect(() => {
    if (!value.length) { setItems([]); return; }
    let cancelled = false;
    fetchProblemsByIds(value).then((res) => {
      if (cancelled) return;
      // Honour the order of `value` rather than the search results.
      const byKey = new Map<string, ProblemOption>();
      for (const problem of res) {
        byKey.set(String(problem.docId), problem);
        if (problem.pid) byKey.set(String(problem.pid), problem);
      }
      setItems(value.map((id) => byKey.get(id) || { docId: Number(id) || 0, pid: id, title: '' }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the external `value` array changes (e.g. parent reset), sync
  // — but only if the change came from outside, identified by id set
  // mismatch.
  useEffect(() => {
    const externalKey = value.join(',');
    const localKey = items.map(problemKey).join(',');
    if (externalKey === localKey) return;
    setItems(value.map((id) => ({ docId: Number(id) || 0, pid: id, title: '' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join(',')]);

  const handleChange = (next: ProblemOption[]) => {
    setItems(next);
    onChange(next.map(problemKey));
  };

  return (
    <MultiSelect<ProblemOption>
      loadOptions={(q) => searchProblems(q, 20)}
      value={items}
      onChange={handleChange}
      getKey={problemKey}
      getLabel={(p) => `${p.pid || p.docId} ${p.title || ''}`.trim()}
      renderChip={(p) => (
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">{p.pid || p.docId}</span>
          {p.title ? <span className="truncate max-w-[140px]">{p.title}</span> : null}
        </span>
      )}
      renderOption={(p) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">{p.pid || p.docId}</span>
          <span className="truncate flex-1">{p.title || '—'}</span>
          {p.difficulty ? <Badge variant="outline" className="text-[10px] shrink-0">Lv.{p.difficulty}</Badge> : null}
          {p.nSubmit ? (
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{p.nAccept ?? 0}/{p.nSubmit}</span>
          ) : null}
        </div>
      )}
      name={name}
      valueFormat={valueFormat}
      placeholder={placeholder || '搜索题目 (pid / 标题)…'}
      maxItems={maxItems}
      disabled={disabled}
      className={className}
      minHeight={minHeight}
    />
  );
}
