import { expect } from 'chai';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import {
  ManagedKnowledgeSuggestionField,
  ManagedPublishProtocolFields,
  ManagedProgrammingAuthorControl,
  ManagedProgrammingTrainingControl,
  ManagedReviewPanel,
} from '../src/components/managed-programming-authority.tsx';
import { ProblemCreateHubView } from '../src/pages/problem-create-hub.tsx';
import { ProblemCreationActions } from '../src/components/problem-creation-actions.tsx';
import { DomainPermissionCopy } from '../src/components/domain-permission-copy.tsx';
import { ProblemMineCreateAction } from '../src/components/problem-mine-create-action.tsx';

function renderManagedCreationBootstrap(bootstrap: { canAssignManagedAuthor: boolean; canAssignManagedTraining: boolean }) {
  return renderToStaticMarkup(
    <form>
      <ManagedProgrammingAuthorControl allowed={bootstrap.canAssignManagedAuthor}>
        <label>
          代指定出题人
          <input name="authorUid" value="77" readOnly />
        </label>
      </ManagedProgrammingAuthorControl>
      <label>
        算法知识点
        <input name="mindmapNodeIds" value="node-1" readOnly />
      </label>
      <ManagedProgrammingTrainingControl allowed={bootstrap.canAssignManagedTraining}>
        <label>
          待挂训练
          <input name="trainingId" value="training-1" readOnly />
        </label>
      </ManagedProgrammingTrainingControl>
    </form>,
  );
}

