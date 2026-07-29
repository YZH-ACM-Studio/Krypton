import { expect } from 'chai';
import { localizedErrorText } from '@hydrooj/framework';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

(global as any).Hydro ||= { model: {}, module: {}, ui: {} };

class TestPermissionError extends Error {}
class TestValidationError extends Error {}

const dbPath = require.resolve('../src/service/db.ts');
const errorPath = require.resolve('../src/error.ts');
const builtinPath = require.resolve('../src/model/builtin.ts');
const oplogPath = require.resolve('../src/model/oplog.ts');
const documentPath = require.resolve('../src/model/document.ts');
const modulePath = require.resolve('../src/model/problem-pid-namespace.ts');

let namespaceDocs: any[] = [];
let counterDocs: any[] = [];
let problemDocs: any[] = [];
let auditDocs: any[] = [];
let namespaceIndexCalls: any[] = [];
let failNamespaceReadAfterMutation = false;
let failNextNamespaceRead = false;

function valueAt(doc: any, path: string): unknown {
    return path.split('.').reduce((value, key) => {
        if (Array.isArray(value)) return value.map((entry) => entry?.[key]);
        return value?.[key];
    }, doc);
}

function matches(doc: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([field, expected]) => {
        const actual = valueAt(doc, field);
        if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
        if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
            if ('$lt' in expected) return typeof actual === 'number' && actual < expected.$lt;
            if ('$ne' in expected) {
                if (Array.isArray(actual)) return !actual.includes(expected.$ne);
                return actual !== expected.$ne;
            }
        }
        if (expected instanceof ObjectId) return actual instanceof ObjectId && actual.equals(expected);
        if (Array.isArray(actual)) return actual.includes(expected);
        return actual === expected;
    });
}

function applyUpdate(doc: any, update: any): void {
    Object.assign(doc, update.$set || {});
    for (const [field, increment] of Object.entries(update.$inc || {})) {
        doc[field] = Number(doc[field] || 0) + Number(increment);
    }
}

function cursor(rows: any[]) {
    return {
        sort() {
            return this;
        },
        async toArray() {
            return rows;
        },
    };
}

