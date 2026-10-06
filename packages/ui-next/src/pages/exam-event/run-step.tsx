import { useState, type JSX, type ReactNode } from 'react';
import { AlertTriangle, CircleDashed, CloudOff, Copy, Play, RefreshCw, ShieldCheck, Square } from 'lucide-react';
import { ActionBar } from '@/components/admin/action-bar';
import { FactGrid, TechDetails, type FactItem } from '@/components/admin/fact-grid';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import {
  DELIVERY_UNKNOWN_FAILURE_REASON,
  ENDPOINT_STATUS_LABELS,
  endpointLocation,
  endpointLocations,
  formatDate,
  isRetryableProjectionItem,
  lookupInfraLabel,
  networkConfigIdentity,
  parsePreflightResponse,
  policyDiffFacts,
  policyEffectLabel,
  postJson,
  preflightCountFact,
  preflightSummaryTone,
  teacherReasonLabel,
  visibleNetworkUpdatePreview,
  type BoundEndpointOption,
  type ConfirmPlan,
  type ExamEventView,
  type NetworkConfig,
  type NetworkExecution,
  type NetworkUpdatePreview,
  type PreflightItem,
  type PreflightResult,
  type ProjectionItem,
  type TargetAssignment,
} from './model';
import { EndpointStatusBadge, MutationNotice, PreflightReadinessBadge } from './shared';

const PREFLIGHT_UNREADY = 'preflight-unready';
const PROJECTION_STATUSES = ['applied', 'expired', 'failed', 'offline', 'queued', 'rejected', 'sent'] as const;

interface TerminalRow {
  endpointId: string;
  projection: ProjectionItem | null;
  preflight: PreflightItem | null;
}

function isProjectionStatus(value: string): value is ProjectionItem['status'] {
  return (PROJECTION_STATUSES as readonly string[]).includes(value);
}

function projectionStatusLabel(status: string): string {
  if (isProjectionStatus(status)) return ENDPOINT_STATUS_LABELS[status];
  return teacherReasonLabel(status);
}

function dispatchStatusLabel(status: NetworkExecution['operation']['status']): string {
  if (status === 'received') return '已收到投影';
  if (status === 'dispatching') return '派发中';
  if (status === 'unknown') return '结果未知';
  return '派发失败';
}

function joinedOrNone(values: readonly string[]): string {
  return values.join('、') || '无';
}

function terminalRows(execution: NetworkExecution | null, visiblePreflight: PreflightItem[] | null): TerminalRow[] {
  const preflightItems = visiblePreflight ?? [];
  const preflightById = new Map(preflightItems.map((item) => [item.endpointId, item]));
  const seen = new Set<string>();
  const rows: TerminalRow[] = [];
  for (const item of execution?.projection?.items ?? []) {
    seen.add(item.endpointId);
    rows.push({
      endpointId: item.endpointId,
      projection: item,
      preflight: preflightById.get(item.endpointId) ?? null,
    });
  }
  for (const item of preflightItems) {
    if (seen.has(item.endpointId)) continue;
    rows.push({ endpointId: item.endpointId, projection: null, preflight: item });
  }
  return rows;
}

function onlineOf(row: TerminalRow): boolean {
  if (row.projection) return row.projection.online;
  if (row.preflight) return row.preflight.online;
  throw new Error(`终端 ${row.endpointId} 缺少连接状态`);
}

function policyVersionText(item: ProjectionItem): string {
  const previous = item.previousPolicyRevision ?? '—';
  const expected = item.expectedPolicyRevision ?? '—';
  const applied = item.appliedPolicyRevision ?? item.networkPolicyState?.policyRevision ?? '—';
  return `旧 ${previous} / 期望 ${expected} / 实际 ${applied}`;
}

function reasonLabel(row: TerminalRow): string {
  const projection = row.projection;
  if (projection) {
    if (projection.failureReason) return teacherReasonLabel(projection.failureReason);
    const stateReason = projection.networkPolicyState?.reason;
    if (stateReason) return teacherReasonLabel(stateReason);
    return '—';
  }
  if (row.preflight && !row.preflight.ready) return teacherReasonLabel(row.preflight.reason);
  return '—';
}

