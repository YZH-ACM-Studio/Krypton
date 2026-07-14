/**
 * Helpers for inspecting / normalizing `Pdoc.config` — in particular the
 * question-kind metadata on `Objective` problems and the region splicing
 * for `FillFunction` problems.
 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import type { AnswerEntry, QuestionKind, StructuredCodeTemplate } from '@hydrooj/common';

/**
 * pdoc.config 在库里是 YAML 字符串（与 testdata config.yaml 镜像）。
 * 服务端需要完整 config 对象（含标准答案）时统一走这里解析；
 * 发给客户端一律经 `clientProblemConfig` 净化，绝不直发。
 */
export function parseProblemConfigObject(pdoc: { config?: unknown } | null | undefined): any {
    if (!pdoc) return null;
    if (pdoc.config && typeof pdoc.config === 'object') return pdoc.config;
    if (typeof pdoc.config === 'string' && pdoc.config.trim()) {
        try {
            const cfg = yaml.load(pdoc.config);
            return cfg && typeof cfg === 'object' ? cfg : null;
        } catch {
            return null;
        }
    }
    return null;
}

export function isProblemConfigFilename(name: string): boolean {
    return /^config\.ya?ml$/i.test(name);
}

/** Pull `(stdAns, score, meta?)` out of an AnswerEntry regardless of arity. */
export function unpackAnswerEntry(entry: AnswerEntry): {
    stdAns: string | string[];
    score: number;
    meta: {
        kind?: QuestionKind;
        prompt?: string;
        type?: QuestionKind;
        choices?: string[];
        presentation?: string;
        partialCreditPercent?: number;
    };
} {
    const stdAns = entry[0];
    const score = entry[1];
    const meta = (entry.length >= 3 ? entry[2] : undefined) || {};
    return { stdAns, score, meta };
}

/**
 * Infer the kind of an answer entry when not explicitly tagged. See PRD §1.3.2:
 *   - array → 'multi'
 *   - single string, no whitespace → 'single'
 *   - single string with whitespace → 'blank'
 *
 * `meta.type` 是早期 problem-type-editor 的 legacy 键名（PLAN P3.2 归一为
 * `kind`），读取端永久兜底。
 */
export function inferQuestionKind(entry: AnswerEntry): QuestionKind {
    const { stdAns, meta } = unpackAnswerEntry(entry);
    if (meta.kind) return meta.kind;
    if (meta.type) return meta.type;
    if (Array.isArray(stdAns)) return 'multi';
    if (typeof stdAns === 'string' && /\s/.test(stdAns)) return 'blank';
    return 'single';
}

/**
 * Return `{ key -> kind }` for all entries in an objective problem's `answers`.
 * Useful for the paper UI tab aggregation.
 */
export function questionKindMap(answers: Record<string, AnswerEntry> | undefined): Record<string, QuestionKind> {
    const out: Record<string, QuestionKind> = {};
    if (!answers || typeof answers !== 'object') return out;
    for (const [key, entry] of Object.entries(answers)) {
        // answers 结构不受控（config.yaml 可原样上传）：entry 为 null/
        // 非数组时跳过，单条畸形不许炸掉考试 paper 页 / finalize 收卷。
        if (!Array.isArray(entry)) continue;
        try {
            out[key] = inferQuestionKind(entry);
        } catch {
            continue;
        }
    }
    return out;
}

// ─── Client-safe question descriptors（PLAN 2026-07 P3.2 / Rev.11）─────────

export interface ClientQuestion {
    key: string;
    kind: QuestionKind;
    prompt?: string;
    /** 选项文本（A/B/C… 按下标映射）；来源 meta.choices ?? config.options[key] */
    choices?: string[];
    score: number;
    presentation?: string;
}

/** 自然序：'2' < '10'，'1-2' 按段比较。 */
function compareQuestionKeys(a: string, b: string): number {
    const as = a.split('-');
    const bs = b.split('-');
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
        if (as[i] === undefined) return -1;
        if (bs[i] === undefined) return 1;
        const an = Number(as[i]);
        const bn = Number(bs[i]);
        if (Number.isFinite(an) && Number.isFinite(bn)) {
            if (an !== bn) return an - bn;
        } else if (as[i] !== bs[i]) {
            return as[i] < bs[i] ? -1 : 1;
        }
    }
    return 0;
}

/**
 * 从客观题 config 提取**不含标准答案**的题目描述符列表（客户端渲染用）。
 * 任何把 config 相关数据发给学生端的路径都必须走这里或
 * `clientProblemConfig`，绝不直接下发 answers。
 */
