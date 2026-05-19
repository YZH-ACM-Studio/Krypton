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
 * Auto-reconnects with exponential backoff. Token comes from the same
 * `/api/admin/vigil/dashboard-token` endpoint used by lib/vigil-api.ts.
 */
import { useEffect, useRef, useState } from 'react';

export type VigilEventMessage =
  | { type: 'snapshot'; sent_at: string; clients: any[]; recent_events: any[]; recent_commands: any[]; recent_screenshots: any[] }
  | { type: 'approval_request'; approval: any }
  | { type: 'approval_resolved'; approvalId: string; status: 'approved' | 'rejected'; sessionId: string | null }
  | { type: 'session_opened' | 'session_closed' | 'session_transferred'; sessionId: string; payload: any }
  | { type: 'client_event'; event: any }
  | { type: string; [k: string]: any };

interface UseVigilSocketOptions {
  onMessage?: (msg: VigilEventMessage) => void;
  /** Pass false to disable connecting (e.g. on demand). Default true. */
  enabled?: boolean;
}

export function useVigilSocket(opts: UseVigilSocketOptions = {}) {
  const { onMessage, enabled = true } = opts;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            onMessage?.(msg);
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
  }, [enabled, onMessage]);

  return { connected, lastSnapshot };
}
