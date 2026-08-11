import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CloudOff,
  FileClock,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Upload,
  Users,
} from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

type EventStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'archived';
type EventType = 'krypton' | 'external';
type SourceKind = 'classroom' | 'endpoint' | 'examSeat' | 'seat' | 'userbindGroup';

interface ExamEventView {
  eventId: string;
  schoolId: string;
  title: string;
  type: EventType;
  contestId: string | null;
  lifecycle: 'draft' | 'scheduled' | 'archived';
  status: EventStatus;
  startAt: string;
  endAt: string;
  ownerUid: number;
  collaboratorUids: number[];
  revision: number;
  updatedAt: string;
}

interface SchoolView {
  schoolId: string;
  name: string;
}

interface NetworkPolicy {
  hosts: string[];
  ips: string[];
  ports: number[];
}

interface PolicyRevision {
  revision: number;
  policy: NetworkPolicy;
  fingerprint: string;
  publishedAt: string;
}

interface PolicyTemplate {
  templateId: string;
  name: string;
  status: 'active' | 'archived';
  revision: number;
  draft: { version: number; policy: NetworkPolicy; fingerprint: string };
  revisions: PolicyRevision[];
  latestPublishedRevision: number | null;
}

interface SourceGroup {
  kind: SourceKind;
  ids: string[];
}

interface TargetRevision {
  revision: number;
  sources: SourceGroup[];
  targetFingerprint: string;
  endpointIds: string[];
  targetCount: number;
  publishedAt: string;
}

interface TargetAssignment {
  assignmentId: string;
  revision: number;
  draft: { version: number; sources: SourceGroup[] };
  revisions: TargetRevision[];
  latestPublishedRevision: number | null;
}

interface RevisionRef {
  id: string;
  revision: number;
  fingerprint: string;
}

interface NetworkConfig {
  revision: number;
  policy: RevisionRef | null;
  target: RevisionRef | null;
}

interface TargetPreview {
  previewFingerprint: string;
  endpointIds: string[];
  targetCount: number;
  addedEndpointIds: string[];
  removedEndpointIds: string[];
}

interface PreflightItem {
  endpointId: string;
  ready: boolean;
  reason: string;
  online: boolean;
  compatible: boolean | null;
  serviceVersion: string | null;
}

interface PreflightResult {
  configIdentity: string;
  items: PreflightItem[];
}

interface ProjectionItem {
  endpointId: string;
  commandId: string | null;
  command: 'apply_network_policy' | 'stop_network_policy';
  expectedPolicyRevision: number | null;
  appliedPolicyRevision: number | null;
  status: 'applied' | 'expired' | 'failed' | 'offline' | 'queued' | 'rejected' | 'sent';
  failureReason: string | null;
  online: boolean;
  networkPolicyState: { state: string; policyRevision?: number; reason?: string } | null;
}

interface NetworkExecution {
  executionId: string;
  revision: number;
  networkPolicyRevision: number;
  desiredState: 'active' | 'stopped';
  policyRef: RevisionRef;
  targetRef: RevisionRef;
  startAt: string;
  hardEndAt: string;
  operation: {
    kind: 'apply' | 'stop';
    status: 'dispatching' | 'failed' | 'received' | 'unknown';
    failureReason: string | null;
  };
  projection: {
    revision: number;
    dispatchStatus: 'complete' | 'dispatching';
    summary: Record<string, number>;
    items: ProjectionItem[];
    receivedAt: string;
  } | null;
}

interface ConfirmPlan {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'destructive';
  facts: Array<{ label: string; value: ReactNode }>;
  run: () => Promise<void>;
}

const SOURCE_LABELS: Record<SourceKind, string> = {
  classroom: '教室',
  endpoint: '指定终端',
  examSeat: '考试座位',
  seat: '实体座位',
  userbindGroup: '用户组',
};

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: '草稿',
  scheduled: '待开始',
  active: '进行中',
  ended: '已结束',
  archived: '已归档',
};

