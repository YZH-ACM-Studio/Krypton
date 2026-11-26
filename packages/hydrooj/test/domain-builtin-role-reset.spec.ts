import { expect } from 'chai';
import { before, beforeEach, describe, it } from 'node:test';

/**
 * DomainModel captures its collections at import, and the real db proxy is not
 * connected in this test process. Install an in-memory db before loading it.
 */
const moduleBag: Record<string, Record<string, unknown>> = {};
const hydro = {
    model: {},
    script: {},
    locales: {},
    ui: {},
    error: {},
    module: new Proxy(moduleBag, {
        get(self, key) {
            if (typeof key !== 'string') return undefined;
            self[key] ||= {};
            return self[key];
        },
    }),
};
(global as unknown as { Hydro: typeof hydro }).Hydro = hydro;

interface Update {
    $set?: Record<string, unknown>;
    $unset?: Record<string, unknown>;
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function readPath(doc: Record<string, unknown>, field: string): unknown {
    if (!field.includes('.')) return doc[field];
    let current: unknown = doc;
    for (const part of field.split('.')) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function writePath(doc: Record<string, unknown>, field: string, value: unknown): void {
    const parts = field.split('.');
    let current = doc;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const next = current[parts[index]];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
            const created: Record<string, unknown> = {};
            current[parts[index]] = created;
            current = created;
            continue;
        }
        current = next as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}

function unsetPath(doc: Record<string, unknown>, field: string): void {
    const parts = field.split('.');
    let current = doc;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const next = current[parts[index]];
        if (!next || typeof next !== 'object' || Array.isArray(next)) return;
        current = next as Record<string, unknown>;
    }
    delete current[parts[parts.length - 1]];
}

function sameValue(actual: unknown, expected: unknown): boolean {
    if (!isOperator(expected)) return actual === expected;
    if ('$exists' in expected && (actual !== undefined) !== Boolean(expected.$exists)) return false;
    if ('$eq' in expected && actual !== expected.$eq) return false;
    if ('$in' in expected) {
        if (!Array.isArray(expected.$in) || !expected.$in.includes(actual)) return false;
    }
    return true;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([field, expected]) => {
        if (field === '$and' && Array.isArray(expected)) {
            return expected.every((item) => matches(doc, item as Record<string, unknown>));
        }
        if (field === '$or' && Array.isArray(expected)) {
            return expected.some((item) => matches(doc, item as Record<string, unknown>));
        }
        return sameValue(readPath(doc, field), expected);
    });
}

function applyUpdate(doc: Record<string, unknown>, update: Update): void {
    const operators = Object.keys(update);
    if (operators.some((key) => key !== '$set' && key !== '$unset')) {
        throw new Error(`unsupported update operators: ${operators.join(',')}`);
    }
    for (const [field, value] of Object.entries(update.$set || {})) writePath(doc, field, value);
    for (const field of Object.keys(update.$unset || {})) unsetPath(doc, field);
}

class MemoryCollection {
    docs: Record<string, unknown>[] = [];

    /** Next matching $unset reports matchedCount 0 and does not change the document. */
    failNextUnset = false;

    /** Runs on the _id-matched document before the update filter is applied. */
    touchBeforeNextUpdate: ((doc: Record<string, unknown>) => void) | null = null;

    async insertOne(doc: Record<string, unknown>) {
        this.docs.push(structuredClone(doc));
        return { acknowledged: true, insertedId: doc._id };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => matches(doc, filter));
        return found ? structuredClone(found) : null;
    }

    find(filter: Record<string, unknown>) {
        const rows = () => this.docs.filter((doc) => matches(doc, filter)).map((doc) => structuredClone(doc));
        return { toArray: async () => rows() };
    }

    async updateOne(filter: Record<string, unknown>, update: Update) {
        if (this.touchBeforeNextUpdate) {
            const touch = this.touchBeforeNextUpdate;
            this.touchBeforeNextUpdate = null;
            const target = this.docs.find((doc) => doc._id === filter._id);
            if (target) touch(target);
        }
        const index = this.docs.findIndex((doc) => matches(doc, filter));
        if (index < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        if (update.$unset && Object.keys(update.$unset).length > 0 && this.failNextUnset) {
            this.failNextUnset = false;
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        applyUpdate(this.docs[index], update);
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    async updateMany(filter: Record<string, unknown>, update: Update) {
        const matched = this.docs.filter((doc) => matches(doc, filter));
        if (update.$unset && Object.keys(update.$unset).length > 0 && this.failNextUnset) {
            this.failNextUnset = false;
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        for (const doc of matched) applyUpdate(doc, update);
        return { acknowledged: true, matchedCount: matched.length, modifiedCount: matched.length };
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Update) {
        const updated = await this.updateOne(filter, update);
        if (!updated.matchedCount) return null;
        return this.findOne(filter);
    }
}

const collections = new Map<string, MemoryCollection>();

function collection(name: string): MemoryCollection {
    let found = collections.get(name);
    if (!found) {
        found = new MemoryCollection();
        collections.set(name, found);
    }
    return found;
}

const { Context } = require('../src/context.ts') as typeof import('../src/context');
const app = new Context();
type BusEvent = keyof import('../src/service/bus').EventMap;
const broadcasts: Array<{ event: string; args: unknown[] }> = [];
app.broadcast = (event: BusEvent, ...args: unknown[]) => {
    broadcasts.push({ event, args });
    return app.emit('bus/broadcast', event, args);
};
// Same relay as service/bus.ts: payload is the broadcast argument list.
app.on('bus/broadcast', (event, payload) => app.parallel(event, ...payload));
(global as unknown as { app: typeof app }).app = app;

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection,
            async ensureIndexes() {
                return undefined;
            },
        },
    },
} as NodeModule;
const domainModule = require('../src/model/domain.ts') as typeof import('../src/model/domain');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const DomainModel = domainModule.default;
const domains = collection('domain');
const members = collection('domain.user');

