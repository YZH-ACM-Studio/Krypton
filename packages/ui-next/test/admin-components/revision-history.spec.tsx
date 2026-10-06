import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// A static import fails collection while revision-history.tsx is absent.
const revisionHistoryLoaders = import.meta.glob('../../src/components/admin/revision-history.tsx');

const SOURCE = 'src/components/admin/revision-history.tsx';

interface RevisionHistoryRow {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  current?: boolean;
  action?: ReactNode;
  detail?: { summary: string; content: ReactNode };
}

interface RevisionHistoryProps {
  title: string;
  summary?: ReactNode;
  rows: RevisionHistoryRow[];
  currentLabel?: string;
  defaultOpen?: boolean;
}

function revisionHistoryLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(revisionHistoryLoaders)) {
    if (key.endsWith(SOURCE)) return load;
  }
  return undefined;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

async function loadRevisionHistory(): Promise<ComponentType<RevisionHistoryProps>> {
  const load = revisionHistoryLoader();
  expect(typeof load, SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('revision-history module must be an object');
  }
  const value = readField(imported, 'RevisionHistory');
  expect(typeof value, 'RevisionHistory').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('RevisionHistory must be a function');
  }
  return value as ComponentType<RevisionHistoryProps>;
}

function publishedRows(): RevisionHistoryRow[] {
  return [
    { key: 'v3', title: 'v3', meta: '2026-08-12 发布', current: true },
    { key: 'v2', title: 'v2', meta: '2026-08-10 发布', current: false },
    { key: 'v1', title: 'v1', meta: '2026-08-01 发布' },
  ];
}

function rootDetails(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  expect(root?.tagName).toBe('DETAILS');
  expect(root).toHaveAttribute('data-slot', 'revision-history');
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected revision history details');
  }
  return root;
}

function historyItems(root: HTMLElement): HTMLElement[] {
  const list = [...root.children].find((node) => node.tagName === 'OL');
  if (!(list instanceof HTMLElement)) return [];
  return [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'LI');
}

function requireRows(root: HTMLElement): [HTMLElement, HTMLElement, HTMLElement] {
  const items = historyItems(root);
  expect(items).toHaveLength(3);
  const [current, previous, oldest] = items;
  expect(current).toBeInstanceOf(HTMLElement);
  expect(previous).toBeInstanceOf(HTMLElement);
  expect(oldest).toBeInstanceOf(HTMLElement);
  if (!(current instanceof HTMLElement) || !(previous instanceof HTMLElement) || !(oldest instanceof HTMLElement)) {
    throw new TypeError('expected three history rows');
  }
  return [current, previous, oldest];
}

function requireBadge(item: HTMLElement): HTMLElement {
  const badge = item.querySelector('[data-slot="badge"]');
  expect(badge).toBeInstanceOf(HTMLElement);
  if (!(badge instanceof HTMLElement)) {
    throw new TypeError('expected a badge');
  }
  return badge;
}

function requireSummary(root: ParentNode): HTMLElement {
  const summary = [...root.children].find((node) => node.tagName === 'SUMMARY');
  expect(summary).toBeInstanceOf(HTMLElement);
  if (!(summary instanceof HTMLElement)) {
    throw new TypeError('expected a summary');
  }
  return summary;
}

