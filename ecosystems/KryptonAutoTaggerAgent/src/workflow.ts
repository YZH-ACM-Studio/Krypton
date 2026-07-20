import {
    type ApprovalDecision,
    buildTagProposal,
    classifyExistingTags,
    type EditorDecision,
    MindmapCatalog,
    type MindmapPromptNode,
    parseApprovalDecision,
    parseEditorDecision,
    type TagProposal,
} from './domain.js';
import { problemIdentity, type ProblemPhase, type RuntimeEventObserver } from './events.js';

export interface ProblemContext {
    docId: number;
    pid: string;
    title: string;
    tag: string[];
    knowledgeMapId: string;
    knowledgeNodeIds: string[];
    content: string;
}

export interface ExistingTagClassification {
    systemTags: string[];
    mindmapTags: string[];
    otherTags: string[];
}

export interface AnalysisInput {
    problem: ProblemContext;
    existingTags: ExistingTagClassification;
    mindmapNodes: readonly MindmapPromptNode[];
}

export interface EditorInput extends AnalysisInput {
    reviewHistory: readonly EditorFeedback[];
}

export interface ApprovalProposal {
    action: TagProposal['action'];
    selectedNodeIds: string[];
    addedTags: string[];
    finalTags: string[];
}

export interface ApprovalInput extends AnalysisInput {
    proposal: ApprovalProposal;
}

export interface AgentInvocationContext {
    round: number;
    problem: Pick<ProblemContext, 'docId' | 'pid' | 'title'>;
}

export interface ReviewRound {
    round: number;
    editor: EditorDecision;
    proposal: ApprovalProposal;
    approval: ApprovalDecision;
}

export interface ProposalValidationFeedback {
    round: number;
    editor: EditorDecision;
    validation: {
        stage: 'proposal';
        reason: string;
    };
}

export type EditorFeedback = ReviewRound | ProposalValidationFeedback;

export interface WorkflowDependencies {
    edit(input: EditorInput, context: AgentInvocationContext): Promise<unknown>;
    approve(input: ApprovalInput, context: AgentInvocationContext): Promise<unknown>;
    loadCurrentCatalog(): Promise<MindmapCatalog>;
    recordWriteIntent(
        docId: number,
        tags: string[],
        expectedTags: string[],
        knowledgeMapId: string,
        knowledgeNodeIds: string[],
        expectedKnowledgeNodeIds: string[],
    ): Promise<void>;
    writeTags(
        docId: number,
        knowledgeMapId: string,
        knowledgeNodeIds: string[],
        expectedTags: string[],
        expectedKnowledgeNodeIds: string[],
    ): Promise<void>;
    observe?: RuntimeEventObserver;
}

export interface WorkflowOptions {
    apply: boolean;
    extraSystemTags: string[];
    maxReviewRounds?: number;
}

export type WorkflowStatus = 'applied' | 'planned' | 'skipped';

export interface WorkflowResult {
    status: WorkflowStatus;
    problem: ProblemContext;
    existingTags: ExistingTagClassification;
    editor: EditorDecision;
    proposal: TagProposal;
    approval: ApprovalDecision;
    rounds: ReviewRound[];
}

