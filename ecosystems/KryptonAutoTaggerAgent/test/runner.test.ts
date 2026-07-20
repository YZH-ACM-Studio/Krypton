import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { OjClient, type ProblemSummary } from '../src/clients.js';
import type { MindmapNodeInput } from '../src/domain.js';
import type { ExternalCallFailedEvent, RuntimeEvent } from '../src/events.js';
import { executeRun as executeRunRaw, type ExecuteRunInput } from '../src/runner.js';
import { type RunSummary, summarizeRun } from '../src/summary.js';
import type { AgentInvocationContext, EditorInput, ProblemContext } from '../src/workflow.js';

const TEST_MAP_ID = 'map-algorithm';
type CanonicalKnowledgeKeys = 'knowledgeMapId' | 'knowledgeNodeIds';
type WithoutCanonicalKnowledge<T> = Omit<T, CanonicalKnowledgeKeys>;
type PartialCanonicalKnowledge<T extends Record<CanonicalKnowledgeKeys, unknown>> = Partial<Pick<T, CanonicalKnowledgeKeys>>;
type OptionalCanonicalKnowledge<T extends Record<CanonicalKnowledgeKeys, unknown>> = WithoutCanonicalKnowledge<T> & PartialCanonicalKnowledge<T>;
type TestProblemSummary = OptionalCanonicalKnowledge<ProblemSummary>;
type TestProblemContext = OptionalCanonicalKnowledge<ProblemContext>;
interface TestOjOperations {
    listTargetProblems(): Promise<TestProblemSummary[]>;
    getMindmapNodes(knowledgeMapId: string): Promise<MindmapNodeInput[]>;
    getProblemContext(docId: number): Promise<TestProblemContext>;
    writeTags(
        docId: number,
        knowledgeMapId: string,
        knowledgeNodeIds: string[],
        expectedTags: string[],
        expectedKnowledgeNodeIds: string[],
    ): Promise<void>;
}

function canonicalProblem<T extends object>(problem: T): T & { knowledgeMapId: string; knowledgeNodeIds: string[] } {
    const record = problem as Record<string, unknown>;
    return {
        ...problem,
        knowledgeMapId: typeof record.knowledgeMapId === 'string' ? record.knowledgeMapId : TEST_MAP_ID,
        knowledgeNodeIds: Array.isArray(record.knowledgeNodeIds) ? (record.knowledgeNodeIds as string[]) : [],
    };
}

/** Keep orchestration fixtures terse while the real OjClient remains strict about canonical map fields. */
function executeRun(input: Omit<ExecuteRunInput, 'oj'> & { oj: TestOjOperations }) {
    const oj = input.oj;
    return executeRunRaw({
        ...input,
        oj: {
            listTargetProblems: async () => (await oj.listTargetProblems()).map((problem) => canonicalProblem(problem)),
            getMindmapNodes: (knowledgeMapId) => oj.getMindmapNodes(knowledgeMapId),
            getProblemContext: async (docId) => canonicalProblem(await oj.getProblemContext(docId)),
            writeTags: (docId, knowledgeMapId, knowledgeNodeIds, expectedTags, expectedKnowledgeNodeIds) =>
                oj.writeTags(docId, knowledgeMapId, knowledgeNodeIds, expectedTags, expectedKnowledgeNodeIds),
        },
    });
}

