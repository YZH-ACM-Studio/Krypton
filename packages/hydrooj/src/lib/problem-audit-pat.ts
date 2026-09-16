import { readSubtasksFromFiles } from '@hydrooj/common';
import { BUILTIN_PID_NAMESPACE_IDS } from './problem-pid-namespace-registry';
import { parseProblemConfigObject } from './problem-config';
import type { ProblemAuditProblem } from './problem-audit';

const TEXT_CHECKERS = new Set(['default', 'strict', '', 'undefined']);
const SPJ_CHECKERS = new Set(['testlib', 'syzoj', 'hustoj', 'qduoj', 'kengyin', 'other']);

export interface PatInventoryRow {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    pidNamespaceId: string | null;
    sourceTemplate: string | null;
    patProblemId: string | null;
    patGuessSource: 'map' | 'title' | null;
    checkerType: string;
    checker: string | null;
    judgeType: string;
    caseCount: number;
    unpairedInputs: string[];
    hidden: boolean;
    archived: boolean;
    flags: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function testdataNames(data: unknown): string[] {
    if (!Array.isArray(data)) return [];
    const names: string[] = [];
    for (const item of data) {
        if (!isPlainObject(item) || typeof item.name !== 'string') continue;
        const name = item.name.trim();
        if (name) names.push(name);
    }
    return names;
}

function checkerFileName(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (isPlainObject(value) && typeof value.file === 'string' && value.file.trim()) return value.file.trim();
    return null;
}

function guessPatIdFromTitle(title: string): string | null {
    let rest = title.trim();
    if (rest.slice(0, 3).toUpperCase() === 'PAT') {
        rest = rest.slice(3).replace(/^[-–\s]+/, '');
        if (rest && 'ABab乙甲'.includes(rest[0])) rest = rest.slice(1).replace(/^[-–\s]+/, '');
    }
    const match = /^(\d{4})\b/.exec(rest);
    if (!match) return null;
    const numeric = Number(match[1]);
    if (numeric < 1000 || numeric > 1999) return null;
    return match[1];
}

function lookupPatMap(problem: ProblemAuditProblem, patMap: Record<string, string>): string | null {
    return patMap[`${problem.domainId}/${problem.pid}`] || patMap[problem.pid] || null;
}

function unpairedInputs(names: string[], config: Record<string, unknown> | null): string[] {
    const files = names.filter((name) => !/^config\.ya?ml$/i.test(name));
    const subtasks = readSubtasksFromFiles(files, {
        time: typeof config?.time === 'string' || typeof config?.time === 'number' ? config.time : undefined,
        memory: typeof config?.memory === 'string' || typeof config?.memory === 'number' ? config.memory : undefined,
        subtasks: Array.isArray(config?.subtasks) ? (config.subtasks as never) : undefined,
    });
    const pairedInputs = new Set(
        subtasks.flatMap((subtask) => (subtask.cases || []).map((item) => item.input).filter((item): item is string => Boolean(item))),
    );
    return names.filter((name) => /\.in$/i.test(name) && !pairedInputs.has(name)).sort();
}

function caseCount(names: string[], config: Record<string, unknown> | null): number {
    const files = names.filter((name) => !/^config\.ya?ml$/i.test(name));
    const subtasks = readSubtasksFromFiles(files, {
        time: typeof config?.time === 'string' || typeof config?.time === 'number' ? config.time : undefined,
        memory: typeof config?.memory === 'string' || typeof config?.memory === 'number' ? config.memory : undefined,
        subtasks: Array.isArray(config?.subtasks) ? (config.subtasks as never) : undefined,
    });
    return subtasks.reduce((sum, subtask) => sum + (subtask.cases || []).length, 0);
}

export function inspectPatProblem(problem: ProblemAuditProblem, patMap: Record<string, string> = {}): PatInventoryRow {
    const config = parseProblemConfigObject(problem);
    const cfg = isPlainObject(config) ? config : null;
    const names = testdataNames(problem.data);
    const checkerType = typeof cfg?.checker_type === 'string' && cfg.checker_type.trim() ? cfg.checker_type.trim() : 'default';
    const checker = checkerFileName(cfg?.checker);
    const judgeType = typeof cfg?.type === 'string' && cfg.type.trim() ? cfg.type.trim() : 'default';
    const namespace = typeof problem.pidNamespaceId === 'string' && problem.pidNamespaceId ? problem.pidNamespaceId : null;
    const sourceTemplate =
        isPlainObject(problem.sourceMeta) && typeof problem.sourceMeta.template === 'string' ? problem.sourceMeta.template : null;
    const mapped = lookupPatMap(problem, patMap);
    const titled = guessPatIdFromTitle(problem.title);
    const patProblemId = mapped || titled;
    const unpaired = unpairedInputs(names, cfg);
    const cases = caseCount(names, cfg);
    const flags: string[] = [];
    if (!namespace) flags.push('namespace_missing');
    if (
        namespace &&
        namespace !== BUILTIN_PID_NAMESPACE_IDS.patBasic &&
        namespace !== BUILTIN_PID_NAMESPACE_IDS.patAdvanced &&
        sourceTemplate !== 'pat_basic' &&
        sourceTemplate !== 'pat_advanced'
    ) {
        flags.push('namespace_not_pat');
    }
    if (/^P3\d{3}$/.test(problem.pid) && namespace === BUILTIN_PID_NAMESPACE_IDS.patAdvanced) flags.push('namespace_mismatch');
    if (/^P4\d{3}$/.test(problem.pid) && namespace === BUILTIN_PID_NAMESPACE_IDS.patBasic) flags.push('namespace_mismatch');
    if (!namespace && /^P[34]\d{3}$/.test(problem.pid)) flags.push('legacy_pid_shape');
    if (!patProblemId) flags.push('pat_id_unknown');
    if (TEXT_CHECKERS.has(checkerType)) flags.push('text_exact_checker');
    if (SPJ_CHECKERS.has(checkerType) && !checker) flags.push('missing_spj_file');
    if (!names.filter((name) => !/^config\.ya?ml$/i.test(name)).length) flags.push('no_testdata');
    if (unpaired.length) flags.push('unpaired_cases');
    if (problem.hidden === true) flags.push('hidden');
    if (problem.archivedAt) flags.push('archived');
    return {
        domainId: problem.domainId,
        docId: problem.docId,
        pid: problem.pid,
        title: problem.title,
        pidNamespaceId: namespace,
        sourceTemplate,
        patProblemId,
        patGuessSource: mapped ? 'map' : titled ? 'title' : null,
        checkerType,
        checker,
        judgeType,
        caseCount: cases,
        unpairedInputs: unpaired,
        hidden: problem.hidden === true,
        archived: Boolean(problem.archivedAt),
        flags,
    };
}
