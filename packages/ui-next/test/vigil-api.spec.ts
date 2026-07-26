import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveRequest,
  buildFlvStreamUrl,
  buildHlsStreamUrl,
  buildRecordingUrl,
  ensureVigilToken,
  executeRecordingDelete,
  fetchClients,
  getCachedVigilBaseUrl,
  invalidateExamSession,
  invalidateVigilTokenCache,
  listContestAudit,
  listContestStudents,
  prepareBrowserDownload,
  previewRecordingDelete,
  recordingBelongsToStudent,
  requestRecordingDownload,
  startBrowserDownload,
  VigilOfflineError,
  vigilScreenshotUrl,
  vigilThumbUrl,
  type VigilRecording,
  type VigilStudentCard,
} from '../src/lib/vigil-api.ts';

const BASE_URL = 'http://vigil.example';
const TOKEN_ENDPOINT = '/api/admin/vigil/dashboard-token';

function tokenBody(overrides: Record<string, unknown> = {}) {
  return {
    token: 'tk-1',
    vigilBaseUrl: BASE_URL,
    vigilWsUrl: 'ws://vigil.example/ws',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
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

beforeEach(() => {
  invalidateVigilTokenCache();
});

describe('vigil dashboard token', () => {
  it('propagates a network failure as token_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('boom');
    }));
    const err = await captureError(ensureVigilToken());
    expect(err).to.be.instanceOf(VigilOfflineError);
    expect((err as VigilOfflineError).reason).to.equal('token_failed');
    expect((err as VigilOfflineError).detail).to.equal('boom');
  });

  it('maps a non-2xx token response to token_failed with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ status: 403, json: {} })));
    const err = await captureError(ensureVigilToken());
    expect((err as VigilOfflineError).reason).to.equal('token_failed');
    expect((err as VigilOfflineError).detail).to.equal('HTTP 403');
  });

  it('maps an unparseable token body to token_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({})));
    const err = await captureError(ensureVigilToken());
    expect((err as VigilOfflineError).reason).to.equal('token_failed');
    expect((err as VigilOfflineError).detail).to.equal('non-JSON token response');
  });

  it('rejects a token payload without a usable base url as not_configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ json: tokenBody({ vigilBaseUrl: '' }) })));
    const err = await captureError(ensureVigilToken());
    expect((err as VigilOfflineError).reason).to.equal('not_configured');
  });

  it('caches an unexpired token across calls', async () => {
    const fn = vi.fn(async () => mockResponse({ json: tokenBody() }));
    vi.stubGlobal('fetch', fn);
    expect(await ensureVigilToken()).to.equal('tk-1');
    expect(await ensureVigilToken()).to.equal('tk-1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getCachedVigilBaseUrl()).to.equal(BASE_URL);
  });
});

describe('vigilFetch request/response handling', () => {
  it('hits the vigil host with the token header and returns parsed json', async () => {
    const clients = [{ client_id: 'm1', status: 'online', last_seen_at: 't' }];
    const fn = stubVigilFetch(() => mockResponse({ json: clients }));
    const result = await fetchClients();
    expect(result).to.deep.equal(clients);
    const [url, init] = fn.mock.calls[1];
    expect(url).to.equal(`${BASE_URL}/api/clients`);
    expect((init?.headers as Record<string, string>)['X-KVS-Token']).to.equal('tk-1');
    expect((init?.headers as Record<string, string>)['Content-Type']).to.equal('application/json');
  });

  it('treats a non-json content type as offline and clears the token cache', async () => {
    stubVigilFetch(() => mockResponse({ contentType: 'text/html; charset=utf-8', text: '<html></html>' }));
    const err = await captureError(fetchClients());
    expect((err as VigilOfflineError).reason).to.equal('non_json');
    expect((err as VigilOfflineError).detail).to.contain('content-type=text/html');
    expect(getCachedVigilBaseUrl()).to.equal(null);
  });

  it('maps a 5xx json response to server_5xx with an html-stripped body', async () => {
    stubVigilFetch(() => mockResponse({ status: 500, text: '<b>internal</b>   <i>error</i>' }));
    const err = await captureError(fetchClients());
    expect((err as VigilOfflineError).reason).to.equal('server_5xx');
    expect((err as VigilOfflineError).detail).to.equal('internal error');
  });

  it('surfaces a 4xx json body as a plain business error', async () => {
    stubVigilFetch(() => mockResponse({ status: 404, json: { detail: 'no such contest' } }));
    const err = await captureError(fetchClients());
    expect(err).to.be.instanceOf(Error);
    expect(err).to.not.be.instanceOf(VigilOfflineError);
    expect((err as Error).message).to.equal('Vigil GET /api/clients: 404 no such contest');
  });

  it('flags a network failure on the api call and clears the cached token', async () => {
    stubVigilFetch(() => {
      throw new TypeError('unreachable');
    });
    const err = await captureError(fetchClients());
    expect((err as VigilOfflineError).reason).to.equal('network');
    expect((err as VigilOfflineError).detail).to.equal('unreachable');
    expect(getCachedVigilBaseUrl()).to.equal(null);
  });
});

