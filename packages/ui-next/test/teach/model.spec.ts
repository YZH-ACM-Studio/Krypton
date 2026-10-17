// @vitest-environment node
// Static imports fail collection while the teach model and api modules are absent.
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.TZ = 'Asia/Shanghai';

const modelLoaders = import.meta.glob('../../src/pages/teach/model.ts');
const apiLoaders = import.meta.glob('../../src/pages/teach/api.ts');

const MODEL_SOURCE = 'src/pages/teach/model.ts';
const API_SOURCE = 'src/pages/teach/api.ts';

const DENIED = '你不能管理这个题目集。';
const LOAD_FAILED = '加载题目集失败';
const PARSE_FAILED = '服务器返回了无法解析的响应';
const CONTAINER_ID = '64b8000000000000000000a1';
const SHANGHAI_NOW = new Date('2026-10-16T12:00:00Z');

const PARSER_NAMES = [
  'parseTeachListPayload',
  'parseTeachNewPayload',
  'parseTeachCopySource',
  'parseTeachWorkbenchPayload',
  'parseTeachComposePayload',
  'parseTeachShareState',
  'parseTeachKnowledgeTree',
  'parseTeachBankPage',
  'parseTeachBankPreview',
  'parseTeachParticipants',
] as const;

interface TeachBankQuery {
  type: string;
  course: string;
  node: string;
  source: string;
  kind: string;
  difficulty: number | string;
  q: string;
  exclude: number[];
  page: number;
}

interface TeachWindowInput {
  type: string;
  beginAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
}

interface TeachApi {
  getJson: (path: string, fallback: string) => Promise<unknown>;
  postForm: (path: string, body: URLSearchParams, fallback: string) => Promise<unknown>;
  postJson: (path: string, body: Record<string, unknown>, fallback: string) => Promise<unknown>;
  list: (query: URLSearchParams) => string;
  copyable: (type: string, id: string) => string;
  provenance: (type: string, id: string) => string;
  share: (type: string, id: string) => string;
  participants: (type: string, id: string) => string;
  knowledgeTree: (type: string) => string;
  bank: (query: TeachBankQuery) => string;
  bankPreview: (type: string, docId: number) => string;
  schoolBank: unknown;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadModule(loaders: object, source: string): Promise<object> {
  const load = moduleLoader(loaders, source);
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

function loadModel(): Promise<object> {
  return loadModule(modelLoaders, MODEL_SOURCE);
}

function loadApiModule(): Promise<object> {
  return loadModule(apiLoaders, API_SOURCE);
}

function typeErrorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    if (!(error instanceof TypeError)) throw new TypeError('expected TypeError');
    return error.message;
  }
  throw new Error('expected TypeError');
}

async function rejectedError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new TypeError('expected Error');
    return error;
  }
  throw new Error('expected a rejection');
}

