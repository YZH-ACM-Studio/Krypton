export interface ProblemSetSubmissionIdentity {
    containerKind: 'course' | 'problemSet';
    containerId: string;
    mode?: 'student' | 'preview';
}

/**
 * A formal submission entered from a problem set is the participation fact.
 * Pretest, teacher preview, course entry, and a submission with no set entry do not enroll.
 * When a trusted practice context exists, it is the submission identity and the page entry is not a fallback.
 */
export function problemSetIdFromSubmission(input: {
    pretest: boolean;
    trusted: ProblemSetSubmissionIdentity | null;
    entry: ProblemSetSubmissionIdentity | null;
}): string | null {
    if (input.pretest) return null;
    const source = input.trusted ?? input.entry;
    if (!source || source.mode === 'preview' || source.containerKind !== 'problemSet') return null;
    if (!/^[0-9a-f]{24}$/.test(source.containerId)) {
        throw new TypeError(`problem set submission enrollment id is invalid: ${source.containerId}`);
    }
    return source.containerId;
}
