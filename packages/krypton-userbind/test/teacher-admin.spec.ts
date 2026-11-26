import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { Document, ObjectId } from 'mongodb';
import {
    BadRequestError,
    CreateError,
    ForbiddenError,
    localizedErrorText,
    localizeError,
    localizeErrorParameter,
    NotFoundError,
    SystemError,
    ValidationError,
} from '@hydrooj/framework';
import { param } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';

const nodeRequire = createRequire(__filename);
const worktreeCommon = nodeRequire(join(__dirname, '../../common/index.ts')) as {
    PERM: Record<string, bigint>;
    PRIV: { PRIV_EDIT_SYSTEM: number; PRIV_USER_PROFILE: number };
    TEACHER_CAPABILITIES: ReadonlyArray<{ key: string; perm: bigint }>;
    TEACHER_CAPABILITY_MASK: bigint;
};
const { PERM, PRIV, TEACHER_CAPABILITIES, TEACHER_CAPABILITY_MASK } = worktreeCommon;

const domainId = 'lab';
const otherDomainId = 'other';
const adminUid = 2;
const adaUid = 20;
const beaUid = 7;
const carlUid = 9;
const doraUid = 15;
const rootUid = 16;
const missingUid = 404;
const goodPassword = 'admin-secret';
const docContest = 30;
const docTraining = 40;
const docProblem = 10;
const adaLoginAt = '2026-10-01T08:00:00.000Z';

class FakeCollection {
    docs: Document[] = [];

    clear() {
        this.docs.length = 0;
    }

    async findOne(filter: Record<string, unknown> = {}) {
        const found = this.docs.find((doc) => matchesFilter(doc, filter));
        return found ? cloneDoc(found) : null;
    }

    find(filter: Record<string, unknown> = {}) {
        const state = {
            rows: this.docs.filter((doc) => matchesFilter(doc, filter)).map(cloneDoc),
        };
        const cursor = {
            sort(spec?: Record<string, number>) {
                if (spec) state.rows.sort((left, right) => compareDocs(left, right, spec));
                return cursor;
            },
            skip() {
                return cursor;
            },
            limit() {
                return cursor;
            },
            project() {
                return cursor;
            },
            async toArray() {
                return state.rows;
            },
        };
        return cursor;
    }

    async insertOne(doc: Document) {
        this.docs.push(cloneDoc(doc));
        return { insertedId: doc._id };
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) {
        const index = this.docs.findIndex((doc) => matchesFilter(doc, filter));
        if (index < 0) {
            if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0 };
            const created: Document = {};
            for (const [key, value] of Object.entries(filter)) {
                if (key === '$or' || isOperator(value)) continue;
                created[key] = value;
            }
            applyUpdate(created, update);
            this.docs.push(created);
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
        }
        applyUpdate(this.docs[index], update);
        return { matchedCount: 1, modifiedCount: 1 };
    }

    async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
        let matchedCount = 0;
        for (const doc of this.docs) {
            if (!matchesFilter(doc, filter)) continue;
            matchedCount += 1;
            applyUpdate(doc, update);
        }
        return { matchedCount, modifiedCount: matchedCount };
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) {
        await this.updateOne(filter, update, options);
        return this.findOne(filter);
    }

    async countDocuments(filter: Record<string, unknown> = {}) {
        return this.docs.filter((doc) => matchesFilter(doc, filter)).length;
    }

    async createIndex() {
        return 'index';
    }
}

function cloneDoc<T extends Document>(doc: T): T {
    const out: Document = { ...doc };
    for (const key of Object.keys(out)) {
        const value = out[key];
        if (Array.isArray(value)) out[key] = [...value];
        else if (value && typeof value === 'object' && !isOperator(value) && !(value instanceof Date) && hexOf(value) == null && !Array.isArray(value)) {
            out[key] = { ...(value as Document) };
        }
    }
    return out as T;
}

function hexOf(value: unknown): string | null {
    if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
        return (value as { toHexString: () => string }).toHexString();
    }
    return null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    const leftHex = hexOf(left);
    const rightHex = hexOf(right);
    if (leftHex && rightHex) return leftHex === rightHex;
    if (typeof (left as { equals?: unknown }).equals === 'function' && (left as { equals: (other: unknown) => boolean }).equals(right)) return true;
    if (typeof (right as { equals?: unknown }).equals === 'function' && (right as { equals: (other: unknown) => boolean }).equals(left)) return true;
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return false;
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    if (hexOf(value)) return false;
    return Object.keys(value as object).some((key) => key.startsWith('$'));
}

function matchesValue(docValue: unknown, expected: unknown): boolean {
    if (Array.isArray(docValue) && !Array.isArray(expected) && !isOperator(expected)) {
        return docValue.some((item) => valuesEqual(item, expected));
    }
    if (Array.isArray(docValue) && Array.isArray(expected)) {
        return docValue.length === expected.length && docValue.every((item, index) => valuesEqual(item, expected[index]));
    }
    return valuesEqual(docValue, expected);
}

