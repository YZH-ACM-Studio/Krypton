import { readStoredSetConfig } from '@hydrooj/common';
import {
    examAttemptScore,
    examAttemptsUsed,
    isExamAttemptJudgePending,
    isExamAttemptPassed,
    isExamPaperFinalized,
    isExamPaperStarted,
    readExamAttemptLimit,
    readExamPassScore,
} from './exam-paper';

export const COURSE_EXAM_ROSTER_STATES = ['not_started', 'in_progress', 'judging', 'finalized'] as const;
export type CourseExamRosterState = (typeof COURSE_EXAM_ROSTER_STATES)[number];

export interface CourseExamRosterFact {
    state: CourseExamRosterState;
    attemptsUsed: number;
    score?: number;
    passed?: boolean;
}

export interface CourseExamRosterMeta {
    title: string;
    passScore: number | null;
    attemptLimit: number;
}

export interface CourseExamRosterContest {
    title?: unknown;
    rule?: unknown;
    examPassScore?: unknown;
    examAttemptLimit?: unknown;
    setConfig?: unknown;
}

export interface CourseExamRosterStatus {
    uid?: unknown;
    startAt?: unknown;
    paperFinalizedAt?: unknown;
    score?: unknown;
    journal?: unknown;
    examAttemptsUsed?: unknown;
    setRoundId?: unknown;
    setRoundNo?: unknown;
    setRoundClosedAt?: unknown;
    setJudgePending?: unknown;
    setAttemptsUsed?: unknown;
    setCurrentRoundStartedAt?: unknown;
    setCurrentRoundClosedAt?: unknown;
}

export function courseExamRosterMeta(tdoc: CourseExamRosterContest): CourseExamRosterMeta {
    const title = typeof tdoc.title === 'string' && tdoc.title.trim() ? tdoc.title.trim() : '结业考试';
    if (tdoc.setConfig !== undefined) {
        const { settings } = readStoredSetConfig(tdoc);
        return { title, passScore: settings.retake.passScore, attemptLimit: settings.retake.extra + 1 };
    }
    return {
        title,
        passScore: readExamPassScore(tdoc),
        attemptLimit: readExamAttemptLimit(tdoc),
    };
}

export function courseExamRosterFact(
    tdoc: CourseExamRosterContest,
    tsdoc: CourseExamRosterStatus | null | undefined,
): CourseExamRosterFact {
    if (tdoc.setConfig !== undefined) {
        const { settings } = readStoredSetConfig(tdoc);
        const attemptsUsed = typeof tsdoc?.setAttemptsUsed === 'number' && Number.isSafeInteger(tsdoc.setAttemptsUsed)
            ? tsdoc.setAttemptsUsed : 0;
        if (!validDate(tsdoc?.setCurrentRoundStartedAt)) return { state: 'not_started', attemptsUsed };
        const judging = tsdoc?.setJudgePending === true;
        const state = validDate(tsdoc?.setCurrentRoundClosedAt) ? judging ? 'judging' : 'finalized' : 'in_progress';
        const chosenClosed = tsdoc?.setRoundId != null && validDate(tsdoc?.setRoundClosedAt);
        const score = tsdoc?.score;
        if (!chosenClosed || typeof score !== 'number' || !Number.isFinite(score)) return { state, attemptsUsed };
        return {
            state,
            attemptsUsed,
            score,
            ...(settings.retake.passScore !== null && !judging ? { passed: score >= settings.retake.passScore } : {}),
        };
    }
    const attemptsUsed = examAttemptsUsed(tsdoc);
    if (!isExamPaperFinalized(tsdoc)) {
        return {
            state: isExamPaperStarted(tsdoc) ? 'in_progress' : 'not_started',
            attemptsUsed,
        };
    }
    const judging = isExamAttemptJudgePending(tsdoc);
    const passScore = readExamPassScore(tdoc);
    return {
        state: judging ? 'judging' : 'finalized',
        attemptsUsed,
        score: examAttemptScore(tsdoc),
        ...(passScore !== null && !judging ? { passed: isExamAttemptPassed(tdoc, tsdoc) } : {}),
    };
}

function validDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

export function courseExamRosterFactsByUid(
    tdoc: CourseExamRosterContest,
    memberUids: readonly number[],
    statuses: readonly CourseExamRosterStatus[],
): Map<number, CourseExamRosterFact> {
    const byUid = new Map<number, CourseExamRosterStatus>();
    for (const row of statuses) {
        const uid = Number(row.uid);
        if (!Number.isSafeInteger(uid) || uid <= 1) {
            throw new TypeError('invalid course exam roster status uid');
        }
        byUid.set(uid, row);
    }
    const facts = new Map<number, CourseExamRosterFact>();
    for (const uid of memberUids) {
        if (!Number.isSafeInteger(uid) || uid <= 1) {
            throw new TypeError(`invalid course exam roster member uid=${uid}`);
        }
        facts.set(uid, courseExamRosterFact(tdoc, byUid.get(uid) || null));
    }
    return facts;
}
