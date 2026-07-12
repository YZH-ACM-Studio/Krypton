/**
 * Helpers for inspecting / normalizing `Pdoc.config` — in particular the
 * question-kind metadata on `Objective` problems and the region splicing
 * for `FillFunction` problems.
 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import type { AnswerEntry, FillFunctionTemplate, FillRegion, QuestionKind } from '@hydrooj/common';

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

export function validateTextProgramFillSubmission(problemKind: unknown, config: any, submitted: unknown): boolean {
    if (problemKind !== 'program_fill' || config?.type !== 'objective' || config?.subType !== 'program_fill_text') return false;
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
        throw new Error('program_fill: text submission must be an object');
    }
    const keys = Object.keys(submitted as Record<string, unknown>);
    if (keys.length !== 1 || keys[0] !== 'main') {
        throw new Error('program_fill: text submission must contain only main');
    }
    const answer = (submitted as Record<string, unknown>).main;
    if (typeof answer !== 'string') throw new Error('program_fill: text submission main must be a string');
    if (/[\r\n]/.test(answer)) throw new Error('program_fill: text submission must be one line');
    return true;
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
    if (config.type === 'fill_function' && config.template) {
        out.template = {
            lang: config.template.lang,
            regions: Array.isArray(config.template.regions)
                ? config.template.regions.map((region) => ({
                      id: region.id,
                      ...(region.prompt ? { prompt: region.prompt } : {}),
                  }))
                : [],
        };
    }
    if (config.subType) out.subType = config.subType;
    return out;
}

// ─── FillFunction region splicing ─────────────────────────────────────────

/** SHA-256 of the template source. Used for draft staleness detection. */
export function templateSourceHash(source: string): string {
    return createHash('sha256').update(source).digest('hex');
}

/**
 * Splice student-provided region contents back into the template `source`.
 *
 * Algorithm (PRD §1.7): sort regions by start position descending, replace
 * each range with the student's content. Replacing from the end backwards
 * keeps earlier ranges' line/col anchors valid even when student content
 * has more or fewer newlines than the original.
 *
 * Throws on invalid input: unknown region id, missing region, out-of-bounds.
 */
export function spliceFillFunction(template: FillFunctionTemplate, regionContents: Record<string, string>): string {
    const expected = new Set(template.regions.map((region) => region.id));
    const unknown = Object.keys(regionContents).find((id) => !expected.has(id));
    if (unknown) throw new Error(`fill_function: unknown region "${unknown}"`);
    const lines = template.source.split('\n');
    const sortedRegions = [...template.regions].sort((a, b) => {
        if (a.start.line !== b.start.line) return b.start.line - a.start.line;
        return b.start.col - a.start.col;
    });

    for (const region of sortedRegions) {
        const content = regionContents[region.id];
        if (content === undefined) {
            throw new Error(`fill_function: missing region "${region.id}"`);
        }
        validateRegionBounds(lines, region);
        spliceOne(lines, region, content);
    }
    return lines.join('\n');
}

function validateRegionBounds(lines: string[], region: FillRegion): void {
    if (region.start.line < 0 || region.start.line >= lines.length) {
        throw new Error(`fill_function: region "${region.id}" start.line out of bounds`);
    }
    if (region.end.line < region.start.line || region.end.line >= lines.length) {
        throw new Error(`fill_function: region "${region.id}" end.line out of bounds`);
    }
    if (region.start.col < 0) {
        throw new Error(`fill_function: region "${region.id}" start.col negative`);
    }
    if (region.start.col > lines[region.start.line].length) {
        throw new Error(`fill_function: region "${region.id}" start.col out of bounds`);
    }
    if (region.end.col < 0 || region.end.col > lines[region.end.line].length) {
        throw new Error(`fill_function: region "${region.id}" end.col out of bounds`);
    }
    if (region.start.line === region.end.line && region.end.col < region.start.col) {
        throw new Error(`fill_function: region "${region.id}" end precedes start`);
    }
}

function spliceOne(lines: string[], region: FillRegion, content: string): void {
    const { start, end } = region;
    const before = lines[start.line].slice(0, start.col);
    const after = lines[end.line].slice(end.col);
    const contentLines = content.split('\n');
    if (contentLines.length === 1) {
        lines.splice(start.line, end.line - start.line + 1, before + contentLines[0] + after);
    } else {
        const newLines = [before + contentLines[0], ...contentLines.slice(1, -1), contentLines[contentLines.length - 1] + after];
        lines.splice(start.line, end.line - start.line + 1, ...newLines);
    }
}

/**
 * Validate that regions don't overlap and have valid bounds. Called by the
 * problem-edit handler before persisting `config.template`.
 */
export function validateRegions(template: Pick<FillFunctionTemplate, 'source' | 'regions'>): void {
    const lines = template.source.split('\n');
    const seen = new Set<string>();
    for (const r of template.regions) {
        if (seen.has(r.id)) throw new Error(`fill_function: duplicate region id "${r.id}"`);
        seen.add(r.id);
        validateRegionBounds(lines, r);
    }
    // Check non-overlap by sorting and comparing adjacent.
    const sorted = [...template.regions].sort((a, b) => {
        if (a.start.line !== b.start.line) return a.start.line - b.start.line;
        return a.start.col - b.start.col;
    });
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev.end.line > cur.start.line || (prev.end.line === cur.start.line && prev.end.col > cur.start.col)) {
            throw new Error(`fill_function: regions "${prev.id}" and "${cur.id}" overlap`);
        }
    }
}

export interface RegionMarkerMetadata {
    id: string;
    prompt?: string;
}

