import { useCallback, useEffect, useMemo, useState } from 'react';

export function resolveChapterId(ids: number[], rawValue: string | null, preferredId: number | null = null): number | null {
  const firstId = ids[0] ?? null;
  if (firstId === null) return null;
  const requested = rawValue === null || rawValue.trim() === '' ? Number.NaN : Number(rawValue);
  if (ids.includes(requested)) return requested;
  return preferredId !== null && ids.includes(preferredId) ? preferredId : firstId;
}

export function withChapterQuery(href: string, chapterId: number): string {
  const url = new URL(href);
  url.searchParams.set('chapter', String(chapterId));
  return url.toString();
}

export function useChapterQuery(chapters: Array<{ _id: number }>, preferredId: number | null = null) {
  const ids = useMemo(() => chapters.map((chapter) => chapter._id), [chapters]);
  const idsKey = ids.join(',');
  const defaultId = resolveChapterId(ids, null, preferredId);
  const [activeId, setActiveId] = useState<number | null>(defaultId);

  useEffect(() => {
    if (typeof window === 'undefined' || defaultId === null) return undefined;
    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get('chapter');
      const nextId = resolveChapterId(ids, requested, preferredId) as number;
      setActiveId(nextId);
      if (requested !== String(nextId)) {
        window.history.replaceState(null, '', withChapterQuery(url.toString(), nextId));
      }
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [defaultId, idsKey, preferredId]);

  const selectChapter = useCallback(
    (chapterId: number, replace = false) => {
      if (typeof window === 'undefined' || !ids.includes(chapterId)) return;
      setActiveId(chapterId);
      const href = withChapterQuery(window.location.href, chapterId);
      window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
    },
    [idsKey],
  );

  return { activeId, selectChapter };
}
