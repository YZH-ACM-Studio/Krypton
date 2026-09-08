import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    knowledgeNodeCompletionCounts,
    problemSetCompletionCount,
    rankCompletionItems,
} from '../src/lib/user-profile-progress';

const root = resolve(__dirname, '..');

describe('user profile completion histograms', () => {
    it('ranks by completed count and drops empty rows', () => {
        expect(
            rankCompletionItems([
                { id: 'b', title: '图论', count: 2 },
                { id: 'a', title: '基础', count: 2 },
                { id: 'c', title: '空', count: 0 },
                { id: 'd', title: '最多', count: 5 },
            ]),
        ).to.deep.equal([
            { id: 'd', title: '最多', count: 5 },
            { id: 'a', title: '基础', count: 2 },
            { id: 'b', title: '图论', count: 2 },
        ]);
    });

    it('counts global AC into a problem set and ignores extra ACs', () => {
        expect(
            problemSetCompletionCount({
                setPids: [1, 2, 2, 3],
                visibleAcPids: new Set([2, 3, 9]),
                integrity: false,
                scopedDonePids: new Set([1]),
            }),
        ).to.equal(2);
    });

    it('uses scoped completions for integrity sets and still hides unseen problems', () => {
        expect(
            problemSetCompletionCount({
                setPids: [1, 2, 3],
                visibleAcPids: new Set([1, 2, 3]),
                integrity: true,
                scopedDonePids: new Set([2]),
            }),
        ).to.equal(1);
        expect(
            problemSetCompletionCount({
                setPids: [1, 2],
                visibleAcPids: new Set([1]),
                integrity: true,
                scopedDonePids: new Set([1, 2]),
            }),
        ).to.equal(1);
    });

    it('counts public knowledge nodes from canonical ids and fails closed on malformed ids', () => {
        expect(
            knowledgeNodeCompletionCounts({
                problems: [
                    { docId: 1, knowledgeNodeIds: ['n-graph', 'n-dp'] },
                    { docId: 2, knowledgeNodeIds: ['n-graph'] },
                    { docId: 3 },
                ],
                publicNodes: [
                    { id: 'n-graph', title: '图论', href: '/mindmap?mapId=m1', subtitle: '算法知识图谱' },
                    { id: 'n-hidden', title: '隐藏' },
                    { id: 'n-dp', title: '动态规划', href: '/mindmap?mapId=m1' },
                ],
            }),
        ).to.deep.equal([
            { id: 'n-graph', title: '图论', count: 2, href: '/mindmap?mapId=m1', subtitle: '算法知识图谱' },
            { id: 'n-dp', title: '动态规划', count: 1, href: '/mindmap?mapId=m1' },
        ]);
        expect(() => knowledgeNodeCompletionCounts({ problems: [{ docId: 8, knowledgeNodeIds: 'n-graph' }], publicNodes: [] })).to.throw(
            /invalid knowledgeNodeIds/,
        );
    });

    it('wires the user page to problem-set and knowledge-node completions', () => {
        const source = readFileSync(resolve(root, 'src/handler/user.ts'), 'utf8');
        expect(source).to.include("from '../lib/user-profile-progress'");
        expect(source).to.include('problemSetCompletionCount');
        expect(source).to.include('knowledgeNodeCompletionCounts');
        expect(source).to.include('practiceIntegrityService.listLatestPublished');
        expect(source).to.include('contextualCompletionService.getCompletedByScope(');
        expect(source).to.include("'knowledgeNodeIds'");
        expect(source).to.match(/subtitle:\s*maps\.length > 1/);
        expect(source).not.to.match(/title:\s*maps\.length > 1 && mapTitle \?/);
    });
});
