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
  status: string;
  began_at: string;
  closed_at: string | null;
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
export async function sendProctorCommand(
  machineId: string, command: string, payload: Record<string, any> = {},
): Promise<any> {
  return await vigilFetch(`/api/clients/${machineId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ command, payload }),
  });
}