describe('payload shaping', () => {
  it('posts the approval decision as a json body', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { ok: true } }));
    await approveRequest('a1', true);
    const [url, init] = fn.mock.calls[1];
    expect(url).to.equal(`${BASE_URL}/api/approvals/a1/approve`);
    expect(init?.method).to.equal('POST');
    expect(JSON.parse(String(init?.body))).to.deep.equal({ asTemporary: true });
  });

  it('url-encodes the session id and ships reason + proctor uid on invalidate', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { ok: true } }));
    await invalidateExamSession('s 1', 'cheating', 42);
    const [url, init] = fn.mock.calls[1];
    expect(url).to.equal(`${BASE_URL}/api/exam-sessions/s%201/invalidate`);
    expect(JSON.parse(String(init?.body))).to.deep.equal({ reason: 'cheating', proctorOjUserId: 42 });
  });

  it('builds the student-list query from the provided params only', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { items: [], page: 1, pageSize: 30, total: 0, counters: {} } }));
    await listContestStudents('c/1', { page: 2, pageSize: 30, status: 'anomaly,offline', q: '张三', sort: 'name' });
    const url = new URL(String(fn.mock.calls[1][0]));
    expect(url.pathname).to.equal('/api/admin/vigil/proctor/contests/c%2F1/students');
    expect(Object.fromEntries(url.searchParams)).to.deep.equal({
      page: '2',
      pageSize: '30',
      status: 'anomaly,offline',
      q: '张三',
      sort: 'name',
    });
  });

  it('omits the query string entirely when no list params are set', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: { items: [], page: 1, pageSize: 30, total: 0, counters: {} } }));
    await listContestStudents('c1');
    expect(String(fn.mock.calls[1][0])).to.equal(`${BASE_URL}/api/admin/vigil/proctor/contests/c1/students`);
  });

  it('serialises audit filters including the numeric actor', async () => {
    const fn = stubVigilFetch(() => mockResponse({ json: [] }));
    await listContestAudit('c1', { since: '2026-01-01', limit: 10, command: 'lock_screen', actor: 7 });
    const url = new URL(String(fn.mock.calls[1][0]));
    expect(Object.fromEntries(url.searchParams)).to.deep.equal({
      since: '2026-01-01',
      limit: '10',
      command: 'lock_screen',
      actor: '7',
    });
  });
});

describe('recording download + delete', () => {
  it('exchanges a download token and assembles the final signed url', async () => {
    const fn = stubVigilFetch(() => mockResponse({
      json: { dl: 'd l', expiresAt: 'later', href: '/recordings/download/abc', count: 1, totalBytes: 10 },
    }));
    const url = await requestRecordingDownload('c1', { recordingId: 'r1' }, { uid: 1, displayName: 'op' });
    expect(url).to.equal(`${BASE_URL}/api/admin/vigil/proctor/recordings/download/abc?dl=d%20l`);
    const [tokenUrl, init] = fn.mock.calls[1];
    expect(tokenUrl).to.equal(`${BASE_URL}/api/admin/vigil/proctor/contests/c1/download-token`);
    expect(JSON.parse(String(init?.body))).to.deep.equal({ recordingId: 'r1', actor: { uid: 1, displayName: 'op' } });
  });

  it('previews a delete through the oj-side proxy with scope params', async () => {
    const preview = { intent: 'i1', expiresAt: 'later', scope: 'student', contestTitle: 't', count: 2, totalBytes: 5 };
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => mockResponse({ json: preview }));
    vi.stubGlobal('fetch', fn);
    const result = await previewRecordingDelete({ cid: 'c1', ojUserId: 9, examSessionId: 's1', recordingId: 'r1' });
    expect(result).to.deep.equal(preview);
    const url = new URL(String(fn.mock.calls[0][0]), 'http://oj.local');
    expect(url.pathname).to.equal('/api/admin/vigil/recordings/delete-preview');
    expect(Object.fromEntries(url.searchParams)).to.deep.equal({ cid: 'c1', ojUserId: '9', examSessionId: 's1', recordingId: 'r1' });
  });

  it('wraps a failed preview response into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({ status: 403, text: 'denied' })));
    const err = await captureError(previewRecordingDelete({ cid: 'c1' }));
    expect((err as Error).message).to.equal('录像删除预检失败（HTTP 403）：denied');
  });

  it('executes a delete as a form post with intent and optional confirm title', async () => {
    const outcome = { ok: true, deleted: 1, missing: 0, failures: [] };
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => mockResponse({ json: outcome }));
    vi.stubGlobal('fetch', fn);
    const result = await executeRecordingDelete({ cid: 'c1', recordingId: 'r1' }, 'i1', 'final exam');
    expect(result).to.deep.equal(outcome);
    const [url, init] = fn.mock.calls[0];
    expect(url).to.equal('/api/admin/vigil/recordings/delete');
    expect(init?.method).to.equal('POST');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).to.deep.equal({
      cid: 'c1',
      intent: 'i1',
      recordingId: 'r1',
      confirmTitle: 'final exam',
    });
  });
});

