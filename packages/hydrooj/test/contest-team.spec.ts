import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
    getParticipationMode,
    normalizeParticipationConfig,
    planParticipationModeTransition,
    teamModeClearConfirmation,
} from '../src/model/contest-participation';

const Module = require('module');
(global as any).Hydro = { model: {} };

class TestValidationError extends Error {}
class TestConflictError extends Error {
    status = 409;
}
class TestPermissionError extends Error {
    status = 403;
}
class TestNotAssignedError extends Error {}
class TestUserNotFoundError extends Error {}

const PERM = { PERM_EDIT_CONTEST: 1n, PERM_EDIT_CONTEST_SELF: 2n, PERM_VIEW_CONTEST: 4n, PERM_ATTEND_CONTEST: 8n };
const PRIV = { PRIV_EDIT_SYSTEM: 1 };
const docs: any[] = [];
const invites: any[] = [];
const audit: any[] = [];
const events: any[] = [];
const indexes: any[] = [];
const users = new Map<number, any>();
const userReads = new Map<number, number>();
let revokeAfterFirstRead: number | null = null;
let currentContest: any;
let failNextInviteUpdateOne = false;
let failNextInviteUpdateMany = false;
let teamCasBarrierRemaining = 0;
let releaseTeamCasBarrier: (() => void) | null = null;
let teamCasBarrier = Promise.resolve();

function armTeamCasBarrier(participants: number) {
    teamCasBarrierRemaining = participants;
    teamCasBarrier = new Promise<void>((resolve) => {
        releaseTeamCasBarrier = resolve;
    });
}

async function waitAtTeamCasBarrier(filter: any, update: any) {
    if (!teamCasBarrierRemaining || filter.revision === undefined || !update.$set?.memberUids) return;
    teamCasBarrierRemaining -= 1;
    if (teamCasBarrierRemaining === 0) releaseTeamCasBarrier?.();
    else await teamCasBarrier;
}

function same(left: any, right: any): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, value]: any) => {
        const actual = doc[key];
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !Array.isArray(value)) {
            if ('$in' in value) {
                const expected = value.$in;
                return Array.isArray(actual)
                    ? actual.some((entry) => expected.some((item: any) => same(entry, item)))
                    : expected.some((item: any) => same(actual, item));
            }
            if ('$ne' in value) return !same(actual, value.$ne);
        }
        if (Array.isArray(actual) && !Array.isArray(value)) return actual.some((entry) => same(entry, value));
        return same(actual, value);
    });
}

function duplicateFor(candidate: any, ignore?: any) {
    const active = docs.filter(
        (doc) => doc !== ignore && doc.active && doc.domainId === candidate.domainId && same(doc.contestId, candidate.contestId),
    );
    if (active.some((doc) => doc.nameKey === candidate.nameKey)) {
        throw Object.assign(new Error('duplicate name'), { code: 11000, keyPattern: { domainId: 1, contestId: 1, nameKey: 1 } });
    }
    if (active.some((doc) => doc.memberUids.some((uid: number) => candidate.memberUids.includes(uid)))) {
        throw Object.assign(new Error('duplicate member'), { code: 11000, keyPattern: { domainId: 1, contestId: 1, memberUids: 1 } });
    }
}

const teamCollection = {
    async insertOne(doc: any) {
        duplicateFor(doc);
        docs.push(doc);
        return { insertedId: doc._id };
    },
    async findOne(filter: any) {
        return docs.find((doc) => matches(doc, filter)) || null;
    },
    async findOneAndUpdate(filter: any, update: any) {
        await waitAtTeamCasBarrier(filter, update);
        const doc = docs.find((candidate) => matches(candidate, filter));
        if (!doc) return null;
        const next = { ...doc, ...(update.$set || {}), revision: doc.revision + Number(update.$inc?.revision || 0) };
        duplicateFor(next, doc);
        Object.assign(doc, next);
        return doc;
    },
    async updateOne(filter: any, update: any) {
        const doc = docs.find((candidate) => matches(candidate, filter));
        if (!doc) return { modifiedCount: 0 };
        Object.assign(doc, update.$set || {});
        doc.revision += Number(update.$inc?.revision || 0);
        return { modifiedCount: 1 };
    },
    async updateMany(filter: any, update: any) {
        const found = docs.filter((candidate) => matches(candidate, filter));
        for (const doc of found) {
            Object.assign(doc, update.$set || {});
            doc.revision += Number(update.$inc?.revision || 0);
        }
        return { modifiedCount: found.length };
    },
    async deleteMany(filter: any) {
        const found = docs.filter((candidate) => matches(candidate, filter));
        for (const doc of found) docs.splice(docs.indexOf(doc), 1);
        return { deletedCount: found.length };
    },
    async countDocuments(filter: any) {
        return docs.filter((doc) => matches(doc, filter)).length;
    },
    find(filter: any) {
        return {
            sort() {
                return {
                    async toArray() {
                        return docs.filter((doc) => matches(doc, filter));
                    },
                };
            },
        };
    },
};

