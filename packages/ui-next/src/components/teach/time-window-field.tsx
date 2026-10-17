import { type ChangeEvent } from 'react';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

export interface TimeWindowValue {
  beginDate: string;
  beginTime: string;
  endDate: string;
  endTime: string;
  personalMinutes: string;
}

export type TimeWindowMode = 'contest' | 'exam' | 'homework';

type TimeWindowErrorKey = 'begin' | 'end' | 'personal';
type TimeWindowErrorMap = Partial<Record<TimeWindowErrorKey, string>>;

const BEGIN_ERROR = '请填写开始时间';
const END_ERROR = '请填写结束时间';
const ORDER_ERROR = '结束时间必须晚于开始时间';
const PERSONAL_ERROR = '个人限时必须是正整数分钟';
const PERSONAL_MIN = 1;
const PERSONAL_MAX = 100000;
const HOUR_MS = 3_600_000;

const OPEN_HINT: Record<TimeWindowMode, string> = {
  contest: '比赛的开始和结束时间。',
  exam: '学生在这段时间里可以开始答题。',
  homework: '学生在这段时间里可以作答。',
};

const PERSONAL_HINT: Record<TimeWindowMode, string> = {
  contest: '每个人从第一次打开题目开始计时（限时赛）。',
  exam: '学生点「开始答题」后计时；开放时间里剩下的时间不够一整轮时不能开考。',
  homework: '设了以后，学生先点「开始作答」才计时，到时自动截止；同时不能再允许迟交。',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return { year, month, day };
}

function parseTimeParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseInstant(date: string, time: string): Date | null {
  const dateParts = parseDateParts(date);
  const timeParts = parseTimeParts(time);
  if (!dateParts || !timeParts) return null;
  return new Date(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute, 0, 0);
}

function localStamp(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

// Decimal only. 90.0 and 1e2 are integers; 0x10 is not a minute the teacher typed.
const PERSONAL_DECIMAL = /^\+?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i;

function personalError(raw: string): string | undefined {
  if (raw === '') return undefined;
  if (!PERSONAL_DECIMAL.test(raw)) return PERSONAL_ERROR;
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < PERSONAL_MIN || minutes > PERSONAL_MAX) return PERSONAL_ERROR;
  return undefined;
}

function joinFieldErrors(begin: string | undefined, end: string | undefined): string | undefined {
  const parts = [begin, end].filter((item): item is string => item !== undefined && item !== '');
  if (parts.length === 0) return undefined;
  return parts.join('；');
}

export function timeWindowHours(value: TimeWindowValue): number | null {
  const begin = parseInstant(value.beginDate, value.beginTime);
  const end = parseInstant(value.endDate, value.endTime);
  if (!begin || !end) return null;
  return (end.getTime() - begin.getTime()) / HOUR_MS;
}

export function timeWindowErrors(value: TimeWindowValue): TimeWindowErrorMap {
  const errors: TimeWindowErrorMap = {};
  const begin = parseInstant(value.beginDate, value.beginTime);
  const end = parseInstant(value.endDate, value.endTime);
  if (!begin) errors.begin = BEGIN_ERROR;
  if (!end) errors.end = END_ERROR;
  else if (begin && end.getTime() <= begin.getTime()) errors.end = ORDER_ERROR;
  const personal = personalError(value.personalMinutes);
  if (personal) errors.personal = personal;
  return errors;
}

export function timeWindowFromIso(beginAt: string, endAt: string, personalMinutes: number | null): TimeWindowValue {
  const begin = new Date(beginAt);
  const end = new Date(endAt);
  if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime())) {
    throw new TypeError('time_window_instant_invalid');
  }
  if (personalMinutes !== null && (typeof personalMinutes !== 'number' || !Number.isFinite(personalMinutes))) {
    throw new TypeError('time_window_personal_invalid');
  }
  const beginStamp = localStamp(begin);
  const endStamp = localStamp(end);
  return {
    beginDate: beginStamp.date,
    beginTime: beginStamp.time,
    endDate: endStamp.date,
    endTime: endStamp.time,
    personalMinutes: personalMinutes === null ? '' : String(personalMinutes),
  };
}

export function TimeWindowField({
  idPrefix,
  mode,
  value,
  onChange,
  personalDisabledReason,
  sourceHint,
  errors,
  endLabel = '结束',
}: {
  idPrefix: string;
  mode: TimeWindowMode;
  value: TimeWindowValue;
  onChange: (next: TimeWindowValue) => void;
  personalDisabledReason?: string | null;
  sourceHint?: string | null;
  errors?: TimeWindowErrorMap;
  endLabel?: string;
}) {
  const personalLocked = Boolean(personalDisabledReason);
  const openError = joinFieldErrors(errors?.begin, errors?.end);

  function update(key: keyof TimeWindowValue) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, [key]: event.target.value });
    };
  }

  return (
    <>
      <FormField label="开放时间" required hint={sourceHint || OPEN_HINT[mode]} error={openError}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-fg-subtle">开始</p>
            {/* ds-allow DS004: 日期占剩余列、时间固定 7rem，间距档写不出这条两列轨道 */}
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <Input
                id={`${idPrefix}-begin-date`}
                type="date"
                aria-label="开始日期"
                value={value.beginDate}
                invalid={Boolean(errors?.begin)}
                onChange={update('beginDate')}
                className="min-w-0"
              />
              <Input
                id={`${idPrefix}-begin-time`}
                type="time"
                aria-label="开始时间"
                value={value.beginTime}
                invalid={Boolean(errors?.begin)}
                onChange={update('beginTime')}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-fg-subtle">{endLabel}</p>
            {/* ds-allow DS004: 日期占剩余列、时间固定 7rem，间距档写不出这条两列轨道 */}
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <Input
                id={`${idPrefix}-end-date`}
                type="date"
                aria-label={`${endLabel}日期`}
                value={value.endDate}
                invalid={Boolean(errors?.end)}
                onChange={update('endDate')}
                className="min-w-0"
              />
              <Input
                id={`${idPrefix}-end-time`}
                type="time"
                aria-label={`${endLabel}时间`}
                value={value.endTime}
                invalid={Boolean(errors?.end)}
                onChange={update('endTime')}
              />
            </div>
          </div>
        </div>
      </FormField>
      <FormField
        label="个人限时"
        optional
        htmlFor={`${idPrefix}-personal`}
        hint={personalLocked ? personalDisabledReason : PERSONAL_HINT[mode]}
        error={errors?.personal}
      >
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-personal`}
            type="number"
            inputMode="numeric"
            className="w-24 shrink-0"
            placeholder="不限"
            value={value.personalMinutes}
            disabled={personalLocked}
            invalid={Boolean(errors?.personal)}
            onChange={update('personalMinutes')}
          />
          <span className="shrink-0 text-sm text-fg-muted">分钟</span>
        </div>
      </FormField>
    </>
  );
}
