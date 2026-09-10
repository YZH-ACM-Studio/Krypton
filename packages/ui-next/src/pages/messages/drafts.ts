const DRAFT_PREFIX = 'krypton:messages:draft:';

function sessionStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function draftKey(uid: number): string {
  return `${DRAFT_PREFIX}${uid}`;
}

export function loadDraft(uid: number): string {
  try {
    const storage = sessionStore();
    if (!storage) return '';
    const value = storage.getItem(draftKey(uid));
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function saveDraft(uid: number, text: string): void {
  try {
    const storage = sessionStore();
    if (!storage) return;
    storage.setItem(draftKey(uid), text);
  } catch {
    // ignore quota / private mode
  }
}

export function clearDraft(uid: number): void {
  try {
    const storage = sessionStore();
    if (!storage) return;
    storage.removeItem(draftKey(uid));
  } catch {
    // ignore
  }
}
