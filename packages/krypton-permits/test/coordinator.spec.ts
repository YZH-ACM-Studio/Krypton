import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import {
    AclMutationError,
    type AclMutationFence,
    type AclPair,
    type AclRepository,
    createAclCoordinator,
    type PermitSource,
} from '../src/coordinator';

const keyOf = ({ domainId, pid, uid }: AclPair) => `${domainId}:${pid}:${uid}`;

class MemoryAclRepository implements AclRepository {
    canonical = new Map<string, any>();
    sources = new Map<string, PermitSource[]>();
    fences = new Map<string, AclMutationFence>();
    mirrors = new Map<string, Set<number>>();
    problemLocks = new Map<string, any>();
    problemRevisions = new Map<string, number>();
    activeClaims = new Map<string, string>();
    failOnceAt: string | null = null;

    private fail(step: string) {
        if (this.failOnceAt === step) {
            this.failOnceAt = null;
            throw new Error(`injected ${step} failure`);
        }
    }

    async getCanonical(pair: AclPair) {
        return this.canonical.get(keyOf(pair)) || null;
    }

    async getSources(pair: AclPair) {
        return (this.sources.get(keyOf(pair)) || []).map((source) => ({ ...source }));
    }

    async getFence(pair: AclPair) {
        return this.fences.get(keyOf(pair)) || null;
    }

    async getProblemAclMutationLock(pair: AclPair) {
        return this.problemLocks.get(keyOf(pair)) || null;
    }

    async beginProblemAclMutation(lock: any) {
        this.fail('lock');
        const key = keyOf(lock);
        const problemKey = `${lock.domainId}:${lock.pid}`;
        const activeClaim = this.activeClaims.get(problemKey);
        if ((lock.writeClaimRequestId || null) !== (activeClaim || null)) {
            throw new Error(`write claim mismatch: ${activeClaim || 'none'}`);
        }
        const existing = this.problemLocks.get(key);
        if (existing) {
            if (existing.requestId !== lock.requestId) throw new Error(`locked by ${existing.requestId}`);
            return existing;
        }
        this.problemLocks.set(key, structuredClone(lock));
        this.problemRevisions.set(problemKey, (this.problemRevisions.get(problemKey) || 0) + 1);
        return this.problemLocks.get(key);
    }

    async clearProblemAclMutation(pair: AclPair, requestId: string) {
        this.fail('clearLock');
        const key = keyOf(pair);
        if (this.problemLocks.get(key)?.requestId !== requestId) throw new Error('problem lock ownership lost');
        this.problemLocks.delete(key);
    }

    async createFence(fence: AclMutationFence) {
        this.fail('fence');
        const key = keyOf(fence);
        if (this.fences.has(key)) throw Object.assign(new Error('duplicate fence'), { code: 11000 });
        this.fences.set(key, structuredClone(fence));
    }

    async updateFence(pair: AclPair, requestId: string, patch: Partial<AclMutationFence>) {
        const key = keyOf(pair);
        const fence = this.fences.get(key);
        if (!fence || fence.requestId !== requestId) throw new Error('fence ownership lost');
        Object.assign(fence, structuredClone(patch));
    }

    async applySource(fence: AclMutationFence) {
        this.fail('source');
        if (fence.intent.action === 'reconcile') return;
        const key = keyOf(fence);
        const current = this.sources.get(key) || [];
        const identity = `${fence.intent.sourceType}:${fence.intent.sourceId}`;
        const next = current.filter((source) => `${source.sourceType}:${source.sourceId}` !== identity);
        if (fence.intent.role) {
            next.push({
                domainId: fence.domainId,
                pid: fence.pid,
                uid: fence.uid,
                sourceType: fence.intent.sourceType,
                sourceId: fence.intent.sourceId,
                role: fence.intent.role,
                active: true,
                grantedBy: fence.intent.grantedBy,
                grantedAt: new Date('2026-07-11T00:00:00.000Z'),
                note: fence.intent.note,
            });
        }
        this.sources.set(key, next);
    }

    async writeCanonical(pair: AclPair, expected: any) {
        this.fail('canonical');
        const key = keyOf(pair);
        if (expected) this.canonical.set(key, structuredClone(expected));
        else this.canonical.delete(key);
    }

