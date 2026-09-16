import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_PID_NAMESPACE_IDS } from './problem-pid-namespace-registry';
import { canonicalJson, sha256, writeJsonAtomic } from './problem-batch-import';
import { classifyTestdataEol, type TestdataEolKind } from './problem-audit-eol';
import { renderLatexWithKatex, scanProblemLatex, type LatexFinding, type LatexRenderer } from './problem-audit-latex';
import { inspectPatProblem, type PatInventoryRow } from './problem-audit-pat';

export const PROBLEM_AUDIT_SCHEMA_VERSION = 1;
export type ProblemAuditKind = 'latex' | 'testdata-eol' | 'pat';

const PID_FILTER = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

export class ProblemAuditError extends Error {
    constructor(
        message: string,
        public readonly code = 'PROBLEM_AUDIT_FAILED',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ProblemAuditError';
    }
}

export interface ProblemAuditProblem {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    content: unknown;
    html?: unknown;
    statementFormat?: unknown;
    programmingStatement?: unknown;
    pidNamespaceId?: unknown;
    sourceMeta?: unknown;
    config?: unknown;
    data?: unknown;
    tag?: unknown;
    hidden?: unknown;
    archivedAt?: unknown;
    problemKind?: unknown;
    nSubmit?: unknown;
    nAccept?: unknown;
}

export interface ProblemAuditTestdataFile {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    name: string;
    size: number;
}

export interface ProblemAuditTestdataRead {
    missing?: boolean;
    tooLarge?: boolean;
    bytes?: Buffer;
}

export interface ProblemAuditQuery {
    domainId?: string;
    allDomains: boolean;
    pids: string[];
}

export interface ProblemAuditAdapter {
    loadProblems(query: ProblemAuditQuery): Promise<ProblemAuditProblem[]>;
    listTestdataFiles?(problems: ProblemAuditProblem[]): Promise<ProblemAuditTestdataFile[]>;
    readTestdata?(file: ProblemAuditTestdataFile): Promise<ProblemAuditTestdataRead>;
    close?(): Promise<void>;
}

export interface TestdataEolFinding {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    name: string;
    size: number;
    eol: TestdataEolKind | 'skipped';
    crlfCount: number;
    crCount: number;
    lfCount: number;
    skipReason?: 'binary' | 'missing' | 'too_large';
}

export interface ProblemAuditReport {
    schemaVersion: 1;
    kind: ProblemAuditKind;
    generatedAt: string;
    query: { domainId: string | null; allDomains: boolean; pids: string[] };
    fingerprint: string;
    summary: Record<string, number>;
    latex?: LatexFinding[];
    testdataEol?: TestdataEolFinding[];
    pat?: PatInventoryRow[];
}

