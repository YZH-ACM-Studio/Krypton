import type { ChapterDraft } from './types';

export function claimChapterProblemIds(chapter: ChapterDraft, owner: 'loose' | number, nextPids: string[]): ChapterDraft {
  const claimed = new Set(nextPids);
  if (owner === 'loose') {
    return {
      ...chapter,
      pids: nextPids,
      sections: chapter.sections.map((section) => ({
        ...section,
        pids: section.pids.filter((pid) => !claimed.has(pid)),
      })),
    };
  }
  return {
    ...chapter,
    pids: chapter.pids.filter((pid) => !claimed.has(pid)),
    sections: chapter.sections.map((section) =>
      section._id === owner
        ? { ...section, pids: nextPids }
        : { ...section, pids: section.pids.filter((pid) => !claimed.has(pid)) },
    ),
  };
}
