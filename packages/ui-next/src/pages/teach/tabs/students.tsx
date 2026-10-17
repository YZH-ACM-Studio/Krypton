import type { TeachTab, TeachType } from '@hydrooj/common';
import { useEffect, useId, useRef, useState } from 'react';
import { KeyRound, Users } from 'lucide-react';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { AudienceField, audienceErrors, type AudienceValue } from '@/components/teach/audience-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import {
  contestFormBody,
  homeworkFormBody,
  practiceFormBody,
  type ContestFormState,
  type HomeworkFormState,
  type PracticeFormState,
} from '../legacy-forms';
import type { TeachWorkbenchPayload } from '../model';
import {
  SaveBar,
  SwitchRow,
  useLegacySnapshot,
  useWorkbenchDirty,
  type AnyLegacySnapshot,
} from '../settings-kit';

const PRACTICE_AUDIENCE = '看到并能开始这个练习的人。';
const REDEEM_ONLY = '现在只能通过兑换码进入。';
const LIVE_AUDIENCE = '能看到并参加的人。名单按用户组实时计算：学生进组立刻能做，退组就看不到。';
const HIDDEN_DESCRIPTION = '学生在列表和首页看不到；拿到链接、或通过课程结业入口仍然能进。';
const INVITE_DESCRIPTION = '报名时要输入邀请码。';
const TEAM_DESCRIPTION = '1–3 人一队，按队伍计分。队伍名单和赛前组队批次在「高级」里管理。';
const TEAM_ON_MESSAGE = '组队参赛必须开启机房监考，并且只能通过客户端进入；保存后这两项会自动打开，并且不计入 Rating。';
const INVITE_REQUIRED = '请填写邀请码';
const SAVE_FAILED = '保存失败。';
const LOAD_FAILED = '题目集设置没有加载出来。';
const SAVING_LOCK = '正在保存。';

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface StudentsDraft {
  audience: AudienceValue;
  hidden: boolean;
  inviteOn: boolean;
  code: string;
  participationMode: 'individual' | 'team';
  teamModeClearConfirmation: string;
}

function isContestFamily(type: TeachType): boolean {
  return type === 'exam' || type === 'acm' || type === 'oi';
}

