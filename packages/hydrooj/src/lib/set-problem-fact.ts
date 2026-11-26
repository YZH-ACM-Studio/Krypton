import { effectiveProblemKind, type ProblemKind, type SetProblemFact } from '@hydrooj/common';

function configMode(config: unknown): string | null {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return null;
    const mode = (config as { mode?: unknown }).mode;
    return typeof mode === 'string' ? mode : null;
}

/** Text program-fill is an objective answer. Compile mode is judged code. Missing mode fails closed. */
export function setProblemFact(doc: { problemKind?: unknown; config?: unknown }): SetProblemFact {
    const kind: ProblemKind = effectiveProblemKind(doc);
    if (kind === 'programming' || kind === 'function') return { kind, judged: true };
    if (kind !== 'program_fill') return { kind, judged: false };
    const mode = configMode(doc.config);
    if (mode !== 'text' && mode !== 'compile') throw new TypeError('set_problem_mode_invalid');
    return { kind, judged: mode === 'compile' };
}
