import { useCallback, useEffect, useMemo, useState } from 'react';

export function resolveChapterId(ids: number[], rawValue: string | null): number | null {
  const firstId = ids[0] ?? null;
  if (firstId === null) return null;
  const requested = Number(rawValue);
  return ids.includes(requested) ? requested : firstId;
}

export function withChapterQuery(href: string, chapterId: number): string {
  const url = new URL(href);
  url.searchParams.set('chapter', String(chapterId));
  return url.toString();
}

export function useChapterQuery(chapters: Array<{ _id: number }>) {
  const ids = useMemo(() => chapters.map((chapter) => chapter._id), [chapters]);
  const idsKey = ids.join(',');
  const firstId = ids[0] ?? null;
  const [activeId, setActiveId] = useState<number | null>(firstId);

  useEffect(() => {
    if (typeof window === 'undefined' || firstId === null) return undefined;
    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get('chapter');
      const nextId = resolveChapterId(ids, requested) as number;
      setActiveId(nextId);
      if (requested !== String(nextId)) {
        window.history.replaceState(null, '', withChapterQuery(url.toString(), nextId));
      }
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [firstId, idsKey]);

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
