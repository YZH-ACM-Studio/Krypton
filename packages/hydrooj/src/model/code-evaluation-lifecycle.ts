import type { ProblemKind, StructuredCodeRegion, StructuredCodeTemplate } from '@hydrooj/common';
import { parseProblemKind } from '@hydrooj/common';
import { nanoid } from 'nanoid';
import { ValidationError } from '../error';
import {
    parseProblemConfigObject,
    STRUCTURED_CODE_REGION_ID,
    templateSourceHash,
    validateCompiledStructuredConfig,
    validateStructuredCodeTemplate,
    validateStructuredCodeTestdataFiles,
} from '../lib/problem-config';

export type CodeEvaluationStatus = 'draft' | 'ready';

export interface CodeEvaluationCase {
    input: string;
    output: string;
}

export interface CodeEvaluationTraceContext {
    actor?: number;
    stage: string;
}

interface CodeEvaluationProblemSnapshot {
    domainId: string;
    docId: number;
    pid?: string;
    problemKind?: ProblemKind;
    codeEvaluationStatus?: CodeEvaluationStatus;
    structureRevision?: number;
    config: unknown;
    data?: Array<{ name: string }>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new ValidationError(field, null, `${field} 不接受字段：${unknown.join(', ')}`);
}

export function normalizeCodeEvaluationFilename(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new ValidationError(field, null, '测试数据文件名必须是文本');
    const filename = value.trim();
    const containsControlCharacter = [...filename].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 128 && code <= 159);
    });
    if (
        !filename ||
        filename !== value ||
        filename === '.' ||
        filename === '..' ||
        /^config\.ya?ml$/i.test(filename) ||
        /[<>:"/\\|?*]/.test(filename) ||
        containsControlCharacter ||
        /[. ]$/.test(filename)
    ) {
        throw new ValidationError(field, null, `测试数据文件名非法：${value}`);
    }
    return filename;
}

export function normalizeCodeEvaluationCases(value: unknown, allowEmpty: boolean): CodeEvaluationCase[] {
    if (!Array.isArray(value)) throw new ValidationError('cases', null, '测试数据映射必须是数组');
    if (!allowEmpty && !value.length) throw new ValidationError('cases', null, '至少需要一个完整测试点');
    return value.map((item, index) => {
        if (!isPlainObject(item)) throw new ValidationError('cases', null, `测试点 ${index + 1} 格式错误`);
        const unknown = Object.keys(item).filter((key) => !['input', 'output'].includes(key));
        if (unknown.length) throw new ValidationError('cases', null, `测试点 ${index + 1} 不接受字段：${unknown.join(', ')}`);
        const input = normalizeCodeEvaluationFilename(item.input, `cases[${index}].input`);
        const output = normalizeCodeEvaluationFilename(item.output, `cases[${index}].output`);
        if (input === output) throw new ValidationError('cases', null, `测试点 ${index + 1} 的输入输出不能是同一文件`);
        return { input, output };
    });
}

function normalizeLanguage(value: unknown): string {
    const lang = typeof value === 'string' ? value.trim() : '';
    if (!lang || !/^[A-Za-z0-9_.+-]{1,64}$/.test(lang)) throw new ValidationError('lang', null, '必须选择唯一评测语言');
    return lang;
}

function normalizeOptionalLanguage(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    return normalizeLanguage(value);
}

function expectedMode(kind: ProblemKind): 'compile' | 'function' {
    if (kind === 'program_fill') return 'compile';
    if (kind === 'function') return 'function';
    throw new ValidationError('problemKind', null, '只有编译型程序填空和函数题使用代码评测草稿');
}

export function normalizeCodeEvaluationCreationStatus(value: unknown): 'draft' | undefined {
    if (value === undefined) return undefined;
    if (value !== 'draft') throw new ValidationError('codeEvaluationStatus', null, '代码评测题创建时只能进入 draft 状态');
    return value;
}

