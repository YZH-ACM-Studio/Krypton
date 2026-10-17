import { type ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// A static import fails collection while time-window-field.tsx is absent.
const fieldLoaders = import.meta.glob('../../src/components/teach/time-window-field.tsx');

const FIELD_SOURCE = 'src/components/teach/time-window-field.tsx';

const OPEN_HINT = {
  contest: '比赛的开始和结束时间。',
  exam: '学生在这段时间里可以开始答题。',
  homework: '学生在这段时间里可以作答。',
} as const;

const PERSONAL_HINT = {
  contest: '每个人从第一次打开题目开始计时（限时赛）。',
  exam: '学生点「开始答题」后计时；开放时间里剩下的时间不够一整轮时不能开考。',
  homework: '设了以后，学生先点「开始作答」才计时，到时自动截止；同时不能再允许迟交。',
} as const;

const PERSONAL_ERROR = '个人限时必须是正整数分钟';
const BEGIN_ERROR = '请填写开始时间';
const END_ERROR = '请填写结束时间';
const ORDER_ERROR = '结束时间必须晚于开始时间';
const LATE_REASON = '已经允许迟交，不能再设个人限时。关掉「允许迟交」后可以设。';
const SOURCE_HINT = '原题目集：10-24 14:00 → 16:00。必须重新填。';

interface TimeWindowValue {
  beginDate: string;
  beginTime: string;
  endDate: string;
  endTime: string;
  personalMinutes: string;
}

type TimeWindowMode = 'contest' | 'exam' | 'homework';
type TimeWindowErrorMap = Partial<Record<'begin' | 'end' | 'personal', string>>;

interface TimeWindowFieldProps {
  idPrefix: string;
  mode: TimeWindowMode;
  value: TimeWindowValue;
  onChange: (next: TimeWindowValue) => void;
  personalDisabledReason?: string | null;
  sourceHint?: string | null;
  errors?: TimeWindowErrorMap;
  endLabel?: string;
}

interface TimeWindowApi {
  TimeWindowField: ComponentType<TimeWindowFieldProps>;
  timeWindowHours: (value: TimeWindowValue) => number | null;
  timeWindowErrors: (value: TimeWindowValue) => TimeWindowErrorMap;
  timeWindowFromIso: (beginAt: string, endAt: string, personalMinutes: number | null) => TimeWindowValue;
}

interface InputPlace {
  parent: HTMLElement;
  index: number;
  siblings: string[];
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as Fn;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
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

async function loadTimeWindow(): Promise<TimeWindowApi> {
  const load = fieldLoader();
  expect(typeof load, FIELD_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${FIELD_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('time window module must be an object');
  }
  return {
    TimeWindowField: asComponent<TimeWindowFieldProps>(readField(imported, 'TimeWindowField'), 'TimeWindowField'),
    timeWindowHours: asFunction<TimeWindowApi['timeWindowHours']>(readField(imported, 'timeWindowHours'), 'timeWindowHours'),
    timeWindowErrors: asFunction<TimeWindowApi['timeWindowErrors']>(readField(imported, 'timeWindowErrors'), 'timeWindowErrors'),
    timeWindowFromIso: asFunction<TimeWindowApi['timeWindowFromIso']>(readField(imported, 'timeWindowFromIso'), 'timeWindowFromIso'),
  };
}

function windowValue(overrides: Partial<TimeWindowValue> = {}): TimeWindowValue {
  return {
    beginDate: '2026-10-24',
    beginTime: '14:00',
    endDate: '2026-10-24',
    endTime: '16:00',
    personalMinutes: '',
    ...overrides,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localStamp(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function inputsIn(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll('input')].filter((node): node is HTMLInputElement => node instanceof HTMLInputElement);
}

function personalInput(): HTMLInputElement {
  const found = inputsIn(document.body).filter((node) => node.getAttribute('type') === 'number');
  expect(found).toHaveLength(1);
  const input = found[0];
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError('personal input');
  }
  return input;
}

function inputPlace(input: HTMLInputElement): InputPlace {
  const parent = input.parentElement;
  if (!(parent instanceof HTMLElement)) {
    throw new TypeError('personal input has no parent');
  }
  const children = [...parent.children];
  return {
    parent,
    index: children.indexOf(input),
    siblings: children.map((child) => (child === input ? 'input' : `${child.tagName}:${child.textContent ?? ''}`)),
  };
}

function labelOf(text: string): HTMLLabelElement {
  const label = screen.getByText(text, { exact: false }).closest('label');
  if (!(label instanceof HTMLLabelElement)) {
    throw new TypeError(`label ${text}`);
  }
  return label;
}

function renderField(
  Field: ComponentType<TimeWindowFieldProps>,
  props: Partial<TimeWindowFieldProps> = {},
) {
  const onChange = vi.fn<(next: TimeWindowValue) => void>();
  const view = render(
    <Field
      idPrefix="tw"
      mode={props.mode ?? 'homework'}
      value={props.value ?? windowValue()}
      onChange={onChange}
      personalDisabledReason={props.personalDisabledReason}
      sourceHint={props.sourceHint}
      errors={props.errors}
      endLabel={props.endLabel}
    />,
  );
  return { onChange, ...view };
}

describe('time window field', () => {
  it('renders four date and time inputs and one number input', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    const { container } = renderField(TimeWindowField, { value: windowValue({ personalMinutes: '90' }) });
    const inputs = inputsIn(container);

    expect(inputs).toHaveLength(5);
    expect(inputs.filter((node) => node.getAttribute('type') === 'date')).toHaveLength(2);
    expect(inputs.filter((node) => node.getAttribute('type') === 'time')).toHaveLength(2);
    expect(inputs.filter((node) => node.getAttribute('type') === 'number')).toHaveLength(1);
    expect(screen.getByLabelText('开始日期')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('开始时间')).toHaveAttribute('type', 'time');
    expect(screen.getByLabelText('结束日期')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('结束时间')).toHaveAttribute('type', 'time');
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-10-24');
    expect(screen.getByLabelText('开始时间')).toHaveValue('14:00');
    expect(screen.getByLabelText('结束日期')).toHaveValue('2026-10-24');
    expect(screen.getByLabelText('结束时间')).toHaveValue('16:00');

    const personal = personalInput();
    expect(personal).toHaveValue(90);
    expect(personal).toHaveAttribute('placeholder', '不限');
    expect(personal.getAttribute('inputmode')).toBe('numeric');
    expect(personal.className.split(/\s+/)).toContain('w-24');
    expect(inputPlace(personal).siblings.some((item) => item.includes('分钟'))).toBe(true);
    expect(screen.getByText('开始')).toBeInTheDocument();
    expect(screen.getByText('结束')).toBeInTheDocument();
    expect(labelOf('开放时间').textContent).toContain('*');
    expect(labelOf('个人限时').textContent).toContain('可选');
    expect(screen.getByText(OPEN_HINT.homework)).toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT.homework)).toBeInTheDocument();
  });

  it('keeps the personal limit input in place when its disabled reason is cleared', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    const value = windowValue({ personalMinutes: '45' });
    const { rerender } = renderField(TimeWindowField, {
      value,
      personalDisabledReason: LATE_REASON,
    });
    const before = inputPlace(personalInput());

    expect(personalInput()).toBeDisabled();
    expect(screen.getByText(LATE_REASON)).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_HINT.homework)).not.toBeInTheDocument();

    rerender(
      <TimeWindowField
        idPrefix="tw"
        mode="homework"
        value={value}
        onChange={vi.fn()}
        personalDisabledReason={null}
      />,
    );

    const after = inputPlace(personalInput());
    expect(personalInput()).toBeEnabled();
    expect(screen.queryByText(LATE_REASON)).not.toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT.homework)).toBeInTheDocument();
    expect(after.parent).toBe(before.parent);
    expect(after.index).toBe(before.index);
    expect(after.siblings).toEqual(before.siblings);
  });

  it('keeps the personal limit editable when the disabled reason is empty', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    renderField(TimeWindowField, { personalDisabledReason: '' });

    expect(personalInput()).toBeEnabled();
    expect(screen.getByText(PERSONAL_HINT.homework)).toBeInTheDocument();
  });

  it('replaces the open-window hint when sourceHint is set', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    const value = windowValue();
    const { rerender } = renderField(TimeWindowField, { mode: 'contest', value });

    expect(screen.getByText(OPEN_HINT.contest)).toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT.contest)).toBeInTheDocument();

    rerender(
      <TimeWindowField
        idPrefix="tw"
        mode="exam"
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(OPEN_HINT.exam)).toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT.exam)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_HINT.contest)).not.toBeInTheDocument();

    rerender(
      <TimeWindowField
        idPrefix="tw"
        mode="homework"
        value={value}
        onChange={vi.fn()}
        sourceHint={SOURCE_HINT}
      />,
    );
    expect(screen.getByText(SOURCE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_HINT.homework)).not.toBeInTheDocument();
    expect(screen.queryByText(OPEN_HINT.exam)).not.toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT.homework)).toBeInTheDocument();
  });

  it('uses 截止 as the end caption when endLabel says so', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    renderField(TimeWindowField, { endLabel: '截止' });

    expect(screen.getByText('开始')).toBeInTheDocument();
    expect(screen.getByText('截止')).toBeInTheDocument();
    expect(screen.queryByText('结束')).not.toBeInTheDocument();
    expect(screen.getByLabelText('截止日期')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('截止时间')).toHaveAttribute('type', 'time');
  });

  it('merges begin and end errors with a Chinese semicolon', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    const value = windowValue();
    const { rerender } = renderField(TimeWindowField, {
      value,
      errors: { begin: BEGIN_ERROR, end: END_ERROR },
    });

    expect(screen.getByRole('alert').textContent).toBe(`${BEGIN_ERROR}；${END_ERROR}`);

    rerender(
      <TimeWindowField
        idPrefix="tw"
        mode="homework"
        value={value}
        onChange={vi.fn()}
        errors={{ begin: BEGIN_ERROR }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(BEGIN_ERROR);

    rerender(
      <TimeWindowField
        idPrefix="tw"
        mode="homework"
        value={value}
        onChange={vi.fn()}
        errors={{ personal: PERSONAL_ERROR }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(PERSONAL_ERROR);
    expect(screen.queryByText(BEGIN_ERROR)).not.toBeInTheDocument();
  });

  it('passes input strings through onChange without correcting them', async () => {
    const { TimeWindowField } = await loadTimeWindow();
    const { onChange } = renderField(TimeWindowField);

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-11-02' } });
    expect(onChange).toHaveBeenLastCalledWith(windowValue({ beginDate: '2026-11-02' }));

    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '09:05' } });
    expect(onChange).toHaveBeenLastCalledWith(windowValue({ beginTime: '09:05' }));

    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-11-03' } });
    expect(onChange).toHaveBeenLastCalledWith(windowValue({ endDate: '2026-11-03' }));

    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '23:59' } });
    expect(onChange).toHaveBeenLastCalledWith(windowValue({ endTime: '23:59' }));

    fireEvent.change(personalInput(), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenLastCalledWith(windowValue({ personalMinutes: '1.5' }));
  });
});

