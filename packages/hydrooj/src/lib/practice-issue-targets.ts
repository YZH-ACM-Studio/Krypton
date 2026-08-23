export interface PracticeIssueIdentity<TContainerId> {
    containerKind: 'course' | 'problemSet';
    containerId: TContainerId;
    scopeKind: 'chapter' | 'stage';
    scopeId: number;
}

export interface PracticeIssueRevision<TRevision> {
    revision: TRevision;
    scopeKind: 'chapter' | 'stage';
    scopeId: number;
}

export type PracticeIssueSelection<TContainerId, TRevision> =
    | { controlled: false }
    | {
          controlled: true;
          identity: PracticeIssueIdentity<TContainerId>;
          targets: Array<PracticeIssueRevision<TRevision>>;
      };

/** Choose the issued identity and published targets for a course→set chain. */
export function selectPracticeIssueTargets<TContainerId, TRevision>(input: {
    primary: PracticeIssueIdentity<TContainerId>;
    extra?: PracticeIssueIdentity<TContainerId>;
    primaryPublished: TRevision | null | undefined;
    extraPublished: TRevision | null | undefined;
}): PracticeIssueSelection<TContainerId, TRevision> {
    if (input.primaryPublished) {
        const targets: Array<PracticeIssueRevision<TRevision>> = [
            { revision: input.primaryPublished, scopeKind: input.primary.scopeKind, scopeId: input.primary.scopeId },
        ];
        if (input.extra && input.extraPublished) {
            targets.push({ revision: input.extraPublished, scopeKind: input.extra.scopeKind, scopeId: input.extra.scopeId });
        }
        return { controlled: true, identity: input.primary, targets };
    }
    if (input.extra && input.extraPublished) {
        return {
            controlled: true,
            identity: input.extra,
            targets: [{ revision: input.extraPublished, scopeKind: input.extra.scopeKind, scopeId: input.extra.scopeId }],
        };
    }
    return { controlled: false };
}
