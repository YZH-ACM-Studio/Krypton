import { expect } from 'chai';
import { describe, it } from 'node:test';
import { assertNoCanonicalProblemPrimitiveMutation, canonicalizeStructuredKnowledgePatch } from '../src/model/structured-problem-metadata';

const context = { domainId: 'system', pid: 17, actor: 42, operation: 'test' };

async function captureFailure(run: () => unknown | Promise<unknown>): Promise<Error> {
    try {
        await run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected operation to fail');
}

describe('P3.16 canonical structured metadata guard', () => {
    it('rejects converting a legacy programming problem into a structured kind', async () => {
        const error = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch({}, { problemKind: 'single', tag: [], knowledgeNodeIds: [] }, {}, context, 'request'),
        );
        expect(error).to.have.property('name', 'ValidationError');
    });

    it('requires a validated knowledge pair to survive every before hook', async () => {
        const patch: Record<string, unknown> = { problemKind: 'single', tag: [], knowledgeNodeIds: [] };
        const required = await canonicalizeStructuredKnowledgePatch({ problemKind: 'single' }, patch, {}, context, 'request', {
            requireKnowledgePair: true,
        });
        expect(required).to.equal(true);
        delete patch.tag;
        delete patch.knowledgeNodeIds;

        const error = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch({ problemKind: 'single' }, patch, {}, context, 'after-hook', {
                requireKnowledgePair: required,
            }),
        );
        expect(error).to.have.property('name', 'ValidationError');
    });

    it('rejects dotted and piecemeal canonical mutations', async () => {
        const dotted = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch({ problemKind: 'single' }, { 'tag.0': 'forged' } as any, {}, context, 'request'),
        );
        expect(dotted).to.have.property('name', 'ValidationError');
        const push = await captureFailure(() => assertNoCanonicalProblemPrimitiveMutation('knowledgeNodeIds', context, 'push'));
        const inc = await captureFailure(() => assertNoCanonicalProblemPrimitiveMutation('tag.0', context, 'inc'));
        expect(push).to.have.property('name', 'ValidationError');
        expect(inc).to.have.property('name', 'ValidationError');
    });
});
