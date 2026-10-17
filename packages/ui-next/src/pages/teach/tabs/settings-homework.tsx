import type { TeachTab } from '@hydrooj/common';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { useBootstrap } from '@/lib/bootstrap';
import {
  timeWindowErrors,
  TimeWindowField,
  type TimeWindowValue,
} from '@/components/teach/time-window-field';
import {
  DEFAULT_PENALTY_RULES,
  homeworkFormBody,
  type HomeworkFormState,
} from '../legacy-forms';
import { TEACH_TYPE_NOUN, type TeachWorkbenchPayload } from '../model';
import {
  CollaboratorsPanel,
  countChangedKeys,
  DangerPanel,
  SaveBar,
  SharePanel,
  SwitchRow,
  useLegacySnapshot,
  useWorkbenchDirty,
} from '../settings-kit';

const LOADING = '正在读取设置。';
const LOAD_FAILED = '题目集设置没有加载出来。';
const WRONG_KIND = '读到的不是作业设置。';
const SAVE_FAILED = '保存失败。';
const SAVED = '已保存';
const CONTENT_HINT = '学生在详情页看到，支持 Markdown';
const TIME_DESCRIPTION = '开放时间 + 可选的个人限时。';
const LATE_DESCRIPTION = '截止后仍可提交，按超时时长打折计分。';
const LATE_LOCKS_PERSONAL = '已经允许迟交，不能再设个人限时。关掉「允许迟交」后可以设。';
const PERSONAL_LOCKS_LATE = '已经设了个人限时，不能再允许迟交。清空个人限时后可以打开。';
const PENALTY_HINT = '超过截止时间多久，得分乘以多少';
const HOURS_ERROR = '扣分小时必须是大于等于 0 的数字。';
const COEFFICIENT_ERROR = '得分系数必须是大于 0 且不超过 1 的数字。';
const DUPLICATE_HOURS = '扣分档的小时数不能重复。';
const RULES_REQUIRED = '请至少保留一档扣分规则。';
const LATE_MISSING = '请填写迟交截止。';
const LATE_ORDER = '迟交截止必须晚于截止时间。';
const LATE_WHOLE_DAY = '迟交截止按整天四舍五入后没有超过截止，请至少延长 1 天。';
const BOTH_OPEN = '个人限时和允许迟交不能同时打开。';
const DAY_MS = 86_400_000;
const CENTIDAY_MS = DAY_MS / 100;
const LATE_DEFAULT_DAYS = 2;
const DECIMAL = /^(?:\d+|\d*\.\d+)$/;
const HOMEWORK_NOUN = TEACH_TYPE_NOUN.homework;

interface PenaltyTier {
  id: string;
  hours: string;
  coefficient: string;
}

interface SettingsDraft {
  title: string;
  content: string;
  beginDate: string;
  beginTime: string;
  deadlineDate: string;
  deadlineTime: string;
  personalMinutes: string;
  lateOn: boolean;
  lateDate: string;
  lateTime: string;
  penaltyRules: PenaltyTier[];
  maintainer: number[];
}

interface ComparableSettings {
  title: string;
  content: string;
  time: {
    beginDate: string;
    beginTime: string;
    deadlineDate: string;
    deadlineTime: string;
    personalMinutes: string;
  };
  late: {
    on: boolean;
    date: string;
    time: string;
    rules: Array<{ hours: string; coefficient: string }>;
  };
  maintainer: number[];
}

const COMPARE_KEYS = ['title', 'content', 'time', 'late', 'maintainer'] as const satisfies readonly (keyof ComparableSettings)[];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseWall(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3] || !timeMatch?.[1] || !timeMatch[2]) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;
  const value = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const check = new Date(value);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return value;
}

