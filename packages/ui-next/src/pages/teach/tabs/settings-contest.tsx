import { parseExamAttemptLimit, parseExamPassScore, type TeachTab, type TeachType } from '@hydrooj/common';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { TimeWindowField, timeWindowErrors, timeWindowFromIso, timeWindowHours, type TimeWindowValue } from '@/components/teach/time-window-field';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/display';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { useBootstrap } from '@/lib/bootstrap';
import { contestFormBody, type ContestFormState, type ContestSnapshot } from '../legacy-forms';
import { OI_RULE_LABEL, TEACH_TYPE_NOUN, type TeachWorkbenchPayload } from '../model';
import { paperFromPayload, paperFullScore } from '../paper';
import {
  CollaboratorsPanel,
  DangerPanel,
  SaveBar,
  SharePanel,
  SwitchRow,
  countChangedKeys,
  useLegacySnapshot,
  useWorkbenchDirty,
} from '../settings-kit';

const TIME_DESCRIPTION = '开放时间 + 可选的个人限时。';
const MARKDOWN_HINT = '学生在详情页看到，支持 Markdown';
const LOCK_EMPTY_HINT = '留空 = 不封榜';
const LOCK_BLOCKS_PERSONAL = '已经设了封榜，不能再设个人限时。';
const PERSONAL_BLOCKS_LOCK = '已经设了个人限时，不能封榜。';
const LOCK_CONFLICT = '封榜和个人限时不能同时设置。';
const LOCK_INVALID = '封榜必须是 1 以上的整数分钟';
const VIEW_LABEL = '允许查看题目';
const VIEW_DESCRIPTION = '结束后学生还能打开题面。';
const PRACTICE_LABEL = '允许补题';
const PRACTICE_DESCRIPTION = '结束后继续提交，记作补题，不进正式榜单。';
const PRACTICE_BLOCKED = '先允许查看题目';
const CODE_LABEL = '允许查看他人代码';
const CODE_DESCRIPTION = '结束后能看到其他人的提交代码。';
const BOARD_LABEL = '赛后保持榜单隐藏';
const BOARD_DESCRIPTION = '结束后普通学生也看不到榜单。';
const VERDICT_LABEL = '学生能看到每题对错';
const VERDICT_DESCRIPTION = '关掉后学生只看到总分。';
const PASS_LABEL = '及格线';
const PASS_HINT = '留空 = 不设及格线，也不能补考';
const PASS_INVALID = '及格线必须是 1 以上的整数';
const PASS_OVER_FULL = '及格线不能超过满分';
const ATTEMPT_LABEL = '最多考几次';
const ATTEMPT_HINT = '含第一次。需要先设及格线';
const ATTEMPT_SUFFIX = '次。不及格且次数没用完，学生可以重新抽卷再考。';
const ATTEMPT_INVALID = '最多考几次必须是 1 以上的整数';
const SAVE_FAILED = '保存失败';
const OI_RULES = ['oi', 'ioi', 'strictioi'] as const;

interface SettingsContestTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

type ContestTeachType = 'exam' | 'acm' | 'oi';

interface SettingsDraft {
  title: string;
  content: string;
  rule: string;
  time: TimeWindowValue;
  lockText: string;
  examShowVerdict: boolean | null;
  passText: string;
  attemptText: string;
  allowPostContestView: boolean | null;
  allowPostContestPractice: boolean | null;
  allowPostContestSubmit: boolean | null;
  allowViewCode: boolean;
  keepScoreboardHidden: boolean;
  maintainer: number[];
}

interface FieldErrors {
  lock: string | null;
  pass: string | null;
  attempt: string | null;
}

const DRAFT_KEYS = [
  'title',
  'content',
  'rule',
  'time',
  'lockText',
  'examShowVerdict',
  'passText',
  'attemptText',
  'allowPostContestView',
  'allowPostContestPractice',
  'allowPostContestSubmit',
  'allowViewCode',
  'keepScoreboardHidden',
  'maintainer',
] as const satisfies ReadonlyArray<keyof SettingsDraft>;

