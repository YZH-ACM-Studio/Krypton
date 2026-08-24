import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

(global as any).Hydro ||= { model: {} };
const { PERM, PRIV, STATUS } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');
const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const problemPath = require.resolve('../src/model/problem.ts');
const virtualPath = require.resolve('../src/model/virtual-contest.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { collection: () => ({ createIndex: async () => 'ok', find: () => ({ toArray: async () => [] }) }) },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_CONTEST: 30 },
} as NodeModule;
require.cache[problemPath] = {
    id: problemPath,
    filename: problemPath,
    loaded: true,
    exports: { async getList() { return {}; } },
} as NodeModule;
delete require.cache[virtualPath];
const { VirtualContestService } = require(virtualPath) as typeof import('../src/model/virtual-contest');

const domainId = 'system';
const contestId = new ObjectId();
const uid = 42;
const beginAt = new Date('2026-08-01T01:00:00.000Z');
const endAt = new Date('2026-08-01T03:00:00.000Z');
let now = new Date(endAt);

function actor(overrides: Record<string, unknown> = {}) {
    return {
        _id: uid,
        hasPerm: (perm: bigint) => perm === PERM.PERM_EDIT_CONTEST,
        hasPriv: (priv: number) => priv !== PRIV.PRIV_EDIT_SYSTEM,
        own: () => false,
        ...overrides,
    };
}

function match(row: any, filter: any) {
    for (const [key, value] of Object.entries(filter || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in (value as any)) {
            if (!(value as any).$in.some((item: unknown) => String(row[key]) === String(item))) return false;
            continue;
        }
        if (value instanceof ObjectId || (value && typeof value === 'object' && (value as any)._bsontype)) {
            if (String(row[key]) !== String(value)) return false;
            continue;
        }
        if (row[key] !== value && String(row[key]) !== String(value)) return false;
    }
    return true;
}

function memory<T extends { _id: ObjectId }>(rows: T[]) {
    return {
        async createIndex() {
            return 'ok';
        },
        find(filter: any = {}) {
            return {
                async toArray() {
                    return rows.filter((row) => match(row, filter));
                },
            };
        },
        async findOne(filter: any) {
            return rows.find((row) => match(row, filter)) || null;
        },
        async insertOne(doc: T) {
            if (rows.some((row) => String(row._id) === String(doc._id))) {
                const error: any = new Error('duplicate');
                error.code = 11000;
                throw error;
            }
            if (
                (doc as any).status === 'active' &&
                rows.some(
                    (row: any) =>
                        row.status === 'active' &&
                        row.domainId === (doc as any).domainId &&
                        String(row.sourceContestId) === String((doc as any).sourceContestId) &&
                        row.uid === (doc as any).uid,
                )
            ) {
                const error: any = new Error('duplicate');
                error.code = 11000;
                throw error;
            }
            rows.push(doc);
            return { insertedId: doc._id };
        },
        async updateOne(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return { matchedCount: 0, modifiedCount: 0 };
            Object.assign(current, update.$set || {});
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return null;
            Object.assign(current, update.$set || {});
            return current;
        },
        async deleteMany() {
            rows.length = 0;
        },
    };
}

function service(tdoc: any = {}) {
    const rows: any[] = [];
    return {
        rows,
        svc: new VirtualContestService({
            attempts: memory(rows) as any,
            now: () => now,
            loadContest: async () => ({
                domainId,
                docId: contestId,
                rule: 'acm',
                beginAt,
                endAt,
                pids: [11, 12],
                title: 'Source',
                participationMode: 'individual',
                ...tdoc,
            }),
            loadProblems: async () => [
                { docId: 11, problemKind: 'programming' },
                { docId: 12, problemKind: 'programming' },
            ],
            scoreAttempt(_tdoc, journal) {
                const accept = new Set(journal.filter((entry) => entry.status === STATUS.STATUS_ACCEPTED).map((entry) => entry.pid)).size;
                return { accept, time: journal.length, detail: {}, display: {} };
            },
        }),
    };
}

async function expectReject(work: Promise<unknown>) {
    try {
        await work;
        expect.fail('expected rejection');
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
    }
}