function stamp(utcMs: number): { date: string; time: string } {
  const value = new Date(utcMs);
  return {
    date: `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    time: `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`,
  };
}

function shiftByCentidays(date: string, time: string, centidays: number): { date: string; time: string } | null {
  const value = parseWall(date, time);
  if (value === null || !Number.isSafeInteger(centidays)) return null;
  return stamp(value + centidays * CENTIDAY_MS);
}

function shiftByDays(date: string, time: string, days: number): { date: string; time: string } | null {
  if (!Number.isFinite(days)) return null;
  return shiftByCentidays(date, time, Math.round(days * 100));
}

// 墙钟按 UTC 分量相减，一天恒为 86400000 ms，不跟浏览器时区走。
// 服务端用 moment.add(extensionDays, 'days')，天数会被收成整数；提交前先对齐到这个结果。
function exactDays(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  const start = parseWall(startDate, startTime);
  const end = parseWall(endDate, endTime);
  if (start === null || end === null) return null;
  return (end - start) / DAY_MS;
}

function postedWholeDays(exact: number): number {
  return Math.round(exact);
}

function daysBetween(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  return exactDays(startDate, startTime, endDate, endTime);
}

function alignLateDeadline(draft: SettingsDraft): SettingsDraft {
  if (!draft.lateOn) return draft;
  const exact = exactDays(draft.deadlineDate, draft.deadlineTime, draft.lateDate, draft.lateTime);
  if (exact === null || !(exact > 0)) return draft;
  const posted = postedWholeDays(exact);
  if (posted < 1) return draft;
  const shifted = shiftByDays(draft.deadlineDate, draft.deadlineTime, posted);
  if (!shifted || (shifted.date === draft.lateDate && shifted.time === draft.lateTime)) return draft;
  return { ...draft, lateDate: shifted.date, lateTime: shifted.time };
}

function readDecimal(raw: string): number | null {
  const text = raw.trim();
  if (!DECIMAL.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return value;
}

function readHours(raw: string): number | null {
  const value = readDecimal(raw);
  if (value === null || value < 0) return null;
  return value;
}

function readCoefficient(raw: string): number | null {
  const value = readDecimal(raw);
  if (value === null || value <= 0 || value > 1) return null;
  return value;
}

function tiersFromRules(rules: ReadonlyArray<{ hours: number; coefficient: number }>): PenaltyTier[] {
  return rules.map((rule, index) => ({
    id: `rule-${index}-${rule.hours}`,
    hours: String(rule.hours),
    coefficient: String(rule.coefficient),
  }));
}

function cloneDraft(draft: SettingsDraft): SettingsDraft {
  return {
    ...draft,
    maintainer: [...draft.maintainer],
    penaltyRules: draft.penaltyRules.map((row) => ({ ...row })),
  };
}

function draftFrom(state: HomeworkFormState): SettingsDraft {
  const late = shiftByDays(state.deadlineDate, state.deadlineTime, state.extensionDays);
  return {
    title: state.title,
    content: state.content,
    beginDate: state.beginDate,
    beginTime: state.beginTime,
    deadlineDate: state.deadlineDate,
    deadlineTime: state.deadlineTime,
    personalMinutes: state.personalMinutes === null ? '' : String(state.personalMinutes),
    lateOn: state.extensionDays > 0,
    lateDate: late?.date ?? state.deadlineDate,
    lateTime: late?.time ?? state.deadlineTime,
    penaltyRules: tiersFromRules(state.penaltyRules),
    maintainer: [...state.maintainer],
  };
}

function withLate(draft: SettingsDraft, on: boolean): SettingsDraft {
  if (!on) return { ...draft, lateOn: false };
  const days = daysBetween(draft.deadlineDate, draft.deadlineTime, draft.lateDate, draft.lateTime);
  const opened = days !== null && days > 0 ? null : shiftByDays(draft.deadlineDate, draft.deadlineTime, LATE_DEFAULT_DAYS);
  return {
    ...draft,
    lateOn: true,
    lateDate: opened?.date ?? draft.lateDate,
    lateTime: opened?.time ?? draft.lateTime,
    penaltyRules: draft.penaltyRules.length > 0 ? draft.penaltyRules : tiersFromRules(DEFAULT_PENALTY_RULES),
  };
}

function windowOf(draft: SettingsDraft): TimeWindowValue {
  return {
    beginDate: draft.beginDate,
    beginTime: draft.beginTime,
    endDate: draft.deadlineDate,
    endTime: draft.deadlineTime,
    personalMinutes: draft.personalMinutes,
  };
}

function collectIssues(draft: SettingsDraft): string[] {
  const issues: string[] = [];
  const personalSet = draft.personalMinutes.trim() !== '';
  const windowErrors = timeWindowErrors(draft.lateOn && !personalSet ? { ...windowOf(draft), personalMinutes: '' } : windowOf(draft));
  if (windowErrors.begin) issues.push(windowErrors.begin);
  if (windowErrors.end) issues.push(windowErrors.end);
  if (!draft.lateOn && windowErrors.personal) issues.push(windowErrors.personal);
  if (draft.lateOn && personalSet) issues.push(BOTH_OPEN);
  if (!draft.lateOn) return issues;
  const exact = exactDays(draft.deadlineDate, draft.deadlineTime, draft.lateDate, draft.lateTime);
  const start = parseWall(draft.deadlineDate, draft.deadlineTime);
  const end = parseWall(draft.lateDate, draft.lateTime);
  if (exact === null || start === null || end === null) issues.push(LATE_MISSING);
  else if (!(end > start)) issues.push(LATE_ORDER);
  else if (postedWholeDays(exact) < 1) issues.push(LATE_WHOLE_DAY);
  if (draft.penaltyRules.length === 0) issues.push(RULES_REQUIRED);
  const seen = new Set<number>();
  let hoursBad = false;
  let coefficientBad = false;
  let duplicate = false;
  for (const row of draft.penaltyRules) {
    const hours = readHours(row.hours);
    const coefficient = readCoefficient(row.coefficient);
    if (hours === null) hoursBad = true;
    if (coefficient === null) coefficientBad = true;
    if (hours !== null) {
      if (seen.has(hours)) duplicate = true;
      seen.add(hours);
    }
  }
  if (hoursBad) issues.push(HOURS_ERROR);
  if (coefficientBad) issues.push(COEFFICIENT_ERROR);
  if (duplicate) issues.push(DUPLICATE_HOURS);
  return issues;
}

function applyDraft(state: HomeworkFormState, draft: SettingsDraft): HomeworkFormState {
  const issues = collectIssues(draft);
  if (issues.length > 0) throw new Error(issues[0] ?? SAVE_FAILED);
  const personalText = draft.personalMinutes.trim();
  const exact = draft.lateOn ? exactDays(draft.deadlineDate, draft.deadlineTime, draft.lateDate, draft.lateTime) : 0;
  const posted = exact === null ? null : postedWholeDays(exact);
  if (draft.lateOn && (posted === null || posted < 1)) throw new Error(LATE_WHOLE_DAY);
  return {
    ...state,
    title: draft.title,
    content: draft.content,
    beginDate: draft.beginDate,
    beginTime: draft.beginTime,
    deadlineDate: draft.deadlineDate,
    deadlineTime: draft.deadlineTime,
    extensionDays: draft.lateOn ? posted ?? 0 : 0,
    penaltyRules: draft.lateOn
      ? draft.penaltyRules.map((row) => ({
        hours: Number(row.hours.trim()),
        coefficient: Number(row.coefficient.trim()),
      }))
      : [],
    personalMinutes: draft.lateOn || personalText === '' ? null : Number(personalText),
    maintainer: [...draft.maintainer],
  };
}

function comparable(draft: SettingsDraft): ComparableSettings {
  return {
    title: draft.title,
    content: draft.content,
    time: {
      beginDate: draft.beginDate,
      beginTime: draft.beginTime,
      deadlineDate: draft.deadlineDate,
      deadlineTime: draft.deadlineTime,
      personalMinutes: draft.personalMinutes,
    },
    late: {
      on: draft.lateOn,
      date: draft.lateDate,
      time: draft.lateTime,
      rules: draft.penaltyRules.map((row) => ({ hours: row.hours, coefficient: row.coefficient })),
    },
    maintainer: draft.maintainer,
  };
}

function saveMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return SAVE_FAILED;
}

export function SettingsHomeworkTab({
  payload,
}: {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}): ReactElement {
  const { status, snapshot, error, reload, save } = useLegacySnapshot();
  const { setTabDirty } = useWorkbenchDirty();
  const locale = useBootstrap().locale;
  const titleId = 'homework-settings-title';
  const lateId = 'homework-settings-late';
  const lateDateId = 'homework-settings-late-date';
  const lateTimeId = 'homework-settings-late-time';
  const homework = snapshot?.kind === 'homework' ? snapshot.value : null;
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [base, setBase] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const tierSeq = useRef(0);
  const dirtyCount = draft && base ? countChangedKeys(comparable(base), comparable(draft), COMPARE_KEYS) : 0;
  const navigationGuard = useUnsavedChangesGuard(dirtyCount > 0);
  const wrongKind = status === 'ready' && snapshot !== null && snapshot.kind !== 'homework';

  useEffect(() => {
    if (!homework) return;
    const next = draftFrom(homework.state);
    setBase(next);
    setDraft(cloneDraft(next));
    setIssues([]);
  }, [homework]);

  useEffect(() => {
    setTabDirty('settings', dirtyCount > 0);
  }, [dirtyCount, setTabDirty]);

  useEffect(() => () => setTabDirty('settings', false), [setTabDirty]);

  function commit(recipe: (current: SettingsDraft) => SettingsDraft) {
    setDraft((current) => (current ? recipe(current) : current));
    setIssues([]);
  }

  function discard() {
    if (!base || saving) return;
    setDraft(cloneDraft(base));
    setIssues([]);
  }

  function retry() {
    void reload().catch((caught: unknown) => {
      console.error('teach homework settings reload failed', { id: payload.container.id, error: caught });
    });
  }

  function addTier() {
    tierSeq.current += 1;
    const id = `tier-${tierSeq.current}`;
    commit((current) => ({
      ...current,
      penaltyRules: [...current.penaltyRules, { id, hours: '', coefficient: '' }],
    }));
  }

  function updateTier(id: string, patch: Partial<Pick<PenaltyTier, 'hours' | 'coefficient'>>) {
    commit((current) => ({
      ...current,
      penaltyRules: current.penaltyRules.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  }

  async function onSave() {
    if (!draft || saving) return;
    const found = collectIssues(draft);
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    const current = alignLateDeadline(draft);
    if (current !== draft) setDraft(current);
    setSaving(true);
    setIssues([]);
    try {
      await save((latest) => {
        if (latest.kind !== 'homework') throw new Error(WRONG_KIND);
        return homeworkFormBody(applyDraft(latest.value.state, current));
      });
      toast.success(SAVED);
    } catch (caught) {
      console.error('teach homework settings save failed', { id: payload.container.id, error: caught });
      setIssues([saveMessage(caught)]);
    } finally {
      setSaving(false);
    }
  }

  if (payload.container.type !== 'homework') {
    return <Alert tone="danger">{WRONG_KIND}</Alert>;
  }

  const loadError = wrongKind ? WRONG_KIND : status === 'error' ? (error ?? LOAD_FAILED) : null;
  const personalSet = draft !== null && draft.personalMinutes.trim() !== '';
  const personalLocksLate = draft !== null && personalSet && !draft.lateOn;
  const lateLocksPersonal = draft !== null && draft.lateOn && !personalSet;
  const windowErrors = draft ? timeWindowErrors(lateLocksPersonal ? { ...windowOf(draft), personalMinutes: '' } : windowOf(draft)) : undefined;

  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <Panel title="基本信息">
        {draft ? (
          <div className="flex flex-col gap-5">
            <FormField label="标题" htmlFor={titleId} inline>
              <Input id={titleId} value={draft.title} onChange={(event) => commit((current) => ({ ...current, title: event.target.value }))} />
            </FormField>
            <FormField label="说明" hint={CONTENT_HINT} inline>
              <MarkdownEditor
                name="content"
                value={draft.content}
                preferredLang={locale}
                minHeight={240}
                onChange={(content) => commit((current) => ({ ...current, content }))}
              />
            </FormField>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="danger">{loadError}</Alert>
            <Button type="button" variant="secondary" onClick={retry}>重试</Button>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{LOADING}</p>
        )}
      </Panel>
      {draft ? (
        <Panel title="时间" description={TIME_DESCRIPTION}>
          <div className="flex flex-col gap-5">
            <TimeWindowField
              idPrefix="homework-settings"
              mode="homework"
              endLabel="截止"
              value={windowOf(draft)}
              personalDisabledReason={lateLocksPersonal ? LATE_LOCKS_PERSONAL : null}
              errors={issues.length > 0 ? windowErrors : undefined}
              onChange={(next) => commit((current) => ({
                ...current,
                beginDate: next.beginDate,
                beginTime: next.beginTime,
                deadlineDate: next.endDate,
                deadlineTime: next.endTime,
                personalMinutes: next.personalMinutes,
              }))}
            />
            <div className="divide-y divide-line-subtle border-t border-line-subtle">
              <SwitchRow
                id={lateId}
                label="允许迟交"
                description={LATE_DESCRIPTION}
                checked={draft.lateOn}
                disabled={personalLocksLate}
                disabledReason={PERSONAL_LOCKS_LATE}
                onCheckedChange={(on) => commit((current) => withLate(current, on))}
              />
              <div className="py-3">
                <FormField label="迟交截止" htmlFor={lateDateId} inline>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Input
                      id={lateDateId}
                      type="date"
                      aria-label="迟交截止日期"
                      value={draft.lateDate}
                      disabled={!draft.lateOn}
                      invalid={issues.includes(LATE_MISSING) || issues.includes(LATE_ORDER) || issues.includes(LATE_WHOLE_DAY)}
                      onChange={(event) => commit((current) => ({ ...current, lateDate: event.target.value }))}
                      className="min-w-0 flex-1"
                    />
                    <Input
                      id={lateTimeId}
                      type="time"
                      aria-label="迟交截止时间"
                      value={draft.lateTime}
                      disabled={!draft.lateOn}
                      invalid={issues.includes(LATE_MISSING) || issues.includes(LATE_ORDER) || issues.includes(LATE_WHOLE_DAY)}
                      onChange={(event) => commit((current) => ({ ...current, lateTime: event.target.value }))}
                      className="w-28 shrink-0"
                    />
                  </div>
                </FormField>
              </div>
              <div className="py-3">
                <FormField label="扣分规则" hint={PENALTY_HINT} inline>
                  <div className="flex flex-col gap-2">
                    {draft.penaltyRules.map((row) => (
                      <div key={row.id} className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 text-sm text-fg-muted">超过</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          aria-label="超过的小时数"
                          value={row.hours}
                          disabled={!draft.lateOn}
                          invalid={issues.includes(HOURS_ERROR) && readHours(row.hours) === null}
                          onChange={(event) => updateTier(row.id, { hours: event.target.value })}
                          className="w-20 shrink-0"
                        />
                        <span className="shrink-0 text-sm text-fg-muted">小时 → 得分 ×</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          aria-label="得分系数"
                          value={row.coefficient}
                          disabled={!draft.lateOn}
                          invalid={issues.includes(COEFFICIENT_ERROR) && readCoefficient(row.coefficient) === null}
                          onChange={(event) => updateTier(row.id, { coefficient: event.target.value })}
                          className="w-20 shrink-0"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label="删除这一档"
                          disabled={!draft.lateOn}
                          onClick={() => commit((current) => ({
                            ...current,
                            penaltyRules: current.penaltyRules.filter((item) => item.id !== row.id),
                          }))}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" disabled={!draft.lateOn} onClick={addTier}>
                      <Plus />
                      加一档
                    </Button>
                  </div>
                </FormField>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}
      {draft ? (
        <CollaboratorsPanel
          noun={HOMEWORK_NOUN}
          value={draft.maintainer}
          onChange={(maintainer) => commit((current) => ({ ...current, maintainer: [...maintainer] }))}
        />
      ) : null}
      <SharePanel type="homework" id={payload.container.id} canShare={payload.capabilities.canShare} />
      <DangerPanel
        type="homework"
        id={payload.container.id}
        title={draft?.title || payload.container.title}
        noun={HOMEWORK_NOUN}
        canDelete={payload.capabilities.canDelete}
      />
      {issues.length > 0 ? (
        <Alert tone="danger">
          <div className="flex flex-col gap-1">
            {issues.map((issue) => <p key={issue}>{issue}</p>)}
          </div>
        </Alert>
      ) : null}
      <SaveBar dirtyCount={dirtyCount} saving={saving} onSave={() => { void onSave(); }} onDiscard={discard} />
      {navigationGuard.guardDialog}
    </div>
  );
}
