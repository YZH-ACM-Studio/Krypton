import type { ProblemKind } from '@hydrooj/common';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { TEACH_KIND_LABEL } from '@/pages/teach/model';

export function KindTabs({
  kinds,
  counts,
  value,
  onValueChange,
  'aria-label': ariaLabel = '题型',
}: {
  kinds: readonly ProblemKind[];
  counts: Partial<Record<ProblemKind, number>>;
  value: ProblemKind;
  onValueChange: (kind: ProblemKind) => void;
  'aria-label'?: string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto scrollbar-none">
      <MiniTabs
        size="sm"
        aria-label={ariaLabel}
        value={value}
        onValueChange={onValueChange}
        items={kinds.map((kind) => ({
          value: kind,
          label: (
            <>
              {kindLabel(kind)}
              <span className="inline-block w-5 text-right text-xs tabular text-fg-subtle">{countLabel(counts, kind)}</span>
            </>
          ),
        }))}
      />
    </div>
  );
}

function kindLabel(kind: ProblemKind): string {
  if (!Object.hasOwn(TEACH_KIND_LABEL, kind)) throw new TypeError(`paper_kind_invalid:${String(kind)}`);
  return TEACH_KIND_LABEL[kind];
}

function countLabel(counts: Partial<Record<ProblemKind, number>>, kind: ProblemKind): string {
  const count = counts[kind];
  if (typeof count !== 'number' || !Number.isFinite(count)) return '0';
  return String(count);
}
