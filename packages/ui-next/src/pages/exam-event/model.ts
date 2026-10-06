import type { ReactNode } from 'react';
import { examTeacherErrorZh, examTeacherExactZh } from '@hydrooj/common';
import { loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

export type EventStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'archived';
export type EventType = 'krypton' | 'external';
export type SourceKind = 'classroom' | 'endpoint' | 'examSeat' | 'seat' | 'userbindGroup';
export type EventPanel = 'basics' | 'policy' | 'targets' | 'run';
export type StepPanelRequest = EventPanel | null;

export interface ContestOption {
  contestId: string;
  title: string;
  beginAt: string;
  endAt: string;
}

export interface BoundEndpointOption {
  endpointId: string;
  label: string;
}

export interface ExamEventView {
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
  createdAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  archivedAt: string | null;
  archivedBy: number | null;
}

export interface SchoolView {
  schoolId: string;
  name: string;
}

export interface ClassroomSummary {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  seatCount: number;
}

export interface NetworkPolicy {
  hosts: string[];
  ips: string[];
  ports: number[];
}

export interface PolicyRevision {
  revision: number;
  policy: NetworkPolicy;
  fingerprint: string;
  publishedAt: string;
}

export interface PolicyTemplate {
  templateId: string;
  name: string;
  status: 'active' | 'archived';
  revision: number;
  collaboratorUids: number[];
  ownerUid: number | null;
  draft: { version: number; policy: NetworkPolicy; fingerprint: string; updatedAt: string | null; updatedBy: number | null };
  revisions: PolicyRevision[];
  latestPublishedRevision: number | null;
}

export interface SourceGroup {
  kind: SourceKind;
  ids: string[];
}

export interface TargetRevision {
  revision: number;
  sources: SourceGroup[];
  targetFingerprint: string;
  endpointIds: string[];
  targetCount: number;
  publishedAt: string;
}

export interface TargetAssignment {
  assignmentId: string;
  revision: number;
  draft: { version: number; sources: SourceGroup[]; updatedAt: string | null; updatedBy: number | null };
  revisions: TargetRevision[];
  latestPublishedRevision: number | null;
}

export interface RevisionRef {
  id: string;
  revision: number;
  fingerprint: string;
}

export interface NetworkConfig {
  revision: number;
  policy: RevisionRef | null;
  target: RevisionRef | null;
  updatedAt: string | null;
}

export interface ExamPreparationSummary {
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
  warning?: string;
}

export interface TargetPreview {
  previewFingerprint: string;
  endpointIds: string[];
  targetCount: number;
  addedEndpointIds: string[];
  removedEndpointIds: string[];
}

export interface PreflightItem {
  endpointId: string;
  ready: boolean;
  reason: string;
  online: boolean;
  compatible: boolean | null;
  serviceVersion: string | null;
}

export interface PreflightResult {
  configIdentity: string;
  items: PreflightItem[];
}

export interface ProjectionItem {
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

export interface NetworkUpdatePreview {
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

export interface NetworkExecution {
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
    requestedAt: string | null;
    receivedAt: string | null;
    failedAt: string | null;
  };
  projection: {
    revision: number;
    dispatchStatus: 'complete' | 'dispatching';
    summary: Record<string, number>;
    items: ProjectionItem[];
    receivedAt: string;
  } | null;
}

export interface ConfirmFact {
  label: string;
  value: ReactNode;
}

export interface ConfirmPlan {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'destructive';
  facts: ConfirmFact[];
  details?: ConfirmFact[];
  run: () => Promise<void>;
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  classroom: '教室',
  endpoint: '指定终端',
  examSeat: '考试座位',
  seat: '实体座位',
  userbindGroup: '用户组',
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: '草稿',
  scheduled: '待开始',
  active: '进行中',
  ended: '已结束',
  archived: '已归档',
};

export const ENDPOINT_STATUS_LABELS: Record<ProjectionItem['status'], string> = {
  applied: '已应用',
  expired: '已过期',
  failed: '应用失败',
  offline: '离线',
  queued: '待派发',
  rejected: '已拒绝',
  sent: '已送达',
};

export const DELIVERY_UNKNOWN_FAILURE_REASON = 'transport_send_failed_delivery_unknown';
export const UNKNOWN_TEACHER_ERROR = '操作无法完成，请重试。';
export const INFRA_CODE_OVERRIDES: Record<string, string> = {
  endpoint_capability_missing: '终端缺少所需能力',
  endpoint_incompatible: '终端版本或协议不兼容',
  endpoint_offline: '终端离线',
  vigil_delivery_unknown: '投递结果未知',
  vigil_http_rejected: 'Vigil 拒绝了本次请求',
};

export function catalogTeacherLabel(code: string): string | null {
  if (examTeacherExactZh(code) == null) return null;
  return examTeacherErrorZh(code);
}

export function lookupInfraLabel(reason: string): string | null {
  return INFRA_CODE_OVERRIDES[reason] || catalogTeacherLabel(reason);
}

export function teacherReasonLabel(reason: string): string {
  const label = lookupInfraLabel(reason);
  if (label) return label;
  if (/[\u3400-\u9FFF]/.test(reason)) return reason;
  if (!/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/.test(reason)) return reason;
  return UNKNOWN_TEACHER_ERROR;
}

export function presentInfraError(message: string): { summary: string; raw: string | null } {
  const trimmed = message.trim();
  const payload = trimmed.replace(/^(?:请求无效：)+/, '');
  const exact = lookupInfraLabel(payload);
  if (exact) return { summary: exact, raw: null };
  if (/[\u3400-\u9FFF]/.test(payload) && !/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/.test(payload)) return { summary: payload, raw: null };
  if (/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/.test(payload) && !/[\u3400-\u9FFF]/.test(payload)) {
    return { summary: UNKNOWN_TEACHER_ERROR, raw: payload };
  }
  const replaced = payload.replace(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g, (token) => lookupInfraLabel(token) || token);
  if (/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/.test(replaced)) return { summary: UNKNOWN_TEACHER_ERROR, raw: trimmed };
  return { summary: replaced, raw: null };
}

export const EVENT_PANELS: Array<{ id: EventPanel; label: string }> = [
  { id: 'basics', label: '基本信息' },
  { id: 'policy', label: '网络策略' },
  { id: 'targets', label: '目标终端' },
  { id: 'run', label: '预检与执行' },
];

export function isRetryableProjectionItem(item: ProjectionItem): boolean {
  return ['expired', 'failed', 'offline', 'rejected'].includes(item.status) && item.failureReason !== DELIVERY_UNKNOWN_FAILURE_REASON;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}响应格式不正确`);
  return value;
}

export function asNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}响应格式不正确`);
  return Number(value);
}