export function normalizeCodeEvaluationDraftCreationConfig(kindInput: ProblemKind, value: unknown): Record<string, unknown> {
    const kind = parseProblemKind(kindInput);
    if (!isPlainObject(value)) throw new ValidationError('structuredConfig');
    assertExactKeys(value, ['main'], 'structuredConfig');
    if (!isPlainObject(value.main)) throw new ValidationError('structuredConfig', null, 'main 必须是对象');
    assertExactKeys(value.main, ['mode', 'lang'], 'structuredConfig.main');
    const mode = expectedMode(kind);
    if (value.main.mode !== mode) throw new ValidationError('mode', null, `评测方式必须是 ${mode}`);
    return { main: { mode, lang: normalizeLanguage(value.main.lang) } };
}

function sourceRegion(source: string, region: Pick<StructuredCodeRegion, 'startLine' | 'endLine'>): string | null {
    const lines = source.split('\n');
    if (region.startLine < 0 || region.endLine <= region.startLine || region.endLine > lines.length) return null;
    return lines.slice(region.startLine, region.endLine).join('\n');
}

function nextRegionId(existing: Set<string>): string {
    let id = '';
    do id = `r_${nanoid(16)}`;
    while (existing.has(id));
    existing.add(id);
    return id;
}

export function normalizeStructuredCodeConfig(kindInput: ProblemKind, value: unknown, currentConfigInput?: unknown): Record<string, unknown> {
    const kind = parseProblemKind(kindInput);
    if (!isPlainObject(value)) throw new ValidationError('structuredConfig');
    assertExactKeys(value, ['main'], 'structuredConfig');
    if (!isPlainObject(value.main)) throw new ValidationError('structuredConfig', null, 'main 必须是对象');
    assertExactKeys(value.main, ['mode', 'lang', 'source', 'regions', 'cases'], 'structuredConfig.main');
    const mode = kind === 'function' ? 'function' : value.main.mode === 'text' || value.main.mode === 'compile' ? value.main.mode : undefined;
    if (!mode) throw new ValidationError('mode', null, '程序填空模式必须是 text 或 compile');
    if (kind === 'function' && value.main.mode !== 'function') throw new ValidationError('mode', null, '评测方式必须是 function');
    const lang = mode === 'text' ? normalizeOptionalLanguage(value.main.lang) : normalizeLanguage(value.main.lang);
    const sourceInput = value.main.source === undefined ? '' : value.main.source;
    if (typeof sourceInput !== 'string') throw new ValidationError('source', null, '私有模板必须是文本');
    const source = sourceInput.replace(/\r\n?/g, '\n');
    const rawRegions = value.main.regions === undefined ? [] : value.main.regions;
    if (!Array.isArray(rawRegions)) throw new ValidationError('regions');
    const currentConfig = parseProblemConfigObject({ config: currentConfigInput });
    const currentTemplate = currentConfig?.template as StructuredCodeTemplate | undefined;
    const currentRegions = new Map<string, StructuredCodeRegion>(
        Array.isArray(currentTemplate?.regions) ? currentTemplate.regions.map((region) => [region.id, region]) : [],
    );
    const allocatedIds = new Set(currentRegions.keys());
    const regions = rawRegions.map((item, index) => {
        if (!isPlainObject(item)) throw new ValidationError('regions', null, `区域 ${index + 1} 格式错误`);
        assertExactKeys(
            item,
            kind === 'function'
                ? ['id', 'startLine', 'endLine', 'order', 'signature', 'description']
                : ['id', 'startLine', 'endLine', 'order', 'prompt'],
            `regions[${index}]`,
        );
        const submittedId = item.id === undefined ? '' : item.id;
        if (typeof submittedId !== 'string') throw new ValidationError('regions', null, `区域 ${index + 1} ID 格式错误`);
        if (submittedId && !STRUCTURED_CODE_REGION_ID.test(submittedId)) {
            throw new ValidationError('regions', null, `区域 ${index + 1} ID 不是有效的服务端 ID`);
        }
        const existing = submittedId ? currentRegions.get(submittedId) : undefined;
        if (submittedId && !existing) throw new ValidationError('regions', null, `区域 ${index + 1} ID 不属于当前题目`);
        if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) || !Number.isSafeInteger(item.order)) {
            throw new ValidationError('regions', null, `区域 ${index + 1} 的行范围或顺序无效`);
        }
        const startLine = Number(item.startLine);
        const endLine = Number(item.endLine);
        const order = Number(item.order);
        if (existing && (existing.startLine !== startLine || existing.endLine !== endLine)) {
            throw new ValidationError('regions', null, `区域 ${index + 1} 坐标不可直接改写，请删除后重新框选`);
        }
        if (existing && currentTemplate && currentTemplate.source !== source) {
            const before = sourceRegion(currentTemplate.source, existing);
            const after = sourceRegion(source, { startLine, endLine });
            if (before === null || after === null || before !== after) {
                throw new ValidationError('regions', null, `区域 ${index + 1} 已因模板修改失效，请删除后重新框选`);
            }
        }
        const id = existing?.id || nextRegionId(allocatedIds);
        if (kind === 'function') {
            if (item.signature !== undefined && typeof item.signature !== 'string') {
                throw new ValidationError('regions', null, `区域 ${index + 1} 函数签名必须是文本`);
            }
            if (item.description !== undefined && typeof item.description !== 'string') {
                throw new ValidationError('regions', null, `区域 ${index + 1} 说明必须是文本`);
            }
            const signature = typeof item.signature === 'string' ? item.signature.trim() : '';
            const description = typeof item.description === 'string' ? item.description.trim() : '';
            return { id, startLine, endLine, order, signature, ...(description ? { description } : {}) };
        }
        if (item.prompt !== undefined && typeof item.prompt !== 'string') {
            throw new ValidationError('regions', null, `区域 ${index + 1} 提示必须是文本`);
        }
        const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
        return { id, startLine, endLine, order, ...(prompt ? { prompt } : {}) };
    });
    if (new Set(regions.map((region) => region.id)).size !== regions.length) throw new ValidationError('regions', null, '区域 ID 不能重复');
    if (mode === 'text' && Object.hasOwn(value.main, 'cases')) {
        throw new ValidationError('cases', null, '文本程序填空不使用测试数据映射');
    }
    const cases = mode === 'text' ? [] : normalizeCodeEvaluationCases(value.main.cases ?? [], true);
    const template = {
        ...(lang ? { lang } : {}),
        source,
        sourceHash: templateSourceHash(source),
        regions: [...regions].sort((a, b) => a.order - b.order),
    } as StructuredCodeTemplate;
    try {
        validateStructuredCodeTemplate(template, kind as 'program_fill' | 'function', { allowEmpty: true, allowEmptySignature: true });
    } catch (error: any) {
        throw new ValidationError('regions', null, error.message);
    }
    return {
        type: kind === 'function' ? 'function' : 'program_fill',
        ...(kind === 'program_fill' ? { mode } : {}),
        score: 100,
        ...(lang ? { langs: [lang] } : {}),
        template,
        ...(mode === 'text' ? {} : { cases }),
    };
}

