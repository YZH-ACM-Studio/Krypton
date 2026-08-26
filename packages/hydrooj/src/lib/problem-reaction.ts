export const PROBLEM_REACTION_KEYS = ['up', 'down', 'what'] as const;
export type ProblemReaction = (typeof PROBLEM_REACTION_KEYS)[number];

export interface ProblemReactionCounts {
    up: number;
    down: number;
    what: number;
}

const KEY_SET = new Set<string>(PROBLEM_REACTION_KEYS);

export function isProblemReaction(value: unknown): value is ProblemReaction {
    return value === 'up' || value === 'down' || value === 'what';
}

export function parseProblemReactionInput(raw: unknown): ProblemReaction | null {
    if (raw === undefined || raw === null || raw === '' || raw === 'none') return null;
    if (!isProblemReaction(raw)) throw new TypeError('reaction must be up, down, what, or none');
    return raw;
}

function readCount(raw: unknown, field: ProblemReaction): number {
    if (raw === undefined) return 0;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
        throw new TypeError(`reactions.${field} must be a non-negative integer`);
    }
    return raw;
}

export function parseStoredProblemReactions(raw: unknown): ProblemReactionCounts {
    if (raw === undefined || raw === null) return { up: 0, down: 0, what: 0 };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('reactions must be an object');
    const node = raw as Record<string, unknown>;
    const extra = Object.keys(node).filter((key) => !KEY_SET.has(key));
    if (extra.length) throw new TypeError(`reactions contains unknown fields ${extra.join(', ')}`);
    return {
        up: readCount(node.up, 'up'),
        down: readCount(node.down, 'down'),
        what: readCount(node.what, 'what'),
    };
}

export function parseStoredProblemReactionChoice(raw: unknown): ProblemReaction | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (!isProblemReaction(raw)) throw new TypeError('stored reaction is invalid');
    return raw;
}

export function nextProblemReactionInc(prev: ProblemReaction | null, next: ProblemReaction | null): Record<string, number> {
    if (prev === next) return {};
    const inc: Record<string, number> = {};
    if (prev) inc[`reactions.${prev}`] = -1;
    if (next) inc[`reactions.${next}`] = 1;
    return inc;
}
