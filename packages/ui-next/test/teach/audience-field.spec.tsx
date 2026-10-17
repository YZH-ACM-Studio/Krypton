import { useState, type ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// A static import fails collection while audience-field.tsx is absent.
const fieldLoaders = import.meta.glob('../../src/components/teach/audience-field.tsx');

const FIELD_SOURCE = 'src/components/teach/audience-field.tsx';
const GROUP_DESCRIPTION = '只有组里已绑定的学生能看到';
const SCHOOL_DESCRIPTION = '按学生记录所在学校限定';
const GROUP_HINT = '只能选你自己的组，或学校开放给老师的组。';
const GROUP_PLACEHOLDER = '搜索用户组';
const SCHOOL_PLACEHOLDER = '搜索学校';
const SEEN_DESCRIPTION = '登录即可看到';
const JOIN_DESCRIPTION = '登录即可报名参加';
const CHOOSE_ERROR = '请选择给谁做';
const GROUP_ERROR = '请至少选择一个用户组';
const SCHOOL_ERROR = '请至少选择一所学校';
const LOCKED_REASON = '跟随课程班级';
const ARCHIVED_SUFFIX = '（已归档）';

interface AudienceGroup {
  id: string;
  name: string;
  archived: boolean;
}

interface AudienceSchool {
  id: string;
  name: string;
}

type AudienceMode = 'all' | 'groups' | 'schools';

interface AudienceValue {
  mode: AudienceMode | null;
  groupIds: string[];
  schoolIds: string[];
}

interface AudienceFieldProps {
  name: string;
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
  allowSchools: boolean;
  groups: AudienceGroup[];
  schools: AudienceSchool[];
  allDescription: string;
  error?: string | null;
  lockedReason?: string | null;
}

interface AudienceApi {
  AudienceField: ComponentType<AudienceFieldProps>;
  audienceErrors: (value: AudienceValue) => string | null;
}

const GROUPS: AudienceGroup[] = [
  { id: 'g-soft', name: '软工 2501', archived: false },
  { id: 'g-old', name: '已结课班', archived: true },
];

const SCHOOLS: AudienceSchool[] = [
  { id: 's-cauc', name: '中国民航大学' },
  { id: 's-other', name: '其他学校' },
];

function audienceValue(overrides: Partial<AudienceValue> = {}): AudienceValue {
  return {
    mode: null,
    groupIds: [],
    schoolIds: [],
    ...overrides,
  };
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as Fn;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as ComponentType<Props>;
}

function fieldLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(fieldLoaders)) {
    if (key.endsWith(FIELD_SOURCE)) return load;
  }
  return undefined;
}

async function loadAudience(): Promise<AudienceApi> {
  const load = fieldLoader();
  expect(typeof load, FIELD_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${FIELD_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('audience field module must be an object');
  }
  return {
    AudienceField: asComponent<AudienceFieldProps>(readField(imported, 'AudienceField'), 'AudienceField'),
    audienceErrors: asFunction<AudienceApi['audienceErrors']>(readField(imported, 'audienceErrors'), 'audienceErrors'),
  };
}

function choiceKey(radio: HTMLElement): string {
  const label = radio.closest('label')?.textContent ?? '';
  if (label.includes('指定用户组')) return 'groups';
  if (label.includes('指定学校')) return 'schools';
  if (label.includes('所有人')) return 'all';
  return label;
}

function choiceOrder(): string[] {
  return screen.getAllByRole('radio').map((radio) => choiceKey(radio));
}

function labelText(name: RegExp): string {
  const radio = screen.getByRole('radio', { name });
  return radio.closest('label')?.textContent ?? '';
}

function isAfter(earlier: Node, later: Node): boolean {
  if (earlier.contains(later)) return false;
  const position = earlier.compareDocumentPosition(later);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function hintElement(): HTMLElement {
  const node = screen.getByText(GROUP_HINT);
  const candidates = [node, node.parentElement];
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.classList.contains('text-xs') && candidate.classList.contains('text-fg-subtle')) {
      return candidate;
    }
  }
  expect(node.className).toContain('text-xs');
  if (!(node instanceof HTMLElement)) {
    throw new TypeError('group hint');
  }
  return node;
}

interface ControlledAudienceProps extends Omit<AudienceFieldProps, 'value' | 'onChange'> {
  Field: ComponentType<AudienceFieldProps>;
  initial: AudienceValue;
  onChange: (next: AudienceValue) => void;
}

