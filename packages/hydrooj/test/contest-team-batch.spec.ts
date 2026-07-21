import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
(global as any).Hydro = { model: {} };

class TestValidationError extends Error {}
class TestConflictError extends Error {
    status = 409;
}
class TestPermissionError extends Error {}
class TestUserNotFoundError extends Error {}

const PERM = {
    PERM_CREATE_CONTEST: 1n,
    PERM_EDIT_CONTEST: 2n,
    PERM_EDIT_CONTEST_SELF: 4n,
    PERM_VIEW_CONTEST: 8n,
    PERM_ATTEND_CONTEST: 16n,
};
const PRIV = { PRIV_EDIT_SYSTEM: 1 };
const batches: any[] = [];
const batchTeams: any[] = [];
const batchInvites: any[] = [];
const contestTeams: any[] = [];
const contestDocs: any[] = [];
const records: any[] = [];
const audits: any[] = [];
const users = new Map<number, any>();
let rejectedRosterUid: number | null = null;
let failInsertManyAfter: number | null = null;
let contestReads = 0;
let mutateScopeOnSecondContestRead = false;
let mutateRuleBeforeBinding = false;
let failInviteUpdateManyOnce = false;

function same(left: any, right: any): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, value]: any) => {
        if (key === '$or') return value.some((branch: any) => matches(doc, branch));
        if (key === '$and') return value.every((branch: any) => matches(doc, branch));
        const actual = doc[key];
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date) && !Array.isArray(value)) {
            if ('$in' in value) {
                return Array.isArray(actual)
                    ? actual.some((entry) => value.$in.some((item: any) => same(entry, item)))
                    : value.$in.some((item: any) => same(actual, item));
            }
            if ('$ne' in value) return !same(actual, value.$ne);
            if ('$exists' in value) return value.$exists ? actual !== undefined : actual === undefined;
            if ('$regex' in value) return value.$regex.test(String(actual || ''));
        }
        if (Array.isArray(actual) && !Array.isArray(value)) return actual.some((entry) => same(entry, value));
        return same(actual, value);
    });
}

