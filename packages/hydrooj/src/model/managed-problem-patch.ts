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
const MANAGED_CANONICAL_FIELDS = new Set(['authoringMode', 'problemKind', 'pid', 'sort', 'tag', 'sourceMeta']);

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
    const publishes =
        current.hidden === true &&
        ((Object.hasOwn($set, 'hidden') && $set.hidden !== true) || Object.hasOwn($unset, 'hidden'));
    const touchesWorkingTitle = requestedFields.some((field) => field === 'title' || field === 'managedAuthoring');
    const coupledWorkingTitle =
        !touchesWorkingTitle ||
        (Object.hasOwn($set, 'title') &&
            Object.hasOwn($set, 'managedAuthoring') &&
            !Object.hasOwn($unset, 'title') &&
            !Object.hasOwn($unset, 'managedAuthoring') &&
            typeof $set.managedAuthoring?.workingTitle === 'string' &&
            $set.title === `待审核 · ${$set.managedAuthoring.workingTitle.trim()}`);
    const workingTitleOnly =
        coupledWorkingTitle &&
        !Object.hasOwn($unset, 'managedAuthoring') &&
        (!Object.hasOwn($set, 'managedAuthoring') ||
            (current.managedAuthoring?.metadataStatus === 'draft' &&
                $set.managedAuthoring?.metadataStatus === 'draft' &&
                typeof $set.managedAuthoring.workingTitle === 'string' &&
                !!$set.managedAuthoring.workingTitle.trim() &&
                isEqual({ ...$set.managedAuthoring, workingTitle: current.managedAuthoring.workingTitle }, current.managedAuthoring)));
    // Generic managed writes never need Mongo dotted paths. Reject every one
    // before capability evaluation so canonical subfields cannot be forged.
    const immutableFields = requestedFields.filter((field) => field.includes('.') || MANAGED_CANONICAL_FIELDS.has(field));
    if (!workingTitleOnly) {
        if (requestedFields.includes('title')) immutableFields.push('title');
        if (requestedFields.includes('managedAuthoring')) immutableFields.push('managedAuthoring');
    }
    if (!requestedFields.length || requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field))) {
        return { capability: 'content', requestedFields, changedFields, immutableFields, publishes };
    }
    if (workingTitleOnly && requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || MANAGED_DRAFT_METADATA_FIELDS.has(field))) {
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
