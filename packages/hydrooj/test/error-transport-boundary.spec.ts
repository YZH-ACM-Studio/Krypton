import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    BadRequestError,
    ConnectionHandler,
    dispatchWebSocketMessage,
    Handler,
    localizeError,
    lookupErrorMessageTranslation,
    NotFoundError,
    preferResolvedClientErrorTransport,
    resolveErrorTransport,
    UserFacingError,
    WebService,
} from '@hydrooj/framework';
import baseLayer from '@hydrooj/framework/base';

(global as any).Hydro ||= {};
(global as any).Hydro.model ||= {};

const createTraceId = () => 'error-transport-boundary-test';

function userFacingError() {
    return localizeError(new NotFoundError('P1000'), 'Problem {0} not found.', 'P1000');
}

function resolve(error: unknown, locale = 'zh-CN') {
    return resolveErrorTransport(error, {
        locale,
        lookup: lookupErrorMessageTranslation,
        createTraceId,
    });
}

function savedContext() {
    return {
        plugin() {
            return {
                ctx: { server: { renderers: {} } },
                async dispose() {
                    return undefined;
                },
            };
        },
    };
}

function fakeService() {
    return {
        activeHandlers: new Map(),
        ctx: {
            async parallel() {
                return undefined;
            },
            async serial() {
                return undefined;
            },
            emit() {
                return undefined;
            },
        },
    };
}

interface TransportResponseBody {
    error?: {
        name: string;
        message: string;
        status?: number;
    };
}

function fakeHttpContext() {
    const request = {
        method: 'get',
        host: 'oj.example.test',
        hostname: 'oj.example.test',
        ip: '127.0.0.1',
        headers: { accept: 'text/html' },
        cookies: {},
        body: {},
        files: {},
        query: {},
        querystring: '',
        path: '/p/P1000',
        originalPath: '/p/P1000',
        params: {},
        referer: '',
        json: false,
        websocket: false,
    };
    const body: TransportResponseBody = {};
    const response = {
        body,
        type: '',
        status: null as number | null,
        template: null as string | null,
        redirect: null,
        attachment() {},
        addHeader() {},
        disposition: null,
    };
    return {
        method: 'GET',
        params: {},
        session: {},
        holdFiles: [],
        request: { method: 'GET', body: {}, headers: request.headers },
        HydroContext: {
            args: {},
            request,
            response,
            UiContext: {},
            user: { _id: 1 },
            domain: { _id: 'system' },
        },
    };
}

function fakeSseContext() {
    const socket = {
        setTimeout() {},
        setNoDelay() {},
        setKeepAlive() {},
    };
    const request = {
        method: 'get',
        host: 'oj.example.test',
        hostname: 'oj.example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body: {},
        files: {},
        query: {},
        querystring: '',
        path: '/record-conn',
        originalPath: '/record-conn',
        params: {},
        referer: '',
        json: false,
        websocket: false,
        socket,
    };
    return {
        method: 'GET',
        params: {},
        session: {},
        status: undefined as number | undefined,
        body: undefined as unknown,
        compress: false,
        request: { socket, headers: {} },
        req: { socket },
        set() {},
        HydroContext: {
            args: {},
            request,
            response: {
                body: {},
                type: '',
                status: null,
                template: null,
            },
            UiContext: {},
            user: { _id: 1 },
            domain: { _id: 'system' },
        },
    };
}

function fakeWsConn() {
    const frames: unknown[] = [];
    const closes: Array<[number, string]> = [];
    return {
        frames,
        closes,
        conn: {
            send(data: unknown) {
                frames.push(typeof data === 'string' ? JSON.parse(data) : data);
            },
            close(code: number, reason: string) {
                closes.push([code, reason]);
            },
            readyState: 1,
            OPEN: 1,
            on() {},
            resume() {},
        },
        layer: { clients: new Set() },
    };
}

async function dispatchHttp(HandlerClass: typeof Handler) {
    const ctx = fakeHttpContext();
    await (WebService.prototype as any).handleHttp.call(fakeService(), ctx, HandlerClass, () => {}, savedContext());
    return ctx.HydroContext.response;
}

async function dispatchSse(HandlerClass: typeof ConnectionHandler) {
    const ctx = fakeSseContext();
    await (WebService.prototype as any).handleWS.call(fakeService(), ctx, HandlerClass, () => {}, null, null, savedContext());
    return ctx;
}