function duplicateInvite(candidate: any, ignore?: any) {
    if (candidate.status !== 'pending') return;
    const duplicate = invites.find(
        (invite) =>
            invite !== ignore &&
            invite.status === 'pending' &&
            invite.domainId === candidate.domainId &&
            same(invite.contestId, candidate.contestId) &&
            same(invite.teamId, candidate.teamId) &&
            invite.inviteeUid === candidate.inviteeUid,
    );
    if (duplicate) {
        throw Object.assign(new Error('duplicate invite'), {
            code: 11000,
            keyPattern: { domainId: 1, contestId: 1, teamId: 1, inviteeUid: 1 },
        });
    }
}

function applyUpdate(doc: any, update: any) {
    Object.assign(doc, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete doc[key];
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] += Number(value);
}

const inviteCollection = {
    async insertOne(doc: any) {
        duplicateInvite(doc);
        invites.push(doc);
        return { insertedId: doc._id };
    },
    async findOne(filter: any) {
        return invites.find((doc) => matches(doc, filter)) || null;
    },
    async findOneAndUpdate(filter: any, update: any) {
        const doc = invites.find((candidate) => matches(candidate, filter));
        if (!doc) return null;
        const next = { ...doc };
        applyUpdate(next, update);
        duplicateInvite(next, doc);
        applyUpdate(doc, update);
        return doc;
    },
    async updateOne(filter: any, update: any) {
        if (failNextInviteUpdateOne) {
            failNextInviteUpdateOne = false;
            throw new Error('injected invite updateOne failure');
        }
        const doc = invites.find((candidate) => matches(candidate, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(doc, update);
        return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter: any, update: any) {
        if (failNextInviteUpdateMany) {
            failNextInviteUpdateMany = false;
            throw new Error('injected invite updateMany failure');
        }
        const found = invites.filter((candidate) => matches(candidate, filter));
        for (const doc of found) applyUpdate(doc, update);
        return { matchedCount: found.length, modifiedCount: found.length };
    },
    async deleteMany(filter: any) {
        const found = invites.filter((candidate) => matches(candidate, filter));
        for (const doc of found) invites.splice(invites.indexOf(doc), 1);
        return { deletedCount: found.length };
    },
    async countDocuments(filter: any) {
        return invites.filter((doc) => matches(doc, filter)).length;
    },
    find(filter: any) {
        return {
            sort() {
                return {
                    async toArray() {
                        return invites.filter((doc) => matches(doc, filter));
                    },
                };
            },
        };
    },
};

const contestStub = {
    async get() {
        return currentContest;
    },
    getParticipationMode(tdoc: any) {
        return tdoc.participationMode === 'team' ? 'team' : 'individual';
    },
    hasParticipantScope(tdoc: any) {
        return tdoc.participantScopeMode === 'schools' || tdoc.participantScopeMode === 'groups';
    },
    async getStatus() {
        return { attend: 1 };
    },
};

const userModelStub = {
    async getById(_domainId: string, uid: number) {
        const result = users.get(uid) || null;
        const reads = (userReads.get(uid) || 0) + 1;
        userReads.set(uid, reads);
        if (uid === revokeAfterFirstRead && reads === 1) users.delete(uid);
        return result;
    },
    async listGroup() {
        return [];
    },
};

const dbStub = {
    collection(name: string) {
        if (name === 'contest.teams') return teamCollection;
        if (name === 'contest.teamInvites') return inviteCollection;
        throw new Error(`unexpected collection ${name}`);
    },
};

const modulePath = require.resolve('../src/model/contest-team.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === '../error') {
            return {
                ContestTeamConflictError: TestConflictError,
                NotAssignedError: TestNotAssignedError,
                PermissionError: TestPermissionError,
                UserNotFoundError: TestUserNotFoundError,
                ValidationError: TestValidationError,
            };
        }
        if (request === '../service/bus') return { __esModule: true, default: { broadcast: async (...args: any[]) => events.push(args) } };
        if (request === '../service/db') return { __esModule: true, default: dbStub };
        if (request === './builtin') return { PERM, PRIV };
        if (request === './contest') return contestStub;
        if (request === './oplog') return { add: async (entry: any) => audit.push(entry) };
        if (request === './user') return { __esModule: true, default: userModelStub };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let teamModel: typeof import('../src/model/contest-team');
try {
    delete require.cache[modulePath];
    teamModel = require(modulePath);
} finally {
    Module._load = originalLoad;
}

function actor(uid: number, admin = false) {
    return {
        _id: uid,
        own: () => admin,
        hasPerm: (permission: bigint) => admin && permission === PERM.PERM_EDIT_CONTEST,
        hasPriv: (privilege: number) => admin && privilege === PRIV.PRIV_EDIT_SYSTEM,
    } as any;
}

function ownerWithoutSelfEdit(uid: number) {
    return {
        _id: uid,
        own: (_doc: any, permission?: bigint) => permission === undefined,
        hasPerm: () => false,
        hasPriv: () => false,
    } as any;
}

async function rejects(work: Promise<unknown>, errorType: new (...args: any[]) => Error) {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(errorType);
        return error as Error;
    }
    expect.fail('expected promise to reject');
}

beforeEach(() => {
    docs.length = 0;
    invites.length = 0;
    audit.length = 0;
    events.length = 0;
    indexes.length = 0;
    users.clear();
    userReads.clear();
    revokeAfterFirstRead = null;
    failNextInviteUpdateOne = false;
    failNextInviteUpdateMany = false;
    teamCasBarrierRemaining = 0;
    releaseTeamCasBarrier = null;
    teamCasBarrier = Promise.resolve();
    for (const uid of [10, 11, 12, 13, 99]) users.set(uid, { _id: uid, hasPerm: () => true });
    currentContest = {
        domainId: 'system',
        docId: new ObjectId('64a000000000000000000001'),
        owner: 99,
        rule: 'acm',
        participationMode: 'team',
        participationRevision: 1,
        beginAt: new Date('2099-01-01T00:00:00Z'),
        endAt: new Date('2099-01-01T05:00:00Z'),
    };
});

describe('P1.11 contest participation policy', () => {
    it('keeps missing mode individual and forces the complete team safety tuple', () => {
        expect(getParticipationMode({} as any)).to.equal('individual');
        const individual = normalizeParticipationConfig({ rule: 'oi', rated: true } as any);
        expect(individual).to.deep.equal({ rule: 'oi', rated: true });

        const team = normalizeParticipationConfig({
            rule: 'acm',
            participationMode: 'team',
            rated: true,
            vigilEnabled: false,
            entryMode: 'open',
        } as any);
        expect(team).to.include({ rated: false, vigilEnabled: true, entryMode: 'client_required' });
        expect(() => normalizeParticipationConfig({ rule: 'oi', participationMode: 'team' } as any)).to.throw();
        expect(() => normalizeParticipationConfig({ rule: 'acm', participationMode: 'other' } as any)).to.throw();
    });

    it('binds destructive mode confirmation to contest id and revision', () => {
        const tid = new ObjectId('64a000000000000000000002');
        expect(teamModeClearConfirmation(tid, 7)).to.equal(`TEAM-MODE-CLEAR:${tid.toHexString()}:7`);
    });

    it('locks mode changes at start, after any record, or on a stale revision', () => {
        const tid = new ObjectId('64a000000000000000000002');
        const current = { participationMode: 'individual' as const, participationRevision: 3, beginAt: new Date('2099-01-01') };
        const next = { participationMode: 'team' as const, beginAt: new Date('2099-01-01') };
        const base = { tid, current, next, now: new Date('2098-01-01'), recordCount: 0, activeTeamCount: 0, expectedRevision: 3 };
        expect(planParticipationModeTransition(base)).to.deep.equal({
            changed: true,
            currentRevision: 3,
            nextRevision: 4,
            clearActiveTeams: false,
        });
        expect(() => planParticipationModeTransition({ ...base, expectedRevision: 2 })).to.throw();
        expect(() => planParticipationModeTransition({ ...base, recordCount: 1 })).to.throw();
        expect(() => planParticipationModeTransition({ ...base, now: current.beginAt })).to.throw();
        expect(() => planParticipationModeTransition({ ...base, activeTeamCount: 1 })).to.throw();
    });

    it('requires a contest-and-revision-bound confirmation before clearing active teams', () => {
        const tid = new ObjectId('64a000000000000000000002');
        const input = {
            tid,
            current: { participationMode: 'team' as const, participationRevision: 7, beginAt: new Date('2099-01-01') },
            next: { participationMode: 'individual' as const, beginAt: new Date('2099-01-01') },
            now: new Date('2098-01-01'),
            recordCount: 0,
            activeTeamCount: 2,
            expectedRevision: 7,
        };
        expect(() => planParticipationModeTransition(input)).to.throw();
        expect(planParticipationModeTransition({ ...input, clearConfirmation: teamModeClearConfirmation(tid, 7) }).clearActiveTeams).to.equal(true);
        expect(planParticipationModeTransition({ ...input, activeTeamCount: 0 }).clearActiveTeams).to.equal(true);
    });
});

describe('P1.11 canonical contest team lifecycle', () => {
    it('normalizes public fields and validates the 1-3 member invariant', () => {
        expect(teamModel.normalizeTeamName('  Alpha   TEAM  ')).to.deep.equal({ name: 'Alpha TEAM', nameKey: 'alpha team' });
        expect(() => teamModel.normalizeTeamName('bad\u0007name')).to.throw(TestValidationError);
        expect(teamModel.validateTeamShape([12, 10, 12], 10)).to.deep.equal([10, 12]);
        expect(() => teamModel.validateTeamShape([10, 11, 12, 13], 10)).to.throw(TestValidationError);
        expect(() => teamModel.validateTeamShape([10, 11], 11)).to.not.throw();
        expect(() => teamModel.validateTeamShape([10, 11], 13)).to.throw(TestValidationError);
    });

    it('rejects unknown management modes at the authoritative model boundary', async () => {
        await rejects(
            teamModel.createTeam('system', currentContest.docId, { user: actor(99, true) }, {
                name: 'Unknown mode',
                memberUids: [10],
                captainUid: 10,
                managementMode: 'other',
            } as any),
            TestValidationError,
        );
        expect(audit).to.have.length(1);
        expect(audit[0]).to.include({ operation: 'create', result: 'rejected', fromRevision: 0, toRevision: 0 });
    });

    it('does not treat document ownership as management permission without the self-edit grant', async () => {
        await rejects(
            teamModel.createTeam(
                'system',
                currentContest.docId,
                { user: ownerWithoutSelfEdit(99) },
                {
                    name: 'Owner without grant',
                    memberUids: [10],
                    captainUid: 10,
                    managementMode: 'admin',
                },
            ),
            TestPermissionError,
        );
        expect(audit[0]).to.include({ operation: 'create', result: 'rejected', fromRevision: 0, toRevision: 0 });
    });

    it('creates only a one-person self team and enforces one active team per member', async () => {
        const created = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            {
                name: 'Solo',
                memberUids: [10],
                captainUid: 10,
                managementMode: 'self',
            },
        );
        expect(created.teamId).to.equal(created._id);
        expect(created).to.include({ active: true, revision: 1, captainUid: 10, managementMode: 'self' });
        await rejects(
            teamModel.createTeam(
                'system',
                currentContest.docId,
                { user: actor(10) },
                {
                    name: 'Other',
                    memberUids: [10],
                    captainUid: 10,
                    managementMode: 'self',
                },
            ),
            TestConflictError,
        );
        await rejects(
            teamModel.createTeam(
                'system',
                currentContest.docId,
                { user: actor(10) },
                {
                    name: 'Forged',
                    memberUids: [10, 11],
                    captainUid: 10,
                    managementMode: 'self',
                },
            ),
            TestPermissionError,
        );
        expect(audit.some((entry) => entry.type === 'contest.team.create' && entry.operation === 'create' && entry.result === 'success')).to.equal(
            true,
        );
    });

    it('rechecks member eligibility at the final write point and deactivates a failed create', async () => {
        revokeAfterFirstRead = 10;
        await rejects(
            teamModel.createTeam(
                'system',
                currentContest.docId,
                { user: actor(10) },
                {
                    name: 'Revoked during create',
                    memberUids: [10],
                    captainUid: 10,
                    managementMode: 'self',
                },
            ),
            TestUserNotFoundError,
        );
        expect(docs).to.have.length(1);
        expect(docs[0].active).to.equal(false);
        expect(docs[0].deactivationReason).to.equal('team_closed');
    });

    it('lets an admin build 1-3 person teams while rejecting revision races and direct self-team additions', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            {
                name: 'Alpha',
                memberUids: [10, 11],
                captainUid: 10,
                managementMode: 'admin',
            },
        );
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                team.teamId,
                { user: actor(99, true) },
                {
                    expectedRevision: 99,
                    description: 'stale',
                },
            ),
            TestConflictError,
        );
        const rejected = audit[audit.length - 1];
        expect(rejected).to.include({ operation: 'update', result: 'rejected', fromRevision: team.revision, toRevision: team.revision });

        const selfTeam = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(12) },
            {
                name: 'Self team',
                memberUids: [12],
                captainUid: 12,
                managementMode: 'self',
            },
        );
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                selfTeam.teamId,
                { user: actor(12) },
                {
                    expectedRevision: selfTeam.revision,
                    memberUids: [12, 13],
                    captainUid: 12,
                },
            ),
            TestConflictError,
        );
    });

    it('enforces active team-name uniqueness independently of membership uniqueness', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            {
                name: 'Same Name',
                memberUids: [10],
                captainUid: 10,
                managementMode: 'admin',
            },
        );
        await rejects(
            teamModel.createTeam(
                'system',
                currentContest.docId,
                { user: actor(99, true) },
                {
                    name: '  SAME   NAME ',
                    memberUids: [11],
                    captainUid: 11,
                    managementMode: 'admin',
                },
            ),
            TestConflictError,
        );
    });

    it('lets a self captain stop a team while reserving admin-team deactivation for administrators', async () => {
        const selfTeam = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            {
                name: 'Closable',
                memberUids: [10],
                captainUid: 10,
                managementMode: 'self',
            },
        );
        const stopped = await teamModel.updateTeam(
            'system',
            currentContest.docId,
            selfTeam.teamId,
            { user: actor(10) },
            {
                expectedRevision: selfTeam.revision,
                active: false,
            },
        );
        expect(stopped.active).to.equal(false);
        expect(events).to.have.length(1);
        expect(events[0][0]).to.equal('contest/team-role-change');
        expect(events[0][1].before.active).to.equal(true);
        expect(events[0][1].after.active).to.equal(false);

        const adminTeam = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            {
                name: 'Admin managed',
                memberUids: [11],
                captainUid: 11,
                managementMode: 'admin',
            },
        );
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                adminTeam.teamId,
                { user: actor(11) },
                {
                    expectedRevision: adminTeam.revision,
                    active: false,
                },
            ),
            TestPermissionError,
        );
        users.delete(11);
        const adminStopped = await teamModel.updateTeam(
            'system',
            currentContest.docId,
            adminTeam.teamId,
            { user: actor(99, true) },
            {
                expectedRevision: adminTeam.revision,
                active: false,
            },
        );
        expect(adminStopped.active).to.equal(false);
        expect(events).to.have.length(2);
        expect(events[1][1].before.active).to.equal(true);
        expect(events[1][1].after.active).to.equal(false);
    });

    it('allows an admin-managed captain to edit display info but not roster', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            {
                name: 'Admin team',
                memberUids: [10, 11],
                captainUid: 10,
                managementMode: 'admin',
            },
        );
        const updated = await teamModel.updateTeam(
            'system',
            currentContest.docId,
            team.teamId,
            { user: actor(10) },
            {
                expectedRevision: team.revision,
                name: 'Renamed team',
            },
        );
        expect(updated.name).to.equal('Renamed team');
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                team.teamId,
                { user: actor(10) },
                {
                    expectedRevision: updated.revision,
                    memberUids: [10],
                    captainUid: 10,
                },
            ),
            TestPermissionError,
        );
    });

    it('freezes ordinary changes at start and emits one role-change event for confirmed admin emergencies', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            {
                name: 'Emergency team',
                memberUids: [10, 11],
                captainUid: 10,
                managementMode: 'admin',
            },
        );
        currentContest.beginAt = new Date('2000-01-01T00:00:00Z');
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                team.teamId,
                { user: actor(99, true) },
                {
                    expectedRevision: team.revision,
                    captainUid: 11,
                },
            ),
            TestConflictError,
        );
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                team.teamId,
                { user: actor(99, true), emergencyConfirmation: teamModel.emergencyTeamConfirmation(team.teamId, team.revision) },
                { expectedRevision: team.revision, name: 'Late rename' },
            ),
            TestConflictError,
        );
        const updated = await teamModel.updateTeam(
            'system',
            currentContest.docId,
            team.teamId,
            { user: actor(99, true), emergencyConfirmation: teamModel.emergencyTeamConfirmation(team.teamId, team.revision) },
            { expectedRevision: team.revision, captainUid: 11 },
        );
        expect(updated.captainUid).to.equal(11);
        expect(events).to.have.length(1);
        expect(events[0][0]).to.equal('contest/team-role-change');
        expect(audit.some((entry) => entry.type === 'contest.team.emergency-update' && entry.result === 'success')).to.equal(true);
    });

    it('registers only equality-partial unique indexes', async () => {
        await teamModel.apply({
            db: {
                async ensureIndexes(_collection: any, ...definitions: any[]) {
                    indexes.push(...definitions);
                },
            },
            on() {},
        } as any);
        const partials = indexes.filter((index) => index.partialFilterExpression);
        expect(partials).to.have.length(3);
        expect(partials.map((index) => index.partialFilterExpression)).to.deep.equal([{ active: true }, { active: true }, { status: 'pending' }]);
    });
});

