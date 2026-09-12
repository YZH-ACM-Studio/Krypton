/**
 * Helpers for inspecting / normalizing `Pdoc.config` — in particular the
 * question-kind metadata on `Objective` problems and the region splicing
 * for `FillFunction` problems.
 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import {
    buildClientStructuredCodeSurface,
    compareStructuredCodeRegions,
    type AnswerEntry,
    type QuestionKind,
    type StructuredCodeRange,
    type StructuredCodeTemplate,
} from '@hydrooj/common';
import { localizedErrorText, type LocalizedErrorText } from '../error';

const localizedProblemConfigErrors = new WeakMap<Error, LocalizedErrorText>();

function problemConfigError(message: LocalizedErrorText, options?: ErrorOptions): Error {
    const error = new Error(message.raw, options);
    localizedProblemConfigErrors.set(error, message);
    return error;
}

function problemConfigTypeError(message: LocalizedErrorText): TypeError {
    const error = new TypeError(message.raw);
    localizedProblemConfigErrors.set(error, message);
    return error;
}

export function getProblemConfigErrorText(error: unknown): LocalizedErrorText | undefined {
    return error instanceof Error ? localizedProblemConfigErrors.get(error) : undefined;
}

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
        const kind = config.type as 'program_fill' | 'function';
        validateStructuredCodeJudgeConfig(config, kind);
        out.template = {
            ...(config.template.lang ? { lang: config.template.lang } : {}),
            surface: buildClientStructuredCodeSurface(config.template),
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

export function validateStructuredCodeTemplate(
    template: StructuredCodeTemplate,
    kind: 'program_fill' | 'function',
    options: { allowEmpty?: boolean } = {},
): void {
    if (!template || typeof template !== 'object') throw problemConfigError(localizedErrorText`${kind}: missing private template`);
    const templateKeys = new Set(['lang', 'source', 'sourceHash', 'publicRanges', 'regions']);
    const extraTemplateKey = Object.keys(template).find((key) => !templateKeys.has(key));
    if (extraTemplateKey) throw problemConfigError(localizedErrorText`${kind}: unexpected template field ${extraTemplateKey}`);
    if (typeof template.source !== 'string') throw problemConfigError(localizedErrorText`${kind}: template source must be text`);
    if (template.source.includes('\r')) throw problemConfigError(localizedErrorText`${kind}: template source must use LF line endings`);
    if (!options.allowEmpty && !template.source.length) throw problemConfigError(localizedErrorText`${kind}: template source is required`);
    if (kind === 'function' && (!template.lang || typeof template.lang !== 'string')) {
        throw problemConfigError(localizedErrorText`function: template language is required`);
    }
    if (template.lang !== undefined && (typeof template.lang !== 'string' || !template.lang)) {
        throw problemConfigError(localizedErrorText`${kind}: template language must be non-empty text when provided`);
    }
    if (template.sourceHash !== templateSourceHash(template.source)) {
        throw problemConfigError(localizedErrorText`${kind}: template source hash mismatch`);
    }
    if (!Array.isArray(template.publicRanges)) throw problemConfigError(localizedErrorText`${kind}: template publicRanges must be an array`);
    if (!Array.isArray(template.regions)) throw problemConfigError(localizedErrorText`${kind}: template regions must be an array`);
    if (!options.allowEmpty && !template.regions.length) throw problemConfigError(localizedErrorText`${kind}: at least one region is required`);

    const lines = template.source.split('\n');
    const validateRange = (range: StructuredCodeRange, label: string) => {
        if (!range || typeof range !== 'object' || Array.isArray(range)) {
            throw problemConfigError(localizedErrorText`${kind}: ${label} is invalid`);
        }
        if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine)) {
            throw problemConfigTypeError(localizedErrorText`${kind}: ${label} has invalid line bounds`);
        }
        if (range.startLine < 0 || range.endLine <= range.startLine || range.endLine > lines.length) {
            throw problemConfigError(localizedErrorText`${kind}: ${label} is out of bounds`);
        }
    };
    for (const [index, range] of template.publicRanges.entries()) {
        const extraKey = Object.keys(range).find((key) => !['startLine', 'endLine'].includes(key));
        if (extraKey) {
            throw problemConfigError(localizedErrorText`${kind}: public range ${index + 1} has unexpected field ${extraKey}`);
        }
        validateRange(range, `public range ${index + 1}`);
        if (index && template.publicRanges[index - 1].startLine > range.startLine) {
            throw problemConfigError(localizedErrorText`${kind}: public ranges must be in source order`);
        }
    }
    const ids = new Set<string>();
    for (const [index, region] of template.regions.entries()) {
        if (!region || typeof region !== 'object') {
            throw problemConfigError(localizedErrorText`${kind}: region ${index + 1} is invalid`);
        }
        const allowedRegionKeys =
            kind === 'function' ? ['id', 'startLine', 'endLine', 'title', 'description'] : ['id', 'startLine', 'endLine', 'prompt'];
        const extraKey = Object.keys(region).find((key) => !allowedRegionKeys.includes(key));
        if (extraKey) {
            throw problemConfigError(localizedErrorText`${kind}: region ${index + 1} has unexpected field ${extraKey}`);
        }
        if (!STRUCTURED_CODE_REGION_ID.test(region.id)) {
            throw problemConfigError(localizedErrorText`${kind}: region ${index + 1} has an invalid server id`);
        }
        if (ids.has(region.id)) throw problemConfigError(localizedErrorText`${kind}: duplicate region id "${region.id}"`);
        ids.add(region.id);
        validateRange(region, `region ${region.id}`);
        if (kind === 'program_fill' && region.endLine !== region.startLine + 1) {
            throw problemConfigError(localizedErrorText`program_fill: every editable region must be exactly one line`);
        }
        if (kind === 'function') {
            if (region.title !== undefined && typeof region.title !== 'string') {
                throw problemConfigError(localizedErrorText`function: region ${region.id} title must be text`);
            }
            if (region.description !== undefined && typeof region.description !== 'string') {
                throw problemConfigError(localizedErrorText`function: region ${region.id} description must be text`);
            }
        } else if (region.prompt !== undefined && typeof region.prompt !== 'string') {
            throw problemConfigError(localizedErrorText`program_fill: region ${region.id} prompt must be text`);
        }
    }
    for (let index = 1; index < template.regions.length; index++) {
        if (compareStructuredCodeRegions(template.regions[index - 1], template.regions[index]) >= 0) {
            throw problemConfigError(localizedErrorText`${kind}: regions must be in canonical source order`);
        }
    }
    const visibleRanges = [
        ...template.publicRanges.map((range, index) => ({ ...range, label: `public range ${index + 1}` })),
        ...template.regions.map((region) => ({ ...region, label: `region ${region.id}` })),
    ].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.label.localeCompare(right.label));
    for (let index = 1; index < visibleRanges.length; index++) {
        if (visibleRanges[index - 1].endLine > visibleRanges[index].startLine) {
            throw problemConfigError(localizedErrorText`${kind}: ${visibleRanges[index - 1].label} and ${visibleRanges[index].label} overlap`);
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
    if (unknown) throw problemConfigError(localizedErrorText`${kind}: unknown region "${unknown}"`);
    const lines = template.source.split('\n');
    const sortedRegions = [...template.regions].sort((a, b) => b.startLine - a.startLine);

    for (const region of sortedRegions) {
        const content = regionContents[region.id];
        if (content === undefined) throw problemConfigError(localizedErrorText`${kind}: missing region "${region.id}"`);
        const replacement = content.replace(/\r\n?/g, '\n').split('\n');
        lines.splice(region.startLine, region.endLine - region.startLine, ...replacement);
    }
    return lines.join('\n');
}

export function validateCompiledStructuredConfig(kind: string, config: any): void {
    if (!['program_fill', 'function'].includes(kind)) return;
    const expectedType = kind === 'function' ? 'function' : 'program_fill';
    if (config?.type !== expectedType) throw problemConfigError(localizedErrorText`${kind}: invalid structured configuration`);
    validateStructuredCodeJudgeConfig(config, kind as 'program_fill' | 'function');
    if (kind === 'program_fill' && config.mode === 'text') return;
    const template = config.template as StructuredCodeTemplate;
    if (!template.lang) throw problemConfigError(localizedErrorText`${kind}: template language is required`);
    if (!Array.isArray(config.langs) || config.langs.length !== 1 || config.langs[0] !== template.lang) {
        throw problemConfigError(localizedErrorText`${kind}: language mismatch`);
    }
}

/** Validate the private configuration required before a structured-code record is created. */
export function validateStructuredCodeJudgeConfig(config: any, kindInput?: 'program_fill' | 'function'): void {
    const kind = kindInput || (config?.type === 'function' ? 'function' : 'program_fill');
    const expectedType = kind === 'function' ? 'function' : 'program_fill';
    if (config?.type !== expectedType) throw problemConfigError(localizedErrorText`${kind}: invalid problem type`);
    if (kind === 'program_fill' && !['text', 'compile'].includes(config.mode)) {
        throw problemConfigError(localizedErrorText`program_fill: mode must be text or compile`);
    }
    validateStructuredCodeTemplate(config.template as StructuredCodeTemplate, kind);
    if (kind === 'program_fill' && config.mode === 'text') {
        if (config.cases !== undefined) {
            throw problemConfigError(localizedErrorText`program_fill: text mode cannot contain testdata cases`);
        }
        return;
    }
    if (!config.template.lang) throw problemConfigError(localizedErrorText`${kind}: template language is required`);
    if (!Array.isArray(config.cases) || !config.cases.length) {
        throw problemConfigError(localizedErrorText`${kind}: testdata cases are required`);
    }
}

