import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import type { AclMutationFence, AclPair, CanonicalPermit, PermitSource } from '../src/coordinator';
import { type AclServiceRepository, createAclService } from '../src/service';

const pairKey = ({ domainId, pid, uid }: AclPair) => `${domainId}:${pid}:${uid}`;

class MemoryServiceRepository implements AclServiceRepository {
    canonical = new Map<string, CanonicalPermit>();
    sources = new Map<string, PermitSource[]>();
    fences = new Map<string, AclMutationFence>();
    mirrors = new Map<string, Set<number>>();
    problemLocks = new Map<string, any>();
    problemWriteClaims = new Map<string, any>();
    missingProblems = new Set<string>();
    mutationCalls = 0;
    failOnceAt: string | null = null;
    failNextClaimRecoveryCas = false;

    private fail(step: string) {
        if (this.failOnceAt === step) {
            this.failOnceAt = null;
            throw new Error(`injected ${step} failure`);
        }
    }

    async getCanonical(pair: AclPair) {
        return this.canonical.get(pairKey(pair)) || null;
    }

    async getSources(pair: AclPair) {
        return (this.sources.get(pairKey(pair)) || []).map((x) => ({ ...x }));
    }

    async getFence(pair: AclPair) {
        return this.fences.get(pairKey(pair)) || null;
    }

    async getProblemAclMutationLock(pair: AclPair) {
        return this.problemLocks.get(pairKey(pair)) || null;
    }

    async beginProblemAclMutation(lock: any) {
        this.fail('lock');
        this.mutationCalls++;
        const problemKey = `${lock.domainId}:${lock.pid}`;
        const claim = this.problemWriteClaims.get(problemKey);
        if (lock.writeClaimRequestId) {
            if (claim?.requestId !== lock.writeClaimRequestId || claim.state !== 'active') {
                throw new Error('bound problem write claim is not active');
            }
        } else if (claim) throw new Error('unbound ACL lock blocked by problem write claim');
        const existing = this.problemLocks.get(pairKey(lock));
        if (existing && existing.requestId !== lock.requestId) throw new Error('problem lock conflict');
        if (!existing) this.problemLocks.set(pairKey(lock), structuredClone(lock));
        return this.problemLocks.get(pairKey(lock));
    }

    async clearProblemAclMutation(pair: AclPair, requestId: string) {
        this.mutationCalls++;
        if (this.problemLocks.get(pairKey(pair))?.requestId !== requestId) throw new Error('problem lock lost');
        this.problemLocks.delete(pairKey(pair));
    }

    async createFence(fence: AclMutationFence) {
        this.mutationCalls++;
        if (this.fences.has(pairKey(fence))) throw Object.assign(new Error('duplicate'), { code: 11000 });
        this.fences.set(pairKey(fence), structuredClone(fence));
    }

    async updateFence(pair: AclPair, requestId: string, patch: Partial<AclMutationFence>) {
        this.mutationCalls++;
        const fence = this.fences.get(pairKey(pair));
        if (!fence || fence.requestId !== requestId) throw new Error('fence ownership lost');
        Object.assign(fence, structuredClone(patch));
    }