describe('P4.1 virtual contest attempt machine', () => {
    it('starts an attempt after global end and rejects a second official start', async () => {
        now = new Date(endAt);
        const { svc } = service();
        const first = await svc.start({ domainId, sourceContestId: contestId, uid });
        expect(first.status).to.equal('active');
        expect(first.endAt.getTime() - first.startAt.getTime()).to.equal(endAt.getTime() - beginAt.getTime());
        await expectReject(svc.start({ domainId, sourceContestId: contestId, uid }));
        await expectReject(svc.start({ domainId, sourceContestId: contestId, uid: uid }));
    });

    it('allows cancel before the first record and restart, then locks after a submission', async () => {
        now = new Date(endAt);
        const { svc } = service();
        const first = await svc.start({ domainId, sourceContestId: contestId, uid });
        await svc.cancel({ domainId, attemptId: first._id, uid });
        const second = await svc.start({ domainId, sourceContestId: contestId, uid });
        expect(second.status).to.equal('active');
        await svc.markFirstRecord({ domainId, attemptId: second._id, uid, pid: 11 });
        await expectReject(svc.cancel({ domainId, attemptId: second._id, uid }));
        const third = await svc.start({ domainId, sourceContestId: contestId, uid: uid + 1 });
        await svc.updateStatus({
            domainId,
            attemptId: third._id,
            uid: uid + 1,
            rid: ObjectId.createFromTime(Math.floor(now.getTime() / 1000) + 3),
            pid: 11,
            result: { status: STATUS.STATUS_WAITING, score: 0 },
        });
        const locked = await svc.getAttempt(domainId, third._id);
        expect(locked.firstRecordAt).to.be.instanceOf(Date);
        await expectReject(svc.cancel({ domainId, attemptId: third._id, uid: uid + 1 }));
    });

    it('settles an active attempt when the window ends and scores without writing contest status', async () => {
        now = new Date(endAt);
        const { svc, rows } = service();
        const attempt = await svc.start({ domainId, sourceContestId: contestId, uid });
        const rid = ObjectId.createFromTime(Math.floor(now.getTime() / 1000) + 10);
        await svc.updateStatus({
            domainId,
            attemptId: attempt._id,
            uid,
            rid,
            pid: 11,
            result: { status: STATUS.STATUS_ACCEPTED, score: 100 },
        });
        now = new Date(attempt.endAt.getTime() + 1);
        const settled = await svc.getAttempt(domainId, attempt._id);
        expect(settled.status).to.equal('ended');
        expect(settled.accept).to.equal(1);
        expect(rows.some((row) => row.status === 'ended')).to.equal(true);
    });

    it('merges an in-window rid after the window ends and restats unlocked in the same write', async () => {
        now = new Date(endAt);
        const { svc } = service();
        const attempt = await svc.start({ domainId, sourceContestId: contestId, uid });
        const rid = ObjectId.createFromTime(Math.floor(attempt.startAt.getTime() / 1000) + 10);
        now = new Date(attempt.endAt.getTime() + 1);
        const updated = await svc.updateStatus({
            domainId,
            attemptId: attempt._id,
            uid,
            rid,
            pid: 11,
            result: { status: STATUS.STATUS_ACCEPTED, score: 100 },
        });
        expect(updated.status).to.equal('ended');
        expect(updated.accept).to.equal(1);
        expect(updated.endedAt).to.be.instanceOf(Date);
        const late = ObjectId.createFromTime(Math.floor(attempt.endAt.getTime() / 1000) + 5);
        await expectReject(
            svc.updateStatus({
                domainId,
                attemptId: attempt._id,
                uid,
                rid: late,
                pid: 11,
                result: { status: STATUS.STATUS_ACCEPTED, score: 100 },
            }),
        );
    });

    it('still merges an in-window rid after another reader has already settled the attempt', async () => {
        now = new Date(endAt);
        const { svc } = service();
        const attempt = await svc.start({ domainId, sourceContestId: contestId, uid });
        const rid = ObjectId.createFromTime(Math.floor(attempt.startAt.getTime() / 1000) + 20);
        now = new Date(attempt.endAt.getTime() + 1);
        const settled = await svc.getAttempt(domainId, attempt._id);
        expect(settled.status).to.equal('ended');
        expect(settled.accept || 0).to.equal(0);
        const updated = await svc.updateStatus({
            domainId,
            attemptId: attempt._id,
            uid,
            rid,
            pid: 12,
            result: { status: STATUS.STATUS_ACCEPTED, score: 100 },
        });
        expect(updated.status).to.equal('ended');
        expect(updated.accept).to.equal(1);
        expect(updated.journal.some((entry) => String(entry.rid) === String(rid))).to.equal(true);
    });

    it('voids an official attempt after confirmation so a new start is allowed', async () => {
        now = new Date(endAt);
        const { svc } = service();
        const attempt = await svc.start({ domainId, sourceContestId: contestId, uid });
        await svc.end({ domainId, attemptId: attempt._id, actor: actor(), uid });
        const ended = await svc.getAttempt(domainId, attempt._id);
        await expectReject(svc.voidAttempt({ domainId, attemptId: ended._id, actor: actor(), confirmation: 'nope' }));
        await svc.voidAttempt({
            domainId,
            attemptId: ended._id,
            actor: actor(),
            confirmation: `VOID-VP:${ended._id.toHexString()}:${ended.rev}`,
        });
        const restarted = await svc.start({ domainId, sourceContestId: contestId, uid });
        expect(restarted.status).to.equal('active');
    });
});