describe('P1.14 team Exam Mode capabilities', () => {
    it('derives captain and member capabilities from the same active roster', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            { name: 'Exam team', memberUids: [10, 11], captainUid: 10, managementMode: 'admin' },
        );

        const captain = teamModel.buildExamModeTeamContext(team, 10);
        expect(captain).to.deep.include({
            teamId: team.teamId.toHexString(),
            teamRole: 'captain',
            canBrowseProblems: true,
            canViewTeamRecords: true,
            canEditCode: true,
            canRun: true,
            canSubmit: true,
            canUseVirtualPrint: true,
        });
        expect(captain.teamInfo).to.deep.equal({
            teamId: team.teamId.toHexString(),
            name: 'Exam team',
            captainUid: 10,
            memberUids: [10, 11],
            revision: team.revision,
        });

        const member = teamModel.buildExamModeTeamContext(team, 11);
        expect(member).to.deep.include({
            teamRole: 'member',
            canBrowseProblems: true,
            canViewTeamRecords: true,
            canEditCode: false,
            canRun: false,
            canSubmit: false,
            canUseVirtualPrint: false,
        });
    });

    it('fails closed for an outsider while allowing a non-writing administrator preview', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            { name: 'Exam team', memberUids: [10], captainUid: 10, managementMode: 'admin' },
        );
        expect(() => teamModel.buildExamModeTeamContext(team, 11)).to.throw(TestConflictError);
        expect(() => teamModel.buildExamModeTeamContext({ ...team, active: false }, 10)).to.throw(TestConflictError);

        const preview = teamModel.buildExamModeTeamContext(null, 99, true);
        expect(preview).to.deep.include({
            teamId: null,
            teamRole: 'admin_preview',
            teamInfo: null,
            canBrowseProblems: true,
            canViewTeamRecords: true,
            canEditCode: false,
            canRun: false,
            canSubmit: false,
            canUseVirtualPrint: false,
        });
    });
});

