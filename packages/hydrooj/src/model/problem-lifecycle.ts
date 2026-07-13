import type { ProblemKind } from '@hydrooj/common';
import { parseProblemKind } from '@hydrooj/common';
import { ValidationError } from '../error';
import { parseRegionMarkers, validateCompiledStructuredConfig } from '../lib/problem-config';
import db from '../service/db';
import * as document from './document';

const recordColl = db.collection('record');
const recordStatColl = db.collection('record.stat');

const FORBIDDEN_STATEMENT_FIELDS = new Set(['prompt', 'statement', 'description', 'instructions', 'introduction', 'preface']);

export const PROBLEM_STRUCTURAL_FIELDS = new Set(['content', 'config', 'problemKind', 'data', 'additional_file', 'reference']);

export function problemCreateChangedFields(
    problemKind: ProblemKind,
    created: {
        pid?: string;
        difficulty?: number;
        reference?: unknown;
        authoringMode?: unknown;
        sourceMeta?: unknown;
        managedAuthoring?: unknown;
    },
): string[] {
    return [
        'title',
        'content',
        'owner',
        'tag',
        'hidden',
        'problemKind',
        'structureRevision',
        'sort',
        'data',
        'additional_file',
        ...(created.pid ? ['pid'] : []),
        ...(created.difficulty ? ['difficulty'] : []),
        ...(created.reference ? ['reference'] : []),
        ...(created.authoringMode ? ['authoringMode'] : []),
        ...(created.sourceMeta ? ['sourceMeta'] : []),
        ...(created.managedAuthoring ? ['managedAuthoring'] : []),
        ...(problemKind !== 'programming' ? ['config'] : []),
    ];
}

/**
 * Preserve the exact inserted docId before either fallible post-create step.
 * Managed creation uses the callback to synchronously clean up failed drafts.
 */
export async function completePersistedProblemCreate(
    docId: number,
    onPersisted: ((docId: number) => void) | undefined,
    emitCreated: () => Promise<unknown>,
    writeAudit: () => Promise<unknown>,
): Promise<number> {
    onPersisted?.(docId);
    await emitCreated();
    await writeAudit();
    return docId;
}

export function problemEditAuditedFields($set: Record<string, unknown>): string[] {
    const fields = Object.keys($set);
    if (Object.hasOwn($set, 'pid')) fields.push('sort');
    return fields;
}

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
        const regionPrompt = key === 'prompt' && /\.regions\[\d+\]$/.test(path);
        if (FORBIDDEN_STATEMENT_FIELDS.has(key) && !regionPrompt) {
            throw new ValidationError('config', null, `题面只能存放在 content，禁止字段 ${path}.${key}`);
        }
        assertNoSecondaryStatement(child, `${path}.${key}`);
    }
}

function normalizeCases(value: unknown): Array<{ input: string; output: string; score?: number }> {
    if (!Array.isArray(value) || !value.length) throw new ValidationError('config', null, '至少需要一个测试点');
    return value.map((item, index) => {
        if (!isPlainObject(item)) throw new ValidationError('config', null, `测试点 ${index + 1} 格式错误`);
        const input = typeof item.input === 'string' ? item.input.trim() : '';
        const output = typeof item.output === 'string' ? item.output.trim() : '';
        const validName = (name: string) => !!name && name !== 'config.yaml' && !/[\\/]/.test(name);
        if (!validName(input) || !validName(output)) {
            throw new ValidationError('config', null, `测试点 ${index + 1} 文件名非法`);
        }
        if (item.score !== undefined && (!Number.isFinite(item.score) || Number(item.score) < 0)) {
            throw new ValidationError('config', null, `测试点 ${index + 1} 分值非法`);
        }
        return { input, output, ...(item.score !== undefined ? { score: Number(item.score) } : {}) };
    });
}

