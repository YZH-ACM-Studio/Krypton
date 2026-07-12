import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {} };
const documentPath = require.resolve('../src/model/document.ts');
const accessPath = require.resolve('../src/model/problem-access.ts');
const previousDocumentCache = require.cache[documentPath];
const originalLoad = Module._load;
const realUtils = require('@hydrooj/utils');
const loggerErrorCalls: any[][] = [];

const TYPE_PROBLEM = 10;
const countCalls: Array<{ domainId: string; docType: number; query: unknown }> = [];
const guardedUpdateCalls: Array<{ filter: any; update: any }> = [];
const updateCalls: Array<{ filter: any; update: any }> = [];
let countResult = 0;
let liveProblem: any = null;

function matchesGuardedFilter(doc: any, filter: any): boolean {
    if (!doc || doc.domainId !== filter.domainId || doc.docType !== filter.docType || doc.docId !== filter.docId) {
        return false;
    }
    const revision = filter.aclMutationRevision;
    const actualRevision = doc.aclMutationRevision ?? null;
    if (revision !== undefined && (revision?.$in ? !revision.$in.includes(actualRevision) : actualRevision !== revision)) return false;
    const lockedUid = filter['aclMutationLocks.uid']?.$ne;
    if (lockedUid !== undefined && doc.aclMutationLocks?.some((lock: any) => lock.uid === lockedUid)) return false;
    if (filter['aclMutationLocks.0']?.$exists === false && doc.aclMutationLocks?.length) return false;
    if (filter.aclWriteClaim?.$exists === false && doc.aclWriteClaim !== undefined) return false;
    for (const key of ['aclWriteClaim.requestId', 'aclWriteClaim.actor', 'aclWriteClaim.state']) {
        if (filter[key] !== undefined && doc.aclWriteClaim?.[key.split('.')[1]] !== filter[key]) return false;
    }
    if (filter.maintainer !== undefined && !doc.maintainer?.includes(filter.maintainer)) return false;
    if (
        filter.$or &&
        !filter.$or.some(
            (term: any) =>
                (term.owner !== undefined && doc.owner === term.owner) ||
                (term.maintainer !== undefined && doc.maintainer?.includes(term.maintainer)),
        )
    ) {
        return false;
    }
    return true;
}

function setPath(target: any, key: string, value: unknown) {
    const parts = key.split('.');
    const last = parts.pop();
    let cursor = target;
    for (const part of parts) cursor = cursor[part] ||= {};
    cursor[last] = value;
}

function unsetPath(target: any, key: string) {
    const parts = key.split('.');
    const last = parts.pop();
    let cursor = target;
    for (const part of parts) {
        cursor = cursor?.[part];
        if (!cursor) return;
    }
    delete cursor[last];
}

function applyUpdate(target: any, update: any) {
    for (const [key, value] of Object.entries(update.$set || {})) setPath(target, key, value);
    for (const key of Object.keys(update.$unset || {})) unsetPath(target, key);
    for (const [key, value] of Object.entries(update.$inc || {})) {
        setPath(target, key, (target[key] || 0) + Number(value));
    }
}

require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        TYPE_PROBLEM,
        coll: {
            async findOneAndUpdate(filter: any, update: any) {
                guardedUpdateCalls.push({ filter: structuredClone(filter), update: structuredClone(update) });
                if (!matchesGuardedFilter(liveProblem, filter)) return null;
                applyUpdate(liveProblem, update);
                return structuredClone(liveProblem);
            },
            async updateOne(filter: any, update: any) {
                updateCalls.push({ filter: structuredClone(filter), update: structuredClone(update) });
                if (!matchesGuardedFilter(liveProblem, filter)) return { matchedCount: 0 };
                applyUpdate(liveProblem, update);
                return { matchedCount: 1 };
            },
            async findOne(filter: any) {
                return matchesGuardedFilter(liveProblem, filter) ? structuredClone(liveProblem) : null;
            },
        },
        async count(domainId: string, docType: number, query: unknown) {
            countCalls.push({ domainId, docType, query });
            return countResult;
        },
    },
} as NodeModule;

