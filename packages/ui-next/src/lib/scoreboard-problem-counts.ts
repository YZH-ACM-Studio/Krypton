export interface ScoreboardProblemCounts { nAccept: number; nSubmit: number }

export function readProblemCounts(value: unknown): ScoreboardProblemCounts | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('题目提交统计无效');
  const nAccept: unknown = 'nAccept' in value ? value.nAccept : undefined;
  const nSubmit: unknown = 'nSubmit' in value ? value.nSubmit : undefined;
  if (nAccept === undefined && nSubmit === undefined) return undefined;
  if (typeof nAccept !== 'number' || !Number.isSafeInteger(nAccept) || nAccept < 0
    || typeof nSubmit !== 'number' || !Number.isSafeInteger(nSubmit) || nSubmit < nAccept) throw new TypeError('题目通过数或提交次数无效');
  return { nAccept, nSubmit };
}