async function dispatchWs(HandlerClass: typeof ConnectionHandler) {
    const { frames, closes, conn, layer } = fakeWsConn();
    const ctx = fakeSseContext();
    await (WebService.prototype as any).handleWS.call(fakeService(), ctx, HandlerClass, () => {}, conn, layer, savedContext());
    return { frames, closes };
}

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
        path: '/transport-boundary',
        originalPath: '/transport-boundary',
        querystring: '',
        set() {},
        redirect() {},
    };
}

describe('P2.44 secondary-failure 4xx preservation', () => {
    it('wraps malformed WebSocket frames as BadRequestError without echoing the payload', async () => {
        const payloads: unknown[] = [];
        const failures: Error[] = [];
        const raw = '{"password":"secret"';

        await dispatchWebSocketMessage(
            raw,
            async (payload) => {
                payloads.push(payload);
            },
            async (error) => {
                failures.push(error);
            },
        );

        assert.deepEqual(payloads, []);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].name, 'BadRequestError');
        assert.ok(failures[0] instanceof BadRequestError);
        assert.doesNotMatch(failures[0].message, /password|secret|Unexpected token|JSON at position/);
        const transport = resolve(failures[0]);
        assert.equal(transport.status, 400);
        assert.equal(transport.userFacing, true);
        assert.equal(transport.error.name, 'BadRequestError');
        assert.equal(transport.error.message, '请求无效：JSON');
        assert.doesNotMatch(JSON.stringify(transport.error), /password|secret|Unexpected token|JSON at position/);
    });

    it('still delivers message-handler failures through the same WebSocket error callback', async () => {
        const failures: Error[] = [];
        await dispatchWebSocketMessage(
            '{"operation":"start"}',
            async () => {
                throw userFacingError();
            },
            async (error) => {
                failures.push(error);
            },
        );
        assert.equal(failures.length, 1);
        assert.equal(failures[0].name, 'NotFoundError');
    });

    it('keeps a resolved 4xx when a secondary failure is an AggregateError candidate', () => {
        const original = userFacingError();
        const secondary = new Error('onerror boom password=secret');
        const already = resolve(original);
        const preserved = preferResolvedClientErrorTransport(original, secondary, resolve, already, 'HTTP error handler failed');

        assert.equal(preserved.status, 404);
        assert.equal(preserved.error.name, 'NotFoundError');
        assert.equal(preserved.error.message, '题目 P1000 不存在。');
        assert.doesNotMatch(JSON.stringify(preserved.error), /password|secret|AggregateError|HTTP error handler failed/);
    });

    it('re-resolves the original UserFacingError when onerror throws before a transport exists', () => {
        const original = userFacingError();
        const preserved = preferResolvedClientErrorTransport(
            original,
            new Error('serial hook password=secret'),
            resolve,
            undefined,
            'HTTP error handler failed',
        );

        assert.equal(preserved.status, 404);
        assert.equal(preserved.error.message, '题目 P1000 不存在。');
        assert.doesNotMatch(JSON.stringify(preserved.error), /password|secret|AggregateError/);
    });

    it('keeps true internal failures as a safe 500 without leaking AggregateError internals', () => {
        const preserved = preferResolvedClientErrorTransport(
            new Error('database password=secret'),
            new Error('onerror boom'),
            resolve,
            undefined,
            'HTTP error handler failed',
        );

        assert.equal(preserved.status, 500);
        assert.equal(preserved.error.name, 'SystemError');
        assert.equal(preserved.error.message, '服务器发生了未预期错误。错误编号：error-transport-boundary-test');
        assert.doesNotMatch(JSON.stringify(preserved.error), /password|secret|AggregateError|onerror boom|HTTP error handler failed/);
    });

    it('does not replace a handled HTTP 4xx when onerror itself throws', async () => {
        class NotFoundOnerrorThrows extends Handler {
            resolveErrorLocale() {
                return 'zh-CN';
            }

            async get() {
                throw userFacingError();
            }

            async onerror(error: any) {
                await super.onerror(error);
                throw new Error('handler boom password=secret');
            }
        }

        const response = await dispatchHttp(NotFoundOnerrorThrows);
        assert.equal(response.status, 404);
        assert.equal(response.template, 'error.html');
        assert.equal(response.body.error.name, 'NotFoundError');
        assert.equal(response.body.error.message, '题目 P1000 不存在。');
        assert.doesNotMatch(JSON.stringify(response.body), /password|secret|AggregateError|handler boom/);
    });

    it('still fail-closes an internal HTTP error when onerror throws', async () => {
        class InternalOnerrorThrows extends Handler {
            resolveErrorLocale() {
                return 'zh-CN';
            }

            async get() {
                throw new Error('database password=secret');
            }

            async onerror() {
                throw new Error('handler boom password=secret');
            }
        }

        const response = await dispatchHttp(InternalOnerrorThrows);
        assert.equal(response.status, 500);
        assert.equal(response.body.error.name, 'SystemError');
        assert.equal(response.body.error.status, 500);
        assert.match(response.body.error.message, /服务器发生了未预期错误。错误编号：/);
        assert.doesNotMatch(JSON.stringify(response.body), /password|secret|AggregateError|handler boom|database/);
    });

    it('sends the original WebSocket 4xx envelope when onerror throws', async () => {
        class NotFoundOnerrorThrows extends ConnectionHandler {
            resolveErrorLocale() {
                return 'zh-CN';
            }

            prepare() {
                throw userFacingError();
            }

            async onerror() {
                throw new Error('ws handler boom password=secret');
            }
        }

        const { frames, closes } = await dispatchWs(NotFoundOnerrorThrows);
        assert.equal(frames.length, 1);
        const frame = frames[0] as { error: { name: string; status: number; message: string } };
        assert.equal(frame.error.name, 'NotFoundError');
        assert.equal(frame.error.status, 404);
        assert.equal(frame.error.message, '题目 P1000 不存在。');
        assert.deepEqual(closes, [[4000, '题目 P1000 不存在。']]);
        assert.doesNotMatch(JSON.stringify(frames), /password|secret|AggregateError|handler boom/);
    });

    it('sets SSE status from the resolved 4xx transport instead of hardcoding 500', async () => {
        class NotFoundPrepare extends ConnectionHandler {
            resolveErrorLocale() {
                return 'zh-CN';
            }

            prepare() {
                throw userFacingError();
            }
        }

        const ctx = await dispatchSse(NotFoundPrepare);
        assert.equal(ctx.status, 404);
    });

    it('keeps SSE status 500 for true internal failures', async () => {
        class InternalPrepare extends ConnectionHandler {
            resolveErrorLocale() {
                return 'zh-CN';
            }

            prepare() {
                throw new Error('database password=secret');
            }
        }

        const ctx = await dispatchSse(InternalPrepare);
        assert.equal(ctx.status, 500);
    });

    it('degrades a failed HTML error page to text/plain while keeping the original 4xx', async () => {
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

        assert.equal(context.response.status, 404);
        assert.equal(context.response.type, 'text/plain');
        assert.equal(context.body, '题目 P1000 不存在。');
        assert.ok(logs.some((entry) => String(entry[0]).includes('Error-page rendering failed')));
        assert.doesNotMatch(String(context.body), /secret|template path|AggregateError/);
    });

    it('keeps a failed internal error page as a safe text/plain 500', async () => {
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
            throw new Error('database password=secret');
        });

        assert.equal(context.response.status, 500);
        assert.equal(context.response.type, 'text/plain');
        assert.equal(context.body, '服务器发生了未预期错误。错误编号：error-transport-boundary-test');
        assert.doesNotMatch(String(context.body), /secret|template path|password|AggregateError|database/);
        assert.ok(logs.some((entry) => String(entry[0]).includes('error-transport-boundary-test')));
    });

    it('keeps an already-rendered 4xx envelope when the success-path error page fails', async () => {
        const logs: unknown[][] = [];
        const layer = baseLayer({ error: (...values: unknown[]) => logs.push(values) }, null, null);
        const context = fakeKoaContext('text/html');

        await layer(context as never, async () => {
            const transport = resolve(userFacingError());
            context.handler = {
                async renderHTML() {
                    throw new Error('template path=/secret/error.html');
                },
            };
            context.HydroContext!.response.status = transport.status;
            context.HydroContext!.response.template = transport.template;
            context.HydroContext!.response.body = {
                UserFacingError,
                error: transport.error,
            };
        });

        assert.equal(context.response.status, 404);
        assert.equal(context.response.type, 'text/plain');
        assert.equal(context.body, '题目 P1000 不存在。');
        assert.doesNotMatch(String(context.body), /secret|template path|AggregateError/);
    });
});
