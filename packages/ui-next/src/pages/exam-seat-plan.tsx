import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, GripVertical, LockKeyhole, Play, RefreshCw, Save, Shuffle, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { createRequestId } from '@/lib/request-id';

type AssignmentMode = 'random' | 'studentId';

interface RosterEntry {
  studentId: string;
  realName: string;
  boundUserId: number;
}

interface RosterRevision {
  rosterId: string;
  revision: number;
  fingerprint: string;
  source: { kind: 'contestAudience' | 'userbindGroups' | 'userbindSchool' };
  entries: RosterEntry[];
}

interface PublishedRosterDriftItem {
  boundUserId: number;
  studentId: string;
  realName: string;
  kind: 'added' | 'removed' | 'identity_changed' | 'team_changed';
  previousTeamId: string | null;
  previousTeamRole: 'captain' | 'member' | null;
  currentTeamId: string | null;
  currentTeamRole: 'captain' | 'member' | null;
}

interface PublishedRosterDrift {
  changed: boolean;
  sourceChangedWithoutParticipantDiff: boolean;
  items: PublishedRosterDriftItem[];
}

interface SeatPlanRosterRef {
  rosterId: string;
  revision: number;
  fingerprint: string;
}

interface SeatPlanClassroomRef {
  classroomId: string;
  layoutRevision: number;
  layoutFingerprint: string;
  profileRevision: number;
  profileFingerprint: string;
  candidateSeatIds: string[];
}

interface SeatPlanV1Revision {
  schemaVersion: 1;
  seatPlanId: string;
  revision: number;
  roster: SeatPlanRosterRef | null;
  classroomId: string;
  layoutRevision: number;
  layoutFingerprint: string;
  fingerprint: string;
  candidateSeatIds: string[];
  diagnostics: AssignmentDiagnostic[];
}

interface SeatPlanV2Revision {
  schemaVersion: 2;
  seatPlanId: string;
  revision: number;
  roster: SeatPlanRosterRef | null;
  classrooms: SeatPlanClassroomRef[];
  fingerprint: string;
  diagnostics: AssignmentDiagnostic[];
}

type SeatPlanRevision = SeatPlanV1Revision | SeatPlanV2Revision;

interface AssignmentMapping {
  boundUserId: number;
  sourceSeatId: string;
}

interface AssignmentDiagnostic {
  code: string;
  sourceSeatIds?: string[];
  seats?: Array<{ seat: SeatIdentity; reason: 'disabled' | 'layout_status' | 'unbound' }>;
  requiredSeatCount?: number;
  availableSeatCount?: number;
  reasons?: string[];
}

interface AssignmentV1Revision {
  schemaVersion: 1;
  assignmentId: string;
  revision: number;
  seatPlan: { seatPlanId: string; revision: number; fingerprint: string };
  roster: { rosterId: string; revision: number; fingerprint: string };
  classroomId: string;
  layoutRevision: number;
  layoutFingerprint: string;
  candidateSeatIds: string[];
  constraints: {
    mode: AssignmentMode;
    lockedAssignments: AssignmentMapping[];
    manualAssignments: AssignmentMapping[];
  };
  eligibleSeatIds: string[];
  assignments: AssignmentMapping[];
  diagnostics: AssignmentDiagnostic[];
  fingerprint: string;
  published: boolean;
}

interface SeatIdentity {
  classroomId: string;
  sourceSeatId: string;
}

interface AssignmentV2Mapping {
  boundUserId: number;
  seat: SeatIdentity;
}

interface AssignmentV2Participant {
  boundUserId: number;
  studentRecordId: string;
  studentId: string;
  teamId: string | null;
  teamRole: 'captain' | 'member' | null;
}

interface AssignmentV2SeatFact extends SeatIdentity {
  label: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  layoutStatus: string;
  enabled: boolean;
  facing: 'down' | 'left' | 'right' | 'unset' | 'up';
  disabledReason: 'client_incompatible' | 'computer_failure' | 'manual_reserve' | 'physical_seat_unavailable' | null;
  bindingId: string | null;
  bindingRevision: number | null;
  endpointId: string | null;
  endpointOnline: boolean | null;
}

interface AssignmentV2RiskEdge {
  left: SeatIdentity;
  right: SeatIdentity;
  distance: number;
  reason: 'perpendicular_facing' | 'same_facing' | 'unset_facing';
}

interface AssignmentV2Explanation {
  classrooms: Array<{ classroomId: string; assignedCount: number; eligibleSeatCount: number }>;
  highRiskEdges: AssignmentV2RiskEdge[];
  mediumRiskEdges: AssignmentV2RiskEdge[];
  splitTeamIds: string[];
  skippedSeats: Array<{ seat: SeatIdentity; reason: 'disabled' | 'layout_status' | 'unbound' }>;
  offlineSeats: SeatIdentity[];
  unsetFacingSeats: SeatIdentity[];
}

interface AssignmentV2Revision {
  schemaVersion: 2;
  assignmentId: string;
  revision: number;
  seatPlan: { seatPlanId: string; revision: number; fingerprint: string };
  roster: { rosterId: string; revision: number; fingerprint: string };
  classrooms: SeatPlanClassroomRef[];
  participants: AssignmentV2Participant[];
  seatFacts: AssignmentV2SeatFact[];
  constraints: {
    strategy: 'maximizeSpacing' | 'minimizeClassrooms';
    lockedAssignments: AssignmentV2Mapping[];
    manualAssignments: AssignmentV2Mapping[];
  };
  assignments: AssignmentV2Mapping[];
  explanation: AssignmentV2Explanation;
  fingerprint: string;
  published: boolean;
}

type AssignmentRevision = AssignmentV1Revision | AssignmentV2Revision;

interface PhysicalSeat {
  classroomId: string;
  sourceSeatId: string;
  label: string;
  status: string;
  bindingId: string | null;
  bindingRevision: number | null;
  endpointId: string | null;
}

interface EndpointPreflightItem {
  endpointId: string;
  online: boolean;
  ready: boolean;
  reason: string;
}

interface AssignmentWorkspace {
  eventRevision: number;
  eventType: 'krypton' | 'external';
  eventLifecycle: 'draft' | 'scheduled' | 'archived';
  contestAudienceState: 'fixed' | 'not-applicable' | 'public';
  startAt: string;
  endAt: string;
  rosterRevisions: RosterRevision[];
  seatPlans: SeatPlanRevision[];
  assignments: AssignmentRevision[];
  publicationRevision: number;
  source: { schemaVersion: 1 | 2; seatPlanRevision: number; seats: PhysicalSeat[] } | null;
  endpointState: 'available' | 'not-required' | 'unavailable';
  endpointItems: EndpointPreflightItem[];
  publishedRosterDrift: PublishedRosterDrift | null;
  latestSeatPlanState: 'current' | 'layout-drift' | 'not-ready';
  rosterGroups: Array<{ groupId: string; name: string }>;
  classrooms: Array<{ classroomId: string; name: string; layoutRevision: number; seatCount: number }>;
}

interface RevisionRef {
  id: string;
  revision: number;
  fingerprint: string;
}

type MonitoringWarningKind =
  | 'detector_degraded'
  | 'detector_failed'
  | 'detector_unsupported'
  | 'forbidden_process_detected'
  | 'forbidden_window_detected'
  | 'monitoring_failed'
  | 'monitoring_unavailable'
  | 'usb_storage_detected';

interface PreloginWorkflow {
  network: {
    source: 'config' | 'execution';
    configRevision: number | null;
    executionRevision: number;
    policy: RevisionRef;
    target: RevisionRef;
    targetCount: number;
    startAt: string;
    hardEndAt: string;
    ready: boolean;
    reason: 'network_execution_expired' | 'network_execution_failed' | 'network_execution_not_active' | 'network_execution_pending' | 'ready';
    appliedCount: number;
    failedCount: number;
    pendingCount: number;
    preloginEndpointCount: number;
    coveredPreloginCount: number;
    missingPreloginEndpointIds: string[];
  };
  monitoring: {
    ready: boolean;
    items: Array<{
      endpointId: string;
      ready: boolean;
      reason: string;
      online: boolean;
      serviceVersion: string | null;
      protocolVersion: number | null;
      warnings: Array<{ kind: MonitoringWarningKind; detector: 'foreground' | 'process' | 'usb' | null; reason: string | null }>;
    }>;
  };
  hardErrorCount: number;
  warningCount: number;
  fingerprint: string;
}

type PreloginDiagnosticCode =
  | 'active_session_conflict'
  | 'assignment_reference_changed'
  | 'contest_not_enterable'
  | 'endpoint_capability_missing'
  | 'endpoint_incompatible'
  | 'endpoint_offline'
  | 'external_workspace_unavailable'
  | 'seat_facing_changed'
  | 'seat_binding_changed'
  | 'user_binding_changed';

interface PreloginPreparationItem {
  uid: number;
  studentRecordId: string;
  sourceSeatId: string;
  bindingId: string | null;
  bindingRevision: number | null;
  endpointId: string | null;
  ready: boolean;
  diagnostics: Array<{ code: PreloginDiagnosticCode; severity: 'error' | 'warning' }>;
  endpoint: {
    online: boolean;
    serviceVersion: string | null;
    protocolVersion: number | null;
    activeSessionId: string | null;
  };
}

interface PreloginPreparation {
  eventRevision: number;
  assignment: { assignmentId: string; revision: number; fingerprint: string };
  publicationRevision: number;
  items: PreloginPreparationItem[];
  hardErrorCount: number;
  warningCount: number;
  fingerprint: string;
}

type PreloginDispatchStatus = 'applied' | 'expired' | 'failed' | 'offline' | 'queued' | 'rejected' | 'sent';
type PreloginStage = 'dispatch' | 'launch' | 'page_ready' | 'process_ready' | 'redeemed';

interface PreloginProjectionItem {
  ticketId: string;
  endpointId: string;
  commandId: string | null;
  status: PreloginDispatchStatus;
  stage: PreloginStage;
  failureReason: string | null;
}

interface PreloginBatchSubject {
  ticketId: string;
  uid: number;
  studentRecordId: string;
  sourceSeatId: string;
  bindingId: string;
  bindingRevision: number;
  endpointId: string;
  expiresAt: string;
  state: 'issued' | 'redeemed';
  redeemedAt: string | null;
}

interface PreloginBatch {
  batchId: string;
  eventRevision: number;
  assignment: { assignmentId: string; revision: number; fingerprint: string };
  publicationRevision: number;
  requestId: string;
  preparationFingerprint: string;
  workflow: {
    fingerprint: string;
    executionRevision: number;
    policy: RevisionRef;
    target: RevisionRef;
    targetCount: number;
    startAt: string;
    hardEndAt: string;
  } | null;
  state: 'dispatching' | 'dispatched';
  revision: number;
  ticketCount: number;
  subjects: PreloginBatchSubject[];
  projection: {
    requestId: string;
    batchId: string;
    dispatchStatus: 'complete' | 'dispatching';
    projectionRevision: number;
    summary: Record<string, number>;
    items: PreloginProjectionItem[];
  } | null;
  retryableTicketIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface PreloginTargetDraft {
  assignmentId: string;
  revision: number;
  sourceAssignmentId: string | null;
  latestPublishedRevision: number | null;
  latestPublishedSourceAssignmentId: string | null;
}

interface PreloginTargetPreview {
  publicationIdentity: string;
  fingerprint: string;
  targetCount: number;
  endpointIds: string[];
  addedEndpointIds: string[];
  removedEndpointIds: string[];
}

interface PreloginPolicyOption {
  templateId: string;
  name: string;
  revision: number;
  fingerprint: string;
}

function preloginPublicationIdentity(assignment: AssignmentRevision, publicationRevision: number): string {
  return `${assignment.assignmentId}\0${assignment.revision}\0${assignment.fingerprint}\0${publicationRevision}`;
}

function preloginBatchReachedTerminalState(batch: PreloginBatch): boolean {
  if (batch.state !== 'dispatched' || batch.projection?.dispatchStatus !== 'complete' || batch.subjects.length !== batch.ticketCount) return false;
  return batch.projection.items.every((item) => retryableStatuses.has(item.status) || (item.status === 'applied' && item.stage === 'page_ready'));
}

export interface AssignmentCsvRow {
  boundUserId: number;
  studentId: string;
  realName: string;
  classroomId: string;
  sourceSeatId: string;
  seatLabel: string;
  endpointId: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}响应格式不正确`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}响应格式不正确`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 0) throw new Error(`${label}响应格式不正确`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 1) throw new Error(`${label}响应格式不正确`);
  return result;
}

