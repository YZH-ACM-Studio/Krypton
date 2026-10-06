import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Save, Upload, Users } from 'lucide-react';
import { ActionBar, type ActionBarTone } from '@/components/admin/action-bar';
import { RevisionHistory, type RevisionHistoryRow } from '@/components/admin/revision-history';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { MultiSelect } from '@/components/ui/multi-select';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import {
  endpointLocation,
  endpointLocations,
  formatDate,
  latestTargetRevision,
  parseTargetPreview,
  postJson,
  publishedSeatAssignmentOptions,
  sameSources,
  SOURCE_LABELS,
  sourceSummary,
  type BoundEndpointOption,
  type ClassroomSummary,
  type ConfirmPlan,
  type EndpointLocations,
  type ExamPreparationSummary,
  type NetworkConfig,
  type SourceGroup,
  type TargetAssignment,
  type TargetPreview,
  type TargetRevision,
} from './model';
import { MutationNotice } from './shared';

const PREVIEW_COLUMN_LIMIT = 20;

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function sourcesAreRequestedSeat(next: readonly SourceGroup[], requested: string): boolean {
  if (!requested || next.length !== 1) return false;
  const [source] = next;
  return source.kind === 'examSeat' && source.ids.length === 1 && source.ids[0] === requested;
}

function dropExamSeatAssignmentQuery(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('examSeatAssignmentId')) return;
  url.searchParams.delete('examSeatAssignmentId');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function EndpointIdentity({ endpointId, locations }: { endpointId: string; locations: EndpointLocations }): JSX.Element {
  return (
    <>
      {endpointLocation(endpointId, locations)}
      <br />
      <span className="font-mono text-2xs text-fg-subtle">{endpointId}</span>
    </>
  );
}

function previewColumn(ids: readonly string[], locations: EndpointLocations, toneClass: string): JSX.Element {
  if (ids.length === 0) return <p>无</p>;
  const visible = ids.slice(0, PREVIEW_COLUMN_LIMIT);
  const hidden = ids.length - visible.length;
  return (
    <ul>
      {visible.map((endpointId, index) => (
        <li key={`${endpointId}:${index}`} className={toneClass}>
          <EndpointIdentity endpointId={endpointId} locations={locations} />
        </li>
      ))}
      {hidden > 0 ? <li>等 {hidden} 台</li> : null}
    </ul>
  );
}

