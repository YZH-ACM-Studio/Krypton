import { expect } from 'chai';
import { describe, it } from 'node:test';
import { resolveProblemKnowledgeNodeIds } from '../src/lib/problem-tag-canonical';

describe('canonical problem knowledge-node storage', () => {
    it('uses the top-level selection for ordinary and converted problems', () => {
        expect(resolveProblemKnowledgeNodeIds({ knowledgeNodeIds: ['node-1', 'node-2'] })).to.deep.equal(['node-1', 'node-2']);
    });

    it('reads a legacy managed selection from managedAuthoring', () => {
        expect(
            resolveProblemKnowledgeNodeIds({
                authoringMode: 'managed',
                managedAuthoring: { selectedMindmapNodeIds: ['node-1', 'node-2'] },
            }),
        ).to.deep.equal(['node-1', 'node-2']);
    });

    it('accepts redundant managed copies only when they contain the same nodes', () => {
        expect(
            resolveProblemKnowledgeNodeIds({
                authoringMode: 'managed',
                knowledgeNodeIds: ['node-2', 'node-1'],
                managedAuthoring: { selectedMindmapNodeIds: ['node-1', 'node-2'] },
            }),
        ).to.deep.equal(['node-1', 'node-2']);

        expect(() =>
            resolveProblemKnowledgeNodeIds({
                authoringMode: 'managed',
                knowledgeNodeIds: ['node-1'],
                managedAuthoring: { selectedMindmapNodeIds: ['node-2'] },
            }),
        ).to.throw(TypeError, /conflicting managed knowledge-node selections/);
    });

    it('fails closed for a managed top-level-only selection and malformed storage', () => {
        expect(() => resolveProblemKnowledgeNodeIds({ authoringMode: 'managed', knowledgeNodeIds: ['node-1'] })).to.throw(
            TypeError,
            /conflicting managed knowledge-node selections/,
        );
        expect(() => resolveProblemKnowledgeNodeIds({ knowledgeNodeIds: ['node-1', 'node-1'] })).to.throw(TypeError, /duplicates/);
        expect(() => resolveProblemKnowledgeNodeIds({ knowledgeNodeIds: 'node-1' })).to.throw(TypeError, /must be an array/);
    });
});