function applyUpdate(doc: any, update: any) {
    Object.assign(doc, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete doc[key];
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = Number(doc[key] || 0) + Number(value);
}

function duplicateBatch(candidate: any, ignore?: any) {
    if (candidate.status !== 'open') return;
    if (batches.some((doc) => doc !== ignore && doc.domainId === candidate.domainId && doc.status === 'open' && doc.nameKey === candidate.nameKey)) {
        throw Object.assign(new Error('duplicate batch name'), { code: 11000, keyPattern: { domainId: 1, nameKey: 1 } });
    }
}

function duplicateBatchTeam(candidate: any, ignore?: any) {
    if (!candidate.active) return;
    const active = batchTeams.filter(
        (doc) => doc !== ignore && doc.active && doc.domainId === candidate.domainId && same(doc.batchId, candidate.batchId),
    );
    if (active.some((doc) => doc.nameKey === candidate.nameKey)) {
        throw Object.assign(new Error('duplicate team name'), { code: 11000, keyPattern: { domainId: 1, batchId: 1, nameKey: 1 } });
    }
    if (active.some((doc) => doc.memberUids.some((uid: number) => candidate.memberUids.includes(uid)))) {
        throw Object.assign(new Error('duplicate batch member'), {
            code: 11000,
            keyPattern: { domainId: 1, batchId: 1, memberUids: 1 },
        });
    }
}

function duplicateContestTeam(candidate: any, ignore?: any) {
    if (!candidate.active) return;
    const active = contestTeams.filter(
        (doc) => doc !== ignore && doc.active && doc.domainId === candidate.domainId && same(doc.contestId, candidate.contestId),
    );
    if (active.some((doc) => doc.nameKey === candidate.nameKey)) {
        throw Object.assign(new Error('duplicate contest team name'), { code: 11000, keyPattern: { nameKey: 1 } });
    }
    if (active.some((doc) => doc.memberUids.some((uid: number) => candidate.memberUids.includes(uid)))) {
        throw Object.assign(new Error('duplicate contest member'), { code: 11000, keyPattern: { memberUids: 1 } });
    }
}

function cursor(source: any[], filter: any) {
    let result = source.filter((doc) => matches(doc, filter));
    const api = {
        sort(spec: any) {
            const keys = Object.entries(spec);
            result = [...result].sort((left, right) => {
                for (const [key, direction] of keys) {
                    const a = left[key];
                    const b = right[key];
                    if (same(a, b)) continue;
                    return (a < b ? -1 : 1) * Number(direction);
                }
                return 0;
            });
            return api;
        },
        project() {
            return api;
        },
        async toArray() {
            return result;
        },
    };
    return api;
}

function collection(source: any[], duplicate?: (candidate: any, ignore?: any) => void) {
    return {
        async insertOne(doc: any) {
            duplicate?.(doc);
            source.push(doc);
            return { insertedId: doc._id };
        },
        async insertMany(docs: any[]) {
            for (const [index, doc] of docs.entries()) {
                if (failInsertManyAfter !== null && index === failInsertManyAfter) throw new Error('injected partial insert failure');
                duplicate?.(doc);
                source.push(doc);
            }
            return { insertedCount: docs.length };
        },
        async findOne(filter: any) {
            return source.find((doc) => matches(doc, filter)) || null;
        },
        async findOneAndUpdate(filter: any, update: any) {
            const doc = source.find((candidate) => matches(candidate, filter));
            if (!doc) return null;
            const next = { ...doc };
            applyUpdate(next, update);
            duplicate?.(next, doc);
            applyUpdate(doc, update);
            return doc;
        },
        async updateOne(filter: any, update: any) {
            const doc = source.find((candidate) => matches(candidate, filter));
            if (!doc) return { matchedCount: 0, modifiedCount: 0 };
            const next = { ...doc };
            applyUpdate(next, update);
            duplicate?.(next, doc);
            applyUpdate(doc, update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(filter: any, update: any) {
            const found = source.filter((doc) => matches(doc, filter));
            for (const doc of found) {
                const next = { ...doc };
                applyUpdate(next, update);
                duplicate?.(next, doc);
                applyUpdate(doc, update);
            }
            return { matchedCount: found.length, modifiedCount: found.length };
        },
        async deleteMany(filter: any) {
            const found = source.filter((doc) => matches(doc, filter));
            for (const doc of found) source.splice(source.indexOf(doc), 1);
            return { deletedCount: found.length };
        },
        async countDocuments(filter: any) {
            return source.filter((doc) => matches(doc, filter)).length;
        },
        find(filter: any) {
            return cursor(source, filter);
        },
    };
}

const batchCollection = collection(batches, duplicateBatch);
const batchTeamCollection = collection(batchTeams, duplicateBatchTeam);
const inviteCollectionBase = collection(batchInvites);
const inviteCollection = {
    ...inviteCollectionBase,
    async updateMany(filter: any, update: any) {
        if (failInviteUpdateManyOnce) {
            failInviteUpdateManyOnce = false;
            throw new Error('injected invitation sync failure');
        }
        return await inviteCollectionBase.updateMany(filter, update);
    },
};
const contestTeamCollection = collection(contestTeams, duplicateContestTeam);
const contestDocumentCollectionBase = collection(contestDocs);
const contestDocumentCollection = {
    ...contestDocumentCollectionBase,
    async updateOne(filter: any, update: any) {
        if (mutateRuleBeforeBinding) {
            mutateRuleBeforeBinding = false;
            contestDocs[0].rule = 'oi';
        }
        return await contestDocumentCollectionBase.updateOne(filter, update);
    },
};
const recordCollection = collection(records);

function normalizeName(value: unknown) {
    const name = String(value || '')
        .trim()
        .replace(/\s+/g, ' ');
    if (!name || name.length > 80) throw new TestValidationError('name');
    return { name, nameKey: name.toLowerCase() };
}

function normalizeMemberUids(value: number[]) {
    return [...new Set(value)].sort((a, b) => a - b);
}

function validateTeamShape(value: number[], captainUid: number) {
    const memberUids = normalizeMemberUids(value);
    if (!memberUids.length || memberUids.length > 3 || !memberUids.includes(captainUid)) throw new TestValidationError('memberUids');
    return memberUids;
}

const contestTeamStub = {
    coll: contestTeamCollection,
    normalizeTeamName: normalizeName,
    normalizeTeamDescription: (value: unknown) => String(value || '').trim(),
    validateTeamShape,
    async assertContestTeamRosterEligibility(_domainId: string, _tdoc: any, uid: number) {
        if (uid === rejectedRosterUid) throw new TestPermissionError('rejected roster member');
    },
};

const contestStub = {
    async get(domainId: string, contestId: ObjectId) {
        const doc = contestDocs.find((item) => item.domainId === domainId && same(item.docId, contestId));
        if (!doc) return null;
        contestReads += 1;
        if (mutateScopeOnSecondContestRead && contestReads === 2) doc.assign = ['late-scope'];
        return {
            ...doc,
            assign: doc.assign ? [...doc.assign] : undefined,
            participantSchoolIds: doc.participantSchoolIds ? [...doc.participantSchoolIds] : undefined,
            participantGroupIds: doc.participantGroupIds ? [...doc.participantGroupIds] : undefined,
        };
    },
    getParticipationMode(tdoc: any) {
        return tdoc?.participationMode === 'team' ? 'team' : 'individual';
    },
};

const userModelStub = {
    async getById(_domainId: string, uid: number) {
        return users.get(uid) || null;
    },
};

const dbStub = {
    collection(name: string) {
        if (name === 'contest.teamBatches') return batchCollection;
        if (name === 'contest.teamBatchTeams') return batchTeamCollection;
        if (name === 'contest.teamBatchInvites') return inviteCollection;
        if (name === 'record') return recordCollection;
        throw new Error(`unexpected collection ${name}`);
    },
};

const modulePath = require.resolve('../src/model/contest-team-batch.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === '../error') {
            return {
                ContestTeamConflictError: TestConflictError,
                PermissionError: TestPermissionError,
                UserNotFoundError: TestUserNotFoundError,
                ValidationError: TestValidationError,
            };
        }
        if (request === '../service/db') return { __esModule: true, default: dbStub };
        if (request === './builtin') return { PERM, PRIV };
        if (request === './contest') return contestStub;
        if (request === './contest-team') return contestTeamStub;
        if (request === './document') return { TYPE_CONTEST: 30, coll: contestDocumentCollection };
        if (request === './oplog') return { add: async (entry: any) => audits.push(entry) };
        if (request === './user') return { __esModule: true, default: userModelStub };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let batchModel: typeof import('../src/model/contest-team-batch');
try {
    delete require.cache[modulePath];
    batchModel = require(modulePath);
} finally {
    Module._load = originalLoad;
}

function actor(uid: number, manager = false) {
    return {
        _id: uid,
        hasPerm: (permission: bigint) => manager || permission === PERM.PERM_VIEW_CONTEST || permission === PERM.PERM_ATTEND_CONTEST,
        hasPriv: (privilege: number) => manager && privilege === PRIV.PRIV_EDIT_SYSTEM,
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

async function createClosedBatch(name = 'Summer Teams') {
    const batch = await batchModel.createBatch('system', { user: actor(99, true) }, { name });
    await batchModel.createTeam(
        'system',
        batch.batchId,
        { user: actor(99, true) },
        {
            name: 'Alpha',
            captainUid: 10,
            memberUids: [10, 11],
            managementMode: 'admin',
        },
    );
    await batchModel.createTeam(
        'system',
        batch.batchId,
        { user: actor(99, true) },
        {
            name: 'Beta',
            captainUid: 12,
            memberUids: [12],
            managementMode: 'admin',
        },
    );
    const latest = await batchModel.getBatch('system', batch.batchId);
    await batchModel.closeBatch('system', batch.batchId, latest.revision, { user: actor(99, true) });
    return await batchModel.getBatch('system', batch.batchId);
}

beforeEach(() => {
    batches.length = 0;
    batchTeams.length = 0;
    batchInvites.length = 0;
    contestTeams.length = 0;
    contestDocs.length = 0;
    records.length = 0;
    audits.length = 0;
    users.clear();
    rejectedRosterUid = null;
    failInsertManyAfter = null;
    contestReads = 0;
    mutateScopeOnSecondContestRead = false;
    mutateRuleBeforeBinding = false;
    failInviteUpdateManyOnce = false;
    for (const uid of [10, 11, 12, 13, 99]) {
        users.set(uid, {
            _id: uid,
            hasPerm: (permission: bigint) => permission === PERM.PERM_VIEW_CONTEST || permission === PERM.PERM_ATTEND_CONTEST,
        });
    }
    contestDocs.push({
        _id: new ObjectId('64a000000000000000000001'),
        domainId: 'system',
        docType: 30,
        docId: new ObjectId('64a000000000000000000001'),
        rule: 'acm',
        participationMode: 'team',
        beginAt: new Date('2099-01-01T00:00:00Z'),
    });
});

describe('P1.17 pre-contest team batches', () => {
    it('supports self assembly, invitation acceptance and freezes every write after close', async () => {
        await rejects(batchModel.createBatch('system', { user: actor(10) }, { name: 'Denied' }), TestPermissionError);
        const batch = await batchModel.createBatch('system', { user: actor(99, true) }, { name: 'Open Batch' });
        const team = await batchModel.createTeam(
            'system',
            batch.batchId,
            { user: actor(10) },
            {
                name: 'Self team',
                captainUid: 10,
                memberUids: [10],
                managementMode: 'self',
            },
        );
        const invite = await batchModel.createInvite('system', batch.batchId, { user: actor(10) }, 11);
        const accepted = await batchModel.acceptInvite('system', batch.batchId, invite.inviteId, { user: actor(11) });
        expect(accepted.memberUids).to.deep.equal([10, 11]);
        expect(batchInvites.find((item) => same(item.inviteId, invite.inviteId)).status).to.equal('accepted');
        await rejects(
            batchModel.createTeam(
                'system',
                batch.batchId,
                { user: actor(11) },
                {
                    name: 'Duplicate member',
                    captainUid: 11,
                    memberUids: [11],
                    managementMode: 'self',
                },
            ),
            TestConflictError,
        );
        const latest = await batchModel.getBatch('system', batch.batchId);
        const closed = await batchModel.closeBatch('system', batch.batchId, latest.revision, { user: actor(99, true) });
        expect(closed.status).to.equal('closed');
        await rejects(
            batchModel.updateTeam('system', batch.batchId, team.teamId, { user: actor(10) }, { expectedRevision: accepted.revision, name: 'Late' }),
            TestConflictError,
        );
    });

    it('keeps invitations many-to-one until one acceptance and enforces the three-member ceiling', async () => {
        const batch = await batchModel.createBatch('system', { user: actor(99, true) }, { name: 'Choice Batch' });
        const alpha = await batchModel.createTeam(
            'system',
            batch.batchId,
            { user: actor(10) },
            {
                name: 'Alpha',
                captainUid: 10,
                memberUids: [10],
                managementMode: 'self',
            },
        );
        await batchModel.createTeam(
            'system',
            batch.batchId,
            { user: actor(12) },
            {
                name: 'Beta',
                captainUid: 12,
                memberUids: [12],
                managementMode: 'self',
            },
        );
        const alphaInvite = await batchModel.createInvite('system', batch.batchId, { user: actor(10) }, 11);
        const betaInvite = await batchModel.createInvite('system', batch.batchId, { user: actor(12) }, 11);
        await batchModel.acceptInvite('system', batch.batchId, betaInvite.inviteId, { user: actor(11) });
        expect(batchInvites.find((item) => same(item.inviteId, alphaInvite.inviteId)).status).to.equal('superseded');
        expect(batchInvites.find((item) => same(item.inviteId, betaInvite.inviteId)).status).to.equal('accepted');

        const updated = await batchModel.updateTeam(
            'system',
            batch.batchId,
            alpha.teamId,
            { user: actor(99, true) },
            {
                expectedRevision: alpha.revision,
                memberUids: [10, 13],
                captainUid: 10,
            },
        );
        await rejects(
            batchModel.updateTeam(
                'system',
                batch.batchId,
                alpha.teamId,
                { user: actor(99, true) },
                {
                    expectedRevision: updated.revision,
                    memberUids: [10, 12, 13, 99],
                    captainUid: 10,
                },
            ),
            TestValidationError,
        );
    });

    it('reports a durable team update as committed when invitation synchronization fails afterward', async () => {
        const batch = await batchModel.createBatch('system', { user: actor(99, true) }, { name: 'Post-commit Batch' });
        const team = await batchModel.createTeam(
            'system',
            batch.batchId,
            { user: actor(10) },
            {
                name: 'Writers',
                captainUid: 10,
                memberUids: [10],
                managementMode: 'self',
            },
        );
        await batchModel.createInvite('system', batch.batchId, { user: actor(10) }, 11);
        const originalRevision = team.revision;
        failInviteUpdateManyOnce = true;
        const logged: unknown[][] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => logged.push(args);
        try {
            const updated = await batchModel.updateTeam(
                'system',
                batch.batchId,
                team.teamId,
                { user: actor(10) },
                { expectedRevision: team.revision, name: 'Writers Updated' },
            );
            expect(updated).to.include({ name: 'Writers Updated', revision: originalRevision + 1 });
        } finally {
            console.error = originalError;
        }
        expect(logged).to.have.length(1);
        expect(String(logged[0][0])).to.include('committed mutation post-commit step failed');
        expect(audits.at(-1)).to.include({ operation: 'team-update', result: 'success' });
    });

    it('materializes independent contest teams and makes repeated or concurrent submission idempotent', async () => {
        const batch = await createClosedBatch();
        const contestId = contestDocs[0].docId;
        const [first, second] = await Promise.all([
            batchModel.snapshotToContest('system', contestId, batch.batchId, 99),
            batchModel.snapshotToContest('system', contestId, batch.batchId, 99),
        ]);
        expect([first.alreadyApplied, second.alreadyApplied].sort()).to.deep.equal([false, true]);
        expect(contestTeams).to.have.length(2);
        expect(contestTeams.every((team) => team.active && team.snapshotState === 'active')).to.equal(true);
        expect(contestTeams.every((team) => team.sourceBatchId.equals(batch.batchId))).to.equal(true);
        expect(contestTeams.every((team) => !batchTeams.some((source) => source.teamId.equals(team.teamId)))).to.equal(true);
        expect(contestDocs[0]).to.include({ teamBatchSnapshotCount: 2 });
        expect(contestDocs[0].teamBatchId.equals(batch.batchId)).to.equal(true);
        expect(contestDocs[0].teamBatchSnapshotHash).to.match(/^[a-f0-9]{64}$/);

        const secondContestId = new ObjectId('64a000000000000000000002');
        contestDocs.push({
            ...contestDocs[0],
            _id: secondContestId,
            docId: secondContestId,
            teamBatchId: undefined,
            teamBatchSnapshotHash: undefined,
            teamBatchSnapshotAt: undefined,
            teamBatchSnapshotCount: undefined,
        });
        const third = await batchModel.snapshotToContest('system', secondContestId, batch.batchId, 99);
        const firstIds = contestTeams.filter((team) => team.contestId.equals(contestId)).map((team) => team.teamId.toHexString());
        const secondIds = contestTeams.filter((team) => team.contestId.equals(secondContestId)).map((team) => team.teamId.toHexString());
        expect(third.alreadyApplied).to.equal(false);
        expect(new Set([...firstIds, ...secondIds]).size).to.equal(4);
        expect(batchTeams.map((team) => team.name)).to.deep.equal(['Alpha', 'Beta']);
    });

    it('rejects open, empty, recorded or already-populated targets before exposing a snapshot', async () => {
        const open = await batchModel.createBatch('system', { user: actor(99, true) }, { name: 'Still Open' });
        await batchModel.createTeam(
            'system',
            open.batchId,
            { user: actor(99, true) },
            {
                name: 'Open Team',
                captainUid: 10,
                memberUids: [10],
                managementMode: 'admin',
            },
        );
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, open.batchId, 99), TestConflictError);

        const empty = await batchModel.createBatch('system', { user: actor(99, true) }, { name: 'Empty' });
        await batchModel.closeBatch('system', empty.batchId, empty.revision, { user: actor(99, true) });
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, empty.batchId, 99), TestConflictError);

        const closed = await createClosedBatch('Ready');
        records.push({ domainId: 'system', contest: contestDocs[0].docId });
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, closed.batchId, 99), TestConflictError);
        records.length = 0;
        contestTeams.push({
            _id: new ObjectId(),
            teamId: new ObjectId(),
            domainId: 'system',
            contestId: contestDocs[0].docId,
            name: 'Existing',
            nameKey: 'existing',
            captainUid: 13,
            memberUids: [13],
            active: true,
        });
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, closed.batchId, 99), TestConflictError);
        expect(contestTeams).to.have.length(1);
        expect(contestDocs[0].teamBatchId).to.equal(undefined);
    });

    it('rejects one ineligible member with exact context and leaves no visible or prepared teams', async () => {
        const batch = await createClosedBatch();
        rejectedRosterUid = 11;
        const error = await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, batch.batchId, 99), TestConflictError);
        expect(error.message).to.include('teamId=').and.to.include('uid=11').and.to.include('stage=contest-eligibility');
        expect(contestTeams).to.have.length(0);
        expect(contestDocs[0].teamBatchId).to.equal(undefined);
    });

    it('rejects target eligibility drift at the final check and audits the exact failed stage', async () => {
        const batch = await createClosedBatch();
        mutateScopeOnSecondContestRead = true;
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, batch.batchId, 99), TestConflictError);
        expect(contestTeams).to.have.length(0);
        expect(contestDocs[0].teamBatchId).to.equal(undefined);
        expect(audits.at(-1)).to.include({ operation: 'snapshot', result: 'rejected', stage: 'target-recheck' });
    });

    it('rejects an ACM rule change at the binding CAS and removes activated snapshot teams', async () => {
        const batch = await createClosedBatch();
        mutateRuleBeforeBinding = true;
        await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, batch.batchId, 99), TestConflictError);
        expect(contestTeams).to.have.length(0);
        expect(contestDocs[0].teamBatchId).to.equal(undefined);
        expect(audits.at(-1)).to.include({ operation: 'snapshot', result: 'rejected', stage: 'binding-cas' });
    });

    it('cleans an exact partially inserted snapshot without hiding the original failure', async () => {
        const batch = await createClosedBatch();
        failInsertManyAfter = 1;
        const error = await rejects(batchModel.snapshotToContest('system', contestDocs[0].docId, batch.batchId, 99), Error);
        expect(error.message).to.equal('injected partial insert failure');
        expect(contestTeams).to.have.length(0);
        expect(contestDocs[0].teamBatchId).to.equal(undefined);
    });
});
