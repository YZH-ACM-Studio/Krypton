import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { TechDetails, type FactItem } from '@/components/admin/fact-grid';
import { StepRail } from '@/components/admin/step-rail';
import { useUserNames, userDisplayName } from '@/components/admin/user-label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/display';
import { Menu } from '@/components/ui/menu';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { BasicsStep } from './basics-step';
import {
  apiObject,
  asRecord,
  asString,
  formatDate,
  parseAssignment,
  parseBoundEndpointOptions,
  parseClassroomSummaries,
  parseConfig,
  parseEvent,
  parseExecution,
  parseNetworkUpdatePreview,
  parsePolicy,
  parsePreparationSummary,
  parseTemplate,
  postJson,
  requestedEventPanel,
  STATUS_LABELS,
  writeEventPanel,
  type BoundEndpointOption,
  type ClassroomSummary,
  type ConfirmPlan,
  type EventPanel,
  type EventType,
  type ExamEventView,
  type ExamPreparationSummary,
  type NetworkConfig,
  type NetworkExecution,
  type NetworkPolicy,
  type NetworkUpdatePreview,
  type PolicyTemplate,
  type SchoolView,
  type TargetAssignment,
} from './model';
import { PolicyStep } from './policy-step';
import { RunStep } from './run-step';
import { ConfirmActionDialog, MutationNotice, statusBadge } from './shared';
import { defaultEventPanel, eventStepItems } from './step-status';
import { TargetStep } from './target-step';

function eventTypeLabel(type: EventType): string {
  return type === 'krypton' ? 'Krypton 比赛' : '外部考试';
}

function schoolNameFor(schools: readonly SchoolView[], schoolId: string): string {
  return schools.find((school) => school.schoolId === schoolId)?.name ?? '学校不可用';
}

function rosterSeatText(preparation: ExamPreparationSummary | null): string {
  const assignment = preparation?.assignment;
  if (!assignment) return '未发布';
  return `r${assignment.roster.revision} / r${assignment.revision}`;
}

function preloginBatchText(batch: ExamPreparationSummary['batch']): string {
  if (!batch) return '尚未创建';
  const stateLabel = batch.state === 'dispatched' ? '已派发' : '派发中';
  return `${stateLabel} \u00B7 ${batch.ticketCount} 张票据`;
}

function revisionValue(value: number | null | undefined): string {
  return `r${value || 0}`;
}

function revisionItems(
  event: ExamEventView,
  config: NetworkConfig | null,
  preparation: ExamPreparationSummary | null,
): FactItem[] {
  const batch = preparation?.batch ?? null;
  const workflow = batch?.workflow ?? null;
  const items: FactItem[] = [
    { label: '名单', value: revisionValue(preparation?.assignment?.roster.revision) },
    { label: '分配', value: revisionValue(preparation?.assignment?.revision) },
    { label: '发布', value: revisionValue(preparation?.publicationRevision) },
    { label: '策略', value: revisionValue(config?.policy?.revision) },
    { label: '目标', value: revisionValue(config?.target?.revision) },
    { label: '票据批次', value: revisionValue(batch?.revision) },
    { label: '投影', value: revisionValue(batch?.projectionRevision) },
    { label: '活动版本', value: String(event.revision) },
    { label: '配置版本', value: String(config?.revision || 0) },
  ];
  if (workflow) {
    items.push(
      { label: '确认执行', value: revisionValue(workflow.executionRevision) },
      { label: '批次策略', value: revisionValue(workflow.policyRevision) },
      { label: '批次目标', value: revisionValue(workflow.targetRevision) },
    );
  } else if (batch) {
    items.push({ label: '批次', value: 'P2.9 前历史批次' });
  }
  return items;
}

function detailUserIds(
  event: ExamEventView | null,
  templates: readonly PolicyTemplate[],
  assignment: TargetAssignment | null,
): Array<number | null | undefined> {
  if (!event) return [];
  return [
    event.ownerUid,
    ...event.collaboratorUids,
    event.createdBy,
    event.updatedBy,
    event.archivedBy,
    ...templates.map((template) => template.draft.updatedBy),
    assignment?.draft.updatedBy,
  ];
}

