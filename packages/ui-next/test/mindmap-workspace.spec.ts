import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { MindmapNode } from '../src/pages/mindmap/types.ts';

const require = createRequire(import.meta.url);
const { mindmapProblemHref, MindmapApiError, mutateMindmap } = require('../src/pages/mindmap/api.ts') as typeof import('../src/pages/mindmap/api');
const { computeMindmapLayout, resolveRootBranchSides } = require('../src/pages/mindmap/layout.ts') as typeof import('../src/pages/mindmap/layout');
const { flattenMindmapTree, planDrop } = require('../src/pages/mindmap/tree.ts') as typeof import('../src/pages/mindmap/tree');

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const version = '2026-07-16T00:00:00.000Z';

function read(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

function makeNode(id: string, parentId: string | null, order: number, extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    _id: id,
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

describe('P2.16 mindmap workspace contracts', () => {
  it('keeps the public page read-only and registers a separate administrator template', () => {
    const publicPage = read('packages/ui-next/src/pages/mindmap/index.tsx');
    const adminPage = read('packages/ui-next/src/pages/mindmap/admin.tsx');
    const canvas = read('packages/ui-next/src/pages/mindmap/canvas.tsx');
    const resolver = read('packages/ui-next/src/pages/resolver.tsx');
    const sidebar = read('packages/ui-next/src/components/layout/sidebar.tsx');
    const combined = [
      publicPage,
      adminPage,
      read('packages/ui-next/src/pages/mindmap/inspector.tsx'),
      read('packages/ui-next/src/pages/mindmap/outline.tsx'),
    ].join('\n');

    expect(publicPage).not.to.include('canEdit');
    expect(publicPage).not.to.include('编辑模式');
    expect(canvas).to.include('nodesDraggable={false}');
    expect(adminPage).to.include('<MindmapOutline');
    expect(adminPage).to.include('<MindmapCanvas');
    expect(adminPage).to.include('<MindmapInspector');
    expect(adminPage).to.include("type MobilePane = 'outline' | 'preview' | 'inspector'");
    const workspaceMatch = adminPage.match(/<ReactFlowProvider>\s*<div className="([^"]+)"/);
    expect(workspaceMatch, 'mindmap admin workspace root').not.to.equal(null);
    const workspaceClasses = workspaceMatch![1].split(/\s+/);
    const utilityName = (value: string) => value.split(':').at(-1) || value;
    expect(workspaceClasses.some((value) => utilityName(value).startsWith('rounded'))).to.equal(false);
    expect(workspaceClasses.some((value) => utilityName(value).startsWith('border'))).to.equal(false);
    expect(workspaceClasses.some((value) => utilityName(value).startsWith('shadow'))).to.equal(false);
    expect(workspaceClasses).to.include.members([
      'flex',
      'h-[calc(100dvh-5.75rem)]',
      'min-h-[38rem]',
      'w-full',
      'min-w-0',
      'flex-col',
      'overflow-hidden',
      'bg-background',
    ]);
    expect(resolver).to.include("'admin_mindmap.html': AdminMindmapPage");
    expect(sidebar).to.include("href: '/admin/mindmap'");
    expect(combined).not.to.match(/\b(?:prompt|confirm|alert)\s*\(/);
    expect(combined).not.to.match(/localStorage|autosave|undo/i);
  });

  it('derives stable root sides solely from explicit sides and sibling order', () => {
    const nodes = [
      makeNode('root', null, 0),
      makeNode('a', 'root', 10, { layoutSide: 'right' }),
      makeNode('b', 'root', 20),
      makeNode('c', 'root', 30, { layoutSide: 'left' }),
      makeNode('d', 'root', 40),
    ];

    expect(Object.fromEntries(resolveRootBranchSides(nodes, 'root'))).to.deep.equal({ a: 'right', c: 'left', b: 'left', d: 'right' });
    expect(Object.fromEntries(resolveRootBranchSides(nodes.slice().reverse(), 'root'))).to.deep.equal({
      a: 'right',
      c: 'left',
      b: 'left',
      d: 'right',
    });
  });

  it('keeps search ancestors visible and plans order/reparent drops without accepting arbitrary order values', () => {
    const nodes = [
      makeNode('root', null, 0),
      makeNode('a', 'root', 10),
      makeNode('b', 'root', 20),
      makeNode('a1', 'a', 10, { topic: '目标知识点', tags: ['graph'] }),
      makeNode('a2', 'a', 20),
    ];

    expect(flattenMindmapTree(nodes, 'root', new Set(), '目标').map((entry) => entry.node._id)).to.deep.equal(['root', 'a', 'a1']);
    expect(planDrop(nodes, 'a2', 'b', 'inside')).to.deep.equal({ newParentId: 'b', targetIndex: 0 });
    expect(planDrop(nodes, 'b', 'a', 'before')).to.deep.equal({ newParentId: 'root', targetIndex: 0 });
    expect(planDrop(nodes, 'a', 'b', 'after')).to.deep.equal({ newParentId: 'root', targetIndex: 1 });
  });

  it('lays out a production-shaped 273-node tree deterministically while ignoring absolute position fields', async () => {
    const nodes: MindmapNode[] = [makeNode('root', null, 0)];
    for (let branch = 0; branch < 8; branch += 1) {
      const branchId = `branch-${branch}`;
      nodes.push(makeNode(branchId, 'root', branch));
      for (let group = 0; group < 8; group += 1) {
        const groupId = `${branchId}-group-${group}`;
        nodes.push(makeNode(groupId, branchId, group));
        const leaves = group === 0 ? 4 : 3;
        for (let leaf = 0; leaf < leaves; leaf += 1) nodes.push(makeNode(`${groupId}-leaf-${leaf}`, groupId, leaf));
      }
    }
    expect(nodes).to.have.lengthOf(273);
    for (const [index, node] of nodes.entries()) {
      (node as MindmapNode & { position?: { x: number; y: number } }).position = { x: index * 100, y: -index };
    }

    const first = await computeMindmapLayout(nodes, 'root');
    for (const node of nodes) {
      (node as MindmapNode & { position?: { x: number; y: number } }).position = { x: -999, y: 999 };
    }
    const second = await computeMindmapLayout(nodes, 'root');
    const compact = (layout: typeof first) => layout.nodes.map((node) => ({ id: node.id, position: node.position }));

    expect(first.nodes).to.have.lengthOf(273);
    expect(compact(second)).to.deep.equal(compact(first));
  });

  it('builds domain-aware problem links for global reference errors', () => {
    expect(mindmapProblemHref({ domainId: 'system', pid: 'P1000' })).to.equal('/p/P1000');
    expect(mindmapProblemHref({ domainId: 'course a', pid: 'A/1' })).to.equal('/d/course%20a/p/A%2F1');
  });

  it('keeps a server conflict explicit and preserves its affected-problem details', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            params: [
              '移动会改变继承标签',
              { reason: 'inherited-tags-change', problems: [{ domainId: 'course-a', docId: 7, pid: 'C7', title: '受影响题目', hidden: true }] },
            ],
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    try {
      let failure: unknown;
      try {
        await mutateMindmap('move', {});
      } catch (error) {
        failure = error;
      }
      expect(failure).to.be.instanceOf(MindmapApiError);
      expect((failure as InstanceType<typeof MindmapApiError>).status).to.equal(409);
      expect((failure as InstanceType<typeof MindmapApiError>).details).to.deep.equal({
        reason: 'inherited-tags-change',
        problems: [{ domainId: 'course-a', docId: 7, pid: 'C7', title: '受影响题目', hidden: true }],
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
