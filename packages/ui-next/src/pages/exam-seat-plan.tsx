import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, GripVertical, LockKeyhole, Play, RefreshCw, Save, Shuffle, Upload } from 'lucide-react';
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
  entries: RosterEntry[];
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
  startAt: string;
  endAt: string;
  rosterRevisions: RosterRevision[];
  seatPlans: SeatPlanRevision[];
  assignments: AssignmentRevision[];
  publicationRevision: number;
  source: { schemaVersion: 1 | 2; seatPlanRevision: number; seats: PhysicalSeat[] } | null;
  endpointState: 'available' | 'not-required' | 'unavailable';
  endpointItems: EndpointPreflightItem[];
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
  fingerprint: string;
  targetCount: number;
  endpointIds: string[];
  addedEndpointIds: string[];
  removedEndpointIds: string[];
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
  if (row.requiredSeatCount !== undefined) diagnostic.requiredSeatCount = integer(row.requiredSeatCount, '诊断');
  if (row.availableSeatCount !== undefined) diagnostic.availableSeatCount = integer(row.availableSeatCount, '诊断');
  if (row.reasons !== undefined) diagnostic.reasons = array(row.reasons, '诊断').map((item) => text(item, '诊断'));
  return diagnostic;
}

function parseRoster(value: unknown): RosterRevision {
  const row = record(value, '名单版本');
  return {
    rosterId: text(row.rosterId, '名单版本'),
    revision: integer(row.revision, '名单版本'),
    fingerprint: text(row.fingerprint, '名单版本'),
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

function diagnosticText(diagnostic: AssignmentDiagnostic): string {
  if (diagnostic.code === 'insufficient_seats') {
    return `可用座位不足：需要 ${diagnostic.requiredSeatCount || 0}，当前 ${diagnostic.availableSeatCount || 0}`;
  }
  if (diagnostic.code === 'seat_disabled') return `已排除禁用座位：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  if (diagnostic.code === 'seat_unbound') return `已排除未绑定终端的座位：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  if (diagnostic.code === 'seat_status_invalid') return `座位状态异常：${diagnostic.sourceSeatIds?.join('、') || '-'}`;
  return `约束冲突：${diagnostic.reasons?.join('、') || diagnostic.code}`;
}

function SeatAssignmentWorkspace({ eventId }: { eventId: string }) {
  const path = `/api/admin/exam-events/${eventId}`;
  const [workspace, setWorkspace] = useState<AssignmentWorkspace | null>(null);
  const [draft, setDraft] = useState<AssignmentMapping[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionDiagnostics, setActionDiagnostics] = useState<AssignmentDiagnostic[]>([]);
  const [sourceKind, setSourceKind] = useState<'contestAudience' | 'userbindGroups' | 'userbindSchool'>('userbindGroups');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [preparationSeats, setPreparationSeats] = useState<PhysicalSeat[]>([]);
  const [selectedCandidateSeatIds, setSelectedCandidateSeatIds] = useState<Set<string>>(new Set());
  const [preparationBusy, setPreparationBusy] = useState(false);
  const [preloginPreparation, setPreloginPreparation] = useState<PreloginPreparation | null>(null);
  const [preloginWorkflow, setPreloginWorkflow] = useState<PreloginWorkflow | null>(null);
  const [preloginWorkflowWriterEnabled, setPreloginWorkflowWriterEnabled] = useState(false);
  const [preloginBatch, setPreloginBatch] = useState<PreloginBatch | null>(null);
  const preloginBatchRef = useRef<PreloginBatch | null>(null);
  const preloginBatchGenerationRef = useRef(0);
  const [preloginBatchHistory, setPreloginBatchHistory] = useState<PreloginBatch[]>([]);
  const [preloginTargetDraft, setPreloginTargetDraft] = useState<PreloginTargetDraft | null>(null);
  const [preloginTargetPreview, setPreloginTargetPreview] = useState<PreloginTargetPreview | null>(null);
  const [preloginNetworkConfigRevision, setPreloginNetworkConfigRevision] = useState(0);
  const [preloginBusy, setPreloginBusy] = useState(false);
  const [preloginError, setPreloginError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [plansPayload, assignmentsPayload] = await Promise.all([apiObject(`${path}/seat-plans`), apiObject(`${path}/seat-assignments`)]);
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
    const next: AssignmentWorkspace = {
      eventRevision: positiveInteger(event.revision, '考试活动'),
      eventType,
      eventLifecycle,
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
      !displayedAssignment &&
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
    setWorkspace(next);
    const latest = next.assignments[0];
    setDraft(latest?.schemaVersion === 1 ? latest.assignments.map((row) => ({ ...row })) : []);
    setLocked(new Set(latest?.schemaVersion === 1 ? latest.constraints.lockedAssignments.map((row) => row.boundUserId) : []));
    setSelectedUid(null);
    setActionDiagnostics([]);
  }, [path]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
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
      setError(null);
      setActionDiagnostics([]);
      try {
        const result = await post(`${path}/seat-assignments`, body);
        if (Object.hasOwn(result, 'assignment')) {
          if (result.assignment === null) {
            setActionDiagnostics(array(result.diagnostics, '分配诊断').map(parseDiagnostic));
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

  const loadPreparationClassroom = useCallback(
    async (classroomId: string) => {
      setSelectedClassroomId(classroomId);
      setPreparationSeats([]);
      setSelectedCandidateSeatIds(new Set());
      if (!classroomId) return;
      setPreparationBusy(true);
      setError(null);
      try {
        const payload = await apiObject(
          `/api/admin/exam-events/${encodeURIComponent(eventId)}/seat-assignment-classrooms/${encodeURIComponent(classroomId)}`,
        );
        if (text(payload.classroomId, '教室座位') !== classroomId) throw new Error('教室座位响应身份不一致');
        const summary = workspace?.classrooms.find((classroom) => classroom.classroomId === classroomId);
        if (!summary || integer(payload.layoutRevision, '教室座位') !== summary.layoutRevision) throw new Error('教室布局已变化，请刷新后重试');
        text(payload.layoutFingerprint, '教室座位');
        const seats = array(payload.seats, '教室座位').map((item) => parseSeat(item, classroomId));
        setPreparationSeats(seats);
        setSelectedCandidateSeatIds(
          new Set(seats.filter((seat) => (seat.status === 'active' || seat.status === 'empty') && seat.bindingId).map((seat) => seat.sourceSeatId)),
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setPreparationBusy(false);
      }
    },
    [eventId, workspace],
  );

  const latest = workspace?.assignments[0] || null;
  const latestPlan = workspace?.seatPlans[0] || null;
  const v2ReadOnly = latest?.schemaVersion === 2 || latestPlan?.schemaVersion === 2;
  const latestV1 = !v2ReadOnly && latest?.schemaVersion === 1 ? latest : null;
  const latestPlanV1 = !v2ReadOnly && latestPlan?.schemaVersion === 1 ? latestPlan : null;
  const latestPlanCurrent = workspace?.latestSeatPlanState === 'current';
  const rosterRef = latest?.roster || latestPlan?.roster || null;
  const roster = rosterRef
    ? workspace?.rosterRevisions.find(
        (item) => item.rosterId === rosterRef.rosterId && item.revision === rosterRef.revision && item.fingerprint === rosterRef.fingerprint,
      ) || null
    : null;
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
      return latest.assignments.map((mapping) => {
        const participant = latest.participants.find((item) => item.boundUserId === mapping.boundUserId);
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
  }, [draft, latest, latestPlan, roster, v1SeatById]);

  const swap = (firstUid: number, secondUid: number) => {
    if (firstUid === secondUid) return;
    setDraft((current) => {
      const first = current.find((row) => row.boundUserId === firstUid);
      const second = current.find((row) => row.boundUserId === secondUid);
      if (!first || !second) return current;
      return current.map((row) => {
        if (row.boundUserId === firstUid) return { ...row, sourceSeatId: second.sourceSeatId };
        if (row.boundUserId === secondUid) return { ...row, sourceSeatId: first.sourceSeatId };
        return row;
      });
    });
  };

  const selectForSwap = (uid: number) => {
    if (selectedUid === null) setSelectedUid(uid);
    else {
      swap(selectedUid, uid);
      setSelectedUid(null);
    }
  };

  const assignSeat = (uid: number, sourceSeatId: string) => {
    const occupant = draft.find((row) => row.sourceSeatId === sourceSeatId);
    if (occupant && occupant.boundUserId !== uid) {
      swap(uid, occupant.boundUserId);
      return;
    }
    if (!occupant) {
      setDraft((current) => current.map((row) => (row.boundUserId === uid ? { ...row, sourceSeatId } : row)));
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
  const canonicalLockedUids = latestV1?.constraints.lockedAssignments.map((row) => row.boundUserId).sort((a, b) => a - b) || [];
  const currentLockedUids = [...locked].sort((a, b) => a - b);
  const dirty = Boolean(
    latestV1 &&
    (JSON.stringify(draft) !== JSON.stringify(latestV1.assignments) || JSON.stringify(currentLockedUids) !== JSON.stringify(canonicalLockedUids)),
  );
  const diagnostics = actionDiagnostics.length ? actionDiagnostics : latestV1?.diagnostics || latestPlan?.diagnostics || [];
  const eligibleSeats = latestV1 ? seats.filter((seat) => latestV1.eligibleSeatIds.includes(seat.sourceSeatId)) : [];
  const selectedStudent = selectedUid === null ? null : rows.find((row) => row.boundUserId === selectedUid) || null;
  const latestRosterForPlan = workspace?.rosterRevisions[0] || null;
  const selectedClassroom = workspace?.classrooms.find((classroom) => classroom.classroomId === selectedClassroomId) || null;
  const publishedAssignment =
    workspace?.assignments.find((assignment): assignment is AssignmentV1Revision => assignment.published && assignment.schemaVersion === 1) || null;
  const publishedV2Assignment =
    workspace?.assignments.find((assignment): assignment is AssignmentV2Revision => assignment.published && assignment.schemaVersion === 2) || null;
  const publishedRoster = publishedAssignment
    ? workspace?.rosterRevisions.find(
        (item) =>
          item.rosterId === publishedAssignment.roster.rosterId &&
          item.revision === publishedAssignment.roster.revision &&
          item.fingerprint === publishedAssignment.roster.fingerprint,
      ) || null
    : null;
  const currentPublicationAlreadyConfirmed = Boolean(
    preloginBatch?.state === 'dispatched' &&
    publishedAssignment &&
    preloginBatch.assignment.assignmentId === publishedAssignment.assignmentId &&
    preloginBatch.assignment.revision === publishedAssignment.revision &&
    preloginBatch.assignment.fingerprint === publishedAssignment.fingerprint &&
    preloginBatch.publicationRevision === workspace?.publicationRevision,
  );

  const loadPreloginFacts = useCallback(async () => {
    if (!publishedAssignment || workspace?.eventType !== 'krypton') throw new Error('当前考试不支持预登录');
    const payload = await post(`${path}/prelogin/prepare`, { assignmentRevision: publishedAssignment.revision });
    const preparation = parsePreloginPreparation(payload.preparation, eventId);
    const workflow = parsePreloginWorkflow(payload.workflow);
    const writerEnabled = boolean(payload.workflowWriterEnabled, '预登录兼容写入门禁');
    if (
      preparation.assignment.assignmentId !== publishedAssignment.assignmentId ||
      preparation.assignment.revision !== publishedAssignment.revision ||
      preparation.assignment.fingerprint !== publishedAssignment.fingerprint ||
      preparation.publicationRevision !== workspace.publicationRevision
    ) {
      throw new Error('预登录预检与当前发布分配不一致');
    }
    setPreloginPreparation(preparation);
    setPreloginWorkflow(workflow);
    setPreloginWorkflowWriterEnabled(writerEnabled);
    return { preparation, workflow };
  }, [eventId, path, publishedAssignment, workspace]);

  const loadPreloginTargetDraft = useCallback(async (): Promise<PreloginTargetDraft | null> => {
    const [payload, configPayload] = await Promise.all([apiObject(`${path}/target-assignment`), apiObject(`${path}/network-config`)]);
    if (configPayload.config === null) setPreloginNetworkConfigRevision(0);
    else setPreloginNetworkConfigRevision(nonNegativeInteger(record(configPayload.config, '预登录网络配置').revision, '预登录网络配置'));
    if (payload.assignment === null) {
      setPreloginTargetDraft(null);
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
    return next;
  }, [path]);

  const savePublishedAssignmentAsTarget = useCallback(async () => {
    if (!publishedAssignment) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      const current = preloginTargetDraft || (await loadPreloginTargetDraft());
      if (current?.sourceAssignmentId === publishedAssignment.assignmentId) return;
      await post(`${path}/target-assignment`, {
        action: 'saveDraft',
        expectedRevision: current?.revision || 0,
        sources: [{ kind: 'examSeat', ids: [publishedAssignment.assignmentId] }],
      });
      setPreloginTargetPreview(null);
      await loadPreloginTargetDraft();
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginTargetDraft, path, preloginTargetDraft, publishedAssignment]);

  const previewPreloginTarget = useCallback(async () => {
    if (!preloginTargetDraft) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      const payload = await post(`${path}/target-assignment`, { action: 'preview', expectedRevision: preloginTargetDraft.revision });
      const preview = record(payload.preview, '目标预览');
      const endpointIds = array(preview.endpointIds, '目标预览').map((value) => text(value, '目标预览'));
      setPreloginTargetPreview({
        fingerprint: fingerprint(preview.previewFingerprint, '目标预览'),
        targetCount: positiveInteger(preview.targetCount, '目标预览'),
        endpointIds,
        addedEndpointIds: array(preview.addedEndpointIds, '目标预览').map((value) => text(value, '目标预览')),
        removedEndpointIds: array(preview.removedEndpointIds, '目标预览').map((value) => text(value, '目标预览')),
      });
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [path, preloginTargetDraft]);

  const publishPreloginTarget = useCallback(async () => {
    if (!preloginTargetDraft || !preloginTargetPreview) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      await post(`${path}/target-assignment`, {
        action: 'publish',
        expectedRevision: preloginTargetDraft.revision,
        confirmationFingerprint: preloginTargetPreview.fingerprint,
      });
      setPreloginTargetPreview(null);
      await loadPreloginTargetDraft();
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginTargetDraft, path, preloginTargetDraft, preloginTargetPreview]);

  const assignPreloginTarget = useCallback(async () => {
    if (!preloginTargetDraft?.latestPublishedRevision) return;
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      await post(`${path}/network-config`, {
        action: 'assignTarget',
        expectedRevision: preloginNetworkConfigRevision,
        assignmentId: preloginTargetDraft.assignmentId,
        revision: preloginTargetDraft.latestPublishedRevision,
      });
      await loadPreloginFacts();
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts, path, preloginNetworkConfigRevision, preloginTargetDraft]);

  const preparePrelogin = useCallback(async () => {
    setPreloginBusy(true);
    setPreloginError(null);
    try {
      await loadPreloginFacts();
    } catch (reason) {
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts]);

  const startPreloginNetwork = useCallback(async () => {
    if (!preloginWorkflow || preloginWorkflow.network.source !== 'config' || preloginWorkflow.network.configRevision === null) return;
    setPreloginBusy(true);
    setPreloginError(null);
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
      setPreloginError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreloginBusy(false);
    }
  }, [loadPreloginFacts, path, preloginWorkflow]);

  const confirmPrelogin = useCallback(async () => {
    if (
      !publishedAssignment ||
      !preloginPreparation ||
      !preloginWorkflow ||
      preloginWorkflow.network.source !== 'execution' ||
      !preloginWorkflow.network.ready ||
      preloginWorkflow.hardErrorCount > 0 ||
      !preloginWorkflowWriterEnabled ||
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
        assignmentRevision: publishedAssignment.revision,
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
    preloginPreparation,
    preloginWorkflow,
    preloginWorkflowWriterEnabled,
    publishedAssignment,
    resumeDispatchingPrelogin,
    writePreloginUrl,
  ]);

  const retryFailedPrelogin = useCallback(async () => {
    if (!preloginBatch?.projection) return;
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
  }, [acceptPreloginBatch, eventId, loadPreloginBatch, path, preloginBatch, writePreloginUrl]);

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
        <Card>
          <CardHeader>
            <CardTitle>准备名单与候选座位</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">这里只追加不可变名单与候选范围；不会自动生成、发布或修改长期终端绑定。</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <label className="text-sm font-medium" htmlFor="seat-roster-source">
                  名单来源
                </label>
                <select
                  id="seat-roster-source"
                  aria-label="名单来源"
                  value={sourceKind}
                  onChange={(event) => setSourceKind(event.target.value as 'contestAudience' | 'userbindGroups' | 'userbindSchool')}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                >
                  <option value="userbindGroups">指定 userbind 用户组</option>
                  <option value="userbindSchool">当前学校全部学生</option>
                  {workspace?.eventType === 'krypton' ? <option value="contestAudience">关联比赛受众</option> : null}
                </select>
                {sourceKind === 'userbindGroups' ? (
                  <div className="max-h-40 space-y-1 overflow-auto rounded-md bg-muted/30 p-2">
                    {workspace?.rosterGroups.map((group) => (
                      <label key={group.groupId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
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
                  disabled={preparationBusy || busy || dirty || (sourceKind === 'userbindGroups' && !selectedGroupIds.size)}
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
              <div className="space-y-2 rounded-md border p-3">
                <label className="text-sm font-medium" htmlFor="seat-plan-classroom">
                  候选教室
                </label>
                <select
                  id="seat-plan-classroom"
                  aria-label="候选教室"
                  value={selectedClassroomId}
                  onChange={(event) => void loadPreparationClassroom(event.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                >
                  <option value="">请选择同校教室</option>
                  {workspace?.classrooms.map((classroom) => (
                    <option key={classroom.classroomId} value={classroom.classroomId}>
                      {classroom.name} · layout r{classroom.layoutRevision} · {classroom.seatCount} 座
                    </option>
                  ))}
                </select>
                {preparationSeats.length ? (
                  <div className="max-h-40 grid gap-1 overflow-auto rounded-md bg-muted/30 p-2 sm:grid-cols-2">
                    {preparationSeats.map((seat) => {
                      const available = (seat.status === 'active' || seat.status === 'empty') && Boolean(seat.bindingId);
                      return (
                        <label key={seat.sourceSeatId} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            disabled={!available}
                            checked={selectedCandidateSeatIds.has(seat.sourceSeatId)}
                            onChange={(event) =>
                              setSelectedCandidateSeatIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(seat.sourceSeatId);
                                else next.delete(seat.sourceSeatId);
                                return next;
                              })
                            }
                          />
                          {seat.label} · {seat.sourceSeatId} {!available ? '（不可用）' : ''}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                <Button
                  variant="outline"
                  disabled={
                    preparationBusy ||
                    busy ||
                    dirty ||
                    latestPlan?.schemaVersion === 2 ||
                    !latestRosterForPlan ||
                    !selectedClassroom ||
                    !selectedCandidateSeatIds.size
                  }
                  onClick={() =>
                    selectedClassroom &&
                    latestRosterForPlan &&
                    executeSeatPlan({
                      action: 'createSeatPlan',
                      rosterRevision: latestRosterForPlan.revision,
                      classroomId: selectedClassroom.classroomId,
                      layoutRevision: selectedClassroom.layoutRevision,
                      candidateSeatIds: [...selectedCandidateSeatIds].sort(),
                    })
                  }
                >
                  创建候选座位计划
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>生成与发布</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {v2ReadOnly ? (
              <p className="w-full rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                当前为跨教室座位协议 v2。本阶段仅开放历史查看与导出；生成、人工调整、发布和预登录将在后续阶段统一启用。
              </p>
            ) : null}
            {workspace?.latestSeatPlanState === 'layout-drift' ? (
              <p className="w-full text-sm text-amber-700">候选教室布局已变化；请在上方按当前布局创建新计划后再生成。</p>
            ) : null}
            <Button
              disabled={busy || dirty || !latestPlanV1?.roster || !latestPlanCurrent}
              onClick={() => latestPlanV1 && execute({ action: 'generate', mode: 'random', seatPlanRevision: latestPlanV1.revision })}
            >
              <Shuffle className="size-4" /> 随机分配
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !latestPlanV1?.roster || !latestPlanCurrent}
              onClick={() => latestPlanV1 && execute({ action: 'generate', mode: 'studentId', seatPlanRevision: latestPlanV1.revision })}
            >
              按学号分配
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !latestV1}
              onClick={() => latestV1 && execute({ action: 'rerandomize', baseAssignmentRevision: latestV1.revision })}
            >
              <RefreshCw className="size-4" /> 重新随机未锁定座位
            </Button>
            <Button
              variant="outline"
              disabled={busy || !latestV1 || !dirty}
              onClick={() =>
                latestV1 &&
                execute({
                  action: 'adjust',
                  baseAssignmentRevision: latestV1.revision,
                  lockedUids: [...locked].sort((a, b) => a - b),
                  mappings: draft,
                })
              }
            >
              <Save className="size-4" /> 保存人工调整
            </Button>
            <Button
              disabled={busy || dirty || !latestV1}
              onClick={() =>
                latestV1 &&
                execute({
                  action: 'publish',
                  assignmentRevision: latestV1.revision,
                  expectedPublicationRevision: workspace?.publicationRevision || 0,
                })
              }
            >
              <Upload className="size-4" /> {latestV1 ? `发布版本 ${latestV1.revision}` : '发布'}
            </Button>
            <Button variant="ghost" disabled={!latest || dirty} onClick={exportCurrent}>
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

        <Card>
          <CardHeader>
            <CardTitle>终端预检与预登录</CardTitle>
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
            ) : publishedV2Assignment ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                已发布跨教室座位分配 r{publishedV2Assignment.revision}。P2.11 仅保证 v2 历史可读；终端预检、网络目标和预登录将在 P2.14
                接入前保持禁用。
              </div>
            ) : !publishedAssignment ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                请先发布一份座位分配；终端预检不会使用最新未发布草稿。
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">名单 r{publishedAssignment.roster.revision}</Badge>
                  <Badge variant="outline">分配 r{publishedAssignment.revision}</Badge>
                  <Badge variant="outline">发布 r{workspace?.publicationRevision || 0}</Badge>
                  {preloginWorkflow ? <Badge variant="outline">策略 r{preloginWorkflow.network.policy.revision}</Badge> : null}
                  {preloginWorkflow ? <Badge variant="outline">目标 r{preloginWorkflow.network.target.revision}</Badge> : null}
                  {preloginBatch ? <Badge variant="outline">批次 r{preloginBatch.revision}</Badge> : null}
                  {preloginBatch?.projection ? <Badge variant="outline">投影 r{preloginBatch.projection.projectionRevision}</Badge> : null}
                </div>
                <p className="font-mono text-xs text-muted-foreground">发布 assignment {publishedAssignment.assignmentId}</p>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium">同页配置预登录目标</p>
                  <p className="mt-1 text-xs text-muted-foreground">每一步仍需显式点击；不会自动发布目标或启动网络。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={preloginBusy || dirty || preloginTargetDraft?.sourceAssignmentId === publishedAssignment.assignmentId}
                      onClick={() => void savePublishedAssignmentAsTarget()}
                    >
                      1. 保存当前分配为目标
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={preloginBusy || dirty || preloginTargetDraft?.sourceAssignmentId !== publishedAssignment.assignmentId}
                      onClick={() => void previewPreloginTarget()}
                    >
                      2. 重新解析目标
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={preloginBusy || dirty || !preloginTargetPreview}
                      onClick={() => void publishPreloginTarget()}
                    >
                      3. 发布目标快照
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        preloginBusy ||
                        dirty ||
                        !preloginTargetDraft?.latestPublishedRevision ||
                        preloginTargetDraft.latestPublishedSourceAssignmentId !== publishedAssignment.assignmentId
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
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={preloginBusy || dirty} onClick={() => void preparePrelogin()}>
                    {preloginBusy ? <RefreshCw className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />} 运行终端预检
                  </Button>
                  {preloginWorkflow?.network.source === 'config' ? (
                    <Button disabled={preloginBusy || dirty} onClick={() => void startPreloginNetwork()}>
                      <Play className="size-4" /> 启动网络策略
                    </Button>
                  ) : null}
                  <Button
                    disabled={
                      preloginBusy ||
                      dirty ||
                      !preloginPreparation ||
                      !preloginWorkflow ||
                      preloginWorkflow.network.source !== 'execution' ||
                      !preloginWorkflow.network.ready ||
                      preloginWorkflow.hardErrorCount > 0 ||
                      !preloginWorkflowWriterEnabled ||
                      currentPublicationAlreadyConfirmed
                    }
                    onClick={() => void confirmPrelogin()}
                  >
                    <Play className="size-4" /> 确认预登录
                  </Button>
                </div>
                {preloginPreparation && !preloginWorkflowWriterEnabled ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                    当前处于 P2.9 兼容读取阶段，确认写入尚未启用。请先完成旧批次兼容验证，再由管理员启用 exam.preloginWorkflowWriterEnabled。
                  </p>
                ) : null}
                {preloginError ? (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {preloginError}
                  </p>
                ) : null}
                {preloginWorkflow && preloginPreparation ? (
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
                            const diagnosticCodes = item.diagnostics.map((diagnostic) => diagnostic.code);
                            return (
                              <TableRow key={item.uid}>
                                <TableCell>
                                  <div className="font-medium">{student?.studentId || `UID ${item.uid}`}</div>
                                  <div className="text-xs text-muted-foreground">{student?.realName || item.studentRecordId}</div>
                                </TableCell>
                                <TableCell>
                                  <div>{item.sourceSeatId}</div>
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
                                  {diagnosticCodes.length ? <div className="mt-1 text-xs text-destructive">{diagnosticCodes.join('、')}</div> : null}
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
                    <Button
                      variant="outline"
                      disabled={preloginBusy || !preloginBatch.projection || (!preloginBatch.retryableTicketIds.length && !pendingRetryIdentity)}
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
                            const student = publishedRosterByUid.get(subject.uid);
                            const result = projectionByTicket.get(subject.ticketId);
                            const succeeded = result?.status === 'applied' && result.stage === 'page_ready';
                            return (
                              <TableRow key={subject.ticketId}>
                                <TableCell>{student ? `${student.studentId} · ${student.realName}` : `UID ${subject.uid}`}</TableCell>
                                <TableCell>
                                  <div>{subject.sourceSeatId}</div>
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
                <Button size="sm" variant="ghost" disabled={preloginBusy} onClick={() => void loadPreloginBatchHistory()}>
                  查看历史批次
                </Button>
                {preloginBatchHistory.length ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="font-medium">历史预登录批次</p>
                    {preloginBatchHistory.map((batch) => (
                      <button
                        key={batch.batchId}
                        type="button"
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/30"
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
            <CardTitle>学生与实体座位</CardTitle>
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
            {selectedStudent && latestV1 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
                <span className="text-sm">为 {selectedStudent.realName} 指定座位</span>
                <select
                  aria-label={`为${selectedStudent.realName}指定座位`}
                  value={selectedStudent.sourceSeatId}
                  onChange={(event) => {
                    assignSeat(selectedStudent.boundUserId, event.target.value);
                    setSelectedUid(null);
                  }}
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                >
                  {eligibleSeats.map((candidate) => (
                    <option key={candidate.sourceSeatId} value={candidate.sourceSeatId}>
                      {candidate.label} · {candidate.sourceSeatId}
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
                  const seat = seatByIdentity.get(seatIdentityKey({ classroomId: row.classroomId, sourceSeatId: row.sourceSeatId }));
                  const endpoint = row.endpointId ? preflightByEndpoint.get(row.endpointId) : null;
                  return (
                    <TableRow
                      key={row.boundUserId}
                      draggable={Boolean(latestV1)}
                      onDragStart={() => latestV1 && setSelectedUid(row.boundUserId)}
                      onDragOver={(event) => latestV1 && event.preventDefault()}
                      onDrop={() => {
                        if (!latestV1 || selectedUid === null) return;
                        swap(selectedUid, row.boundUserId);
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
                          {row.classroomId ? `${row.classroomId} · ` : ''}
                          {row.sourceSeatId || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{row.endpointId || '未绑定'}</div>
                        <div className="text-xs text-muted-foreground">{seat?.bindingRevision ? `绑定 r${seat.bindingRevision}` : '-'}</div>
                      </TableCell>
                      <TableCell>
                        {endpoint ? (
                          <Badge variant={endpoint.online ? 'default' : 'destructive'}>{endpoint.online ? '在线' : '离线'}</Badge>
                        ) : (
                          <Badge variant="outline">未知</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {latestV1 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={selectedUid === row.boundUserId ? 'default' : 'outline'}
                              aria-label={`选择${row.realName}换位`}
                              onClick={() => selectForSwap(row.boundUserId)}
                            >
                              <GripVertical className="size-4" /> 换位
                            </Button>
                            <label className="inline-flex items-center gap-1 text-sm">
                              <input
                                type="checkbox"
                                aria-label={`锁定${row.realName}`}
                                checked={locked.has(row.boundUserId)}
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
                        ) : (
                          <Badge variant="outline">v2 历史只读</Badge>
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
