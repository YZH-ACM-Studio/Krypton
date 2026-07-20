import { isCanonicalManagedSourceTag } from '../model/managed-problem-source';
import type { ProgrammingTagNormalizationPreview } from '../model/managed-problem-authoring';
import { canonicalJson, sha256 } from './problem-batch-import';
import type { KnowledgeMindmapOption } from './problem-tag-canonical';
import type { ProblemTagBackfillProblemSnapshot } from './problem-tag-backfill';

export interface ProblemTagBackfillMindmapFact {
    id: string;
    mapId: string;
    mapTitle: string;
    parentId: string | null;
    topic: string;
    tags: string[];
    updatedAt: string;
}

function nodePath(node: ProblemTagBackfillMindmapFact, byId: Map<string, ProblemTagBackfillMindmapFact>) {
    const path: ProblemTagBackfillMindmapFact[] = [];
    const visited = new Set<string>();
    let current: ProblemTagBackfillMindmapFact | undefined = node;
    while (current) {
        if (visited.has(current.id)) throw new Error(`mindmap contains a cycle at ${current.id}`);
        visited.add(current.id);
        path.push(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId);
        if (!current) throw new Error(`mindmap ancestor is missing for ${node.id}`);
    }
    return path.reverse();
}

export function normalizeProblemTagBackfillMindmapFacts(rows: Array<Record<string, any>>): ProblemTagBackfillMindmapFact[] {
    const facts = rows.map((row) => {
        const id = String(row._id ?? row.id ?? '');
        const mapId = String(row.mapId ?? '');
        const parentId = row.parentId == null ? null : String(row.parentId);
        const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : typeof row.updatedAt === 'string' ? row.updatedAt : '';
        if (!/^[a-f0-9]{24}$/i.test(id) || !/^[a-f0-9]{24}$/i.test(mapId) || (parentId !== null && !/^[a-f0-9]{24}$/i.test(parentId))) {
            throw new Error(`mindmap node identity is malformed: ${id}`);
        }
        if (
            typeof row.mapTitle !== 'string' ||
            !row.mapTitle.trim() ||
            typeof row.topic !== 'string' ||
            !row.topic ||
            !Array.isArray(row.tags) ||
            row.tags.some((tag: unknown) => typeof tag !== 'string')
        ) {
            throw new Error(`mindmap node fields are malformed: ${id}`);
        }
        if (!updatedAt || Number.isNaN(new Date(updatedAt).getTime())) throw new Error(`mindmap node updatedAt is malformed: ${id}`);
        return { id, mapId, mapTitle: row.mapTitle.trim(), parentId, topic: row.topic, tags: [...row.tags], updatedAt };
    });
    facts.sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length) throw new Error('mindmap contains duplicate node ids');
    return facts;
}

export function problemTagBackfillMindmapFingerprint(facts: ProblemTagBackfillMindmapFact[]): string {
    return sha256(canonicalJson(facts));
}