describe('observable run orchestration', () => {
    test('keeps each problem on its own map from catalog load through canonical write', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-multi-map-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const mapLoads: string[] = [];
        const writes: Array<{ docId: number; mapId: string; nodeIds: string[]; expectedNodeIds: string[] }> = [];
        try {
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath,
                    failureFilePath: path.join(directory, 'failures.json'),
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 2,
                },
                oj: {
                    listTargetProblems: async () => [
                        { docId: 7, pid: 'P7', title: '算法题', tag: ['L2'], knowledgeMapId: 'map-a', knowledgeNodeIds: [] },
                        { docId: 8, pid: 'P8', title: '类定义题', tag: ['L2', '旧类'], knowledgeMapId: 'map-b', knowledgeNodeIds: ['class-old'] },
                    ],
                    getMindmapNodes: async (mapId) => {
                        mapLoads.push(mapId);
                        if (mapId === 'map-a') {
                            return [
                                { id: 'root-a', parentId: null, topic: '算法', tags: [] },
                                { id: 'math-a', parentId: 'root-a', topic: '数学', tags: ['共享标签'] },
                            ];
                        }
                        return [
                            { id: 'root-b', parentId: null, topic: '面向对象', tags: [] },
                            { id: 'class-old', parentId: 'root-b', topic: '旧类', tags: ['旧类'] },
                            { id: 'class-b', parentId: 'root-b', topic: '类', tags: ['共享标签'] },
                        ];
                    },
                    getProblemContext: async (docId) => {
                        if (docId === 7) {
                            return {
                                docId,
                                pid: 'P7',
                                title: '算法题',
                                tag: ['L2'],
                                knowledgeMapId: 'map-a',
                                knowledgeNodeIds: [],
                                content: '算法题面',
                            };
                        }
                        return {
                            docId,
                            pid: 'P8',
                            title: '类定义题',
                            tag: ['L2', '旧类'],
                            knowledgeMapId: 'map-b',
                            knowledgeNodeIds: ['class-old'],
                            content: '类定义题面',
                        };
                    },
                    writeTags: async (docId, mapId, nodeIds, _expectedTags, expectedNodeIds) => {
                        writes.push({ docId, mapId, nodeIds, expectedNodeIds });
                    },
                },
                agents: {
                    edit: async ({ problem }: EditorInput) => ({
                        action: 'apply',
                        selectedNodeIds: [problem.docId === 7 ? 'math-a' : 'class-b'],
                        reason: '选择当前题目所属图中的节点。',
                        confidence: 0.98,
                    }),
                    approve: async () => ({ decision: 'approve', reason: '节点与所属图一致。' }),
                },
                observe: () => undefined,
                getEvents: () => [],
            });

            assert.deepEqual(mapLoads, ['map-a', 'map-b', 'map-a', 'map-b']);
            assert.deepEqual(writes, [
                { docId: 7, mapId: 'map-a', nodeIds: ['math-a'], expectedNodeIds: [] },
                { docId: 8, mapId: 'map-b', nodeIds: ['class-old', 'class-b'], expectedNodeIds: ['class-old'] },
            ]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('records one problem failure and continues processing the remaining batch', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-problem-isolation-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const events: RuntimeEvent[] = [];
        const editedDocIds: number[] = [];
        const writtenDocIds: number[] = [];
        try {
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath,
                    failureFilePath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => [
                        { docId: 7, pid: 'P7', title: '失败题', tag: ['L2'] },
                        { docId: 8, pid: 'P8', title: '后续成功题', tag: ['L2'] },
                    ],
                    getMindmapNodes: async () => [
                        { id: 'root', parentId: null, topic: '算法', tags: [] },
                        { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                    ],
                    getProblemContext: async (docId) => ({
                        docId,
                        pid: `P${docId}`,
                        title: docId === 7 ? '失败题' : '后续成功题',
                        tag: ['L2'],
                        content: `题面 ${docId}`,
                    }),
                    writeTags: async (docId) => {
                        writtenDocIds.push(docId);
                    },
                },
                agents: {
                    edit: async (input: EditorInput) => {
                        editedDocIds.push(input.problem.docId);
                        if (input.problem.docId === 7) throw new Error('simulated single-problem model failure');
                        return { action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 };
                    },
                    approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
                },
                observe: (event) => events.push(event),
                getEvents: () => events,
            });

            assert.deepEqual(editedDocIds, [7, 8]);
            assert.deepEqual(writtenDocIds, [8]);
            assert.deepEqual(
                events.filter((event) => event.type === 'problem_failed').map((event) => event.problem.docId),
                [7],
            );
            assert.deepEqual(
                events.filter((event) => event.type === 'problem_completed').map((event) => event.problem.docId),
                [8],
            );
            assert.equal(events.at(-1)?.type, 'run_completed');

            const report = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            assert.deepEqual(
                report.filter((record) => record.type === 'problem_error' || record.type === 'problem_result').map((record) => record.type),
                ['problem_error', 'problem_result'],
            );
            assert.equal(report.at(-1)?.type, 'run_completed');
            const ledger = JSON.parse(await readFile(failureFilePath, 'utf8')) as {
                version: number;
                failures: Array<Record<string, unknown>>;
            };
            assert.equal(ledger.version, 1);
            assert.deepEqual(
                ledger.failures.map(({ firstFailedAt: _firstFailedAt, lastFailedAt: _lastFailedAt, ...failure }) => failure),
                [{ docId: 7, pid: 'P7', title: '失败题', attempts: 1, lastError: 'simulated single-problem model failure' }],
            );
            assert.equal(typeof ledger.failures[0].firstFailedAt, 'string');
            assert.equal(typeof ledger.failures[0].lastFailedAt, 'string');
            const markdown = await readFile(reportPath.replace(/\.jsonl$/, '-summary.md'), 'utf8');
            assert.match(markdown, /题目：完成 1，失败尝试 1/);
            assert.match(markdown, /P8 后续成功题/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('treats operator cancellation as a global stop and never starts the next problem', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-cancel-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const controller = new AbortController();
        const events: RuntimeEvent[] = [];
        const editedDocIds: number[] = [];
        const writtenDocIds: number[] = [];
        const interruption = new Error('operator interrupted run');
        try {
            await assert.rejects(
                () =>
                    executeRun({
                        settings: {
                            apply: true,
                            limit: null,
                            reportPath,
                            failureFilePath,
                            extraSystemTags: [],
                            editorModel: 'editor-model',
                            approvalModel: 'approval-model',
                            maxReviewRounds: 3,
                        },
                        oj: {
                            listTargetProblems: async () => [
                                { docId: 7, pid: 'P7', title: '当前题', tag: ['L2'] },
                                { docId: 8, pid: 'P8', title: '不得启动的下一题', tag: ['L2'] },
                            ],
                            getMindmapNodes: async () => [{ id: 'math', parentId: null, topic: '数学', tags: ['数学'] }],
                            getProblemContext: async (docId) => ({
                                docId,
                                pid: `P${docId}`,
                                title: docId === 7 ? '当前题' : '不得启动的下一题',
                                tag: ['L2'],
                                content: `题面 ${docId}`,
                            }),
                            writeTags: async (docId) => {
                                writtenDocIds.push(docId);
                            },
                        },
                        agents: {
                            edit: async (input: EditorInput) => {
                                editedDocIds.push(input.problem.docId);
                                if (input.problem.docId === 7) {
                                    controller.abort(interruption);
                                    throw interruption;
                                }
                                return { action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 };
                            },
                            approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
                        },
                        observe: (event) => events.push(event),
                        getEvents: () => events,
                        signal: controller.signal,
                    }),
                /operator interrupted run/,
            );

            assert.deepEqual(editedDocIds, [7]);
            assert.deepEqual(writtenDocIds, []);
            assert.equal(
                events.some((event) => event.type === 'problem_failed'),
                false,
            );
            assert.equal(events.at(-1)?.type, 'run_failed');
            const report = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            assert.equal(report.at(-1)?.type, 'run_failed');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('drives the TUI lifecycle and preserves the full rejection-revision trail in JSONL', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        const statement = '中文题面 LINE "quoted" \\ path\nNEXT_UNIQUE_FULL_PROBLEM_STATEMENT';
        const unicodeEscapedStatement = [...statement]
            .map((character) => [...character].map((codeUnit) => `\\u${codeUnit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''))
            .join('');
        let edits = 0;
        let approvals = 0;
        try {
            await executeRun({
                settings: {
                    apply: false,
                    limit: null,
                    reportPath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] }],
                    getMindmapNodes: async () => [
                        { id: 'root', parentId: null, topic: '算法', tags: [] },
                        { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                        { id: 'number', parentId: 'math', topic: '数论', tags: ['数论'] },
                    ],
                    getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'], content: statement }),
                    writeTags: async () => {
                        throw new Error('dry-run must not write');
                    },
                },
                agents: {
                    edit: async (_input: EditorInput, context: AgentInvocationContext) => {
                        edits++;
                        if (context.round === 1) {
                            events.push({
                                type: 'model_call_completed',
                                at: new Date().toISOString(),
                                callId: 'synthetic-editor-call',
                                role: 'editor',
                                round: 1,
                                model: 'editor-model',
                                problem: { docId: 7, pid: 'P7', title: '快速幂' },
                                toolsProvided: false,
                                durationMs: 1,
                                responseId: 'synthetic-response',
                                finishReason: 'stop',
                                reasoningContent: statement,
                                rawContent: `{"reason":"${unicodeEscapedStatement}","${unicodeEscapedStatement}":"key evidence"}`,
                                parsedDecision: { reason: statement },
                                toolCalls: [],
                                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                            });
                        }
                        return context.round === 1
                            ? { action: 'apply', selectedNodeIds: ['math'], reason: '标签过宽。', confidence: 0.7 }
                            : { action: 'apply', selectedNodeIds: ['number'], reason: '按审批意见改为数论。', confidence: 0.95 };
                    },
                    approve: async () => {
                        approvals++;
                        return approvals === 1
                            ? { decision: 'reject', reason: '应选择更具体的数论节点。' }
                            : { decision: 'approve', reason: '返修正确。' };
                    },
                },
                observe: (event) => events.push(event),
                getEvents: () => events,
            });

            assert.equal(edits, 2);
            assert.equal(approvals, 2);
            assert.deepEqual(
                events
                    .filter((event) =>
                        ['run_started', 'run_ready', 'problem_started', 'review_round_completed', 'problem_completed', 'run_completed'].includes(
                            event.type,
                        ),
                    )
                    .map((event) => event.type),
                [
                    'run_started',
                    'run_ready',
                    'problem_started',
                    'review_round_completed',
                    'review_round_completed',
                    'problem_completed',
                    'run_completed',
                ],
            );

            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const result = lines.find((line) => line.type === 'problem_result');
            assert.ok(result);
            assert.equal(result.status, 'planned');
            assert.equal((result.reviewRounds as unknown[]).length, 2);
            assert.match(JSON.stringify(result.trace), /应选择更具体的数论节点/);
            const modelTrace = (result.trace as Array<Record<string, unknown>>).find((event) => event.type === 'model_call_completed');
            const escapedStatement = JSON.stringify(statement).slice(1, -1);
            const redactedRawContent = String(modelTrace?.rawContent);
            assert.equal(redactedRawContent.includes(statement), false);
            assert.equal(redactedRawContent.includes(escapedStatement), false);
            assert.equal(redactedRawContent.includes(unicodeEscapedStatement), false);
            assert.deepEqual(JSON.parse(redactedRawContent), {
                reason: '[REDACTED_PROBLEM_STATEMENT]',
                '[REDACTED_PROBLEM_STATEMENT]': 'key evidence',
            });
            assert.match(JSON.stringify(result), /REDACTED_PROBLEM_STATEMENT/);
            assert.equal(lines.at(-1)?.type, 'run_completed');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('keeps literal redaction case-sensitive and compiles each statement pattern once per audit tree', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-case-sensitive-redaction-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        const originalRegExp = globalThis.RegExp;
        let statementPatternCompilations = 0;
        const countingRegExp = new Proxy(originalRegExp, {
            construct(target, args) {
                if (String(args[0]).includes('\\\\u0041')) statementPatternCompilations++;
                return Reflect.construct(target, args, target);
            },
        }) as RegExpConstructor;
        try {
            globalThis.RegExp = countingRegExp;
            try {
                await executeRun({
                    settings: {
                        apply: false,
                        limit: null,
                        reportPath,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '单字符题', tag: ['L2'] }],
                        getMindmapNodes: async () => [{ id: 'root', parentId: null, topic: '算法', tags: [] }],
                        getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '单字符题', tag: ['L2'], content: 'A' }),
                        writeTags: async () => {
                            throw new Error('approved skip must not write');
                        },
                    },
                    agents: {
                        edit: async () => {
                            events.push({
                                type: 'model_call_completed',
                                at: new Date().toISOString(),
                                callId: 'case-sensitive-redaction',
                                role: 'editor',
                                round: 1,
                                model: 'editor-model',
                                problem: { docId: 7, pid: 'P7', title: '单字符题' },
                                toolsProvided: false,
                                durationMs: 1,
                                responseId: 'response-redaction',
                                finishReason: 'stop',
                                reasoningContent: 'A',
                                rawContent: String.raw`provider echo: \u0041`,
                                parsedDecision: { action: 'skip' },
                                toolCalls: [],
                                usage: null,
                            });
                            return { action: 'skip', selectedNodeIds: [], reason: 'already adequate', confidence: 0.95 };
                        },
                        approve: async () => ({ decision: 'approve', reason: 'approved' }),
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                });
            } finally {
                globalThis.RegExp = originalRegExp;
            }

            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const result = lines.find((line) => line.type === 'problem_result');
            assert.ok(result);
            assert.equal(result.status, 'skipped');
            assert.equal((result.editor as Record<string, unknown>).reason, 'already adequate');
            assert.match(JSON.stringify(result), /REDACTED_PROBLEM_STATEMENT/);
            assert.equal(statementPatternCompilations, 1);
        } finally {
            globalThis.RegExp = originalRegExp;
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('waits for every started initialization request before recording the terminal failure', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-initialization-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        const observe = (event: RuntimeEvent) => events.push(event);
        try {
            await assert.rejects(
                () =>
                    executeRun({
                        settings: {
                            apply: false,
                            limit: null,
                            reportPath,
                            extraSystemTags: [],
                            editorModel: 'editor-model',
                            approvalModel: 'approval-model',
                            maxReviewRounds: 3,
                        },
                        oj: {
                            listTargetProblems: async () => [
                                { docId: 7, pid: 'P7', title: '图 A', tag: ['L2'], knowledgeMapId: 'map-a', knowledgeNodeIds: [] },
                                { docId: 8, pid: 'P8', title: '图 B', tag: ['L2'], knowledgeMapId: 'map-b', knowledgeNodeIds: [] },
                            ],
                            getMindmapNodes: async (knowledgeMapId) => {
                                observe({
                                    type: 'external_call_started',
                                    at: new Date().toISOString(),
                                    callId: knowledgeMapId,
                                    service: 'oj',
                                    operation: `GET mindmap ${knowledgeMapId}`,
                                });
                                if (knowledgeMapId === 'map-a') {
                                    observe({
                                        type: 'external_call_failed',
                                        at: new Date().toISOString(),
                                        callId: knowledgeMapId,
                                        service: 'oj',
                                        operation: `GET mindmap ${knowledgeMapId}`,
                                        durationMs: 0,
                                        httpStatus: 500,
                                        error: 'map-a unavailable',
                                    });
                                    throw new Error('map-a unavailable');
                                }
                                await new Promise((resolve) => setTimeout(resolve, 10));
                                observe({
                                    type: 'external_call_completed',
                                    at: new Date().toISOString(),
                                    callId: knowledgeMapId,
                                    service: 'oj',
                                    operation: `GET mindmap ${knowledgeMapId}`,
                                    durationMs: 10,
                                    httpStatus: 200,
                                });
                                return [{ id: 'root-b', parentId: null, topic: '图 B', tags: [] }];
                            },
                            getProblemContext: async () => {
                                throw new Error('must not load a problem');
                            },
                            writeTags: async () => {
                                throw new Error('must not write');
                            },
                        },
                        agents: {
                            edit: async () => {
                                throw new Error('must not edit');
                            },
                            approve: async () => {
                                throw new Error('must not approve');
                            },
                        },
                        observe,
                        getEvents: () => events,
                    }),
                /map-a unavailable/,
            );

            await new Promise((resolve) => setTimeout(resolve, 15));
            assert.equal(events.at(-1)?.type, 'run_failed');
            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const failure = lines.at(-1);
            assert.equal(failure?.type, 'run_failed');
            assert.match(JSON.stringify(failure?.trace), /external_call_failed/);
            assert.match(JSON.stringify(failure?.trace), /external_call_completed/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('records review exhaustion as a failed problem without failing the batch', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        try {
            await executeRun({
                settings: {
                    apply: false,
                    limit: null,
                    reportPath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 1,
                },
                oj: {
                    listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] }],
                    getMindmapNodes: async () => [
                        { id: 'root', parentId: null, topic: '算法', tags: [] },
                        { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                    ],
                    getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'], content: '计算 a 的 b 次幂。' }),
                    writeTags: async () => {
                        throw new Error('failed review must not write');
                    },
                },
                agents: {
                    edit: async () => ({ action: 'apply', selectedNodeIds: ['math'], reason: '数学。', confidence: 0.7 }),
                    approve: async () => ({ decision: 'reject', reason: '证据不足。' }),
                },
                observe: (event) => events.push(event),
                getEvents: () => events,
            });

            const terminal = events.at(-1);
            assert.equal(terminal?.type, 'run_completed');
            assert.ok(events.some((event) => event.type === 'problem_failed'));
            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const problemError = lines.find((line) => line.type === 'problem_error');
            assert.match(JSON.stringify(problemError?.error), /revision loop exhausted after 1 attempts/);
            assert.match(JSON.stringify(problemError?.trace), /problem_failed/);
            assert.equal(lines.at(-1)?.type, 'run_completed');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('persists initialization OJ calls and the same complete aggregate shown by the TUI', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-bootstrap-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        const observe = (event: RuntimeEvent) => events.push(event);
        const oj = new OjClient(
            'http://oj.test',
            'kat_secret',
            async (input) => {
                const url = new URL(String(input));
                if (url.pathname === '/api/tagger/audit') {
                    return Response.json({
                        problems: [
                            {
                                docId: 7,
                                pid: 'P7',
                                title: '已标注',
                                tag: ['L2', '数学'],
                                knowledgeMapId: TEST_MAP_ID,
                                knowledgeNodeIds: ['math'],
                            },
                        ],
                    });
                }
                if (url.pathname === '/api/tagger/mindmap') {
                    return Response.json({
                        knowledgeMap: { id: TEST_MAP_ID, title: '算法', visibility: 'public' },
                        nodes: [
                            { id: 'root', mapId: TEST_MAP_ID, parentId: null, topic: '算法', tags: [] },
                            { id: 'math', mapId: TEST_MAP_ID, parentId: 'root', topic: '数学', tags: ['数学'] },
                        ],
                    });
                }
                if (url.pathname === '/api/tagger/problem-context') {
                    return Response.json({
                        problem: {
                            docId: 7,
                            pid: 'P7',
                            title: '已标注',
                            tag: ['L2', '数学'],
                            knowledgeMapId: TEST_MAP_ID,
                            knowledgeNodeIds: ['math'],
                            content: '题面',
                        },
                    });
                }
                throw new Error(`unexpected test URL: ${url}`);
            },
            { observe },
        );
        try {
            await executeRun({
                settings: {
                    apply: false,
                    limit: null,
                    reportPath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj,
                agents: {
                    edit: async () => ({ action: 'skip', selectedNodeIds: [], reason: '现有标签已足够。', confidence: 0.95 }),
                    approve: async () => ({ decision: 'approve', reason: '无需新增。' }),
                },
                observe,
                getEvents: () => events,
            });

            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const ready = lines.find((line) => line.type === 'run_ready');
            assert.match(JSON.stringify(ready?.initializationTrace), /GET \/api\/tagger\/audit/);
            assert.match(JSON.stringify(ready?.initializationTrace), /GET \/api\/tagger\/mindmap/);
            const completed = lines.find((line) => line.type === 'run_completed');
            const summary = completed?.summary as RunSummary;
            assert.deepEqual(summary.oj, { calls: 3, succeeded: 3, failed: 0 });
            assert.deepEqual(summary.counts, { applied: 0, planned: 0, skipped: 1 });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('turns an apply-time OJ business rejection into an observable failed problem after recording intent', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-write-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const events: RuntimeEvent[] = [];
        const observe = (event: RuntimeEvent) => events.push(event);
        const oj = new OjClient(
            'http://oj.test',
            'kat_secret',
            async (input) => {
                const url = new URL(String(input));
                if (url.pathname === '/api/tagger/audit') {
                    return Response.json({
                        problems: [
                            {
                                docId: 7,
                                pid: 'P7',
                                title: '快速幂',
                                tag: ['L2'],
                                knowledgeMapId: TEST_MAP_ID,
                                knowledgeNodeIds: [],
                            },
                        ],
                    });
                }
                if (url.pathname === '/api/tagger/mindmap') {
                    return Response.json({
                        knowledgeMap: { id: TEST_MAP_ID, title: '算法', visibility: 'public' },
                        nodes: [
                            { id: 'root', mapId: TEST_MAP_ID, parentId: null, topic: '算法', tags: [] },
                            { id: 'math', mapId: TEST_MAP_ID, parentId: 'root', topic: '数学', tags: ['数学'] },
                        ],
                    });
                }
                if (url.pathname === '/api/tagger/problem-context') {
                    return Response.json({
                        problem: {
                            docId: 7,
                            pid: 'P7',
                            title: '快速幂',
                            tag: ['L2'],
                            knowledgeMapId: TEST_MAP_ID,
                            knowledgeNodeIds: [],
                            content: '题面',
                        },
                    });
                }
                if (url.pathname === '/api/tagger/apply') {
                    return Response.json({ results: [{ docId: 7, ok: false, error: 'tag_conflict' }] });
                }
                throw new Error(`unexpected test URL: ${url}`);
            },
            { observe },
        );
        try {
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath,
                    failureFilePath: path.join(directory, 'failed-problems.json'),
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj,
                agents: {
                    edit: async () => ({ action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 }),
                    approve: async () => ({ decision: 'approve', reason: '提案正确。' }),
                },
                observe,
                getEvents: () => events,
            });

            const failedWrite = events.find(
                (event): event is ExternalCallFailedEvent => event.type === 'external_call_failed' && event.operation === 'POST /api/tagger/apply',
            );
            assert.ok(failedWrite);
            assert.equal(failedWrite.httpStatus, 200);
            assert.ok(events.some((event) => event.type === 'problem_failed'));
            const lines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            assert.ok(lines.findIndex((line) => line.type === 'approved_write_intent') < lines.findIndex((line) => line.type === 'problem_error'));
            assert.match(JSON.stringify(lines.find((line) => line.type === 'problem_error')), /tag_conflict/);
            assert.equal(lines.at(-1)?.type, 'run_completed');
            const markdown = await readFile(reportPath.replace(/\.jsonl$/, '-summary.md'), 'utf8');
            assert.match(markdown, /状态：完成（含失败题）/);
            assert.match(markdown, /题目：完成 0，失败尝试 1/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('resumes after completed results and writes one cumulative human-readable classification file', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-resume-run-'));
        const previousReportPath = path.join(directory, 'interrupted.jsonl');
        const reportPath = path.join(directory, 'resumed.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const previousEvents = [
            {
                type: 'problem_completed',
                problem: { docId: 761, pid: 'M0761', title: '1001 A+B Format' },
                status: 'applied',
                addedTags: ['基础算法', '模拟'],
                reviewRounds: 1,
            },
            {
                type: 'problem_completed',
                problem: { docId: 762, pid: 'M0762', title: '1002 A+B for Polynomials' },
                status: 'skipped',
                addedTags: [],
                reviewRounds: 1,
            },
        ] as unknown as RuntimeEvent[];
        const previousRecords = [
            {
                type: 'run_started',
                at: '2026-07-15T06:48:16.818Z',
                mode: 'apply',
                reportPath: previousReportPath,
                targetTags: ['L2', 'PAT甲级'],
                editorModel: 'editor-model',
                approvalModel: 'approval-model',
                maxReviewRounds: 3,
                retryFailed: false,
                failureFilePath,
            },
            {
                type: 'approved_write_intent',
                at: '2026-07-15T06:49:00.000Z',
                problem: { docId: 761, pid: 'M0761', title: '1001 A+B Format' },
                beforeTags: ['PAT甲级'],
                afterTags: ['PAT甲级', '基础算法', '模拟'],
            },
            {
                type: 'problem_result',
                at: '2026-07-15T06:49:01.000Z',
                status: 'applied',
                problem: { docId: 761, pid: 'M0761', title: '1001 A+B Format', beforeTags: ['PAT甲级'] },
                proposal: { addedTags: ['基础算法', '模拟'] },
            },
            {
                type: 'problem_result',
                at: '2026-07-15T06:50:01.000Z',
                status: 'skipped',
                problem: { docId: 762, pid: 'M0762', title: '1002 A+B for Polynomials', beforeTags: ['PAT甲级'] },
                proposal: { addedTags: [] },
            },
            {
                type: 'run_failed',
                at: '2026-07-15T06:51:00.000Z',
                durationMs: 164_000,
                reportPath: previousReportPath,
                error: { message: 'interrupted', stack: null },
                summary: summarizeRun(previousEvents),
            },
        ];
        const targets = [761, 762, 778, 779].map((docId) => ({
            docId,
            pid: `M${String(docId).padStart(4, '0')}`,
            title: `Problem ${docId}`,
            tag: ['PAT甲级'],
        }));
        const processedDocIds: number[] = [];
        const writtenDocIds: number[] = [];
        const events: RuntimeEvent[] = [];
        try {
            await writeFile(previousReportPath, `${previousRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
            await executeRun({
                settings: {
                    apply: true,
                    limit: 2,
                    reportPath,
                    resumeReportPath: previousReportPath,
                    failureFilePath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => targets,
                    getMindmapNodes: async () => [
                        { id: 'root', parentId: null, topic: '算法', tags: [] },
                        { id: 'basic', parentId: 'root', topic: '基础算法', tags: ['基础算法'] },
                        { id: 'simulation', parentId: 'basic', topic: '模拟', tags: ['模拟'] },
                    ],
                    getProblemContext: async (docId) => {
                        processedDocIds.push(docId);
                        return {
                            docId,
                            pid: `M${String(docId).padStart(4, '0')}`,
                            title: `Problem ${docId}`,
                            tag: ['PAT甲级'],
                            content: `Statement ${docId}`,
                        };
                    },
                    writeTags: async (docId) => {
                        writtenDocIds.push(docId);
                    },
                },
                agents: {
                    edit: async () => ({ action: 'apply', selectedNodeIds: ['simulation'], reason: '模拟题。', confidence: 0.95 }),
                    approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
                },
                observe: (event) => events.push(event),
                getEvents: () => events,
            });

            assert.deepEqual(processedDocIds, [778, 779]);
            assert.deepEqual(writtenDocIds, [778, 779]);
            const started = events.find((event) => event.type === 'run_started');
            const ready = events.find((event) => event.type === 'run_ready');
            assert.equal(started?.resumeReportPath, previousReportPath);
            assert.equal(ready?.resumedCompletedCount, 2);
            const markdown = await readFile(reportPath.replace(/\.jsonl$/, '-summary.md'), 'utf8');
            assert.match(markdown, /续跑来源：.*interrupted\.jsonl/);
            assert.match(markdown, /### 模拟（3）/);
            assert.match(markdown, /M0761 1001 A\+B Format/);
            assert.match(markdown, /M0778 Problem 778/);
            assert.match(markdown, /M0779 Problem 779/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('reserves the Markdown summary path before any OJ or Agent call', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-summary-reservation-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const summaryPath = path.join(directory, 'run-summary.md');
        const calls: string[] = [];
        const events: RuntimeEvent[] = [];
        try {
            await writeFile(summaryPath, 'existing summary\n');
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: true,
                        limit: null,
                        reportPath,
                        failureFilePath: path.join(directory, 'failed-problems.json'),
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => {
                            calls.push('listTargetProblems');
                            return [];
                        },
                        getMindmapNodes: async () => {
                            calls.push('getMindmapNodes');
                            return [];
                        },
                        getProblemContext: async () => {
                            calls.push('getProblemContext');
                            throw new Error('must not be called');
                        },
                        writeTags: async () => {
                            calls.push('writeTags');
                        },
                    },
                    agents: {
                        edit: async () => {
                            calls.push('edit');
                            return { action: 'skip', selectedNodeIds: [], reason: 'skip', confidence: 1 };
                        },
                        approve: async () => {
                            calls.push('approve');
                            return { decision: 'approve', reason: 'skip' };
                        },
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                }),
            );

            assert.deepEqual(calls, []);
            assert.equal(await readFile(summaryPath, 'utf8'), 'existing summary\n');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('does not double-count an unpersisted no-write result when the failed run is resumed', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-unpersisted-result-'));
        const firstReportPath = path.join(directory, 'first.jsonl');
        const resumedReportPath = path.join(directory, 'resumed.jsonl');
        const target = { docId: 761, pid: 'M0761', title: '1001 A+B Format', tag: ['PAT甲级'] };
        const mindmapNodes = [
            { id: 'root', parentId: null, topic: '算法', tags: [] as string[] },
            { id: 'basic', parentId: 'root', topic: '基础算法', tags: ['基础算法'] },
            { id: 'simulation', parentId: 'basic', topic: '模拟', tags: ['模拟'] },
        ];
        const agents = {
            edit: async () => ({ action: 'apply', selectedNodeIds: ['simulation'], reason: '模拟题。', confidence: 0.95 }),
            approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
        };
        const firstEvents: RuntimeEvent[] = [];
        let reportPrefix = '';
        let sabotaged = false;
        let restored = false;
        try {
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: false,
                        limit: null,
                        reportPath: firstReportPath,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [target],
                        getMindmapNodes: async () => mindmapNodes,
                        getProblemContext: async () => ({ ...target, content: 'Statement' }),
                        writeTags: async () => {
                            throw new Error('dry-run must not write');
                        },
                    },
                    agents,
                    observe: (event) => {
                        firstEvents.push(event);
                        if (event.type === 'problem_phase' && event.phase === 'audit' && event.status === 'started' && !sabotaged) {
                            reportPrefix = readFileSync(firstReportPath, 'utf8');
                            rmSync(firstReportPath);
                            mkdirSync(firstReportPath);
                            sabotaged = true;
                        } else if (event.type === 'problem_phase' && event.phase === 'audit' && event.status === 'failed' && !restored) {
                            rmSync(firstReportPath, { recursive: true });
                            writeFileSync(firstReportPath, reportPrefix);
                            restored = true;
                        }
                    },
                    getEvents: () => firstEvents,
                }),
            );
            assert.equal(sabotaged, true);
            assert.equal(restored, true);
            assert.equal(
                firstEvents.some((event) => event.type === 'problem_completed'),
                false,
            );
            assert.equal(
                firstEvents.some((event) => event.type === 'problem_failed'),
                true,
            );

            const resumedEvents: RuntimeEvent[] = [];
            await executeRun({
                settings: {
                    apply: false,
                    limit: null,
                    reportPath: resumedReportPath,
                    resumeReportPath: firstReportPath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => [target],
                    getMindmapNodes: async () => mindmapNodes,
                    getProblemContext: async () => ({ ...target, content: 'Statement' }),
                    writeTags: async () => {
                        throw new Error('dry-run must not write');
                    },
                },
                agents,
                observe: (event) => resumedEvents.push(event),
                getEvents: () => resumedEvents,
            });

            const terminal = JSON.parse((await readFile(resumedReportPath, 'utf8')).trimEnd().split('\n').at(-1) || '{}') as {
                cumulativeSummary: RunSummary;
            };
            assert.deepEqual(terminal.cumulativeSummary.counts, { applied: 0, planned: 1, skipped: 0 });
            assert.equal(terminal.cumulativeSummary.problems.completed, 1);
            assert.match(await readFile(resumedReportPath.replace(/\.jsonl$/, '-summary.md'), 'utf8'), /计划写入 1/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('keeps a persisted skip completed when later failure-ledger cleanup fails', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-persisted-skip-'));
        const firstReportPath = path.join(directory, 'first.jsonl');
        const resumedReportPath = path.join(directory, 'resumed.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const resumedFailureFilePath = path.join(directory, 'resumed-failed-problems.json');
        const target = { docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] };
        const firstEvents: RuntimeEvent[] = [];
        try {
            await writeFile(
                failureFilePath,
                `${JSON.stringify(
                    {
                        version: 1,
                        failures: [
                            {
                                docId: 7,
                                pid: 'P7',
                                title: '快速幂',
                                attempts: 1,
                                firstFailedAt: '2026-07-15T00:00:00.000Z',
                                lastFailedAt: '2026-07-15T00:00:00.000Z',
                                lastError: 'old review failure',
                            },
                        ],
                    },
                    null,
                    2,
                )}\n`,
            );
            await mkdir(`${failureFilePath}.${process.pid}.tmp`);
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: true,
                        limit: null,
                        reportPath: firstReportPath,
                        failureFilePath,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [target],
                        getMindmapNodes: async () => [{ id: 'root', parentId: null, topic: '算法', tags: [] }],
                        getProblemContext: async () => ({ ...target, content: 'Statement' }),
                        writeTags: async () => {
                            throw new Error('approved skip must not write');
                        },
                    },
                    agents: {
                        edit: async () => ({ action: 'skip', selectedNodeIds: [], reason: '已有标签足够。', confidence: 0.95 }),
                        approve: async () => ({ decision: 'approve', reason: '无需修改。' }),
                    },
                    observe: (event) => firstEvents.push(event),
                    getEvents: () => firstEvents,
                }),
            );

            const firstRecords = (await readFile(firstReportPath, 'utf8'))
                .trimEnd()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            assert.equal(
                firstRecords.some((record) => record.type === 'problem_result' && record.status === 'skipped'),
                true,
            );
            assert.equal(firstEvents.find((event) => event.type === 'problem_completed')?.status, 'skipped');
            assert.equal(
                firstEvents.some((event) => event.type === 'problem_failed'),
                false,
            );

            const resumedEvents: RuntimeEvent[] = [];
            const resumedCalls: string[] = [];
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath: resumedReportPath,
                    resumeReportPath: firstReportPath,
                    failureFilePath: resumedFailureFilePath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => [target],
                    getMindmapNodes: async () => [{ id: 'root', parentId: null, topic: '算法', tags: [] }],
                    getProblemContext: async () => {
                        resumedCalls.push('getProblemContext');
                        return { ...target, content: 'Statement' };
                    },
                    writeTags: async () => {
                        resumedCalls.push('writeTags');
                    },
                },
                agents: {
                    edit: async () => {
                        resumedCalls.push('edit');
                        return { action: 'skip', selectedNodeIds: [], reason: '已有标签足够。', confidence: 0.95 };
                    },
                    approve: async () => {
                        resumedCalls.push('approve');
                        return { decision: 'approve', reason: '无需修改。' };
                    },
                },
                observe: (event) => resumedEvents.push(event),
                getEvents: () => resumedEvents,
            });

            assert.deepEqual(resumedCalls, []);
            const terminal = JSON.parse((await readFile(resumedReportPath, 'utf8')).trimEnd().split('\n').at(-1) || '{}') as {
                cumulativeSummary: RunSummary;
            };
            assert.deepEqual(terminal.cumulativeSummary.counts, { applied: 0, planned: 0, skipped: 1 });
            assert.equal(terminal.cumulativeSummary.problems.completed, 1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('records apply failures and removes them after a successful retry-failed run', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-retry-failed-'));
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const targets = [
            { docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] },
            { docId: 8, pid: 'P8', title: '最短路', tag: ['L2'] },
        ];
        const mindmapNodes = [
            { id: 'root', parentId: null, topic: '算法', tags: [] as string[] },
            { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
        ];
        const agents = {
            edit: async () => ({ action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 }),
            approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
        };
        try {
            const firstEvents: RuntimeEvent[] = [];
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath: path.join(directory, 'first.jsonl'),
                    failureFilePath,
                    retryFailed: false,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => targets,
                    getMindmapNodes: async () => mindmapNodes,
                    getProblemContext: async (docId) => ({
                        docId,
                        pid: `P${docId}`,
                        title: docId === 7 ? '快速幂' : '最短路',
                        tag: ['L2'],
                        content: '题面',
                    }),
                    writeTags: async () => {
                        throw new Error('simulated apply failure');
                    },
                },
                agents,
                observe: (event) => firstEvents.push(event),
                getEvents: () => firstEvents,
            });

            const failedLedger = JSON.parse(await readFile(failureFilePath, 'utf8')) as Record<string, unknown>;
            assert.equal(failedLedger.version, 1);
            assert.deepEqual(
                (failedLedger.failures as Array<Record<string, unknown>>).map(({ docId, pid, title, attempts }) => ({ docId, pid, title, attempts })),
                [
                    { docId: 7, pid: 'P7', title: '快速幂', attempts: 1 },
                    { docId: 8, pid: 'P8', title: '最短路', attempts: 1 },
                ],
            );
            assert.match(JSON.stringify(failedLedger), /simulated apply failure/);

            const dryRunDocIds: number[] = [];
            const dryRunEvents: RuntimeEvent[] = [];
            await executeRun({
                settings: {
                    apply: false,
                    limit: null,
                    reportPath: path.join(directory, 'retry-dry-run.jsonl'),
                    failureFilePath,
                    retryFailed: true,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => targets,
                    getMindmapNodes: async () => mindmapNodes,
                    getProblemContext: async (docId) => {
                        dryRunDocIds.push(docId);
                        return { docId, pid: `P${docId}`, title: docId === 7 ? '快速幂' : '最短路', tag: ['L2'], content: '题面' };
                    },
                    writeTags: async () => {
                        throw new Error('retry dry-run must not write');
                    },
                },
                agents,
                observe: (event) => dryRunEvents.push(event),
                getEvents: () => dryRunEvents,
            });
            assert.deepEqual(dryRunDocIds, [7, 8]);
            assert.deepEqual(JSON.parse(await readFile(failureFilePath, 'utf8')), failedLedger);

            const repeatedFailureEvents: RuntimeEvent[] = [];
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath: path.join(directory, 'retry-failed-again.jsonl'),
                    failureFilePath,
                    retryFailed: true,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => targets,
                    getMindmapNodes: async () => mindmapNodes,
                    getProblemContext: async (docId) => ({
                        docId,
                        pid: `P${docId}`,
                        title: docId === 7 ? '快速幂' : '最短路',
                        tag: ['L2'],
                        content: '题面',
                    }),
                    writeTags: async () => {
                        throw new Error('second simulated apply failure');
                    },
                },
                agents,
                observe: (event) => repeatedFailureEvents.push(event),
                getEvents: () => repeatedFailureEvents,
            });
            const repeatedLedger = JSON.parse(await readFile(failureFilePath, 'utf8')) as {
                failures: Array<{ attempts: number; lastError: string }>;
            };
            assert.deepEqual(
                repeatedLedger.failures.map(({ attempts, lastError }) => ({ attempts, lastError })),
                [
                    { attempts: 2, lastError: 'second simulated apply failure' },
                    { attempts: 2, lastError: 'second simulated apply failure' },
                ],
            );

            const retriedDocIds: number[] = [];
            const retryEvents: RuntimeEvent[] = [];
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath: path.join(directory, 'retry.jsonl'),
                    failureFilePath,
                    retryFailed: true,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => targets,
                    getMindmapNodes: async () => mindmapNodes,
                    getProblemContext: async (docId) => {
                        retriedDocIds.push(docId);
                        return { docId, pid: `P${docId}`, title: docId === 7 ? '快速幂' : '最短路', tag: ['L2'], content: '题面' };
                    },
                    writeTags: async () => undefined,
                },
                agents,
                observe: (event) => retryEvents.push(event),
                getEvents: () => retryEvents,
            });

            assert.deepEqual(retriedDocIds, [7, 8]);
            assert.deepEqual(JSON.parse(await readFile(failureFilePath, 'utf8')), { version: 1, failures: [] });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('keeps a remotely committed result completed when post-write audit persistence fails', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-committed-audit-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const events: RuntimeEvent[] = [];
        try {
            await writeFile(
                failureFilePath,
                `${JSON.stringify(
                    {
                        version: 1,
                        failures: [
                            {
                                docId: 7,
                                pid: 'P7',
                                title: '快速幂',
                                attempts: 2,
                                firstFailedAt: '2026-07-15T00:00:00.000Z',
                                lastFailedAt: '2026-07-15T01:00:00.000Z',
                                lastError: 'old apply failure',
                            },
                        ],
                    },
                    null,
                    2,
                )}\n`,
            );
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: true,
                        limit: null,
                        reportPath,
                        failureFilePath,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] }],
                        getMindmapNodes: async () => [
                            { id: 'root', parentId: null, topic: '算法', tags: [] },
                            { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                        ],
                        getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'], content: '题面' }),
                        writeTags: async () => {
                            await rm(reportPath);
                            await mkdir(reportPath);
                        },
                    },
                    agents: {
                        edit: async () => ({ action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 }),
                        approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                }),
            );

            const completed = events.find((event) => event.type === 'problem_completed');
            assert.equal(completed?.status, 'applied');
            assert.equal(
                events.some((event) => event.type === 'problem_failed'),
                false,
            );
            assert.equal(events.at(-1)?.type, 'run_failed');
            assert.deepEqual(summarizeRun(events).counts, { applied: 1, planned: 0, skipped: 0 });
            assert.deepEqual(summarizeRun(events).classifications, [{ tag: '数学', problems: [{ docId: 7, pid: 'P7', title: '快速幂' }] }]);
            assert.deepEqual(JSON.parse(await readFile(failureFilePath, 'utf8')), { version: 1, failures: [] });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('removes a successfully skipped retry from the ledger without marking its failed JSONL audit completed', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-skipped-audit-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const events: RuntimeEvent[] = [];
        try {
            await writeFile(
                failureFilePath,
                `${JSON.stringify(
                    {
                        version: 1,
                        failures: [
                            {
                                docId: 7,
                                pid: 'P7',
                                title: '快速幂',
                                attempts: 1,
                                firstFailedAt: '2026-07-15T00:00:00.000Z',
                                lastFailedAt: '2026-07-15T00:00:00.000Z',
                                lastError: 'old review failure',
                            },
                        ],
                    },
                    null,
                    2,
                )}\n`,
            );
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: true,
                        limit: null,
                        reportPath,
                        failureFilePath,
                        retryFailed: true,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2', '数学'] }],
                        getMindmapNodes: async () => [
                            { id: 'root', parentId: null, topic: '算法', tags: [] },
                            { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                        ],
                        getProblemContext: async () => ({
                            docId: 7,
                            pid: 'P7',
                            title: '快速幂',
                            tag: ['L2', '数学'],
                            content: '题面',
                        }),
                        writeTags: async () => {
                            throw new Error('approved skip must not write');
                        },
                    },
                    agents: {
                        edit: async () => ({ action: 'skip', selectedNodeIds: [], reason: '已有标签足够。', confidence: 0.95 }),
                        approve: async () => {
                            await rm(reportPath);
                            await mkdir(reportPath);
                            return { decision: 'approve', reason: '无需修改。' };
                        },
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                }),
            );

            assert.deepEqual(JSON.parse(await readFile(failureFilePath, 'utf8')), { version: 1, failures: [] });
            assert.equal(
                events.some((event) => event.type === 'problem_completed'),
                false,
            );
            assert.equal(
                events.some((event) => event.type === 'problem_failed'),
                true,
            );
            assert.equal(events.at(-1)?.type, 'run_failed');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('does not rewrite an old failure when its successful post-write cleanup cannot be persisted', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-committed-cleanup-failure-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const originalLedger = {
            version: 1,
            failures: [
                {
                    docId: 7,
                    pid: 'P7',
                    title: '快速幂',
                    attempts: 2,
                    firstFailedAt: '2026-07-15T00:00:00.000Z',
                    lastFailedAt: '2026-07-15T01:00:00.000Z',
                    lastError: 'old apply failure',
                },
            ],
        };
        const events: RuntimeEvent[] = [];
        try {
            await writeFile(failureFilePath, `${JSON.stringify(originalLedger, null, 2)}\n`);
            await mkdir(`${failureFilePath}.${process.pid}.tmp`);
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: true,
                        limit: null,
                        reportPath,
                        failureFilePath,
                        retryFailed: true,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] }],
                        getMindmapNodes: async () => [
                            { id: 'root', parentId: null, topic: '算法', tags: [] },
                            { id: 'math', parentId: 'root', topic: '数学', tags: ['数学'] },
                        ],
                        getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'], content: '题面' }),
                        writeTags: async () => undefined,
                    },
                    agents: {
                        edit: async () => ({ action: 'apply', selectedNodeIds: ['math'], reason: '数学题。', confidence: 0.95 }),
                        approve: async () => ({ decision: 'approve', reason: '分类正确。' }),
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                }),
            );

            assert.deepEqual(JSON.parse(await readFile(failureFilePath, 'utf8')), originalLedger);
            assert.equal(
                events.some((event) => event.type === 'problem_failed'),
                false,
            );
            assert.equal(events.find((event) => event.type === 'problem_completed')?.status, 'applied');
            assert.equal(
                events.filter((event) => event.type === 'problem_phase' && event.phase === 'failure_ledger' && event.status === 'started').length,
                1,
            );
            const reportLines = (await readFile(reportPath, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
            const terminal = reportLines.at(-1);
            assert.equal(terminal?.type, 'run_failed');
            assert.deepEqual((terminal?.summary as RunSummary).counts, { applied: 1, planned: 0, skipped: 0 });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('redacts a Unicode-escaped full statement embedded in a prefixed apply error before writing the failure ledger', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-ledger-redaction-'));
        const reportPath = path.join(directory, 'run.jsonl');
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const statement = '完整题面: "A+B" 🚀\n下一行';
        const mixedEscapedStatement = statement
            .split('')
            .map((codeUnit) => {
                const code = codeUnit.charCodeAt(0);
                return code > 127 ? `\\u${code.toString(16).padStart(4, '0').toUpperCase()}` : JSON.stringify(codeUnit).slice(1, -1);
            })
            .join('');
        const events: RuntimeEvent[] = [];
        try {
            await executeRun({
                settings: {
                    apply: true,
                    limit: null,
                    reportPath,
                    failureFilePath,
                    extraSystemTags: [],
                    editorModel: 'editor-model',
                    approvalModel: 'approval-model',
                    maxReviewRounds: 3,
                },
                oj: {
                    listTargetProblems: async () => [{ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'] }],
                    getMindmapNodes: async () => [{ id: 'root', parentId: null, topic: '算法', tags: [] }],
                    getProblemContext: async () => ({ docId: 7, pid: 'P7', title: '快速幂', tag: ['L2'], content: statement }),
                    writeTags: async () => {
                        throw new Error('must not write');
                    },
                },
                agents: {
                    edit: async () => {
                        throw new Error(`provider failed: ${mixedEscapedStatement}`);
                    },
                    approve: async () => {
                        throw new Error('must not approve');
                    },
                },
                observe: (event) => events.push(event),
                getEvents: () => events,
            });

            const ledger = JSON.parse(await readFile(failureFilePath, 'utf8')) as {
                failures: Array<{ lastError: string }>;
            };
            assert.equal(ledger.failures[0].lastError, 'provider failed: [REDACTED_PROBLEM_STATEMENT]');
            const report = await readFile(reportPath, 'utf8');
            assert.equal(report.includes(statement), false);
            assert.equal(report.includes(mixedEscapedStatement), false);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('fails before external calls when the requested failure ledger is corrupt', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'krypton-tagger-corrupt-ledger-'));
        const failureFilePath = path.join(directory, 'failed-problems.json');
        const events: RuntimeEvent[] = [];
        let ojCalls = 0;
        try {
            await writeFile(failureFilePath, '{not-json');
            await assert.rejects(() =>
                executeRun({
                    settings: {
                        apply: false,
                        limit: null,
                        reportPath: path.join(directory, 'run.jsonl'),
                        failureFilePath,
                        retryFailed: true,
                        extraSystemTags: [],
                        editorModel: 'editor-model',
                        approvalModel: 'approval-model',
                        maxReviewRounds: 3,
                    },
                    oj: {
                        listTargetProblems: async () => {
                            ojCalls++;
                            return [];
                        },
                        getMindmapNodes: async () => {
                            ojCalls++;
                            return [];
                        },
                        getProblemContext: async () => {
                            throw new Error('must not load a problem');
                        },
                        writeTags: async () => {
                            throw new Error('must not write');
                        },
                    },
                    agents: {
                        edit: async () => {
                            throw new Error('must not edit');
                        },
                        approve: async () => {
                            throw new Error('must not approve');
                        },
                    },
                    observe: (event) => events.push(event),
                    getEvents: () => events,
                }),
            );

            assert.equal(ojCalls, 0);
            assert.equal(events.at(-1)?.type, 'run_failed');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
