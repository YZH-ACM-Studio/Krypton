import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  type EndpointPreflight,
  type SeatFilter,
} from '../../src/pages/exam-classroom/model.ts';

// A static import fails collection while seat-status-filter.tsx is absent.
const filterLoaders = import.meta.glob('../../src/pages/exam-classroom/seat-status-filter.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const FILTER_SOURCE = 'src/pages/exam-classroom/seat-status-filter.tsx';
const HINT = '未检测实时在线状态';

interface SeatStatusFilterProps {
  counts: Record<SeatFilter, number>;
  value: SeatFilter;
  preflightState: EndpointPreflight['state'];
  onValueChange: (filter: SeatFilter) => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function counts(partial: Partial<Record<SeatFilter, number>> = {}): Record<SeatFilter, number> {
  return {
    all: 0,
    bound: 0,
    online: 0,
    offline: 0,
    unbound: 0,
    pairing: 0,
    'identity-change': 0,
    conflict: 0,
    disabled: 0,
    ...partial,
  };
}

function tabLabels(): string[] {
  return screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').replace(/[\s\d]/g, ''));
}

function expectTabCount(label: string, count: number): void {
  expect(screen.getByRole('tab', { name: new RegExp(`^${label}`) })).toHaveTextContent(String(count));
}

function filterLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(filterLoaders)) {
    if (key.endsWith(FILTER_SOURCE)) return load;
  }
  return undefined;
}

