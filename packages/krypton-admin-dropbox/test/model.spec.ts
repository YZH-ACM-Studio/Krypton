import { createHash } from 'node:crypto';
import { expect } from 'chai';
import { PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');

const modelPath = require.resolve('../src/model.ts');
const authPath = require.resolve('../src/auth.ts');
const errorsPath = require.resolve('../src/errors.ts');
const typesPath = require.resolve('../src/types.ts');
const originalLoad = Module._load;

type AnyDoc = Record<string, unknown>;

function idsEqual(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date) && !Array.isArray(value);
}

function clone<T>(value: T): T {
    if (value instanceof ObjectId) return value;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) out[key] = clone(nested);
        return out as T;
    }
    return value;
}

function matches(doc: AnyDoc, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, expected]) => idsEqual(doc[key], expected));
}

function sortRows(rows: AnyDoc[], spec: Record<string, number>): AnyDoc[] {
    const entries = Object.entries(spec);
    return [...rows].sort((left, right) => {
        for (const [key, dir] of entries) {
            const av = left[key];
            const bv = right[key];
            let cmp = 0;
            if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
            else if (av instanceof ObjectId || bv instanceof ObjectId) cmp = String(av).localeCompare(String(bv));
            else cmp = String(av).localeCompare(String(bv));
            if (cmp !== 0) return dir < 0 ? -cmp : cmp;
        }
        return 0;
    });
}

function memoryCollection() {
    const docs: AnyDoc[] = [];
    function query(filter: Record<string, unknown>) {
        return docs.filter((doc) => matches(doc, filter));
    }
    return {
        docs,
        async insertOne(doc: AnyDoc) {
            const copy = clone(doc);
            docs.push(copy);
            return { acknowledged: true, insertedId: copy._id };
        },
        async findOne(filter: Record<string, unknown>) {
            const found = query(filter)[0];
            return found ? clone(found) : null;
        },
        find(filter: Record<string, unknown> = {}) {
            let rows = query(filter).map((doc) => clone(doc));
            const cursor = {
                sort(spec: Record<string, number>) {
                    rows = sortRows(rows, spec);
                    return cursor;
                },
                async toArray() {
                    return rows;
                },
            };
            return cursor;
        },
        async deleteOne(filter: Record<string, unknown>) {
            const index = docs.findIndex((doc) => matches(doc, filter));
            if (index < 0) return { acknowledged: true, deletedCount: 0 };
            docs.splice(index, 1);
            return { acknowledged: true, deletedCount: 1 };
        },
        clear() {
            docs.splice(0, docs.length);
        },
    };
}

const filesColl = memoryCollection();
const stored = new Map<string, Buffer | string>();

function storedSize(path: string): number {
    const value = stored.get(path);
    if (value == null) return 0;
    if (typeof value === 'string') return Buffer.byteLength(value);
    return value.length;
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename || '';
    if (request === 'hydrooj' && filename.includes('krypton-admin-dropbox/src')) {
        return {
            CreateError: framework.CreateError,
            ForbiddenError: framework.ForbiddenError,
            NotFoundError: framework.NotFoundError,
            UserFacingError: framework.UserFacingError,
            ObjectId,
            PRIV,
            StorageModel: {
                async put(path: string, file: Buffer | string) {
                    stored.set(path, file);
                    return path;
                },
                async del(paths: string[]) {
                    for (const path of paths) stored.delete(path);
                },
                async getMeta(path: string) {
                    if (!stored.has(path)) return null;
                    return { size: storedSize(path) };
                },
                async exists(path: string) {
                    return stored.has(path);
                },
                async signDownloadLink(path: string, filename: string) {
                    return `https://signed.test/${path}?name=${encodeURIComponent(filename)}`;
                },
            },
            SystemModel: {
                get() {
                    return null;
                },
            },
        };
    }
    if (request === './db' && filename === modelPath) {
        return { dropboxFilesColl: filesColl };
    }
    return originalLoad.call(this, request, parent, isMain);
};

for (const path of [modelPath, authPath, errorsPath, typesPath]) {
    delete require.cache[path];
}

let model: typeof import('../src/model.ts');
let types: typeof import('../src/types.ts');
try {
    types = require(typesPath);
    model = require(modelPath);
} finally {
    Module._load = originalLoad;
}

function pdf(extra = 'body') {
    return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(extra)]);
}

function sha256(buf: Buffer) {
    return createHash('sha256').update(buf).digest('hex');
}

function admin(id = 2) {
    return {
        _id: id,
        domainId: 'system',
        hasPriv(priv: number) {
            return priv === PRIV.PRIV_EDIT_SYSTEM;
        },
    };
}

async function expectReject(work: () => Promise<unknown>, name: string) {
    try {
        await work();
    } catch (error) {
        expect((error as { name?: string }).name).to.equal(name);
        return;
    }
    expect.fail(`expected ${name}`);
}

beforeEach(() => {
    filesColl.clear();
    stored.clear();
});

describe('krypton-admin-dropbox storage prefix', () => {
    it('stores blobs under admin-dropbox/ and never collect/', async () => {
        expect(types.ADMIN_DROPBOX_STORAGE_PREFIX).to.equal('admin-dropbox/');
        expect(types.dropboxStoragePath('system', 'abc')).to.equal('admin-dropbox/system/abc');
        expect(types.isAdminDropboxStoragePath('admin-dropbox/system/abc')).to.equal(true);
        expect(types.isAdminDropboxStoragePath('collect/system/abc')).to.equal(false);
        expect(types.dropboxStoragePath('system', 'abc').startsWith('collect/')).to.equal(false);

        const body = pdf('dropbox');
        const doc = await model.create(admin(), body, 'notes.pdf', 'default');
        expect(doc.storagePath).to.equal(`admin-dropbox/system/${String(doc._id)}`);
        expect(doc.storagePath.startsWith(types.ADMIN_DROPBOX_STORAGE_PREFIX)).to.equal(true);
        expect(doc.storagePath.startsWith('collect/')).to.equal(false);
        expect(types.isAdminDropboxStoragePath(doc.storagePath)).to.equal(true);
        expect(stored.has(doc.storagePath)).to.equal(true);
        expect(stored.has(`collect/system/${String(doc._id)}`)).to.equal(false);
        expect(doc.expireAt.getTime() - doc.createdAt.getTime()).to.equal(types.ADMIN_DROPBOX_DEFAULT_TTL_MS);
    });
});

describe('krypton-admin-dropbox expired download', () => {
    it('fails closed when the file is past expireAt', async () => {
        const id = new ObjectId();
        const body = pdf('expired');
        const storagePath = types.dropboxStoragePath('system', String(id));
        stored.set(storagePath, body);
        await filesColl.insertOne({
            _id: id,
            domainId: 'system',
            ownerUid: 2,
            originalName: 'old.pdf',
            storagePath,
            size: body.length,
            sha256: sha256(body),
            createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
            expireAt: new Date(Date.now() - 1000),
            note: null,
        });

        await expectReject(() => model.download(admin(), id), 'AdminDropboxExpiredError');
        expect(stored.has(storagePath)).to.equal(false);
        expect(await filesColl.findOne({ _id: id })).to.equal(null);
    });
});
