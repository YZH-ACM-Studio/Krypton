import { expect } from 'chai';
import { localizedErrorText } from '@hydrooj/framework';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
(global as any).Hydro = { model: {} };

class TestValidationError extends Error {}
class TestConflictError extends Error {}
class TestPermissionError extends Error {}

const contestId = new ObjectId('64a000000000000000000201');
const teamId = new ObjectId('64a000000000000000000202');
const snapshots: any[] = [];
const counters = new Map<string, any>();
let team: any;
let tdoc: any;
let pdoc: any;

function same(left: any, right: any): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, expected]: [string, any]) => {
        const actual = doc[key];
        if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !Array.isArray(expected)) {
            if ('$in' in expected) return expected.$in.some((value: any) => same(actual, value));
            if ('$or' in expected) return expected.$or.some((entry: any) => matches(doc, entry));
            if ('$exists' in expected) return expected.$exists ? actual !== undefined : actual === undefined;
        }
        return same(actual, expected);
    });
}

function sorted(rows: any[], order: Record<string, 1 | -1>) {
    return [...rows].sort((left, right) => {
        for (const [key, direction] of Object.entries(order)) {
            const a = left[key] instanceof Date ? left[key].getTime() : String(left[key]);
            const b = right[key] instanceof Date ? right[key].getTime() : String(right[key]);
            if (a < b) return -1 * direction;
            if (a > b) return direction;
        }
        return 0;
    });
}

function cursor(rows: any[]) {
    let value = [...rows];
    return {
        sort(order: Record<string, 1 | -1>) {
            value = sorted(value, order);
            return this;
        },
        skip(count: number) {
            value = value.slice(count);
            return this;
        },
        limit(count: number) {
            value = value.slice(0, count);
            return this;
        },
        project() {
            return this;
        },
        async toArray() {
            return value;
        },
    };
}

const snapshotCollection = {
    async insertMany(docs: any[]) {
        snapshots.push(...docs);
        return { insertedCount: docs.length };
    },
    find(filter: any) {
        const rows = snapshots.filter((doc) => {
            if (filter.$or && !filter.$or.some((entry: any) => matches(doc, entry))) return false;
            const rest = { ...filter };
            delete rest.$or;
            return matches(doc, rest);
        });
        return cursor(rows);
    },
    async findOne(filter: any) {
        return snapshots.find((doc) => matches(doc, filter)) || null;
    },
    async findOneAndUpdate(filter: any, update: any) {
        const doc = snapshots.find((candidate) => matches(candidate, filter));
        if (!doc) return null;
        Object.assign(doc, update.$set || {});
        return doc;
    },
    async updateOne(filter: any, update: any) {
        const doc = snapshots.find((candidate) => matches(candidate, filter));
        if (!doc) return { modifiedCount: 0 };
        Object.assign(doc, update.$set || {});
        return { modifiedCount: 1 };
    },
    async deleteMany(filter: any) {
        const found = snapshots.filter((doc) => matches(doc, filter));
        for (const doc of found) snapshots.splice(snapshots.indexOf(doc), 1);
        return { deletedCount: found.length };
    },
};

const counterCollection = {
    async findOneAndUpdate(filter: any, update: any) {
        const current = counters.get(filter._id) || { _id: filter._id, sequence: 0 };
        current.sequence += Number(update.$inc?.sequence || 0);
        counters.set(filter._id, current);
        return current;
    },
    async deleteMany() {
        counters.clear();
        return { deletedCount: 0 };
    },
};

const dbStub = {
    collection(name: string) {
        if (name === 'contest.teamCodeSnapshots') return snapshotCollection;
        if (name === 'contest.teamCodeSnapshotCounters') return counterCollection;
        throw new Error(`unexpected collection ${name}`);
    },
};

