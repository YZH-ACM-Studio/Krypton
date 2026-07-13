import type { ProblemDoc } from 'hydrooj';

export function isLegacyPublishTransition(
    pdoc: Pick<ProblemDoc, 'authoringMode' | 'hidden'> | null | undefined,
    previous?: { hidden?: boolean },
): boolean {
    return pdoc?.authoringMode !== 'managed' && previous?.hidden === true && pdoc?.hidden === false;
}