export function clientQuestions(
    config: { answers?: Record<string, AnswerEntry>; options?: Record<string, string[]> } | null | undefined,
): ClientQuestion[] {
    if (!config?.answers || typeof config.answers !== 'object') return [];
    const out: ClientQuestion[] = [];
    for (const [key, entry] of Object.entries(config.answers)) {
        if (!Array.isArray(entry)) continue;
        let meta: ReturnType<typeof unpackAnswerEntry>['meta'];
        let kind: QuestionKind;
        try {
            meta = unpackAnswerEntry(entry).meta;
            kind = inferQuestionKind(entry);
        } catch {
            continue;
        }
        const choices =
            (Array.isArray(meta.choices) && meta.choices.length ? meta.choices : undefined) ??
            (Array.isArray(config.options?.[key]) && config.options[key].length ? config.options[key] : undefined);
        const q: ClientQuestion = { key, kind, score: Number(entry[1]) || 0 };
        if (typeof meta.prompt === 'string' && meta.prompt) q.prompt = meta.prompt;
        if (meta.presentation === 'truefalse') q.presentation = 'truefalse';
        if (choices) q.choices = choices.map((c) => String(c ?? ''));
        out.push(q);
    }
    return out.sort((a, b) => compareQuestionKeys(a.key, b.key));
}

/**
 * 学生端可见的 config 子集。paper 考试 pdict、题目详情等一切
 * 面向学生的响应都用它替换原始 config —— 原始 config 含 answers
 * （标准答案）/cases/checker，一个字段都不许漏出去。
 */
export function clientProblemConfig(config: any): any {
    if (!config || typeof config !== 'object') return { type: 'default' };
    const out: any = { type: config.type || 'default' };
    if (Array.isArray(config.langs) && config.langs.length) out.langs = config.langs;
    if (config.type === 'objective') {
        out.questions = clientQuestions(config);
        // 兼容既有考试页消费点 pdoc.config.options[questionKey]。
        const options: Record<string, string[]> = {};
        for (const q of out.questions) if (q.choices) options[q.key] = q.choices;
        if (Object.keys(options).length) out.options = options;
    }
    if (['program_fill', 'function'].includes(config.type) && config.template) {
        if (config.type === 'program_fill') validateStructuredCodeJudgeConfig(config, 'program_fill');
        const regions = Array.isArray(config.template.regions) ? [...config.template.regions].sort((a, b) => Number(a.order) - Number(b.order)) : [];
        out.template = {
            ...(config.template.lang ? { lang: config.template.lang } : {}),
            regions: regions.map((region) => ({
                id: region.id,
                ...(config.type === 'function'
                    ? {
                          signature: region.signature,
                          ...(region.description ? { description: region.description } : {}),
                      }
                    : region.prompt
                      ? { prompt: region.prompt }
                      : {}),
            })),
            ...(config.type === 'program_fill' ? { skeleton: clientProgramFillSkeleton(config.template) } : {}),
        };
        if (config.type === 'program_fill') out.mode = config.mode;
    }
    if (config.subType) out.subType = config.subType;
    return out;
}

// ─── Structured-code whole-line regions ───────────────────────────────────

/** SHA-256 of the template source. Used for draft staleness detection. */
export function templateSourceHash(source: string): string {
    return createHash('sha256').update(source).digest('hex');
}

export const STRUCTURED_CODE_REGION_ID = /^r_[A-Za-z0-9_-]{12,32}$/;

export type ClientProgramFillSkeletonLine = { code: string } | { regionId: string };

/** Build a public source skeleton without ever copying a selected answer line. */
export function clientProgramFillSkeleton(template: StructuredCodeTemplate): ClientProgramFillSkeletonLine[] {
    validateStructuredCodeTemplate(template, 'program_fill');
    const regionByLine = new Map(template.regions.map((region) => [region.startLine, region.id]));
    return template.source.split('\n').map((code, line) => {
        const regionId = regionByLine.get(line);
        return regionId ? { regionId } : { code };
    });
}

