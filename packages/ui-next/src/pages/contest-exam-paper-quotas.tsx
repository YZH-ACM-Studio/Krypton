import { useEffect, useMemo, useRef, useState } from 'react';
import { PROBLEM_KINDS, effectiveProblemKind, type ProblemKind } from '@hydrooj/common';
import { Input } from '@/components/ui/input';

const KIND_LABEL: Record<ProblemKind, string> = {
  programming: '编程',
  single: '单选',
  multi: '多选',
  true_false: '判断',
  blank: '填空',
  subjective: '主观',
  program_fill: '程序填空',
  function: '函数',
};

const POOL_SHORT_MESSAGE = '题型数量不足，不能保存抽题';

type QuotaDraft = Record<ProblemKind, string>;
type ProblemKindBrief = { problemKind?: unknown };

function emptyQuotaDraft(): QuotaDraft {
  return Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, ''])) as QuotaDraft;
}

function positiveQuotaCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const count = Number(trimmed);
  if (!Number.isInteger(count) || count < 1) return null;
  return count;
}

export function examPaperQuotaDraft(quotas?: Partial<Record<string, number>>): QuotaDraft {
  const draft = emptyQuotaDraft();
  if (!quotas) return draft;
  for (const kind of PROBLEM_KINDS) {
    const count = quotas[kind];
    if (typeof count === 'number' && Number.isInteger(count) && count >= 1) draft[kind] = String(count);
  }
  return draft;
}

export function countExamPaperPoolFromPdict(
  pids: readonly number[] | undefined,
  pdict: Record<string, ProblemKindBrief> | undefined,
): Record<ProblemKind, number> {
  const counts = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, 0])) as Record<ProblemKind, number>;
  for (const pid of pids || []) {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue;
    const problem = pdict?.[String(pid)];
    counts[effectiveProblemKind({ problemKind: problem?.problemKind })] += 1;
  }
  return counts;
}

export function serializeExamPaperQuotasField(draft: QuotaDraft): string {
  const quotas: Partial<Record<ProblemKind, number>> = {};
  let invalid = false;
  for (const kind of PROBLEM_KINDS) {
    const raw = draft[kind].trim();
    if (!raw) continue;
    const count = Number(raw);
    if (Number.isInteger(count) && count === 0) continue;
    if (!Number.isInteger(count) || count < 1) {
      invalid = true;
      quotas[kind] = Number.isFinite(count) ? count : 0;
      continue;
    }
    quotas[kind] = count;
  }
  if (invalid) return JSON.stringify(quotas);
  return Object.keys(quotas).length ? JSON.stringify(quotas) : '';
}

export function examPaperQuotaPoolShortfalls(
  draft: QuotaDraft,
  pool: Record<ProblemKind, number>,
): ProblemKind[] {
  const shortfalls: ProblemKind[] = [];
  for (const kind of PROBLEM_KINDS) {
    const count = positiveQuotaCount(draft[kind]);
    if (count !== null && pool[kind] < count) shortfalls.push(kind);
  }
  return shortfalls;
}

export function ContestExamPaperQuotas({
  pids,
  pdict,
  quotas,
  disabled = false,
}: {
  pids?: number[];
  pdict?: Record<string, ProblemKindBrief>;
  quotas?: Partial<Record<string, number>>;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<QuotaDraft>(() => examPaperQuotaDraft(quotas));
  const pool = useMemo(() => countExamPaperPoolFromPdict(pids, pdict), [pids, pdict]);
  const payload = useMemo(() => serializeExamPaperQuotasField(draft), [draft]);
  const shortfalls = useMemo(() => examPaperQuotaPoolShortfalls(draft, pool), [draft, pool]);

  useEffect(() => {
    const root = rootRef.current;
    const form = root?.closest('form');
    if (!root || !form) return undefined;
    for (const kind of PROBLEM_KINDS) {
      const input = root.querySelector<HTMLInputElement>(`#examPaperQuota-${kind}`);
      input?.setCustomValidity(shortfalls.includes(kind) ? POOL_SHORT_MESSAGE : '');
    }
    const onSubmit = (event: Event) => {
      if (!shortfalls.length) return;
      event.preventDefault();
      const first = root.querySelector<HTMLInputElement>(`#examPaperQuota-${shortfalls[0]}`);
      first?.reportValidity();
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [shortfalls]);

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">按题型抽题</h3>
        <p className="text-xs text-muted-foreground">0 或留空表示不抽该题型</p>
        {shortfalls.length ? <p className="text-xs text-destructive">{POOL_SHORT_MESSAGE}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {PROBLEM_KINDS.map((kind) => (
          <div key={kind} className="space-y-1.5">
            <label htmlFor={`examPaperQuota-${kind}`} className="text-sm font-medium">
              {KIND_LABEL[kind]}
              <span className="ml-1 font-normal text-muted-foreground">题库 {pool[kind]}</span>
            </label>
            <Input
              id={`examPaperQuota-${kind}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              disabled={disabled}
              value={draft[kind]}
              aria-invalid={shortfalls.includes(kind)}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({ ...current, [kind]: value }));
              }}
              placeholder="0"
            />
          </div>
        ))}
      </div>
      {payload ? <input type="hidden" name="examPaperQuotas" value={payload} /> : null}
    </div>
  );
}
