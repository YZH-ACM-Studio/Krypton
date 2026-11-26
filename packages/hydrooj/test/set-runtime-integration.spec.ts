import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createDraftConfig, parseSetConfig, STATUS, type SetSettings } from '@hydrooj/common';
import type { RecordDoc, Tdoc } from '../src/interface';
import { normalizeParticipationConfig, usesAcmScoring } from '../src/model/contest-participation';
import { buildVirtualContestSnapshot, evaluateVirtualContestEligibility } from '../src/lib/virtual-contest';
import { withSetParticipantBoundary } from '../src/lib/set-participant-boundary';
import { currentSetProblemPids, projectCurrentSetTdoc } from '../src/lib/set-problem-access';

const Module = require('module');
const originalLoad = Module._load;
const contestPath = require.resolve('../src/model/contest.ts');
const roundPath = require.resolve('../src/model/set-round.ts');
const recordPath = require.resolve('../src/model/record.ts');
const data = new Map<string, any[]>();
const problems = new Map<number, any>();
let storedContest: Tdoc;

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId) return right instanceof ObjectId && left.equals(right);
    if (left instanceof Date) return right instanceof Date && left.getTime() === right.getTime();
    return left === right;
}

function matches(row: any, query: any): boolean {
    return Object.entries(query).every(([key, value]: [string, any]) => {
        if (key === '$or') return value.some((clause: any) => matches(row, clause));
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
            if ('$lte' in value) return row[key] <= value.$lte;
            if ('$in' in value) return (Array.isArray(row[key]) ? row[key] : [row[key]]).some((v: unknown) => value.$in.some((i: unknown) => same(v, i)));
        }
        return same(row[key], value);
    });
}

function collection(name: string) {
    const rows = () => data.get(name) ?? [];
    return {
        find(query: any) {
            return {
                sort() { return this; },
                project() { return this; },
                toArray: async () => rows().filter((row) => matches(row, query)),
            };
        },
        findOne: async (query: any) => rows().find((row) => matches(row, query)) ?? null,
        async insertOne(row: any) {
            if (!data.has(name)) data.set(name, []);
            data.get(name)!.push(row);
            return { insertedId: row._id };
        },
        async findOneAndUpdate(query: any, update: any, options?: { upsert?: boolean }) {
            let row = rows().find((item) => matches(item, query));
            if (!row && options?.upsert) {
                row = { ...query, ...update.$setOnInsert };
                if (!data.has(name)) data.set(name, []);
                data.get(name)!.push(row);
            }
            if (!row) return null;
            Object.assign(row, update.$set);
            for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = (row[key] ?? 0) + Number(value);
            for (const key of Object.keys(update.$unset ?? {})) delete row[key];
            return { ...row };
        },
        async updateOne(query: any, update: any) {
            const row = await this.findOneAndUpdate(query, update);
            return { matchedCount: row ? 1 : 0 };
        },
        countDocuments: async (query: any) => rows().filter((row) => matches(row, query)).length,
    };
}