    async applySource(fence: AclMutationFence) {
        this.fail('source');
        this.mutationCalls++;
        if (fence.intent.action === 'reconcile') return;
        const key = pairKey(fence);
        const current = this.sources.get(key) || [];
        const next = current.filter((source) => source.sourceType !== fence.intent.sourceType || source.sourceId !== fence.intent.sourceId);
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

    async writeCanonical(pair: AclPair, expected: CanonicalPermit | null) {
        this.mutationCalls++;
        if (expected) this.canonical.set(pairKey(pair), structuredClone(expected));
        else this.canonical.delete(pairKey(pair));
    }

    async writeMirror(pair: AclPair, maintain: boolean) {
        this.mutationCalls++;
        const key = `${pair.domainId}:${pair.pid}`;
        const mirror = this.mirrors.get(key) || new Set<number>();
        if (maintain) mirror.add(pair.uid);
        else mirror.delete(pair.uid);
        this.mirrors.set(key, mirror);
    }

    async mirrorHas(pair: AclPair) {
        return this.mirrors.get(`${pair.domainId}:${pair.pid}`)?.has(pair.uid) || false;
    }

    async deleteFence(pair: AclPair, requestId: string) {
        this.fail('clearFence');
        this.mutationCalls++;
        if (this.fences.get(pairKey(pair))?.requestId !== requestId) throw new Error('fence ownership lost');
        this.fences.delete(pairKey(pair));
    }

    async listSourcesForProblem(domainId: string, pid: number) {
        return [...this.sources.values()].flat().filter((x) => x.domainId === domainId && x.pid === pid);
    }

    async listSourcesForContest(domainId: string, sourceId: string, uid?: number) {
        return [...this.sources.values()]
            .flat()
            .filter((x) => x.domainId === domainId && x.sourceType === 'contest' && x.sourceId === sourceId && (uid === undefined || x.uid === uid));
    }

    async listCanonicalForUser(domainId: string, uid: number) {
        return [...this.canonical.values()].filter((x) => x.domainId === domainId && x.uid === uid && x.active);
    }

    async listFencesForUser(domainId: string, uid: number) {
        return [...this.fences.values()].filter((x) => x.domainId === domainId && x.uid === uid);
    }

    async listProblemAclMutationLocksForUser(domainId: string, uid: number) {
        return [...this.problemLocks.values()].filter((lock) => lock.domainId === domainId && lock.uid === uid);
    }

    async listFencesForDomain(domainId: string) {
        return [...this.fences.values()].filter((fence) => fence.domainId === domainId);
    }

    async listProblemAclMutationLocksForDomain(domainId: string) {
        return [...this.problemLocks.values()].filter((lock) => lock.domainId === domainId);
    }

    async listProblemAclMutationLocksForProblem(domainId: string, pid: number) {
        return [...this.problemLocks.values()].filter((lock) => lock.domainId === domainId && lock.pid === pid);
    }

    async listProblemWriteClaimsForDomain(domainId: string) {
        return [...this.problemWriteClaims.values()].filter((claim) => claim.domainId === domainId);
    }

    async problemExists(domainId: string, pid: number) {
        return !this.missingProblems.has(`${domainId}:${pid}`);
    }

    async getProblemWriteClaim(domainId: string, pid: number) {
        return this.problemWriteClaims.get(`${domainId}:${pid}`) || null;
    }

    async reactivateErroredProblemWriteClaim(domainId: string, pid: number, requestId: string) {
        const claim = this.problemWriteClaims.get(`${domainId}:${pid}`);
        if (claim?.requestId !== requestId || claim.state !== 'error') return false;
        claim.state = 'active';
        claim.updatedAt = new Date('2026-07-11T00:00:00.000Z');
        return true;
    }

    async markProblemWriteClaimRepairError(domainId: string, pid: number, requestId: string, error: unknown) {
        if (this.failNextClaimRecoveryCas) {
            this.failNextClaimRecoveryCas = false;
            return false;
        }
        const claim = this.problemWriteClaims.get(`${domainId}:${pid}`);
        if (claim?.requestId !== requestId || claim.state !== 'active') return false;
        claim.state = 'error';
        claim.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        claim.updatedAt = new Date('2026-07-11T00:00:00.000Z');
        return true;
    }

    async clearActiveProblemWriteClaim(domainId: string, pid: number, requestId: string) {
        const key = `${domainId}:${pid}`;
        const claim = this.problemWriteClaims.get(key);
        if (claim?.requestId !== requestId || claim.state !== 'active') return false;
        if ([...this.problemLocks.values()].some((lock) => lock.domainId === domainId && lock.pid === pid)) {
            return false;
        }
        this.problemWriteClaims.delete(key);
        return true;
    }

    async listCanonicalForDomain(domainId: string) {
        return [...this.canonical.values()].filter((x) => x.domainId === domainId);
    }

    async listCanonicalForContest(domainId: string, sourceId: string, uid?: number) {
        return [...this.canonical.values()].filter(
            (x) => x.domainId === domainId && x.active === true && x.viaContest === sourceId && (uid === undefined || x.uid === uid),
        );
    }

    async listSourcesForDomain(domainId: string) {
        return [...this.sources.values()].flat().filter((x) => x.domainId === domainId);
    }

    async listProblemMirrorsForDomain(domainId: string) {
        return [...this.mirrors.entries()]
            .filter(([key]) => key.startsWith(`${domainId}:`))
            .map(([key, uids]) => ({
                domainId,
                pid: Number(key.slice(domainId.length + 1)),
                maintainer: [...uids],
            }));
    }

    async listCanonicalForProblem(domainId: string, pid: number) {
        return [...this.canonical.values()].filter((x) => x.domainId === domainId && x.pid === pid);
    }

    async listFencesForProblem(domainId: string, pid: number) {
        return [...this.fences.values()].filter((x) => x.domainId === domainId && x.pid === pid);
    }

    async getProblemMirror(domainId: string, pid: number) {
        return [...(this.mirrors.get(`${domainId}:${pid}`) || new Set<number>())];
    }
}

describe('ACL service', () => {
    let repo: MemoryServiceRepository;
    let service: ReturnType<typeof createAclService>;

    beforeEach(() => {
        repo = new MemoryServiceRepository();
        service = createAclService(repo, { now: () => new Date('2026-07-11T00:00:00.000Z') });
    });

    async function expectClaimBoundDedicatedRepairsFailClosed(options: {
        pid: number;
        markerClaimRequestId: string;
        currentClaim?: { requestId: string; state: 'active' | 'error' };
        message: string;
    }) {
        if (options.currentClaim) {
            repo.problemWriteClaims.set(`system:${options.pid}`, {
                domainId: 'system',
                pid: options.pid,
                requestId: options.currentClaim.requestId,
                actor: 1,
                operation: 'permit-update',
                state: options.currentClaim.state,
                lastError: options.currentClaim.state === 'error' ? 'crashed' : null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }
        const entries = [
            { kind: 'orphan' as const, uid: options.pid * 10 },
            { kind: 'fence' as const, uid: options.pid * 10 + 1 },
        ];
        await Promise.all(
            entries.map(async (entry) => {
                const pair = { domainId: 'system', pid: options.pid, uid: entry.uid };
                const marker = {
                    ...pair,
                    requestId: `acl-${options.pid}-${entry.kind}`,
                    from: null,
                    to: 'maintainer' as const,
                    intent: {
                        action: 'set-source' as const,
                        sourceType: 'direct' as const,
                        sourceId: 'direct',
                        role: 'maintainer' as const,
                        grantedBy: 1,
                        note: '',
                    },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    writeClaimRequestId: options.markerClaimRequestId,
                };
                if (entry.kind === 'orphan') repo.problemLocks.set(pairKey(pair), marker);
                else repo.fences.set(pairKey(pair), { ...marker, completedSteps: [], lastError: 'crashed' });
                const mutationsBefore = repo.mutationCalls;

                const error = await (
                    entry.kind === 'orphan'
                        ? service.repairOrphanProblemLock(pair, marker.requestId)
                        : service.repairFenceWithoutProblemLock(pair, marker.requestId)
                ).catch((caught: Error) => caught);

                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.contain(options.message);
                expect(repo.mutationCalls).to.equal(mutationsBefore);
                if (entry.kind === 'orphan') {
                    expect(repo.problemLocks.get(pairKey(pair))?.requestId).to.equal(marker.requestId);
                    expect(repo.fences.has(pairKey(pair))).to.equal(false);
                } else {
                    expect(repo.fences.get(pairKey(pair))?.requestId).to.equal(marker.requestId);
                    expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
                }
            }),
        );
    }

    it('publishing clears every verifier source while preserving direct and contest maintainers', async () => {
        await service.grantDirect('system', 1, 10, 'maintainer', 1, 'd-m');
        await service.grantContest('system', 1, 20, 'maintainer', 1, 'c1', 'c-m');
        await service.grantContest('system', 1, 30, 'verifier', 1, 'c1', 'c-v');
        await service.grantContest('system', 1, 40, 'maintainer', 1, 'c2', 'c2-m');
        await service.grantDirect('system', 1, 40, 'verifier', 1, 'd-v');
        const staleVerifier = { domainId: 'system', pid: 1, uid: 35 };
        repo.canonical.set(pairKey(staleVerifier), {
            ...staleVerifier,
            role: 'verifier',
            active: true,
            grantedBy: 1,
            grantedAt: new Date(),
            viaContest: null,
            note: 'stale-without-source',
        });
        repo.mirrors.set('system:1', new Set([10, 20, 35]));

        const removed = await service.clearVerifiersForProblem('system', 1, 'publish-1', 1);

        expect(removed).to.equal(2);
        expect((await repo.getCanonical({ domainId: 'system', pid: 1, uid: 10 }))?.role).to.equal('maintainer');
        expect((await repo.getCanonical({ domainId: 'system', pid: 1, uid: 20 }))?.role).to.equal('maintainer');
        expect(await repo.getCanonical({ domainId: 'system', pid: 1, uid: 30 })).to.equal(null);
        expect(await repo.getCanonical(staleVerifier)).to.equal(null);
        expect(await repo.mirrorHas(staleVerifier)).to.equal(false);
        expect((await repo.getCanonical({ domainId: 'system', pid: 1, uid: 40 }))?.role).to.equal('maintainer');
        expect(await repo.mirrorHas({ domainId: 'system', pid: 1, uid: 40 })).to.equal(true);
    });

    it('removing one contest source never removes another contest or direct grant', async () => {
        await service.grantContest('system', 2, 50, 'verifier', 1, 'c1', 'c1');
        await service.grantContest('system', 2, 50, 'maintainer', 1, 'c2', 'c2');
        await service.grantDirect('system', 3, 50, 'verifier', 1, 'direct');
        await service.grantContest('system', 3, 50, 'maintainer', 1, 'c1', 'c1-p3');
        const staleContestPair = { domainId: 'system', pid: 8, uid: 50 };
        repo.canonical.set(pairKey(staleContestPair), {
            ...staleContestPair,
            role: 'verifier',
            active: true,
            grantedBy: 1,
            grantedAt: new Date(),
            viaContest: 'c1',
            note: 'legacy-contest-canonical',
        });

        const removed = await service.revokeContestUser('system', 'c1', 50, 'remove-c1', 1);

        expect(removed).to.equal(2);
        expect((await repo.getCanonical({ domainId: 'system', pid: 2, uid: 50 }))?.role).to.equal('maintainer');
        expect((await repo.getCanonical({ domainId: 'system', pid: 3, uid: 50 }))?.role).to.equal('verifier');
        expect(await repo.getCanonical(staleContestPair)).to.equal(null);
        expect(await repo.listSourcesForContest('system', 'c2', 50)).to.have.lengthOf(1);
    });

    it('batch revoke clears all sources for each requested pair without crossing domains', async () => {
        await service.grantDirect('system', 4, 60, 'maintainer', 1, 's4');
        await service.grantContest('system', 4, 60, 'verifier', 1, 'c1', 's4c');
        await service.grantDirect('system', 5, 60, 'verifier', 1, 's5');
        await service.grantDirect('other', 4, 60, 'maintainer', 1, 'other');
        const stalePair = { domainId: 'system', pid: 6, uid: 60 };
        repo.canonical.set(pairKey(stalePair), {
            ...stalePair,
            role: 'maintainer',
            active: true,
            grantedBy: 1,
            grantedAt: new Date(),
            viaContest: null,
            note: 'stale',
        });
        repo.mirrors.set('system:6', new Set([60]));

        const removed = await service.revokePairs(
            'system',
            [
                { pid: 4, uid: 60 },
                { pid: 5, uid: 60 },
                { pid: 6, uid: 60 },
            ],
            'batch-r',
            1,
        );

        expect(removed).to.equal(3);
        expect(await repo.getCanonical({ domainId: 'system', pid: 4, uid: 60 })).to.equal(null);
        expect(await repo.getCanonical({ domainId: 'system', pid: 5, uid: 60 })).to.equal(null);
        expect(await repo.getCanonical(stalePair)).to.equal(null);
        expect(await repo.mirrorHas(stalePair)).to.equal(false);
        expect((await repo.getCanonical({ domainId: 'other', pid: 4, uid: 60 }))?.role).to.equal('maintainer');
    });

    it('contest sync reconciles the complete pid/user matrix without touching direct sources', async () => {
        await service.grantContest('system', 30, 50, 'verifier', 1, 'c-sync', 'existing-50');
        await service.grantContest('system', 30, 51, 'maintainer', 1, 'c-sync', 'existing-51');
        await service.grantContest('system', 30, 52, 'verifier', 1, 'c-sync', 'removed-user');
        await service.grantContest('system', 29, 50, 'verifier', 1, 'c-sync', 'removed-pid');
        await service.grantDirect('system', 29, 50, 'maintainer', 1, 'direct-survives');

        await service.syncContestPids(
            'system',
            'c-sync',
            [29, 30],
            [30, 31],
            [
                { uid: 50, role: 'verifier' },
                { uid: 51, role: 'maintainer' },
                { uid: 53, role: 'verifier' },
            ],
            1,
            'sync-full-matrix',
        );

        const contestSources = await repo.listSourcesForContest('system', 'c-sync');
        expect(contestSources.map((source) => `${source.pid}:${source.uid}:${source.role}`).sort()).to.deep.equal([
            '30:50:verifier',
            '30:51:maintainer',
            '30:53:verifier',
            '31:50:verifier',
            '31:51:maintainer',
            '31:53:verifier',
        ]);
        expect((await repo.getCanonical({ domainId: 'system', pid: 29, uid: 50 }))?.role).to.equal('maintainer');
    });

    it('preload excludes fenced pairs and separates maintained from all permitted pids', async () => {
        await service.grantDirect('system', 6, 70, 'maintainer', 1, 'p6');
        await service.grantDirect('system', 7, 70, 'verifier', 1, 'p7');
        repo.fences.set(pairKey({ domainId: 'system', pid: 6, uid: 70 }), {
            domainId: 'system',
            pid: 6,
            uid: 70,
            requestId: 'stuck',
            from: 'maintainer',
            to: null,
            intent: { sourceType: 'direct', sourceId: 'direct', role: null, grantedBy: 1, note: '' },
            completedSteps: [],
            lastError: 'stuck',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const loaded = await service.loadUserAcl('system', 70);

        expect([...loaded.permitPids]).to.deep.equal([7]);
        expect([...loaded.maintainedPids]).to.deep.equal([]);
        expect([...loaded.fencedPids]).to.deep.equal([6]);
    });

    it('preload denies an orphan ProblemDoc lock even when fence insertion never completed', async () => {
        await service.grantDirect('system', 8, 80, 'maintainer', 1, 'p8');
        repo.problemLocks.set(pairKey({ domainId: 'system', pid: 8, uid: 80 }), {
            domainId: 'system',
            pid: 8,
            uid: 80,
            requestId: 'orphan-lock',
            from: 'maintainer',
            to: 'verifier',
            intent: {
                action: 'set-source',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'verifier',
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const loaded = await service.loadUserAcl('system', 80);

        expect([...loaded.permitPids]).to.deep.equal([]);
        expect([...loaded.maintainedPids]).to.deep.equal([]);
        expect([...loaded.fencedPids]).to.deep.equal([8]);
    });

    it('reports orphan ProblemDoc locks, fence/lock mismatches, and active/error write claims read-only', async () => {
        const orphan = {
            domainId: 'system',
            pid: 40,
            uid: 400,
            requestId: 'orphan-40',
            from: null,
            to: 'maintainer' as const,
            intent: {
                action: 'set-source' as const,
                sourceType: 'direct' as const,
                sourceId: 'direct',
                role: 'maintainer' as const,
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        repo.problemLocks.set(pairKey(orphan), orphan);
        const fenceOnly = {
            domainId: 'system',
            pid: 41,
            uid: 410,
            requestId: 'fence-41',
            from: 'verifier' as const,
            to: null,
            intent: {
                action: 'set-source' as const,
                sourceType: 'direct' as const,
                sourceId: 'direct',
                role: null,
                grantedBy: 1,
                note: '',
            },
            completedSteps: [],
            lastError: 'stuck',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        repo.fences.set(pairKey(fenceOnly), fenceOnly);
        repo.problemWriteClaims.set('system:42', {
            domainId: 'system',
            pid: 42,
            requestId: 'claim-active',
            actor: 1,
            operation: 'files-upload',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.problemWriteClaims.set('system:43', {
            domainId: 'system',
            pid: 43,
            requestId: 'claim-error',
            actor: 1,
            operation: 'metadata-edit',
            state: 'error',
            lastError: 'failed',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.mutationCalls = 0;

        const report = await service.buildDriftReport('system');

        expect(report.orphanProblemLocks.map((lock) => lock.requestId)).to.deep.equal(['orphan-40']);
        expect(
            report.fenceProblemLockMismatches.map((row) => ({
                pid: row.pid,
                reasons: row.reasons,
            })),
        ).to.deep.equal([{ pid: 41, reasons: ['missing-problem-lock'] }]);
        expect(
            report.aclMutationFences.map((row) => ({
                pid: row.pid,
                problemLock: row.problemLock,
            })),
        ).to.deep.equal([{ pid: 41, problemLock: null }]);
        expect(report.problemWriteClaims.map((claim) => [claim.pid, claim.requestId, claim.state])).to.deep.equal([
            [42, 'claim-active', 'active'],
            [43, 'claim-error', 'error'],
        ]);
        expect(repo.mutationCalls).to.equal(0);
    });

    it('repairs an orphan lock only with its exact original request and resumes failures idempotently', async () => {
        const pair = { domainId: 'system', pid: 44, uid: 440 };
        repo.problemLocks.set(pairKey(pair), {
            ...pair,
            requestId: 'orphan-44',
            from: null,
            to: 'maintainer',
            intent: {
                action: 'set-source',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const conflict = await service.repairOrphanProblemLock(pair, 'other-request').catch((error) => error);
        expect(conflict.message).to.contain('requestId mismatch');
        expect(repo.problemLocks.get(pairKey(pair))?.requestId).to.equal('orphan-44');

        repo.failOnceAt = 'source';
        const first = await service.repairOrphanProblemLock(pair, 'orphan-44').catch((error) => error);
        expect(first.message).to.contain('injected source failure');
        expect(repo.problemLocks.get(pairKey(pair))?.requestId).to.equal('orphan-44');
        expect(repo.fences.get(pairKey(pair))?.requestId).to.equal('orphan-44');

        const repaired = await service.repairOrphanProblemLock(pair, 'orphan-44');
        expect(repaired?.role).to.equal('maintainer');
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
        expect(repo.fences.has(pairKey(pair))).to.equal(false);
    });

    it('refuses orphan-lock repair when the ProblemDoc disappeared and preserves the marker', async () => {
        const pair = { domainId: 'system', pid: 45, uid: 450 };
        repo.problemLocks.set(pairKey(pair), {
            ...pair,
            requestId: 'orphan-45',
            from: null,
            to: null,
            intent: {
                action: 'reconcile',
                sourceType: 'direct',
                sourceId: 'direct',
                role: null,
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.missingProblems.add('system:45');

        const error = await service.repairOrphanProblemLock(pair, 'orphan-45').catch((caught) => caught);

        expect(error.message).to.equal('problem system/45 does not exist');
        expect(repo.problemLocks.get(pairKey(pair))?.requestId).to.equal('orphan-45');
    });

    it('repairs a fence without a ProblemDoc lock only with its exact requestId', async () => {
        const pair = { domainId: 'system', pid: 50, uid: 500 };
        repo.fences.set(pairKey(pair), {
            ...pair,
            requestId: 'fence-50',
            from: null,
            to: 'maintainer',
            intent: {
                action: 'set-source',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                grantedBy: 1,
                note: '',
            },
            completedSteps: [],
            lastError: 'clear-order crash',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const wrong = await service.repairFenceWithoutProblemLock(pair, 'other-request').catch((error) => error);
        expect(wrong.message).to.contain('requestId mismatch');
        expect(repo.fences.get(pairKey(pair))?.requestId).to.equal('fence-50');

        const repaired = await service.repairFenceWithoutProblemLock(pair, 'fence-50');
        expect(repaired?.role).to.equal('maintainer');
        expect(repo.fences.has(pairKey(pair))).to.equal(false);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
    });

    it('routes an ERROR-claim-bound fence through problem-write-claim repair', async () => {
        const pair = { domainId: 'system', pid: 51, uid: 510 };
        repo.problemWriteClaims.set('system:51', {
            domainId: 'system',
            pid: 51,
            requestId: 'claim-51',
            actor: 1,
            operation: 'permit-update',
            state: 'error',
            lastError: 'failed',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.fences.set(pairKey(pair), {
            ...pair,
            requestId: 'fence-51',
            from: null,
            to: 'maintainer',
            intent: {
                action: 'set-source',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                grantedBy: 1,
                note: '',
            },
            completedSteps: [],
            lastError: 'failed',
            createdAt: new Date(),
            updatedAt: new Date(),
            writeClaimRequestId: 'claim-51',
        });

        const error = await service.repairFenceWithoutProblemLock(pair, 'fence-51').catch((caught) => caught);

        expect(error.message).to.contain('use problem-write-claim repair');
        expect(repo.fences.get(pairKey(pair))?.requestId).to.equal('fence-51');
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
    });

    it('keeps dedicated repair entrypoints behind the ACTIVE problem-write-claim confirmation flow', async () => {
        await expectClaimBoundDedicatedRepairsFailClosed({
            pid: 60,
            markerClaimRequestId: 'claim-60',
            currentClaim: { requestId: 'claim-60', state: 'active' },
            message: 'ACTIVE problem write claim claim-60',
        });
    });

    it('routes both dedicated repair entrypoints through ERROR problem-write-claim repair', async () => {
        await expectClaimBoundDedicatedRepairsFailClosed({
            pid: 61,
            markerClaimRequestId: 'claim-61',
            currentClaim: { requestId: 'claim-61', state: 'error' },
            message: 'use problem-write-claim repair',
        });
    });

    it('rejects dedicated repair entrypoints when the marker belongs to another claim', async () => {
        await expectClaimBoundDedicatedRepairsFailClosed({
            pid: 62,
            markerClaimRequestId: 'claim-62-marker',
            currentClaim: { requestId: 'claim-62-current', state: 'active' },
            message: 'binding does not match the current problem write claim',
        });
    });

    it('rejects dedicated repair entrypoints when their bound claim is missing', async () => {
        await expectClaimBoundDedicatedRepairsFailClosed({
            pid: 63,
            markerClaimRequestId: 'claim-63-missing',
            message: 'binding does not match the current problem write claim',
        });
    });

    it('converges both fence-only and lock-only markers before a global write claim', async () => {
        const fencePair = { domainId: 'system', pid: 52, uid: 520 };
        const lockPair = { domainId: 'system', pid: 52, uid: 521 };
        const marker = (pair: AclPair, requestId: string) => ({
            ...pair,
            requestId,
            from: null,
            to: 'maintainer' as const,
            intent: {
                action: 'set-source' as const,
                sourceType: 'direct' as const,
                sourceId: 'direct',
                role: 'maintainer' as const,
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.fences.set(pairKey(fencePair), {
            ...marker(fencePair, 'fence-52'),
            completedSteps: [],
            lastError: 'stuck',
        });
        repo.problemLocks.set(pairKey(lockPair), marker(lockPair, 'lock-52'));

        await service.prepareProblemWriteClaim('system', 52);

        expect(repo.fences.size).to.equal(0);
        expect(repo.problemLocks.size).to.equal(0);
        expect(repo.canonical.get(pairKey(fencePair))?.role).to.equal('maintainer');
        expect(repo.canonical.get(pairKey(lockPair))?.role).to.equal('maintainer');
    });

    it('does not touch ACL markers while another global write claim exists', async () => {
        const pair = { domainId: 'system', pid: 53, uid: 530 };
        repo.problemWriteClaims.set('system:53', {
            domainId: 'system',
            pid: 53,
            requestId: 'claim-53',
            actor: 1,
            operation: 'metadata-edit',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.fences.set(pairKey(pair), {
            ...pair,
            requestId: 'fence-53',
            from: null,
            to: null,
            intent: {
                action: 'reconcile',
                sourceType: 'direct',
                sourceId: 'direct',
                role: null,
                grantedBy: 1,
                note: '',
            },
            completedSteps: [],
            lastError: 'stuck',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const error = await service.prepareProblemWriteClaim('system', 53).catch((caught) => caught);

        expect(error.message).to.contain('already has active write claim claim-53');
        expect(repo.fences.get(pairKey(pair))?.requestId).to.equal('fence-53');
        expect(repo.mutationCalls).to.equal(0);
    });

    it('reactivates an exact ERROR write claim, converges its bound fence, then clears the claim', async () => {
        const claim = {
            domainId: 'system',
            pid: 46,
            requestId: 'claim-46',
            actor: 1,
            operation: 'permit-update',
            state: 'error',
            lastError: 'outer failed',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        repo.problemWriteClaims.set('system:46', claim);
        const pair = { domainId: 'system', pid: 46, uid: 460 };
        repo.fences.set(pairKey(pair), {
            ...pair,
            requestId: 'acl-46',
            from: 'maintainer',
            to: 'maintainer',
            intent: {
                action: 'reconcile',
                sourceType: 'direct',
                sourceId: 'direct',
                role: null,
                grantedBy: 1,
                note: '',
            },
            completedSteps: ['source', 'canonical', 'mirror', 'verify'],
            lastError: 'clearFence failed',
            createdAt: new Date(),
            updatedAt: new Date(),
            writeClaimRequestId: 'claim-46',
        });

        await service.repairErroredProblemWriteClaim('system', 46, 'claim-46');

        expect(repo.problemWriteClaims.has('system:46')).to.equal(false);
        expect(repo.fences.has(pairKey(pair))).to.equal(false);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
    });

    it('refuses ACTIVE write-claim recovery without both the exact requestId and process-quiesced confirmation', async () => {
        repo.problemWriteClaims.set('system:54', {
            domainId: 'system',
            pid: 54,
            requestId: 'claim-54',
            actor: 1,
            operation: 'files-upload',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const missingConfirmation = await service
            .recoverActiveProblemWriteClaim('system', 54, 'claim-54', 'PARTIAL_WRITE_INSPECTED')
            .catch((error: Error) => error);
        expect((missingConfirmation as Error).message).to.contain('PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED');
        expect(repo.problemWriteClaims.get('system:54')?.state).to.equal('active');

        const wrongRequest = await service
            .recoverActiveProblemWriteClaim('system', 54, 'other-claim', 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED')
            .catch((error: Error) => error);
        expect((wrongRequest as Error).message).to.contain('requestId mismatch');
        expect(repo.problemWriteClaims.get('system:54')?.requestId).to.equal('claim-54');
        expect(repo.problemWriteClaims.get('system:54')?.state).to.equal('active');
    });

    it('recovers a crash-left ACTIVE write claim through ERROR repair and leaves the problem writable', async () => {
        repo.problemWriteClaims.set('system:55', {
            domainId: 'system',
            pid: 55,
            requestId: 'claim-55',
            actor: 1,
            operation: 'permit-update',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.failOnceAt = 'source';
        const failedMutation = await service.grantDirect('system', 55, 550, 'maintainer', 1, 'acl-55', '', 'claim-55').catch((error) => error);
        expect(failedMutation.message).to.contain('injected source failure');
        expect(repo.fences.get('system:55:550')?.writeClaimRequestId).to.equal('claim-55');
        expect(repo.problemLocks.get('system:55:550')?.writeClaimRequestId).to.equal('claim-55');

        await service.recoverActiveProblemWriteClaim('system', 55, 'claim-55', 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED');

        expect(repo.problemWriteClaims.has('system:55')).to.equal(false);
        expect(repo.fences.has('system:55:550')).to.equal(false);
        expect(repo.problemLocks.has('system:55:550')).to.equal(false);
        expect(repo.canonical.get('system:55:550')?.role).to.equal('maintainer');
        await service.prepareProblemWriteClaim('system', 55);
    });

    it('keeps the recovered claim in ERROR when an ACL marker belongs to another claim', async () => {
        const pair = { domainId: 'system', pid: 56, uid: 560 };
        repo.problemWriteClaims.set('system:56', {
            domainId: 'system',
            pid: 56,
            requestId: 'claim-56',
            actor: 1,
            operation: 'permit-update',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const marker = {
            ...pair,
            requestId: 'acl-56',
            from: null,
            to: 'maintainer' as const,
            intent: {
                action: 'set-source' as const,
                sourceType: 'direct' as const,
                sourceId: 'direct',
                role: 'maintainer' as const,
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            writeClaimRequestId: 'different-claim',
        };
        repo.problemLocks.set(pairKey(pair), marker);
        repo.fences.set(pairKey(pair), {
            ...marker,
            completedSteps: [],
            lastError: 'crashed',
        });

        const error = await service
            .recoverActiveProblemWriteClaim('system', 56, 'claim-56', 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED')
            .catch((caught: Error) => caught);

        expect((error as Error).message).to.contain('not bound to write claim claim-56');
        expect(repo.problemWriteClaims.get('system:56')?.state).to.equal('error');
        expect(repo.fences.has(pairKey(pair))).to.equal(true);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(true);
    });

    it('fails closed when the ACTIVE-to-ERROR recovery CAS loses a race', async () => {
        repo.problemWriteClaims.set('system:57', {
            domainId: 'system',
            pid: 57,
            requestId: 'claim-57',
            actor: 1,
            operation: 'metadata-edit',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.failNextClaimRecoveryCas = true;

        const error = await service
            .recoverActiveProblemWriteClaim('system', 57, 'claim-57', 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED')
            .catch((caught: Error) => caught);

        expect((error as Error).message).to.contain('changed before exact ACTIVE recovery');
        expect(repo.problemWriteClaims.get('system:57')?.state).to.equal('active');
    });

    it('never clears an active/wrong claim and restores ERROR when bound ACL resume fails', async () => {
        repo.problemWriteClaims.set('system:49', {
            domainId: 'system',
            pid: 49,
            requestId: 'claim-49',
            actor: 1,
            operation: 'metadata-edit',
            state: 'error',
            lastError: 'failed',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const wrong = await service.repairErroredProblemWriteClaim('system', 49, 'other-claim').catch((error) => error);
        expect((wrong as Error).message).to.contain('requestId mismatch');
        expect(repo.problemWriteClaims.get('system:49')?.state).to.equal('error');

        repo.problemWriteClaims.set('system:47', {
            domainId: 'system',
            pid: 47,
            requestId: 'claim-47',
            actor: 1,
            operation: 'permit-update',
            state: 'active',
            lastError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const active = await service.repairErroredProblemWriteClaim('system', 47, 'claim-47').catch((error) => error);
        expect(active.message).to.contain('active and cannot be operator-cleared');
        expect(repo.problemWriteClaims.get('system:47')?.state).to.equal('active');

        const pair = { domainId: 'system', pid: 48, uid: 480 };
        repo.problemWriteClaims.set('system:48', {
            domainId: 'system',
            pid: 48,
            requestId: 'claim-48',
            actor: 1,
            operation: 'permit-update',
            state: 'error',
            lastError: 'outer failed',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        repo.problemLocks.set(pairKey(pair), {
            ...pair,
            requestId: 'acl-48',
            from: null,
            to: 'maintainer',
            intent: {
                action: 'set-source',
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            writeClaimRequestId: 'claim-48',
        });
        repo.failOnceAt = 'source';

        const failed = await service.repairErroredProblemWriteClaim('system', 48, 'claim-48').catch((error) => error);
        expect(failed.message).to.contain('injected source failure');
        expect(repo.problemWriteClaims.get('system:48')?.state).to.equal('error');
        expect(repo.problemWriteClaims.get('system:48')?.lastError).to.contain('injected source failure');
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(true);

        await service.repairErroredProblemWriteClaim('system', 48, 'claim-48');
        expect(repo.problemWriteClaims.has('system:48')).to.equal(false);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(false);
        expect(repo.fences.has(pairKey(pair))).to.equal(false);
    });

    it('reports three legacy drift categories plus source/canonical conflicts read-only', async () => {
        await service.grantDirect('system', 10, 100, 'maintainer', 1, 'ok');
        await service.grantDirect('system', 10, 102, 'verifier', 1, 'verifier');
        await service.grantDirect('system', 11, 110, 'maintainer', 1, 'missing-mirror');
        repo.mirrors.get('system:11')!.delete(110);
        repo.mirrors.set('system:10', new Set([100, 101, 102]));

        const conflictPair = { domainId: 'system', pid: 12, uid: 120 };
        repo.sources.set(pairKey(conflictPair), [
            {
                ...conflictPair,
                sourceType: 'direct',
                sourceId: 'direct',
                role: 'maintainer',
                active: true,
                grantedBy: 1,
                grantedAt: new Date(),
                note: '',
            },
        ]);
        repo.canonical.set(pairKey(conflictPair), {
            ...conflictPair,
            role: 'verifier',
            active: true,
            grantedBy: 1,
            grantedAt: new Date(),
            viaContest: null,
            note: '',
        });

        const report = await service.buildDriftReport('system');

        expect(report.legacyMaintainerWithoutCanonical).to.deep.include.members([
            { domainId: 'system', pid: 10, uid: 101 },
            { domainId: 'system', pid: 10, uid: 102 },
        ]);
        expect(report.canonicalMaintainerWithoutLegacy).to.deep.equal([{ domainId: 'system', pid: 11, uid: 110 }]);
        expect(report.verifierInLegacy).to.deep.equal([{ domainId: 'system', pid: 10, uid: 102 }]);
        expect(
            report.sourceCanonicalConflicts.map((x) => ({
                domainId: x.domainId,
                pid: x.pid,
                uid: x.uid,
                expected: x.expected?.role || null,
                actual: x.actual?.role || null,
            })),
        ).to.deep.equal([{ domainId: 'system', pid: 12, uid: 120, expected: 'maintainer', actual: 'verifier' }]);

        // Repairs are explicit, pair-scoped coordinator operations; the report
        // itself never performs them.
        await service.grantDirect('system', 10, 101, 'maintainer', 1, 'repair-legacy-101');
        await service.reconcilePair({ domainId: 'system', pid: 10, uid: 102 }, 'repair-verifier-102', 1);
        await service.reconcilePair({ domainId: 'system', pid: 11, uid: 110 }, 'repair-mirror-110', 1);
        await service.reconcilePair(conflictPair, 'repair-conflict-120', 1);
        const repaired = await service.buildDriftReport('system');
        expect(repaired.legacyMaintainerWithoutCanonical).to.deep.equal([]);
        expect(repaired.canonicalMaintainerWithoutLegacy).to.deep.equal([]);
        expect(repaired.verifierInLegacy).to.deep.equal([]);
        expect(repaired.sourceCanonicalConflicts).to.deep.equal([]);
    });

    it('reports every uncleared fence and repairs an exact unbound ACL mutation to zero drift', async () => {
        const pair = { domainId: 'system', pid: 58, uid: 580 };
        repo.failOnceAt = 'clearFence';
        const failed = await service.grantDirect(pair.domainId, pair.pid, pair.uid, 'maintainer', 1, 'acl-58').catch((error) => error);
        expect(failed.message).to.contain('injected clearFence failure');
        expect((await repo.getSources(pair))[0]?.role).to.equal('maintainer');
        expect(repo.canonical.get(pairKey(pair))?.role).to.equal('maintainer');
        expect(await repo.mirrorHas(pair)).to.equal(true);

        const report = await service.buildDriftReport('system');
        expect(report).to.have.property('aclMutationFences');
        expect(
            report.aclMutationFences.map((fence) => ({
                fenceRequestId: fence.requestId,
                problemLockRequestId: fence.problemLock?.requestId || null,
            })),
        ).to.deep.equal([
            {
                fenceRequestId: 'acl-58',
                problemLockRequestId: 'acl-58',
            },
        ]);
        expect(report.fenceProblemLockMismatches).to.deep.equal([]);

        const wrong = await service.repairAclMutation(pair, 'other-request').catch((error: Error) => error);
        expect((wrong as Error).message).to.contain('requestId mismatch');
        expect(repo.fences.has(pairKey(pair))).to.equal(true);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(true);

        await service.repairAclMutation(pair, 'acl-58');
        const repaired = await service.buildDriftReport('system');
        expect(repaired.aclMutationFences).to.deep.equal([]);
        expect(repaired.orphanProblemLocks).to.deep.equal([]);
        expect(repaired.fenceProblemLockMismatches).to.deep.equal([]);
    });

    it('routes an ERROR-claim-bound ACL mutation to exact problem-write-claim repair', async () => {
        const pair = { domainId: 'system', pid: 59, uid: 590 };
        repo.problemWriteClaims.set('system:59', {
            domainId: 'system',
            pid: 59,
            requestId: 'claim-59',
            actor: 1,
            operation: 'permit-update',
            state: 'error',
            lastError: 'crashed',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const marker = {
            ...pair,
            requestId: 'acl-59',
            from: null,
            to: 'maintainer' as const,
            intent: {
                action: 'set-source' as const,
                sourceType: 'direct' as const,
                sourceId: 'direct',
                role: 'maintainer' as const,
                grantedBy: 1,
                note: '',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            writeClaimRequestId: 'claim-59',
        };
        repo.problemLocks.set(pairKey(pair), marker);
        repo.fences.set(pairKey(pair), {
            ...marker,
            completedSteps: [],
            lastError: 'crashed',
        });
        const mutationsBefore = repo.mutationCalls;

        const error = await service.repairAclMutation(pair, 'acl-59').catch((caught: Error) => caught);

        expect((error as Error).message).to.contain('use problem-write-claim repair');
        expect(repo.problemWriteClaims.get('system:59')?.state).to.equal('error');
        expect(repo.fences.has(pairKey(pair))).to.equal(true);
        expect(repo.problemLocks.has(pairKey(pair))).to.equal(true);
        expect(repo.mutationCalls).to.equal(mutationsBefore);
    });

    it('explicitly reports source-less legacy canonical rows without mutating ACL data', async () => {
        const direct = { domainId: 'system', pid: 13, uid: 130 };
        const contest = { domainId: 'system', pid: 14, uid: 140 };
        repo.canonical.set(pairKey(direct), {
            ...direct,
            role: 'maintainer',
            active: true,
            grantedBy: 7,
            grantedAt: new Date('2025-01-01T00:00:00.000Z'),
            viaContest: null,
            note: 'direct-old',
        });
        repo.canonical.set(pairKey(contest), {
            ...contest,
            role: 'verifier',
            active: true,
            grantedBy: 8,
            grantedAt: new Date('2025-02-01T00:00:00.000Z'),
            viaContest: 'contest-old',
            note: 'contest-old',
        });
        repo.mutationCalls = 0;

        const loaded = await service.loadUserAcl('system', 130);
        const report = await service.buildDriftReport('system');

        expect([...loaded.maintainedPids]).to.deep.equal([13]);
        expect(report.legacyCanonicalWithoutSource).to.deep.equal([
            {
                ...direct,
                role: 'maintainer',
                sourceType: 'direct',
                sourceId: 'direct',
            },
            {
                ...contest,
                role: 'verifier',
                sourceType: 'contest',
                sourceId: 'contest-old',
            },
        ]);
        expect(repo.mutationCalls).to.equal(0);
    });

    it('repairs legacy canonical rows into provenance-faithful direct or contest sources', async () => {
        const direct = { domainId: 'system', pid: 15, uid: 150 };
        const contest = { domainId: 'system', pid: 16, uid: 160 };
        repo.canonical.set(pairKey(direct), {
            ...direct,
            role: 'verifier',
            active: true,
            grantedBy: 17,
            grantedAt: new Date('2025-03-01T00:00:00.000Z'),
            viaContest: null,
            note: 'direct-old',
        });
        repo.canonical.set(pairKey(contest), {
            ...contest,
            role: 'maintainer',
            active: true,
            grantedBy: 18,
            grantedAt: new Date('2025-04-01T00:00:00.000Z'),
            viaContest: 'contest-preserve',
            note: 'contest-old',
        });

        await service.repairLegacyCanonicalWithoutSource(direct, 'repair-direct', 999);
        await service.repairLegacyCanonicalWithoutSource(contest, 'repair-contest', 999);

        expect((await repo.getSources(direct))[0]).to.deep.include({
            ...direct,
            sourceType: 'direct',
            sourceId: 'direct',
            role: 'verifier',
            active: true,
            grantedBy: 17,
            note: 'direct-old',
        });
        expect((await repo.getSources(contest))[0]).to.deep.include({
            ...contest,
            sourceType: 'contest',
            sourceId: 'contest-preserve',
            role: 'maintainer',
            active: true,
            grantedBy: 18,
            note: 'contest-old',
        });
        expect((await repo.getCanonical(contest))?.viaContest).to.equal('contest-preserve');
        expect((await service.buildDriftReport('system')).legacyCanonicalWithoutSource).to.deep.equal([]);
    });

    it('hard delete cleanup resumes fences and clears source, canonical, and legacy-only ACL state', async () => {
        await service.grantDirect('system', 20, 200, 'maintainer', 1, 'normal');
        const stalePair = { domainId: 'system', pid: 20, uid: 201 };
        repo.canonical.set(pairKey(stalePair), {
            ...stalePair,
            role: 'maintainer',
            active: true,
            grantedBy: 1,
            grantedAt: new Date(),
            viaContest: null,
            note: '',
        });
        repo.mirrors.set('system:20', new Set([200, 201, 202]));
        const fencedPair = { domainId: 'system', pid: 20, uid: 203 };
        repo.fences.set(pairKey(fencedPair), {
            ...fencedPair,
            requestId: 'interrupted-grant',
            from: null,
            to: 'verifier',
            intent: { sourceType: 'contest', sourceId: 'c9', role: 'verifier', grantedBy: 1, note: '' },
            completedSteps: [],
            lastError: 'process stopped',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        await service.grantDirect('other', 20, 200, 'maintainer', 1, 'other-domain');

        await service.clearForProblem('system', 20, 'hard-delete-20', 1);

        expect(await repo.listSourcesForProblem('system', 20)).to.have.lengthOf(0);
        expect(await repo.listCanonicalForProblem('system', 20)).to.have.lengthOf(0);
        expect(await repo.listFencesForProblem('system', 20)).to.have.lengthOf(0);
        expect(await repo.getProblemMirror('system', 20)).to.deep.equal([]);
        expect((await repo.getCanonical({ domainId: 'other', pid: 20, uid: 200 }))?.role).to.equal('maintainer');
    });
});
