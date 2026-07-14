import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PendingNavigation =
  | { type: 'href'; url: string }
  | {
      type: 'traverse';
      resolve: (confirmed: boolean) => void;
    };

type NavigationApi = EventTarget;
type NavigationTraverseEvent = Event & {
  canIntercept: boolean;
  destination: { url: string };
  downloadRequest: string | null;
  hashChange: boolean;
  navigationType: 'push' | 'replace' | 'reload' | 'traverse';
  signal: AbortSignal;
  intercept(options: { handler?: () => void | Promise<void>; precommitHandler?: () => void | Promise<void> }): void;
};

function navigationApi(): NavigationApi | null {
  const candidate = (window as Window & { navigation?: unknown }).navigation;
  return candidate instanceof EventTarget ? candidate : null;
}

function snapshotForm(form: HTMLFormElement | null): string | null {
  if (!form) return null;
  const entries = [...new FormData(form).entries()].map(([name, value]) => [
    name,
    typeof value === 'string' ? value : `${value.name}:${value.size}:${value.type}`,
  ]);
  return JSON.stringify(entries);
}

/** Compare the canonical submitted form shape, so reverting a change clears dirty state. */
export function useFormDirtyState(formRef: RefObject<HTMLFormElement | null>, revisionKey: string) {
  const baselineRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const snapshot = useCallback(() => snapshotForm(formRef.current), [formRef]);

  const recompute = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const current = snapshot();
      if (current === null) return;
      if (baselineRef.current === null) baselineRef.current = current;
      setDirty(current !== baselineRef.current);
    });
  }, [snapshot]);

  const markClean = useCallback(() => {
    const current = snapshot();
    if (current !== null) baselineRef.current = current;
    setDirty(false);
  }, [snapshot]);

  useLayoutEffect(() => {
    const current = snapshot();
    if (current !== null && baselineRef.current === null) baselineRef.current = current;
  }, [snapshot]);

  useEffect(() => {
    recompute();
  }, [recompute, revisionKey]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return { dirty, recompute, markClean, snapshot };
}

/**
 * Custom confirmation for same-origin links and both history traversal directions.
 * The Navigation API path does not add entries, so enabling the guard never
 * destroys an existing Forward stack. Older browsers retain their history and
 * use the native beforeunload prompt for traversal, refresh, close and address-bar exits.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  const bypassRef = useRef(false);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const [pending, setPendingState] = useState<PendingNavigation | null>(null);
  dirtyRef.current = dirty;

  const setPending = useCallback((next: PendingNavigation | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const replacePending = useCallback(
    (next: PendingNavigation) => {
      const current = pendingRef.current;
      if (current?.type === 'traverse' && current !== next) current.resolve(false);
      setPending(next);
    },
    [setPending],
  );

  const allowNavigation = useCallback(() => {
    bypassRef.current = true;
    const current = pendingRef.current;
    setPending(null);
    if (current?.type === 'traverse') current.resolve(true);
  }, [setPending]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassRef.current || !dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  useEffect(() => {
    const interceptLink = (event: MouseEvent) => {
      if (bypassRef.current || !dirtyRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.download || (anchor.target && anchor.target !== '_self')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash !== window.location.hash) return;
      event.preventDefault();
      event.stopPropagation();
      replacePending({ type: 'href', url: url.href });
    };
    document.addEventListener('click', interceptLink, true);
    return () => document.removeEventListener('click', interceptLink, true);
  }, [replacePending]);

  useEffect(() => {
    const navigation = navigationApi();
    if (!navigation) return;
    const interceptTraversal = (rawEvent: Event) => {
      const event = rawEvent as NavigationTraverseEvent;
      if (
        bypassRef.current ||
        !dirtyRef.current ||
        event.navigationType !== 'traverse' ||
        !event.canIntercept ||
        !event.cancelable ||
        event.signal.aborted ||
        event.hashChange ||
        event.downloadRequest !== null
      ) {
        return;
      }
      const destination = new URL(event.destination.url, window.location.href);
      if (destination.origin !== window.location.origin) return;

      let resolveDecision: (confirmed: boolean) => void = () => {};
      const decision = new Promise<boolean>((resolve) => {
        resolveDecision = resolve;
      });
      const nextPending: PendingNavigation = { type: 'traverse', resolve: resolveDecision };
      const abortDecision = () => {
        resolveDecision(false);
        if (pendingRef.current === nextPending) setPending(null);
      };
      event.signal.addEventListener('abort', abortDecision, { once: true });
      try {
        event.intercept({
          precommitHandler: async () => {
            const confirmed = await decision;
            event.signal.removeEventListener('abort', abortDecision);
            if (!confirmed) throw new DOMException('Navigation cancelled by unsaved changes guard', 'AbortError');
          },
          // Interception converts the traversal to same-document navigation.
          // Reload only after commit so the server-rendered destination replaces this editor.
          handler: () => window.location.reload(),
        });
      } catch (error) {
        event.signal.removeEventListener('abort', abortDecision);
        resolveDecision(false);
        throw error;
      }
      if (!event.signal.aborted) replacePending(nextPending);
    };
    navigation.addEventListener('navigate', interceptTraversal);
    return () => navigation.removeEventListener('navigate', interceptTraversal);
  }, [replacePending, setPending]);

  useEffect(() => {
    if (dirty || pendingRef.current?.type !== 'traverse') return;
    allowNavigation();
  }, [allowNavigation, dirty]);

  useEffect(
    () => () => {
      const current = pendingRef.current;
      if (current?.type === 'traverse') current.resolve(false);
    },
    [],
  );

  const cancelNavigation = useCallback(() => {
    const current = pendingRef.current;
    setPending(null);
    if (current?.type === 'traverse') current.resolve(false);
  }, [setPending]);

  const discardAndLeave = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    if (current.type === 'href') {
      allowNavigation();
      window.location.assign(current.url);
      return;
    }
    allowNavigation();
  }, [allowNavigation]);

  const guardDialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelNavigation()}>
      <DialogContent className="sm:max-w-md" onClose={cancelNavigation}>
        <DialogHeader>
          <DialogTitle>放弃未保存的更改？</DialogTitle>
        </DialogHeader>
        <p className="px-5 text-sm text-muted-foreground">当前题目还有未保存的修改。离开后这些修改不会自动恢复。</p>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={cancelNavigation}>
            继续编辑
          </Button>
          <Button type="button" variant="destructive" onClick={discardAndLeave}>
            放弃更改并离开
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { allowNavigation, guardDialog };
}