describe('managed programming creation authority UI', () => {
  it('renders the localized permission name and its concrete capability boundary', () => {
    const markup = renderToStaticMarkup(
      <DomainPermissionCopy name="仅创建本人托管编程题草稿" detail="仅可创建本人名下的隐藏自命题托管编程题草稿，不能导入、代指定出题人或发布。" />,
    );
    expect(markup).to.include('仅创建本人托管编程题草稿');
    expect(markup).to.include('不能导入、代指定出题人或发布');
    expect(markup).not.to.include('Create managed programming drafts');
  });

  it('serializes the complete revision-bound managed publication protocol', () => {
    const markup = renderToStaticMarkup(<ManagedPublishProtocolFields docId={7} expectedStructureRevision={9} />);
    expect(markup).to.include('name="operation" value="managedPublish"');
    expect(markup).to.include('name="pid" value="7"');
    expect(markup).to.include('name="expectedStructureRevision" value="9"');
    expect(() => renderToStaticMarkup(<ManagedPublishProtocolFields docId={7} expectedStructureRevision={0} />)).to.throw(
      'Managed publication requires an exact structure revision',
    );
  });

  it('renders only the server-authorized managed programming route for a trusted creator', () => {
    const markup = renderToStaticMarkup(
      createElement(ProblemCreateHubView, {
        problemKinds: [{ kind: 'programming', slug: 'programming' }],
      }),
    );
    expect(markup).to.include('编程题');
    expect(markup).to.include('href="/problem/create/programming"');
    expect(markup).not.to.include('单选题');
    expect(markup).not.to.include('主观题');
  });

  it('renders every route explicitly authorized by the administrator bootstrap', () => {
    const markup = renderToStaticMarkup(
      createElement(ProblemCreateHubView, {
        problemKinds: [
          { kind: 'programming', slug: 'programming' },
          { kind: 'single', slug: 'single' },
          { kind: 'function', slug: 'function' },
        ],
      }),
    );
    expect(markup).to.include('编程题');
    expect(markup).to.include('单选题');
    expect(markup).to.include('代码实现题');
  });

  it('fails visibly when the server route mapping is inconsistent', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ProblemCreateHubView, {
          problemKinds: [{ kind: 'programming', slug: 'legacy-programming' }],
        }),
      ),
    ).to.throw('Problem kind route mapping mismatch');
  });

  it('renders delegated author and training controls only for the administrator bootstrap', () => {
    const administrator = renderManagedCreationBootstrap({ canAssignManagedAuthor: true, canAssignManagedTraining: true });
    expect(administrator).to.include('name="authorUid"');
    expect(administrator).to.include('name="trainingId"');
    expect(administrator).to.include('name="mindmapNodeIds"');

    const trustedCreator = renderManagedCreationBootstrap({ canAssignManagedAuthor: false, canAssignManagedTraining: false });
    expect(trustedCreator).not.to.include('name="authorUid"');
    expect(trustedCreator).not.to.include('name="trainingId"');
    expect(trustedCreator).to.include('name="mindmapNodeIds"');
  });

  it('submits managed knowledge suggestions only for an editable draft', () => {
    const editable = renderToStaticMarkup(
      <ManagedKnowledgeSuggestionField editable metadataDraft selectedNodeIds={['node-1', 'node-2']}>
        <span>节点选择器</span>
      </ManagedKnowledgeSuggestionField>,
    );
    expect(editable.match(/name="knowledgeNodeIds"/g)).to.have.lengthOf(1);
    expect(editable).to.include('value="node-1,node-2"');
    expect(editable).to.include('正式标签仍只在管理员发布时派生');

    const emptySuggestion = renderToStaticMarkup(
      <ManagedKnowledgeSuggestionField editable metadataDraft selectedNodeIds={[]}>
        <span>节点选择器</span>
      </ManagedKnowledgeSuggestionField>,
    );
    expect(emptySuggestion).to.include('name="knowledgeNodeIds"');
    expect(emptySuggestion).to.include('value=""');

    const readOnly = renderToStaticMarkup(
      <ManagedKnowledgeSuggestionField editable={false} metadataDraft selectedNodeIds={['node-1']}>
        <span>节点选择器</span>
      </ManagedKnowledgeSuggestionField>,
    );
    expect(readOnly).not.to.include('name="knowledgeNodeIds"');
    expect(readOnly).to.include('当前角色只能查看');
  });

  it('renders the administrator publish form with the exact reviewed revision', () => {
    const markup = renderToStaticMarkup(
      <ManagedReviewPanel
        pdoc={{
          docId: 7,
          pid: 'P3107',
          hidden: true,
          title: '工作标题',
          difficulty: 4,
          structureRevision: 9,
          tag: ['stale-tag'],
          sourceMeta: { template: 'self', year: 2026 },
          managedAuthoring: { workingTitle: '工作标题', metadataStatus: 'draft' },
        }}
        sourceTemplates={[{ id: 'self', label: '自命题', fields: ['year'] }]}
        trainingOptions={[]}
        problemsUrl="/d/system/p"
        difficultyOptions={[{ value: 4, label: '普及+/提高' }]}
        reviewPreview={{
          state: 'ready',
          structureRevision: 9,
          tags: ['自命题', '算法'],
          selectedMindmapNodeIds: ['node-1'],
        }}
        pendingContributions={[{ uid: 88, scope: 'data' }]}
        pendingContributionFingerprint="pending-fingerprint"
        contributionUdict={{ 88: { _id: 88, uname: 'data-user' } }}
      />,
    );
    expect(markup).to.include('管理员审核与发布');
    expect(markup).to.include('name="operation" value="managedPublish"');
    expect(markup).to.include('name="expectedStructureRevision" value="9"');
    expect(markup).to.include('name="formalTitle"');
    expect(markup).to.include('name="difficulty"');
    expect(markup).to.include('自命题');
    expect(markup).to.include('算法');
    expect(markup).not.to.include('stale-tag');
    expect(markup).to.include('data-user');
    expect(markup).to.include('仍有 1 项协作任务待完成');
    expect(markup).to.include('name="pendingContributionsConfirmed" value="false"');
    expect(markup).to.include('name="pendingContributionFingerprint" value="pending-fingerprint"');
  });

  it('disables managed publication when the server review preview is missing or invalid', () => {
    const base = {
      docId: 7,
      hidden: true,
      structureRevision: 9,
      sourceMeta: { template: 'self', year: 2026 },
      managedAuthoring: { workingTitle: '工作标题', metadataStatus: 'draft' },
    };
    const missing = renderToStaticMarkup(
      <ManagedReviewPanel
        pdoc={base}
        sourceTemplates={[{ id: 'self', label: '自命题', fields: ['year'] }]}
        trainingOptions={[]}
        problemsUrl="/d/system/p"
        difficultyOptions={[]}
      />,
    );
    expect(missing).to.include('服务端未提供当前修订的审核预检结果');
    expect(missing).to.match(/<button[^>]*disabled=""[^>]*>.*确认并发布/s);

    const invalid = renderToStaticMarkup(
      <ManagedReviewPanel
        pdoc={base}
        sourceTemplates={[{ id: 'self', label: '自命题', fields: ['year'] }]}
        trainingOptions={[]}
        problemsUrl="/d/system/p"
        difficultyOptions={[]}
        reviewPreview={{ state: 'invalid', structureRevision: 9, tags: [], selectedMindmapNodeIds: [], message: '知识节点已失效' }}
      />,
    );
    expect(invalid).to.include('审核预检失败：知识节点已失效');
    expect(invalid).not.to.include('stale-tag');
  });

  it('renders no dead create action for a user rejected by the managed create route', () => {
    expect(renderToStaticMarkup(<ProblemMineCreateAction allowed={false} />)).to.equal('');
    const allowed = renderToStaticMarkup(<ProblemMineCreateAction allowed />);
    expect(allowed).to.include('href="/problem/create"');
    expect(allowed).to.include('新建题目');
  });

  it('renders problem-bank actions only from server-authorized capabilities', () => {
    const none = renderToStaticMarkup(<ProblemCreationActions canCreateAny={false} canImport={false} />);
    expect(none).to.equal('');

    const narrow = renderToStaticMarkup(<ProblemCreationActions canCreateAny canImport={false} />);
    expect(narrow).to.include('href="/problem/create"');
    expect(narrow).not.to.include('/problem/import/hydro');

    const broad = renderToStaticMarkup(<ProblemCreationActions canCreateAny canImport />);
    expect(broad).to.include('href="/problem/create"');
    expect(broad).to.include('href="/problem/import/hydro"');
  });
});
