import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';

const Module = require('module');
const framework = require('../../../framework/framework');
const authPath = require.resolve('../src/auth.ts');
const handlerPath = require.resolve('../src/handler.ts');
const errorsPath = require.resolve('../src/errors.ts');
const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
const originalLoad = Module._load;

interface DropboxAuthUser { _id: number; hasPriv(p: number): boolean }
interface DropboxAuth {
    canUseAdminDropbox(user: DropboxAuthUser): boolean;
}

const modelCalls = {
    create: 0,
    list: 0,
    download: 0,
    remove: 0,
};

class FakeForbiddenError extends Error {
    name = 'PrivilegeError';
}

class FakeHandler {
    user: { _id: number; hasPriv(priv: number): boolean };
    domain = { _id: 'system' };
    args: Record<string, unknown> = {};
    request: { files?: { file?: { filepath?: string; size?: number; originalFilename?: string } }; body?: Record<string, unknown> } = {};
    response: { body?: unknown; template?: string; redirect?: string; addHeader: (name: string, value: string) => void } = {
        addHeader() { /* test stub */ },
    };

    checkPriv(priv: number) {
        if (!this.user.hasPriv(priv)) throw new FakeForbiddenError('forbidden');
    }

    async limitRate() { /* test stub */ }
}

const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename || '';
    if (request === 'hydrooj' && filename.includes('krypton-admin-dropbox/src')) {
        return {
            CreateError: framework.CreateError,
            ForbiddenError: framework.ForbiddenError,
            NotFoundError: framework.NotFoundError,
            UserFacingError: framework.UserFacingError,
            Context: class {},
            Handler: FakeHandler,
            ObjectId,
            OplogModel: { log: async () => undefined },
            PRIV,
            StorageModel: {},
            Types,
            ValidationError: class extends Error { name = 'ValidationError'; },
            param,
        };
    }
    if (parent?.filename === handlerPath && request === './model') {
        return {
            async create() { modelCalls.create += 1; return { _id: new ObjectId(), size: 1, sha256: 'a'.repeat(64) }; },
            async list() { modelCalls.list += 1; return []; },
            async download() { modelCalls.download += 1; return { url: '/signed', file: { _id: new ObjectId(), size: 1 } }; },
            async remove() { modelCalls.remove += 1; },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let auth: DropboxAuth;
let AdminDropboxHandler: typeof FakeHandler;
let AdminDropboxDownloadHandler: typeof FakeHandler;
try {
    delete require.cache[authPath];
    delete require.cache[errorsPath];
    delete require.cache[handlerPath];
    auth = require(authPath) as DropboxAuth;
    ({ AdminDropboxHandler, AdminDropboxDownloadHandler } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function user(id: number, flags?: { privs?: number[] }): DropboxAuthUser {
    const privs = new Set(flags?.privs ?? []);
    return {
        _id: id,
        hasPriv(priv: number) {
            return privs.has(priv);
        },
    };
}

function handler(isAdmin: boolean, Ctor: typeof FakeHandler = AdminDropboxHandler) {
    const instance = Reflect.construct(Ctor, []) as FakeHandler;
    instance.user = {
        _id: isAdmin ? 2 : 10,
        hasPriv: (priv: number) => isAdmin && priv === PRIV.PRIV_EDIT_SYSTEM,
    };
    instance.response = { addHeader() { /* test stub */ } };
    instance.request = {};
    instance.args = {};
    return instance as FakeHandler & {
        prepare: () => Promise<void>;
        get: (...args: unknown[]) => Promise<void>;
        postUploadFile: (...args: unknown[]) => Promise<void>;
        postDelete: (...args: unknown[]) => Promise<void>;
    };
}

async function capture(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
        return null;
    } catch (error) {
        return error;
    }
}

describe('krypton-admin-dropbox auth', () => {
    it('forbids teachers and other non-admins; only PRIV_EDIT_SYSTEM may use the dropbox', () => {
        expect(auth.canUseAdminDropbox(user(2))).to.equal(false);
        expect(auth.canUseAdminDropbox(user(3, { privs: [] }))).to.equal(false);
        const teacher = {
            _id: 10,
            hasPriv: () => false,
            hasPerm: (perm: bigint) => perm === PERM.PERM_CREATE_COLLECT,
        };
        expect(auth.canUseAdminDropbox(teacher)).to.equal(false);
        expect(auth.canUseAdminDropbox(user(2, { privs: [PRIV.PRIV_EDIT_SYSTEM] }))).to.equal(true);
    });

    it('rejects non-admin list, upload, delete, and download before model writes', async () => {
        modelCalls.create = 0;
        modelCalls.list = 0;
        modelCalls.download = 0;
        modelCalls.remove = 0;

        const listHandler = handler(false);
        expect(await capture(() => listHandler.prepare())).to.be.instanceOf(FakeForbiddenError);
        expect(await capture(() => listHandler.postUploadFile('system'))).to.be.instanceOf(FakeForbiddenError);
        expect(await capture(() => listHandler.postDelete('system', new ObjectId()))).to.be.instanceOf(FakeForbiddenError);

        const downloadHandler = handler(false, AdminDropboxDownloadHandler);
        expect(await capture(() => downloadHandler.prepare())).to.be.instanceOf(FakeForbiddenError);

        expect(modelCalls.create).to.equal(0);
        expect(modelCalls.list).to.equal(0);
        expect(modelCalls.download).to.equal(0);
        expect(modelCalls.remove).to.equal(0);
    });

    it('is mounted at /admin/dropbox with checkPriv, not /collect or exam-mode', () => {
        expect(handlerSource).to.include("'/admin/dropbox'");
        expect(handlerSource).to.include('checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(handlerSource).to.include('admin_dropbox.html');
        expect(handlerSource).to.include('async postUploadFile');
        expect(handlerSource).to.include('async postDelete');
        expect(handlerSource).not.to.match(/['"`]\/collect/);
        expect(handlerSource).to.not.include('/exam-mode');
        expect(handlerSource).to.not.include('/paper');
    });
});