export function EventDetailPage({ eventId }: { eventId: string }): JSX.Element {
  const bs = useBootstrap();
  const [event, setEvent] = useState<ExamEventView | null>(null);
  const [schools, setSchools] = useState<SchoolView[]>([]);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [suggestedPolicy, setSuggestedPolicy] = useState<NetworkPolicy | null>(null);
  const [assignment, setAssignment] = useState<TargetAssignment | null>(null);
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [execution, setExecution] = useState<NetworkExecution | null>(null);
  const [preparation, setPreparation] = useState<ExamPreparationSummary | null>(null);
  const [updatePreview, setUpdatePreview] = useState<NetworkUpdatePreview | null>(null);
  const [updatePreviewWarning, setUpdatePreviewWarning] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [boundEndpoints, setBoundEndpoints] = useState<BoundEndpointOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ConfirmPlan | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [panel, setPanel] = useState<EventPanel | null>(null);
  // First successful load picks the step. Later reloads keep it; only clicks write the URL.
  const panelChosenFor = useRef<string | null>(null);
  const names = useUserNames(bs.domain.id, detailUserIds(event, templates, assignment));
  const displayName = (uid: number | null | undefined) => userDisplayName(uid, names);
  const goToPanel = (next: EventPanel) => {
    setPanel(next);
    writeEventPanel(next);
    // writeEventPanel deletes panel for basics, so a later visit would fall back to the first unfinished step
    // or to targets while examSeatAssignmentId remains. panel= takes priority over that seat id.
    if (next !== 'basics') return;
    const url = new URL(window.location.href);
    url.searchParams.set('panel', 'basics');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };
  const reload = useCallback(async () => {
    const detail = await apiObject(`/api/admin/exam-events/${eventId}`, undefined, '加载考试活动失败');
    const parsedEvent = parseEvent(detail.event);
    const parsedPreparation = parsePreparationSummary(detail.preparation);
    if (!Array.isArray(detail.schools)) throw new Error('学校响应格式不正确');
    const [policyPayload, targetPayload, configPayload, executionPayload] = await Promise.all([
      apiObject(`/api/admin/exam-policy-templates?eventId=${encodeURIComponent(eventId)}`, undefined, '加载策略失败'),
      apiObject(`/api/admin/exam-events/${eventId}/target-assignment`, undefined, '加载目标失败'),
      apiObject(`/api/admin/exam-events/${eventId}/network-config`, undefined, '加载网络配置失败'),
      apiObject(`/api/admin/exam-events/${eventId}/network-execution`, undefined, '加载执行事实失败'),
    ]);
    if (!Array.isArray(policyPayload.templates)) throw new Error('策略响应格式不正确');
    // Match the old reload: each parse runs after the previous setState, so a later failure keeps earlier facts.
    setEvent(parsedEvent);
    setPreparation(parsedPreparation);
    const parsedSchools = detail.schools.map((item: unknown) => {
      const school = asRecord(item, '学校');
      return { schoolId: asString(school.schoolId, '学校'), name: asString(school.name, '学校') };
    });
    setSchools(parsedSchools);
    const parsedTemplates = policyPayload.templates.map((item: unknown) => parseTemplate(item));
    setTemplates(parsedTemplates);
    const parsedSuggested = policyPayload.suggestedPolicy == null ? null : parsePolicy(policyPayload.suggestedPolicy);
    setSuggestedPolicy(parsedSuggested);
    const parsedAssignment = parseAssignment(targetPayload.assignment);
    setAssignment(parsedAssignment);
    const parsedClassrooms = parseClassroomSummaries(targetPayload.classrooms);
    setClassrooms(parsedClassrooms);
    const parsedBound = parseBoundEndpointOptions(targetPayload.boundEndpoints);
    setBoundEndpoints(parsedBound);
    const parsedConfig = parseConfig(configPayload.config);
    setConfig(parsedConfig);
    const parsedExecution = parseExecution(executionPayload.execution);
    setExecution(parsedExecution);
    const parsedPreview = parseNetworkUpdatePreview(executionPayload.updatePreview);
    setUpdatePreview(parsedPreview);
    const parsedWarning = executionPayload.updatePreviewWarning == null
      ? null
      : asString(executionPayload.updatePreviewWarning, '热更新预览');
    setUpdatePreviewWarning(parsedWarning);
    if (panelChosenFor.current !== eventId) {
      panelChosenFor.current = eventId;
      setPanel(defaultEventPanel({
        event: parsedEvent,
        config: parsedConfig,
        templates: parsedTemplates,
        assignment: parsedAssignment,
        execution: parsedExecution,
      }, requestedEventPanel()));
    }
  }, [eventId]);
  useEffect(() => {
    let current = true;
    void reload()
      .catch((cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : '加载考试基础设施失败');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reload]);
  const closePlan = () => {
    setPlan(null);
    setConfirmError(null);
  };
  const runPlan = (next: ConfirmPlan) => {
    setConfirmError(null);
    setPlan({
      ...next,
      run: async () => {
        setConfirmBusy(true);
        setConfirmError(null);
        try {
          await next.run();
          closePlan();
        } catch (cause) {
          setConfirmError(cause instanceof Error ? cause.message : '操作失败');
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };
  if (loading || (event !== null && error === null && panel === null)) {
    return (
      <AdminPage bypassPrivGate hideSidebar contentClassName="min-w-0 overflow-x-clip">
        <div className="flex min-h-64 items-center justify-center">
          <Spinner className="size-6 text-fg-subtle" />
        </div>
      </AdminPage>
    );
  }
  if (!event || error || panel === null) {
    return (
      <AdminPage bypassPrivGate hideSidebar contentClassName="min-w-0 overflow-x-clip" title="考试基础设施">
        <MutationNotice error={error || '考试活动不存在或无权访问'} />
      </AdminPage>
    );
  }
  const readOnly = event.lifecycle === 'archived';
  const seatsHref = `/admin/exam-infrastructure/events/${event.eventId}/seats`;
  const facts = { event, config, templates, assignment, execution };
  const openArchive = () => {
    runPlan({
      title: '归档此活动？',
      description: '归档是当前唯一移除路径，不会删除历史网络版本或执行事实。',
      confirmLabel: '确认归档',
      tone: 'destructive',
      facts: [
        { label: '活动', value: event.title },
        { label: '当前状态', value: STATUS_LABELS[event.status] },
        { label: '活动版本', value: `${event.revision} → ${event.revision + 1}` },
      ],
      run: async () => {
        await postJson(
          `/api/admin/exam-events/${event.eventId}`,
          { action: 'archive', expectedRevision: event.revision },
          '归档考试失败',
        );
        await reload();
        toast.success('活动已归档');
      },
    });
  };
  let preparationWarning: string | null = null;
  if (preparation?.warning === 'assignment_publication_reference_drift') {
    preparationWarning = '已发布座位分配的引用已变化，座位发布摘要暂不可用，但活动基本信息仍可编辑。';
  } else if (preparation?.warning) {
    preparationWarning = '预登录批次摘要暂不可用，但活动基本信息仍可编辑。';
  }
  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      contentClassName="min-w-0 overflow-x-clip"
      title={event.title}
      description={`${schoolNameFor(schools, event.schoolId)} \u00B7 ${eventTypeLabel(event.type)} \u00B7 ${formatDate(event.startAt)} – ${formatDate(event.endAt)}`}
      actions={(
        <>
          {statusBadge(event.status)}
          <Menu
            label="更多"
            trigger={(menuProps) => (
              <Button type="button" variant="secondary" size="sm" aria-label="更多" {...menuProps}>
                更多
                <ChevronDown />
              </Button>
            )}
            items={[
              { label: '打开座位工作台', href: seatsHref },
              'separator',
              {
                label: '归档活动…',
                danger: true,
                disabled: readOnly,
                onSelect: openArchive,
              },
            ]}
          />
        </>
      )}
    >
      <a href="/admin/exam-infrastructure" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        返回活动列表
      </a>
      <div className="min-w-0 space-y-4">
        {preparationWarning ? <MutationNotice error={preparationWarning} /> : null}
        <div className="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            <Panel
              title="考试准备"
              footer={(
                <Button asChild variant="secondary" size="sm">
                  <a href={seatsHref}>打开座位工作台</a>
                </Button>
              )}
            >
              <DescriptionList
                items={[
                  { term: '名单 / 座位分配', detail: rosterSeatText(preparation) },
                  { term: '座位发布', detail: revisionValue(preparation?.publicationRevision) },
                  { term: '预登录批次', detail: preloginBatchText(preparation?.batch ?? null) },
                ]}
              />
              <TechDetails summary="修订号" items={revisionItems(event, config, preparation)} />
            </Panel>
            <Panel flush>
              <StepRail
                aria-label="考试活动步骤"
                items={eventStepItems(facts)}
                value={panel}
                onValueChange={goToPanel}
              />
            </Panel>
          </aside>
          <div className="min-w-0">
            {panel === 'basics' ? (
              <BasicsStep
                event={event}
                schools={schools}
                displayName={displayName}
                reload={reload}
                requestConfirm={runPlan}
              />
            ) : null}
            {panel === 'policy' ? (
              <PolicyStep
                eventId={eventId}
                templates={templates}
                suggestedPolicy={suggestedPolicy}
                config={config}
                readOnly={readOnly}
                displayName={displayName}
                reload={reload}
                requestConfirm={runPlan}
              />
            ) : null}
            {panel === 'targets' ? (
              <TargetStep
                eventId={eventId}
                schoolId={event.schoolId}
                assignment={assignment}
                preparation={preparation}
                config={config}
                classrooms={classrooms}
                boundEndpoints={boundEndpoints}
                readOnly={readOnly}
                displayName={displayName}
                reload={reload}
                requestConfirm={runPlan}
              />
            ) : null}
            {panel === 'run' ? (
              <RunStep
                event={event}
                config={config}
                assignment={assignment}
                execution={execution}
                updatePreview={updatePreview}
                updatePreviewWarning={updatePreviewWarning}
                boundEndpoints={boundEndpoints}
                reload={reload}
                requestConfirm={runPlan}
              />
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmActionDialog plan={plan} busy={confirmBusy} error={confirmError} onClose={closePlan} />
    </AdminPage>
  );
}
