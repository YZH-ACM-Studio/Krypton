import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { Time } from '@hydrooj/utils/lib/utils';
import {
    buildVirtualContestSnapshot,
    canViewVirtualContestRecord,
    compareVirtualAttemptRank,
    contestAllowsVirtual,
    evaluateVirtualContestEligibility,
    isContestGloballyEnded,
    isVirtualAttemptOpen,
    isVirtualContestScoreFrozen,
    officialAttemptBlocksNewStart,
    rankVirtualAttempts,
    syntheticVirtualContestDoc,
    ridCreatedDuringVirtualAttempt,
    virtualAttemptWindow,
    virtualContestDurationMs,
    virtualContestLockOffsetMs,
    virtualContestSnapshotFingerprint,
} from '../src/lib/virtual-contest';

const beginAt = new Date('2026-08-01T01:00:00.000Z');
const endAt = new Date('2026-08-01T05:00:00.000Z');

function contestDoc(overrides: Record<string, unknown> = {}) {
    return {
        rule: 'acm',
        beginAt,
        endAt,
        pids: [1, 2],
        title: 'VP Source',
        ...overrides,
    } as any;
}

describe('P4.1 virtual contest eligibility and snapshot', () => {
    it('supports the locked programming rules and excludes exam, homework, and teams', () => {
        for (const rule of ['acm', 'oi', 'ioi', 'ledo', 'strictioi']) {
            expect(evaluateVirtualContestEligibility(contestDoc({ rule }), { now: endAt }).allowed).to.equal(true);
        }
        expect(evaluateVirtualContestEligibility(contestDoc({ rule: 'exam' }), { now: endAt }).reason).to.equal('rule_unsupported');
        expect(evaluateVirtualContestEligibility(contestDoc({ rule: 'homework' }), { now: endAt }).reason).to.equal('rule_unsupported');
        expect(evaluateVirtualContestEligibility(contestDoc({ participationMode: 'team' }), { now: endAt }).reason).to.equal('team_contest');
        expect(evaluateVirtualContestEligibility(contestDoc({ allowVirtual: false }), { now: endAt }).reason).to.equal('virtual_disabled');
        expect(contestAllowsVirtual({})).to.equal(true);
        expect(evaluateVirtualContestEligibility(contestDoc({ pids: [] }), { now: endAt }).reason).to.equal('no_problems');
        expect(evaluateVirtualContestEligibility(contestDoc({ _code: 'secret' }), { now: endAt }).reason).to.equal('invite_required');
        expect(evaluateVirtualContestEligibility(contestDoc({ _code: 'secret' }), { now: endAt, attended: true }).allowed).to.equal(true);
        expect(evaluateVirtualContestEligibility(contestDoc(), { now: endAt, missingProblems: true }).reason).to.equal('missing_problems');
    });

    it('starts only after the global contest end, not a personal duration expiry', () => {
        const beforeEnd = new Date(endAt.getTime() - 1);
        expect(isContestGloballyEnded(contestDoc(), beforeEnd)).to.equal(false);
        expect(evaluateVirtualContestEligibility(contestDoc(), { now: beforeEnd }).reason).to.equal('not_ended');
        expect(evaluateVirtualContestEligibility(contestDoc(), { now: endAt }).allowed).to.equal(true);
        expect(
            evaluateVirtualContestEligibility(contestDoc({ duration: 1 }), { now: new Date(beginAt.getTime() + Time.hour), hasSubjective: false })
                .reason,
        ).to.equal('not_ended');
    });

    it('rejects contests with subjective or manual-grade problems', () => {
        expect(evaluateVirtualContestEligibility(contestDoc(), { now: endAt, hasSubjective: true }).reason).to.equal('has_subjective');
        expect(evaluateVirtualContestEligibility(contestDoc(), { now: endAt, hasManualGrade: true }).reason).to.equal('has_manual_grade');
    });

    it('snapshots fixed windows, flexible duration, and lock offset without copying live problems later', () => {
        const lockAt = new Date(endAt.getTime() - 60 * 60_000);
        const snapshot = buildVirtualContestSnapshot(contestDoc({ lockAt, score: { 1: 200 }, langs: ['cpp'] }));
        expect(snapshot.durationMs).to.equal(4 * Time.hour);
        expect(snapshot.lockOffsetMs).to.equal(3 * Time.hour);
        expect(snapshot.pids).to.deep.equal([1, 2]);
        expect(snapshot.score[1]).to.equal(200);
        const flexible = virtualContestDurationMs(contestDoc({ duration: 2.5 }));
        expect(flexible).to.equal(Math.round(2.5 * Time.hour));
        expect(virtualContestLockOffsetMs(contestDoc())).to.equal(null);
        const window = virtualAttemptWindow(endAt, snapshot.durationMs);
        expect(window.endAt.getTime() - window.startAt.getTime()).to.equal(snapshot.durationMs);
        const synthetic = syntheticVirtualContestDoc({
            domainId: 'system',
            sourceContestId: new ObjectId(),
            snapshot,
            startAt: window.startAt,
            endAt: window.endAt,
        });
        expect(synthetic.beginAt).to.equal(window.startAt);
        expect(synthetic.lockAt?.getTime()).to.equal(window.startAt.getTime() + snapshot.lockOffsetMs!);
    });

    it('keeps one official attempt and treats only an active window as open', () => {
        expect(officialAttemptBlocksNewStart('active')).to.equal(true);
        expect(officialAttemptBlocksNewStart('ended')).to.equal(true);
        expect(officialAttemptBlocksNewStart('cancelled')).to.equal(false);
        expect(officialAttemptBlocksNewStart('voided')).to.equal(false);
        const startAt = new Date('2026-08-02T00:00:00.000Z');
        const attempt = { status: 'active' as const, startAt, endAt: new Date(startAt.getTime() + 1000) };
        expect(isVirtualAttemptOpen(attempt, startAt)).to.equal(true);
        expect(isVirtualAttemptOpen(attempt, attempt.endAt)).to.equal(false);
        expect(isVirtualAttemptOpen({ ...attempt, status: 'ended' }, startAt)).to.equal(false);
        const lockAttempt = {
            status: 'active' as const,
            startAt,
            endAt: new Date(startAt.getTime() + 4 * Time.hour),
            snapshot: { lockOffsetMs: Time.hour },
        };
        expect(isVirtualContestScoreFrozen(lockAttempt, new Date(startAt.getTime() + Time.hour - 1))).to.equal(false);
        expect(isVirtualContestScoreFrozen(lockAttempt, new Date(startAt.getTime() + Time.hour))).to.equal(true);
        expect(isVirtualContestScoreFrozen({ ...lockAttempt, status: 'ended' }, new Date(startAt.getTime() + Time.hour))).to.equal(false);
    });

    it('ranks attempts with the same official statusSort and tie rules', () => {
        const ranked = rankVirtualAttempts(
            [
                { uid: 1, accept: 2, time: 300 },
                { uid: 2, accept: 3, time: 500 },
                { uid: 3, accept: 2, time: 300 },
            ],
            { accept: -1, time: 1 },
            (row) => row,
        );
        expect(ranked.map(([rank, row]) => [rank, row.uid])).to.deep.equal([
            [1, 2],
            [2, 1],
            [2, 3],
        ]);
        expect(compareVirtualAttemptRank({ score: -1 }, { score: 80 }, { score: 100 })).to.be.greaterThan(0);
    });

    it('keeps in-progress virtual records private except to the owner and managers', () => {
        expect(
            canViewVirtualContestRecord({
                attempt: { uid: 8, status: 'active' },
                viewerUid: 8,
                canManage: false,
                viewerHasEnded: false,
            }),
        ).to.equal(true);
        expect(
            canViewVirtualContestRecord({
                attempt: { uid: 8, status: 'active' },
                viewerUid: 9,
                canManage: false,
                viewerHasEnded: true,
            }),
        ).to.equal(false);
        expect(
            canViewVirtualContestRecord({
                attempt: { uid: 8, status: 'ended' },
                viewerUid: 9,
                canManage: false,
                viewerHasEnded: true,
            }),
        ).to.equal(true);
        expect(
            canViewVirtualContestRecord({
                attempt: { uid: 8, status: 'active' },
                viewerUid: 9,
                canManage: true,
                viewerHasEnded: false,
            }),
        ).to.equal(true);
    });

    it('fingerprints snapshot identity and only counts rids created inside the attempt window', () => {
        const snapshot = buildVirtualContestSnapshot(contestDoc({ score: { 2: 100, 1: 200 }, lockAt: new Date(beginAt.getTime() + Time.hour) }));
        const same = virtualContestSnapshotFingerprint({ ...snapshot, score: { 1: 200, 2: 100 } });
        expect(same).to.equal(virtualContestSnapshotFingerprint(snapshot));
        expect(virtualContestSnapshotFingerprint({ ...snapshot, pids: [2, 1] })).to.not.equal(same);
        expect(virtualContestSnapshotFingerprint({ ...snapshot, durationMs: snapshot.durationMs + 1 })).to.not.equal(same);
        const startAt = new Date('2026-08-10T04:00:00.100Z');
        const window = virtualAttemptWindow(startAt, Time.hour);
        expect(window.startAt.getTime()).to.equal(Math.floor(startAt.getTime() / 1000) * 1000);
        expect(ridCreatedDuringVirtualAttempt(ObjectId.createFromTime(Math.floor(startAt.getTime() / 1000)), window)).to.equal(true);
        expect(ridCreatedDuringVirtualAttempt(ObjectId.createFromTime(Math.floor(window.endAt.getTime() / 1000)), window)).to.equal(false);
    });
});