export function knowledgeMindmapOptionsFromFacts(facts: ProblemTagBackfillMindmapFact[]): KnowledgeMindmapOption[] {
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    return facts
        .filter((fact) => fact.tags.some((tag) => tag.trim()))
        .map((fact) => {
            let label: string;
            let pathError: string | undefined;
            try {
                label = nodePath(fact, byId)
                    .map((part) => part.topic)
                    .join(' / ');
            } catch (error) {
                // Keep exact tag matching available so the per-problem preview can
                // classify the affected entry as an invalid path instead of aborting
                // an otherwise useful read-only report.
                label = `[invalid path ${fact.id}] ${fact.topic}`;
                pathError = error instanceof Error ? error.message : String(error);
            }
            return {
                id: fact.id,
                mapId: fact.mapId,
                mapTitle: fact.mapTitle,
                label,
                tags: [...new Set(fact.tags.map((tag) => tag.trim()).filter(Boolean))],
                ...(pathError ? { pathError } : {}),
            };
        })
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

export function previewProblemTagNormalizationFromFacts(
    snapshot: ProblemTagBackfillProblemSnapshot,
    selectedNodeIdsInput: string[],
    facts: ProblemTagBackfillMindmapFact[],
): ProgrammingTagNormalizationPreview {
    if (!Array.isArray(snapshot.tag) || snapshot.tag.some((tag) => typeof tag !== 'string')) {
        throw new TypeError('stored problem tags must be a string array');
    }
    const selectedNodeIds = [...new Set(selectedNodeIdsInput.map(String))].sort();
    if (!selectedNodeIds.length) throw new Error('knowledgeNodeIds is required');
    const currentKnowledgeNodeIds = snapshot.knowledgeNodeIdsPresent
        ? Array.isArray(snapshot.knowledgeNodeIds)
            ? [...new Set(snapshot.knowledgeNodeIds.map(String))].sort()
            : null
        : [];
    if (!currentKnowledgeNodeIds || currentKnowledgeNodeIds.some((id) => !/^[a-f0-9]{24}$/i.test(id))) {
        throw new Error('stored problem knowledgeNodeIds is malformed');
    }
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    const knowledgeMapId = String(snapshot.knowledgeMapId || '');
    if (!/^[a-f0-9]{24}$/i.test(knowledgeMapId)) throw new Error('problem knowledgeMapId is missing or malformed');
    const mapFacts = facts.filter((fact) => fact.mapId === knowledgeMapId);
    const mapTitle = mapFacts[0]?.mapTitle;
    if (!mapTitle || mapFacts.some((fact) => fact.mapTitle !== mapTitle)) throw new Error('problem knowledge map is missing or malformed');
    const tags: string[] = [];
    const pathVersion = new Map<string, ProblemTagBackfillMindmapFact>();
    for (const id of selectedNodeIds) {
        const node = byId.get(id);
        if (!node || node.mapId !== knowledgeMapId || !node.tags.some((tag) => tag.trim())) {
            throw new Error(`mindmap node is missing, cross-map or not selectable: ${id}`);
        }
        for (const part of nodePath(node, byId)) {
            if (part.mapId !== knowledgeMapId) throw new Error(`mindmap path crosses maps: ${id}`);
            pathVersion.set(part.id, part);
            for (const rawTag of part.tags) {
                const tag = rawTag.trim();
                if (tag && !tags.includes(tag)) tags.push(tag);
            }
        }
    }
    const sourceTags = snapshot.tag.filter(isCanonicalManagedSourceTag);
    const nextTags = [...new Set([...sourceTags, ...tags])];
    const currentSet = new Set(snapshot.tag);
    const nextSet = new Set(nextTags);
    const mindmapPathVersion = [...pathVersion.values()]
        .map(({ id, parentId, topic, updatedAt }) => ({ id, parentId, topic, updatedAt }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const fingerprint = sha256(
        JSON.stringify({
            domainId: snapshot.domainId,
            docId: snapshot.docId,
            structureRevision: snapshot.structureRevisionPresent ? snapshot.structureRevision : null,
            currentTags: snapshot.tag,
            currentKnowledgeMapId: knowledgeMapId,
            currentKnowledgeNodeIds,
            targetKnowledgeMapId: knowledgeMapId,
            selectedNodeIds,
            nextTags,
            mindmapPathVersion,
        }),
    );
    return {
        knowledgeMapId: knowledgeMapId as any,
        knowledgeMapTitle: mapTitle,
        sourceTags,
        selectedNodeIds: selectedNodeIds as any,
        nextTags,
        retainedTags: snapshot.tag.filter((tag) => nextSet.has(tag)),
        addedTags: nextTags.filter((tag) => !currentSet.has(tag)),
        removedTags: snapshot.tag.filter((tag) => !nextSet.has(tag)),
        fingerprint,
        mindmapPathVersion,
    };
}
