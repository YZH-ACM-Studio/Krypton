import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  parsePairingWindow,
  type PairingWindow,
} from '../../src/pages/exam-classroom/model.ts';

// A static import fails collection while pairing-card.tsx is absent.
const pairingCardLoaders = import.meta.glob('../../src/pages/exam-classroom/pairing-card.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const PAIRING_CARD_SOURCE = 'src/pages/exam-classroom/pairing-card.tsx';
const CREATED_AT = '2026-08-11T00:00:00.000Z';
const NOW = Date.parse(CREATED_AT);

interface PairingCardProps {
  window: PairingWindow;
  completed: boolean;
  now: number;
  busy: boolean;
  recentSeatId: string | null;
  displayName: (uid: number | null | undefined) => string;
  onClose: () => void;
  onLocateRecent: () => void;
}

interface RevokeTarget {
  endpointId: string;
  seatLabel: string;
}

interface RecentActionNoticeProps {
  undoSeatLabel: string | null;
  revoke: RevokeTarget | null;
  busy: boolean;
  onUndo: () => void;
  onRevoke: () => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function displayName(uid: number | null | undefined): string {
  if (uid == null) return '—';
  if (uid === 2) return '王老师';
  return `UID ${uid}`;
}

function entry(sourceSeatId: string, status: string): Record<string, unknown> {
  return {
    sourceSeatId,
    mode: 'bind',
    status,
    revision: 1,
    codeHint: '12',
    expectedBindingRevision: 0,
    claimedEndpointId: null,
    claimedAt: null,
    bindingRevision: null,
    completedAt: null,
  };
}

function pairingWindow(
  statuses: string[],
  expiresAt: string,
  options?: { revision?: number; createdBy?: number },
): PairingWindow {
  const payload: Record<string, unknown> = {
    windowId: '66b800000000000000000720',
    status: 'open',
    revision: options?.revision ?? 3,
    expiresAt,
    entries: statuses.map((status, index) => entry(`seat-${index + 1}`, status)),
    createdAt: CREATED_AT,
    createdBy: options?.createdBy ?? 2,
    closedAt: null,
    closedBy: null,
  };
  const parsed = parsePairingWindow(payload);
  if (!parsed) throw new TypeError('pairing window fixture');
  return parsed;
}

function roundedValueNow(node: HTMLElement): number {
  const raw = node.getAttribute('aria-valuenow');
  expect(raw).not.toBeNull();
  return Math.round(Number(raw));
}

function pairingLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pairingCardLoaders)) {
    if (key.endsWith(PAIRING_CARD_SOURCE)) return load;
  }
  return undefined;
}

