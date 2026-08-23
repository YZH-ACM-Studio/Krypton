import type { TrainingNode } from '../interface';

export class ProblemSetStageGraphError extends Error {
    constructor(
        message: string,
        public readonly reason: 'missing_stage' | 'cycle',
    ) {
        super(message);
        this.name = 'ProblemSetStageGraphError';
    }
}

export function trainingNodeById(dag: readonly TrainingNode[], stageId: number): TrainingNode | undefined {
    return dag.find((node) => Number(node._id) === stageId);
}

export function computePrerequisiteClosure(dag: readonly TrainingNode[], stageId: number): number[] {
    const byId = new Map<number, TrainingNode>();
    for (const node of dag) byId.set(Number(node._id), node);
    if (!byId.has(stageId)) throw new ProblemSetStageGraphError(`stage ${stageId} is not in the published DAG`, 'missing_stage');
    const visiting = new Set<number>();
    const ordered: number[] = [];
    const seen = new Set<number>();
    const visit = (id: number) => {
        if (seen.has(id)) return;
        if (visiting.has(id)) throw new ProblemSetStageGraphError(`stage DAG cycle at ${id}`, 'cycle');
        const node = byId.get(id);
        if (!node) throw new ProblemSetStageGraphError(`stage ${id} is not in the published DAG`, 'missing_stage');
        visiting.add(id);
        for (const required of node.requireNids || []) visit(Number(required));
        visiting.delete(id);
        seen.add(id);
        ordered.push(id);
    };
    visit(stageId);
    return ordered;
}

export function prerequisitesCompleted(node: TrainingNode, doneNids: ReadonlySet<number>): boolean {
    return (node.requireNids || []).every((id) => doneNids.has(Number(id)));
}
