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

export interface UseRecordSocketOptions {
  /** WS endpoint base path, default `/record-conn`. */
  path?: '/record-conn' | '/record-detail-conn';
  /** Query params to attach to the WS URL (tid, pid, uidOrName, rid, status, …). */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Called whenever a new rdoc snapshot arrives. */
  onRdoc: (rdoc: Rdoc) => void;
  /** Optional error callback for diagnostics. */
  onError?: (e: any) => void;
  /** Disable connection entirely (e.g. when user is signed out). */
  disabled?: boolean;
}

export function useRecordSocket({
  path = '/record-conn',
  filters,
  onRdoc,
  onError,
  disabled,
}: UseRecordSocketOptions) {
  // Latest callbacks captured in refs so re-renders don't re-open the
  // socket merely because the closure changed.
  const onRdocRef = useRef(onRdoc);
  const onErrorRef = useRef(onError);
  useEffect(() => { onRdocRef.current = onRdoc; }, [onRdoc]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Stringify filters into a stable dep so React knows when to reconnect.
  const filterKey = stableFilterKey(filters);

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    let closed = false;
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
        try { payload = JSON.parse(e.data); } catch { return; }
        if (payload && payload.rdoc) {
          onRdocRef.current(payload.rdoc);
        }
      };
      ws.onerror = (err) => {
        onErrorRef.current?.(err);
      };
      ws.onclose = () => {
        if (closed) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, filterKey, disabled]);
}

function stableFilterKey(filters?: Record<string, any>): string {
  if (!filters) return '';
  return Object.keys(filters).sort().map((k) => `${k}=${String(filters[k] ?? '')}`).join('&');
}
