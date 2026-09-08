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
const clientSessions = new Map<string, { uid: number; domainId: string; contestId: ObjectId }>();
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

function clientRequestContext(
    path: string,
    options: {
        method?: string;
        query?: Record<string, string>;
        json?: boolean;
        hasPriv?: boolean;
        hasPerm?: boolean;
        domainId?: string;
    } = {},
) {
    const redirects: string[] = [];
    const method = options.method || 'GET';
    const response = { status: null as number | null, template: null as string | null, body: {}, redirect: null as string | null };
    const context = {
        request: { path, method, query: options.query || {} },
        query: options.query || {},
        session: { sid: 'client-62', uid: 62 },
        HydroContext: {
            request: { path, method: method.toLowerCase(), json: options.json === true },
            response,
            user: { _id: 62, hasPriv: () => options.hasPriv === true, hasPerm: () => options.hasPerm === true },
            domain: { _id: options.domainId || 'system' },
        },
        redirect: (target: string) => redirects.push(target),
    } as any;
    const handler = {
        context,
        request: context.HydroContext.request,
        response,
        session: context.session,
        user: context.HydroContext.user,
        domain: context.HydroContext.domain,
    } as any;
    return { context, handler, redirects, response };
}

async function runClientRequest(request: ReturnType<typeof clientRequestContext>, onAllowed?: () => void | Promise<void>) {
    let handlerReached = false;
    let businessLogicRan = false;
    let control: string | undefined;
    await lockout.vigilGuardLockoutLayer(request.context, async () => {
        handlerReached = true;
        control = lockout.enforceBoundClientHandler(request.handler);
        if (!control) {
            businessLogicRan = true;
            await onAllowed?.();
        }
    });
    return { handlerReached, businessLogicRan, control };
}

function ordinaryBrowserRequestContext(
    path: string,
    options: {
        method?: string;
        query?: Record<string, string>;
        json?: boolean;
        uid?: number;
        domainId?: string;
        hasPriv?: boolean;
        hasPerm?: boolean;
    } = {},
) {
    const redirects: string[] = [];
    const method = options.method || 'GET';
    const uid = options.uid ?? 70;
    const context = {
        request: { path, method, query: options.query || {} },
        query: options.query || {},
        session: { uid },
        status: null as number | null,
        HydroContext: {
            request: { path, method: method.toLowerCase(), json: options.json === true },
            user: { _id: uid, hasPriv: () => options.hasPriv === true, hasPerm: () => options.hasPerm === true },
            domain: { _id: options.domainId || 'system' },
        },
        redirect: (target: string) => redirects.push(target),
    } as any;
    return { context, redirects };
}

async function runOrdinaryBrowserRequest(request: ReturnType<typeof ordinaryBrowserRequestContext>) {
    let continued = false;
    await lockout.vigilGuardLockoutLayer(request.context, async () => {
        continued = true;
    });
    return { continued };
}