export function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label}响应格式不正确`);
  return [...value];
}

export function optionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function optionalAuditString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return asString(value, label);
}

function optionalAuditNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return asNumber(value, label);
}

export function parseEvent(value: unknown): ExamEventView {
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
    createdAt: optionalAuditString(event.createdAt, '考试活动'),
    createdBy: optionalAuditNumber(event.createdBy, '考试活动'),
    updatedBy: optionalAuditNumber(event.updatedBy, '考试活动'),
    archivedAt: optionalAuditString(event.archivedAt, '考试活动'),
    archivedBy: optionalAuditNumber(event.archivedBy, '考试活动'),
  };
}

export function parsePolicy(value: unknown): NetworkPolicy {
  const policy = asRecord(value, '网络策略');
  if (!Array.isArray(policy.ports) || policy.ports.some((port) => !Number.isSafeInteger(port))) throw new Error('网络策略响应格式不正确');
  return { hosts: asStringArray(policy.hosts, '网络策略'), ips: asStringArray(policy.ips, '网络策略'), ports: [...policy.ports] as number[] };
}

export function parseRef(value: unknown): RevisionRef | null {
  if (value === null) return null;
  const ref = asRecord(value, '版本引用');
  return { id: asString(ref.id, '版本引用'), revision: asNumber(ref.revision, '版本引用'), fingerprint: asString(ref.fingerprint, '版本引用') };
}

export function parseSources(value: unknown): SourceGroup[] {
  if (!Array.isArray(value)) throw new Error('目标来源响应格式不正确');
  return value.map((item) => {
    const source = asRecord(item, '目标来源');
    const kind = asString(source.kind, '目标来源');
    if (!Object.hasOwn(SOURCE_LABELS, kind)) throw new Error('目标来源响应格式不正确');
    return { kind: kind as SourceKind, ids: asStringArray(source.ids, '目标来源') };
  });
}

export function parseTemplate(value: unknown): PolicyTemplate {
  const template = asRecord(value, '策略模板');
  const draft = asRecord(template.draft, '策略草稿');
  const status = asString(template.status, '策略模板');
  if (status !== 'active' && status !== 'archived') throw new Error('策略模板响应格式不正确');
  if (!Array.isArray(template.revisions)) throw new Error('策略模板响应格式不正确');
  if (!Array.isArray(template.collaboratorUids) || template.collaboratorUids.some((uid) => !Number.isSafeInteger(uid))) {
    throw new Error('策略模板响应格式不正确');
  }
  return {
    templateId: asString(template.templateId, '策略模板'),
    name: asString(template.name, '策略模板'),
    status,
    revision: asNumber(template.revision, '策略模板'),
    collaboratorUids: [...template.collaboratorUids] as number[],
    ownerUid: optionalAuditNumber(template.ownerUid, '策略模板'),
    draft: {
      version: asNumber(draft.version, '策略草稿'),
      policy: parsePolicy(draft.policy),
      fingerprint: asString(draft.fingerprint, '策略草稿'),
      updatedAt: optionalAuditString(draft.updatedAt, '策略草稿'),
      updatedBy: optionalAuditNumber(draft.updatedBy, '策略草稿'),
    },
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

export function parseAssignment(value: unknown): TargetAssignment | null {
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
      updatedAt: optionalAuditString(draft.updatedAt, '目标草稿'),
      updatedBy: optionalAuditNumber(draft.updatedBy, '目标草稿'),
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

export function parseConfig(value: unknown): NetworkConfig | null {
  if (value === null) return null;
  const config = asRecord(value, '网络配置');
  return {
    revision: asNumber(config.revision, '网络配置'),
    policy: parseRef(config.policy),
    target: parseRef(config.target),
    updatedAt: optionalAuditString(config.updatedAt, '网络配置'),
  };
}

export function parsePreparationSummary(value: unknown): ExamPreparationSummary {
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
  const warning = summary.warning === undefined || summary.warning === null ? undefined : asString(summary.warning, '考试准备摘要');
  return { assignment, publicationRevision: asNumber(summary.publicationRevision, '考试准备摘要'), batch, ...(warning ? { warning } : {}) };
}

export function parseProjectionItem(value: unknown): ProjectionItem {
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

export function parseNetworkUpdatePreview(value: unknown): NetworkUpdatePreview | null {
  if (value == null) return null;
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

export function parseExecution(value: unknown): NetworkExecution | null {
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
      requestedAt: optionalAuditString(operation.requestedAt, '网络执行'),
      receivedAt: optionalAuditString(operation.receivedAt, '网络执行'),
      failedAt: optionalAuditString(operation.failedAt, '网络执行'),
    },
    projection,
  };
}

export async function apiObject(path: string, init?: RequestInit, fallback = '操作失败'): Promise<Record<string, unknown>> {
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

export async function postJson(path: string, body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  return apiObject(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fallback);
}

export function splitValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function networkConfigIdentity(config: NetworkConfig | null): string {
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

export function sameRevisionRef(left: RevisionRef | null, right: RevisionRef | null): boolean {
  return Boolean(left && right && left.id === right.id && left.revision === right.revision && left.fingerprint === right.fingerprint);
}

export function visibleNetworkUpdatePreview(
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

export function policyEffectLabel(effect: NetworkUpdatePreview['policyDiff']['effect']): string {
  if (effect === 'loosening') return '放宽';
  if (effect === 'tightening') return '收紧';
  if (effect === 'mixed') return '同时收紧与放宽';
  return '规则等价';
}

export function formatPorts(ports: number[]): string {
  return ports.length ? ports.join('、') : '全部端口';
}

export function policyDiffFacts(diff: NetworkUpdatePreview['policyDiff']): Array<{ label: string; value: ReactNode }> {
  const addedRules = [...diff.addedHosts.map((item) => `域名 ${item}`), ...diff.addedIps.map((item) => `IP ${item}`)];
  const removedRules = [...diff.removedHosts.map((item) => `域名 ${item}`), ...diff.removedIps.map((item) => `IP ${item}`)];
  return [
    { label: '变化方向', value: policyEffectLabel(diff.effect) },
    { label: '新增允许规则', value: addedRules.length ? addedRules.join('、') : '无' },
    { label: '移除允许规则', value: removedRules.length ? removedRules.join('、') : '无' },
    { label: '端口变化', value: `${formatPorts(diff.beforePorts)} → ${formatPorts(diff.afterPorts)}` },
  ];
}

export function policyExpansion(current: NetworkPolicy, previous: NetworkPolicy | null): string[] {
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

export function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date);
}

export function parseContestOption(value: unknown, contestId?: string): ContestOption {
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

export async function searchContests(query: string): Promise<ContestOption[]> {
  const payload = await apiObject(`/contest?q=${encodeURIComponent(query)}`, undefined, '搜索比赛失败');
  if (!Array.isArray(payload.tdocs)) throw new Error('比赛响应格式不正确');
  return payload.tdocs.map((item) => parseContestOption(item));
}

export async function loadContestOption(contestId: string): Promise<ContestOption> {
  const payload = await apiObject(`/contest/${encodeURIComponent(contestId)}`, undefined, '加载比赛失败');
  return parseContestOption(payload.tdoc, contestId);
}

export function collaboratorsFromUids(uids: number[]): DomainUserOption[] {
  return uids.map((uid) => ({ _id: uid }));
}

export async function hydrateCollaborators(domainId: string, uids: number[]): Promise<DomainUserOption[]> {
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

export function collaboratorChipLabel(user: DomainUserOption): string {
  return user.displayName || user.uname || '协作者（名称不可用）';
}

export function contestTitleFact(contestId: string | null, option: ContestOption | null, unavailable: boolean): string {
  if (!contestId) return '纯外部考试';
  if (option?.title) return option.title;
  return unavailable ? '比赛标题不可用' : '加载比赛…';
}

export function writeEventPanel(panel: EventPanel) {
  const url = new URL(window.location.href);
  if (panel === 'basics') url.searchParams.delete('panel');
  else url.searchParams.set('panel', panel);
  url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
}

export function preflightSummaryTone(items: PreflightItem[]): 'success' | 'danger' | 'neutral' {
  if (items.length === 0) return 'neutral';
  if (items.every((item) => item.ready)) return 'success';
  if (items.some((item) => !item.ready && item.compatible !== null)) return 'danger';
  return 'neutral';
}

export function preflightCountFact(items: PreflightItem[] | null): string {
  if (!items?.length) return '待检';
  const ready = items.filter((item) => item.ready).length;
  return `${ready}/${items.length} 台就绪`;
}

export function parseClassroomSummaries(value: unknown): ClassroomSummary[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('教室列表响应格式不正确');
  return value.map((item) => {
    const classroom = asRecord(item, '教室列表');
    return {
      classroomId: asString(classroom.classroomId, '教室列表'),
      schoolId: asString(classroom.schoolId, '教室列表'),
      name: asString(classroom.name, '教室列表'),
      layoutRevision: asNumber(classroom.layoutRevision, '教室列表'),
      seatCount: asNumber(classroom.seatCount, '教室列表'),
    };
  });
}

export function parseBoundEndpointOptions(value: unknown): BoundEndpointOption[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('终端列表响应格式不正确');
  const endpoints: BoundEndpointOption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const endpoint = asRecord(item, '终端列表');
    const endpointId = asString(endpoint.endpointId, '终端列表');
    const label = asString(endpoint.label, '终端列表');
    if (seen.has(endpointId)) throw new Error('终端列表响应格式不正确');
    seen.add(endpointId);
    endpoints.push({ endpointId, label });
  }
  return endpoints;
}

export function publishedSeatAssignmentOptions(
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

export function requestedEventPanel(url: string = window.location.href): EventPanel | null {
  const resolved = new URL(url);
  const panel = resolved.searchParams.get('panel');
  if (panel === 'basics' || panel === 'policy' || panel === 'targets' || panel === 'run') return panel;
  if (resolved.hash === '#target-assignment' || resolved.searchParams.get('examSeatAssignmentId')) return 'targets';
  return null;
}

export function parsePreflightResponse(payload: Record<string, unknown>): PreflightResult {
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
  return { configIdentity: networkConfigIdentity(preflightConfig), items };
}

export function parseTargetPreview(value: unknown): TargetPreview {
  const raw = asRecord(value, '目标预览');
  return {
    previewFingerprint: asString(raw.previewFingerprint, '目标预览'),
    endpointIds: asStringArray(raw.endpointIds, '目标预览'),
    targetCount: asNumber(raw.targetCount, '目标预览'),
    addedEndpointIds: asStringArray(raw.addedEndpointIds, '目标预览'),
    removedEndpointIds: asStringArray(raw.removedEndpointIds, '目标预览'),
  };
}

function sameSortedStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((item, index) => item === sortedRight[index]);
}

function sameSortedNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((first, second) => first - second);
  const sortedRight = [...right].sort((first, second) => first - second);
  return sortedLeft.every((item, index) => item === sortedRight[index]);
}

export function samePolicy(left: NetworkPolicy, right: NetworkPolicy): boolean {
  return sameSortedStrings(left.hosts, right.hosts) && sameSortedStrings(left.ips, right.ips) && sameSortedNumbers(left.ports, right.ports);
}

function normalizedSource(source: SourceGroup): SourceGroup {
  return { kind: source.kind, ids: [...source.ids].sort() };
}

function compareSources(left: SourceGroup, right: SourceGroup): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  const leftKey = left.ids.join(',');
  const rightKey = right.ids.join(',');
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  if (left.ids.length !== right.ids.length) return left.ids.length - right.ids.length;
  for (let index = 0; index < left.ids.length; index += 1) {
    const leftId = left.ids[index];
    const rightId = right.ids[index];
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  }
  return 0;
}

export function sameSources(left: SourceGroup[], right: SourceGroup[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = left.map(normalizedSource).sort(compareSources);
  const normalizedRight = right.map(normalizedSource).sort(compareSources);
  return normalizedLeft.every((source, index) => {
    const other = normalizedRight[index];
    return other !== undefined
      && source.kind === other.kind
      && source.ids.length === other.ids.length
      && source.ids.every((id, idIndex) => id === other.ids[idIndex]);
  });
}

export function latestPolicyRevision(template: PolicyTemplate): PolicyRevision | null {
  if (template.latestPublishedRevision === null) return null;
  return template.revisions.find((revision) => revision.revision === template.latestPublishedRevision) ?? null;
}

export function latestTargetRevision(assignment: TargetAssignment | null): TargetRevision | null {
  if (!assignment || assignment.latestPublishedRevision === null) return null;
  return assignment.revisions.find((revision) => revision.revision === assignment.latestPublishedRevision) ?? null;
}

export type EndpointLocations = ReadonlyMap<string, string>;

export function endpointLocations(bound: BoundEndpointOption[]): EndpointLocations {
  return new Map(bound.map((item) => [item.endpointId, item.label]));
}

export function endpointLocation(endpointId: string, locations: EndpointLocations): string {
  const label = locations.get(endpointId);
  return label === undefined ? '位置未知' : label;
}

export function sourceSummary(sources: SourceGroup[], classrooms: ClassroomSummary[]): string {
  if (sources.length === 0) return '无';
  return sources.map((source) => {
    if (source.kind === 'classroom' && source.ids.length === 1) {
      const classroom = classrooms.find((item) => item.classroomId === source.ids[0]);
      if (classroom) return classroom.name;
    }
    return `${SOURCE_LABELS[source.kind]} ${source.ids.length} 项`;
  }).join('、');
}
