import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { MindmapApiError, mindmapProblemHref, mutateMindmap } from '../src/pages/mindmap/api';
import { AdminMindmapPage } from '../src/pages/mindmap/admin.tsx';
import { computeMindmapLayout, resolveRootBranchSides } from '../src/pages/mindmap/layout';
import { flattenMindmapTree, mergeMindmapTagDraft, planDrop } from '../src/pages/mindmap/tree';
import type { MindmapNode } from '../src/pages/mindmap/types.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const version = '2026-07-16T00:00:00.000Z';

function read(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

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

describe('p2.16 and P2.28 mindmap workspace contracts', () => {
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
    expect(publicPage).to.include('ariaLabel="切换知识导图"');
    expect(publicPage).to.include('/mindmap?map=');
    expect(publicPage).to.include('side="bottom"');
    expect(publicPage).to.include('<Sheet');
    expect(canvas).to.include('nodesDraggable={false}');
    expect(adminPage.includes('staleMapId')).to.equal(false);
    expect(adminPage.includes('当前链接里的导图已不可用')).to.equal(false);
    expect(adminPage.includes('新建导图')).to.equal(false);
    expect(adminPage.includes('设为默认')).to.equal(false);
    expect(adminPage.includes('删除整张导图')).to.equal(false);
    expect(adminPage.includes('ariaLabel="切换知识导图"')).to.equal(false);
    expect(adminPage).to.include('<MindmapOutline');
    expect(adminPage).to.include('<MindmapCanvas');
    expect(adminPage).to.include('<MindmapInspector');
    expect(adminPage).to.include('mutateKnowledgeMap');
    expect(adminPage).to.include('expectedMapUpdatedAt: config.updatedAt');
    expect(adminPage).to.include("type MobilePane = 'outline' | 'preview' | 'inspector'");
    expect(adminPage).to.include("setMobilePane('inspector')");
    for (const panel of ['outline', 'preview', 'inspector']) {
      expect(adminPage).to.include(`data-mindmap-panel="${panel}"`);
    }
    expect(adminPage).to.include('data-mindmap-canvas');
    expect(adminPage).to.include('aria-label="导图管理工作区"');
    const inspector = read('packages/ui-next/src/pages/mindmap/inspector.tsx');
    expect(inspector).to.include('createPortal');
    expect(inspector).to.include('data-mindmap-problem-search="results"');
    expect(adminPage).to.include('<MiniTabs');
    expect(canvas).to.match(/aria-label=\{data\.collapsed/);

    expect(resolver).to.include("'admin_mindmap.html': AdminMindmapPage");
    const handler = read('packages/krypton-mindmap/src/handler.ts');
    expect(handler).to.include('staleMapId');
    expect(handler).not.to.include('if (requested && !config) throw new NotFoundError');
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

  it('treats uncommitted tag input as an effective value that map switching must protect', () => {
    expect(mergeMindmapTagDraft(['图论'], ' 最短路, 图论 ')).to.deep.equal(['图论', '最短路']);
    const inspector = read('packages/ui-next/src/pages/mindmap/inspector.tsx');
    expect(inspector).to.include('!sameStrings(effectiveTags, node.tags)');
    expect(inspector).to.include('{ tags: effectiveTags }');
  });

  it('keeps the production-shaped 274-node layout stable after adding map scope and ignores absolute positions', async () => {
    const nodes: MindmapNode[] = [makeNode('root', null, 0)];
    for (let branch = 0; branch < 8; branch += 1) {
      const branchId = `branch-${branch}`;
      nodes.push(makeNode(branchId, 'root', branch));
      for (let group = 0; group < 8; group += 1) {
        const groupId = `${branchId}-group-${group}`;
        nodes.push(makeNode(groupId, branchId, group));
        const leaves = group === 0 ? (branch === 0 ? 5 : 4) : 3;
        for (let leaf = 0; leaf < leaves; leaf += 1) nodes.push(makeNode(`${groupId}-leaf-${leaf}`, groupId, leaf));
      }
    }
    expect(nodes).to.have.lengthOf(274);
    for (const [index, node] of nodes.entries()) {
      (node as MindmapNode & { position?: { x: number; y: number } }).position = { x: index * 100, y: -index };
    }

    const first = await computeMindmapLayout(nodes, 'root');
    for (const node of nodes) {
      (node as MindmapNode & { position?: { x: number; y: number } }).position = { x: -999, y: 999 };
      node.mapId = 'map-b';
    }
    const second = await computeMindmapLayout(nodes, 'root');
    const compact = (layout: typeof first) => layout.nodes.map((node) => ({ id: node.id, position: node.position }));

    expect(first.nodes).to.have.lengthOf(274);
    expect(compact(second)).to.deep.equal(compact(first));
  });

  it('preserves the established RIGHT layout and renders DOWN maps as a vertical tree', async () => {
    const nodes = [
      makeNode('root', null, 0),
      makeNode('left', 'root', 10, { layoutSide: 'left' }),
      makeNode('right', 'root', 20, { layoutSide: 'right' }),
      makeNode('leaf', 'left', 10),
    ];

    const established = await computeMindmapLayout(nodes, 'root');
    const explicitRight = await computeMindmapLayout(nodes, 'root', new Set(), 'RIGHT');
    expect(explicitRight).to.deep.equal(established);

    const down = await computeMindmapLayout(nodes, 'root', new Set(), 'DOWN');
    const positions = new Map(down.nodes.map((node) => [node.id, node.position]));
    expect(positions.get('left')!.y).to.be.greaterThan(positions.get('root')!.y);
    expect(positions.get('right')!.y).to.be.greaterThan(positions.get('root')!.y);
    expect(positions.get('leaf')!.y).to.be.greaterThan(positions.get('left')!.y);
    expect(positions.get('left')!.x).not.to.equal(positions.get('right')!.x);
    expect(down.edges.every((edge) => edge.sourceHandle === 'src-bottom' && edge.targetHandle === 'tgt-top')).to.equal(true);

    const inspector = read('packages/ui-next/src/pages/mindmap/inspector.tsx');
    expect(inspector).to.include("layoutDirection === 'RIGHT' && isRootBranch");
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
            name: 'MindmapConflictError',
            errorCode: 'MindmapConflictError',
            code: 409,
            status: 409,
            params: [
              '移动会改变继承标签',
              { reason: 'inherited-tags-change', problems: [{ domainId: 'course-a', docId: 7, pid: 'C7', title: '受影响题目', hidden: true }] },
            ],
            message: '移动会改变继承标签。',
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
      expect((failure as InstanceType<typeof MindmapApiError>).message).to.equal('移动会改变继承标签。');
      expect((failure as InstanceType<typeof MindmapApiError>).details).to.deep.equal({
        reason: 'inherited-tags-change',
        problems: [{ domainId: 'course-a', docId: 7, pid: 'C7', title: '受影响题目', hidden: true }],
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('posts the map id and nested title fields when saving settings', async () => {
    const previousFetch = globalThis.fetch;
    const page = {
      nodes: [
        {
          _id: 'root',
          mapId: 'map-merged',
          parentId: null,
          topic: '知识图谱',
          tags: [],
          problemIds: [],
          order: 0,
          createdAt: version,
          updatedAt: version,
        },
      ],
      config: {
        _id: 'map-merged',
        title: '知识图谱',
        rootNodeId: 'root',
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: version,
        updatedAt: version,
      },
      referenceCounts: {},
    };
    const requests: Array<{ url: string; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body || '');
      if (init?.method === 'POST') requests.push({ url, body });
      const saved = {
        ...page,
        config: { ...page.config, title: '知识图谱修订', layoutDirection: 'RIGHT' },
      };
      const payload = url.includes('node-problems') ? { problems: [] } : saved;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const bootstrap: KryptonBootstrap = {
      appName: 'Krypton',
      siteName: 'Krypton OJ',
      locale: 'zh_CN',
      theme: 'light',
      generatedAt: version,
      user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
      domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
      urls: { home: '/' } as KryptonBootstrap['urls'],
      udict: {},
      page: { templateName: 'admin_mindmap.html', data: page },
    };
    try {
      const user = userEvent.setup();
      render(createElement(BootstrapProvider, { bootstrap }, createElement(AdminMindmapPage)));
      await user.type(screen.getByRole('textbox', { name: '导图名称' }), '修订');
      await waitFor(() => {
        const save = screen.getByRole('button', { name: '保存设置' });
        if (!(save instanceof HTMLButtonElement)) throw new Error('save settings is not a button');
        expect(save.disabled).to.equal(false);
      });
      await user.click(screen.getByRole('button', { name: '保存设置' }));
      await waitFor(() => {
        expect(requests.length).to.equal(1);
      });
      const request = requests[0];
      if (!request) throw new Error('missing map settings request');
      expect(new URL(request.url, 'http://localhost').pathname).to.equal('/admin/mindmap/maps');
      const form = new URLSearchParams(request.body);
      expect(form.get('operation')).to.equal('update');
      expect(JSON.parse(form.get('payload') || '{}')).to.deep.equal({
        id: 'map-merged',
        expectedUpdatedAt: version,
        fields: { title: '知识图谱修订', layoutDirection: 'RIGHT' },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('describes course nodes instead of multiple maps', () => {
    const adminPage = read('packages/ui-next/src/pages/mindmap/admin.tsx');
    const inspector = read('packages/ui-next/src/pages/mindmap/inspector.tsx');
    const api = read('packages/ui-next/src/pages/mindmap/api.ts');
    const types = read('packages/ui-next/src/pages/mindmap/types.ts');
    const ui = [adminPage, inspector, api].join('\n');

    expect(ui.includes('/admin/mindmap/course-nodes')).to.equal(true);
    expect(types.includes('courseVisibility')).to.equal(true);
    expect(types.includes('ownerUids')).to.equal(true);
    expect(types.includes('coursePins')).to.equal(false);
    expect(types.includes('isDefault')).to.equal(false);
    expect(ui.includes('对学生公开')).to.equal(true);
    expect(ui.includes('负责教师可以编辑这门课下面的知识点，不能改课程节点本身')).to.equal(true);
    expect(ui.includes('收录题：把不是挂在这个知识点上的题也算进来')).to.equal(true);
  });
});