export function validateStructuredCodeTemplate(
    template: StructuredCodeTemplate,
    kind: 'program_fill' | 'function',
    options: { allowEmpty?: boolean; allowEmptySignature?: boolean } = {},
): void {
    if (!template || typeof template !== 'object') throw new Error(`${kind}: missing private template`);
    if (typeof template.source !== 'string') throw new Error(`${kind}: template source must be text`);
    if (template.source.includes('\r')) throw new Error(`${kind}: template source must use LF line endings`);
    if (!options.allowEmpty && !template.source.length) throw new Error(`${kind}: template source is required`);
    if (kind === 'function' && (!template.lang || typeof template.lang !== 'string')) {
        throw new Error('function: template language is required');
    }
    if (template.lang !== undefined && (typeof template.lang !== 'string' || !template.lang)) {
        throw new Error(`${kind}: template language must be non-empty text when provided`);
    }
    if (template.sourceHash !== templateSourceHash(template.source)) throw new Error(`${kind}: template source hash mismatch`);
    if (!Array.isArray(template.regions)) throw new Error(`${kind}: template regions must be an array`);
    if (!options.allowEmpty && !template.regions.length) throw new Error(`${kind}: at least one region is required`);

    const lines = template.source.split('\n');
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const [index, region] of template.regions.entries()) {
        if (!region || typeof region !== 'object') throw new Error(`${kind}: region ${index + 1} is invalid`);
        if (!STRUCTURED_CODE_REGION_ID.test(region.id)) throw new Error(`${kind}: region ${index + 1} has an invalid server id`);
        if (ids.has(region.id)) throw new Error(`${kind}: duplicate region id "${region.id}"`);
        ids.add(region.id);
        if (!Number.isSafeInteger(region.order) || region.order < 0) throw new Error(`${kind}: region ${region.id} has an invalid order`);
        if (orders.has(region.order)) throw new Error(`${kind}: duplicate region order ${region.order}`);
        orders.add(region.order);
        if (!Number.isSafeInteger(region.startLine) || !Number.isSafeInteger(region.endLine)) {
            throw new TypeError(`${kind}: region ${region.id} has invalid line bounds`);
        }
        if (region.startLine < 0 || region.endLine <= region.startLine || region.endLine > lines.length) {
            throw new Error(`${kind}: region ${region.id} is out of bounds`);
        }
        if (kind === 'program_fill' && region.endLine !== region.startLine + 1) {
            throw new Error('program_fill: every editable region must be exactly one line');
        }
        if (kind === 'function') {
            if (typeof region.signature !== 'string') throw new Error(`function: region ${region.id} signature must be text`);
            if (!options.allowEmptySignature && !region.signature.trim()) {
                throw new Error(`function: region ${region.id} signature is required`);
            }
            if (region.description !== undefined && typeof region.description !== 'string') {
                throw new Error(`function: region ${region.id} description must be text`);
            }
        } else if (region.prompt !== undefined && typeof region.prompt !== 'string') {
            throw new Error(`program_fill: region ${region.id} prompt must be text`);
        }
    }
    if (orders.size && [...orders].sort((a, b) => a - b).some((order, index) => order !== index)) {
        throw new Error(`${kind}: region order must be a contiguous zero-based sequence`);
    }
    const bySource = [...template.regions].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    for (let index = 1; index < bySource.length; index++) {
        if (bySource[index - 1].endLine > bySource[index].startLine) {
            throw new Error(`${kind}: regions "${bySource[index - 1].id}" and "${bySource[index].id}" overlap`);
        }
    }
}

/** Replace whole-line regions from the end so earlier source coordinates stay stable. */
export function spliceStructuredCodeTemplate(
    template: StructuredCodeTemplate,
    regionContents: Record<string, string>,
    kind: 'program_fill' | 'function',
): string {
    validateStructuredCodeTemplate(template, kind);
    const expected = new Set(template.regions.map((region) => region.id));
    const unknown = Object.keys(regionContents).find((id) => !expected.has(id));
    if (unknown) throw new Error(`${kind}: unknown region "${unknown}"`);
    const lines = template.source.split('\n');
    const sortedRegions = [...template.regions].sort((a, b) => b.startLine - a.startLine);

    for (const region of sortedRegions) {
        const content = regionContents[region.id];
        if (content === undefined) throw new Error(`${kind}: missing region "${region.id}"`);
        const replacement = content.replace(/\r\n?/g, '\n').split('\n');
        lines.splice(region.startLine, region.endLine - region.startLine, ...replacement);
    }
    return lines.join('\n');
}

export function validateCompiledStructuredConfig(kind: string, config: any): void {
    if (!['program_fill', 'function'].includes(kind)) return;
    const expectedType = kind === 'function' ? 'function' : 'program_fill';
    if (config?.type !== expectedType) throw new Error(`${kind}: invalid structured configuration`);
    validateStructuredCodeJudgeConfig(config, kind as 'program_fill' | 'function');
    if (kind === 'program_fill' && config.mode === 'text') return;
    const template = config.template as StructuredCodeTemplate;
    if (!template.lang) throw new Error(`${kind}: template language is required`);
    if (!Array.isArray(config.langs) || config.langs.length !== 1 || config.langs[0] !== template.lang) {
        throw new Error(`${kind}: language mismatch`);
    }
}

