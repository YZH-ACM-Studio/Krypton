import { FLAG_UNREAD } from './flags';
import type { MessageDoc } from './types';

export function isUnseenIncoming(message: MessageDoc, selfUid: number, seen: Set<string>): boolean {
  if (message.from === selfUid) return false;
  if (!((message.flag ?? 0) & FLAG_UNREAD)) return false;
  return !seen.has(String(message._id));
}
