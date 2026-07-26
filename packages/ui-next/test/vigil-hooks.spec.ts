import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyCommandResult, useProctorCommands } from '../src/hooks/use-proctor-commands.ts';
import { useVigilSocket, type SnapshotMsg, type VigilEventMessage } from '../src/hooks/use-vigil-socket.ts';
import { invalidateVigilTokenCache } from '../src/lib/vigil-api.ts';

const TOKEN_ENDPOINT = '/api/admin/vigil/dashboard-token';

function tokenBody() {
  return {
    token: 'tk-1',
    vigilBaseUrl: 'http://vigil.example',
    vigilWsUrl: 'ws://vigil.example/ws',
    expiresAt: Date.now() + 3_600_000,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Drain chained microtasks (token fetch → json → api fetch → json → …). */
async function flushAsync(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/* ─── useVigilSocket ───────────────────────────────────────────────────── */

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe('useVigilSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url) === TOKEN_ENDPOINT) return jsonResponse(tokenBody());
      throw new Error(`unexpected fetch: ${String(url)}`);
    }));
  });

  async function renderConnectedSocket(onMessage?: (msg: VigilEventMessage) => void) {
    const rendered = renderHook(() => useVigilSocket(onMessage ? { onMessage } : {}));
    await act(async () => {
      await flushAsync();
    });
    expect(MockWebSocket.instances.length).to.equal(1);
    return { ...rendered, ws: MockWebSocket.instances[0] };
  }

  it('does not fetch a token or open a socket when disabled', async () => {
    renderHook(() => useVigilSocket({ enabled: false }));
    await act(async () => {
      await flushAsync();
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(MockWebSocket.instances.length).to.equal(0);
  });

  it('connects with the token in the query string and reports the open state', async () => {
    const { result, ws } = await renderConnectedSocket();
    expect(ws.url).to.equal('ws://vigil.example/ws?token=tk-1');
    expect(result.current.connected).to.equal(false);
    act(() => ws.open());
    expect(result.current.connected).to.equal(true);
  });

  it('sends subscribe/unsubscribe frames with a default page size of 30', async () => {
    const { result, ws } = await renderConnectedSocket();
    act(() => ws.open());

    act(() => result.current.subscribeContest({ contestId: 'c1', page: 2, machineIds: ['m1', 'm2'] }));
    expect(JSON.parse(ws.sent.at(-1)!)).to.deep.equal({
      subscribe: { contestId: 'c1', page: 2, pageSize: 30, machineIds: ['m1', 'm2'] },
    });

    act(() => result.current.subscribeContest(null));
    expect(JSON.parse(ws.sent.at(-1)!)).to.deep.equal({ unsubscribe: true });
  });

  it('queues a subscription made before the socket opens and flushes it on open', async () => {
    const { result, ws } = await renderConnectedSocket();

    act(() => result.current.subscribeContest({ contestId: 'c9', page: 1, pageSize: 10, machineIds: ['m9'] }));
    expect(ws.sent.length).to.equal(0);

    act(() => ws.open());
    expect(JSON.parse(ws.sent.at(-1)!)).to.deep.equal({
      subscribe: { contestId: 'c9', page: 1, pageSize: 10, machineIds: ['m9'] },
    });
  });

  it('stores snapshots, forwards every parsed message, and ignores malformed frames', async () => {
    const seen: VigilEventMessage[] = [];
    const { result, ws } = await renderConnectedSocket((msg) => seen.push(msg));
    act(() => ws.open());

    const snapshot: SnapshotMsg = {
      type: 'snapshot',
      sent_at: 'now',
      clients: [],
      recent_events: [],
      recent_commands: [],
      recent_screenshots: [],
    };
    act(() => ws.onmessage?.({ data: JSON.stringify(snapshot) }));
    expect(result.current.lastSnapshot).to.deep.equal(snapshot);

    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'approval_resolved', approvalId: 'a1', status: 'approved', sessionId: null }) }));
    expect(seen.map((m) => m.type)).to.deep.equal(['snapshot', 'approval_resolved']);

    act(() => ws.onmessage?.({ data: 'not-json{' }));
    expect(seen.length).to.equal(2);
  });

  it('closes the socket on unmount', async () => {
    const { ws, unmount } = await renderConnectedSocket();
    act(() => ws.open());
    unmount();
    expect(ws.readyState).to.equal(MockWebSocket.CLOSED);
  });
});

