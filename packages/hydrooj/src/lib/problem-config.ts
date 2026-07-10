/**
 * Helpers for inspecting / normalizing `Pdoc.config` — in particular the
 * question-kind metadata on `Objective` problems and the region splicing
 * for `FillFunction` problems.
 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import type {
    AnswerEntry, FillFunctionTemplate, FillRegion, QuestionKind,
} from '@hydrooj/common';
import { STATUS } from '@hydrooj/common';

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
            return (cfg && typeof cfg === 'object') ? cfg : null;
        } catch {
            return null;
        }
    }
    return null;
}

/** Pull `(stdAns, score, meta?)` out of an AnswerEntry regardless of arity. */
export function unpackAnswerEntry(entry: AnswerEntry): {
    stdAns: string | string[];
    score: number;
    meta: { kind?: QuestionKind, prompt?: string, type?: QuestionKind, choices?: string[] };
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
    config: { answers?: Record<string, AnswerEntry>, options?: Record<string, string[]> } | null | undefined,
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
        const choices = (Array.isArray(meta.choices) && meta.choices.length ? meta.choices : undefined)
            ?? (Array.isArray(config.options?.[key]) && config.options[key].length ? config.options[key] : undefined);
        const q: ClientQuestion = { key, kind, score: Number(entry[1]) || 0 };
        if (typeof meta.prompt === 'string' && meta.prompt) q.prompt = meta.prompt;
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
    // fill_function 模板本身就是要展示给学生的（挖空区外只读可见），
    // 不含标准答案，原样透传。
    if (config.type === 'fill_function' && config.template) out.template = config.template;
    if (config.subType) out.subType = config.subType;
    return out;
}

/** 主观题 key → {score 满分, prompt}（Rev.12 阅卷/判后合分共用）。 */
export function subjectiveKeysOf(cfg: any): Record<string, { score: number, prompt: string }> {
    const out: Record<string, { score: number, prompt: string }> = {};
    if (cfg?.type !== 'objective' || !cfg.answers || typeof cfg.answers !== 'object') return out;
    for (const [key, entry] of Object.entries(cfg.answers)) {
        if (!Array.isArray(entry)) continue;
        try {
            const { score, meta } = unpackAnswerEntry(entry as any);
            if (meta.kind === 'subjective') out[key] = { score: Number(score) || 0, prompt: meta.prompt || '' };
        } catch { continue; }
    }
    return out;
}

/**
 * 判题完成后合并已有人工评分（Rev.12，MAJOR-1 修复）：重判/rejudge 会把
 * score/status 重置为纯自动部分，若 record 上已有人工分（rdoc.subjective），
 * 这里以**新的自动分为 baseScore** 重算总分与状态——人工分在重判后不丢，
 * 且 baseScore 永远跟随最新自动判分（顺带修 stale baseScore）。
 * 返回 null 表示无需合并。
 */
export function mergeSubjectiveScores(rdoc: {
    score?: number;
    status?: number;
    subjective?: { scores: Record<string, number>, baseScore: number, gradedBy: number, gradedAt: Date };
}, cfg: any): { score: number, status: number, subjective: NonNullable<typeof rdoc.subjective> } | null {
    const scores = rdoc.subjective?.scores;
    if (!scores || !Object.keys(scores).length) return null;
    const keys = subjectiveKeysOf(cfg);
    if (!Object.keys(keys).length) return null;
    const baseScore = rdoc.score || 0;
    let manualSum = 0;
    for (const [k, v] of Object.entries(scores)) {
        // 只合并仍存在的主观题 key（题目改配置后残留的旧 key 忽略）
        if (keys[k]) manualSum += Math.min(Number(v) || 0, keys[k].score);
    }
    const newScore = baseScore + manualSum;
    const allGraded = Object.keys(keys).every((k) => scores[k] !== undefined);
    let totalFull = 0;
    for (const entry of Object.values(cfg.answers || {})) {
        if (Array.isArray(entry)) totalFull += Number(entry[1]) || 0;
    }
    const status = allGraded
        ? (newScore >= totalFull ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER)
        : STATUS.STATUS_WAITING;
    return {
        score: newScore,
        status,
        subjective: { ...rdoc.subjective!, baseScore },
    };
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
export function spliceFillFunction(
    template: FillFunctionTemplate, regionContents: Record<string, string>,
): string {
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
}

function spliceOne(lines: string[], region: FillRegion, content: string): void {
    const { start, end } = region;
    const before = lines[start.line].slice(0, start.col);
    const after = lines[end.line].slice(end.col);
    const contentLines = content.split('\n');
    if (contentLines.length === 1) {
        lines.splice(start.line, end.line - start.line + 1, before + contentLines[0] + after);
    } else {
        const newLines = [
            before + contentLines[0],
            ...contentLines.slice(1, -1),
            contentLines[contentLines.length - 1] + after,
        ];
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
        if (prev.end.line > cur.start.line
            || (prev.end.line === cur.start.line && prev.end.col > cur.start.col)) {
            throw new Error(`fill_function: regions "${prev.id}" and "${cur.id}" overlap`);
        }
    }
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