export function normalizeCodeEvaluationDraftConfig(kindInput: ProblemKind, value: unknown, currentConfigInput?: unknown): Record<string, unknown> {
    const kind = parseProblemKind(kindInput);
    const config = normalizeStructuredCodeConfig(kind, value, currentConfigInput);
    if (!isCodeEvaluationProblem(kind, config)) {
        throw new ValidationError('mode', null, '只有编译型程序填空和函数题使用代码评测草稿');
    }
    return config;
}

export function isCodeEvaluationProblem(kindInput: unknown, configInput: unknown): boolean {
    const kind = kindInput === undefined ? 'programming' : parseProblemKind(kindInput);
    if (kind === 'function') return true;
    if (kind !== 'program_fill') return false;
    const config = parseProblemConfigObject({ config: configInput });
    return config?.type === 'program_fill' && config?.mode === 'compile';
}

export function assertCodeEvaluationStatusInvariant(
    kindInput: unknown,
    configInput: unknown,
    status: unknown,
): asserts status is CodeEvaluationStatus | undefined {
    const codeEvaluation = isCodeEvaluationProblem(kindInput, configInput);
    if (codeEvaluation && !['draft', 'ready'].includes(String(status))) {
        throw new ValidationError('codeEvaluationStatus', null, '代码评测题必须具有显式 draft/ready 状态');
    }
    if (!codeEvaluation && status !== undefined) {
        throw new ValidationError('codeEvaluationStatus', null, '非代码评测题不能设置代码评测状态');
    }
}