/* ─── useProctorCommands ───────────────────────────────────────────────── */

const COMMANDS_URL = 'http://vigil.example/api/admin/vigil/proctor/commands';

function stubCommandFetch(response: () => Response) {
  const fn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url) === TOKEN_ENDPOINT) return jsonResponse(tokenBody());
    if (String(url) === COMMANDS_URL) return response();
    throw new Error(`unexpected fetch: ${String(url)}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('useProctorCommands', () => {
  beforeEach(() => {
    invalidateVigilTokenCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores command results for unknown command ids', () => {
    expect(() => notifyCommandResult({ type: 'command_result', commandId: 'nope', machineId: 'm1', result: 'ok' })).to.not.throw();
  });

  it('resolves a single-target command once the matching ws result arrives', async () => {
    stubCommandFetch(() => jsonResponse({ commandId: 'cmd-1', accepted: 1 }));
    const { result } = renderHook(() => useProctorCommands({ contestId: 'c1' }));

    const pendingSend = result.current.sendCommand({ targetMachineId: 'm1', command: 'lock_screen' });
    await flushAsync();

    notifyCommandResult({ type: 'command_result', commandId: 'cmd-1', machineId: 'm1', result: 'ok' });
    const outcome = await pendingSend;
    expect(outcome.accepted).to.equal(1);
    expect(outcome.result?.result).to.equal('ok');
  });

  it('falls back to a timeout result when no ws reply arrives in 5s', async () => {
    stubCommandFetch(() => jsonResponse({ commandId: 'cmd-2', accepted: 1 }));
    const { result } = renderHook(() => useProctorCommands({ contestId: 'c1' }));

    const pendingSend = result.current.sendCommand({ targetMachineId: 'm1', command: 'capture_screenshot' });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(5_000);

    const outcome = await pendingSend;
    expect(outcome.result?.result).to.equal('timeout');
    expect(outcome.result?.machineId).to.equal('m1');
    expect(outcome.result?.errorMessage).to.equal('客户端在 5 秒内未回执');
  });

  it('resolves group sends immediately from the accepted/rejected breakdown', async () => {
    const fn = stubCommandFetch(() => jsonResponse({ commandId: '', accepted: 2, rejected: [{ machineId: 'm3', reason: 'offline' }] }));
    const { result } = renderHook(() => useProctorCommands({ contestId: 'c1' }));

    const outcome = await result.current.sendCommand({ audienceFilter: 'all', command: 'show_message', payload: { body: 'hi' } });
    expect(outcome).to.deep.equal({ accepted: 2, result: null, rejected: [{ machineId: 'm3', reason: 'offline' }] });

    const commandCall = fn.mock.calls.find(([url]) => String(url) === COMMANDS_URL)!;
    expect(JSON.parse(String(commandCall[1]?.body))).to.deep.equal({
      contestId: 'c1',
      audienceFilter: 'all',
      command: 'show_message',
      payload: { body: 'hi' },
    });
  });

  it('rethrows http failures from the command endpoint', async () => {
    stubCommandFetch(() => jsonResponse({ detail: 'forbidden' }, 403));
    const { result } = renderHook(() => useProctorCommands({ contestId: 'c1' }));

    let thrown: unknown;
    try {
      await result.current.sendCommand({ targetMachineId: 'm1', command: 'flush_logs' });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error).message).to.contain('403 forbidden');
  });
});
