import { flattenDeep, intersection } from 'lodash';
import { effectiveProblemKind, gradeObjectiveAnswer, type AnswerEntry } from '@hydrooj/common';
import {
    type LocalizedErrorText,
    localizedErrorText,
    ProblemConfigError,
    ProblemNotAllowLanguageError,
    ValidationError,
} from '../error';
import {
    getProblemConfigErrorText,
    gradeProgramFillTextSubmission,
    parseProblemConfigObject,
    questionKindMap,
} from './problem-config';

function throwLocalized(field: string, text: LocalizedErrorText): never {
    throw new ValidationError(field, null, text);
}

export interface VerifyObjectiveQuestionResult {
    outcome: 'correct' | 'partial' | 'wrong';
    score: number;
}

export interface VerifyObjectiveBody {
    results: Record<string, VerifyObjectiveQuestionResult>;
    skipped: string[];
}

interface LangRuntime {
    disabled?: boolean;
    hidden?: boolean;
    remote?: boolean;
    validAs?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failPid(message: LocalizedErrorText): never {
    throw new ValidationError('pid', null, message);
}

function objectiveAnswers(config: Record<string, unknown>): Record<string, AnswerEntry> {
    if (!isRecord(config.answers)) failPid(localizedErrorText`这道题不能在验题里判分。`);
    return config.answers as Record<string, AnswerEntry>;
}

function unanswered(value: unknown): boolean {
    return value === undefined || value === null;
}

/** Grade the keys the teacher actually answered. Unanswered keys stay out of the body. */
export function gradeVerifyObjective(pdoc: { config?: unknown }, answers: Record<string, unknown>): VerifyObjectiveBody {
    const config = parseProblemConfigObject(pdoc);
    if (!isRecord(config)) failPid(localizedErrorText`这道题不能在验题里判分。`);
    if (config.type === 'program_fill' && config.mode === 'text') return gradeTextProgramFill(config, answers);
    if (config.type !== 'objective') failPid(localizedErrorText`这道题不能在验题里判分。`);
    return gradeObjectiveConfig(config, answers);
}

function gradeObjectiveConfig(config: Record<string, unknown>, answers: Record<string, unknown>): VerifyObjectiveBody {
    const spec = objectiveAnswers(config);
    const kinds = questionKindMap(spec);
    for (const key of Object.keys(answers)) {
        if (!Object.hasOwn(kinds, key)) {
            throw new ValidationError('answers', null, localizedErrorText`答案里有这道题没有的小题。`);
        }
    }
    const results: VerifyObjectiveBody['results'] = {};
    const skipped: string[] = [];
    for (const [key, kind] of Object.entries(kinds)) {
        if (!Object.hasOwn(answers, key) || unanswered(answers[key])) continue;
        if (kind === 'subjective') {
            skipped.push(key);
            continue;
        }
        const grade = gradeObjectiveAnswer(spec[key], answers[key]);
        results[key] = { outcome: grade.outcome, score: grade.score };
    }
    return { results, skipped };
}

function regionIds(config: Record<string, unknown>): string[] {
    const template = config.template;
    if (!isRecord(template) || !Array.isArray(template.regions) || !template.regions.length) {
        failPid(localizedErrorText`这道题不能在验题里判分。`);
    }
    const ids: string[] = [];
    for (const region of template.regions) {
        if (!isRecord(region) || typeof region.id !== 'string' || !region.id) failPid(localizedErrorText`这道题不能在验题里判分。`);
        ids.push(region.id);
    }
    return ids;
}

function gradeTextProgramFill(config: Record<string, unknown>, answers: Record<string, unknown>): VerifyObjectiveBody {
    const ids = regionIds(config);
    const known = new Set(ids);
    for (const key of Object.keys(answers)) {
        if (!known.has(key)) throw new ValidationError('answers', null, localizedErrorText`答案里有这道题没有的小题。`);
    }
    const payload: Record<string, string> = {};
    const answered: string[] = [];
    for (const id of ids) {
        if (!Object.hasOwn(answers, id) || unanswered(answers[id])) {
            payload[id] = '\u0000';
            continue;
        }
        const value = answers[id];
        if (typeof value !== 'string') throw new ValidationError('answers', null, localizedErrorText`程序填空的答案必须是文本。`);
        payload[id] = value;
        answered.push(id);
    }
    let grade: ReturnType<typeof gradeProgramFillTextSubmission>;
    try {
        grade = gradeProgramFillTextSubmission(config, JSON.stringify(payload));
    } catch (error) {
        const text = getProblemConfigErrorText(error);
        if (text) throwLocalized('answers', text);
        throw error;
    }
    const results: VerifyObjectiveBody['results'] = {};
    for (const region of grade.regions) {
        if (!answered.includes(region.id)) continue;
        results[region.id] = {
            outcome: region.correct ? 'correct' : 'wrong',
            score: region.score,
        };
    }
    return { results, skipped: [] };
}

function readLangList(value: unknown): string[] | null {
    if (value == null) return null;
    if (!Array.isArray(value)) throw new ValidationError('lang', null, localizedErrorText`题目的语言配置无效。`);
    const list: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string' || !item) throw new ValidationError('lang', null, localizedErrorText`题目的语言配置无效。`);
        list.push(item);
    }
    return list;
}

