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
}

export interface CourseExamRosterStatus {
    uid?: unknown;
    startAt?: unknown;
    paperFinalizedAt?: unknown;
    score?: unknown;
    journal?: unknown;
    examAttemptsUsed?: unknown;
}

export function courseExamRosterMeta(tdoc: CourseExamRosterContest): CourseExamRosterMeta {
    const title = typeof tdoc.title === 'string' && tdoc.title.trim() ? tdoc.title.trim() : '结业考试';
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
