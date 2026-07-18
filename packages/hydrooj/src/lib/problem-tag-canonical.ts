import { isCanonicalManagedSourceTag } from '../model/managed-problem-source';

export interface KnowledgeMindmapOption {
    id: string;
    label: string;
    tags: string[];
    pathError?: string;
}

export interface LegacyProgrammingTagClassification {
    sourceTags: string[];
    suggestions: Array<{ tag: string; nodeId: string; label: string }>;
    suggestedNodeIds: string[];
    ambiguousTags: Array<{ tag: string; candidates: string[] }>;
    unknownTags: string[];
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