function workbenchFixture(): Record<string, unknown> {
  return {
    container: {
      type: 'exam',
      id: CONTAINER_ID,
      rule: 'exam',
      title: '期中考试',
      status: 'running',
      beginAt: '2026-10-24T06:00:00.000Z',
      endAt: '2026-10-24T08:00:00.000Z',
      durationMinutes: 90,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'groups',
        groupNames: ['高一一班'],
        schoolNames: [],
        boundStudentCount: 36,
      },
      owner: { uid: 7, name: '张老师' },
      maintainers: [{ uid: 8, name: '赵老师' }],
      createdAt: '2026-10-01T01:02:03.000Z',
      schoolShared: { sharedAt: '2026-10-02T01:02:03.000Z', sharedByName: '李老师' },
      copiedFrom: {
        type: 'homework',
        id: '64b8000000000000000000b2',
        title: '上次作业',
        ownerName: '王老师',
      },
      examPassScore: 60,
      examAttemptLimit: 2,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: `/contest/${CONTAINER_ID}`,
        scoreboard: `/contest/${CONTAINER_ID}/scoreboard`,
        manage: `/contest/${CONTAINER_ID}/management`,
        users: `/contest/${CONTAINER_ID}/user`,
        clarification: `/contest/${CONTAINER_ID}/clarification`,
        grading: `/manage/grading/${CONTAINER_ID}`,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/contest/${CONTAINER_ID}/management`,
        redemption: null,
      },
    },
    paper: {
      problems: [
        {
          docId: 101,
          pid: 'P1001',
          title: '两数之和',
          kind: 'programming',
          score: 20,
          hidden: true,
          mine: false,
          difficulty: 3,
        },
        {
          docId: 102,
          pid: 'P1002',
          title: '判断正误',
          kind: 'single',
          score: null,
          hidden: false,
          mine: true,
          difficulty: null,
        },
      ],
      stages: null,
      examPaperQuotas: { single: 2 },
    },
    stats: {
      participantCount: 30,
      startedCount: 12,
      finalizedCount: null,
      submittedCount: 20,
      recordCount: 40,
      audienceCount: 36,
      problemStats: [{ docId: 101, accepted: 5, attempted: 9 }],
    },
    capabilities: {
      canDelete: false,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: true,
    },
  };
}

function withoutContainerLinks(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(payload);
  const container = copy.container;
  if (typeof container !== 'object' || container === null) throw new TypeError('fixture container');
  Reflect.deleteProperty(container, 'links');
  return copy;
}

function bankPage(kind: string): Record<string, unknown> {
  return {
    items: [
      {
        docId: 3,
        pid: 'P1003',
        title: '判断正误',
        kind,
        difficulty: null,
        tags: ['入门'],
        nSubmit: 8,
        nAccept: 3,
        hidden: false,
        mine: true,
        schoolShared: true,
        ownerName: '张老师',
        courseId: null,
        nodePath: ['第一章'],
      },
    ],
    page: 1,
    pageCount: 1,
    total: 1,
  };
}

function hydroDenied(message: string): Response {
  return new Response(JSON.stringify({
    error: {
      name: 'PermissionError',
      errorCode: 'PermissionError',
      code: 403,
      status: 403,
      params: [],
      message,
    },
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  fetchMock.mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function expectJsonRequest(init: RequestInit | undefined, method?: string): void {
  expect(init?.credentials).toBe('same-origin');
  expect(new Headers(init?.headers).get('accept')).toBe('application/json');
  if (method !== undefined) expect(init?.method?.toUpperCase()).toBe(method);
}

function serializedBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError('teach request body must be a string or URLSearchParams');
}

function expectShanghaiClock(): void {
  process.env.TZ = 'Asia/Shanghai';
  expect(new Date('2026-10-24T06:00:00Z').getHours(), 'test clock must be Asia/Shanghai').toBe(14);
}

async function readApi(): Promise<TeachApi> {
  const api = await loadApiModule();
  const teachApi = readField(api, 'teachApi');
  if (typeof teachApi !== 'object' || teachApi === null) throw new TypeError('teachApi must be an object');
  return {
    getJson: asFunction<TeachApi['getJson']>(readField(api, 'getJson'), 'getJson'),
    postForm: asFunction<TeachApi['postForm']>(readField(api, 'postForm'), 'postForm'),
    postJson: asFunction<TeachApi['postJson']>(readField(api, 'postJson'), 'postJson'),
    list: asFunction<TeachApi['list']>(readField(teachApi, 'list'), 'teachApi.list'),
    copyable: asFunction<TeachApi['copyable']>(readField(teachApi, 'copyable'), 'teachApi.copyable'),
    provenance: asFunction<TeachApi['provenance']>(readField(teachApi, 'provenance'), 'teachApi.provenance'),
    share: asFunction<TeachApi['share']>(readField(teachApi, 'share'), 'teachApi.share'),
    participants: asFunction<TeachApi['participants']>(readField(teachApi, 'participants'), 'teachApi.participants'),
    knowledgeTree: asFunction<TeachApi['knowledgeTree']>(readField(teachApi, 'knowledgeTree'), 'teachApi.knowledgeTree'),
    bank: asFunction<TeachApi['bank']>(readField(teachApi, 'bank'), 'teachApi.bank'),
    bankPreview: asFunction<TeachApi['bankPreview']>(readField(teachApi, 'bankPreview'), 'teachApi.bankPreview'),
    schoolBank: readField(teachApi, 'schoolBank'),
  };
}

async function formatWindow(input: TeachWindowInput, now: Date): Promise<string> {
  const model = await loadModel();
  const formatTeachWindow = asFunction<(value: TeachWindowInput, at: Date) => string>(
    readField(model, 'formatTeachWindow'),
    'formatTeachWindow',
  );
  return formatTeachWindow(input, now);
}

describe('teach model and api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a complete workbench payload and rejects a missing links field', async () => {
    const model = await loadModel();
    const parseTeachWorkbenchPayload = asFunction<(raw: unknown) => unknown>(
      readField(model, 'parseTeachWorkbenchPayload'),
      'parseTeachWorkbenchPayload',
    );
    const fixture = workbenchFixture();

    expect(parseTeachWorkbenchPayload(fixture)).toEqual(fixture);

    const message = typeErrorMessage(() => {
      parseTeachWorkbenchPayload(withoutContainerLinks(fixture));
    });
    expect(message).toContain('teach_payload_invalid:');
    expect(message).toContain('container.links');
  });

  it('parses a bank page and rejects a kind that is not a problem kind', async () => {
    const model = await loadModel();
    const parseTeachBankPage = asFunction<(raw: unknown) => unknown>(
      readField(model, 'parseTeachBankPage'),
      'parseTeachBankPage',
    );
    const fixture = bankPage('single');

    expect(parseTeachBankPage(fixture)).toEqual(fixture);
    expect(() => parseTeachBankPage(bankPage('essay'))).toThrow(TypeError);
  });

  it('rejects a non-object from every teach payload parser', async () => {
    const model = await loadModel();
    for (const name of PARSER_NAMES) {
      const parse = asFunction<(raw: unknown) => unknown>(readField(model, name), name);
      const message = typeErrorMessage(() => {
        parse(null);
      });
      expect(message, name).toContain('teach_payload_invalid:');
    }
  });

  it('formats the shanghai exam window with a personal limit', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'exam',
      beginAt: '2026-10-24T06:00:00Z',
      endAt: '2026-10-24T08:00:00Z',
      durationMinutes: 90,
    }, SHANGHAI_NOW)).resolves.toBe('10-24 14:00 → 16:00 · 限时 90 分钟');
  });

  it('formats practice as unlimited and omits a missing personal limit', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'practice',
      beginAt: '2026-10-24T06:00:00Z',
      endAt: '2026-10-24T08:00:00Z',
      durationMinutes: 90,
    }, SHANGHAI_NOW)).resolves.toBe('不限时');
    await expect(formatWindow({
      type: 'exam',
      beginAt: '2026-10-24T06:00:00Z',
      endAt: '2026-10-24T08:00:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('10-24 14:00 → 16:00');
  });

  it('formats a window that crosses days', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'acm',
      beginAt: '2026-10-13T00:00:00Z',
      endAt: '2026-10-20T15:59:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('10-13 08:00 → 10-20 23:59');
  });

  it('writes the year when the window is outside the current year', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'oi',
      beginAt: '2025-10-24T06:00:00Z',
      endAt: '2025-10-24T08:00:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('2025-10-24 14:00 → 16:00');
  });

  it('uses the locked teach labels', async () => {
    const model = await loadModel();
    expect(readField(model, 'TEACH_STATUS_LABEL')).toEqual({
      upcoming: '即将开始',
      running: '进行中',
      ended: '已结束',
      open: '不限时',
    });
    expect(readField(model, 'TEACH_TYPE_LABEL')).toEqual({
      practice: '练习',
      homework: '作业与考试 · 逐题',
      exam: '作业与考试 · 整卷',
      acm: 'ACM 比赛',
      oi: 'OI·IOI 比赛',
    });
    expect(readField(model, 'TEACH_TYPE_NOUN')).toEqual({
      practice: '练习',
      homework: '作业',
      exam: '考试',
      acm: '比赛',
      oi: '比赛',
    });
    expect(readField(model, 'TEACH_KIND_LABEL')).toEqual({
      true_false: '判断题',
      single: '单选题',
      multi: '多选题',
      blank: '填空题',
      program_fill: '程序填空题',
      function: '函数题',
      programming: '编程题',
      subjective: '主观题',
    });
    expect(readField(model, 'OI_RULE_LABEL')).toEqual({
      oi: 'OI',
      ioi: 'IOI',
      strictioi: '严格 IOI',
      ledo: 'Ledo',
    });
  });

  it('returns the hydro chinese message for a forbidden response', async () => {
    const fetchMock = stubFetch(hydroDenied(DENIED));
    const { getJson } = await readApi();
    const error = await rejectedError(() => getJson('/teach/exam/1', LOAD_FAILED));

    expect(error.message).toBe(DENIED);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/teach/exam/1');
    expectJsonRequest(fetchMock.mock.calls[0]?.[1]);
  });

  it('rejects a 200 response that is not json', async () => {
    stubFetch(textResponse('not-json'));
    const { getJson } = await readApi();
    const error = await rejectedError(() => getJson('/teach', LOAD_FAILED));

    expect(error.message).toBe(PARSE_FAILED);
  });

  it('returns parsed json and posts form and json bodies', async () => {
    const payload = { shared: true };
    const form = new URLSearchParams();
    form.set('operation', 'update');
    form.set('title', '期中考试');

    const getMock = stubFetch(jsonResponse({ ok: true, total: 1 }));
    const { getJson, postForm, postJson } = await readApi();
    await expect(getJson('/teach', LOAD_FAILED)).resolves.toEqual({ ok: true, total: 1 });
    expectJsonRequest(getMock.mock.calls[0]?.[1]);

    const postJsonMock = stubFetch(jsonResponse({ ok: true }));
    await expect(postJson('/teach/exam/1/share', payload, '保存失败')).resolves.toEqual({ ok: true });
    expect(postJsonMock.mock.calls[0]?.[0]).toBe('/teach/exam/1/share');
    expectJsonRequest(postJsonMock.mock.calls[0]?.[1], 'POST');
    expect(serializedBody(postJsonMock.mock.calls[0]?.[1]?.body)).toBe(JSON.stringify(payload));

    const postFormMock = stubFetch(jsonResponse({ ok: true }));
    await expect(postForm('/contest/1/edit', form, '保存失败')).resolves.toEqual({ ok: true });
    expect(postFormMock.mock.calls[0]?.[0]).toBe('/contest/1/edit');
    expectJsonRequest(postFormMock.mock.calls[0]?.[1], 'POST');
    expect(serializedBody(postFormMock.mock.calls[0]?.[1]?.body)).toBe(form.toString());
  });

  it('shares the get error contract for form and json posts', async () => {
    const { postForm, postJson } = await readApi();
    const form = new URLSearchParams();
    form.set('operation', 'update');

    stubFetch(hydroDenied(DENIED));
    const deniedForm = await rejectedError(() => postForm('/contest/1/edit', form, '保存失败'));
    expect(deniedForm.message).toBe(DENIED);

    stubFetch(hydroDenied(DENIED));
    const deniedJson = await rejectedError(() => postJson('/teach/exam/1/share', { shared: false }, '保存失败'));
    expect(deniedJson.message).toBe(DENIED);

    stubFetch(textResponse('not-json'));
    const badForm = await rejectedError(() => postForm('/contest/1/edit', form, '保存失败'));
    expect(badForm.message).toBe(PARSE_FAILED);

    stubFetch(textResponse('not-json'));
    const badJson = await rejectedError(() => postJson('/teach/exam/1/share', { shared: false }, '保存失败'));
    expect(badJson.message).toBe(PARSE_FAILED);
  });

  it('builds a bank query whose all and exclude values round-trip', async () => {
    const { bank } = await readApi();
    const url = bank({
      type: 'homework',
      course: 'all',
      node: 'all',
      source: 'school',
      kind: 'all',
      difficulty: 'all',
      q: 'graph',
      exclude: [3, 4],
      page: 2,
    });
    const parsed = new URL(url, 'https://teach.local');

    expect(parsed.pathname).toBe('/teach-api/bank');
    expect(parsed.searchParams.get('type')).toBe('homework');
    expect(parsed.searchParams.get('course')).toBe('all');
    expect(parsed.searchParams.get('node')).toBe('all');
    expect(parsed.searchParams.get('source')).toBe('school');
    expect(parsed.searchParams.get('kind')).toBe('all');
    expect(parsed.searchParams.get('difficulty')).toBe('all');
    expect(parsed.searchParams.get('q')).toBe('graph');
    expect(parsed.searchParams.get('exclude')).toBe('3,4');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('builds the other teach api paths', async () => {
    const api = await readApi();
    const params = new URLSearchParams();
    params.set('scope', 'mine');
    params.set('type', 'quiz');

    expect(api.list(params)).toBe(`/teach?${params.toString()}`);
    expect(api.copyable('exam', CONTAINER_ID)).toBe(`/teach/exam/${CONTAINER_ID}/copyable`);
    expect(api.provenance('practice', CONTAINER_ID)).toBe(`/teach/practice/${CONTAINER_ID}/provenance`);
    expect(api.share('homework', CONTAINER_ID)).toBe(`/teach/homework/${CONTAINER_ID}/share`);
    expect(api.participants('acm', CONTAINER_ID)).toBe(`/teach/acm/${CONTAINER_ID}/participants`);
    expect(api.knowledgeTree('oi')).toBe('/teach-api/knowledge-tree?type=oi');
    expect(api.bankPreview('exam', 12)).toBe('/teach-api/bank/12?type=exam');
    expect(api.schoolBank).toBe('/problem/school-bank');
  });

  it('writes the year on both ends when only one end is outside this year', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'acm',
      beginAt: '2025-10-13T00:00:00Z',
      endAt: '2026-10-20T15:59:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('2025-10-13 08:00 → 2026-10-20 23:59');
  });

  it('prints both dates when the same month and day fall in different years', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'exam',
      beginAt: '2025-10-24T06:00:00Z',
      endAt: '2026-10-24T08:00:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('2025-10-24 14:00 → 2026-10-24 16:00');
  });

  it('rejects a bank difficulty outside 0 to 10', async () => {
    const { bank } = await readApi();
    const query = {
      type: 'homework',
      course: 'all',
      node: 'all',
      source: 'all',
      kind: 'all',
      difficulty: 10,
      q: '',
      exclude: [] as number[],
      page: 1,
    };

    expect(new URL(bank({ ...query, difficulty: 0 }), 'https://teach.local').searchParams.get('difficulty')).toBe('0');
    expect(new URL(bank(query), 'https://teach.local').searchParams.get('difficulty')).toBe('10');
    const message = typeErrorMessage(() => {
      bank({ ...query, difficulty: 11 });
    });
    expect(message).toContain('teach_payload_invalid:bank.difficulty');
  });

  it('pads a single-digit month in the window', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'homework',
      beginAt: '2026-01-05T00:30:00Z',
      endAt: '2026-01-05T02:00:00Z',
      durationMinutes: null,
    }, SHANGHAI_NOW)).resolves.toBe('01-05 08:30 → 10:00');
  });

  it('keeps a zero-minute personal limit in the window text', async () => {
    expectShanghaiClock();
    await expect(formatWindow({
      type: 'homework',
      beginAt: '2026-10-24T06:00:00Z',
      endAt: '2026-10-24T08:00:00Z',
      durationMinutes: 0,
    }, SHANGHAI_NOW)).resolves.toBe('10-24 14:00 → 16:00 · 限时 0 分钟');
  });
});
