import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { isBrowserLockoutAudience } from '../src/lockout-audience';

const Module = require('module');

function audience(overrides: Partial<Parameters<typeof isBrowserLockoutAudience>[0]> = {}) {
    return {
        participationMode: 'individual' as const,
        hasFinalizedTeamRoster: false,
        isActiveTeamMember: false,
        hasExplicitParticipantScope: false,
        participantScopeMatches: true,
        hasLegacyAssign: false,
        legacyAssignMatches: true,
        hasInviteCode: false,
        attended: false,
        ...overrides,
    };
}

describe('P1.28 browser-lockout audience policy', () => {
    it('locks unrestricted individuals only after canonical attendance', () => {
        expect(isBrowserLockoutAudience(audience())).to.equal(false);
        expect(isBrowserLockoutAudience(audience({ attended: true }))).to.equal(true);
    });

    it('pre-locks matching explicit scope or legacy assign and rejects misses', () => {
        expect(isBrowserLockoutAudience(audience({ hasExplicitParticipantScope: true }))).to.equal(true);
        expect(
            isBrowserLockoutAudience(
                audience({
                    hasExplicitParticipantScope: true,
                    participantScopeMatches: false,
                }),
            ),
        ).to.equal(false);
        expect(isBrowserLockoutAudience(audience({ hasLegacyAssign: true }))).to.equal(true);
        expect(
            isBrowserLockoutAudience(
                audience({
                    hasLegacyAssign: true,
                    legacyAssignMatches: false,
                }),
            ),
        ).to.equal(false);
    });

    it('keeps invite-code contests attendance-gated even with an explicit scope', () => {
        const scopedInvite = audience({
            hasExplicitParticipantScope: true,
            hasInviteCode: true,
        });
        expect(isBrowserLockoutAudience(scopedInvite)).to.equal(false);
        expect(isBrowserLockoutAudience({ ...scopedInvite, attended: true })).to.equal(true);
    });

    it('locks only active members of a finalized team roster', () => {
        const team = audience({ participationMode: 'team' });
        expect(isBrowserLockoutAudience(team)).to.equal(false);
        expect(isBrowserLockoutAudience({ ...team, isActiveTeamMember: true })).to.equal(false);
        expect(
            isBrowserLockoutAudience({
                ...team,
                hasFinalizedTeamRoster: true,
                isActiveTeamMember: true,
            }),
        ).to.equal(true);
        expect(isBrowserLockoutAudience({ ...team, hasFinalizedTeamRoster: true })).to.equal(false);
    });
});

const contestId = new ObjectId('64a000000000000000000701');
const contests: any[] = [];
const attended = new Set<string>();
const legacyGroups = new Map<number, string[]>();
const activeTeamMembers = new Set<number>();
const clientSessions = new Map<string, { uid: number; domainId: string }>();
let contestScanCount = 0;
let beforeStatusReturn: ((attendedAtRead: boolean) => Promise<void>) | null = null;
const originalDateNow = Date.now;
let clockNow = originalDateNow();
Date.now = () => clockNow;

function effectiveLockoutWindow(tdoc: any) {
    return {
        blockStart: tdoc.blockStart ? new Date(tdoc.blockStart) : new Date(Date.now() - 60_000),
        blockEnd: tdoc.blockEnd ? new Date(tdoc.blockEnd) : new Date(Date.now() + 60_000),
    };
}

const contestModel = {
    isInLockoutWindow: (tdoc: any, now: Date = new Date()) => {
        if (tdoc.inWindow === false) return false;
        const window = effectiveLockoutWindow(tdoc);
        return window.blockStart <= now && now < window.blockEnd;
    },
    effectiveLockoutWindow,
    getParticipationMode: (tdoc: any) => (tdoc.participationMode === 'team' ? 'team' : 'individual'),
    isTeamBatchFinalizationPending: (tdoc: any) => tdoc.participationMode === 'team' && !!tdoc.plannedTeamBatchId && !tdoc.teamBatchId,
    hasParticipantScope: (tdoc: any) => tdoc.participantScopeMode === 'schools' || tdoc.participantScopeMode === 'groups',
    getStatus: async (_domainId: string, tid: ObjectId, uid: number) => {
        const attendedAtRead = attended.has(`${tid.toHexString()}:${uid}`);
        const hook = beforeStatusReturn;
        beforeStatusReturn = null;
        if (hook) await hook(attendedAtRead);
        return attendedAtRead ? { attend: 1 } : null;
    },
};

