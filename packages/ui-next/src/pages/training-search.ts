export type TrainingProblemSearchStatus = 'accepted' | 'partiallyAccepted' | 'previouslyAccepted' | 'attempted' | 'unattempted';

export interface TrainingProblemSearchChapter {
  id: number;
  title: string;
  completed?: boolean;
}

export interface TrainingProblemSearchRow {
  docId: number;
  displayPid: string;
  title: string;
  status: TrainingProblemSearchStatus;
  completedChapterCount: number;
  chapters: TrainingProblemSearchChapter[];
}

interface TrainingSearchNode {
  _id: number;
  title?: string;
  pids?: Array<number | string>;
}

interface TrainingSearchProblem {
  docId?: number;
  pid?: string;
  title?: string;
}

interface TrainingSearchStatus {
  status?: number;
}

interface TrainingSearchNodeStatus {
  donePids?: number[];
}

export interface TrainingListContextualProgress {
  completedProblemCount?: number;
  doneNids?: number[];
  nsdict?: Record<string, TrainingSearchNodeStatus & { isDone?: boolean; isProgress?: boolean; isOpen?: boolean; isInvalid?: boolean }>;
}

export function resolveTrainingListProgress(
  legacyStatus: { donePids?: number[]; doneNids?: number[] },
  contextualProgress?: TrainingListContextualProgress,
): { completedProblemCount: number; doneNids: number[]; nsdict: TrainingListContextualProgress['nsdict'] } {
  if (contextualProgress) {
    return {
      completedProblemCount:
        Number.isSafeInteger(contextualProgress.completedProblemCount) && Number(contextualProgress.completedProblemCount) >= 0
          ? Number(contextualProgress.completedProblemCount)
          : 0,
      doneNids: Array.isArray(contextualProgress.doneNids) ? contextualProgress.doneNids.map(Number) : [],
      nsdict: contextualProgress.nsdict,
    };
  }
  return {
    completedProblemCount: Array.isArray(legacyStatus.donePids) ? legacyStatus.donePids.length : 0,
    doneNids: Array.isArray(legacyStatus.doneNids) ? legacyStatus.doneNids.map(Number) : [],
    nsdict: undefined,
  };
}

export function searchTrainingProblems({
  dag,
  pdict,
  psdict,
  nsdict = {},
  controlled = false,
  query,
  limit = 20,
}: {
  dag: TrainingSearchNode[];
  pdict: Record<string, TrainingSearchProblem | undefined>;
  psdict: Record<string, TrainingSearchStatus | undefined>;
  nsdict?: Record<string, TrainingSearchNodeStatus | undefined>;
  controlled?: boolean;
  query: string;
  limit?: number;
}): { total: number; results: TrainingProblemSearchRow[] } {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return { total: 0, results: [] };

  const rows = new Map<number, TrainingProblemSearchRow>();
  for (const chapter of dag) {
    for (const rawPid of chapter.pids || []) {
      const pdoc = pdict[String(rawPid)];
      const docId = Number(pdoc?.docId);
      if (!Number.isSafeInteger(docId) || docId <= 0) continue;

      let row = rows.get(docId);
      if (!row) {
        const psdoc = psdict[String(docId)];
        row = {
          docId,
          displayPid: String(pdoc?.pid || docId),
          title: String(pdoc?.title || '未命名'),
          status: psdoc?.status === 1 ? 'accepted' : psdoc ? 'attempted' : 'unattempted',
          completedChapterCount: 0,
          chapters: [],
        };
        rows.set(docId, row);
      }
      if (!row.chapters.some((item) => item.id === chapter._id)) {
        const completed = controlled && (nsdict[String(chapter._id)]?.donePids || []).map(Number).includes(docId);
        row.chapters.push({
          id: chapter._id,
          title: String(chapter.title || `阶段 ${chapter._id}`),
          ...(controlled ? { completed } : {}),
        });
        if (completed) row.completedChapterCount += 1;
      }
    }
  }

  if (controlled) {
    for (const row of rows.values()) {
      if (row.completedChapterCount === row.chapters.length) row.status = 'accepted';
      else if (row.completedChapterCount > 0) row.status = 'partiallyAccepted';
      else if (psdict[String(row.docId)]?.status === 1) row.status = 'previouslyAccepted';
      else row.status = 'unattempted';
    }
  }

  const matches = Array.from(rows.values()).filter((row) =>
    [row.displayPid, row.docId, row.title].some((value) => String(value).toLocaleLowerCase().includes(keyword)),
  );
  return {
    total: matches.length,
    results: matches.slice(0, Math.max(0, limit)),
  };
}