const ENDPOINT_STATUS_LABELS: Record<ProjectionItem['status'], string> = {
  applied: '已应用',
  expired: '已过期',
  failed: '应用失败',
  offline: '离线',
  queued: '待派发',
  rejected: '已拒绝',
  sent: '已送达',
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}响应格式不正确`);
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}响应格式不正确`);
  return Number(value);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label}响应格式不正确`);
  return [...value];
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function parseEvent(value: unknown): ExamEventView {
  const event = asRecord(value, '考试活动');
  const type = asString(event.type, '考试活动');
  const lifecycle = asString(event.lifecycle, '考试活动');
  const status = asString(event.status, '考试活动');
  if (
    (type !== 'krypton' && type !== 'external') ||
    !['draft', 'scheduled', 'archived'].includes(lifecycle) ||
    !Object.hasOwn(STATUS_LABELS, status)
  ) {
    throw new Error('考试活动响应格式不正确');
  }
  if (!Array.isArray(event.collaboratorUids) || event.collaboratorUids.some((uid) => !Number.isSafeInteger(uid))) {
    throw new Error('考试活动响应格式不正确');
  }
  return {
    eventId: asString(event.eventId, '考试活动'),
    schoolId: asString(event.schoolId, '考试活动'),
    title: asString(event.title, '考试活动'),
    type,
    contestId: optionalString(event.contestId, '考试活动'),
    lifecycle: lifecycle as ExamEventView['lifecycle'],
    status: status as EventStatus,
    startAt: asString(event.startAt, '考试活动'),
    endAt: asString(event.endAt, '考试活动'),
    ownerUid: asNumber(event.ownerUid, '考试活动'),
    collaboratorUids: [...event.collaboratorUids] as number[],
    revision: asNumber(event.revision, '考试活动'),
    updatedAt: asString(event.updatedAt, '考试活动'),
  };
}

function parsePolicy(value: unknown): NetworkPolicy {
  const policy = asRecord(value, '网络策略');
  if (!Array.isArray(policy.ports) || policy.ports.some((port) => !Number.isSafeInteger(port))) throw new Error('网络策略响应格式不正确');
  return { hosts: asStringArray(policy.hosts, '网络策略'), ips: asStringArray(policy.ips, '网络策略'), ports: [...policy.ports] as number[] };
}

function parseRef(value: unknown): RevisionRef | null {
  if (value === null) return null;
  const ref = asRecord(value, '版本引用');
  return { id: asString(ref.id, '版本引用'), revision: asNumber(ref.revision, '版本引用'), fingerprint: asString(ref.fingerprint, '版本引用') };
}

function parseSources(value: unknown): SourceGroup[] {
  if (!Array.isArray(value)) throw new Error('目标来源响应格式不正确');
  return value.map((item) => {
    const source = asRecord(item, '目标来源');
    const kind = asString(source.kind, '目标来源');
    if (!Object.hasOwn(SOURCE_LABELS, kind)) throw new Error('目标来源响应格式不正确');
    return { kind: kind as SourceKind, ids: asStringArray(source.ids, '目标来源') };
  });
}

function parseTemplate(value: unknown): PolicyTemplate {
  const template = asRecord(value, '策略模板');
  const draft = asRecord(template.draft, '策略草稿');
  const status = asString(template.status, '策略模板');
  if (status !== 'active' && status !== 'archived') throw new Error('策略模板响应格式不正确');
  if (!Array.isArray(template.revisions)) throw new Error('策略模板响应格式不正确');
  return {
    templateId: asString(template.templateId, '策略模板'),
    name: asString(template.name, '策略模板'),
    status,
    revision: asNumber(template.revision, '策略模板'),
    draft: { version: asNumber(draft.version, '策略草稿'), policy: parsePolicy(draft.policy), fingerprint: asString(draft.fingerprint, '策略草稿') },
    revisions: template.revisions.map((item) => {
      const revision = asRecord(item, '策略版本');
      return {
        revision: asNumber(revision.revision, '策略版本'),
        policy: parsePolicy(revision.policy),
        fingerprint: asString(revision.fingerprint, '策略版本'),
        publishedAt: asString(revision.publishedAt, '策略版本'),
      };
    }),
    latestPublishedRevision: template.latestPublishedRevision === null ? null : asNumber(template.latestPublishedRevision, '策略模板'),
  };
}

function parseAssignment(value: unknown): TargetAssignment | null {
  if (value === null) return null;
  const assignment = asRecord(value, '目标分配');
  const draft = asRecord(assignment.draft, '目标草稿');
  if (!Array.isArray(assignment.revisions)) throw new Error('目标分配响应格式不正确');
  return {
    assignmentId: asString(assignment.assignmentId, '目标分配'),
    revision: asNumber(assignment.revision, '目标分配'),
    draft: {
      version: asNumber(draft.version, '目标草稿'),
      sources: parseSources(draft.sources),
    },
    revisions: assignment.revisions.map((item) => {
      const revision = asRecord(item, '目标版本');
      return {
        revision: asNumber(revision.revision, '目标版本'),
        sources: parseSources(revision.sources),
        targetFingerprint: asString(revision.targetFingerprint, '目标版本'),
        endpointIds: asStringArray(revision.endpointIds, '目标版本'),
        targetCount: asNumber(revision.targetCount, '目标版本'),
        publishedAt: asString(revision.publishedAt, '目标版本'),
      };
    }),
    latestPublishedRevision: assignment.latestPublishedRevision === null ? null : asNumber(assignment.latestPublishedRevision, '目标分配'),
  };
}

function parseConfig(value: unknown): NetworkConfig | null {
  if (value === null) return null;
  const config = asRecord(value, '网络配置');
  return { revision: asNumber(config.revision, '网络配置'), policy: parseRef(config.policy), target: parseRef(config.target) };
}

function parseProjectionItem(value: unknown): ProjectionItem {
  const item = asRecord(value, '终端执行状态');
  const command = asString(item.command, '终端执行状态');
  const status = asString(item.status, '终端执行状态');
  if ((command !== 'apply_network_policy' && command !== 'stop_network_policy') || !Object.hasOwn(ENDPOINT_STATUS_LABELS, status)) {
    throw new Error('终端执行状态响应格式不正确');
  }
  let networkPolicyState: ProjectionItem['networkPolicyState'] = null;
  if (item.networkPolicyState !== null) {
    const state = asRecord(item.networkPolicyState, '终端网络状态');
    networkPolicyState = {
      state: asString(state.state, '终端网络状态'),
      ...(state.policyRevision === undefined ? {} : { policyRevision: asNumber(state.policyRevision, '终端网络状态') }),
      ...(state.reason === undefined ? {} : { reason: asString(state.reason, '终端网络状态') }),
    };
  }
  return {
    endpointId: asString(item.endpointId, '终端执行状态'),
    commandId: optionalString(item.commandId, '终端执行状态'),
    command,
    expectedPolicyRevision: item.expectedPolicyRevision === null ? null : asNumber(item.expectedPolicyRevision, '终端执行状态'),
    appliedPolicyRevision: item.appliedPolicyRevision === null ? null : asNumber(item.appliedPolicyRevision, '终端执行状态'),
    status: status as ProjectionItem['status'],
    failureReason: optionalString(item.failureReason, '终端执行状态'),
    online: (() => {
      if (typeof item.online !== 'boolean') throw new Error('终端执行状态响应格式不正确');
      return item.online;
    })(),
    networkPolicyState,
  };
}

function parseExecution(value: unknown): NetworkExecution | null {
  if (value === null) return null;
  const execution = asRecord(value, '网络执行');
  const operation = asRecord(execution.operation, '网络执行');
  let projection: NetworkExecution['projection'] = null;
  if (execution.projection !== null) {
    const raw = asRecord(execution.projection, '执行投影');
    if (!Array.isArray(raw.items)) throw new Error('执行投影响应格式不正确');
    const summary = asRecord(raw.summary, '执行投影');
    const canonicalSummary: Record<string, number> = {};
    for (const [key, count] of Object.entries(summary)) canonicalSummary[key] = asNumber(count, '执行投影');
    const dispatchStatus = asString(raw.dispatchStatus, '执行投影');
    if (dispatchStatus !== 'complete' && dispatchStatus !== 'dispatching') throw new Error('执行投影响应格式不正确');
    projection = {
      revision: asNumber(raw.revision, '执行投影'),
      dispatchStatus,
      summary: canonicalSummary,
      items: raw.items.map(parseProjectionItem),
      receivedAt: asString(raw.receivedAt, '执行投影'),
    };
  }
  const policyRef = parseRef(execution.policyRef);
  const targetRef = parseRef(execution.targetRef);
  const desiredState = asString(execution.desiredState, '网络执行');
  const operationKind = asString(operation.kind, '网络执行');
  const operationStatus = asString(operation.status, '网络执行');
  if (!policyRef || !targetRef) throw new Error('网络执行响应格式不正确');
  if (desiredState !== 'active' && desiredState !== 'stopped') throw new Error('网络执行响应格式不正确');
  if (operationKind !== 'apply' && operationKind !== 'stop') throw new Error('网络执行响应格式不正确');
  if (!['dispatching', 'failed', 'received', 'unknown'].includes(operationStatus)) throw new Error('网络执行响应格式不正确');
  return {
    executionId: asString(execution.executionId, '网络执行'),
    revision: asNumber(execution.revision, '网络执行'),
    networkPolicyRevision: asNumber(execution.networkPolicyRevision, '网络执行'),
    desiredState,
    policyRef,
    targetRef,
    startAt: asString(execution.startAt, '网络执行'),
    hardEndAt: asString(execution.hardEndAt, '网络执行'),
    operation: {
      kind: operationKind,
      status: operationStatus as NetworkExecution['operation']['status'],
      failureReason: optionalString(operation.failureReason, '网络执行'),
    },
    projection,
  };
}

async function apiObject(path: string, init?: RequestInit, fallback = '操作失败'): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(
    path,
    {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init?.headers || {}) },
    },
    fallback,
  );
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  const payload: unknown = await response.json().catch((error) => {
    throw new Error(`服务器返回了无法解析的响应：${error instanceof Error ? error.message : String(error)}`);
  });
  return asRecord(payload, fallback);
}

async function postJson(path: string, body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  return apiObject(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fallback);
}

function splitValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function networkConfigIdentity(config: NetworkConfig | null): string {
  if (!config?.policy || !config.target) return '';
  return [
    config.revision,
    config.policy.id,
    config.policy.revision,
    config.policy.fingerprint,
    config.target.id,
    config.target.revision,
    config.target.fingerprint,
  ].join(':');
}

function policyExpansion(current: NetworkPolicy, previous: NetworkPolicy | null): string[] {
  const added = previous
    ? [...current.hosts.filter((item) => !previous.hosts.includes(item)), ...current.ips.filter((item) => !previous.ips.includes(item))]
    : [...current.hosts, ...current.ips];
  if (!previous) {
    added.push(...(current.ports.length ? current.ports.map((port) => `端口：${port}`) : ['端口：全部端口']));
  } else if (previous.ports.length && !current.ports.length) {
    added.push('端口：全部端口');
  } else if (previous.ports.length && current.ports.length) {
    added.push(...current.ports.filter((port) => !previous.ports.includes(port)).map((port) => `端口：${port}`));
  }
  return added;
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date);
}

function statusBadge(status: EventStatus) {
  const variant = status === 'active' ? 'default' : status === 'archived' || status === 'ended' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

function MutationNotice({ error, success }: { error: string | null; success?: string | null }) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'rounded-xl border px-4 py-3 text-sm',
        error
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {error || success}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Network; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
      <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function ConfirmActionDialog({ plan, busy, error, onClose }: { plan: ConfirmPlan | null; busy: boolean; error: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && !busy && onClose()}>
      {plan ? (
        <DialogContent className="w-[min(560px,calc(100vw-1.5rem))]" onClose={busy ? undefined : onClose}>
          <DialogHeader>
            <DialogTitle>{plan.title}</DialogTitle>
            <p className="mt-1 pr-8 text-sm leading-6 text-muted-foreground">{plan.description}</p>
          </DialogHeader>
          <DialogBody className="space-y-3 px-6 py-5">
            <MutationNotice error={error} />
            {plan.facts.map((fact) => (
              <div key={fact.label} className="grid gap-1 rounded-lg border bg-muted/20 px-3 py-2 sm:grid-cols-[140px_1fr]">
                <span className="text-xs font-medium text-muted-foreground">{fact.label}</span>
                <span className="break-words text-sm">{fact.value}</span>
              </div>
            ))}
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} autoFocus onClick={onClose}>
              取消
            </Button>
            <Button type="button" variant={plan.tone === 'destructive' ? 'destructive' : 'default'} disabled={busy} onClick={() => void plan.run()}>
              {busy ? <CircleDashed className="size-4 animate-spin" /> : null}
              {plan.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function EventCreateDialog({ open, schools, onClose }: { open: boolean; schools: SchoolView[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType>('external');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const body: Record<string, unknown> = {
        schoolId: String(form.get('schoolId') || ''),
        title: String(form.get('title') || ''),
        type,
        startAt: new Date(String(form.get('startAt') || '')).toISOString(),
        endAt: new Date(String(form.get('endAt') || '')).toISOString(),
        collaboratorUids: splitValues(String(form.get('collaboratorUids') || '')).map(Number),
      };
      const contestId = String(form.get('contestId') || '').trim();
      if (contestId) body.contestId = contestId;
      const payload = await postJson('/api/admin/exam-events', body, '创建考试活动失败');
      const created = parseEvent(payload.event);
      window.location.assign(`/admin/exam-infrastructure/events/${created.eventId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建考试活动失败');
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="w-[min(720px,calc(100vw-1.5rem))]" onClose={busy ? undefined : onClose}>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>新建考试活动</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">Krypton 比赛和纯外部考试共用同一套基础设施流程。</p>
          </DialogHeader>
          <DialogBody className="space-y-5 px-6 py-5">
            <MutationNotice error={error} />
            <FormRow columns={2}>
              <FormField label="活动名称" htmlFor="new-exam-title" required>
                <Input id="new-exam-title" name="title" required maxLength={120} autoFocus />
              </FormField>
              <FormField label="学校" htmlFor="new-exam-school" required>
                <select
                  id="new-exam-school"
                  name="schoolId"
                  required
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">请选择学校</option>
                  {schools.map((school) => (
                    <option key={school.schoolId} value={school.schoolId}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="考试类型" htmlFor="new-exam-type" required>
                <select
                  id="new-exam-type"
                  value={type}
                  onChange={(event) => setType(event.target.value as EventType)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="external">外部考试</option>
                  <option value="krypton">Krypton 比赛</option>
                </select>
              </FormField>
              <FormField
                label="Contest ID"
                htmlFor="new-exam-contest"
                required={type === 'krypton'}
                hint="外部考试必须留空；Krypton 活动可先建草稿再关联。"
              >
                <Input id="new-exam-contest" name="contestId" disabled={type === 'external'} placeholder="24 位 Contest ObjectId" />
              </FormField>
              <FormField label="开始时间" htmlFor="new-exam-start" required>
                <Input id="new-exam-start" name="startAt" type="datetime-local" required />
              </FormField>
              <FormField label="硬截止时间" htmlFor="new-exam-end" required>
                <Input id="new-exam-end" name="endAt" type="datetime-local" required />
              </FormField>
            </FormRow>
            <FormField label="协作者 UID" htmlFor="new-exam-collaborators" hint="可选；用逗号或换行分隔，服务端会重新校验学校范围。">
              <Textarea id="new-exam-collaborators" name="collaboratorUids" rows={2} />
            </FormField>
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <CircleDashed className="size-4 animate-spin" /> : <Plus className="size-4" />}创建活动
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventListPage() {
  const [events, setEvents] = useState<ExamEventView[]>([]);
  const [schools, setSchools] = useState<SchoolView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let current = true;
    void apiObject('/api/admin/exam-events', undefined, '加载考试活动失败')
      .then((payload) => {
        if (!current) return;
        if (!Array.isArray(payload.events) || !Array.isArray(payload.schools)) throw new Error('考试活动响应格式不正确');
        setEvents(payload.events.map(parseEvent));
        setSchools(
          payload.schools.map((item) => {
            const school = asRecord(item, '学校');
            return { schoolId: asString(school.schoolId, '学校'), name: asString(school.name, '学校') };
          }),
        );
      })
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : '加载考试活动失败'))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, []);
  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      title="考试基础设施"
      description="统一管理 Krypton 比赛与外部考试的网络策略、目标终端和真实执行结果。"
      actions={
        !loading && !error ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新建活动
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <MutationNotice error={error} />
      ) : loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <CircleDashed className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : events.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {events.map((event) => (
            <a
              key={event.eventId}
              href={`/admin/exam-infrastructure/events/${event.eventId}`}
              className="group rounded-2xl border bg-card p-5 outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold">{event.title}</h2>
                    {statusBadge(event.status)}
                    <Badge variant="outline">{event.type === 'krypton' ? 'Krypton' : '外部考试'}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatDate(event.startAt)} → {formatDate(event.endAt)}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>活动版本 {event.revision}</span>
                <span>负责人 UID {event.ownerUid}</span>
                <span>{event.collaboratorUids.length} 名协作者</span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileClock}
          title="还没有考试活动"
          description="先创建外部考试或关联 Krypton 比赛，再逐步配置网络策略和目标终端。"
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              创建第一个活动
            </Button>
          }
        />
      )}
      <EventCreateDialog open={creating} schools={schools} onClose={() => setCreating(false)} />
    </AdminPage>
  );
}