const modulePath = require.resolve('../src/model/contest-team-code.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === '../error') {
            return {
                ContestTeamConflictError: TestConflictError,
                localizedErrorText,
                PermissionError: TestPermissionError,
                ValidationError: TestValidationError,
            };
        }
        if (request === '../service/db') return { __esModule: true, default: dbStub };
        if (request === './contest') {
            return {
                get: async () => tdoc,
                getParticipationMode: (doc: any) => doc.participationMode || 'individual',
            };
        }
        if (request === './contest-team') {
            return {
                canManageContestTeams: (user: any) => user.admin === true,
                getTeam: async () => team,
                getTeamByMember: async (_domainId: string, _contestId: ObjectId, uid: number) =>
                    team?.active && team.memberUids.includes(uid) ? team : null,
            };
        }
        if (request === './problem') return { __esModule: true, default: { get: async () => pdoc } };
        if (request === './setting') {
            return {
                langs: {
                    'cc.cc20o2': { disabled: false },
                    'py.py3': { disabled: false },
                    'java.java17': { disabled: false },
                },
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let codeModel: typeof import('../src/model/contest-team-code');
try {
    delete require.cache[modulePath];
    codeModel = require(modulePath);
} finally {
    Module._load = originalLoad;
}

function actor(uid: number, admin = false) {
    return { _id: uid, admin } as any;
}

async function rejects(work: Promise<unknown>, errorType: new (...args: any[]) => Error) {
    const error = await work.catch((caught) => caught);
    expect(error).to.be.instanceOf(errorType);
    return error;
}

beforeEach(() => {
    snapshots.length = 0;
    counters.clear();
    team = {
        domainId: 'system',
        contestId,
        teamId,
        captainUid: 10,
        memberUids: [10, 11, 12],
        revision: 3,
        active: true,
    };
    tdoc = {
        domainId: 'system',
        docId: contestId,
        rule: 'acm',
        participationMode: 'team',
        beginAt: new Date('2020-01-01T00:00:00.000Z'),
        endAt: new Date('2100-01-01T00:00:00.000Z'),
        pids: [501],
    };
    pdoc = { domainId: 'system', docId: 501, pid: 'P0501', title: 'Snapshot', config: { langs: ['cc.cc20o2', 'py.py3'] } };
});

describe('P1.16 team code snapshots', () => {
    it('stores one immutable snapshot per selected recipient with one shared sequence', async () => {
        const result = await codeModel.createSnapshots(
            'system',
            contestId,
            actor(10),
            {
                problemId: 501,
                language: 'cc.cc20o2',
                code: 'int main() {}',
                targetUids: [11, 12],
            },
            async () => ({ clientVersion: '1.4.0' }),
            new Date('2026-07-21T10:00:00.000Z'),
        );

        expect(result).to.have.length(2);
        expect(result.map((doc) => doc.targetUid)).to.deep.equal([11, 12]);
        expect(new Set(result.map((doc) => doc.sequence)).size).to.equal(1);
        expect(result[0]).to.include({ senderUid: 10, pid: 'P0501', title: 'Snapshot', clientVersion: '1.4.0' });
        expect(result[0].code).to.equal('int main() {}');
    });

    it('rejects the whole request before writing when any target is invalid', async () => {
        await rejects(
            codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                { problemId: 501, language: 'cc.cc20o2', code: 'x', targetUids: [11, 99] },
                async () => ({ clientVersion: '1.4.0' }),
                new Date('2026-07-21T10:00:00.000Z'),
            ),
            TestValidationError,
        );
        await rejects(
            codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                {
                    problemId: 501,
                    language: 'cc.cc20o2',
                    code: 'x'.repeat(codeModel.MAX_TEAM_CODE_BYTES + 1),
                    targetUids: [11],
                },
                async () => ({ clientVersion: '1.4.0' }),
                new Date('2026-07-21T10:00:00.000Z'),
            ),
            TestValidationError,
        );
        expect(snapshots).to.have.length(0);
    });

    it('requires an active captain, an in-contest problem, a supported language and non-empty bounded source', async () => {
        team.captainUid = 11;
        await rejects(
            codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                { problemId: 501, language: 'cc.cc20o2', code: 'x', targetUids: [11] },
                async () => ({ clientVersion: '1.4.0' }),
                new Date('2026-07-21T10:00:00.000Z'),
            ),
            TestPermissionError,
        );
        team.captainUid = 10;
        await rejects(
            codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                { problemId: 501, language: 'java.java17', code: 'x', targetUids: [11] },
                async () => ({ clientVersion: '1.4.0' }),
                new Date('2026-07-21T10:00:00.000Z'),
            ),
            TestValidationError,
        );
        await rejects(
            codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                { problemId: 501, language: 'cc.cc20o2', code: '', targetUids: [11] },
                async () => ({ clientVersion: '1.4.0' }),
                new Date('2026-07-21T10:00:00.000Z'),
            ),
            TestValidationError,
        );
    });

    it('accepts the persisted YAML form of the problem language configuration', async () => {
        pdoc.config = 'type: default\nlangs:\n  - cc.cc20o2\n';
        const [snapshot] = await codeModel.createSnapshots(
            'system',
            contestId,
            actor(10),
            { problemId: 501, language: 'cc.cc20o2', code: '  int main() {}\n', targetUids: [11] },
            async () => ({ clientVersion: '1.4.0' }),
            new Date('2026-07-21T10:00:00.000Z'),
        );
        expect(snapshot.code).to.equal('  int main() {}\n');

        pdoc.config = 'type: default\n';
        const [defaultLanguageSnapshot] = await codeModel.createSnapshots(
            'system',
            contestId,
            actor(10),
            { problemId: 501, language: 'py.py3', code: 'print(1)\n', targetUids: [12] },
            async () => ({ clientVersion: '1.4.0' }),
            new Date('2026-07-21T10:00:01.000Z'),
        );
        expect(defaultLanguageSnapshot.language).to.equal('py.py3');
    });

    it('synchronously trims each recipient from 51 snapshots back to exactly 50', async () => {
        await codeModel.createSnapshots(
            'system',
            contestId,
            actor(10),
            { problemId: 501, language: 'cc.cc20o2', code: 'other-recipient', targetUids: [12] },
            async () => ({ clientVersion: '1.4.0' }),
            new Date('2026-07-21T09:59:59.000Z'),
        );
        for (let index = 0; index < 51; index++) {
            await codeModel.createSnapshots(
                'system',
                contestId,
                actor(10),
                { problemId: 501, language: 'cc.cc20o2', code: `v${index}`, targetUids: [11] },
                async () => ({ clientVersion: '1.4.0' }),
                new Date(Date.parse('2026-07-21T10:00:00.000Z') + index),
            );
        }
        expect(snapshots.filter((doc) => doc.targetUid === 11)).to.have.length(50);
        expect(snapshots.filter((doc) => doc.targetUid === 12)).to.have.length(1);
        expect(snapshots.some((doc) => doc.code === 'v0')).to.equal(false);
    });

    it('isolates recipients, allows the sender/admin, marks recipient opens, and revokes removed members', async () => {
        const [sent] = await codeModel.createSnapshots(
            'system',
            contestId,
            actor(10),
            { problemId: 501, language: 'cc.cc20o2', code: 'private', targetUids: [11] },
            async () => ({ clientVersion: '1.4.0' }),
            new Date('2026-07-21T10:00:00.000Z'),
        );

        expect((await codeModel.getAccessible('system', contestId, sent._id, actor(10)))?._id.equals(sent._id)).to.equal(true);
        expect(codeModel.snapshotState(sent)).to.equal('pending');
        expect(await codeModel.markNotified(sent._id, 11, new Date('2026-07-21T10:00:01.000Z'))).to.equal(true);
        expect(codeModel.snapshotState(sent)).to.equal('saved');
        expect((await codeModel.openAccessible('system', contestId, sent._id, actor(11)))?.openedAt).to.be.instanceOf(Date);
        expect(codeModel.snapshotState(sent)).to.equal('opened');
        await rejects(codeModel.getAccessible('system', contestId, sent._id, actor(12)), TestPermissionError);
        expect((await codeModel.getAccessible('system', contestId, sent._id, actor(99, true)))?._id.equals(sent._id)).to.equal(true);
        expect(await codeModel.listAccessible('system', contestId, actor(99, true), undefined, true)).to.have.length(1);

        team.memberUids = [10, 12];
        await rejects(codeModel.getAccessible('system', contestId, sent._id, actor(11)), TestPermissionError);
    });
});
