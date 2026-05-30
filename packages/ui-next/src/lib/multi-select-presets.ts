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

export const LANG_LABEL_MAP = Object.fromEntries(
  COMMON_LANG_OPTIONS.map((o) => [o.value, o.label]),
) as Record<string, string>;

/** Resolve a list of lang ids to LangOption — unknown ids fall back to id-as-label. */
export function resolveLangs(ids: string[]): LangOption[] {
  return ids.filter(Boolean).map((id) => ({ value: id, label: LANG_LABEL_MAP[id] || id }));
}

export interface ProblemOption {
  docId: number;
  pid?: string;
  title: string;
  tag?: string[];
  difficulty?: number;
  nSubmit?: number;
  nAccept?: number;
}

/**
 * Search problems via the existing Hydro /p endpoint with JSON Accept.
 * `quick=true` keeps the projection small. Limit is server-clamped.
 */
export async function searchProblems(query: string, limit = 20): Promise<ProblemOption[]> {
  const url = new URL('/p', window.location.origin);
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('quick', 'true');
  url.searchParams.set('limit', String(limit));
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.pdocs)) return [];
    return data.pdocs.map((p: any) => ({
      docId: p.docId,
      pid: p.pid,
      title: p.title,
      tag: p.tag,
      difficulty: p.difficulty,
      nSubmit: p.nSubmit,
      nAccept: p.nAccept,
    }));
  } catch { return []; }
}

/**
 * Fetch problem docs for a known set of pids/docIds (used to seed the
 * MultiSelect value from a stored CSV without losing titles). Falls
 * through to a placeholder if a pid isn't found.
 */
export async function fetchProblemsByIds(ids: string[]): Promise<ProblemOption[]> {
  if (!ids.length) return [];
  // Hydro's /p endpoint doesn't accept "ids=..." cleanly; the cheapest
  // workaround is one search per id (each cheap, parallel).
  const results = await Promise.all(ids.map(async (id) => {
    const list = await searchProblems(id, 5);
    return list.find((p) => String(p.pid) === id || String(p.docId) === id)
      || { docId: Number(id) || 0, pid: id, title: '' };
  }));
  return results;
}

/** Identify a ProblemOption — keep pid as the canonical key. */
export function problemKey(p: ProblemOption): string {
  return String(p.pid || p.docId);
}