export interface ProblemAuditRunInput {
    kind: ProblemAuditKind;
    adapter: ProblemAuditAdapter;
    domainId?: string;
    allDomains?: boolean;
    pids?: string[];
    generatedAt?: string;
    renderLatex?: LatexRenderer;
    patMap?: Record<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function parseProblemAuditKind(value: unknown): ProblemAuditKind {
    if (value === 'latex' || value === 'testdata-eol' || value === 'pat') return value;
    throw new ProblemAuditError(`unsupported audit kind: ${String(value)}`, 'PROBLEM_AUDIT_KIND_INVALID');
}

export function parsePidFilter(value: unknown): string[] {
    if (value === undefined || value === null || value === '') return [];
    const text = String(value);
    const pids = text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const invalid = pids.filter((pid) => !PID_FILTER.test(pid));
    if (invalid.length) throw new ProblemAuditError(`invalid --pid: ${invalid.join(', ')}`, 'PROBLEM_AUDIT_PID_INVALID');
    return [...new Set(pids)].sort();
}

export function parsePatMap(value: unknown): Record<string, string> {
    if (value === undefined || value === null) return {};
    if (!isPlainObject(value)) throw new ProblemAuditError('pat map must be a JSON object', 'PROBLEM_AUDIT_PAT_MAP_INVALID');
    const entries = isPlainObject(value.entries) ? value.entries : value;
    const map: Record<string, string> = {};
    for (const [key, patId] of Object.entries(entries)) {
        if (key === 'schemaVersion' || key === 'entries') continue;
        if (typeof patId !== 'string' || !/^\d{4}$/.test(patId.trim())) {
            throw new ProblemAuditError(`pat map value must be a 4-digit PAT id: ${key}`, 'PROBLEM_AUDIT_PAT_MAP_INVALID');
        }
        const pid = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
        if (!PID_FILTER.test(pid)) throw new ProblemAuditError(`pat map key is not a pid: ${key}`, 'PROBLEM_AUDIT_PAT_MAP_INVALID');
        const id = patId.trim();
        map[key] = id;
        if (!map[pid]) map[pid] = id;
    }
    return map;
}

export async function readPatMapFile(filename: string): Promise<Record<string, string>> {
    const raw = JSON.parse(await fs.readFile(filename, 'utf8')) as unknown;
    return parsePatMap(raw);
}

function queryFromInput(input: ProblemAuditRunInput): ProblemAuditQuery {
    const pids = parsePidFilter((input.pids || []).join(','));
    const allDomains = input.allDomains === true;
    const domainId = allDomains ? undefined : String(input.domainId || 'system').trim() || 'system';
    return { domainId, allDomains, pids };
}

function matchesPidFilter(problem: ProblemAuditProblem, pids: string[]): boolean {
    if (!pids.length) return true;
    return pids.includes(problem.pid);
}

function compareFinding(left: { pid: string; docId: number; path?: string; name?: string }, right: typeof left): number {
    return left.pid.localeCompare(right.pid) || left.docId - right.docId || String(left.path || left.name || '').localeCompare(String(right.path || right.name || ''));
}

async function runLatexAudit(problems: ProblemAuditProblem[], render: LatexRenderer): Promise<{ findings: LatexFinding[]; summary: Record<string, number> }> {
    const findings: LatexFinding[] = [];
    let spans = 0;
    for (const problem of problems) {
        const scanned = scanProblemLatex(problem, render);
        spans += scanned.spanCount;
        findings.push(...scanned.findings);
    }
    findings.sort((left, right) => compareFinding(left, right) || left.offset - right.offset);
    return {
        findings,
        summary: {
            problems: problems.length,
            mathSpans: spans,
            failures: findings.length,
            unterminated: findings.filter((item) => item.reason === 'unterminated').length,
            katexErrors: findings.filter((item) => item.reason === 'katex').length,
            doubleBackslash: findings.filter((item) => item.reason === 'double-backslash').length,
            withSuggestion: findings.filter((item) => Boolean(item.suggested)).length,
        },
    };
}

async function runTestdataEolAudit(
    problems: ProblemAuditProblem[],
    adapter: ProblemAuditAdapter,
): Promise<{ findings: TestdataEolFinding[]; summary: Record<string, number> }> {
    if (typeof adapter.listTestdataFiles !== 'function' || typeof adapter.readTestdata !== 'function') {
        throw new ProblemAuditError('testdata-eol adapter cannot read blobs', 'PROBLEM_AUDIT_ADAPTER_INVALID');
    }
    const files = await adapter.listTestdataFiles(problems);
    const findings: TestdataEolFinding[] = [];
    for (const file of files) {
        if (file.size > MAX_TEXT_BYTES) {
            findings.push({
                domainId: file.domainId,
                docId: file.docId,
                pid: file.pid,
                title: file.title,
                name: file.name,
                size: file.size,
                eol: 'skipped',
                crlfCount: 0,
                crCount: 0,
                lfCount: 0,
                skipReason: 'too_large',
            });
            continue;
        }
        const blob = await adapter.readTestdata(file);
        if (blob.missing) {
            findings.push({
                domainId: file.domainId,
                docId: file.docId,
                pid: file.pid,
                title: file.title,
                name: file.name,
                size: file.size,
                eol: 'skipped',
                crlfCount: 0,
                crCount: 0,
                lfCount: 0,
                skipReason: 'missing',
            });
            continue;
        }
        if (blob.tooLarge || !blob.bytes) {
            findings.push({
                domainId: file.domainId,
                docId: file.docId,
                pid: file.pid,
                title: file.title,
                name: file.name,
                size: file.size,
                eol: 'skipped',
                crlfCount: 0,
                crCount: 0,
                lfCount: 0,
                skipReason: 'too_large',
            });
            continue;
        }
        const classified = classifyTestdataEol(blob.bytes);
        findings.push({
            domainId: file.domainId,
            docId: file.docId,
            pid: file.pid,
            title: file.title,
            name: file.name,
            size: file.size,
            eol: classified.binary ? 'skipped' : classified.kind,
            crlfCount: classified.crlfCount,
            crCount: classified.crCount,
            lfCount: classified.lfCount,
            ...(classified.binary ? { skipReason: 'binary' as const } : {}),
        });
    }
    findings.sort((left, right) => compareFinding(left, right));
    const interesting = findings.filter((item) => item.eol === 'crlf' || item.eol === 'cr' || item.eol === 'mixed' || item.skipReason);
    return {
        findings: interesting,
        summary: {
            problems: problems.length,
            files: findings.length,
            lf: findings.filter((item) => item.eol === 'lf').length,
            crlf: findings.filter((item) => item.eol === 'crlf').length,
            cr: findings.filter((item) => item.eol === 'cr').length,
            mixed: findings.filter((item) => item.eol === 'mixed').length,
            none: findings.filter((item) => item.eol === 'none').length,
            binary: findings.filter((item) => item.skipReason === 'binary').length,
            missing: findings.filter((item) => item.skipReason === 'missing').length,
            tooLarge: findings.filter((item) => item.skipReason === 'too_large').length,
        },
    };
}

function isPatCandidate(problem: ProblemAuditProblem): boolean {
    if (problem.pidNamespaceId === BUILTIN_PID_NAMESPACE_IDS.patBasic || problem.pidNamespaceId === BUILTIN_PID_NAMESPACE_IDS.patAdvanced) {
        return true;
    }
    if (isPlainObject(problem.sourceMeta) && (problem.sourceMeta.template === 'pat_basic' || problem.sourceMeta.template === 'pat_advanced')) {
        return true;
    }
    return /^P[34]\d{3}$/.test(problem.pid);
}

async function runPatAudit(
    problems: ProblemAuditProblem[],
    patMap: Record<string, string>,
): Promise<{ rows: PatInventoryRow[]; summary: Record<string, number> }> {
    const rows = problems.filter(isPatCandidate).map((problem) => inspectPatProblem(problem, patMap));
    rows.sort((left, right) => compareFinding(left, right));
    const countFlag = (flag: string) => rows.filter((row) => row.flags.includes(flag)).length;
    return {
        rows,
        summary: {
            problems: rows.length,
            patIdKnown: rows.filter((row) => Boolean(row.patProblemId)).length,
            textExactChecker: countFlag('text_exact_checker'),
            missingSpjFile: countFlag('missing_spj_file'),
            noTestdata: countFlag('no_testdata'),
            unpairedCases: countFlag('unpaired_cases'),
            namespaceMissing: countFlag('namespace_missing'),
            patIdUnknown: countFlag('pat_id_unknown'),
        },
    };
}

export async function runProblemAudit(input: ProblemAuditRunInput): Promise<ProblemAuditReport> {
    const kind = parseProblemAuditKind(input.kind);
    const query = queryFromInput(input);
    const loaded = await input.adapter.loadProblems(query);
    const problems = loaded.filter((problem) => matchesPidFilter(problem, query.pids));
    const generatedAt = input.generatedAt || new Date().toISOString();
    const report: ProblemAuditReport = {
        schemaVersion: PROBLEM_AUDIT_SCHEMA_VERSION,
        kind,
        generatedAt,
        query: { domainId: query.domainId || null, allDomains: query.allDomains, pids: query.pids },
        fingerprint: '',
        summary: {},
    };
    if (kind === 'latex') {
        const render = input.renderLatex || renderLatexWithKatex;
        const result = await runLatexAudit(problems, render);
        report.latex = result.findings;
        report.summary = result.summary;
    } else if (kind === 'testdata-eol') {
        const result = await runTestdataEolAudit(problems, input.adapter);
        report.testdataEol = result.findings;
        report.summary = result.summary;
    } else {
        const result = await runPatAudit(problems, input.patMap || {});
        report.pat = result.rows;
        report.summary = result.summary;
    }
    report.fingerprint = sha256(
        canonicalJson({
            schemaVersion: report.schemaVersion,
            kind: report.kind,
            query: report.query,
            summary: report.summary,
            latex: report.latex || [],
            testdataEol: report.testdataEol || [],
            pat: report.pat || [],
        }),
    );
    return report;
}

export function problemAuditSummary(report: ProblemAuditReport) {
    return { kind: report.kind, fingerprint: report.fingerprint, ...report.summary };
}

function escapeMarkdown(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderProblemAuditMarkdown(report: ProblemAuditReport): string {
    const lines = [
        `# 题目只读审计：${report.kind}`,
        '',
        `- 生成时间：${report.generatedAt}`,
        `- 范围：${report.query.allDomains ? '全部域' : report.query.domainId}${report.query.pids.length ? `；pid ${report.query.pids.join(', ')}` : ''}`,
        `- fingerprint：\`${report.fingerprint}\``,
        `- 摘要：${Object.entries(report.summary)
            .map(([key, value]) => `${key}=${value}`)
            .join('，')}`,
        '',
        '本报告只读。不改题、不交题、不重测。',
        '',
    ];
    if (report.kind === 'latex') {
        lines.push('## KaTeX 失败', '');
        if (!report.latex?.length) {
            lines.push('没有失败项。');
        } else {
            lines.push('| pid | 路径 | 模式 | 原文 | 建议 | 错误 |', '|---|---|---|---|---|---|');
            for (const item of report.latex) {
                lines.push(
                    `| ${escapeMarkdown(item.pid)} | ${escapeMarkdown(item.path)} | ${item.display ? '独立' : '行内'} | \`${escapeMarkdown(item.latex)}\` | ${item.suggested ? `\`${escapeMarkdown(item.suggested)}\`` : ''} | ${escapeMarkdown(item.error)} |`,
                );
            }
        }
    } else if (report.kind === 'testdata-eol') {
        lines.push('## 非 LF testdata', '');
        if (!report.testdataEol?.length) {
            lines.push('没有 CRLF / CR / mixed / 跳过项。');
        } else {
            lines.push('| pid | 文件 | eol | crlf | cr | lf | 跳过 |', '|---|---|---|---:|---:|---:|---|');
            for (const item of report.testdataEol) {
                lines.push(
                    `| ${escapeMarkdown(item.pid)} | ${escapeMarkdown(item.name)} | ${item.eol} | ${item.crlfCount} | ${item.crCount} | ${item.lfCount} | ${item.skipReason || ''} |`,
                );
            }
        }
    } else {
        lines.push('## PAT 清单', '');
        if (!report.pat?.length) {
            lines.push('没有 PAT 候选题。');
        } else {
            lines.push('| pid | PAT 题号 | checker | 测例 | 标记 |', '|---|---|---|---:|---|');
            for (const item of report.pat) {
                lines.push(
                    `| ${escapeMarkdown(item.pid)} | ${item.patProblemId || ''} | ${escapeMarkdown(item.checkerType)}${item.checker ? ` / ${escapeMarkdown(item.checker)}` : ''} | ${item.caseCount} | ${escapeMarkdown(item.flags.join(', '))} |`,
                );
            }
        }
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

export async function persistProblemAuditReport(reportPath: string, report: ProblemAuditReport): Promise<{ reportPath: string; markdownPath: string }> {
    const resolved = path.resolve(reportPath);
    const extension = path.extname(resolved);
    const markdownPath = `${extension ? resolved.slice(0, -extension.length) : resolved}.md`;
    await writeJsonAtomic(resolved, report);
    const temporary = `${markdownPath}.tmp-${process.pid}`;
    await fs.mkdir(path.dirname(markdownPath), { recursive: true });
    await fs.writeFile(temporary, renderProblemAuditMarkdown(report), { mode: 0o600 });
    await fs.rename(temporary, markdownPath);
    return { reportPath: resolved, markdownPath };
}