describe('P1.12 invitation and assignment lifecycle', () => {
    it('keeps one stable pending invitation per team and invitee', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Invite team', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const first = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        const second = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        expect(first.inviteId.equals(second.inviteId)).to.equal(true);
        expect(second.teamId.equals(team.teamId)).to.equal(true);
        expect(invites.filter((invite) => invite.status === 'pending')).to.have.length(1);
        expect(audit.some((entry) => entry.operation === 'invite-create' && entry.result === 'success')).to.equal(true);
    });

    it('accepts one of several invitations atomically into one team and supersedes the rest', async () => {
        const firstTeam = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'First', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(11) },
            { name: 'Second', memberUids: [11], captainUid: 11, managementMode: 'self' },
        );
        const acceptedInvite = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 12);
        const otherInvite = await teamModel.createInvite('system', currentContest.docId, { user: actor(11) }, 12);
        const joined = await teamModel.acceptInvite('system', currentContest.docId, acceptedInvite.inviteId, { user: actor(12) });
        expect(joined.teamId.equals(firstTeam.teamId)).to.equal(true);
        expect(joined.memberUids).to.deep.equal([10, 12]);
        expect(invites.find((invite) => invite.inviteId.equals(acceptedInvite.inviteId))?.status).to.equal('accepted');
        expect(invites.find((invite) => invite.inviteId.equals(otherInvite.inviteId))?.status).to.equal('superseded');
        expect(events.at(-1)?.[0]).to.equal('contest/team-role-change');
    });

    it('resolves concurrent accepts of different teams without restoring a superseded invitation', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Race first', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(11) },
            { name: 'Race second', memberUids: [11], captainUid: 11, managementMode: 'self' },
        );
        const first = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 12);
        const second = await teamModel.createInvite('system', currentContest.docId, { user: actor(11) }, 12);
        armTeamCasBarrier(2);
        const results = await Promise.allSettled([
            teamModel.acceptInvite('system', currentContest.docId, first.inviteId, { user: actor(12) }),
            teamModel.acceptInvite('system', currentContest.docId, second.inviteId, { user: actor(12) }),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        expect(results.filter((result) => result.status === 'rejected')).to.have.length(1);
        expect(invites.filter((invite) => invite.inviteeUid === 12 && invite.status === 'pending')).to.have.length(0);
        expect(invites.filter((invite) => invite.inviteeUid === 12 && invite.status === 'accepted')).to.have.length(1);
        expect(invites.filter((invite) => invite.inviteeUid === 12 && invite.status === 'superseded')).to.have.length(1);
    });

    it('refreshes the losing invitation revision when two users accept the same non-full team concurrently', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Shared race', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const first = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        const second = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 12);
        armTeamCasBarrier(2);
        const results = await Promise.allSettled([
            teamModel.acceptInvite('system', currentContest.docId, first.inviteId, { user: actor(11) }),
            teamModel.acceptInvite('system', currentContest.docId, second.inviteId, { user: actor(12) }),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        const current = await teamModel.getTeam('system', currentContest.docId, team.teamId);
        const pending = invites.find((invite) => invite.status === 'pending');
        expect(current?.memberUids).to.have.length(2);
        expect(pending?.teamRevision).to.equal(current?.revision);
        const final = await teamModel.acceptInvite('system', currentContest.docId, pending.inviteId, {
            user: actor(pending.inviteeUid),
        });
        expect(final.memberUids).to.deep.equal([10, 11, 12]);
    });

    it('returns the committed membership and emits the role event when invitation finalization fails', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Observable commit', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const invite = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        const errors: any[][] = [];
        const originalError = console.error;
        console.error = (...args: any[]) => errors.push(args);
        failNextInviteUpdateOne = true;
        try {
            const committed = await teamModel.acceptInvite('system', currentContest.docId, invite.inviteId, { user: actor(11) });
            expect(committed.memberUids).to.deep.equal([10, 11]);
        } finally {
            console.error = originalError;
        }
        expect(events.at(-1)?.[0]).to.equal('contest/team-role-change');
        expect(errors.some((entry) => entry[0] === '[contest-team] committed mutation post-commit step failed')).to.equal(true);
        expect(audit.some((entry) => entry.operation === 'invite-accept' && entry.result === 'success')).to.equal(true);
    });

    it('keeps a committed roster change successful and publishes its role event when invite synchronization fails', async () => {
        const team = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(99, true) },
            { name: 'Admin sync failure', memberUids: [10, 11], captainUid: 10, managementMode: 'admin' },
        );
        const errors: any[][] = [];
        const originalError = console.error;
        console.error = (...args: any[]) => errors.push(args);
        failNextInviteUpdateMany = true;
        try {
            const committed = await teamModel.updateTeam(
                'system',
                currentContest.docId,
                team.teamId,
                { user: actor(99, true) },
                { expectedRevision: team.revision, memberUids: [11], captainUid: 11 },
            );
            expect(committed.memberUids).to.deep.equal([11]);
        } finally {
            console.error = originalError;
        }
        expect(events.at(-1)?.[0]).to.equal('contest/team-role-change');
        expect(errors.some((entry) => entry[0] === '[contest-team] committed mutation post-commit step failed')).to.equal(true);
    });

    it('lets only the invitee decline and freezes invite actions at contest start', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Decline team', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const first = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        await rejects(teamModel.declineInvite('system', currentContest.docId, first.inviteId, { user: actor(12) }), TestPermissionError);
        const declined = await teamModel.declineInvite('system', currentContest.docId, first.inviteId, { user: actor(11) });
        expect(declined.status).to.equal('declined');

        const second = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 12);
        currentContest.beginAt = new Date('2000-01-01T00:00:00Z');
        await rejects(teamModel.acceptInvite('system', currentContest.docId, second.inviteId, { user: actor(12) }), TestConflictError);
        await rejects(teamModel.declineInvite('system', currentContest.docId, second.inviteId, { user: actor(12) }), TestConflictError);
    });

    it('rechecks eligibility and active membership before accepting', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Eligibility team', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const invite = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        users.set(11, { _id: 11, hasPerm: () => false });
        await rejects(teamModel.acceptInvite('system', currentContest.docId, invite.inviteId, { user: actor(11) }), TestNotAssignedError);
        expect(invites.find((entry) => entry.inviteId.equals(invite.inviteId))?.status).to.equal('pending');
    });

    it('restores the claimed invitation when eligibility disappears at the final accept check', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Final eligibility team', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const invite = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        userReads.clear();
        revokeAfterFirstRead = 11;
        await rejects(teamModel.acceptInvite('system', currentContest.docId, invite.inviteId, { user: actor(11) }), TestUserNotFoundError);
        expect(invites.find((entry) => entry.inviteId.equals(invite.inviteId))?.status).to.equal('pending');
        expect(docs[0].memberUids).to.deep.equal([10]);
    });

    it('allows exactly three members and rejects another invitation once the team is full', async () => {
        await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Three person team', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        const first = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        await teamModel.acceptInvite('system', currentContest.docId, first.inviteId, { user: actor(11) });
        const second = await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 12);
        const full = await teamModel.acceptInvite('system', currentContest.docId, second.inviteId, { user: actor(12) });
        expect(full.memberUids).to.deep.equal([10, 11, 12]);
        await rejects(teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 13), TestConflictError);
    });

    it('reserves invitations for self-managed captains and lets admins change management mode', async () => {
        const selfTeam = await teamModel.createTeam(
            'system',
            currentContest.docId,
            { user: actor(10) },
            { name: 'Convertible', memberUids: [10], captainUid: 10, managementMode: 'self' },
        );
        await rejects(
            teamModel.updateTeam(
                'system',
                currentContest.docId,
                selfTeam.teamId,
                { user: actor(10) },
                { expectedRevision: selfTeam.revision, managementMode: 'admin' },
            ),
            TestPermissionError,
        );
        await teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11);
        const converted = await teamModel.updateTeam(
            'system',
            currentContest.docId,
            selfTeam.teamId,
            { user: actor(99, true) },
            { expectedRevision: selfTeam.revision, managementMode: 'admin' },
        );
        expect(converted.managementMode).to.equal('admin');
        expect(invites.filter((invite) => invite.teamId.equals(converted.teamId) && invite.status === 'pending')).to.have.length(0);
        await rejects(teamModel.createInvite('system', currentContest.docId, { user: actor(10) }, 11), TestPermissionError);
    });
});
