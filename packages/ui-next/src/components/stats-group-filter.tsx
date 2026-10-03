import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';

export interface StatsGroupChoice {
  _id: string;
  name: string;
  archivedAt?: string | null;
}

function groupLabel(group: StatsGroupChoice): string {
  return group.archivedAt ? `${group.name}（已归档）` : group.name;
}

export function StatsGroupFields({
  groups,
  selectedIds,
  hint,
}: {
  groups: StatsGroupChoice[];
  selectedIds: string[];
  hint: string;
}) {
  const options = useMemo(
    () => [...groups].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left._id.localeCompare(right._id)),
    [groups],
  );
  const [selected, setSelected] = useState(() => {
    const byId = new Map(options.map((group) => [group._id, group]));
    return selectedIds.flatMap((id) => {
      const group = byId.get(id);
      return group ? [group] : [];
    });
  });

  return (
    <div className="min-w-0 flex-1 space-y-1.5" role="group" aria-label="用户组">
      <p className="text-xs text-fg-subtle">用户组</p>
      {options.length ? (
        <MultiSelect
          options={options}
          value={selected}
          onChange={setSelected}
          getKey={(group) => group._id}
          getLabel={groupLabel}
          name="groupIds"
          placeholder="搜索用户组"
          emptyText="没有匹配的用户组"
          minHeight={40}
        />
      ) : (
        <p className="text-sm text-fg-muted">暂无用户组</p>
      )}
      <p className="text-xs text-fg-subtle">{hint}</p>
    </div>
  );
}

export function StatsGroupFilterForm({
  action,
  hidden = {},
  groups,
  selectedIds,
  hint,
}: {
  action: string;
  hidden?: Record<string, string>;
  groups: StatsGroupChoice[];
  selectedIds: string[];
  hint: string;
}) {
  return (
    <form method="get" action={action} className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <StatsGroupFields groups={groups} selectedIds={selectedIds} hint={hint} />
      <Button type="submit" variant="secondary" className="shrink-0">
        查看
      </Button>
    </form>
  );
}
