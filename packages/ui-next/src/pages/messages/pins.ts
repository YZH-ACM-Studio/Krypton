const PINS_KEY = 'krypton:messages:pins';

function localStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parsePinList(raw: string | null): number[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const uids: number[] = [];
  const seen = new Set<number>();
  for (const item of parsed) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0 || seen.has(item)) continue;
    seen.add(item);
    uids.push(item);
  }
  return uids;
}

export function loadPins(): number[] {
  try {
    const storage = localStore();
    if (!storage) return [];
    return parsePinList(storage.getItem(PINS_KEY));
  } catch {
    return [];
  }
}

export function togglePin(uid: number): number[] {
  const current = loadPins();
  if (!Number.isSafeInteger(uid) || uid <= 0) return current;
  const next = current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid];
  try {
    const storage = localStore();
    if (storage) storage.setItem(PINS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}