export function validateStructuredCodeTestdataFiles(config: any, files: Array<{ name: string }>, kindInput?: 'program_fill' | 'function'): void {
    validateStructuredCodeJudgeConfig(config, kindInput);
    if ((kindInput === 'program_fill' || config.type === 'program_fill') && config.mode !== 'compile') {
        throw problemConfigError(localizedErrorText`program_fill: text mode does not use testdata files`);
    }
    const available = new Set((files || []).map((item) => item.name));
    const missing = (config.cases || []).flatMap((item) => [item.input, item.output]).find((name) => !available.has(name));
    if (missing) throw problemConfigError(localizedErrorText`${kindInput || config.type}: missing testdata file ${missing}`);
}

/** Parse and validate a student region payload before inserting a Record. */
export function parseStructuredRegionSubmission(
    kind: 'program_fill' | 'function',
    template: { lang?: string; regions?: Array<{ id: string }> } | null | undefined,
    rawCode: string,
): Record<string, string> {
    const regionDescriptors = Array.isArray(template?.regions) ? template.regions : [];
    if (!template || !regionDescriptors.length) {
        throw problemConfigError(localizedErrorText`${kind}: missing template region description`);
    }
    let regions: unknown;
    try {
        regions = JSON.parse(rawCode);
    } catch (error: any) {
        throw problemConfigError(localizedErrorText`${kind}: region payload is not valid JSON`, { cause: error });
    }
    if (!regions || typeof regions !== 'object' || Array.isArray(regions)) {
        throw problemConfigError(localizedErrorText`${kind}: region payload must be an object`);
    }
    const expected = regionDescriptors.map((region) => region.id).sort();
    if (expected.some((id) => typeof id !== 'string' || !STRUCTURED_CODE_REGION_ID.test(id))) {
        throw problemConfigError(localizedErrorText`${kind}: invalid template region id`);
    }
    if (new Set(expected).size !== expected.length) {
        throw problemConfigError(localizedErrorText`${kind}: duplicate template region id`);
    }
    const actual = Object.keys(regions).sort();
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
        throw problemConfigError(localizedErrorText`${kind}: region payload keys do not match template`);
    }
    const result = regions as Record<string, unknown>;
    if (actual.some((id) => typeof result[id] !== 'string')) {
        throw problemConfigError(localizedErrorText`${kind}: every region value must be a string`);
    }
    if (kind === 'program_fill' && actual.some((id) => /[\r\n]/.test(result[id] as string))) {
        throw problemConfigError(localizedErrorText`program_fill: every submitted region must be one line`);
    }
    return result as Record<string, string>;
}

export interface ProgramFillTextGrade {
    correctCount: number;
    score: number;
    regions: Array<{ id: string; correct: boolean; score: number }>;
}

/** Grade canonical text program-fill answers without materializing a second answer source. */
export function gradeProgramFillTextSubmission(config: any, rawCode: string): ProgramFillTextGrade {
    validateStructuredCodeJudgeConfig(config, 'program_fill');
    if (config.mode !== 'text') throw problemConfigError(localizedErrorText`program_fill: text grader requires text mode`);
    const submitted = parseStructuredRegionSubmission('program_fill', config.template, rawCode);
    const lines = config.template.source.split('\n');
    const regions = config.template.regions.map((region) => {
        const expected = lines.slice(region.startLine, region.endLine).join('\n').replace(/\r\n?/g, '\n').trim();
        const actual = submitted[region.id].replace(/\r\n?/g, '\n').trim();
        return { id: region.id, correct: actual === expected, score: 0 };
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