const EMPTY_FIELD_ERRORS: FieldErrors = { lock: null, pass: null, attempt: null };

function contestKind(type: TeachType): ContestTeachType | null {
  if (type === 'exam' || type === 'acm' || type === 'oi') return type;
  return null;
}

function ruleFits(type: ContestTeachType, rule: string): boolean {
  if (type === 'exam') return rule === 'exam';
  if (type === 'acm') return rule === 'acm';
  return rule === 'oi' || rule === 'ioi' || rule === 'strictioi' || rule === 'ledo';
}

function showsLock(type: ContestTeachType): boolean {
  return type === 'acm' || type === 'oi';
}

function parseLocal(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  if (parsed.getHours() !== hour || parsed.getMinutes() !== minute) return null;
  return parsed;
}

function personalMinutes(hours: number | null): number | null {
  if (hours === null) return null;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    throw new TypeError('teach_personal_hours_invalid');
  }
  const minutes = Math.round(hours * 60);
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new TypeError('teach_personal_hours_invalid');
  return minutes;
}

function timeFromState(state: ContestFormState): TimeWindowValue {
  const begin = parseLocal(state.beginDate, state.beginTime);
  if (!begin || !Number.isFinite(state.windowHours) || state.windowHours <= 0) {
    throw new TypeError('teach_window_invalid');
  }
  // duration*3600000 can land 1ms before a minute boundary. Round to whole
  // minutes first, the same way the old contest editor builds the end instant.
  const minutes = Math.round(state.windowHours * 60);
  if (minutes < 1) throw new TypeError('teach_window_invalid');
  const end = new Date(begin.getTime());
  end.setMinutes(end.getMinutes() + minutes);
  return timeWindowFromIso(begin.toISOString(), end.toISOString(), personalMinutes(state.personalHours));
}

function comparableSettings(draft: SettingsDraft): SettingsDraft {
  // 缺省补考次数就是 1。输入 1 和空白交给服务端是同一结果，不能算成未保存。
  const attempt = draft.attemptText.trim();
  return attempt === '1' ? { ...draft, attemptText: '' } : draft;
}

function integerText(value: number | null, path: string): string {
  if (value === null) return '';
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(path);
  return String(value);
}

function lockText(minutes: number | null): string {
  if (minutes === null) return '';
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new TypeError('teach_lock_minutes_invalid');
  return String(minutes);
}

function draftFromState(state: ContestFormState): SettingsDraft {
  return {
    title: state.title,
    content: state.content,
    rule: state.rule,
    time: timeFromState(state),
    lockText: lockText(state.lockMinutes),
    examShowVerdict: state.examShowVerdict,
    passText: integerText(state.examPassScore, 'teach_pass_score_invalid'),
    attemptText: integerText(state.examAttemptLimit, 'teach_attempt_limit_invalid'),
    allowPostContestView: state.allowPostContestView,
    allowPostContestPractice: state.allowPostContestPractice,
    allowPostContestSubmit: state.allowPostContestSubmit,
    allowViewCode: state.allowViewCode,
    keepScoreboardHidden: state.keepScoreboardHidden,
    maintainer: state.maintainer.slice(),
  };
}

function oiRuleChoices(rule: string): Array<{ value: string; label: string }> {
  const values: string[] = [...OI_RULES];
  if (rule === 'ledo') values.push('ledo');
  return values.map((value) => {
    const label = OI_RULE_LABEL[value];
    if (!label) throw new TypeError(`teach_oi_rule_invalid:${value}`);
    return { value, label };
  });
}

function textFilled(value: string): boolean {
  return value.trim() !== '';
}

function timeInvalid(value: TimeWindowValue): boolean {
  const errors = timeWindowErrors(value);
  return errors.begin !== undefined || errors.end !== undefined || errors.personal !== undefined;
}

function passFromText(raw: string, fullScore: number | null): { value: number | null; error: string | null } {
  const text = raw.trim();
  if (text === '') return { value: null, error: null };
  try {
    const score = parseExamPassScore(text);
    if (score === null) return { value: null, error: PASS_INVALID };
    if (fullScore !== null && score > fullScore) return { value: null, error: PASS_OVER_FULL };
    return { value: score, error: null };
  } catch (error) {
    if (error instanceof TypeError) return { value: null, error: PASS_INVALID };
    throw error;
  }
}

