import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  type SeatDisabledReason,
  type SeatFacing,
  type SeatOperationalEntry,
  type SeatOperationalProfile,
} from '../../src/pages/exam-classroom/model.ts';

// A static import fails collection while operational-panel.tsx is absent.
const panelLoaders = import.meta.glob('../../src/pages/exam-classroom/operational-panel.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const SOURCE = 'src/pages/exam-classroom/operational-panel.tsx';
const CREATED_AT = '2026-08-15T10:00:00.000Z';
const PANEL_TITLE = '批量设置运行配置';
const PANEL_DESCRIPTION = '不修改布局几何和终端绑定，每次操作立即保存为新版本。';
const SELECT_HINT = '点击座位切换选择，或在布局空白处拖动框选。';
const UNPERSISTED = '当前布局使用未持久化默认值';
const NOTE_LABEL = '禁用备注（可选）';
const FACING_NAMES = ['未设置', '上', '右', '下', '左'] as const;
const REASON_NAMES = ['电脑故障', '客户端不兼容', '实体座位不可用', '人工保留'] as const;

interface OperationalPanelProps {
  profile: SeatOperationalProfile;
  selectedSeatIds: Set<string>;
  visibleSeatIds: string[];
  busy: boolean;
  disabledReason: SeatDisabledReason;
  note: string;
  displayName: (uid: number | null | undefined) => string;
  onDisabledReasonChange: (reason: SeatDisabledReason) => void;
  onNoteChange: (note: string) => void;
  onSelectVisible: () => void;
  onClear: () => void;
  onFacing: (facing: SeatFacing) => void;
  onDisable: () => void;
  onRestore: () => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function entry(sourceSeatId: string, enabled = true): SeatOperationalEntry {
  return {
    sourceSeatId,
    enabled,
    facing: 'unset',
    disabledReason: enabled ? null : 'computer_failure',
    note: enabled ? null : '无法开机',
  };
}

function profile(overrides: Partial<SeatOperationalProfile> = {}): SeatOperationalProfile {
  return {
    schemaVersion: 1,
    domainId: 'system',
    schoolId: 'school-1',
    classroomId: 'classroom-1',
    layoutRevision: 3,
    layoutFingerprint: 'layout-fingerprint',
    revision: 0,
    previousRevision: null,
    entries: [entry('seat-1'), entry('seat-2'), entry('seat-3')],
    fingerprint: 'profile-fingerprint',
    persisted: false,
    createdAt: null,
    createdBy: null,
    ...overrides,
  };
}

function teacherName(uid: number | null | undefined): string {
  if (uid === 2) return '王老师';
  if (uid == null) return '未命名';
  return `UID ${uid}`;
}

function createProps(overrides: Partial<OperationalPanelProps> = {}): OperationalPanelProps {
  return {
    profile: profile(),
    selectedSeatIds: new Set(['seat-1', 'seat-2']),
    visibleSeatIds: ['seat-1', 'seat-2', 'seat-3'],
    busy: false,
    disabledReason: 'computer_failure',
    note: '',
    displayName: teacherName,
    onDisabledReasonChange: vi.fn<(reason: SeatDisabledReason) => void>(),
    onNoteChange: vi.fn<(note: string) => void>(),
    onSelectVisible: vi.fn<() => void>(),
    onClear: vi.fn<() => void>(),
    onFacing: vi.fn<(facing: SeatFacing) => void>(),
    onDisable: vi.fn<() => void>(),
    onRestore: vi.fn<() => void>(),
    ...overrides,
  };
}

function panelLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(panelLoaders)) {
    if (key.endsWith(SOURCE)) return load;
  }
  return undefined;
}

