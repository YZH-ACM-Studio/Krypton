import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { after, describe, it } from 'node:test';
import { assertNoCanonicalProblemPrimitiveMutation, canonicalizeStructuredKnowledgePatch } from '../src/model/structured-problem-metadata';

const Module = require('module');
const context = { domainId: 'system', pid: 17, actor: 42, operation: 'test' };
const knowledgeMapId = new ObjectId('507f1f77bcf86cd799439010');
const managedAuthoringPath = require.resolve('../src/model/managed-problem-authoring.ts');
const previousManagedAuthoringCache = require.cache[managedAuthoringPath];
require.cache[managedAuthoringPath] = {
    id: managedAuthoringPath,
    filename: managedAuthoringPath,
    loaded: true,
    exports: {
        async materializeKnowledgeMindmapTags(input: unknown, options: { knowledgeMapId: ObjectId }) {
            const nodeIds = Array.isArray(input) ? input : [];
            return { mapId: options.knowledgeMapId, nodeIds, tags: nodeIds.map(() => '图论') };
        },
    },
} as NodeModule;

after(() => {
    if (previousManagedAuthoringCache) require.cache[managedAuthoringPath] = previousManagedAuthoringCache;
    else delete require.cache[managedAuthoringPath];
});

async function captureFailure(run: () => unknown | Promise<unknown>): Promise<Error> {
    try {
        await run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected operation to fail');
}

describe('P3.16 canonical structured metadata guard', () => {
    it('materializes a non-empty node pair through the lazy loader instead of native ESM resolution', async () => {
        const originalLoad = Module._load;
        const canonicalNode = { toHexString: () => '507f1f77bcf86cd799439011' };
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === './managed-problem-authoring' && parent?.filename.endsWith('structured-problem-metadata.ts')) {
                return {
                    async materializeKnowledgeMindmapTags() {
                        return { mapId: knowledgeMapId, nodeIds: [canonicalNode], tags: ['图论'] };
                    },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            const patch: any = { tag: ['图论'], knowledgeMapId, knowledgeNodeIds: ['507f1f77bcf86cd799439011'] };
            const required = await canonicalizeStructuredKnowledgePatch({ problemKind: 'single', knowledgeMapId }, patch, {}, context, 'request');
            expect(required).to.equal(true);
            expect(patch.knowledgeMapId).to.equal(knowledgeMapId);
            expect(patch.knowledgeNodeIds).to.deep.equal([canonicalNode]);
        } finally {
            Module._load = originalLoad;
        }
    });

    it('rejects converting a legacy programming problem into a structured kind', async () => {
        const error = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch({}, { problemKind: 'single', tag: [], knowledgeNodeIds: [] }, {}, context, 'request'),
        );
        expect(error).to.have.property('name', 'ValidationError');
    });

    it('requires a validated knowledge pair to survive every before hook', async () => {
        const patch: Record<string, unknown> = {
            problemKind: 'single',
            tag: ['图论'],
            knowledgeMapId,
            knowledgeNodeIds: ['507f1f77bcf86cd799439011'],
        };
        const required = await canonicalizeStructuredKnowledgePatch({ problemKind: 'single', knowledgeMapId }, patch, {}, context, 'request', {
            requireKnowledgePair: true,
        });
        expect(required).to.equal(true);
        delete patch.tag;
        delete patch.knowledgeMapId;
        delete patch.knowledgeNodeIds;

        const error = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch({ problemKind: 'single', knowledgeMapId }, patch, {}, context, 'after-hook', {
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

    it('requires an atomic tag and node pair after a legacy programming problem is normalized', async () => {
        const converted = { problemKind: 'programming' as const, knowledgeMapId, knowledgeNodeIds: [], tag: ['PAT乙级'] };
        const tagOnly = await captureFailure(() => canonicalizeStructuredKnowledgePatch(converted, { tag: ['forged'] }, {}, context, 'request'));
        const nodesOnly = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch(converted, { knowledgeNodeIds: [] }, {}, context, 'request'),
        );
        expect(tagOnly).to.have.property('name', 'ValidationError');
        expect(nodesOnly).to.have.property('name', 'ValidationError');
        const emptyPair = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch(converted, { tag: ['PAT乙级'], knowledgeMapId, knowledgeNodeIds: [] }, {}, context, 'request'),
        );
        expect(emptyPair).to.have.property('name', 'ValidationError');
    });

    it('allows an empty managed programming draft only at its explicit creation boundary', async () => {
        const patch: any = { tag: [], knowledgeMapId, knowledgeNodeIds: [] };
        const required = await canonicalizeStructuredKnowledgePatch(
            { problemKind: 'programming', authoringMode: 'managed', tag: [] },
            patch,
            {},
            context,
            'request',
            { requireKnowledgePair: true, allowEmptyKnowledgeNodes: true },
        );
        expect(required).to.equal(true);
        expect(patch).to.deep.equal({ tag: [], knowledgeMapId, knowledgeNodeIds: [] });
    });

    it('preserves flat import tags on a map-only programming draft at the trusted creation boundary', async () => {
        const patch: any = { tag: ['legacy import tag'], knowledgeMapId, knowledgeNodeIds: [] };
        const required = await canonicalizeStructuredKnowledgePatch(
            { problemKind: 'programming', tag: ['legacy import tag'] },
            patch,
            {},
            context,
            'after-hook',
            { requireKnowledgePair: true, allowEmptyKnowledgeNodes: true },
        );
        expect(required).to.equal(true);
        expect(patch).to.deep.equal({ tag: ['legacy import tag'], knowledgeMapId, knowledgeNodeIds: [] });
    });

    it('rejects an ordinary canonical write that changes the current map', async () => {
        const otherMapId = new ObjectId('507f1f77bcf86cd799439099');
        const error = await captureFailure(() =>
            canonicalizeStructuredKnowledgePatch(
                { problemKind: 'single', knowledgeMapId, tag: [] },
                { tag: ['图论'], knowledgeMapId: otherMapId, knowledgeNodeIds: [new ObjectId('507f1f77bcf86cd799439011')] },
                {},
                context,
                'request',
            ),
        );
        expect(error).to.have.property('name', 'ValidationError');
    });

    it('allows a trusted raw tag write to remain an unconverted legacy programming problem', async () => {
        const required = await canonicalizeStructuredKnowledgePatch(
            { problemKind: 'programming' },
            { tag: ['external legacy tag'] },
            {},
            context,
            'request',
        );
        expect(required).to.equal(false);
    });
});
