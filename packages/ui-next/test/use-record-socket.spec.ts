import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchRecordSocketPayload,
  isTerminalRecordSocketClose,
  useRecordSocket,
} from '../src/hooks/use-record-socket.ts';

const SNAPSHOT_ID = '0123456789abcdef01234567';

/* ─── dispatchRecordSocketPayload ──────────────────────────────────────── */

function dispatch(payload: unknown) {
  const spies = {
    onRdoc: vi.fn(),
    onTeamRoleChange: vi.fn(),
    onTeamCodeAvailable: vi.fn(),
    onRecordScoreAction: vi.fn(),
  };
  dispatchRecordSocketPayload(payload, spies.onRdoc, spies.onTeamRoleChange, spies.onTeamCodeAvailable, spies.onRecordScoreAction);
  return spies;
}

describe('dispatchRecordSocketPayload', () => {
  it('forwards rdoc snapshots without a score action when the key is absent', () => {
    const spies = dispatch({ rdoc: { _id: 'r1', status: 1 } });
    expect(spies.onRdoc).toHaveBeenCalledWith({ _id: 'r1', status: 1 });
    expect(spies.onRecordScoreAction).not.toHaveBeenCalled();
    expect(spies.onTeamRoleChange).not.toHaveBeenCalled();
    expect(spies.onTeamCodeAvailable).not.toHaveBeenCalled();
  });

  it('pairs the score action capability with the rdoc id', () => {
    const spies = dispatch({ rdoc: { _id: 'r2' }, recordScoreAction: { operation: 'cancel' } });
    expect(spies.onRecordScoreAction).toHaveBeenCalledWith({ operation: 'cancel' }, 'r2');
  });

  it('coerces a present-but-empty score action to null and a missing id to an empty string', () => {
    const spies = dispatch({ rdoc: {}, recordScoreAction: undefined });
    expect(spies.onRdoc).toHaveBeenCalledWith({});
    expect(spies.onRecordScoreAction).toHaveBeenCalledWith(null, '');
  });

  it('reports team role changes with a safe non-negative revision and skips the rdoc path', () => {
    const spies = dispatch({ teamRoleChanged: true, teamRevision: 7, rdoc: { _id: 'x' } });
    expect(spies.onTeamRoleChange).toHaveBeenCalledWith(7);
    expect(spies.onRdoc).not.toHaveBeenCalled();
  });

  it('accepts numeric-string revisions and revision zero', () => {
    expect(dispatch({ teamRoleChanged: true, teamRevision: '3' }).onTeamRoleChange).toHaveBeenCalledWith(3);
    expect(dispatch({ teamRoleChanged: true, teamRevision: 0 }).onTeamRoleChange).toHaveBeenCalledWith(0);
  });

  it('degrades unusable revisions to null', () => {
    expect(dispatch({ teamRoleChanged: true, teamRevision: 'abc' }).onTeamRoleChange).toHaveBeenCalledWith(null);
    expect(dispatch({ teamRoleChanged: true, teamRevision: -1 }).onTeamRoleChange).toHaveBeenCalledWith(null);
    expect(dispatch({ teamRoleChanged: true, teamRevision: 1.5 }).onTeamRoleChange).toHaveBeenCalledWith(null);
    expect(dispatch({ teamRoleChanged: true }).onTeamRoleChange).toHaveBeenCalledWith(null);
  });

  it('requires teamRoleChanged to be strictly true', () => {
    const spies = dispatch({ teamRoleChanged: 1, teamRevision: 7 });
    expect(spies.onTeamRoleChange).not.toHaveBeenCalled();
  });

  it('delivers team code snapshots only for well-formed object ids', () => {
    expect(dispatch({ teamCodeAvailable: true, snapshotId: SNAPSHOT_ID }).onTeamCodeAvailable).toHaveBeenCalledWith(SNAPSHOT_ID);
    expect(dispatch({ teamCodeAvailable: true, snapshotId: SNAPSHOT_ID.toUpperCase() }).onTeamCodeAvailable).not.toHaveBeenCalled();
    expect(dispatch({ teamCodeAvailable: true, snapshotId: 'short' }).onTeamCodeAvailable).not.toHaveBeenCalled();
    expect(dispatch({ teamCodeAvailable: true }).onTeamCodeAvailable).not.toHaveBeenCalled();
  });

  it('ignores payloads without any recognized shape', () => {
    for (const payload of [null, undefined, {}, 'text', { html: '<div />' }]) {
      const spies = dispatch(payload);
      expect(spies.onRdoc).not.toHaveBeenCalled();
      expect(spies.onTeamRoleChange).not.toHaveBeenCalled();
      expect(spies.onTeamCodeAvailable).not.toHaveBeenCalled();
      expect(spies.onRecordScoreAction).not.toHaveBeenCalled();
    }
  });
});

/* ─── isTerminalRecordSocketClose ──────────────────────────────────────── */

describe('isTerminalRecordSocketClose', () => {
  it('is terminal only for the team-role channel closing with 4003', () => {
    expect(isTerminalRecordSocketClose('/exam-mode/team-role-conn', 4003)).to.equal(true);
    expect(isTerminalRecordSocketClose('/exam-mode/team-role-conn', 1006)).to.equal(false);
    expect(isTerminalRecordSocketClose('/record-conn', 4003)).to.equal(false);
    expect(isTerminalRecordSocketClose('/record-detail-conn', 4003)).to.equal(false);
  });
});

