import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { PidNamespaceAclUser } from '../src/model/problem-pid-namespace';

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
const collectionStub = {
    find() {
        return {
            sort() {
                return this;
            },
            async toArray() {
                return structuredClone(namespaceDocs);
            },
        };
    },
    async findOne() {
        return null;
    },
};

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => collectionStub } },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { PermissionError: TestPermissionError, ValidationError: TestValidationError },
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
    exports: { add: async () => null, coll: { updateOne: async () => ({ matchedCount: 1 }) } },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_PROBLEM: 10, coll: collectionStub },
} as NodeModule;
delete require.cache[modulePath];

const {
    BUILTIN_PID_NAMESPACE_IDS,
    DEFAULT_PID_NAMESPACE_ID,
    builtinPidNamespaceIdForSourceTemplate,
    canCreateInPidNamespace,
    formatCustomPid,
    loadPidNamespaceAclForUser,
    normalizeCustomPidNamespaceInput,
    pidNamespaceCapabilityForProblem,
    withLivePidNamespaceGrant,
    withPidNamespaceBoundary,
} = require(modulePath) as typeof import('../src/model/problem-pid-namespace');

function actor(input: {
    admin?: boolean;
    createAll?: boolean;
    createProgramming?: boolean;
    authors?: string[];
    managers?: string[];
    editAll?: string[];
}): PidNamespaceAclUser {
    return {
        _id: 42,
        hasPriv: () => !!input.admin,
        hasPerm: (permission: bigint) => {
            if (permission === 0n) return false;
            return input.createAll || input.createProgramming || false;
        },
        _pidNamespaceAclLoaded: true,
        _pidNamespaceAclDomainId: 'system',
        _pidNamespaceAuthorIds: new Set(input.authors || []),
        _pidNamespaceManagerIds: new Set(input.managers || []),
        _pidNamespaceEditAllIds: new Set(input.editAll || []),
    };
}

