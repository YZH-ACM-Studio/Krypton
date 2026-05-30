/**
 * Typed Vigil dashboard client. Calls Vigil server's REST endpoints.
 *
 * Token + base URL come from OJ's `/api/admin/vigil/dashboard-token` (see
 * packages/hydrooj/src/handler/vigil-integration.ts:VigilDashboardTokenHandler).
 * We fetch a short-lived token on first use and cache it for the page session.
 *
 * Error model:
 *   - `VigilOfflineError`: server unreachable, misconfigured, or returning
 *     non-JSON (e.g. OJ SPA fallback HTML when the path is wrong). Pages
 *     should detect this and render a friendly "service offline" empty state
 *     INSTEAD of raw error text.
 *   - Other Error: real business error (4xx with parseable JSON body).
 */

export class VigilOfflineError extends Error {
  readonly reason: 'not_configured' | 'network' | 'non_json' | 'token_failed' | 'server_5xx';
  readonly detail?: string;
  constructor(reason: VigilOfflineError['reason'], detail?: string) {
    super(`Vigil offline: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'VigilOfflineError';
    this.reason = reason;
    this.detail = detail;
  }
}

interface DashboardTokenResponse {
  token: string;
  vigilBaseUrl: string;
  vigilWsUrl: string;
  expiresAt: number;
}

let cached: DashboardTokenResponse | null = null;

function looksLikeUrl(v: string | null | undefined): boolean {
  if (!v || typeof v !== 'string') return false;
  return /^https?:\/\//i.test(v.trim());
}

async function getToken(): Promise<DashboardTokenResponse> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  let res: Response;
  try {
    res = await fetch('/api/admin/vigil/dashboard-token', { credentials: 'include' });
  } catch (e: any) {
    throw new VigilOfflineError('token_failed', e?.message);
  }
  if (!res.ok) {
    throw new VigilOfflineError('token_failed', `HTTP ${res.status}`);
  }
  let data: DashboardTokenResponse;
  try {
    data = await res.json();
  } catch (e: any) {
    throw new VigilOfflineError('token_failed', 'non-JSON token response');
  }
  if (!looksLikeUrl(data?.vigilBaseUrl)) {
    throw new VigilOfflineError('not_configured', 'vigilBaseUrl is empty or invalid');
  }
  cached = data;
  return cached;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function vigilFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const tk = await getToken();
  const url = `${tk.vigilBaseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-KVS-Token': tk.token,
        ...(init.headers || {}),
      },
    });
  } catch (e: any) {
    // Reset cached token: maybe baseUrl changed.
    cached = null;
    throw new VigilOfflineError('network', e?.message);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Likely OJ fallback HTML — treat as offline.
    cached = null;
    throw new VigilOfflineError('non_json', `content-type=${contentType.slice(0, 40)}`);
  }

  if (res.status >= 500) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new VigilOfflineError('server_5xx', stripHtml(body));
  }

  if (!res.ok) {
    let bodyMsg = '';
    try {
      const j = await res.json();
      bodyMsg = j?.detail || j?.message || JSON.stringify(j);
    } catch {}
    throw new Error(`Vigil ${init.method || 'GET'} ${path}: ${res.status} ${bodyMsg.slice(0, 200)}`);
  }

  return await res.json();
}

// ─── Read APIs ────────────────────────────────────────────────────────────

export interface VigilClient {
  client_id: string;
  hostname?: string;
  status: string;
  last_seen_at: string;
  exam_session_id?: string;
}

