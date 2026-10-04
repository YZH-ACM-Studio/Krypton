import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vigilApi from '../src/lib/vigil-api.ts';

const { invalidateVigilTokenCache, VigilOfflineError } = vigilApi;

const BASE_URL = 'http://vigil.example';
const TOKEN_ENDPOINT = '/api/admin/vigil/dashboard-token';
const ACTOR = { uid: 7, displayName: 'T' };

const WATCH_STATE = {
  leaseId: 'lease_abc',
  status: 'starting',
  reason: null,
  detail: '',
  mode: 'watch',
  recording: false,
  streams: { screen: '/vigil-flv/live-nodvr/c1_m1_screen.flv', camera: null },
  renewAfterMs: 2000,
  leaseTtlMs: 45000,
};

interface Actor { uid: number; displayName: string }
type WatchFn = (contestId: string, machineId: string, actor: Actor) => Promise<unknown>;
type LeaseFn = (leaseId: string) => Promise<unknown>;
type RecordFn = (contestId: string, machineId: string, enabled: boolean, actor: Actor) => Promise<unknown>;
type NodesFn = () => Promise<unknown>;
type LeaseLostCtor = new (message?: string) => Error;

function readExport(name: string): unknown {
  const bag: Record<string, unknown> = { ...vigilApi };
  return bag[name];
}

function mustExport<T>(name: string): T {
  const value = readExport(name);
  expect(typeof value, `missing export ${name}`).toBe('function');
  return value as T;
}

function tokenBody() {
  return {
    token: 'tk-1',
    vigilBaseUrl: BASE_URL,
    vigilWsUrl: 'ws://vigil.example/ws',
    expiresAt: Date.now() + 3_600_000,
  };
}

interface MockResponseSpec {
  status?: number;
  contentType?: string | null;
  json?: unknown;
  text?: string;
}

function mockResponse({ status = 200, contentType = 'application/json', json, text }: MockResponseSpec = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => {
      if (json === undefined) throw new SyntaxError('not json');
      return json;
    },
    text: async () => text ?? (json === undefined ? '' : JSON.stringify(json)),
  } as unknown as Response;
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Routes the dashboard-token endpoint automatically; everything else goes to `handler`. */
function stubVigilFetch(handler: FetchHandler = () => mockResponse({ json: {} })) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === TOKEN_ENDPOINT) return mockResponse({ json: tokenBody() });
    return await handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject');
}

function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

beforeEach(() => {
  invalidateVigilTokenCache();
});

