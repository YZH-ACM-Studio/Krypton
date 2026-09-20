import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describeHydroError, lookupErrorMessageTranslation, resolveErrorTransport, UserFacingError } from '@hydrooj/framework';

(global as any).Hydro ||= { model: {} };

const Module = require('module');
const serviceTokenPath = require.resolve('../src/lib/service-token.ts');
const originalLoad = Module._load;
let accepted: unknown;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../model/system') {
        return {
            __esModule: true,
            default: {
                get: (key: string) => (key.endsWith('.accepted') ? accepted : undefined),
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let ServiceTokenError: typeof import('../src/lib/service-token').ServiceTokenError;
let requireServiceToken: typeof import('../src/lib/service-token').requireServiceToken;
try {
    delete require.cache[serviceTokenPath];
    ({ ServiceTokenError, requireServiceToken } = require(serviceTokenPath));
} finally {
    Module._load = originalLoad;
}

const createTraceId = () => 'service-token-test';
const TEMPLATES = {
    missing: 'Service token missing',
    invalid: 'Service token invalid',
    'no-accepted-list': 'Service token no-accepted-list',
} as const;

function handler(token?: string | string[]) {
    return {
        request: {
            headers: token === undefined ? {} : { 'x-service-token': token },
        },
    } as Parameters<typeof requireServiceToken>[0];
}

function thrownServiceTokenError(run: () => void) {
    try {
        run();
    } catch (error) {
        assert.ok(error instanceof ServiceTokenError);
        return error;
    }
    throw new Error('expected ServiceTokenError');
}

function resolve(error: InstanceType<typeof ServiceTokenError>, locale = 'zh-CN') {
    return resolveErrorTransport(error, {
        locale,
        lookup: lookupErrorMessageTranslation,
        createTraceId,
    });
}

describe('ServiceTokenError user-facing transport', () => {
    it('is a 401 UserFacingError for each rejection reason', () => {
        for (const reason of ['missing', 'invalid', 'no-accepted-list'] as const) {
            const error = new ServiceTokenError(reason);
            assert.ok(error instanceof UserFacingError);
            assert.equal(error.name, 'ServiceTokenError');
            assert.equal(error.code, 401);
            assert.equal(error.reason, reason);
            assert.deepEqual(error.params, [reason]);
            assert.equal(describeHydroError(error).template, TEMPLATES[reason]);
            assert.equal(describeHydroError(error).status, 401);
        }
    });

    it('keeps 401 identity through error transport instead of collapsing to a 500 toast', () => {
        for (const reason of ['missing', 'invalid', 'no-accepted-list'] as const) {
            const result = resolve(new ServiceTokenError(reason));
            assert.equal(result.status, 401);
            assert.equal(result.template, 'error.html');
            assert.equal(result.userFacing, true);
            assert.equal(result.traceId, undefined);
            assert.equal(result.error.name, 'ServiceTokenError');
            assert.equal(result.error.errorCode, 'ServiceTokenError');
            assert.equal(result.error.code, 401);
            assert.equal(result.error.status, 401);
            assert.deepEqual(result.error.params, [reason]);
            assert.equal(result.error.message, lookupErrorMessageTranslation(TEMPLATES[reason], 'zh-CN'));
            assert.doesNotMatch(JSON.stringify(result.error), /secret|token-value|500|SystemError/);
        }
    });
});

describe('requireServiceToken', () => {
    it('fails closed when no accepted tokens are configured, even if a header is present', () => {
        accepted = [];
        const error = thrownServiceTokenError(() => requireServiceToken(handler('secret-token'), 'vigil'));
        assert.equal(error.reason, 'no-accepted-list');
        assert.equal(error.code, 401);
        assert.ok(error instanceof UserFacingError);
        const result = resolve(error);
        assert.equal(result.status, 401);
        assert.equal(result.error.message, '服务令牌接收列表未配置。');
        assert.doesNotMatch(JSON.stringify(result.error), /secret-token/);
    });

    it('fails closed when the accepted list is missing or malformed', () => {
        for (const value of [undefined, null, 'secret-token', { token: 'secret-token' }, ['']]) {
            accepted = value;
            const error = thrownServiceTokenError(() => requireServiceToken(handler('secret-token'), 'vigil'));
            assert.equal(error.reason, 'no-accepted-list');
        }
    });

    it('rejects a missing header as a 401 missing-token error', () => {
        accepted = ['accepted-token'];
        const error = thrownServiceTokenError(() => requireServiceToken(handler(), 'vigil'));
        assert.equal(error.reason, 'missing');
        const result = resolve(error);
        assert.equal(result.status, 401);
        assert.equal(result.error.message, '缺少服务令牌。');
    });

    it('rejects an empty header as missing rather than opening the gate', () => {
        accepted = ['accepted-token'];
        const error = thrownServiceTokenError(() => requireServiceToken(handler(''), 'vigil'));
        assert.equal(error.reason, 'missing');
    });

    it('rejects an invalid token without putting the presented value in the error', () => {
        accepted = ['accepted-token'];
        const error = thrownServiceTokenError(() => requireServiceToken(handler('wrong-token'), 'vigil'));
        assert.equal(error.reason, 'invalid');
        const result = resolve(error);
        assert.equal(result.status, 401);
        assert.equal(result.error.message, '服务令牌无效。');
        assert.doesNotMatch(JSON.stringify({ message: error.message, params: error.params, body: result.error }), /wrong-token/);
    });

    it('accepts a matching token and does not throw', () => {
        accepted = ['accepted-token'];
        requireServiceToken(handler('accepted-token'), 'vigil');
        requireServiceToken(handler(['accepted-token', 'ignored']), 'vigil');
    });
});
