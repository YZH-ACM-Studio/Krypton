import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ptaKindName,
  PTA_KIND_ORDER,
  SET_CODE_POLICIES,
  SET_FEEDBACK_WHENS,
  SET_SCOREBOARDS,
  SET_ROUND_PICKS,
  SET_OBJECTIVE_REVEALS,
  SET_CODE_REVEALS,
  SET_AFTER_DEADLINE,
  SET_PROGRAM_FILL_CHANNELS,
  SET_CONFIG_TEXT,
  SET_EXPERIENCE_DEFAULTS,
  type SetSettings,
  type SetExperience,
} from '@hydrooj/common';
import { getJson, postJson } from '@/pages/teach/api';
import { confirmDialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { SimpleSelect } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { CollaboratorsPanel, DangerPanel, SharePanel, useWorkbenchDirty } from '../settings-kit';
import type { TeachWorkbenchPayload } from '../model';
import { SetGroupPermissions } from './set-group-permissions';
import {
  CONTEST_KEYS,
  CONTEST_LABELS,
  draftOf,
  localDate,
  parseResponse,
  settingsRequest,
  type SettingsDraft,
  type SettingsResponse,
} from './set-settings-model';

const WHEN_LABELS = { immediate: '保存或评测后立即', after_round: '本轮结束后', after_deadline: '统一截止后', after_release: '老师发布后' };
const CODE_LABELS = { highest: '最高分', last: '最后一次', subtask_best: '子任务最高', retry_decay: '重试衰减', acm: 'ACM' };
const BOARD_LABELS = { off: '关闭', live: '实时', during_only: '仅进行中', after_end: '结束后' };
const CATEGORIES = [
  { value: 'basic', label: '基本信息' },
  { value: 'answer', label: '作答与时间' },
  { value: 'feedback', label: '成绩与反馈' },
  { value: 'access', label: '用户组权限' },
  { value: 'advanced', label: '高级规则' },
  { value: 'manage', label: '协作与管理' },
] as const;
type Category = (typeof CATEGORIES)[number]['value'];
const GRID = 'grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3';

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return '保存失败。';
  return SET_CONFIG_TEXT[error.message]?.zh ?? error.message;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium text-fg">
      {label}
      {children}
    </label>
  );
}
function Check({
  label,
  note,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-start gap-3 text-sm text-fg">
      <Switch className="mt-0.5" aria-label={label} checked={value} disabled={disabled} onCheckedChange={onChange} />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {note ? <span className="mt-1 block text-xs font-normal text-fg-muted">{note}</span> : null}
      </span>
    </label>
  );
}
function Choice<T extends string>({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <SimpleSelect
        ariaLabel={label}
        value={value}
        options={values.map((choice) => ({ value: choice, label: labels[choice] }))}
        onValueChange={(next) => {
          const choice = values.find((candidate) => candidate === next);
          if (choice === undefined) throw new TypeError('未知设置选项。');
          onChange(choice);
        }}
      />
    </Field>
  );
}
function NumberField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number | null;
  min?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        aria-label={label}
        min={min}
        value={value === null || Number.isNaN(value) ? '' : value}
        onChange={(event) => onChange(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))}
      />
    </Field>
  );
}
export function SetSettingsTab({ payload, onSaved }: { payload: TeachWorkbenchPayload; onSaved?: (result: SettingsResponse) => void }) {
  const { setTabDirty } = useWorkbenchDirty();
  const onDirtyChange = useCallback((dirty: boolean) => setTabDirty('settings', dirty), [setTabDirty]);
  return (
    <SetAdvancedSettings
      type={payload.container.type}
      id={payload.container.id}
      workbench={payload}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />
  );
}