describe('watchStudentStream', () => {
  it('posts the contest, machine, and actor and returns the response json', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: WATCH_STATE }));
    const watchStudentStream = mustExport<WatchFn>('watchStudentStream');
    const result = await watchStudentStream('c1', 'm1', ACTOR);
    expect(String(fn.mock.calls[0]?.[0])).toBe(TOKEN_ENDPOINT);
    const [url, init] = fn.mock.calls[1];
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/watch`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ contestId: 'c1', machineId: 'm1', actor: ACTOR });
    expect(result).toEqual(WATCH_STATE);
  });
});

describe('renewStudentStream', () => {
  it('posts to the renew url and returns the response json', async () => {
    const renewed = { ...WATCH_STATE, status: 'live', renewAfterMs: 15000 };
    const fn = stubVigilFetch(() => mockResponse({ json: renewed }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const result = await renewStudentStream('lease_1');
    const [url, init] = fn.mock.calls[1];
    expect(String(url).endsWith('/streams/watch/lease_1/renew')).toBe(true);
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/watch/lease_1/renew`);
    expect(init?.method).toBe('POST');
    expect(result).toEqual(renewed);
  });

  it('encodes the lease id in the renew path', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: WATCH_STATE }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    await renewStudentStream('a/b');
    const [url] = fn.mock.calls[1];
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/watch/${encodeURIComponent('a/b')}/renew`);
  });

  it('rejects a 404 as VigilLeaseLostError', async () => {
    const fn = stubVigilFetch(() => mockResponse({ status: 404, json: { detail: 'lease_not_found' } }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const LeaseLost = mustExport<LeaseLostCtor>('VigilLeaseLostError');
    const err = await captureError(renewStudentStream('lease_1'));
    const [url, init] = fn.mock.calls[1];
    expect(String(url).endsWith('/streams/watch/lease_1/renew')).toBe(true);
    expect(init?.method).toBe('POST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LeaseLost);
    expect((err as Error).name).toBe('VigilLeaseLostError');
    expect((err as Error).message).toBe('lease_not_found');
  });

  it('does not treat a non-404 detail that merely ends with ": 404" as a lost lease', async () => {
    stubVigilFetch(() => mockResponse({ status: 400, json: { detail: 'code: 404' } }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const LeaseLost = mustExport<LeaseLostCtor>('VigilLeaseLostError');
    const err = await captureError(renewStudentStream('lease_1'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LeaseLost);
    expect(err).not.toBeInstanceOf(VigilOfflineError);
    expect((err as Error).message).toBe(
      'Vigil POST /api/admin/vigil/proctor/streams/watch/lease_1/renew: 400 code: 404',
    );
  });

  it('rethrows a 400 as a plain Error and not VigilLeaseLostError', async () => {
    stubVigilFetch(() => mockResponse({ status: 400, json: { detail: 'bad_request' } }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const LeaseLost = mustExport<LeaseLostCtor>('VigilLeaseLostError');
    const err = await captureError(renewStudentStream('lease_1'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LeaseLost);
    expect(err).not.toBeInstanceOf(VigilOfflineError);
    expect((err as Error).message).toBe(
      'Vigil POST /api/admin/vigil/proctor/streams/watch/lease_1/renew: 400 bad_request',
    );
  });

  it('rethrows a 400 when the detail mentions 404 but the status is not 404', async () => {
    stubVigilFetch(() => mockResponse({ status: 400, json: { detail: 'see 404 notes' } }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const LeaseLost = mustExport<LeaseLostCtor>('VigilLeaseLostError');
    const err = await captureError(renewStudentStream('lease_1'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LeaseLost);
    expect(err).not.toBeInstanceOf(VigilOfflineError);
    expect((err as Error).message).toBe(
      'Vigil POST /api/admin/vigil/proctor/streams/watch/lease_1/renew: 400 see 404 notes',
    );
  });

  it('rethrows a 5xx offline error even when the body contains a 404 status fragment', async () => {
    stubVigilFetch(() => mockResponse({ status: 500, text: 'oops : 404 happened' }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const LeaseLost = mustExport<LeaseLostCtor>('VigilLeaseLostError');
    const err = await captureError(renewStudentStream('lease_1'));
    expect(err).toBeInstanceOf(VigilOfflineError);
    expect(err).not.toBeInstanceOf(LeaseLost);
    expect((err as InstanceType<typeof VigilOfflineError>).reason).toBe('server_5xx');
    expect((err as Error).message).toBe('Vigil offline: server_5xx (oops : 404 happened)');
  });

  it('encodes every reserved character in the renew lease id', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: WATCH_STATE }));
    const renewStudentStream = mustExport<LeaseFn>('renewStudentStream');
    const leaseId = 'a/b c?';
    await renewStudentStream(leaseId);
    const [url, init] = fn.mock.calls[1];
    expect(url).toBe(
      `${BASE_URL}/api/admin/vigil/proctor/streams/watch/${encodeURIComponent(leaseId)}/renew`,
    );
    expect(init?.method).toBe('POST');
  });
});

describe('releaseStudentStream', () => {
  it('sends DELETE with keepalive and resolves undefined on a 500', async () => {
    const fn = stubVigilFetch(() => mockResponse({ status: 500, text: 'down' }));
    const releaseStudentStream = mustExport<LeaseFn>('releaseStudentStream');
    await expect(releaseStudentStream('lease_1')).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[1];
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/watch/lease_1`);
    expect(String(url).endsWith('/renew')).toBe(false);
    expect(init?.method).toBe('DELETE');
    expect(init?.keepalive).toBe(true);
  });

  it('resolves undefined after a successful delete instead of the response body', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { ok: true } }));
    const releaseStudentStream = mustExport<LeaseFn>('releaseStudentStream');
    await expect(releaseStudentStream('a/b')).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[1];
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/watch/${encodeURIComponent('a/b')}`);
    expect(init?.method).toBe('DELETE');
    expect(init?.keepalive).toBe(true);
  });

  it('swallows a 404 instead of throwing VigilLeaseLostError', async () => {
    stubVigilFetch(() => mockResponse({ status: 404, json: { detail: 'lease_not_found' } }));
    const releaseStudentStream = mustExport<LeaseFn>('releaseStudentStream');
    await expect(releaseStudentStream('lease_1')).resolves.toBeUndefined();
  });

  it('resolves undefined when the vigil request fails before a response', async () => {
    stubVigilFetch(() => {
      throw new TypeError('socket hang up');
    });
    const releaseStudentStream = mustExport<LeaseFn>('releaseStudentStream');
    await expect(releaseStudentStream('lease_1')).resolves.toBeUndefined();
  });

  it('encodes every reserved character in the release lease id', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { ok: true } }));
    const releaseStudentStream = mustExport<LeaseFn>('releaseStudentStream');
    const leaseId = 'a/b c?';
    await expect(releaseStudentStream(leaseId)).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[1];
    expect(url).toBe(
      `${BASE_URL}/api/admin/vigil/proctor/streams/watch/${encodeURIComponent(leaseId)}`,
    );
    expect(String(url).endsWith('/renew')).toBe(false);
    expect(init?.method).toBe('DELETE');
    expect(init?.keepalive).toBe(true);
  });
});

describe('setManualRecording', () => {
  it('posts the contest, machine, enabled flag, and actor to the record url', async () => {
    const payload = { ok: true, recording: true };
    const fn = stubVigilFetch(() => mockResponse({ json: payload }));
    const setManualRecording = mustExport<RecordFn>('setManualRecording');
    const result = await setManualRecording('c1', 'm1', true, ACTOR);
    const [url, init] = fn.mock.calls[1];
    expect(String(url).endsWith('/streams/record')).toBe(true);
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/streams/record`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      contestId: 'c1',
      machineId: 'm1',
      enabled: true,
      actor: ACTOR,
    });
    expect(result).toEqual(payload);
  });

  it('posts enabled false when manual recording is turned off', async () => {
    const payload = { ok: true, recording: false };
    const fn = stubVigilFetch(() => mockResponse({ json: payload }));
    const setManualRecording = mustExport<RecordFn>('setManualRecording');
    const result = await setManualRecording('c1', 'm1', false, ACTOR);
    const [url, init] = fn.mock.calls[1];
    expect(String(url).endsWith('/streams/record')).toBe(true);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      contestId: 'c1',
      machineId: 'm1',
      enabled: false,
      actor: ACTOR,
    });
    expect(result).toEqual(payload);
  });

  it('rejects a 409 from the record endpoint instead of reporting success', async () => {
    stubVigilFetch(() => mockResponse({ status: 409, json: { detail: 'record_contest' } }));
    const setManualRecording = mustExport<RecordFn>('setManualRecording');
    const err = await captureError(setManualRecording('c1', 'm1', true, ACTOR));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'Vigil POST /api/admin/vigil/proctor/streams/record: 409 record_contest',
    );
  });
});

describe('getMediaNodes', () => {
  it('gets the media nodes url and returns the response json', async () => {
    const payload = {
      configured: false,
      healthy: 0,
      total: 0,
      error: null,
      nodes: [],
    };
    const fn = stubVigilFetch(() => mockResponse({ json: payload }));
    const getMediaNodes = mustExport<NodesFn>('getMediaNodes');
    const result = await getMediaNodes();
    const [url, init] = fn.mock.calls[1];
    expect(String(url).endsWith('/proctor/media/nodes')).toBe(true);
    expect(url).toBe(`${BASE_URL}/api/admin/vigil/proctor/media/nodes`);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(result).toEqual(payload);
  });
});

describe('vigil student card manual recording', () => {
  it('adds an optional manualRecording field with the specified jsdoc', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/lib/vigil-api.ts'), 'utf8');
    const body = interfaceBody(source, 'VigilStudentCard');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/\/\*\* 未开录屏的比赛中，老师手动开启了录制。 \*\/\s*manualRecording\?: boolean;/);
  });
});
