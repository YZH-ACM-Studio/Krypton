// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeMindmapLayout, NODE_HEIGHT, NODE_WIDTH, resolveRootBranchSides, sortMindmapNodes, visibleSubset } from '../src/pages/mindmap/layout';
import { childrenByParent, flattenMindmapTree, mergeMindmapTagDraft, nodePath, planDrop, siblingIndex } from '../src/pages/mindmap/tree';
import type { MindmapNode } from '../src/pages/mindmap/types.ts';

const version = '2026-07-16T00:00:00.000Z';

function makeNode(id: string, parentId: string | null, order: number, extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    _id: id,
    mapId: 'map-a',
    parentId,
    topic: id,
    tags: [],
    problemIds: [],
    order,
    createdAt: version,
    updatedAt: version,
    ...extra,
  };
}

describe('sortMindmapNodes', () => {
  it('sorts by order then id without mutating the input array', () => {
    const input = [makeNode('b', null, 10), makeNode('a', null, 10), makeNode('c', null, 5)];
    const sorted = sortMindmapNodes(input);
    expect(sorted.map((node) => node._id)).to.deep.equal(['c', 'a', 'b']);
    expect(input.map((node) => node._id)).to.deep.equal(['b', 'a', 'c']);
  });
});

describe('resolveRootBranchSides', () => {
  it('returns an empty map for a childless root and ignores unrelated nodes', () => {
    const nodes = [makeNode('root', null, 0), makeNode('other', 'elsewhere', 0)];
    expect(resolveRootBranchSides(nodes, 'root').size).to.equal(0);
  });

  it('keeps explicit sides even when the split is unbalanced', () => {
    const nodes = [
      makeNode('root', null, 0),
      makeNode('a', 'root', 10, { layoutSide: 'right' }),
      makeNode('b', 'root', 20, { layoutSide: 'right' }),
      makeNode('c', 'root', 30, { layoutSide: 'right' }),
    ];
    expect(Object.fromEntries(resolveRootBranchSides(nodes, 'root'))).to.deep.equal({ a: 'right', b: 'right', c: 'right' });
  });
});

describe('visibleSubset', () => {
  const nodes = [
    makeNode('root', null, 0),
    makeNode('a', 'root', 10),
    makeNode('a1', 'a', 10),
    makeNode('a1x', 'a1', 10),
    makeNode('b', 'root', 20),
  ];

  it('hides all descendants of a collapsed node but keeps the node itself', () => {
    const { visible, children } = visibleSubset(nodes, new Set(['a']));
    expect(visible.map((node) => node._id)).to.deep.equal(['root', 'a', 'b']);
    expect(children.a).to.deep.equal(['a1']);
    expect(children.a1).to.deep.equal(['a1x']);
  });

  it('collapses transitively when an inner node is collapsed', () => {
    const { visible } = visibleSubset(nodes, new Set(['a1']));
    expect(visible.map((node) => node._id)).to.deep.equal(['root', 'a', 'a1', 'b']);
  });

  it('ignores unknown collapsed ids and lists children in order-sorted sequence', () => {
    const shuffled = [nodes[4], nodes[1], nodes[0], nodes[3], nodes[2]];
    const { visible, children } = visibleSubset(shuffled, new Set(['ghost']));
    expect(visible.map((node) => node._id)).to.deep.equal(['b', 'a', 'root', 'a1x', 'a1']);
    expect(children.root).to.deep.equal(['a', 'b']);
  });
});