async function loadSeatStatusFilter(): Promise<ComponentType<SeatStatusFilterProps>> {
  const load = filterLoader();
  expect(typeof load, FILTER_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${FILTER_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('seat status filter module must be an object');
  const value = readField(imported, 'SeatStatusFilter');
  expect(typeof value, 'SeatStatusFilter').toBe('function');
  if (typeof value !== 'function') throw new TypeError('SeatStatusFilter must be a function');
  return value as ComponentType<SeatStatusFilterProps>;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', FILTER_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

function expectExplicitVariants(): void {
  const script = [
    "import { readFileSync } from 'node:fs';",
    "import { scanOpenTags } from './scripts/design-gate.mjs';",
    'const source = readFileSync(process.argv[1], "utf8");',
    'const lines = [];',
    "for (const tag of scanOpenTags(source, 'Button')) {",
    "  if (!tag.text.includes('variant=')) lines.push(String(tag.line));",
    '}',
    'if (lines.length > 0) {',
    "  console.log(lines.map((line) => process.argv[1] + ':' + line + ' 缺少 variant=').join('\\n'));",
    '  process.exit(1);',
    '}',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, FILTER_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

describe('classroom seat status filter', () => {
  it('未检测在线时只显示全部、已绑定和未绑定，并提示未检测', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({ all: 3, bound: 2, unbound: 1 })}
        value="all"
        preflightState="unavailable"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    const tablist = screen.getByRole('tablist', { name: '座位筛选' });
    const root = tablist.parentElement;
    if (!(root instanceof HTMLElement)) throw new TypeError('seat filter root missing');
    expect(root.className).toContain('flex-wrap');
    expect(root.className).toContain('items-center');
    expect(root.className).toContain('gap-x-3');
    expect(root.className).toContain('gap-y-2');
    expect(tabLabels()).toEqual(['全部', '已绑定', '未绑定']);
    expectTabCount('全部', 3);
    expectTabCount('已绑定', 2);
    expectTabCount('未绑定', 1);
    expect(screen.getByRole('tab', { name: /^全部/ })).toHaveAttribute('aria-selected', 'true');

    const hint = screen.getByText(HINT);
    expect(hint.tagName).toBe('SPAN');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('text-fg-subtle');
    expect(tablist.contains(hint)).toBe(false);
    expect(tablist.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('能检测在线时显示在线和离线，不显示已绑定，也不提示未检测', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        // bound stays positive so hiding a zero count cannot explain the missing 已绑定 tab.
        counts={counts({ all: 3, bound: 2, online: 1, offline: 1, unbound: 1 })}
        value="all"
        preflightState="available"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '在线', '离线', '未绑定']);
    expectTabCount('全部', 3);
    expectTabCount('在线', 1);
    expectTabCount('离线', 1);
    expectTabCount('未绑定', 1);
    expect(screen.queryByRole('tab', { name: /^已绑定/ })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('当前冲突计数为零时仍显示，点击未绑定会切换', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    const onValueChange = vi.fn<(filter: SeatFilter) => void>();
    render(
      <SeatStatusFilter
        counts={counts({ all: 3, bound: 2, unbound: 1, conflict: 0 })}
        value="conflict"
        preflightState="unavailable"
        onValueChange={onValueChange}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '已绑定', '未绑定', '冲突']);
    const conflict = screen.getByRole('tab', { name: /^冲突/ });
    expect(conflict).toHaveAttribute('aria-selected', 'true');
    expectTabCount('冲突', 0);
    expect(screen.queryByRole('tab', { name: /^配对中/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^身份变化/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^已禁用/ })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('tab', { name: /^未绑定/ }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('unbound');
  });

  it('不需要预检时用已绑定，且不提示未检测', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({ all: 3, bound: 2, online: 1, offline: 1, unbound: 1 })}
        value="all"
        preflightState="not-required"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '已绑定', '未绑定']);
    expect(screen.queryByRole('tab', { name: /^在线/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^离线/ })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('计数全为零时仍显示全部，未检测提示只在 unavailable', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    const hidden = render(
      <SeatStatusFilter
        counts={counts()}
        value="all"
        preflightState="unavailable"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );
    expect(tabLabels()).toEqual(['全部']);
    expectTabCount('全部', 0);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    hidden.unmount();

    render(
      <SeatStatusFilter
        counts={counts()}
        value="all"
        preflightState="available"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );
    expect(tabLabels()).toEqual(['全部']);
    expect(screen.queryByRole('tab', { name: /^在线/ })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('未检测时忽略在线和离线计数，并按固定顺序排列', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({
          all: 8,
          bound: 1,
          online: 1,
          offline: 1,
          unbound: 1,
          pairing: 1,
          'identity-change': 1,
          conflict: 1,
          disabled: 1,
        })}
        value="all"
        preflightState="unavailable"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '已绑定', '未绑定', '配对中', '身份变化', '冲突', '已禁用']);
    expect(screen.queryByRole('tab', { name: /^在线/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^离线/ })).not.toBeInTheDocument();
  });

  it('能检测在线时忽略已绑定计数，并按固定顺序排列', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({
          all: 8,
          bound: 1,
          online: 1,
          offline: 1,
          unbound: 1,
          pairing: 1,
          'identity-change': 1,
          conflict: 1,
          disabled: 1,
        })}
        value="all"
        preflightState="available"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '在线', '离线', '未绑定', '配对中', '身份变化', '冲突', '已禁用']);
    expect(screen.queryByRole('tab', { name: /^已绑定/ })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('当前筛选计数为零时仍显示该项，不限于冲突', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({ all: 2, bound: 1, unbound: 1, pairing: 0 })}
        value="pairing"
        preflightState="unavailable"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '已绑定', '未绑定', '配对中']);
    const pairing = screen.getByRole('tab', { name: /^配对中/ });
    expect(pairing).toHaveAttribute('aria-selected', 'true');
    expectTabCount('配对中', 0);
    expect(screen.queryByRole('tab', { name: /^冲突/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^身份变化/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^已禁用/ })).not.toBeInTheDocument();
  });

  it('能检测在线且当前选中离线时，计数为零仍显示离线', async () => {
    const SeatStatusFilter = await loadSeatStatusFilter();
    render(
      <SeatStatusFilter
        counts={counts({ all: 2, online: 2, offline: 0 })}
        value="offline"
        preflightState="available"
        onValueChange={vi.fn<(filter: SeatFilter) => void>()}
      />,
    );

    expect(tabLabels()).toEqual(['全部', '在线', '离线']);
    expect(screen.getByRole('tab', { name: /^离线/ })).toHaveAttribute('aria-selected', 'true');
    expectTabCount('离线', 0);
    expect(screen.queryByRole('tab', { name: /^已绑定/ })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, FILTER_SOURCE)), FILTER_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
