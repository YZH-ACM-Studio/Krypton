/** Product title of the seeded algorithm knowledge map. */
export const ALGORITHM_KNOWLEDGE_MAP_TITLE = '算法知识图谱';

export interface DefaultKnowledgeMapCandidate {
    title: string;
    isDefault?: boolean;
}

/**
 * Choose the map opened when the request has no `map` query.
 * Canonical: unique `isDefault:true`. Fallback: the seeded algorithm map title.
 * Title-sorted `maps[0]` is not a default.
 */
export function pickDefaultKnowledgeMap<T extends DefaultKnowledgeMapCandidate>(maps: readonly T[]): T | undefined {
    if (!maps.length) return undefined;
    const flagged = maps.filter((map) => map.isDefault === true);
    if (flagged.length > 1) {
        throw new Error(`multiple default knowledge maps (${flagged.length})`);
    }
    if (flagged[0]) return flagged[0];
    const algorithm = maps.filter((map) => map.title === ALGORITHM_KNOWLEDGE_MAP_TITLE);
    if (algorithm.length === 1) return algorithm[0];
    return undefined;
}
