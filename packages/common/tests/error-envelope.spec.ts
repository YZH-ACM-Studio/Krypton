import { expect } from 'chai';
import { describe, it } from 'node:test';
import { InvalidHydroErrorEnvelopeError, parseHydroErrorEnvelope, parseHydroErrorPayload, presentHydroErrorEnvelope } from '../error-envelope';

const payload = {
    name: 'ValidationError',
    errorCode: 'ValidationError',
    code: 400,
    status: 400,
    params: ['content'],
    message: '字段 content 校验失败。',
    nested: {
        0: {
            name: 'ValidationError.Parameter',
            errorCode: 'ValidationError.Parameter',
            code: 400,
            status: 400,
            params: [],
            message: '字段 content 不能为空。',
        },
    },
};

describe('Hydro client error envelope', () => {
    it('returns the authoritative server message without formatting raw params again', () => {
        const parsed = parseHydroErrorEnvelope({ error: payload });

        expect(parsed.message).to.equal('字段 content 校验失败。');
        expect(parsed.params).to.deep.equal(['content']);
        expect(parsed.nested?.[0]?.message).to.equal('字段 content 不能为空。');
    });

    it('accepts the same canonical payload at the server-rendered page boundary', () => {
        expect(parseHydroErrorPayload(payload).message).to.equal('字段 content 校验失败。');
    });

    it('rejects guessed legacy shapes and residual placeholders', () => {
        const invalid = [
            { error: '请求失败' },
            { message: '请求失败' },
            { error: { ...payload, message: '字段 {0} 校验失败。' } },
            { error: { ...payload, msg: '请求失败', message: undefined } },
            { error: { ...payload, params: 'content' } },
            { error: { ...payload, nested: { child: payload } } },
        ];

        for (const value of invalid) {
            expect(() => parseHydroErrorEnvelope(value)).to.throw(InvalidHydroErrorEnvelopeError);
        }
    });

    it('turns a malformed response into a safe traceable presentation', () => {
        const result = presentHydroErrorEnvelope(
            { error: { message: 'Field {0} failed', params: ['content'] } },
            {
                fallback: '保存失败',
                createTraceId: () => 'client-test-trace',
            },
        );

        expect(result.message).to.equal('保存失败：服务器返回了无法解析的错误响应。错误编号：client-test-trace');
        expect(result.traceId).to.equal('client-test-trace');
        expect(result.payload).to.equal(undefined);
        expect(result.diagnostic).to.be.instanceOf(InvalidHydroErrorEnvelopeError);
    });

    it('rejects an envelope whose status disagrees with the HTTP response', () => {
        const result = presentHydroErrorEnvelope(
            { error: payload },
            {
                fallback: '保存失败',
                createTraceId: () => 'status-mismatch-trace',
                expectedStatus: 409,
            },
        );

        expect(result.message).to.equal('保存失败：服务器返回了无法解析的错误响应。错误编号：status-mismatch-trace');
        expect(result.payload).to.equal(undefined);
        expect(result.diagnostic).to.be.instanceOf(InvalidHydroErrorEnvelopeError);
    });
});
