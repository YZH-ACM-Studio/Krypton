import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { DomainUserSearchOption, domainUserSearchLabel, loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { ClassroomLauncher } from '@/pages/exam-classroom';

type EventStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'archived';
type EventType = 'krypton' | 'external';
type SourceKind = 'classroom' | 'endpoint' | 'examSeat' | 'seat' | 'userbindGroup';
type EventPanel = 'basics' | 'policy' | 'targets' | 'run';

interface ContestOption {
  contestId: string;
  title: string;
  beginAt: string;
  endAt: string;
}

interface BoundEndpointOption {
  endpointId: string;
  label: string;
}

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

interface ClassroomSummary {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  seatCount: number;
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

interface ExamPreparationSummary {
  assignment: {
    id: string;
    revision: number;
    fingerprint: string;
    roster: RevisionRef;
  } | null;
  publicationRevision: number;
  batch: {
    id: string;
    revision: number;
    projectionRevision: number | null;
    state: 'dispatching' | 'dispatched';
    ticketCount: number;
    workflow: {
      executionRevision: number;
      policyRevision: number;
      targetRevision: number;
    } | null;
  } | null;
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
  previousPolicyRevision: number | null;
  expectedPolicyRevision: number | null;
  appliedPolicyRevision: number | null;
  status: 'applied' | 'expired' | 'failed' | 'offline' | 'queued' | 'rejected' | 'sent';
  failureReason: string | null;
  online: boolean;
  networkPolicyState: { state: string; policyRevision?: number; reason?: string } | null;
}

interface NetworkUpdatePreview {
  executionRevision: number;
  configRevision: number;
  fromPolicyRef: RevisionRef;
  toPolicyRef: RevisionRef;
  fromTargetRef: RevisionRef;
  toTargetRef: RevisionRef;
  previousNetworkPolicyRevision: number;
  expectedNetworkPolicyRevision: number;
  policyDiff: {
    effect: 'loosening' | 'mixed' | 'tightening' | 'unchanged';
    addedHosts: string[];
    removedHosts: string[];
    addedIps: string[];
    removedIps: string[];
    beforePorts: number[];
    afterPorts: number[];
  };
  targetDiff: {
    beforeCount: number;
    afterCount: number;
    addedEndpointIds: string[];
    removedEndpointIds: string[];
  };
  requiresStop: boolean;
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

interface ConfirmFact {
  label: string;
  value: ReactNode;
}

interface ConfirmPlan {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'destructive';
  facts: ConfirmFact[];
  details?: ConfirmFact[];
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

const DELIVERY_UNKNOWN_FAILURE_REASON = 'transport_send_failed_delivery_unknown';

const EVENT_PANELS: Array<{ id: EventPanel; label: string }> = [
  { id: 'basics', label: '基本信息' },
  { id: 'policy', label: '网络策略' },
  { id: 'targets', label: '目标终端' },
  { id: 'run', label: '预检与执行' },
];

function isRetryableProjectionItem(item: ProjectionItem): boolean {
  return ['expired', 'failed', 'offline', 'rejected'].includes(item.status) && item.failureReason !== DELIVERY_UNKNOWN_FAILURE_REASON;
}

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

function parsePreparationSummary(value: unknown): ExamPreparationSummary {
  const summary = asRecord(value, '考试准备摘要');
  let assignment: ExamPreparationSummary['assignment'] = null;
  if (summary.assignment !== null) {
    const rawAssignment = asRecord(summary.assignment, '发布座位分配');
    const roster = parseRef(rawAssignment.roster);
    if (!roster) throw new Error('发布座位分配响应格式不正确');
    assignment = {
      id: asString(rawAssignment.id, '发布座位分配'),
      revision: asNumber(rawAssignment.revision, '发布座位分配'),
      fingerprint: asString(rawAssignment.fingerprint, '发布座位分配'),
      roster,
    };
  }
  let batch: ExamPreparationSummary['batch'] = null;
  if (summary.batch !== null) {
    const rawBatch = asRecord(summary.batch, '预登录批次');
    const state = asString(rawBatch.state, '预登录批次');
    if (state !== 'dispatching' && state !== 'dispatched') throw new Error('预登录批次响应格式不正确');
    const rawWorkflow = rawBatch.workflow === null ? null : asRecord(rawBatch.workflow, '预登录批次网络版本');
    batch = {
      id: asString(rawBatch.id, '预登录批次'),
      revision: asNumber(rawBatch.revision, '预登录批次'),
      projectionRevision: rawBatch.projectionRevision === null ? null : asNumber(rawBatch.projectionRevision, '预登录批次'),
      state,
      ticketCount: asNumber(rawBatch.ticketCount, '预登录批次'),
      workflow: rawWorkflow
        ? {
            executionRevision: asNumber(rawWorkflow.executionRevision, '预登录批次网络版本'),
            policyRevision: asNumber(rawWorkflow.policyRevision, '预登录批次网络版本'),
            targetRevision: asNumber(rawWorkflow.targetRevision, '预登录批次网络版本'),
          }
        : null,
    };
  }
  return { assignment, publicationRevision: asNumber(summary.publicationRevision, '考试准备摘要'), batch };
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
    previousPolicyRevision: item.previousPolicyRevision === null ? null : asNumber(item.previousPolicyRevision, '终端执行状态'),
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

function parseNetworkUpdatePreview(value: unknown): NetworkUpdatePreview | null {
  if (value === null) return null;
  const preview = asRecord(value, '热更新预览');
  const policyDiff = asRecord(preview.policyDiff, '策略差异');
  const targetDiff = asRecord(preview.targetDiff, '目标差异');
  const effect = asString(policyDiff.effect, '策略差异');
  if (!['loosening', 'mixed', 'tightening', 'unchanged'].includes(effect) || typeof preview.requiresStop !== 'boolean') {
    throw new Error('热更新预览响应格式不正确');
  }
  const numberArray = (candidate: unknown, label: string): number[] => {
    if (!Array.isArray(candidate) || candidate.some((item) => !Number.isSafeInteger(item))) throw new Error(`${label}响应格式不正确`);
    return [...candidate] as number[];
  };
  const fromPolicyRef = parseRef(preview.fromPolicyRef);
  const toPolicyRef = parseRef(preview.toPolicyRef);
  const fromTargetRef = parseRef(preview.fromTargetRef);
  const toTargetRef = parseRef(preview.toTargetRef);
  if (!fromPolicyRef || !toPolicyRef || !fromTargetRef || !toTargetRef) throw new Error('热更新预览响应格式不正确');
  return {
    executionRevision: asNumber(preview.executionRevision, '热更新预览'),
    configRevision: asNumber(preview.configRevision, '热更新预览'),
    fromPolicyRef,
    toPolicyRef,
    fromTargetRef,
    toTargetRef,
    previousNetworkPolicyRevision: asNumber(preview.previousNetworkPolicyRevision, '热更新预览'),
    expectedNetworkPolicyRevision: asNumber(preview.expectedNetworkPolicyRevision, '热更新预览'),
    policyDiff: {
      effect: effect as NetworkUpdatePreview['policyDiff']['effect'],
      addedHosts: asStringArray(policyDiff.addedHosts, '策略差异'),
      removedHosts: asStringArray(policyDiff.removedHosts, '策略差异'),
      addedIps: asStringArray(policyDiff.addedIps, '策略差异'),
      removedIps: asStringArray(policyDiff.removedIps, '策略差异'),
      beforePorts: numberArray(policyDiff.beforePorts, '策略差异'),
      afterPorts: numberArray(policyDiff.afterPorts, '策略差异'),
    },
    targetDiff: {
      beforeCount: asNumber(targetDiff.beforeCount, '目标差异'),
      afterCount: asNumber(targetDiff.afterCount, '目标差异'),
      addedEndpointIds: asStringArray(targetDiff.addedEndpointIds, '目标差异'),
      removedEndpointIds: asStringArray(targetDiff.removedEndpointIds, '目标差异'),
    },
    requiresStop: preview.requiresStop,
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

function sameRevisionRef(left: RevisionRef | null, right: RevisionRef | null): boolean {
  return Boolean(left && right && left.id === right.id && left.revision === right.revision && left.fingerprint === right.fingerprint);
}

function visibleNetworkUpdatePreview(
  preview: NetworkUpdatePreview | null,
  config: NetworkConfig | null,
  execution: NetworkExecution | null,
): NetworkUpdatePreview | null {
  if (
    !preview ||
    !config?.policy ||
    !config.target ||
    !execution ||
    preview.configRevision !== config.revision ||
    preview.executionRevision !== execution.revision ||
    !sameRevisionRef(preview.fromPolicyRef, execution.policyRef) ||
    !sameRevisionRef(preview.toPolicyRef, config.policy) ||
    !sameRevisionRef(preview.fromTargetRef, execution.targetRef) ||
    !sameRevisionRef(preview.toTargetRef, config.target)
  ) {
    return null;
  }
  return preview;
}

function policyEffectLabel(effect: NetworkUpdatePreview['policyDiff']['effect']): string {
  if (effect === 'loosening') return '放宽';
  if (effect === 'tightening') return '收紧';
  if (effect === 'mixed') return '同时收紧与放宽';
  return '规则等价';
}

function formatPorts(ports: number[]): string {
  return ports.length ? ports.join('、') : '全部端口';
}

function policyDiffFacts(diff: NetworkUpdatePreview['policyDiff']): Array<{ label: string; value: ReactNode }> {
  const addedRules = [...diff.addedHosts.map((item) => `域名 ${item}`), ...diff.addedIps.map((item) => `IP ${item}`)];
  const removedRules = [...diff.removedHosts.map((item) => `域名 ${item}`), ...diff.removedIps.map((item) => `IP ${item}`)];
  return [
    { label: '变化方向', value: policyEffectLabel(diff.effect) },
    { label: '新增允许规则', value: addedRules.length ? addedRules.join('、') : '无' },
    { label: '移除允许规则', value: removedRules.length ? removedRules.join('、') : '无' },
    { label: '端口变化', value: `${formatPorts(diff.beforePorts)} → ${formatPorts(diff.afterPorts)}` },
  ];
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

function parseContestOption(value: unknown, contestId?: string): ContestOption {
  const contest = asRecord(value, '比赛');
  const title = asString(contest.title, '比赛').trim();
  if (!title) throw new Error('比赛响应格式不正确');
  return {
    contestId: contestId || asString(contest.docId, '比赛'),
    title,
    beginAt: asString(contest.beginAt, '比赛'),
    endAt: asString(contest.endAt, '比赛'),
  };
}

async function searchContests(query: string): Promise<ContestOption[]> {
  const payload = await apiObject(`/contest?q=${encodeURIComponent(query)}`, undefined, '搜索比赛失败');
  if (!Array.isArray(payload.tdocs)) throw new Error('比赛响应格式不正确');
  return payload.tdocs.map((item) => parseContestOption(item));
}

async function loadContestOption(contestId: string): Promise<ContestOption> {
  const payload = await apiObject(`/contest/${encodeURIComponent(contestId)}`, undefined, '加载比赛失败');
  return parseContestOption(payload.tdoc, contestId);
}

function collaboratorsFromUids(uids: number[]): DomainUserOption[] {
  return uids.map((uid) => ({ _id: uid }));
}

async function hydrateCollaborators(domainId: string, uids: number[]): Promise<DomainUserOption[]> {
  return Promise.all(
    uids.map(async (uid) => {
      try {
        const users = await loadDomainUsers(domainId, String(uid));
        const match = users.find((user) => user._id === uid);
        if (match && (match.displayName || match.uname)) return match;
      } catch {
        // Chip falls back to an explicit unavailable label; do not invent a name.
      }
      return { _id: uid };
    }),
  );
}

function collaboratorChipLabel(user: DomainUserOption): string {
  return user.displayName || user.uname || '协作者（名称不可用）';
}

function contestTitleFact(contestId: string | null, option: ContestOption | null, unavailable: boolean): string {
  if (!contestId) return '纯外部考试';
  if (option?.title) return option.title;
  return unavailable ? '比赛标题不可用' : '加载比赛…';
}

function readEventPanel(): EventPanel {
  const url = new URL(window.location.href);
  const panel = url.searchParams.get('panel');
  if (panel === 'basics' || panel === 'policy' || panel === 'targets' || panel === 'run') return panel;
  if (url.hash === '#target-assignment' || url.searchParams.get('examSeatAssignmentId')) return 'targets';
  return 'basics';
}

function writeEventPanel(panel: EventPanel) {
  const url = new URL(window.location.href);
  if (panel === 'basics') url.searchParams.delete('panel');
  else url.searchParams.set('panel', panel);
  url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
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
            {plan.details?.length ? (
              <details className="rounded-lg border bg-muted/10 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">详细标识</summary>
                <div className="mt-2 space-y-2">
                  {plan.details.map((fact) => (
                    <div key={fact.label} className="grid gap-1 sm:grid-cols-[140px_1fr]">
                      <span className="text-xs font-medium text-muted-foreground">{fact.label}</span>
                      <span className="break-words font-mono text-xs">{fact.value}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
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

function EventStepNav({ panel, onChange }: { panel: EventPanel; onChange: (panel: EventPanel) => void }) {
  return (
    <nav
      aria-label="考试活动步骤"
      className="mb-6 grid auto-cols-[minmax(11rem,1fr)] grid-flow-col overflow-x-auto border-y border-border/70"
    >
      {EVENT_PANELS.map((stage, index) => (
        <Button
          key={stage.id}
          type="button"
          variant="ghost"
          className={cn(
            "relative min-h-14 justify-start gap-3 rounded-none px-3 text-left after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:content-['']",
            panel === stage.id
              ? 'text-foreground after:bg-primary hover:bg-muted/40'
              : 'text-muted-foreground after:bg-transparent hover:text-foreground',
          )}
          aria-current={panel === stage.id ? 'step' : undefined}
          onClick={() => onChange(stage.id)}
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full border text-xs tabular-nums',
              panel === stage.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-background',
            )}
          >
            {index + 1}
          </span>
          <span className="whitespace-nowrap text-sm font-medium">{stage.label}</span>
        </Button>
      ))}
    </nav>
  );
}

function ContestSearchSelect({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (contestId: string, option: ContestOption | null) => void;
}) {
  const [known, setKnown] = useState<ContestOption | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [titleState, setTitleState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  useEffect(() => {
    if (!value) {
      setKnown(null);
      setTitleState('idle');
      return;
    }
    if (known?.contestId === value) {
      setTitleState('idle');
      return;
    }
    let current = true;
    setTitleState('loading');
    void loadContestOption(value)
      .then((option) => {
        if (!current) return;
        setKnown(option);
        setTitleState('idle');
      })
      .catch(() => {
        if (!current) return;
        setKnown(null);
        setTitleState('unavailable');
      });
    return () => {
      current = false;
    };
  }, [known, value]);
  const current =
    known && known.contestId === value
      ? known
      : value
        ? {
            contestId: value,
            title: titleState === 'unavailable' ? '比赛标题不可用' : '加载比赛…',
            beginAt: '',
            endAt: '',
          }
        : null;
  return (
    <div className="space-y-2">
      <MutationNotice error={searchError} />
      <div role="group" aria-label="Krypton 比赛" aria-disabled={disabled || undefined}>
        <MultiSelect<ContestOption>
          value={current ? [current] : []}
          onChange={(items) => {
            const next = items[0] || null;
            setKnown(next);
            setSearchError(null);
            setTitleState('idle');
            onChange(next?.contestId || '', next);
          }}
          loadOptions={async (query) => {
            setSearchError(null);
            try {
              return await searchContests(query);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : '搜索比赛失败';
              setSearchError(message);
              throw cause;
            }
          }}
          getKey={(item) => item.contestId}
          getLabel={(item) => item.title}
          getDescription={(item) => (item.beginAt && item.endAt ? `${formatDate(item.beginAt)} → ${formatDate(item.endAt)}` : '')}
          renderChip={(item) => (
            <span>
              {item.title}
              {item.beginAt && item.endAt ? (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {formatDate(item.beginAt)} → {formatDate(item.endAt)}
                </span>
              ) : null}
            </span>
          )}
          name={name}
          maxItems={1}
          disabled={disabled}
          placeholder="搜索比赛标题"
          emptyText={searchError || '没有匹配的比赛'}
        />
      </div>
    </div>
  );
}

function CollaboratorSelect({
  domainId,
  value,
  onChange,
  disabled,
}: {
  domainId: string;
  value: DomainUserOption[];
  onChange: (users: DomainUserOption[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="协作者" aria-disabled={disabled || undefined}>
      <MultiSelect<DomainUserOption>
        value={value}
        onChange={onChange}
        loadOptions={(query) => loadDomainUsers(domainId, query)}
        getKey={(item) => String(item._id)}
        getLabel={domainUserSearchLabel}
        renderChip={(item) => <span>{collaboratorChipLabel(item)}</span>}
        renderOption={(item) => <DomainUserSearchOption user={item} />}
        disabled={disabled}
        placeholder="搜索 UID / OJ 用户 / 学号 / 姓名"
        emptyText="没有匹配的用户"
      />
    </div>
  );
}

function EventCreateDialog({ open, schools, onClose }: { open: boolean; schools: SchoolView[]; onClose: () => void }) {
  const bs = useBootstrap();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType>('external');
  const [contestId, setContestId] = useState('');
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>([]);
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
        collaboratorUids: collaborators.map((user) => user._id),
      };
      if (type === 'krypton' && contestId.trim()) body.contestId = contestId.trim();
      const payload = await postJson('/api/admin/exam-events', body, '创建考试活动失败');
      const created = parseEvent(payload.event);
      window.location.assign(`/admin/exam-infrastructure/events/${created.eventId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建考试活动失败');
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    setType('external');
    setContestId('');
    setCollaborators([]);
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="w-[min(720px,calc(100vw-1.5rem))]" onClose={busy ? undefined : close}>
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
                <SimpleSelect
                  id="new-exam-school"
                  name="schoolId"
                  required
                  ariaLabel="学校"
                  defaultValue=""
                  placeholder="请选择学校"
                  options={[{ value: '', label: '请选择学校' }, ...schools.map((school) => ({ value: school.schoolId, label: school.name }))]}
                />
              </FormField>
              <FormField label="考试类型" htmlFor="new-exam-type" required>
                <SimpleSelect
                  id="new-exam-type"
                  ariaLabel="考试类型"
                  value={type}
                  onValueChange={(next) => {
                    const resolved = next as EventType;
                    setType(resolved);
                    if (resolved === 'external') setContestId('');
                  }}
                  options={[
                    { value: 'external', label: '外部考试' },
                    { value: 'krypton', label: 'Krypton 比赛' },
                  ]}
                />
              </FormField>
              {type === 'krypton' ? (
                <FormField label="Krypton 比赛" required hint="按标题搜索并选择比赛；可先建草稿再关联。">
                  <ContestSearchSelect name="contestId" value={contestId} onChange={(next) => setContestId(next)} />
                </FormField>
              ) : null}
              <FormField label="开始时间" htmlFor="new-exam-start" required>
                <Input id="new-exam-start" name="startAt" type="datetime-local" required />
              </FormField>
              <FormField label="硬截止时间" htmlFor="new-exam-end" required>
                <Input id="new-exam-end" name="endAt" type="datetime-local" required />
              </FormField>
            </FormRow>
            <FormField label="协作者" hint="可选；服务端会重新校验学校范围。">
              <CollaboratorSelect domainId={bs.domain.id} value={collaborators} onChange={setCollaborators} />
            </FormField>
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
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
          <>
            <ClassroomLauncher schools={schools} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              新建活动
            </Button>
          </>
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
                    {schools.find((school) => school.schoolId === event.schoolId)?.name || '学校未登记'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
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
  const bs = useBootstrap();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType>(event.type);
  const [contestId, setContestId] = useState(event.contestId || '');
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>(() => collaboratorsFromUids(event.collaboratorUids));
  const [linkedContest, setLinkedContest] = useState<ContestOption | null>(null);
  const [linkedContestUnavailable, setLinkedContestUnavailable] = useState(false);
  const hydrateSeq = useRef(0);
  const criticalEditable = event.lifecycle !== 'archived' && event.status !== 'active' && event.status !== 'ended';
  useEffect(() => {
    if (!event.contestId) {
      setLinkedContest(null);
      setLinkedContestUnavailable(false);
      return;
    }
    let current = true;
    void loadContestOption(event.contestId)
      .then((option) => {
        if (!current) return;
        setLinkedContest(option);
        setLinkedContestUnavailable(false);
      })
      .catch(() => {
        if (!current) return;
        setLinkedContest(null);
        setLinkedContestUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, [event.contestId]);
  const openEditor = () => {
    const seq = ++hydrateSeq.current;
    setType(event.type);
    setContestId(event.contestId || '');
    setCollaborators(collaboratorsFromUids(event.collaboratorUids));
    setEditing(true);
    void hydrateCollaborators(bs.domain.id, event.collaboratorUids).then((next) => {
      if (seq === hydrateSeq.current) setCollaborators(next);
    });
  };
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
      collaboratorUids: collaborators.map((user) => user._id),
    };
    if (criticalEditable) {
      Object.assign(body, {
        schoolId: String(form.get('schoolId') || ''),
        type,
        contestId: type === 'krypton' ? contestId.trim() || null : null,
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
            基本信息
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">活动时间窗和类型是后续策略执行的边界。</p>
        </div>
        {event.lifecycle === 'archived' ? (
          <Badge variant="secondary">只读归档</Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={openEditor}>
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
                    { label: 'Contest', value: contestTitleFact(event.contestId, linkedContest, linkedContestUnavailable) },
                  ],
                  details: event.contestId ? [{ label: 'Contest ID', value: event.contestId }] : undefined,
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
              variant="destructive"
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
          <form key={`${event.revision}-${event.schoolId}-${editing ? 'open' : 'closed'}`} onSubmit={(formEvent) => void save(formEvent)}>
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
                  <SimpleSelect
                    id="edit-exam-school"
                    name="schoolId"
                    ariaLabel="学校"
                    defaultValue={event.schoolId}
                    disabled={!criticalEditable}
                    options={schools.map((school) => ({ value: school.schoolId, label: school.name }))}
                  />
                </FormField>
                <FormField label="考试类型" htmlFor="edit-exam-type" required>
                  <SimpleSelect
                    id="edit-exam-type"
                    ariaLabel="考试类型"
                    value={type}
                    disabled={!criticalEditable}
                    onValueChange={(next) => {
                      const resolved = next as EventType;
                      setType(resolved);
                      if (resolved === 'external') setContestId('');
                    }}
                    options={[
                      { value: 'external', label: '外部考试' },
                      { value: 'krypton', label: 'Krypton 比赛' },
                    ]}
                  />
                </FormField>
                {type === 'krypton' ? (
                  <FormField label="Krypton 比赛">
                    <ContestSearchSelect
                      name="contestId"
                      value={contestId}
                      disabled={!criticalEditable}
                      onChange={(next) => setContestId(next)}
                    />
                  </FormField>
                ) : null}
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
          网络策略
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">草稿可反复保存；发布后版本不可变，活动只引用明确版本。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={error} />
        {readOnly ? <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">活动已归档，策略版本仅供查看。</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="策略模板" htmlFor="policy-template" className="flex-1">
            <SimpleSelect
              id="policy-template"
              ariaLabel="策略模板"
              value={selected?.templateId || '__new__'}
              disabled={readOnly}
              onValueChange={setSelectedId}
              options={[
                { value: '__new__', label: '新建策略' },
                ...templates
                  .filter((template) => template.status === 'active')
                  .map((template) => ({ value: template.templateId, label: template.name })),
              ]}
            />
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

function parseBoundEndpoints(payload: Record<string, unknown>): BoundEndpointOption[] {
  const classroom = asRecord(payload.classroom, '教室工作台');
  const layout = asRecord(classroom.layout, '教室布局');
  if (!Array.isArray(layout.seats) || !Array.isArray(payload.bindings)) throw new Error('教室工作台响应格式不正确');
  const seats = new Map<string, string>();
  for (const item of layout.seats) {
    const seat = asRecord(item, '座位布局');
    seats.set(asString(seat.sourceSeatId, '座位布局'), asString(seat.label, '座位布局'));
  }
  const name = asString(classroom.name, '教室');
  if (!name) throw new Error('教室工作台响应格式不正确');
  const endpoints: BoundEndpointOption[] = [];
  const seen = new Set<string>();
  for (const item of payload.bindings) {
    const binding = asRecord(item, '终端绑定');
    const status = asString(binding.status, '终端绑定');
    if (status !== 'active') continue;
    const endpointId = optionalString(binding.endpointId, '终端绑定');
    if (!endpointId) continue;
    const sourceSeatId = asString(binding.sourceSeatId, '终端绑定');
    const label = seats.get(sourceSeatId);
    if (label === undefined) throw new Error('教室工作台响应格式不正确');
    if (seen.has(endpointId)) throw new Error('教室工作台响应格式不正确');
    seen.add(endpointId);
    endpoints.push({ endpointId, label: `${name} / ${label}` });
  }
  return endpoints;
}

function publishedSeatAssignmentOptions(
  preparation: ExamPreparationSummary | null,
  assignment: TargetAssignment | null,
  requestedId: string,
): Array<{ id: string; label: string }> {
  const options = new Map<string, string>();
  if (preparation?.assignment) {
    options.set(preparation.assignment.id, `已发布分配 r${preparation.assignment.revision}`);
  }
  if (requestedId && !options.has(requestedId)) options.set(requestedId, '已发布分配');
  const sources = [...(assignment?.draft.sources || []), ...(assignment?.revisions.flatMap((revision) => revision.sources) || [])];
  for (const source of sources) {
    if (source.kind !== 'examSeat') continue;
    for (const id of source.ids) {
      if (!options.has(id)) options.set(id, '已发布分配');
    }
  }
  return [...options.entries()].map(([id, label]) => ({ id, label }));
}

function TargetSection({
  eventId,
  schoolId,
  assignment,
  preparation,
  config,
  readOnly,
  reload,
  requestConfirm,
}: {
  eventId: string;
  schoolId: string;
  assignment: TargetAssignment | null;
  preparation: ExamPreparationSummary | null;
  config: NetworkConfig | null;
  readOnly: boolean;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  type EditableSourceKind = 'classroom' | 'endpoint' | 'examSeat';
  type SourceMode = EditableSourceKind | 'existing';
  const requestedAssignmentId = () => new URL(window.location.href).searchParams.get('examSeatAssignmentId')?.trim() || '';
  const seatAssignmentOptions = () => publishedSeatAssignmentOptions(preparation, assignment, requestedAssignmentId());
  const initialSourceKind = (): SourceMode => {
    if (requestedAssignmentId()) return 'examSeat';
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
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [boundEndpoints, setBoundEndpoints] = useState<BoundEndpointOption[]>([]);
  const [bindingsLoaded, setBindingsLoaded] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSourceKind(initialSourceKind());
    setSelectedEndpointIds(draftEndpointIds());
    setClassroomId(initialClassroomId());
    setExamSeatAssignmentId(initialAssignmentId());
  }, [assignment?.revision, preparation?.assignment?.id, preparation?.assignment?.revision]);
  useEffect(() => {
    let current = true;
    setBindingsLoaded(false);
    setBindingError(null);
    void apiObject('/api/admin/exam-infrastructure/classrooms', undefined, '加载教室列表失败')
      .then(async (payload) => {
        if (!Array.isArray(payload.classrooms)) throw new Error('教室列表响应格式不正确');
        const parsed = payload.classrooms.map((value) => {
          const classroom = asRecord(value, '教室列表');
          return {
            classroomId: asString(classroom.classroomId, '教室列表'),
            schoolId: asString(classroom.schoolId, '教室列表'),
            name: asString(classroom.name, '教室列表'),
            layoutRevision: asNumber(classroom.layoutRevision, '教室列表'),
            seatCount: asNumber(classroom.seatCount, '教室列表'),
          };
        });
        if (!current) return;
        setClassrooms(parsed);
        const schoolRooms = parsed.filter((classroom) => classroom.schoolId === schoolId);
        const states = await Promise.all(
          schoolRooms.map((room) =>
            apiObject(
              `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(room.classroomId)}/seat-bindings`,
              undefined,
              '加载座位绑定失败',
            ).then(parseBoundEndpoints),
          ),
        );
        if (!current) return;
        setBoundEndpoints(states.flat());
        setBindingsLoaded(true);
      })
      .catch((cause) => {
        if (!current) return;
        setBoundEndpoints([]);
        setBindingError(cause instanceof Error ? cause.message : '加载教室列表失败');
        setBindingsLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [schoolId]);
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
  const saveVariant = targetDirty && !preview ? 'default' : 'outline';
  const previewVariant = !targetDirty && !preview ? 'default' : 'outline';
  const targetNotice = error || bindingError || unresolvedError;
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
    <Card id="target-assignment">
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          目标终端
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">保存动态来源后必须重新预览；发布只冻结显式 endpoint 快照。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MutationNotice error={targetNotice} />
        {readOnly ? <p className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">活动已归档，目标快照仅供查看。</p> : null}
        <FormField label="目标来源" htmlFor="target-source-kind" hint="考试座位引用已发布 assignment；外部无名单考试继续使用教室或指定终端来源。">
          <SimpleSelect
            id="target-source-kind"
            ariaLabel="目标来源"
            value={sourceKind}
            disabled={readOnly}
            onValueChange={(next) => {
              const resolved = next as SourceMode;
              setSourceKind(resolved);
              setPreview(null);
              if (resolved === 'examSeat') {
                const options = seatAssignmentOptions();
                if (options.length === 1 && !examSeatAssignmentId) setExamSeatAssignmentId(options[0].id);
              }
            }}
            options={[
              { value: 'endpoint', label: '指定终端' },
              { value: 'classroom', label: '整间教室' },
              { value: 'examSeat', label: '已发布考试座位分配' },
              ...(initialSourceKind() === 'existing' ? [{ value: 'existing', label: '保留现有来源（只读）' }] : []),
            ]}
          />
        </FormField>
        {sourceKind === 'endpoint' ? (
          <FormField label="指定终端" hint="只列出当前学校教室里已经绑定的活动终端。">
            <div role="group" aria-label="指定终端" aria-disabled={readOnly || undefined}>
              <MultiSelect<BoundEndpointOption>
                value={selectedEndpoints}
                onChange={(next) => {
                  setSelectedEndpointIds(next.map((item) => item.endpointId));
                  setPreview(null);
                }}
                options={boundEndpoints}
                getKey={(item) => item.endpointId}
                getLabel={(item) => item.label}
                disabled={readOnly}
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
              disabled={readOnly}
              onValueChange={(next) => {
                setClassroomId(next);
                setPreview(null);
              }}
              options={[
                { value: '', label: '选择教室' },
                ...classrooms
                  .filter((classroom) => classroom.schoolId === schoolId)
                  .map((classroom) => ({
                    value: classroom.classroomId,
                    label: `${classroom.name} · ${classroom.seatCount} 座`,
                  })),
              ]}
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
              disabled={readOnly}
              onValueChange={(next) => {
                setExamSeatAssignmentId(next);
                setPreview(null);
              }}
              placeholder="选择已发布分配"
              options={[
                { value: '', label: '选择已发布分配' },
                ...seatAssignmentOptions().map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </FormField>
        ) : (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <p className="font-medium">现有来源保持不变</p>
            <p className="mt-1 text-muted-foreground">
              当前草稿包含多个来源组或旧的实体座位/用户组来源，本页不会把它们静默改写。可直接重新解析，或明确切换到上方支持的来源类型后保存。
            </p>
            <ul className="mt-2 list-inside list-disc font-mono text-xs text-muted-foreground">
              {savedSources.map((source, index) => (
                <li key={`${source.kind}-${index}`}>
                  {SOURCE_LABELS[source.kind]} · {source.ids.length} 项
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={saveVariant}
            disabled={readOnly || busy || sourceKind === 'existing' || endpointDraftBlocked || (Boolean(assignment) && !targetDirty)}
            onClick={() => void save()}
          >
            <Save className="size-4" />
            保存来源
          </Button>
          <Button
            size="sm"
            variant={previewVariant}
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
  updatePreview,
  reload,
  requestConfirm,
}: {
  event: ExamEventView;
  config: NetworkConfig | null;
  assignment: TargetAssignment | null;
  execution: NetworkExecution | null;
  updatePreview: NetworkUpdatePreview | null;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}) {
  const configIdentity = networkConfigIdentity(config);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const visiblePreflight = preflight?.configIdentity === configIdentity ? preflight.items : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (
    action: 'preflight' | 'refresh' | 'retry' | 'retryFailed' | 'start' | 'stop',
    rethrow = false,
    expectedConfigRevision?: number,
  ) => {
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
  const preflightReadyCount = visiblePreflight?.filter((item) => item.ready).length || 0;
  const updateTone =
    canonicalUpdatePreview?.policyDiff.effect === 'loosening' || canonicalUpdatePreview?.policyDiff.effect === 'mixed' ? 'destructive' : 'default';
  const showStart = execution?.desiredState !== 'active';
  const showRetryFailed = Boolean(
    execution?.projection?.dispatchStatus === 'complete' &&
      retryableFailures.length > 0 &&
      !hasDeliveryUnknownFailure &&
      event.lifecycle !== 'archived' &&
      (execution.desiredState !== 'active' || !canonicalUpdatePreview),
  );
  const primaryAction = !execution ? 'start' : showRetryFailed ? 'retryFailed' : showStart ? 'start' : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          预检与执行
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
              {showStart ? (
                <Button
                  size="sm"
                  variant={primaryAction === 'start' ? 'default' : 'outline'}
                  disabled={busy || !runnable || !visiblePreflight || currentRequestUnresolved}
                  title={
                    currentRequestUnresolved ? '请先重试当前请求或刷新到完整执行事实' : !visiblePreflight ? '请先对当前配置执行终端预检' : undefined
                  }
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
                        { label: '当前预检', value: `${preflightReadyCount}/${visiblePreflight?.length || 0} 台就绪` },
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
              {(currentRequestUnresolved || hasDeliveryUnknownFailure) && event.lifecycle !== 'archived' ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void call('retry')}>
                  <RefreshCw className="size-4" />
                  重试当前请求
                </Button>
              ) : null}
              {showRetryFailed && execution ? (
                <Button
                  size="sm"
                  variant={primaryAction === 'retryFailed' ? 'default' : 'outline'}
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
                  <RefreshCw className="size-4" />
                  整批重试失败项
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
                        {
                          label: '目标终端数',
                          value:
                            canonicalUpdatePreview?.targetDiff.beforeCount ?? execution.projection?.items.length ?? target?.targetCount ?? '未知',
                        },
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
            {execution?.desiredState === 'active' && canonicalUpdatePreview ? (
              <div
                className={cn(
                  'rounded-xl border p-4',
                  canonicalUpdatePreview.requiresStop
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : updateTone === 'destructive'
                      ? 'border-destructive/30 bg-destructive/5'
                      : 'border-primary/25 bg-primary/5',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">配置已有新版本等待应用</p>
                      <Badge variant={updateTone === 'destructive' ? 'destructive' : 'outline'}>
                        {policyEffectLabel(canonicalUpdatePreview.policyDiff.effect)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      策略 v{canonicalUpdatePreview.fromPolicyRef.revision} → v{canonicalUpdatePreview.toPolicyRef.revision} · 目标{' '}
                      {canonicalUpdatePreview.targetDiff.beforeCount} → {canonicalUpdatePreview.targetDiff.afterCount} 台
                    </p>
                  </div>
                  {!canonicalUpdatePreview.requiresStop ? (
                    <Button
                      size="sm"
                      variant={updateTone}
                      disabled={busy || !runnable || !visiblePreflight || currentRequestUnresolved}
                      title={
                        currentRequestUnresolved ? '请先重试当前请求或刷新到完整执行事实' : !visiblePreflight ? '请先对新配置执行终端预检' : undefined
                      }
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
                            { label: '当前预检', value: `${preflightReadyCount}/${visiblePreflight?.length || 0} 台就绪` },
                            { label: '硬截止', value: formatDate(execution.hardEndAt) },
                          ],
                          run: () => call('start', true, canonicalUpdatePreview.configRevision),
                        })
                      }
                    >
                      <RefreshCw className="size-4" />
                      {updateIsRollback ? '回滚并热更新' : '热更新策略'}
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <Fact
                    label="新增允许规则"
                    value={[...canonicalUpdatePreview.policyDiff.addedHosts, ...canonicalUpdatePreview.policyDiff.addedIps].join('、') || '无'}
                  />
                  <Fact
                    label="移除允许规则"
                    value={[...canonicalUpdatePreview.policyDiff.removedHosts, ...canonicalUpdatePreview.policyDiff.removedIps].join('、') || '无'}
                  />
                  <Fact label="新增终端" value={canonicalUpdatePreview.targetDiff.addedEndpointIds.join('、') || '无'} />
                  <Fact label="移除终端" value={canonicalUpdatePreview.targetDiff.removedEndpointIds.join('、') || '无'} />
                </div>
                {canonicalUpdatePreview.requiresStop ? (
                  <p className="mt-3 rounded-lg border border-amber-500/25 bg-background/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    目标终端发生变化。为避免被移除的机器继续残留旧锁，必须先停止当前目标并等待全部终端确认释放，再按新快照启动。
                  </p>
                ) : null}
              </div>
            ) : null}
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
                      旧 {item.previousPolicyRevision ?? '—'} / 期望 {item.expectedPolicyRevision ?? '—'} / 实际{' '}
                      {item.appliedPolicyRevision ?? item.networkPolicyState?.policyRevision ?? '—'}
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
  const [preparation, setPreparation] = useState<ExamPreparationSummary | null>(null);
  const [updatePreview, setUpdatePreview] = useState<NetworkUpdatePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ConfirmPlan | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [panel, setPanel] = useState<EventPanel>(readEventPanel);
  const goToPanel = (next: EventPanel) => {
    setPanel(next);
    writeEventPanel(next);
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
    setEvent(parsedEvent);
    setPreparation(parsedPreparation);
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
    setUpdatePreview(parseNetworkUpdatePreview(executionPayload.updatePreview));
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
        <EventStepNav panel={panel} onChange={goToPanel} />
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">考试名单与座位</p>
                {statusBadge(event.status)}
              </div>
              <p className="text-sm text-muted-foreground">查看固定名单、可复现分配、人工调整与发布 revision。</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">修订与批次</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">名单 r{preparation?.assignment?.roster.revision || 0}</Badge>
                  <Badge variant="outline">分配 r{preparation?.assignment?.revision || 0}</Badge>
                  <Badge variant="outline">发布 r{preparation?.publicationRevision || 0}</Badge>
                  <Badge variant="outline">策略 r{config?.policy?.revision || 0}</Badge>
                  <Badge variant="outline">目标 r{config?.target?.revision || 0}</Badge>
                  <Badge variant="outline">票据批次 r{preparation?.batch?.revision || 0}</Badge>
                  <Badge variant="outline">投影 r{preparation?.batch?.projectionRevision || 0}</Badge>
                  {preparation?.batch?.workflow ? <Badge variant="outline">确认执行 r{preparation.batch.workflow.executionRevision}</Badge> : null}
                  {preparation?.batch?.workflow ? <Badge variant="outline">批次策略 r{preparation.batch.workflow.policyRevision}</Badge> : null}
                  {preparation?.batch?.workflow ? <Badge variant="outline">批次目标 r{preparation.batch.workflow.targetRevision}</Badge> : null}
                  {preparation?.batch && !preparation.batch.workflow ? <Badge variant="outline">P2.9 前历史批次</Badge> : null}
                </div>
              </details>
            </div>
            <Button asChild variant="outline">
              <a href={`/admin/exam-infrastructure/events/${event.eventId}/seats`}>打开座位工作台</a>
            </Button>
          </CardContent>
        </Card>
        {panel === 'basics' ? <BasicEventSection event={event} schools={schools} reload={reload} requestConfirm={runPlan} /> : null}
        {panel === 'policy' ? (
          <PolicySection
            eventId={eventId}
            templates={templates}
            config={config}
            readOnly={event.lifecycle === 'archived'}
            reload={reload}
            requestConfirm={runPlan}
          />
        ) : null}
        {panel === 'targets' ? (
          <TargetSection
            eventId={eventId}
            schoolId={event.schoolId}
            assignment={assignment}
            preparation={preparation}
            config={config}
            readOnly={event.lifecycle === 'archived'}
            reload={reload}
            requestConfirm={runPlan}
          />
        ) : null}
        {panel === 'run' ? (
          <ExecutionSection
            event={event}
            config={config}
            assignment={assignment}
            execution={execution}
            updatePreview={updatePreview}
            reload={reload}
            requestConfirm={runPlan}
          />
        ) : null}
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
