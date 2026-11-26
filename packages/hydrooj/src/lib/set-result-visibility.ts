import { feedbackOpen, feedbackSideForProblem, type SetProblemFact, type SetSettings } from '@hydrooj/common';

export interface SetResultVisibility {
    score: boolean;
    verdict: boolean;
    details: boolean;
}

/** Each result is gated by its own round, never by another completed attempt. */
export function getSetResultVisibility(
    settings: SetSettings,
    fact: SetProblemFact,
    clock: { now: Date; endAt: Date; roundClosedAt: Date | null },
): SetResultVisibility {
    const code = feedbackSideForProblem(settings, fact) === 'code';
    const feedback = code ? settings.feedback.code : settings.feedback.objective;
    if (code && settings.feedback.code.afterDeadline === 'full' && clock.now >= clock.endAt) {
        return { score: true, verdict: true, details: !settings.experience?.hideTestCases };
    }
    const open = feedbackOpen(feedback.when, settings.feedback.gradesReleased, clock.now, clock.roundClosedAt, clock.endAt);
    if (!open || feedback.reveal === 'none') return { score: false, verdict: false, details: false };
    return {
        score: feedback.reveal === 'full' || feedback.reveal === 'score',
        verdict: feedback.reveal === 'full' || feedback.reveal === 'verdict',
        details: feedback.reveal === 'full' && (!fact.judged || !settings.experience?.hideTestCases),
    };
}
