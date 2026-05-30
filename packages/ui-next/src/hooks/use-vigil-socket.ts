/**
 * useVigilSocket — opens a WebSocket to Vigil's dashboard endpoint and
 * dispatches the typed message stream defined by the server.
 *
 * Message types (server → client):
 *   - { type: 'snapshot', clients, recent_events, recent_commands, recent_screenshots }
 *   - { type: 'approval_request', approval: {...} }
 *   - { type: 'approval_resolved', approvalId, status, sessionId }
 *   - { type: 'session_opened' | 'session_closed' | 'session_transferred', sessionId, payload }
 *   - { type: 'client_event', event: {...} }
 *
 * Phase 1 monitoring extensions (CLIENT_PROCTOR_MONITORING_DESIGN §9.2):
 *   - { type: 'student_status_update', contestId, machineId, status, ... }
 *   - { type: 'screenshot_added', contestId, machineId, screenshotId, eventId?, ts, thumbUrl }
 *   - { type: 'event_added', contestId, machineId, eventId, severity, type, summary, ts }
 *   - { type: 'command_result', commandId, machineId, result, errorMessage?, data? }
 *   - { type: 'stream_status_change', contestId, machineId, streamType, status }
 *
 * Contest subscription:
 *   After WS opens, callers can call `subscribeContest({ contestId, page, machineIds })`
 *   to tell the server "I'm watching contest X, page Y, these are the 30 machineIds
 *   I have on screen". The server filters per-page deltas to that subset while
 *   status updates (which drive the cards' green/orange dot) are streamed for
 *   the whole contest. The hook re-sends the subscription automatically on
 *   reconnect.
 *
 * Auto-reconnects with exponential backoff. Token comes from the same
 * `/api/admin/vigil/dashboard-token` endpoint used by lib/vigil-api.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VigilEventSeverity,
  VigilStudentStatus,
} from '@/lib/vigil-api';

/* ─── Message types ────────────────────────────────────────────────────── */

interface SnapshotMsg {
  type: 'snapshot';
  sent_at: string;
  clients: any[];
  recent_events: any[];
  recent_commands: any[];
  recent_screenshots: any[];
}

interface ApprovalRequestMsg {
  type: 'approval_request';
  approval: any;
}

interface ApprovalResolvedMsg {
  type: 'approval_resolved';
  approvalId: string;
  status: 'approved' | 'rejected';
  sessionId: string | null;
}

interface SessionLifecycleMsg {
  type: 'session_opened' | 'session_closed' | 'session_transferred';
  sessionId: string;
  payload: any;
}

interface ClientEventMsg {
  type: 'client_event';
  event: any;
}

/* New Phase 1 messages */

export interface StudentStatusUpdateMsg {
  type: 'student_status_update';
  contestId: string;
  machineId: string;
  status: VigilStudentStatus;
  lastHeartbeat?: string | null;
  eventCount?: number;
  lockedAt?: string | null;
  lockedBy?: number | null;
}

export interface ScreenshotAddedMsg {
  type: 'screenshot_added';
  contestId: string;
  machineId: string;
  screenshotId: string;
  eventId?: string | null;
  ts: string;
  thumbUrl?: string;
}

export interface EventAddedMsg {
  type: 'event_added';
  contestId: string;
  machineId: string;
  eventId: string;
  severity: VigilEventSeverity;
  eventType: string;
  summary: string;
  ts: string;
  screenshotId?: string | null;
}

export interface CommandResultMsg {
  type: 'command_result';
  commandId: string;
  machineId: string;
  result: 'ok' | 'client_offline' | 'timeout' | 'error';
  errorMessage?: string;
  data?: any;
}

export interface StreamStatusChangeMsg {
  type: 'stream_status_change';
  contestId: string;
  machineId: string;
  streamType: 'screen' | 'camera';
  status: 'started' | 'stopped' | 'failed';
}

export type VigilEventMessage =
  | SnapshotMsg
  | ApprovalRequestMsg
  | ApprovalResolvedMsg
  | SessionLifecycleMsg
  | ClientEventMsg
  | StudentStatusUpdateMsg
  | ScreenshotAddedMsg
  | EventAddedMsg
  | CommandResultMsg
  | StreamStatusChangeMsg
  | { type: string;[k: string]: any };

/* ─── Hook API ─────────────────────────────────────────────────────────── */

export interface ContestSubscription {
  contestId: string;
  page: number;
  pageSize?: number;
  machineIds: string[];
}

interface UseVigilSocketOptions {
  onMessage?: (msg: VigilEventMessage) => void;
  /** Pass false to disable connecting (e.g. on demand). Default true. */
  enabled?: boolean;
}

export interface UseVigilSocket {
  connected: boolean;
  lastSnapshot: any;
  /**
   * Subscribe (or update the subscription) for a contest. Sent immediately if
   * the socket is open; queued otherwise and resent after reconnect.
   *
   * Pass `null` to clear the subscription (e.g. when leaving the page).
   */
  subscribeContest: (sub: ContestSubscription | null) => void;
}

export function useVigilSocket(opts: UseVigilSocketOptions = {}): UseVigilSocket {
  const { onMessage, enabled = true } = opts;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest subscription request — re-sent on every (re)connect so the server
  // doesn't lose track of which page we're looking at after a brief drop.
  const subscriptionRef = useRef<ContestSubscription | null>(null);

  // Keep `onMessage` callable from inside the WS callbacks without re-running
  // the connect effect every render (callers often pass an inline lambda).
  const onMessageRef = useRef<UseVigilSocketOptions['onMessage']>(undefined);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const sendSubscription = useCallback((sub: ContestSubscription | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (sub) {
      ws.send(JSON.stringify({
        subscribe: {
          contestId: sub.contestId,
          page: sub.page,
          pageSize: sub.pageSize ?? 30,
          machineIds: sub.machineIds,
        },
      }));
    } else {
      ws.send(JSON.stringify({ unsubscribe: true }));
    }
  }, []);

  const subscribeContest = useCallback((sub: ContestSubscription | null) => {
    subscriptionRef.current = sub;
    sendSubscription(sub);
  }, [sendSubscription]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function connect() {
      try {
        const tk = await fetch('/api/admin/vigil/dashboard-token', { credentials: 'include' })
          .then((r) => r.json());
        if (cancelled) return;
        const url = `${tk.vigilWsUrl}?token=${encodeURIComponent(tk.token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          reconnectAttempt.current = 0;
          // Re-send the active subscription, if any, so the server resumes
          // pushing scoped deltas without the page having to re-call
          // subscribeContest.
          if (subscriptionRef.current) sendSubscription(subscriptionRef.current);
        };
        ws.onclose = () => {
          setConnected(false);
          if (cancelled) return;
          const backoff = Math.min(1000 * 2 ** reconnectAttempt.current, 30_000);
          reconnectAttempt.current += 1;
          reconnectTimer.current = setTimeout(connect, backoff);
        };
        ws.onerror = () => { /* close handler covers reconnect */ };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as VigilEventMessage;
            if (msg.type === 'snapshot') setLastSnapshot(msg);
            onMessageRef.current?.(msg);
          } catch { /* ignore malformed */ }
        };
      } catch {
        if (cancelled) return;
        const backoff = Math.min(1000 * 2 ** reconnectAttempt.current, 30_000);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, backoff);
      }
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, sendSubscription]);

  return { connected, lastSnapshot, subscribeContest };
}