function copyIds(ids: readonly string[]): string[] {
  return [...ids];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameAudience(left: AudienceValue, right: AudienceValue): boolean {
  return left.mode === right.mode && sameIds(left.groupIds, right.groupIds) && sameIds(left.schoolIds, right.schoolIds);
}

function audienceFromContest(state: ContestFormState): AudienceValue {
  const groupIds = copyIds(state.participantGroupIds);
  const schoolIds = copyIds(state.participantSchoolIds);
  if (state.participantScopeMode === 'groups') return { mode: 'groups', groupIds, schoolIds };
  if (state.participantScopeMode === 'schools') return { mode: 'schools', groupIds, schoolIds };
  return { mode: 'all', groupIds, schoolIds };
}

function audienceFromHomework(state: HomeworkFormState): AudienceValue {
  const groupIds = copyIds(state.participantGroupIds);
  if (state.participantScopeMode === 'groups') return { mode: 'groups', groupIds, schoolIds: [] };
  return { mode: 'all', groupIds, schoolIds: [] };
}

function audienceFromPractice(state: PracticeFormState): AudienceValue {
  const groupIds = copyIds(state.audienceGroupIds);
  if (!state.audiencePublic) return { mode: 'groups', groupIds, schoolIds: [] };
  return { mode: 'all', groupIds, schoolIds: [] };
}

function draftFrom(snapshot: AnyLegacySnapshot): StudentsDraft {
  if (snapshot.kind === 'homework') {
    return {
      audience: audienceFromHomework(snapshot.value.state),
      hidden: false,
      inviteOn: false,
      code: '',
      participationMode: 'individual',
      teamModeClearConfirmation: '',
    };
  }
  if (snapshot.kind === 'practice') {
    return {
      audience: audienceFromPractice(snapshot.value.state),
      hidden: false,
      inviteOn: false,
      code: '',
      participationMode: 'individual',
      teamModeClearConfirmation: '',
    };
  }
  const state = snapshot.value.state;
  const code = state.code;
  return {
    audience: audienceFromContest(state),
    hidden: state.hidden,
    inviteOn: code.trim() !== '',
    code,
    participationMode: state.participationMode,
    teamModeClearConfirmation: '',
  };
}

function postedCode(draft: StudentsDraft): string {
  return draft.inviteOn ? draft.code.trim() : '';
}

function countDirty(snapshot: AnyLegacySnapshot, draft: StudentsDraft): number {
  const base = draftFrom(snapshot);
  let count = sameAudience(base.audience, draft.audience) ? 0 : 1;
  if (snapshot.kind !== 'contest') return count;
  if (base.hidden !== draft.hidden) count += 1;
  if (base.inviteOn !== draft.inviteOn || postedCode(draft) !== postedCode(base)) count += 1;
  if (base.participationMode !== draft.participationMode) count += 1;
  return count;
}

function audienceDescription(type: TeachType, snapshot: AnyLegacySnapshot, audience: AudienceValue): string {
  if (type !== 'practice') return LIVE_AUDIENCE;
  const savedRedeemOnly = snapshot.kind === 'practice'
    && !snapshot.value.state.audiencePublic
    && snapshot.value.state.audienceGroupIds.length === 0;
  const draftStillEmpty = audience.mode === 'groups' && audience.groupIds.length === 0;
  return savedRedeemOnly && draftStillEmpty ? `${PRACTICE_AUDIENCE}${REDEEM_ONLY}` : PRACTICE_AUDIENCE;
}

function allDescription(type: TeachType): string {
  return type === 'practice' ? '登录即可看到和做题' : '登录即可报名参加';
}

function homeworkAudience(value: AudienceValue): Pick<HomeworkFormState, 'participantScopeMode' | 'participantGroupIds'> {
  if (value.mode === 'groups') return { participantScopeMode: 'groups', participantGroupIds: value.groupIds };
  if (value.mode === 'all') return { participantScopeMode: 'none', participantGroupIds: value.groupIds };
  throw new TypeError(`audience_mode_invalid:${String(value.mode)}`);
}

function practiceAudience(value: AudienceValue): Pick<PracticeFormState, 'audiencePublic' | 'audienceGroupIds'> {
  if (value.mode === 'all') return { audiencePublic: true, audienceGroupIds: value.groupIds };
  if (value.mode === 'groups') return { audiencePublic: false, audienceGroupIds: value.groupIds };
  throw new TypeError(`audience_mode_invalid:${String(value.mode)}`);
}

function contestAudience(
  value: AudienceValue,
): Pick<ContestFormState, 'participantScopeMode' | 'participantGroupIds' | 'participantSchoolIds'> {
  if (value.mode === 'groups') {
    return {
      participantScopeMode: 'groups',
      participantGroupIds: value.groupIds,
      participantSchoolIds: value.schoolIds,
    };
  }
  if (value.mode === 'schools') {
    return {
      participantScopeMode: 'schools',
      participantGroupIds: value.groupIds,
      participantSchoolIds: value.schoolIds,
    };
  }
  if (value.mode === 'all') {
    return {
      participantScopeMode: 'none',
      participantGroupIds: value.groupIds,
      participantSchoolIds: value.schoolIds,
    };
  }
  throw new TypeError(`audience_mode_invalid:${String(value.mode)}`);
}

function buildBody(type: TeachType, latest: AnyLegacySnapshot, draft: StudentsDraft): URLSearchParams {
  if (type === 'homework') {
    if (latest.kind !== 'homework') throw new TypeError('teach_snapshot_kind_invalid');
    return homeworkFormBody({ ...latest.value.state, ...homeworkAudience(draft.audience) });
  }
  if (type === 'practice') {
    if (latest.kind !== 'practice') throw new TypeError('teach_snapshot_kind_invalid');
    const body = practiceFormBody({ ...latest.value.state, ...practiceAudience(draft.audience) });
    // Draft group ids stay so switching back to groups keeps the selection. An empty
    // audienceGroupIds value is parsed as [''], so all mode must omit the key.
    if (draft.audience.mode === 'all') body.delete('audienceGroupIds');
    return body;
  }
  if (latest.kind !== 'contest') throw new TypeError('teach_snapshot_kind_invalid');
  const state = latest.value.state;
  const participationMode = draft.participationMode;
  const participationRevision = state.participationRevision;
  const teamModeClearConfirmation = participationMode === 'individual' ? draft.teamModeClearConfirmation : '';
  // Team mode posts rule=acm. The contest handler then forces client_required and clears rated.
  return contestFormBody({
    ...state,
    ...contestAudience(draft.audience),
    hidden: draft.hidden,
    code: postedCode(draft),
    participationMode,
    participationRevision,
    teamModeClearConfirmation,
    rule: participationMode === 'team' ? 'acm' : state.rule,
  });
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function AccessNote({ type, onNavigateTab }: { type: TeachType; onNavigateTab: (tab: TeachTab) => void }) {
  if (type === 'practice') {
    return (
      <Alert
        tone="neutral"
        className="[&_[data-icon]]:hidden"
        action={(
          <Button type="button" variant="link" size="sm" onClick={() => onNavigateTab('advanced')}>
            管理兑换码
          </Button>
        )}
      >
        <span className="inline-flex min-w-0 items-start gap-2">
          <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">名单外的人也可以用兑换码开放。</span>
        </span>
      </Alert>
    );
  }
  return (
    <Alert
      tone="neutral"
      className="[&_[data-icon]]:hidden"
      action={(
        <Button asChild variant="link" size="sm">
          <a href="/user-groups">打开我的用户组</a>
        </Button>
      )}
    >
      <span className="inline-flex min-w-0 items-start gap-2">
        <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">要加人或删人，去改用户组本身。</span>
      </span>
    </Alert>
  );
}

export function StudentsTab({ payload, onNavigateTab }: TeachTabProps) {
  const type = payload.container.type;
  const contest = isContestFamily(type);
  const { status, snapshot, error, reload, save } = useLegacySnapshot();
  const { setTabDirty } = useWorkbenchDirty();
  const hiddenId = useId();
  const inviteId = useId();
  const teamId = useId();
  const codeId = useId();
  const [basedOn, setBasedOn] = useState<AnyLegacySnapshot | null>(null);
  const [draft, setDraft] = useState<StudentsDraft | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const teamConfirmRef = useRef(false);

  if (snapshot && snapshot !== basedOn) {
    setBasedOn(snapshot);
    setDraft(draftFrom(snapshot));
    setAudienceError(null);
    setCodeError(null);
    setSaveError(null);
  }

  const ready = snapshot !== null && draft !== null && basedOn === snapshot;
  const dirtyCount = ready && snapshot && draft ? countDirty(snapshot, draft) : 0;
  useUnsavedChangesGuard(dirtyCount > 0);
  useEffect(() => {
    setTabDirty('students', dirtyCount > 0);
  }, [dirtyCount, setTabDirty]);
  useEffect(() => () => setTabDirty('students', false), [setTabDirty]);

  function patchDraft(patch: Partial<StudentsDraft>) {
    if (savingRef.current) return;
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function changeAudience(next: AudienceValue) {
    if (savingRef.current) return;
    patchDraft({ audience: next });
    setAudienceError(null);
  }

  async function changeTeam(next: boolean) {
    if (savingRef.current || teamConfirmRef.current || !draft || basedOn?.kind !== 'contest') return;
    if (next === (draft.participationMode === 'team')) return;
    const activeTeamCount = basedOn.value.extras.activeTeamCount;
    const clearToken = basedOn.value.extras.teamModeClearToken;
    teamConfirmRef.current = true;
    try {
      if (next) {
        const confirmed = await confirmDialog(TEAM_ON_MESSAGE, { title: '改成组队参赛？', confirmLabel: '改成组队参赛' });
        if (!confirmed) {
          setDraft((current) => (current ? { ...current } : current));
          return;
        }
        patchDraft({ participationMode: 'team', teamModeClearConfirmation: '' });
        return;
      }
      if (activeTeamCount > 0) {
        const confirmed = await confirmDialog(
          `这场比赛已经有 ${activeTeamCount} 支队伍，保存后会清空全部队伍。`,
          { title: '改回个人参赛？', confirmLabel: '清空队伍并改回', destructive: true },
        );
        if (!confirmed) {
          setDraft((current) => (current ? { ...current } : current));
          return;
        }
        patchDraft({ participationMode: 'individual', teamModeClearConfirmation: clearToken });
        return;
      }
      patchDraft({ participationMode: 'individual', teamModeClearConfirmation: '' });
    } finally {
      teamConfirmRef.current = false;
    }
  }

  function discard() {
    if (!basedOn || savingRef.current) return;
    setDraft(draftFrom(basedOn));
    setAudienceError(null);
    setCodeError(null);
    setSaveError(null);
  }

  async function onSave() {
    if (!draft || savingRef.current) return;
    const nextAudienceError = audienceErrors(draft.audience);
    const nextCodeError = contest && draft.inviteOn && draft.code.trim() === '' ? INVITE_REQUIRED : null;
    setAudienceError(nextAudienceError);
    setCodeError(nextCodeError);
    if (nextAudienceError || nextCodeError) return;
    const savingDraft = draft;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await save((latest) => buildBody(type, latest, savingDraft));
      toast.success('已保存');
    } catch (caught) {
      console.error('teach students save failed', { type, id: payload.container.id, error: caught });
      setSaveError(messageOf(caught, SAVE_FAILED));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (status === 'error' && !ready) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <Alert tone="danger">{error || LOAD_FAILED}</Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void reload().catch((caught: unknown) => {
                console.error('teach students reload failed', { type, id: payload.container.id, error: caught });
              });
            }}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (!ready || !draft || basedOn?.kind === undefined) {
    return <p className="text-sm text-fg-subtle">正在加载。</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel title="给谁做" description={audienceDescription(type, basedOn, draft.audience)}>
        <AudienceField
          name="students-audience"
          value={draft.audience}
          onChange={changeAudience}
          allowSchools={contest}
          groups={basedOn.value.catalogs.groups}
          schools={basedOn.value.catalogs.schools}
          allDescription={allDescription(type)}
          error={audienceError}
          lockedReason={saving ? SAVING_LOCK : null}
        />
      </Panel>
      {contest && basedOn.kind === 'contest' ? (
        <Panel title="入口">
          <div className="divide-y divide-line-subtle">
            <SwitchRow
              id={hiddenId}
              label="不在比赛列表中显示"
              description={HIDDEN_DESCRIPTION}
              checked={draft.hidden}
              disabled={saving}
              onCheckedChange={(hidden) => patchDraft({ hidden })}
            />
            <div>
              <SwitchRow
                id={inviteId}
                label="需要邀请码"
                description={INVITE_DESCRIPTION}
                checked={draft.inviteOn}
                disabled={saving}
                onCheckedChange={(inviteOn) => {
                  if (savingRef.current) return;
                  patchDraft({ inviteOn });
                  setCodeError(null);
                }}
              />
              {draft.inviteOn ? (
                <div className="pb-3">
                  <FormField label="邀请码" htmlFor={codeId} required error={codeError}>
                    <Input
                      id={codeId}
                      value={draft.code}
                      invalid={codeError !== null}
                      disabled={saving}
                      autoComplete="off"
                      onChange={(event) => {
                        if (savingRef.current) return;
                        patchDraft({ code: event.target.value });
                        setCodeError(null);
                      }}
                    />
                  </FormField>
                </div>
              ) : null}
            </div>
            {type === 'acm' ? (
              <SwitchRow
                id={teamId}
                label="组队参赛"
                description={TEAM_DESCRIPTION}
                checked={draft.participationMode === 'team'}
                disabled={saving}
                onCheckedChange={(next) => {
                  void changeTeam(next);
                }}
              />
            ) : null}
          </div>
        </Panel>
      ) : null}
      <AccessNote type={type} onNavigateTab={onNavigateTab} />
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <SaveBar dirtyCount={dirtyCount} saving={saving} onSave={() => { void onSave(); }} onDiscard={discard} />
    </div>
  );
}
