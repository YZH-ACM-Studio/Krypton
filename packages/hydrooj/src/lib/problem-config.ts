/**
 * Helpers for inspecting / normalizing `Pdoc.config` — in particular the
 * question-kind metadata on `Objective` problems and the region splicing
 * for `FillFunction` problems.
 */
import { createHash } from 'node:crypto';
import type {
    AnswerEntry, FillFunctionTemplate, FillRegion, QuestionKind,
} from '@hydrooj/common';

/** Pull `(stdAns, score, meta?)` out of an AnswerEntry regardless of arity. */
export function unpackAnswerEntry(entry: AnswerEntry): {
    stdAns: string | string[];
    score: number;
    meta: { kind?: QuestionKind; prompt?: string };
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
 */
export function inferQuestionKind(entry: AnswerEntry): QuestionKind {
    const { stdAns, meta } = unpackAnswerEntry(entry);
    if (meta.kind) return meta.kind;
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
    if (!answers) return out;
    for (const [key, entry] of Object.entries(answers)) {
        out[key] = inferQuestionKind(entry);
    }
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