describe('time window errors', () => {
  it('rejects an end that is not later than the start and a fractional personal limit', async () => {
    const { timeWindowErrors } = await loadTimeWindow();

    expect(timeWindowErrors(windowValue({ endTime: '13:00' }))).toEqual({ end: ORDER_ERROR });
    expect(timeWindowErrors(windowValue({ personalMinutes: '1.5' }))).toEqual({ personal: PERSONAL_ERROR });
  });

  it('asks for a missing begin or end and treats an equal window as not later', async () => {
    const { timeWindowErrors } = await loadTimeWindow();

    expect(timeWindowErrors(windowValue({
      beginDate: '',
      beginTime: '',
      endDate: '',
      endTime: '',
    }))).toEqual({ begin: BEGIN_ERROR, end: END_ERROR });
    expect(timeWindowErrors(windowValue({ beginDate: '', beginTime: '' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ beginTime: '' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ beginDate: '' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ endDate: '', endTime: '' }))).toEqual({ end: END_ERROR });
    expect(timeWindowErrors(windowValue({ endTime: '' }))).toEqual({ end: END_ERROR });
    expect(timeWindowErrors(windowValue({ endTime: '14:00' }))).toEqual({ end: ORDER_ERROR });
    expect(timeWindowErrors(windowValue({ endDate: '2026-10-23', endTime: '23:59' }))).toEqual({ end: ORDER_ERROR });
    expect(timeWindowErrors(windowValue({ endTime: '14:01' }))).toEqual({});
  });

  it('accepts only whole personal minutes from 1 through 100000', async () => {
    const { timeWindowErrors } = await loadTimeWindow();

    expect(timeWindowErrors(windowValue())).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '1' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '100000' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '90' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '90.0' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '100000.0' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '1e2' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ personalMinutes: '1.5' }))).toEqual({ personal: PERSONAL_ERROR });
    expect(timeWindowErrors(windowValue({ personalMinutes: '0' }))).toEqual({ personal: PERSONAL_ERROR });
    expect(timeWindowErrors(windowValue({ personalMinutes: '100001' }))).toEqual({ personal: PERSONAL_ERROR });
    expect(timeWindowErrors(windowValue({ personalMinutes: 'abc' }))).toEqual({ personal: PERSONAL_ERROR });
    expect(timeWindowErrors(windowValue({ personalMinutes: '   ' }))).toEqual({ personal: PERSONAL_ERROR });
    expect(timeWindowErrors(windowValue({
      beginDate: '',
      beginTime: '',
      personalMinutes: '1.5',
    }))).toEqual({ begin: BEGIN_ERROR, personal: PERSONAL_ERROR });
  });

  it('treats an impossible date or clock as unfilled', async () => {
    const { timeWindowErrors } = await loadTimeWindow();

    expect(timeWindowErrors(windowValue({ beginDate: '2026-02-31' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ beginDate: '2026-02-29' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ endDate: '2026-04-31' }))).toEqual({ end: END_ERROR });
    expect(timeWindowErrors(windowValue({ beginDate: '2024-02-29' }))).toEqual({});
    expect(timeWindowErrors(windowValue({ beginTime: '14:60' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({ endTime: '16:60' }))).toEqual({ end: END_ERROR });
    expect(timeWindowErrors(windowValue({ beginTime: '24:00' }))).toEqual({ begin: BEGIN_ERROR });
    expect(timeWindowErrors(windowValue({
      beginTime: '23:59',
      endDate: '2026-10-25',
      endTime: '00:00',
    }))).toEqual({});
  });
});