export function TargetStep({
  eventId,
  schoolId,
  assignment,
  preparation,
  config,
  classrooms,
  boundEndpoints,
  readOnly,
  displayName,
  reload,
  requestConfirm,
}: {
  eventId: string;
  schoolId: string;
  assignment: TargetAssignment | null;
  preparation: ExamPreparationSummary | null;
  config: NetworkConfig | null;
  classrooms: ClassroomSummary[];
  boundEndpoints: BoundEndpointOption[];
  readOnly: boolean;
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}): JSX.Element {
  type EditableSourceKind = 'classroom' | 'endpoint' | 'examSeat';
  type SourceMode = EditableSourceKind | 'existing';
  const requestedAssignmentId = () => new URL(window.location.href).searchParams.get('examSeatAssignmentId')?.trim() || '';
  const seatAssignmentOptions = () => publishedSeatAssignmentOptions(preparation, assignment, requestedAssignmentId());
  // First mount honors the URL seat. After the user edits the source, revision reloads must not force it back.
  const honorUrlSeat = useRef(true);
  const initialSourceKind = (): SourceMode => {
    if (honorUrlSeat.current && requestedAssignmentId()) return 'examSeat';
    const saved = assignment?.draft.sources || [];
    if (!saved.length) return 'endpoint';
    if (saved.length !== 1) return 'existing';
    const [source] = saved;
    if (source.kind === 'endpoint') return 'endpoint';
    if (source.kind === 'classroom' && source.ids.length === 1) return 'classroom';
    if (source.kind === 'examSeat' && source.ids.length === 1) return 'examSeat';
    return 'existing';
  };
  const initialClassroomId = () => assignment?.draft.sources.find((source) => source.kind === 'classroom')?.ids[0] || '';
  const initialAssignmentId = () => {
    const requested = requestedAssignmentId();
    if (requested) return requested;
    const fromDraft = assignment?.draft.sources.find((source) => source.kind === 'examSeat')?.ids[0] || '';
    if (fromDraft) return fromDraft;
    const published = seatAssignmentOptions();
    return published.length === 1 ? published[0].id : '';
  };
  const draftEndpointIds = () => assignment?.draft.sources.find((source) => source.kind === 'endpoint')?.ids || [];
  const [sourceKind, setSourceKind] = useState<SourceMode>(initialSourceKind);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<string[]>(draftEndpointIds);
  const [classroomId, setClassroomId] = useState(initialClassroomId);
  const [examSeatAssignmentId, setExamSeatAssignmentId] = useState(initialAssignmentId);
  const bindingsLoaded = true;
  const bindingError = null;
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [busyAction, setBusyAction] = useState<'save' | 'preview' | 'publish' | 'assign' | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState<string | null>(null);
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;
  const revisionWaiters = useRef<Array<() => void>>([]);
  // A preview response applies only while this generation is still current.
  const previewGeneration = useRef(0);
  const busyGeneration = useRef(0);
  const claimPreview = () => {
    previewGeneration.current += 1;
    return previewGeneration.current;
  };
  const claimBusy = (action: 'save' | 'preview' | 'publish' | 'assign') => {
    busyGeneration.current += 1;
    setBusyAction(action);
    return busyGeneration.current;
  };
  const releaseBusy = (ticket: number) => {
    if (busyGeneration.current !== ticket) return;
    setBusyAction(null);
  };
  const noteSourceEdited = () => {
    honorUrlSeat.current = false;
    previewGeneration.current += 1;
    setPreview(null);
  };
  useEffect(() => {
    setSourceKind(initialSourceKind());
    setSelectedEndpointIds(draftEndpointIds());
    setClassroomId(initialClassroomId());
    setExamSeatAssignmentId(initialAssignmentId());
  }, [assignment?.revision, preparation?.assignment?.id, preparation?.assignment?.revision]);
  useLayoutEffect(() => {
    const waiters = revisionWaiters.current.splice(0);
    for (const waiter of waiters) waiter();
  }, [assignment?.revision]);
  const selectedEndpoints = selectedEndpointIds
    .map((endpointId) => boundEndpoints.find((item) => item.endpointId === endpointId))
    .filter((item): item is BoundEndpointOption => Boolean(item));
  const unresolvedEndpointIds =
    bindingsLoaded && sourceKind === 'endpoint'
      ? selectedEndpointIds.filter((endpointId) => !boundEndpoints.some((item) => item.endpointId === endpointId))
      : [];
  const unresolvedError =
    sourceKind === 'endpoint' && bindingsLoaded && !bindingError && unresolvedEndpointIds.length
      ? '无法解析指定终端的教室或座位'
      : null;
  const sources = (): SourceGroup[] => {
    if (sourceKind === 'existing') return assignment?.draft.sources.map((source) => ({ kind: source.kind, ids: [...source.ids] })) || [];
    if (sourceKind === 'examSeat') return examSeatAssignmentId ? [{ kind: 'examSeat', ids: [examSeatAssignmentId] }] : [];
    if (sourceKind === 'classroom') return classroomId ? [{ kind: 'classroom', ids: [classroomId] }] : [];
    return selectedEndpointIds.length ? [{ kind: 'endpoint', ids: [...selectedEndpointIds] }] : [];
  };
  const savedSources = assignment?.draft.sources || [];
  const targetDirty = JSON.stringify(sources()) !== JSON.stringify(savedSources);
  const endpointDraftBlocked = sourceKind === 'endpoint' && (Boolean(bindingError) || unresolvedEndpointIds.length > 0);
  const targetNotice = error || bindingError || unresolvedError;
  const locations = endpointLocations(boundEndpoints);
  const latest = latestTargetRevision(assignment);
  const revisionAfterReload = (previous: number): Promise<number> => {
    const immediate = assignmentRef.current?.revision || 0;
    if (immediate !== previous) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        const index = revisionWaiters.current.indexOf(finish);
        if (index >= 0) revisionWaiters.current.splice(index, 1);
        resolve(assignmentRef.current?.revision || 0);
      };
      revisionWaiters.current.push(finish);
      timer = window.setTimeout(finish, 50);
    });
  };
  const saveAndResolve = async () => {
    const savedRevision = assignment?.revision || 0;
    const savedGeneration = claimPreview();
    const saveTicket = claimBusy('save');
    setError(null);
    setPreview(null);
    const nextSources = sources();
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'saveDraft', expectedRevision: savedRevision, sources: nextSources },
        '保存目标来源失败',
      );
      const requested = requestedAssignmentId();
      if (requested && !sourcesAreRequestedSeat(nextSources, requested)) dropExamSeatAssignmentQuery();
      await reload();
    } catch (cause) {
      setError(failureMessage(cause, '保存目标来源失败'));
      releaseBusy(saveTicket);
      return;
    }
    toast.success('目标来源已保存');
    if (previewGeneration.current !== savedGeneration) {
      releaseBusy(saveTicket);
      return;
    }
    const generation = claimPreview();
    const previewTicket = claimBusy('preview');
    const expectedRevision = await revisionAfterReload(savedRevision);
    try {
      if (previewGeneration.current !== generation) return;
      const payload = await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'preview', expectedRevision },
        '预检目标失败',
      );
      if (previewGeneration.current !== generation) return;
      setPreview(parseTargetPreview(payload.preview));
    } catch (cause) {
      if (previewGeneration.current !== generation) return;
      setError(failureMessage(cause, '预检目标失败'));
    } finally {
      releaseBusy(previewTicket);
    }
  };
  const previewTargets = async () => {
    const generation = claimPreview();
    const ticket = claimBusy('preview');
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'preview', expectedRevision: assignment?.revision || 0 },
        '预检目标失败',
      );
      if (previewGeneration.current !== generation) return;
      setPreview(parseTargetPreview(payload.preview));
    } catch (cause) {
      if (previewGeneration.current !== generation) return;
      setError(failureMessage(cause, '预检目标失败'));
    } finally {
      releaseBusy(ticket);
    }
  };
  const publish = async () => {
    if (!preview) return;
    const confirmationFingerprint = preview.previewFingerprint;
    const publishedRevision = (assignment?.latestPublishedRevision || 0) + 1;
    claimPreview();
    const ticket = claimBusy('publish');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        {
          eventId,
          action: 'publish',
          expectedRevision: assignment?.revision || 0,
          confirmationFingerprint,
        },
        '发布目标快照失败',
      );
      setPreview(null);
      await reload();
      toast.success(`已发布快照 v${publishedRevision}`);
    } finally {
      releaseBusy(ticket);
    }
  };
  const assign = async (revision: TargetRevision) => {
    if (!assignment) return;
    claimPreview();
    const ticket = claimBusy('assign');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/network-config`,
        {
          eventId,
          action: 'assignTarget',
          expectedRevision: config?.revision || 0,
          assignmentId: assignment.assignmentId,
          revision: revision.revision,
        },
        '分配目标失败',
      );
      await reload();
      toast.success(`本活动目标已改为 v${revision.revision}`);
    } finally {
      releaseBusy(ticket);
    }
  };
  const openPublish = () => {
    if (!preview) return;
    requestConfirm({
      title: '发布目标终端快照？',
      description: '发布时服务端会再次解析来源；只要来源或能力发生漂移就会拒绝。',
      confirmLabel: '确认发布',
      facts: [
        { label: '目标草稿版本', value: `${assignment?.revision || 0} → ${(assignment?.revision || 0) + 1}` },
        { label: '发布目标版本', value: `v${(assignment?.latestPublishedRevision || 0) + 1}` },
        { label: '目标终端数', value: `${preview.targetCount} 台` },
        { label: '新增终端', value: `${preview.addedEndpointIds.length} 台` },
        { label: '移除终端', value: `${preview.removedEndpointIds.length} 台` },
        { label: '分配影响', value: '不会自动启动或修改当前执行' },
      ],
      details: [
        { label: '新增终端 ID', value: preview.addedEndpointIds.length ? preview.addedEndpointIds.join('、') : '无' },
        { label: '移除终端 ID', value: preview.removedEndpointIds.length ? preview.removedEndpointIds.join('、') : '无' },
      ],
      run: publish,
    });
  };
  const openAssign = (revision: TargetRevision) => {
    requestConfirm({
      title: '分配此目标快照？',
      description: '活动配置会固定引用这组终端；已存在的执行不会被改写。',
      confirmLabel: '确认分配',
      facts: [
        { label: '目标版本', value: `v${revision.revision}` },
        { label: '目标终端数', value: revision.targetCount },
        { label: '配置版本', value: `${config?.revision || 0} → ${(config?.revision || 0) + 1}` },
        { label: '执行影响', value: '不会自动启动或热更新' },
      ],
      run: () => assign(revision),
    });
  };
  const resolveButton = (variant: 'primary' | 'secondary', label: '解析终端' | '重新解析') => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={readOnly || busy || !assignment || targetDirty}
      loading={busyAction === 'preview'}
      title={targetDirty ? '请先保存来源，再解析服务端 canonical 草稿' : undefined}
      onClick={() => void previewTargets()}
    >
      <Users />
      {label}
    </Button>
  );
  const lockSourceFields = readOnly || busy;
  // Preview stays switchable: a late response is dropped by generation. Other actions lock the tabs.
  const lockSourceTabs = readOnly || (busy && busyAction !== 'preview');
  const sourceItems: MiniTabItem<SourceMode>[] = [
    { value: 'endpoint', label: '指定终端', disabled: lockSourceTabs },
    { value: 'classroom', label: '整间教室', disabled: lockSourceTabs },
    { value: 'examSeat', label: '已发布考试座位分配', disabled: lockSourceTabs },
  ];
  if (initialSourceKind() === 'existing') {
    sourceItems.push({ value: 'existing', label: '保留现有来源（只读）', disabled: lockSourceTabs });
  }
  let status: string | undefined;
  let statusTone: ActionBarTone = 'neutral';
  let end: ReactNode = null;
  if (!readOnly) {
    if (sources().length === 0 && !targetDirty) {
      status = '尚未选择来源';
    } else if (targetDirty) {
      status = '有未保存修改';
      statusTone = 'warning';
      end = (
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={readOnly || busy || sourceKind === 'existing' || endpointDraftBlocked || (Boolean(assignment) && !targetDirty)}
          loading={busyAction === 'save'}
          onClick={() => void saveAndResolve()}
        >
          <Save />
          保存并解析
        </Button>
      );
    } else if (preview) {
      status = '已解析，尚未发布';
      statusTone = 'warning';
      end = (
        <>
          {resolveButton('secondary', '重新解析')}
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={busy}
            loading={busyAction === 'publish'}
            onClick={openPublish}
          >
            <Upload />
            {`发布为快照 v${(assignment?.latestPublishedRevision || 0) + 1}…`}
          </Button>
        </>
      );
    } else if (!latest || !assignment || !sameSources(assignment.draft.sources, latest.sources)) {
      status = '草稿已保存，尚未解析';
      statusTone = 'warning';
      end = resolveButton('primary', '解析终端');
    } else if (config?.target?.id !== assignment.assignmentId || config.target.revision !== latest.revision) {
      status = `v${latest.revision} 已发布，本活动尚未使用`;
      statusTone = 'warning';
      end = (
        <>
          {resolveButton('secondary', '解析终端')}
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={busy}
            loading={busyAction === 'assign'}
            onClick={() => openAssign(latest)}
          >
            设为本活动目标…
          </Button>
        </>
      );
    } else {
      status = `本活动正在使用 v${latest.revision}`;
      statusTone = 'success';
      end = resolveButton('secondary', '解析终端');
    }
  }
  const usingRevision = (revision: TargetRevision) =>
    Boolean(assignment && config?.target?.id === assignment.assignmentId && config.target.revision === revision.revision);
  const historyRows: RevisionHistoryRow[] = assignment
    ? [...assignment.revisions]
      .sort((left, right) => right.revision - left.revision)
      .map((revision) => {
        const current = usingRevision(revision);
        return {
          key: String(revision.revision),
          title: `v${revision.revision} · ${revision.targetCount} 台`,
          meta: `${formatDate(revision.publishedAt)} 发布 · 来源：${sourceSummary(revision.sources, classrooms)}`,
          current,
          action: current || readOnly ? undefined : (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => openAssign(revision)}>
              改用此快照
            </Button>
          ),
          detail: {
            summary: `查看 ${revision.endpointIds.length} 台终端`,
            content: (
              <ul>
                {revision.endpointIds.map((endpointId, index) => (
                  <li key={`${endpointId}:${index}`}>
                    <EndpointIdentity endpointId={endpointId} locations={locations} />
                  </li>
                ))}
              </ul>
            ),
          },
        };
      })
    : [];
  const historySummary = assignment
    ? `${assignment.revisions.length} 个快照${assignment.draft.updatedAt ? ` · 草稿最后由 ${displayName(assignment.draft.updatedBy)} 修改于 ${formatDate(assignment.draft.updatedAt)}` : ''}`
    : undefined;
  const classroomOptions = classrooms
    .filter((classroom) => classroom.schoolId === schoolId)
    .map((classroom) => ({
      value: classroom.classroomId,
      label: `${classroom.name} · ${classroom.seatCount} 座`,
    }));
  return (
    <div id="target-assignment">
      <Panel
        title="目标终端"
        description="保存动态来源后必须重新预览；发布只冻结显式 endpoint 快照。"
        footer={<ActionBar status={status} statusTone={statusTone} end={end} />}
      >
        <div className="space-y-4">
          <MutationNotice error={targetNotice} />
          {readOnly ? <Alert tone="neutral">活动已归档，目标快照仅供查看。</Alert> : null}
          <FormField label="目标来源" hint="考试座位引用已发布 assignment；外部无名单考试继续使用教室或指定终端来源。">
            <MiniTabs
              aria-label="目标来源"
              value={sourceKind}
              items={sourceItems}
              onValueChange={(next) => {
                noteSourceEdited();
                setSourceKind(next);
                if (next === 'examSeat') {
                  const options = seatAssignmentOptions();
                  if (options.length === 1 && !examSeatAssignmentId) setExamSeatAssignmentId(options[0].id);
                }
              }}
            />
          </FormField>
          {sourceKind === 'endpoint' ? (
            <FormField label="指定终端" hint="只列出当前学校教室里已经绑定的活动终端。">
              <div role="group" aria-label="指定终端" aria-disabled={lockSourceFields || undefined}>
                <MultiSelect<BoundEndpointOption>
                  value={selectedEndpoints}
                  onChange={(next) => {
                    noteSourceEdited();
                    setSelectedEndpointIds(next.map((item) => item.endpointId));
                  }}
                  options={boundEndpoints}
                  getKey={(item) => item.endpointId}
                  getLabel={(item) => item.label}
                  disabled={lockSourceFields}
                  placeholder="搜索已绑定终端"
                  emptyText="没有已绑定的活动终端"
                />
              </div>
            </FormField>
          ) : sourceKind === 'classroom' ? (
            <FormField label="教室" htmlFor="target-classroom" hint="只列出当前活动学校下的已导入教室；发布时服务端重验当前 active bindings。">
              <SimpleSelect
                id="target-classroom"
                ariaLabel="教室"
                value={classroomId}
                disabled={lockSourceFields}
                onValueChange={(next) => {
                  noteSourceEdited();
                  setClassroomId(next);
                }}
                options={[{ value: '', label: '选择教室' }, ...classroomOptions]}
              />
            </FormField>
          ) : sourceKind === 'examSeat' ? (
            <FormField
              label="已发布分配"
              htmlFor="target-exam-seat-assignment"
              hint="从座位工作台已发布的分配中选择；发布目标时服务端会重验 publication、布局和绑定。"
            >
              <SimpleSelect
                id="target-exam-seat-assignment"
                ariaLabel="已发布分配"
                value={examSeatAssignmentId}
                disabled={lockSourceFields}
                onValueChange={(next) => {
                  noteSourceEdited();
                  setExamSeatAssignmentId(next);
                }}
                placeholder="选择已发布分配"
                options={[
                  { value: '', label: '选择已发布分配' },
                  ...seatAssignmentOptions().map((item) => ({ value: item.id, label: item.label })),
                ]}
              />
            </FormField>
          ) : (
            <div className="rounded-md bg-surface-sunken p-3 text-sm">
              <p className="font-medium text-fg">现有来源保持不变</p>
              <p className="mt-1 text-fg-muted">
                当前草稿包含多个来源组或旧的实体座位/用户组来源，本页不会把它们静默改写。可直接重新解析，或明确切换到上方支持的来源类型后保存。
              </p>
              <ul className="mt-2 list-inside list-disc font-mono text-xs text-fg-subtle">
                {savedSources.map((source, index) => (
                  <li key={`${source.kind}-${index}`}>
                    {SOURCE_LABELS[source.kind]} · {source.ids.length} 项
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview ? (
            <div className="rounded-md bg-surface-sunken p-4">
              <p className="font-medium text-fg">解析到 {preview.targetCount} 台终端</p>
              <p className="mt-1 text-xs text-fg-subtle">
                新增 {preview.addedEndpointIds.length} · 移除 {preview.removedEndpointIds.length}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-fg">新增</p>
                  {previewColumn(preview.addedEndpointIds, locations, 'text-success-fg')}
                </div>
                <div>
                  <p className="text-sm font-medium text-fg">移除</p>
                  {previewColumn(preview.removedEndpointIds, locations, 'text-danger-fg')}
                </div>
              </div>
            </div>
          ) : null}
          <RevisionHistory
            title="快照历史"
            currentLabel="本活动使用中"
            summary={historySummary}
            rows={historyRows}
          />
          {assignment && assignment.revisions.length === 0 && assignment.draft.updatedAt ? (
            <p className="text-xs text-fg-muted">
              草稿最后由 {displayName(assignment.draft.updatedBy)} 修改于 {formatDate(assignment.draft.updatedAt)}
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
