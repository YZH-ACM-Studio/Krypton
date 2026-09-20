import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    CreateError,
    ForbiddenError,
    lookupErrorMessageTranslation,
    NotFoundError,
    resolveErrorTransport,
    UserFacingError,
} from '@hydrooj/framework';

const Module = require('module');
const errorsPath = require.resolve('../src/errors.ts');
const originalLoad = Module._load;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === errorsPath && request === 'hydrooj') {
        return {
            CreateError,
            ForbiddenError,
            NotFoundError,
            UserFacingError,
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let errors: typeof import('../src/errors.ts');
try {
    delete require.cache[errorsPath];
    errors = require(errorsPath);
} finally {
    Module._load = originalLoad;
}

function resolve(error: unknown) {
    return resolveErrorTransport(error, {
        locale: 'zh-CN',
        lookup: lookupErrorMessageTranslation,
        createTraceId: () => 'collect-error-test',
    });
}

describe('krypton-collect error transport', () => {
    it('keeps CollectForbiddenError as 403 with interpolated Access denied, not an unexpected-server-error toast', () => {
        const error = new errors.CollectForbiddenError('无权编辑此收集');
        expect(error).to.be.instanceOf(UserFacingError);
        expect(error.name).to.equal('CollectForbiddenError');
        expect(error.code).to.equal(403);
        expect(error.msg()).to.equal('Access denied: {0}');
        expect(error.params).to.deep.equal(['无权编辑此收集']);
        expect(lookupErrorMessageTranslation('Access denied: {0}', 'zh-CN')).to.equal('访问被拒绝：{0}');

        const result = resolve(error);
        expect(result.status).to.equal(403);
        expect(result.template).to.equal('error.html');
        expect(result.userFacing).to.equal(true);
        expect(result.traceId).to.equal(undefined);
        expect(result.error.name).to.equal('CollectForbiddenError');
        expect(result.error.errorCode).to.equal('CollectForbiddenError');
        expect(result.error.code).to.equal(403);
        expect(result.error.status).to.equal(403);
        expect(result.error.params).to.deep.equal(['无权编辑此收集']);
        expect(result.error.message).to.equal('访问被拒绝：无权编辑此收集');
        expect(result.error.message).to.not.match(/未预期错误|错误编号|SystemError/);
        expect(JSON.stringify(result.error)).to.not.match(/500|SystemError|未预期错误/);
    });

    it('interpolates CollectFileRejectedError scalar Chinese reasons as 400 Invalid request', () => {
        const reason = '文件过大';
        const error = new errors.CollectFileRejectedError(reason);
        expect(error).to.be.instanceOf(UserFacingError);
        expect(error.name).to.equal('CollectFileRejectedError');
        expect(error.code).to.equal(400);
        expect(error.msg()).to.equal('Invalid request: {0}');
        expect(error.params).to.deep.equal([reason]);
        expect(typeof error.params[0]).to.equal('string');
        expect(lookupErrorMessageTranslation('Invalid request: {0}', 'zh-CN')).to.equal('请求无效：{0}');

        const result = resolve(error);
        expect(result.status).to.equal(400);
        expect(result.template).to.equal('error.html');
        expect(result.userFacing).to.equal(true);
        expect(result.traceId).to.equal(undefined);
        expect(result.error.name).to.equal('CollectFileRejectedError');
        expect(result.error.errorCode).to.equal('CollectFileRejectedError');
        expect(result.error.code).to.equal(400);
        expect(result.error.status).to.equal(400);
        expect(result.error.params).to.deep.equal([reason]);
        expect(result.error.message).to.equal('请求无效：文件过大');
        expect(result.error.message).to.not.match(/未预期错误|错误编号|SystemError/);
        expect(JSON.stringify(result.error)).to.not.match(/500|SystemError|未预期错误/);
    });
});
