import path from 'node:path';
import type { ProblemAuditProblem } from './problem-audit';

const CONTEXT = 24;
const LANGUAGE_KEY = /^[A-Za-z0-9_-]{1,32}$/;
const STRUCTURED_TEXT_PATHS = ['background', 'description', 'input', 'output', 'hints'] as const;

export type LatexRenderResult = { ok: true } | { ok: false; error: string };
export type LatexRenderer = (source: string, displayMode: boolean) => LatexRenderResult;

// Narrowed through a predicate: a falsy `ok` test cannot discard the success
// member while the repository compiles with `strictNullChecks: false`.
function latexRenderFailed(result: LatexRenderResult): result is Extract<LatexRenderResult, { ok: false }> {
    return !result.ok;
}

export interface LatexSpan {
    path: string;
    display: boolean;
    latex: string;
    offset: number;
    unterminated: boolean;
    context: string;
}

export interface LatexFinding {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    path: string;
    display: boolean;
    latex: string;
    offset: number;
    reason: 'katex' | 'unterminated' | 'double-backslash';
    error: string;
    suggested: string | null;
    context: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function sliceContext(source: string, offset: number): string {
    const start = Math.max(0, offset - CONTEXT);
    const end = Math.min(source.length, offset + CONTEXT);
    return source.slice(start, end).replace(/\s+/g, ' ');
}

function isEscaped(source: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++;
    return slashes % 2 === 1;
}

function isWhitespaceCode(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigitCode(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
}

function isValidDollarDelim(source: string, pos: number, opening: boolean): boolean {
    const prev = pos > 0 ? source.charCodeAt(pos - 1) : -1;
    const next = pos + 1 < source.length ? source.charCodeAt(pos + 1) : -1;
    if (opening) return !isWhitespaceCode(next);
    return !isWhitespaceCode(prev) && !isDigitCode(next);
}

function skipInlineCode(source: string, start: number): number {
    let ticks = 0;
    while (start + ticks < source.length && source[start + ticks] === '`') ticks++;
    let cursor = start + ticks;
    while (cursor < source.length) {
        if (source[cursor] === '`') {
            let run = 0;
            while (cursor + run < source.length && source[cursor + run] === '`') run++;
            if (run === ticks) return cursor + run;
            cursor += run;
            continue;
        }
        cursor++;
    }
    return source.length;
}

function openingFence(source: string, index: number): { length: number; marker: string } | null {
    let cursor = index;
    let spaces = 0;
    while (spaces < 3 && source[cursor] === ' ') {
        cursor++;
        spaces++;
    }
    const marker = source[cursor];
    if (marker !== '`' && marker !== '~') return null;
    let run = 0;
    while (source[cursor + run] === marker) run++;
    if (run < 3) return null;
    return { length: spaces + run, marker: marker.repeat(run) };
}

function closingFence(source: string, index: number, marker: string): number | null {
    let cursor = index;
    let spaces = 0;
    while (spaces < 3 && source[cursor] === ' ') {
        cursor++;
        spaces++;
    }
    const char = marker[0];
    let run = 0;
    while (source[cursor + run] === char) run++;
    if (run < marker.length) return null;
    const after = cursor + run;
    const rest = source.slice(after).split('\n', 1)[0].trim();
    return rest ? null : after;
}

function findUnescaped(source: string, token: string, from: number): number {
    let cursor = from;
    while (cursor < source.length) {
        const found = source.indexOf(token, cursor);
        if (found === -1) return -1;
        if (!isEscaped(source, found)) return found;
        cursor = found + token.length;
    }
    return -1;
}

export function extractMathSpans(pathName: string, source: string): LatexSpan[] {
    const spans: LatexSpan[] = [];
    const n = source.length;
    let i = 0;
    let lineStart = true;
    let fence: string | null = null;
    while (i < n) {
        if (fence) {
            if (lineStart) {
                const close = closingFence(source, i, fence);
                if (close !== null) {
                    fence = null;
                    i = close;
                    continue;
                }
            }
            if (source[i] === '\n') lineStart = true;
            else if (source[i] !== ' ' && source[i] !== '\t') lineStart = false;
            i++;
            continue;
        }
        if (lineStart) {
            const fenceOpen = openingFence(source, i);
            if (fenceOpen) {
                fence = fenceOpen.marker;
                i += fenceOpen.length;
                lineStart = false;
                continue;
            }
        }
        if (source[i] === '`') {
            i = skipInlineCode(source, i);
            lineStart = false;
            continue;
        }
        if (source.startsWith('$$', i) && !isEscaped(source, i)) {
            const end = findUnescaped(source, '$$', i + 2);
            if (end === -1) {
                spans.push({
                    path: pathName,
                    display: true,
                    latex: source.slice(i + 2).trim(),
                    offset: i,
                    unterminated: true,
                    context: sliceContext(source, i),
                });
                break;
            }
            spans.push({
                path: pathName,
                display: true,
                latex: source.slice(i + 2, end).trim(),
                offset: i,
                unterminated: false,
                context: sliceContext(source, i),
            });
            i = end + 2;
            lineStart = false;
            continue;
        }
        if (source[i] === '$' && !isEscaped(source, i) && isValidDollarDelim(source, i, true)) {
            let match = i + 1;
            let end = -1;
            while (match < n) {
                const found = source.indexOf('$', match);
                if (found === -1) break;
                if (source.slice(i + 1, found).includes('\n')) break;
                if (!isEscaped(source, found) && isValidDollarDelim(source, found, false) && found > i + 1) {
                    end = found;
                    break;
                }
                match = found + 1;
            }
            if (end === -1) {
                i += 1;
                lineStart = false;
                continue;
            }
            spans.push({
                path: pathName,
                display: false,
                latex: source.slice(i + 1, end).trim(),
                offset: i,
                unterminated: false,
                context: sliceContext(source, i),
            });
            i = end + 1;
            lineStart = false;
            continue;
        }
        lineStart = source[i] === '\n';
        i++;
    }
    return spans.filter((span) => span.unterminated || span.latex.length > 0);
}

function stripHtml(text: string): string {
    return text
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

function localeSources(content: unknown): Array<{ path: string; text: string }> {
    if (isPlainObject(content)) {
        const entries = Object.entries(content).filter(([language, text]) => LANGUAGE_KEY.test(language) && typeof text === 'string');
        if (entries.length) return entries.map(([language, text]) => ({ path: `content.${language}`, text: text as string }));
    }
    if (typeof content !== 'string') return [];
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (isPlainObject(parsed)) {
                const entries = Object.entries(parsed).filter(([language, text]) => LANGUAGE_KEY.test(language) && typeof text === 'string');
                if (entries.length) return entries.map(([language, text]) => ({ path: `content.${language}`, text: text as string }));
            }
        } catch {
            // ordinary markdown
        }
    }
    return [{ path: 'content', text: content }];
}

export function statementSourcesForAudit(problem: ProblemAuditProblem): Array<{ path: string; text: string }> {
    const sources: Array<{ path: string; text: string }> = [];
    const seen = new Set<string>();
    const add = (pathName: string, text: string) => {
        if (!text || seen.has(pathName)) return;
        seen.add(pathName);
        sources.push({ path: pathName, text });
    };
    if (problem.statementFormat === 'structured-v1' && isPlainObject(problem.programmingStatement)) {
        const statement = problem.programmingStatement;
        for (const key of STRUCTURED_TEXT_PATHS) {
            const section = statement[key];
            if (isPlainObject(section) && typeof section.content === 'string') add(`programmingStatement.${key}`, section.content);
        }
        const examples = statement.examples;
        if (isPlainObject(examples) && Array.isArray(examples.items)) {
            for (const [index, example] of examples.items.entries()) {
                if (isPlainObject(example) && typeof example.note === 'string') {
                    add(`programmingStatement.examples.${index}.note`, example.note);
                }
            }
        }
    }
    const html = problem.html === true;
    for (const source of localeSources(problem.content)) add(source.path, html ? stripHtml(source.text) : source.text);
    if (typeof problem.title === 'string' && problem.title.includes('$')) add('title', problem.title);
    return sources;
}

function collapseDoubleBackslashCommands(source: string): string {
    let current = source;
    for (let step = 0; step < 4; step++) {
        const next = current.replace(/\\\\([A-Za-z]+)/g, '\\$1');
        if (next === current) return current;
        current = next;
    }
    return current;
}

function hasDoubleBackslashCommand(source: string): boolean {
    return /\\\\[A-Za-z]/.test(source);
}

function rewriteLatex(source: string): string {
    return collapseDoubleBackslashCommands(source)
        .replace(/\\mbox\s*\{/g, '\\text{')
        .replace(/\\begin\{eqnarray\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\{eqnarray\*?\}/g, '\\end{aligned}')
        .replace(/\\begin\{equation\*?\}/g, '')
        .replace(/\\end\{equation\*?\}/g, '');
}

function renders(source: string, display: boolean, render: LatexRenderer): boolean {
    return render(source, display).ok || (!display && render(source, true).ok);
}

function suggestLatex(source: string, display: boolean, render: LatexRenderer): string | null {
    if (renders(source, display, render) && !hasDoubleBackslashCommand(source)) return null;
    if (!display && !hasDoubleBackslashCommand(source) && render(source, true).ok) return source;
    const rewritten = rewriteLatex(source).trim();
    if (rewritten && rewritten !== source && renders(rewritten, display, render)) return rewritten;
    return null;
}

export function scanProblemLatex(
    problem: ProblemAuditProblem,
    render: LatexRenderer,
): { spanCount: number; findings: LatexFinding[] } {
    const findings: LatexFinding[] = [];
    let spanCount = 0;
    for (const source of statementSourcesForAudit(problem)) {
        const spans = extractMathSpans(source.path, source.text);
        spanCount += spans.length;
        for (const span of spans) {
            if (span.unterminated) {
                findings.push({
                    domainId: problem.domainId,
                    docId: problem.docId,
                    pid: problem.pid,
                    title: problem.title,
                    path: span.path,
                    display: span.display,
                    latex: span.latex,
                    offset: span.offset,
                    reason: 'unterminated',
                    error: 'unterminated math delimiter',
                    suggested: null,
                    context: span.context,
                });
                continue;
            }
            const doubled = hasDoubleBackslashCommand(span.latex);
            const rendered = render(span.latex, span.display);
            if (rendered.ok && !doubled) continue;
            findings.push({
                domainId: problem.domainId,
                docId: problem.docId,
                pid: problem.pid,
                title: problem.title,
                path: span.path,
                display: span.display,
                latex: span.latex,
                offset: span.offset,
                reason: rendered.ok ? 'double-backslash' : 'katex',
                error: latexRenderFailed(rendered)
                    ? rendered.error
                    : 'double backslash command is not KaTeX (\\\\le is a line break plus letters, not \\le)',
                suggested: suggestLatex(span.latex, span.display, render),
                context: span.context,
            });
        }
    }
    return { spanCount, findings };
}

interface KatexModule {
    renderToString(source: string, options: { throwOnError: boolean; displayMode: boolean; strict: 'ignore' }): string;
}

let cachedKatex: KatexModule | null | undefined;

export function resolveKatexModule(): KatexModule {
    if (cachedKatex) return cachedKatex;
    const paths = [path.resolve(__dirname, '../../../ui-default'), path.resolve(__dirname, '../../../ui-next'), process.cwd()];
    try {
        cachedKatex = require(require.resolve('katex', { paths })) as KatexModule;
        return cachedKatex;
    } catch (error) {
        throw new Error(`katex is unavailable for latex audit: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function renderLatexWithKatex(source: string, displayMode: boolean): LatexRenderResult {
    try {
        resolveKatexModule().renderToString(source, { throwOnError: true, displayMode, strict: 'ignore' });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
    }
}