function attemptFromText(raw: string): { value: number | null; error: string | null } {
  const text = raw.trim();
  if (text === '') return { value: null, error: null };
  try {
    return { value: parseExamAttemptLimit(text), error: null };
  } catch (error) {
    if (error instanceof TypeError) return { value: null, error: ATTEMPT_INVALID };
    throw error;
  }
}

function lockFromText(raw: string): { value: number | null; error: string | null } {
  const text = raw.trim();
  if (text === '') return { value: null, error: null };
  // 0 is not a lock: the server treats a falsy lock as no lockAt.
  if (!/^[1-9]\d*$/.test(text)) return { value: null, error: LOCK_INVALID };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) return { value: null, error: LOCK_INVALID };
  return { value, error: null };
}

function windowHoursFrom(value: TimeWindowValue): number {
  const hours = timeWindowHours(value);
  if (hours === null || !(hours > 0)) throw new TypeError('teach_window_invalid');
  const minutes = Math.round(hours * 60);
  if (minutes < 1) throw new TypeError('teach_window_invalid');
  return minutes / 60;
}

function personalHoursFrom(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const minutes = Number(text);
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new TypeError('teach_personal_minutes_invalid');
  return minutes / 60;
}

function fieldErrorsOf(draft: SettingsDraft, type: ContestTeachType, fullScore: number | null): FieldErrors {
  const errors: FieldErrors = { lock: null, pass: null, attempt: null };
  if (showsLock(type)) {
    const lock = lockFromText(draft.lockText);
    if (lock.error) errors.lock = lock.error;
    else if (lock.value !== null && textFilled(draft.time.personalMinutes)) errors.lock = LOCK_CONFLICT;
  }
  if (type === 'exam') {
    const pass = passFromText(draft.passText, fullScore);
    errors.pass = pass.error;
    // No pass line means no retake. A disabled attempt box must not block save.
    if (pass.error === null && pass.value !== null) errors.attempt = attemptFromText(draft.attemptText).error;
  }
  return errors;
}

function hasFieldErrors(errors: FieldErrors): boolean {
  return errors.lock !== null || errors.pass !== null || errors.attempt !== null;
}

function settingsPatch(
  state: ContestFormState,
  base: SettingsDraft,
  draft: SettingsDraft,
  type: ContestTeachType,
  fullScore: number | null,
): Partial<ContestFormState> {
  const errors = fieldErrorsOf(draft, type, fullScore);
  if (timeInvalid(draft.time) || hasFieldErrors(errors)) throw new TypeError('teach_settings_invalid');
  const timeUnchanged = JSON.stringify(draft.time) === JSON.stringify(base.time);
  // An unedited window keeps the snapshot duration. Recomputing hours from the
  // date inputs can drift and would rewrite a contest the teacher did not change.
  const timePatch: Pick<ContestFormState, 'beginDate' | 'beginTime' | 'windowHours' | 'personalHours'> = timeUnchanged
    ? {
      beginDate: state.beginDate,
      beginTime: state.beginTime,
      windowHours: state.windowHours,
      personalHours: state.personalHours,
    }
    : {
      beginDate: draft.time.beginDate,
      beginTime: draft.time.beginTime,
      windowHours: windowHoursFrom(draft.time),
      personalHours: personalHoursFrom(draft.time.personalMinutes),
    };
  const patch: Partial<ContestFormState> = {
    title: draft.title,
    content: draft.content,
    maintainer: draft.maintainer.slice(),
    ...timePatch,
  };
  if (type === 'oi') patch.rule = draft.rule;
  if (showsLock(type)) {
    const lock = lockFromText(draft.lockText);
    if (lock.error) throw new TypeError('teach_settings_invalid');
    patch.lockMinutes = lock.value;
    patch.allowPostContestView = draft.allowPostContestView;
    patch.allowPostContestPractice = draft.allowPostContestPractice;
    patch.allowPostContestSubmit = draft.allowPostContestSubmit;
    patch.allowViewCode = draft.allowViewCode;
    patch.keepScoreboardHidden = draft.keepScoreboardHidden;
  }
  if (type === 'exam') {
    const pass = passFromText(draft.passText, fullScore);
    const attempt = pass.value === null ? { value: null, error: null } : attemptFromText(draft.attemptText);
    if (pass.error || attempt.error) throw new TypeError('teach_settings_invalid');
    patch.examShowVerdict = draft.examShowVerdict;
    patch.examPassScore = pass.value;
    patch.examAttemptLimit = attempt.value;
    patch.allowPostContestView = draft.allowPostContestView;
  }
  return patch;
}