let access: typeof import('../src/model/problem-access');
try {
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (request === '@hydrooj/utils') {
            return {
                ...realUtils,
                Logger: class TestLogger {
                    error(...args: any[]) {
                        loggerErrorCalls.push(args);
                    }
                },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[accessPath];
    access = require(accessPath);
} finally {
    Module._load = originalLoad;
    if (previousDocumentCache) require.cache[documentPath] = previousDocumentCache;
    else delete require.cache[documentPath];
}

const {
    assertProblemAclDomain,
    assertProblemBankSelection,
    buildProblemBankScope,
    canBrowseProblemBank,
    canMaintainProblem,
    canViewProblem,
    isProblemBankAdmin,
    readStableMaintainableProblem,
    readStableViewableProblem,
    refreshProblemAcl,
} = access;

const { PERM, PRIV } = require('../src/model/builtin.ts');

type UserKind = 'student' | 'creator' | 'hidden-viewer' | 'admin';

function makeUser(kind: UserKind, overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>();
    if (kind === 'creator') perms.add(PERM.PERM_CREATE_PROBLEM);
    if (kind === 'hidden-viewer') perms.add(PERM.PERM_VIEW_PROBLEM_HIDDEN);
    if (kind !== 'student') perms.add(PERM.PERM_VIEW_PROBLEM);
    if (kind === 'student') perms.add(PERM.PERM_VIEW_PROBLEM);
    return {
        _id: 42,
        role: kind === 'admin' ? 'default' : 'root',
        _permitPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _aclFencedPids: new Set<number>(),
        _problemAclDomainId: 'system',
        _problemAclLoaded: true,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => kind === 'admin' && wanted.includes(PRIV.PRIV_EDIT_SYSTEM),
        ...overrides,
    } as any;
}

function pdoc(docId: number, owner = 7, hidden = true, maintainer: number[] = [], domainId = 'system') {
    return { domainId, docId, owner, hidden, maintainer } as any;
}

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as any;
    }
}

beforeEach(() => {
    countCalls.length = 0;
    guardedUpdateCalls.length = 0;
    updateCalls.length = 0;
    countResult = 0;
    liveProblem = null;
    loggerErrorCalls.length = 0;
    (global as any).Hydro.model.permits = {
        async loadAclForUser() {
            return {
                permitPids: new Set<number>(),
                maintainedPids: new Set<number>(),
                fencedPids: new Set<number>(),
            };
        },
    };
});

describe('P2.11 problem-bank capability matrix', () => {
    it('recognizes administrators only through PRIV_EDIT_SYSTEM, never role names', () => {
        expect(isProblemBankAdmin(makeUser('admin'))).to.equal(true);
        expect(isProblemBankAdmin(makeUser('student', { role: 'root' }))).to.equal(false);
        expect(isProblemBankAdmin(makeUser('creator', { role: 'admin' }))).to.equal(false);
    });

    it('lets only admins or creators with a successfully loaded ACL browse', () => {
        expect(canBrowseProblemBank(makeUser('student'))).to.equal(false);
        expect(canBrowseProblemBank(makeUser('hidden-viewer'))).to.equal(false);
        expect(canBrowseProblemBank(makeUser('creator'))).to.equal(true);
        expect(canBrowseProblemBank(makeUser('creator', { _problemAclLoaded: false }))).to.equal(false);
        expect(canBrowseProblemBank(makeUser('admin', { _problemAclLoaded: false }))).to.equal(false);
    });

    it('builds an owner plus active-maintainer Mongo scope and excludes fenced pairs', () => {
        const scope = buildProblemBankScope(
            makeUser('creator', {
                _permitPids: new Set([101, 102, 103]),
                _maintainedPids: new Set([102, 103]),
                _aclFencedPids: new Set([103, 104]),
            }),
        );
        expect(scope).to.deep.equal({
            $and: [
                {
                    $or: [{ owner: 42 }, { $and: [{ docId: { $in: [102] } }, { maintainer: 42 }] }],
                },
                { docId: { $nin: [103, 104] } },
                { 'aclMutationLocks.uid': { $ne: 42 } },
            ],
        });
    });

    it('returns an impossible scope for students and every failed ACL preload', () => {
        expect(buildProblemBankScope(makeUser('student'))).to.deep.equal({ docId: { $in: [] } });
        expect(buildProblemBankScope(makeUser('creator', { _problemAclLoaded: false }))).to.deep.equal({ docId: { $in: [] } });
        expect(buildProblemBankScope(makeUser('admin', { _problemAclLoaded: false }))).to.deep.equal({ docId: { $in: [] } });
    });

    it('excludes an administrator own fenced pair from the otherwise global scope', () => {
        expect(
            buildProblemBankScope(
                makeUser('admin', {
                    _aclFencedPids: new Set([103, 101]),
                }),
            ),
        ).to.deep.equal({
            $and: [{ docId: { $nin: [101, 103] } }, { 'aclMutationLocks.uid': { $ne: 42 } }],
        });
    });

    it('allows exact owners and active maintainers, not verifier or legacy-maintainer grants', () => {
        const owner = makeUser('creator');
        expect(canMaintainProblem(owner, pdoc(100, owner._id))).to.equal(true);

        const maintainerWithoutCreate = makeUser('student', {
            _maintainedPids: new Set([100]),
        });
        expect(canMaintainProblem(maintainerWithoutCreate, pdoc(100))).to.equal(true);

        const verifier = makeUser('creator', { _permitPids: new Set([100]) });
        expect(canMaintainProblem(verifier, pdoc(100))).to.equal(false);
        expect(canMaintainProblem(makeUser('creator'), pdoc(100, 7, true, [42]))).to.equal(false);
        expect(canMaintainProblem(makeUser('creator'), pdoc(100, 99))).to.equal(false);
    });

    it('denies maintenance on fence or ACL preload failure, including owner and admin pairs', () => {
        expect(canMaintainProblem(makeUser('creator', { _aclFencedPids: new Set([100]) }), pdoc(100, 42))).to.equal(false);
        expect(canMaintainProblem(makeUser('creator', { _problemAclLoaded: false }), pdoc(100, 42))).to.equal(false);
        expect(canMaintainProblem(makeUser('admin', { _aclFencedPids: new Set([100]) }), pdoc(100))).to.equal(false);
        expect(canMaintainProblem(makeUser('admin', { _problemAclLoaded: false }), pdoc(100))).to.equal(false);
    });

    it('never applies current-domain maintenance state to the same pid in another domain', () => {
        const otherDomain = pdoc(100, 42, true, [], 'course-domain');
        expect(
            canMaintainProblem(
                makeUser('creator', {
                    _maintainedPids: new Set([100]),
                }),
                otherDomain,
            ),
        ).to.equal(false);
        expect(canMaintainProblem(makeUser('creator'), otherDomain)).to.equal(false);
        expect(canMaintainProblem(makeUser('admin'), otherDomain)).to.equal(false);
    });
});

