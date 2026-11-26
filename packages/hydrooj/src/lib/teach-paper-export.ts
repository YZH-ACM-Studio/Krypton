import { ObjectId } from 'mongodb';
import {
    activePaperPids, contestProblemScoreWeight, type SetPaperPoints, paperProblemMaximum, roundPaperPoints,
    effectiveProblemKind,
    groupByPta,
    isBasicObjectiveKind,
    isTeachGroupedByKind,
    letterLabel,
    ptaKindName,
    ptaLabel,
    readExamPaperQuotas,
    TEACH_SCORED_CONTEST_RULES,
    type ProblemKind,
    type TeachType,
    type SetCodePolicy,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { type LocalizedErrorText, localizedErrorText, ValidationError } from '../error';
import problem, { type ProblemDoc } from '../model/problem';
import { loadPaperProblemFacts } from './set-paper-facts';
import { storedSetConfigOrNull } from './set-publication';
import { parseProblemConfigObject } from './problem-config';

const logger = new Logger('teach-paper-export');
const SECTION_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八'] as const;

export type TeachObjectivePreview =
    | { kind: 'single'; options: string[]; answerIndex: number }
    | { kind: 'multi'; options: string[]; answerIndexes: number[] }
    | { kind: 'true_false'; answer: boolean }
    | { kind: 'blank'; answer: string };

interface PaperContainer {
    _id?: unknown;
    title?: unknown;
    rule?: unknown;
    pids?: unknown;
    score?: unknown;
    setPoints?: SetPaperPoints;
    examPaperQuotas?: unknown;
    setConfig?: unknown;
    dag?: unknown;
}

export interface TeachPaperExportItem {
    label: string;
    pid: number;
    title: string;
    score: number | null;
    kind: ProblemKind;
    statement: string;
    options: string[] | null;
    answer: string | null;
}

export interface TeachPaperExportSection {
    kind: ProblemKind | null;
    heading: string;
    drawNote: string | null;
    items: TeachPaperExportItem[];
}

export interface TeachPaperExport {
    title: string;
    type: TeachType;
    answers: boolean;
    grouped: boolean;
    sections: TeachPaperExportSection[];
}

interface PreparedProblem {
    docId: number;
    title: string;
    kind: ProblemKind;
    score: number | null;
    statement: string;
    options: string[] | null;
    answer: string | null;
}

function invalid(field: string, text: LocalizedErrorText): never {
    throw new ValidationError(field, null, text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readOptions(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((option) => typeof option !== 'string')) invalid('config', localizedErrorText`题目选项无效。`);
    return [...value];
}

export function objectiveOf(kind: ProblemKind, config: unknown): TeachObjectivePreview | null {
    if (!isBasicObjectiveKind(kind)) return null;
    const parsed: unknown = parseProblemConfigObject({ config });
    if (!isRecord(parsed) || !isRecord(parsed.main)) return null;
    const main = parsed.main;
    if (kind === 'single') {
        const options = readOptions(main.options);
        if (typeof main.answerIndex !== 'number' || !Number.isSafeInteger(main.answerIndex) || main.answerIndex < 0 || main.answerIndex >= options.length) {
            invalid('config', localizedErrorText`单选题答案无效。`);
        }
        return { kind: 'single', options, answerIndex: main.answerIndex };
    }
    if (kind === 'multi') {
        const options = readOptions(main.options);
        if (
            !Array.isArray(main.answerIndexes)
            || !main.answerIndexes.length
            || main.answerIndexes.some((index) => typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= options.length)
        ) invalid('config', localizedErrorText`多选题答案无效。`);
        return { kind: 'multi', options, answerIndexes: [...main.answerIndexes] };
    }
    if (kind === 'true_false') {
        if (typeof main.answer !== 'boolean') invalid('config', localizedErrorText`判断题答案无效。`);
        return { kind: 'true_false', answer: main.answer };
    }
    if (typeof main.answer !== 'string') invalid('config', localizedErrorText`填空题答案无效。`);
    return { kind: 'blank', answer: main.answer };
}

export function readContent(doc: { content?: unknown }): string {
    if (doc.content === undefined || doc.content === null) return '';
    if (typeof doc.content !== 'string') throw new TypeError('teach bank content is invalid');
    return doc.content;
}

function readTitle(raw: unknown): string {
    if (typeof raw !== 'string') invalid('title', localizedErrorText`题目集标题无效。`);
    return raw;
}

function readRule(type: TeachType, doc: PaperContainer): string {
    if (type === 'practice') return 'problem_set';
    if (typeof doc.rule !== 'string' || !doc.rule) invalid('rule', localizedErrorText`题目集的赛制无效。`);
    return doc.rule;
}

function readPids(raw: unknown): number[] {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.some((pid) => !positiveInt(pid))) invalid('pids', localizedErrorText`题目列表无效。`);
    return raw.slice();
}

function practicePids(doc: PaperContainer): number[] {
    const dag = doc.dag;
    if (!Array.isArray(dag)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
    const pids: number[] = [];
    for (const node of dag) {
        if (!isRecord(node) || !Array.isArray(node.pids)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        for (const pid of node.pids) {
            if (!positiveInt(pid)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
            pids.push(pid);
        }
    }
    return pids;
}

function containerPids(type: TeachType, doc: PaperContainer): number[] {
    if (type === 'practice') return practicePids(doc);
    return readPids(doc.pids);
}

function scoreFor(type: TeachType, rule: string, score: unknown, docId: number, codePolicy: SetCodePolicy | null): number | null {
    if (codePolicy) return codePolicy === 'acm' ? null : contestProblemScoreWeight({ score }, docId);
    if (type === 'practice' || rule === 'acm' || rule === 'ledo') return null;
    if (type === 'homework' || TEACH_SCORED_CONTEST_RULES.includes(rule)) return contestProblemScoreWeight({ score }, docId);
    return null;
}

function quotasFor(type: TeachType, raw: unknown): Partial<Record<ProblemKind, number>> | null {
    if (type !== 'exam') return null;
    try {
        return readExamPaperQuotas(raw);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'exam_paper_quotas_invalid') invalid('examPaperQuotas', localizedErrorText`抽题设置无效。`);
        throw error;
    }
}

function containerKey(doc: PaperContainer): string {
    return doc._id instanceof ObjectId ? doc._id.toHexString() : 'invalid';
}

function formatPoints(value: number): string {
    if (!Number.isFinite(value)) invalid('score', localizedErrorText`题目分值无效。`);
    return String(roundPaperPoints(value));
}

function sectionHeading(index: number, kind: ProblemKind, scores: readonly (number | null)[]): string {
    const ordinal = SECTION_ORDINALS[index];
    if (!ordinal) invalid('sections', localizedErrorText`试卷分组无效。`);
    const name = ptaKindName(kind);
    if (scores.every((score) => score === null)) return `${ordinal}、${name}`;
    const first = scores[0];
    const uniform = typeof first === 'number' && scores.every((score) => score === first);
    if (uniform) {
        return `${ordinal}、${name}（每题 ${formatPoints(first)} 分，共 ${formatPoints(first * scores.length)} 分）`;
    }
    let total = 0;
    for (const score of scores) {
        if (typeof score === 'number') total += score;
    }
    return `${ordinal}、${name}（共 ${formatPoints(total)} 分）`;
}

function drawNote(kind: ProblemKind, quotas: Partial<Record<ProblemKind, number>> | null): string | null {
    if (!quotas || !Object.hasOwn(quotas, kind)) return null;
    const count = quotas[kind];
    if (typeof count !== 'number') return null;
    return `每人抽 ${count} 道`;
}

function rewriteStatementFiles(docId: number, content: string): string {
    return content.replaceAll('file://', `/p/${docId}/file/`);
}

function kindOf(doc: { problemKind?: unknown }, docId: number): ProblemKind {
    try {
        return effectiveProblemKind(doc);
    } catch (error) {
        if (error instanceof TypeError) {
            logger.error('teach paper export kind rejected docId=%d', docId);
            invalid('problemKind', localizedErrorText`题目的题型无效。`);
        }
        throw error;
    }
}

function statementOf(docId: number, doc: ProblemDoc): string {
    let content: string;
    try {
        content = readContent(doc);
    } catch (error) {
        if (error instanceof TypeError) invalid('content', localizedErrorText`题目题面无效。`);
        throw error;
    }
    return rewriteStatementFiles(docId, content);
}

function objectiveAnswer(objective: TeachObjectivePreview): string {
    if (objective.kind === 'true_false') return objective.answer ? '对' : '错';
    if (objective.kind === 'blank') return objective.answer;
    if (objective.kind === 'single') return letterLabel(objective.answerIndex);
    const indexes = [...new Set(objective.answerIndexes)].sort((left, right) => left - right);
    return indexes.map((index) => letterLabel(index)).join(', ');
}

function objectiveFields(kind: ProblemKind, config: unknown, answers: boolean): { options: string[] | null; answer: string | null } {
    const objective = objectiveOf(kind, config);
    if (isBasicObjectiveKind(kind) && !objective) invalid('config', localizedErrorText`题目答案无效。`);
    const options = objective && (objective.kind === 'single' || objective.kind === 'multi') ? [...objective.options] : null;
    const answer = answers && objective ? objectiveAnswer(objective) : null;
    return { options, answer };
}

function missingProblem(domainId: string, containerId: string, docId: number, score: number | null): PreparedProblem {
    logger.error('teach paper export problem missing domain=%s id=%s docId=%d', domainId, containerId, docId);
    return {
        docId,
        title: '（题目已删除）',
        kind: 'programming',
        score,
        statement: '',
        options: null,
        answer: null,
    };
}

function prepareProblem(
    domainId: string,
    containerId: string,
    docId: number,
    doc: ProblemDoc | null,
    score: number | null,
    answers: boolean,
): PreparedProblem {
    if (!doc || doc.docId !== docId) return missingProblem(domainId, containerId, docId, score);
    if (typeof doc.title !== 'string') invalid('title', localizedErrorText`题目数据无效。`);
    const kind = kindOf(doc, docId);
    const objective = objectiveFields(kind, doc.config, answers);
    return {
        docId,
        title: doc.title,
        kind,
        score,
        statement: statementOf(docId, doc),
        options: objective.options,
        answer: objective.answer,
    };
}

function toItem(item: PreparedProblem, label: string): TeachPaperExportItem {
    return {
        label,
        pid: item.docId,
        title: item.title,
        score: item.score,
        kind: item.kind,
        statement: item.statement,
        options: item.options,
        answer: item.answer,
    };
}

function groupedSections(items: readonly PreparedProblem[], quotas: Partial<Record<ProblemKind, number>> | null): TeachPaperExportSection[] {
    const groups = groupByPta(items.map((item) => ({ ...item, pid: item.docId })));
    return groups.map((group, index) => ({
        kind: group.kind,
        heading: sectionHeading(index, group.kind, group.items.map((item) => item.score)),
        drawNote: drawNote(group.kind, quotas),
        items: group.items.map((item, indexInKind) => toItem(item, ptaLabel(group.kind, indexInKind))),
    }));
}

function ungroupedSection(type: TeachType, items: readonly PreparedProblem[]): TeachPaperExportSection {
    return {
        kind: null,
        heading: '',
        drawNote: null,
        items: items.map((item, index) => toItem(item, type === 'practice' ? String(index + 1) : letterLabel(index))),
    };
}

async function loadProblems(domainId: string, pids: readonly number[]): Promise<Map<number, ProblemDoc | null>> {
    const unique = [...new Set(pids)];
    // getList rewrites config into the student view and drops objective answers.
    const pairs = await Promise.all(unique.map(async (docId) => {
        const doc = await problem.get(domainId, docId, problem.PROJECTION_PUBLIC, true);
        return [docId, doc] as const;
    }));
    return new Map(pairs);
}

export async function buildTeachPaperExport(domainId: string, type: TeachType, doc: PaperContainer, answers: boolean): Promise<TeachPaperExport> {
    const title = readTitle(doc.title);
    const rule = readRule(type, doc);
    const pids = activePaperPids(containerPids(type, doc), doc.setPoints);
    const scoreMap = doc.score;
    const config = type === 'practice' ? null : storedSetConfigOrNull(doc);
    const codePolicy = config?.settings.codePolicy ?? null;
    const quotas = config ? config.settings.draw.quotas : quotasFor(type, doc.examPaperQuotas);
    const grouped = isTeachGroupedByKind(type);
    const loaded = await loadProblems(domainId, pids);
    const facts = codePolicy && codePolicy !== 'acm' && !doc.setPoints
        ? await loadPaperProblemFacts(problem, domainId, pids.filter((pid) => loaded.get(pid))) : null;
    const containerId = containerKey(doc);
    const prepared = pids.map((docId) => prepareProblem(
        domainId,
        containerId,
        docId,
        loaded.get(docId) ?? null,
        codePolicy && codePolicy !== 'acm'
            ? doc.setPoints || facts?.has(docId) ? paperProblemMaximum(doc, docId, facts?.get(docId)?.rawMax ?? 0) : null
            : scoreFor(type, rule, scoreMap, docId, codePolicy),
        answers,
    ));
    return {
        title,
        type,
        answers,
        grouped,
        sections: grouped ? groupedSections(prepared, quotas) : [ungroupedSection(type, prepared)],
    };
}