    async writeMirror(pair: AclPair, maintain: boolean) {
        this.fail('mirror');
        const key = `${pair.domainId}:${pair.pid}`;
        const current = this.mirrors.get(key) || new Set<number>();
        if (maintain) current.add(pair.uid);
        else current.delete(pair.uid);
        this.mirrors.set(key, current);
    }

    async mirrorHas(pair: AclPair) {
        this.fail('verify');
        return this.mirrors.get(`${pair.domainId}:${pair.pid}`)?.has(pair.uid) || false;
    }

    async deleteFence(pair: AclPair, requestId: string) {
        this.fail('clearFence');
        const key = keyOf(pair);
        if (this.fences.get(key)?.requestId !== requestId) throw new Error('fence ownership lost');
        this.fences.delete(key);
    }
}

describe('ACL mutation coordinator', () => {
    let repo: MemoryAclRepository;
    let coordinator: ReturnType<typeof createAclCoordinator>;

    beforeEach(() => {
        repo = new MemoryAclRepository();
        coordinator = createAclCoordinator(repo, {
            now: () => new Date('2026-07-11T00:00:00.000Z'),
        });
    });

    it('derives one canonical role with direct > contest maintainer > contest verifier precedence', async () => {
        const pair = { domainId: 'system', pid: 42, uid: 7 };

        await coordinator.mutate({ ...pair, requestId: 'contest-v', sourceType: 'contest', sourceId: 'c1', role: 'verifier', grantedBy: 1 });
        await coordinator.mutate({ ...pair, requestId: 'contest-m', sourceType: 'contest', sourceId: 'c2', role: 'maintainer', grantedBy: 2 });
        expect(repo.canonical.get(keyOf(pair)).role).to.equal('maintainer');

        await coordinator.mutate({ ...pair, requestId: 'direct-v', sourceType: 'direct', sourceId: 'direct', role: 'verifier', grantedBy: 3 });
        expect(repo.canonical.get(keyOf(pair)).role).to.equal('verifier');

        await coordinator.mutate({ ...pair, requestId: 'remove-direct', sourceType: 'direct', sourceId: 'direct', role: null, grantedBy: 3 });
        expect(repo.canonical.get(keyOf(pair)).role).to.equal('maintainer');

        await coordinator.mutate({ ...pair, requestId: 'remove-c2', sourceType: 'contest', sourceId: 'c2', role: null, grantedBy: 2 });
        expect(repo.canonical.get(keyOf(pair)).role).to.equal('verifier');
        expect(repo.sources.get(keyOf(pair))).to.have.lengthOf(1);
    });

    it('passes only the canonical three-field pair to repository queries', async () => {
        const pairMethods = new Set([
            'getCanonical', 'getSources', 'getFence', 'getProblemAclMutationLock',
            'clearProblemAclMutation', 'updateFence', 'writeCanonical', 'writeMirror',
            'mirrorHas', 'deleteFence',
        ]);
        const strictRepo = new Proxy(repo, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (typeof value !== 'function') return value;
                if (!pairMethods.has(String(property))) return value.bind(target);
                return (query: AclPair, ...args: unknown[]) => {
                    expect(Object.keys(query).sort()).to.deep.equal(['domainId', 'pid', 'uid']);
                    return value.call(target, query, ...args);
                };
            },
        });
        const strictCoordinator = createAclCoordinator(strictRepo, {
            now: () => new Date('2026-07-11T00:00:00.000Z'),
        });
        const result = await strictCoordinator.mutate({
            domainId: 'system',
            pid: 77,
            uid: 8,
            requestId: 'strict-pair',
            sourceType: 'direct',
            sourceId: 'direct',
            role: 'verifier',
            grantedBy: 2,
        });
        expect(result?.role).to.equal('verifier');
    });

    it('keeps a deny fence on failure and resumes the same requestId idempotently', async () => {
        const pair = { domainId: 'system', pid: 99, uid: 8 };
        repo.failOnceAt = 'mirror';

        let failure: unknown;
        try {
            await coordinator.mutate({
                ...pair,
                requestId: 'req-99',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                grantedBy: 1,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(AclMutationError);
        expect(repo.fences.get(keyOf(pair))?.requestId).to.equal('req-99');
        expect(repo.fences.get(keyOf(pair))?.completedSteps).to.deep.equal(['source', 'canonical']);
        expect(repo.fences.get(keyOf(pair))?.lastError).to.contain('injected mirror failure');

        const result = await coordinator.mutate({
            ...pair,
            requestId: 'req-99',
            sourceType: 'direct',
            sourceId: 'direct',
            role: 'maintainer',
            grantedBy: 1,
        });

        expect(result.role).to.equal('maintainer');
        expect(repo.fences.has(keyOf(pair))).to.equal(false);
        expect(await repo.mirrorHas(pair)).to.equal(true);
        expect(repo.sources.get(keyOf(pair))).to.have.lengthOf(1);
    });

    it('persists the fence before using one transaction for source, canonical, mirror, and verification', async () => {
        const events: string[] = [];
        const transactional = new MemoryAclRepository() as MemoryAclRepository & {
            withMutationTransaction<T>(work: (tx: AclRepository) => Promise<T>): Promise<T>;
        };
        const baseCreateFence = transactional.createFence.bind(transactional);
        transactional.createFence = async (fence) => {
            events.push('fence');
            await baseCreateFence(fence);
        };
        const baseBeginProblemAclMutation = transactional.beginProblemAclMutation.bind(transactional);
        transactional.beginProblemAclMutation = async (lock) => {
            events.push('lock');
            return baseBeginProblemAclMutation(lock);
        };
        transactional.withMutationTransaction = async <T>(
            work: (tx: AclRepository) => Promise<T>,
        ): Promise<T> => {
            events.push('transaction:start');
            const result = await work(transactional);
            events.push('transaction:commit');
            return result;
        };
        const baseApplySource = transactional.applySource.bind(transactional);
        transactional.applySource = async (fence) => {
            events.push('source');
            await baseApplySource(fence);
        };
        const baseWriteCanonical = transactional.writeCanonical.bind(transactional);
        transactional.writeCanonical = async (pair, expected) => {
            events.push('canonical');
            await baseWriteCanonical(pair, expected);
        };
        const baseWriteMirror = transactional.writeMirror.bind(transactional);
        transactional.writeMirror = async (pair, maintain) => {
            events.push('mirror');
            await baseWriteMirror(pair, maintain);
        };
        const baseDeleteFence = transactional.deleteFence.bind(transactional);
        transactional.deleteFence = async (pair, requestId) => {
            events.push('clearFence');
            await baseDeleteFence(pair, requestId);
        };
        const baseClearProblemAclMutation = transactional.clearProblemAclMutation.bind(transactional);
        transactional.clearProblemAclMutation = async (pair, requestId) => {
            events.push('clearLock');
            await baseClearProblemAclMutation(pair, requestId);
        };

        await createAclCoordinator(transactional).mutate({
            domainId: 'system', pid: 101, uid: 9,
            requestId: 'tx-101', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 1,
        });

        expect(events).to.deep.equal([
            'lock',
            'fence',
            'transaction:start',
            'source',
            'canonical',
            'mirror',
            'transaction:commit',
            'clearFence',
            'clearLock',
        ]);
    });

    for (const step of ['lock', 'fence', 'source', 'canonical', 'mirror', 'verify', 'clearLock', 'clearFence']) {
        it(`fails closed when ${step} fails and resumes safely with the same requestId`, async () => {
            const faultRepo = new MemoryAclRepository();
            const faultCoordinator = createAclCoordinator(faultRepo, {
                now: () => new Date('2026-07-11T00:00:00.000Z'),
            });
            const pair = { domainId: 'system', pid: 200, uid: 20 };
            faultRepo.failOnceAt = step;
            let error: unknown;
            try {
                await faultCoordinator.mutate({
                    ...pair, requestId: `fault-${step}`,
                    sourceType: 'direct', sourceId: 'direct',
                    role: 'maintainer', grantedBy: 1,
                });
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(AclMutationError);
            if (step === 'lock') {
                expect(faultRepo.problemLocks.has(keyOf(pair))).to.equal(false);
                expect(faultRepo.fences.has(keyOf(pair))).to.equal(false);
                expect(faultRepo.sources.has(keyOf(pair))).to.equal(false);
                expect(faultRepo.canonical.has(keyOf(pair))).to.equal(false);
            } else {
                expect(faultRepo.problemLocks.get(keyOf(pair))?.requestId).to.equal(`fault-${step}`);
                if (step !== 'fence' && step !== 'clearLock') {
                    expect(faultRepo.fences.get(keyOf(pair))?.lastError).to.contain(`injected ${step} failure`);
                } else {
                    expect(faultRepo.fences.has(keyOf(pair))).to.equal(false);
                }
                await faultCoordinator.mutate({
                    ...pair, requestId: `fault-${step}`,
                    sourceType: 'direct', sourceId: 'direct',
                    role: 'maintainer', grantedBy: 1,
                });
                expect(faultRepo.fences.has(keyOf(pair))).to.equal(false);
                expect(faultRepo.problemLocks.has(keyOf(pair))).to.equal(false);
                expect(faultRepo.canonical.get(keyOf(pair))?.role).to.equal('maintainer');
                expect(await faultRepo.mirrorHas(pair)).to.equal(true);
            }
        });
    }

    it('rejects a different requestId while retaining the original pair fence', async () => {
        const pair = { domainId: 'system', pid: 300, uid: 30 };
        repo.failOnceAt = 'source';
        await coordinator.mutate({
            ...pair, requestId: 'original', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 1,
        }).catch(() => undefined);

        let error: any;
        try {
            await coordinator.mutate({
                ...pair, requestId: 'intruder', sourceType: 'direct', sourceId: 'direct',
                role: 'verifier', grantedBy: 2,
            });
        } catch (caught) {
            error = caught;
        }

        expect(error?.name).to.equal('AclMutationConflictError');
        expect(error?.status).to.equal(409);
        expect(repo.fences.get(keyOf(pair))?.requestId).to.equal('original');
    });

    it('keeps an orphan problem lock when fence insert fails, resumes same request, and conflicts another request', async () => {
        const pair = { domainId: 'system', pid: 301, uid: 31 };
        repo.failOnceAt = 'fence';
        await coordinator.mutate({
            ...pair, requestId: 'orphan-owner', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 1,
        }).catch(() => undefined);

        expect(repo.problemLocks.get(keyOf(pair))).to.deep.include({
            ...pair,
            requestId: 'orphan-owner',
            intent: {
                action: 'set-source', sourceType: 'direct', sourceId: 'direct',
                role: 'maintainer', grantedBy: 1, note: '',
            },
        });
        expect(repo.problemRevisions.get('system:301')).to.equal(1);
        expect(repo.fences.has(keyOf(pair))).to.equal(false);

        const conflict = await coordinator.mutate({
            ...pair, requestId: 'intruder', sourceType: 'direct', sourceId: 'direct',
            role: 'verifier', grantedBy: 2,
        }).catch((error) => error);
        expect(conflict?.name).to.equal('AclMutationConflictError');
        expect(repo.problemRevisions.get('system:301')).to.equal(1);

        await coordinator.mutate({
            ...pair, requestId: 'orphan-owner', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 1,
        });
        expect(repo.problemLocks.has(keyOf(pair))).to.equal(false);
        expect(repo.fences.has(keyOf(pair))).to.equal(false);
        expect(repo.problemRevisions.get('system:301')).to.equal(1);
    });

    it('binds an ACL target lock to the exact active global write claim', async () => {
        const pair = { domainId: 'system', pid: 302, uid: 32 };
        repo.activeClaims.set('system:302', 'permit-operation');

        const unbound = await coordinator.mutate({
            ...pair, requestId: 'unbound', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 42,
        }).catch((error) => error);
        expect(unbound).to.be.instanceOf(AclMutationError);
        expect(repo.problemLocks.has(keyOf(pair))).to.equal(false);

        await coordinator.mutate({
            ...pair, requestId: 'bound', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 42, writeClaimRequestId: 'permit-operation',
        });
        expect(repo.canonical.get(keyOf(pair))?.role).to.equal('maintainer');

        const mismatchPair = { ...pair, uid: 33 };
        const mismatch = await coordinator.mutate({
            ...mismatchPair, requestId: 'mismatch', sourceType: 'direct', sourceId: 'direct',
            role: 'maintainer', grantedBy: 42, writeClaimRequestId: 'other-operation',
        }).catch((error) => error);
        expect(mismatch).to.be.instanceOf(AclMutationError);
        expect(repo.problemLocks.has(keyOf(mismatchPair))).to.equal(false);
    });
});