describe('P2.11 linearizable problem metadata writes', () => {
    const commit = (access as any).commitProblemAclGuardedUpdate;

    it('rejects a stale maintainer snapshot when downgrade increments the live ProblemDoc revision first', async () => {
        const staleUser = makeUser('creator', { _maintainedPids: new Set([100]) });
        const stalePdoc = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            maintainer: [42],
            aclMutationRevision: 0,
        };
        expect(canMaintainProblem(staleUser, stalePdoc)).to.equal(true);
        liveProblem = {
            ...stalePdoc,
            title: 'before',
            maintainer: [],
            aclMutationRevision: 1,
            aclMutationLocks: [],
        };

        const result = await commit(staleUser, stalePdoc, { title: 'stale overwrite' }, {});

        expect(result).to.equal(null);
        expect(liveProblem.title).to.equal('before');
        expect(guardedUpdateCalls[0].filter).to.deep.include({
            domainId: 'system',
            docType: TYPE_PROBLEM,
            docId: 100,
            aclMutationRevision: { $in: [null, 0] },
            maintainer: 42,
            'aclMutationLocks.uid': { $ne: 42 },
        });
    });

    it('allows a current owner, administrator, or live mirrored maintainer with the current revision', async () => {
        for (const [kind, user, owner, maintainer] of [
            ['owner', makeUser('creator'), 42, []],
            ['admin', makeUser('admin'), 7, []],
            ['maintainer', makeUser('creator', { _maintainedPids: new Set([100]) }), 7, [42]],
        ] as const) {
            liveProblem = {
                domainId: 'system',
                docType: TYPE_PROBLEM,
                docId: 100,
                owner,
                maintainer,
                title: 'before',
                aclMutationRevision: 3,
                aclMutationLocks: [],
            };
            const snapshot = structuredClone(liveProblem);

            const result = await commit(user, snapshot, { title: kind }, {});
            expect(result?.title).to.equal(kind);
        }
    });

    it('denies the guarded update while the same uid has a persistent ProblemDoc lock', async () => {
        const user = makeUser('admin');
        liveProblem = {
            domainId: 'system',
            docType: TYPE_PROBLEM,
            docId: 100,
            owner: 7,
            maintainer: [],
            title: 'before',
            aclMutationRevision: 4,
            aclMutationLocks: [{ uid: 42, requestId: 'downgrade' }],
        };

        const result = await commit(user, structuredClone(liveProblem), { title: 'blocked' }, {});

        expect(result).to.equal(null);
        expect(liveProblem.title).to.equal('before');
    });
});

