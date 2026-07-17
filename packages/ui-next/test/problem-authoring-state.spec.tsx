import { expect } from 'chai';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import { ManagedProblemTrainingStatus, ProblemAuthorText, ProblemEditGate } from '../src/components/problem-authoring-state.tsx';

describe('managed problem visible authoring state', () => {
  it('renders an unset author instead of inventing a storage owner', () => {
    expect(renderToStaticMarkup(createElement(ProblemAuthorText, { authors: [] }))).to.include('未设置');
    expect(renderToStaticMarkup(createElement(ProblemAuthorText, { authors: [{ _id: 77, uname: 'nowcoder' }] }))).to.include('nowcoder');
  });

  it('renders the edit entry only when the server capability allows it outside contests', () => {
    const edit = createElement('span', null, '编辑');
    expect(renderToStaticMarkup(createElement(ProblemEditGate, { canEditProblem: false, inContest: false, children: edit }))).to.equal('');
    expect(renderToStaticMarkup(createElement(ProblemEditGate, { canEditProblem: true, inContest: true, children: edit }))).to.equal('');
    expect(renderToStaticMarkup(createElement(ProblemEditGate, { canEditProblem: true, inContest: false, children: edit }))).to.include('编辑');
  });

  it('renders confirmed live memberships and ignores consumed pending placement', () => {
    const markup = renderToStaticMarkup(
      createElement(ManagedProblemTrainingStatus, {
        metadataStatus: 'confirmed',
        pendingPlacement: { trainingId: 'stale', chapterId: 99 },
        trainingOptions: [{ id: 'stale', title: '旧待挂训练', templates: [], chapters: [{ id: 99, title: '旧章节' }] }],
        placements: [
          { trainingId: 't1', trainingTitle: '牛客暑期多校训练集', chapterId: 40, chapterTitle: '2026年牛客-第1场' },
          { trainingId: 't2', trainingTitle: '数据结构训练', chapterId: 3, chapterTitle: '并查集' },
        ],
      }),
    );
    expect(markup).to.include('所属训练');
    expect(markup).to.include('牛客暑期多校训练集 / 2026年牛客-第1场');
    expect(markup).to.include('数据结构训练 / 并查集');
    expect(markup).not.to.include('旧待挂训练');
    expect(markup).not.to.include('待挂训练');
  });
});
