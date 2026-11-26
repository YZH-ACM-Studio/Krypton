import { expect } from 'chai';
import { describe, it } from 'node:test';
import { proveLegacyRound, type LegacyRoundEvidence } from '../set-migrate';

const beginAt = new Date('2026-11-01T00:00:00Z');
const endAt = new Date('2026-11-01T02:00:00Z');
const now = new Date('2026-11-01T03:00:00Z');
const evidence: LegacyRoundEvidence = {
    rule: 'exam', beginAt, endAt, now, startAt: beginAt, finalizedAt: endAt,
    attemptsUsed: 3, personalLimitHours: null, hasOfficialFacts: true, hasJournalFloor: true,
};

describe('legacy round evidence', () => {
    it('preserves the real attempt ordinal and records erased history without placeholders', () => {
        expect(proveLegacyRound(evidence)).to.deep.equal({
            roundNo: 3, missingRounds: 2, startedAt: beginAt, startedAtSource: 'status.startAt', closedAt: endAt, state: 'closed',
        });
        expect(proveLegacyRound({ ...evidence, finalizedAt: undefined, now: new Date('2026-11-01T01:00:00Z') })?.roundNo).to.equal(4);
    });
    it('does not invent a round for attendance or drafts without a start or official facts', () => {
        expect(proveLegacyRound({ ...evidence, startAt: undefined, finalizedAt: undefined, attemptsUsed: undefined, hasOfficialFacts: false })).to.equal(null);
    });
    it('requires the exam start and current-attempt journal floor', () => {
        expect(() => proveLegacyRound({ ...evidence, startAt: undefined })).to.throw('set_migrate_exam_start_missing');
        expect(() => proveLegacyRound({ ...evidence, hasJournalFloor: false })).to.throw('set_migrate_exam_floor_missing');
    });
    it('uses contest begin for an untimed legacy submission, and refuses an unprovable personal deadline', () => {
        const input = { ...evidence, rule: 'oi' as const, startAt: undefined, finalizedAt: undefined, attemptsUsed: undefined };
        expect(proveLegacyRound(input)?.startedAtSource).to.equal('contest.beginAt');
        expect(() => proveLegacyRound({ ...input, personalLimitHours: 1 })).to.throw('set_migrate_timed_start_missing');
    });
    it('closes a proven started attempt at its personal deadline without inventing answers', () => {
        expect(proveLegacyRound({ ...evidence, attemptsUsed: 0, finalizedAt: undefined, personalLimitHours: 1, hasOfficialFacts: false })?.closedAt)
            .to.deep.equal(new Date('2026-11-01T01:00:00Z'));
    });
    it('does not use untimed contest attendance as a start, including visits outside the window', () => {
        for (const startAt of [new Date(beginAt.getTime() - 60_000), new Date(endAt.getTime() + 60_000)]) {
            const input = { ...evidence, rule: 'ioi' as const, startAt, finalizedAt: undefined, attemptsUsed: undefined };
            expect(proveLegacyRound(input)?.startedAt).to.deep.equal(beginAt);
            expect(proveLegacyRound(input)?.startedAtSource).to.equal('contest.beginAt');
            expect(proveLegacyRound({ ...input, hasOfficialFacts: false })).to.equal(null);
            expect(() => proveLegacyRound({ ...input, personalLimitHours: 1 })).to.throw('set_migrate_start_outside_window');
        }
    });
});
