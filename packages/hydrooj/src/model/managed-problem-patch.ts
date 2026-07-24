import { isEqual } from 'lodash';
import type { ProblemDoc } from '../interface';
import type { ProblemWriteCapability } from './problem-access';

export interface ManagedProblemPatchGuard {
    capability: ProblemWriteCapability;
    requestedFields: string[];
    changedFields: string[];
    immutableFields: string[];
    publishes: boolean;
}

export function managedProblemPatchStateFilter(current: ProblemDoc) {
    return {
        authoringMode: 'managed' as const,
        hidden: current.hidden,
        managedAuthoring: current.managedAuthoring,
    };
}

const MANAGED_CONTENT_FIELDS = new Set(['content', 'config', 'data', 'additional_file', 'html']);
const MANAGED_DRAFT_METADATA_FIELDS = new Set(['title', 'difficulty', 'managedAuthoring']);
const MANAGED_ARCHIVE_FIELDS = new Set(['archivedAt', 'archivedBy', 'archiveReason']);
const MANAGED_CANONICAL_FIELDS = new Set([
    'authoringMode',
    'problemKind',
    'pid',
    'sort',
    'tag',
    'sourceMeta',
    'batchImport',
    'hasBatchImportIdentity',
]);

/** Classify one generic managed-problem patch before any role capability is considered. */
export function managedProblemPatchCapability(
    current: ProblemDoc,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown>,
): ManagedProblemPatchGuard {
    const requestedFields = [...new Set([...Object.keys($set), ...Object.keys($unset)])];
    const changedFields = [
        ...Object.entries($set)
            .filter(([field, value]) => field.includes('.') || !isEqual((current as any)[field], value))
            .map(([field]) => field),
        ...Object.keys($unset).filter((field) => field.includes('.') || (current as any)[field] !== undefined),
    ];
    const publishes = current.hidden === true && ((Object.hasOwn($set, 'hidden') && $set.hidden !== true) || Object.hasOwn($unset, 'hidden'));
    const hasManagedAuthoring = Object.hasOwn($set, 'managedAuthoring');
    const titleRequested = requestedFields.includes('title');
    const proposedAuthoring = $set.managedAuthoring;
    const workingTitleChanged = hasManagedAuthoring && proposedAuthoring?.workingTitle !== current.managedAuthoring?.workingTitle;
    const managedDraftAuthoringPatch =
        !Object.hasOwn($unset, 'managedAuthoring') &&
        (!hasManagedAuthoring ||
            (current.managedAuthoring?.metadataStatus === 'draft' &&
                proposedAuthoring?.metadataStatus === 'draft' &&
                typeof proposedAuthoring.workingTitle === 'string' &&
                !!proposedAuthoring.workingTitle.trim() &&
                Array.isArray(proposedAuthoring.selectedMindmapNodeIds) &&
                isEqual(
                    {
                        ...proposedAuthoring,
                        workingTitle: current.managedAuthoring.workingTitle,
                        selectedMindmapNodeIds: current.managedAuthoring.selectedMindmapNodeIds,
                    },
                    current.managedAuthoring,
                )));
    const titleCoupled =
        (!titleRequested && !workingTitleChanged) ||
        (titleRequested &&
            hasManagedAuthoring &&
            Object.hasOwn($set, 'title') &&
            !Object.hasOwn($unset, 'title') &&
            typeof proposedAuthoring?.workingTitle === 'string' &&
            $set.title === `待审核 · ${proposedAuthoring.workingTitle.trim()}`);
    const managedDraftPatch = managedDraftAuthoringPatch && titleCoupled;
    const managedSuggestionPatch = managedDraftPatch && hasManagedAuthoring && !titleRequested && !workingTitleChanged;
    // Generic managed writes never need Mongo dotted paths. Reject every one
    // before capability evaluation so canonical subfields cannot be forged.
    const immutableFields = requestedFields.filter((field) => field.includes('.') || MANAGED_CANONICAL_FIELDS.has(field));
    if (!managedDraftPatch) {
        if (requestedFields.includes('title')) immutableFields.push('title');
        if (requestedFields.includes('managedAuthoring')) immutableFields.push('managedAuthoring');
    }
    const contentPatch =
        !requestedFields.length ||
        requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || (field === 'managedAuthoring' && managedSuggestionPatch));
    if (contentPatch) {
        return { capability: 'content', requestedFields, changedFields, immutableFields, publishes };
    }
    if (managedDraftPatch && requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || MANAGED_DRAFT_METADATA_FIELDS.has(field))) {
        return { capability: 'metadata', requestedFields, changedFields, immutableFields, publishes };
    }
    if (requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || field === 'hidden' || MANAGED_ARCHIVE_FIELDS.has(field))) {
        const hasArchiveField = requestedFields.some((field) => MANAGED_ARCHIVE_FIELDS.has(field));
        return { capability: hasArchiveField ? 'archive' : 'publish', requestedFields, changedFields, immutableFields, publishes };
    }
    // Unified publication owns canonical metadata. Unknown top-level fields
    // still require publish capability, while immutableFields remains final.
    return { capability: 'publish', requestedFields, changedFields, immutableFields, publishes };
}
