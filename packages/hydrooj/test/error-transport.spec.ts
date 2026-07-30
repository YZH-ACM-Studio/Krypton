import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    ConnectionHandler,
    createEarlyErrorBoundary,
    dispatchWebSocketMessage,
    fitWebSocketCloseReason,
    Handler,
    localizeError,
    lookupErrorMessageTranslation,
    NotFoundError,
    resolveErrorTransport,
    UserFacingError,
} from '@hydrooj/framework';
import { PERM } from '@hydrooj/common';
import baseLayer from '@hydrooj/framework/base';
import { PermissionError } from '../src/error';

(global as any).Hydro ||= {};
(global as any).Hydro.model ||= {};

const createTraceId = () => 'error-transport-test';

function userFacingError() {
    return localizeError(new NotFoundError('P1000'), 'Problem {0} not found.', 'P1000');
}

function nestedUserFacingError() {
    const child = userFacingError();
    return localizeError(new UserFacingError(child), 'Access denied: {0}', child);
}

function resolve(error: unknown, locale = 'zh-CN', lookup: typeof lookupErrorMessageTranslation = lookupErrorMessageTranslation) {
    return resolveErrorTransport(error, {
        locale,
        lookup,
        createTraceId,
    });
}

function expectStableKnownFields(payload: ReturnType<typeof resolve>['error']) {
    assert.equal(payload.name, 'NotFoundError');
    assert.equal(payload.errorCode, 'NotFoundError');
    assert.equal(payload.code, 404);
    assert.equal(payload.status, 404);
    assert.deepEqual(payload.params, ['P1000']);
}