function executionTechItems(execution: NetworkExecution): FactItem[] {
  const items: FactItem[] = [
    { label: '执行 ID', value: execution.executionId },
    { label: '执行版本', value: String(execution.revision) },
    { label: '终端策略 revision', value: String(execution.networkPolicyRevision) },
    { label: '投影版本', value: execution.projection ? String(execution.projection.revision) : '—' },
    { label: '投影回报时间', value: execution.projection ? formatDate(execution.projection.receivedAt) : '—' },
  ];
  if (execution.operation.failedAt) items.push({ label: '失败时间', value: formatDate(execution.operation.failedAt) });
  return items;
}

async function copyEndpointId(endpointId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(endpointId);
  } catch {
    return;
  }
  toast.success('已复制终端 ID');
}

function TerminalSection({
  execution,
  visiblePreflight,
  boundEndpoints,
}: {
  execution: NetworkExecution | null;
  visiblePreflight: PreflightItem[] | null;
  boundEndpoints: BoundEndpointOption[];
}): JSX.Element {
  const [filter, setFilter] = useState('all');
  const rows = terminalRows(execution, visiblePreflight);
  const locations = endpointLocations(boundEndpoints);
  const unreadyCount = (visiblePreflight ?? []).filter((item) => !item.ready).length;
  const summary = execution?.projection?.summary ?? {};
  const filterItems = [
    { value: 'all', label: '全部', count: rows.length },
    ...Object.entries(summary).map(([status, count]) => ({
      value: status,
      label: projectionStatusLabel(status),
      count,
    })),
    ...(unreadyCount > 0 ? [{ value: PREFLIGHT_UNREADY, label: '预检未就绪', count: unreadyCount }] : []),
  ];
  const selected = filterItems.some((item) => item.value === filter) ? filter : 'all';
  const visible = selected === 'all' ? rows : rows.filter((row) => {
    if (selected === PREFLIGHT_UNREADY) return row.preflight != null && !row.preflight.ready;
    return row.projection?.status === selected;
  });
  const readyCount = visiblePreflight?.filter((item) => item.ready).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">终端</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">预检</span>
          {visiblePreflight ? (
            <Badge tone={preflightSummaryTone(visiblePreflight)}>
              {readyCount}/{visiblePreflight.length} 就绪
            </Badge>
          ) : (
            <Badge tone="warning">待检</Badge>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        execution ? (
          <EmptyState compact icon={<CircleDashed />} title="等待执行投影" description="命令请求已经持久化，但尚未收到可展示的逐机事实。" />
        ) : (
          <EmptyState compact icon={<CloudOff />} title="尚未启动网络策略" description="预检只检查终端状态，不会创建执行或下发命令。" />
        )
      ) : (
        <>
          {filterItems.length > 1 ? (
            <MiniTabs aria-label="终端筛选" value={selected} onValueChange={setFilter} items={filterItems} />
          ) : null}
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>位置</TableHead>
                  <TableHead>终端</TableHead>
                  <TableHead>连接</TableHead>
                  <TableHead>预检</TableHead>
                  <TableHead>命令事实</TableHead>
                  <TableHead>策略版本</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row, index) => {
                  const version = row.preflight?.serviceVersion;
                  return (
                    <TableRow key={`${index}:${row.endpointId}`}>
                      <TableCell>{endpointLocation(row.endpointId, locations)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs break-all">{row.endpointId}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label={`复制终端 ID ${row.endpointId}`}
                          onClick={() => {
                            void copyEndpointId(row.endpointId);
                          }}
                        >
                          <Copy />
                        </Button>
                      </TableCell>
                      <TableCell>{onlineOf(row) ? '在线' : '离线'}</TableCell>
                      <TableCell>
                        {row.preflight ? <PreflightReadinessBadge item={row.preflight} /> : <span className="text-fg-subtle">—</span>}
                      </TableCell>
                      <TableCell>{row.projection ? <EndpointStatusBadge status={row.projection.status} /> : '—'}</TableCell>
                      <TableCell className="text-xs">{row.projection ? policyVersionText(row.projection) : '—'}</TableCell>
                      <TableCell className="text-xs text-fg-subtle">
                        {reasonLabel(row)}
                        {version ? <span className="text-fg-subtle">{` · Service ${version}`}</span> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

export function RunStep({
  event,
  config,
  assignment,
  execution,
  updatePreview,
  updatePreviewWarning,
  boundEndpoints,
  reload,
  requestConfirm,
}: {
  event: ExamEventView;
  config: NetworkConfig | null;
  assignment: TargetAssignment | null;
  execution: NetworkExecution | null;
  updatePreview: NetworkUpdatePreview | null;
  updatePreviewWarning: string | null;
  boundEndpoints: BoundEndpointOption[];
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}): JSX.Element {
  const configIdentity = networkConfigIdentity(config);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const reportedPreflight = preflight?.configIdentity === configIdentity ? preflight.items : null;
  const visiblePreflight = reportedPreflight?.length ? reportedPreflight : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offlineEndpoints = execution?.projection?.items.filter((item) => !item.online) || [];
  const activeOfflineEndpoints = execution?.desiredState === 'active' ? offlineEndpoints : [];
  const incompleteRelease = execution?.desiredState === 'stopped' && (execution.projection?.items.some((item) => item.status !== 'applied') ?? false);
  const call = async (action: 'preflight' | 'refresh' | 'retry' | 'retryFailed' | 'start' | 'stop', rethrow = false, expectedConfigRevision?: number) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action !== 'preflight') body.expectedRevision = execution?.revision || 0;
      if (action === 'start') {
        if (expectedConfigRevision === undefined) throw new Error('缺少确认时的配置版本');
        body.expectedConfigRevision = expectedConfigRevision;
      }
      const payload = await postJson(
        `/api/admin/exam-events/${event.eventId}/network-execution`,
        body,
        `${action === 'preflight' ? '预检' : '执行网络操作'}失败`,
      );
      if (action === 'preflight') setPreflight(parsePreflightResponse(payload));
      await reload();
      if (action === 'start') toast.success(execution?.desiredState === 'active' ? '热更新已下发' : '网络策略已启动');
      else if (action === 'stop') toast.success('停止命令已下发');
      else if (action === 'retryFailed') toast.success('已整批重新下发');
    } catch (cause) {
      if (!rethrow) setError(cause instanceof Error ? cause.message : '网络操作失败');
      if (rethrow) throw cause;
    } finally {
      setBusy(false);
    }
  };
  const publishedTarget = assignment?.revisions.find((revision) => revision.revision === config?.target?.revision) || null;
  const canonicalUpdatePreview = visibleNetworkUpdatePreview(updatePreview, config, execution);
  const failures =
    execution?.projection?.items.filter(
      (item) => item.status === 'failed' || item.status === 'offline' || item.status === 'rejected' || item.status === 'expired',
    ) || [];
  const retryableFailures = failures.filter(isRetryableProjectionItem);
  const hasDeliveryUnknownFailure = failures.some((item) => item.failureReason === DELIVERY_UNKNOWN_FAILURE_REASON);
  const currentRequestUnresolved = Boolean(
    execution && (execution.operation.status !== 'received' || execution.projection?.dispatchStatus !== 'complete' || hasDeliveryUnknownFailure),
  );
  const runnable = event.lifecycle === 'scheduled' && event.status !== 'ended';
  const updateIsRollback = Boolean(
    canonicalUpdatePreview &&
      canonicalUpdatePreview.fromPolicyRef.id === canonicalUpdatePreview.toPolicyRef.id &&
      canonicalUpdatePreview.toPolicyRef.revision < canonicalUpdatePreview.fromPolicyRef.revision,
  );
  const updateTone =
    canonicalUpdatePreview?.policyDiff.effect === 'loosening' || canonicalUpdatePreview?.policyDiff.effect === 'mixed' ? 'destructive' : 'default';
  const showStart = execution?.desiredState !== 'active';
  const showRetryFailed = Boolean(
    execution?.projection?.dispatchStatus === 'complete' &&
      retryableFailures.length > 0 &&
      !hasDeliveryUnknownFailure &&
      offlineEndpoints.length === 0 &&
      event.lifecycle !== 'archived' &&
      (execution.desiredState !== 'active' || !canonicalUpdatePreview),
  );
  const primaryAction = !execution ? 'start' : showRetryFailed ? 'retryFailed' : showStart ? 'start' : null;
  const showHotUpdate = execution?.desiredState === 'active' && canonicalUpdatePreview != null;
  const hotUpdatePrimary = Boolean(showHotUpdate && canonicalUpdatePreview && !canonicalUpdatePreview.requiresStop && updateTone !== 'destructive');
  const unresolvedTitle = currentRequestUnresolved ? '请先重试当前请求或刷新到完整执行事实' : undefined;
  const notices = (
    <>
      <MutationNotice error={error} />
      {updatePreviewWarning ? (
        <MutationNotice error={lookupInfraLabel(updatePreviewWarning) || '当前执行引用的策略或目标已变化，热更新预览暂不可用。'} />
      ) : null}
    </>
  );

  if (!config?.policy || !config.target) {
    return (
      <Panel title="预检与执行" description="“已送达”不等于“已应用”；此处只展示 Vigil 返回并由 OJ 持久化的逐机事实。">
        <div className="space-y-4">
          {notices}
          <EmptyState compact icon={<AlertTriangle />} title="网络配置尚未完成" description="先分配一个已发布策略版本和目标快照，再进行预检。" />
        </div>
      </Panel>
    );
  }

  const policy = config.policy;
  const configTarget = config.target;
  const startVariant = primaryAction === 'start' && !hotUpdatePrimary ? 'primary' : 'secondary';
  const retryVariant = primaryAction === 'retryFailed' && !hotUpdatePrimary ? 'primary' : 'secondary';
  const startButton = showStart ? (
    <Button
      type="button"
      size="sm"
      variant={startVariant}
      disabled={busy || !runnable || currentRequestUnresolved}
      title={unresolvedTitle}
      onClick={() =>
        requestConfirm({
          title: '启动网络策略？',
          description: '命令会逐机持久化并派发。页面返回或传输成功不代表终端已经应用。',
          confirmLabel: '确认启动',
          facts: [
            { label: '执行版本', value: `${execution?.revision || 0} → ${(execution?.revision || 0) + 1}` },
            { label: '策略版本', value: `v${policy.revision}` },
            { label: '目标终端数', value: publishedTarget?.targetCount ?? '未知' },
            { label: '硬截止', value: formatDate(event.endAt) },
            { label: '目标变化', value: publishedTarget ? `${publishedTarget.endpointIds.length} 台固定快照` : '无法确认' },
            { label: '当前预检', value: preflightCountFact(visiblePreflight) },
            ...(canonicalUpdatePreview
              ? [
                  ...policyDiffFacts(canonicalUpdatePreview.policyDiff),
                  {
                    label: '终端变化',
                    value: `${canonicalUpdatePreview.targetDiff.beforeCount} → ${canonicalUpdatePreview.targetDiff.afterCount} 台`,
                  },
                ]
              : []),
          ],
          run: () => call('start', true, config.revision),
        })
      }
    >
      <Play />
      启动
    </Button>
  ) : null;
  const retryButton = showRetryFailed && execution ? (
    <Button
      type="button"
      size="sm"
      variant={retryVariant}
      disabled={busy}
      onClick={() =>
        requestConfirm({
          title: execution.desiredState === 'active' ? '整批重新应用网络策略？' : '整批重新发送停止命令？',
          description:
            execution.desiredState === 'active'
              ? '为保持同一目标快照的 revision 一致，系统会给全部目标终端发送更高策略 revision；不是只给失败终端补发。'
              : '系统会给全部目标终端发送新的签名停止命令；已经确认释放的终端只更新精确停止证明，不会重新加锁。',
          confirmLabel: execution.desiredState === 'active' ? '确认整批重试' : '确认重新停止',
          tone: 'destructive',
          facts: [
            { label: '执行版本', value: `${execution.revision} → ${execution.revision + 1}` },
            {
              label: '终端策略 revision',
              value:
                execution.desiredState === 'active'
                  ? `${execution.networkPolicyRevision} → ${execution.networkPolicyRevision + 1}`
                  : `${execution.networkPolicyRevision}（不变）`,
            },
            { label: '整批目标', value: `${execution.projection?.items.length ?? 0} 台` },
            { label: '当前失败终端', value: retryableFailures.map((item) => item.endpointId).join('、') },
            { label: '硬截止', value: formatDate(execution.hardEndAt) },
          ],
          run: () => call('retryFailed', true),
        })
      }
    >
      <RefreshCw />
      整批重试失败项
    </Button>
  ) : null;
  const retryFirst = primaryAction === 'retryFailed';
  let statusLabel = '已停止';
  let statusDot: ReactNode = <StatusDot />;
  if (!execution) {
    statusLabel = '尚未启动';
  } else if (execution.desiredState === 'active') {
    statusLabel = '锁网运行中';
    statusDot = <StatusDot tone="success" pulse />;
  }
  const statusFacts: FactItem[] = execution
    ? [
        { label: '派发', value: dispatchStatusLabel(execution.operation.status) },
        { label: '策略 / 目标', value: `v${execution.policyRef.revision} / v${execution.targetRef.revision}` },
        { label: '硬截止', value: formatDate(execution.hardEndAt) },
        {
          label: '请求 → 回报',
          value: `${execution.operation.requestedAt ? formatDate(execution.operation.requestedAt) : '—'} → ${execution.operation.receivedAt ? formatDate(execution.operation.receivedAt) : '—'}`,
        },
      ]
    : [
        { label: '策略', value: `v${policy.revision}` },
        { label: '目标', value: `v${configTarget.revision} · ${publishedTarget?.targetCount ?? '未知'} 台` },
        { label: '硬截止', value: formatDate(event.endAt) },
        { label: '当前预检', value: preflightCountFact(visiblePreflight) },
      ];

  return (
    <Panel title="预检与执行" description="“已送达”不等于“已应用”；此处只展示 Vigil 返回并由 OJ 持久化的逐机事实。">
      <div className="space-y-4">
        {notices}
        <div className="rounded-md bg-surface-sunken p-4">
          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <p className="flex items-center gap-2 text-lg font-semibold text-fg">
              {statusDot}
              {statusLabel}
            </p>
            <FactGrid columns={4} facts={statusFacts} />
          </div>
        </div>
        {execution?.operation.failureReason ? <MutationNotice error={execution.operation.failureReason} /> : null}
        {showHotUpdate && canonicalUpdatePreview && execution ? (
          <div className="rounded-md bg-surface-sunken p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-fg">配置已有新版本等待应用</p>
                  <Badge
                    tone={updateTone === 'destructive' ? 'danger' : canonicalUpdatePreview.policyDiff.effect === 'tightening' ? 'info' : 'neutral'}
                    variant="outline"
                  >
                    {policyEffectLabel(canonicalUpdatePreview.policyDiff.effect)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-fg-subtle">
                  策略 v{canonicalUpdatePreview.fromPolicyRef.revision} → v{canonicalUpdatePreview.toPolicyRef.revision} · 目标{' '}
                  {canonicalUpdatePreview.targetDiff.beforeCount} → {canonicalUpdatePreview.targetDiff.afterCount} 台
                </p>
              </div>
              {!canonicalUpdatePreview.requiresStop ? (
                <Button
                  type="button"
                  size="sm"
                  variant={updateTone === 'destructive' ? 'danger-soft' : 'primary'}
                  disabled={busy || !runnable || currentRequestUnresolved}
                  title={unresolvedTitle}
                  onClick={() =>
                    requestConfirm({
                      title: updateIsRollback ? '回滚并热更新网络策略？' : '热更新网络策略？',
                      description:
                        updateTone === 'destructive'
                          ? '本次变更包含访问范围放宽。命令会逐机持久化，只有终端回报实际版本后才算应用成功。'
                          : '目标快照不变；命令会逐机持久化，离线或失败终端不会被显示成已经更新。',
                      confirmLabel: updateIsRollback ? '确认回滚' : '确认热更新',
                      tone: updateTone,
                      facts: [
                        {
                          label: '执行版本',
                          value: `${canonicalUpdatePreview.executionRevision} → ${canonicalUpdatePreview.executionRevision + 1}`,
                        },
                        {
                          label: '终端策略 revision',
                          value: `${canonicalUpdatePreview.previousNetworkPolicyRevision} → ${canonicalUpdatePreview.expectedNetworkPolicyRevision}`,
                        },
                        ...policyDiffFacts(canonicalUpdatePreview.policyDiff),
                        { label: '影响终端', value: `${canonicalUpdatePreview.targetDiff.afterCount} 台` },
                        { label: '当前预检', value: preflightCountFact(visiblePreflight) },
                        { label: '硬截止', value: formatDate(execution.hardEndAt) },
                      ],
                      run: () => call('start', true, canonicalUpdatePreview.configRevision),
                    })
                  }
                >
                  <RefreshCw />
                  {updateIsRollback ? '回滚并热更新' : '热更新策略'}
                </Button>
              ) : null}
            </div>
            <div className="mt-3">
              <FactGrid
                columns={2}
                facts={[
                  {
                    label: '新增允许规则',
                    value: joinedOrNone([...canonicalUpdatePreview.policyDiff.addedHosts, ...canonicalUpdatePreview.policyDiff.addedIps]),
                  },
                  {
                    label: '移除允许规则',
                    value: joinedOrNone([...canonicalUpdatePreview.policyDiff.removedHosts, ...canonicalUpdatePreview.policyDiff.removedIps]),
                  },
                  { label: '新增终端', value: joinedOrNone(canonicalUpdatePreview.targetDiff.addedEndpointIds) },
                  { label: '移除终端', value: joinedOrNone(canonicalUpdatePreview.targetDiff.removedEndpointIds) },
                ]}
              />
            </div>
            {canonicalUpdatePreview.requiresStop ? (
              <Alert tone="warning" className="mt-3">
                目标终端发生变化。为避免被移除的机器继续残留旧锁，必须先停止当前目标并等待全部终端确认释放，再按新快照启动。
              </Alert>
            ) : null}
          </div>
        ) : null}
        <ActionBar
          start={
            <>
              {retryFirst ? retryButton : startButton}
              {retryFirst ? startButton : retryButton}
              <Button type="button" size="sm" variant="secondary" disabled={busy || !runnable} onClick={() => void call('preflight')}>
                <ShieldCheck />
                终端预检
              </Button>
              {execution ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void call('refresh')}>
                  <RefreshCw />
                  刷新事实
                </Button>
              ) : null}
              {(currentRequestUnresolved || hasDeliveryUnknownFailure) && event.lifecycle !== 'archived' ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void call('retry')}>
                  <RefreshCw />
                  重试当前请求
                </Button>
              ) : null}
            </>
          }
          end={
            execution?.desiredState === 'active' ? (
              <Button
                type="button"
                size="sm"
                variant="danger-soft"
                disabled={busy}
                onClick={() =>
                  requestConfirm({
                    title: '停止网络策略？',
                    description:
                      '停止命令仍需逐机执行且终端必须在线。离线终端不会被记成已释放；已整盘还原的机器先在本机运行 --network-lock-recover。',
                    confirmLabel: '确认停止',
                    tone: 'destructive',
                    facts: [
                      { label: '执行版本', value: `${execution.revision} → ${execution.revision + 1}` },
                      { label: '策略版本', value: `v${execution.networkPolicyRevision}` },
                      {
                        label: '目标终端数',
                        value: canonicalUpdatePreview?.targetDiff.beforeCount ?? execution.projection?.items.length ?? publishedTarget?.targetCount ?? '未知',
                      },
                      { label: '当前失败终端', value: failures.length ? failures.map((item) => item.endpointId).join('、') : '无' },
                      { label: '硬截止', value: formatDate(execution.hardEndAt) },
                    ],
                    run: () => call('stop', true),
                  })
                }
              >
                <Square />
                停止
              </Button>
            ) : null
          }
        />
        {activeOfflineEndpoints.length > 0 ? (
          <Alert tone="warning">
            {`${activeOfflineEndpoints.length} 台终端离线（${activeOfflineEndpoints.map((item) => item.endpointId).join('、')}）。offline 不是已释放。请等这些机器上线后再点停止；已还原或状态不可读的机器先在本机管理员运行 KryptonVigilClient.exe --network-lock-recover。`}
          </Alert>
        ) : null}
        {incompleteRelease ? (
          <Alert tone="danger">旧目标尚未完整释放。命令事实为 offline / failed 的终端硬盘里可能还有锁，不能当作已经解锁，也不能换目标后重试启动。</Alert>
        ) : null}
        <TerminalSection execution={execution} visiblePreflight={visiblePreflight} boundEndpoints={boundEndpoints} />
        {execution ? <TechDetails items={executionTechItems(execution)} /> : null}
      </div>
    </Panel>
  );
}