describe('time window hours', () => {
  it('returns 2 hours for 10-24 14:00 to 10-24 16:00', async () => {
    const { timeWindowHours } = await loadTimeWindow();

    expect(timeWindowHours(windowValue())).toBe(2);
    expect(timeWindowHours(windowValue({ endTime: '15:30' }))).toBe(1.5);
    expect(timeWindowHours(windowValue({
      beginDate: '2026-06-15',
      beginTime: '22:00',
      endDate: '2026-06-16',
      endTime: '00:00',
    }))).toBe(2);
  });

  it('returns null when a date or time cannot be parsed', async () => {
    const { timeWindowHours } = await loadTimeWindow();

    expect(timeWindowHours(windowValue({
      beginDate: '',
      beginTime: '',
      endDate: '',
      endTime: '',
    }))).toBeNull();
    expect(timeWindowHours(windowValue({ beginTime: '' }))).toBeNull();
    expect(timeWindowHours(windowValue({ beginDate: 'not-a-date' }))).toBeNull();
    expect(timeWindowHours(windowValue({ endTime: '' }))).toBeNull();
    expect(timeWindowHours(windowValue({ endDate: 'not-a-date' }))).toBeNull();
    expect(timeWindowHours(windowValue({ endDate: '', endTime: '' }))).toBeNull();
    expect(timeWindowHours(windowValue({ beginDate: '2026-02-31' }))).toBeNull();
    expect(timeWindowHours(windowValue({ endDate: '2026-04-31' }))).toBeNull();
    expect(timeWindowHours(windowValue({ beginTime: '14:60' }))).toBeNull();
    expect(timeWindowHours(windowValue({ endTime: '16:60' }))).toBeNull();
  });

  it('returns the signed difference when the end is not later than the start', async () => {
    const { timeWindowHours } = await loadTimeWindow();

    expect(timeWindowHours(windowValue({ endTime: '13:00' }))).toBe(-1);
    expect(timeWindowHours(windowValue({ endTime: '14:00' }))).toBe(0);
  });
});

describe('time window from iso', () => {
  it('splits instants into local date and time fields', async () => {
    const { timeWindowFromIso } = await loadTimeWindow();
    const begin = new Date(2026, 5, 15, 14, 5, 0, 0);
    const end = new Date(2026, 5, 16, 9, 0, 0, 0);
    const beginStamp = localStamp(begin);
    const endStamp = localStamp(end);

    expect(timeWindowFromIso(begin.toISOString(), end.toISOString(), null)).toEqual({
      beginDate: beginStamp.date,
      beginTime: beginStamp.time,
      endDate: endStamp.date,
      endTime: endStamp.time,
      personalMinutes: '',
    });
    expect(timeWindowFromIso(begin.toISOString(), end.toISOString(), 90).personalMinutes).toBe('90');
    expect(timeWindowFromIso(begin.toISOString(), end.toISOString(), 0).personalMinutes).toBe('0');
  });
});
