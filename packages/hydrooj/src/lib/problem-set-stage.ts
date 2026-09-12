import type { TrainingDoc, TrainingNode } from '../interface';
import { courseNodePids } from './course-chapter';

const STATUS_ACCEPTED = 1;

export class ProblemSetStageGraphError extends Error {
    constructor(
        message: string,
        public readonly reason: 'missing_stage' | 'cycle',
    ) {
        super(message);
        this.name = 'ProblemSetStageGraphError';
    }
}

export interface ProblemSetIntroAccess {
    accessible: boolean;
    stageAccess: 'all' | readonly number[];
}

export interface ProblemSetIntroProgressInput {
    psdict: Record<string, { status?: number } | undefined>;
    publishedIntegrity: unknown;
    contextualDoneByScope: ReadonlyMap<number, ReadonlySet<number>> | null;
    selfContextualDoneByScope: ReadonlyMap<number, ReadonlySet<number>> | null;
}

export interface ProblemSetIntroNodeStatus {
    progress: number;
    isDone: boolean;
    isProgress: boolean | number;
    isOpen: boolean;
    isInvalid: boolean;
    hasAccess: boolean;
    lockReason: 'prereq' | 'no_access' | undefined;
    donePids: number[];
    selfDonePids: number[];
}

export interface ProblemSetIntroProjection {
    pids: number[];
    ndict: Record<number, TrainingNode>;
    nsdict: Record<number, ProblemSetIntroNodeStatus>;
    completedProblemCount: number;
    totalProblemCount: number;
    doneNids: number[];
    donePids: number[];
    done: boolean;
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

export function problemSetStageIsAccessible(decision: ProblemSetIntroAccess, stageId: number): boolean {
    if (!decision.accessible) return false;
    if (decision.stageAccess === 'all') return true;
    return decision.stageAccess.includes(stageId);
}

export function problemSetIntroPids(tdoc: Pick<TrainingDoc, 'dag'>): number[] {
    return Array.from(new Set(tdoc.dag.flatMap((node) => courseNodePids(node))));
}

function introNodeIsDone(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[]) {
    return new Set(doneNids).isSupersetOf(new Set(node.requireNids)) && new Set(donePids).isSupersetOf(new Set(courseNodePids(node)));
}

function introNodeIsProgress(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[], progPids: Set<number> | number[]) {
    const pids = courseNodePids(node);
    return (
        new Set(doneNids).isSupersetOf(new Set(node.requireNids)) &&
        !new Set(donePids).isSupersetOf(new Set(pids)) &&
        new Set(donePids).union(new Set(progPids)).intersection(new Set(pids)).size
    );
}

function introNodeIsOpen(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[], progPids: Set<number> | number[]) {
    const pids = courseNodePids(node);
    return (
        new Set(doneNids).isSupersetOf(new Set(node.requireNids)) &&
        !new Set(donePids).isSupersetOf(new Set(pids)) &&
        !new Set(donePids).union(new Set(progPids)).intersection(new Set(pids)).size
    );
}

function introNodeIsInvalid(node: TrainingNode, doneNids: Set<number> | number[]) {
    return !new Set(doneNids).isSupersetOf(new Set(node.requireNids));
}

/** Student intro dump keeps every published DAG node, including inaccessible titles/pids. */
export function serializeProblemSetIntro(
    tdoc: Pick<TrainingDoc, 'dag'>,
    decision: ProblemSetIntroAccess,
    progress: ProblemSetIntroProgressInput,
): ProblemSetIntroProjection {
    const pids = problemSetIntroPids(tdoc);
    const totalProblemCount = tdoc.dag.reduce((total, node) => total + new Set(node.pids).size, 0);
    const donePids = new Set<number>();
    const progPids = new Set<number>();
    for (const pid in progress.psdict) {
        if (!+pid) continue;
        const psdoc = progress.psdict[pid];
        if (!psdoc) throw new TypeError(`problem set intro status missing pid=${pid}`);
        if (!progress.publishedIntegrity && psdoc.status) {
            if (psdoc.status === STATUS_ACCEPTED) {
                donePids.add(+pid);
            } else progPids.add(+pid);
        }
    }
    const nsdict: Record<number, ProblemSetIntroNodeStatus> = {};
    const ndict: Record<number, TrainingNode> = {};
    const doneNids = new Set<number>();
    let completedProblemCount = 0;
    for (const node of tdoc.dag) {
        ndict[node._id] = node;
        const nodePids = new Set(node.pids);
        const totalCount = nodePids.size;
        const scopedDonePids = progress.contextualDoneByScope
            ? nodePids.intersection(progress.contextualDoneByScope.get(node._id) || new Set<number>())
            : donePids;
        if (progress.contextualDoneByScope) for (const pid of scopedDonePids) donePids.add(pid);
        const doneCount = nodePids.intersection(new Set(scopedDonePids)).size;
        completedProblemCount += doneCount;
        const hasAccess = problemSetStageIsAccessible(decision, node._id);
        const isInvalid = introNodeIsInvalid(node, doneNids);
        const nsdoc: ProblemSetIntroNodeStatus = {
            progress: totalCount ? Math.floor(100 * (doneCount / totalCount)) : 100,
            isDone: introNodeIsDone(node, doneNids, scopedDonePids),
            isProgress: introNodeIsProgress(node, doneNids, scopedDonePids, progPids),
            isOpen: introNodeIsOpen(node, doneNids, scopedDonePids, progPids),
            isInvalid,
            hasAccess,
            lockReason: hasAccess ? (isInvalid ? 'prereq' : undefined) : 'no_access',
            donePids: Array.from(scopedDonePids),
            selfDonePids: progress.selfContextualDoneByScope
                ? Array.from(nodePids.intersection(progress.selfContextualDoneByScope.get(node._id) || new Set<number>()))
                : [],
        };
        if (nsdoc.isDone) doneNids.add(node._id);
        nsdict[node._id] = nsdoc;
    }
    return {
        pids,
        ndict,
        nsdict,
        completedProblemCount,
        totalProblemCount,
        doneNids: Array.from(doneNids),
        donePids: Array.from(donePids),
        done: doneNids.size === tdoc.dag.length,
    };
}
