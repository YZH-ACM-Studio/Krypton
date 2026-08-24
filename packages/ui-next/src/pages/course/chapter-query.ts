import { useCallback, useEffect, useMemo, useState } from 'react';

export function resolveChapterId(ids: number[], rawValue: string | null, preferredId: number | null = null): number | null {
  const firstId = ids[0] ?? null;
  if (firstId === null) return null;
  const requested = rawValue === null || rawValue.trim() === '' ? Number.NaN : Number(rawValue);
  if (ids.includes(requested)) return requested;
  return preferredId !== null && ids.includes(preferredId) ? preferredId : firstId;
}

export function resolveSectionId(ids: number[], rawValue: string | null): number | null {
  if (!ids.length) return null;
  const requested = rawValue === null || rawValue.trim() === '' ? Number.NaN : Number(rawValue);
  return ids.includes(requested) ? requested : null;
}

export function withChapterQuery(href: string, chapterId: number, sectionId: number | null = null): string {
  const url = new URL(href);
  url.searchParams.set('chapter', String(chapterId));
  if (sectionId == null) url.searchParams.delete('section');
  else url.searchParams.set('section', String(sectionId));
  return url.toString();
}

export function useChapterQuery(chapters: Array<{ _id: number; sections?: Array<{ _id: number }> }>, preferredId: number | null = null) {
  const ids = useMemo(() => chapters.map((chapter) => chapter._id), [chapters]);
  const idsKey = ids.join(',');
  const sectionsKey = chapters.map((chapter) => `${chapter._id}:${(chapter.sections || []).map((section) => section._id).join(',')}`).join('|');
  const defaultId = resolveChapterId(ids, null, preferredId);
  const [activeId, setActiveId] = useState<number | null>(defaultId);
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || defaultId === null) return undefined;
    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      const rawChapter = url.searchParams.get('chapter');
      const nextId = resolveChapterId(ids, rawChapter, preferredId) as number;
      const requestedChapter = rawChapter === null || rawChapter.trim() === '' ? Number.NaN : Number(rawChapter);
      const chapter = chapters.find((item) => item._id === nextId);
      const nextSectionId =
        ids.includes(requestedChapter) && requestedChapter === nextId
          ? resolveSectionId(
              (chapter?.sections || []).map((section) => section._id),
              url.searchParams.get('section'),
            )
          : null;
      setActiveId(nextId);
      setActiveSectionId(nextSectionId);
      const canonical = withChapterQuery(url.toString(), nextId, nextSectionId);
      if (canonical !== url.toString()) window.history.replaceState(null, '', canonical);
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [defaultId, idsKey, preferredId, sectionsKey]);

  const selectChapter = useCallback(
    (chapterId: number, replace = false) => {
      if (typeof window === 'undefined' || !ids.includes(chapterId)) return;
      setActiveId(chapterId);
      setActiveSectionId(null);
      const href = withChapterQuery(window.location.href, chapterId, null);
      window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
    },
    [idsKey],
  );

  const selectSection = useCallback(
    (chapterId: number, sectionId: number | null, replace = false) => {
      if (typeof window === 'undefined' || !ids.includes(chapterId)) return;
      const chapter = chapters.find((item) => item._id === chapterId);
      const sectionIds = (chapter?.sections || []).map((section) => section._id);
      const nextSectionId = sectionId == null ? null : resolveSectionId(sectionIds, String(sectionId));
      setActiveId(chapterId);
      setActiveSectionId(nextSectionId);
      const href = withChapterQuery(window.location.href, chapterId, nextSectionId);
      window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
    },
    [idsKey, sectionsKey],
  );

  return { activeId, activeSectionId, selectChapter, selectSection };
}
