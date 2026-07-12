import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    BASIC_OBJECTIVE_KIND,
    BASIC_OBJECTIVE_KINDS,
    effectiveProblemKind,
    parseProblemKind,
    parseProblemKindSlug,
    PROBLEM_KIND_SLUGS,
    PROBLEM_KINDS,
    problemKindToSlug,
} from '../problem-kind';

describe('problem kind contract', () => {
    it('keeps the one-to-one stored-kind and URL-slug mapping', () => {
        expect(PROBLEM_KINDS).to.deep.equal(['programming', 'single', 'multi', 'true_false', 'blank', 'subjective', 'program_fill', 'function']);
        expect(PROBLEM_KIND_SLUGS).to.deep.equal(['programming', 'single', 'multi', 'true-false', 'blank', 'subjective', 'program-fill', 'function']);
        for (const kind of PROBLEM_KINDS) {
            expect(parseProblemKindSlug(problemKindToSlug(kind))).to.equal(kind);
        }
    });

    it('provides the shared basic-objective subset without redefining kind or slug pairs', () => {
        expect(BASIC_OBJECTIVE_KINDS).to.deep.equal([
            BASIC_OBJECTIVE_KIND.single,
            BASIC_OBJECTIVE_KIND.multi,
            BASIC_OBJECTIVE_KIND.trueFalse,
            BASIC_OBJECTIVE_KIND.blank,
        ]);
        expect(BASIC_OBJECTIVE_KINDS.map(problemKindToSlug)).to.deep.equal(['single', 'multi', 'true-false', 'blank']);
    });

    it('interprets a missing legacy kind as programming without mutating it', () => {
        expect(effectiveProblemKind({})).to.equal('programming');
        expect(effectiveProblemKind({ problemKind: 'single' })).to.equal('single');
    });

    it('rejects unknown stored kinds and URL slugs instead of falling back', () => {
        expect(() => parseProblemKind('true-false')).to.throw(TypeError, 'Unknown problem kind');
        expect(() => parseProblemKindSlug('true_false')).to.throw(TypeError, 'Unknown problem kind slug');
        expect(() => effectiveProblemKind({ problemKind: 'mystery' as any })).to.throw(TypeError);
    });
});
