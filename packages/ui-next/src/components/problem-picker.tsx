/**
 * `<ProblemPicker>` — convenience wrapper around `<MultiSelect>` for
 * problem-id arrays. External value/onChange use `string[]` so consumers
 * don't have to worry about the rich `ProblemOption` shape. Titles are
 * filled in async after mount.
 */
import { useEffect, useState } from 'react';
import { MultiSelect } from '@/components/ui/multi-select';
import { Difficulty } from '@/components/ui/verdict';
import { fetchProblemsByIds, mergeFetchedProblemTitles, problemKey, type ProblemOption, searchProblems } from '@/lib/multi-select-presets';

export interface ProblemPickerProps {
  value: Array<string | number>;
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
  value,
  onChange,
  name,
  valueFormat = 'csv',
  placeholder,
  maxItems,
  disabled,
  className,
  minHeight = 48,
}: ProblemPickerProps) {
  // Local state — kept in ProblemOption[] form for richer chip rendering.
  const [items, setItems] = useState<ProblemOption[]>(() =>
    value.map((id) => ({
      docId: Number(id) || 0,
      pid: id,
      title: '',
    })),
  );

  // Fill titles in for the initial id list once. Numeric ids must be
  // strings before fetch: fetchProblemsByIds compares with strict ===.
  // The result only titles rows still selected; it must not put back
  // ids the user removed before the request returned.
  useEffect(() => {
    if (!value.length) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const requestedIds = value.map((id) => String(id));
    fetchProblemsByIds(requestedIds).then((res) => {
      if (cancelled) return;
      setItems((current) => mergeFetchedProblemTitles(current, requestedIds, res));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Parent may replace a pid token with its docId while the mount fetch is
  // still in flight. That response keeps the old token, so a mismatched id
  // list has to request titles for the ids now on screen.
  useEffect(() => {
    const externalKey = value.join(',');
    const localKey = items.map(problemKey).join(',');
    if (externalKey === localKey) return undefined;
    const requestedIds = value.map((id) => String(id));
    setItems(requestedIds.map((id) => ({ docId: Number(id) || 0, pid: id, title: '' })));
    if (!requestedIds.length) return undefined;
    let cancelled = false;
    fetchProblemsByIds(requestedIds).then((res) => {
      if (cancelled) return;
      setItems((current) => mergeFetchedProblemTitles(current, requestedIds, res));
    });
    return () => {
      cancelled = true;
    };
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">{p.pid || p.docId}</span>
          {p.title ? <span className="min-w-0 max-w-36 truncate">{p.title}</span> : null}
        </span>
      )}
      renderOption={(p) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">{p.pid || p.docId}</span>
          <span className="min-w-0 flex-1 truncate">{p.title || '—'}</span>
          <Difficulty level={p.difficulty} />
          {p.nSubmit ? (
            <span className="shrink-0 text-2xs text-fg-subtle tabular">
              {p.nAccept ?? 0}/{p.nSubmit}
            </span>
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
