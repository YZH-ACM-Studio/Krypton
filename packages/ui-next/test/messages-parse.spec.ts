import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../src/pages/messages/drafts.ts';
import { FLAG_UNREAD } from '../src/pages/messages/flags.ts';
import {
  createPendingConv,
  lastMessageTime,
  mergeConversations,
  parseConversations,
  sortConversations,
  upsertConversation,
} from '../src/pages/messages/parse.ts';
import { loadPins, togglePin } from '../src/pages/messages/pins.ts';
import { isUnseenIncoming } from '../src/pages/messages/seen.ts';
import type { Conv, MessageDoc } from '../src/pages/messages/types.ts';
import { readMessageTarget, writeMessageTarget } from '../src/pages/messages/url.ts';

/** Mongo ObjectId timestamp occupies the first 4 bytes (8 hex chars) as unix seconds. */
function objectIdAt(epochSeconds: number): string {
  return `${epochSeconds.toString(16).padStart(8, '0')}${'0'.repeat(16)}`;
}

function conv(uid: number, messages: MessageDoc[], uname?: string): Conv {
  return {
    uid,
    udoc: uname === undefined ? {} : { uname },
    messages,
  };
}

describe('parseConversations', () => {
  it('returns an empty list for null or an array', () => {
    expect(parseConversations(null)).toEqual([]);
    expect(parseConversations([])).toEqual([]);
    expect(parseConversations([{ uid: 3 }])).toEqual([]);
  });

  it('skips junk entries and keeps valid uid keys', () => {
    const raw: Record<string, unknown> = {
      '': { messages: [] },
      abc: { messages: [] },
      '01': { messages: [{ _id: objectIdAt(1) }] },
      '-2': { messages: [] },
      3: 'nope',
      4: [{ _id: objectIdAt(1) }],
      0: { udoc: { uname: 'System' }, messages: [] },
      12: {
        udoc: { _id: 12, uname: 'Eve' },
        messages: [{ _id: objectIdAt(3), content: 'ok' }, null, { _id: 99 }, { content: 'no id' }],
      },
    };

    expect(parseConversations(raw)).toEqual([
      {
        uid: 12,
        udoc: { _id: 12, uname: 'Eve' },
        messages: [{ _id: objectIdAt(3), content: 'ok' }],
      },
      {
        uid: 0,
        udoc: { uname: 'System' },
        messages: [],
      },
    ]);
  });

  it('sorts messages oldest-first even when the input is newest-first', () => {
    const parsed = parseConversations({
      7: {
        udoc: { uname: 'Ada' },
        messages: [
          { _id: objectIdAt(9), content: 'c' },
          { _id: objectIdAt(5), content: 'b' },
          { _id: objectIdAt(1), content: 'a' },
        ],
      },
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].messages.map((message) => message.content)).toEqual(['a', 'b', 'c']);
    expect(parsed[0].messages.map((message) => message._id)).toEqual([
      objectIdAt(1),
      objectIdAt(5),
      objectIdAt(9),
    ]);
  });
});

describe('lastMessageTime', () => {
  it('uses the newest ObjectId regardless of input order', () => {
    const older = { _id: objectIdAt(100) };
    const newer = { _id: objectIdAt(250) };
    expect(lastMessageTime([newer, older])).toBe(250_000);
    expect(lastMessageTime([older, newer])).toBe(250_000);
  });
});

describe('mergeConversations', () => {
  it('keeps empty pending conversations and replaces messages for known uids', () => {
    const pending = createPendingConv(20, { uname: 'Pat' });
    const known = conv(21, [{ _id: objectIdAt(1), content: 'old' }], 'Known');
    const extra = conv(22, [{ _id: objectIdAt(2), content: 'gone' }], 'Gone');
    const next = [
      conv(
        21,
        [
          { _id: objectIdAt(9), content: 'new' },
          { _id: objectIdAt(3), content: 'mid' },
        ],
        'Known++',
      ),
    ];

    expect(mergeConversations([pending, known, extra], next)).toEqual([
      {
        uid: 21,
        udoc: { uname: 'Known++' },
        messages: [
          { _id: objectIdAt(3), content: 'mid' },
          { _id: objectIdAt(9), content: 'new' },
        ],
      },
      {
        uid: 20,
        udoc: { _id: 20, uname: 'Pat' },
        messages: [],
      },
    ]);
  });
});

describe('upsertConversation', () => {
  it('adds a pending conversation without dropping the rest of the inbox', () => {
    const alice = conv(3, [{ _id: objectIdAt(1), content: 'hi' }], 'Alice');
    const bob = conv(4, [{ _id: objectIdAt(2), content: 'yo' }], 'Bob');
    const next = upsertConversation([alice, bob], createPendingConv(9));
    expect(next.map((item) => item.uid).sort((a, b) => a - b)).toEqual([3, 4, 9]);
    expect(next.find((item) => item.uid === 3)?.messages).toEqual(alice.messages);
  });

  it('does not replace an existing thread with an empty pending stub', () => {
    const alice = conv(3, [{ _id: objectIdAt(1), content: 'hi' }], 'Alice');
    const next = upsertConversation([alice], createPendingConv(3, { uname: 'Alice2' }));
    expect(next).toHaveLength(1);
    expect(next[0].messages).toEqual(alice.messages);
    expect(next[0].udoc.uname).toBe('Alice2');
  });
});