function matchesFilter(doc: Document, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter || {})) {
        if (key === '$or') {
            const clauses = value as Array<Record<string, unknown>>;
            if (!clauses.some((clause) => matchesFilter(doc, clause))) return false;
            continue;
        }
        if (key === '$and') {
            const clauses = value as Array<Record<string, unknown>>;
            if (!clauses.every((clause) => matchesFilter(doc, clause))) return false;
            continue;
        }
        const docValue = doc[key];
        if (isOperator(value)) {
            if ('$in' in value && !(value.$in as unknown[]).some((item) => valuesEqual(docValue, item) || (Array.isArray(docValue) && docValue.some((entry) => valuesEqual(entry, item))))) return false;
            if ('$eq' in value && !valuesEqual(docValue, value.$eq)) return false;
            if ('$ne' in value && valuesEqual(docValue, value.$ne)) return false;
            if ('$exists' in value) {
                const exists = value.$exists !== false && value.$exists !== 0 && value.$exists !== null;
                if (exists !== (docValue !== undefined)) return false;
            }
            continue;
        }
        if (!matchesValue(docValue, value)) return false;
    }
    return true;
}

function setDeep(doc: Document, path: string, value: unknown) {
    const parts = path.split('.');
    let cursor: Document = doc;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        const next = cursor[part];
        if (next == null || typeof next !== 'object' || Array.isArray(next) || hexOf(next) || next instanceof Date) cursor[part] = {};
        cursor = cursor[part] as Document;
    }
    cursor[parts[parts.length - 1]] = value;
}

function unsetDeep(doc: Document, path: string) {
    const parts = path.split('.');
    let cursor: Document = doc;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const next = cursor[parts[index]];
        if (next == null || typeof next !== 'object' || Array.isArray(next)) return;
        cursor = next as Document;
    }
    delete cursor[parts[parts.length - 1]];
}

function applyAddToSet(doc: Document, addToSet: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(addToSet)) {
        const values = raw && typeof raw === 'object' && '$each' in (raw as object) ? ((raw as { $each: unknown[] }).$each ?? []) : [raw];
        if (!Array.isArray(doc[key])) doc[key] = doc[key] == null ? [] : [doc[key]];
        const list = doc[key] as unknown[];
        for (const value of values) {
            if (!list.some((item) => valuesEqual(item, value))) list.push(value);
        }
    }
}

function applyPull(doc: Document, pull: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(pull)) {
        if (!Array.isArray(doc[key])) continue;
        const deny = raw && typeof raw === 'object' && '$in' in (raw as object) ? ((raw as { $in: unknown[] }).$in ?? []) : [raw];
        doc[key] = (doc[key] as unknown[]).filter((item) => !deny.some((value) => valuesEqual(item, value)));
    }
}

function applyUpdate(doc: Document, update: Record<string, unknown>) {
    if (update.$set && typeof update.$set === 'object') {
        for (const [key, value] of Object.entries(update.$set as Record<string, unknown>)) setDeep(doc, key, value);
    }
    if (update.$unset && typeof update.$unset === 'object') {
        for (const key of Object.keys(update.$unset as object)) unsetDeep(doc, key);
    }
    if (update.$addToSet && typeof update.$addToSet === 'object') applyAddToSet(doc, update.$addToSet as Record<string, unknown>);
    if (update.$pull && typeof update.$pull === 'object') applyPull(doc, update.$pull as Record<string, unknown>);
}

function sortKey(value: unknown): string | number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.getTime();
    const hex = hexOf(value);
    if (hex) return hex;
    if (value == null) return '';
    return String(value);
}

function compareDocs(left: Document, right: Document, spec: Record<string, number>): number {
    for (const [key, direction] of Object.entries(spec)) {
        if (direction !== 1 && direction !== -1) continue;
        const av = sortKey(left[key]);
        const bv = sortKey(right[key]);
        if (av === bv) continue;
        if (av < bv) return direction === 1 ? -1 : 1;
        return direction === 1 ? 1 : -1;
    }
    return 0;
}

interface OplogEntry {
    type: string;
    data: Record<string, unknown>;
}

interface TeachersHandler {
    user: {
        _id: number;
        priv: number;
        hasPriv: (priv: number) => boolean;
        checkPassword: (password: string) => Promise<void>;
    };
    domain: { _id: string };
    args: Record<string, unknown>;
    request: { body: Record<string, unknown>; query: Record<string, unknown>; params: Record<string, unknown>; headers: Record<string, unknown> };
    response: { template?: string; body?: unknown; redirect?: string };
    session: Record<string, unknown>;
    prepare?: () => Promise<void>;
    get?: (args: Record<string, unknown>) => Promise<unknown>;
    limitRate: (...args: unknown[]) => Promise<void>;
    checkPriv: (priv: number) => void;
    url: (name: string, params?: Record<string, unknown>) => string;
}

interface RegisteredRoute {
    name: string;
    path: string;
    Handler: new () => TeachersHandler;
    priv: number;
}

interface TeacherRow {
    uid: number;
    uname: string;
    schoolIds: string[];
    owned: { courses: number; sets: number; groups: number };
    loginAt: string | null;
}

interface CapabilityItem {
    key: string;
    enabled: boolean;
    defaultEnabled: boolean;
}

interface TeachersPayload {
    teachers: TeacherRow[];
    schools: Array<{ id: string; name: string }>;
    capabilities: {
        customized: boolean;
        stored: string | null;
        effective: string;
        items: CapabilityItem[];
    };
}

interface Fixture {
    alpha: ObjectId;
    beta: ObjectId;
    foreign: ObjectId;
}

const collections = new Map<string, FakeCollection>();
const oplogs: OplogEntry[] = [];
const rateLimits: unknown[][] = [];
const passwordChecks: string[] = [];
const routes: RegisteredRoute[] = [];
let loadError: unknown;
let fx: Fixture = { alpha: new ObjectId(), beta: new ObjectId(), foreign: new ObjectId() };

