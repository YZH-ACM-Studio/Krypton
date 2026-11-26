import { parseSetSettings, type SetSettings } from '@hydrooj/common';
export const CONTEST_DEFAULTS = {
  allowVirtual: true,
  allowPostContestView: true,
  allowPostContestPractice: true,
  allowPostContestSubmit: true,
  allowViewCode: false,
  allowPrint: false,
};
export type ContestOptions = typeof CONTEST_DEFAULTS;
export const CONTEST_LABELS: Record<keyof ContestOptions, string> = {
  allowVirtual: '允许虚拟参赛',
  allowPostContestView: '结束后允许查看题目',
  allowPostContestPractice: '结束后允许补题',
  allowPostContestSubmit: '结束后允许提交',
  allowViewCode: '允许查看其他参与者代码',
  allowPrint: '允许虚拟打印',
};
export const CONTEST_KEYS = Object.keys(CONTEST_DEFAULTS) as Array<keyof ContestOptions>;
export interface SetBasicInfo {
  title: string;
  content: string;
  beginAt: string | null;
  endAt: string | null;
  maintainer: number[];
  hidden: boolean;
}
export interface SettingsResponse {
  basic?: SetBasicInfo;
  settings: SetSettings;
  revision: number;
  lockAt: string | null;
  contestOptions: ContestOptions;
  langs: string[];
  languageOptions: { value: string; label: string }[];
  groups: { id: string; name: string; attachable: boolean }[];
}
export interface LateTier {
  hours: string;
  coefficient: string;
}

export function parseResponse(raw: unknown): SettingsResponse {
  if (typeof raw !== 'object' || raw === null || !('settings' in raw) || !('revision' in raw)) throw new Error('设置响应缺少内容或版本。');
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error('设置版本无效。');
  if (!('lockAt' in raw) || (raw.lockAt !== null && (typeof raw.lockAt !== 'string' || !Number.isFinite(Date.parse(raw.lockAt))))) { throw new Error('封榜时间无效。'); }
  const contestOptions = { ...CONTEST_DEFAULTS };
  for (const key of CONTEST_KEYS) {
    if (!(key in raw)) continue;
    const value: unknown = Reflect.get(raw, key);
    if (typeof value !== 'boolean') throw new Error(`${CONTEST_LABELS[key]}的设置无效。`);
    contestOptions[key] = value;
  }
  return {
    langs: parseStringList(Reflect.get(raw, 'langs') ?? []),
    languageOptions: parseLanguages(Reflect.get(raw, 'languageOptions') ?? []),
    groups: parseGroups(Reflect.get(raw, 'groups') ?? []),
    ...(Object.hasOwn(raw, 'basic') ? { basic: parseBasicInfo(Reflect.get(raw, 'basic')) } : {}),
    settings: parseSetSettings(raw.settings),
    revision: raw.revision,
    lockAt: raw.lockAt,
    contestOptions,
  };
}