export class ReviewLoopExhaustedError extends Error {
    constructor(
        readonly problem: Pick<ProblemContext, 'docId' | 'pid' | 'title'>,
        readonly rounds: ReviewRound[],
        readonly feedbackHistory: EditorFeedback[] = rounds,
    ) {
        const lastFeedback = feedbackHistory.at(-1);
        const reason = lastFeedback && 'validation' in lastFeedback ? lastFeedback.validation.reason : lastFeedback?.approval.reason;
        super(`revision loop exhausted after ${feedbackHistory.length} attempts for ${problem.pid || problem.docId}: ${reason || 'no feedback'}`);
        this.name = 'ReviewLoopExhaustedError';
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sentence(value: string): string {
    return /[。！？.!?]$/.test(value) ? value : `${value}。`;
}

function sameStrings(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

export async function processProblem(
    problem: ProblemContext,
    catalog: MindmapCatalog,
    options: WorkflowOptions,
    dependencies: WorkflowDependencies,
): Promise<WorkflowResult> {
    const observe = dependencies.observe || (() => undefined);
    const identity = problemIdentity(problem);
    const phase = (name: ProblemPhase, status: 'started' | 'completed' | 'failed', round: number | null, message: string) =>
        observe({ type: 'problem_phase', at: new Date().toISOString(), problem: identity, phase: name, status, round, message });
    const existingTags = classifyExistingTags(problem.tag, catalog, options.extraSystemTags);
    const analysisInput: AnalysisInput = { problem, existingTags, mindmapNodes: catalog.promptNodes };
    const maxReviewRounds = options.maxReviewRounds ?? 5;
    if (!Number.isSafeInteger(maxReviewRounds) || maxReviewRounds <= 0) throw new Error('maxReviewRounds must be a positive safe integer');
    const rounds: ReviewRound[] = [];
    const feedbackHistory: EditorFeedback[] = [];
    let editor!: EditorDecision;
    let proposal!: TagProposal;
    let approval!: ApprovalDecision;
    for (let round = 1; round <= maxReviewRounds; round++) {
        const context: AgentInvocationContext = { round, problem };
        phase(
            'editor',
            'started',
            round,
            feedbackHistory.length ? `第 ${round} 轮返修：已向编辑 Agent 发送全部审批与本地校验历史。` : '第 1 轮：正在调用编辑 Agent。',
        );
        try {
            editor = parseEditorDecision(await dependencies.edit({ ...analysisInput, reviewHistory: [...feedbackHistory] }, context));
            phase('editor', 'completed', round, `编辑 Agent 返回 ${editor.action}，置信度 ${editor.confidence.toFixed(2)}：${editor.reason}`);
        } catch (error) {
            phase('editor', 'failed', round, `编辑 Agent 调用失败：${errorMessage(error)}`);
            throw error;
        }
        try {
            proposal = buildTagProposal(problem.tag, editor, catalog, problem.knowledgeNodeIds);
            phase(
                'proposal',
                'completed',
                round,
                `提案已构建：${proposal.addedTags.length ? `新增 ${proposal.addedTags.join('、')}` : '不新增标签'}`,
            );
        } catch (error) {
            const reason = errorMessage(error);
            phase('proposal', 'failed', round, `提案校验失败：${reason}`);
            feedbackHistory.push({ round, editor, validation: { stage: 'proposal', reason } });
            if (round < maxReviewRounds) {
                phase('feedback', 'completed', round, `提案校验失败：${sentence(reason)}已反馈给编辑 Agent，准备第 ${round + 1} 轮返修。`);
                continue;
            }
            throw new ReviewLoopExhaustedError(problem, rounds, feedbackHistory);
        }
        const approvalProposal: ApprovalProposal = {
            action: proposal.action,
            selectedNodeIds: proposal.selectedNodeIds,
            addedTags: proposal.addedTags,
            finalTags: proposal.finalTags,
        };
        phase('approval', 'started', round, `第 ${round} 轮：正在调用独立审批 Agent。`);
        try {
            approval = parseApprovalDecision(await dependencies.approve({ ...analysisInput, proposal: approvalProposal }, context));
            phase('approval', 'completed', round, `审批 Agent 返回 ${approval.decision}：${approval.reason}`);
        } catch (error) {
            phase('approval', 'failed', round, `审批 Agent 调用失败：${errorMessage(error)}`);
            throw error;
        }
        const completedRound = { round, editor, proposal: approvalProposal, approval };
        rounds.push(completedRound);
        feedbackHistory.push(completedRound);
        observe({ type: 'review_round_completed', at: new Date().toISOString(), problem: identity, review: completedRound });
        if (approval.decision === 'approve') break;
        if (round < maxReviewRounds) {
            phase('feedback', 'completed', round, `审批拒绝：${sentence(approval.reason)}已反馈给编辑 Agent，准备第 ${round + 1} 轮返修。`);
        }
    }
    if (approval.decision === 'reject') throw new ReviewLoopExhaustedError(problem, rounds, feedbackHistory);

    let status: WorkflowStatus;
    if (proposal.action === 'skip') status = 'skipped';
    else if (!options.apply) status = 'planned';
    else {
        phase('revalidation', 'started', null, '正在重新读取实时思维导图并复算已审批提案。');
        try {
            const currentCatalog = await dependencies.loadCurrentCatalog();
            const currentProposal = buildTagProposal(problem.tag, editor, currentCatalog, problem.knowledgeNodeIds);
            const sameAddedTags = sameStrings(currentProposal.addedTags, proposal.addedTags);
            const sameFinalTags = sameStrings(currentProposal.finalTags, proposal.finalTags);
            const sameSelectedNodes = sameStrings(currentProposal.selectedNodeIds, proposal.selectedNodeIds);
            if (!sameAddedTags || !sameFinalTags || !sameSelectedNodes) {
                throw new Error(`mindmap changed after approval for problem ${problem.docId}; refusing stale proposal`);
            }
            phase('revalidation', 'completed', null, '实时导图下提案标签仍一致，审批提案仍然有效。');
        } catch (error) {
            phase('revalidation', 'failed', null, `实时复核失败：${errorMessage(error)}`);
            throw error;
        }
        phase('write_intent', 'started', null, '正在持久化审批通过的写入意图。');
        try {
            await dependencies.recordWriteIntent(
                problem.docId,
                proposal.finalTags,
                problem.tag,
                problem.knowledgeMapId,
                proposal.selectedNodeIds,
                problem.knowledgeNodeIds,
            );
            phase('write_intent', 'completed', null, '写入意图已持久化。');
        } catch (error) {
            phase('write_intent', 'failed', null, `写入意图持久化失败：${errorMessage(error)}`);
            throw error;
        }
        phase('write', 'started', null, '正在向 OJ 提交标签变更。');
        try {
            await dependencies.writeTags(problem.docId, problem.knowledgeMapId, proposal.selectedNodeIds, problem.tag, problem.knowledgeNodeIds);
            phase('write', 'completed', null, 'OJ 已确认标签变更。');
        } catch (error) {
            phase('write', 'failed', null, `OJ 标签写入失败：${errorMessage(error)}`);
            throw error;
        }
        status = 'applied';
    }

    return { status, problem, existingTags, editor, proposal, approval, rounds };
}
