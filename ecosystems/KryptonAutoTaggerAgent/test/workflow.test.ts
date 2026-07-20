import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MindmapCatalog } from '../src/domain.js';
import { type EditorInput, type ProblemContext, processProblem, ReviewLoopExhaustedError } from '../src/workflow.js';

const catalog = MindmapCatalog.from([
    { id: 'root', parentId: null, topic: '算法', tags: [] },
    { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
    { id: 'number', parentId: 'math', topic: '数论', tags: ['数论'] },
]);

const problem: ProblemContext = {
    docId: 7,
    pid: 'P7',
    title: '快速幂',
    tag: ['PAT甲级', '2025春'],
    knowledgeMapId: 'map-algorithm',
    knowledgeNodeIds: [],
    content: '计算 a 的 b 次幂。',
};

describe('two-agent approval workflow', () => {
    test('an approved editor proposal is written only in explicit apply mode', async () => {
        const writes: Array<{
            docId: number;
            knowledgeMapId: string;
            knowledgeNodeIds: string[];
            expectedTags: string[];
            expectedKnowledgeNodeIds: string[];
        }> = [];
        const writeEvents: string[] = [];
        const result = await processProblem(
            problem,
            catalog,
            { apply: true, extraSystemTags: [] },
            {
                edit: async () => ({ action: 'apply', selectedNodeIds: ['number'], reason: '数论题。', confidence: 0.95 }),
                approve: async ({ proposal }) => {
                    assert.deepEqual(proposal.addedTags, ['数学', '数论']);
                    return { decision: 'approve', reason: '父子标签完整且语义正确。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => {
                    writeEvents.push('intent');
                },
                writeTags: async (docId, knowledgeMapId, knowledgeNodeIds, expectedTags, expectedKnowledgeNodeIds) => {
                    writeEvents.push('write');
                    writes.push({ docId, knowledgeMapId, knowledgeNodeIds, expectedTags, expectedKnowledgeNodeIds });
                },
            },
        );

        assert.equal(result.status, 'applied');
        assert.deepEqual(writes, [
            {
                docId: 7,
                knowledgeMapId: 'map-algorithm',
                knowledgeNodeIds: ['number'],
                expectedTags: ['PAT甲级', '2025春'],
                expectedKnowledgeNodeIds: [],
            },
        ]);
        assert.deepEqual(writeEvents, ['intent', 'write']);
    });

    test('preserves existing canonical nodes when appending an approved classification', async () => {
        const writes: string[][] = [];
        const alreadyClassified = {
            ...problem,
            tag: ['PAT甲级', '2025春', '数学'],
            knowledgeNodeIds: ['math'],
        };

        const result = await processProblem(
            alreadyClassified,
            catalog,
            { apply: true, extraSystemTags: [] },
            {
                edit: async () => ({ action: 'apply', selectedNodeIds: ['number'], reason: '补充数论分类。', confidence: 0.95 }),
                approve: async ({ proposal }) => {
                    assert.deepEqual(proposal.selectedNodeIds, ['math', 'number']);
                    return { decision: 'approve', reason: '保留原分类并追加数论。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async (_docId, _mapId, nodeIds) => {
                    writes.push(nodeIds);
                },
            },
        );

        assert.equal(result.status, 'applied');
        assert.deepEqual(writes, [['math', 'number']]);
    });

    test('dry-run still invokes the approval agent but never writes', async () => {
        let approvals = 0;
        let writes = 0;
        const result = await processProblem(
            problem,
            catalog,
            { apply: false, extraSystemTags: [] },
            {
                edit: async () => ({ action: 'apply', selectedNodeIds: ['number'], reason: '数论题。', confidence: 0.9 }),
                approve: async () => {
                    approvals++;
                    return { decision: 'approve', reason: '合理。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => {
                    writes++;
                },
            },
        );

        assert.equal(result.status, 'planned');
        assert.equal(approvals, 1);
        assert.equal(writes, 0);
    });

    test('feeds a rejection back to the editor and keeps reviewing until a revision is approved', async () => {
        const editorInputs: Array<Record<string, unknown>> = [];
        const approvalReasons: string[] = [];
        let edits = 0;
        let approvals = 0;
        let writes = 0;
        const result = await processProblem(
            problem,
            catalog,
            { apply: false, extraSystemTags: [], maxReviewRounds: 3 },
            {
                edit: async (input) => {
                    editorInputs.push(input as unknown as Record<string, unknown>);
                    edits++;
                    return edits === 1
                        ? { action: 'apply', selectedNodeIds: ['math'], reason: '先按宽泛数学标签处理。', confidence: 0.7 }
                        : { action: 'apply', selectedNodeIds: ['number'], reason: '根据审批意见改为数论。', confidence: 0.95 };
                },
                approve: async () => {
                    approvals++;
                    const reason = approvals === 1 ? '标签过宽；题面明确是快速幂，应选择数论节点。' : '已按意见改为数论，父链完整。';
                    approvalReasons.push(reason);
                    return { decision: approvals === 1 ? 'reject' : 'approve', reason };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => {
                    writes++;
                },
            },
        );

        assert.equal(result.status, 'planned');
        assert.equal(edits, 2);
        assert.equal(approvals, 2);
        assert.equal(writes, 0);
        assert.deepEqual(editorInputs[0].reviewHistory, []);
        assert.deepEqual(editorInputs[1].reviewHistory, [
            {
                round: 1,
                editor: { action: 'apply', selectedNodeIds: ['math'], reason: '先按宽泛数学标签处理。', confidence: 0.7 },
                proposal: {
                    action: 'apply',
                    selectedNodeIds: ['math'],
                    addedTags: ['数学'],
                    finalTags: ['PAT甲级', '2025春', '数学'],
                },
                approval: { decision: 'reject', reason: approvalReasons[0] },
            },
        ]);
        assert.equal(result.rounds.length, 2);
        assert.equal(result.rounds[0].approval.decision, 'reject');
        assert.equal(result.rounds[1].approval.decision, 'approve');
        assert.deepEqual(result.proposal.addedTags, ['数学', '数论']);
    });

    test('feeds a deterministic proposal validation failure back to the editor before approval', async () => {
        const hierarchyCatalog = MindmapCatalog.from([
            { id: 'root', parentId: null, topic: '算法', tags: [] },
            { id: 'basic', parentId: 'root', topic: '基础算法', tags: ['基础算法'] },
            { id: 'simulation', parentId: 'basic', topic: '模拟', tags: ['模拟'] },
        ]);
        const incompleteProblem = { ...problem, tag: ['模拟', 'PAT甲级'] };
        const editorInputs: EditorInput[] = [];
        const events: Array<Record<string, unknown>> = [];
        let approvals = 0;

        const result = await processProblem(
            incompleteProblem,
            hierarchyCatalog,
            { apply: false, extraSystemTags: [], maxReviewRounds: 3 },
            {
                observe: (event) => events.push(event as unknown as Record<string, unknown>),
                edit: async (input, context) => {
                    editorInputs.push(input);
                    return context.round === 1
                        ? { action: 'skip', selectedNodeIds: [], reason: '已有模拟标签足够。', confidence: 0.95 }
                        : { action: 'apply', selectedNodeIds: ['simulation'], reason: '补齐模拟的父标签。', confidence: 0.99 };
                },
                approve: async ({ proposal }) => {
                    approvals++;
                    assert.deepEqual(proposal, {
                        action: 'apply',
                        selectedNodeIds: ['simulation'],
                        addedTags: ['基础算法'],
                        finalTags: ['模拟', 'PAT甲级', '基础算法'],
                    });
                    return { decision: 'approve', reason: '父标签已补齐。' };
                },
                loadCurrentCatalog: async () => hierarchyCatalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => {
                    throw new Error('dry-run must not write');
                },
            },
        );

        assert.equal(result.status, 'planned');
        assert.equal(editorInputs.length, 2);
        assert.equal(approvals, 1);
        assert.deepEqual(editorInputs[1].reviewHistory, [
            {
                round: 1,
                editor: { action: 'skip', selectedNodeIds: [], reason: '已有模拟标签足够。', confidence: 0.95 },
                validation: {
                    stage: 'proposal',
                    reason: 'missing parent mindmap tags: 模拟: 算法 > 基础算法 > 模拟 -> 基础算法',
                },
            },
        ]);
        assert.deepEqual(
            events.filter((event) => event.type === 'problem_phase').map((event) => `${String(event.phase)}:${String(event.status)}`),
            [
                'editor:started',
                'editor:completed',
                'proposal:failed',
                'feedback:completed',
                'editor:started',
                'editor:completed',
                'proposal:completed',
                'approval:started',
                'approval:completed',
            ],
        );
        const feedback = events.find((event) => event.type === 'problem_phase' && event.phase === 'feedback');
        assert.match(String(feedback?.message), /提案校验失败.*missing parent mindmap tags.*已反馈给编辑 Agent.*第 2 轮返修/);
    });

    test('fails explicitly when proposal validation revisions exhaust the configured limit', async () => {
        const hierarchyCatalog = MindmapCatalog.from([
            { id: 'root', parentId: null, topic: '算法', tags: [] },
            { id: 'basic', parentId: 'root', topic: '基础算法', tags: ['基础算法'] },
            { id: 'simulation', parentId: 'basic', topic: '模拟', tags: ['模拟'] },
        ]);
        const incompleteProblem = { ...problem, tag: ['模拟', 'PAT甲级'] };
        let edits = 0;
        let approvals = 0;

        await assert.rejects(
            () =>
                processProblem(
                    incompleteProblem,
                    hierarchyCatalog,
                    { apply: false, extraSystemTags: [], maxReviewRounds: 2 },
                    {
                        edit: async () => {
                            edits++;
                            return { action: 'skip', selectedNodeIds: [], reason: '仍然错误地跳过。', confidence: 0.9 };
                        },
                        approve: async () => {
                            approvals++;
                            return { decision: 'approve', reason: '不应进入审批。' };
                        },
                        loadCurrentCatalog: async () => hierarchyCatalog,
                        recordWriteIntent: async () => {
                            throw new Error('invalid proposal must not record intent');
                        },
                        writeTags: async () => {
                            throw new Error('invalid proposal must not write');
                        },
                    },
                ),
            (error) => {
                assert.ok(error instanceof ReviewLoopExhaustedError);
                assert.equal(error.rounds.length, 0);
                assert.equal(error.feedbackHistory.length, 2);
                const finalFeedback = error.feedbackHistory[1];
                assert.ok('validation' in finalFeedback);
                assert.match(finalFeedback.validation.reason, /missing parent mindmap tags/);
                assert.match(error.message, /revision loop exhausted after 2 attempts/);
                return true;
            },
        );

        assert.equal(edits, 2);
        assert.equal(approvals, 0);
    });

    test('fails explicitly with every review round preserved when the revision limit is exhausted', async () => {
        let edits = 0;
        let approvals = 0;

        await assert.rejects(
            () =>
                processProblem(
                    problem,
                    catalog,
                    { apply: false, extraSystemTags: [], maxReviewRounds: 2 },
                    {
                        edit: async () => {
                            edits++;
                            return { action: 'apply', selectedNodeIds: ['math'], reason: `第 ${edits} 版仍然过宽。`, confidence: 0.6 };
                        },
                        approve: async () => {
                            approvals++;
                            return { decision: 'reject', reason: `第 ${approvals} 轮仍未定位到数论。` };
                        },
                        loadCurrentCatalog: async () => catalog,
                        recordWriteIntent: async () => undefined,
                        writeTags: async () => {
                            throw new Error('an exhausted review loop must never write');
                        },
                    },
                ),
            (error) => {
                assert.ok(error instanceof ReviewLoopExhaustedError);
                assert.equal(error.rounds.length, 2);
                assert.equal(error.rounds[1].approval.reason, '第 2 轮仍未定位到数论。');
                return true;
            },
        );
        assert.equal(edits, 2);
        assert.equal(approvals, 2);
    });

    test('emits every editor, proposal, approval, feedback, revalidation, intent, and write phase for the TUI', async () => {
        const events: Array<Record<string, unknown>> = [];
        let approvals = 0;
        await processProblem(
            problem,
            catalog,
            { apply: true, extraSystemTags: [], maxReviewRounds: 3 },
            {
                observe: (event) => events.push(event as unknown as Record<string, unknown>),
                edit: async (_input, context) => ({
                    action: 'apply',
                    selectedNodeIds: [context.round === 1 ? 'math' : 'number'],
                    reason: context.round === 1 ? '先选数学。' : '按审批意见改成数论。',
                    confidence: 0.9,
                }),
                approve: async () => {
                    approvals++;
                    return approvals === 1
                        ? { decision: 'reject', reason: '请改为更具体的数论节点。' }
                        : { decision: 'approve', reason: '返修正确。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => undefined,
            },
        );

        assert.deepEqual(
            events.map((event) => (event.type === 'problem_phase' ? `${event.phase}:${event.status}` : event.type)),
            [
                'editor:started',
                'editor:completed',
                'proposal:completed',
                'approval:started',
                'approval:completed',
                'review_round_completed',
                'feedback:completed',
                'editor:started',
                'editor:completed',
                'proposal:completed',
                'approval:started',
                'approval:completed',
                'review_round_completed',
                'revalidation:started',
                'revalidation:completed',
                'write_intent:started',
                'write_intent:completed',
                'write:started',
                'write:completed',
            ],
        );
        const feedback = events.find((event) => event.type === 'problem_phase' && event.phase === 'feedback');
        assert.equal(feedback?.message, '审批拒绝：请改为更具体的数论节点。已反馈给编辑 Agent，准备第 2 轮返修。');
        const rounds = events.filter((event) => event.type === 'review_round_completed');
        assert.equal(rounds.length, 2);
        assert.deepEqual((rounds[0].review as Record<string, unknown>).approval, {
            decision: 'reject',
            reason: '请改为更具体的数论节点。',
        });
    });

    test('the approval agent also reviews an editor skip decision', async () => {
        let reviewedAction = '';
        const result = await processProblem(
            { ...problem, tag: ['PAT甲级', '数学', '数论'] },
            catalog,
            { apply: true, extraSystemTags: [] },
            {
                edit: async () => ({ action: 'skip', selectedNodeIds: [], reason: '现有标签完整。', confidence: 0.9 }),
                approve: async ({ proposal }) => {
                    reviewedAction = proposal.action;
                    return { decision: 'approve', reason: '无需继续添加。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => {
                    throw new Error('skip must not write');
                },
            },
        );

        assert.equal(reviewedAction, 'skip');
        assert.equal(result.status, 'skipped');
    });

    test('the approval agent receives the exact proposed change without editor-authored prose', async () => {
        await processProblem(
            problem,
            catalog,
            { apply: false, extraSystemTags: [] },
            {
                edit: async () => ({
                    action: 'apply',
                    selectedNodeIds: ['number'],
                    reason: 'editor-controlled-instruction',
                    confidence: 0.8,
                }),
                approve: async ({ proposal }) => {
                    assert.deepEqual(proposal, {
                        action: 'apply',
                        selectedNodeIds: ['number'],
                        addedTags: ['数学', '数论'],
                        finalTags: ['PAT甲级', '2025春', '数学', '数论'],
                    });
                    assert.doesNotMatch(JSON.stringify(proposal), /editor-controlled-instruction/);
                    return { decision: 'approve', reason: '只根据题面和差异审批。' };
                },
                loadCurrentCatalog: async () => catalog,
                recordWriteIntent: async () => undefined,
                writeTags: async () => {
                    throw new Error('dry-run must not write');
                },
            },
        );
    });

    test('apply mode revalidates the approved proposal against a fresh mindmap before writing', async () => {
        const changedCatalog = MindmapCatalog.from([
            { id: 'root', parentId: null, topic: '算法', tags: [] },
            { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
        ]);
        let writes = 0;

        await assert.rejects(
            () =>
                processProblem(
                    problem,
                    catalog,
                    { apply: true, extraSystemTags: [] },
                    {
                        edit: async () => ({ action: 'apply', selectedNodeIds: ['number'], reason: '数论题。', confidence: 0.9 }),
                        approve: async () => ({ decision: 'approve', reason: '原导图下合理。' }),
                        loadCurrentCatalog: async () => changedCatalog,
                        recordWriteIntent: async () => {
                            throw new Error('stale proposal must fail before recording a write intent');
                        },
                        writeTags: async () => {
                            writes++;
                        },
                    },
                ),
            /unknown mindmap node: number/i,
        );
        assert.equal(writes, 0);
    });

    test('marks revalidation failed when a retained node has a changed ancestor tag', async () => {
        const changedCatalog = MindmapCatalog.from([
            { id: 'root', parentId: null, topic: '算法', tags: [] },
            { id: 'math', parentId: 'root', topic: '数学', tags: ['离散数学'] },
            { id: 'number', parentId: 'math', topic: '数论', tags: ['数论'] },
        ]);
        const events: Array<Record<string, unknown>> = [];
        let intents = 0;
        let writes = 0;

        await assert.rejects(
            () =>
                processProblem(
                    problem,
                    catalog,
                    { apply: true, extraSystemTags: [] },
                    {
                        observe: (event) => events.push(event as unknown as Record<string, unknown>),
                        edit: async () => ({ action: 'apply', selectedNodeIds: ['number'], reason: '数论题。', confidence: 0.9 }),
                        approve: async () => ({ decision: 'approve', reason: '原导图下合理。' }),
                        loadCurrentCatalog: async () => changedCatalog,
                        recordWriteIntent: async () => {
                            intents++;
                        },
                        writeTags: async () => {
                            writes++;
                        },
                    },
                ),
            /mindmap changed after approval/,
        );

        const revalidation = events.filter((event) => event.type === 'problem_phase' && event.phase === 'revalidation');
        assert.deepEqual(
            revalidation.map((event) => event.status),
            ['started', 'failed'],
        );
        assert.match(String(revalidation[1]?.message), /mindmap changed after approval/);
        assert.equal(intents, 0);
        assert.equal(writes, 0);
        assert.equal(
            events.some((event) => event.type === 'problem_phase' && event.phase === 'write_intent'),
            false,
        );
        assert.equal(
            events.some((event) => event.type === 'problem_phase' && event.phase === 'write'),
            false,
        );
    });
});