describe('computeMindmapLayout', () => {
  it('returns an empty layout for empty input or a missing root id', async () => {
    expect(await computeMindmapLayout([], 'root')).to.deep.equal({ nodes: [], edges: [] });
    expect(await computeMindmapLayout([makeNode('root', null, 0)], null)).to.deep.equal({ nodes: [], edges: [] });
  });

  it('renders a lone root at the origin with root metadata and no edges', async () => {
    const { nodes, edges } = await computeMindmapLayout([makeNode('root', null, 0)], 'root');
    expect(edges).to.deep.equal([]);
    expect(nodes).to.have.lengthOf(1);
    expect(nodes[0].position).to.deep.equal({ x: 0, y: 0 });
    expect(nodes[0].type).to.equal('mindmap');
    expect(nodes[0].style).to.deep.equal({ width: NODE_WIDTH, height: NODE_HEIGHT });
    expect(nodes[0].data.isRoot).to.equal(true);
    expect(nodes[0].data.side).to.equal('root');
    expect(nodes[0].data.hasChildren).to.equal(false);
  });

  it('places left branches at negative x and right branches at positive x around the root', async () => {
    const raw = [
      makeNode('root', null, 0),
      makeNode('l', 'root', 10, { layoutSide: 'left' }),
      makeNode('r', 'root', 20, { layoutSide: 'right' }),
    ];
    const { nodes, edges } = await computeMindmapLayout(raw, 'root');
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.get('root')!.position).to.deep.equal({ x: 0, y: 0 });
    expect(byId.get('l')!.position.x).to.be.lessThan(0);
    expect(byId.get('r')!.position.x).to.be.greaterThan(0);
    expect(byId.get('l')!.data.side).to.equal('left');
    expect(byId.get('r')!.data.side).to.equal('right');

    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    expect(edgeById.get('e-root-l')).to.include({ source: 'root', target: 'l', sourceHandle: 'src-left', targetHandle: 'tgt-right' });
    expect(edgeById.get('e-root-r')).to.include({ source: 'root', target: 'r', sourceHandle: 'src-right', targetHandle: 'tgt-left' });
  });

  it('drops collapsed descendants and their edges while flagging the collapsed node', async () => {
    const raw = [
      makeNode('root', null, 0),
      makeNode('a', 'root', 10, { layoutSide: 'right' }),
      makeNode('a1', 'a', 10),
      makeNode('b', 'root', 20, { layoutSide: 'left' }),
    ];
    const { nodes, edges } = await computeMindmapLayout(raw, 'root', new Set(['a']));
    expect(nodes.map((node) => node.id).sort()).to.deep.equal(['a', 'b', 'root']);
    expect(edges.map((edge) => edge.id).sort()).to.deep.equal(['e-root-a', 'e-root-b']);
    const a = nodes.find((node) => node.id === 'a')!;
    expect(a.data.collapsed).to.equal(true);
    expect(a.data.hasChildren).to.equal(true);
    expect(a.data.isRoot).to.equal(false);
  });
});

describe('mergeMindmapTagDraft', () => {
  it('returns deduplicated existing tags when the draft is empty', () => {
    expect(mergeMindmapTagDraft(['图论', '图论'], '')).to.deep.equal(['图论']);
    expect(mergeMindmapTagDraft([], ' , ,, ')).to.deep.equal([]);
  });

  it('keeps first-seen order across tags and draft entries', () => {
    expect(mergeMindmapTagDraft(['x'], 'y, x , z,y')).to.deep.equal(['x', 'y', 'z']);
  });
});

describe('childrenByParent', () => {
  it('groups roots under the null key and order-sorts every sibling list', () => {
    const nodes = [makeNode('b', 'root', 20), makeNode('root', null, 0), makeNode('a', 'root', 10)];
    const grouped = childrenByParent(nodes);
    expect(grouped.get(null)!.map((node) => node._id)).to.deep.equal(['root']);
    expect(grouped.get('root')!.map((node) => node._id)).to.deep.equal(['a', 'b']);
    expect(grouped.get('missing')).to.equal(undefined);
  });
});