function BasicEventSection({
  event,
  schools,
  reload,
  requestConfirm,
}: {
  event: ExamEventView;
  schools: SchoolView[];
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criticalEditable = event.lifecycle !== 'archived' && event.status !== 'active' && event.status !== 'ended';
  const mutate = async (action: 'schedule' | 'archive') => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${event.eventId}`,
        { action, expectedRevision: event.revision },
        action === 'schedule' ? '计划考试失败' : '归档考试失败',
      );
      await reload();
      setEditing(false);
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
      collaboratorUids: splitValues(String(form.get('collaboratorUids') || '')).map(Number),
    };
    if (criticalEditable) {
      const type = String(form.get('type')) as EventType;
      Object.assign(body, {
        schoolId: String(form.get('schoolId') || ''),
        type,
        contestId: type === 'krypton' ? String(form.get('contestId') || '').trim() || null : null,
        startAt: new Date(String(form.get('startAt') || '')).toISOString(),
        endAt: new Date(String(form.get('endAt') || '')).toISOString(),
      });
    }
    try {
      await postJson(`/api/admin/exam-events/${event.eventId}`, body, '保存活动信息失败');
      await reload();
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存活动信息失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle role="heading" aria-level={3}>
            1. 基本信息
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">活动时间窗和类型是后续策略执行的边界。</p>
        </div>
        {event.lifecycle === 'archived' ? (
          <Badge variant="secondary">只读归档</Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            编辑
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="类型" value={event.type === 'krypton' ? 'Krypton 比赛' : '外部考试'} />
          <Fact label="状态" value={STATUS_LABELS[event.status]} />
          <Fact label="开始" value={formatDate(event.startAt)} />
          <Fact label="硬截止" value={formatDate(event.endAt)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {event.lifecycle === 'draft' ? (
            <Button
              size="sm"
              onClick={() =>
                requestConfirm({
                  title: '计划此考试活动？',
                  description: '计划后时间窗和关键关联会受到生命周期限制。服务端会重新校验 Contest 与权限。',
                  confirmLabel: '确认计划',
                  facts: [
                    { label: '活动版本', value: `${event.revision} → ${event.revision + 1}` },
                    { label: '考试时段', value: `${formatDate(event.startAt)} → ${formatDate(event.endAt)}` },
                    { label: 'Contest', value: event.contestId || '纯外部考试' },
                  ],
                  run: () => mutate('schedule'),
                })
              }
            >
              <CheckCircle2 className="size-4" />
              计划活动
            </Button>
          ) : null}
          {event.lifecycle !== 'archived' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                requestConfirm({
                  title: '归档此活动？',
                  description: '归档是当前唯一移除路径，不会删除历史网络版本或执行事实。',
                  confirmLabel: '确认归档',
                  tone: 'destructive',
                  facts: [
                    { label: '活动', value: event.title },
                    { label: '当前状态', value: STATUS_LABELS[event.status] },
                    { label: '活动版本', value: `${event.revision} → ${event.revision + 1}` },
                  ],
                  run: () => mutate('archive'),
                })
              }
            >
              <Archive className="size-4" />
              归档
            </Button>
          ) : null}
        </div>
      </CardContent>
      <Dialog open={editing} onOpenChange={(open) => !open && !busy && setEditing(false)}>
        <DialogContent className="w-[min(760px,calc(100vw-1.5rem))]" onClose={busy ? undefined : () => setEditing(false)}>
          <form onSubmit={(formEvent) => void save(formEvent)}>
            <DialogHeader>
              <DialogTitle>编辑基本信息</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-5 px-6 py-5">
              <MutationNotice error={error} />
              {criticalEditable ? null : (
                <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  考试已经开始或结束；仅活动名称和协作者仍可维护。
                </p>
              )}
              <FormRow columns={2}>
                <FormField label="活动名称" htmlFor="edit-exam-title" required>
                  <Input id="edit-exam-title" name="title" defaultValue={event.title} required maxLength={120} autoFocus />
                </FormField>
                <FormField label="学校" htmlFor="edit-exam-school" required>
                  <select
                    id="edit-exam-school"
                    name="schoolId"
                    defaultValue={event.schoolId}
                    disabled={!criticalEditable}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {schools.map((school) => (
                      <option key={school.schoolId} value={school.schoolId}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="考试类型" htmlFor="edit-exam-type" required>
                  <select
                    id="edit-exam-type"
                    name="type"
                    defaultValue={event.type}
                    disabled={!criticalEditable}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="external">外部考试</option>
                    <option value="krypton">Krypton 比赛</option>
                  </select>
                </FormField>
                <FormField label="Contest ID" htmlFor="edit-exam-contest">
                  <Input id="edit-exam-contest" name="contestId" defaultValue={event.contestId || ''} disabled={!criticalEditable} />
                </FormField>
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
              <FormField label="协作者 UID" htmlFor="edit-exam-collaborators">
                <Textarea id="edit-exam-collaborators" name="collaboratorUids" defaultValue={event.collaboratorUids.join(', ')} rows={2} />
              </FormField>
            </DialogBody>
            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <CircleDashed className="size-4 animate-spin" /> : <Save className="size-4" />}保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/15 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function PolicySection({
  eventId,
  templates,
  config,
  readOnly,
  reload,
  requestConfirm,
}: {
  eventId: string;
  templates: PolicyTemplate[];
  config: NetworkConfig | null;
  readOnly: boolean;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected =
    selectedId === '__new__'
      ? null
      : templates.find((template) => template.templateId === selectedId) ||
        templates.find((template) => template.templateId === config?.policy?.id) ||
        templates[0] ||
        null;
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [ips, setIps] = useState('');
  const [ports, setPorts] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) {
      setName('');
      setHosts('');
      setIps('');
      setPorts('');
      return;
    }
    setSelectedId(selected.templateId);
    setName(selected.name);
    setHosts(selected.draft.policy.hosts.join('\n'));
    setIps(selected.draft.policy.ips.join('\n'));
    setPorts(selected.draft.policy.ports.join(', '));
  }, [selected?.templateId, selected?.revision]);
  const policy = (): NetworkPolicy => ({ hosts: splitValues(hosts), ips: splitValues(ips), ports: splitValues(ports).map((value) => Number(value)) });
  const dirty =
    Boolean(selected) && JSON.stringify({ name, policy: policy() }) !== JSON.stringify({ name: selected?.name, policy: selected?.draft.policy });
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-policy-templates?eventId=${encodeURIComponent(eventId)}`,
        { eventId, name, policy: policy(), collaboratorUids: [] },
        '创建策略失败',
      );
      const created = parseTemplate(payload.template);
      await reload();
      setSelectedId(created.templateId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建策略失败');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!selected) return create();
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-policy-templates/${selected.templateId}?eventId=${encodeURIComponent(eventId)}`,
        { eventId, templateId: selected.templateId, action: 'saveDraft', expectedRevision: selected.revision, name, policy: policy() },
        '保存策略草稿失败',
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存策略草稿失败');
    } finally {
      setBusy(false);
    }
  };
  const latest = selected?.revisions.find((revision) => revision.revision === selected.latestPublishedRevision) || null;
  const added = policyExpansion(policy(), latest?.policy || null);
  const publish = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-policy-templates/${selected.templateId}?eventId=${encodeURIComponent(eventId)}`,
        { eventId, templateId: selected.templateId, action: 'publish', expectedRevision: selected.revision },
        '发布策略失败',
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const assign = async (revision: PolicyRevision) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/network-config`,
        { eventId, action: 'assignPolicy', expectedRevision: config?.revision || 0, templateId: selected.templateId, revision: revision.revision },
        '分配策略失败',
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          2. 网络策略
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">草稿可反复保存；发布后版本不可变，活动只引用明确版本。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={error} />
        {readOnly ? <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">活动已归档，策略版本仅供查看。</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="策略模板" htmlFor="policy-template" className="flex-1">
            <select
              id="policy-template"
              value={selected?.templateId || '__new__'}
              disabled={readOnly}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="__new__">新建策略</option>
              {templates
                .filter((template) => template.status === 'active')
                .map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.name}
                  </option>
                ))}
            </select>
          </FormField>
          <Badge variant="outline">当前分配 v{config?.policy?.revision || '—'}</Badge>
        </div>
        <FormField label="策略名称" htmlFor="policy-name" required>
          <Input
            id="policy-name"
            value={name}
            disabled={readOnly}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="例如：CSP 考试网络"
          />
        </FormField>
        <FormRow columns={3}>
          <FormField label="允许域名" htmlFor="policy-hosts" hint="每行一个精确域名或 *.example.com">
            <Textarea id="policy-hosts" value={hosts} disabled={readOnly} onChange={(event) => setHosts(event.target.value)} rows={5} />
          </FormField>
          <FormField label="允许 IP / CIDR" htmlFor="policy-ips" hint="每行一个 IPv4、IPv6 或 CIDR">
            <Textarea id="policy-ips" value={ips} disabled={readOnly} onChange={(event) => setIps(event.target.value)} rows={5} />
          </FormField>
          <FormField label="允许端口" htmlFor="policy-ports" hint="逗号或换行分隔">
            <Textarea id="policy-ports" value={ports} disabled={readOnly} onChange={(event) => setPorts(event.target.value)} rows={5} />
          </FormField>
        </FormRow>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly || busy || !name.trim() || (Boolean(selected) && !dirty)}
            onClick={() => void save()}
          >
            {busy ? <CircleDashed className="size-4 animate-spin" /> : <Save className="size-4" />}
            {selected ? '保存草稿' : '创建策略'}
          </Button>
          {selected ? (
            <Button
              size="sm"
              disabled={readOnly || busy || dirty}
              title={dirty ? '请先保存草稿，再发布服务端 canonical 版本' : undefined}
              onClick={() =>
                requestConfirm({
                  title: '发布不可变策略版本？',
                  description: added.length
                    ? '本次策略增加了允许项，会放宽终端可访问范围。发布只生成版本，不会自动下发。'
                    : '发布只生成不可变版本，不会自动下发到终端。',
                  confirmLabel: '确认发布',
                  tone: added.length ? 'destructive' : 'default',
                  facts: [
                    { label: '模板版本', value: `${selected.revision} → ${selected.revision + 1}` },
                    { label: '发布策略版本', value: `v${(selected.latestPublishedRevision || 0) + 1}` },
                    { label: '新增允许项', value: added.length ? added.join('、') : '无' },
                    { label: '目标终端', value: '尚未下发；需后续明确分配并启动' },
                  ],
                  run: publish,
                })
              }
            >
              <Upload className="size-4" />
              发布版本
            </Button>
          ) : null}
          {dirty ? <span className="text-xs text-amber-700 dark:text-amber-300">有未保存修改</span> : null}
        </div>
        {selected?.revisions.length ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">已发布版本</p>
            {[...selected.revisions].reverse().map((revision) => (
              <div key={revision.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                <div>
                  <span className="text-sm font-medium">v{revision.revision}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{formatDate(revision.publishedAt)}</span>
                </div>
                <Button
                  size="sm"
                  variant={config?.policy?.id === selected.templateId && config.policy.revision === revision.revision ? 'secondary' : 'outline'}
                  disabled={readOnly || busy || (config?.policy?.id === selected.templateId && config.policy.revision === revision.revision)}
                  onClick={() =>
                    requestConfirm({
                      title: '分配此策略版本？',
                      description: '活动配置会通过 CAS 更新；已存在的执行仍固定使用启动时版本。',
                      confirmLabel: '确认分配',
                      facts: [
                        { label: '策略', value: `${selected.name} · v${revision.revision}` },
                        { label: '配置版本', value: `${config?.revision || 0} → ${(config?.revision || 0) + 1}` },
                        { label: '策略指纹', value: revision.fingerprint.slice(0, 16) },
                        { label: '执行影响', value: '不会自动启动或热更新' },
                      ],
                      run: () => assign(revision),
                    })
                  }
                >
                  {config?.policy?.id === selected.templateId && config.policy.revision === revision.revision ? '已分配' : '分配'}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TargetSection({
  eventId,
  assignment,
  config,
  readOnly,
  reload,
  requestConfirm,
}: {
  eventId: string;
  assignment: TargetAssignment | null;
  config: NetworkConfig | null;
  readOnly: boolean;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  const initialEndpoints = () => assignment?.draft.sources.find((source) => source.kind === 'endpoint')?.ids.join('\n') || '';
  const [endpointIds, setEndpointIds] = useState(initialEndpoints);
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEndpointIds(initialEndpoints());
  }, [assignment?.revision]);
  const sources = (): SourceGroup[] => {
    const ids = splitValues(endpointIds);
    return ids.length ? [{ kind: 'endpoint', ids }] : [];
  };
  const savedEndpointIds = [...(assignment?.draft.sources.find((source) => source.kind === 'endpoint')?.ids || [])].sort();
  const targetDirty = JSON.stringify([...splitValues(endpointIds)].sort()) !== JSON.stringify(savedEndpointIds);
  const save = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'saveDraft', expectedRevision: assignment?.revision || 0, sources: sources() },
        '保存目标来源失败',
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存目标来源失败');
    } finally {
      setBusy(false);
    }
  };
  const previewTargets = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'preview', expectedRevision: assignment?.revision || 0 },
        '预检目标失败',
      );
      const raw = asRecord(payload.preview, '目标预览');
      setPreview({
        previewFingerprint: asString(raw.previewFingerprint, '目标预览'),
        endpointIds: asStringArray(raw.endpointIds, '目标预览'),
        targetCount: asNumber(raw.targetCount, '目标预览'),
        addedEndpointIds: asStringArray(raw.addedEndpointIds, '目标预览'),
        removedEndpointIds: asStringArray(raw.removedEndpointIds, '目标预览'),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '预检目标失败');
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/target-assignment`,
        { eventId, action: 'publish', expectedRevision: assignment?.revision || 0, confirmationFingerprint: preview.previewFingerprint },
        '发布目标快照失败',
      );
      setPreview(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const assign = async (revision: TargetRevision) => {
    if (!assignment) return;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          3. 目标终端
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">保存动态来源后必须重新预览；发布只冻结显式 endpoint 快照。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={error} />
        {readOnly ? <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">活动已归档，目标快照仅供查看。</p> : null}
        <FormField label="指定终端" htmlFor="target-endpoint" hint="每行一个已完成入网的 Endpoint ID">
          <Textarea
            id="target-endpoint"
            value={endpointIds}
            disabled={readOnly}
            onChange={(event) => {
              setEndpointIds(event.target.value);
              setPreview(null);
            }}
            rows={4}
          />
        </FormField>
        <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
          教室、实体座位、考试座位和用户组需等待对应 canonical 上线；当前不作为可提交的目标来源。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={readOnly || busy || (Boolean(assignment) && !targetDirty)} onClick={() => void save()}>
            <Save className="size-4" />
            保存来源
          </Button>
          <Button
            size="sm"
            disabled={readOnly || busy || !assignment || targetDirty}
            title={targetDirty ? '请先保存来源，再解析服务端 canonical 草稿' : undefined}
            onClick={() => void previewTargets()}
          >
            {busy ? <CircleDashed className="size-4 animate-spin" /> : <Users className="size-4" />}重新解析
          </Button>
          {targetDirty ? <span className="text-xs text-amber-700 dark:text-amber-300">有未保存修改，请先保存再解析</span> : null}
        </div>
        {preview ? (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">解析到 {preview.targetCount} 台终端</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  新增 {preview.addedEndpointIds.length} · 移除 {preview.removedEndpointIds.length}
                </p>
              </div>
              <Button
                size="sm"
                disabled={readOnly}
                onClick={() =>
                  requestConfirm({
                    title: '发布目标终端快照？',
                    description: '发布时服务端会再次解析来源；只要来源或能力发生漂移就会拒绝。',
                    confirmLabel: '确认发布',
                    facts: [
                      { label: '目标草稿版本', value: `${assignment?.revision || 0} → ${(assignment?.revision || 0) + 1}` },
                      { label: '发布目标版本', value: `v${(assignment?.latestPublishedRevision || 0) + 1}` },
                      { label: '目标终端数', value: preview.targetCount },
                      { label: '新增终端', value: preview.addedEndpointIds.length ? preview.addedEndpointIds.join('、') : '无' },
                      { label: '移除终端', value: preview.removedEndpointIds.length ? preview.removedEndpointIds.join('、') : '无' },
                      { label: '分配影响', value: '不会自动启动或修改当前执行' },
                    ],
                    run: publish,
                  })
                }
              >
                <Upload className="size-4" />
                发布快照
              </Button>
            </div>
          </div>
        ) : null}
        {assignment?.revisions.length ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">已发布快照</p>
            {[...assignment.revisions].reverse().map((revision) => (
              <div key={revision.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                <div>
                  <span className="text-sm font-medium">
                    v{revision.revision} · {revision.targetCount} 台
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">{formatDate(revision.publishedAt)}</span>
                </div>
                <Button
                  size="sm"
                  variant={config?.target?.id === assignment.assignmentId && config.target.revision === revision.revision ? 'secondary' : 'outline'}
                  disabled={readOnly || busy || (config?.target?.id === assignment.assignmentId && config.target.revision === revision.revision)}
                  onClick={() =>
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
                    })
                  }
                >
                  {config?.target?.id === assignment.assignmentId && config.target.revision === revision.revision ? '已分配' : '分配'}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExecutionSection({
  event,
  config,
  assignment,
  execution,
  reload,
  requestConfirm,
}: {
  event: ExamEventView;
  config: NetworkConfig | null;
  assignment: TargetAssignment | null;
  execution: NetworkExecution | null;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  const configIdentity = networkConfigIdentity(config);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const visiblePreflight = preflight?.configIdentity === configIdentity ? preflight.items : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (action: 'preflight' | 'refresh' | 'retry' | 'start' | 'stop', rethrow = false, expectedConfigRevision?: number) => {
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
      if (action === 'preflight') {
        if (!Array.isArray(payload.preflight)) throw new Error('预检响应格式不正确');
        const preflightConfig = parseConfig(payload.preflightConfig);
        if (!preflightConfig?.policy || !preflightConfig.target) throw new Error('预检配置身份不正确');
        const items = payload.preflight.map((value) => {
          const item = asRecord(value, '预检');
          if (
            typeof item.ready !== 'boolean' ||
            typeof item.online !== 'boolean' ||
            (item.compatible !== null && typeof item.compatible !== 'boolean')
          ) {
            throw new Error('预检响应格式不正确');
          }
          return {
            endpointId: asString(item.endpointId, '预检'),
            ready: item.ready,
            reason: asString(item.reason, '预检'),
            online: item.online,
            compatible: item.compatible,
            serviceVersion: optionalString(item.serviceVersion, '预检'),
          };
        });
        setPreflight({ configIdentity: networkConfigIdentity(preflightConfig), items });
      }
      await reload();
    } catch (cause) {
      if (!rethrow) setError(cause instanceof Error ? cause.message : '网络操作失败');
      if (rethrow) throw cause;
    } finally {
      setBusy(false);
    }
  };
  const target = assignment?.revisions.find((revision) => revision.revision === config?.target?.revision) || null;
  const failures =
    execution?.projection?.items.filter(
      (item) => item.status === 'failed' || item.status === 'offline' || item.status === 'rejected' || item.status === 'expired',
    ) || [];
  const runnable = event.lifecycle === 'scheduled' && event.status !== 'ended';
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          4. 预检、启停与结果
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">“已送达”不等于“已应用”；此处只展示 Vigil 返回并由 OJ 持久化的逐机事实。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={error} />
        {!config?.policy || !config.target ? (
          <EmptyState icon={AlertTriangle} title="网络配置尚未完成" description="先分配一个已发布策略版本和目标快照，再进行预检。" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy || !runnable} onClick={() => void call('preflight')}>
                <ShieldCheck className="size-4" />
                终端预检
              </Button>
              {execution?.desiredState !== 'active' ? (
                <Button
                  size="sm"
                  disabled={busy || !runnable}
                  onClick={() =>
                    requestConfirm({
                      title: '启动网络策略？',
                      description: '命令会逐机持久化并派发。页面返回或传输成功不代表终端已经应用。',
                      confirmLabel: '确认启动',
                      facts: [
                        { label: '执行版本', value: `${execution?.revision || 0} → ${(execution?.revision || 0) + 1}` },
                        { label: '策略版本', value: `v${config.policy!.revision}` },
                        { label: '目标终端数', value: target?.targetCount ?? '未知' },
                        { label: '硬截止', value: formatDate(event.endAt) },
                        { label: '目标变化', value: target ? `${target.endpointIds.length} 台固定快照` : '无法确认' },
                      ],
                      run: () => call('start', true, config.revision),
                    })
                  }
                >
                  <Play className="size-4" />
                  启动
                </Button>
              ) : null}
              {execution ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void call('refresh')}>
                  <RefreshCw className="size-4" />
                  刷新事实
                </Button>
              ) : null}
              {(execution?.operation.status === 'failed' || execution?.operation.status === 'unknown') && event.lifecycle !== 'archived' ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void call('retry')}>
                  <RefreshCw className="size-4" />
                  重试派发
                </Button>
              ) : null}
              {execution?.desiredState === 'active' ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    requestConfirm({
                      title: '停止网络策略？',
                      description: '停止命令仍需逐机执行；离线或失败终端不会被伪装成已解锁，硬截止保持不变。',
                      confirmLabel: '确认停止',
                      tone: 'destructive',
                      facts: [
                        { label: '执行版本', value: `${execution.revision} → ${execution.revision + 1}` },
                        { label: '策略版本', value: `v${execution.networkPolicyRevision}` },
                        { label: '目标终端数', value: target?.targetCount ?? execution.projection?.items.length ?? '未知' },
                        { label: '当前失败终端', value: failures.length ? failures.map((item) => item.endpointId).join('、') : '无' },
                        { label: '硬截止', value: formatDate(execution.hardEndAt) },
                      ],
                      run: () => call('stop', true),
                    })
                  }
                >
                  <Square className="size-4" />
                  停止
                </Button>
              ) : null}
            </div>
            {visiblePreflight ? (
              <div className="rounded-xl border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">预检结果</p>
                  <Badge variant={visiblePreflight.every((item) => item.ready) ? 'default' : 'destructive'}>
                    {visiblePreflight.filter((item) => item.ready).length}/{visiblePreflight.length} 就绪
                  </Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {visiblePreflight.map((item) => (
                    <div key={item.endpointId} className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{item.endpointId}</span>
                        <Badge variant={item.ready ? 'outline' : 'destructive'}>{item.ready ? '就绪' : item.reason}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.online ? '在线' : '离线'} · Service {item.serviceVersion || '未知'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {execution ? (
              <ExecutionFacts execution={execution} />
            ) : (
              <EmptyState icon={CloudOff} title="尚未启动网络策略" description="预检只检查终端状态，不会创建执行或下发命令。" />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionFacts({ execution }: { execution: NetworkExecution }) {
  const projection = execution.projection;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="期望状态" value={execution.desiredState === 'active' ? '启用' : '停止'} />
        <Fact
          label="派发状态"
          value={
            execution.operation.status === 'received'
              ? '已收到投影'
              : execution.operation.status === 'dispatching'
                ? '派发中'
                : execution.operation.status === 'unknown'
                  ? '结果未知'
                  : '派发失败'
          }
        />
        <Fact label="策略版本" value={`v${execution.networkPolicyRevision}`} />
        <Fact label="硬截止" value={formatDate(execution.hardEndAt)} />
      </div>
      {execution.operation.failureReason ? <MutationNotice error={execution.operation.failureReason} /> : null}
      {projection ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">逐终端执行事实</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(projection.summary).map(([status, count]) => (
                <Badge key={status} variant="outline">
                  {status} {count}
                </Badge>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>终端</TableHead>
                  <TableHead>连接</TableHead>
                  <TableHead>命令事实</TableHead>
                  <TableHead>策略版本</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projection.items.map((item) => (
                  <TableRow key={item.endpointId}>
                    <TableCell className="font-mono text-xs">{item.endpointId}</TableCell>
                    <TableCell>{item.online ? '在线' : '离线'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === 'applied' ? 'default' : item.status === 'failed' || item.status === 'rejected' ? 'destructive' : 'outline'
                        }
                      >
                        {ENDPOINT_STATUS_LABELS[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      期望 {item.expectedPolicyRevision ?? '—'} / 实际 {item.appliedPolicyRevision ?? item.networkPolicyState?.policyRevision ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-64 text-xs text-muted-foreground">
                      {item.failureReason || item.networkPolicyState?.reason || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <EmptyState icon={CircleDashed} title="等待执行投影" description="命令请求已经持久化，但尚未收到可展示的逐机事实。" />
      )}
    </div>
  );
}

function EventDetailPage({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<ExamEventView | null>(null);
  const [schools, setSchools] = useState<SchoolView[]>([]);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [assignment, setAssignment] = useState<TargetAssignment | null>(null);
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [execution, setExecution] = useState<NetworkExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ConfirmPlan | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const detail = await apiObject(`/api/admin/exam-events/${eventId}`, undefined, '加载考试活动失败');
    const parsedEvent = parseEvent(detail.event);
    if (!Array.isArray(detail.schools)) throw new Error('学校响应格式不正确');
    const [policyPayload, targetPayload, configPayload, executionPayload] = await Promise.all([
      apiObject(`/api/admin/exam-policy-templates?eventId=${encodeURIComponent(eventId)}`, undefined, '加载策略失败'),
      apiObject(`/api/admin/exam-events/${eventId}/target-assignment`, undefined, '加载目标失败'),
      apiObject(`/api/admin/exam-events/${eventId}/network-config`, undefined, '加载网络配置失败'),
      apiObject(`/api/admin/exam-events/${eventId}/network-execution`, undefined, '加载执行事实失败'),
    ]);
    if (!Array.isArray(policyPayload.templates)) throw new Error('策略响应格式不正确');
    setEvent(parsedEvent);
    setSchools(
      detail.schools.map((item) => {
        const school = asRecord(item, '学校');
        return { schoolId: asString(school.schoolId, '学校'), name: asString(school.name, '学校') };
      }),
    );
    setTemplates(policyPayload.templates.map(parseTemplate));
    setAssignment(parseAssignment(targetPayload.assignment));
    setConfig(parseConfig(configPayload.config));
    setExecution(parseExecution(executionPayload.execution));
  }, [eventId]);
  useEffect(() => {
    let current = true;
    void reload()
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : '加载考试基础设施失败'))
      .finally(() => current && setLoading(false));
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
  if (loading) {
    return (
      <AdminPage bypassPrivGate hideSidebar>
        <div className="flex min-h-64 items-center justify-center">
          <CircleDashed className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AdminPage>
    );
  }
  if (!event || error) {
    return (
      <AdminPage bypassPrivGate hideSidebar title="考试基础设施">
        <MutationNotice error={error || '考试活动不存在或无权访问'} />
      </AdminPage>
    );
  }
  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      title={
        <div>
          <a
            href="/admin/exam-infrastructure"
            className="mb-2 inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            返回活动列表
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{event.title}</h1>
            {statusBadge(event.status)}
            <Badge variant="outline">{event.type === 'krypton' ? 'Krypton' : '外部考试'}</Badge>
          </div>
        </div>
      }
      description={`活动版本 ${event.revision} · 配置版本 ${config?.revision || 0} · 所有写入仍由服务端 CAS 与权限边界确认。`}
    >
      <div className="space-y-4 pb-10">
        <BasicEventSection event={event} schools={schools} reload={reload} requestConfirm={runPlan} />
        <PolicySection
          eventId={eventId}
          templates={templates}
          config={config}
          readOnly={event.lifecycle === 'archived'}
          reload={reload}
          requestConfirm={runPlan}
        />
        <TargetSection
          eventId={eventId}
          assignment={assignment}
          config={config}
          readOnly={event.lifecycle === 'archived'}
          reload={reload}
          requestConfirm={runPlan}
        />
        <ExecutionSection event={event} config={config} assignment={assignment} execution={execution} reload={reload} requestConfirm={runPlan} />
      </div>
      <ConfirmActionDialog plan={plan} busy={confirmBusy} error={confirmError} onClose={closePlan} />
    </AdminPage>
  );
}

export function ExamInfrastructurePage() {
  const bs = useBootstrap();
  if (!bs.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = asRecord(bs.page.data, '考试基础设施页面');
  if (data.eventId !== null) throw new Error('考试基础设施列表页响应格式不正确');
  return <EventListPage />;
}

export function ExamEventPage() {
  const bs = useBootstrap();
  if (!bs.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = asRecord(bs.page.data, '考试活动页面');
  const eventId = asString(data.eventId, '考试活动页面');
  if (!eventId) throw new Error('考试活动页面响应格式不正确');
  return <EventDetailPage eventId={eventId} />;
}