async function loadOperationalPanel(): Promise<ComponentType<OperationalPanelProps>> {
  const load = panelLoader();
  expect(typeof load, SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('operational panel module must be an object');
  const value = readField(imported, 'OperationalPanel');
  expect(typeof value, 'OperationalPanel').toBe('function');
  if (typeof value !== 'function') throw new TypeError('OperationalPanel must be a function');
  return value as ComponentType<OperationalPanelProps>;
}

async function renderPanel(overrides: Partial<OperationalPanelProps> = {}) {
  const OperationalPanel = await loadOperationalPanel();
  const props = createProps(overrides);
  const view = render(<OperationalPanel {...props} />);
  return { OperationalPanel, props, ...view };
}

function facingField(): HTMLElement {
  const fieldset = screen.getByRole('group', { name: '朝向' });
  expect(fieldset.tagName).toBe('FIELDSET');
  return fieldset;
}

function versionLine(): HTMLElement {
  return screen.getByText((_, node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (!node.textContent?.includes('当前 revision')) return false;
    return ![...node.querySelectorAll('*')].some((child) => child.textContent?.includes('当前 revision'));
  });
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

describe('exam classroom operational panel', () => {
  it('已选两个座位时显示已选文案，并且禁用所选可用', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel();
    const count = screen.getByText('2', { selector: 'span' });
    const selected = screen.getByText('已选 2 个座位');

    expect(selected).toHaveClass('sr-only');
    expect(count).toHaveClass('text-xl', 'font-semibold', 'tabular');
    expect(count.nextElementSibling).toHaveTextContent('个座位已选');
    expect(count.nextElementSibling).toHaveClass('text-xs', 'text-fg-subtle');
    expect(screen.getByRole('button', { name: '禁用所选' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '禁用所选' })).toHaveAttribute('data-variant', 'danger-soft');

    await user.click(screen.getByRole('button', { name: '禁用所选' }));
    expect(props.onDisable).toHaveBeenCalledTimes(1);
  });

  it('没有选中座位时朝向分组和清空选择不可用', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel({
      selectedSeatIds: new Set<string>(),
      visibleSeatIds: ['seat-1', 'seat-2'],
    });
    const fieldset = facingField();

    expect(fieldset).toBeDisabled();
    expect(screen.getByText('已选 0 个座位')).toBeInTheDocument();
    for (const name of FACING_NAMES) {
      expect(within(fieldset).getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: '清空选择' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '禁用所选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复所选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '选择当前结果' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: '禁用原因' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: NOTE_LABEL })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '选择当前结果' }));
    expect(props.onSelectVisible).toHaveBeenCalledTimes(1);
  });

  it('点击左只调用一次 onFacing', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel();
    const fieldset = facingField();
    const names = within(fieldset).getAllByRole('button').map((button) => button.textContent?.trim() ?? '');

    expect(names).toEqual([...FACING_NAMES]);
    expect(fieldset).toBeEnabled();
    for (const button of within(fieldset).getAllByRole('button')) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button).toHaveAttribute('data-variant', 'secondary');
      expect(button).toHaveAttribute('data-size', 'sm');
      expect(button).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: '左' }).parentElement).toHaveClass('grid', 'grid-cols-5', 'gap-1.5');
    expect(within(fieldset).getByText('朝向').tagName).toBe('LEGEND');
    expect(within(fieldset).getByText('朝向')).toHaveClass('text-xs', 'font-medium');

    await user.click(screen.getByRole('button', { name: '左' }));
    expect(props.onFacing).toHaveBeenCalledTimes(1);
    expect(props.onFacing).toHaveBeenCalledWith('left');
  });

  it('每个朝向按钮把自身方向交给 onFacing', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel();
    const expected: Array<readonly [string, SeatFacing]> = [
      ['未设置', 'unset'],
      ['上', 'up'],
      ['右', 'right'],
      ['下', 'down'],
      ['左', 'left'],
    ];

    for (const [name, facing] of expected) {
      await user.click(screen.getByRole('button', { name }));
      expect(props.onFacing).toHaveBeenLastCalledWith(facing);
    }
    expect(props.onFacing).toHaveBeenCalledTimes(expected.length);
  });

  it('选择客户端不兼容并把备注交给 onNoteChange', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel({ note: '已有备注' });
    const note = screen.getByRole('textbox', { name: NOTE_LABEL });
    const reason = screen.getByRole('combobox', { name: '禁用原因' });

    expect(reason).toHaveTextContent('电脑故障');
    expect(note).toHaveValue('已有备注');
    expect(note).toHaveAttribute('maxlength', '240');
    expect(note).toHaveAttribute('placeholder', '可选备注，最多 240 字');

    await user.click(reason);
    expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([...REASON_NAMES]);
    await user.click(screen.getByRole('option', { name: '客户端不兼容' }));
    expect(props.onDisabledReasonChange).toHaveBeenCalledTimes(1);
    expect(props.onDisabledReasonChange).toHaveBeenCalledWith('client_incompatible');

    fireEvent.change(note, { target: { value: '无法开机' } });
    expect(props.onNoteChange).toHaveBeenCalledTimes(1);
    expect(props.onNoteChange).toHaveBeenCalledWith('无法开机');
  });

  it('四个禁用原因都按原值交给 onDisabledReasonChange', async () => {
    const user = userEvent.setup();
    const { OperationalPanel, props, rerender } = await renderPanel({ disabledReason: 'manual_reserve' });
    const cases: Array<readonly [string, SeatDisabledReason]> = [
      ['电脑故障', 'computer_failure'],
      ['客户端不兼容', 'client_incompatible'],
      ['实体座位不可用', 'physical_seat_unavailable'],
      ['人工保留', 'manual_reserve'],
    ];

    for (const [label, reason] of cases) {
      await user.click(screen.getByRole('combobox', { name: '禁用原因' }));
      await user.click(screen.getByRole('option', { name: label }));
      expect(props.onDisabledReasonChange).toHaveBeenLastCalledWith(reason);
      rerender(<OperationalPanel {...props} disabledReason={reason} />);
    }
    expect(props.onDisabledReasonChange).toHaveBeenCalledTimes(cases.length);
  });

  it('备注把输入原文交给 onNoteChange', async () => {
    const { props } = await renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: NOTE_LABEL }), { target: { value: '  无法开机  ' } });
    expect(props.onNoteChange).toHaveBeenCalledTimes(1);
    expect(props.onNoteChange).toHaveBeenCalledWith('  无法开机  ');
  });

  it('所选座位都可用时不能恢复，有一个禁用座位时可以恢复', async () => {
    const user = userEvent.setup();
    const enabledOnly = profile({
      entries: [entry('seat-1'), entry('seat-2'), entry('seat-3', false)],
    });
    const { OperationalPanel, props, rerender } = await renderPanel({
      profile: enabledOnly,
      selectedSeatIds: new Set(['seat-1', 'seat-2']),
    });

    expect(screen.getByRole('button', { name: '恢复所选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复所选' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('button', { name: '禁用所选' })).toBeEnabled();

    rerender(
      <OperationalPanel
        {...props}
        selectedSeatIds={new Set(['seat-2', 'seat-3'])}
      />,
    );
    expect(screen.getByRole('button', { name: '恢复所选' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '恢复所选' }));
    expect(props.onRestore).toHaveBeenCalledTimes(1);
  });

  it('版本行在未持久化和已保存时使用规定的片段', async () => {
    const displayName = vi.fn<(uid: number | null | undefined) => string>(teacherName);
    const { OperationalPanel, props, rerender } = await renderPanel({ displayName });
    const line = versionLine();

    expect(line).toHaveClass('font-mono', 'text-2xs', 'text-fg-subtle');
    expect(line.textContent).toBe(`当前 revision 0 · ${UNPERSISTED}`);
    expect(line.textContent).not.toContain('上一版');
    expect(line.textContent).not.toContain('王老师');

    rerender(
      <OperationalPanel
        {...props}
        profile={profile({
          revision: 2,
          previousRevision: 1,
          persisted: true,
          createdAt: CREATED_AT,
          createdBy: 2,
        })}
      />,
    );
    expect(versionLine().textContent).toBe(`当前 revision 2 · 上一版 r1 · ${formatDate(CREATED_AT)} · 王老师`);
    expect(versionLine().textContent).not.toContain(UNPERSISTED);
    expect(displayName).toHaveBeenCalledWith(2);

    displayName.mockClear();
    rerender(
      <OperationalPanel
        {...props}
        profile={profile({
          revision: 4,
          previousRevision: 1,
          persisted: true,
          createdAt: null,
          createdBy: 2,
        })}
      />,
    );
    expect(versionLine().textContent).toBe(`当前 revision 4 · 上一版 r1 · ${UNPERSISTED}`);

    rerender(
      <OperationalPanel
        {...props}
        profile={profile({
          revision: 3,
          previousRevision: null,
          persisted: true,
          createdAt: CREATED_AT,
          createdBy: 2,
        })}
      />,
    );
    expect(versionLine().textContent).toBe(`当前 revision 3 · ${formatDate(CREATED_AT)} · 王老师`);
    expect(versionLine().textContent).not.toContain('上一版');

    displayName.mockClear();
    rerender(
      <OperationalPanel
        {...props}
        profile={profile({
          revision: 5,
          previousRevision: 0,
          persisted: true,
          createdAt: CREATED_AT,
          createdBy: null,
        })}
      />,
    );
    expect(versionLine().textContent).toBe(`当前 revision 5 · 上一版 r0 · ${formatDate(CREATED_AT)} · 未命名`);
    expect(displayName).toHaveBeenCalledWith(null);
  });

  it('未持久化配置即使有创建时间也显示默认值', async () => {
    const displayName = vi.fn<(uid: number | null | undefined) => string>(teacherName);
    await renderPanel({
      displayName,
      profile: profile({
        revision: 1,
        previousRevision: 2,
        persisted: false,
        createdAt: CREATED_AT,
        createdBy: 2,
      }),
    });

    expect(versionLine().textContent).toBe(`当前 revision 1 · 上一版 r2 · ${UNPERSISTED}`);
    expect(versionLine().textContent).not.toContain(formatDate(CREATED_AT));
    expect(versionLine().textContent).not.toContain('王老师');
    expect(displayName).not.toHaveBeenCalled();
  });

  it('面板标题、提示和按钮变体按运行配置规格渲染，且没有完成按钮', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel();
    const title = screen.getByRole('heading', { level: 3, name: PANEL_TITLE });
    const description = screen.getByText(PANEL_DESCRIPTION);
    const hint = screen.getByText(SELECT_HINT);
    const selectVisible = screen.getByRole('button', { name: '选择当前结果' });
    const clear = screen.getByRole('button', { name: '清空选择' });
    const disable = screen.getByRole('button', { name: '禁用所选' });

    expect(title.closest('[data-slot="panel"]')).not.toBeNull();
    expect(description.tagName).toBe('P');
    expect(hint).toHaveClass('text-xs', 'text-fg-subtle');
    expect(hint.parentElement).toHaveClass('flex', 'flex-col', 'gap-4');
    expect(screen.getByText('禁用')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument();
    expect(screen.queryByText('批量设置座位运行配置')).not.toBeInTheDocument();
    expect(screen.queryByText(/不会修改布局几何或终端绑定/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(9);
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('data-variant', 'primary');
      expect(button).toHaveAttribute('data-size', 'sm');
    }
    expect(selectVisible).toHaveAttribute('data-variant', 'ghost');
    expect(clear).toHaveAttribute('data-variant', 'ghost');
    expect(selectVisible).toBeEnabled();
    expect(clear).toBeEnabled();
    expect(disable.parentElement).toBe(screen.getByRole('button', { name: '恢复所选' }).parentElement);
    expect(disable.parentElement).toHaveClass('grid', 'grid-cols-2', 'gap-2');

    await user.click(selectVisible);
    await user.click(clear);
    expect(props.onSelectVisible).toHaveBeenCalledTimes(1);
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('忙碌或当前结果为空时沿用原来的禁用条件', async () => {
    const disabledSeat = profile({
      entries: [entry('seat-1', false), entry('seat-2')],
    });
    const { OperationalPanel, props, rerender } = await renderPanel({
      profile: disabledSeat,
      selectedSeatIds: new Set(['seat-1', 'seat-2']),
      visibleSeatIds: [],
      busy: false,
    });

    expect(screen.getByRole('button', { name: '选择当前结果' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清空选择' })).toBeEnabled();
    expect(facingField()).toBeEnabled();
    expect(screen.getByRole('button', { name: '恢复所选' })).toBeEnabled();

    rerender(
      <OperationalPanel
        {...props}
        busy
        visibleSeatIds={['seat-1', 'seat-2']}
      />,
    );
    expect(facingField()).toBeDisabled();
    for (const name of ['选择当前结果', '清空选择', '禁用所选', '恢复所选', ...FACING_NAMES]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('combobox', { name: '禁用原因' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: NOTE_LABEL })).toBeDisabled();
  });

  it('当前结果只有一个座位时仍可选择', async () => {
    const user = userEvent.setup();
    const { props } = await renderPanel({ visibleSeatIds: ['seat-1'], busy: false });
    const button = screen.getByRole('button', { name: '选择当前结果' });

    expect(button).toBeEnabled();
    await user.click(button);
    expect(props.onSelectVisible).toHaveBeenCalledTimes(1);
  });

  it('源码和渲染出的 className 不含 violet', async () => {
    const sourcePath = resolve(packageRoot, SOURCE);
    expect(existsSync(sourcePath), sourcePath).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).not.toContain('violet');

    const { container } = await renderPanel();
    const classes = [container.getAttribute('class') ?? ''];
    for (const node of container.querySelectorAll('*')) classes.push(node.getAttribute('class') ?? '');
    expect(classes.join('\n')).not.toContain('violet');
  });

  it('运行配置面板通过设计门禁且按钮显式声明 variant', () => {
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