/** Missing or '' means no limit. Any other string is a restriction, even if it splits to nothing. */
function commaLangList(value: unknown): string[] | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string') throw new ValidationError('lang', null, localizedErrorText`题目的语言配置无效。`);
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function templateLang(config: Record<string, unknown>): string {
    const template = config.template;
    if (!isRecord(template) || typeof template.lang !== 'string') return '';
    return template.lang;
}

function contestLangList(value: unknown): string[] | undefined {
    if (value == null) return undefined;
    const list = readLangList(value);
    return list.length ? list : undefined;
}

function remoteJudgeLangs(subType: unknown, langs: Record<string, LangRuntime | undefined>): string[] {
    const prefix = `${subType}.`;
    const found = Object.keys(langs).filter((key) => {
        const runtime = langs[key];
        if (!runtime) return false;
        const alias = typeof subType === 'string' ? runtime.validAs?.[subType] : undefined;
        return key.startsWith(prefix) || Boolean(alias);
    });
    if (typeof subType === 'string' && langs[subType]) found.push(subType);
    return found;
}

function baseLangs(
    config: Record<string, unknown>,
    langs: Record<string, LangRuntime | undefined>,
    restrictions: string[][],
): string[] {
    if (config.type === 'remote_judge') return remoteJudgeLangs(config.subType, langs);
    const keepHidden = flattenDeep(restrictions).length > 0;
    return Object.keys(langs).filter((key) => {
        const runtime = langs[key];
        if (!runtime || runtime.remote) return false;
        return keepHidden || !runtime.hidden;
    });
}

/**
 * Same language gate as a normal submission: structured problems use the template
 * language, and text-mode program fill is graded in memory instead of stored.
 * The allowed set is problem.ts _prepare: base langs intersected with the problem,
 * source domain, current domain, and contest lists.
 */
export function resolveVerifySubmitLanguage(
    pdoc: { config?: unknown; problemKind?: unknown },
    requestedLang: string,
    langs: Record<string, LangRuntime | undefined>,
    scope: { contestLangs?: unknown; domainLangs?: unknown; sourceDomainLangs?: unknown },
): string {
    const config = parseProblemConfigObject(pdoc);
    if (!isRecord(config)) failPid(localizedErrorText`这道题不能提交验题代码。`);
    const kind = effectiveProblemKind(pdoc);
    const type = typeof config.type === 'string' ? config.type : 'default';
    let lang = requestedLang;
    if (type === 'program_fill' && config.mode === 'text') {
        throw new ValidationError('code', null, localizedErrorText`文本模式程序填空请使用判分。`);
    }
    if (type === 'program_fill' || type === 'function') {
        if ((type === 'program_fill' && kind === 'program_fill' && config.mode === 'compile') || (type === 'function' && kind === 'function')) {
            lang = templateLang(config);
        } else {
            failPid(localizedErrorText`这道题不能提交验题代码。`);
        }
    } else if (type === 'objective' || type === 'submit_answer' || kind !== 'programming') {
        failPid(localizedErrorText`这道题不能提交验题代码。`);
    }
    const restrictions: string[][] = [];
    // An empty problem lang list is a real restriction. An empty contest list is "no limit".
    if (config.langs) {
        const configured = readLangList(config.langs);
        restrictions.push(configured);
    }
    const sourceDomainLangs = commaLangList(scope.sourceDomainLangs);
    if (sourceDomainLangs) restrictions.push(sourceDomainLangs);
    const domainLangs = commaLangList(scope.domainLangs);
    if (domainLangs) restrictions.push(domainLangs);
    const contestLangs = contestLangList(scope.contestLangs);
    if (contestLangs) restrictions.push(contestLangs);
    const allowed = intersection(baseLangs(config, langs, restrictions), ...restrictions);
    if (!allowed.length) throw new ProblemConfigError();
    const runtime = langs[lang];
    if (!allowed.includes(lang) || !runtime || runtime.disabled) throw new ProblemNotAllowLanguageError();
    return lang;
}