function parseBasicInfo(raw: unknown): SetBasicInfo {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('title' in raw) ||
    !('content' in raw) ||
    !('beginAt' in raw) ||
    !('endAt' in raw) ||
    !('maintainer' in raw) ||
    !('hidden' in raw) ||
    typeof raw.title !== 'string' ||
    typeof raw.content !== 'string' ||
    typeof raw.hidden !== 'boolean' ||
    (raw.beginAt !== null && (typeof raw.beginAt !== 'string' || !Number.isFinite(Date.parse(raw.beginAt)))) ||
    (raw.endAt !== null && (typeof raw.endAt !== 'string' || !Number.isFinite(Date.parse(raw.endAt)))) ||
    !Array.isArray(raw.maintainer) ||
    !raw.maintainer.every((uid): uid is number => typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0)
  ) {
    throw new Error('题目集基本信息无效。');
  }
  return {
    title: raw.title,
    content: raw.content,
    hidden: raw.hidden,
    maintainer: raw.maintainer,
    beginAt: raw.beginAt === null ? null : new Date(raw.beginAt).toISOString(),
    endAt: raw.endAt === null ? null : new Date(raw.endAt).toISOString(),
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('设置选项格式无效。');
  return value;
}
function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('编译器列表无效。');
  return value;
}
function parseLanguages(value: unknown): SettingsResponse['languageOptions'] {
  return records(value).map((row) => {
    if (typeof row.value !== 'string' || typeof row.label !== 'string') throw new Error('编译器选项无效。');
    return { value: row.value, label: row.label };
  });
}
function parseGroups(value: unknown): SettingsResponse['groups'] {
  return records(value).map((row) => {
    if (typeof row._id !== 'string' || (row.name !== null && typeof row.name !== 'string') || typeof row.attachable !== 'boolean') { throw new Error('用户组选项无效。'); }
    return { id: row._id, name: row.name ?? '已删除的组', attachable: row.attachable };
  });
}
export function localDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function tiersOf(settings: SetSettings): LateTier[] {
  return settings.late.enabled
    ? Object.entries(settings.late.rules).map(([hours, coefficient]) => ({ hours, coefficient: String(coefficient) }))
    : [{ hours: '0', coefficient: '0.8' }];
}
export interface SettingsDraft {
  basic?: SetBasicInfo;
  settings: SetSettings;
  tiers: LateTier[];
  lockTime: string;
  contestOptions: ContestOptions;
  langs: string[];
}
export function draftOf(response: SettingsResponse): SettingsDraft {
  return {
    basic: response.basic,
    settings: response.settings,
    tiers: tiersOf(response.settings),
    lockTime: response.lockAt === null ? '' : localDate(new Date(response.lockAt)),
    contestOptions: response.contestOptions,
    langs: response.langs,
  };
}
export function settingsRequest(draft: SettingsDraft, initial: SettingsResponse) {
  let settings = draft.settings;
  if (settings.late.enabled) {
    const rules: Record<string, number> = {};
    if (!draft.tiers.length) throw new Error('请至少填写一档迟交扣分。');
    for (const tier of draft.tiers) {
      const hours = Number(tier.hours);
      const coefficient = Number(tier.coefficient);
      if (
        !tier.hours.trim() ||
        !Number.isFinite(hours) ||
        hours < 0 ||
        !tier.coefficient.trim() ||
        !Number.isFinite(coefficient) ||
        coefficient <= 0 ||
        coefficient > 1
      ) { throw new Error('迟交小时须不小于 0，得分系数须大于 0 且不超过 1。'); }
      if (Object.hasOwn(rules, String(hours))) throw new Error('迟交小时数不能重复。');
      rules[String(hours)] = coefficient;
    }
    settings = { ...settings, late: { ...settings.late, rules } };
  }
  let basic = draft.basic;
  if (basic) {
    if (!/^.{1,64}$/.test(basic.title.trim())) throw new Error('标题须为 1 到 64 个字符。');
    if ((basic.beginAt === null) !== (basic.endAt === null)) throw new Error('请填写完整的开放和结束时间。');
    if (
      basic.beginAt !== null &&
      basic.endAt !== null &&
      (!Number.isFinite(Date.parse(basic.beginAt)) ||
        !Number.isFinite(Date.parse(basic.endAt)) ||
        Date.parse(basic.beginAt) >= Date.parse(basic.endAt))
    ) { throw new Error('结束时间须晚于开放时间。'); }
    basic = {
      ...basic,
      title: basic.title.trim(),
      beginAt: basic.beginAt === null ? null : new Date(basic.beginAt).toISOString(),
      endAt: basic.endAt === null ? null : new Date(basic.endAt).toISOString(),
    };
  }
  const lockAt =
    draft.lockTime === (initial.lockAt === null ? '' : localDate(new Date(initial.lockAt)))
      ? initial.lockAt
      : draft.lockTime === ''
        ? null
        : new Date(draft.lockTime).toISOString();
  return {
    ...(basic ? { basic } : {}),
    settings: parseSetSettings(settings),
    expectedRevision: initial.revision,
    lockAt,
    langs: draft.langs,
    ...draft.contestOptions,
  };
}