function ControlledAudience({
  Field,
  initial,
  onChange,
  name,
  allowSchools,
  groups,
  schools,
  allDescription,
  error,
  lockedReason,
}: ControlledAudienceProps) {
  const [value, setValue] = useState(initial);
  return (
    <Field
      name={name}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      allowSchools={allowSchools}
      groups={groups}
      schools={schools}
      allDescription={allDescription}
      error={error}
      lockedReason={lockedReason}
    />
  );
}

function renderField(
  Field: ComponentType<AudienceFieldProps>,
  props: Partial<AudienceFieldProps> = {},
) {
  const onChange = vi.fn<(next: AudienceValue) => void>();
  const view = render(
    <Field
      name={props.name ?? 'naud'}
      value={props.value ?? audienceValue()}
      onChange={onChange}
      allowSchools={props.allowSchools ?? false}
      groups={props.groups ?? GROUPS}
      schools={props.schools ?? SCHOOLS}
      allDescription={props.allDescription ?? SEEN_DESCRIPTION}
      error={props.error}
      lockedReason={props.lockedReason}
    />,
  );
  return { onChange, ...view };
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

function lastAudience(onChange: { mock: { calls: AudienceValue[][] } }): AudienceValue {
  const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
  if (!next) throw new TypeError('onChange was not called');
  return next;
}

function renderControlled(
  Field: ComponentType<AudienceFieldProps>,
  props: Partial<Omit<AudienceFieldProps, 'onChange' | 'value'>> & { initial?: AudienceValue } = {},
) {
  const onChange = vi.fn<(next: AudienceValue) => void>();
  const view = render(
    <ControlledAudience
      Field={Field}
      initial={props.initial ?? audienceValue()}
      onChange={onChange}
      name={props.name ?? 'naud'}
      allowSchools={props.allowSchools ?? true}
      groups={props.groups ?? GROUPS}
      schools={props.schools ?? SCHOOLS}
      allDescription={props.allDescription ?? JOIN_DESCRIPTION}
      error={props.error}
      lockedReason={props.lockedReason}
    />,
  );
  return { onChange, ...view };
}

describe('audience field', () => {
  it('shows only everyone and group choices when schools are not allowed', async () => {
    const { AudienceField } = await loadAudience();
    renderField(AudienceField, {
      allowSchools: false,
      allDescription: SEEN_DESCRIPTION,
      value: audienceValue(),
    });

    expect(choiceOrder()).toEqual(['all', 'groups']);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: /指定学校/ })).not.toBeInTheDocument();
    expect(screen.queryByText(SCHOOL_DESCRIPTION)).not.toBeInTheDocument();
    expect(labelText(/所有人/)).toContain(SEEN_DESCRIPTION);
    expect(labelText(/指定用户组/)).toContain(GROUP_DESCRIPTION);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    const caption = screen.getByText('给谁做', { exact: false }).closest('label');
    expect(caption?.textContent).toContain('给谁做');
    expect(caption?.textContent).toContain('*');
    expect(screen.getByRole('radiogroup').className.split(/\s+/)).toContain('flex-col');
    expect(screen.queryByPlaceholderText(GROUP_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SCHOOL_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(GROUP_HINT)).not.toBeInTheDocument();
  });

  it('selects groups and places the group picker after the radio group', async () => {
    const user = userEvent.setup();
    const { AudienceField } = await loadAudience();
    const { onChange } = renderControlled(AudienceField, {
      allowSchools: true,
      allDescription: JOIN_DESCRIPTION,
      initial: audienceValue(),
    });

    expect(choiceOrder()).toEqual(['all', 'groups', 'schools']);
    expect(labelText(/所有人/)).toContain(JOIN_DESCRIPTION);
    expect(labelText(/指定用户组/)).toContain(GROUP_DESCRIPTION);
    expect(labelText(/指定学校/)).toContain(SCHOOL_DESCRIPTION);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.queryByPlaceholderText(GROUP_PLACEHOLDER)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /指定用户组/ }));

    expect(onChange).toHaveBeenLastCalledWith(audienceValue({ mode: 'groups' }));
    expect(screen.getByRole('radio', { name: /指定用户组/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /所有人/ })).not.toBeChecked();
    const radioGroup = screen.getByRole('radiogroup');
    const groupSearch = screen.getByPlaceholderText(GROUP_PLACEHOLDER);
    const hint = hintElement();
    expect(isAfter(radioGroup, groupSearch)).toBe(true);
    expect(isAfter(groupSearch, hint)).toBe(true);
    expect(hint.classList.contains('text-xs')).toBe(true);
    expect(hint.classList.contains('text-fg-subtle')).toBe(true);

    await user.click(groupSearch);
    expect(screen.getByRole('button', { name: '软工 2501' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `已结课班${ARCHIVED_SUFFIX}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `软工 2501${ARCHIVED_SUFFIX}` })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '软工 2501' }));
    expect(onChange).toHaveBeenLastCalledWith(audienceValue({
      mode: 'groups',
      groupIds: ['g-soft'],
    }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: '软工 2501' })).not.toBeInTheDocument();
    expect(screen.getByText('软工 2501')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /指定学校/ }));
    expect(onChange).toHaveBeenLastCalledWith(audienceValue({
      mode: 'schools',
      groupIds: ['g-soft'],
    }));
    expect(screen.getByRole('radio', { name: /指定学校/ })).toBeChecked();
    const schoolSearch = screen.getByPlaceholderText(SCHOOL_PLACEHOLDER);
    expect(isAfter(screen.getByRole('radiogroup'), schoolSearch)).toBe(true);
    expect(screen.queryByPlaceholderText(GROUP_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText(GROUP_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText('软工 2501')).not.toBeInTheDocument();
  });

  it('keeps the chosen groups when leaving that mode and coming back', async () => {
    const user = userEvent.setup();
    const { AudienceField } = await loadAudience();
    const initial = audienceValue({
      mode: 'groups',
      groupIds: ['g-old'],
      schoolIds: ['s-cauc'],
    });
    const { onChange } = renderControlled(AudienceField, {
      allowSchools: true,
      initial,
    });

    expect(screen.getByRole('radio', { name: /指定用户组/ })).toBeChecked();
    expect(screen.getByText(`已结课班${ARCHIVED_SUFFIX}`)).toBeInTheDocument();
    expect(screen.queryByText('中国民航大学')).not.toBeInTheDocument();
    const chip = screen.getByText(`已结课班${ARCHIVED_SUFFIX}`);
    expect(isAfter(screen.getByRole('radiogroup'), chip)).toBe(true);

    await user.click(screen.getByRole('radio', { name: /所有人/ }));
    expect(onChange).toHaveBeenLastCalledWith(audienceValue({
      mode: 'all',
      groupIds: ['g-old'],
      schoolIds: ['s-cauc'],
    }));
    expect(screen.getByRole('radio', { name: /所有人/ })).toBeChecked();
    expect(screen.queryByText(`已结课班${ARCHIVED_SUFFIX}`)).not.toBeInTheDocument();
    expect(screen.queryByText(GROUP_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText('中国民航大学')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /指定用户组/ }));
    expect(onChange).toHaveBeenLastCalledWith(initial);
    expect(screen.getByText(`已结课班${ARCHIVED_SUFFIX}`)).toBeInTheDocument();
    expect(screen.getByText(GROUP_HINT)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /指定学校/ }));
    expect(onChange).toHaveBeenLastCalledWith(audienceValue({
      mode: 'schools',
      groupIds: ['g-old'],
      schoolIds: ['s-cauc'],
    }));
    expect(screen.getByText('中国民航大学')).toBeInTheDocument();
    expect(isAfter(screen.getByRole('radiogroup'), screen.getByText('中国民航大学'))).toBe(true);
    expect(screen.queryByText(`已结课班${ARCHIVED_SUFFIX}`)).not.toBeInTheDocument();
    expect(screen.queryByText(GROUP_HINT)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /指定用户组/ }));
    expect(onChange).toHaveBeenLastCalledWith(initial);
    expect(screen.getByText(`已结课班${ARCHIVED_SUFFIX}`)).toBeInTheDocument();
    expect(screen.queryByText('中国民航大学')).not.toBeInTheDocument();
  });

  it('keeps a school id that is outside the catalog when another school is chosen', async () => {
    const user = userEvent.setup();
    const { AudienceField } = await loadAudience();
    const { onChange } = renderControlled(AudienceField, {
      allowSchools: true,
      schools: [
        { id: 's-cauc', name: '中国民航大学' },
        { id: 's-other', name: '其他学校' },
      ],
      initial: audienceValue({
        mode: 'schools',
        schoolIds: ['s-deleted', 's-cauc'],
      }),
    });

    expect(screen.getByText('s-deleted')).toBeInTheDocument();
    expect(screen.getByText('中国民航大学')).toBeInTheDocument();

    await user.click(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: '其他学校' }));

    const next = lastAudience(onChange);
    expect(next.mode).toBe('schools');
    expect(sortedIds(next.schoolIds)).toEqual(sortedIds(['s-deleted', 's-cauc', 's-other']));
  });

  it('keeps a group id that is outside the catalog when another group is chosen', async () => {
    const user = userEvent.setup();
    const { AudienceField } = await loadAudience();
    const { onChange } = renderControlled(AudienceField, {
      allowSchools: false,
      initial: audienceValue({
        mode: 'groups',
        groupIds: ['g-missing', 'g-soft'],
      }),
    });

    expect(screen.getByText('g-missing')).toBeInTheDocument();
    expect(screen.getByText('软工 2501')).toBeInTheDocument();

    await user.click(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: `已结课班${ARCHIVED_SUFFIX}` }));

    const next = lastAudience(onChange);
    expect(next.mode).toBe('groups');
    expect(sortedIds(next.groupIds)).toEqual(sortedIds(['g-missing', 'g-soft', 'g-old']));
  });

  it('shows the field error under the choices', async () => {
    const { AudienceField } = await loadAudience();
    renderField(AudienceField, {
      allowSchools: false,
      value: audienceValue({ mode: 'groups' }),
      error: GROUP_ERROR,
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(GROUP_ERROR);
    expect(isAfter(screen.getByRole('radiogroup'), alert)).toBe(true);
    expect(isAfter(screen.getByPlaceholderText(GROUP_PLACEHOLDER), alert)).toBe(true);
    expect(isAfter(screen.getByText(GROUP_HINT), alert)).toBe(true);
  });

  it('disables every choice and shows the lock reason underneath', async () => {
    const { AudienceField } = await loadAudience();
    renderField(AudienceField, {
      allowSchools: true,
      allDescription: JOIN_DESCRIPTION,
      value: audienceValue({ mode: 'groups' }),
      lockedReason: LOCKED_REASON,
    });

    expect(choiceOrder()).toEqual(['all', 'groups', 'schools']);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
    expect(screen.getByPlaceholderText(GROUP_PLACEHOLDER)).toBeDisabled();
    const reason = screen.getByText(LOCKED_REASON);
    expect(isAfter(screen.getByRole('radiogroup'), reason)).toBe(true);
    expect(isAfter(screen.getByPlaceholderText(GROUP_PLACEHOLDER), reason)).toBe(true);
    expect(isAfter(screen.getByText(GROUP_HINT), reason)).toBe(true);
  });

  it('leaves the choices enabled when the lock reason is empty', async () => {
    const { AudienceField } = await loadAudience();
    const props = {
      name: 'naud',
      value: audienceValue(),
      onChange: vi.fn(),
      allowSchools: true,
      groups: GROUPS,
      schools: SCHOOLS,
      allDescription: JOIN_DESCRIPTION,
    };
    const { rerender } = renderField(AudienceField, { ...props, lockedReason: null });

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeEnabled();
    }
    expect(screen.queryByText(LOCKED_REASON)).not.toBeInTheDocument();

    rerender(<AudienceField {...props} lockedReason="" />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeEnabled();
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('audience errors', () => {
  it('asks for a choice, and for a group or school once that mode is selected', async () => {
    const { audienceErrors } = await loadAudience();

    expect(audienceErrors(audienceValue())).toBe(CHOOSE_ERROR);
    expect(audienceErrors(audienceValue({
      groupIds: ['g-soft'],
      schoolIds: ['s-cauc'],
    }))).toBe(CHOOSE_ERROR);
    expect(audienceErrors(audienceValue({ mode: 'groups' }))).toBe(GROUP_ERROR);
    expect(audienceErrors(audienceValue({
      mode: 'groups',
      schoolIds: ['s-cauc'],
    }))).toBe(GROUP_ERROR);
    expect(audienceErrors(audienceValue({ mode: 'schools' }))).toBe(SCHOOL_ERROR);
    expect(audienceErrors(audienceValue({
      mode: 'schools',
      groupIds: ['g-soft'],
    }))).toBe(SCHOOL_ERROR);
    expect(audienceErrors(audienceValue({ mode: 'all' }))).toBeNull();
    expect(audienceErrors(audienceValue({
      mode: 'all',
      groupIds: ['g-soft'],
      schoolIds: ['s-cauc'],
    }))).toBeNull();
    expect(audienceErrors(audienceValue({
      mode: 'groups',
      groupIds: ['g-soft'],
    }))).toBeNull();
    expect(audienceErrors(audienceValue({
      mode: 'schools',
      schoolIds: ['s-cauc'],
    }))).toBeNull();
  });
});
