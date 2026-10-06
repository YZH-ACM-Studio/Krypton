import { useEffect, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { ActionBar } from '@/components/admin/action-bar';
import { FactGrid, TechDetails, type FactItem } from '@/components/admin/fact-grid';
import type { DomainUserOption } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import {
  collaboratorsFromUids,
  contestTitleFact,
  formatDate,
  hydrateCollaborators,
  loadContestOption,
  postJson,
  toLocalDateTime,
  type ConfirmPlan,
  type ContestOption,
  type EventType,
  type ExamEventView,
  type SchoolView,
} from './model';
import { CollaboratorSelect, ContestSearchSelect, MutationNotice, statusBadge } from './shared';

const BASICS_FORM_ID = 'exam-event-basics-form';
const TIMELINE_JOIN = '\u3000\u00B7\u3000';

function isEventType(value: string): value is EventType {
  return value === 'krypton' || value === 'external';
}

function timelineText(event: ExamEventView, displayName: (uid: number | null | undefined) => string): string {
  const parts: string[] = [];
  if (event.createdAt != null) {
    parts.push(`创建于 ${formatDate(event.createdAt)} \u00B7 ${displayName(event.createdBy)}`);
  }
  parts.push(`最近更新 ${formatDate(event.updatedAt)} \u00B7 ${displayName(event.updatedBy)}`);
  if (event.archivedAt != null) {
    parts.push(`归档于 ${formatDate(event.archivedAt)} \u00B7 ${displayName(event.archivedBy)}`);
  }
  return parts.join(TIMELINE_JOIN);
}

function techItems(event: ExamEventView): FactItem[] {
  const items: FactItem[] = [
    { label: '活动 ID', value: event.eventId },
    { label: '活动版本', value: String(event.revision) },
  ];
  if (event.contestId) items.push({ label: 'Contest ID', value: event.contestId });
  return items;
}

function collaboratorValue(uids: number[], displayName: (uid: number | null | undefined) => string): ReactNode {
  if (uids.length === 0) return '无';
  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-1.5">
      {uids.map((uid) => (
        <Badge
          key={uid}
          tone="neutral"
          className="h-auto! max-w-full min-w-0 shrink! whitespace-normal! break-words py-0.5 text-left"
        >
          {displayName(uid)}
        </Badge>
      ))}
    </div>
  );
}

interface LinkedContestState {
  contestId: string;
  option: ContestOption | null;
  unavailable: boolean;
}

function contestForEvent(contestId: string | null, linked: LinkedContestState | null): { option: ContestOption | null; unavailable: boolean } {
  if (contestId && linked?.contestId === contestId) return { option: linked.option, unavailable: linked.unavailable };
  return { option: null, unavailable: false };
}

function sameUidOrder(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((uid, index) => uid === right[index]);
}

function applyHydratedCollaborators(current: DomainUserOption[], openedUids: readonly number[], hydrated: DomainUserOption[]): DomainUserOption[] {
  const currentIds = current.map((user) => user._id);
  if (sameUidOrder(currentIds, openedUids)) return hydrated;
  const named = new Map(hydrated.map((user) => [user._id, user]));
  return current.map((user) => named.get(user._id) ?? user);
}

function contestValue(contestId: string | null, option: ContestOption | null, unavailable: boolean): ReactNode {
  if (!contestId) return '纯外部考试';
  return (
    <a
      href={`/contest/${contestId}`}
      className="rounded-sm text-brand-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {contestTitleFact(contestId, option, unavailable)}
    </a>
  );
}

