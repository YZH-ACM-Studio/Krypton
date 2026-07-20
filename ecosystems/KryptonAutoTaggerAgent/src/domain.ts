export interface MindmapNodeInput {
    id: string;
    parentId: string | null;
    topic: string;
    tags: string[];
}

export const TARGET_TAGS = ['L2', 'PAT甲级'] as const;

export function hasTargetTag(tags: readonly string[]): boolean {
    return TARGET_TAGS.some((target) => tags.includes(target));
}

export interface MindmapPromptNode {
    id: string;
    path: string;
    tags: string[];
}

export interface EditorDecision {
    action: 'apply' | 'skip';
    selectedNodeIds: string[];
    reason: string;
    confidence: number;
}

export interface ApprovalDecision {
    decision: 'approve' | 'reject';
    reason: string;
}

export interface TagProposal extends EditorDecision {
    addedTags: string[];
    finalTags: string[];
}

interface MindmapNode extends MindmapNodeInput {
    topic: string;
    tags: string[];
}

const DEFAULT_SYSTEM_TAGS = new Set(['L1', 'L2', 'L3', 'PAT', 'PAT甲级', 'PAT乙级', '天梯赛全国总决赛', '天梯赛省级赛', 'CAUC校赛']);

const SYSTEM_TAG_PATTERNS = [/^\d{4}[春夏秋冬]$/, /^\d{4}CCCC(?:-省)?$/];

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object`);
    return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
    return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim() || item !== item.trim())) {
        throw new TypeError(`${label} must be an array of trimmed non-empty strings`);
    }
    if (new Set(value).size !== value.length) throw new TypeError(`${label} must not contain duplicates`);
    return [...value];
}

export class MindmapCatalog {
    readonly allowedTags: ReadonlySet<string>;
    readonly promptNodes: readonly MindmapPromptNode[];
    private readonly nodeIdsByTag: ReadonlyMap<string, readonly string[]>;

    private constructor(private readonly nodes: ReadonlyMap<string, MindmapNode>) {
        this.allowedTags = new Set([...nodes.values()].flatMap((node) => node.tags));
        const nodeIdsByTag = new Map<string, string[]>();
        for (const node of nodes.values()) {
            for (const tag of node.tags) nodeIdsByTag.set(tag, [...(nodeIdsByTag.get(tag) || []), node.id]);
        }
        this.nodeIdsByTag = nodeIdsByTag;
        this.promptNodes = [...nodes.values()]
            .filter((node) => node.tags.length > 0)
            .map((node) => ({ id: node.id, path: this.pathFor(node.id), tags: [...node.tags] }))
            .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
    }

    static from(inputs: MindmapNodeInput[]): MindmapCatalog {
        if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('mindmap must contain at least one node');
        const nodes = new Map<string, MindmapNode>();
        for (const input of inputs) {
            const id = nonEmptyString(input.id, 'mindmap node id');
            if (nodes.has(id)) throw new Error(`duplicate mindmap node id: ${id}`);
            const parentId = input.parentId === null ? null : nonEmptyString(input.parentId, `parentId for ${id}`);
            const topic = nonEmptyString(input.topic, `topic for ${id}`);
            const tags = stringArray(input.tags, `tags for ${id}`);
            nodes.set(id, { id, parentId, topic, tags });
        }
        const roots = [...nodes.values()].filter((node) => node.parentId === null);
        if (roots.length !== 1) throw new Error(`mindmap must contain exactly one root, found ${roots.length}`);
        for (const node of nodes.values()) {
            if (node.parentId !== null && !nodes.has(node.parentId)) throw new Error(`mindmap node ${node.id} has unknown parent ${node.parentId}`);
            const seen = new Set<string>();
            let current: MindmapNode | undefined = node;
            while (current) {
                if (seen.has(current.id)) throw new Error(`mindmap contains a cycle at ${current.id}`);
                seen.add(current.id);
                current = current.parentId === null ? undefined : nodes.get(current.parentId);
            }
        }
        return new MindmapCatalog(nodes);
    }

    hasTag(tag: string): boolean {
        return this.allowedTags.has(tag);
    }

    closureTags(nodeId: string): string[] {
        const chain = this.pathNodes(nodeId);
        const node = chain[chain.length - 1];
        if (node.tags.length === 0) throw new Error(`mindmap node ${nodeId} has no tags and cannot be selected`);
        return [...new Set(chain.flatMap((item) => item.tags))];
    }

    assertHierarchyClosed(tags: string[]): void {
        const current = new Set(stringArray(tags, 'tags'));
        const violations: string[] = [];
        for (const tag of current) {
            const nodeIds = this.nodeIdsByTag.get(tag);
            if (!nodeIds) continue;
            const candidates = nodeIds.map((nodeId) => ({
                nodeId,
                missing: this.ancestorTags(nodeId).filter((parentTag) => !current.has(parentTag)),
            }));
            if (candidates.some((candidate) => candidate.missing.length === 0)) continue;
            violations.push(
                `${tag}: ${candidates.map((candidate) => `${this.pathFor(candidate.nodeId)} -> ${candidate.missing.join(', ')}`).join(' | ')}`,
            );
        }
        if (violations.length) throw new Error(`missing parent mindmap tags: ${violations.join('; ')}`);
    }

    private ancestorTags(nodeId: string): string[] {
        return [
            ...new Set(
                this.pathNodes(nodeId)
                    .slice(0, -1)
                    .flatMap((item) => item.tags),
            ),
        ];
    }

    private pathFor(nodeId: string): string {
        return this.pathNodes(nodeId)
            .map((node) => node.topic)
            .join(' > ');
    }

    private pathNodes(nodeId: string): MindmapNode[] {
        const node = this.nodes.get(nodeId);
        if (!node) throw new Error(`unknown mindmap node: ${nodeId}`);
        const path: MindmapNode[] = [];
        let current: MindmapNode | undefined = node;
        while (current) {
            path.unshift(current);
            current = current.parentId === null ? undefined : this.nodes.get(current.parentId);
        }
        return path;
    }
}

export function parseEditorDecision(value: unknown): EditorDecision {
    const record = asRecord(value, 'editor decision');
    if (record.action !== 'apply' && record.action !== 'skip') throw new TypeError('editor action must be apply or skip');
    const selectedNodeIds = stringArray(record.selectedNodeIds, 'selectedNodeIds');
    if (record.action === 'apply' && selectedNodeIds.length === 0) throw new TypeError('selectedNodeIds must not be empty for apply');
    if (record.action === 'skip' && selectedNodeIds.length > 0) throw new TypeError('selectedNodeIds must be empty for skip');
    const reason = nonEmptyString(record.reason, 'editor reason');
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
        throw new TypeError('editor confidence must be a number between 0 and 1');
    }
    return { action: record.action, selectedNodeIds, reason, confidence: record.confidence };
}

export function parseApprovalDecision(value: unknown): ApprovalDecision {
    const record = asRecord(value, 'approval decision');
    if (record.decision !== 'approve' && record.decision !== 'reject') throw new TypeError('approval decision must be approve or reject');
    return { decision: record.decision, reason: nonEmptyString(record.reason, 'approval reason') };
}

export function buildTagProposal(
    existingTags: string[],
    decision: EditorDecision,
    catalog: MindmapCatalog,
    existingNodeIds: string[] = [],
): TagProposal {
    const current = stringArray(existingTags, 'existingTags');
    const currentNodeIds = stringArray(existingNodeIds, 'existingNodeIds');
    if (decision.action === 'skip') {
        catalog.assertHierarchyClosed(current);
        return { ...decision, addedTags: [], finalTags: current };
    }

    const selectedNodeIds = [...new Set([...currentNodeIds, ...decision.selectedNodeIds])];
    const closure = [...new Set(selectedNodeIds.flatMap((nodeId) => catalog.closureTags(nodeId)))];
    const addedTags = closure.filter((tag) => !current.includes(tag));
    const addedNodeIds = selectedNodeIds.filter((nodeId) => !currentNodeIds.includes(nodeId));
    if (addedTags.length === 0 && addedNodeIds.length === 0) {
        throw new Error('editor proposed apply but no new canonical mindmap selection would be added');
    }
    if (addedTags.some((tag) => !catalog.hasTag(tag))) throw new Error('proposal contains a tag outside the live mindmap vocabulary');
    const finalTags = [...current, ...addedTags];
    catalog.assertHierarchyClosed(finalTags);
    return { ...decision, selectedNodeIds, addedTags, finalTags };
}

export function classifyExistingTags(existingTags: string[], catalog: MindmapCatalog, extraSystemTags: string[]) {
    const configuredSystemTags = new Set([...DEFAULT_SYSTEM_TAGS, ...stringArray(extraSystemTags, 'extraSystemTags')]);
    const result = { systemTags: [] as string[], mindmapTags: [] as string[], otherTags: [] as string[] };
    for (const tag of stringArray(existingTags, 'existingTags')) {
        if (configuredSystemTags.has(tag) || SYSTEM_TAG_PATTERNS.some((pattern) => pattern.test(tag))) result.systemTags.push(tag);
        else if (catalog.hasTag(tag)) result.mindmapTags.push(tag);
        else result.otherTags.push(tag);
    }
    return result;
}
