import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { buildVigilContestRoleResolution } from '../src/model/vigil-contest-role';

const Module = require('module');

const contestId = new ObjectId('64a000000000000000000101');
const teamId = new ObjectId('64a000000000000000000102');

function teamDoc() {
    return {
        domainId: 'system',
        contestId,
        teamId,
        captainUid: 10,
        memberUids: [10, 11],
        revision: 7,
        active: true,
    } as any;
}

describe('P1.15 Vigil contest-role contract', () => {
    it('emits the exact captain/member capabilities and a denied non-member role', () => {
        const tdoc = { participationMode: 'team' } as any;
        const captain = buildVigilContestRoleResolution(tdoc, teamDoc(), 10);
        const member = buildVigilContestRoleResolution(tdoc, teamDoc(), 11);
        const denied = buildVigilContestRoleResolution(tdoc, null, 12, 'active_team_required');

        expect(captain).to.deep.equal({
            protocolVersion: 2,
            minClientProtocolVersion: 2,
            participationMode: 'team',
            eligible: true,
            teamId: teamId.toHexString(),
            role: 'captain',
            teamRevision: 7,
            capabilities: {
                canBrowseProblems: true,
                canViewTeamRecords: true,
                canEditCode: true,
                canRun: true,
                canSubmit: true,
                canUseVirtualPrint: true,
                canMinimize: true,
            },
        });
        expect(member.capabilities).to.deep.include({ canEditCode: false, canRun: false, canSubmit: false, canMinimize: false });
        expect(denied).to.deep.include({ eligible: false, role: 'none', reason: 'active_team_required' });
        expect(denied.capabilities).to.deep.include({ canBrowseProblems: false, canSubmit: false });
    });

    it('keeps individual contests on the legacy protocol without team fields', () => {
        expect(buildVigilContestRoleResolution({} as any, null, 10)).to.deep.equal({
            protocolVersion: 1,
            minClientProtocolVersion: 0,
            participationMode: 'individual',
            eligible: true,
            role: 'individual',
        });
    });
});

const sessions: any[] = [];

function same(left: any, right: any): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, expected]: [string, any]) => {
        const actual = doc[key];
        if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
            if ('$in' in expected) return expected.$in.some((value: any) => same(actual, value));
        }
        return same(actual, expected);
    });
}

const clientSessionsColl = {
    async findOne(filter: any) {
        return sessions.find((session) => matches(session, filter)) || null;
    },
    async updateMany(filter: any, update: any) {
        const found = sessions.filter((session) => matches(session, filter));
        for (const session of found) Object.assign(session, update.$set || {});
        return { modifiedCount: found.length };
    },
    find() {
        return { toArray: async () => [] };
    },
    async deleteOne() {
        return { deletedCount: 0 };
    },
};

const helpersPath = require.resolve('../../krypton-vigilguard/src/helpers.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === helpersPath) {
        if (request === './db') return { clientSessionsColl };
        if (request === 'hydrooj/src/model/contest') {
            return { hasParticipantScope: () => false, isClientRequired: () => true };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let vigilSessions: any;
try {
    delete require.cache[helpersPath];
    vigilSessions = require(helpersPath);
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    sessions.length = 0;
});

async function rejectsActiveSession(work: Promise<unknown>) {
    const error: any = await work.catch((caught) => caught);
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include('active captain Vigil session');
}

async function rejectsVirtualPrintSession(work: Promise<unknown>) {
    const error: any = await work.catch((caught) => caught);
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include('virtual-print capability');
}

describe('P1.15 authoritative team client sessions', () => {
    it('accepts only the active captain session bound to the same sid, user, contest and team', async () => {
        const row = {
            sid: 'sid-10',
            domainId: 'system',
            contestId,
            teamId,
            uid: 10,
            active: true,
            participationMode: 'team',
            teamRole: 'captain',
            capabilities: { canSubmit: true },
            expiresAt: new Date(Date.now() + 60_000),
        };
        sessions.push(row);

        expect(await vigilSessions.assertActiveTeamSubmissionSession('sid-10', 'system', contestId, 10, teamId)).to.equal(row);
        row.teamRole = 'member';
        await rejectsActiveSession(vigilSessions.assertActiveTeamSubmissionSession('sid-10', 'system', contestId, 10, teamId));
        row.teamRole = 'captain';
        row.active = false;
        await rejectsActiveSession(vigilSessions.assertActiveTeamSubmissionSession('sid-10', 'system', contestId, 10, teamId));
    });

    it('updates the new captain first and invalidates removed members without a worker', async () => {
        for (const uid of [10, 11, 12]) {
            sessions.push({
                sid: `sid-${uid}`,
                domainId: 'system',
                contestId,
                teamId,
                uid,
                active: true,
                participationMode: 'team',
                teamRole: uid === 10 ? 'captain' : 'member',
                capabilities: { canSubmit: uid === 10 },
                expiresAt: new Date(Date.now() + 60_000),
            });
        }

        const result = await vigilSessions.refreshActiveTeamSessionRoles(
            { domainId: 'system', contestId, teamId, memberUids: [10, 11, 12] },
            { teamId, memberUids: [10, 11], captainUid: 11, revision: 8, active: true },
        );

        expect(result).to.deep.equal({ updated: 2, invalidated: 1 });
        expect(sessions.find((row) => row.uid === 10)).to.deep.include({ active: true, teamRole: 'member', teamRevision: 8 });
        expect(sessions.find((row) => row.uid === 10).capabilities.canSubmit).to.equal(false);
        expect(sessions.find((row) => row.uid === 11)).to.deep.include({ active: true, teamRole: 'captain', teamRevision: 8 });
        expect(sessions.find((row) => row.uid === 11).capabilities.canSubmit).to.equal(true);
        expect(sessions.find((row) => row.uid === 12)).to.deep.include({ active: false, teamRole: 'none', teamRevision: 8 });
    });

    it('derives virtual-print authority and client version only from the active captain session', async () => {
        const row = {
            sid: 'sid-print',
            domainId: 'system',
            contestId,
            teamId,
            uid: 10,
            active: true,
            participationMode: 'team',
            teamRole: 'captain',
            capabilities: { canUseVirtualPrint: true },
            clientVersion: '1.4.0',
            expiresAt: new Date(Date.now() + 60_000),
        };
        sessions.push(row);

        expect(await vigilSessions.assertActiveTeamVirtualPrintSession('sid-print', 'system', contestId, 10, teamId)).to.equal(row);
        row.capabilities.canUseVirtualPrint = false;
        await rejectsVirtualPrintSession(vigilSessions.assertActiveTeamVirtualPrintSession('sid-print', 'system', contestId, 10, teamId));
        row.capabilities.canUseVirtualPrint = true;
        row.clientVersion = '';
        await rejectsVirtualPrintSession(vigilSessions.assertActiveTeamVirtualPrintSession('sid-print', 'system', contestId, 10, teamId));
    });
});