function mappedCases(configInput: unknown, allowEmpty: boolean): CodeEvaluationCase[] {
    const config = parseProblemConfigObject({ config: configInput });
    const value = config?.cases ?? [];
    return normalizeCodeEvaluationCases(value, allowEmpty);
}

export function assertCodeEvaluationMappingsExist(configInput: unknown, files: Array<{ name: string }> | undefined, allowEmpty: boolean): void {
    const cases = mappedCases(configInput, allowEmpty);
    const available = new Set((files || []).map((file) => file.name));
    for (const [index, item] of cases.entries()) {
        if (!available.has(item.input)) throw new ValidationError('cases', null, `测试点 ${index + 1} 输入文件不存在：${item.input}`);
        if (!available.has(item.output)) throw new ValidationError('cases', null, `测试点 ${index + 1} 输出文件不存在：${item.output}`);
    }
}

export function assertProblemReadyForUse(pdoc: CodeEvaluationProblemSnapshot, _context: CodeEvaluationTraceContext): void {
    const codeEvaluation = isCodeEvaluationProblem(pdoc.problemKind, pdoc.config);
    if (!codeEvaluation) {
        if (pdoc.codeEvaluationStatus !== undefined) {
            throw new ValidationError('codeEvaluationStatus', null, '非代码评测题包含非法评测状态');
        }
        return;
    }
    if (pdoc.codeEvaluationStatus !== 'ready') {
        throw new ValidationError('codeEvaluationStatus', null, '代码评测题草稿尚未完成，不能用于发布、引用、提交或评测');
    }
    try {
        const config = parseProblemConfigObject(pdoc);
        validateCompiledStructuredConfig(String(pdoc.problemKind), config);
        validateStructuredCodeTestdataFiles(config, pdoc.data || [], pdoc.problemKind as 'program_fill' | 'function');
    } catch (error: any) {
        throw new ValidationError('codeEvaluationStatus', null, error.message);
    }
}

export type CodeEvaluationFileMutation =
    | { type: 'upload'; filename: string }
    | { type: 'rename'; filename: string; newFilename: string }
    | { type: 'delete'; filenames: string[] };

export function assertCodeEvaluationFileMutation(
    pdoc: Pick<CodeEvaluationProblemSnapshot, 'problemKind' | 'config' | 'data'>,
    mutation: CodeEvaluationFileMutation,
): void {
    if (!isCodeEvaluationProblem(pdoc.problemKind, pdoc.config)) return;
    if (mutation.type === 'upload') {
        normalizeCodeEvaluationFilename(mutation.filename, 'filename');
    } else if (mutation.type === 'rename') {
        normalizeCodeEvaluationFilename(mutation.filename, 'files');
        normalizeCodeEvaluationFilename(mutation.newFilename, 'newNames');
    } else {
        mutation.filenames.forEach((filename) => normalizeCodeEvaluationFilename(filename, 'files'));
    }
    const existing = new Set((pdoc.data || []).map((file) => file.name));
    const referenced = new Map<string, number[]>();
    for (const [index, item] of mappedCases(pdoc.config, true).entries()) {
        for (const filename of [item.input, item.output]) {
            const indexes = referenced.get(filename) || [];
            indexes.push(index + 1);
            referenced.set(filename, indexes);
        }
    }
    if (mutation.type === 'upload') {
        if (existing.has(mutation.filename)) throw new ValidationError('filename', null, `同名测试数据已存在：${mutation.filename}`);
        return;
    }
    if (mutation.type === 'rename') {
        const cases = referenced.get(mutation.filename);
        if (cases?.length) throw new ValidationError('files', null, `${mutation.filename} 正被测试点 ${cases.join(', ')} 引用，请先调整映射`);
        if (!existing.has(mutation.filename)) throw new ValidationError('files', null, `待改名文件不存在：${mutation.filename}`);
        if (existing.has(mutation.newFilename)) throw new ValidationError('newNames', null, `目标文件名已存在：${mutation.newFilename}`);
        return;
    }
    for (const filename of mutation.filenames) {
        const cases = referenced.get(filename);
        if (cases?.length) throw new ValidationError('files', null, `${filename} 正被测试点 ${cases.join(', ')} 引用，请先调整映射`);
    }
}

