import type { PracticeIntegrityPolicy } from '../model/practice-integrity';

export interface InheritedPracticeEnforcement {
    prohibitExternalCodeInjection: boolean;
    removeIndependentSubmitForm: boolean;
}

export function emptyInheritedPracticeEnforcement(): InheritedPracticeEnforcement {
    return { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: false };
}

export function canApplyInheritedPracticeEnforcement(input: { virtualAttempt?: unknown; tdoc?: { rule?: unknown } | null }): boolean {
    if (input.virtualAttempt) return false;
    if (!input.tdoc) return true;
    return input.tdoc.rule === 'homework';
}

export function combineInheritedPracticeEnforcement(
    policies: readonly Pick<PracticeIntegrityPolicy, 'prohibitExternalCodeInjection' | 'removeIndependentSubmitForm'>[],
): InheritedPracticeEnforcement {
    return policies.reduce<InheritedPracticeEnforcement>(
        (combined, policy) => ({
            prohibitExternalCodeInjection: combined.prohibitExternalCodeInjection || policy.prohibitExternalCodeInjection === true,
            removeIndependentSubmitForm: combined.removeIndependentSubmitForm || policy.removeIndependentSubmitForm === true,
        }),
        emptyInheritedPracticeEnforcement(),
    );
}

export function inheritedPracticeEnforcementIsActive(enforcement: InheritedPracticeEnforcement | null | undefined): boolean {
    return enforcement?.prohibitExternalCodeInjection === true || enforcement?.removeIndependentSubmitForm === true;
}