function collection(name: string): FakeCollection {
    let coll = collections.get(name);
    if (!coll) {
        coll = new FakeCollection();
        collections.set(name, coll);
    }
    return coll;
}

class PermissionError extends Error {
    constructor(message?: string) {
        super(message || 'Permission denied');
        this.name = 'PermissionError';
    }
}

class RecordingHandler {
    user: TeachersHandler['user'] = {
        _id: 0,
        priv: 0,
        hasPriv: () => false,
        checkPassword: async () => undefined,
    };

    domain = { _id: domainId };

    args: Record<string, unknown> = { domainId };

    request: TeachersHandler['request'] = { body: {}, query: {}, params: {}, headers: {} };

    response: TeachersHandler['response'] = {};

    session: Record<string, unknown> = {};

    checkPriv(priv: number) {
        if (!this.user.hasPriv(priv)) throw new PermissionError();
    }

    async limitRate(...args: unknown[]) {
        rateLimits.push(args);
    }

    url(name: string) {
        return `/${name}`;
    }
}

class RecordingLogger {
    constructor(public name: string) {}

    info() {}

    warn() {}

    error() {}

    debug() {}

    success() {}
}

const DomainModel = {
    async get(rawDomainId: string) {
        const lowered = String(rawDomainId).toLowerCase();
        const found = collection('domain').docs.find((doc) => doc.lower === lowered || doc._id === rawDomainId || doc._id === lowered);
        return found ? cloneDoc(found) : null;
    },
    async setUserRole(rawDomainId: string, uid: number, role: string, autojoin = false) {
        const coll = collection('domain.user');
        const existing = coll.docs.find((doc) => doc.domainId === rawDomainId && doc.uid === uid);
        if (!existing) {
            await coll.insertOne({ domainId: rawDomainId, uid, role, ...(autojoin ? { join: true } : {}) });
            return { upsertedCount: 1 };
        }
        return coll.updateOne({ domainId: rawDomainId, uid }, { $set: { role, ...(autojoin ? { join: true } : {}) } });
    },
    async compareAndSetRolePermission(rawDomainId: string, role: string, expected: bigint, next: bigint) {
        if (role === 'root') return { state: 'conflict' as const };
        const current = collection('domain').docs.find((doc) => doc._id === rawDomainId || doc.lower === String(rawDomainId).toLowerCase());
        if (!current) return { state: 'missing' as const };
        if (!current.roles || typeof current.roles !== 'object') current.roles = {};
        const roles = current.roles as Record<string, string>;
        const stored = Object.hasOwn(roles, role);
        const effective = stored ? BigInt(roles[role]) : role === 'teacher' ? PERM.PERM_TEACHER : undefined;
        if (effective === undefined) return { state: 'missing' as const };
        if (effective !== expected) return { state: 'conflict' as const, current: effective };
        roles[role] = next.toString();
        return { state: 'updated' as const };
    },
    async resetBuiltinRolePermission(rawDomainId: string, role: string, expected: string) {
        if (role !== 'teacher') return { state: 'not_builtin' as const };
        const current = collection('domain').docs.find((doc) => doc._id === rawDomainId || doc.lower === String(rawDomainId).toLowerCase());
        if (!current || !current.roles || typeof current.roles !== 'object' || !Object.hasOwn(current.roles as object, role)) {
            return { state: 'missing' as const };
        }
        const roles = current.roles as Record<string, string>;
        if (roles[role] !== expected) return { state: 'conflict' as const };
        delete roles[role];
        return { state: 'reset' as const };
    },
};

const UserModel = {
    coll: collection('user'),
    async getById(requestedDomain: string, uid: number) {
        const user = await collection('user').findOne({ _id: uid });
        if (!user) return null;
        const membership = collection('domain.user').docs.find((doc) => doc.domainId === requestedDomain && doc.uid === uid);
        return {
            _id: uid,
            uname: user.uname,
            loginat: user.loginat,
            priv: user.priv,
            role: typeof membership?.role === 'string' ? membership.role : 'default',
        };
    },
};