export function BasicsStep({
  event,
  schools,
  displayName,
  reload,
  requestConfirm,
}: {
  event: ExamEventView;
  schools: SchoolView[];
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}): JSX.Element {
  const bs = useBootstrap();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType>(event.type);
  const [contestId, setContestId] = useState(event.contestId || '');
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>(() => collaboratorsFromUids(event.collaboratorUids));
  const [linkedContestState, setLinkedContestState] = useState<LinkedContestState | null>(null);
  const hydrateSeq = useRef(0);
  const linkedContestView = contestForEvent(event.contestId, linkedContestState);
  const criticalEditable = event.lifecycle !== 'archived' && event.status !== 'active' && event.status !== 'ended';
  const schoolName = schools.find((school) => school.schoolId === event.schoolId)?.name ?? '学校不可用';

  useEffect(() => {
    if (!event.contestId) {
      setLinkedContestState(null);
      return;
    }
    const requestedContestId = event.contestId;
    setLinkedContestState((prev) => (
      prev?.contestId === requestedContestId ? prev : { contestId: requestedContestId, option: null, unavailable: false }
    ));
    let current = true;
    void loadContestOption(requestedContestId)
      .then((option) => {
        if (!current) return;
        setLinkedContestState({ contestId: requestedContestId, option, unavailable: false });
      })
      .catch(() => {
        if (!current) return;
        setLinkedContestState({ contestId: requestedContestId, option: null, unavailable: true });
      });
    return () => {
      current = false;
    };
  }, [event.contestId]);

  const openEditor = () => {
    const seq = ++hydrateSeq.current;
    const openedUids = event.collaboratorUids;
    setType(event.type);
    setContestId(event.contestId || '');
    setCollaborators(collaboratorsFromUids(openedUids));
    setError(null);
    setEditing(true);
    void hydrateCollaborators(bs.domain.id, openedUids).then((next) => {
      if (seq !== hydrateSeq.current) return;
      setCollaborators((current) => applyHydratedCollaborators(current, openedUids, next));
    });
  };

  const schedule = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${event.eventId}`,
        { action: 'schedule', expectedRevision: event.revision },
        '计划考试失败',
      );
      await reload();
      setEditing(false);
      toast.success('活动已计划');
    } finally {
      setBusy(false);
    }
  };

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(formEvent.currentTarget);
    const body: Record<string, unknown> = {
      action: 'update',
      expectedRevision: event.revision,
      title: String(form.get('title') || ''),
      collaboratorUids: collaborators.map((user) => user._id),
    };
    try {
      if (criticalEditable) {
        Object.assign(body, {
          schoolId: String(form.get('schoolId') || ''),
          type,
          contestId: type === 'krypton' ? contestId.trim() || null : null,
          startAt: new Date(String(form.get('startAt') || '')).toISOString(),
          endAt: new Date(String(form.get('endAt') || '')).toISOString(),
        });
      }
      await postJson(`/api/admin/exam-events/${event.eventId}`, body, '保存活动信息失败');
      await reload();
      setEditing(false);
      toast.success('基本信息已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存活动信息失败');
    } finally {
      setBusy(false);
    }
  };

  const readOnlyFooter = (() => {
    if (event.lifecycle === 'archived') return <ActionBar status="只读归档" />;
    if (event.lifecycle === 'draft') {
      return (
        <ActionBar
          status="草稿 · 尚未计划"
          statusTone="warning"
          end={
            <>
              <Button type="button" variant="secondary" onClick={openEditor}>
                编辑
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  requestConfirm({
                    title: '计划此考试活动？',
                    description: '计划后时间窗和关键关联会受到生命周期限制。服务端会重新校验 Contest 与权限。',
                    confirmLabel: '确认计划',
                    facts: [
                      { label: '活动版本', value: `${event.revision} → ${event.revision + 1}` },
                      { label: '考试时段', value: `${formatDate(event.startAt)} → ${formatDate(event.endAt)}` },
                      { label: 'Contest', value: contestTitleFact(event.contestId, linkedContestView.option, linkedContestView.unavailable) },
                    ],
                    details: event.contestId ? [{ label: 'Contest ID', value: event.contestId }] : undefined,
                    run: () => schedule(),
                  });
                }}
              >
                计划活动
              </Button>
            </>
          }
        />
      );
    }
    return (
      <ActionBar
        status={criticalEditable ? '已计划' : '考试已开始或结束，只能修改名称和协作者'}
        statusTone={criticalEditable ? 'success' : 'neutral'}
        end={
          <Button type="button" variant="primary" onClick={openEditor}>
            编辑
          </Button>
        }
      />
    );
  })();

  return (
    <Panel
      title="基本信息"
      description="活动时间窗和类型是后续策略执行的边界。"
      footer={
        editing ? (
          <ActionBar
            end={
              <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => { setEditing(false); setError(null); }}>
                  取消
                </Button>
                <Button type="submit" form={BASICS_FORM_ID} variant="primary" loading={busy}>
                  保存
                </Button>
              </>
            }
          />
        ) : (
          readOnlyFooter
        )
      }
    >
      {editing ? (
        <form id={BASICS_FORM_ID} className="flex flex-col gap-5" onSubmit={(formEvent) => void save(formEvent)}>
          <MutationNotice error={error} />
          {criticalEditable ? null : <Alert tone="neutral">考试已经开始或结束；仅活动名称和协作者仍可维护。</Alert>}
          <FormRow columns={2}>
            <FormField label="活动名称" htmlFor="edit-exam-title" required>
              <Input id="edit-exam-title" name="title" defaultValue={event.title} required maxLength={120} autoFocus />
            </FormField>
            <FormField label="学校" htmlFor="edit-exam-school" required>
              <SimpleSelect
                id="edit-exam-school"
                name="schoolId"
                ariaLabel="学校"
                defaultValue={event.schoolId}
                disabled={!criticalEditable}
                options={schools.map((school) => ({ value: school.schoolId, label: school.name }))}
              />
            </FormField>
          </FormRow>
          <FormRow columns={2}>
            <FormField label="考试类型" htmlFor="edit-exam-type" required>
              <SimpleSelect
                id="edit-exam-type"
                ariaLabel="考试类型"
                value={type}
                disabled={!criticalEditable}
                onValueChange={(next) => {
                  if (!isEventType(next)) throw new Error(`未知考试类型：${next}`);
                  setType(next);
                  if (next === 'external') setContestId('');
                }}
                options={[
                  { value: 'external', label: '外部考试' },
                  { value: 'krypton', label: 'Krypton 比赛' },
                ]}
              />
            </FormField>
            {type === 'krypton' ? (
              <FormField label="Krypton 比赛">
                <ContestSearchSelect name="contestId" value={contestId} disabled={!criticalEditable} onChange={(next) => setContestId(next)} />
              </FormField>
            ) : null}
          </FormRow>
          <FormRow columns={2}>
            <FormField label="开始时间" htmlFor="edit-exam-start" required>
              <Input
                id="edit-exam-start"
                name="startAt"
                type="datetime-local"
                defaultValue={toLocalDateTime(event.startAt)}
                required
                disabled={!criticalEditable}
              />
            </FormField>
            <FormField label="硬截止时间" htmlFor="edit-exam-end" required>
              <Input
                id="edit-exam-end"
                name="endAt"
                type="datetime-local"
                defaultValue={toLocalDateTime(event.endAt)}
                required
                disabled={!criticalEditable}
              />
            </FormField>
          </FormRow>
          <FormField label="协作者">
            <CollaboratorSelect domainId={bs.domain.id} value={collaborators} onChange={setCollaborators} />
          </FormField>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <MutationNotice error={error} />
          <FactGrid
            columns={3}
            facts={[
              { label: '学校', value: schoolName },
              { label: '类型', value: event.type === 'krypton' ? 'Krypton 比赛' : '外部考试' },
              { label: '关联比赛', value: contestValue(event.contestId, linkedContestView.option, linkedContestView.unavailable) },
              { label: '状态', value: statusBadge(event.status) },
              { label: '开始', value: formatDate(event.startAt) },
              { label: '硬截止', value: formatDate(event.endAt) },
              { label: '负责人', value: displayName(event.ownerUid) },
              { label: '协作者', value: collaboratorValue(event.collaboratorUids, displayName) },
            ]}
          />
          <p className="text-xs text-fg-subtle">{timelineText(event, displayName)}</p>
          <TechDetails items={techItems(event)} />
        </div>
      )}
    </Panel>
  );
}