export interface VigilEvent {
  event_id: string;
  client_id: string;
  exam_session_id?: string;
  category: string;
  severity: string;
  message: string;
  occurrence_count: number;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface VigilApproval {
  id: string;
  machine_id: string;
  oj_contest_id: string;
  student_id_input: string;
  real_name_input: string;
  matched_oj_user_id: number | null;
  is_unknown: boolean;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface VigilExamSession {
  id: string;
  machine_id: string;
  oj_user_id: number;
  oj_contest_id: string;
  oj_domain_id?: string;
  status: string;
  began_at: string;
  closed_at: string | null;
  close_reason?: string | null;
  is_temporary_user: boolean;
}

export async function fetchClients(): Promise<VigilClient[]> {
  return await vigilFetch<VigilClient[]>('/api/clients');
}
export async function fetchEvents(params: Record<string, string> = {}): Promise<VigilEvent[]> {
  const qs = new URLSearchParams(params).toString();
  return await vigilFetch(`/api/events${qs ? `?${qs}` : ''}`);
}
export async function fetchApprovals(): Promise<VigilApproval[]> {
  return await vigilFetch('/api/approvals');
}
export async function approveRequest(id: string, asTemporary: boolean): Promise<any> {
  return await vigilFetch(`/api/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ asTemporary }),
  });
}
export async function rejectRequest(id: string, reason: string): Promise<any> {
  return await vigilFetch(`/api/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
export async function fetchExamSessions(): Promise<VigilExamSession[]> {
  return await vigilFetch('/api/exam-sessions');
}
export async function invalidateExamSession(
  sessionId: string,
  reason: string,
  proctorOjUserId?: number,
): Promise<any> {
  return await vigilFetch(`/api/exam-sessions/${encodeURIComponent(sessionId)}/invalidate`, {
    method: 'POST',
    body: JSON.stringify({ reason, proctorOjUserId }),
  });
}
export async function resetStudentFinishSession(
  sessionId: string,
  proctorOjUserId?: number,
): Promise<any> {
  return await vigilFetch('/api/proctor/reset-student-finish', {
    method: 'POST',
    body: JSON.stringify({ sessionId, proctorOjUserId }),
  });
}
export async function sendProctorCommand(
  machineId: string, command: string, payload: Record<string, any> = {},
): Promise<any> {
  return await vigilFetch(`/api/clients/${machineId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ command, payload }),
  });
}

/* ─── Phase 1 monitoring extensions ────────────────────────────────────── */
/*
 * The endpoints below are served by vigil-server under
 *   /api/admin/vigil/proctor/*
 * and authenticated with the same dashboard token used by getToken().
 * They are referenced from the new "卡片墙 + 抽屉 + 直播" monitoring UI
 * (pages/vigil/*). The server-side implementation lands separately —
 * for now, these calls will surface VigilOfflineError until those routes ship.
 */

/** UI-friendly status enum surfaced to the card wall. */
export type VigilStudentStatus =
  | 'online'
  | 'anomaly'
  | 'offline'
  | 'disconnected'
  | 'locked'
  /** Terminal session (submitted/invalidated/closed/force_closed/transferred). */
  | 'ended';

/** Severity bands shared by the events / event_added stream / proctor UI. */
export type VigilEventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface VigilStudentCard {
  /** Stable per-machine identity used everywhere else in this API. */
  machineId: string;
  /** OJ uid resolved by the server when login_request matched a profile. */
  uid?: number;
  /** Display name (real name if available, otherwise login handle). */
  name: string;
  /** Student id (学号). */
  studentId?: string;
  /** Computed status — see §7.4 of CLIENT_PROCTOR_MONITORING_DESIGN. */
  status: VigilStudentStatus;
  /** When status === 'ended', the specific terminal reason in Chinese
   *  (已主动交卷 / 已作废 / 已换机 / 被强制结束 / 已结束). Null otherwise. */
  endedReason?: string | null;
  /** Most recent screenshot thumb URL (typed below, in case server omits). */
  recentScreenshotUrl?: string | null;
  /** ISO timestamp of the most recent screenshot. */
  recentScreenshotAt?: string | null;
  /** Cumulative number of (severity >= warning) events for this session. */
  eventCount: number;
  /** Wall-clock seconds since the student entered the exam. */
  examSeconds?: number;
  /** Last heartbeat from the client (ISO). */
  lastHeartbeat?: string | null;
  /** Stream state — drives the 屏/摄/录 toggles in the drawer. */
  streamState?: {
    screen?: 'started' | 'stopped' | 'failed';
    camera?: 'started' | 'stopped' | 'failed';
  };
  /** Whether DVR recording is enabled for this contest (mirrors contest field). */
  recordEnabled?: boolean;
  /** Locked metadata, when status = "locked". */
  lockedAt?: string | null;
  lockedBy?: number | null;
}

export interface VigilStudentListResponse {
  items: VigilStudentCard[];
  page: number;
  pageSize: number;
  total: number;
  /** Bucketed counters for the top stat banner. */
  counters: {
    online: number;
    anomaly: number;
    offline: number;
    disconnected: number;
    locked: number;
    ended: number;
    total: number;
  };
}

export interface VigilStudentEvent {
  eventId: string;
  machineId: string;
  type: string;
  severity: VigilEventSeverity;
  summary: string;
  payload?: Record<string, any>;
  count: number;
  firstTs: string;
  lastTs: string;
  ts: string;
  screenshotId?: string | null;
}

export interface VigilStudentScreenshot {
  screenshotId: string;
  machineId: string;
  url: string;
  thumbUrl: string;
  width?: number;
  height?: number;
  ts: string;
  reasonTag?: 'scheduled' | 'event' | 'command';
  eventId?: string | null;
  commandId?: string | null;
}

export interface VigilRecording {
  recordingId: string;
  machineId: string;
  uid?: number;
  streamType: 'screen' | 'camera';
  filename: string;
  url: string;
  size: number;
  durationMs: number;
  startTs: string;
  endTs: string;
}

export interface VigilAuditEntry {
  id: string;
  contestId: string;
  actor: { uid: number; displayName: string };
  targetMachineId?: string;
  targetUid?: number;
  command: string;
  payload?: any;
  reason?: string;
  ts: string;
  result: 'ok' | 'timeout' | 'client_offline' | 'error';
  errorMessage?: string;
  resultedAt?: string;
}

export interface ProctorCommandRequest {
  contestId: string;
  /** Single-target shortcut; mutually exclusive with `targetMachineIds`. */
  targetMachineId?: string;
  /** Group send. When set, server picks `targetMachineId` per recipient. */
  targetMachineIds?: string[];
  /** When sending a group message: filter on the *server* side instead. */
  audienceFilter?: 'all' | 'online' | 'anomaly';
  command: string;
  payload?: Record<string, any>;
  reason?: string;
  /** Actor metadata is filled in server-side from the token, but we accept
   *  an explicit override for tests. */
  actor?: { uid?: number; displayName?: string };
}

export interface ProctorCommandResponse {
  /** Per-target command id. For group sends this is a list, keyed by machineId. */
  commandId: string;
  /** Result is delivered async via WS `command_result`; HTTP just acknowledges. */
  accepted: number;
  rejected?: { machineId: string; reason: string }[];
}

export async function sendProctorCommandV2(
  body: ProctorCommandRequest,
): Promise<ProctorCommandResponse> {
  return await vigilFetch('/api/admin/vigil/proctor/commands', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ListStudentsParams {
  page?: number;
  pageSize?: number;
  /** Comma-joined status filter, e.g. "anomaly,offline". */
  status?: string;
  /** Free-text query against name + studentId. */
  q?: string;
  /** Server-side sort key; defaults to "status_priority". */
  sort?:
    | 'status_priority'
    | 'student_id'
    | 'name'
    | 'exam_time'
    | 'event_count';
}

export async function listContestStudents(
  contestId: string,
  params: ListStudentsParams = {},
): Promise<VigilStudentListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  const suffix = qs.toString() ? `?${qs}` : '';
  return await vigilFetch(
    `/api/admin/vigil/proctor/contests/${encodeURIComponent(contestId)}/students${suffix}`,
  );
}

export interface ListStudentEventsParams {
  /** ISO timestamp; only events with ts > since are returned. */
  since?: string;
  limit?: number;
}

export async function listStudentEvents(
  contestId: string,
  machineId: string,
  params: ListStudentEventsParams = {},
): Promise<VigilStudentEvent[]> {
  const qs = new URLSearchParams();
  if (params.since) qs.set('since', params.since);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return await vigilFetch(
    `/api/admin/vigil/proctor/contests/${encodeURIComponent(contestId)}/students/${encodeURIComponent(machineId)}/events${suffix}`,
  );
}

export interface ListStudentScreenshotsParams {
  since?: string;
  limit?: number;
}

export async function listStudentScreenshots(
  contestId: string,
  machineId: string,
  params: ListStudentScreenshotsParams = {},
): Promise<VigilStudentScreenshot[]> {
  const qs = new URLSearchParams();
  if (params.since) qs.set('since', params.since);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return await vigilFetch(
    `/api/admin/vigil/proctor/contests/${encodeURIComponent(contestId)}/students/${encodeURIComponent(machineId)}/screenshots${suffix}`,
  );
}

export async function listContestRecordings(
  contestId: string,
): Promise<VigilRecording[]> {
  return await vigilFetch(
    `/api/admin/vigil/proctor/contests/${encodeURIComponent(contestId)}/recordings`,
  );
}

export interface ListAuditParams {
  since?: string;
  limit?: number;
  command?: string;
  actor?: number;
}

export async function listContestAudit(
  contestId: string,
  params: ListAuditParams = {},
): Promise<VigilAuditEntry[]> {
  const qs = new URLSearchParams();
  if (params.since) qs.set('since', params.since);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.command) qs.set('command', params.command);
  if (params.actor) qs.set('actor', String(params.actor));
  const suffix = qs.toString() ? `?${qs}` : '';
  return await vigilFetch(
    `/api/admin/vigil/proctor/contests/${encodeURIComponent(contestId)}/audit${suffix}`,
  );
}

/**
 * Resolve the absolute thumb URL for a screenshot. Goes through the same
 * dashboard-token base so that mongo/file paths stay private.
 *
 * Falls back to `/api/admin/vigil/screenshots/{sid}/thumb` if vigilBaseUrl
 * is not yet cached (caller should ensure a `getToken()` happened first).
 */
export function vigilThumbUrl(screenshotId: string): string {
  const baseUrl = cached?.vigilBaseUrl || '';
  return `${baseUrl}/api/admin/vigil/screenshots/${encodeURIComponent(screenshotId)}/thumb`;
}

/** Absolute URL for the full-res screenshot file. */
export function vigilScreenshotUrl(screenshotId: string): string {
  const baseUrl = cached?.vigilBaseUrl || '';
  return `${baseUrl}/api/admin/vigil/screenshots/${encodeURIComponent(screenshotId)}/file`;
}

/**
 * Build the HLS m3u8 URL that the live player should load.
 *
 * The path goes via Caddy's `/vigil-hls/*` reverse proxy on the OJ host
 * (forward_auth → hydrooj check-hls-access), which then reaches SRS on
 * oj-vigil. See §4.4 of CLIENT_PROCTOR_MONITORING_DESIGN.
 */
export function buildHlsStreamUrl(
  contestId: string,
  machineId: string,
  streamType: 'screen' | 'camera',
  recordEnabled: boolean,
): string {
  // Caddy is configured on the same host that serves the OJ frontend, so a
  // *relative* URL is enough and dodges any cross-origin auth weirdness.
  const app = recordEnabled ? 'live-record' : 'live-nodvr';
  return `/vigil-hls/${app}/${encodeURIComponent(contestId)}_${encodeURIComponent(machineId)}_${streamType}.m3u8`;
}

/** Build the URL that the recording playback player should load. */
export function buildRecordingUrl(filename: string): string {
  return `/vigil-hls/recordings/${filename}`;
}

/**
 * Returns the currently cached dashboard token base URL — primarily so the
 * live-player can pre-warm the token before opening, since HLS.js fetches
 * happen outside our `vigilFetch` interceptor.
 */
export function getCachedVigilBaseUrl(): string | null {
  return cached?.vigilBaseUrl || null;
}

/** Force a token refresh on next call — used after token failure. */
export function invalidateVigilTokenCache(): void {
  cached = null;
}

/** Pre-fetch the dashboard token, e.g. before opening an HLS player. */
export async function ensureVigilToken(): Promise<string> {
  const tk = await getToken();
  return tk.token;
}
