import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    CreateError as defineHydroError,
    createErrorTraceId,
    describeHydroError,
    ErrorMessageResolutionError,
    HydroError,
    resolveErrorLocale,
    resolveErrorMessage,
    type ErrorMessageDescriptor,
    UserFacingError,
    ValidationError,
} from '@hydrooj/framework';
import { ProblemNotFoundError, ProblemStructureConflictError } from '../src/error';

const translations = new Map<string, string>([
    ['zh-CN:Problem {0} changed.', '题目 {0} 已发生变化。'],
    ['en:Problem {0} changed.', 'Problem {0} changed.'],
    ['zh-CN:Values {0}, {1}, {0}.', '值为 {0}、{1}，再次为 {0}。'],
    ['zh-CN:Child {0}.', '子错误：{0}。'],
    ['zh-CN:Parent {0}.', '父错误：{0}。'],
    ['zh-CN:Field {0} validation failed. ({2})', '字段 {0} 验证失败。（{2}）'],
    ['zh-CN:Problem {1} not found.', '题目 {1} 不存在。'],
]);

const lookup = (template: string, locale: string) => translations.get(`${locale}:${template}`) ?? null;
const traceId = () => 'trace-test-001';

function descriptor(template: string, params: readonly unknown[] = []): ErrorMessageDescriptor {
    return {
        name: 'TestError',
        errorCode: 'TestError',
        status: 400,
        template,
        params,
        messageParams: Object.fromEntries(params.map((value, index) => [index, value])),
    };
}

function expectFailure(run: () => unknown, reason: ErrorMessageResolutionError['reason']) {
    assert.throws(run, (error: unknown) => {
        assert.ok(error instanceof ErrorMessageResolutionError);
        assert.equal(error.reason, reason);
        assert.equal(error.traceId, 'trace-test-001');
        assert.equal(error.errorName, 'TestError');
        assert.equal(error.locale, 'zh-CN');
        return true;
    });
}

describe('P2.42 error locale selection', () => {
    it('keeps ui-next fixed to zh-CN', () => {
        assert.equal(
            resolveErrorLocale({
                surface: 'ui-next',
                authenticated: true,
                userLocale: 'en_US',
                sessionLocale: 'ja',
                requestLocales: ['ko'],
                domainLocale: 'en',
            }),
            'zh-CN',
        );
    });

    it('uses the authenticated user, session, request and domain facts in order', () => {
        assert.equal(
            resolveErrorLocale({
                surface: 'legacy-ui',
                authenticated: true,
                userLocale: 'en_US',
                sessionLocale: 'ja',
                requestLocales: ['ko'],
                domainLocale: 'zh_CN',
            }),
            'en-US',
        );
        assert.equal(
            resolveErrorLocale({
                surface: 'api',
                authenticated: true,
                sessionLocale: 'ja_JP',
                requestLocales: ['ko'],
                domainLocale: 'zh_CN',
            }),
            'ja-JP',
        );
        assert.equal(
            resolveErrorLocale({
                surface: 'websocket',
                authenticated: true,
                requestLocales: ['ko_KR'],
                domainLocale: 'zh_CN',
            }),
            'ko-KR',
        );
        assert.equal(
            resolveErrorLocale({
                surface: 'legacy-ui',
                authenticated: true,
                requestLocales: [],
                domainLocale: 'zh_CN',
            }),
            'zh-CN',
        );
        assert.equal(
            resolveErrorLocale({
                surface: 'api',
                authenticated: true,
                requestLocales: ['*'],
                domainLocale: 'zh_CN',
            }),
            'zh-CN',
        );
    });

    it('uses the domain default for unauthenticated requests', () => {
        assert.equal(
            resolveErrorLocale({
                surface: 'api',
                authenticated: false,
                sessionLocale: 'en',
                requestLocales: ['en-US'],
                domainLocale: 'zh_CN',
            }),
            'zh-CN',
        );
    });

    it('rejects missing or malformed authoritative locale facts', () => {
        assert.throws(
            () =>
                resolveErrorLocale({
                    surface: 'legacy-ui',
                    authenticated: true,
                    domainLocale: '',
                }),
            /domainLocale/,
        );
        assert.throws(
            () =>
                resolveErrorLocale({
                    surface: 'legacy-ui',
                    authenticated: true,
                    userLocale: '../../etc/passwd',
                    domainLocale: 'zh_CN',
                }),
            /locale/i,
        );
    });
});