const namespaceCollection = {
    find(filter: Record<string, any>) {
        return cursor(namespaceDocs.filter((doc) => matches(doc, filter)));
    },
    async findOne(filter: Record<string, any>) {
        if (failNextNamespaceRead) {
            failNextNamespaceRead = false;
            throw new Error('injected namespace materialization failure');
        }
        return namespaceDocs.find((doc) => matches(doc, filter)) || null;
    },
    async insertOne(doc: any) {
        if (
            namespaceDocs.some(
                (candidate) =>
                    candidate.domainId === doc.domainId &&
                    (candidate.namespaceId === doc.namespaceId || (doc.prefix && candidate.prefix === doc.prefix)),
            )
        ) {
            const error: any = new Error('duplicate namespace');
            error.code = 11000;
            throw error;
        }
        namespaceDocs.push(doc);
        return { insertedId: doc._id };
    },
    async findOneAndUpdate(filter: Record<string, any>, update: any) {
        const doc = namespaceDocs.find((candidate) => matches(candidate, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        if (failNamespaceReadAfterMutation) {
            failNamespaceReadAfterMutation = false;
            failNextNamespaceRead = true;
        }
        return doc;
    },
    async deleteOne(filter: Record<string, any>) {
        const index = namespaceDocs.findIndex((candidate) => matches(candidate, filter));
        if (index < 0) return { deletedCount: 0 };
        namespaceDocs.splice(index, 1);
        return { deletedCount: 1 };
    },
    async createIndex(key: any, options: any) {
        namespaceIndexCalls.push({ key: structuredClone(key), options: structuredClone(options) });
        return 'index';
    },
};

const counterCollection = {
    find(filter: Record<string, any>) {
        return cursor(counterDocs.filter((doc) => matches(doc, filter)));
    },
    async findOne(filter: Record<string, any>) {
        return counterDocs.find((doc) => matches(doc, filter)) || null;
    },
    async findOneAndUpdate(filter: Record<string, any>, update: any) {
        const doc = counterDocs.find((candidate) => matches(candidate, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        return doc;
    },
};

const problemCollection = {
    async findOne(filter: Record<string, any>) {
        return problemDocs.find((doc) => matches(doc, filter)) || null;
    },
};

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection(name: string) {
                if (name === 'problem.pid_namespaces') return namespaceCollection;
                if (name === 'problem.pid_counters') return counterCollection;
                throw new Error(`unexpected collection ${name}`);
            },
        },
    },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { localizedErrorText, PermissionError: TestPermissionError, ValidationError: TestValidationError },
} as NodeModule;
require.cache[builtinPath] = {
    id: builtinPath,
    filename: builtinPath,
    loaded: true,
    exports: {
        PERM: { PERM_CREATE_PROBLEM: 1n, PERM_CREATE_PROGRAMMING_DRAFT: 2n },
        PRIV: { PRIV_EDIT_SYSTEM: 4n },
    },
} as NodeModule;
require.cache[oplogPath] = {
    id: oplogPath,
    filename: oplogPath,
    loaded: true,
    exports: {
        async add(entry: any) {
            const _id = new ObjectId();
            auditDocs.push({ ...entry, _id });
            return _id;
        },
        coll: {
            async updateOne(filter: Record<string, any>, update: any) {
                const audit = auditDocs.find((doc) => matches(doc, filter));
                if (!audit) return { matchedCount: 0 };
                applyUpdate(audit, update);
                return { matchedCount: 1 };
            },
        },
    },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_PROBLEM: 10, coll: problemCollection },
} as NodeModule;
delete require.cache[modulePath];

const {
    BUILTIN_PID_NAMESPACE_IDS,
    createCustomPidNamespace,
    deleteCustomPidNamespace,
    ensurePidNamespaceIndexes,
    reservePidForNamespace,
    setPidNamespaceMember,
    updatePidNamespaceConfig,
} = require(modulePath) as typeof import('../src/model/problem-pid-namespace');

const admin = {
    _id: 2,
    hasPriv: () => true,
    hasPerm: () => false,
};

async function expectReject(promise: Promise<unknown>, ErrorType: new (...args: any[]) => Error): Promise<void> {
    let rejected: unknown;
    try {
        await promise;
    } catch (error) {
        rejected = error;
    }
    expect(rejected).to.be.instanceOf(ErrorType);
}

beforeEach(() => {
    namespaceDocs = [];
    counterDocs = [];
    problemDocs = [];
    auditDocs = [];
    namespaceIndexCalls = [];
    failNamespaceReadAfterMutation = false;
    failNextNamespaceRead = false;
});

