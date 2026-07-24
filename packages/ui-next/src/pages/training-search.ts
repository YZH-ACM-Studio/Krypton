export type TrainingProblemSearchStatus = 'accepted' | 'attempted' | 'unattempted';

export interface TrainingProblemSearchChapter {
  id: number;
  title: string;
}

export interface TrainingProblemSearchRow {
  docId: number;
  displayPid: string;
  title: string;
  status: TrainingProblemSearchStatus;
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

export function searchTrainingProblems({
  dag,
  pdict,
  psdict,
  query,
  limit = 20,
}: {
  dag: TrainingSearchNode[];
  pdict: Record<string, TrainingSearchProblem | undefined>;
  psdict: Record<string, TrainingSearchStatus | undefined>;
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
          chapters: [],
        };
        rows.set(docId, row);
      }
      if (!row.chapters.some((item) => item.id === chapter._id)) {
        row.chapters.push({
          id: chapter._id,
          title: String(chapter.title || `阶段 ${chapter._id}`),
        });
      }
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