describe('flattenMindmapTree', () => {
  const nodes = [
    makeNode('root', null, 0),
    makeNode('a', 'root', 10, { description: '包含 Graph 描述' }),
    makeNode('a1', 'a', 10),
    makeNode('b', 'root', 20),
  ];

  it('returns nothing without a root id or with an unknown root id', () => {
    expect(flattenMindmapTree(nodes, null, new Set(['root']))).to.deep.equal([]);
    expect(flattenMindmapTree(nodes, 'ghost', new Set(['root']))).to.deep.equal([]);
  });

  it('only descends into expanded nodes and reports depth and child flags', () => {
    expect(flattenMindmapTree(nodes, 'root', new Set()).map((entry) => entry.node._id)).to.deep.equal(['root']);
    const expanded = flattenMindmapTree(nodes, 'root', new Set(['root']));
    expect(expanded.map((entry) => [entry.node._id, entry.depth, entry.hasChildren])).to.deep.equal([
      ['root', 0, true],
      ['a', 1, true],
      ['b', 1, false],
    ]);
  });

  it('matches queries case-insensitively against descriptions and prunes non-matching children', () => {
    const hits = flattenMindmapTree(nodes, 'root', new Set(['root', 'a']), 'graph');
    expect(hits.map((entry) => entry.node._id)).to.deep.equal(['root', 'a']);
  });

  it('returns nothing when the query matches no node', () => {
    expect(flattenMindmapTree(nodes, 'root', new Set(['root', 'a']), '不存在的词')).to.deep.equal([]);
  });

  it('survives a parent cycle instead of recursing forever', () => {
    const cyclic = [makeNode('root', 'a', 0), makeNode('a', 'root', 10)];
    const flat = flattenMindmapTree(cyclic, 'root', new Set(['root', 'a']));
    expect(flat.map((entry) => entry.node._id)).to.deep.equal(['root', 'a']);
  });
});

describe('nodePath', () => {
  const nodes = [makeNode('root', null, 0), makeNode('a', 'root', 10), makeNode('a1', 'a', 10)];

  it('walks from the root down to the requested node', () => {
    expect(nodePath(nodes, 'a1').map((node) => node._id)).to.deep.equal(['root', 'a', 'a1']);
    expect(nodePath(nodes, 'root').map((node) => node._id)).to.deep.equal(['root']);
  });

  it('returns an empty path for unknown ids and stops on parent cycles', () => {
    expect(nodePath(nodes, 'ghost')).to.deep.equal([]);
    const cyclic = [makeNode('root', 'a', 0), makeNode('a', 'root', 10)];
    expect(nodePath(cyclic, 'a').map((node) => node._id)).to.deep.equal(['root', 'a']);
  });
});

describe('siblingIndex', () => {
  it('ranks by the order field rather than array position', () => {
    const late = makeNode('late', 'root', 30);
    const nodes = [makeNode('root', null, 0), late, makeNode('early', 'root', 10)];
    expect(siblingIndex(nodes, late)).to.equal(1);
    expect(siblingIndex(nodes, nodes[2])).to.equal(0);
  });
});

describe('planDrop', () => {
  const nodes = [
    makeNode('root', null, 0),
    makeNode('a', 'root', 10),
    makeNode('b', 'root', 20),
    makeNode('c', 'root', 30),
    makeNode('a1', 'a', 10),
    makeNode('a2', 'a', 20),
  ];

  it('rejects unknown participants, self drops, and reordering around the root', () => {
    expect(planDrop(nodes, 'ghost', 'a', 'before')).to.equal(null);
    expect(planDrop(nodes, 'a', 'ghost', 'before')).to.equal(null);
    expect(planDrop(nodes, 'a', 'a', 'inside')).to.equal(null);
    expect(planDrop(nodes, 'a', 'root', 'before')).to.equal(null);
    expect(planDrop(nodes, 'a', 'root', 'after')).to.equal(null);
  });

  it('appends after the remaining children when dropping inside the current parent', () => {
    expect(planDrop(nodes, 'a1', 'a', 'inside')).to.deep.equal({ newParentId: 'a', targetIndex: 1 });
  });

  it('computes sibling indexes with the dragged node removed from the list', () => {
    expect(planDrop(nodes, 'a', 'c', 'before')).to.deep.equal({ newParentId: 'root', targetIndex: 1 });
    expect(planDrop(nodes, 'c', 'a', 'after')).to.deep.equal({ newParentId: 'root', targetIndex: 1 });
    expect(planDrop(nodes, 'a', 'b', 'after')).to.deep.equal({ newParentId: 'root', targetIndex: 1 });
  });
});