async function loadPairingModule(): Promise<{
  PairingCard: ComponentType<PairingCardProps>;
  RecentActionNotice: ComponentType<RecentActionNoticeProps>;
}> {
  const load = pairingLoader();
  expect(typeof load, PAIRING_CARD_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAIRING_CARD_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('pairing card module must be an object');
  const pairingCard = readField(imported, 'PairingCard');
  const recentActionNotice = readField(imported, 'RecentActionNotice');
  expect(typeof pairingCard, 'PairingCard').toBe('function');
  expect(typeof recentActionNotice, 'RecentActionNotice').toBe('function');
  if (typeof pairingCard !== 'function' || typeof recentActionNotice !== 'function') {
    throw new TypeError('pairing card exports must be functions');
  }
  return {
    PairingCard: pairingCard as ComponentType<PairingCardProps>,
    RecentActionNotice: recentActionNotice as ComponentType<RecentActionNoticeProps>,
  };
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', PAIRING_CARD_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, PAIRING_CARD_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

describe('classroom pairing card', () => {
  it('进行中的窗口显示剩余时间、进度和开启人，关闭窗口会通知', async () => {
    const { PairingCard } = await loadPairingModule();
    const onClose = vi.fn<() => void>();
    const onLocateRecent = vi.fn<() => void>();
    const expiresAt = new Date(NOW + 252_000).toISOString();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'open', 'open'], expiresAt)}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={onClose}
        onLocateRecent={onLocateRecent}
      />,
    );

    const section = screen.getByRole('region', { name: '当前配对窗口' });
    expect(section.className).toContain('border-info-line');
    expect(section.className).toContain('bg-info-soft');
    expect(within(section).getByText(/配对窗口进行中 · r3/)).toBeInTheDocument();
    expect(within(section).getByText(/剩余 4:12/)).toBeInTheDocument();
    expect(within(section).getByText(/已绑定 1 \/ 3/)).toBeInTheDocument();
    expect(within(section).queryByText(/已取消/)).not.toBeInTheDocument();
    const opened = formatDate(CREATED_AT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(within(section).getByText(new RegExp(`由 王老师 于 ${opened} 开启`))).toBeInTheDocument();

    const progress = within(section).getByRole('progressbar');
    expect(roundedValueNow(progress)).toBe(33);
    expect(progress.className).toContain('h-1');
    expect(progress.querySelector('.bg-brand')).not.toBeNull();

    const close = within(section).getByRole('button', { name: '关闭窗口' });
    expect(close).toHaveAttribute('data-variant', 'secondary');
    expect(close).toHaveAttribute('data-size', 'sm');
    expect(close).toBeEnabled();
    expect(within(section).queryByRole('button', { name: '定位最近响应' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: '关闭并继续下一台' })).not.toBeInTheDocument();

    await userEvent.setup().click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLocateRecent).not.toHaveBeenCalled();
  });

  it('完成后改成关闭并继续下一台，且不显示剩余', async () => {
    const { PairingCard } = await loadPairingModule();
    const onClose = vi.fn<() => void>();
    const expiresAt = new Date(NOW + 252_000).toISOString();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'open', 'open'], expiresAt)}
        completed={true}
        now={NOW}
        busy={false}
        recentSeatId="seat-2"
        displayName={displayName}
        onClose={onClose}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );

    const section = screen.getByRole('region', { name: '当前配对窗口' });
    expect(within(section).getByText(/配对已完成 · r3/)).toBeInTheDocument();
    expect(within(section).queryByText(/配对窗口进行中/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/剩余/)).not.toBeInTheDocument();
    expect(within(section).getByText(/已绑定 1 \/ 3/)).toBeInTheDocument();
    expect(roundedValueNow(within(section).getByRole('progressbar'))).toBe(33);

    const close = within(section).getByRole('button', { name: '关闭并继续下一台' });
    expect(close).toHaveAttribute('data-variant', 'secondary');
    expect(close).toHaveAttribute('data-size', 'sm');
    expect(within(section).queryByRole('button', { name: '关闭窗口' })).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: '定位最近响应' })).toBeInTheDocument();

    await userEvent.setup().click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('有最近响应座位时才提供定位，点击后通知', async () => {
    const { PairingCard } = await loadPairingModule();
    const onClose = vi.fn<() => void>();
    const onLocateRecent = vi.fn<() => void>();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'open', 'open'], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId="seat-2"
        displayName={displayName}
        onClose={onClose}
        onLocateRecent={onLocateRecent}
      />,
    );

    const section = screen.getByRole('region', { name: '当前配对窗口' });
    const names = within(section).getAllByRole('button').map((button) => (button.textContent ?? '').replace(/\s+/g, ''));
    expect(names).toEqual(['定位最近响应', '关闭窗口']);
    const locate = within(section).getByRole('button', { name: '定位最近响应' });
    expect(locate).toHaveAttribute('data-variant', 'secondary');
    expect(locate).toHaveAttribute('data-size', 'sm');

    await userEvent.setup().click(locate);
    expect(onLocateRecent).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('已取消计入进度，已认领仍算未完成', async () => {
    const { PairingCard } = await loadPairingModule();
    const expiresAt = new Date(NOW + 252_000).toISOString();
    const { unmount } = render(
      <PairingCard
        window={pairingWindow(['bound', 'cancelled', 'open'], expiresAt)}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/已绑定 1 \/ 3 · 已取消 1/)).toBeInTheDocument();
    expect(roundedValueNow(screen.getByRole('progressbar'))).toBe(67);
    unmount();

    render(
      <PairingCard
        window={pairingWindow(['bound', 'claimed', 'open'], expiresAt)}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/已绑定 1 \/ 3/)).toBeInTheDocument();
    expect(screen.queryByText(/已取消/)).not.toBeInTheDocument();
    expect(roundedValueNow(screen.getByRole('progressbar'))).toBe(33);
  });

  it('到期显示已到期，没有座位时进度为零', async () => {
    const { PairingCard } = await loadPairingModule();
    const { unmount } = render(
      <PairingCard
        window={pairingWindow(['open'], new Date(NOW - 1000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/配对窗口进行中 · r3/)).toBeInTheDocument();
    expect(screen.getByText(/剩余 已到期/)).toBeInTheDocument();
    unmount();

    render(
      <PairingCard
        window={pairingWindow([], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/已绑定 0 \/ 0/)).toBeInTheDocument();
    expect(roundedValueNow(screen.getByRole('progressbar'))).toBe(0);
  });

  it('没有撤销和吊销时不渲染提示', async () => {
    const { RecentActionNotice } = await loadPairingModule();
    const { container } = render(
      <RecentActionNotice
        undoSeatLabel={null}
        revoke={null}
        busy={false}
        onUndo={vi.fn<() => void>()}
        onRevoke={vi.fn<() => void>()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('只有换机完成时只提供吊销旧终端', async () => {
    const { RecentActionNotice } = await loadPairingModule();
    const onUndo = vi.fn<() => void>();
    const onRevoke = vi.fn<() => void>();
    render(
      <RecentActionNotice
        undoSeatLabel={null}
        revoke={{ endpointId: 'ep_old_000000000001', seatLabel: 'A-02' }}
        busy={false}
        onUndo={onUndo}
        onRevoke={onRevoke}
      />,
    );

    const notice = screen.getByRole('status');
    expect(notice.className).toContain('bg-surface-sunken');
    expect(screen.getByText('A-02 已完成换机，旧终端凭据仍然有效。')).toBeInTheDocument();
    expect(screen.queryByText(/刚刚完成绑定/)).not.toBeInTheDocument();
    const revoke = screen.getByRole('button', { name: '吊销旧终端' });
    expect(screen.getAllByRole('button')).toEqual([revoke]);
    expect(revoke.className).toContain('bg-danger-soft');
    expect(revoke).toHaveAttribute('data-variant', 'danger-soft');
    expect(revoke).toHaveAttribute('data-size', 'sm');
    expect(revoke).toBeEnabled();

    await userEvent.setup().click(revoke);
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('只有刚完成绑定时只提供撤销', async () => {
    const { RecentActionNotice } = await loadPairingModule();
    const onUndo = vi.fn<() => void>();
    const onRevoke = vi.fn<() => void>();
    render(
      <RecentActionNotice
        undoSeatLabel="A-01"
        revoke={null}
        busy={false}
        onUndo={onUndo}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByRole('status').className).toContain('bg-surface-sunken');
    expect(screen.getByText('A-01 刚刚完成绑定，可以撤销。')).toBeInTheDocument();
    expect(screen.queryByText(/已完成换机/)).not.toBeInTheDocument();
    const undo = screen.getByRole('button', { name: '撤销刚完成的绑定' });
    expect(screen.getAllByRole('button')).toEqual([undo]);
    expect(undo).toHaveAttribute('data-variant', 'secondary');
    expect(undo).toHaveAttribute('data-size', 'sm');
    expect(undo.className).not.toContain('bg-danger-soft');

    await userEvent.setup().click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it('绑定和换机同时完成时两句各占一行', async () => {
    const { RecentActionNotice } = await loadPairingModule();
    const onUndo = vi.fn<() => void>();
    const onRevoke = vi.fn<() => void>();
    render(
      <RecentActionNotice
        undoSeatLabel="A-01"
        revoke={{ endpointId: 'ep_old_000000000001', seatLabel: 'A-02' }}
        busy={false}
        onUndo={onUndo}
        onRevoke={onRevoke}
      />,
    );

    const undoText = screen.getByText('A-01 刚刚完成绑定，可以撤销。');
    const revokeText = screen.getByText('A-02 已完成换机，旧终端凭据仍然有效。');
    expect(undoText).not.toBe(revokeText);
    expect(undoText.compareDocumentPosition(revokeText) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const names = screen.getAllByRole('button').map((button) => (button.textContent ?? '').replace(/\s+/g, ''));
    expect(names).toEqual(['撤销刚完成的绑定', '吊销旧终端']);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤销刚完成的绑定' }));
    await user.click(screen.getByRole('button', { name: '吊销旧终端' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('标题版本号跟随窗口 revision，不写死某一版', async () => {
    const { PairingCard } = await loadPairingModule();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'open'], new Date(NOW + 252_000).toISOString(), { revision: 8 })}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/配对窗口进行中 · r8/)).toBeInTheDocument();
    expect(screen.queryByText(/· r3/)).not.toBeInTheDocument();
  });

  it('只有一个已绑定座位时进度是百分之百', async () => {
    const { PairingCard } = await loadPairingModule();
    render(
      <PairingCard
        window={pairingWindow(['bound'], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(/^已绑定 1 \/ 1$/)).toBeInTheDocument();
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeCloseTo(100, 5);
  });

  it('进度值是已绑定加已取消占总数的百分比，不预先取整', async () => {
    const { PairingCard } = await loadPairingModule();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'cancelled', 'open'], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    const raw = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));
    expect(raw).toBeCloseTo((2 / 3) * 100, 5);
    expect(Number.isInteger(raw)).toBe(false);
  });

  it('配对进度条使用小尺寸', async () => {
    const { PairingCard } = await loadPairingModule();
    render(
      <PairingCard
        window={pairingWindow(['bound', 'open', 'open'], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    const classes = screen.getByRole('progressbar').className.split(/\s+/);
    expect(classes).toContain('h-1');
    expect(classes).not.toContain('h-1.5');
  });

  it('开启人使用调用方按 createdBy 给出的显示名', async () => {
    const { PairingCard } = await loadPairingModule();
    const opened = formatDate(CREATED_AT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    render(
      <PairingCard
        window={pairingWindow(['open'], new Date(NOW + 252_000).toISOString(), { createdBy: 9 })}
        completed={false}
        now={NOW}
        busy={false}
        recentSeatId={null}
        displayName={(uid) => (uid === 9 ? '李老师' : '错名字')}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByText(new RegExp(`由 李老师 于 ${opened} 开启`))).toBeInTheDocument();
    expect(screen.queryByText(/王老师/)).not.toBeInTheDocument();
  });

  it('忙碌时配对和刚完成操作的按钮不可用', async () => {
    const { PairingCard, RecentActionNotice } = await loadPairingModule();
    const { unmount } = render(
      <PairingCard
        window={pairingWindow(['bound', 'open'], new Date(NOW + 252_000).toISOString())}
        completed={false}
        now={NOW}
        busy={true}
        recentSeatId="seat-2"
        displayName={displayName}
        onClose={vi.fn<() => void>()}
        onLocateRecent={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByRole('button', { name: '定位最近响应' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关闭窗口' })).toBeDisabled();
    unmount();

    render(
      <RecentActionNotice
        undoSeatLabel="A-01"
        revoke={{ endpointId: 'ep_old_000000000001', seatLabel: 'A-02' }}
        busy={true}
        onUndo={vi.fn<() => void>()}
        onRevoke={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByRole('button', { name: '撤销刚完成的绑定' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '吊销旧终端' })).toBeDisabled();
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, PAIRING_CARD_SOURCE)), PAIRING_CARD_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
