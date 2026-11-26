import type { LegacyContestRule } from './set-config';

export interface LegacyRoundEvidence {
    rule: LegacyContestRule;
    beginAt: Date;
    endAt: Date;
    now: Date;
    startAt?: Date;
    finalizedAt?: Date;
    attemptsUsed?: number;
    personalLimitHours: number | null;
    hasOfficialFacts: boolean;
    hasJournalFloor: boolean;
}

export interface ProvenLegacyRound {
    roundNo: number;
    missingRounds: number;
    startedAt: Date;
    startedAtSource: 'status.startAt' | 'contest.beginAt';
    closedAt: Date | null;
    state: 'open' | 'closed';
}

function date(value: unknown, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`set_migrate_invalid_${field}`);
    return value;
}

/** A retained current attempt keeps its original ordinal; erased attempts never become empty rounds. */
export function proveLegacyRound(input: LegacyRoundEvidence): ProvenLegacyRound | null {
    const beginAt = date(input.beginAt, 'beginAt');
    const endAt = date(input.endAt, 'endAt');
    date(input.now, 'now');
    if (beginAt >= endAt) throw new TypeError('set_migrate_invalid_window');
    if (input.startAt !== undefined) date(input.startAt, 'startAt');
    if (input.finalizedAt !== undefined) date(input.finalizedAt, 'finalizedAt');
    if (input.attemptsUsed !== undefined && (!Number.isSafeInteger(input.attemptsUsed) || input.attemptsUsed < 0)) {
        throw new TypeError('set_migrate_invalid_attemptsUsed');
    }
    const used = input.attemptsUsed ?? (input.finalizedAt ? 1 : 0);
    const personalStart = input.rule === 'exam' || input.personalLimitHours !== null;
    // Untimed contest startAt was also written when merely viewing the contest.
    if ((!input.startAt || !personalStart) && !input.finalizedAt && !input.hasOfficialFacts) {
        if (used) throw new TypeError('set_migrate_current_attempt_missing');
        return null;
    }
    if (input.rule === 'exam' && !input.startAt) throw new TypeError('set_migrate_exam_start_missing');
    if (!input.startAt && input.personalLimitHours !== null) throw new TypeError('set_migrate_timed_start_missing');
    if (input.rule !== 'exam' && used > 1) throw new TypeError('set_migrate_nonexam_attempts_ambiguous');
    if (input.finalizedAt && used < 1) throw new TypeError('set_migrate_finalize_count_conflict');
    const roundNo = input.rule === 'exam' ? used + (input.finalizedAt ? 0 : 1) : 1;
    if (roundNo > 1 && !input.hasJournalFloor) throw new TypeError('set_migrate_exam_floor_missing');
    const startedAt = personalStart && input.startAt ? input.startAt : beginAt;
    if (startedAt < beginAt || startedAt >= endAt || startedAt > input.now) throw new TypeError('set_migrate_start_outside_window');
    if (input.finalizedAt && (input.finalizedAt < startedAt || input.finalizedAt > input.now)) {
        throw new TypeError('set_migrate_finalize_outside_window');
    }
    const deadline = new Date(Math.min(
        endAt.getTime(),
        input.personalLimitHours === null ? Infinity : startedAt.getTime() + input.personalLimitHours * 3_600_000,
    ));
    const closedAt = input.finalizedAt ?? (input.now >= deadline ? deadline : null);
    return {
        roundNo,
        missingRounds: roundNo - 1,
        startedAt,
        startedAtSource: personalStart && input.startAt ? 'status.startAt' : 'contest.beginAt',
        closedAt,
        state: closedAt ? 'closed' : 'open',
    };
}
