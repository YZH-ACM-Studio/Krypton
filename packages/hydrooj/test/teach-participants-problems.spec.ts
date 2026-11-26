import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PERM, STATUS } from '@hydrooj/common';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError } from '../src/error';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

// Load the participants module at runtime, after the model stubs are installed.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

type TeachRule = 'homework' | 'exam';

interface TeachActor {
    _id: number;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

interface JournalEntry {
    rid: ObjectId;
    pid: number;
    status?: number;
}

interface StatusRow {
    domainId: string;
    docType: number;
    docId: ObjectId;
    uid: number;
    attend: number;
    journal?: JournalEntry[];
}

type LoadTeachParticipants = (domainId: string, actor: TeachActor, type: string, id: ObjectId) => Promise<unknown>;

const TYPE_CONTEST = 30;
const domainId = 'teach-domain';
const ownerUid = 4;
const maintainerUid = 7;
const penaltySince = new Date('2026-10-16T08:00:00.000Z');
const penaltySeconds = Math.floor(penaltySince.getTime() / 1000);

const statuses: StatusRow[] = [];
let contestDoc: Record<string, unknown> | null = null;
let loadTeachParticipants: LoadTeachParticipants | null = null;

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameId(left: unknown, right: unknown): boolean {
    const leftHex = left instanceof ObjectId ? left.toHexString() : typeof left === 'string' ? left : '';
    const rightHex = right instanceof ObjectId ? right.toHexString() : typeof right === 'string' ? right : '';
    if (leftHex && rightHex) return leftHex === rightHex;
    return Object.is(left, right);
}

function asQuery(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    return null;
}

function operatorMatches(operator: string, actual: unknown, expected: unknown): boolean {
    if (operator === '$eq') return valueMatches(actual, expected);
    if (operator === '$in' && Array.isArray(expected)) return expected.some((item) => valueMatches(actual, item));
    const left = asNumber(actual);
    const right = asNumber(expected);
    if (left === null || right === null) return false;
    if (operator === '$gt') return left > right;
    if (operator === '$gte') return left >= right;
    return false;
}

function valueMatches(actual: unknown, expected: unknown): boolean {
    if (expected instanceof ObjectId || actual instanceof ObjectId) return sameId(actual, expected);
    if (isRecord(expected)) {
        const keys = Object.keys(expected);
        if (keys.length > 0 && keys.every((key) => key.startsWith('$'))) {
            return keys.every((key) => operatorMatches(key, actual, expected[key]));
        }
    }
    return Object.is(actual, expected);
}

function rowMatches(row: StatusRow, query: Record<string, unknown>): boolean {
    const record = row as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(query)) {
        if (!valueMatches(record[key], expected)) return false;
    }
    return true;
}

function cursor(rows: StatusRow[]) {
    return {
        async toArray() {
            return rows.map((row) => {
                const copy: Record<string, unknown> = { ...row };
                if (Array.isArray(row.journal)) copy.journal = row.journal.map((entry) => ({ ...entry }));
                return copy;
            });
        },
    };
}

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: [],
    } as NodeModule;
}

const contestExports = {
    RULES: {
        acm: {},
        oi: {},
        ioi: {},
        ledo: {},
        strictioi: {},
        exam: {},
        homework: { hidden: true },
    },
    async get(nextDomainId: string, id: unknown) {
        if (!contestDoc || contestDoc.domainId !== nextDomainId || !sameId(contestDoc.docId, id)) {
            throw new ContestNotFoundError(nextDomainId, id);
        }
        return contestDoc;
    },
};
const contestModule = { ...contestExports, __esModule: true, default: contestExports };

const trainingExports = {
    async get(nextDomainId: string, id: unknown) {
        throw new ContestNotFoundError(nextDomainId, id);
    },
};
const trainingModule = { ...trainingExports, __esModule: true, default: trainingExports };

const documentExports = {
    TYPE_CONTEST,
    getMultiStatus(nextDomainId: string, docType: number, query: unknown) {
        const filter = asQuery(query);
        const rows = statuses.filter((row) => row.docType === docType && row.domainId === nextDomainId && rowMatches(row, filter));
        return cursor(rows);
    },
};
const documentModule = { ...documentExports, __esModule: true, default: documentExports };

const userExports = {
    async getList(_nextDomainId: string, uids: readonly number[]) {
        const result: Record<number, { _id: number; uname: string }> = {};
        for (const uid of uids) result[uid] = { _id: uid, uname: `user-${uid}` };
        return result;
    },
};
const userModule = { ...userExports, __esModule: true, default: userExports };

installStub('../src/model/contest.ts', contestModule);
installStub('../src/model/training.ts', trainingModule);
installStub('../src/model/document.ts', documentModule);
installStub('../src/model/user.ts', userModule);