const problemModel = {
    get: async (_domain: string, pid: number) => problems.get(pid) ?? null,
    getList: async (_domain: string, pids: number[]) => Object.fromEntries([...problems].filter(([pid]) => pids.includes(pid))),
    claimStructureLockForSubmission: async (_domain: string, pid: number) => problems.get(pid),
};
const docModel = {
    TYPE_CONTEST: 30,
    get: async () => storedContest,
    getMultiStatus: () => collection('document.status').find({ docId: storedContest.docId }),
    setStatus: async (_domain: string, _type: number, _tid: ObjectId, uid: number, set: object) => {
        const row = data.get('document.status')!.find((item) => item.uid === uid);
        Object.assign(row, set);
        return row;
    },
    revPushStatus: async (_domain: string, _type: number, _tid: ObjectId, uid: number, _field: string, entry: object) => {
        const row = data.get('document.status')!.find((item) => item.uid === uid);
        row.journal = [entry];
        return row;
    },
    coll: collection('document'), collStatus: collection('document.status'),
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../service/db' || request === './db') return { __esModule: true, default: { collection } };
    if (request === '../service/bus' || request === './bus') return { __esModule: true, default: { parallel: async () => {} } };
    if ([contestPath, roundPath, recordPath].includes(parent?.filename)) {
        if (request === '../service/db') return { __esModule: true, default: { collection } };
        if (request === '../service/bus') return { __esModule: true, default: { parallel: async () => {} } };
        if (request === './document') return docModel;
        if (request === './problem') return { __esModule: true, default: problemModel, ProblemModel: problemModel };
        if (request === './user') {
            return { __esModule: true, default: {
                getListForRender: async (_domain: string, uids: number[]) => Object.fromEntries(uids.map((uid) => [uid, { uname: `u${uid}` }])),
            } };
        }
        if (request === './record' && parent.filename !== recordPath) {
            return { __esModule: true, default: {
                coll: collection('record'), get: async (_domain: string, rid: ObjectId) => collection('record').findOne({ _id: rid }),
            } };
        }
        if (['./message', './oplog', './domain', './system', './task'].includes(request)) return { __esModule: true, default: {} };
        if (request === './contest-team-status') {
            return { coll: collection('contest.teamStatuses'),
                getMulti: (domainId: string, contestId: ObjectId) => collection('contest.teamStatuses').find({ domainId, contestId }) };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let contest: typeof import('../src/model/contest');
let record: typeof import('../src/model/record').default;
try {
    global.Hydro ||= { model: {}, module: {}, ui: {} } as typeof global.Hydro;
    contest = require(contestPath);
    require(roundPath);
    record = require(recordPath).default;
} finally {
    Module._load = originalLoad;
}

const student = { _id: 7, own: () => false, hasPerm: () => false, hasPriv: () => false };
function setup(settings: Partial<SetSettings> = {}) {
    const draft = createDraftConfig('contest');
    storedContest = {
        domainId: 'test', _id: new ObjectId(), docId: new ObjectId(), docType: 30, owner: 1, attend: 1, duration: 0,
        title: 'Set', content: '', rule: 'contest', pids: [1], score: { 1: 100 },
        beginAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 3600000),
        setConfig: parseSetConfig({ ...draft, publication: 'published', settings: { ...draft.settings, ...settings } }),
    } as Tdoc;
    problems.set(1, { docId: 1, problemKind: 'programming', config: { type: 'default', maxScore: 100 } });
    data.set('document', [storedContest]);
    data.set('document.status', [{ uid: 7, domainId: 'test', docType: 30, docId: storedContest.docId, attend: 1, score: 9999 }]);
}
function addRound(roundNo: number, closed = false) {
    const round = { _id: new ObjectId(), domainId: 'test', tid: storedContest.docId, participantKey: 'u:7',
        roundNo, state: closed ? 'closed' : 'open', paperPids: [1], startedAt: storedContest.beginAt,
        closedAt: closed ? new Date(Date.now() - 1000) : null, total: 0 };
    data.set('contest.rounds', [...data.get('contest.rounds') ?? [], round]);
    return round;
}
function addRecord(roundId: ObjectId, score = 100, acceptedAt = new Date()) {
    const rdoc = { _id: new ObjectId(), domainId: 'test', contest: storedContest.docId, uid: 7, pid: 1,
        setRoundId: roundId, setAcceptedAt: acceptedAt, status: score === 100 ? 1 : 2, score,
        judgeAt: new Date(), time: 42, memory: 64, compilerTexts: ['private'], judgeTexts: ['private'],
        testCases: [{ score: 100 }], subtasks: { 1: { score: 100, status: 1 } }, manualGrade: { score: 100 } } as unknown as RecordDoc;
    data.set('record', [...data.get('record') ?? [], rdoc]);
    return rdoc;
}

beforeEach(() => {
    data.clear();
    problems.clear();
    setup();
});

describe('configured sets runtime integrations', () => {
    it('opens own record routes for a published contest preset without looking up a missing RULES key', () => {
        expect(contest.canShowSelfRecord.call({ user: student } as never, storedContest)).to.equal(true);
        expect(contest.canShowRecord.call({ user: student } as never, storedContest)).to.equal(false);
    });

    it('uses the record round for after-round feedback and does not mutate the original record', async () => {
        storedContest.setConfig.settings.feedback.code = { when: 'after_round', reveal: 'full', afterDeadline: 'same' };
        const closed = addRound(1, true);
        const open = addRound(2);
        const first = addRecord(closed._id);
        const second = addRecord(open._id);
        second.scoreCancellation = { before: { score: 100, status: 1 } } as RecordDoc['scoreCancellation'];
        expect((await contest.applyProjection(storedContest, first, student as never)).score).to.equal(100);
        const hidden = await contest.applyProjection(storedContest, second, student as never);
        expect(hidden.score).to.equal(undefined);
        expect(hidden.status).to.equal(undefined);
        expect(hidden.testCases).to.deep.equal([]);
        expect(hidden.manualGrade).to.equal(undefined);
        expect(hidden.scoreCancellation).to.equal(undefined);
        expect(second.score).to.equal(100);
    });

    it('keeps verdict-only feedback free of scores, cases and grading comments', async () => {
        storedContest.setConfig.settings.feedback.code = { when: 'immediate', reveal: 'verdict', afterDeadline: 'same' };
        const rdoc = addRecord(addRound(1)._id);
        const visible = await contest.applyProjection(storedContest, rdoc, student as never);
        expect(visible.status).to.equal(1);
        expect(visible.score).to.equal(undefined);
        expect(visible.testCases).to.deep.equal([]);
        expect(visible.manualGrade).to.equal(undefined);
        expect(visible.compilerTexts).to.deep.equal([]);
    });

    it('uses configured end/deadline policy instead of an old startAt or duration flag', async () => {
        storedContest.duration = 0.01;
        storedContest.setConfig.settings.personalLimit.hours = 1;
        expect(contest.isOngoing(storedContest, { startAt: new Date(0) })).to.equal(true);
        expect(contest.isDone(storedContest, { startAt: new Date(0) })).to.equal(false);
        expect(contest.homeworkStartRequired(storedContest, {})).to.equal(false);
        storedContest.setConfig.settings.feedback.code = { when: 'after_release', reveal: 'none', afterDeadline: 'full' };
        const rdoc = addRecord(addRound(1)._id);
        storedContest.endAt = new Date(Date.now() - 1);
        expect((await contest.applyProjection(storedContest, rdoc, student as never)).score).to.equal(100);
    });

    it('ranks the frozen submission facts instead of the live persistent score', async () => {
        storedContest.lockAt = new Date(Date.now() - 30000);
        const round = addRound(1);
        addRecord(round._id, 40, new Date(storedContest.lockAt.getTime() - 1000));
        addRecord(round._id, 100, new Date(storedContest.lockAt.getTime() + 1000));
        const [, rows, , dict] = await contest.getScoreboard.call({ user: student, translate: (text: string) => text } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        expect(dict[1]).to.include({ nAccept: 0, nSubmit: 1 });
        expect(rows[1].find((cell) => cell.type === 'total_score')?.value).to.equal('40/100');
        expect(data.get('document.status')![0].score).to.equal(9999);
    });

    it('counts formal submissions across rounds but counts each solver only once per question', async () => {
        storedContest.pids = [1, 2];
        problems.set(2, { docId: 2, problemKind: 'programming', config: { type: 'default', maxScore: 100 } });
        const first = addRound(1, true);
        first.paperPids.push(2);
        addRecord(first._id, 40);
        addRecord(first._id);
        const redo = addRound(2);
        redo.paperPids.push(2);
        addRecord(redo._id);
        const other = addRound(1);
        other.paperPids.push(2);
        other.participantKey = 'u:8';
        data.get('document.status')!.push({ ...data.get('document.status')![0], uid: 8 });
        addRecord(other._id, 0).uid = 8;
        Object.assign(addRecord(other._id, 0), { uid: 8, status: STATUS.STATUS_WAITING, judgeAt: null });
        addRecord(other._id).status = STATUS.STATUS_CANCELED;
        addRecord(other._id).status = STATUS.STATUS_IGNORED;
        addRecord(new ObjectId()); // Not a round of this set.
        const [, , , dict] = await contest.getScoreboard.call({ user: student, translate: (text: string) => text } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        expect(dict[1]).to.include({ nAccept: 1, nSubmit: 5 });
        expect(dict[2]).to.include({ nAccept: 0, nSubmit: 0 });
    });

    it('counts a team once when two of its members pass the same question', async () => {
        storedContest.participationMode = 'team';
        storedContest.setConfig.settings.codePolicy = 'acm';
        const teamId = new ObjectId();
        data.set('contest.teams', [{ teamId, domainId: 'test', contestId: storedContest.docId,
            active: true, captainUid: 7, memberUids: [7, 8], name: 'Team' }]);
        const round = addRound(1);
        round.participantKey = `t:${teamId.toHexString()}`;
        for (const uid of [7, 8]) Object.assign(addRecord(round._id), { uid, contestTeamId: teamId });
        const [, rows, , dict] = await contest.getScoreboard.call({ user: { ...student, hasPriv: () => true, own: () => true }, translate: String } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        expect(rows).to.have.length(2);
        expect(dict[1]).to.include({ nAccept: 1, nSubmit: 2 });
    });

    it('uses the original journal for a locked grade and withholds counts when only the grade survives', async () => {
        const round = addRound(1, true);
        const rid = ObjectId.createFromTime(Math.floor(+round.startedAt / 1000) + 60);
        const status = data.get('document.status')![0];
        Object.assign(status, { _id: new ObjectId(), journal: [{ rid, pid: 1, status: STATUS.STATUS_ACCEPTED }] });
        Object.assign(round, { detail: { 1: { pid: 1, rid, status: STATUS.STATUS_ACCEPTED, score: 100, acceptedAt: rid.getTimestamp() } },
            legacy: { sourceRule: 'ioi', sourceStatusId: status._id, missingRounds: 0, incompleteHistory: true, scoreLocked: true } });
        const board = () => contest.getScoreboard.call({ user: student, translate: String } as never, 'test', storedContest.docId,
            { isExport: false, showDisplayName: false });
        expect((await board())[3][1]).to.include({ nSubmit: 1, nAccept: 1 });
        status.journal = [];
        const [, rows, , dict] = await board();
        expect(rows[1].at(-1)?.score).to.equal(100);
        expect(dict[1]).not.to.have.property('nSubmit');
        expect(dict[1]).not.to.have.property('nAccept');
    });

    it('does not disclose scores or ranking order before code feedback opens', async () => {
        storedContest.setConfig.settings.feedback.code.when = 'after_release';
        addRecord(addRound(1)._id);
        const [, rows, , dict] = await contest.getScoreboard.call({ user: student, translate: (text: string) => text } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        expect(dict[1]).not.to.have.property('nAccept');
        expect(dict[1]).not.to.have.property('nSubmit');
        expect(rows[1].find((cell) => cell.type === 'total_score')?.value).to.equal('0/100');
        expect(rows[1].at(-1)?.value).to.equal('-');
        expect(await contest.canFilterRecordStatus(storedContest, false)).to.equal(false);
        expect(await contest.canFilterRecordStatus(storedContest, true)).to.equal(true);
    });

    it('shows ACM accepted count and penalty for the configured contest rule', async () => {
        storedContest.setConfig.settings.codePolicy = 'acm';
        storedContest.setConfig.settings.feedback.code.reveal = 'verdict';
        const round = addRound(1);
        addRecord(round._id, 0, new Date(round.startedAt.getTime() + 1000));
        addRecord(round._id, 100, new Date(round.startedAt.getTime() + 60000));
        const [, rows, , dict] = await contest.getScoreboard.call({ user: student, translate: (text: string) => text } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        expect(dict[1]).to.include({ nAccept: 1, nSubmit: 2 });
        expect(rows[1].at(-1)).not.to.have.property('problemCounts');
        expect(rows[1].find((cell) => cell.type === 'solved')?.value).to.equal('1');
        expect(rows[1].find((cell) => cell.type === 'time')?.raw).to.equal(1260);
        expect(rows[1].at(-1)?.scorePercentage).to.equal(undefined);
    });

    it('limits drawn scoreboard columns and titles to the viewer paper while preserving total ranking', async () => {
        storedContest.pids = [1, 2];
        storedContest.score = { 1: 100, 2: 100 };
        storedContest.setConfig.settings.codePolicy = 'highest';
        storedContest.setConfig.settings.draw = { enabled: true, quotas: { programming: 1 }, redrawEachRound: true, allowRepeatAcrossRounds: true };
        problems.get(1).title = 'Own question';
        problems.set(2, { docId: 2, title: 'Other drawn question', problemKind: 'programming', config: { type: 'default', maxScore: 100 } });
        addRecord(addRound(1, true)._id, 70);
        const otherRound = addRound(1, true);
        otherRound.participantKey = 'u:8';
        otherRound.paperPids = [2];
        const otherRecord = addRecord(otherRound._id, 90);
        otherRecord.uid = 8;
        otherRecord.pid = 2;
        data.get('document.status')!.push({ ...data.get('document.status')![0], uid: 8 });
        const readBoard = (actor: typeof student) => contest.getScoreboard.call({ user: actor, translate: (text: string) => text } as never,
            'test', storedContest.docId, { isExport: false, showDisplayName: false });
        const totals = (rows: Awaited<ReturnType<typeof readBoard>>[1]) => rows.slice(1).map((row) => row.find((cell) => cell.type === 'total_score')?.value);
        const [unstartedDoc, unstartedRows, , unstartedProblems] = await readBoard({ ...student, _id: 9 });
        expect(unstartedDoc.pids).to.deep.equal([]);
        expect(unstartedProblems).to.deep.equal({});
        expect(unstartedRows[0].filter((cell) => cell.type === 'problem')).to.deep.equal([]);
        expect(totals(unstartedRows)).to.deep.equal(['90/100', '70/100']);
        const [studentDoc, studentRows, , studentProblems] = await readBoard(student);
        expect(studentDoc.pids).to.deep.equal([1]);
        expect(Object.keys(studentProblems)).to.deep.equal(['1']);
        expect(JSON.stringify([studentDoc, studentRows, studentProblems])).not.to.include('Other drawn question');
        expect(studentRows[0].filter((cell) => cell.type === 'problem').map((cell) => cell.raw)).to.deep.equal([1]);
        expect(totals(studentRows)).to.deep.equal(['90/100', '70/100']);
        const [managerDoc, managerRows, , managerProblems] = await readBoard({ ...student, own: () => true, hasPerm: () => true });
        expect(managerProblems[2]).to.include({ nSubmit: 1, nAccept: 0 });
        expect(managerRows[1].at(-1)?.problemCounts).to.deep.equal({ nSubmit: 1, nAccept: 0 });
        expect(managerDoc.pids).to.deep.equal([1, 2]);
        expect(Object.keys(managerProblems)).to.deep.equal(['1', '2']);
        expect(managerRows[0].filter((cell) => cell.type === 'problem').map((cell) => cell.raw)).to.deep.equal([1, 2]);
        expect(totals(managerRows)).to.deep.equal(['90/100', '70/100']);
    });

    it('keeps projection and status persistence inside the participant boundary and passes the changed round', async () => {
        const round = addRound(1);
        const rdoc = addRecord(round._id);
        const realRoundModule = require(roundPath) as typeof import('../src/model/set-round');
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        let changed: ObjectId | undefined;
        const loadBefore = Module._load;
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (parent.filename === contestPath && request === './set-round') {
                return { ...realRoundModule, projectParticipantStatus: async (_domain: string, _tid: ObjectId, _uid: number,
                    _team: ObjectId | undefined, changedRoundId: ObjectId) => {
                    changed = changedRoundId;
                    entered();
                    await blocked;
                    return { score: 75, accept: 0, time: 0, detail: {}, display: {}, setRoundId: round._id,
                        setRoundNo: 1, setRoundClosedAt: null, setScoreRevision: 1, setJudgePending: false };
                } };
            }
            return loadBefore.call(this, request, parent, isMain);
        };
        try {
            const updating = contest.updateStatus('test', storedContest.docId, 7, rdoc._id, 1);
            await started;
            let observed: number | undefined;
            const reader = withSetParticipantBoundary('test', storedContest.docId, 'u:7', async () => {
                observed = data.get('document.status')![0].score;
            });
            await Promise.resolve();
            expect(observed).to.equal(undefined);
            release();
            await Promise.all([updating, reader]);
            expect(observed).to.equal(75);
            expect(changed?.equals(round._id)).to.equal(true);
            expect(data.get('document.status')![0].setRoundId.equals(round._id)).to.equal(true);
        } finally {
            release();
            Module._load = loadBefore;
        }
    });

    it('selects team eligibility and VP scoring from codePolicy', () => {
        storedContest.setConfig.settings.codePolicy = 'acm';
        const team = normalizeParticipationConfig({ ...storedContest, participationMode: 'team' as const });
        expect(usesAcmScoring(team)).to.equal(true);
        expect(team.entryMode).to.equal('client_required');
        expect(team.rated).to.equal(false);
        storedContest.setConfig.settings.codePolicy = 'last';
        storedContest.setConfig.settings.personalLimit.hours = 0.5;
        storedContest.duration = 10;
        expect(buildVirtualContestSnapshot(storedContest).rule).to.equal('oi');
        expect(buildVirtualContestSnapshot(storedContest).durationMs).to.equal(1800000);
        expect(evaluateVirtualContestEligibility(storedContest, { now: new Date(storedContest.endAt.getTime() + 1) }).allowed).to.equal(true);
        expect(() => normalizeParticipationConfig({ ...storedContest, participationMode: 'team' as const })).to.throw();
    });

    it('resumes an accepted manual answer without resetting its later grade', async () => {
        const round = addRound(1, true);
        const input = { domainId: 'test', tid: storedContest.docId, roundId: round._id, uid: 7, pid: 1,
            answerVersion: 1, operationId: 'operation1', rid: new ObjectId(), acceptedAt: new Date(), body: { main: 'answer' } };
        const ensured = await record.ensureManualSetAnswerRecord(input);
        expect(ensured.setRoundId.equals(round._id)).to.equal(true);
        const stored = data.get('record')![0];
        stored.score = 75;
        stored.manualGrade = { score: 75 };
        const retried = await record.ensureManualSetAnswerRecord(input);
        expect(retried.score).to.equal(75);
        expect(data.get('record')).to.have.length(1);
        let rejected = false;
        try {
            await record.ensureManualSetAnswerRecord({ ...input, answerVersion: 2 });
        } catch {
            rejected = true;
        }
        expect(rejected).to.equal(true);
    });

    it('rejects legacy formal submissions for non-code answers', async () => {
        addRound(1);
        problems.set(1, { docId: 1, problemKind: 'single', config: { type: 'objective' } });
        let failure: unknown;
        try {
            await record.add('test', 1, 7, '_', '{"main":"A"}', false, { type: 'judge', contest: storedContest.docId });
        } catch (error) {
            failure = error;
        }
        expect(failure).to.have.property('params').that.includes('type');
        expect(data.get('record') ?? []).to.have.length(0);
    });

    it('stores the final acceptance timestamp and marks the bound round before a code insert', async () => {
        const round = addRound(1);
        const previousBus = global.bus;
        global.bus = { broadcast() {} } as unknown as typeof global.bus;
        try {
            const before = Date.now();
            const autoSave = { id: '81cb59d2-b927-4ea9-8512-c707a266f71c', hash: 'deduplicated-content-hash' };
            const rid = await record.add('test', 1, 7, 'cpp', 'int main() {}', false,
                { type: 'judge', contest: storedContest.docId, setAutoSave: autoSave });
            const stored = data.get('record')![0];
            expect(stored._id.equals(rid)).to.equal(true);
            expect(stored.setRoundId.equals(round._id)).to.equal(true);
            expect(stored.setAutoSaveId).to.equal(autoSave.id);
            expect(stored.setAutoSaveHash).to.equal(autoSave.hash);
            expect(stored.setAcceptedAt.getTime()).to.be.at.least(before).and.at.most(Date.now());
            expect(data.get('contest.rounds')![0].scoreDirty).to.equal(true);
        } finally {
            global.bus = previousBus;
        }
    });

    it('marks a changed verdict dirty before its new result becomes visible', async () => {
        const round = addRound(1);
        const rdoc = addRecord(round._id, 40);
        await record.update('test', rdoc._id, { score: 90 });
        expect(data.get('contest.rounds')![0].scoreDirty).to.equal(true);
        expect(data.get('record')![0].score).to.equal(90);
    });

    it('retains the dirty marker when an explicit score mutation fails after changing the record', async () => {
        const round = addRound(1);
        const rdoc = addRecord(round._id);
        let failed = false;
        try {
            await record.withSetScoreMutation(rdoc, async () => {
                expect(data.get('contest.rounds')![0].scoreDirty).to.equal(true);
                data.get('record')![0].status = 9;
                throw new Error('projection interrupted');
            });
        } catch (error) {
            failed = error instanceof Error && error.message === 'projection interrupted';
        }
        expect(failed).to.equal(true);
        expect(data.get('contest.rounds')![0].scoreDirty).to.equal(true);
        expect(data.get('record')![0].status).to.equal(9);
    });

    it('restricts configured problem access to the latest round paper, including closed rounds', async () => {
        storedContest.pids = [1, 2, 3];
        expect(await currentSetProblemPids(storedContest, 7, false)).to.deep.equal([]);
        const oldRound = addRound(1, true);
        oldRound.paperPids = [1, 2];
        const current = addRound(2, true);
        current.paperPids = [2, 3];
        problems.set(2, { docId: 2, problemKind: 'programming', config: { type: 'default', maxScore: 100 } });
        problems.set(3, { docId: 3, problemKind: 'programming', config: { type: 'default', maxScore: 100 } });
        expect(await currentSetProblemPids(storedContest, 7, false)).to.deep.equal([2, 3]);
        expect(await currentSetProblemPids(storedContest, 7, true)).to.deep.equal([1, 2, 3]);
        storedContest.score = { 1: 10, 2: 20, 3: 30 };
        storedContest.balloon = { 1: 'red', 2: 'blue' };
        storedContest.autoHideProblemPids = [1, 2, 3];
        const safe = await projectCurrentSetTdoc(storedContest, 7, false);
        expect(safe.pids).to.deep.equal([2, 3]);
        expect(safe.score).to.deep.equal({ 2: 20, 3: 30 });
        expect(safe.balloon).to.deep.equal({ 2: 'blue' });
        expect(safe.autoHideProblemPids).to.deep.equal([2, 3]);
    });
});
