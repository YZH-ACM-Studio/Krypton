import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
/**
 * Shared presets for `<MultiSelect>` consumers.
 *
 * Languages are static (~17 commonly seen Hydro lang ids).
 * Problems require an async loader that hits the Hydro JSON endpoint.
 */

export interface LangOption {
  value: string;
  label: string;
}

export const COMMON_LANG_OPTIONS: LangOption[] = [
  { value: 'cc.cc20', label: 'C++20' },
  { value: 'cc.cc17', label: 'C++17' },
  { value: 'cc.cc14', label: 'C++14' },
  { value: 'cc.cc11', label: 'C++11' },
  { value: 'cc', label: 'C++ (default)' },
  { value: 'c', label: 'C' },
  { value: 'py.py3', label: 'Python 3' },
  { value: 'py.pypy3', label: 'PyPy3' },
  { value: 'py', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'kt.jvm', label: 'Kotlin/JVM' },
  { value: 'go', label: 'Go' },
  { value: 'rs', label: 'Rust' },
  { value: 'js', label: 'JavaScript' },
  { value: 'pas', label: 'Pascal' },
  { value: 'cs', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'rb', label: 'Ruby' },
  { value: 'hs', label: 'Haskell' },
  { value: 'bash', label: 'Bash' },
];

export const LANG_LABEL_MAP = Object.fromEntries(COMMON_LANG_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>;

/** Resolve a list of lang ids to LangOption — unknown ids fall back to id-as-label. */
export function resolveLangs(ids: string[]): LangOption[] {
  return ids.filter(Boolean).map((id) => ({ value: id, label: LANG_LABEL_MAP[id] || id }));
}

export interface ProblemOption {
  docId: number;
  pid?: string | number;
  title: string;
  tag?: string[];
  difficulty?: number;
  nSubmit?: number;
  nAccept?: number;
  problemKind?: unknown;
}

export interface PidNamespaceOption {
  namespaceId: string;
  name: string;
  enabled: boolean;
  allocated?: boolean;
  prefix?: string;
}

export interface ProblemBankPage {
  page: number;
  pcount: number;
  ppcount: number;
  problems: ProblemOption[];
  pidNamespaces: PidNamespaceOption[];
}

export type SearchProblemBankOptions = {
  query?: string | number;
  page?: number;
  limit?: number;
  kind?: string;
  pidNamespaceId?: string;
  quick?: boolean;
};

const PROBLEM_BANK_MAX_PAGES = 200;

function projectProblemOption(p: ProblemOption): ProblemOption {
  return {
    docId: p.docId,
    pid: p.pid,
    title: p.title,
    tag: p.tag,
    difficulty: p.difficulty,
    nSubmit: p.nSubmit,
    nAccept: p.nAccept,
    problemKind: p.problemKind,
  };
}

function readNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function readPidNamespaceOptions(value: unknown): PidNamespaceOption[] {
  if (!Array.isArray(value)) return [];
  const out: PidNamespaceOption[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.namespaceId !== 'string' || !rec.namespaceId) continue;
    if (typeof rec.name !== 'string' || !rec.name) continue;
    out.push({
      namespaceId: rec.namespaceId,
      name: rec.name,
      enabled: rec.enabled === true,
      allocated: rec.allocated === true,
      prefix: typeof rec.prefix === 'string' ? rec.prefix : undefined,
    });
  }
  return out;
}

export function readProblemBankPage(data: unknown, page: number): ProblemBankPage {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('题库响应不是对象');
  }
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.pdocs)) {
    throw new Error('题库响应缺少题目列表');
  }
  const problems: ProblemOption[] = [];
  for (const row of record.pdocs) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('题库题目条目无效');
    }
    const rec = row as Record<string, unknown>;
    if (typeof rec.docId !== 'number' || !Number.isInteger(rec.docId) || rec.docId <= 0) {
      throw new Error('题库题目缺少 docId');
    }
    problems.push(
      projectProblemOption({
        docId: rec.docId,
        pid: typeof rec.pid === 'string' || typeof rec.pid === 'number' ? rec.pid : undefined,
        title: typeof rec.title === 'string' ? rec.title : '',
        tag: Array.isArray(rec.tag) ? rec.tag.filter((tag): tag is string => typeof tag === 'string') : undefined,
        difficulty: typeof rec.difficulty === 'number' ? rec.difficulty : undefined,
        nSubmit: typeof rec.nSubmit === 'number' ? rec.nSubmit : undefined,
        nAccept: typeof rec.nAccept === 'number' ? rec.nAccept : undefined,
        problemKind: rec.problemKind,
      }),
    );
  }
  return {
    page,
    pcount: readNonNegativeInt(record.pcount) ?? problems.length,
    ppcount: readNonNegativeInt(record.ppcount) ?? (problems.length ? 1 : 0),
    problems,
    pidNamespaces: readPidNamespaceOptions(record.pidNamespaces),
  };
}