export function SetAdvancedSettings({
  type,
  id,
  onDirtyChange,
  workbench,
  onSaved,
}: {
  type: string;
  id: string;
  workbench?: TeachWorkbenchPayload;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (result: SettingsResponse) => void;
}) {
  const locale = useBootstrap().user.viewLang;
  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [category, setCategory] = useState<Category>('basic');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const activeRequest = useRef(false);
  const mounted = useRef(true);
  const loadedRef = useRef(loaded);
  const draftRef = useRef(draft);
  loadedRef.current = loaded;
  draftRef.current = draft;
  const fingerprint = JSON.stringify(draft);
  const dirty = loaded !== null && draft !== null && fingerprint !== JSON.stringify(draftOf(loaded));
  const { guardDialog } = useUnsavedChangesGuard(dirty || saving);
  useEffect(() => {
    onDirtyChange?.(dirty || saving);
    return () => onDirtyChange?.(false);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setDraft(null);
    setError(null);
    getJson(`/teach/${type}/${id}/set-settings`, '无法读取题目集设置。')
      .then((raw) => {
        const result = parseResponse(raw);
        if (cancelled) return;
        setLoaded(result);
        setDraft(draftOf(result));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, loadAttempt]);

  async function save(releaseGrades = false) {
    const initial = loadedRef.current;
    const snapshot = draftRef.current;
    if (!initial || !snapshot || activeRequest.current) return;
    const sent = JSON.stringify(snapshot);
    activeRequest.current = true;
    setSaving(true);
    setError(null);
    try {
      const candidate = releaseGrades
        ? { ...snapshot, settings: { ...snapshot.settings, feedback: { ...snapshot.settings.feedback, gradesReleased: true } } }
        : snapshot;
      const response = parseResponse(await postJson(`/teach/${type}/${id}/set-settings`, settingsRequest(candidate, initial), '保存失败'));
      if (!mounted.current) return;
      const result = { ...response, languageOptions: initial.languageOptions, groups: initial.groups };
      loadedRef.current = result;
      setLoaded(result);
      // A response confirms only its own snapshot. Edits made in flight are saved next.
      if (JSON.stringify(draftRef.current) === sent) {
        draftRef.current = draftOf(result);
        setDraft(draftRef.current);
      } else if (releaseGrades && draftRef.current) {
        const pending = draftRef.current;
        draftRef.current = {
          ...pending,
          settings: { ...pending.settings, feedback: { ...pending.settings.feedback, gradesReleased: result.settings.feedback.gradesReleased } },
        };
        setDraft(draftRef.current);
      }
      onSaved?.(result);
    } catch (caught: unknown) {
      console.error('Problem set settings save failed', { type, id, revision: initial.revision, cause: caught });
      if (mounted.current) setError(errorText(caught));
    } finally {
      activeRequest.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = window.setTimeout(() => {
      void saveRef.current();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, fingerprint, saving, error]);

  if (!loaded || !draft) {
 return (
      <div className="flex flex-col items-start gap-3">
        {error ? (
          <>
            <Alert tone="danger">{error}</Alert>
            <Button variant="secondary" onClick={() => setLoadAttempt((value) => value + 1)}>
              重新读取
            </Button>
          </>
        ) : (
          <p className="text-sm text-fg-muted">正在读取设置…</p>
        )}
      </div>
    );
}
  const current = draft.settings;
  const basic = draft.basic;
  const feedback = current.feedback;
  const retake = current.retake;
  const experience = current.experience ?? SET_EXPERIENCE_DEFAULTS;
  function update(next: SettingsDraft) {
    setDraft(next);
    setError(null);
  }
  function patch(next: SetSettings) {
    update({ ...draft!, settings: next });
  }
  function patchExperience(next: Partial<SetExperience>) {
    patch({ ...current, experience: { ...experience, ...next } });
  }
  function patchRetake(next: Partial<SetSettings['retake']>) {
    patch({ ...current, retake: { ...retake, ...next } });
  }
  function patchFeedback(next: Partial<SetSettings['feedback']>) {
    patch({ ...current, feedback: { ...feedback, ...next } });
  }
  const needsRelease = !feedback.gradesReleased && (feedback.objective.when === 'after_release' || feedback.code.when === 'after_release');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <MiniTabs<Category>
          aria-label="设置分类"
          size="md"
          value={category}
          onValueChange={setCategory}
          items={CATEGORIES.map((item) => ({ ...item }))}
        />
        <p role="status" className="text-xs text-fg-muted">
          {saving ? '正在保存…' : error ? '保存未完成' : dirty ? '等待自动保存…' : '所有更改已保存'}
        </p>
      </div>
      {error ? (
        <Alert
          tone="danger"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => {
                  void save();
                }}
              >
                重试保存
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={async () => {
                  if (
                    await confirmDialog('重新读取会放弃当前未保存的修改。', { title: '读取最新设置？', confirmLabel: '重新读取', destructive: true })
                  ) { setLoadAttempt((value) => value + 1); }
                }}
              >
                重新读取
              </Button>
            </div>
          }
        >
          {error} 修改仍保留在当前页面。
        </Alert>
      ) : null}
      {needsRelease && category !== 'feedback' ? <p className="text-sm text-warning-fg">成绩尚未发布，可在「成绩与反馈」中发布。</p> : null}
      {category === 'basic' ? (
        <>
          {basic ? (
            <Panel title="基本信息">
              <div className="grid min-w-0 gap-5 md:grid-cols-2">
                <Field label="题目集名称">
                  <Input
                    aria-label="题目集名称"
                    value={basic.title}
                    maxLength={64}
                    onChange={(event) => update({ ...draft, basic: { ...basic, title: event.currentTarget.value } })}
                  />
                </Field>
                <Check
                  label="不在学生列表中显示"
                  note="直接打开链接仍可进入。"
                  value={basic.hidden}
                  onChange={(hidden) => update({ ...draft, basic: { ...basic, hidden } })}
                />
              </div>
            </Panel>
          ) : null}
          {basic ? (
            <Panel title="考前说明" description="学生开始作答前可见，支持 Markdown。">
              <MarkdownEditor
                value={basic.content}
                preferredLang={locale}
                minHeight={220}
                onChange={(content) => update({ ...draft, basic: { ...basic, content } })}
              />
            </Panel>
          ) : null}
          <Panel title="作答公告" description="学生开始作答后可见。">
            <MarkdownEditor
              value={experience.announcement}
              preferredLang={locale}
              minHeight={180}
              onChange={(announcement) => patchExperience({ announcement })}
            />
          </Panel>
          <Panel title="交流">
            <Check
              label="开放讨论区"
              note="关闭后学生不能查看或发表本题目集的讨论。"
              value={experience.discussion}
              onChange={(discussion) => patchExperience({ discussion })}
            />
          </Panel>
        </>
      ) : null}
      {category === 'answer' ? (
        <>
          <Panel title="时间窗口">
            <div className={GRID}>
              {basic ? (
                <>
                  <Field label="开放时间">
                    <Input
                      aria-label="开放时间"
                      type="datetime-local"
                      value={basic.beginAt === null ? '' : localDate(new Date(basic.beginAt))}
                      onChange={(event) => update({ ...draft, basic: { ...basic, beginAt: event.currentTarget.value || null } })}
                    />
                  </Field>
                  <Field label="结束时间">
                    <Input
                      aria-label="结束时间"
                      type="datetime-local"
                      value={basic.endAt === null ? '' : localDate(new Date(basic.endAt))}
                      onChange={(event) => update({ ...draft, basic: { ...basic, endAt: event.currentTarget.value || null } })}
                    />
                  </Field>
                </>
              ) : null}
              <NumberField
                label="个人限时（分钟，留空不限时）"
                value={current.personalLimit.hours === null ? null : current.personalLimit.hours * 60}
                min={1}
                onChange={(minutes) =>
                  patch({
                    ...current,
                    personalLimit: {
                      hours: minutes === null ? null : minutes / 60,
                      requireFullWindow: minutes === null ? false : current.personalLimit.requireFullWindow,
                    },
                  })
                }
              />
              <Check
                label="开始时须有完整个人限时"
                value={current.personalLimit.requireFullWindow}
                disabled={current.personalLimit.hours === null}
                onChange={(requireFullWindow) => patch({ ...current, personalLimit: { ...current.personalLimit, requireFullWindow } })}
              />
            </div>
          </Panel>
          <Panel title="作答方式">
            <div className={GRID}>
              <Check label="允许提前交卷" value={current.earlyHandIn} onChange={(earlyHandIn) => patch({ ...current, earlyHandIn })} />
              <Check label="允许使用自测" value={experience.allowSelfTest} onChange={(allowSelfTest) => patchExperience({ allowSelfTest })} />
              <Check
                label="限制代码粘贴"
                note="编辑器拦截粘贴、拖入和文件导入。"
                value={experience.prohibitCodePaste}
                onChange={(prohibitCodePaste) => patchExperience({ prohibitCodePaste })}
              />
            </div>
            <div className="mt-5">
              <Field label="允许使用的编译器">
                <MultiSelect<string>
                  placeholder="不限制编译器"
                  options={loaded.languageOptions.map((item) => item.value)}
                  value={draft.langs}
                  getKey={(value) => value}
                  getLabel={(value) => loaded.languageOptions.find((item) => item.value === value)?.label ?? value}
                  onChange={(langs) => update({ ...draft, langs })}
                />
              </Field>
              <p className="mt-2 text-xs text-fg-muted">留空表示不限制；具体题目仍使用自身支持的编译器。</p>
            </div>
          </Panel>
          <Panel title="迟交">
            <div className="flex flex-col gap-5">
              <Check
                label="允许迟交"
                value={current.late.enabled}
                onChange={(enabled) =>
                  patch({
                    ...current,
                    late: enabled ? { enabled: true, onTimeAt: new Date(basic?.beginAt ?? Date.now()), rules: { 0: 0.8 } } : { enabled: false },
                  })
                }
              />
              {current.late.enabled ? (
                <>
                  <Field label="按时提交截止">
                    <Input
                      aria-label="按时提交截止"
                      type="datetime-local"
                      value={localDate(current.late.onTimeAt)}
                      onChange={(event) => {
                        if (current.late.enabled) patch({ ...current, late: { ...current.late, onTimeAt: new Date(event.currentTarget.value) } });
                      }}
                    />
                  </Field>
                  <p className="text-xs text-fg-muted">统一结束时间仍是最终截止，迟交只延续当前轮。</p>
                  {draft.tiers.map((tier, index) => (
                    <div key={index} className="grid items-end gap-3 sm:grid-cols-3">
                      <Field label="超过小时数">
                        <Input
                          aria-label={`第 ${index + 1} 档超过小时数`}
                          type="number"
                          min={0}
                          value={tier.hours}
                          onChange={(event) =>
                            update({
                              ...draft,
                              tiers: draft.tiers.map((row, offset) => (offset === index ? { ...row, hours: event.currentTarget.value } : row)),
                            })
                          }
                        />
                      </Field>
                      <Field label="得分系数">
                        <Input
                          aria-label={`第 ${index + 1} 档得分系数`}
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={tier.coefficient}
                          onChange={(event) =>
                            update({
                              ...draft,
                              tiers: draft.tiers.map((row, offset) => (offset === index ? { ...row, coefficient: event.currentTarget.value } : row)),
                            })
                          }
                        />
                      </Field>
                      <Button variant="ghost" onClick={() => update({ ...draft, tiers: draft.tiers.filter((_, offset) => offset !== index) })}>
                        删除第 {index + 1} 档
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button variant="secondary" onClick={() => update({ ...draft, tiers: [...draft.tiers, { hours: '', coefficient: '0.5' }] })}>
                      增加扣分档
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
        </>
      ) : null}
      {category === 'feedback' ? (
        <>
          {needsRelease ? (
            <Alert
              tone="warning"
              action={
                <Button
                  variant="secondary"
                  disabled={dirty || saving}
                  onClick={() => {
                    void save(true);
                  }}
                >
                  发布成绩
                </Button>
              }
            >
              成绩尚未发布。发布后学生按下面的反馈规则查看。
            </Alert>
          ) : null}
          <Panel title="成绩计算">
            <div className={GRID}>
              <Choice
                label="代码题计分"
                value={current.codePolicy}
                values={SET_CODE_POLICIES}
                labels={CODE_LABELS}
                onChange={(codePolicy) => patch({ ...current, codePolicy })}
              />
              <Choice
                label="跨轮取分"
                value={retake.pick}
                values={SET_ROUND_PICKS}
                labels={{ highest_total: '取总分最高的一轮', last_round: '取最后一轮' }}
                onChange={(pick) => patchRetake({ pick })}
              />
              <NumberField label="及格线（分，留空不设）" value={retake.passScore} min={1} onChange={(passScore) => patchRetake({ passScore })} />
            </div>
          </Panel>
          <Panel title="反馈时机与内容">
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
              <Choice
                label="客观题反馈时间"
                value={feedback.objective.when}
                values={SET_FEEDBACK_WHENS}
                labels={WHEN_LABELS}
                onChange={(when) => patchFeedback({ objective: { ...feedback.objective, when } })}
              />
              <Choice
                label="客观题反馈内容"
                value={feedback.objective.reveal}
                values={SET_OBJECTIVE_REVEALS}
                labels={{ full: '分数与对错', score: '仅分数', none: '不显示' }}
                onChange={(reveal) => patchFeedback({ objective: { ...feedback.objective, reveal } })}
              />
              <Choice
                label="代码题反馈时间"
                value={feedback.code.when}
                values={SET_FEEDBACK_WHENS}
                labels={WHEN_LABELS}
                onChange={(when) => patchFeedback({ code: { ...feedback.code, when } })}
              />
              <Choice
                label="代码题反馈内容"
                value={feedback.code.reveal}
                values={SET_CODE_REVEALS}
                labels={{ full: '完整结果', verdict: '仅评测状态', none: '不显示' }}
                onChange={(reveal) => patchFeedback({ code: { ...feedback.code, reveal } })}
              />
              <Choice
                label="截止后代码反馈"
                value={feedback.code.afterDeadline}
                values={SET_AFTER_DEADLINE}
                labels={{ same: '沿用上面的设置', full: '显示完整结果' }}
                onChange={(afterDeadline) => patchFeedback({ code: { ...feedback.code, afterDeadline } })}
              />
              <Choice
                label="编译型程序填空反馈"
                value={feedback.programFillChannel}
                values={SET_PROGRAM_FILL_CHANNELS}
                labels={{ objective: '按客观题设置', code: '按代码题设置' }}
                onChange={(programFillChannel) => patchFeedback({ programFillChannel })}
              />
            </div>
          </Panel>
          <Panel title="学生可见内容">
            <div className={GRID}>
              <Check
                label="排名显示学生姓名"
                value={experience.showDisplayName}
                onChange={(showDisplayName) => patchExperience({ showDisplayName })}
              />
              <Check label="显示题目难度" value={experience.showDifficulty} onChange={(showDifficulty) => patchExperience({ showDifficulty })} />
              <Check label="隐藏测试点详情" value={experience.hideTestCases} onChange={(hideTestCases) => patchExperience({ hideTestCases })} />
              <Check
                label="隐藏总分"
                note="同时隐藏按总分计算的名次。"
                value={experience.hideTotalScore}
                onChange={(hideTotalScore) => patchExperience({ hideTotalScore })}
              />
              <Choice
                label="排名开放时间"
                value={current.scoreboard}
                values={SET_SCOREBOARDS}
                labels={BOARD_LABELS}
                onChange={(scoreboard) => patch({ ...current, scoreboard })}
              />
              <Field label="封榜开始（留空关闭）">
                <Input
                  aria-label="封榜开始"
                  type="datetime-local"
                  value={draft.lockTime}
                  onChange={(event) => update({ ...draft, lockTime: event.currentTarget.value })}
                />
              </Field>
            </div>
          </Panel>
        </>
      ) : null}
      {category === 'access' ? (
        <SetGroupPermissions
          policy={current.authorization}
          savedPolicy={!!loaded.settings.authorization}
          catalog={loaded.groups}
          onChange={(authorization) => patch({ ...current, authorization })}
        />
      ) : null}
      {category === 'advanced' ? (
        <>
          <Panel title="结束前保存">
            <Check
              label="结束前自动保存答案"
              note="默认关闭。开启后，页面保持打开时会在截止前 30 秒保存未提交的答案；保存失败会明确提示。"
              value={experience.autoSaveBeforeEnd}
              onChange={(autoSaveBeforeEnd) => patchExperience({ autoSaveBeforeEnd })}
            />
          </Panel>
          <Panel title="重新作答">
            <div className={GRID}>
              <NumberField label="允许重新作答次数" value={retake.extra} onChange={(extra) => patchRetake({ extra: extra ?? 0 })} />
              <Check label="只有不及格才能重做" value={retake.onlyAfterFail} onChange={(onlyAfterFail) => patchRetake({ onlyAfterFail })} />
              <Check
                label="重做时须有完整个人限时"
                value={retake.requireFullWindow}
                onChange={(requireFullWindow) => patchRetake({ requireFullWindow })}
              />
            </div>
          </Panel>
          <Panel title="随机抽题">
            <div className="flex flex-col gap-5">
              <Check
                label="启用随机抽题"
                value={current.draw.enabled}
                onChange={(enabled) =>
                  patch({ ...current, draw: { enabled, quotas: enabled ? {} : null, redrawEachRound: true, allowRepeatAcrossRounds: true } })
                }
              />
              {current.draw.enabled ? (
                <>
                  <div className={GRID}>
                    {PTA_KIND_ORDER.map((kind) => (
                      <NumberField
                        key={kind}
                        label={`${ptaKindName(kind)}抽取数量`}
                        value={current.draw.quotas?.[kind] ?? null}
                        min={1}
                        onChange={(count) => {
                          const quotas = { ...current.draw.quotas };
                          if (count === null) delete quotas[kind];
                          else quotas[kind] = count;
                          patch({ ...current, draw: { ...current.draw, quotas } });
                        }}
                      />
                    ))}
                  </div>
                  <div className={GRID}>
                    <Check
                      label="每轮重新抽题"
                      value={current.draw.redrawEachRound}
                      onChange={(redrawEachRound) => patch({ ...current, draw: { ...current.draw, redrawEachRound } })}
                    />
                    <Check
                      label="不同轮次允许重复题目"
                      value={current.draw.allowRepeatAcrossRounds}
                      onChange={(allowRepeatAcrossRounds) => patch({ ...current, draw: { ...current.draw, allowRepeatAcrossRounds } })}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
          <Panel title="竞赛与赛后">
            <div className={GRID}>
              {CONTEST_KEYS.map((key) => (
                <Check
                  key={key}
                  label={CONTEST_LABELS[key]}
                  value={draft.contestOptions[key]}
                  onChange={(value) => update({ ...draft, contestOptions: { ...draft.contestOptions, [key]: value } })}
                />
              ))}
            </div>
          </Panel>
        </>
      ) : null}
      {category === 'manage' ? (
        <>
          {basic ? (
            <CollaboratorsPanel
              noun="题目集"
              value={basic.maintainer}
              onChange={(maintainer) => update({ ...draft, basic: { ...basic, maintainer } })}
            />
          ) : null}
          {workbench ? (
            <>
              <SharePanel type={workbench.container.type} id={id} canShare={workbench.capabilities.canShare} />
              <DangerPanel
                type={workbench.container.type}
                id={id}
                title={basic?.title ?? workbench.container.title}
                noun="题目集"
                canDelete={workbench.capabilities.canDelete}
              />
            </>
          ) : null}
        </>
      ) : null}
      {guardDialog}
    </div>
  );
}
