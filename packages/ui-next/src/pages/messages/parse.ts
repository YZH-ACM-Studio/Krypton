import { FLAG_UNREAD } from './flags';
import type { Conv, MessageDoc, MessageUser } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUidKey(raw: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const uid = Number(raw);
  if (!Number.isSafeInteger(uid) || uid < 0) return null;
  return uid;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function parseMessageTo(value: unknown): number | number[] | undefined {
  const single = parseOptionalNumber(value);
  if (single !== undefined) return single;
  if (!Array.isArray(value)) return undefined;
  const uids: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return undefined;
    uids.push(item);
  }
  return uids;
}

function parseMessageUser(value: unknown): MessageUser {
  if (!isRecord(value)) return {};
  const udoc: MessageUser = {};
  const id = parseOptionalNumber(value._id);
  if (id !== undefined) udoc._id = id;
  if (typeof value.uname === 'string') udoc.uname = value.uname;
  if (typeof value.avatarUrl === 'string') udoc.avatarUrl = value.avatarUrl;
  return udoc;
}

function parseMessageDoc(value: unknown): MessageDoc | null {
  if (!isRecord(value) || typeof value._id !== 'string') return null;
  const message: MessageDoc = { _id: value._id };
  const from = parseOptionalNumber(value.from);
  if (from !== undefined) message.from = from;
  const to = parseMessageTo(value.to);
  if (to !== undefined) message.to = to;
  const flag = parseOptionalNumber(value.flag);
  if (flag !== undefined) message.flag = flag;
  if ('content' in value) message.content = value.content;
  return message;
}

export function objectIdDate(id: unknown): Date | null {
  const value = String(id || '');
  if (!/^[0-9a-f]{24}$/i.test(value)) return null;
  const timestamp = Number.parseInt(value.slice(0, 8), 16) * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function parseSystemMessage(content: unknown): { message: string; params: unknown[] } | null {
  if (typeof content !== 'string') return null;
  try {
    const data: unknown = JSON.parse(content);
    if (!isRecord(data) || typeof data.message !== 'string') return null;
    return {
      message: data.message,
      params: Array.isArray(data.params) ? data.params : [],
    };
  } catch {
    return null;
  }
}

export function getMessagePreview(message: MessageDoc): string {
  const system = parseSystemMessage(message.content);
  if (!system) return String(message.content || '');
  return system.message.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const index = Number.parseInt(key.split(':')[0], 10);
    return String(system.params[index] || '');
  });
}

export function messageTime(message: MessageDoc): number {
  return objectIdDate(message._id)?.getTime() || 0;
}

/** Oldest first. Hydro GET currently pushes newest-first; IM threads need chronological order. */
export function chronologicalMessages(messages: MessageDoc[]): MessageDoc[] {
  return [...messages].sort((a, b) => {
    const delta = messageTime(a) - messageTime(b);
    if (delta !== 0) return delta;
    return String(a._id).localeCompare(String(b._id));
  });
}

export function lastMessage(messages: MessageDoc[]): MessageDoc | undefined {
  const ordered = chronologicalMessages(messages);
  return ordered[ordered.length - 1];
}

export function lastMessageTime(messages: MessageDoc[]): number {
  const last = lastMessage(messages);
  if (!last) return 0;
  return messageTime(last);
}

export function countUnread(conv: Conv, selfUid: number): number {
  let n = 0;
  for (const message of conv.messages) {
    if (message.from === selfUid) continue;
    if ((message.flag ?? 0) & FLAG_UNREAD) n += 1;
  }
  return n;
}

export function parseConversations(raw: unknown): Conv[] {
  if (!isRecord(raw)) return [];
  const result: Conv[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const uid = parseUidKey(key);
    if (uid === null || !isRecord(value)) continue;
    const messages: MessageDoc[] = [];
    if (Array.isArray(value.messages)) {
      for (const item of value.messages) {
        const message = parseMessageDoc(item);
        if (message) messages.push(message);
      }
    }
    result.push({
      uid,
      udoc: parseMessageUser(value.udoc),
      messages: chronologicalMessages(messages),
    });
  }
  result.sort((a, b) => lastMessageTime(b.messages) - lastMessageTime(a.messages));
  return result;
}

export function createPendingConv(uid: number, udoc?: MessageUser): Conv {
  return {
    uid,
    udoc: {
      ...udoc,
      _id: udoc?._id ?? uid,
      uname: udoc?.uname || `UID ${uid}`,
    },
    messages: [],
  };
}

/** Insert or replace one conversation without dropping the rest of the inbox. */
export function upsertConversation(convs: Conv[], conv: Conv): Conv[] {
  const byUid = new Map<number, Conv>();
  for (const item of convs) byUid.set(item.uid, item);
  const existing = byUid.get(conv.uid);
  if (existing && existing.messages.length > 0 && conv.messages.length === 0) {
    byUid.set(conv.uid, {
      uid: existing.uid,
      udoc: { ...existing.udoc, ...conv.udoc },
      messages: existing.messages,
    });
    return Array.from(byUid.values());
  }
  byUid.set(conv.uid, {
    uid: conv.uid,
    udoc: { ...existing?.udoc, ...conv.udoc },
    messages: chronologicalMessages(conv.messages.length ? conv.messages : existing?.messages || []),
  });
  return Array.from(byUid.values());
}

export function mergeConversations(prev: Conv[], next: Conv[]): Conv[] {
  const byUid = new Map<number, Conv>();
  for (const conv of next) {
    byUid.set(conv.uid, {
      uid: conv.uid,
      udoc: conv.udoc,
      messages: chronologicalMessages(conv.messages),
    });
  }
  for (const conv of prev) {
    if (byUid.has(conv.uid)) continue;
    // Keep locally opened empty threads until the server returns real messages.
    if (conv.messages.length === 0) {
      byUid.set(conv.uid, {
        uid: conv.uid,
        udoc: conv.udoc,
        messages: [],
      });
    }
  }
  return Array.from(byUid.values());
}

export function sortConversations(convs: Conv[], pinnedUids: number[]): Conv[] {
  const pinned = new Set(pinnedUids);
  return [...convs].sort((a, b) => {
    const aPinned = pinned.has(a.uid) ? 1 : 0;
    const bPinned = pinned.has(b.uid) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return lastMessageTime(b.messages) - lastMessageTime(a.messages);
  });
}