function normalizeCompilableStructured(kind: 'program_fill' | 'function', main: Record<string, unknown>) {
    const lang = typeof main.lang === 'string' ? main.lang.trim() : '';
    if (!lang || !/^[A-Za-z0-9_.+-]{1,64}$/.test(lang)) throw new ValidationError('config', null, '必须选择唯一评测语言');
    const markerSource = typeof main.markerSource === 'string' ? main.markerSource : '';
    const metadata = Array.isArray(main.regions)
        ? main.regions.map((item) => ({
              id: isPlainObject(item) && typeof item.id === 'string' ? item.id : '',
              ...(isPlainObject(item) && item.prompt !== undefined ? { prompt: item.prompt as string } : {}),
          }))
        : [];
    let template;
    try {
        template = parseRegionMarkers(markerSource, metadata);
    } catch (error: any) {
        throw new ValidationError('config', null, error.message);
    }
    template.lang = lang;
    if (kind === 'program_fill') {
        if (metadata.length !== 1 || metadata[0].id !== 'main') {
            throw new ValidationError('config', null, '编译型程序填空必须且只能使用 main region');
        }
        const region = template.regions[0];
        if (region.start.line !== region.end.line) {
            throw new ValidationError('config', null, '程序填空占位内容必须只有一行');
        }
    }
    const cases = normalizeCases(main.cases);
    const config = {
        type: 'fill_function',
        subType: kind === 'program_fill' ? 'program_fill_compile' : 'function',
        score: 100,
        langs: [lang],
        main: { mode: kind === 'program_fill' ? 'compile' : 'function', lang, markerSource, regions: metadata, cases },
        template,
        cases,
    };
    validateCompiledStructuredConfig(kind, config);
    return config;
}

function normalizeOptions(value: unknown): string[] {
    if (!Array.isArray(value) || value.length < 2 || value.length > 26) {
        throw new ValidationError('config', null, '选项数量必须为 2–26');
    }
    const options = value.map((option) => {
        if (typeof option !== 'string' || !option.trim()) {
            throw new ValidationError('config', null, '选项不能为空');
        }
        return option.trim();
    });
    if (new Set(options).size !== options.length) {
        throw new ValidationError('config', null, '选项内容不能重复');
    }
    return options;
}

function optionKey(index: number): string {
    return String.fromCharCode(65 + index);
}

function normalizeBasicObjective(kind: ProblemKind, main: Record<string, unknown>): Record<string, unknown> {
    if (kind === 'single') {
        const options = normalizeOptions(main.options);
        if (!Number.isSafeInteger(main.answerIndex) || Number(main.answerIndex) < 0 || Number(main.answerIndex) >= options.length) {
            throw new ValidationError('config', null, '单选题正确项必须属于选项');
        }
        const answerIndex = Number(main.answerIndex);
        return {
            type: 'objective',
            score: 100,
            main: { options, answerIndex },
            answers: { main: [optionKey(answerIndex), 100, { kind: 'single', choices: options }] },
            options: { main: options },
        };
    }
    if (kind === 'true_false') {
        if (typeof main.answer !== 'boolean') {
            throw new ValidationError('config', null, '判断题答案必须为正确或错误');
        }
        const options = ['正确', '错误'];
        return {
            type: 'objective',
            score: 100,
            main: { answer: main.answer },
            answers: {
                main: [
                    main.answer ? 'A' : 'B',
                    100,
                    {
                        kind: 'single',
                        choices: options,
                        presentation: 'truefalse',
                    },
                ],
            },
            options: { main: options },
        };
    }
    if (kind === 'blank') {
        if (typeof main.answer !== 'string' || !main.answer.trim()) {
            throw new ValidationError('config', null, '填空题可接受答案不能为空');
        }
        return {
            type: 'objective',
            score: 100,
            main: { answer: main.answer },
            answers: { main: [main.answer, 100, { kind: 'blank' }] },
        };
    }
    if (kind === 'subjective') {
        if (main.gradingInstructions !== undefined && typeof main.gradingInstructions !== 'string') {
            throw new ValidationError('config', null, '阅卷说明必须是文本');
        }
        const gradingInstructions = String(main.gradingInstructions || '').trim();
        return {
            type: 'objective',
            score: 100,
            main: { ...(gradingInstructions ? { gradingInstructions } : {}) },
            answers: { main: ['', 100, { kind: 'subjective' }] },
        };
    }
    const options = normalizeOptions(main.options);
    if (
        !Array.isArray(main.answerIndexes) ||
        !main.answerIndexes.length ||
        main.answerIndexes.some((index) => !Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= options.length)
    ) {
        throw new ValidationError('config', null, '多选题正确项必须是非空选项子集');
    }
    const answerIndexes = Array.from(new Set(main.answerIndexes.map(Number))).sort((a, b) => a - b);
    if (answerIndexes.length !== main.answerIndexes.length) {
        throw new ValidationError('config', null, '多选题正确项不能重复');
    }
    const rawPartialCreditPercent = main.partialCreditPercent ?? 0;
    if (!Number.isSafeInteger(rawPartialCreditPercent) || Number(rawPartialCreditPercent) < 0 || Number(rawPartialCreditPercent) > 100) {
        throw new ValidationError('config', null, '多选题部分分比例必须是 0–100 整数');
    }
    const partialCreditPercent = Number(rawPartialCreditPercent);
    return {
        type: 'objective',
        score: 100,
        main: { options, answerIndexes, partialCreditPercent },
        answers: {
            main: [
                answerIndexes.map(optionKey),
                100,
                {
                    kind: 'multi',
                    choices: options,
                    partialCreditPercent,
                },
            ],
        },
        options: { main: options },
    };
}