const hydroHost = global as unknown as { Hydro?: { model: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };

function isLoader(value: unknown): value is LoadTeachParticipants {
    return typeof value === 'function';
}

function loader(): LoadTeachParticipants {
    if (loadTeachParticipants) return loadTeachParticipants;
    const loaded: unknown = requireFromTest('../src/lib/teach-participants.ts');
    if (!isRecord(loaded) || !isLoader(loaded.loadTeachParticipants)) {
        throw new TypeError('teach export missing: loadTeachParticipants');
    }
    loadTeachParticipants = loaded.loadTeachParticipants;
    return loadTeachParticipants;
}

after(() => {
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

beforeEach(() => {
    statuses.length = 0;
    contestDoc = null;
});

function ridAt(offsetSeconds: number): ObjectId {
    return ObjectId.createFromTime(penaltySeconds + offsetSeconds);
}

function actor(uid: number, perms: readonly bigint[]): TeachActor {
    const permSet = new Set<bigint>(perms);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: () => false,
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function manager(rule: TeachRule): TeachActor {
    const perms = [PERM.PERM_USERBIND_MANAGE_STUDENTS];
    if (rule === 'homework') perms.push(PERM.PERM_EDIT_HOMEWORK_SELF);
    else perms.push(PERM.PERM_EDIT_CONTEST_SELF);
    return actor(maintainerUid, perms);
}

function attend(id: ObjectId, uid: number, journal?: JournalEntry[]): void {
    statuses.push({
        domainId,
        docType: TYPE_CONTEST,
        docId: id,
        uid,
        attend: 1,
        ...(journal ? { journal } : {}),
    });
}

async function loadParticipants(rule: TeachRule, rows: ReadonlyArray<{ uid: number; journal?: JournalEntry[] }>): Promise<unknown> {
    const id = new ObjectId();
    contestDoc = {
        domainId,
        docId: id,
        owner: ownerUid,
        maintainer: [maintainerUid],
        rule,
        title: '题目集',
        penaltySince,
    };
    for (const row of rows) attend(id, row.uid, row.journal);
    return withStudentDirectory(new InMemoryStudentDirectory(), () => loader()(domainId, manager(rule), rule, id));
}

function participantRow(body: unknown, uid: number): Record<string, unknown> {
    expect(isRecord(body)).to.equal(true);
    if (!isRecord(body)) throw new TypeError('participants payload');
    expect(Array.isArray(body.participants)).to.equal(true);
    if (!Array.isArray(body.participants)) throw new TypeError('participants payload');
    const found = body.participants.find((item) => isRecord(item) && item.uid === uid);
    expect(isRecord(found)).to.equal(true);
    if (!isRecord(found)) throw new TypeError(`missing participant ${uid}`);
    return found;
}

describe('teach participant problem facts', () => {
    it('counts two journal entries for one pid on that participant only', async () => {
        const body = await loadParticipants('homework', [
            {
                uid: 21,
                journal: [
                    { rid: ridAt(-240), pid: 1001 },
                    { rid: ridAt(-120), pid: 1001 },
                ],
            },
            {
                uid: 23,
                journal: [{ rid: ridAt(-120), pid: 1001 }],
            },
        ]);
        expect(participantRow(body, 21).problems).to.deep.equal({
            1001: { submits: 2, late: false },
        });
        expect(participantRow(body, 23).problems).to.deep.equal({
            1001: { submits: 1, late: false },
        });
    });

    it('marks a homework problem late only when one of its records is after the penalty time', async () => {
        const equalRid = ridAt(0);
        expect(equalRid.getTimestamp().getTime()).to.equal(penaltySince.getTime());
        const body = await loadParticipants('homework', [
            {
                uid: 21,
                journal: [
                    { rid: ridAt(120), pid: 1001 },
                    { rid: equalRid, pid: 1002 },
                    { rid: ridAt(-120), pid: 1004 },
                ],
            },
        ]);
        expect(participantRow(body, 21).problems).to.deep.equal({
            1001: { submits: 1, late: true },
            1002: { submits: 1, late: false },
            1004: { submits: 1, late: false },
        });
    });

    it('leaves exam problem lateness false when the record is after the penalty time', async () => {
        const body = await loadParticipants('exam', [
            {
                uid: 41,
                journal: [
                    { rid: ridAt(-120), pid: 1001 },
                    { rid: ridAt(120), pid: 1001 },
                ],
            },
        ]);
        expect(participantRow(body, 41).problems).to.deep.equal({
            1001: { submits: 2, late: false },
        });
    });

    it('omits pids that the participant did not submit', async () => {
        const body = await loadParticipants('homework', [
            { uid: 21, journal: [{ rid: ridAt(-120), pid: 1001 }] },
            { uid: 22 },
        ]);
        expect(participantRow(body, 21).problems).to.deep.equal({
            1001: { submits: 1, late: false },
        });
        expect(participantRow(body, 22).problems).to.deep.equal({});
    });

    it('skips canceled journal entries when counting submits and lateness', async () => {
        const body = await loadParticipants('homework', [
            {
                uid: 21,
                journal: [
                    { rid: ridAt(-120), pid: 1001, status: STATUS.STATUS_ACCEPTED },
                    { rid: ridAt(120), pid: 1001, status: STATUS.STATUS_CANCELED },
                    { rid: ridAt(120), pid: 1002, status: STATUS.STATUS_CANCELED },
                ],
            },
        ]);
        expect(participantRow(body, 21).problems).to.deep.equal({
            1001: { submits: 1, late: false },
        });
    });
});