function FieldAlert({ message }: { message: string | null | undefined }): ReactElement | null {
  if (!message) return null;
  // `role="alert"` does not take its accessible name from contents, so the test and
  // assistive tech need an explicit label that matches the visible sentence.
  return <p role="alert" aria-label={message} className="text-xs text-danger-fg">{message}</p>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return SAVE_FAILED;
}

function fullScoreText(fullScore: number | null): string {
  return fullScore === null ? '满分不确定' : `满分 ${fullScore}`;
}

function SettingsContestForm({
  payload,
  kind,
  snapshot,
}: {
  payload: TeachWorkbenchPayload;
  kind: ContestTeachType;
  snapshot: ContestSnapshot;
}): ReactElement {
  const base = useMemo(() => draftFromState(snapshot.state), [snapshot]);
  const [draft, setDraft] = useState(base);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const locale = useBootstrap().locale;
  const { save } = useLegacySnapshot();
  const { setTabDirty } = useWorkbenchDirty();
  const fullScore = paperFullScore(paperFromPayload(payload.paper, payload.container));
  const dirtyCount = countChangedKeys(comparableSettings(base), comparableSettings(draft), DRAFT_KEYS);
  const { guardDialog } = useUnsavedChangesGuard(dirtyCount > 0);
  const timeErrors = showErrors ? timeWindowErrors(draft.time) : undefined;
  const fieldErrors = showErrors ? fieldErrorsOf(draft, kind, fullScore) : EMPTY_FIELD_ERRORS;
  const lockActive = lockFromText(draft.lockText).value !== null;
  const personalActive = textFilled(draft.time.personalMinutes);
  const lockDisablesPersonal = showsLock(kind) && lockActive && !personalActive;
  const personalDisablesLock = showsLock(kind) && personalActive && !lockActive;
  const viewOn = draft.allowPostContestView !== false;
  const practiceOn = draft.allowPostContestPractice !== false && draft.allowPostContestSubmit !== false;
  const passEntered = textFilled(draft.passText);
  const ruleChoices = kind === 'oi' ? oiRuleChoices(snapshot.state.rule) : [];

  useEffect(() => {
    setTabDirty('settings', dirtyCount > 0);
    return () => setTabDirty('settings', false);
  }, [dirtyCount, setTabDirty]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // FormField's alert role does not take its name from the sentence. Label the
    // node TimeWindowField already rendered so the message is not painted twice.
    for (const node of root.querySelectorAll<HTMLElement>('[role="alert"]')) {
      if (node.hasAttribute('aria-label')) continue;
      const text = node.textContent?.trim() ?? '';
      if (text !== '') node.setAttribute('aria-label', text);
    }
  });

  function update<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateView(on: boolean): void {
    // Closing view only disables the practice switch. The draft flags stay,
    // so reopening view restores the switch and a save does not rewrite them.
    update('allowPostContestView', on);
  }

  function updatePractice(on: boolean): void {
    if (!viewOn) return;
    setDraft((current) => ({
      ...current,
      allowPostContestPractice: on,
      allowPostContestSubmit: on,
    }));
  }

  function discard(): void {
    setDraft(base);
    setShowErrors(false);
    setSaveError(null);
  }

  async function onSave(): Promise<void> {
    const errors = fieldErrorsOf(draft, kind, fullScore);
    if (timeInvalid(draft.time) || hasFieldErrors(errors)) {
      setShowErrors(true);
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setShowErrors(false);
    try {
      const patch = settingsPatch(snapshot.state, base, draft, kind, fullScore);
      await save((latest) => {
        if (latest.kind !== 'contest') throw new TypeError('teach_snapshot_kind_invalid');
        return contestFormBody({ ...latest.value.state, ...patch });
      });
      toast.success('已保存');
    } catch (error) {
      console.error('teach contest settings save failed', { id: payload.container.id, error });
      setSaveError(messageOf(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const lockHint = personalDisablesLock
    ? PERSONAL_BLOCKS_LOCK
    : lockActive && personalActive
      ? LOCK_CONFLICT
      : LOCK_EMPTY_HINT;

  return (
    <div ref={rootRef} className="flex max-w-3xl flex-col gap-6">
      <Panel title="基本信息">
        <div className="flex flex-col gap-5">
          <FormField inline label="标题" htmlFor={`${fieldId}-title`}>
            <Input
              id={`${fieldId}-title`}
              value={draft.title}
              onChange={(event) => update('title', event.target.value)}
            />
          </FormField>
          <FormField inline label="说明" hint={MARKDOWN_HINT}>
            <MarkdownEditor
              value={draft.content}
              onChange={(value) => update('content', value)}
              minHeight={180}
              preferredLang={locale}
            />
          </FormField>
          {kind === 'oi' ? (
            <FormField inline label="赛制">
              <MiniTabs
                aria-label="赛制"
                value={draft.rule}
                items={ruleChoices}
                onValueChange={(next) => {
                  if (!ruleChoices.some((item) => item.value === next)) return;
                  update('rule', next);
                }}
              />
            </FormField>
          ) : null}
        </div>
      </Panel>
      <Panel title="时间" description={TIME_DESCRIPTION}>
        <div className="flex flex-col gap-5">
          <TimeWindowField
            idPrefix={`${fieldId}-window`}
            mode={kind === 'exam' ? 'exam' : 'contest'}
            value={draft.time}
            onChange={(time) => update('time', time)}
            personalDisabledReason={lockDisablesPersonal ? LOCK_BLOCKS_PERSONAL : null}
            errors={timeErrors}
          />
          {showsLock(kind) ? (
            <FormField inline label="封榜" htmlFor={`${fieldId}-lock`} hint={fieldErrors.lock ? undefined : lockHint}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm text-fg-muted">结束前</span>
                <Input
                  id={`${fieldId}-lock`}
                  inputMode="numeric"
                  className="w-24 shrink-0 tabular"
                  value={draft.lockText}
                  disabled={personalDisablesLock}
                  invalid={fieldErrors.lock !== null}
                  onChange={(event) => update('lockText', event.target.value)}
                />
                <span className="shrink-0 text-sm text-fg-muted">分钟</span>
              </div>
              <FieldAlert message={fieldErrors.lock} />
            </FormField>
          ) : null}
        </div>
      </Panel>
      {kind === 'exam' ? (
        <Panel title="成绩与补考">
          <div className="divide-y divide-line-subtle">
            <SwitchRow
              id={`${fieldId}-verdict`}
              label={VERDICT_LABEL}
              description={VERDICT_DESCRIPTION}
              checked={draft.examShowVerdict !== false}
              onCheckedChange={(next) => update('examShowVerdict', next)}
            />
            <FormField
              inline
              className="py-3"
              label={PASS_LABEL}
              htmlFor={`${fieldId}-pass`}
              hint={PASS_HINT}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  id={`${fieldId}-pass`}
                  inputMode="numeric"
                  className="w-24 shrink-0 tabular"
                  value={draft.passText}
                  invalid={fieldErrors.pass !== null}
                  onChange={(event) => update('passText', event.target.value)}
                />
                <span className="min-w-0 text-sm text-fg-muted tabular">分（{fullScoreText(fullScore)}）</span>
              </div>
              <FieldAlert message={fieldErrors.pass} />
            </FormField>
            <FormField
              inline
              className="py-3"
              label={ATTEMPT_LABEL}
              htmlFor={`${fieldId}-attempts`}
              hint={ATTEMPT_HINT}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  id={`${fieldId}-attempts`}
                  inputMode="numeric"
                  className="w-24 shrink-0 tabular"
                  value={draft.attemptText}
                  disabled={!passEntered}
                  invalid={fieldErrors.attempt !== null}
                  onChange={(event) => update('attemptText', event.target.value)}
                />
                <span className="min-w-0 text-sm text-fg-muted">{ATTEMPT_SUFFIX}</span>
              </div>
              <FieldAlert message={fieldErrors.attempt} />
            </FormField>
          </div>
        </Panel>
      ) : null}
      <Panel title={kind === 'exam' ? '结束以后' : '赛后'}>
        <div className="divide-y divide-line-subtle">
          <SwitchRow
            id={`${fieldId}-view`}
            label={VIEW_LABEL}
            description={VIEW_DESCRIPTION}
            checked={viewOn}
            onCheckedChange={updateView}
          />
          {showsLock(kind) ? (
            <>
              <SwitchRow
                id={`${fieldId}-practice`}
                label={PRACTICE_LABEL}
                description={PRACTICE_DESCRIPTION}
                checked={practiceOn}
                disabled={!viewOn}
                disabledReason={PRACTICE_BLOCKED}
                onCheckedChange={updatePractice}
              />
              <SwitchRow
                id={`${fieldId}-code`}
                label={CODE_LABEL}
                description={CODE_DESCRIPTION}
                checked={draft.allowViewCode}
                onCheckedChange={(next) => update('allowViewCode', next)}
              />
              <SwitchRow
                id={`${fieldId}-board`}
                label={BOARD_LABEL}
                description={BOARD_DESCRIPTION}
                checked={draft.keepScoreboardHidden}
                onCheckedChange={(next) => update('keepScoreboardHidden', next)}
              />
            </>
          ) : null}
        </div>
      </Panel>
      <CollaboratorsPanel
        noun={TEACH_TYPE_NOUN[kind]}
        value={draft.maintainer}
        onChange={(next) => update('maintainer', next)}
      />
      <SharePanel type={kind} id={payload.container.id} canShare={payload.capabilities.canShare} />
      <DangerPanel
        type={kind}
        id={payload.container.id}
        title={draft.title}
        noun={TEACH_TYPE_NOUN[kind]}
        canDelete={payload.capabilities.canDelete}
      />
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <SaveBar dirtyCount={dirtyCount} saving={saving} onSave={() => { void onSave(); }} onDiscard={discard} />
      {guardDialog}
    </div>
  );
}

export function SettingsContestTab({ payload }: SettingsContestTabProps): ReactElement {
  const legacy = useLegacySnapshot();
  if (legacy.status === 'loading') return <Skeleton className="h-64 max-w-3xl" />;
  if (legacy.status === 'error' || !legacy.snapshot) {
    return <Alert tone="danger">{legacy.error ?? '题目集设置没有加载出来。'}</Alert>;
  }
  if (legacy.snapshot.kind !== 'contest') {
    console.error('teach contest settings expected a contest snapshot', { kind: legacy.snapshot.kind });
    return <Alert tone="danger">这份题目集不是比赛或考试，不能在这里改设置。</Alert>;
  }
  const kind = contestKind(payload.container.type);
  if (!kind || !ruleFits(kind, legacy.snapshot.value.state.rule)) {
    console.error('teach contest settings type does not match the contest rule', {
      type: payload.container.type,
      rule: legacy.snapshot.value.state.rule,
    });
    return <Alert tone="danger">这份题目集的类型和赛制对不上，不能在这里改设置。</Alert>;
  }
  let base: SettingsDraft;
  try {
    base = draftFromState(legacy.snapshot.value.state);
  } catch (error) {
    console.error('teach contest settings snapshot rejected', { id: payload.container.id, error });
    return <Alert tone="danger">这份比赛的时间或成绩设置读不出来，不能改设置。</Alert>;
  }
  return <SettingsContestForm key={JSON.stringify(base)} payload={payload} kind={kind} snapshot={legacy.snapshot.value} />;
}
