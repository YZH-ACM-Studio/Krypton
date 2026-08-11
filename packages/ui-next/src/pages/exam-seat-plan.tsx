import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, GripVertical, LockKeyhole, RefreshCw, Save, Shuffle, Upload } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

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

interface SeatPlanRevision {
  seatPlanId: string;
  revision: number;
  roster: { rosterId: string; revision: number; fingerprint: string } | null;
  classroomId: string;
  layoutRevision: number;
  layoutFingerprint: string;
  fingerprint: string;
  candidateSeatIds: string[];
  diagnostics: AssignmentDiagnostic[];
}

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

interface AssignmentRevision {
  assignmentId: string;
  revision: number;
  seatPlan: { seatPlanId: string; revision: number; fingerprint: string };
  roster: { rosterId: string; revision: number; fingerprint: string };
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

interface PhysicalSeat {
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
  eventType: 'krypton' | 'external';
  rosterRevisions: RosterRevision[];
  seatPlans: SeatPlanRevision[];
  assignments: AssignmentRevision[];
  publicationRevision: number;
  source: { seatPlanRevision: number; seats: PhysicalSeat[] } | null;
  endpointState: 'available' | 'not-required' | 'unavailable';
  endpointItems: EndpointPreflightItem[];
  latestSeatPlanState: 'current' | 'layout-drift' | 'not-ready';
  rosterGroups: Array<{ groupId: string; name: string }>;
  classrooms: Array<{ classroomId: string; name: string; layoutRevision: number; seatCount: number }>;
}

export interface AssignmentCsvRow {
  boundUserId: number;
  studentId: string;
  realName: string;
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

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function parseMapping(value: unknown): AssignmentMapping {
  const row = record(value, '座位映射');
  return { boundUserId: integer(row.boundUserId, '座位映射'), sourceSeatId: text(row.sourceSeatId, '座位映射') };
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
  const roster = row.roster === null ? null : record(row.roster, '座位计划名单');
  return {
    seatPlanId: text(row.seatPlanId, '座位计划'),
    revision: integer(row.revision, '座位计划'),
    roster: roster
      ? {
          rosterId: text(roster.rosterId, '座位计划名单'),
          revision: integer(roster.revision, '座位计划名单'),
          fingerprint: text(roster.fingerprint, '座位计划名单'),
        }
      : null,
    classroomId: text(row.classroomId, '座位计划'),
    layoutRevision: integer(row.layoutRevision, '座位计划'),
    layoutFingerprint: text(row.layoutFingerprint, '座位计划'),
    fingerprint: text(row.fingerprint, '座位计划'),
    candidateSeatIds: array(row.candidateSeatIds, '座位计划').map((item) => text(item, '座位计划')),
    diagnostics: array(row.diagnostics, '座位计划').map(parseDiagnostic),
  };
}

function parseAssignment(value: unknown): AssignmentRevision {
  const row = record(value, '分配版本');
  const seatPlan = record(row.seatPlan, '分配座位计划');
  const roster = record(row.roster, '分配名单');
  const constraints = record(row.constraints, '分配约束');
  const mode = text(constraints.mode, '分配约束');
  if (mode !== 'random' && mode !== 'studentId') throw new Error('分配约束响应格式不正确');
  if (typeof row.published !== 'boolean') throw new Error('分配版本响应格式不正确');
  return {
    assignmentId: text(row.assignmentId, '分配版本'),
    revision: integer(row.revision, '分配版本'),
    seatPlan: {
      seatPlanId: text(seatPlan.seatPlanId, '分配座位计划'),
      revision: integer(seatPlan.revision, '分配座位计划'),
      fingerprint: text(seatPlan.fingerprint, '分配座位计划'),
    },
    roster: {
      rosterId: text(roster.rosterId, '分配名单'),
      revision: integer(roster.revision, '分配名单'),
      fingerprint: text(roster.fingerprint, '分配名单'),
    },
    constraints: {
      mode,
      lockedAssignments: array(constraints.lockedAssignments, '分配约束').map(parseMapping),
      manualAssignments: array(constraints.manualAssignments, '分配约束').map(parseMapping),
    },
    eligibleSeatIds: array(row.eligibleSeatIds, '分配版本').map((item) => text(item, '分配版本')),
    assignments: array(row.assignments, '分配版本').map(parseMapping),
    diagnostics: array(row.diagnostics, '分配版本').map(parseDiagnostic),
    fingerprint: text(row.fingerprint, '分配版本'),
    published: row.published,
  };
}

function parseSeat(value: unknown): PhysicalSeat {
  const row = record(value, '实体座位');
  return {
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
    const next: AssignmentWorkspace = {
      eventType,
      rosterRevisions: array(plansPayload.rosterRevisions, '名单版本').map(parseRoster),
      seatPlans: array(plansPayload.seatPlans, '座位计划').map(parseSeatPlan),
      assignments: array(assignmentsPayload.assignments, '分配版本').map(parseAssignment),
      publicationRevision: publication ? integer(publication.revision, '发布版本') : 0,
      source: source
        ? {
            seatPlanRevision: integer(source.seatPlanRevision, '分配来源'),
            seats: array(source.seats, '分配来源').map(parseSeat),
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
    setDraft(latest?.assignments.map((row) => ({ ...row })) || []);
    setLocked(new Set(latest?.constraints.lockedAssignments.map((row) => row.boundUserId) || []));
    setSelectedUid(null);
    setActionDiagnostics([]);
  }, [path]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

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
        const seats = array(payload.seats, '教室座位').map(parseSeat);
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
  const latestPlanCurrent = workspace?.latestSeatPlanState === 'current';
  const rosterRef = latest?.roster || latestPlan?.roster || null;
  const roster = rosterRef
    ? workspace?.rosterRevisions.find(
        (item) => item.rosterId === rosterRef.rosterId && item.revision === rosterRef.revision && item.fingerprint === rosterRef.fingerprint,
      ) || null
    : null;
  const seats = workspace?.source?.seats || [];
  const seatById = useMemo(() => new Map(seats.map((seat) => [seat.sourceSeatId, seat])), [seats]);
  const preflightByEndpoint = useMemo(() => new Map((workspace?.endpointItems || []).map((item) => [item.endpointId, item])), [workspace]);

  const rows = useMemo<AssignmentCsvRow[]>(() => {
    if (!roster) return [];
    const mappingByUid = new Map(draft.map((row) => [row.boundUserId, row.sourceSeatId]));
    return roster.entries.map((entry) => {
      const sourceSeatId = mappingByUid.get(entry.boundUserId) || '';
      const seat = seatById.get(sourceSeatId);
      return {
        ...entry,
        sourceSeatId,
        seatLabel: seat?.label || '',
        endpointId: seat?.endpointId || '',
      };
    });
  }, [draft, roster, seatById]);

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
    const blob = new Blob([`\uFEFF${assignmentCsv(rows, latest.revision)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `exam-seat-assignment-${eventId}-r${latest.revision}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = rows.filter((row) =>
    `${row.studentId} ${row.realName} ${row.seatLabel} ${row.sourceSeatId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const canonicalLockedUids = latest?.constraints.lockedAssignments.map((row) => row.boundUserId).sort((a, b) => a - b) || [];
  const currentLockedUids = [...locked].sort((a, b) => a - b);
  const dirty = Boolean(
    latest &&
    (JSON.stringify(draft) !== JSON.stringify(latest.assignments) || JSON.stringify(currentLockedUids) !== JSON.stringify(canonicalLockedUids)),
  );
  const diagnostics = actionDiagnostics.length ? actionDiagnostics : latest?.diagnostics || latestPlan?.diagnostics || [];
  const eligibleSeats = latest ? seats.filter((seat) => latest.eligibleSeatIds.includes(seat.sourceSeatId)) : [];
  const selectedStudent = selectedUid === null ? null : rows.find((row) => row.boundUserId === selectedUid) || null;
  const latestRosterForPlan = workspace?.rosterRevisions[0] || null;
  const selectedClassroom = workspace?.classrooms.find((classroom) => classroom.classroomId === selectedClassroomId) || null;

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
                  disabled={preparationBusy || busy || dirty || !latestRosterForPlan || !selectedClassroom || !selectedCandidateSeatIds.size}
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
            {workspace?.latestSeatPlanState === 'layout-drift' ? (
              <p className="w-full text-sm text-amber-700">候选教室布局已变化；请在上方按当前布局创建新计划后再生成。</p>
            ) : null}
            <Button
              disabled={busy || dirty || !latestPlan?.roster || !latestPlanCurrent}
              onClick={() => latestPlan && execute({ action: 'generate', mode: 'random', seatPlanRevision: latestPlan.revision })}
            >
              <Shuffle className="size-4" /> 随机分配
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !latestPlan?.roster || !latestPlanCurrent}
              onClick={() => latestPlan && execute({ action: 'generate', mode: 'studentId', seatPlanRevision: latestPlan.revision })}
            >
              按学号分配
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !latest}
              onClick={() => latest && execute({ action: 'rerandomize', baseAssignmentRevision: latest.revision })}
            >
              <RefreshCw className="size-4" /> 重新随机未锁定座位
            </Button>
            <Button
              variant="outline"
              disabled={busy || !latest || !dirty}
              onClick={() =>
                latest &&
                execute({ action: 'adjust', baseAssignmentRevision: latest.revision, lockedUids: [...locked].sort((a, b) => a - b), mappings: draft })
              }
            >
              <Save className="size-4" /> 保存人工调整
            </Button>
            <Button
              disabled={busy || dirty || !latest}
              onClick={() =>
                latest &&
                execute({ action: 'publish', assignmentRevision: latest.revision, expectedPublicationRevision: workspace?.publicationRevision || 0 })
              }
            >
              <Upload className="size-4" /> {latest ? `发布版本 ${latest.revision}` : '发布'}
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
            {selectedStudent ? (
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
                  const seat = seatById.get(row.sourceSeatId);
                  const endpoint = row.endpointId ? preflightByEndpoint.get(row.endpointId) : null;
                  return (
                    <TableRow
                      key={row.boundUserId}
                      draggable
                      onDragStart={() => setSelectedUid(row.boundUserId)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (selectedUid === null) return;
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
                        <div className="text-xs text-muted-foreground">{row.sourceSeatId || '-'}</div>
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
  if (!bs.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = record(bs.page.data, '考试座位页面');
  const eventId = text(data.eventId, '考试座位页面');
  if (!eventId) throw new Error('考试座位页面响应格式不正确');
  return <SeatAssignmentWorkspace eventId={eventId} />;
}