function fingerprint(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label}响应格式不正确`);
  return result;
}

function objectId(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{24}$/.test(result)) throw new Error(`${label}响应格式不正确`);
  return result;
}

function isoDate(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) throw new Error(`${label}响应格式不正确`);
  return result;
}

function requestId(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(result)) throw new Error(`${label}响应格式不正确`);
  return result;
}

function parseMapping(value: unknown): AssignmentMapping {
  const row = record(value, '座位映射');
  return { boundUserId: integer(row.boundUserId, '座位映射'), sourceSeatId: text(row.sourceSeatId, '座位映射') };
}

function parseSeatIdentity(value: unknown, label = '结构化座位'): SeatIdentity {
  const row = record(value, label);
  return { classroomId: objectId(row.classroomId, label), sourceSeatId: text(row.sourceSeatId, label) };
}

function parseV2Mapping(value: unknown): AssignmentV2Mapping {
  const row = record(value, '结构化座位映射');
  return { boundUserId: positiveInteger(row.boundUserId, '结构化座位映射'), seat: parseSeatIdentity(row.seat) };
}

function parseSeatPlanClassroom(value: unknown): SeatPlanClassroomRef {
  const row = record(value, '教室座位计划');
  return {
    classroomId: objectId(row.classroomId, '教室座位计划'),
    layoutRevision: positiveInteger(row.layoutRevision, '教室座位计划'),
    layoutFingerprint: fingerprint(row.layoutFingerprint, '教室座位计划'),
    profileRevision: nonNegativeInteger(row.profileRevision, '教室座位计划'),
    profileFingerprint: fingerprint(row.profileFingerprint, '教室座位计划'),
    candidateSeatIds: array(row.candidateSeatIds, '教室座位计划').map((item) => text(item, '教室座位计划')),
  };
}

function parseDiagnostic(value: unknown): AssignmentDiagnostic {
  const row = record(value, '诊断');
  const diagnostic: AssignmentDiagnostic = { code: text(row.code, '诊断') };
  if (row.sourceSeatIds !== undefined) diagnostic.sourceSeatIds = array(row.sourceSeatIds, '诊断').map((item) => text(item, '诊断'));
  if (row.seats !== undefined) {
    diagnostic.seats = array(row.seats, '诊断').map((item) => {
      const skipped = record(item, '座位跳过诊断');
      const reason = text(skipped.reason, '座位跳过诊断');
      if (reason !== 'disabled' && reason !== 'layout_status' && reason !== 'unbound') throw new Error('座位跳过诊断响应格式不正确');
      return { seat: parseSeatIdentity(skipped.seat, '座位跳过诊断'), reason };
    });
  }
  if (row.requiredSeatCount !== undefined) diagnostic.requiredSeatCount = integer(row.requiredSeatCount, '诊断');
  if (row.availableSeatCount !== undefined) diagnostic.availableSeatCount = integer(row.availableSeatCount, '诊断');
  if (row.reasons !== undefined) diagnostic.reasons = array(row.reasons, '诊断').map((item) => text(item, '诊断'));
  return diagnostic;
}

function parseRoster(value: unknown): RosterRevision {
  const row = record(value, '名单版本');
  const source = record(row.source, '名单来源');
  const sourceKind = text(source.kind, '名单来源');
  if (sourceKind !== 'contestAudience' && sourceKind !== 'userbindGroups' && sourceKind !== 'userbindSchool') {
    throw new Error('名单来源响应格式不正确');
  }
  return {
    rosterId: text(row.rosterId, '名单版本'),
    revision: integer(row.revision, '名单版本'),
    fingerprint: text(row.fingerprint, '名单版本'),
    source: { kind: sourceKind },
    entries: array(row.entries, '名单版本').map((item) => {
      const entry = record(item, '名单学生');
      return {
        studentId: text(entry.studentId, '名单学生'),
        realName: text(entry.realName, '名单学生'),
        boundUserId: integer(entry.boundUserId, '名单学生'),
      };
    }),
  };
}

function nullableTeamRole(value: unknown, context: string): 'captain' | 'member' | null {
  if (value === null) return null;
  const role = text(value, context);
  if (role !== 'captain' && role !== 'member') throw new Error(`${context}响应格式不正确`);
  return role;
}

function parsePublishedRosterDrift(value: unknown): PublishedRosterDrift | null {
  if (value === null) return null;
  const row = record(value, '发布名单漂移');
  return {
    changed: boolean(row.changed, '发布名单漂移'),
    sourceChangedWithoutParticipantDiff: boolean(row.sourceChangedWithoutParticipantDiff, '发布名单漂移'),
    items: array(row.items, '发布名单漂移').map((item) => {
      const change = record(item, '发布名单漂移人员');
      const kind = text(change.kind, '发布名单漂移人员');
      if (kind !== 'added' && kind !== 'removed' && kind !== 'identity_changed' && kind !== 'team_changed') {
        throw new Error('发布名单漂移人员响应格式不正确');
      }
      return {
        boundUserId: positiveInteger(change.boundUserId, '发布名单漂移人员'),
        studentId: text(change.studentId, '发布名单漂移人员'),
        realName: text(change.realName, '发布名单漂移人员'),
        kind,
        previousTeamId: change.previousTeamId === null ? null : objectId(change.previousTeamId, '发布名单漂移人员'),
        previousTeamRole: nullableTeamRole(change.previousTeamRole, '发布名单漂移人员'),
        currentTeamId: change.currentTeamId === null ? null : objectId(change.currentTeamId, '发布名单漂移人员'),
        currentTeamRole: nullableTeamRole(change.currentTeamRole, '发布名单漂移人员'),
      };
    }),
  };
}

function parseSeatPlan(value: unknown): SeatPlanRevision {
  const row = record(value, '座位计划');
  const schemaVersion = integer(row.schemaVersion, '座位计划');
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error('座位计划响应格式不正确');
  const roster = row.roster === null ? null : record(row.roster, '座位计划名单');
  const common = {
    seatPlanId: objectId(row.seatPlanId, '座位计划'),
    revision: positiveInteger(row.revision, '座位计划'),
    roster: roster
      ? {
          rosterId: objectId(roster.rosterId, '座位计划名单'),
          revision: positiveInteger(roster.revision, '座位计划名单'),
          fingerprint: fingerprint(roster.fingerprint, '座位计划名单'),
        }
      : null,
    fingerprint: fingerprint(row.fingerprint, '座位计划'),
    diagnostics: array(row.diagnostics, '座位计划').map(parseDiagnostic),
  };
  if (schemaVersion === 2) {
    return {
      ...common,
      schemaVersion,
      classrooms: array(row.classrooms, '座位计划').map(parseSeatPlanClassroom),
    };
  }
  return {
    ...common,
    schemaVersion,
    classroomId: text(row.classroomId, '座位计划'),
    layoutRevision: positiveInteger(row.layoutRevision, '座位计划'),
    layoutFingerprint: fingerprint(row.layoutFingerprint, '座位计划'),
    candidateSeatIds: array(row.candidateSeatIds, '座位计划').map((item) => text(item, '座位计划')),
  };
}

function parseAssignment(input: unknown): AssignmentRevision {
  const row = record(input, '分配版本');
  const schemaVersion = integer(row.schemaVersion, '分配版本');
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error('分配版本响应格式不正确');
  const seatPlan = record(row.seatPlan, '分配座位计划');
  const roster = record(row.roster, '分配名单');
  if (typeof row.published !== 'boolean') throw new Error('分配版本响应格式不正确');
  const common = {
    assignmentId: objectId(row.assignmentId, '分配版本'),
    revision: positiveInteger(row.revision, '分配版本'),
    seatPlan: {
      seatPlanId: objectId(seatPlan.seatPlanId, '分配座位计划'),
      revision: positiveInteger(seatPlan.revision, '分配座位计划'),
      fingerprint: fingerprint(seatPlan.fingerprint, '分配座位计划'),
    },
    roster: {
      rosterId: objectId(roster.rosterId, '分配名单'),
      revision: positiveInteger(roster.revision, '分配名单'),
      fingerprint: fingerprint(roster.fingerprint, '分配名单'),
    },
    fingerprint: fingerprint(row.fingerprint, '分配版本'),
    published: row.published,
  };
  const constraints = record(row.constraints, '分配约束');
  if (schemaVersion === 2) {
    const strategy = text(constraints.strategy, '分配约束');
    if (strategy !== 'maximizeSpacing' && strategy !== 'minimizeClassrooms') throw new Error('分配约束响应格式不正确');
    const participants = array(row.participants, '分配参与者').map((value): AssignmentV2Participant => {
      const participant = record(value, '分配参与者');
      const teamRole = participant.teamRole === null ? null : text(participant.teamRole, '分配参与者');
      if (teamRole !== null && teamRole !== 'captain' && teamRole !== 'member') throw new Error('分配参与者响应格式不正确');
      return {
        boundUserId: positiveInteger(participant.boundUserId, '分配参与者'),
        studentRecordId: objectId(participant.studentRecordId, '分配参与者'),
        studentId: text(participant.studentId, '分配参与者'),
        teamId: optionalText(participant.teamId, '分配参与者'),
        teamRole,
      };
    });
    const facingValues = new Set<AssignmentV2SeatFact['facing']>(['down', 'left', 'right', 'unset', 'up']);
    const disabledReasons = new Set<NonNullable<AssignmentV2SeatFact['disabledReason']>>([
      'client_incompatible',
      'computer_failure',
      'manual_reserve',
      'physical_seat_unavailable',
    ]);
    const seatFacts = array(row.seatFacts, '分配座位事实').map((value): AssignmentV2SeatFact => {
      const fact = record(value, '分配座位事实');
      const facing = text(fact.facing, '分配座位事实') as AssignmentV2SeatFact['facing'];
      if (!facingValues.has(facing)) throw new Error('分配座位事实响应格式不正确');
      const disabledReason = fact.disabledReason === null ? null : text(fact.disabledReason, '分配座位事实');
      if (disabledReason !== null && !disabledReasons.has(disabledReason as NonNullable<AssignmentV2SeatFact['disabledReason']>)) {
        throw new Error('分配座位事实响应格式不正确');
      }
      const endpointOnline = fact.endpointOnline === null ? null : boolean(fact.endpointOnline, '分配座位事实');
      return {
        ...parseSeatIdentity(fact, '分配座位事实'),
        label: text(fact.label, '分配座位事实'),
        x: finiteNumber(fact.x, '分配座位事实'),
        y: finiteNumber(fact.y, '分配座位事实'),
        width: fact.width === null ? null : finiteNumber(fact.width, '分配座位事实'),
        height: fact.height === null ? null : finiteNumber(fact.height, '分配座位事实'),
        rotation: finiteNumber(fact.rotation, '分配座位事实'),
        layoutStatus: text(fact.layoutStatus, '分配座位事实'),
        enabled: boolean(fact.enabled, '分配座位事实'),
        facing,
        disabledReason: disabledReason as AssignmentV2SeatFact['disabledReason'],
        bindingId: fact.bindingId === null ? null : objectId(fact.bindingId, '分配座位事实'),
        bindingRevision: fact.bindingRevision === null ? null : positiveInteger(fact.bindingRevision, '分配座位事实'),
        endpointId: optionalText(fact.endpointId, '分配座位事实'),
        endpointOnline,
      };
    });
    const explanation = record(row.explanation, '分配解释');
    const parseRiskEdge = (value: unknown): AssignmentV2RiskEdge => {
      const edge = record(value, '分配风险边');
      const reason = text(edge.reason, '分配风险边');
      if (reason !== 'perpendicular_facing' && reason !== 'same_facing' && reason !== 'unset_facing') {
        throw new Error('分配风险边响应格式不正确');
      }
      return {
        left: parseSeatIdentity(edge.left),
        right: parseSeatIdentity(edge.right),
        distance: finiteNumber(edge.distance, '分配风险边'),
        reason,
      };
    };
    const skippedSeats = array(explanation.skippedSeats, '分配解释').map((value): AssignmentV2Explanation['skippedSeats'][number] => {
      const skipped = record(value, '分配跳过座位');
      const reason = text(skipped.reason, '分配跳过座位');
      if (reason !== 'disabled' && reason !== 'layout_status' && reason !== 'unbound') throw new Error('分配跳过座位响应格式不正确');
      return { seat: parseSeatIdentity(skipped.seat), reason };
    });
    return {
      ...common,
      schemaVersion,
      classrooms: array(row.classrooms, '分配教室').map(parseSeatPlanClassroom),
      participants,
      seatFacts,
      constraints: {
        strategy,
        lockedAssignments: array(constraints.lockedAssignments, '分配约束').map(parseV2Mapping),
        manualAssignments: array(constraints.manualAssignments, '分配约束').map(parseV2Mapping),
      },
      assignments: array(row.assignments, '分配版本').map(parseV2Mapping),
      explanation: {
        classrooms: array(explanation.classrooms, '分配解释').map((value) => {
          const classroom = record(value, '分配解释教室');
          return {
            classroomId: objectId(classroom.classroomId, '分配解释教室'),
            assignedCount: nonNegativeInteger(classroom.assignedCount, '分配解释教室'),
            eligibleSeatCount: nonNegativeInteger(classroom.eligibleSeatCount, '分配解释教室'),
          };
        }),
        highRiskEdges: array(explanation.highRiskEdges, '分配解释').map(parseRiskEdge),
        mediumRiskEdges: array(explanation.mediumRiskEdges, '分配解释').map(parseRiskEdge),
        splitTeamIds: array(explanation.splitTeamIds, '分配解释').map((value) => text(value, '分配解释')),
        skippedSeats,
        offlineSeats: array(explanation.offlineSeats, '分配解释').map((value) => parseSeatIdentity(value)),
        unsetFacingSeats: array(explanation.unsetFacingSeats, '分配解释').map((value) => parseSeatIdentity(value)),
      },
    };
  }
  const mode = text(constraints.mode, '分配约束');
  if (mode !== 'random' && mode !== 'studentId') throw new Error('分配约束响应格式不正确');
  return {
    ...common,
    schemaVersion,
    classroomId: objectId(row.classroomId, '分配版本'),
    layoutRevision: positiveInteger(row.layoutRevision, '分配版本'),
    layoutFingerprint: fingerprint(row.layoutFingerprint, '分配版本'),
    candidateSeatIds: array(row.candidateSeatIds, '分配版本').map((item) => text(item, '分配版本')),
    constraints: {
      mode,
      lockedAssignments: array(constraints.lockedAssignments, '分配约束').map(parseMapping),
      manualAssignments: array(constraints.manualAssignments, '分配约束').map(parseMapping),
    },
    eligibleSeatIds: array(row.eligibleSeatIds, '分配版本').map((item) => text(item, '分配版本')),
    assignments: array(row.assignments, '分配版本').map(parseMapping),
    diagnostics: array(row.diagnostics, '分配版本').map(parseDiagnostic),
  };
}

function parseSeat(value: unknown, fallbackClassroomId?: string): PhysicalSeat {
  const row = record(value, '实体座位');
  return {
    classroomId: row.classroomId === undefined ? objectId(fallbackClassroomId, '实体座位') : objectId(row.classroomId, '实体座位'),
    sourceSeatId: text(row.sourceSeatId, '实体座位'),
    label: text(row.label, '实体座位'),
    status: text(row.status, '实体座位'),
    bindingId: optionalText(row.bindingId, '实体座位'),
    bindingRevision: row.bindingRevision === null ? null : integer(row.bindingRevision, '实体座位'),
    endpointId: optionalText(row.endpointId, '实体座位'),
  };
}

function parsePreflightItem(value: unknown): EndpointPreflightItem {
  const row = record(value, '终端预检');
  if (typeof row.online !== 'boolean' || typeof row.ready !== 'boolean') throw new Error('终端预检响应格式不正确');
  return {
    endpointId: text(row.endpointId, '终端预检'),
    online: row.online,
    ready: row.ready,
    reason: text(row.reason, '终端预检'),
  };
}

function parseRosterGroup(value: unknown): { groupId: string; name: string } {
  const row = record(value, '名单用户组');
  return { groupId: text(row.groupId, '名单用户组'), name: text(row.name, '名单用户组') };
}

function parseClassroomSummary(value: unknown): { classroomId: string; name: string; layoutRevision: number; seatCount: number } {
  const row = record(value, '候选教室');
  return {
    classroomId: text(row.classroomId, '候选教室'),
    name: text(row.name, '候选教室'),
    layoutRevision: integer(row.layoutRevision, '候选教室'),
    seatCount: integer(row.seatCount, '候选教室'),
  };
}

function parseRevisionRef(value: unknown, label: string): RevisionRef {
  const row = record(value, label);
  return {
    id: objectId(row.id, label),
    revision: positiveInteger(row.revision, label),
    fingerprint: fingerprint(row.fingerprint, label),
  };
}

const monitoringWarningKinds = new Set<MonitoringWarningKind>([
  'detector_degraded',
  'detector_failed',
  'detector_unsupported',
  'forbidden_process_detected',
  'forbidden_window_detected',
  'monitoring_failed',
  'monitoring_unavailable',
  'usb_storage_detected',
]);

function parsePreloginWorkflow(value: unknown): PreloginWorkflow {
  const row = record(value, '考试准备工作流');
  if (positiveInteger(row.schemaVersion, '考试准备工作流') !== 1) throw new Error('考试准备工作流响应格式不正确');
  const network = record(row.network, '网络版本');
  const source = text(network.source, '网络版本');
  if (source !== 'config' && source !== 'execution') throw new Error('网络版本响应格式不正确');
  const configRevision = network.configRevision === null ? null : positiveInteger(network.configRevision, '网络版本');
  const executionRevision = nonNegativeInteger(network.executionRevision, '网络版本');
  if ((source === 'config') !== (configRevision !== null) || (source === 'execution' && executionRevision < 1)) {
    throw new Error('网络版本响应身份不一致');
  }
  const networkReady = boolean(network.ready, '网络版本');
  const networkReason = text(network.reason, '网络版本') as PreloginWorkflow['network']['reason'];
  if (
    !['network_execution_expired', 'network_execution_failed', 'network_execution_not_active', 'network_execution_pending', 'ready'].includes(
      networkReason,
    )
  ) {
    throw new Error('网络版本响应格式不正确');
  }
  const targetCount = positiveInteger(network.targetCount, '目标版本');
  const appliedCount = nonNegativeInteger(network.appliedCount, '网络版本');
  const failedCount = nonNegativeInteger(network.failedCount, '网络版本');
  const pendingCount = nonNegativeInteger(network.pendingCount, '网络版本');
  const preloginEndpointCount = nonNegativeInteger(network.preloginEndpointCount, '网络目标覆盖');
  const coveredPreloginCount = nonNegativeInteger(network.coveredPreloginCount, '网络目标覆盖');
  const missingPreloginEndpointIds = array(network.missingPreloginEndpointIds, '网络目标覆盖').map((endpointId) => text(endpointId, '网络目标覆盖'));
  if (
    appliedCount + failedCount + pendingCount !== targetCount ||
    coveredPreloginCount + missingPreloginEndpointIds.length !== preloginEndpointCount ||
    coveredPreloginCount > targetCount ||
    new Set(missingPreloginEndpointIds).size !== missingPreloginEndpointIds.length ||
    networkReady !== (source === 'execution' && networkReason === 'ready' && appliedCount === targetCount) ||
    (source === 'config' && networkReason !== 'network_execution_not_active')
  ) {
    throw new Error('网络版本响应身份不一致');
  }
  const monitoring = record(row.monitoring, '监测预检');
  const monitoringItems = array(monitoring.items, '监测预检').map((rawItem) => {
    const item = record(rawItem, '监测预检终端');
    const warnings = array(item.warnings, '监测告警').map((rawWarning) => {
      const warning = record(rawWarning, '监测告警');
      const kind = text(warning.kind, '监测告警') as MonitoringWarningKind;
      if (!monitoringWarningKinds.has(kind)) throw new Error('监测告警响应格式不正确');
      const detector = warning.detector;
      if (detector !== null && detector !== 'foreground' && detector !== 'process' && detector !== 'usb') {
        throw new Error('监测告警响应格式不正确');
      }
      return {
        kind,
        detector: detector as 'foreground' | 'process' | 'usb' | null,
        reason: optionalText(warning.reason, '监测告警'),
      };
    });
    array(item.capabilities, '监测能力').forEach((rawCapability) => {
      const capability = record(rawCapability, '监测能力');
      text(capability.name, '监测能力');
      positiveInteger(capability.version, '监测能力');
      array(capability.commands, '监测能力').forEach((command) => text(command, '监测能力'));
    });
    return {
      endpointId: text(item.endpointId, '监测预检终端'),
      ready: boolean(item.ready, '监测预检终端'),
      reason: text(item.reason, '监测预检终端'),
      online: boolean(item.online, '监测预检终端'),
      serviceVersion: optionalText(item.serviceVersion, '监测预检终端'),
      protocolVersion: item.protocolVersion === null ? null : positiveInteger(item.protocolVersion, '监测预检终端'),
      warnings,
    };
  });
  if (
    new Set(monitoringItems.map((item) => item.endpointId)).size !== monitoringItems.length ||
    boolean(monitoring.ready, '监测预检') !== monitoringItems.every((item) => item.ready)
  ) {
    throw new Error('监测预检响应身份不一致');
  }
  const hardErrorCount = nonNegativeInteger(row.hardErrorCount, '考试准备工作流');
  if (!networkReady && hardErrorCount < 1) throw new Error('考试准备工作流响应状态不一致');
  return {
    network: {
      source,
      configRevision,
      executionRevision,
      policy: parseRevisionRef(network.policy, '策略版本'),
      target: parseRevisionRef(network.target, '目标版本'),
      targetCount,
      startAt: isoDate(network.startAt, '网络窗口'),
      hardEndAt: isoDate(network.hardEndAt, '网络窗口'),
      ready: networkReady,
      reason: networkReason,
      appliedCount,
      failedCount,
      pendingCount,
      preloginEndpointCount,
      coveredPreloginCount,
      missingPreloginEndpointIds,
    },
    monitoring: { ready: monitoringItems.every((item) => item.ready), items: monitoringItems },
    hardErrorCount,
    warningCount: nonNegativeInteger(row.warningCount, '考试准备工作流'),
    fingerprint: fingerprint(row.fingerprint, '考试准备工作流'),
  };
}

const preloginDiagnosticCodes = new Set<PreloginDiagnosticCode>([
  'active_session_conflict',
  'assignment_reference_changed',
  'contest_not_enterable',
  'endpoint_capability_missing',
  'endpoint_incompatible',
  'endpoint_offline',
  'external_workspace_unavailable',
  'seat_facing_changed',
  'seat_binding_changed',
  'user_binding_changed',
]);

function parsePreloginPreparation(value: unknown, expectedEventId: string): PreloginPreparation {
  const row = record(value, '预登录预检');
  if (positiveInteger(row.schemaVersion, '预登录预检') !== 1 || objectId(row.eventId, '预登录预检') !== expectedEventId) {
    throw new Error('预登录预检响应身份不一致');
  }
  text(row.domainId, '预登录预检');
  const assignment = record(row.assignment, '预登录分配');
  if (row.workspace !== null) {
    const workspace = record(row.workspace, '预登录工作台');
    if (workspace.kind !== 'contest' || text(workspace.path, '预登录工作台') !== `/exam-mode/${objectId(workspace.contestId, '预登录工作台')}`) {
      throw new Error('预登录工作台响应格式不正确');
    }
  }
  const items = array(row.items, '预登录预检').map((rawItem): PreloginPreparationItem => {
    const item = record(rawItem, '预登录终端');
    const endpoint = record(item.endpoint, '预登录终端');
    boolean(endpoint.online, '预登录终端');
    array(endpoint.capabilities, '预登录终端').forEach((rawCapability) => {
      const capability = record(rawCapability, '预登录能力');
      text(capability.name, '预登录能力');
      positiveInteger(capability.version, '预登录能力');
      array(capability.commands, '预登录能力').forEach((command) => text(command, '预登录能力'));
    });
    const diagnostics = array(item.diagnostics, '预登录诊断').map((rawDiagnostic) => {
      const diagnostic = record(rawDiagnostic, '预登录诊断');
      const code = text(diagnostic.code, '预登录诊断') as PreloginDiagnosticCode;
      const severity = text(diagnostic.severity, '预登录诊断');
      if (!preloginDiagnosticCodes.has(code) || (severity !== 'error' && severity !== 'warning')) {
        throw new Error('预登录诊断响应格式不正确');
      }
      return { code, severity } as const;
    });
    return {
      uid: positiveInteger(item.uid, '预登录终端'),
      studentRecordId: objectId(item.studentRecordId, '预登录终端'),
      sourceSeatId: text(item.sourceSeatId, '预登录终端'),
      bindingId: item.bindingId === null ? null : objectId(item.bindingId, '预登录终端'),
      bindingRevision: item.bindingRevision === null ? null : positiveInteger(item.bindingRevision, '预登录终端'),
      endpointId: optionalText(item.endpointId, '预登录终端'),
      ready: boolean(item.ready, '预登录终端'),
      diagnostics,
      endpoint: {
        online: endpoint.online as boolean,
        serviceVersion: optionalText(endpoint.serviceVersion, '预登录终端'),
        protocolVersion: endpoint.protocolVersion === null ? null : positiveInteger(endpoint.protocolVersion, '预登录终端'),
        activeSessionId: optionalText(endpoint.activeSessionId, '预登录终端'),
      },
    };
  });
  if (items.length > 500 || new Set(items.map((item) => item.uid)).size !== items.length) throw new Error('预登录预检响应身份重复');
  return {
    eventRevision: positiveInteger(row.eventRevision, '预登录预检'),
    assignment: {
      assignmentId: objectId(assignment.assignmentId, '预登录分配'),
      revision: positiveInteger(assignment.revision, '预登录分配'),
      fingerprint: fingerprint(assignment.fingerprint, '预登录分配'),
    },
    publicationRevision: positiveInteger(row.publicationRevision, '预登录预检'),
    items,
    hardErrorCount: nonNegativeInteger(row.hardErrorCount, '预登录预检'),
    warningCount: nonNegativeInteger(row.warningCount, '预登录预检'),
    fingerprint: fingerprint(row.fingerprint, '预登录预检'),
  };
}

const dispatchStatuses = new Set<PreloginDispatchStatus>(['applied', 'expired', 'failed', 'offline', 'queued', 'rejected', 'sent']);
const preloginStages = new Set<PreloginStage>(['dispatch', 'launch', 'page_ready', 'process_ready', 'redeemed']);
const retryableStatuses = new Set<PreloginDispatchStatus>(['expired', 'failed', 'offline', 'rejected']);

function parsePreloginBatch(value: unknown, expectedEventId: string): PreloginBatch {
  const row = record(value, '预登录批次');
  const batchId = objectId(row.batchId, '预登录批次');
  if (objectId(row.eventId, '预登录批次') !== expectedEventId) throw new Error('预登录批次响应身份不一致');
  const state = text(row.state, '预登录批次');
  if (state !== 'dispatching' && state !== 'dispatched') throw new Error('预登录批次响应格式不正确');
  const assignment = record(row.assignment, '预登录批次分配');
  const workflow = row.workflow === null ? null : record(row.workflow, '预登录批次网络版本');
  const workflowStartAt = workflow ? isoDate(workflow.startAt, '预登录批次网络窗口') : null;
  const workflowHardEndAt = workflow ? isoDate(workflow.hardEndAt, '预登录批次网络窗口') : null;
  if (workflowStartAt && workflowHardEndAt && workflowHardEndAt <= workflowStartAt) {
    throw new Error('预登录批次网络窗口响应格式不正确');
  }
  const subjects = array(row.subjects, '预登录批次终端').map((rawSubject): PreloginBatchSubject => {
    const subject = record(rawSubject, '预登录批次终端');
    const ticketState = text(subject.state, '预登录批次终端');
    if (ticketState !== 'issued' && ticketState !== 'redeemed') throw new Error('预登录批次终端响应格式不正确');
    return {
      ticketId: objectId(subject.ticketId, '预登录批次终端'),
      uid: positiveInteger(subject.uid, '预登录批次终端'),
      studentRecordId: objectId(subject.studentRecordId, '预登录批次终端'),
      sourceSeatId: text(subject.sourceSeatId, '预登录批次终端'),
      bindingId: objectId(subject.bindingId, '预登录批次终端'),
      bindingRevision: positiveInteger(subject.bindingRevision, '预登录批次终端'),
      endpointId: text(subject.endpointId, '预登录批次终端'),
      expiresAt: isoDate(subject.expiresAt, '预登录批次终端'),
      state: ticketState,
      redeemedAt: subject.redeemedAt === null ? null : isoDate(subject.redeemedAt, '预登录批次终端'),
    };
  });
  const ticketCount = nonNegativeInteger(row.ticketCount, '预登录批次');
  if (
    ticketCount > 500 ||
    subjects.length > ticketCount ||
    new Set(subjects.map((item) => item.ticketId)).size !== subjects.length ||
    new Set(subjects.map((item) => item.endpointId)).size !== subjects.length ||
    (state === 'dispatched' && subjects.length !== ticketCount)
  ) {
    throw new Error('预登录批次终端响应身份不一致');
  }
  const subjectByTicket = new Map(subjects.map((subject) => [subject.ticketId, subject]));
  let projection: PreloginBatch['projection'] = null;
  if (row.projection !== null) {
    const rawProjection = record(row.projection, '预登录投影');
    const dispatchStatus = text(rawProjection.dispatchStatus, '预登录投影');
    if (dispatchStatus !== 'complete' && dispatchStatus !== 'dispatching') throw new Error('预登录投影响应格式不正确');
    const projectionItems = array(rawProjection.items, '预登录投影').map((rawItem): PreloginProjectionItem => {
      const item = record(rawItem, '预登录投影终端');
      const status = text(item.status, '预登录投影终端') as PreloginDispatchStatus;
      const stage = text(item.stage, '预登录投影终端') as PreloginStage;
      if (!dispatchStatuses.has(status) || !preloginStages.has(stage)) throw new Error('预登录投影终端响应格式不正确');
      return {
        ticketId: objectId(item.ticketId, '预登录投影终端'),
        endpointId: text(item.endpointId, '预登录投影终端'),
        commandId: optionalText(item.commandId, '预登录投影终端'),
        status,
        stage,
        failureReason: optionalText(item.failureReason, '预登录投影终端'),
      };
    });
    if (
      projectionItems.length !== subjects.length ||
      new Set(projectionItems.map((item) => item.ticketId)).size !== projectionItems.length ||
      projectionItems.some((item) => subjectByTicket.get(item.ticketId)?.endpointId !== item.endpointId)
    ) {
      throw new Error('预登录投影响应身份不一致');
    }
    const summary = record(rawProjection.summary, '预登录投影汇总');
    const parsedSummary = Object.fromEntries(Object.entries(summary).map(([key, count]) => [key, nonNegativeInteger(count, '预登录投影汇总')]));
    projection = {
      requestId: requestId(rawProjection.requestId, '预登录投影'),
      batchId: objectId(rawProjection.batchId, '预登录投影'),
      dispatchStatus,
      projectionRevision: positiveInteger(rawProjection.projectionRevision, '预登录投影'),
      summary: parsedSummary,
      items: projectionItems,
    };
    if (projection.batchId !== batchId) throw new Error('预登录投影响应身份不一致');
  }
  if ((state === 'dispatched') !== Boolean(projection)) throw new Error('预登录批次响应状态不一致');
  const retryableTicketIds = array(row.retryableTicketIds, '预登录失败重试集').map((item) => objectId(item, '预登录失败重试集'));
  const derivedRetryable = (projection?.items || [])
    .filter((item) => retryableStatuses.has(item.status))
    .map((item) => item.ticketId)
    .sort();
  if (JSON.stringify([...retryableTicketIds].sort()) !== JSON.stringify(derivedRetryable)) throw new Error('预登录失败重试集响应不一致');
  return {
    batchId,
    eventRevision: positiveInteger(row.eventRevision, '预登录批次'),
    assignment: {
      assignmentId: objectId(assignment.assignmentId, '预登录批次分配'),
      revision: positiveInteger(assignment.revision, '预登录批次分配'),
      fingerprint: fingerprint(assignment.fingerprint, '预登录批次分配'),
    },
    publicationRevision: positiveInteger(row.publicationRevision, '预登录批次'),
    requestId: requestId(row.requestId, '预登录批次'),
    preparationFingerprint: fingerprint(row.preparationFingerprint, '预登录批次'),
    workflow:
      workflow && workflowStartAt && workflowHardEndAt
        ? {
            fingerprint: fingerprint(workflow.fingerprint, '预登录批次网络版本'),
            executionRevision: positiveInteger(workflow.executionRevision, '预登录批次网络版本'),
            policy: parseRevisionRef(workflow.policy, '预登录批次策略版本'),
            target: parseRevisionRef(workflow.target, '预登录批次目标版本'),
            targetCount: positiveInteger(workflow.targetCount, '预登录批次目标版本'),
            startAt: workflowStartAt,
            hardEndAt: workflowHardEndAt,
          }
        : null,
    state,
    revision: positiveInteger(row.revision, '预登录批次'),
    ticketCount,
    subjects,
    projection,
    retryableTicketIds: [...retryableTicketIds].sort(),
    createdAt: isoDate(row.createdAt, '预登录批次'),
    updatedAt: isoDate(row.updatedAt, '预登录批次'),
  };
}

async function apiObject(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(
    path,
    { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init?.headers || {}) } },
    '座位分配操作失败',
  );
  if (!response.ok) throw new Error(await readHydroResponseError(response, '座位分配操作失败'));
  const value: unknown = await response.json();
  return record(value, '座位分配');
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiObject(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const neutralized = typeof value === 'string' && (/^[\t\r]/.test(raw) || /^\s*[=+\-@]/.test(raw)) ? `'${raw}` : raw;
  return /[",\r\n\t]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

export function assignmentCsv(rows: AssignmentCsvRow[], revision: number): string {
  return [
    ['studentId', 'realName', 'seatLabel', 'sourceSeatId', 'endpointId', 'assignmentRevision'],
    ...rows.map((row) => [row.studentId, row.realName, row.seatLabel, row.sourceSeatId, row.endpointId, revision]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

export function assignmentCsvV2(rows: AssignmentCsvRow[], revision: number): string {
  return [
    ['studentId', 'realName', 'classroomId', 'seatLabel', 'sourceSeatId', 'endpointId', 'assignmentRevision'],
    ...rows.map((row) => [row.studentId, row.realName, row.classroomId, row.seatLabel, row.sourceSeatId, row.endpointId, revision]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function seatIdentityKey(seat: SeatIdentity): string {
  return `${seat.classroomId}\u0000${seat.sourceSeatId}`;
}

function riskEdgeKey(edge: AssignmentV2RiskEdge): string {
  return `${seatIdentityKey(edge.left)}\u0001${seatIdentityKey(edge.right)}`;
}

function diagnosticText(diagnostic: AssignmentDiagnostic): string {
  if (diagnostic.code === 'insufficient_seats') {
    return `可用座位不足：需要 ${diagnostic.requiredSeatCount || 0}，当前 ${diagnostic.availableSeatCount || 0}`;
  }
  if (diagnostic.code === 'seat_disabled') return `已排除禁用座位：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  if (diagnostic.code === 'seat_unbound') return `已排除未绑定终端的座位：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  if (diagnostic.code === 'seat_status_invalid') return `座位状态异常：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  if (diagnostic.code === 'seat_skipped') {
    return `已跳过不可分配座位：${diagnostic.seats?.map((item) => `${item.seat.classroomId}/${item.seat.sourceSeatId}（${item.reason}）`).join('、') || '-'}`;
  }
  return `约束冲突：${diagnostic.reasons?.join('、') || diagnostic.code}`;
}

function rosterDriftText(item: PublishedRosterDriftItem): string {
  const person = `${item.studentId || `UID ${item.boundUserId}`} · ${item.realName || `UID ${item.boundUserId}`}`;
  if (item.kind === 'added') return `新增参赛者：${person}`;
  if (item.kind === 'removed') return `移除参赛者：${person}`;
  if (item.kind === 'identity_changed') return `学生身份资料变化：${person}`;
  const previous = item.previousTeamId ? `${item.previousTeamId} / ${item.previousTeamRole === 'captain' ? '队长' : '队员'}` : '非团队成员';
  const current = item.currentTeamId ? `${item.currentTeamId} / ${item.currentTeamRole === 'captain' ? '队长' : '队员'}` : '非团队成员';
  return `团队或角色变化：${person}（${previous} → ${current}）`;
}

const facingLabel: Record<AssignmentV2SeatFact['facing'], string> = {
  down: '↓',
  left: '←',
  right: '→',
  unset: '·',
  up: '↑',
};

const facingAccessibleLabel: Record<AssignmentV2SeatFact['facing'], string> = {
  down: '朝下',
  left: '朝左',
  right: '朝右',
  unset: '朝向未设置',
  up: '朝上',
};

const skippedReasonLabel: Record<AssignmentV2Explanation['skippedSeats'][number]['reason'], string> = {
  disabled: '已禁用',
  layout_status: '布局状态不可用',
  unbound: '未绑定 Endpoint',
};

const riskReasonLabel: Record<AssignmentV2RiskEdge['reason'], string> = {
  perpendicular_facing: '垂直朝向',
  same_facing: '同向',
  unset_facing: '朝向未设置',
};

function ClassroomSeatMap({
  classroomId,
  classroomName,
  editable,
  highRiskKeys,
  mediumRiskKeys,
  mappings,
  onSelect,
  rowsByUid,
  seats,
  selectedUid,
  showRiskLines,
  zoom,
}: {
  classroomId: string;
  classroomName: string;
  editable: boolean;
  highRiskKeys: Set<string>;
  mediumRiskKeys: Set<string>;
  mappings: AssignmentV2Mapping[];
  onSelect: (uid: number) => void;
  rowsByUid: Map<number, AssignmentCsvRow>;
  seats: AssignmentV2SeatFact[];
  selectedUid: number | null;
  showRiskLines: boolean;
  zoom: number;
}) {
  const roomSeats = seats.filter((seat) => seat.classroomId === classroomId);
  if (!roomSeats.length) return null;
  const xs = roomSeats.map((seat) => seat.x);
  const ys = roomSeats.map((seat) => seat.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX);
  const height = Math.max(1, Math.max(...ys) - minY);
  const mapWidth = Math.round(760 * zoom);
  const mapHeight = Math.round(420 * zoom);
  const positionBySeat = new Map(
    roomSeats.map((seat) => [
      seatIdentityKey(seat),
      {
        left: 36 + ((seat.x - minX) / width) * (mapWidth - 132),
        top: 36 + ((seat.y - minY) / height) * (mapHeight - 100),
      },
    ]),
  );
  const occupantBySeat = new Map(mappings.map((mapping) => [seatIdentityKey(mapping.seat), mapping.boundUserId]));
  const highRiskSeatKeys = new Set<string>();
  for (const edgeKey of highRiskKeys) {
    const [leftKey, rightKey] = edgeKey.split('\u0001');
    highRiskSeatKeys.add(leftKey);
    highRiskSeatKeys.add(rightKey);
  }
  const mediumRiskSeatKeys = new Set<string>();
  for (const edgeKey of mediumRiskKeys) {
    const [leftKey, rightKey] = edgeKey.split('\u0001');
    mediumRiskSeatKeys.add(leftKey);
    mediumRiskSeatKeys.add(rightKey);
  }
  return (
    <section className="space-y-2" aria-label={`${classroomName}座位图`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{classroomName}</h4>
        <span className="text-xs text-muted-foreground">{roomSeats.length} 个候选座位</span>
      </div>
      <div className="max-w-full overflow-auto rounded-md border bg-muted/20" tabIndex={0} aria-label={`${classroomName}座位图，可滚动平移`}>
        <div className="relative" style={{ height: mapHeight, minHeight: 260, width: mapWidth }}>
          {showRiskLines ? (
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
              {[...highRiskKeys, ...mediumRiskKeys].map((edgeKey) => {
                const [leftKey, rightKey] = edgeKey.split('\u0001');
                const left = positionBySeat.get(leftKey);
                const right = positionBySeat.get(rightKey);
                if (!left || !right) return null;
                const high = highRiskKeys.has(edgeKey);
                return (
                  <line
                    key={edgeKey}
                    x1={left.left + 42}
                    y1={left.top + 20}
                    x2={right.left + 42}
                    y2={right.top + 20}
                    stroke={high ? 'rgb(220 38 38)' : 'rgb(217 119 6)'}
                    strokeOpacity={high ? 0.7 : 0.5}
                    strokeWidth={high ? 2 : 1.5}
                  />
                );
              })}
            </svg>
          ) : null}
          {roomSeats.map((seat) => {
            const key = seatIdentityKey(seat);
            const position = positionBySeat.get(key)!;
            const uid = occupantBySeat.get(key) || null;
            const row = uid === null ? null : rowsByUid.get(uid) || null;
            const hasHighRisk = highRiskSeatKeys.has(key);
            const hasMediumRisk = !hasHighRisk && mediumRiskSeatKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                disabled={uid === null || !editable}
                aria-label={`${classroomName} ${seat.label || seat.sourceSeatId}，${facingAccessibleLabel[seat.facing]}${
                  row ? `，${row.studentId} ${row.realName}` : '，未分配'
                }${hasHighRisk ? '，高风险' : hasMediumRisk ? '，中风险' : ''}`}
                onClick={() => uid !== null && onSelect(uid)}
                className={`absolute w-[84px] rounded-md border px-1 py-1 text-center text-[11px] shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  uid !== null && selectedUid === uid
                    ? 'border-primary bg-primary text-primary-foreground'
                    : hasHighRisk
                      ? 'border-red-600 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100'
                      : hasMediumRisk
                        ? 'border-amber-600 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
                        : uid === null
                          ? 'border-dashed bg-background text-muted-foreground'
                          : 'bg-background'
                }`}
                style={{ left: position.left, top: position.top }}
              >
                <span className="block truncate font-medium">
                  {facingLabel[seat.facing]} {seat.label || seat.sourceSeatId}
                </span>
                <span className="block truncate">{row ? `${row.studentId} ${row.realName}` : '空座'}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SeatAssignmentWorkspace({ eventId }: { eventId: string }) {
  const path = `/api/admin/exam-events/${eventId}`;
  const [workspace, setWorkspace] = useState<AssignmentWorkspace | null>(null);
  const [draft, setDraft] = useState<AssignmentMapping[]>([]);
  const [v2Draft, setV2Draft] = useState<AssignmentV2Mapping[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspaceFresh, setWorkspaceFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionDiagnostics, setActionDiagnostics] = useState<AssignmentDiagnostic[]>([]);
  const [sourceKind, setSourceKind] = useState<'contestAudience' | 'userbindGroups' | 'userbindSchool'>('contestAudience');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedV2ClassroomIds, setSelectedV2ClassroomIds] = useState<Set<string>>(new Set());
  const [v2Strategy, setV2Strategy] = useState<'maximizeSpacing' | 'minimizeClassrooms'>('minimizeClassrooms');
  const [mapZoom, setMapZoom] = useState(1);
  const [showRiskLines, setShowRiskLines] = useState(false);
  const [riskDetail, setRiskDetail] = useState<'high' | 'medium' | null>(null);
  const [preparationBusy, setPreparationBusy] = useState(false);
  const [preloginPreparation, setPreloginPreparation] = useState<PreloginPreparation | null>(null);
  const [preloginWorkflow, setPreloginWorkflow] = useState<PreloginWorkflow | null>(null);
  const [preloginFactsFresh, setPreloginFactsFresh] = useState(false);
  const [preloginV2WriterEnabled, setPreloginV2WriterEnabled] = useState(false);
  const [preloginWorkflowWriterEnabled, setPreloginWorkflowWriterEnabled] = useState(false);
  const [preloginBatch, setPreloginBatch] = useState<PreloginBatch | null>(null);
  const preloginBatchRef = useRef<PreloginBatch | null>(null);
  const preloginBatchGenerationRef = useRef(0);
  const [preloginBatchHistory, setPreloginBatchHistory] = useState<PreloginBatch[]>([]);
  const [preloginTargetDraft, setPreloginTargetDraft] = useState<PreloginTargetDraft | null>(null);
  const [preloginTargetPreview, setPreloginTargetPreview] = useState<PreloginTargetPreview | null>(null);
  const [preloginTargetFactsFresh, setPreloginTargetFactsFresh] = useState(false);
  const [preloginNetworkConfigRevision, setPreloginNetworkConfigRevision] = useState(0);
  const [preloginNetworkPolicyRef, setPreloginNetworkPolicyRef] = useState<RevisionRef | null>(null);
  const [preloginNetworkTargetRef, setPreloginNetworkTargetRef] = useState<RevisionRef | null>(null);
  const [preloginPolicyOptions, setPreloginPolicyOptions] = useState<PreloginPolicyOption[]>([]);
  const [selectedPreloginPolicy, setSelectedPreloginPolicy] = useState('');
  const [preloginBusy, setPreloginBusy] = useState(false);
  const [preloginError, setPreloginError] = useState<string | null>(null);
  const workspaceLoadGenerationRef = useRef(0);
  const preloginPublicationIdentityRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const generation = ++workspaceLoadGenerationRef.current;
    setWorkspaceFresh(false);
    let payloads: [Record<string, unknown>, Record<string, unknown>];
    try {
      payloads = await Promise.all([apiObject(`${path}/seat-plans`), apiObject(`${path}/seat-assignments`)]);
    } catch (reason) {
      if (generation !== workspaceLoadGenerationRef.current) return false;
      setWorkspaceFresh(false);
      throw reason;
    }
    if (generation !== workspaceLoadGenerationRef.current) return false;
    const [plansPayload, assignmentsPayload] = payloads;
    const publication = assignmentsPayload.publication === null ? null : record(assignmentsPayload.publication, '发布版本');
    const source = assignmentsPayload.source === null ? null : record(assignmentsPayload.source, '分配来源');
    const preflight = record(assignmentsPayload.endpointPreflight, '终端预检');
    const state = text(preflight.state, '终端预检');
    if (state !== 'available' && state !== 'not-required' && state !== 'unavailable') throw new Error('终端预检响应格式不正确');
    const latestSeatPlanState = text(assignmentsPayload.latestSeatPlanState, '座位计划状态');
    if (latestSeatPlanState !== 'current' && latestSeatPlanState !== 'layout-drift' && latestSeatPlanState !== 'not-ready') {
      throw new Error('座位计划状态响应格式不正确');
    }
    const event = record(plansPayload.event, '考试活动');
    const eventType = text(event.type, '考试活动');
    if (eventType !== 'krypton' && eventType !== 'external') throw new Error('考试活动响应格式不正确');
    const eventLifecycle = text(event.lifecycle, '考试活动');
    if (eventLifecycle !== 'draft' && eventLifecycle !== 'scheduled' && eventLifecycle !== 'archived') {
      throw new Error('考试活动响应格式不正确');
    }
    const contestAudienceState = text(event.contestAudienceState, '考试活动');
    if (contestAudienceState !== 'fixed' && contestAudienceState !== 'not-applicable' && contestAudienceState !== 'public') {
      throw new Error('考试活动响应格式不正确');
    }
    const next: AssignmentWorkspace = {
      eventRevision: positiveInteger(event.revision, '考试活动'),
      eventType,
      eventLifecycle,
      contestAudienceState,
      startAt: isoDate(event.startAt, '考试活动'),
      endAt: isoDate(event.endAt, '考试活动'),
      rosterRevisions: array(plansPayload.rosterRevisions, '名单版本').map(parseRoster),
      seatPlans: array(plansPayload.seatPlans, '座位计划').map(parseSeatPlan),
      assignments: array(assignmentsPayload.assignments, '分配版本').map(parseAssignment),
      publicationRevision: publication ? integer(publication.revision, '发布版本') : 0,
      source: source
        ? {
            schemaVersion: (() => {
              const version = integer(source.schemaVersion, '分配来源');
              if (version !== 1 && version !== 2) throw new Error('分配来源响应格式不正确');
              return version;
            })(),
            seatPlanRevision: positiveInteger(source.seatPlanRevision, '分配来源'),
            seats: array(source.seats, '分配来源').map((item) =>
              parseSeat(item, source.classroomId === undefined ? undefined : objectId(source.classroomId, '分配来源')),
            ),
          }
        : null,
      endpointState: state,
      endpointItems: array(preflight.items, '终端预检').map(parsePreflightItem),
      publishedRosterDrift: parsePublishedRosterDrift(assignmentsPayload.publishedRosterDrift),
      latestSeatPlanState,
      rosterGroups: array(assignmentsPayload.rosterGroups, '名单用户组').map(parseRosterGroup),
      classrooms: array(assignmentsPayload.classrooms, '候选教室').map(parseClassroomSummary),
    };
    const displayedAssignment = next.assignments[0];
    if (displayedAssignment && next.source?.seatPlanRevision !== displayedAssignment.seatPlan.revision) {
      throw new Error('分配来源与当前显示版本不一致');
    }
    if (displayedAssignment && next.source?.schemaVersion !== displayedAssignment.schemaVersion) {
      throw new Error('分配来源 schema 与当前显示版本不一致');
    }
    if (
      displayedAssignment &&
      !next.rosterRevisions.some(
        (item) =>
          item.rosterId === displayedAssignment.roster.rosterId &&
          item.revision === displayedAssignment.roster.revision &&
          item.fingerprint === displayedAssignment.roster.fingerprint,
      )
    ) {
      throw new Error('分配名单与当前显示版本不一致');
    }
    if (
      displayedAssignment &&
      !next.seatPlans.some(
        (item) =>
          item.seatPlanId === displayedAssignment.seatPlan.seatPlanId &&
          item.revision === displayedAssignment.seatPlan.revision &&
          item.fingerprint === displayedAssignment.seatPlan.fingerprint,
      )
    ) {
      throw new Error('分配计划与当前显示版本不一致');
    }
    const displayedPlan = next.seatPlans[0];
    if (
      displayedPlan?.roster &&
      !next.rosterRevisions.some(
        (item) =>
          item.rosterId === displayedPlan.roster?.rosterId &&
          item.revision === displayedPlan.roster.revision &&
          item.fingerprint === displayedPlan.roster.fingerprint,
      )
    ) {
      throw new Error('座位计划名单与当前显示版本不一致');
    }
    const nextPublishedAssignment = next.assignments.find((assignment) => assignment.published) || null;
    const nextPublicationIdentity = nextPublishedAssignment ? preloginPublicationIdentity(nextPublishedAssignment, next.publicationRevision) : null;
    if (preloginPublicationIdentityRef.current !== nextPublicationIdentity) {
      preloginPublicationIdentityRef.current = nextPublicationIdentity;
      setPreloginPreparation(null);
      setPreloginWorkflow(null);
      setPreloginFactsFresh(false);
      setPreloginTargetPreview(null);
      setPreloginTargetFactsFresh(false);
      setPreloginV2WriterEnabled(false);
      setPreloginWorkflowWriterEnabled(false);
    }
    setWorkspace(next);
    setSourceKind((current) => (next.eventType === 'krypton' ? 'contestAudience' : current === 'contestAudience' ? 'userbindGroups' : current));
    const latest = next.assignments[0];
    setDraft(latest?.schemaVersion === 1 ? latest.assignments.map((row) => ({ ...row })) : []);
    setV2Draft(latest?.schemaVersion === 2 ? latest.assignments.map((row) => ({ boundUserId: row.boundUserId, seat: { ...row.seat } })) : []);
    setLocked(new Set(latest ? latest.constraints.lockedAssignments.map((row) => row.boundUserId) : []));
    if (latest?.schemaVersion === 2) setV2Strategy(latest.constraints.strategy);
    const currentPlan = next.seatPlans[0];
    if (currentPlan?.schemaVersion === 2) setSelectedV2ClassroomIds(new Set(currentPlan.classrooms.map((classroom) => classroom.classroomId)));
    setSelectedUid(null);
    setActionDiagnostics([]);
    setWorkspaceFresh(true);
    return true;
  }, [path]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  const refreshWorkspace = useCallback(async (): Promise<boolean> => {
    setError(null);
    setWorkspaceFresh(false);
    try {
      return await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [load]);

  const writePreloginUrl = useCallback(
    (state: { batchId?: string | null; requestId?: string | null; retryProjectionRevision?: number | null; retryRequestId?: string | null }) => {
      const url = new URL(window.location.href);
      const values: Array<[string, string | null | undefined]> = [
        ['batchId', state.batchId],
        ['requestId', state.requestId],
        ['retryProjectionRevision', state.retryProjectionRevision === undefined ? undefined : state.retryProjectionRevision?.toString() || null],
        ['retryRequestId', state.retryRequestId],
      ];
      for (const [key, value] of values) {
        if (value) url.searchParams.set(key, value);
        else if (value === null) url.searchParams.delete(key);
      }
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    },
    [],
  );

  const selectPreloginBatch = useCallback((batch: PreloginBatch) => {
    preloginBatchGenerationRef.current += 1;
    preloginBatchRef.current = batch;
    setPreloginBatch(batch);
  }, []);

  const acceptPreloginBatch = useCallback(
    (
      batch: PreloginBatch,
      expected?: {
        allowBatchSwitch?: boolean;
        batchId: string | null;
        generation: number;
      },
    ): PreloginBatch | null => {
      if (
        expected &&
        (preloginBatchGenerationRef.current !== expected.generation || (preloginBatchRef.current?.batchId || null) !== expected.batchId)
      ) {
        return null;
      }
      const current = preloginBatchRef.current;
      if (current && current.batchId !== batch.batchId && !expected?.allowBatchSwitch) return null;
      if (current) {
        const currentProjectionRevision = current.projection?.projectionRevision || 0;
        const incomingProjectionRevision = batch.projection?.projectionRevision || 0;
        if (current.batchId === batch.batchId && (batch.revision < current.revision || incomingProjectionRevision < currentProjectionRevision)) {
          return current;
        }
        if (
          current.batchId === batch.batchId &&
          batch.revision === current.revision &&
          incomingProjectionRevision === currentProjectionRevision &&
          JSON.stringify(batch) !== JSON.stringify(current)
        ) {
          throw new Error('同一预登录批次版本返回了冲突内容');
        }
      }
      if (!current || current.batchId !== batch.batchId) preloginBatchGenerationRef.current += 1;
      preloginBatchRef.current = batch;
      setPreloginBatch(batch);
      return batch;
    },
    [],
  );

  const loadPreloginBatch = useCallback(
    async (batchId: string): Promise<PreloginBatch | null> => {
      const expected = {
        batchId: preloginBatchRef.current?.batchId || null,
        generation: preloginBatchGenerationRef.current,
      };
      const payload = await apiObject(`${path}/prelogin-batches/${encodeURIComponent(batchId)}`);
      const batch = parsePreloginBatch(payload.batch, eventId);
      return acceptPreloginBatch(batch, expected);
    },
    [acceptPreloginBatch, eventId, path],
  );

  const resumeDispatchingPrelogin = useCallback(
    async (batch: PreloginBatch): Promise<PreloginBatch> => {
      if (batch.state === 'dispatched') return batch;
      if (!batch.workflow) throw new Error('该历史批次没有可验证的整合工作流身份，不能自动恢复投递。');
      const expected = {
        batchId: preloginBatchRef.current?.batchId || null,
        generation: preloginBatchGenerationRef.current,
      };
      const payload = await post(`${path}/prelogin/confirm`, {
        assignmentRevision: batch.assignment.revision,
        preparationFingerprint: batch.preparationFingerprint,
        workflowFingerprint: batch.workflow.fingerprint,
        requestId: batch.requestId,
      });
      const resumed = parsePreloginBatch(payload.batch, eventId);
      if (resumed.state !== 'dispatched' || resumed.requestId !== batch.requestId || resumed.batchId !== batch.batchId) {
        throw new Error('预登录确认恢复未收敛');
      }
      if (acceptPreloginBatch(resumed, expected)) writePreloginUrl({ batchId: resumed.batchId, requestId: null });
      return resumed;
    },
    [acceptPreloginBatch, eventId, path, writePreloginUrl],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const batchId = url.searchParams.get('batchId');
    const recoverRequestId = url.searchParams.get('requestId');
    let current = true;
    setPreloginBusy(true);
    setPreloginError(null);
    const recover = async () => {
      if (batchId) {
        const batch = await loadPreloginBatch(objectId(batchId, '预登录 URL'));
        if (!batch) return null;
        return batch.state === 'dispatching' ? resumeDispatchingPrelogin(batch) : batch;
      }
      const payload = recoverRequestId
        ? await apiObject(`${path}/prelogin-requests/${encodeURIComponent(requestId(recoverRequestId, '预登录 URL'))}`)
        : await apiObject(`${path}/prelogin-latest`);
      if (payload.batch === null) {
        if (recoverRequestId) throw new Error('尚未找到该确认请求；请重新运行终端预检后使用同一请求继续。');
        return null;
      }
      const batch = parsePreloginBatch(payload.batch, eventId);
      if (current) {
        selectPreloginBatch(batch);
        if (batch.state === 'dispatched') writePreloginUrl({ batchId: batch.batchId, requestId: recoverRequestId ? null : undefined });
        else writePreloginUrl({ batchId: null, requestId: batch.requestId });
      }
      return batch.state === 'dispatching' ? resumeDispatchingPrelogin(batch) : batch;
    };
    void recover()
      .catch((reason: unknown) => current && setPreloginError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => current && setPreloginBusy(false));
    return () => {
      current = false;
    };
  }, [eventId, loadPreloginBatch, path, resumeDispatchingPrelogin, selectPreloginBatch, writePreloginUrl]);

  const loadPreloginBatchHistory = useCallback(async () => {
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      const payload = await apiObject(`${path}/prelogin-batches`);
      setPreloginBatchHistory(array(payload.batches, '预登录批次历史').map((item) => parsePreloginBatch(item, eventId)));
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [eventId, path]);

  useEffect(() => {
    if (!preloginBatch || preloginBatchReachedTerminalState(preloginBatch)) return;
    let current = true;
    let timer: number | null = null;
    const poll = async () => {
      if (!current || document.visibilityState === 'hidden') {
        timer = window.setTimeout(poll, 5000);
        return;
      }
      try {
        const batch = await loadPreloginBatch(preloginBatch.batchId);
        if (!batch || preloginBatchReachedTerminalState(batch)) return;
      } catch (reason) {
        if (current) setPreloginError(reason instanceof Error ? reason.message : String(reason));
      }
      if (current) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 2000);
    return () => {
      current = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadPreloginBatch, preloginBatch]);

  const execute = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setWorkspaceFresh(false);
      setError(null);
      setActionDiagnostics([]);
      try {
        const result = await post(`${path}/seat-assignments`, body);
        if (Object.hasOwn(result, 'assignment')) {
          if (result.assignment === null) {
            setActionDiagnostics(array(result.diagnostics, '分配诊断').map(parseDiagnostic));
            setWorkspaceFresh(true);
            return;
          }
          parseAssignment(result.assignment);
        }
        await load();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
    [load, path],
  );

  const executeSeatPlan = useCallback(
    async (body: Record<string, unknown>) => {
      setPreparationBusy(true);
      setWorkspaceFresh(false);
      setError(null);
      try {
        await post(`${path}/seat-plans`, body);
        await load();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setPreparationBusy(false);
      }
    },
    [load, path],
  );

  const latest = workspace?.assignments[0] || null;
  const latestPlan = workspace?.seatPlans[0] || null;
  const latestV2 = latest?.schemaVersion === 2 ? latest : null;
  const latestPlanV2 = latestPlan?.schemaVersion === 2 ? latestPlan : null;
  const latestV1 = latest?.schemaVersion === 1 ? latest : null;
  const latestPlanCurrent = workspace?.latestSeatPlanState === 'current';
  const mutationBusy = busy || preparationBusy || preloginBusy;
  const rosterRef = latest?.roster || latestPlan?.roster || null;
  const roster = rosterRef
    ? workspace?.rosterRevisions.find(
        (item) => item.rosterId === rosterRef.rosterId && item.revision === rosterRef.revision && item.fingerprint === rosterRef.fingerprint,
      ) || null
    : null;
  const planRoster = latestPlan?.roster
    ? workspace?.rosterRevisions.find(
        (item) =>
          item.rosterId === latestPlan.roster?.rosterId &&
          item.revision === latestPlan.roster.revision &&
          item.fingerprint === latestPlan.roster.fingerprint,
      ) || null
    : null;
  const automaticSeatingAllowed = workspace?.eventType !== 'krypton' || workspace.contestAudienceState === 'fixed';
  const latestAssignmentUsesCanonicalRoster = workspace?.eventType !== 'krypton' || !latestV2 || roster?.source.kind === 'contestAudience';
  const latestPlanUsesCanonicalRoster = workspace?.eventType !== 'krypton' || !latestPlanV2 || planRoster?.source.kind === 'contestAudience';
  const currentV2UsesCanonicalRoster = latestAssignmentUsesCanonicalRoster && latestPlanUsesCanonicalRoster;
  const assignmentIsCurrentV2 = Boolean(
    automaticSeatingAllowed &&
    currentV2UsesCanonicalRoster &&
    workspaceFresh &&
    latestV2 &&
    latestPlanV2 &&
    latestPlanCurrent &&
    latestV2.seatPlan.seatPlanId === latestPlanV2.seatPlanId &&
    latestV2.seatPlan.revision === latestPlanV2.revision &&
    latestV2.seatPlan.fingerprint === latestPlanV2.fingerprint,
  );
  const canMutateV2Draft = assignmentIsCurrentV2 && !mutationBusy;
  const seats = workspace?.source?.seats || [];
  const seatByIdentity = useMemo(() => new Map(seats.map((seat) => [seatIdentityKey(seat), seat])), [seats]);
  const v1SeatById = useMemo(() => new Map(seats.map((seat) => [seat.sourceSeatId, seat])), [seats]);
  const preflightByEndpoint = useMemo(() => new Map((workspace?.endpointItems || []).map((item) => [item.endpointId, item])), [workspace]);

  const rows = useMemo<AssignmentCsvRow[]>(() => {
    if (!roster) return [];
    if (!latest) {
      return roster.entries.map((entry) => ({
        ...entry,
        classroomId: latestPlan?.schemaVersion === 1 ? latestPlan.classroomId : '',
        sourceSeatId: '',
        seatLabel: '',
        endpointId: '',
      }));
    }
    if (latest.schemaVersion === 2) {
      const rosterByUid = new Map(roster.entries.map((entry) => [entry.boundUserId, entry]));
      const seatByKey = new Map(latest.seatFacts.map((seat) => [seatIdentityKey(seat), seat]));
      const participantByUid = new Map(latest.participants.map((participant) => [participant.boundUserId, participant]));
      return v2Draft.map((mapping) => {
        const participant = participantByUid.get(mapping.boundUserId);
        const rosterEntry = rosterByUid.get(mapping.boundUserId);
        const seat = seatByKey.get(seatIdentityKey(mapping.seat));
        return {
          boundUserId: mapping.boundUserId,
          studentId: rosterEntry?.studentId || participant?.studentId || '',
          realName: rosterEntry?.realName || '',
          classroomId: mapping.seat.classroomId,
          sourceSeatId: mapping.seat.sourceSeatId,
          seatLabel: seat?.label || '',
          endpointId: seat?.endpointId || '',
        };
      });
    }
    const mappingByUid = new Map(draft.map((row) => [row.boundUserId, row.sourceSeatId]));
    return roster.entries.map((entry) => {
      const sourceSeatId = mappingByUid.get(entry.boundUserId) || '';
      const seat = v1SeatById.get(sourceSeatId);
      return {
        ...entry,
        classroomId: seat?.classroomId || latest.classroomId,
        sourceSeatId,
        seatLabel: seat?.label || '',
        endpointId: seat?.endpointId || '',
      };
    });
  }, [draft, latest, latestPlan, roster, v1SeatById, v2Draft]);
  const rowsByUid = useMemo(() => new Map(rows.map((row) => [row.boundUserId, row])), [rows]);
  const classroomDisplayById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const classroom of workspace?.classrooms || []) counts.set(classroom.name, (counts.get(classroom.name) || 0) + 1);
    return new Map(
      (workspace?.classrooms || []).map((classroom) => [
        classroom.classroomId,
        counts.get(classroom.name) === 1 ? classroom.name : `${classroom.name} · ${classroom.classroomId}`,
      ]),
    );
  }, [workspace]);
  const latestV2SeatByKey = useMemo(() => new Map((latestV2?.seatFacts || []).map((seat) => [seatIdentityKey(seat), seat])), [latestV2]);
  const v2OccupantBySeatKey = useMemo(() => new Map(v2Draft.map((mapping) => [seatIdentityKey(mapping.seat), mapping.boundUserId])), [v2Draft]);
  const highRiskKeys = useMemo(() => new Set((latestV2?.explanation.highRiskEdges || []).map(riskEdgeKey)), [latestV2]);
  const mediumRiskKeys = useMemo(() => new Set((latestV2?.explanation.mediumRiskEdges || []).map(riskEdgeKey)), [latestV2]);

  const swapV2 = (firstUid: number, secondUid: number) => {
    if (!canMutateV2Draft || firstUid === secondUid) return;
    setV2Draft((current) => {
      const first = current.find((row) => row.boundUserId === firstUid);
      const second = current.find((row) => row.boundUserId === secondUid);
      if (!first || !second) return current;
      return current.map((row) => {
        if (row.boundUserId === firstUid) return { ...row, seat: { ...second.seat } };
        if (row.boundUserId === secondUid) return { ...row, seat: { ...first.seat } };
        return row;
      });
    });
  };

  const selectForSwap = (uid: number) => {
    if (!canMutateV2Draft) return;
    if (selectedUid === null) setSelectedUid(uid);
    else {
      swapV2(selectedUid, uid);
      setSelectedUid(null);
    }
  };

  const assignSeatV2 = (uid: number, seatKey: string) => {
    if (!canMutateV2Draft) return;
    const candidate = latestV2SeatByKey.get(seatKey);
    if (!candidate) return;
    const occupantUid = v2OccupantBySeatKey.get(seatKey);
    if (occupantUid !== undefined && occupantUid !== uid) {
      swapV2(uid, occupantUid);
      return;
    }
    if (occupantUid === undefined) {
      setV2Draft((current) =>
        current.map((row) =>
          row.boundUserId === uid ? { ...row, seat: { classroomId: candidate.classroomId, sourceSeatId: candidate.sourceSeatId } } : row,
        ),
      );
    }
  };

  const exportCurrent = () => {
    if (!latest) return;
    const csv = latest.schemaVersion === 2 ? assignmentCsvV2(rows, latest.revision) : assignmentCsv(rows, latest.revision);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `exam-seat-assignment-${eventId}-r${latest.revision}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = rows.filter((row) =>
    `${row.studentId} ${row.realName} ${row.classroomId} ${row.seatLabel} ${row.sourceSeatId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const canonicalV2LockedUids = latestV2?.constraints.lockedAssignments.map((row) => row.boundUserId).sort((a, b) => a - b) || [];
  const currentLockedUids = [...locked].sort((a, b) => a - b);
  const dirty = Boolean(
    latestV2 &&
    (JSON.stringify(v2Draft) !== JSON.stringify(latestV2.assignments) || JSON.stringify(currentLockedUids) !== JSON.stringify(canonicalV2LockedUids)),
  );
  const diagnostics = actionDiagnostics.length ? actionDiagnostics : latestV1?.diagnostics || latestPlan?.diagnostics || [];
  const eligibleV2Seats = latestV2
    ? latestV2.seatFacts.filter(
        (seat) => seat.enabled && (seat.layoutStatus === 'active' || seat.layoutStatus === 'empty') && seat.bindingId && seat.endpointId,
      )
    : [];
  const knownOfflineV2Seats = latestV2
    ? latestV2.explanation.offlineSeats.filter((seat) => latestV2SeatByKey.get(seatIdentityKey(seat))?.endpointOnline === false)
    : [];
  const unknownOnlineV2Seats = latestV2
    ? latestV2.explanation.offlineSeats.filter((seat) => latestV2SeatByKey.get(seatIdentityKey(seat))?.endpointOnline === null)
    : [];
  const describeV2Seat = (identity: SeatIdentity): string => {
    const seat = latestV2SeatByKey.get(seatIdentityKey(identity));
    return `${classroomDisplayById.get(identity.classroomId) || identity.classroomId} / ${seat?.label || identity.sourceSeatId}`;
  };
  const selectedStudent = selectedUid === null ? null : rowsByUid.get(selectedUid) || null;
  const newestRoster = workspace?.rosterRevisions[0] || null;
  const latestRosterForPlan =
    automaticSeatingAllowed && (workspace?.eventType !== 'krypton' || newestRoster?.source.kind === 'contestAudience') ? newestRoster : null;
  const splitTeams = useMemo(
    () =>
      (latestV2?.explanation.splitTeamIds || []).map((teamId) => ({
        teamId,
        members: (latestV2?.participants || [])
          .filter((participant) => participant.teamId === teamId)
          .map((participant) => ({ participant, row: rowsByUid.get(participant.boundUserId) || null })),
      })),
    [latestV2, rowsByUid],
  );
  const publishedAssignment =
    workspace?.assignments.find((assignment): assignment is AssignmentV1Revision => assignment.published && assignment.schemaVersion === 1) || null;
  const publishedV2Assignment =
    workspace?.assignments.find((assignment): assignment is AssignmentV2Revision => assignment.published && assignment.schemaVersion === 2) || null;
  const publishedPreparationAssignment = publishedV2Assignment || publishedAssignment;
  const currentPreloginPublicationIdentity =
    publishedPreparationAssignment && workspace ? preloginPublicationIdentity(publishedPreparationAssignment, workspace.publicationRevision) : null;
  const publishedRoster = publishedPreparationAssignment
    ? workspace?.rosterRevisions.find(
        (item) =>
          item.rosterId === publishedPreparationAssignment.roster.rosterId &&
          item.revision === publishedPreparationAssignment.roster.revision &&
          item.fingerprint === publishedPreparationAssignment.roster.fingerprint,
      ) || null
    : null;
  const publishedAssignmentUsesCanonicalRoster = Boolean(
    workspace?.eventType !== 'krypton' ||
    publishedPreparationAssignment?.schemaVersion === 1 ||
    (publishedPreparationAssignment && publishedRoster?.source.kind === 'contestAudience'),
  );
  const publishedAssignmentAudienceReady = Boolean(publishedPreparationAssignment?.schemaVersion === 1 || automaticSeatingAllowed);
  const publishedV2SeatByUid = new Map((publishedV2Assignment?.assignments || []).map((mapping) => [mapping.boundUserId, mapping.seat]));
  const preloginFactsCurrent = Boolean(
    workspaceFresh &&
    preloginFactsFresh &&
    publishedAssignmentAudienceReady &&
    preloginPreparation &&
    publishedPreparationAssignment &&
    publishedAssignmentUsesCanonicalRoster &&
    workspace &&
    !workspace.publishedRosterDrift?.changed &&
    preloginPreparation.eventRevision === workspace.eventRevision &&
    preloginPreparation.assignment.assignmentId === publishedPreparationAssignment.assignmentId &&
    preloginPreparation.assignment.revision === publishedPreparationAssignment.revision &&
    preloginPreparation.assignment.fingerprint === publishedPreparationAssignment.fingerprint &&
    preloginPreparation.publicationRevision === workspace.publicationRevision &&
    preloginPublicationIdentityRef.current === currentPreloginPublicationIdentity,
  );
  const preloginBatchMatchesCurrentPublication = Boolean(
    workspaceFresh &&
    publishedAssignmentAudienceReady &&
    preloginBatch &&
    publishedPreparationAssignment &&
    publishedAssignmentUsesCanonicalRoster &&
    workspace &&
    !workspace.publishedRosterDrift?.changed &&
    preloginBatch.eventRevision === workspace.eventRevision &&
    preloginBatch.assignment.assignmentId === publishedPreparationAssignment.assignmentId &&
    preloginBatch.assignment.revision === publishedPreparationAssignment.revision &&
    preloginBatch.assignment.fingerprint === publishedPreparationAssignment.fingerprint &&
    preloginBatch.publicationRevision === workspace.publicationRevision,
  );
  const preloginBatchAssignment = preloginBatch
    ? workspace?.assignments.find(
        (assignment) =>
          assignment.assignmentId === preloginBatch.assignment.assignmentId &&
          assignment.revision === preloginBatch.assignment.revision &&
          assignment.fingerprint === preloginBatch.assignment.fingerprint,
      ) || null
    : null;
  const preloginBatchSeatByUid = new Map(
    preloginBatchAssignment?.schemaVersion === 2
      ? preloginBatchAssignment.assignments.map((mapping) => [mapping.boundUserId, mapping.seat] as const)
      : [],
  );
  const preloginBatchRoster = preloginBatchAssignment
    ? workspace?.rosterRevisions.find(
        (candidate) =>
          candidate.rosterId === preloginBatchAssignment.roster.rosterId &&
          candidate.revision === preloginBatchAssignment.roster.revision &&
          candidate.fingerprint === preloginBatchAssignment.roster.fingerprint,
      ) || null
    : null;
  const preloginBatchRosterByUid = new Map((preloginBatchRoster?.entries || []).map((entry) => [entry.boundUserId, entry]));
  const currentPublicationAlreadyConfirmed = Boolean(preloginBatch?.state === 'dispatched' && preloginBatchMatchesCurrentPublication);

  const loadPreloginFacts = useCallback(async () => {
    if (!publishedPreparationAssignment || workspace?.eventType !== 'krypton') throw new Error('当前考试不支持预登录');
    setPreloginFactsFresh(false);
    const expectedPublicationIdentity = preloginPublicationIdentity(publishedPreparationAssignment, workspace.publicationRevision);
    const payload = await post(`${path}/prelogin/prepare`, { assignmentRevision: publishedPreparationAssignment.revision });
    const preparation = parsePreloginPreparation(payload.preparation, eventId);
    const workflow = parsePreloginWorkflow(payload.workflow);
    const v2WriterEnabled = boolean(payload.v2WriterEnabled, '跨教室预登录兼容写入门禁');
    const writerEnabled = boolean(payload.workflowWriterEnabled, '预登录兼容写入门禁');
    if (
      preparation.eventRevision !== workspace.eventRevision ||
      preparation.assignment.assignmentId !== publishedPreparationAssignment.assignmentId ||
      preparation.assignment.revision !== publishedPreparationAssignment.revision ||
      preparation.assignment.fingerprint !== publishedPreparationAssignment.fingerprint ||
      preparation.publicationRevision !== workspace.publicationRevision ||
      preloginPublicationIdentityRef.current !== expectedPublicationIdentity
    ) {
      throw new Error('预登录预检与当前发布分配不一致');
    }
    setPreloginPreparation(preparation);
    setPreloginWorkflow(workflow);
    setPreloginV2WriterEnabled(v2WriterEnabled);
    setPreloginWorkflowWriterEnabled(writerEnabled);
    setPreloginFactsFresh(true);
    return { preparation, workflow };
  }, [eventId, path, publishedPreparationAssignment, workspace]);

  const loadPreloginTargetDraft = useCallback(async (): Promise<PreloginTargetDraft | null> => {
    setPreloginTargetFactsFresh(false);
    setPreloginTargetPreview(null);
    const [payload, configPayload, policyPayload] = await Promise.all([
      apiObject(`${path}/target-assignment`),
      apiObject(`${path}/network-config`),
      apiObject(`/api/admin/exam-policy-templates?eventId=${encodeURIComponent(eventId)}`),
    ]);
    let policyRef: RevisionRef | null = null;
    let targetRef: RevisionRef | null = null;
    if (configPayload.config === null) setPreloginNetworkConfigRevision(0);
    else {
      const config = record(configPayload.config, '预登录网络配置');
      setPreloginNetworkConfigRevision(nonNegativeInteger(config.revision, '预登录网络配置'));
      const parseConfigRef = (value: unknown, label: string): RevisionRef | null => {
        if (value === null) return null;
        const reference = record(value, label);
        return {
          id: objectId(reference.id, label),
          revision: positiveInteger(reference.revision, label),
          fingerprint: fingerprint(reference.fingerprint, label),
        };
      };
      policyRef = parseConfigRef(config.policy, '预登录网络策略引用');
      targetRef = parseConfigRef(config.target, '预登录网络目标引用');
    }
    setPreloginNetworkPolicyRef(policyRef);
    setPreloginNetworkTargetRef(targetRef);
    const policyOptions = array(policyPayload.templates, '网络策略模板')
      .flatMap((value): PreloginPolicyOption[] => {
        const template = record(value, '网络策略模板');
        if (text(template.status, '网络策略模板') !== 'active') return [];
        const templateId = objectId(template.templateId, '网络策略模板');
        const name = text(template.name, '网络策略模板');
        return array(template.revisions, '网络策略版本').map((revisionValue) => {
          const revision = record(revisionValue, '网络策略版本');
          return {
            templateId,
            name,
            revision: positiveInteger(revision.revision, '网络策略版本'),
            fingerprint: fingerprint(revision.fingerprint, '网络策略版本'),
          };
        });
      })
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.revision - right.revision || left.templateId.localeCompare(right.templateId),
      );
    setPreloginPolicyOptions(policyOptions);
    const assignedPolicyKey = policyRef ? `${policyRef.id}:${policyRef.revision}` : '';
    setSelectedPreloginPolicy((current) =>
      policyOptions.some((option) => `${option.templateId}:${option.revision}` === current)
        ? current
        : policyOptions.some((option) => `${option.templateId}:${option.revision}` === assignedPolicyKey)
          ? assignedPolicyKey
          : policyOptions.length === 1
            ? `${policyOptions[0].templateId}:${policyOptions[0].revision}`
            : '',
    );
    if (payload.assignment === null) {
      setPreloginTargetDraft(null);
      setPreloginTargetFactsFresh(true);
      return null;
    }
    const assignment = record(payload.assignment, '预登录目标草稿');
    const targetDraft = record(assignment.draft, '预登录目标草稿');
    const sources = array(targetDraft.sources, '预登录目标草稿').map((sourceValue) => {
      const source = record(sourceValue, '预登录目标草稿');
      return { kind: text(source.kind, '预登录目标草稿'), ids: array(source.ids, '预登录目标草稿').map((id) => text(id, '预登录目标草稿')) };
    });
    const sourceAssignmentId = sources.length === 1 && sources[0].kind === 'examSeat' && sources[0].ids.length === 1 ? sources[0].ids[0] : null;
    const revisions = array(assignment.revisions, '预登录目标版本');
    const latestPublishedRevision =
      assignment.latestPublishedRevision === null ? null : positiveInteger(assignment.latestPublishedRevision, '预登录目标草稿');
    const latestPublished = latestPublishedRevision
      ? revisions.find((value) => positiveInteger(record(value, '预登录目标版本').revision, '预登录目标版本') === latestPublishedRevision)
      : null;
    let latestPublishedSourceAssignmentId: string | null = null;
    if (latestPublished) {
      const publishedSources = array(record(latestPublished, '预登录目标版本').sources, '预登录目标版本').map((value) => {
        const source = record(value, '预登录目标版本');
        return { kind: text(source.kind, '预登录目标版本'), ids: array(source.ids, '预登录目标版本').map((id) => text(id, '预登录目标版本')) };
      });
      if (publishedSources.length === 1 && publishedSources[0].kind === 'examSeat' && publishedSources[0].ids.length === 1) {
        latestPublishedSourceAssignmentId = publishedSources[0].ids[0];
      }
    }
    const next = {
      assignmentId: objectId(assignment.assignmentId, '预登录目标草稿'),
      revision: positiveInteger(assignment.revision, '预登录目标草稿'),
      sourceAssignmentId,
      latestPublishedRevision,
      latestPublishedSourceAssignmentId,
    };
    setPreloginTargetDraft(next);
    setPreloginTargetFactsFresh(true);
    return next;
  }, [eventId, path]);

  const refreshPreloginTargetFacts = useCallback(async () => {
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      await loadPreloginTargetDraft();
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginTargetDraft]);

  const assignPreloginPolicy = useCallback(async () => {
    if (!publishedAssignmentUsesCanonicalRoster || !preloginTargetFactsFresh || !selectedPreloginPolicy) return;
    const selected = preloginPolicyOptions.find((option) => `${option.templateId}:${option.revision}` === selectedPreloginPolicy);
    if (!selected) return;
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(`${path}/network-config`, {
        action: 'assignPolicy',
        expectedRevision: preloginNetworkConfigRevision,
        templateId: selected.templateId,
        revision: selected.revision,
      });
      await loadPreloginTargetDraft();
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginTargetDraft();
        setPreloginError(`${operationError}；策略分配结果未知，已重读当前网络配置，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；策略分配结果未知且网络配置重读失败：${recoveryError}`);
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [
    loadPreloginTargetDraft,
    path,
    preloginNetworkConfigRevision,
    preloginPolicyOptions,
    preloginTargetFactsFresh,
    publishedAssignmentUsesCanonicalRoster,
    selectedPreloginPolicy,
  ]);

  const scheduleExamEvent = useCallback(async () => {
    if (
      !workspace ||
      !publishedAssignmentUsesCanonicalRoster ||
      workspace.eventLifecycle !== 'draft' ||
      !workspaceFresh ||
      !preloginTargetFactsFresh ||
      !preloginNetworkPolicyRef ||
      !preloginNetworkTargetRef
    ) {
      return;
    }
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(path, { action: 'schedule', expectedRevision: workspace.eventRevision });
      if (!(await refreshWorkspace())) {
        setPreloginError('活动计划已提交，但当前考试活动重读失败；所有后续写入已暂停，请先使用“重读教室事实”。');
      }
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      const recovered = await refreshWorkspace();
      setPreloginError(
        recovered
          ? `${operationError}；计划结果未知，已重读当前考试活动，请核对生命周期后继续。`
          : `${operationError}；计划结果未知且当前考试活动重读失败，请先使用“重读教室事实”。`,
      );
    } finally {
      setPreloginBusy(false);
    }
  }, [
    path,
    preloginNetworkPolicyRef,
    preloginNetworkTargetRef,
    preloginTargetFactsFresh,
    publishedAssignmentUsesCanonicalRoster,
    refreshWorkspace,
    workspace,
    workspaceFresh,
  ]);

  const savePublishedAssignmentAsTarget = useCallback(async () => {
    if (!publishedPreparationAssignment || !publishedAssignmentUsesCanonicalRoster) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      const current = preloginTargetFactsFresh ? preloginTargetDraft : await loadPreloginTargetDraft();
      if (current?.sourceAssignmentId === publishedPreparationAssignment.assignmentId) return;
      await post(`${path}/target-assignment`, {
        action: 'saveDraft',
        expectedRevision: current?.revision || 0,
        sources: [{ kind: 'examSeat', ids: [publishedPreparationAssignment.assignmentId] }],
      });
      setPreloginTargetPreview(null);
      await loadPreloginTargetDraft();
    } catch (reason) {
      setPreloginTargetPreview(null);
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginTargetDraft();
        setPreloginError(`${operationError}；保存结果未知，已重读当前目标草稿，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；保存结果未知且目标草稿重读失败：${recoveryError}`);
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [
    loadPreloginTargetDraft,
    path,
    preloginTargetDraft,
    preloginTargetFactsFresh,
    publishedAssignmentUsesCanonicalRoster,
    publishedPreparationAssignment,
  ]);

  const previewPreloginTarget = useCallback(async () => {
    if (!publishedAssignmentUsesCanonicalRoster || !preloginTargetFactsFresh || !preloginTargetDraft || !currentPreloginPublicationIdentity) return;
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginTargetPreview(null);
    try {
      const payload = await post(`${path}/target-assignment`, { action: 'preview', expectedRevision: preloginTargetDraft.revision });
      const preview = record(payload.preview, '目标预览');
      const endpointIds = array(preview.endpointIds, '目标预览').map((value) => text(value, '目标预览'));
      setPreloginTargetPreview({
        publicationIdentity: currentPreloginPublicationIdentity,
        fingerprint: fingerprint(preview.previewFingerprint, '目标预览'),
        targetCount: positiveInteger(preview.targetCount, '目标预览'),
        endpointIds,
        addedEndpointIds: array(preview.addedEndpointIds, '目标预览').map((value) => text(value, '目标预览')),
        removedEndpointIds: array(preview.removedEndpointIds, '目标预览').map((value) => text(value, '目标预览')),
      });
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      const refreshed = await refreshWorkspace();
      setPreloginError(
        refreshed
          ? `${operationError}；目标解析失败后已重读当前名单与发布分配，请按页面漂移明细处理后重试。`
          : `${operationError}；目标解析失败且当前名单重读失败，请先使用“重读教室事实”。`,
      );
    } finally {
      setPreloginBusy(false);
    }
  }, [
    currentPreloginPublicationIdentity,
    path,
    preloginTargetDraft,
    preloginTargetFactsFresh,
    publishedAssignmentUsesCanonicalRoster,
    refreshWorkspace,
  ]);

  const publishPreloginTarget = useCallback(async () => {
    if (
      !preloginTargetDraft ||
      !publishedAssignmentUsesCanonicalRoster ||
      !preloginTargetFactsFresh ||
      !preloginTargetPreview ||
      preloginTargetPreview.publicationIdentity !== currentPreloginPublicationIdentity
    ) {
      return;
    }
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(`${path}/target-assignment`, {
        action: 'publish',
        expectedRevision: preloginTargetDraft.revision,
        confirmationFingerprint: preloginTargetPreview.fingerprint,
      });
      setPreloginTargetPreview(null);
      await loadPreloginTargetDraft();
    } catch (reason) {
      setPreloginTargetPreview(null);
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginTargetDraft();
        setPreloginError(`${operationError}；发布结果未知，已重读当前目标版本，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；发布结果未知且目标版本重读失败：${recoveryError}`);
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [
    currentPreloginPublicationIdentity,
    loadPreloginTargetDraft,
    path,
    preloginTargetDraft,
    preloginTargetFactsFresh,
    preloginTargetPreview,
    publishedAssignmentUsesCanonicalRoster,
  ]);

  const assignPreloginTarget = useCallback(async () => {
    if (!publishedAssignmentUsesCanonicalRoster || !preloginTargetFactsFresh || !preloginTargetDraft?.latestPublishedRevision) return;
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(`${path}/network-config`, {
        action: 'assignTarget',
        expectedRevision: preloginNetworkConfigRevision,
        assignmentId: preloginTargetDraft.assignmentId,
        revision: preloginTargetDraft.latestPublishedRevision,
      });
      await loadPreloginTargetDraft();
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginTargetDraft();
        setPreloginError(`${operationError}；分配结果未知，已重读当前网络配置，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；分配结果未知且当前网络配置重读失败：${recoveryError}`);
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [
    loadPreloginTargetDraft,
    path,
    preloginNetworkConfigRevision,
    preloginTargetDraft,
    preloginTargetFactsFresh,
    publishedAssignmentUsesCanonicalRoster,
  ]);

  const preparePrelogin = useCallback(async () => {
    if (!publishedAssignmentUsesCanonicalRoster) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      await loadPreloginFacts();
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      const refreshed = await refreshWorkspace();
      setPreloginError(
        refreshed
          ? `${operationError}；终端预检失败后已重读当前名单与考试活动，请按页面漂移明细处理后重试。`
          : `${operationError}；终端预检失败且当前名单重读失败，请先使用“重读教室事实”。`,
      );
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts, publishedAssignmentUsesCanonicalRoster, refreshWorkspace]);

  const startPreloginNetwork = useCallback(async () => {
    if (
      !preloginFactsCurrent ||
      !preloginWorkflow ||
      preloginWorkflow.network.source !== 'config' ||
      preloginWorkflow.network.configRevision === null
    ) {
      return;
    }
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(`${path}/network-execution`, {
        action: 'start',
        expectedRevision: preloginWorkflow.network.executionRevision,
        expectedConfigRevision: preloginWorkflow.network.configRevision,
      });
      const refreshed = await loadPreloginFacts();
      if (refreshed.workflow.network.source !== 'execution' || !refreshed.workflow.network.ready) {
        throw new Error('网络策略尚未在全部目标终端完成应用；请查看逐终端网络执行事实。');
      }
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginFacts();
        setPreloginError(`${operationError}；启动结果未知，已重读当前网络执行事实，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        const refreshed = await refreshWorkspace();
        setPreloginError(
          refreshed
            ? `${operationError}；当前网络执行事实重读失败（${recoveryError}），已重读名单与考试活动，请核对后继续。`
            : `${operationError}；启动结果未知且网络执行、名单事实均重读失败：${recoveryError}`,
        );
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts, path, preloginFactsCurrent, preloginWorkflow, refreshWorkspace]);

  const retryPreloginNetwork = useCallback(async () => {
    if (
      !preloginFactsCurrent ||
      !preloginWorkflow ||
      preloginWorkflow.network.source !== 'execution' ||
      preloginWorkflow.network.ready ||
      (preloginWorkflow.network.reason !== 'network_execution_pending' && preloginWorkflow.network.reason !== 'network_execution_failed')
    ) {
      return;
    }
    const action = preloginWorkflow.network.reason === 'network_execution_pending' ? 'retry' : 'retryFailed';
    setPreloginBusy(true);
    setPreloginError(null);
    setPreloginFactsFresh(false);
    try {
      await post(`${path}/network-execution`, { action, expectedRevision: preloginWorkflow.network.executionRevision });
      await loadPreloginFacts();
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        await loadPreloginFacts();
        setPreloginError(`${operationError}；网络重试结果未知，已重读当前执行事实，请核对后继续。`);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        const refreshed = await refreshWorkspace();
        setPreloginError(
          refreshed
            ? `${operationError}；当前执行事实重读失败（${recoveryError}），已重读名单与考试活动，请核对后继续。`
            : `${operationError}；网络重试结果未知且执行、名单事实均重读失败：${recoveryError}`,
        );
      }
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts, path, preloginFactsCurrent, preloginWorkflow, refreshWorkspace]);

  const confirmPrelogin = useCallback(async () => {
    if (
      !publishedPreparationAssignment ||
      !preloginFactsCurrent ||
      !preloginPreparation ||
      !preloginWorkflow ||
      preloginWorkflow.network.source !== 'execution' ||
      !preloginWorkflow.network.ready ||
      preloginWorkflow.hardErrorCount > 0 ||
      !preloginWorkflowWriterEnabled ||
      (publishedPreparationAssignment.schemaVersion === 2 && !preloginV2WriterEnabled) ||
      currentPublicationAlreadyConfirmed
    ) {
      return;
    }
    const url = new URL(window.location.href);
    const canonicalRequestId = url.searchParams.has('requestId') ? requestId(url.searchParams.get('requestId'), '确认请求') : createRequestId();
    writePreloginUrl({ requestId: canonicalRequestId, batchId: null });
    setPreloginBusy(true);
    setPreloginError(null);
    const expected = {
      allowBatchSwitch: true,
      batchId: preloginBatchRef.current?.batchId || null,
      generation: preloginBatchGenerationRef.current,
    };
    try {
      const payload = await post(`${path}/prelogin/confirm`, {
        assignmentRevision: publishedPreparationAssignment.revision,
        preparationFingerprint: preloginPreparation.fingerprint,
        workflowFingerprint: preloginWorkflow.fingerprint,
        requestId: canonicalRequestId,
      });
      const batch = parsePreloginBatch(payload.batch, eventId);
      if (!batch.workflow || batch.workflow.fingerprint !== preloginWorkflow.fingerprint || batch.requestId !== canonicalRequestId) {
        throw new Error('预登录确认响应身份不一致');
      }
      if (acceptPreloginBatch(batch, expected)) writePreloginUrl({ batchId: batch.batchId, requestId: null });
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      try {
        const recovered = await apiObject(`${path}/prelogin-requests/${encodeURIComponent(canonicalRequestId)}`);
        if (recovered.batch !== null) {
          const batch = parsePreloginBatch(recovered.batch, eventId);
          if (!acceptPreloginBatch(batch, expected)) return;
          if (batch.state === 'dispatched') {
            writePreloginUrl({ batchId: batch.batchId, requestId: null });
            return;
          }
          writePreloginUrl({ batchId: null, requestId: canonicalRequestId });
          await resumeDispatchingPrelogin(batch);
          return;
        }
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；确认请求恢复查询失败：${recoveryError}`);
        return;
      }
      setPreloginError(operationError);
    } finally {
      setPreloginBusy(false);
    }
  }, [
    currentPublicationAlreadyConfirmed,
    acceptPreloginBatch,
    eventId,
    path,
    preloginFactsCurrent,
    preloginPreparation,
    preloginWorkflow,
    preloginV2WriterEnabled,
    preloginWorkflowWriterEnabled,
    publishedPreparationAssignment,
    resumeDispatchingPrelogin,
    writePreloginUrl,
  ]);

  const retryFailedPrelogin = useCallback(async () => {
    if (!preloginBatch?.projection || !preloginBatchMatchesCurrentPublication) return;
    setPreloginBusy(true);
    setPreloginError(null);
    let canonicalRequestId: string | null = null;
    try {
      const url = new URL(window.location.href);
      const storedRequestId = url.searchParams.get('retryRequestId');
      canonicalRequestId = storedRequestId ? requestId(storedRequestId, '失败重试请求') : createRequestId();
      const storedRevision = url.searchParams.get('retryProjectionRevision');
      const expectedProjectionRevision =
        storedRevision === null ? preloginBatch.projection.projectionRevision : positiveInteger(Number(storedRevision), '失败重试请求');
      if (storedRevision !== null && expectedProjectionRevision !== preloginBatch.projection.projectionRevision) {
        if (preloginBatch.projection.projectionRevision > expectedProjectionRevision) {
          writePreloginUrl({ retryProjectionRevision: null, retryRequestId: null });
          return;
        }
        throw new Error('失败重试投影已由其它操作推进；请确认当前失败项后重新发起。');
      }
      const ticketIds = [...preloginBatch.retryableTicketIds];
      if (!ticketIds.length || new Set(ticketIds).size !== ticketIds.length) throw new Error('当前没有可重试的失败项');
      writePreloginUrl({ retryProjectionRevision: expectedProjectionRevision, retryRequestId: canonicalRequestId });
      const payload = await post(`${path}/prelogin-batches/${encodeURIComponent(preloginBatch.batchId)}/retry`, {
        expectedProjectionRevision,
        requestId: canonicalRequestId,
        ticketIds,
      });
      const batch = parsePreloginBatch(payload.batch, eventId);
      acceptPreloginBatch(batch);
      writePreloginUrl({ retryProjectionRevision: null, retryRequestId: null });
    } catch (reason) {
      const operationError = reason instanceof Error ? reason.message : String(reason);
      if (!canonicalRequestId) {
        setPreloginError(operationError);
        return;
      }
      try {
        await loadPreloginBatch(preloginBatch.batchId);
      } catch (recoveryReason) {
        const recoveryError = recoveryReason instanceof Error ? recoveryReason.message : String(recoveryReason);
        setPreloginError(`${operationError}；批次恢复查询失败：${recoveryError}`);
        return;
      }
      setPreloginError(`${operationError}；结果未知，已保留同一失败重试请求，可继续重放。`);
    } finally {
      setPreloginBusy(false);
    }
  }, [acceptPreloginBatch, eventId, loadPreloginBatch, path, preloginBatch, preloginBatchMatchesCurrentPublication, writePreloginUrl]);

  const projectionByTicket = useMemo(() => new Map((preloginBatch?.projection?.items || []).map((item) => [item.ticketId, item])), [preloginBatch]);
  const preloginResultCounts = useMemo(() => {
    const counts = { failed: 0, pending: 0, success: 0, unprocessed: 0 };
    for (const subject of preloginBatch?.subjects || []) {
      const item = projectionByTicket.get(subject.ticketId);
      if (!item) counts.unprocessed += 1;
      else if (item.status === 'applied' && item.stage === 'page_ready') counts.success += 1;
      else if (retryableStatuses.has(item.status)) counts.failed += 1;
      else counts.pending += 1;
    }
    counts.unprocessed += Math.max(0, (preloginBatch?.ticketCount || 0) - (preloginBatch?.subjects.length || 0));
    return counts;
  }, [preloginBatch, projectionByTicket]);
  const publishedRosterByUid = useMemo(() => new Map((publishedRoster?.entries || []).map((entry) => [entry.boundUserId, entry])), [publishedRoster]);
  const monitoringByEndpoint = useMemo(
    () => new Map((preloginWorkflow?.monitoring.items || []).map((item) => [item.endpointId, item])),
    [preloginWorkflow],
  );
  const pendingRetryIdentity = useMemo(() => {
    const url = new URL(window.location.href);
    return Boolean(url.searchParams.get('retryRequestId') && url.searchParams.get('retryProjectionRevision'));
  }, [preloginBatch, preloginError]);
  const pendingConfirmIdentity = new URL(window.location.href).searchParams.has('requestId');
  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      title={
        <div>
          <a href={`/admin/exam-infrastructure/events/${eventId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> 返回考试活动
          </a>
          <h1 className="text-xl font-semibold">考试座位分配</h1>
        </div>
      }
      description="名单、布局、终端绑定与分配 revision 均由服务端重新校验；页面不会自动生成或发布真实分配。"
    >
      <div className="space-y-4 pb-10">
        {error ? (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {workspace?.publishedRosterDrift?.changed ? (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-medium">当前参赛名单或团队关系已不同于已发布分配；新的预登录会整批阻止，请重新冻结名单并生成、检查和发布新版本。</p>
            <div className="mt-2 space-y-1">
              {workspace.publishedRosterDrift.items.map((item) => (
                <p key={`${item.kind}-${item.boundUserId}`}>{rosterDriftText(item)}</p>
              ))}
              {workspace.publishedRosterDrift.sourceChangedWithoutParticipantDiff ? (
                <p>名单来源范围或团队 revision 已变化，但成员与角色集合未变化；仍需重新冻结后确认新 revision。</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {workspace?.eventType === 'krypton' && !currentV2UsesCanonicalRoster ? (
          <div role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            历史 v2 计划或分配使用了 userbind
            子名单；凡仍引用该子名单的版本只读保留，不能继续生成、调整、发布或预登录。请先按当前比赛受众冻结新名单，再创建候选计划。
          </div>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>步骤 1–2：冻结名单与候选教室</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">这里只追加不可变名单与候选范围；不会自动生成、发布或修改长期终端绑定。</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <label className="text-sm font-medium" htmlFor="seat-roster-source">
                  步骤 1：名单来源
                </label>
                {workspace?.eventType === 'krypton' ? (
                  <output id="seat-roster-source" className="block w-full rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <span className="block font-medium">关联比赛受众</span>
                    <span className="block text-xs text-muted-foreground">
                      {workspace.contestAudienceState === 'public'
                        ? '公开或邀请码比赛不支持自动排座。'
                        : '名单来源由当前比赛的固定参赛范围自动确定，无需选择。'}
                    </span>
                  </output>
                ) : (
                  <select
                    id="seat-roster-source"
                    aria-label="名单来源"
                    value={sourceKind}
                    disabled={mutationBusy || dirty || !workspaceFresh || !automaticSeatingAllowed}
                    onChange={(event) => setSourceKind(event.target.value as 'userbindGroups' | 'userbindSchool')}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                  >
                    <option value="userbindGroups">指定 userbind 用户组</option>
                    <option value="userbindSchool">当前学校全部学生</option>
                  </select>
                )}
                {workspace?.contestAudienceState === 'public' ? (
                  <p className="text-sm text-amber-700">
                    这是一场参赛名单持续变化的完全公开或邀请码比赛，第一版不提供自动排座，也不会用学校、用户组或某一刻的 attend 用户绕过该限制。
                  </p>
                ) : null}
                {sourceKind === 'userbindGroups' ? (
                  <div className="max-h-40 space-y-1 overflow-auto rounded-md bg-muted/30 p-2">
                    {workspace?.rosterGroups.map((group) => (
                      <label key={group.groupId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={mutationBusy || dirty || !workspaceFresh || !automaticSeatingAllowed}
                          checked={selectedGroupIds.has(group.groupId)}
                          onChange={(event) =>
                            setSelectedGroupIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(group.groupId);
                              else next.delete(group.groupId);
                              return next;
                            })
                          }
                        />
                        {group.name}
                      </label>
                    ))}
                    {!workspace?.rosterGroups.length ? <p className="text-sm text-muted-foreground">当前学校没有可用用户组。</p> : null}
                  </div>
                ) : null}
                <Button
                  variant="outline"
                  disabled={
                    mutationBusy ||
                    dirty ||
                    !workspaceFresh ||
                    !automaticSeatingAllowed ||
                    (sourceKind === 'contestAudience' && workspace?.contestAudienceState !== 'fixed') ||
                    (sourceKind === 'userbindGroups' && !selectedGroupIds.size)
                  }
                  onClick={() =>
                    executeSeatPlan({
                      action: 'createRoster',
                      sourceKind,
                      groupIds: sourceKind === 'userbindGroups' ? [...selectedGroupIds].sort() : [],
                    })
                  }
                >
                  生成或刷新名单
                </Button>
              </div>
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">步骤 2：候选教室</p>
                  <p className="text-xs text-muted-foreground">可跨教室多选；计划会冻结当前布局、朝向和禁用配置版本。</p>
                </div>
                <div className="max-h-56 space-y-1 overflow-auto rounded-md bg-muted/30 p-2">
                  {workspace?.classrooms.map((classroom) => (
                    <div key={classroom.classroomId} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`选择教室${classroomDisplayById.get(classroom.classroomId) || classroom.classroomId}`}
                          disabled={mutationBusy || dirty || !workspaceFresh || !automaticSeatingAllowed}
                          checked={selectedV2ClassroomIds.has(classroom.classroomId)}
                          onChange={(event) =>
                            setSelectedV2ClassroomIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(classroom.classroomId);
                              else next.delete(classroom.classroomId);
                              return next;
                            })
                          }
                        />
                        <span className="truncate">
                          {classroomDisplayById.get(classroom.classroomId) || classroom.classroomId} · layout r{classroom.layoutRevision} ·{' '}
                          {classroom.seatCount} 座
                        </span>
                      </label>
                      <a
                        href={`/admin/exam-infrastructure/classrooms/${classroom.classroomId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs text-primary underline-offset-4 hover:underline"
                      >
                        朝向 / 禁用设置
                      </a>
                    </div>
                  ))}
                  {!workspace?.classrooms.length ? <p className="text-sm text-muted-foreground">当前学校没有可用教室。</p> : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={mutationBusy || (dirty && workspaceFresh)}
                  onClick={() => {
                    if (dirty && !window.confirm('这会放弃当前未保存的人工调整，并从服务端重新读取最终状态。是否继续？')) return;
                    void refreshWorkspace();
                  }}
                >
                  <RefreshCw className="size-4" /> {dirty && !workspaceFresh ? '放弃未保存调整并重读' : '重读教室事实'}
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    mutationBusy || dirty || !workspaceFresh || !automaticSeatingAllowed || !latestRosterForPlan || !selectedV2ClassroomIds.size
                  }
                  onClick={() =>
                    latestRosterForPlan &&
                    executeSeatPlan({
                      action: 'createSeatPlanV2',
                      rosterRevision: latestRosterForPlan.revision,
                      classroomIds: [...selectedV2ClassroomIds].sort(),
                      expectedPreviousRevision: latestPlan?.revision || 0,
                    })
                  }
                >
                  创建跨教室候选计划
                </Button>
                {latest?.schemaVersion === 1 || latestPlan?.schemaVersion === 1 ? (
                  <p className="rounded-md border bg-muted/20 p-2 text-sm text-muted-foreground">
                    v1 历史只读；新的候选计划和分配统一使用跨教室 v2。
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>步骤 3–5：生成、检查调整与发布</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm text-muted-foreground">
              步骤 3 选择策略并生成尽力型结果；步骤 4 在下方座位图或学生清单中换位、锁定并保存；步骤 5 明确发布最终 revision。
            </p>
            {!workspaceFresh ? (
              <p className="w-full rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm text-amber-800 dark:text-amber-200">
                页面事实尚未完成重读；所有写入、发布和导出均已暂停。请点击“重读教室事实”。
              </p>
            ) : null}
            {workspace?.latestSeatPlanState === 'layout-drift' ? (
              <p className="w-full text-sm text-amber-700">候选教室布局已变化；请在上方按当前布局创建新计划后再生成。</p>
            ) : null}
            {latestPlanV2?.roster && planRoster ? (
              <details className="w-full rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  当前候选计划冻结名单 r{planRoster.revision} · {planRoster.entries.length} 人（生成前请核对）
                </summary>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto text-muted-foreground">
                  {planRoster.entries.map((entry) => (
                    <p key={entry.boundUserId}>
                      {entry.studentId} · {entry.realName} · UID {entry.boundUserId}
                    </p>
                  ))}
                  {!planRoster.entries.length ? <p>名单为空。</p> : null}
                </div>
              </details>
            ) : null}
            {latestPlanV2 ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <span>分配策略</span>
                  <select
                    aria-label="跨教室分配策略"
                    value={v2Strategy}
                    disabled={mutationBusy || dirty || !workspaceFresh || !automaticSeatingAllowed || !latestPlanUsesCanonicalRoster}
                    onChange={(event) => setV2Strategy(event.target.value as AssignmentV2Revision['constraints']['strategy'])}
                    className="rounded-md border bg-background px-2 py-2 text-sm"
                  >
                    <option value="minimizeClassrooms">少用教室</option>
                    <option value="maximizeSpacing">优先隔开</option>
                  </select>
                </label>
                <Button
                  disabled={
                    mutationBusy ||
                    dirty ||
                    !workspaceFresh ||
                    !automaticSeatingAllowed ||
                    !latestPlanUsesCanonicalRoster ||
                    !latestPlanV2.roster ||
                    !latestPlanCurrent ||
                    !planRoster
                  }
                  onClick={() =>
                    execute({
                      action: 'generateV2',
                      expectedPreviousRevision: latest?.revision || 0,
                      strategy: v2Strategy,
                      seatPlanRevision: latestPlanV2.revision,
                    })
                  }
                >
                  <Shuffle className="size-4" /> 生成尽力型跨教室分配
                </Button>
                <Button
                  variant="outline"
                  disabled={mutationBusy || dirty || !assignmentIsCurrentV2}
                  onClick={() => latestV2 && execute({ action: 'rerandomizeV2', baseAssignmentRevision: latestV2.revision })}
                >
                  <RefreshCw className="size-4" /> 保留锁定项重新分配
                </Button>
                <Button
                  variant="outline"
                  disabled={mutationBusy || !assignmentIsCurrentV2 || !dirty}
                  onClick={() =>
                    latestV2 &&
                    execute({
                      action: 'adjustV2',
                      baseAssignmentRevision: latestV2.revision,
                      lockedUids: [...locked].sort((a, b) => a - b),
                      mappings: v2Draft,
                    })
                  }
                >
                  <Save className="size-4" /> 保存跨教室人工调整
                </Button>
                <Button
                  disabled={mutationBusy || dirty || !assignmentIsCurrentV2}
                  onClick={() =>
                    latestV2 &&
                    execute({
                      action: 'publish',
                      assignmentRevision: latestV2.revision,
                      expectedPublicationRevision: workspace?.publicationRevision || 0,
                    })
                  }
                >
                  <Upload className="size-4" /> {latestV2 ? `发布跨教室版本 ${latestV2.revision}` : '发布'}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">请先在上方创建跨教室 v2 候选计划；v1 历史只读。</p>
            )}
            <Button variant="ghost" disabled={!latest || dirty || mutationBusy || !workspaceFresh} onClick={exportCurrent}>
              <Download className="size-4" /> 导出当前页面 CSV
            </Button>
            {latest ? (
              <Badge variant={latest.published ? 'default' : 'outline'}>
                分配版本 {latest.revision}
                {latest.published ? ' · 已发布' : ' · 未发布'}
              </Badge>
            ) : (
              <Badge variant="outline">尚未生成</Badge>
            )}
            {dirty ? <Badge variant="destructive">人工调整未保存</Badge> : null}
          </CardContent>
        </Card>

        {diagnostics.length ? (
          <Card>
            <CardHeader>
              <CardTitle>完整诊断</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {diagnostics.map((item, index) => (
                <p key={`${item.code}-${index}`}>{diagnosticText(item)}</p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {latestV2 ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>步骤 4：检查解释并人工调整</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">只展示已冻结的客观事实：教室用量、风险边、拆队、跳过座位和 Endpoint 状态。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="缩小座位图"
                    disabled={mapZoom <= 0.6}
                    onClick={() => setMapZoom((current) => Math.max(0.6, Number((current - 0.2).toFixed(1))))}
                  >
                    <ZoomOut className="size-4" />
                  </Button>
                  <span className="min-w-12 text-center text-sm">{Math.round(mapZoom * 100)}%</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="放大座位图"
                    disabled={mapZoom >= 1.8}
                    onClick={() => setMapZoom((current) => Math.min(1.8, Number((current + 0.2).toFixed(1))))}
                  >
                    <ZoomIn className="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant={showRiskLines ? 'default' : 'outline'} onClick={() => setShowRiskLines((value) => !value)}>
                    {showRiskLines ? '隐藏风险连线' : '显示风险连线'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {dirty ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm text-amber-800 dark:text-amber-200">
                  座位图已显示人工换位；风险边和解释仍属于已保存版本，保存后服务端会重新计算。
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {latestV2.explanation.classrooms.map((classroom) => (
                  <div key={classroom.classroomId} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{classroomDisplayById.get(classroom.classroomId) || classroom.classroomId}</p>
                    <p className="mt-1 text-muted-foreground">
                      已分配 {classroom.assignedCount} / 可用 {classroom.eligibleSeatCount}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={riskDetail === 'high' ? 'destructive' : 'outline'}
                  onClick={() => setRiskDetail((value) => (value === 'high' ? null : 'high'))}
                >
                  高风险边 {latestV2.explanation.highRiskEdges.length}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={riskDetail === 'medium' ? 'default' : 'outline'}
                  onClick={() => setRiskDetail((value) => (value === 'medium' ? null : 'medium'))}
                >
                  中风险边 {latestV2.explanation.mediumRiskEdges.length}
                </Button>
                <Badge variant={latestV2.explanation.splitTeamIds.length ? 'destructive' : 'outline'}>
                  拆分队伍 {latestV2.explanation.splitTeamIds.length}
                </Badge>
                <Badge variant="outline">跳过座位 {latestV2.explanation.skippedSeats.length}</Badge>
                <Badge variant={knownOfflineV2Seats.length ? 'destructive' : 'outline'}>离线 Endpoint {knownOfflineV2Seats.length}</Badge>
                <Badge variant={unknownOnlineV2Seats.length ? 'secondary' : 'outline'}>在线未知 {unknownOnlineV2Seats.length}</Badge>
                <Badge variant={latestV2.explanation.unsetFacingSeats.length ? 'secondary' : 'outline'}>
                  朝向未设置 {latestV2.explanation.unsetFacingSeats.length}
                </Badge>
              </div>
              {riskDetail ? (
                <div className="max-h-56 space-y-1 overflow-auto rounded-md border p-3 text-sm" aria-live="polite">
                  {(riskDetail === 'high' ? latestV2.explanation.highRiskEdges : latestV2.explanation.mediumRiskEdges).map((edge) => (
                    <p key={riskEdgeKey(edge)}>
                      {describeV2Seat(edge.left)} ↔ {describeV2Seat(edge.right)} · {riskReasonLabel[edge.reason]} · 距离 {edge.distance}
                    </p>
                  ))}
                  {!(riskDetail === 'high' ? latestV2.explanation.highRiskEdges : latestV2.explanation.mediumRiskEdges).length ? (
                    <p className="text-muted-foreground">无该级别风险边。</p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">拆队和跳过明细</summary>
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    {splitTeams.map((team) => (
                      <div key={team.teamId} className="rounded border p-2">
                        <p className="font-medium text-foreground">队伍 {team.teamId}</p>
                        {team.members.map(({ participant, row }) => (
                          <p key={participant.boundUserId}>
                            {participant.teamRole === 'captain' ? '队长' : '队员'} · {row?.studentId || participant.studentId}{' '}
                            {row?.realName || '姓名未知'} →{' '}
                            {row
                              ? `${classroomDisplayById.get(row.classroomId) || row.classroomId} / ${row.seatLabel || row.sourceSeatId}`
                              : '座位未知'}
                          </p>
                        ))}
                      </div>
                    ))}
                    {!splitTeams.length ? <p>没有被拆分的队伍。</p> : null}
                    {latestV2.explanation.skippedSeats.map((item) => (
                      <p key={seatIdentityKey(item.seat)}>
                        {describeV2Seat(item.seat)} · {skippedReasonLabel[item.reason]}
                      </p>
                    ))}
                    {!latestV2.explanation.skippedSeats.length ? <p>没有被跳过的座位。</p> : null}
                  </div>
                </details>
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Endpoint 与朝向 warning 明细</summary>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {knownOfflineV2Seats.map((seat) => (
                      <p key={`offline-${seatIdentityKey(seat)}`}>{describeV2Seat(seat)} · Endpoint 离线</p>
                    ))}
                    {unknownOnlineV2Seats.map((seat) => (
                      <p key={`unknown-${seatIdentityKey(seat)}`}>{describeV2Seat(seat)} · Endpoint 在线状态未知</p>
                    ))}
                    {latestV2.explanation.unsetFacingSeats.map((seat) => (
                      <p key={`facing-${seatIdentityKey(seat)}`}>{describeV2Seat(seat)} · 朝向未设置</p>
                    ))}
                    {!knownOfflineV2Seats.length && !unknownOnlineV2Seats.length && !latestV2.explanation.unsetFacingSeats.length ? (
                      <p>没有 Endpoint 或朝向 warning。</p>
                    ) : null}
                  </div>
                </details>
              </div>
              <div className="space-y-5">
                {latestV2.classrooms.map((classroom) => (
                  <ClassroomSeatMap
                    key={classroom.classroomId}
                    classroomId={classroom.classroomId}
                    classroomName={classroomDisplayById.get(classroom.classroomId) || classroom.classroomId}
                    editable={canMutateV2Draft}
                    highRiskKeys={highRiskKeys}
                    mediumRiskKeys={mediumRiskKeys}
                    mappings={v2Draft}
                    onSelect={selectForSwap}
                    rowsByUid={rowsByUid}
                    seats={latestV2.seatFacts}
                    selectedUid={selectedUid}
                    showRiskLines={showRiskLines}
                    zoom={mapZoom}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>步骤 6–7：终端预检、网络启动与显式预启动</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspace?.eventType === 'external' ? (
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <p className="font-medium">预登录不适用</p>
                <p className="mt-1 text-muted-foreground">
                  外部考试没有受信 Contest 工作台；可继续使用教室或指定终端目标完成网络控制，不创建空名单或伪造票据。
                </p>
                <Button asChild className="mt-3" size="sm" variant="outline">
                  <a href={`/admin/exam-infrastructure/events/${eventId}`}>返回网络策略与目标</a>
                </Button>
              </div>
            ) : !publishedPreparationAssignment ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                请先发布一份座位分配；终端预检不会使用最新未发布草稿。
              </div>
            ) : (
              <>
                <p className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-sm text-sky-800 dark:text-sky-200">
                  建议在开赛前 10–15 分钟运行预检并启动网络；系统不会定时唤起、不会 Wake-on-LAN，也不会自动点击最后一步。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">名单 r{publishedPreparationAssignment.roster.revision}</Badge>
                  <Badge variant="outline">分配 r{publishedPreparationAssignment.revision}</Badge>
                  <Badge variant="outline">发布 r{workspace?.publicationRevision || 0}</Badge>
                  {preloginWorkflow ? <Badge variant="outline">策略 r{preloginWorkflow.network.policy.revision}</Badge> : null}
                  {preloginWorkflow ? <Badge variant="outline">目标 r{preloginWorkflow.network.target.revision}</Badge> : null}
                  {preloginBatch ? <Badge variant="outline">批次 r{preloginBatch.revision}</Badge> : null}
                  {preloginBatch?.projection ? <Badge variant="outline">投影 r{preloginBatch.projection.projectionRevision}</Badge> : null}
                </div>
                <p className="font-mono text-xs text-muted-foreground">发布 assignment {publishedPreparationAssignment.assignmentId}</p>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium">步骤 6：固定终端范围并启动网络</p>
                  <p className="mt-1 text-xs text-muted-foreground">每一步仍需显式点击；不会自动发布目标或启动网络。</p>
                  {!publishedAssignmentUsesCanonicalRoster ? (
                    <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-200">
                      当前发布分配使用历史 userbind 子名单，仅供审计；请发布基于 canonical 比赛名单的新分配后再配置终端、网络和预登录。
                    </p>
                  ) : null}
                  <div className="mt-3 rounded-md border bg-background p-3">
                    <p className="text-sm font-medium">网络策略与活动状态</p>
                    {!preloginTargetFactsFresh ? (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        disabled={mutationBusy || dirty || !workspaceFresh || !publishedAssignmentUsesCanonicalRoster}
                        onClick={() => void refreshPreloginTargetFacts()}
                      >
                        <RefreshCw className="size-4" /> 读取当前策略与目标事实
                      </Button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">当前策略 {preloginNetworkPolicyRef ? `r${preloginNetworkPolicyRef.revision}` : '未分配'}</Badge>
                          <Badge variant="outline">当前目标 {preloginNetworkTargetRef ? `r${preloginNetworkTargetRef.revision}` : '未分配'}</Badge>
                          <Badge variant="outline">
                            活动 {workspace?.eventLifecycle === 'draft' ? '草稿' : workspace?.eventLifecycle === 'scheduled' ? '已计划' : '已归档'}
                          </Badge>
                        </div>
                        {preloginPolicyOptions.length ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <label className="flex-1 text-sm">
                              <span className="mb-1 block font-medium">已发布网络策略版本</span>
                              <select
                                aria-label="已发布网络策略版本"
                                value={selectedPreloginPolicy}
                                onChange={(event) => setSelectedPreloginPolicy(event.target.value)}
                                className="h-9 w-full rounded-md border bg-background px-3"
                              >
                                <option value="">请选择策略</option>
                                {preloginPolicyOptions.map((option) => (
                                  <option key={`${option.templateId}:${option.revision}`} value={`${option.templateId}:${option.revision}`}>
                                    {option.name} · r{option.revision}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                mutationBusy ||
                                dirty ||
                                !workspaceFresh ||
                                !publishedAssignmentUsesCanonicalRoster ||
                                !selectedPreloginPolicy ||
                                selectedPreloginPolicy ===
                                  (preloginNetworkPolicyRef ? `${preloginNetworkPolicyRef.id}:${preloginNetworkPolicyRef.revision}` : '')
                              }
                              onClick={() => void assignPreloginPolicy()}
                            >
                              分配所选策略
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            当前学校没有可选的已发布网络策略；请先在考试基础设施中发布策略版本。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        mutationBusy ||
                        dirty ||
                        !workspaceFresh ||
                        !publishedAssignmentUsesCanonicalRoster ||
                        (preloginTargetFactsFresh && preloginTargetDraft?.sourceAssignmentId === publishedPreparationAssignment.assignmentId)
                      }
                      onClick={() => void savePublishedAssignmentAsTarget()}
                    >
                      1. 保存当前分配为目标
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        mutationBusy ||
                        dirty ||
                        !workspaceFresh ||
                        !publishedAssignmentUsesCanonicalRoster ||
                        !preloginTargetFactsFresh ||
                        preloginTargetDraft?.sourceAssignmentId !== publishedPreparationAssignment.assignmentId
                      }
                      onClick={() => void previewPreloginTarget()}
                    >
                      2. 重新解析目标
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        mutationBusy ||
                        dirty ||
                        !workspaceFresh ||
                        !publishedAssignmentUsesCanonicalRoster ||
                        !preloginTargetFactsFresh ||
                        !preloginTargetPreview ||
                        preloginTargetPreview.publicationIdentity !== currentPreloginPublicationIdentity
                      }
                      onClick={() => void publishPreloginTarget()}
                    >
                      3. 发布目标快照
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        mutationBusy ||
                        dirty ||
                        !workspaceFresh ||
                        !publishedAssignmentUsesCanonicalRoster ||
                        !preloginTargetFactsFresh ||
                        !preloginTargetDraft?.latestPublishedRevision ||
                        preloginTargetDraft.latestPublishedSourceAssignmentId !== publishedPreparationAssignment.assignmentId
                      }
                      onClick={() => void assignPreloginTarget()}
                    >
                      4. 分配到活动
                    </Button>
                  </div>
                  {preloginTargetPreview ? (
                    <div className="mt-3 rounded-md border bg-background p-3 text-xs">
                      <p className="font-medium">即将发布 {preloginTargetPreview.targetCount} 台终端</p>
                      <p className="mt-1 text-muted-foreground">
                        新增 {preloginTargetPreview.addedEndpointIds.length} · 移除 {preloginTargetPreview.removedEndpointIds.length}
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer">查看完整 Endpoint 范围</summary>
                        <p className="mt-2 break-all font-mono">{preloginTargetPreview.endpointIds.join('、')}</p>
                      </details>
                    </div>
                  ) : null}
                  {workspace?.eventLifecycle === 'draft' ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      disabled={
                        mutationBusy ||
                        dirty ||
                        !workspaceFresh ||
                        !publishedAssignmentUsesCanonicalRoster ||
                        !preloginTargetFactsFresh ||
                        !preloginNetworkPolicyRef ||
                        !preloginNetworkTargetRef
                      }
                      onClick={() => void scheduleExamEvent()}
                    >
                      <Play className="size-4" /> 将考试活动显式计划为待开始
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={
                      mutationBusy || dirty || !workspaceFresh || !publishedAssignmentUsesCanonicalRoster || workspace?.eventLifecycle !== 'scheduled'
                    }
                    onClick={() => void preparePrelogin()}
                  >
                    {preloginBusy ? <RefreshCw className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />} 运行终端预检
                  </Button>
                  {preloginFactsCurrent && preloginWorkflow?.network.source === 'config' ? (
                    <Button disabled={mutationBusy || dirty} onClick={() => void startPreloginNetwork()}>
                      <Play className="size-4" /> 启动网络策略
                    </Button>
                  ) : null}
                  {preloginFactsCurrent &&
                  preloginWorkflow?.network.source === 'execution' &&
                  !preloginWorkflow.network.ready &&
                  (preloginWorkflow.network.reason === 'network_execution_pending' ||
                    preloginWorkflow.network.reason === 'network_execution_failed') ? (
                    <Button variant="outline" disabled={mutationBusy || dirty} onClick={() => void retryPreloginNetwork()}>
                      <RefreshCw className="size-4" />
                      {preloginWorkflow.network.reason === 'network_execution_pending' ? '重试当前网络请求' : '整批重试失败网络命令'}
                    </Button>
                  ) : null}
                  <Button
                    disabled={
                      mutationBusy ||
                      dirty ||
                      !preloginFactsCurrent ||
                      !preloginPreparation ||
                      !preloginWorkflow ||
                      preloginWorkflow.network.source !== 'execution' ||
                      !preloginWorkflow.network.ready ||
                      preloginWorkflow.hardErrorCount > 0 ||
                      !preloginWorkflowWriterEnabled ||
                      (publishedPreparationAssignment.schemaVersion === 2 && !preloginV2WriterEnabled) ||
                      currentPublicationAlreadyConfirmed
                    }
                    onClick={() => void confirmPrelogin()}
                  >
                    <Play className="size-4" /> 步骤 7：一键预启动全部终端
                  </Button>
                </div>
                {preloginFactsCurrent && preloginPreparation && !preloginWorkflowWriterEnabled ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                    当前处于 P2.9 兼容读取阶段，确认写入尚未启用。请先完成旧批次兼容验证，再由管理员启用 exam.preloginWorkflowWriterEnabled。
                  </p>
                ) : null}
                {preloginFactsCurrent && preloginPreparation && publishedPreparationAssignment.schemaVersion === 2 && !preloginV2WriterEnabled ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                    跨教室预登录当前处于兼容读取阶段。部署并验证 P2.14 reader 后，由管理员一次性启用
                    exam.preloginV2WriterEnabled；启用后最低回滚版本为 P2.14 compatible reader。
                  </p>
                ) : null}
                {preloginError ? (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {preloginError}
                  </p>
                ) : null}
                {preloginFactsCurrent && preloginWorkflow && preloginPreparation ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">确认范围</p>
                        <p className="text-xs text-muted-foreground">
                          {preloginWorkflow.network.source === 'execution'
                            ? `运行执行 r${preloginWorkflow.network.executionRevision}`
                            : `活动配置 r${preloginWorkflow.network.configRevision}`}
                          {' · '}目标 {preloginWorkflow.network.targetCount} 台 · 硬截止{' '}
                          {new Date(preloginWorkflow.network.hardEndAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          网络应用 {preloginWorkflow.network.appliedCount} · 失败 {preloginWorkflow.network.failedCount} · 在途{' '}
                          {preloginWorkflow.network.pendingCount}
                          {preloginWorkflow.network.reason === 'network_execution_not_active' ? ' · 尚未启动' : ''}
                          {preloginWorkflow.network.reason === 'network_execution_expired' ? ' · 已到硬截止' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          预登录终端覆盖 {preloginWorkflow.network.coveredPreloginCount}/{preloginWorkflow.network.preloginEndpointCount}
                          {preloginWorkflow.network.missingPreloginEndpointIds.length
                            ? ` · 目标缺少 ${preloginWorkflow.network.missingPreloginEndpointIds.join('、')}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={preloginWorkflow.hardErrorCount ? 'destructive' : 'default'}>硬错误 {preloginWorkflow.hardErrorCount}</Badge>
                        <Badge variant="outline">告警 {preloginWorkflow.warningCount}</Badge>
                      </div>
                    </div>
                    <div className="max-h-96 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>学生</TableHead>
                            <TableHead>座位 / Endpoint</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>预检</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preloginPreparation.items.map((item) => {
                            const student = publishedRosterByUid.get(item.uid);
                            const monitoring = item.endpointId ? monitoringByEndpoint.get(item.endpointId) : null;
                            const publishedSeat = publishedV2SeatByUid.get(item.uid);
                            const hardDiagnostics = item.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
                            const warningDiagnostics = item.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
                            return (
                              <TableRow key={item.uid}>
                                <TableCell>
                                  <div className="font-medium">{student?.studentId || `UID ${item.uid}`}</div>
                                  <div className="text-xs text-muted-foreground">{student?.realName || item.studentRecordId}</div>
                                </TableCell>
                                <TableCell>
                                  <div>
                                    {publishedSeat
                                      ? `${classroomDisplayById.get(publishedSeat.classroomId) || publishedSeat.classroomId} / ${publishedSeat.sourceSeatId}`
                                      : item.sourceSeatId}
                                  </div>
                                  <div className="font-mono text-xs text-muted-foreground">{item.endpointId || '未绑定'}</div>
                                </TableCell>
                                <TableCell>
                                  <div>{item.endpoint.serviceVersion || monitoring?.serviceVersion || '未知版本'}</div>
                                  <div className="text-xs text-muted-foreground">
                                    协议 {item.endpoint.protocolVersion || monitoring?.protocolVersion || '未知'}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={item.ready && monitoring?.ready !== false ? 'default' : 'destructive'}>
                                    {item.ready && monitoring?.ready !== false ? '可投递' : '阻塞'}
                                  </Badge>
                                  {hardDiagnostics.length ? (
                                    <div className="mt-1 text-xs text-destructive">
                                      {hardDiagnostics.map((diagnostic) => diagnostic.code).join('、')}
                                    </div>
                                  ) : null}
                                  {warningDiagnostics.length ? (
                                    <div className="mt-1 text-xs text-amber-700">
                                      告警：{warningDiagnostics.map((diagnostic) => diagnostic.code).join('、')}
                                    </div>
                                  ) : null}
                                  {monitoring?.warnings.length ? (
                                    <div className="mt-1 text-xs text-amber-700">
                                      告警：{monitoring.warnings.map((warning) => warning.kind).join('、')}
                                    </div>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : null}
                {preloginBatch ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">逐终端结果</p>
                        <p className="font-mono text-xs text-muted-foreground">batch {preloginBatch.batchId}</p>
                        <p className="font-mono text-xs text-muted-foreground">request {preloginBatch.requestId}</p>
                        <p className="text-xs text-muted-foreground">
                          冻结分配 r{preloginBatch.assignment.revision} · 发布 r{preloginBatch.publicationRevision}
                        </p>
                        {preloginBatch.workflow ? (
                          <p className="text-xs text-muted-foreground">
                            确认时执行 r{preloginBatch.workflow.executionRevision} · 策略 r{preloginBatch.workflow.policy.revision} · 目标 r
                            {preloginBatch.workflow.target.revision}（{preloginBatch.workflow.targetCount} 台） · 硬截止{' '}
                            {new Date(preloginBatch.workflow.hardEndAt).toLocaleString()}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">历史预登录批次（P2.9 前创建），未记录整合工作流网络版本。</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="default">成功 {preloginResultCounts.success}</Badge>
                        <Badge variant="destructive">失败 {preloginResultCounts.failed}</Badge>
                        <Badge variant="secondary">在途 {preloginResultCounts.pending}</Badge>
                        <Badge variant="outline">未处理 {preloginResultCounts.unprocessed}</Badge>
                      </div>
                    </div>
                    {!preloginBatchMatchesCurrentPublication ? (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-200">
                        这是历史发布版本的批次，仅供审计；不能对当前发布版本执行失败重试。
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      disabled={
                        mutationBusy ||
                        !preloginBatchMatchesCurrentPublication ||
                        !preloginBatch.projection ||
                        (!preloginBatch.retryableTicketIds.length && !pendingRetryIdentity)
                      }
                      onClick={() => void retryFailedPrelogin()}
                    >
                      <RefreshCw className="size-4" />
                      {pendingRetryIdentity ? '继续上次失败重试' : `只重试 ${preloginBatch.retryableTicketIds.length} 个失败项`}
                    </Button>
                    <div className="max-h-96 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>学生</TableHead>
                            <TableHead>座位 / Endpoint</TableHead>
                            <TableHead>阶段</TableHead>
                            <TableHead>结果</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preloginBatch.subjects.map((subject) => {
                            const student = preloginBatchRosterByUid.get(subject.uid);
                            const structuredSeat = preloginBatchSeatByUid.get(subject.uid);
                            const result = projectionByTicket.get(subject.ticketId);
                            const succeeded = result?.status === 'applied' && result.stage === 'page_ready';
                            return (
                              <TableRow key={subject.ticketId}>
                                <TableCell>{student ? `${student.studentId} · ${student.realName}` : `UID ${subject.uid}`}</TableCell>
                                <TableCell>
                                  <div>
                                    {structuredSeat
                                      ? `${classroomDisplayById.get(structuredSeat.classroomId) || structuredSeat.classroomId} / ${structuredSeat.sourceSeatId}`
                                      : preloginBatchAssignment?.schemaVersion === 1
                                        ? subject.sourceSeatId
                                        : `${subject.sourceSeatId}（历史教室不可定位）`}
                                  </div>
                                  <div className="font-mono text-xs text-muted-foreground">{subject.endpointId}</div>
                                </TableCell>
                                <TableCell>{result?.stage || 'dispatch'}</TableCell>
                                <TableCell>
                                  <Badge variant={succeeded ? 'default' : result && retryableStatuses.has(result.status) ? 'destructive' : 'outline'}>
                                    {succeeded ? '页面就绪' : result?.status || '未处理'}
                                  </Badge>
                                  {result?.failureReason ? <div className="mt-1 text-xs text-destructive">{result.failureReason}</div> : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : null}
                <Button size="sm" variant="ghost" disabled={mutationBusy} onClick={() => void loadPreloginBatchHistory()}>
                  查看历史批次
                </Button>
                {pendingConfirmIdentity ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    确认请求结果尚未收敛；原 requestId 已保留，继续同一确认请求前暂不可切换历史批次。
                  </p>
                ) : null}
                {preloginBatchHistory.length ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="font-medium">历史预登录批次</p>
                    {preloginBatchHistory.map((batch) => (
                      <button
                        key={batch.batchId}
                        type="button"
                        disabled={mutationBusy || pendingRetryIdentity || pendingConfirmIdentity}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          selectPreloginBatch(batch);
                          writePreloginUrl({ batchId: batch.batchId, requestId: null });
                        }}
                      >
                        <span>
                          分配 r{batch.assignment.revision} · 发布 r{batch.publicationRevision} · 批次 r{batch.revision}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{batch.requestId}</span>
                        <span className="w-full text-xs text-muted-foreground">
                          {batch.workflow
                            ? `执行 r${batch.workflow.executionRevision} · 策略 r${batch.workflow.policy.revision} · 目标 r${batch.workflow.target.revision}`
                            : 'P2.9 前历史批次，无整合工作流引用'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>步骤 4 补充：学生与实体座位清单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspace?.endpointState === 'unavailable' ? (
              <p className="text-sm text-amber-700">终端实时状态暂不可用；不会把未知状态伪装为在线。</p>
            ) : null}
            <Input
              aria-label="搜索学生或座位"
              placeholder="搜索学号、姓名或座位"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {selectedStudent && canMutateV2Draft ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
                <span className="text-sm">为 {selectedStudent.realName} 指定座位</span>
                <select
                  aria-label={`为${selectedStudent.realName}指定座位`}
                  value={seatIdentityKey(selectedStudent)}
                  disabled={!canMutateV2Draft}
                  onChange={(event) => {
                    assignSeatV2(selectedStudent.boundUserId, event.target.value);
                    setSelectedUid(null);
                  }}
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                >
                  {eligibleV2Seats.map((candidate) => (
                    <option key={seatIdentityKey(candidate)} value={seatIdentityKey(candidate)}>
                      {classroomDisplayById.get(candidate.classroomId) || candidate.classroomId} · {candidate.label || candidate.sourceSeatId} ·{' '}
                      {candidate.sourceSeatId}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学生</TableHead>
                  <TableHead>座位</TableHead>
                  <TableHead>终端</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>人工调整</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const seatKey = seatIdentityKey({ classroomId: row.classroomId, sourceSeatId: row.sourceSeatId });
                  const seat = seatByIdentity.get(seatKey);
                  const v2Seat = latestV2SeatByKey.get(seatKey);
                  const endpoint = row.endpointId ? preflightByEndpoint.get(row.endpointId) : null;
                  return (
                    <TableRow
                      key={row.boundUserId}
                      draggable={canMutateV2Draft}
                      onDragStart={() => canMutateV2Draft && setSelectedUid(row.boundUserId)}
                      onDragOver={(event) => canMutateV2Draft && event.preventDefault()}
                      onDrop={() => {
                        if (!canMutateV2Draft || selectedUid === null) return;
                        swapV2(selectedUid, row.boundUserId);
                        setSelectedUid(null);
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{row.studentId}</div>
                        <div className="text-muted-foreground">{row.realName}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{row.seatLabel || '未分配'}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.classroomId ? `${classroomDisplayById.get(row.classroomId) || row.classroomId} · ` : ''}
                          {row.sourceSeatId || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{row.endpointId || '未绑定'}</div>
                        <div className="text-xs text-muted-foreground">
                          {seat?.bindingRevision || v2Seat?.bindingRevision ? `绑定 r${seat?.bindingRevision || v2Seat?.bindingRevision}` : '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {endpoint ? (
                          <Badge variant={endpoint.online ? 'default' : 'destructive'}>{endpoint.online ? '在线' : '离线'}</Badge>
                        ) : (
                          <Badge variant="outline">未知</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {assignmentIsCurrentV2 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={selectedUid === row.boundUserId ? 'default' : 'outline'}
                              aria-label={`选择${row.realName}换位`}
                              disabled={!canMutateV2Draft}
                              onClick={() => selectForSwap(row.boundUserId)}
                            >
                              <GripVertical className="size-4" /> 换位
                            </Button>
                            <label className="inline-flex items-center gap-1 text-sm">
                              <input
                                type="checkbox"
                                aria-label={`锁定${row.realName}`}
                                checked={locked.has(row.boundUserId)}
                                disabled={!canMutateV2Draft}
                                onChange={(event) =>
                                  setLocked((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(row.boundUserId);
                                    else next.delete(row.boundUserId);
                                    return next;
                                  })
                                }
                              />
                              <LockKeyhole className="size-3.5" /> 锁定
                            </label>
                          </div>
                        ) : latestV1 ? (
                          <Badge variant="outline">v1 历史只读</Badge>
                        ) : latestV2 ? (
                          <Badge variant="outline">当前分配未引用最新计划</Badge>
                        ) : (
                          <Badge variant="outline">尚未生成分配</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!workspace ? <p className="text-sm text-muted-foreground">正在加载座位分配……</p> : null}
            {workspace && !rows.length ? <p className="text-sm text-muted-foreground">当前名单为空；系统不会凭空创建学生或分配记录。</p> : null}
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}

export function ExamSeatPlanPage() {
  const bs = useBootstrap();
  const data = record(bs.page.data, '考试座位页面');
  if (data.canManage !== true) return <ForbiddenPanel message="你没有管理此考试活动的权限。" />;
  const eventId = text(data.eventId, '考试座位页面');
  if (!eventId) throw new Error('考试座位页面响应格式不正确');
  return <SeatAssignmentWorkspace eventId={eventId} />;
}