export function normalizeStructuredProblemConfig(kind: ProblemKind, config: unknown): Record<string, unknown> {
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
    if (['single', 'multi', 'true_false', 'blank', 'subjective'].includes(kind)) {
        if (!isPlainObject(config.main)) throw new ValidationError('config', null, 'main 必须是对象');
        return normalizeBasicObjective(kind, config.main);
    }
    if (kind === 'program_fill') {
        if (!isPlainObject(config.main)) throw new ValidationError('config', null, 'main 必须是对象');
        if (config.main.mode === 'text') {
            if (typeof config.main.answer !== 'string' || !config.main.answer.trim() || /[\r\n]/.test(config.main.answer)) {
                throw new ValidationError('config', null, '文本程序填空答案必须是非空单行文本');
            }
            return {
                type: 'objective',
                subType: 'program_fill_text',
                score: 100,
                main: { mode: 'text', answer: config.main.answer },
                answers: { main: [config.main.answer, 100, { kind: 'fill_program' }] },
            };
        }
        if (config.main.mode !== 'compile') throw new ValidationError('config', null, '程序填空模式必须是 text 或 compile');
        return normalizeCompilableStructured('program_fill', config.main);
    }
    if (kind === 'function') {
        if (!isPlainObject(config.main)) throw new ValidationError('config', null, 'main 必须是对象');
        return normalizeCompilableStructured('function', config.main);
    }
    return { ...config, score: 100 };
}

export function structuredProblemUsesTestdata(kind: ProblemKind, config: any): boolean {
    return kind === 'function' || (kind === 'program_fill' && (config?.main?.mode === 'compile' || config?.subType === 'program_fill_compile'));
}

export function cloneStructuredProblemForLanguage(kind: ProblemKind, config: unknown, language: string): Record<string, unknown> {
    if (!['program_fill', 'function'].includes(kind)) throw new ValidationError('cloneLang');
    if (!isPlainObject(config) || !isPlainObject(config.main) || !structuredProblemUsesTestdata(kind, config)) throw new ValidationError('cloneLang');
    if (config.main.lang === language) throw new ValidationError('cloneLang');
    return normalizeStructuredProblemConfig(kind, {
        main: { ...config.main, lang: language },
    });
}

export function assertStructureRevision(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) {
        throw new ValidationError('expectedStructureRevision');
    }
}

export async function hasStartedProblemContainer(domainId: string, pid: number): Promise<boolean> {
    return !!(await document.coll.findOne(
        {
            domainId,
            docType: document.TYPE_CONTEST,
            pids: pid,
            beginAt: { $lte: new Date() },
        },
        { projection: { _id: 1 } },
    ));
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
export async function findProblemReferences(domainId: string, pid: number, publicPid?: string): Promise<ProblemReferenceReport> {
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