describe('P2.11 durable global problem write claim', () => {
    const acquire = (access as any).acquireProblemWriteClaim;
    const commit = (access as any).commitProblemWriteClaimUpdate;
    const markError = (access as any).markProblemWriteClaimError;
    const clear = (access as any).clearProblemWriteClaim;

    it('lets a live maintainer claim the global latch and rejects every overlapping writer', async () => {
        const user = makeUser('creator', { _maintainedPids: new Set([100]) });
        liveProblem = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            maintainer: [42],
            aclMutationRevision: 3,
            aclMutationLocks: [],
            title: 'before',
        };
        const snapshot = structuredClone(liveProblem);
        const claim = await acquire(user, snapshot, 'files-100', 'files-upload', { now: new Date('2026-07-11T00:00:00.000Z') });
        expect(claim).to.deep.include({
            domainId: 'system',
            pid: 100,
            requestId: 'files-100',
            actor: 42,
            operation: 'files-upload',
            state: 'active',
            lastError: null,
        });
        expect(liveProblem.aclMutationRevision).to.equal(4);

        const second = await acquire(user, structuredClone(liveProblem), 'other', 'metadata-edit');
        expect(second).to.equal(null);
        const stale = await (access as any).commitProblemAclGuardedUpdate(user, snapshot, { title: 'stale' }, {});
        expect(stale).to.equal(null);
        expect(liveProblem.title).to.equal('before');
    });

    it('makes revoke-first and write-first mutually exclusive at revision plus lock state', async () => {
        const user = makeUser('creator', { _maintainedPids: new Set([100]) });
        const stale = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            maintainer: [42],
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        liveProblem = {
            ...stale,
            maintainer: [],
            aclMutationRevision: 1,
            aclMutationLocks: [{ uid: 42, requestId: 'owner-revoke' }],
        };
        expect(await acquire(user, stale, 'old-files', 'files-delete')).to.equal(null);

        liveProblem = structuredClone(stale);
        const claim = await acquire(user, stale, 'write-first', 'files-delete');
        expect(claim).not.to.equal(null);
        expect(liveProblem.aclWriteClaim.requestId).to.equal('write-first');
        // Repository ACL-lock creation is required to match this exact active
        // claim; an unbound revoke cannot match the same ProblemDoc state.
        expect(liveProblem.aclWriteClaim.state).to.equal('active');
    });

    it('keeps one claim across metadata steps, then clears only the exact owner', async () => {
        const user = makeUser('creator');
        liveProblem = {
            ...pdoc(100, 42),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
            title: 'before',
            config: '',
        };
        const claim = await acquire(user, structuredClone(liveProblem), 'problem-save', 'problem-structure-save');
        expect((await commit(claim, { title: 'after' }, {}))?.title).to.equal('after');
        expect((await commit(claim, { config: 'type: objective' }, {}))?.config).to.equal('type: objective');
        expect(await clear({ ...claim, requestId: 'forged' })).to.equal(false);
        expect(await clear(claim)).to.equal(true);
        expect(liveProblem.aclWriteClaim).to.equal(undefined);
    });

    it('persists an ERROR marker without TTL for the fenced repair service', async () => {
        const user = makeUser('creator');
        liveProblem = {
            ...pdoc(100, 42),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        const claim = await acquire(user, structuredClone(liveProblem), 'failed-upload', 'files-upload');
        expect(await markError(claim, new Error('storage failed'), new Date('2026-07-11T00:01:00.000Z'))).to.equal(true);
        expect(liveProblem.aclWriteClaim).to.deep.include({
            requestId: 'failed-upload',
            state: 'error',
            lastError: 'Error: storage failed',
        });
        expect(await clear(claim)).to.equal(false);
        expect(liveProblem.aclWriteClaim.state).to.equal('error');
        expect((access as any).clearErroredProblemWriteClaimForRepair).to.equal(undefined);
    });

    it('refuses to clear an ACTIVE claim while any ACL mutation lock remains', async () => {
        const user = makeUser('creator');
        liveProblem = {
            ...pdoc(100, 42),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        const claim = await acquire(user, structuredClone(liveProblem), 'permit-edit', 'permit-grant');
        liveProblem.aclMutationLocks.push({ uid: 77, requestId: 'permit-target' });
        expect(await clear(claim)).to.equal(false);
        expect(liveProblem.aclWriteClaim.requestId).to.equal('permit-edit');
        liveProblem.aclMutationLocks = [];
        expect(await clear(claim)).to.equal(true);
    });

    it('allows only an actor-exact self-revoke claim without maintenance authority', async () => {
        const verifier = makeUser('student', { _id: 55 });
        liveProblem = {
            ...pdoc(100, 7),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 2,
            aclMutationLocks: [],
            maintainer: [],
        };
        const claim = await acquire(verifier, structuredClone(liveProblem), 'self-revoke', 'permit-revoke', { selfRevokeUid: 55 });
        expect(claim?.actor).to.equal(55);
        await clear(claim);
        const error = await captureFailure(() =>
            acquire(verifier, structuredClone(liveProblem), 'forged-self', 'permit-revoke', { selfRevokeUid: 56 }),
        );
        expect(error).to.be.instanceOf(TypeError);
    });
});

describe('P2.11 concrete-problem viewing', () => {
    it('preserves public, owner, and global-hidden access', () => {
        expect(canViewProblem(makeUser('student'), pdoc(100, 7, false))).to.equal(true);
        expect(canViewProblem(makeUser('student'), pdoc(100, 42, true))).to.equal(true);
        expect(canViewProblem(makeUser('hidden-viewer'), pdoc(100))).to.equal(true);
    });

    it('fails closed for public, owner, and administrator access when ACL preload fails', () => {
        const failedPreload = { _problemAclLoaded: false };
        expect(canViewProblem(makeUser('student', failedPreload), pdoc(100, 7, false))).to.equal(false);
        expect(canViewProblem(makeUser('student', failedPreload), pdoc(100, 42))).to.equal(false);
        expect(
            canViewProblem(
                makeUser('admin', {
                    ...failedPreload,
                    hasPerm: (...wanted: bigint[]) => wanted.some((perm) => [PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN].includes(perm)),
                }),
                pdoc(100),
            ),
        ).to.equal(false);
    });

    it('fails closed for public, owner, and administrator access when ACL state belongs to another domain', () => {
        const wrongDomain = { _problemAclDomainId: 'course-domain' };
        expect(canViewProblem(makeUser('student', wrongDomain), pdoc(100, 7, false))).to.equal(false);
        expect(canViewProblem(makeUser('student', wrongDomain), pdoc(100, 42))).to.equal(false);
        expect(
            canViewProblem(
                makeUser('admin', {
                    ...wrongDomain,
                    hasPerm: (...wanted: bigint[]) => wanted.some((perm) => [PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN].includes(perm)),
                }),
                pdoc(100),
            ),
        ).to.equal(false);
    });

    it('accepts active verifier/maintainer permits only after ACL preload', () => {
        expect(canViewProblem(makeUser('student', { _permitPids: new Set([100]) }), pdoc(100))).to.equal(true);
        expect(
            canViewProblem(
                makeUser('student', {
                    _permitPids: new Set([100]),
                    _problemAclLoaded: false,
                }),
                pdoc(100),
            ),
        ).to.equal(false);
        expect(canViewProblem(makeUser('student'), pdoc(100, 7, true, [42]))).to.equal(false);
    });

    it('denies a fenced pair before every other concrete-problem grant', () => {
        for (const user of [
            makeUser('student', { _aclFencedPids: new Set([100]) }),
            makeUser('hidden-viewer', { _aclFencedPids: new Set([100]) }),
            makeUser('admin', { _aclFencedPids: new Set([100]) }),
        ]) {
            expect(canViewProblem(user, pdoc(100, user._id, false))).to.equal(false);
        }
    });

    it('does not reuse current-domain ACL state for the same pid in another domain', () => {
        const hiddenOther = pdoc(100, 7, true, [], 'course-domain');
        expect(
            canViewProblem(
                makeUser('student', {
                    _permitPids: new Set([100]),
                }),
                hiddenOther,
            ),
        ).to.equal(false);
        expect(
            canViewProblem(
                makeUser('student', {
                    _aclFencedPids: new Set([100]),
                }),
                pdoc(100, 7, false, [], 'course-domain'),
            ),
        ).to.equal(false);
    });
});

describe('P2.11 stable direct-problem reads', () => {
    function readLiveProblem(onFinal?: (filter: any) => void) {
        return async (filter?: any) => {
            if (!filter) return liveProblem ? structuredClone(liveProblem) : null;
            onFinal?.(filter);
            return matchesGuardedFilter(liveProblem, filter) ? structuredClone(liveProblem) : null;
        };
    }

    function permitSnapshot(...pids: number[]) {
        return {
            permitPids: new Set(pids),
            maintainedPids: new Set<number>(),
            fencedPids: new Set<number>(),
        };
    }

    function maintainerSnapshot(...pids: number[]) {
        return {
            permitPids: new Set(pids),
            maintainedPids: new Set(pids),
            fencedPids: new Set<number>(),
        };
    }

    it('returns a stable permitted snapshot and strips every persistent coordination field', async () => {
        liveProblem = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            title: 'secret',
            aclMutationRevision: 4,
            aclMutationLocks: [],
            aclWriteClaim: { requestId: 'edit-1', state: 'active' },
        };
        (global as any).Hydro.model.permits.loadAclForUser = async () => permitSnapshot(100);

        const result = await readStableViewableProblem('system', makeUser('student'), readLiveProblem());

        expect(result?.title).to.equal('secret');
        expect(result).not.to.have.property('aclMutationRevision');
        expect(result).not.to.have.property('aclMutationLocks');
        expect(result).not.to.have.property('aclWriteClaim');
    });

    it('denies when revocation starts after the initial read but before ACL loading', async () => {
        liveProblem = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        (global as any).Hydro.model.permits.loadAclForUser = async () => {
            liveProblem.aclMutationRevision = 1;
            return permitSnapshot();
        };

        const result = await readStableViewableProblem('system', makeUser('student'), readLiveProblem());

        expect(result).to.equal(null);
    });

    it('rejects an old ACL snapshot when revocation completes during ACL loading', async () => {
        liveProblem = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        let loads = 0;
        (global as any).Hydro.model.permits.loadAclForUser = async () => {
            loads++;
            if (loads === 1) {
                liveProblem.aclMutationRevision = 1;
                return permitSnapshot(100);
            }
            return permitSnapshot();
        };

        const result = await readStableViewableProblem('system', makeUser('student'), readLiveProblem());

        expect(result).to.equal(null);
        expect(loads).to.equal(2);
    });

    it('rejects an old ACL snapshot when revocation wins immediately before the final read', async () => {
        liveProblem = {
            ...pdoc(100),
            docType: TYPE_PROBLEM,
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        let loads = 0;
        let finals = 0;
        (global as any).Hydro.model.permits.loadAclForUser = async () => {
            loads++;
            return loads === 1 ? permitSnapshot(100) : permitSnapshot();
        };

        const result = await readStableViewableProblem(
            'system',
            makeUser('student'),
            readLiveProblem(() => {
                if (finals++ === 0) {
                    liveProblem.aclMutationRevision = 1;
                    liveProblem.aclMutationLocks = [];
                }
            }),
        );

        expect(result).to.equal(null);
        expect(finals).to.equal(1);
        expect(loads).to.equal(2);
    });

    it('keeps public, owner, verifier, global-hidden viewer, and administrator reads stable', async () => {
        for (const [user, doc, permits] of [
            [makeUser('student'), pdoc(100, 7, false), []],
            [makeUser('student'), pdoc(100, 42, true), []],
            [makeUser('student'), pdoc(100), [100]],
            [makeUser('hidden-viewer'), pdoc(100), []],
            [
                makeUser('admin', {
                    hasPerm: (...wanted: bigint[]) => wanted.some((perm) => [PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN].includes(perm)),
                }),
                pdoc(100),
                [],
            ],
        ] as const) {
            liveProblem = {
                ...doc,
                docType: TYPE_PROBLEM,
                aclMutationRevision: 2,
                aclMutationLocks: [],
            };
            (global as any).Hydro.model.permits.loadAclForUser = async () => permitSnapshot(...permits);

            const result = await readStableViewableProblem('system', user, readLiveProblem());
            expect(result?.docId).to.equal(100);
        }
    });

    it('rejects an old maintainer snapshot when downgrade completes before the final raw read', async () => {
        liveProblem = {
            ...pdoc(100, 7, true, [42]),
            docType: TYPE_PROBLEM,
            config: 'secret: true',
            aclMutationRevision: 0,
            aclMutationLocks: [],
        };
        let loads = 0;
        let finals = 0;
        (global as any).Hydro.model.permits.loadAclForUser = async () => {
            loads++;
            return loads === 1 ? maintainerSnapshot(100) : maintainerSnapshot();
        };

        const result = await readStableMaintainableProblem(
            'system',
            makeUser('creator'),
            readLiveProblem(() => {
                if (finals++ === 0) {
                    // The downgrade has completed and its marker is already
                    // clear: only the ProblemDoc revision/mirror changed.
                    liveProblem.aclMutationRevision = 1;
                    liveProblem.maintainer = [];
                }
            }),
        );

        expect(result).to.equal(null);
        expect(finals).to.equal(1);
        expect(loads).to.equal(2);
    });

    it('requires a stable owner-or-maintainer mirror for maintainer-only reads', async () => {
        liveProblem = {
            ...pdoc(100, 7, true, []),
            docType: TYPE_PROBLEM,
            config: 'secret: true',
            aclMutationRevision: 4,
            aclMutationLocks: [],
        };
        (global as any).Hydro.model.permits.loadAclForUser = async () => maintainerSnapshot(100);
        const finalFilters: any[] = [];

        const result = await readStableMaintainableProblem(
            'system',
            makeUser('creator'),
            readLiveProblem((filter) => finalFilters.push(filter)),
        );

        expect(result).to.equal(null);
        expect(finalFilters).to.have.length(2);
        expect(finalFilters.every((filter) => filter.$or?.some((term: any) => term.maintainer === 42))).to.equal(true);
    });

    it('preserves stable raw reads for owners, active maintainers, and administrators', async () => {
        for (const [user, owner, maintainer, snapshot] of [
            [makeUser('creator'), 42, [], maintainerSnapshot()],
            [makeUser('creator'), 7, [42], maintainerSnapshot(100)],
            [makeUser('admin'), 7, [], maintainerSnapshot()],
        ] as const) {
            liveProblem = {
                ...pdoc(100, owner, true, [...maintainer]),
                docType: TYPE_PROBLEM,
                config: 'secret: true',
                aclMutationRevision: 5,
                aclMutationLocks: [],
            };
            (global as any).Hydro.model.permits.loadAclForUser = async () => snapshot;

            const result = await readStableMaintainableProblem('system', user, readLiveProblem());

            expect(result?.config).to.equal('secret: true');
            expect((result as any)?.aclMutationRevision).to.equal(undefined);
            expect((result as any)?.aclMutationLocks).to.equal(undefined);
        }
    });
});

describe('P2.11 ACL reload observability', () => {
    it('fails closed with one client-safe 403 while logging and preserving the original server error', async () => {
        const raw = new Error('database unavailable');
        const user = makeUser('creator', {
            _permitPids: new Set([901]),
            _maintainedPids: new Set([902]),
            _aclFencedPids: new Set([903]),
            _problemAclDomainId: 'system',
            _problemAclLoaded: true,
        });
        (global as any).Hydro.model.permits.loadAclForUser = async () => {
            throw raw;
        };

        const denied = await captureFailure(() => refreshProblemAcl(user, 'system'));

        expect(denied?.name).to.equal('PermissionError');
        expect(denied?.code).to.equal(403);
        expect(denied?.cause).to.equal(raw);
        expect(Object.prototype.propertyIsEnumerable.call(denied, 'cause')).to.equal(false);
        expect(Object.keys(denied)).not.to.include('cause');
        expect([...user._permitPids]).to.deep.equal([]);
        expect([...user._maintainedPids]).to.deep.equal([]);
        expect([...user._aclFencedPids]).to.deep.equal([]);
        expect(user._problemAclDomainId).to.equal(undefined);
        expect(user._problemAclLoaded).to.equal(false);
        expect(loggerErrorCalls).to.deep.equal([['Problem ACL reload failed domain=%s uid=%d error=%o', 'system', 42, raw]]);

        (global as any).Hydro.model.permits.loadAclForUser = async () => ({
            permitPids: [],
            maintainedPids: new Set(),
            fencedPids: new Set(),
        });
        const invalid = await captureFailure(() => refreshProblemAcl(user, 'system'));
        expect(invalid?.name).to.equal(denied?.name);
        expect(invalid?.code).to.equal(denied?.code);
        expect(invalid?.params).to.deep.equal(denied?.params);
        expect(invalid?.cause).to.be.instanceOf(TypeError);
        expect(invalid?.cause?.message).to.equal('permits.loadAclForUser returned an invalid ACL snapshot');
        expect(loggerErrorCalls[1]?.slice(0, 3)).to.deep.equal(['Problem ACL reload failed domain=%s uid=%d error=%o', 'system', 42]);
        expect(loggerErrorCalls[1]?.[3]).to.equal(invalid?.cause);
    });
});

describe('P2.11 problem selection assertion', () => {
    it('accepts only successfully loaded ACL state for the authoritative domain', () => {
        expect(() => assertProblemAclDomain(makeUser('creator'), 'system')).not.to.throw();
        expect(() => assertProblemAclDomain(makeUser('creator', { _problemAclLoaded: false }), 'system')).to.throw(/permission/i);
        expect(() => assertProblemAclDomain(makeUser('creator'), 'course-domain')).to.throw(/permission/i);
    });

    it('deduplicates new pids, skips grandfathered pids, and checks one scoped count', async () => {
        countResult = 1;
        const user = makeUser('creator', { _maintainedPids: new Set([20]) });
        await assertProblemBankSelection('system', [10, 20, 20], user, [10]);
        expect(countCalls).to.deep.equal([
            {
                domainId: 'system',
                docType: TYPE_PROBLEM,
                query: {
                    $and: [buildProblemBankScope(user), { docId: { $in: [20] }, archivedAt: { $exists: false } }],
                },
            },
        ]);
    });

    it('allows an all-grandfathered selection without requiring current browse ability or querying Mongo', async () => {
        await assertProblemBankSelection('system', [10, 10], makeUser('student'), [10]);
        expect(countCalls).to.deep.equal([]);
    });

    it('checks the authoritative ACL domain before an all-grandfathered early return', async () => {
        const error = await captureFailure(() => assertProblemBankSelection('course-domain', [10], makeUser('student'), [10]));
        expect(error?.name).to.equal('PermissionError');
        expect(countCalls).to.deep.equal([]);
    });

    it('rejects missing or out-of-scope selections with the same non-disclosing permission error', async () => {
        const user = makeUser('creator');
        countResult = 0;
        const missing = await captureFailure(() => assertProblemBankSelection('system', [10], user));
        const outOfScope = await captureFailure(() => assertProblemBankSelection('system', [99], user));
        expect(missing?.name).to.equal('PermissionError');
        expect(outOfScope?.name).to.equal('PermissionError');
        expect(missing?.params).to.deep.equal(outOfScope?.params);
        expect(String(missing)).not.to.include('10');
        expect(String(outOfScope)).not.to.include('99');
    });

    it('rejects any newly added pid before Mongo when the user cannot browse', async () => {
        const error = await captureFailure(() => assertProblemBankSelection('system', [20], makeUser('student'), [10]));
        expect(error?.name).to.equal('PermissionError');
        expect(countCalls).to.deep.equal([]);
    });

    it('fails closed before Mongo when non-admin ACL state belongs to another domain', async () => {
        const error = await captureFailure(() => assertProblemBankSelection('course-domain', [20], makeUser('creator')));
        expect(error?.name).to.equal('PermissionError');
        expect(countCalls).to.deep.equal([]);
    });

    it('also rejects an administrator selection when its loaded ACL belongs to another domain', async () => {
        const error = await captureFailure(() => assertProblemBankSelection('course-domain', [20], makeUser('admin')));
        expect(error?.name).to.equal('PermissionError');
        expect(countCalls).to.deep.equal([]);
    });
});

describe('P2.11 ProblemModel public surface', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/problem.ts'), 'utf8');

    it('exposes stable plugin wrappers and delegates concrete viewing to the ACL helper', () => {
        for (const method of [
            'assertProblemAclDomain',
            'isProblemBankAdmin',
            'canBrowseProblemBank',
            'buildProblemBankScope',
            'canMaintainProblem',
            'assertProblemBankSelection',
            'getMaintainableAuthorized',
            'getViewableAuthorized',
        ]) {
            expect(source).to.match(new RegExp(`static (?:async )?${method}\\(`));
        }
        expect(source).to.include('return canViewProblem(udoc, pdoc);');
        expect(source).to.include('readStableViewableProblem(domainId, user, read)');
        expect(source).to.include('readStableMaintainableProblem(domainId, user, read)');
        expect(source).to.include('PROBLEM_ACL_INTERNAL_FIELDS');
        expect(source).not.to.include('pdoc.maintainer?.includes(udoc._id)');
        expect(source).not.to.include('i.maintainer?.includes(canViewHidden as any)');
    });
});

