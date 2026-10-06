import { type JSX } from 'react';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { type EndpointPreflight, type SeatFilter } from './model';

const FILTER_LABEL: Record<SeatFilter, string> = {
  all: '全部',
  bound: '已绑定',
  online: '在线',
  offline: '离线',
  unbound: '未绑定',
  pairing: '配对中',
  'identity-change': '身份变化',
  conflict: '冲突',
  disabled: '已禁用',
};

const TAIL_FILTERS = ['unbound', 'pairing', 'identity-change', 'conflict', 'disabled'] as const satisfies readonly SeatFilter[];

function orderedFilters(preflightState: EndpointPreflight['state']): SeatFilter[] {
  const availability: SeatFilter[] = preflightState === 'available' ? ['online', 'offline'] : ['bound'];
  return ['all', ...availability, ...TAIL_FILTERS];
}

function shownFilters(
  counts: Record<SeatFilter, number>,
  value: SeatFilter,
  preflightState: EndpointPreflight['state'],
): SeatFilter[] {
  return orderedFilters(preflightState).filter((filter) => filter === 'all' || filter === value || counts[filter] !== 0);
}

export function SeatStatusFilter({
  counts,
  value,
  preflightState,
  onValueChange,
}: {
  counts: Record<SeatFilter, number>;
  value: SeatFilter;
  preflightState: EndpointPreflight['state'];
  onValueChange: (filter: SeatFilter) => void;
}): JSX.Element {
  const items: Array<MiniTabItem<SeatFilter>> = shownFilters(counts, value, preflightState).map((filter) => ({
    value: filter,
    label: FILTER_LABEL[filter],
    count: counts[filter],
  }));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <MiniTabs aria-label="座位筛选" size="sm" value={value} onValueChange={onValueChange} items={items} />
      {preflightState === 'unavailable' ? <span className="text-xs text-fg-subtle">未检测实时在线状态</span> : null}
    </div>
  );
}