type ResetState = { state: 'reset' } | { state: 'missing' } | { state: 'conflict' } | { state: 'not_builtin' };
type ResetBuiltinRolePermission = (domainId: string, role: string, expected: string) => Promise<ResetState>;

async function resetBuiltinRolePermission(domainId: string, role: string, expected: string): Promise<ResetState> {
    const fn: unknown = Reflect.get(DomainModel, 'resetBuiltinRolePermission');
    if (typeof fn !== 'function') throw new TypeError('DomainModel.resetBuiltinRolePermission is not a function');
    return (fn as ResetBuiltinRolePermission).call(DomainModel, domainId, role, expected);
}

async function seed(domainId: string, roles: Record<string, string>, memberSeeds: Array<{ uid: number; role: string }> = []) {
    await domains.insertOne({
        _id: domainId,
        lower: domainId,
        owner: 1,
        name: domainId,
        bulletin: '',
        avatar: '',
        roles,
    });
    for (const member of memberSeeds) {
        await members.insertOne({
            domainId,
            uid: member.uid,
            role: member.role,
            join: true,
        });
    }
}

async function readRoles(domainId: string): Promise<Record<string, unknown>> {
    const doc = await domains.findOne({ _id: domainId });
    expect(doc, domainId).to.not.equal(null);
    const roles = (doc as Record<string, unknown>).roles;
    expect(roles, `${domainId} roles`).to.be.an('object');
    expect(roles, `${domainId} roles`).to.not.equal(null);
    return roles as Record<string, unknown>;
}

async function readMemberRole(domainId: string, uid: number): Promise<string> {
    const doc = await members.findOne({ domainId, uid });
    expect(doc, `${domainId}:${uid}`).to.not.equal(null);
    const role = (doc as Record<string, unknown>).role;
    expect(role, `${domainId}:${uid}`).to.be.a('string');
    return role as string;
}

function saw(events: Array<{ event: string; args: unknown[] }>, event: string, arg: unknown): boolean {
    return events.some((entry) => entry.event === event && entry.args[0] === arg);
}

