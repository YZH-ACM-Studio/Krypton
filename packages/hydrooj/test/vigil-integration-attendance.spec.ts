import { expect } from 'chai';
import { existsSync } from 'fs';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { resolve } from 'path';

const Module = require('module');
const contestId = new ObjectId('64a000000000000000000702');
const calls: Array<{ action: string; domainId?: string; uid?: number; subscribe?: number }> = [];
let attended = false;
let persistAttendance = true;
let contestExists = true;

class TestValidationError extends Error {}
class TestNotFoundError extends Error {}

const contestStub = {
    get: async (domainId: string, tid: ObjectId) => {
        calls.push({ action: 'get', domainId });
        expect(tid.equals(contestId)).to.equal(true);
        return contestExists ? { docId: tid } : null;
    },
    getStatus: async (domainId: string, tid: ObjectId, uid: number) => {
        calls.push({ action: attended ? 'status-attended' : 'status-missing', domainId, uid });
        expect(tid.equals(contestId)).to.equal(true);
        return attended ? { attend: 1 } : null;
    },
    isDone: () => false,
    attend: async (domainId: string, tid: ObjectId, uid: number, options: { subscribe: number }) => {
        calls.push({ action: 'attend', domainId, uid, subscribe: options.subscribe });
        expect(tid.equals(contestId)).to.equal(true);
        if (persistAttendance) attended = true;
    },
    isOngoing: () => true,
    setStatus: async (domainId: string, tid: ObjectId, uid: number) => {
        calls.push({ action: 'set-status', domainId, uid });
        expect(tid.equals(contestId)).to.equal(true);
    },
};

const modulePath = require.resolve('../src/lib/vigil-integration-attendance.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === 'hydrooj') {
            return {
                NotFoundError: TestNotFoundError,
                OplogModel: {
                    log: async (_handler: unknown, type: string, data: { uid: number }) => {
                        calls.push({ action: type, uid: data.uid });
                    },
                },
                ValidationError: TestValidationError,
            };
        }
        if (request === '../model/contest') return contestStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let attendance: typeof import('../src/lib/vigil-integration-attendance');
try {
    delete require.cache[modulePath];
    attendance = require(modulePath);
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    calls.length = 0;
    attended = false;
    persistAttendance = true;
    contestExists = true;
    (global as any).Hydro = {
        model: {
            vigilguard: {
                invalidateLockoutCache(domainId: string, uid: number) {
                    calls.push({ action: 'invalidate', domainId, uid });
                },
            },
        },
    };
});

describe('P1.28 Vigil Client attendance transition', () => {
    it('keeps the non-plugin helper outside the auto-loaded handler directory', () => {
        expect(existsSync(resolve(__dirname, '../src/handler/vigil-integration-attendance.ts'))).to.equal(false);
        expect(existsSync(resolve(__dirname, '../src/lib/vigil-integration-attendance.ts'))).to.equal(true);
    });

    it('persists attendance, invalidates the exact user cache, audits, then starts the contest status', async () => {
        await attendance.ensureVigilContestParticipation({} as any, 'system', contestId.toHexString(), 64);

        expect(calls).to.deep.equal([
            { action: 'get', domainId: 'system' },
            { action: 'status-missing', domainId: 'system', uid: 64 },
            { action: 'attend', domainId: 'system', uid: 64, subscribe: 1 },
            { action: 'status-attended', domainId: 'system', uid: 64 },
            { action: 'invalidate', domainId: 'system', uid: 64 },
            { action: 'vigilguard.auto_attend', uid: 64 },
            { action: 'set-status', domainId: 'system', uid: 64 },
        ]);
    });

    it('invalidates an existing attended session without fabricating an auto-attend audit', async () => {
        attended = true;
        await attendance.ensureVigilContestParticipation({} as any, 'system', contestId.toHexString(), 65);

        expect(calls).to.deep.equal([
            { action: 'get', domainId: 'system' },
            { action: 'status-attended', domainId: 'system', uid: 65 },
            { action: 'invalidate', domainId: 'system', uid: 65 },
            { action: 'set-status', domainId: 'system', uid: 65 },
        ]);
    });

    it('fails before cache invalidation when auto-attendance was not persisted', async () => {
        persistAttendance = false;
        let error: unknown;
        try {
            await attendance.ensureVigilContestParticipation({} as any, 'system', contestId.toHexString(), 66);
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('did not persist');
        expect(calls.some(({ action }) => action === 'invalidate')).to.equal(false);
    });

    it('fails closed on malformed launch identity before reading or mutating contest state', async () => {
        for (const [id, uid] of [
            [undefined, 67],
            ['not-an-object-id', 67],
            [contestId.toHexString(), 0],
        ] as const) {
            calls.length = 0;
            let error: unknown;
            try {
                await attendance.ensureVigilContestParticipation({} as any, 'system', id, uid);
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(TestValidationError);
            expect(calls).to.deep.equal([]);
        }
    });

    it('fails closed if the contest was deleted after Vigil token verification', async () => {
        contestExists = false;
        let error: unknown;
        try {
            await attendance.ensureVigilContestParticipation({} as any, 'system', contestId.toHexString(), 68);
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(TestNotFoundError);
        expect(calls).to.deep.equal([{ action: 'get', domainId: 'system' }]);
    });
});
