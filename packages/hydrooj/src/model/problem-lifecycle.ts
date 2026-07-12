import type { ProblemKind } from '@hydrooj/common';
import { parseProblemKind } from '@hydrooj/common';
import { ValidationError } from '../error';
import db from '../service/db';
import * as document from './document';

const recordColl = db.collection('record');
const recordStatColl = db.collection('record.stat');

const FORBIDDEN_STATEMENT_FIELDS = new Set([
    'prompt', 'statement', 'description', 'instructions', 'introduction', 'preface',
]);

export const PROBLEM_STRUCTURAL_FIELDS = new Set([
    'content', 'config', 'problemKind', 'data', 'additional_file', 'reference',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertNoSecondaryStatement(value: unknown, path = 'config'): void {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            assertNoSecondaryStatement(item, `${path}[${index}]`);
        }
        return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_STATEMENT_FIELDS.has(key)) {
            throw new ValidationError('config', null, `题面只能存放在 content，禁止字段 ${path}.${key}`);
        }
        assertNoSecondaryStatement(child, `${path}.${key}`);
    }
}

export function normalizeStructuredProblemConfig(
    kind: ProblemKind,
    config: unknown,
): Record<string, unknown> {
    parseProblemKind(kind);
    if (kind === 'programming') {
        throw new ValidationError('problemKind', null, '编程题继续使用现有 config.yaml/testdata 编辑链路');
    }
    if (!isPlainObject(config) || !Object.hasOwn(config, 'main')) {
        throw new ValidationError('config', null, '结构化题配置必须是包含 main 的对象');
    }
    if (Object.hasOwn(config, 'testdataSourcePid')) {
        throw new ValidationError('config', null, '共享测试数据尚未实现');
    }
    assertNoSecondaryStatement(config);
    return { ...config, score: 100 };
}

export function assertStructureRevision(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) {
        throw new ValidationError('expectedStructureRevision');
    }
}

export async function hasStartedProblemContainer(domainId: string, pid: number): Promise<boolean> {
    return !!await document.coll.findOne({
        domainId,
        docType: document.TYPE_CONTEST,
        pids: pid,
        beginAt: { $lte: new Date() },
    }, { projection: { _id: 1 } });
}

export interface ProblemReferenceReport {
    containers: number;
    trainingCourses: number;
    records: number;
    statuses: number;
    problemReferences: number;
    solutionsDiscussions: number;
    mindmap: number;
    tasks: number;
    paperDrafts: number;
    permits: number;
    testdataSources: number;
}

export function problemReferenceCount(report: ProblemReferenceReport): number {
    return Object.values(report).reduce((total, count) => total + count, 0);
}

/**
 * Fixed, synchronous hard-delete guard for this small installation. Mongo
 * errors are intentionally allowed to propagate so a partial scan can never
 * be mistaken for permission to delete.
 */
export async function findProblemReferences(
    domainId: string,
    pid: number,
    publicPid?: string,
): Promise<ProblemReferenceReport> {
    const aliases = Array.from(new Set([String(pid), publicPid].filter(Boolean)));
    const [
        containers,
        trainingCourses,
        records,
        recordStats,
        statuses,
        problemReferences,
        solutions,
        discussions,
        mindmap,
        tasks,
        paperDrafts,
        permits,
        permitSources,
        testdataSources,
    ] = await Promise.all([
        document.coll.countDocuments({ domainId, docType: document.TYPE_CONTEST, pids: pid }),
        document.coll.countDocuments({ domainId, docType: document.TYPE_TRAINING, 'dag.pids': pid }),
        recordColl.countDocuments({ domainId, pid }),
        recordStatColl.countDocuments({ domainId, pid }),
        document.collStatus.countDocuments({ domainId, docType: document.TYPE_PROBLEM, docId: pid }),
        document.coll.countDocuments({
            docType: document.TYPE_PROBLEM,
            'reference.domainId': domainId,
            'reference.pid': pid,
        }),
        document.coll.countDocuments({
            domainId,
            docType: document.TYPE_PROBLEM_SOLUTION,
            parentType: document.TYPE_PROBLEM,
            parentId: pid,
        }),
        document.coll.countDocuments({
            domainId,
            docType: document.TYPE_DISCUSSION,
            parentType: document.TYPE_PROBLEM,
            parentId: pid,
        }),
        (db as any).collection('mindmap.nodes').countDocuments({ problemIds: { $in: aliases } }),
        (db as any).collection('tasks.tasks').countDocuments({
            domainId,
            'graph.nodes.params.problemId': { $in: [pid, String(pid), publicPid].filter(Boolean) },
        }),
        (db as any).collection('vigil.paper_draft').countDocuments({ domainId, pid }),
        (db as any).collection('problem.permits').countDocuments({ domainId, pid, active: { $in: [true, null] } }),
        (db as any).collection('problem.permitSources').countDocuments({ domainId, pid, active: { $in: [true, null] } }),
        document.coll.countDocuments({
            domainId,
            docType: document.TYPE_PROBLEM,
            $or: [{ testdataSourcePid: pid }, { 'config.testdataSourcePid': pid }],
        }),
    ]);
    return {
        containers,
        trainingCourses,
        records: records + recordStats,
        statuses,
        problemReferences,
        solutionsDiscussions: solutions + discussions,
        mindmap,
        tasks,
        paperDrafts,
        permits: permits + permitSources,
        testdataSources,
    };
}