describe('P2.42 strict localized error resolver', () => {
    it('resolves single, repeated and Unicode positional parameters deterministically', () => {
        const single = resolveErrorMessage(descriptor('Problem {0} changed.', ['P4056']), {
            locale: 'zh-CN',
            lookup,
            createTraceId: traceId,
        });
        assert.equal(single.message, '题目 P4056 已发生变化。');
        assert.equal(single.name, 'TestError');
        assert.equal(single.errorCode, 'TestError');
        assert.equal(single.status, 400);
        assert.deepEqual(single.params, ['P4056']);

        const repeated = resolveErrorMessage(descriptor('Values {0}, {1}, {0}.', ['甲', '✓']), {
            locale: 'zh-CN',
            lookup,
            createTraceId: traceId,
        });
        assert.equal(repeated.message, '值为 甲、✓，再次为 甲。');
    });

    it('keeps parameter text inert for the HTML/React escaping boundary', () => {
        const result = resolveErrorMessage(descriptor('Problem {0} changed.', ['<script>alert(1)</script>']), {
            locale: 'zh-CN',
            lookup,
            createTraceId: traceId,
        });
        assert.equal(result.message, '题目 <script>alert(1)</script> 已发生变化。');
        assert.equal(typeof result.message, 'string');
    });

    it('recursively resolves nested user-facing errors without object stringification', () => {
        const child = descriptor('Child {0}.', ['P1000']);
        const parent = descriptor('Parent {0}.', [null]);
        const result = resolveErrorMessage(
            {
                ...parent,
                nested: { 0: child },
            },
            {
                locale: 'zh-CN',
                lookup,
                createTraceId: traceId,
            },
        );

        assert.equal(result.message, '父错误：子错误：P1000。。');
        assert.equal(result.nested?.[0]?.message, '子错误：P1000。');
    });

    it('fails closed on a missing translation', () => {
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Unknown {0}.', ['value']), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'missing_translation',
        );
    });

    it('fails closed when source and localized placeholder indexes drift', () => {
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {0} changed.', ['P1']), {
                    locale: 'zh-CN',
                    lookup: () => '题目 {1} 已变化。',
                    createTraceId: traceId,
                }),
            'placeholder_mismatch',
        );
    });

    it('fails closed on missing, extra or undefined positional parameters', () => {
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Values {0}, {1}, {0}.', ['one']), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'parameter_mismatch',
        );
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {0} changed.', ['P1', 'extra']), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'parameter_mismatch',
        );
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {0} changed.', [undefined]), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'invalid_parameter',
        );
    });

    it('fails closed on malformed braces and placeholder-looking output', () => {
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {x} changed.', ['P1']), {
                    locale: 'zh-CN',
                    lookup: () => '题目 {x} 已变化。',
                    createTraceId: traceId,
                }),
            'malformed_template',
        );
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {0} changed.', ['{1}']), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'unresolved_placeholder',
        );
    });

    it('fails closed on non-scalar parameters unless they are explicit nested errors', () => {
        expectFailure(
            () =>
                resolveErrorMessage(descriptor('Problem {0} changed.', [{ pid: 'P1' }]), {
                    locale: 'zh-CN',
                    lookup,
                    createTraceId: traceId,
                }),
            'invalid_parameter',
        );
    });

    it('keeps raw machine params while only validating the parameters referenced by an existing Hydro template', () => {
        const validation = new ValidationError('title', null, 'required');
        const validationResult = resolveErrorMessage(describeHydroError(validation), {
            locale: 'zh-CN',
            lookup,
            createTraceId: traceId,
        });
        assert.deepEqual(validationResult.params, ['title', null, 'required']);
        assert.deepEqual(validationResult.messageParams, { 0: 'title', 2: 'required' });
        assert.equal(validationResult.message, '字段 title 验证失败。（required）');

        const notFound = new ProblemNotFoundError('system', 123);
        const notFoundResult = resolveErrorMessage(describeHydroError(notFound), {
            locale: 'zh-CN',
            lookup,
            createTraceId: traceId,
        });
        assert.deepEqual(notFoundResult.params, ['system', 123]);
        assert.deepEqual(notFoundResult.messageParams, { 1: 123 });
        assert.equal(notFoundResult.message, '题目 123 不存在。');
    });

    it('keeps raw params while separating dynamic display params', () => {
        const DynamicError = defineHydroError('DynamicError', UserFacingError, function (this: HydroError) {
            this.params[0] = 'View this domain';
            return 'Permission {0}.';
        });
        const error = new DynamicError(1n);
        const described = describeHydroError(error);

        assert.deepEqual(error.params, [1n]);
        assert.deepEqual(described.params, [1n]);
        assert.deepEqual(described.messageParams, { 0: 'View this domain' });
    });

    it('creates trace IDs with getRandomValues when randomUUID is unavailable on an HTTP origin', () => {
        const value = createErrorTraceId({
            getRandomValues(bytes) {
                for (let index = 0; index < bytes.length; index++) bytes[index] = index;
                return bytes;
            },
        });

        assert.equal(value, 'error-00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('describes existing Hydro errors without changing their identity, status or params', () => {
        const error = new ProblemStructureConflictError('P4056');
        const described = describeHydroError(error);

        assert.equal(error.name, 'ProblemStructureConflictError');
        assert.equal(error.code, 409);
        assert.deepEqual(error.params, ['P4056']);
        assert.equal(error.msg(), 'Problem {0} has changed or its structure is locked. Reload and try again.');
        assert.deepEqual(described, {
            name: 'ProblemStructureConflictError',
            errorCode: 'ProblemStructureConflictError',
            status: 409,
            template: 'Problem {0} has changed or its structure is locked. Reload and try again.',
            params: ['P4056'],
            messageParams: { 0: 'P4056' },
        });
    });
});