const REGION_START = /^\s*\/\/\s*@krypton-region\s+([A-Za-z][A-Za-z0-9_-]{0,31})\s*$/;
const REGION_END = /^\s*\/\/\s*@krypton-endregion\s+([A-Za-z][A-Za-z0-9_-]{0,31})\s*$/;

export function parseRegionMarkers(markerSource: string, metadata: RegionMarkerMetadata[]): FillFunctionTemplate {
    if (typeof markerSource !== 'string' || !markerSource.trim()) {
        throw new Error('fill_function: template source is required');
    }
    if (!Array.isArray(metadata) || !metadata.length) {
        throw new Error('fill_function: at least one region is required');
    }
    const metaById = new Map<string, RegionMarkerMetadata>();
    for (const item of metadata) {
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(item.id)) {
            throw new Error('fill_function: invalid region id');
        }
        if (metaById.has(item.id)) throw new Error(`fill_function: duplicate region id "${item.id}"`);
        if (item.prompt !== undefined && typeof item.prompt !== 'string') {
            throw new Error(`fill_function: invalid prompt for region "${item.id}"`);
        }
        metaById.set(item.id, { id: item.id, ...(item.prompt?.trim() ? { prompt: item.prompt.trim() } : {}) });
    }
    const output: string[] = [];
    const parsed = new Map<string, FillRegion>();
    let active: { id: string; startLine: number } | null = null;
    for (const line of markerSource.replace(/\r\n/g, '\n').split('\n')) {
        const start = line.match(REGION_START);
        const end = line.match(REGION_END);
        if (start) {
            if (active) throw new Error(`fill_function: nested region "${start[1]}"`);
            if (parsed.has(start[1])) throw new Error(`fill_function: duplicate marker "${start[1]}"`);
            active = { id: start[1], startLine: output.length };
            continue;
        }
        if (end) {
            if (!active || active.id !== end[1]) {
                throw new Error(`fill_function: unmatched end marker "${end[1]}"`);
            }
            if (output.length === active.startLine) {
                throw new Error(`fill_function: region "${active.id}" needs a placeholder line`);
            }
            const endLine = output.length - 1;
            parsed.set(active.id, {
                id: active.id,
                start: { line: active.startLine, col: 0 },
                end: { line: endLine, col: output[endLine].length },
            });
            active = null;
            continue;
        }
        if (line.includes('@krypton-region') || line.includes('@krypton-endregion')) {
            throw new Error('fill_function: malformed region marker');
        }
        output.push(line);
    }
    if (active) throw new Error(`fill_function: missing end marker for "${active.id}"`);
    if (parsed.size !== metaById.size) throw new Error('fill_function: marker and region metadata do not match');
    const regions = metadata.map((item) => {
        const region = parsed.get(item.id);
        if (!region) throw new Error(`fill_function: missing marker for "${item.id}"`);
        return { ...region, ...(metaById.get(item.id)?.prompt ? { prompt: metaById.get(item.id)!.prompt } : {}) };
    });
    const source = output.join('\n');
    const template = { lang: '', source, regions, sourceHash: templateSourceHash(source) };
    validateRegions(template);
    return template;
}

export function validateCompiledStructuredConfig(kind: string, config: any): void {
    if (kind === 'program_fill' && config?.main?.mode === 'text') return;
    if (!['program_fill', 'function'].includes(kind)) return;
    const expectedSubType = kind === 'program_fill' ? 'program_fill_compile' : 'function';
    if (config?.type !== 'fill_function' || config?.subType !== expectedSubType) {
        throw new Error(`${kind}: invalid compile configuration`);
    }
    validateFillFunctionJudgeConfig(config);
    const template = config.template as FillFunctionTemplate;
    if (!Array.isArray(config.langs) || config.langs.length !== 1 || config.langs[0] !== template.lang) {
        throw new Error(`${kind}: language mismatch`);
    }
    if (kind === 'program_fill') {
        if (template.regions.length !== 1 || template.regions[0].id !== 'main') {
            throw new Error('program_fill: compile mode requires exactly one main region');
        }
        const region = template.regions[0];
        if (region.start.line !== region.end.line) throw new Error('program_fill: editable region must be one line');
    }
}

/** Validate the private configuration required before any fill-function record is created. */
export function validateFillFunctionJudgeConfig(config: any): void {
    if (config?.type !== 'fill_function') throw new Error('fill_function: invalid problem type');
    const template = config.template as FillFunctionTemplate;
    if (!template?.source || !template.lang || !Array.isArray(template.regions) || !template.regions.length) {
        throw new Error('fill_function: missing template configuration');
    }
    validateRegions(template);
    if (!Array.isArray(config.cases) || !config.cases.length) {
        throw new Error('fill_function: testdata cases are required');
    }
}

export function validateFillFunctionTestdataFiles(config: any, files: Array<{ name: string }>): void {
    validateFillFunctionJudgeConfig(config);
    const available = new Set((files || []).map((item) => item.name));
    const missing = (config.cases || []).flatMap((item) => [item.input, item.output]).find((name) => !available.has(name));
    if (missing) throw new Error(`fill_function: missing testdata file ${missing}`);
}

/** Parse and validate a student region payload before inserting a Record. */
export function parseStructuredRegionSubmission(
    kind: 'program_fill' | 'function' | 'fill_function',
    template: { lang: string; regions: Array<{ id: string }> } | null | undefined,
    rawCode: string,
): Record<string, string> {
    if (!template?.lang || !Array.isArray(template.regions) || !template.regions.length) {
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
    if (expected.some((id) => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id))) {
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
    if (kind === 'program_fill' && /[\r\n]/.test(result.main as string)) {
        throw new Error('program_fill: compile submission must be one line');
    }
    return result as Record<string, string>;
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