describe('stream and screenshot url builders', () => {
  it('picks the dvr app by record flag and encodes stream ids', () => {
    expect(buildHlsStreamUrl('c 1', 'm/1', 'screen', true)).to.equal('/vigil-hls/live-record/c%201_m%2F1_screen.m3u8');
    expect(buildHlsStreamUrl('c1', 'm1', 'camera', false)).to.equal('/vigil-hls/live-nodvr/c1_m1_camera.m3u8');
    expect(buildFlvStreamUrl('c1', 'm1', 'screen', false)).to.equal('/vigil-flv/live-nodvr/c1_m1_screen.flv');
    expect(buildFlvStreamUrl('c1', 'm1', 'camera', true)).to.equal('/vigil-flv/live-record/c1_m1_camera.flv');
    expect(buildRecordingUrl('seg-1.mp4')).to.equal('/vigil-hls/recordings/seg-1.mp4');
  });

  it('prefixes screenshot urls with the cached base once a token is loaded', async () => {
    expect(vigilThumbUrl('s/1')).to.equal('/api/admin/vigil/screenshots/s%2F1/thumb');
    expect(vigilScreenshotUrl('s1')).to.equal('/api/admin/vigil/screenshots/s1/file');
    stubVigilFetch();
    await ensureVigilToken();
    expect(vigilThumbUrl('s1')).to.equal(`${BASE_URL}/api/admin/vigil/screenshots/s1/thumb`);
    expect(vigilScreenshotUrl('s1')).to.equal(`${BASE_URL}/api/admin/vigil/screenshots/s1/file`);
  });
});

describe('recordingBelongsToStudent', () => {
  const recording = { uid: 5, examSessionId: 'sess-1' } as VigilRecording;

  it('matches on uid whenever the card has one', () => {
    const student = { uid: 5, examSessionId: 'other' } as VigilStudentCard;
    expect(recordingBelongsToStudent(recording, student)).to.equal(true);
    expect(recordingBelongsToStudent(recording, { uid: 6, examSessionId: 'sess-1' } as VigilStudentCard)).to.equal(false);
  });

  it('falls back to the exam session for unknown students', () => {
    const student = { examSessionId: 'sess-1' } as VigilStudentCard;
    expect(recordingBelongsToStudent(recording, student)).to.equal(true);
    expect(recordingBelongsToStudent({ ...recording, examSessionId: 'sess-2' } as VigilRecording, student)).to.equal(false);
  });
});

describe('browser download helpers', () => {
  it('throws a friendly error when the popup is blocked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => prepareBrowserDownload()).to.throw('浏览器阻止了下载窗口');
    open.mockRestore();
  });

  it('detaches the opener and navigates the prepared window', () => {
    const replace = vi.fn();
    const fakeWindow = {
      opener: {},
      document: { title: '', body: { textContent: '' } },
      location: { replace },
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
    const target = prepareBrowserDownload();
    expect(target).to.equal(fakeWindow);
    expect(target.opener).to.equal(null);
    expect(target.document.title).to.equal('录像下载');
    startBrowserDownload('http://x/dl', target);
    expect(replace).toHaveBeenCalledWith('http://x/dl');
    open.mockRestore();
  });
});