export function assertCodeEvaluationStatusTransition(
    currentStatus: unknown,
    $set: Record<string, unknown>,
    $unset: Record<string, unknown>,
    operation: string,
): void {
    const touched = [...Object.keys($set), ...Object.keys($unset)].some(
        (field) => field === 'codeEvaluationStatus' || field.startsWith('codeEvaluationStatus.'),
    );
    if (!touched) return;
    if (
        operation !== 'code-evaluation-complete' ||
        currentStatus !== 'draft' ||
        $set.codeEvaluationStatus !== 'ready' ||
        Object.keys($unset).some((field) => field === 'codeEvaluationStatus' || field.startsWith('codeEvaluationStatus.'))
    ) {
        throw new ValidationError('codeEvaluationStatus', null, '代码评测状态只能由完成草稿服务从 draft 原子切换为 ready');
    }
}

export function assertCodeEvaluationLifecyclePatch(
    current: Partial<CodeEvaluationProblemSnapshot> & Pick<CodeEvaluationProblemSnapshot, 'problemKind' | 'config' | 'codeEvaluationStatus'>,
    $set: Record<string, unknown>,
    $unset: Record<string, unknown>,
    operation: string,
    options: { physicalTestdataMutation?: boolean } = {},
): void {
    const lifecycleRoots = new Set(['problemKind', 'config', 'codeEvaluationStatus', 'data']);
    const fields = [...Object.keys($set), ...Object.keys($unset)];
    const dotted = fields.filter((field) => field.includes('.') && lifecycleRoots.has(field.split('.')[0]));
    if (dotted.length) {
        throw new ValidationError('fields', null, `代码评测生命周期字段必须整体写入：${dotted.join(', ')}`);
    }
    assertCodeEvaluationStatusTransition(current.codeEvaluationStatus, $set, $unset, operation);
    const next = (field: 'problemKind' | 'config' | 'codeEvaluationStatus' | 'data') => {
        if (Object.hasOwn($unset, field)) return undefined;
        if (Object.hasOwn($set, field)) return $set[field];
        return current[field];
    };
    const problemKind = next('problemKind');
    const config = next('config');
    const codeEvaluationStatus = next('codeEvaluationStatus');
    const dataTouched = fields.some((field) => field === 'data' || field.startsWith('data.'));
    if (
        dataTouched &&
        (isCodeEvaluationProblem(current.problemKind, current.config) || isCodeEvaluationProblem(problemKind, config)) &&
        options.physicalTestdataMutation !== true
    ) {
        throw new ValidationError('data', null, '代码评测题测试数据元数据只能由测试数据文件服务写入');
    }
    assertCodeEvaluationStatusInvariant(problemKind, config, codeEvaluationStatus);
    if (codeEvaluationStatus === 'ready') {
        assertProblemReadyForUse(
            {
                domainId: current.domainId || 'unknown',
                docId: current.docId || 0,
                pid: current.pid,
                problemKind: problemKind as ProblemKind,
                codeEvaluationStatus,
                structureRevision: current.structureRevision,
                config,
                data: next('data') as Array<{ name: string }> | undefined,
            },
            { stage: `${operation}-state` },
        );
    }
}

/** Mongo predicate for every document that must pass the full code-evaluation ready gate. */
export const CODE_EVALUATION_CANDIDATE_FILTER = {
    $or: [
        { problemKind: 'function' },
        { problemKind: 'program_fill', 'config.type': 'program_fill', 'config.mode': 'compile' },
        { codeEvaluationStatus: { $exists: true } },
    ],
};