describe('builtin role permission reset', () => {
    before(async () => {
        await domainModule.apply(app);
    });

    beforeEach(() => {
        domains.failNextUnset = false;
        domains.touchBeforeNextUpdate = null;
        members.failNextUnset = false;
        members.touchBeforeNextUpdate = null;
    });

    it('deletes the stored teacher permission and leaves account roles unchanged', async () => {
        const stored = '406';
        await seed('n11-reset', { teacher: stored, default: '1' }, [
            { uid: 7, role: 'teacher' },
            { uid: 8, role: 'default' },
        ]);
        await seed('n11-other', { teacher: stored, default: '1' }, [{ uid: 9, role: 'teacher' }]);
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-reset', 'teacher', stored);

        expect(result.state).to.equal('reset');
        const roles = await readRoles('n11-reset');
        expect(Object.hasOwn(roles, 'teacher')).to.equal(false);
        expect(roles.default).to.equal('1');
        expect(await readMemberRole('n11-reset', 7)).to.equal('teacher');
        expect(await readMemberRole('n11-reset', 8)).to.equal('default');
        expect((await readRoles('n11-other')).teacher).to.equal(stored);
        expect(await readMemberRole('n11-other', 9)).to.equal('teacher');
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-reset')).to.equal(true);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-reset'))).to.equal(true);
    });

    it('keeps the stored permission when the expected value does not match', async () => {
        const stored = '406';
        await seed('n11-conflict', { teacher: stored, default: '1' }, [{ uid: 7, role: 'teacher' }]);
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-conflict', 'teacher', '407');

        expect(result.state).to.equal('conflict');
        expect((await readRoles('n11-conflict')).teacher).to.equal(stored);
        expect(await readMemberRole('n11-conflict', 7)).to.equal('teacher');
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-conflict')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-conflict'))).to.equal(false);
    });

    it('reports missing when the domain has not stored the role', async () => {
        await seed('n11-missing', { default: '1' }, [{ uid: 7, role: 'teacher' }]);
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-missing', 'teacher', '406');

        expect(result.state).to.equal('missing');
        expect(Object.hasOwn(await readRoles('n11-missing'), 'teacher')).to.equal(false);
        expect(await readMemberRole('n11-missing', 7)).to.equal('teacher');
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-missing')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-missing'))).to.equal(false);
    });

    it('rejects root and roles outside the builtin set', async () => {
        await seed('n11-builtin', { create_problems: '9', default: '1' });
        const mark = broadcasts.length;

        const root = await resetBuiltinRolePermission('n11-builtin', 'root', '9');
        const custom = await resetBuiltinRolePermission('n11-builtin', 'create_problems', '9');

        expect(root.state).to.equal('not_builtin');
        expect(custom.state).to.equal('not_builtin');
        const roles = await readRoles('n11-builtin');
        expect(roles.create_problems).to.equal('9');
        expect(Object.hasOwn(roles, 'root')).to.equal(false);
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-builtin')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-builtin'))).to.equal(false);
    });

    it('reports conflict when the conditional unset matches no document', async () => {
        const stored = '406';
        await seed('n11-race', { teacher: stored, default: '1' }, [{ uid: 7, role: 'teacher' }]);
        domains.failNextUnset = true;
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-race', 'teacher', stored);

        expect(result.state).to.equal('conflict');
        expect((await readRoles('n11-race')).teacher).to.equal(stored);
        expect(await readMemberRole('n11-race', 7)).to.equal('teacher');
        expect(domains.failNextUnset).to.equal(false);
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-race')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-race'))).to.equal(false);
    });

    it('resets a stored guest permission without changing account roles', async () => {
        const stored = '3';
        await seed('n11-guest', { guest: stored, default: '1' }, [{ uid: 4, role: 'guest' }]);
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-guest', 'guest', stored);

        expect(result.state).to.equal('reset');
        const roles = await readRoles('n11-guest');
        expect(Object.hasOwn(roles, 'guest')).to.equal(false);
        expect(roles.default).to.equal('1');
        expect(await readMemberRole('n11-guest', 4)).to.equal('guest');
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-guest')).to.equal(true);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-guest'))).to.equal(true);
    });

    it('keeps a permission that changed before the conditional unset', async () => {
        const stored = '406';
        await seed('n11-stale', { teacher: stored, default: '1' }, [{ uid: 7, role: 'teacher' }]);
        domains.touchBeforeNextUpdate = (doc) => {
            const roles = doc.roles;
            if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
                throw new TypeError('roles missing');
            }
            (roles as Record<string, unknown>).teacher = '999';
        };
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-stale', 'teacher', stored);

        expect(result.state).to.equal('conflict');
        expect((await readRoles('n11-stale')).teacher).to.equal('999');
        expect(await readMemberRole('n11-stale', 7)).to.equal('teacher');
        expect(domains.touchBeforeNextUpdate).to.equal(null);
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-stale')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-stale'))).to.equal(false);
    });

    it('compares the stored permission as an exact decimal string', async () => {
        await seed('n11-leading-zero', { teacher: '010', default: '1' }, [{ uid: 7, role: 'teacher' }]);
        const mark = broadcasts.length;

        const mismatch = await resetBuiltinRolePermission('n11-leading-zero', 'teacher', '10');

        expect(mismatch.state).to.equal('conflict');
        expect((await readRoles('n11-leading-zero')).teacher).to.equal('010');
        expect(await readMemberRole('n11-leading-zero', 7)).to.equal('teacher');
        const mismatchEvents = broadcasts.slice(mark);
        expect(saw(mismatchEvents, 'domain/delete-cache', 'n11-leading-zero')).to.equal(false);
        expect(saw(mismatchEvents, 'user/delcache', JSON.stringify('n11-leading-zero'))).to.equal(false);

        const match = await resetBuiltinRolePermission('n11-leading-zero', 'teacher', '010');

        expect(match.state).to.equal('reset');
        const roles = await readRoles('n11-leading-zero');
        expect(Object.hasOwn(roles, 'teacher')).to.equal(false);
        expect(roles.default).to.equal('1');
        expect(await readMemberRole('n11-leading-zero', 7)).to.equal('teacher');
    });

    it('rejects object prototype names that are not builtin roles', async () => {
        await seed('n11-proto', { default: '1' }, [{ uid: 7, role: 'default' }]);
        const mark = broadcasts.length;

        const result = await resetBuiltinRolePermission('n11-proto', 'toString', '1');

        expect(result.state).to.equal('not_builtin');
        expect((await readRoles('n11-proto')).default).to.equal('1');
        expect(await readMemberRole('n11-proto', 7)).to.equal('default');
        const events = broadcasts.slice(mark);
        expect(saw(events, 'domain/delete-cache', 'n11-proto')).to.equal(false);
        expect(saw(events, 'user/delcache', JSON.stringify('n11-proto'))).to.equal(false);
    });
});
