import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { UserFacingError } from '@hydrooj/framework';
import { ContestTeamConflictError } from 'hydrooj/src/error';

const Module = require('module');

const contestId = new ObjectId('64a000000000000000000101');
const teamId = new ObjectId('64a000000000000000000102');

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

const helpersPath = require.resolve('../src/helpers.ts');
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

function expectCaptainSessionRequired(error: any) {
    expect(error).to.be.instanceOf(ContestTeamConflictError);
    expect(error).to.be.instanceOf(UserFacingError);
    expect(error.code).to.equal(409);
    expect(error.params).to.deep.equal(['active_vigil_captain_session_required']);
}

async function rejectsCaptainSession(work: Promise<unknown>) {
    const error: any = await work.catch((caught) => caught);
    expectCaptainSessionRequired(error);
}

describe('authoritative team client sessions', () => {
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
        await rejectsCaptainSession(vigilSessions.assertActiveTeamSubmissionSession('sid-10', 'system', contestId, 10, teamId));
        row.teamRole = 'captain';
        row.active = false;
        await rejectsCaptainSession(vigilSessions.assertActiveTeamSubmissionSession('sid-10', 'system', contestId, 10, teamId));
    });

    it('rejects team submission without an active captain Vigil session as a recoverable 409', async () => {
        await rejectsCaptainSession(vigilSessions.assertActiveTeamSubmissionSession('', 'system', contestId, 10, teamId));
        await rejectsCaptainSession(vigilSessions.assertActiveTeamSubmissionSession('missing', 'system', contestId, 10, teamId));
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
        await rejectsCaptainSession(vigilSessions.assertActiveTeamVirtualPrintSession('sid-print', 'system', contestId, 10, teamId));
        row.capabilities.canUseVirtualPrint = true;
        row.clientVersion = '';
        await rejectsCaptainSession(vigilSessions.assertActiveTeamVirtualPrintSession('sid-print', 'system', contestId, 10, teamId));
    });
});