describe('P2.38 PID namespace canonical rules', () => {
    it('returns an explicit empty namespace ACL for an anonymous user', async () => {
        namespaceDocs = [];
        const snapshot = await loadPidNamespaceAclForUser('system', 0);
        expect([...snapshot.authorNamespaceIds]).to.deep.equal([]);
        expect([...snapshot.managerNamespaceIds]).to.deep.equal([]);
        expect([...snapshot.editAllNamespaceIds]).to.deep.equal([]);
        let rejected: unknown;
        try {
            await loadPidNamespaceAclForUser('system', -1);
        } catch (error) {
            rejected = error;
        }
        expect(rejected).to.be.instanceOf(TypeError);
    });

    it('maps every managed source template to one stable built-in namespace', () => {
        expect(builtinPidNamespaceIdForSourceTemplate('pat_basic')).to.equal(BUILTIN_PID_NAMESPACE_IDS.patBasic);
        expect(builtinPidNamespaceIdForSourceTemplate('pat_advanced')).to.equal(BUILTIN_PID_NAMESPACE_IDS.patAdvanced);
        expect(builtinPidNamespaceIdForSourceTemplate('self')).to.equal(DEFAULT_PID_NAMESPACE_ID);
        expect(builtinPidNamespaceIdForSourceTemplate('nowcoder_summer')).to.equal(BUILTIN_PID_NAMESPACE_IDS.nowcoder);
        expect(builtinPidNamespaceIdForSourceTemplate('hdu_summer')).to.equal(BUILTIN_PID_NAMESPACE_IDS.hdu);
        expect(builtinPidNamespaceIdForSourceTemplate('hdu_spring')).to.equal(BUILTIN_PID_NAMESPACE_IDS.hdu);
        expect(builtinPidNamespaceIdForSourceTemplate('gplt_national')).to.equal(BUILTIN_PID_NAMESPACE_IDS.gplt);
        expect(builtinPidNamespaceIdForSourceTemplate('gplt_provincial')).to.equal(BUILTIN_PID_NAMESPACE_IDS.gplt);
        expect(builtinPidNamespaceIdForSourceTemplate('cauc')).to.equal(BUILTIN_PID_NAMESPACE_IDS.cauc);
    });

    it('keeps P5 available as the default without a namespace grant', () => {
        const user = actor({ createProgramming: true });
        expect(canCreateInPidNamespace(user, 'system', DEFAULT_PID_NAMESPACE_ID)).to.equal(true);
        expect(canCreateInPidNamespace(user, 'other', DEFAULT_PID_NAMESPACE_ID)).to.equal(false);
    });

    it('requires a namespace author grant even with the upper-level create permission', () => {
        const namespaceId = BUILTIN_PID_NAMESPACE_IDS.nowcoder;
        expect(canCreateInPidNamespace(actor({ createAll: true }), 'system', namespaceId)).to.equal(false);
        expect(canCreateInPidNamespace(actor({ createAll: true, authors: [namespaceId] }), 'system', namespaceId)).to.equal(true);
        expect(canCreateInPidNamespace(actor({ createProgramming: true, managers: [namespaceId] }), 'system', namespaceId)).to.equal(true);
        expect(canCreateInPidNamespace(actor({ admin: true }), 'system', namespaceId)).to.equal(true);
    });

    it('keeps manager, edit-all and per-problem capabilities orthogonal', () => {
        const namespaceId = 'custom:os';
        const pdoc = {
            domainId: 'system',
            docId: 100,
            pidNamespaceId: namespaceId,
            authoringMode: 'managed' as const,
            hidden: true,
            managedAuthoring: { metadataStatus: 'draft' as const },
        };
        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), pdoc, 'metadata')).to.equal('manager');
        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), pdoc, 'publish')).to.equal('manager');
        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), pdoc, 'content')).to.equal(null);
        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), pdoc, 'data')).to.equal(null);

        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), pdoc, 'content')).to.equal('editAll');
        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), pdoc, 'data')).to.equal('editAll');
        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), pdoc, 'metadata')).to.equal('editAll');
        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), pdoc, 'publish')).to.equal(null);
        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), pdoc, 'collaborators')).to.equal(null);

        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), { ...pdoc, hidden: false }, 'publish')).to.equal(null);
        expect(pidNamespaceCapabilityForProblem(actor({ managers: [namespaceId] }), { ...pdoc, hidden: false }, 'metadata')).to.equal(null);
        expect(pidNamespaceCapabilityForProblem(actor({ editAll: [namespaceId] }), { ...pdoc, archivedAt: new Date() }, 'content')).to.equal(null);
    });

    it('canonicalizes custom namespaces without accepting a rule engine', () => {
        expect(
            normalizeCustomPidNamespaceInput({
                name: '操作系统',
                prefix: ' os ',
                start: '1001',
            }),
        ).to.deep.equal({
            name: '操作系统',
            prefix: 'OS',
            start: 1001,
        });
        for (const prefix of ['', 'O', 'OS-', 'P3', 'NOWCODER', 'TOOLONGPREFIX']) {
            expect(() => normalizeCustomPidNamespaceInput({ name: '课程', prefix, start: 1 })).to.throw();
        }
        expect(() => normalizeCustomPidNamespaceInput({ name: '课程', prefix: 'OS', start: 0 })).to.throw();
        expect(() => normalizeCustomPidNamespaceInput({ name: '课程', prefix: 'OS', start: 10_000 })).to.throw();
    });

    it('formats exactly four digits and fails fast at exhaustion', () => {
        expect(formatCustomPid('OS', 1)).to.equal('OS0001');
        expect(formatCustomPid('OS', 1072)).to.equal('OS1072');
        expect(formatCustomPid('OS', 9999)).to.equal('OS9999');
        expect(() => formatCustomPid('OS', 10_000)).to.throw();
    });

    it('serializes same-namespace writes without blocking other namespaces', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = withPidNamespaceBoundary('system', 'custom:os', async () => {
            events.push('os:first:start');
            await firstGate;
            events.push('os:first:end');
        });
        const second = withPidNamespaceBoundary('system', 'custom:os', async () => {
            events.push('os:second');
        });
        const unrelated = withPidNamespaceBoundary('system', 'custom:db', async () => {
            events.push('db');
        });
        await unrelated;
        expect(events).to.deep.equal(['os:first:start', 'db']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).to.deep.equal(['os:first:start', 'db', 'os:first:end', 'os:second']);
    });

    it('keeps a live namespace grant across one reentrant scoped write before a queued revoke', async () => {
        const namespaceId = 'custom:0123456789abcdef01234567';
        namespaceDocs = [{ namespaceId, members: [{ uid: 42, role: 'author', editAll: true }] }];
        const events: string[] = [];
        let releaseWrite!: () => void;
        const writeGate = new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });
        const claim = {
            domainId: 'system',
            pid: 100,
            actor: 42,
            requestId: 'data:100',
            pidNamespaceId: namespaceId,
            pidNamespaceGrant: 'editAll' as const,
        };
        const write = withLivePidNamespaceGrant(claim, () =>
            withPidNamespaceBoundary('system', namespaceId, async () => {
                events.push('write:start');
                await writeGate;
                events.push('write:end');
                return 'written';
            }),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        const revoke = withPidNamespaceBoundary('system', namespaceId, async () => {
            namespaceDocs = [];
            events.push('revoke');
        });

        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(events).to.deep.equal(['write:start']);
        releaseWrite();
        expect(await write).to.equal('written');
        await revoke;
        expect(events).to.deep.equal(['write:start', 'write:end', 'revoke']);
    });

    it('rechecks manager membership at the specialized publication write boundary', async () => {
        const namespaceId = 'custom:0123456789abcdef01234567';
        namespaceDocs = [
            {
                namespaceId,
                members: [{ uid: 42, role: 'manager', editAll: false }],
            },
        ];
        const claim = {
            domainId: 'system',
            pid: 100,
            actor: 42,
            requestId: 'review:100',
            pidNamespaceId: namespaceId,
            pidNamespaceGrant: 'manager' as const,
        };
        expect(await withLivePidNamespaceGrant(claim, async () => 'committed')).to.equal('committed');
        namespaceDocs = [];
        expect(await withLivePidNamespaceGrant(claim, async () => 'must-not-run')).to.equal(null);
    });
});
