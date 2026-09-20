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
        createTraceId: () => 'dropbox-error-test',
    });
}

describe('krypton-admin-dropbox errors', () => {
    it('uses cataloged templates, keeps statuses, and stores scalar Chinese rejection reasons', () => {
        const notFound = new errors.AdminDropboxNotFoundError();
        expect(notFound.name).to.equal('AdminDropboxNotFoundError');
        expect(notFound.msg()).to.equal('文件不存在');
        expect(notFound.code).to.equal(404);

        const forbidden = new errors.AdminDropboxForbiddenError();
        expect(forbidden.name).to.equal('AdminDropboxForbiddenError');
        expect(forbidden.msg()).to.equal('需要系统管理权限');
        expect(forbidden.code).to.equal(403);

        const rejected = new errors.AdminDropboxFileRejectedError('过期时间不合法');
        expect(rejected.name).to.equal('AdminDropboxFileRejectedError');
        expect(rejected.msg()).to.equal('Invalid request: {0}');
        expect(rejected.params).to.deep.equal(['过期时间不合法']);
        expect(typeof rejected.params[0]).to.equal('string');
        expect(rejected.code).to.equal(400);

        const expired = new errors.AdminDropboxExpiredError();
        expect(expired.name).to.equal('AdminDropboxExpiredError');
        expect(expired.msg()).to.equal('文件已过期');
        expect(expired.code).to.equal(410);
    });

    it('interpolates AdminDropboxFileRejectedError scalar Chinese reasons as 400 Invalid request', () => {
        const reason = '过期时间不合法';
        const error = new errors.AdminDropboxFileRejectedError(reason);
        expect(error).to.be.instanceOf(UserFacingError);
        expect(error.name).to.equal('AdminDropboxFileRejectedError');
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
        expect(result.error.name).to.equal('AdminDropboxFileRejectedError');
        expect(result.error.errorCode).to.equal('AdminDropboxFileRejectedError');
        expect(result.error.code).to.equal(400);
        expect(result.error.status).to.equal(400);
        expect(result.error.params).to.deep.equal([reason]);
        expect(result.error.message).to.equal('请求无效：过期时间不合法');
        expect(result.error.message).to.not.match(/未预期错误|错误编号|SystemError/);
        expect(JSON.stringify(result.error)).to.not.match(/500|SystemError|未预期错误/);
    });
});
