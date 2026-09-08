export interface ProfileCompletionItem {
    id: string;
    title: string;
    count: number;
    href?: string;
    subtitle?: string;
}

export function rankCompletionItems(items: readonly ProfileCompletionItem[], limit = 20): ProfileCompletionItem[] {
    return items
        .filter((item) => item.count > 0)
        .slice()
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id))
        .slice(0, limit);
}

export function problemSetCompletionCount(input: {
    setPids: readonly number[];
    visibleAcPids: ReadonlySet<number>;
    integrity: boolean;
    scopedDonePids: ReadonlySet<number>;
}): number {
    const pids = [...new Set(input.setPids)];
    if (input.integrity) {
        return pids.filter((pid) => input.scopedDonePids.has(pid) && input.visibleAcPids.has(pid)).length;
    }
    return pids.filter((pid) => input.visibleAcPids.has(pid)).length;
}

function knowledgeNodeIdStrings(problem: { knowledgeNodeIds?: unknown; docId?: unknown }): string[] {
    const raw = problem.knowledgeNodeIds;
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        throw new TypeError(`invalid knowledgeNodeIds for problem ${String(problem.docId)}`);
    }
    const ids: string[] = [];
    for (const [index, value] of raw.entries()) {
        if (value == null) {
            throw new TypeError(`invalid knowledgeNodeIds[${index}] for problem ${String(problem.docId)}`);
        }
        const id = typeof value === 'string' ? value.trim() : String(value);
        if (!id) throw new TypeError(`empty knowledgeNodeIds[${index}] for problem ${String(problem.docId)}`);
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

export function knowledgeNodeCompletionCounts(input: {
    problems: ReadonlyArray<{ knowledgeNodeIds?: unknown; docId?: unknown }>;
    publicNodes: ReadonlyArray<{ id: string; title: string; href?: string; subtitle?: string }>;
}): ProfileCompletionItem[] {
    const nodes = new Map(input.publicNodes.map((node) => [node.id, node]));
    const counts = new Map<string, number>();
    for (const problem of input.problems) {
        for (const id of knowledgeNodeIdStrings(problem)) {
            if (!nodes.has(id)) continue;
            counts.set(id, (counts.get(id) || 0) + 1);
        }
    }
    return rankCompletionItems(
        [...counts.entries()].map(([id, count]) => {
            const node = nodes.get(id);
            if (!node) throw new TypeError(`knowledge node ${id} disappeared during tally`);
            return {
                id,
                title: node.title,
                count,
                href: node.href,
                ...(node.subtitle ? { subtitle: node.subtitle } : {}),
            };
        }),
    );
}
