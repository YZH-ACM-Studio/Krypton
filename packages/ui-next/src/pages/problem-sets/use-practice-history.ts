import { useEffect } from 'react';

/** The browser can restore a card list or stage detail from before the submission. */
export function useRefreshPracticeOnReturn(active = true) {
  useEffect(() => {
    if (!active) return;
    const refresh = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [active]);
}