const collectRequestId = '64a000000000000000000aaa';
const COLLECT_LOCKOUT_REQUESTS: Array<{ path: string; method?: string; query?: Record<string, string>; json?: boolean }> = [
    { path: '/collect' },
    { path: '/collect', method: 'POST' },
    { path: '/admin/collect' },
    { path: '/admin/collect', method: 'POST' },
    { path: '/api/collect/pending' },
    { path: '/api/collect/pending', method: 'POST' },
    { path: `/collect/${collectRequestId}`, method: 'POST' },
];

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

    it('confines an active Client session to its bound exam workspace', async () => {
        contests.push(contestDoc());
        attended.add(`${contestId.toHexString()}:62`);
        clientSessions.set('client-62', { uid: 62, domainId: 'system', contestId });

        const allowed = clientRequestContext(`/exam-mode/${contestId.toHexString()}/discussion`);
        expect(await runClientRequest(allowed)).to.deep.equal({ handlerReached: true, businessLogicRan: true, control: undefined });
        expect(allowed.redirects).to.deep.equal([]);

        const escaped = clientRequestContext('/');
        expect(await runClientRequest(escaped)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(escaped.response).to.include({ status: 302, redirect: `/d/system/exam-mode/${contestId.toHexString()}` });
        expect(escaped.context.session.uid).to.equal(62);

        const operatorEscape = clientRequestContext('/record', { hasPriv: true, hasPerm: true });
        expect(await runClientRequest(operatorEscape)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(operatorEscape.response.redirect).to.equal(`/d/system/exam-mode/${contestId.toHexString()}`);

        const otherDomainEscape = clientRequestContext('/d/another/', { domainId: 'another' });
        expect(await runClientRequest(otherDomainEscape)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(otherDomainEscape.response.redirect).to.equal(`/d/system/exam-mode/${contestId.toHexString()}`);

        const samePathInOtherDomain = clientRequestContext(`/exam-mode/${contestId.toHexString()}`, { domainId: 'another' });
        expect(await runClientRequest(samePathInOtherDomain)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(samePathInOtherDomain.response.redirect).to.equal(`/d/system/exam-mode/${contestId.toHexString()}`);

        clientSessions.delete('client-62');
        expect(await lockout.getBrowserLockoutDecision('system', 62)).to.not.equal(null);
    });

    it('keeps only contest-bound support endpoints available to the active Client session', async () => {
        clientSessions.set('client-62', { uid: 62, domainId: 'system', contestId });
        const tid = contestId.toHexString();
        const allowed = [
            clientRequestContext(`/paper/${tid}/draft/100`, { method: 'PATCH' }),
            clientRequestContext('/p/100/submit', { method: 'POST', query: { tid }, json: true }),
            clientRequestContext('/p/100/file/diagram.png', { query: { tid } }),
            clientRequestContext('/record/64a000000000000000000777', { query: { tid }, json: true }),
            clientRequestContext('/record', { query: { tid, pid: '100', uidOrName: '62' }, json: true }),
        ];
        for (const request of allowed) {
            expect(await runClientRequest(request)).to.deep.equal({ handlerReached: true, businessLogicRan: true, control: undefined });
            expect(request.response.redirect).to.equal(null);
        }

        const wrongContest = clientRequestContext('/p/100/submit', {
            method: 'POST',
            query: { tid: new ObjectId().toHexString() },
            json: true,
        });
        expect(await runClientRequest(wrongContest)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(wrongContest.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);

        const htmlRecord = clientRequestContext('/record/64a000000000000000000777', { query: { tid } });
        expect(await runClientRequest(htmlRecord)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(htmlRecord.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);

        const htmlRecordList = clientRequestContext('/record', { query: { tid, uidOrName: '62' } });
        expect(await runClientRequest(htmlRecordList)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(htmlRecordList.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);

        const recordListMissingTid = clientRequestContext('/record', { query: { uidOrName: '62' }, json: true });
        expect(await runClientRequest(recordListMissingTid)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(recordListMissingTid.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);

        const recordListWrongContest = clientRequestContext('/record', {
            query: { tid: new ObjectId().toHexString(), uidOrName: '62' },
            json: true,
        });
        expect(await runClientRequest(recordListWrongContest)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
        expect(recordListWrongContest.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);

        for (const path of ['/logout', '/bind', '/claim', '/oauth/authorize', '/client-required-notice']) {
            const recoveryEscape = clientRequestContext(path);
            expect(await runClientRequest(recoveryEscape)).to.deep.equal({ handlerReached: true, businessLogicRan: false, control: 'cleanup' });
            expect(recoveryEscape.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);
        }
    });

    it('contains plain form validation errors inside the exam shell without hiding JSON errors', async () => {
        clientSessions.set('client-62', { uid: 62, domainId: 'system', contestId });
        const tid = contestId.toHexString();
        const htmlForm = clientRequestContext(`/exam-mode/${tid}/discussion/create`, { method: 'POST' });
        await runClientRequest(htmlForm, async () => {
            htmlForm.response.status = 400;
            htmlForm.response.template = 'error.html';
            htmlForm.response.body = { error: { message: '字段 content 验证失败。' } };
        });
        expect(htmlForm.response).to.include({
            status: 302,
            template: null,
            redirect: `/d/system/exam-mode/${tid}/discussion/create`,
        });

        const jsonForm = clientRequestContext(`/exam-mode/${tid}/discussion/create`, { method: 'POST', json: true });
        await runClientRequest(jsonForm, async () => {
            jsonForm.response.status = 400;
            jsonForm.response.template = 'error.html';
            jsonForm.response.body = { error: { message: '字段 content 验证失败。' } };
        });
        expect(jsonForm.response).to.include({ status: 400, template: 'error.html', redirect: null });
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
        const pluginSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
        expect(pluginSource).to.include("ctx.on('handler/before-prepare', enforceBoundClientHandler)");
    });
});

describe('P2.9 file-collect lockout isolation', () => {
    it('does not mention /collect in the lockout allowlists', () => {
        const lockoutSource = readFileSync(resolve(__dirname, '../src/lockout.ts'), 'utf8');
        expect(lockoutSource).to.not.include('/collect');
    });

    it('treats collect paths as unbound Client requests and redirects to the exam workspace', async () => {
        clientSessions.set('client-62', { uid: 62, domainId: 'system', contestId });
        const tid = contestId.toHexString();
        const denied = [
            ...COLLECT_LOCKOUT_REQUESTS.map((spec) =>
                clientRequestContext(spec.path, { method: spec.method, query: spec.query, json: spec.json }),
            ),
            clientRequestContext('/collect', { query: { tid } }),
            clientRequestContext('/admin/collect', { query: { tid } }),
            clientRequestContext('/api/collect/pending', { query: { tid }, json: true }),
            clientRequestContext(`/collect/${collectRequestId}`, { method: 'POST', query: { tid }, json: true }),
            clientRequestContext('/d/system/collect'),
            clientRequestContext('/d/system/admin/collect'),
            clientRequestContext('/d/system/api/collect/pending', { json: true }),
            clientRequestContext(`/d/system/collect/${collectRequestId}`, { method: 'POST', query: { tid } }),
            clientRequestContext('/collect', { hasPriv: true, hasPerm: true }),
        ];
        for (const request of denied) {
            expect(await runClientRequest(request)).to.deep.equal({
                handlerReached: true,
                businessLogicRan: false,
                control: 'cleanup',
            });
            expect(request.response.redirect).to.equal(`/d/system/exam-mode/${tid}`);
            expect(request.context.session.uid).to.equal(62);
        }
    });

    it('drops ordinary-browser collect requests to the lockout notice', async () => {
        contests.push(contestDoc());
        attended.add(`${contestId.toHexString()}:70`);
        const notice = `/client-required-notice?tid=${contestId.toHexString()}`;
        const denied = [
            ...COLLECT_LOCKOUT_REQUESTS,
            { path: '/d/system/collect' },
            { path: '/d/system/admin/collect' },
            { path: '/d/system/api/collect/pending' },
            { path: `/d/system/collect/${collectRequestId}`, method: 'POST' as const },
        ];
        for (const spec of denied) {
            const request = ordinaryBrowserRequestContext(spec.path, {
                method: spec.method,
                query: spec.query,
                json: spec.json,
                uid: 70,
            });
            expect(await runOrdinaryBrowserRequest(request)).to.deep.equal({ continued: false });
            expect(request.context.status).to.equal(302);
            expect(request.redirects).to.deep.equal([notice]);
            expect(request.context.session.uid).to.equal(0);
        }

        const recovery = ordinaryBrowserRequestContext('/login', { uid: 70 });
        expect(await runOrdinaryBrowserRequest(recovery)).to.deep.equal({ continued: true });
        expect(recovery.redirects).to.deep.equal([]);
        expect(recovery.context.session.uid).to.equal(70);
        expect(recovery.context.status).to.equal(null);
    });
});
