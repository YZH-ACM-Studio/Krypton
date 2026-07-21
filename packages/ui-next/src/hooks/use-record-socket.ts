/**
 * useRecordSocket — opens a WebSocket to Hydro's `/record-conn` (list)
 * or `/record-detail-conn` (single) endpoint and pushes `rdoc` updates
 * to the caller.
 *
 * Hydro sends two payload shapes:
 *   - `{ rdoc }` when `noTemplate=true` is in the URL — we always pass it.
 *   - `{ rdoc, html }` otherwise — ignored, never requested.
 *
 * Auto-reconnect with exponential backoff capped at 30 s. Closes cleanly
 * on unmount or filter change.
 */
import { useEffect, useRef } from 'react';

export type Rdoc = Record<string, any>;
export type RecordSocketPath = '/record-conn' | '/record-detail-conn' | '/exam-mode/team-role-conn';

export interface UseRecordSocketOptions {
  /** WS endpoint base path, default `/record-conn`. */
  path?: RecordSocketPath;
  /** Query params to attach to the WS URL (tid, pid, uidOrName, rid, status, …). */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Called whenever a new rdoc snapshot arrives. */
  onRdoc: (rdoc: Rdoc) => void;
  /** Optional error callback for diagnostics. */
  onError?: (e: any) => void;
  /** Team roster/captain revision changed; callers must refresh server capabilities. */
  onTeamRoleChange?: (revision: number | null) => void;
  /** A virtual-print snapshot was persisted for this team member. */
  onTeamCodeAvailable?: (snapshotId: string) => void;
  /** Disable connection entirely (e.g. when user is signed out). */
  disabled?: boolean;
}

export function dispatchRecordSocketPayload(
  payload: any,
  onRdoc: (rdoc: Rdoc) => void,
  onTeamRoleChange?: (revision: number | null) => void,
  onTeamCodeAvailable?: (snapshotId: string) => void,
) {
  if (payload?.teamRoleChanged === true) {
    const revision = Number(payload.teamRevision);
    onTeamRoleChange?.(Number.isSafeInteger(revision) && revision >= 0 ? revision : null);
    return;
  }
  if (payload?.teamCodeAvailable === true) {
    const snapshotId = String(payload.snapshotId || '');
    if (/^[0-9a-f]{24}$/.test(snapshotId)) onTeamCodeAvailable?.(snapshotId);
    return;
  }
  if (payload?.rdoc) onRdoc(payload.rdoc);
}

export function isTerminalRecordSocketClose(path: RecordSocketPath, code: number): boolean {
  return path === '/exam-mode/team-role-conn' && code === 4003;
}

export function useRecordSocket({
  path = '/record-conn',
  filters,
  onRdoc,
  onError,
  onTeamRoleChange,
  onTeamCodeAvailable,
  disabled,
}: UseRecordSocketOptions) {
  // Latest callbacks captured in refs so re-renders don't re-open the
  // socket merely because the closure changed.
  const onRdocRef = useRef(onRdoc);
  const onErrorRef = useRef(onError);
  const onTeamRoleChangeRef = useRef(onTeamRoleChange);
  const onTeamCodeAvailableRef = useRef(onTeamCodeAvailable);
  useEffect(() => {
    onRdocRef.current = onRdoc;
  }, [onRdoc]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onTeamRoleChangeRef.current = onTeamRoleChange;
  }, [onTeamRoleChange]);
  useEffect(() => {
    onTeamCodeAvailableRef.current = onTeamCodeAvailable;
  }, [onTeamCodeAvailable]);

  // Stringify filters into a stable dep so React knows when to reconnect.
  const filterKey = stableFilterKey(filters);

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    let closed = false;
    let teamInvalidated = false;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`${proto}//${window.location.host}${path}`);
      url.searchParams.set('noTemplate', 'true');
      for (const [k, v] of Object.entries(filters || {})) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
      try {
        ws = new WebSocket(url.toString());
      } catch (err) {
        onErrorRef.current?.(err);
        scheduleRetry();
        return;
      }
      ws.onmessage = (e) => {
        let payload: any;
        try {
          payload = JSON.parse(e.data);
        } catch {
          return;
        }
        if (payload?.teamRoleChanged === true) teamInvalidated = true;
        dispatchRecordSocketPayload(
          payload,
          onRdocRef.current,
          onTeamRoleChangeRef.current,
          onTeamCodeAvailableRef.current,
        );
      };
      ws.onerror = (err) => {
        onErrorRef.current?.(err);
      };
      ws.onclose = (event) => {
        if (closed) return;
        if (isTerminalRecordSocketClose(path, event.code)) {
          closed = true;
          if (!teamInvalidated) onTeamRoleChangeRef.current?.(null);
          return;
        }
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [path, filterKey, disabled]);
}

function stableFilterKey(filters?: Record<string, any>): string {
  if (!filters) return '';
  return Object.keys(filters)
    .sort()
    .map((k) => `${k}=${String(filters[k] ?? '')}`)
    .join('&');
}