describe('P2.11 stable direct-read entry contracts', () => {
    const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
    const recordSource = readSource('packages/hydrooj/src/handler/record.ts');
    const referenceSource = readSource('packages/hydrooj/src/handler/problem-reference.ts');
    const homeSource = readSource('packages/hydrooj/src/handler/home.ts');
    const permitsSource = readSource('packages/krypton-permits/src/handler.ts');

    it('routes record, referenced-problem, starred, and permit-inbox reads through the stable helper', () => {
        expect(recordSource).not.to.include('problem.canViewBy(');
        expect(recordSource).to.include('problem.getViewableAuthorized(');
        expect(referenceSource).to.include('problem.getViewableAuthorized(');
        expect(referenceSource).not.to.include('problem.canViewBy(');
        expect(homeSource).to.include('ProblemModel.getViewableAuthorized(');
        expect(permitsSource).to.include('ProblemModel.getViewableAuthorized(');
    });
});

describe('P2.11 startup contracts', () => {
    const loaderSource = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/loader.ts'), 'utf8');
    const settingSource = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/setting.ts'), 'utf8');

    it('loads krypton-permits as a builtin before request-serving UI addons', () => {
        const permits = loaderSource.indexOf("path.resolve(__dirname, '..', '..', 'krypton-permits')");
        const ui = loaderSource.indexOf("path.resolve(__dirname, '..', '..', 'ui-next')");
        expect(permits).to.be.greaterThan(-1);
        expect(permits).to.be.lessThan(ui);
    });

    it('keeps problem.hideBank default-on only as a deprecated compatibility setting', () => {
        expect(settingSource).to.include("Setting('setting_basic', 'problem.hideBank', true");
        expect(settingSource).to.match(/problem\.hideBank[\s\S]{0,500}@deprecated/);
        expect(settingSource).to.match(/problem\.hideBank[\s\S]{0,700}not an authorization/i);
    });
});
