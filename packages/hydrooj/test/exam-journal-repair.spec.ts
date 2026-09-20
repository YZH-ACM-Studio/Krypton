import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import {
    examJournalEntryFromRecord,
    isExamJournalPendingStatus,
    mergeExamJournalEntry,
    rebuildExamJournalFromRecords,
} from '../src/lib/exam-paper';
import { runContestRecalcStatusCommand } from '../src/commands/contest-recalc-status';

const STATUS_WAITING = 0;
const STATUS_ACCEPTED = 1;
const STATUS_WRONG_ANSWER = 2;
const STATUS_JUDGING = 20;

function rid(n: number): ObjectId {
    return ObjectId.createFromTime(1_700_000_000 + n);
}

const contestId = rid(1);
const judged = rid(10);
const waiting = rid(11);
const older = rid(2);

describe('exam journal merge', () => {
    it('keeps a judged entry when a waiting placeholder arrives for the same rid', () => {
        const existing = {
            rid: judged,
            pid: 3272,
            status: STATUS_ACCEPTED,
            score: 100,
            lang: '_',
        };
        const merged = mergeExamJournalEntry(existing, {
            rid: judged,
            pid: 3272,
            status: STATUS_WAITING,
            score: 0,
        });
        expect(merged).to.deep.equal(existing);
    });

    it('rejects a placeholder that still has pid 0', () => {
        expect(() =>
            mergeExamJournalEntry(undefined, {
                rid: judged,
                pid: 0,
                status: STATUS_WAITING,
                score: 0,
            }),
        ).to.throw(TypeError, 'exam_journal_pid_invalid');
    });

    it('lets a later judged result replace a waiting placeholder', () => {
        const incoming = {
            rid: waiting,
            pid: 3278,
            status: STATUS_ACCEPTED,
            score: 100,
        };
        expect(
            mergeExamJournalEntry(
                { rid: waiting, pid: 3278, status: STATUS_WAITING, score: 0 },
                incoming,
            ),
        ).to.deep.equal(incoming);
    });

    it('fills pid 0 on an otherwise judged entry from the incoming pid', () => {
        expect(
            mergeExamJournalEntry(
                { rid: judged, pid: 0, status: STATUS_ACCEPTED, score: 100 },
                { rid: judged, pid: 3272, status: STATUS_WAITING, score: 0 },
            ),
        ).to.deep.equal({ rid: judged, pid: 3272, status: STATUS_ACCEPTED, score: 100 });
    });
});

describe('exam journal rebuild from records', () => {
    it('replaces pid-0 journal rows with the matching record facts', () => {
        const journal = rebuildExamJournalFromRecords(
            {
                uid: 874,
                examJournalAfter: older,
                journal: [{ rid: judged, pid: 0, status: STATUS_WAITING, score: 0 }],
            },
            [
                {
                    _id: judged,
                    uid: 874,
                    pid: 3272,
                    status: STATUS_ACCEPTED,
                    score: 100,
                    lang: '_',
                    contest: contestId,
                },
            ],
            { uid: 874, contestId },
        );
        expect(journal).to.deep.equal([
            { rid: judged, pid: 3272, status: STATUS_ACCEPTED, score: 100, lang: '_' },
        ]);
    });

    it('includes after-floor records that never made it into journal', () => {
        const journal = rebuildExamJournalFromRecords(
            { uid: 874, examJournalAfter: older, journal: [] },
            [
                {
                    _id: judged,
                    uid: 874,
                    pid: 3272,
                    status: STATUS_WRONG_ANSWER,
                    score: 0,
                    contest: contestId,
                },
            ],
            { uid: 874, contestId },
        );
        expect(journal.map((entry) => entry.pid)).to.deep.equal([3272]);
    });

    it('drops pre-floor records and fails closed on a missing journal rid', () => {
        expect(
            rebuildExamJournalFromRecords(
                { uid: 874, examJournalAfter: judged, journal: [] },
                [
                    {
                        _id: older,
                        uid: 874,
                        pid: 3272,
                        status: STATUS_ACCEPTED,
                        score: 100,
                        contest: contestId,
                    },
                ],
                { uid: 874, contestId },
            ),
        ).to.deep.equal([]);
        expect(() =>
            rebuildExamJournalFromRecords(
                { uid: 874, journal: [{ rid: judged, pid: 0, status: STATUS_WAITING, score: 0 }] },
                [],
                { uid: 874, contestId },
            ),
        ).to.throw(TypeError, /exam_journal_record_missing/);
    });

    it('preserves journal manual and rejects a record from another contest', () => {
        const journal = rebuildExamJournalFromRecords(
            {
                uid: 874,
                journal: [{ rid: judged, pid: 0, status: STATUS_WAITING, score: 0, manual: true }],
            },
            [
                {
                    _id: judged,
                    uid: 874,
                    pid: 3272,
                    status: STATUS_WAITING,
                    score: 0,
                    contest: contestId,
                },
            ],
            { uid: 874, contestId },
        );
        expect(journal[0].manual).to.equal(true);
        expect(() =>
            rebuildExamJournalFromRecords(
                { uid: 874, journal: [] },
                [
                    {
                        _id: judged,
                        uid: 874,
                        pid: 3272,
                        status: STATUS_ACCEPTED,
                        score: 100,
                        contest: rid(99),
                    },
                ],
                { uid: 874, contestId },
            ),
        ).to.throw(TypeError, 'exam_journal_contest_mismatch');
    });
});

describe('exam journal helpers', () => {
    it('treats waiting/judging as pending and requires a real pid on record facts', () => {
        expect(isExamJournalPendingStatus(STATUS_WAITING)).to.equal(true);
        expect(isExamJournalPendingStatus(STATUS_JUDGING)).to.equal(true);
        expect(isExamJournalPendingStatus(STATUS_ACCEPTED)).to.equal(false);
        expect(() =>
            examJournalEntryFromRecord({
                _id: judged,
                uid: 874,
                pid: 0,
                status: STATUS_WAITING,
                contest: contestId,
            }),
        ).to.throw(TypeError, 'exam_journal_pid_invalid');
    });
});

describe('contest recalc-status command', () => {
    it('rebuilds through contest.recalcStatus and returns scores', async () => {
        const tid = rid(50);
        let loaded = 0;
        const result = await runContestRecalcStatusCommand('system', tid.toHexString(), {
            async loadContest() {
                loaded += 1;
                return {
                    async get(domainId: string, contestId: ObjectId) {
                        expect(domainId).to.equal('system');
                        expect(contestId.equals(tid)).to.equal(true);
                        return { rule: 'exam', docId: tid };
                    },
                    async recalcStatus(domainId: string, contestId: ObjectId) {
                        expect(domainId).to.equal('system');
                        expect(contestId.equals(tid)).to.equal(true);
                        return [{ uid: 874, score: 92, journal: [{ pid: 3272 }] }];
                    },
                } as any;
            },
        });
        expect(loaded).to.equal(1);
        expect(result).to.deep.equal({
            ok: true,
            domainId: 'system',
            tid: tid.toHexString(),
            rule: 'exam',
            rows: [{ uid: 874, score: 92, journal: 1 }],
        });
    });
});