const documentModel = {
    TYPE_CONTEST: 30,
    coll: {
        find() {
            contestScanCount += 1;
            return {
                async *[Symbol.asyncIterator]() {
                    for (const contest of contests) yield contest;
                },
            };
        },
    },
};

const contestTeamModel = {
    getTeamByMember: async (_domainId: string, _tid: ObjectId, uid: number) =>
        activeTeamMembers.has(uid) ? { active: true, memberUids: [uid] } : null,
};

const userModel = {
    listGroup: async (_domainId: string, uid: number) => (legacyGroups.get(uid) || []).map((name) => ({ name })),
};

const lockoutPath = require.resolve('../src/lockout.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === lockoutPath) {
        if (request === 'hydrooj/src/model/builtin') {
            return {
                PERM: { PERM_EDIT_CONTEST: 2 },
                PRIV: { PRIV_EDIT_SYSTEM: 1 },
            };
        }
        if (request === 'hydrooj/src/model/contest') return contestModel;
        if (request === 'hydrooj/src/model/contest-team') return contestTeamModel;
        if (request === 'hydrooj/src/model/document') return documentModel;
        if (request === 'hydrooj/src/model/user') return { __esModule: true, default: userModel };
        if (request === './helpers') {
            return {
                clientSessionKeyFromSession: (session: any) => session?.sid || '',
                currentClientSession: async (sid: string) => clientSessions.get(sid) || null,
                hitsParticipantScope: async (_domainId: string, tdoc: any) => tdoc.scopeMatches !== false,
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let lockout: typeof import('../src/lockout');
try {
    delete require.cache[lockoutPath];
    lockout = require(lockoutPath);
} finally {
    Module._load = originalLoad;
}

function contestDoc(overrides: Record<string, unknown> = {}) {
    return {
        _id: contestId,
        docId: contestId,
        domainId: 'system',
        title: 'Lockout test',
        owner: 2,
        maintainer: [],
        participantScopeMode: 'none',
        assign: [],
        inWindow: true,
        ...overrides,
    } as any;
}

beforeEach(() => {
    clockNow = originalDateNow();
    contests.length = 0;
    attended.clear();
    legacyGroups.clear();
    activeTeamMembers.clear();
    clientSessions.clear();
    contestScanCount = 0;
    beforeStatusReturn = null;
    lockout.invalidateLockoutCache();
});

after(() => {
    Date.now = originalDateNow;
});

describe('P1.28 browser-lockout runtime facts', () => {
    it('keeps an unrestricted nonparticipant online, then locks immediately after exact cache invalidation', async () => {
        contests.push(contestDoc());

        expect(await lockout.getBrowserLockoutDecision('system', 50)).to.equal(null);
        attended.add(`${contestId.toHexString()}:50`);
        expect(await lockout.getBrowserLockoutDecision('system', 50)).to.equal(null);
        expect(contestScanCount).to.equal(1);

        lockout.invalidateLockoutCache('system', 50);
        expect(await lockout.getBrowserLockoutDecision('system', 50)).to.include({
            contestId: contestId.toHexString(),
            title: 'Lockout test',
        });
        expect(contestScanCount).to.equal(2);
    });

    it('does not let an in-flight stale miss repopulate the cache after attendance invalidation', async () => {
        contests.push(contestDoc());
        let releaseStatus!: () => void;
        let statusReadStarted!: () => void;
        const statusRead = new Promise<void>((done) => {
            statusReadStarted = done;
        });
        const release = new Promise<void>((done) => {
            releaseStatus = done;
        });
        beforeStatusReturn = async (attendedAtRead) => {
            expect(attendedAtRead).to.equal(false);
            statusReadStarted();
            await release;
        };

        const pendingDecision = lockout.getBrowserLockoutDecision('system', 63);
        await statusRead;
        attended.add(`${contestId.toHexString()}:63`);
        lockout.invalidateLockoutCache('system', 63);
        releaseStatus();

        expect(await pendingDecision).to.include({
            contestId: contestId.toHexString(),
            title: 'Lockout test',
        });
        expect(contestScanCount).to.equal(2);
    });

    it('pre-locks explicit scope and assign matches but not misses', async () => {
        contests.push(contestDoc({ participantScopeMode: 'schools', scopeMatches: false }));
        expect(await lockout.getBrowserLockoutDecision('system', 51)).to.equal(null);

        contests[0].scopeMatches = true;
        lockout.invalidateLockoutCache('system', 51);
        expect(await lockout.getBrowserLockoutDecision('system', 51)).to.not.equal(null);

        contests[0] = contestDoc({ participantScopeMode: 'groups', scopeMatches: false });
        lockout.invalidateLockoutCache('system', 51);
        expect(await lockout.getBrowserLockoutDecision('system', 51)).to.equal(null);
        contests[0].scopeMatches = true;
        lockout.invalidateLockoutCache('system', 51);
        expect(await lockout.getBrowserLockoutDecision('system', 51)).to.not.equal(null);

        contests[0] = contestDoc({ assign: ['class-a'] });
        lockout.invalidateLockoutCache('system', 52);
        expect(await lockout.getBrowserLockoutDecision('system', 52)).to.equal(null);
        legacyGroups.set(52, ['class-a']);
        lockout.invalidateLockoutCache('system', 52);
        expect(await lockout.getBrowserLockoutDecision('system', 52)).to.not.equal(null);
    });

    it('keeps invite codes attendance-gated and skips contests outside the configured window', async () => {
        contests.push(contestDoc({ _code: 'invite' }));
        expect(await lockout.getBrowserLockoutDecision('system', 53)).to.equal(null);
        attended.add(`${contestId.toHexString()}:53`);
        lockout.invalidateLockoutCache('system', 53);
        expect(await lockout.getBrowserLockoutDecision('system', 53)).to.not.equal(null);

        contests[0].blockStart = clockNow - 120_000;
        contests[0].blockEnd = clockNow;
        lockout.invalidateLockoutCache('system', 53);
        expect(await lockout.getBrowserLockoutDecision('system', 53)).to.equal(null);
    });

    it('expires a cached allow exactly when a matching audience enters the lockout window', async () => {
        const blockStart = clockNow + 1_000;
        contests.push(
            contestDoc({
                participantScopeMode: 'schools',
                scopeMatches: true,
                blockStart,
                blockEnd: blockStart + 60_000,
            }),
        );

        expect(await lockout.getBrowserLockoutDecision('system', 64)).to.equal(null);
        expect(contestScanCount).to.equal(1);

        clockNow = blockStart;
        expect(await lockout.getBrowserLockoutDecision('system', 64)).to.include({
            contestId: contestId.toHexString(),
            title: 'Lockout test',
        });
        expect(contestScanCount).to.equal(2);
    });

    it('expires a cached lock exactly when the lockout window ends', async () => {
        const blockEnd = clockNow + 1_000;
        contests.push(
            contestDoc({
                participantScopeMode: 'schools',
                scopeMatches: true,
                blockStart: clockNow - 60_000,
                blockEnd,
            }),
        );

        expect(await lockout.getBrowserLockoutDecision('system', 65)).to.not.equal(null);
        expect(contestScanCount).to.equal(1);

        clockNow = blockEnd;
        expect(await lockout.getBrowserLockoutDecision('system', 65)).to.equal(null);
        expect(contestScanCount).to.equal(2);
    });

    it('recomputes when an asynchronous audience read crosses the lockout start', async () => {
        const blockStart = clockNow + 1_000;
        contests.push(contestDoc({ blockStart, blockEnd: blockStart + 60_000 }));
        attended.add(`${contestId.toHexString()}:66`);
        let releaseStatus!: () => void;
        let statusReadStarted!: () => void;
        const statusRead = new Promise<void>((done) => {
            statusReadStarted = done;
        });
        const release = new Promise<void>((done) => {
            releaseStatus = done;
        });
        beforeStatusReturn = async (attendedAtRead) => {
            expect(attendedAtRead).to.equal(true);
            statusReadStarted();
            await release;
        };

        const pendingDecision = lockout.getBrowserLockoutDecision('system', 66);
        await statusRead;
        clockNow = blockStart;
        releaseStatus();

        expect(await pendingDecision).to.include({
            contestId: contestId.toHexString(),
            title: 'Lockout test',
        });
        expect(contestScanCount).to.equal(2);
    });

    it('recomputes when an asynchronous audience read crosses the lockout end', async () => {
        const blockEnd = clockNow + 1_000;
        contests.push(contestDoc({ blockStart: clockNow - 60_000, blockEnd }));
        attended.add(`${contestId.toHexString()}:67`);
        let releaseStatus!: () => void;
        let statusReadStarted!: () => void;
        const statusRead = new Promise<void>((done) => {
            statusReadStarted = done;
        });
        const release = new Promise<void>((done) => {
            releaseStatus = done;
        });
        beforeStatusReturn = async (attendedAtRead) => {
            expect(attendedAtRead).to.equal(true);
            statusReadStarted();
            await release;
        };

        const pendingDecision = lockout.getBrowserLockoutDecision('system', 67);
        await statusRead;
        clockNow = blockEnd;
        releaseStatus();

        expect(await pendingDecision).to.equal(null);
        expect(contestScanCount).to.equal(2);
    });

    it('locks finalized active team members only and preserves owner and maintainer bypasses', async () => {
        contests.push(contestDoc({ participationMode: 'team', plannedTeamBatchId: new ObjectId() }));
        activeTeamMembers.add(54);
        expect(await lockout.getBrowserLockoutDecision('system', 54)).to.equal(null);

        delete contests[0].plannedTeamBatchId;
        contests[0].teamBatchId = new ObjectId();
        lockout.invalidateLockoutCache('system', 54);
        expect(await lockout.getBrowserLockoutDecision('system', 54)).to.not.equal(null);

        lockout.invalidateLockoutCache('system', 55);
        expect(await lockout.getBrowserLockoutDecision('system', 55)).to.equal(null);

        contests[0] = contestDoc({ owner: 56, maintainer: [57] });
        attended.add(`${contestId.toHexString()}:56`);
        attended.add(`${contestId.toHexString()}:57`);
        expect(await lockout.getBrowserLockoutDecision('system', 56)).to.equal(null);
        expect(await lockout.getBrowserLockoutDecision('system', 57)).to.equal(null);
    });

    it('recomputes finalized team membership after roster-change domain invalidation', async () => {
        contests.push(contestDoc({ participationMode: 'team', teamBatchId: new ObjectId() }));
        expect(await lockout.getBrowserLockoutDecision('system', 58)).to.equal(null);

        activeTeamMembers.add(58);
        lockout.invalidateLockoutCache('system');
        expect(await lockout.getBrowserLockoutDecision('system', 58)).to.not.equal(null);

        activeTeamMembers.delete(58);
        lockout.invalidateLockoutCache('system');
        expect(await lockout.getBrowserLockoutDecision('system', 58)).to.equal(null);
        expect(contestScanCount).to.equal(3);
    });

    it('keeps system and domain contest-admin middleware bypasses ahead of lockout computation', async () => {
        contests.push(contestDoc());
        let continued = false;
        await lockout.vigilGuardLockoutLayer(
            {
                request: { path: '/record' },
                HydroContext: {
                    user: { _id: 60, hasPriv: () => true, hasPerm: () => false },
                    domain: { _id: 'system' },
                },
            } as any,
            async () => {
                continued = true;
            },
        );
        expect(continued).to.equal(true);
        expect(contestScanCount).to.equal(0);

        continued = false;
        await lockout.vigilGuardLockoutLayer(
            {
                request: { path: '/record' },
                HydroContext: {
                    user: { _id: 61, hasPriv: () => false, hasPerm: () => true },
                    domain: { _id: 'system' },
                },
            } as any,
            async () => {
                continued = true;
            },
        );
        expect(continued).to.equal(true);
        expect(contestScanCount).to.equal(0);
    });

    it('bypasses the active Client session but keeps attendance authoritative after that session exits', async () => {
        contests.push(contestDoc());
        attended.add(`${contestId.toHexString()}:62`);
        clientSessions.set('client-62', { uid: 62, domainId: 'system' });

        expect(await lockout.getBrowserLockoutDecision('system', 62, { sid: 'client-62' })).to.equal(null);
        clientSessions.delete('client-62');
        expect(await lockout.getBrowserLockoutDecision('system', 62)).to.not.equal(null);
    });

    it('wires both Client launch paths and team roster models to cache invalidation', () => {
        const integrationSource = readFileSync(resolve(__dirname, '../../hydrooj/src/handler/vigil-integration.ts'), 'utf8');
        expect(integrationSource.match(/ensureVigilContestParticipation\(this,/g)).to.have.length(2);

        const teamSource = readFileSync(resolve(__dirname, '../../hydrooj/src/model/contest-team.ts'), 'utf8');
        expect(teamSource).to.include('requireVigilLockoutCacheInvalidator');
        expect(teamSource).to.include('invalidateLockoutCache(domainId)');
        const batchSource = readFileSync(resolve(__dirname, '../../hydrooj/src/model/contest-team-batch.ts'), 'utf8');
        expect(batchSource).to.include('contestTeam.requireVigilLockoutCacheInvalidator');

        const userHandler = readFileSync(resolve(__dirname, '../../hydrooj/src/handler/user.ts'), 'utf8');
        expect(userHandler).to.include('udoc.hasPerm(PERM.PERM_EDIT_CONTEST)');
    });
});