/** Validate the private configuration required before a structured-code record is created. */
export function validateStructuredCodeJudgeConfig(config: any, kindInput?: 'program_fill' | 'function'): void {
    const kind = kindInput || (config?.type === 'function' ? 'function' : 'program_fill');
    const expectedType = kind === 'function' ? 'function' : 'program_fill';
    if (config?.type !== expectedType) throw new Error(`${kind}: invalid problem type`);
    if (kind === 'program_fill' && !['text', 'compile'].includes(config.mode)) {
        throw new Error('program_fill: mode must be text or compile');
    }
    validateStructuredCodeTemplate(config.template as StructuredCodeTemplate, kind);
    if (kind === 'program_fill' && config.mode === 'text') {
        if (config.cases !== undefined) throw new Error('program_fill: text mode cannot contain testdata cases');
        return;
    }
    if (!config.template.lang) throw new Error(`${kind}: template language is required`);
    if (!Array.isArray(config.cases) || !config.cases.length) throw new Error(`${kind}: testdata cases are required`);
}

export function validateStructuredCodeTestdataFiles(config: any, files: Array<{ name: string }>, kindInput?: 'program_fill' | 'function'): void {
    validateStructuredCodeJudgeConfig(config, kindInput);
    if ((kindInput === 'program_fill' || config.type === 'program_fill') && config.mode !== 'compile') {
        throw new Error('program_fill: text mode does not use testdata files');
    }
    const available = new Set((files || []).map((item) => item.name));
    const missing = (config.cases || []).flatMap((item) => [item.input, item.output]).find((name) => !available.has(name));
    if (missing) throw new Error(`${kindInput || config.type}: missing testdata file ${missing}`);
}

/** Parse and validate a student region payload before inserting a Record. */
export function parseStructuredRegionSubmission(
    kind: 'program_fill' | 'function',
    template: { lang?: string; regions: Array<{ id: string }> } | null | undefined,
    rawCode: string,
): Record<string, string> {
    if (!template || !Array.isArray(template.regions) || !template.regions.length) {
        throw new Error(`${kind}: missing template region description`);
    }
    let regions: unknown;
    try {
        regions = JSON.parse(rawCode);
    } catch (error: any) {
        throw new Error(`${kind}: region payload is not valid JSON`, { cause: error });
    }
    if (!regions || typeof regions !== 'object' || Array.isArray(regions)) {
        throw new Error(`${kind}: region payload must be an object`);
    }
    const expected = template.regions.map((region) => region.id).sort();
    if (expected.some((id) => typeof id !== 'string' || !STRUCTURED_CODE_REGION_ID.test(id))) {
        throw new Error(`${kind}: invalid template region id`);
    }
    if (new Set(expected).size !== expected.length) throw new Error(`${kind}: duplicate template region id`);
    const actual = Object.keys(regions).sort();
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
        throw new Error(`${kind}: region payload keys do not match template`);
    }
    const result = regions as Record<string, unknown>;
    if (actual.some((id) => typeof result[id] !== 'string')) {
        throw new Error(`${kind}: every region value must be a string`);
    }
    if (kind === 'program_fill' && actual.some((id) => /[\r\n]/.test(result[id] as string))) {
        throw new Error('program_fill: every submitted region must be one line');
    }
    return result as Record<string, string>;
}

export interface ProgramFillTextGrade {
    correctCount: number;
    score: number;
    regions: Array<{ id: string; order: number; correct: boolean; score: number }>;
}

/** Grade canonical text program-fill answers without materializing a second answer source. */
export function gradeProgramFillTextSubmission(config: any, rawCode: string): ProgramFillTextGrade {
    validateStructuredCodeJudgeConfig(config, 'program_fill');
    if (config.mode !== 'text') throw new Error('program_fill: text grader requires text mode');
    const submitted = parseStructuredRegionSubmission('program_fill', config.template, rawCode);
    const lines = config.template.source.split('\n');
    const regions = [...config.template.regions]
        .sort((a, b) => a.order - b.order)
        .map((region) => {
            const expected = lines.slice(region.startLine, region.endLine).join('\n').replace(/\r\n?/g, '\n').trim();
            const actual = submitted[region.id].replace(/\r\n?/g, '\n').trim();
            return { id: region.id, order: region.order, correct: actual === expected, score: 0 };
        });
    const correctCount = regions.filter((region) => region.correct).length;
    const score = (100 * correctCount) / regions.length;
    for (const region of regions) region.score = region.correct ? 100 / regions.length : 0;
    return { correctCount, score, regions };
}

/**
 * Compute a fingerprint of the judging-affecting fields of a problem config,
 * used to detect when a `paper_draft` was made against a now-changed problem.
 */
export function problemFingerprint(config: any): string {
    const subset = {
        type: config?.type,
        answers: config?.answers,
        template: config?.template,
        cases: config?.cases,
        subtasks: config?.subtasks,
        checker: config?.checker,
    };
    return createHash('sha256').update(JSON.stringify(subset)).digest('hex');
}