describe('P2.44 shared error transport resolver', () => {
    it('preserves the known error identity, status and raw params while resolving the full message', () => {
        const result = resolve(userFacingError());

        assert.equal(result.status, 404);
        assert.equal(result.template, 'error.html');
        assert.equal(result.userFacing, true);
        expectStableKnownFields(result.error);
        assert.equal(result.error.message, '题目 P1000 不存在。');
        assert.equal(result.traceId, undefined);
        assert.equal(result.internalError, undefined);
        assert.doesNotMatch(JSON.stringify(result.error), /\{\d+\}/);
    });

    it('uses the requested locale without changing the machine-facing fields', () => {
        const result = resolve(userFacingError(), 'en-US');

        expectStableKnownFields(result.error);
        assert.equal(result.error.message, 'Problem P1000 not found.');
    });

    it('preserves the 4xx contract for existing and unsupported interface locales', () => {
        const korean = resolve(userFacingError(), 'ko-KR', (template, locale) =>
            lookupErrorMessageTranslation(template, locale, (source, requestedLocale) =>
                source === 'Problem {0} not found.' && requestedLocale.startsWith('ko') ? '문제 {0}을(를) 찾을 수 없습니다.' : source,
            ),
        );
        const unsupported = resolve(userFacingError(), 'fr-FR');

        assert.equal(korean.status, 404);
        assert.equal(korean.error.name, 'NotFoundError');
        assert.equal(korean.error.message, '문제 P1000을(를) 찾을 수 없습니다.');
        assert.equal(unsupported.status, 404);
        assert.equal(unsupported.error.name, 'NotFoundError');
        assert.equal(unsupported.error.message, '题目 P1000 不存在。');
        assert.equal(
            lookupErrorMessageTranslation('View this domain', 'fr-FR', (source, requestedLocale) =>
                source === 'View this domain' && requestedLocale === 'zh-CN' ? '查看此域' : source,
            ),
            '查看此域',
        );
    });

    it('keeps real permission descriptions in the requested legacy locale', () => {
        const legacyPermissionLookup = (source: string, requestedLocale: string) => {
            if (source === "You don't have the required permission ({0}) in this domain.") {
                if (requestedLocale.startsWith('ko')) return '권한 필요: {0}';
                if (requestedLocale === 'zh-TW') return '需要權限：{0}';
                return source;
            }
            if (source === 'View this domain') {
                if (requestedLocale.startsWith('ko')) return '이 도메인 보기';
                if (requestedLocale === 'zh-TW') return '檢視此網域';
                if (requestedLocale === 'zh-CN') return '查看此域';
            }
            return source;
        };
        const lookup = (template: string, locale: string) => lookupErrorMessageTranslation(template, locale, legacyPermissionLookup);

        const english = resolve(new PermissionError(PERM.PERM_VIEW), 'en-US', lookup);
        const korean = resolve(new PermissionError(PERM.PERM_VIEW), 'ko-KR', lookup);
        const traditionalChinese = resolve(new PermissionError(PERM.PERM_VIEW), 'zh_TW', lookup);
        const unsupported = resolve(new PermissionError(PERM.PERM_VIEW), 'fr-FR', lookup);

        for (const result of [english, korean, traditionalChinese, unsupported]) {
            assert.equal(result.status, 403);
            assert.equal(result.error.name, 'PermissionError');
            assert.deepEqual(result.error.params, [PERM.PERM_VIEW]);
        }
        assert.equal(english.error.message, "You don't have the required permission (View this domain) in this domain.");
        assert.equal(korean.error.message, '권한 필요: 이 도메인 보기');
        assert.equal(traditionalChinese.error.message, '需要權限：檢視此網域');
        assert.equal(unsupported.error.message, '您在该域中缺少所需权限（查看此域）。');
    });

    it('keeps nested user-facing context structured and fully resolved', () => {
        const result = resolve(nestedUserFacingError());

        assert.equal(result.error.message, '访问被拒绝：题目 P1000 不存在。');
        assert.equal(result.error.nested?.[0]?.name, 'NotFoundError');
        assert.equal(result.error.nested?.[0]?.message, '题目 P1000 不存在。');
        assert.equal(result.error.nested?.[0]?.status, 404);
        assert.doesNotMatch(JSON.stringify(result.error), /\{\d+\}|\[object Object\]/);
    });

    it('fails closed with one trace ID when a user-facing descriptor cannot be resolved', () => {
        const error = localizeError(new UserFacingError('value'), 'Missing catalog entry {0}', 'value');
        const result = resolve(error);

        assert.equal(result.status, 500);
        assert.equal(result.template, 'bsod.html');
        assert.equal(result.userFacing, false);
        assert.equal(result.traceId, 'error-transport-test');
        assert.equal(result.error.traceId, 'error-transport-test');
        assert.equal(result.error.name, 'SystemError');
        assert.equal(result.error.errorCode, 'SystemError');
        assert.equal(result.error.status, 500);
        assert.deepEqual(result.error.params, []);
        assert.equal(result.error.message, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.equal(result.internalError?.name, 'ErrorMessageResolutionError');
        assert.doesNotMatch(JSON.stringify(result.error), /Missing catalog entry|value|\{\d+\}/);
    });

    it('returns a safe traceable 500 without leaking an unexpected error or stack', () => {
        const result = resolve(new Error('database password=secret'));
        const serialized = JSON.stringify(result.error);

        assert.equal(result.status, 500);
        assert.equal(result.template, 'bsod.html');
        assert.equal(result.traceId, 'error-transport-test');
        assert.equal(result.error.message, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.equal(result.internalError?.message, 'database password=secret');
        assert.doesNotMatch(serialized, /password|secret|stack|Error:/);
    });

    it('fails closed when a user-facing error cannot describe itself', () => {
        const error = userFacingError();
        error.msg = () => {
            throw new Error('broken descriptor password=secret');
        };

        const result = resolve(error);

        assert.equal(result.status, 500);
        assert.equal(result.traceId, 'error-transport-test');
        assert.equal(result.error.message, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.match(result.internalError?.message || '', /broken descriptor/);
        assert.doesNotMatch(JSON.stringify(result.error), /broken descriptor|password|secret|stack/);
    });
});

describe('P2.44 framework HTTP and WebSocket boundaries', () => {
    it('puts the same authoritative envelope into the HTTP response for HTML and JSON requests', async () => {
        const html = Object.create(Handler.prototype) as Handler;
        html.request = { json: false } as Handler['request'];
        html.response = {} as Handler['response'];
        html.resolveErrorLocale = () => 'zh-CN';

        const json = Object.create(Handler.prototype) as Handler;
        json.request = { json: true } as Handler['request'];
        json.response = {} as Handler['response'];
        json.resolveErrorLocale = () => 'zh-CN';

        await html.onerror(userFacingError());
        await json.onerror(userFacingError());

        assert.equal(html.response.status, 404);
        assert.equal(json.response.status, 404);
        assert.equal(html.response.template, 'error.html');
        assert.equal(json.response.template, 'error.html');
        assert.deepEqual(html.response.body.error, json.response.body.error);
        expectStableKnownFields(html.response.body.error);
        assert.equal(html.response.body.error.message, '题目 P1000 不存在。');
        assert.equal('stack' in html.response.body.error, false);
    });

    it('sends the same stable fields and complete message in the WebSocket error frame', async () => {
        const frames: unknown[] = [];
        const closes: Array<[number, string]> = [];
        const handler = Object.create(ConnectionHandler.prototype) as ConnectionHandler;
        handler.request = { path: '/record/detail-conn' } as ConnectionHandler['request'];
        handler.resolveErrorLocale = () => 'zh-CN';
        handler.send = (value: unknown) => frames.push(value);
        handler.close = (code: number, reason: string) => closes.push([code, reason]);

        await handler.onerror(userFacingError());

        assert.equal(frames.length, 1);
        const frame = frames[0] as { error: ReturnType<typeof resolve>['error'] };
        expectStableKnownFields(frame.error);
        assert.equal(frame.error.message, '题目 P1000 不存在。');
        assert.deepEqual(closes, [[4000, '题目 P1000 不存在。']]);
        assert.equal('stack' in frame.error, false);
    });

    it('keeps the full WebSocket frame message while respecting the close-reason byte limit', async () => {
        const frames: unknown[] = [];
        const closes: Array<[number, string]> = [];
        const handler = Object.create(ConnectionHandler.prototype) as ConnectionHandler;
        handler.request = { path: '/record/detail-conn' } as ConnectionHandler['request'];
        handler.resolveErrorLocale = () => 'zh-CN';
        handler.send = (value: unknown) => frames.push(value);
        handler.close = (code: number, reason: string) => closes.push([code, reason]);
        const detail = '甲'.repeat(100);
        const error = localizeError(new UserFacingError(detail), 'Access denied: {0}', detail);

        await handler.onerror(error);

        const frame = frames[0] as { error: ReturnType<typeof resolve>['error'] };
        assert.equal(frame.error.message, `访问被拒绝：${detail}`);
        assert.equal(closes[0][0], 4000);
        assert.ok(Buffer.byteLength(closes[0][1]) <= 123);
        assert.ok(frame.error.message.startsWith(closes[0][1]));
    });

    it('uses one protocol-safe close-reason rule for Hydro WebSocket overrides', () => {
        const message = `访问被拒绝：${'甲'.repeat(100)}`;
        const reason = fitWebSocketCloseReason(message);

        assert.ok(Buffer.byteLength(reason) <= 123);
        assert.ok(message.startsWith(reason));
    });

    it('routes malformed frames and message-handler failures through the same WebSocket error boundary', async () => {
        const payloads: unknown[] = [];
        const failures: Error[] = [];
        const fail = async (error: Error) => {
            failures.push(error);
        };

        await dispatchWebSocketMessage(
            '{',
            async (payload) => {
                payloads.push(payload);
            },
            fail,
        );
        await dispatchWebSocketMessage(
            '{"operation":"start"}',
            async () => {
                throw userFacingError();
            },
            fail,
        );

        assert.deepEqual(payloads, []);
        assert.equal(failures.length, 2);
        assert.equal(failures[0].name, 'SyntaxError');
        assert.equal(failures[1].name, 'NotFoundError');
    });
});

interface FakeKoaContext {
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    cookies: Record<string, unknown>;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    path: string;
    originalPath: string;
    querystring: string;
    handler?: Record<string, unknown>;
    HydroContext?: Record<string, any>;
    body?: unknown;
    status?: number;
    type?: string;
    set: (name: string, value: string) => void;
    redirect: (url: string) => void;
}

function fakeKoaContext(accept: string): FakeKoaContext {
    return {
        request: {
            method: 'GET',
            host: 'oj.example.test',
            hostname: 'oj.example.test',
            ip: '127.0.0.1',
            headers: { accept },
            body: {},
            files: {},
        },
        response: {},
        cookies: {},
        query: {},
        params: {},
        path: '/transport-test',
        originalPath: '/transport-test',
        querystring: '',
        set() {},
        redirect() {},
    };
}

function fakeBoundaryHandler(locale: string, rendered: Array<{ template: string; data: Record<string, unknown> }>) {
    return {
        resolveErrorTransport(error: unknown) {
            return resolve(error, locale);
        },
        async renderHTML(template: string, data: Record<string, unknown>) {
            rendered.push({ template, data });
            const payload = data.error as ReturnType<typeof resolve>['error'];
            return `<main>${payload.message}</main>`;
        },
    };
}

describe('P2.44 outer HTTP response boundary', () => {
    it('negotiates HTML and JSON without changing their shared error envelope', async () => {
        const logs: unknown[][] = [];
        const layer = baseLayer({ error: (...values: unknown[]) => logs.push(values) }, null, null);
        const html = fakeKoaContext('text/html');
        const json = fakeKoaContext('application/json');
        const rendered: Array<{ template: string; data: Record<string, unknown> }> = [];

        await layer(html as never, async () => {
            html.handler = fakeBoundaryHandler('zh-CN', rendered);
            throw userFacingError();
        });
        await layer(json as never, async () => {
            json.handler = fakeBoundaryHandler('zh-CN', rendered);
            throw userFacingError();
        });

        assert.equal(html.response.status, 404);
        assert.equal(html.response.type, 'text/html');
        assert.equal(html.body, '<main>题目 P1000 不存在。</main>');
        assert.equal(json.response.status, 404);
        const jsonError = (json.body as { error: ReturnType<typeof resolve>['error'] }).error;
        expectStableKnownFields(jsonError);
        assert.equal(jsonError.message, '题目 P1000 不存在。');
        assert.deepEqual(rendered[0].data.error, jsonError);
        assert.equal(logs.length, 0);
    });

    it('turns a serialization failure into a safe traceable JSON 500', async () => {
        const logs: unknown[][] = [];
        const layer = baseLayer({ error: (...values: unknown[]) => logs.push(values) }, null, null);
        const context = fakeKoaContext('application/json');
        const rendered: Array<{ template: string; data: Record<string, unknown> }> = [];

        await layer(context as never, async () => {
            context.handler = fakeBoundaryHandler('zh-CN', rendered);
            context.HydroContext!.UiContext = {};
            context.HydroContext!.user = {};
            const circular: Record<string, unknown> = {};
            circular.self = circular;
            context.HydroContext!.response.body = circular;
        });

        assert.equal(context.response.status, 500);
        const error = (context.body as { error: ReturnType<typeof resolve>['error'] }).error;
        assert.equal(error.name, 'SystemError');
        assert.equal(error.status, 500);
        assert.equal(error.traceId, 'error-transport-test');
        assert.equal(error.message, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.doesNotMatch(JSON.stringify(error), /circular|Serialize failure|stack/);
        assert.equal(logs.length, 1);
        assert.match(String(logs[0][0]), /error-transport-test/);
    });

    it('turns an error-page renderer failure into a safe traceable 500', async () => {
        const logs: unknown[][] = [];
        const layer = baseLayer({ error: (...values: unknown[]) => logs.push(values) }, null, null);
        const context = fakeKoaContext('text/html');

        await layer(context as never, async () => {
            context.handler = {
                resolveErrorTransport(error: unknown) {
                    return resolve(error);
                },
                async renderHTML() {
                    throw new Error('template path=/secret/error.html');
                },
            };
            throw userFacingError();
        });

        assert.equal(context.response.status, 500);
        assert.equal(context.response.type, 'text/plain');
        assert.equal(context.body, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.ok(logs.some((entry) => String(entry[0]).includes('error-transport-test')));
        assert.doesNotMatch(String(context.body), /secret|template path/);
    });
});

describe('P2.44 outer Koa error boundary', () => {
    it('leaves a successful request unchanged', async () => {
        const logs: unknown[][] = [];
        const context = fakeKoaContext('text/html');
        const layer = createEarlyErrorBoundary({ error: (...values: unknown[]) => logs.push(values) }, (error) => resolve(error));

        await layer(context as never, async () => {
            context.status = 204;
            context.type = 'text/plain';
            context.body = 'unchanged';
        });

        assert.equal(context.status, 204);
        assert.equal(context.type, 'text/plain');
        assert.equal(context.body, 'unchanged');
        assert.equal(logs.length, 0);
    });

    it('preserves an early 4xx status while returning the shared safe envelope', async () => {
        const logs: unknown[][] = [];
        const context = fakeKoaContext('application/json');
        const layer = createEarlyErrorBoundary({ error: (...values: unknown[]) => logs.push(values) }, (error) => resolve(error));
        const parsingError = Object.assign(new Error('request body contains password=secret'), { status: 400 });

        await layer(context as never, async () => {
            throw parsingError;
        });

        assert.equal(context.status, 400);
        assert.equal(context.type, 'application/json');
        const error = (context.body as { error: ReturnType<typeof resolve>['error'] }).error;
        assert.equal(error.name, 'HttpStatusError');
        assert.equal(error.status, 400);
        assert.deepEqual(error.params, [400]);
        assert.equal(error.message, '请求失败（HTTP 400）。');
        assert.doesNotMatch(JSON.stringify(error), /password|secret|stack/);
        assert.equal(logs.length, 0);
    });

    it('turns an unknown early failure into a traceable 500 without leaking its details', async () => {
        const logs: unknown[][] = [];
        const context = fakeKoaContext('application/json');
        const layer = createEarlyErrorBoundary({ error: (...values: unknown[]) => logs.push(values) }, (error) => resolve(error));

        await layer(context as never, async () => {
            throw new Error('body parser path=/secret and password=secret');
        });

        assert.equal(context.status, 500);
        assert.equal(context.type, 'application/json');
        const error = (context.body as { error: ReturnType<typeof resolve>['error'] }).error;
        assert.equal(error.name, 'SystemError');
        assert.equal(error.traceId, 'error-transport-test');
        assert.equal(error.message, '服务器发生了未预期错误。错误编号：error-transport-test');
        assert.doesNotMatch(JSON.stringify(error), /password|secret|body parser|stack/);
        assert.equal(logs.length, 1);
        assert.match(String(logs[0][0]), /error-transport-test/);
    });
});
