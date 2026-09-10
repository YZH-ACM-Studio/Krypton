import { FLAG_UNREAD } from './flags';
import type { MessageDoc } from './types';

const SEEN_KEY = 'krypton:messages:seen';
const MAX_SEEN = 2000;

function sessionStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parseSeenList(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'string' || item === '' || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids.length > MAX_SEEN ? ids.slice(ids.length - MAX_SEEN) : ids;
}

function persistSeen(ids: string[]): Set<string> {
  try {
    const storage = sessionStore();
    if (storage) storage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
  return new Set(ids);
}

export function loadSeen(): Set<string> {
  try {
    const storage = sessionStore();
    if (!storage) return new Set();
    return new Set(parseSeenList(storage.getItem(SEEN_KEY)));
  } catch {
    return new Set();
  }
}

export function markConvSeen(ids: string[]): Set<string> {
  const ordered = Array.from(loadSeen());
  const present = new Set(ordered);
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || present.has(id)) continue;
    ordered.push(id);
    present.add(id);
  }
  const trimmed = ordered.length > MAX_SEEN ? ordered.slice(ordered.length - MAX_SEEN) : ordered;
  return persistSeen(trimmed);
}

export function isUnseenIncoming(message: MessageDoc, selfUid: number, seen: Set<string>): boolean {
  if (message.from === selfUid) return false;
  if (!((message.flag ?? 0) & FLAG_UNREAD)) return false;
  return !seen.has(String(message._id));
}
