import { isCanonicalManagedSourceTag } from '../model/managed-problem-source';

export interface KnowledgeMindmapOption {
    id: string;
    mapId: string;
    mapTitle: string;
    label: string;
    tags: string[];
    pathError?: string;
}

export interface KnowledgeMapOption {
    id: string;
    title: string;
    visibility: 'hidden' | 'public';
}

export interface LegacyProgrammingTagClassification {
    sourceTags: string[];
    suggestions: Array<{ tag: string; nodeId: string; label: string }>;
    suggestedNodeIds: string[];
    ambiguousTags: Array<{ tag: string; candidates: string[] }>;
    unknownTags: string[];
}

export interface ProblemKnowledgeNodeFields {
    authoringMode?: unknown;
    knowledgeNodeIds?: unknown;
    managedAuthoring?: unknown;
}

function storedKnowledgeNodeId(value: unknown, field: string): string {
    let normalized: string;
    if (typeof value === 'string') normalized = value;
    else if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
        normalized = String((value as { toHexString(): string }).toHexString());
    } else {
        throw new TypeError(`${field} must be a string or ObjectId`);
    }
    if (!normalized || normalized.trim() !== normalized) throw new TypeError(`${field} must be a trimmed non-empty node id`);
    return normalized;
}

function storedKnowledgeNodeIds(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
    const ids = value.map((nodeId, index) => storedKnowledgeNodeId(nodeId, `${field}[${index}]`));
    if (new Set(ids).size !== ids.length) throw new TypeError(`${field} must not contain duplicates`);
    return ids;
}

function sameNodeIdSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((nodeId) => rightSet.has(nodeId));
}

/**
 * Resolve the canonical knowledge-node selection across the two persisted
 * programming-problem layouts.
 *
 * Managed problems created before the P2.29 migration keep their canonical
 * selection only in `managedAuthoring.selectedMindmapNodeIds`. New managed
 * writes mirror that selection to the top-level field. When both copies are
 * present they must agree; a disagreement is storage corruption, not a reason
 * to prefer one copy silently.
 */
export function resolveProblemKnowledgeNodeIds(pdoc: ProblemKnowledgeNodeFields, label = 'problem'): string[] {
    const topLevel = storedKnowledgeNodeIds(pdoc.knowledgeNodeIds, `${label}.knowledgeNodeIds`);
    if (pdoc.authoringMode !== 'managed') return topLevel;

    if (pdoc.managedAuthoring !== undefined && (pdoc.managedAuthoring === null || typeof pdoc.managedAuthoring !== 'object')) {
        throw new TypeError(`${label}.managedAuthoring must be an object`);
    }
    const managed = storedKnowledgeNodeIds(
        (pdoc.managedAuthoring as { selectedMindmapNodeIds?: unknown } | undefined)?.selectedMindmapNodeIds,
        `${label}.managedAuthoring.selectedMindmapNodeIds`,
    );
    if (topLevel.length && !sameNodeIdSet(topLevel, managed)) {
        throw new TypeError(`${label} has conflicting managed knowledge-node selections`);
    }
    return managed;
}

function requireStoredProblemTags(input: unknown): string[] {
    if (!Array.isArray(input) || input.some((tag) => typeof tag !== 'string')) {
        throw new TypeError('stored problem tags must be a string array');
    }
    return [...input];
}

/** Pure strict-exact classifier shared by the single-problem UI and site backfill plan. */
export function classifyLegacyProgrammingTags(
    currentTagsInput: unknown,
    mindmapOptions: readonly KnowledgeMindmapOption[],
): LegacyProgrammingTagClassification {
    const currentTags = requireStoredProblemTags(currentTagsInput);
    const nodesByTag = new Map<string, KnowledgeMindmapOption[]>();
    for (const option of mindmapOptions) {
        for (const tag of option.tags) {
            const candidates = nodesByTag.get(tag) || [];
            if (!candidates.some((candidate) => candidate.id === option.id)) candidates.push(option);
            nodesByTag.set(tag, candidates);
        }
    }
    const sourceTags: string[] = [];
    const suggestions: LegacyProgrammingTagClassification['suggestions'] = [];
    const ambiguousTags: LegacyProgrammingTagClassification['ambiguousTags'] = [];
    const unknownTags: string[] = [];
    for (const tag of currentTags) {
        if (isCanonicalManagedSourceTag(tag)) {
            sourceTags.push(tag);
            continue;
        }
        const candidates = nodesByTag.get(tag) || [];
        if (candidates.length === 1) {
            suggestions.push({ tag, nodeId: candidates[0].id, label: candidates[0].label });
        } else if (candidates.length > 1) {
            ambiguousTags.push({ tag, candidates: candidates.map((candidate) => candidate.label) });
        } else {
            unknownTags.push(tag);
        }
    }
    return {
        sourceTags,
        suggestions,
        suggestedNodeIds: [...new Set(suggestions.map((suggestion) => suggestion.nodeId))],
        ambiguousTags,
        unknownTags,
    };
}