function loadTeacherAdmin(): { applyTeacherAdminHandlers: (ctx: { Route: (...args: unknown[]) => void }) => void } {
    const Module = require('module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
    const originalLoad = Module._load;
    const utils = require('@hydrooj/utils') as Record<string, unknown>;
    const utilsProxy = new Proxy(utils, {
        get(target, prop, receiver) {
            if (prop === 'Logger') return RecordingLogger;
            return Reflect.get(target, prop, receiver);
        },
    });
    const hydrooj = {
        db: { collection: (name: string) => collection(name) },
        ObjectId,
        UserModel,
        DomainModel,
        OplogModel: {
            async log(_handler: unknown, type: string, data: Record<string, unknown>) {
                oplogs.push({ type, data: { ...data } });
            },
        },
        document: {
            TYPE_CONTEST: docContest,
            TYPE_TRAINING: docTraining,
            TYPE_PROBLEM: docProblem,
            coll: collection('document'),
        },
        PERM,
        PRIV,
        TEACHER_CAPABILITIES,
        TEACHER_CAPABILITY_MASK,
        ValidationError,
        NotFoundError,
        ForbiddenError,
        localizedErrorText,
        localizeError,
        localizeErrorParameter,
        SystemError,
        BadRequestError,
        CreateError,
        PermissionError,
        Context: class Context {},
        Handler: RecordingHandler,
        param,
        Types,
    };
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') return hydrooj;
        if (request === '@hydrooj/utils') return utilsProxy;
        // node_modules/@hydrooj/common points at the main checkout, which still grants task creation.
        if (request === '@hydrooj/common' || request.startsWith('@hydrooj/common/')) return worktreeCommon;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${sep}krypton-userbind${sep}src${sep}`)) delete require.cache[key];
        }
        return require('../src/teacher-admin');
    } finally {
        Module._load = originalLoad;
    }
}

function applyRoutes() {
    routes.length = 0;
    const loaded = loadTeacherAdmin();
    if (typeof loaded.applyTeacherAdminHandlers !== 'function') {
        throw new TypeError('applyTeacherAdminHandlers is not exported');
    }
    loaded.applyTeacherAdminHandlers({
        Route(name: unknown, routePath: unknown, Handler: unknown, priv: unknown) {
            routes.push({
                name: String(name),
                path: String(routePath),
                Handler: Handler as new () => TeachersHandler,
                priv: Number(priv),
            });
        },
    });
}

function schoolDoc(id: ObjectId): Document {
    const doc = collection('userbind.schools').docs.find((item) => hexOf(item._id) === id.toHexString());
    if (!doc) throw new Error(`missing school ${id.toHexString()}`);
    return doc;
}

function staffOf(id: ObjectId): number[] {
    const staff = schoolDoc(id).staffUids;
    return Array.isArray(staff) ? [...(staff as number[])] : [];
}

function roleOf(uid: number): string | undefined {
    const doc = collection('domain.user').docs.find((item) => item.domainId === domainId && item.uid === uid);
    return typeof doc?.role === 'string' ? doc.role : undefined;
}

function joinOf(uid: number): unknown {
    return collection('domain.user').docs.find((item) => item.domainId === domainId && item.uid === uid)?.join;
}

function storedTeacherPermission(): string | undefined {
    const domain = collection('domain').docs.find((item) => item._id === domainId);
    const roles = domain?.roles;
    if (!roles || typeof roles !== 'object' || !Object.hasOwn(roles, 'teacher')) return undefined;
    return String((roles as Record<string, string>).teacher);
}

function mentions(value: unknown, token: string): boolean {
    if (Array.isArray(value)) return value.map((item) => hexOf(item) ?? String(item)).includes(token);
    const hex = hexOf(value);
    if (hex) return hex === token;
    return String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .includes(token);
}

async function rejectionOf(run: () => Promise<unknown>): Promise<Error & { params?: unknown[] }> {
    try {
        await run();
    } catch (error) {
        return error as Error & { params?: unknown[] };
    }
    throw new Error('expected rejection');
}

function errorText(error: { message?: string; params?: unknown[] }): string {
    const params = Array.isArray(error.params) ? error.params.map((value) => String(value)) : [];
    return [error.message || '', ...params].join('\n');
}

function operationMethod(operation: string): string {
    const suffix = operation
        .split('_')
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
        .join('');
    return `post${suffix}`;
}

function methodOf(handler: TeachersHandler, name: string): ((args: Record<string, string>) => Promise<unknown>) | undefined {
    const value = (handler as unknown as Record<string, unknown>)[name];
    if (typeof value !== 'function') return undefined;
    return value as (args: Record<string, string>) => Promise<unknown>;
}

async function submit(handler: TeachersHandler, fields: Record<string, string>): Promise<unknown> {
    const specificName = operationMethod(fields.operation);
    const specific = methodOf(handler, specificName);
    const generic = methodOf(handler, 'post');
    const all = methodOf(handler, 'all');
    const target = specific || generic || all;
    if (!target) throw Object.assign(new Error(`missing handler for ${fields.operation}`), { name: 'MissingHandlerError' });
    handler.request.body = { ...fields };
    handler.args = { domainId, ...fields };
    return target.call(handler, { domainId, ...fields });
}

function makeAdmin(): TeachersHandler {
    if (!routes[0]) throw new Error('admin_teachers route was not registered');
    const handler = new routes[0].Handler();
    handler.user = {
        _id: adminUid,
        priv: PRIV.PRIV_EDIT_SYSTEM | PRIV.PRIV_USER_PROFILE,
        hasPriv(priv: number) {
            return (this.priv & priv) === priv;
        },
        async checkPassword(password: string) {
            passwordChecks.push(password);
            if (password !== goodPassword) {
                const error = new Error('password rejected');
                error.name = 'LoginError';
                throw error;
            }
        },
    };
    handler.domain = { _id: domainId };
    handler.args = { domainId };
    handler.request = { body: {}, query: {}, params: {}, headers: {} };
    handler.response = {};
    handler.session = {};
    handler.limitRate = async (...args: unknown[]) => {
        rateLimits.push(args);
    };
    return handler;
}

async function openPage(): Promise<TeachersHandler> {
    ensureLoaded();
    const handler = makeAdmin();
    if (typeof handler.prepare === 'function') await handler.prepare();
    return handler;
}

async function readPage(): Promise<{ handler: TeachersHandler; body: TeachersPayload }> {
    const handler = await openPage();
    const returned = await handler.get?.({ domainId });
    const body = (handler.response.body ?? returned) as TeachersPayload;
    return { handler, body };
}

function assertOk(handler: TeachersHandler, result: unknown) {
    expect(handler.response.body ?? result).to.deep.equal({ ok: true });
}

function assertNoWrite(beforeRoles: string | undefined, beforeStaff: number[][]) {
    expect(storedTeacherPermission()).to.equal(beforeRoles);
    expect(staffOf(fx.alpha)).to.deep.equal(beforeStaff[0]);
    expect(staffOf(fx.beta)).to.deep.equal(beforeStaff[1]);
    expect(staffOf(fx.foreign)).to.deep.equal(beforeStaff[2]);
    expect(oplogs).to.deep.equal([]);
}

async function seed() {
    fx = { alpha: new ObjectId(), beta: new ObjectId(), foreign: new ObjectId() };
    await collection('domain').insertOne({ _id: domainId, lower: domainId, roles: {} });
    await collection('user').insertOne({
        _id: adminUid,
        uname: 'root-admin',
        priv: PRIV.PRIV_EDIT_SYSTEM | PRIV.PRIV_USER_PROFILE,
        loginat: new Date('2026-09-01T00:00:00.000Z'),
    });
    await collection('user').insertOne({ _id: adaUid, uname: 'ada', priv: 0, loginat: new Date(adaLoginAt) });
    await collection('user').insertOne({ _id: beaUid, uname: 'bea', priv: 0 });
    await collection('user').insertOne({ _id: carlUid, uname: 'carl', priv: 0, loginat: new Date('2026-08-01T00:00:00.000Z') });
    await collection('domain.user').insertOne({ domainId, uid: beaUid, role: 'teacher', join: true });
    await collection('domain.user').insertOne({ domainId, uid: adaUid, role: 'teacher', join: true });
    await collection('domain.user').insertOne({ domainId, uid: carlUid, role: 'default', join: true });
    await collection('userbind.schools').insertOne({
        _id: fx.beta,
        domainId,
        name: 'Beta',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        staffUids: [],
    });
    await collection('userbind.schools').insertOne({
        _id: fx.alpha,
        domainId,
        name: 'Alpha',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        staffUids: [beaUid],
    });
    await collection('userbind.schools').insertOne({
        _id: fx.foreign,
        domainId: otherDomainId,
        name: 'Aaa',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        staffUids: [],
    });
    const document = collection('document');
    await document.insertOne({ domainId, docType: docTraining, kind: 'course', owner: beaUid });
    await document.insertOne({ domainId, docType: docContest, owner: beaUid, title: 'contest-1' });
    await document.insertOne({ domainId, docType: docContest, owner: beaUid, title: 'contest-2' });
    await document.insertOne({ domainId, docType: docTraining, kind: 'problem_set', owner: beaUid });
    await document.insertOne({ domainId, docType: docTraining, kind: 'other', owner: beaUid });
    await document.insertOne({ domainId, docType: docProblem, owner: beaUid });
    await document.insertOne({ domainId, docType: docTraining, kind: 'course', owner: adaUid });
    await document.insertOne({ domainId: otherDomainId, docType: docTraining, kind: 'course', owner: beaUid });
    await document.insertOne({ domainId: otherDomainId, docType: docContest, owner: beaUid });
    await document.insertOne({ domainId: otherDomainId, docType: docTraining, kind: 'problem_set', owner: beaUid });
    const groups = collection('userbind.user_groups');
    await groups.insertOne({ _id: new ObjectId(), domainId, schoolId: fx.alpha, ownerUid: beaUid, name: 'live' });
    await groups.insertOne({
        _id: new ObjectId(),
        domainId,
        schoolId: fx.alpha,
        ownerUid: beaUid,
        name: 'archived',
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await groups.insertOne({ _id: new ObjectId(), domainId, schoolId: fx.alpha, ownerUid: adaUid, name: 'ada-group' });
    await groups.insertOne({ _id: new ObjectId(), domainId: otherDomainId, schoolId: fx.foreign, ownerUid: beaUid, name: 'foreign-group' });
}

describe('teacher administration wiring', () => {
    it('calls applyTeacherAdminHandlers from the plugin entry', () => {
        const indexSource = readFileSync(join(__dirname, '../index.ts'), 'utf8');
        expect(indexSource).to.include("import { applyTeacherAdminHandlers } from './src/teacher-admin';");
        expect(indexSource).to.include('applyTeacherAdminHandlers(ctx);');
    });
});

function ensureLoaded() {
    if (loadError) throw loadError;
}

describe('teacher administration api', { concurrency: false }, () => {
    before(() => {
        try {
            applyRoutes();
        } catch (error) {
            loadError = error;
        }
    });

    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        oplogs.length = 0;
        rateLimits.length = 0;
        passwordChecks.length = 0;
        UserModel.coll = collection('user');
        await seed();
    });

    it('registers GET and POST for system administrators only', () => {
        ensureLoaded();
        expect(routes.length > 0).to.equal(true);
        for (const route of routes) {
            expect(route.name).to.equal('admin_teachers');
            expect(route.path).to.equal('/admin/teachers');
            expect(route.priv).to.equal(PRIV.PRIV_EDIT_SYSTEM);
        }
    });

    it('lists teachers by uname with school ids, login time, and owned counts', async () => {
        const { handler, body } = await readPage();
        expect(handler.response.template).to.equal('admin_teachers.html');
        expect(body.teachers.map((row) => row.uname)).to.deep.equal(['ada', 'bea']);
        expect(body.teachers.map((row) => row.uid)).to.deep.equal([adaUid, beaUid]);
        expect(body.teachers[0].schoolIds).to.deep.equal([]);
        expect(body.teachers[0].loginAt).to.equal(adaLoginAt);
        expect(body.teachers[0].owned).to.deep.equal({ courses: 1, sets: 0, groups: 1 });
        expect(body.teachers[1].schoolIds).to.deep.equal([fx.alpha.toHexString()]);
        expect(body.teachers[1].loginAt).to.equal(null);
        expect(body.teachers[1].owned).to.deep.equal({ courses: 1, sets: 3, groups: 1 });
        expect(body.schools).to.deep.equal([
            { id: fx.alpha.toHexString(), name: 'Alpha' },
            { id: fx.beta.toHexString(), name: 'Beta' },
        ]);
        expect(oplogs).to.deep.equal([]);
    });

    it('reports builtin teacher capabilities when the role permission is not stored', async () => {
        const { body } = await readPage();
        expect(body.capabilities.customized).to.equal(false);
        expect(body.capabilities.stored).to.equal(null);
        expect(body.capabilities.effective).to.equal(PERM.PERM_TEACHER.toString());
        const items = body.capabilities.items.map((item) => ({
            key: item.key,
            enabled: item.enabled,
            defaultEnabled: item.defaultEnabled,
        }));
        expect(items).to.deep.equal(
            TEACHER_CAPABILITIES.map((item) => ({
                key: item.key,
                enabled: (PERM.PERM_TEACHER & item.perm) !== 0n,
                defaultEnabled: (PERM.PERM_TEACHER & item.perm) !== 0n,
            })),
        );
        const task = items.find((item) => item.key === 'createTask');
        const practice = items.find((item) => item.key === 'createPractice');
        expect(task?.enabled).to.equal(false);
        expect(task?.defaultEnabled).to.equal(false);
        expect(practice?.enabled).to.equal(false);
        expect(practice?.defaultEnabled).to.equal(false);
    });

    it('sets a default account as teacher in the selected school and writes an oplog', async () => {
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'set_teacher',
            password: goodPassword,
            uid: String(carlUid),
            schoolIds: fx.alpha.toHexString(),
        });
        assertOk(handler, result);
        expect(roleOf(carlUid)).to.equal('teacher');
        expect(joinOf(carlUid)).to.equal(true);
        expect(staffOf(fx.alpha)).to.deep.equal([beaUid, carlUid]);
        expect(oplogs).to.have.length(1);
        expect(oplogs[0].type).to.equal('userbind.admin.set_teacher');
        expect(oplogs[0].data.domainId).to.equal(domainId);
        expect(oplogs[0].data.targetUid === carlUid || oplogs[0].data.targetUid === String(carlUid)).to.equal(true);
        expect(mentions(oplogs[0].data.schoolIds, fx.alpha.toHexString())).to.equal(true);
        expect(JSON.stringify(oplogs)).to.not.include(goodPassword);
        expect(passwordChecks).to.deep.equal([goodPassword]);
        expect(rateLimits).to.deep.include(['admin_teachers_password', 60, 5, '{{ip}}@{{user}}']);
    });

    it('joins an account that is not yet in the domain when setting a teacher', async () => {
        await collection('user').insertOne({ _id: doraUid, uname: 'dora', priv: 0 });
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'set_teacher',
            password: goodPassword,
            uid: String(doraUid),
            schoolIds: fx.beta.toHexString(),
        });
        assertOk(handler, result);
        expect(roleOf(doraUid)).to.equal('teacher');
        expect(joinOf(doraUid)).to.equal(true);
        expect(staffOf(fx.beta)).to.deep.equal([doraUid]);
    });

    it('refuses to turn a domain root into a teacher', async () => {
        await collection('user').insertOne({ _id: rootUid, uname: 'domain-root', priv: 0 });
        await collection('domain.user').insertOne({ domainId, uid: rootUid, role: 'root', join: true });
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(rootUid),
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(errorText(error)).to.include('这个账号是域管理员，不能改成老师。');
        expect(roleOf(rootUid)).to.equal('root');
        assertNoWrite(undefined, beforeStaff);
    });

    it('refuses to set an account that is already a teacher', async () => {
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(adaUid),
                schoolIds: fx.beta.toHexString(),
            }),
        );
        expect(errorText(error)).to.include('这个账号已经是老师。');
        expect(roleOf(adaUid)).to.equal('teacher');
        assertNoWrite(undefined, beforeStaff);
    });

    it('rejects a wrong admin password before writing a teacher', async () => {
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'set_teacher',
                password: 'wrong-password',
                uid: '0',
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(error.name).to.not.equal('ValidationError');
        expect(roleOf(carlUid)).to.equal('default');
        assertNoWrite(undefined, beforeStaff);
        expect(rateLimits).to.deep.include(['admin_teachers_password', 60, 5, '{{ip}}@{{user}}']);
    });

    it('rejects the write when the stored privilege is no longer a system administrator', async () => {
        const admin = collection('user').docs.find((doc) => doc._id === adminUid);
        if (!admin) throw new Error('missing admin');
        admin.priv = 0;
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        await rejectionOf(() =>
            submit(handler, {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(carlUid),
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(roleOf(carlUid)).to.equal('default');
        assertNoWrite(undefined, beforeStaff);
    });

    it('moves teacher schools and refuses the same change for a non-teacher', async () => {
        const handler = await openPage();
        const moved = await submit(handler, {
            operation: 'set_schools',
            password: goodPassword,
            uid: String(beaUid),
            schoolIds: fx.beta.toHexString(),
        });
        assertOk(handler, moved);
        expect(staffOf(fx.alpha)).to.deep.equal([]);
        expect(staffOf(fx.beta)).to.deep.equal([beaUid]);
        expect(oplogs[0].type).to.equal('userbind.admin.set_schools');
        expect(oplogs[0].data.domainId).to.equal(domainId);

        oplogs.length = 0;
        const beforeAlpha = staffOf(fx.alpha);
        const beforeBeta = staffOf(fx.beta);
        const denied = await openPage();
        await rejectionOf(() =>
            submit(denied, {
                operation: 'set_schools',
                password: goodPassword,
                uid: String(carlUid),
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(roleOf(carlUid)).to.equal('default');
        expect(staffOf(fx.alpha)).to.deep.equal(beforeAlpha);
        expect(staffOf(fx.beta)).to.deep.equal(beforeBeta);
        expect(oplogs).to.deep.equal([]);
    });

    it('clears every school in this domain when removeStaff is 1', async () => {
        schoolDoc(fx.beta).staffUids = [beaUid];
        schoolDoc(fx.foreign).staffUids = [beaUid];
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'unset_teacher',
            password: goodPassword,
            uid: String(beaUid),
            removeStaff: '1',
        });
        assertOk(handler, result);
        expect(roleOf(beaUid)).to.equal('default');
        expect(staffOf(fx.alpha)).to.deep.equal([]);
        expect(staffOf(fx.beta)).to.deep.equal([]);
        expect(staffOf(fx.foreign)).to.deep.equal([beaUid]);
        expect(oplogs[0].type).to.equal('userbind.admin.unset_teacher');
        expect(oplogs[0].data.domainId).to.equal(domainId);
    });

    it('keeps school staff when removeStaff is 0', async () => {
        schoolDoc(fx.alpha).staffUids = [beaUid, adaUid];
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'unset_teacher',
            password: goodPassword,
            uid: String(adaUid),
            removeStaff: '0',
        });
        assertOk(handler, result);
        expect(roleOf(adaUid)).to.equal('default');
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(staffOf(fx.alpha)).to.deep.equal([beaUid, adaUid]);
    });

    it('stores the selected capability bits and keeps bits outside the mask', async () => {
        const expected = PERM.PERM_TEACHER.toString();
        const next = (PERM.PERM_TEACHER & ~TEACHER_CAPABILITY_MASK) | PERM.PERM_CREATE_PROBLEM | PERM.PERM_CREATE_CONTEST;
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'save_capabilities',
            password: goodPassword,
            enabled: 'createProblem,createContest',
            expected,
        });
        assertOk(handler, result);
        expect(storedTeacherPermission()).to.equal(next.toString());
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(oplogs[0].type).to.equal('userbind.admin.save_capabilities');
        expect(oplogs[0].data.domainId).to.equal(domainId);
        expect(mentions(oplogs[0].data.enabled, 'createProblem')).to.equal(true);
        expect(mentions(oplogs[0].data.enabled, 'createContest')).to.equal(true);
    });

    it('rejects a stale capability expected value and leaves the stored role alone', async () => {
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'save_capabilities',
                password: goodPassword,
                enabled: 'createProblem,createContest',
                expected: '1',
            }),
        );
        expect(errorText(error)).to.include('老师权限已被别人改过，请刷新后再改。');
        expect(storedTeacherPermission()).to.equal(undefined);
        expect(roleOf(adaUid)).to.equal('teacher');
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(oplogs).to.deep.equal([]);
    });

    it('deletes the stored teacher permission without changing account roles', async () => {
        const domain = collection('domain').docs.find((item) => item._id === domainId);
        if (!domain) throw new Error('missing domain');
        domain.roles = { teacher: '4242' };
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'reset_capabilities',
            password: goodPassword,
            expected: '4242',
        });
        assertOk(handler, result);
        expect(storedTeacherPermission()).to.equal(undefined);
        expect(roleOf(adaUid)).to.equal('teacher');
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(oplogs[0].type).to.equal('userbind.admin.reset_capabilities');
    });

    it('accepts reset when the domain has no stored teacher permission', async () => {
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'reset_capabilities',
            password: goodPassword,
            expected: '',
        });
        assertOk(handler, result);
        expect(storedTeacherPermission()).to.equal(undefined);
        expect(roleOf(beaUid)).to.equal('teacher');
    });

    it('rejects an unknown operation, a foreign school, an unknown capability, a bad uid, and a missing user', async () => {
        const beforeStaff = () => [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const staffBefore = beforeStaff();
        const handler = await openPage();
        const unknown = await rejectionOf(() =>
            submit(handler, {
                operation: 'promote',
                password: goodPassword,
                uid: String(carlUid),
            }),
        );
        expect(unknown.name).to.equal('ValidationError');
        assertNoWrite(undefined, staffBefore);

        const foreign = await rejectionOf(async () =>
            submit(await openPage(), {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(carlUid),
                schoolIds: fx.foreign.toHexString(),
            }),
        );
        expect(foreign.name).to.equal('ValidationError');
        expect(roleOf(carlUid)).to.equal('default');
        assertNoWrite(undefined, staffBefore);

        const badKey = await rejectionOf(async () =>
            submit(await openPage(), {
                operation: 'save_capabilities',
                password: goodPassword,
                enabled: 'createProblem,notACapability',
                expected: PERM.PERM_TEACHER.toString(),
            }),
        );
        expect(badKey.name).to.equal('ValidationError');
        expect(storedTeacherPermission()).to.equal(undefined);

        const alphaId = fx.alpha.toHexString();
        const zeroUid = await rejectionOf(async () =>
            submit(await openPage(), {
                operation: 'set_teacher',
                password: goodPassword,
                uid: '0',
                schoolIds: alphaId,
            }),
        );
        expect(zeroUid.name).to.equal('ValidationError');
        const textUid = await rejectionOf(async () =>
            submit(await openPage(), {
                operation: 'set_teacher',
                password: goodPassword,
                uid: 'abc',
                schoolIds: alphaId,
            }),
        );
        expect(textUid.name).to.equal('ValidationError');
        expect(roleOf(carlUid)).to.equal('default');
        assertNoWrite(undefined, staffBefore);

        const missing = await rejectionOf(async () =>
            submit(await openPage(), {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(missingUid),
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(missing.name).to.equal('NotFoundError');
        expect(collection('domain.user').docs.some((doc) => doc.uid === missingUid)).to.equal(false);
        assertNoWrite(undefined, staffBefore);
    });

    it('reads a stored teacher permission instead of the builtin default', async () => {
        const domain = collection('domain').docs.find((item) => item._id === domainId);
        if (!domain) throw new Error('missing domain');
        const stored = PERM.PERM_CREATE_TASK.toString();
        domain.roles = { teacher: stored };
        const { body } = await readPage();
        expect(body.capabilities.customized).to.equal(true);
        expect(body.capabilities.stored).to.equal(stored);
        expect(body.capabilities.effective).to.equal(stored);
        const byKey = new Map(body.capabilities.items.map((item) => [item.key, item]));
        expect(byKey.get('createTask')?.enabled).to.equal(true);
        expect(byKey.get('createTask')?.defaultEnabled).to.equal((PERM.PERM_TEACHER & PERM.PERM_CREATE_TASK) !== 0n);
        expect(byKey.get('createProblem')?.enabled).to.equal(false);
        expect(byKey.get('createProblem')?.defaultEnabled).to.equal((PERM.PERM_TEACHER & PERM.PERM_CREATE_PROBLEM) !== 0n);
    });

    it('rejects a stale reset expected value and keeps the stored permission', async () => {
        const domain = collection('domain').docs.find((item) => item._id === domainId);
        if (!domain) throw new Error('missing domain');
        domain.roles = { teacher: '4242' };
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'reset_capabilities',
                password: goodPassword,
                expected: '1',
            }),
        );
        expect(errorText(error)).to.include('老师权限已被别人改过，请刷新后再改。');
        expect(storedTeacherPermission()).to.equal('4242');
        expect(roleOf(adaUid)).to.equal('teacher');
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(oplogs).to.deep.equal([]);
    });

    it('rejects an unset that does not say whether to remove school staff', async () => {
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'unset_teacher',
                password: goodPassword,
                uid: String(beaUid),
                removeStaff: '2',
            }),
        );
        expect(error.name).to.equal('ValidationError');
        expect(errorText(error)).to.include('是否移除教职工参数无效');
        expect(roleOf(beaUid)).to.equal('teacher');
        assertNoWrite(undefined, beforeStaff);
    });

    it('sets a teacher with no schools and does not add staff', async () => {
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'set_teacher',
            password: goodPassword,
            uid: String(carlUid),
            schoolIds: '',
        });
        assertOk(handler, result);
        expect(roleOf(carlUid)).to.equal('teacher');
        expect(staffOf(fx.alpha)).to.deep.equal([beaUid]);
        expect(staffOf(fx.beta)).to.deep.equal([]);
        expect(staffOf(fx.foreign)).to.deep.equal([]);
        expect(oplogs).to.have.length(1);
        expect(oplogs[0].type).to.equal('userbind.admin.set_teacher');
        expect(oplogs[0].data.domainId).to.equal(domainId);
        expect(oplogs[0].data.schoolIds).to.deep.equal([]);
    });

    it('clears every school in this domain when the new school list is empty', async () => {
        const handler = await openPage();
        const result = await submit(handler, {
            operation: 'set_schools',
            password: goodPassword,
            uid: String(beaUid),
            schoolIds: '',
        });
        assertOk(handler, result);
        expect(roleOf(beaUid)).to.equal('teacher');
        expect(staffOf(fx.alpha)).to.deep.equal([]);
        expect(staffOf(fx.beta)).to.deep.equal([]);
        expect(staffOf(fx.foreign)).to.deep.equal([]);
        expect(oplogs[0].type).to.equal('userbind.admin.set_schools');
        expect(oplogs[0].data.domainId).to.equal(domainId);
        expect(oplogs[0].data.schoolIds).to.deep.equal([]);
    });

    it('rejects the write when the stored privilege is missing the profile bit', async () => {
        const admin = collection('user').docs.find((doc) => doc._id === adminUid);
        if (!admin) throw new Error('missing admin');
        admin.priv = PRIV.PRIV_EDIT_SYSTEM;
        const beforeStaff = [staffOf(fx.alpha), staffOf(fx.beta), staffOf(fx.foreign)];
        const handler = await openPage();
        const error = await rejectionOf(() =>
            submit(handler, {
                operation: 'set_teacher',
                password: goodPassword,
                uid: String(carlUid),
                schoolIds: fx.alpha.toHexString(),
            }),
        );
        expect(error.name).to.equal('ForbiddenError');
        expect(errorText(error)).to.include('当前账号已不再拥有系统管理权限');
        expect(roleOf(carlUid)).to.equal('default');
        assertNoWrite(undefined, beforeStaff);
    });
});