describe('P2.38 PID namespace persistent mutation paths', () => {
    it('uses an equality-only partial unique index for custom prefixes', async () => {
        await ensurePidNamespaceIndexes();
        expect(namespaceIndexCalls).to.deep.include({
            key: { domainId: 1, prefix: 1 },
            options: {
                unique: true,
                name: 'pidNamespaceCustomPrefix',
                partialFilterExpression: { kind: 'custom' },
            },
        });
    });

    it('allocates custom PIDs uniquely under concurrency and permanently locks its numbering rule', async () => {
        const created = await createCustomPidNamespace('system', { name: '操作系统', prefix: 'OS', start: 100 }, admin, 'create-os');
        const allocated = await Promise.all([
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: created.namespaceId,
                sourceMeta: { template: 'self', year: 2026 },
                user: admin,
                actor: 2,
                requestId: 'reserve-os-1',
            }),
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: created.namespaceId,
                sourceMeta: { template: 'self', year: 2026 },
                user: admin,
                actor: 2,
                requestId: 'reserve-os-2',
            }),
        ]);
        expect(allocated.map((item) => item.pid)).to.deep.equal(['OS0100', 'OS0101']);

        const live = namespaceDocs[0];
        expect(live).to.include({ allocated: true, counter: 101, revision: 3 });
        await expectReject(
            updatePidNamespaceConfig({
                domainId: 'system',
                namespaceId: created.namespaceId,
                expectedRevision: live.revision,
                user: admin,
                requestId: 'change-os-prefix',
                prefix: 'DB',
            }),
            TestValidationError,
        );
        await expectReject(
            deleteCustomPidNamespace({
                domainId: 'system',
                namespaceId: created.namespaceId,
                expectedRevision: live.revision,
                user: admin,
                requestId: 'delete-os',
            }),
            TestValidationError,
        );

        const renamed = await updatePidNamespaceConfig({
            domainId: 'system',
            namespaceId: created.namespaceId,
            expectedRevision: live.revision,
            user: admin,
            requestId: 'rename-os',
            name: '操作系统课程',
        });
        expect(renamed).to.include({ name: '操作系统课程', counter: 101, allocated: true });
    });

    it('rejects disabled, colliding and exhausted allocations without hiding counter effects', async () => {
        const disabled = await createCustomPidNamespace('system', { name: '数据库', prefix: 'DB', start: 1 }, admin, 'create-db');
        await updatePidNamespaceConfig({
            domainId: 'system',
            namespaceId: disabled.namespaceId,
            expectedRevision: 1,
            user: admin,
            requestId: 'disable-db',
            enabled: false,
        });
        const disabledCounter = namespaceDocs[0].counter;
        await expectReject(
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: disabled.namespaceId,
                sourceMeta: { template: 'self', year: 2026 },
                user: admin,
                actor: 2,
                requestId: 'reserve-disabled',
            }),
            TestValidationError,
        );
        expect(namespaceDocs[0].counter).to.equal(disabledCounter);

        namespaceDocs = [];
        const colliding = await createCustomPidNamespace('system', { name: '网络', prefix: 'NET', start: 1 }, admin, 'create-net');
        problemDocs.push({ domainId: 'system', docType: 10, docId: 50, pid: 'NET0001' });
        await expectReject(
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: colliding.namespaceId,
                sourceMeta: { template: 'self', year: 2026 },
                user: admin,
                actor: 2,
                requestId: 'reserve-collision',
            }),
            TestValidationError,
        );
        expect(namespaceDocs[0].counter).to.equal(1);
        expect(auditDocs.find((row) => row.requestId === 'reserve-collision')).to.deep.include({
            operation: 'pid.allocate',
            domainId: 'system',
            namespaceId: colliding.namespaceId,
            operator: 2,
            requestId: 'reserve-collision',
            result: 'rejected',
        });
        expect(auditDocs.find((row) => row.requestId === 'reserve-collision')?.after).to.deep.equal({
            counter: 1,
            pid: 'NET0001',
            counterConsumed: true,
        });

        namespaceDocs = [];
        const exhausted = await createCustomPidNamespace('system', { name: '极限', prefix: 'MAX', start: 9999 }, admin, 'create-max');
        await reservePidForNamespace({
            domainId: 'system',
            namespaceId: exhausted.namespaceId,
            sourceMeta: { template: 'self', year: 2026 },
            user: admin,
            actor: 2,
            requestId: 'reserve-max',
        });
        await expectReject(
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: exhausted.namespaceId,
                sourceMeta: { template: 'self', year: 2026 },
                user: admin,
                actor: 2,
                requestId: 'reserve-exhausted',
            }),
            TestValidationError,
        );
        expect(namespaceDocs[0].counter).to.equal(9999);
    });

    it('keeps built-in identity immutable and does not corrupt an exhausted built-in counter', async () => {
        await expectReject(
            updatePidNamespaceConfig({
                domainId: 'system',
                namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
                expectedRevision: 0,
                user: admin,
                requestId: 'rename-pat',
                name: '改名',
            }),
            TestValidationError,
        );
        await expectReject(
            deleteCustomPidNamespace({
                domainId: 'system',
                namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
                expectedRevision: 1,
                user: admin,
                requestId: 'delete-pat',
            }),
            TestValidationError,
        );

        counterDocs.push({ domainId: 'system', namespace: 'pat-basic', value: 3999, updatedAt: new Date() });
        await expectReject(
            reservePidForNamespace({
                domainId: 'system',
                namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
                sourceMeta: { template: 'pat_basic', year: 2026, season: 'summer' },
                user: admin,
                actor: 2,
                requestId: 'reserve-pat-exhausted',
            }),
            TestValidationError,
        );
        expect(counterDocs[0].value).to.equal(3999);
    });

    it('lets managers assign only ordinary authors while administrators control manager and edit-all grants', async () => {
        const created = await createCustomPidNamespace('system', { name: '操作系统', prefix: 'OS', start: 1 }, admin, 'create-members');
        let namespace = await setPidNamespaceMember({
            domainId: 'system',
            namespaceId: created.namespaceId,
            expectedRevision: 1,
            targetUid: 8,
            role: 'manager',
            editAll: false,
            user: admin,
            requestId: 'assign-manager',
        });
        const manager = {
            _id: 8,
            hasPriv: () => false,
            hasPerm: () => false,
        };
        namespace = await setPidNamespaceMember({
            domainId: 'system',
            namespaceId: created.namespaceId,
            expectedRevision: namespace.revision,
            targetUid: 9,
            role: 'author',
            editAll: false,
            user: manager,
            requestId: 'assign-author',
        });
        expect(namespace.members).to.deep.include({ uid: 9, role: 'author', editAll: false });
        await expectReject(
            setPidNamespaceMember({
                domainId: 'system',
                namespaceId: created.namespaceId,
                expectedRevision: namespace.revision,
                targetUid: 9,
                role: 'author',
                editAll: true,
                user: manager,
                requestId: 'manager-escalation',
            }),
            TestPermissionError,
        );
    });

    it('writes structured actor, domain, namespace, operation, before, after, result and request id audit fields', async () => {
        const created = await createCustomPidNamespace('system', { name: '操作系统', prefix: 'OS', start: 1 }, admin, 'audit-create');
        await updatePidNamespaceConfig({
            domainId: 'system',
            namespaceId: created.namespaceId,
            expectedRevision: 1,
            user: admin,
            requestId: 'audit-update',
            name: '操作系统课程',
        });
        const audit = auditDocs.find((row) => row.requestId === 'audit-update');
        expect(audit).to.deep.include({
            operation: 'config.update',
            domainId: 'system',
            namespaceId: created.namespaceId,
            operator: 2,
            requestId: 'audit-update',
            result: 'success',
        });
        expect(audit.before).to.deep.include({ name: '操作系统', revision: 1 });
        expect(audit.after).to.deep.include({ name: '操作系统课程', revision: 2 });
    });

    it('records an incomplete audit when a committed config write cannot be materialized', async () => {
        const created = await createCustomPidNamespace('system', { name: '操作系统', prefix: 'OS', start: 1 }, admin, 'create-os');
        failNamespaceReadAfterMutation = true;

        await expectReject(
            updatePidNamespaceConfig({
                domainId: 'system',
                namespaceId: created.namespaceId,
                expectedRevision: 1,
                user: admin,
                requestId: 'update-os-with-read-failure',
                name: '操作系统课程',
            }),
            Error,
        );

        expect(namespaceDocs[0]).to.include({ name: '操作系统课程', revision: 2 });
        expect(auditDocs.find((row) => row.requestId === 'update-os-with-read-failure')).to.deep.include({
            operation: 'config.update',
            result: 'incomplete',
        });
    });
});
