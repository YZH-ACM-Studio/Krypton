function parsePositiveInt(raw: string | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!/^[1-9]\d{0,15}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function queryFromSearch(search: string): URLSearchParams {
  const qIndex = search.indexOf('?');
  let query = qIndex >= 0 ? search.slice(qIndex + 1) : search;
  const hashIndex = query.indexOf('#');
  if (hashIndex >= 0) query = query.slice(0, hashIndex);
  return new URLSearchParams(query);
}

export function readMessageTarget(search: string, selfUid: number): number | null {
  const params = queryFromSearch(search);
  const target = parsePositiveInt(params.get('target')) ?? parsePositiveInt(params.get('uid'));
  if (target == null || target === selfUid) return null;
  return target;
}

export function writeMessageTarget(uid: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('uid');
    if (uid == null || !Number.isSafeInteger(uid) || uid <= 0) url.searchParams.delete('target');
    else url.searchParams.set('target', String(uid));
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // ignore
  }
}