export function mergeProblemBankPages(pages: readonly ProblemOption[][]): ProblemOption[] {
  const seen = new Set<string>();
  const out: ProblemOption[] = [];
  for (const page of pages) {
    for (const option of page) {
      const key = problemKey(option);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(option);
    }
  }
  return out;
}

function problemBankUrl(options: SearchProblemBankOptions): URL {
  const url = new URL('/p', window.location.origin);
  if (options.query) url.searchParams.set('q', String(options.query));
  if (options.quick !== false) url.searchParams.set('quick', 'true');
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  if (options.page && options.page > 1) url.searchParams.set('page', String(options.page));
  if (options.kind) url.searchParams.set('kind', options.kind);
  if (options.pidNamespaceId) url.searchParams.set('pidNamespaceId', options.pidNamespaceId);
  return url;
}

/**
 * One page of `/p` with pcount/ppcount. Throws on HTTP or shape errors.
 * Do not pass a small `limit` if you will request page>1: Hydro resets
 * page>1 to `pagination.problem`, which would skip or overlap rows.
 */
export async function searchProblemBankPage(options: SearchProblemBankOptions = {}): Promise<ProblemBankPage> {
  const page = options.page && options.page > 1 ? options.page : 1;
  const res = await fetchHydroResponse(problemBankUrl(options).toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(await readHydroResponseError(res, '题库搜索失败'));
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('题库响应不是 JSON');
  }
  return readProblemBankPage(data, page);
}

export async function searchProblemBankAll(
  options: Omit<SearchProblemBankOptions, 'page'> = {},
  onPage?: (page: number, pageCount: number) => void,
): Promise<ProblemOption[]> {
  const first = await searchProblemBankPage({ ...options, page: 1 });
  let pageCount = Math.max(first.ppcount, first.problems.length ? 1 : 0);
  onPage?.(1, Math.max(pageCount, 1));
  if (first.pcount > first.problems.length && pageCount <= 1) {
    throw new Error(`题库声称共有 ${first.pcount} 道题，但只返回了一页 ${first.problems.length} 道，无法加入全部`);
  }
  const pages = [first.problems];
  for (let page = 2; page <= pageCount; page += 1) {
    if (page > PROBLEM_BANK_MAX_PAGES) {
      throw new Error(`题库分页超过 ${PROBLEM_BANK_MAX_PAGES} 页，已停止。请缩小搜索范围。`);
    }
    onPage?.(page, pageCount);
    const next = await searchProblemBankPage({ ...options, page });
    pageCount = Math.max(pageCount, next.ppcount);
    pages.push(next.problems);
    if (!next.problems.length) break;
  }
  return mergeProblemBankPages(pages);
}

export async function listPidNamespaceOptions(): Promise<PidNamespaceOption[]> {
  const page = await searchProblemBankPage({ limit: 1, quick: false });
  return page.pidNamespaces;
}

/**
 * Search problems via the existing Hydro /p endpoint with JSON Accept.
 * `quick=true` keeps the projection small. Limit is server-clamped.
 */
export async function searchProblems(
  query: string | number,
  limit = 20,
  options?: { kind?: string; quick?: boolean },
): Promise<ProblemOption[]> {
  const url = new URL('/p', window.location.origin);
  if (query) url.searchParams.set('q', String(query));
  if (options?.quick !== false) url.searchParams.set('quick', 'true');
  url.searchParams.set('limit', String(limit));
  if (options?.kind) url.searchParams.set('kind', options.kind);
  try {
    const res = await fetchHydroResponse(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data: unknown = await res.json().catch(() => null);
    const pdocs = data && typeof data === 'object' ? (data as { pdocs?: unknown }).pdocs : null;
    if (!Array.isArray(pdocs)) return [];
    return (pdocs as ProblemOption[]).map((p) => ({
      docId: p.docId,
      pid: p.pid,
      title: p.title,
      tag: p.tag,
      difficulty: p.difficulty,
      nSubmit: p.nSubmit,
      nAccept: p.nAccept,
      problemKind: p.problemKind,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch problem docs for a known set of pids/docIds (used to seed the
 * MultiSelect value from a stored CSV without losing titles). Falls
 * through to a placeholder if a pid isn't found.
 */
export async function fetchProblemsByIds(ids: Array<string | number>): Promise<ProblemOption[]> {
  if (!ids.length) return [];
  // Hydro's /p endpoint doesn't accept "ids=..." cleanly; the cheapest
  // workaround is one search per id (each cheap, parallel).
  const results = await Promise.all(
    ids.map(async (id) => {
      const list = await searchProblems(id, 5);
      return list.find((p) => String(p.pid) === id || String(p.docId) === id) || { docId: Number(id) || 0, pid: id, title: '' };
    }),
  );
  return results;
}

/** Identify a ProblemOption by Hydro's internal numeric docId for form submits. */
export function problemKey(p: ProblemOption): string {
  return String(p.docId || p.pid);
}