describe('revision history', () => {
  it('rows 为空时 container.firstChild 为 null', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const { container } = render(<RevisionHistory title="版本历史" summary="没有版本" rows={[]} defaultOpen />);
    expect(container.firstChild).toBeNull();
  });

  it('只有当前行带 data-current，徽标默认为使用中', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const { container } = render(<RevisionHistory title="版本历史" rows={publishedRows()} />);
    const [current, previous, oldest] = requireRows(rootDetails(container));

    expect(current).toHaveAttribute('data-current', 'true');
    expect(previous).not.toHaveAttribute('data-current');
    expect(oldest).not.toHaveAttribute('data-current');
    expect(current.textContent).toContain('v3');
    expect(previous.textContent).toContain('v2');
    expect(oldest.textContent).toContain('v1');
    expect(current.textContent).toContain('2026-08-12 发布');
    expect(previous.textContent).toContain('2026-08-10 发布');
    expect(oldest.textContent).toContain('2026-08-01 发布');

    const badge = requireBadge(current);
    expect(badge).toHaveAttribute('data-tone', 'success');
    expect(badge.textContent?.trim()).toBe('使用中');
    expect(previous.querySelector('[data-slot="badge"]')).toBeNull();
    expect(oldest.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('currentLabel 替换当前行徽标文本', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const { container } = render(<RevisionHistory title="版本历史" rows={publishedRows()} currentLabel="本活动使用中" />);
    const [current] = requireRows(rootDetails(container));
    expect(requireBadge(current).textContent?.trim()).toBe('本活动使用中');
  });

  it('打开后能找到行内操作按钮', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const { container } = render(
      <RevisionHistory
        title="版本历史"
        defaultOpen
        rows={[{ key: 'v2', title: 'v2', action: <button>改用此版本</button> }]}
      />,
    );
    const root = rootDetails(container);
    expect(root.hasAttribute('open')).toBe(true);
    const button = screen.getByRole('button', { name: '改用此版本' });
    const item = historyItems(root).find((node) => node.contains(button));
    expect(item).toBeInstanceOf(HTMLElement);
  });

  it('详情行的内层 summary 与 content 渲染在内层 details 中', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const { container } = render(
      <RevisionHistory
        title="版本历史"
        defaultOpen
        rows={[{ key: 'v1', title: 'v1', detail: { summary: '查看规则', content: '端口：443' } }]}
      />,
    );
    const item = historyItems(rootDetails(container))[0];
    expect(item).toBeInstanceOf(HTMLElement);
    if (!(item instanceof HTMLElement)) {
      throw new TypeError('expected a history row');
    }
    const inner = [...item.querySelectorAll('details')].find((node) => node instanceof HTMLElement && node.tagName === 'DETAILS');
    expect(inner?.tagName).toBe('DETAILS');
    if (!(inner instanceof HTMLElement)) {
      throw new TypeError('expected nested details');
    }
    const summary = requireSummary(inner);
    expect(summary.textContent?.trim()).toBe('查看规则');
    expect(summary.textContent).not.toContain('端口：443');
    const content = [...inner.children].find((node) => node !== summary && node.textContent?.includes('端口：443'));
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content?.textContent).toContain('端口：443');
  });

  it('defaultOpen 省略时根 details 无 open，为 true 时有', async () => {
    const RevisionHistory = await loadRevisionHistory();
    const rows = [{ key: 'v1', title: 'v1' }];
    const closed = render(<RevisionHistory title="版本历史" summary="1 个已发布版本" rows={rows} />);
    const closedRoot = rootDetails(closed.container);
    const closedSummary = requireSummary(closedRoot);
    expect(closedRoot.hasAttribute('open')).toBe(false);
    expect(closedSummary.textContent).toContain('版本历史');
    expect(closedSummary.textContent).toContain('1 个已发布版本');
    expect(closedSummary.textContent).not.toContain('v1');

    const opened = render(<RevisionHistory title="版本历史" summary="1 个已发布版本" rows={rows} defaultOpen />);
    expect(rootDetails(opened.container).hasAttribute('open')).toBe(true);
  });

  it('门禁零违规', () => {
    // helpers.ts imports design-gate.mjs, whose import.meta.url is not a file URL under the jsdom transform.
    const packageRoot = resolve(import.meta.dirname, '../..');
    expect(existsSync(resolve(packageRoot, SOURCE)), SOURCE).toBe(true);
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', SOURCE], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
      throw new TypeError('design-gate did not return a status and string output');
    }
    expect(result.status, `${result.stdout}${result.stderr}`.trim()).toBe(0);
  });
});