describe('sortConversations', () => {
  it('places pinned conversations first, then newest last-message time', () => {
    const pinnedOld = conv(10, [{ _id: objectIdAt(1) }]);
    const unpinnedNewest = conv(11, [{ _id: objectIdAt(9) }]);
    const pinnedNewer = conv(12, [{ _id: objectIdAt(5) }]);

    expect(sortConversations([unpinnedNewest, pinnedOld, pinnedNewer], [10, 12]).map((item) => item.uid)).toEqual([
      12, 10, 11,
    ]);
  });
});

describe('createPendingConv', () => {
  it('falls back to UID n when uname is missing', () => {
    expect(createPendingConv(8)).toEqual({
      uid: 8,
      udoc: { _id: 8, uname: 'UID 8' },
      messages: [],
    });
    expect(createPendingConv(8, { uname: '' }).udoc.uname).toBe('UID 8');
    expect(createPendingConv(8, { uname: 'Zed', avatarUrl: '/z.png' })).toEqual({
      uid: 8,
      udoc: { uname: 'Zed', avatarUrl: '/z.png', _id: 8 },
      messages: [],
    });
  });
});

describe('readMessageTarget', () => {
  it('prefers target over uid and rejects self and 0', () => {
    expect(readMessageTarget('?target=5&uid=8', 1)).toBe(5);
    expect(readMessageTarget('?uid=8', 1)).toBe(8);
    expect(readMessageTarget('?target=1&uid=8', 1)).toBeNull();
    expect(readMessageTarget('?uid=1', 1)).toBeNull();
    expect(readMessageTarget('?target=0', 1)).toBeNull();
    expect(readMessageTarget('?uid=0', 1)).toBeNull();
    expect(readMessageTarget('?target=0&uid=8', 1)).toBe(8);
  });
});

describe('writeMessageTarget', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/home/messages');
  });

  it('replaceState writes target and drops uid', () => {
    window.history.replaceState({ page: 'messages' }, '', '/home/messages?uid=9#pane');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    writeMessageTarget(4);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith({ page: 'messages' }, '', '/home/messages?target=4#pane');
  });

  it('replaceState clears target when the uid is null', () => {
    window.history.replaceState({ page: 'messages' }, '', '/home/messages?target=4&uid=9');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    writeMessageTarget(null);

    expect(replaceState).toHaveBeenCalledWith({ page: 'messages' }, '', '/home/messages');
  });

  it('does not replaceState when the url is already canonical', () => {
    window.history.replaceState({}, '', '/home/messages?target=4');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    writeMessageTarget(4);

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('drafts', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('saves, loads, and clears drafts via sessionStorage', () => {
    expect(loadDraft(7)).toBe('');
    saveDraft(7, 'hello');
    saveDraft(8, 'other');
    expect(sessionStorage.getItem('krypton:messages:draft:7')).toBe('hello');
    expect(loadDraft(7)).toBe('hello');
    expect(loadDraft(8)).toBe('other');
    clearDraft(7);
    expect(sessionStorage.getItem('krypton:messages:draft:7')).toBeNull();
    expect(loadDraft(7)).toBe('');
    expect(loadDraft(8)).toBe('other');
  });
});

describe('pins', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('toggles a uid in and out of the pin list', () => {
    expect(loadPins()).toEqual([]);
    expect(togglePin(3)).toEqual([3]);
    expect(togglePin(8)).toEqual([3, 8]);
    expect(localStorage.getItem('krypton:messages:pins')).toBe(JSON.stringify([3, 8]));
    expect(togglePin(3)).toEqual([8]);
    expect(loadPins()).toEqual([8]);
    expect(togglePin(8)).toEqual([]);
    expect(loadPins()).toEqual([]);
  });
});

describe('isUnseenIncoming', () => {
  it('is true only for FLAG_UNREAD incoming messages not in seen', () => {
    const incoming: MessageDoc = { _id: 'm1', from: 9, flag: FLAG_UNREAD };
    expect(isUnseenIncoming(incoming, 2, new Set())).toBe(true);
    expect(isUnseenIncoming(incoming, 2, new Set(['m1']))).toBe(false);
    expect(isUnseenIncoming({ ...incoming, from: 2 }, 2, new Set())).toBe(false);
    expect(isUnseenIncoming({ _id: 'm1', from: 9 }, 2, new Set())).toBe(false);
    expect(isUnseenIncoming({ _id: 'm1', from: 9, flag: 0 }, 2, new Set())).toBe(false);
  });
});