/* ─── useRecordSocket ──────────────────────────────────────────────────── */

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe('useRecordSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a socket with noTemplate and the serialized filters, skipping nullish values', () => {
    renderHook(() => useRecordSocket({
      filters: { tid: 'abc', page: 2, all: true, uidOrName: undefined },
      onRdoc: vi.fn(),
    }));
    expect(MockWebSocket.instances.length).to.equal(1);
    expect(MockWebSocket.instances[0].url).to.equal(
      `ws://${window.location.host}/record-conn?noTemplate=true&tid=abc&page=2&all=true`,
    );
  });

  it('targets the requested endpoint path', () => {
    renderHook(() => useRecordSocket({ path: '/record-detail-conn', filters: { rid: 'r1' }, onRdoc: vi.fn() }));
    expect(MockWebSocket.instances[0].url).to.equal(
      `ws://${window.location.host}/record-detail-conn?noTemplate=true&rid=r1`,
    );
  });

  it('never connects while disabled', () => {
    renderHook(() => useRecordSocket({ onRdoc: vi.fn(), disabled: true }));
    expect(MockWebSocket.instances.length).to.equal(0);
  });

  it('forwards parsed rdoc frames and ignores malformed json', () => {
    const onRdoc = vi.fn();
    renderHook(() => useRecordSocket({ onRdoc }));
    const ws = MockWebSocket.instances[0];

    ws.onmessage?.({ data: JSON.stringify({ rdoc: { _id: 'r1', status: 1 } }) });
    expect(onRdoc).toHaveBeenCalledWith({ _id: 'r1', status: 1 });

    ws.onmessage?.({ data: '{not json' });
    expect(onRdoc).toHaveBeenCalledTimes(1);
  });

  it('wires the score action callback through to dispatch in the right order', () => {
    const onRdoc = vi.fn();
    const onRecordScoreAction = vi.fn();
    renderHook(() => useRecordSocket({ onRdoc, onRecordScoreAction }));
    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ rdoc: { _id: 'r9' }, recordScoreAction: { operation: 'restore' } }),
    });
    expect(onRdoc).toHaveBeenCalledWith({ _id: 'r9' });
    expect(onRecordScoreAction).toHaveBeenCalledWith({ operation: 'restore' }, 'r9');
  });

  it('reports socket errors through onError', () => {
    const onError = vi.fn();
    renderHook(() => useRecordSocket({ onRdoc: vi.fn(), onError }));
    const boom = new Error('socket down');
    MockWebSocket.instances[0].onerror?.(boom);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('reconnects with exponential backoff after an abnormal close', () => {
    renderHook(() => useRecordSocket({ onRdoc: vi.fn() }));
    expect(MockWebSocket.instances.length).to.equal(1);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances.length).to.equal(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances.length).to.equal(2);

    MockWebSocket.instances[1].onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances.length).to.equal(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances.length).to.equal(3);
  });

  it('retries after the websocket constructor itself throws', () => {
    const onError = vi.fn();
    let attempts = 0;
    vi.stubGlobal('WebSocket', class BlockedWebSocket {
      constructor() {
        attempts += 1;
        throw new Error('blocked');
      }
    });
    renderHook(() => useRecordSocket({ onRdoc: vi.fn(), onError }));
    expect(attempts).to.equal(1);
    expect(onError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(attempts).to.equal(2);
  });

  it('closes the active socket on unmount', () => {
    const { unmount } = renderHook(() => useRecordSocket({ onRdoc: vi.fn() }));
    const ws = MockWebSocket.instances[0];
    expect(ws.closed).to.equal(false);
    unmount();
    expect(ws.closed).to.equal(true);
  });

  it('cancels a pending reconnect on unmount', () => {
    const { unmount } = renderHook(() => useRecordSocket({ onRdoc: vi.fn() }));
    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances.length).to.equal(1);
  });

  it('reopens the socket only when the filter contents actually change', () => {
    const onRdoc = vi.fn();
    const { rerender } = renderHook(
      ({ filters }: { filters: Record<string, string> }) => useRecordSocket({ filters, onRdoc }),
      { initialProps: { filters: { tid: 'a' } } },
    );
    expect(MockWebSocket.instances.length).to.equal(1);

    // same contents, new object identity: no reconnect
    rerender({ filters: { tid: 'a' } });
    expect(MockWebSocket.instances.length).to.equal(1);

    rerender({ filters: { tid: 'b' } });
    expect(MockWebSocket.instances.length).to.equal(2);
    expect(MockWebSocket.instances[0].closed).to.equal(true);
    expect(MockWebSocket.instances[1].url).to.contain('tid=b');
  });

  it('treats a 4003 close on the team-role channel as terminal and resets the role', () => {
    const onTeamRoleChange = vi.fn();
    renderHook(() => useRecordSocket({ path: '/exam-mode/team-role-conn', onRdoc: vi.fn(), onTeamRoleChange }));
    MockWebSocket.instances[0].onclose?.({ code: 4003 });
    expect(onTeamRoleChange).toHaveBeenCalledWith(null);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances.length).to.equal(1);
  });

  it('suppresses the terminal null reset when a revision bump already arrived', () => {
    const onTeamRoleChange = vi.fn();
    renderHook(() => useRecordSocket({ path: '/exam-mode/team-role-conn', onRdoc: vi.fn(), onTeamRoleChange }));
    const ws = MockWebSocket.instances[0];
    ws.onmessage?.({ data: JSON.stringify({ teamRoleChanged: true, teamRevision: 4 }) });
    expect(onTeamRoleChange).toHaveBeenCalledWith(4);
    ws.onclose?.({ code: 4003 });
    expect(onTeamRoleChange).toHaveBeenCalledTimes(1);
  });
});
