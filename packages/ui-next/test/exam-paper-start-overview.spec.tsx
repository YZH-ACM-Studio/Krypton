import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstPaperKind, groupCellsByKind, KIND_ORDER, type PaperCell } from '../src/components/paper/paper-shell';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ExamPaperPage } from '../src/pages/exam-mode/paper';

function bootstrap(overrides: Record<string, unknown> = {}): KryptonBootstrap {
  const now = Date.now();
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: new Date(now).toISOString(),
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'exam_paper.html',
      data: {
        tdoc: {
          docId: 'T1000',
          _id: 'T1000',
          title: '结业考试',
          beginAt: new Date(now - 60_000).toISOString(),
          endAt: new Date(now + 60_000).toISOString(),
          rule: 'exam',
          owner: 1,
        },
        pdict: {},
        cells: [],
        now,
        inWindow: true,
        canFinalize: false,
        paperStarted: false,
        canStartPaper: true,
        canViewPaper: false,
        contestBeginAt: new Date(now - 60_000).toISOString(),
        contestEndAt: new Date(now + 3_600_000).toISOString(),
        durationHours: 2,
        paperOutline: {
          questionCount: 45,
          kinds: [
            { kind: 'true_false', count: 30 },
            { kind: 'multi', count: 15 },
          ],
        },
        owner: null,
        broadcasts: [],
        scoreboard: [],
        showScoreboard: false,
        allowSubmitByKind: false,
        ...overrides,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '#overview');
});

describe('exam paper start and overview', () => {
  it('opens the first KIND_ORDER tab even when the first drawn cell is multi', () => {
    const cells: PaperCell[] = [
      { pid: 2, questionKey: 'main', kind: 'multi', score: 100 },
      { pid: 1, questionKey: 'main', kind: 'true_false', score: 100 },
    ];
    expect(firstPaperKind(groupCellsByKind(cells))).to.equal('true_false');
    expect(KIND_ORDER.indexOf('true_false')).to.be.lessThan(KIND_ORDER.indexOf('multi'));
  });

  it('keeps the question surface hidden until the student starts', async () => {
    window.history.replaceState(null, '', '#problems');
    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ExamPaperPage />
      </BootstrapProvider>,
    );
    expect(screen.queryByRole('heading', { name: '第 1 题' })).to.equal(null);
    expect(screen.getByRole('button', { name: '开始答题' })).to.exist;
    await waitFor(() => {
      expect(window.location.hash).to.equal('#overview');
    });
  });

  it('centers a full-width start CTA and does not leak paper cells', () => {
    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ExamPaperPage />
      </BootstrapProvider>,
    );
    const cta = screen.getByRole('button', { name: '开始答题' });
    expect(cta.className).to.match(/w-full/);
    expect(cta.className).to.match(/h-14/);
    expect(screen.getByText('题量 45 道')).to.exist;
    expect(screen.getByText('判断 · 30')).to.exist;
    expect(screen.queryByText('第 1 题')).to.equal(null);
  });

  it('locks explicit start, first tab, and kind badge on the exam paper only', () => {
    const paper = readFileSync(resolve(import.meta.dirname, '../src/pages/exam-mode/paper.tsx'), 'utf8');
    const sections = readFileSync(resolve(import.meta.dirname, '../src/components/paper/sections.tsx'), 'utf8');
    const shell = readFileSync(resolve(import.meta.dirname, '../src/components/paper/paper-shell.tsx'), 'utf8');
    const workspace = readFileSync(resolve(import.meta.dirname, '../src/pages/exam-mode/workspace.tsx'), 'utf8');
    expect(paper).to.include('/paper/${tid}/start');
    expect(paper).to.include('/paper/${tid}#ranking');
    expect(paper).not.to.include('/c/${tid}/scoreboard');
    expect(paper).to.include('开始后将按个人时长计时，试卷不能重抽。确定开始答题？');
    expect(paper).to.include('将清空上一轮本场答卷并重新计时');
    expect(paper).to.include('firstPaperKind(groups)');
    expect(paper).to.include('kindLabel={KIND_LABELS[cell.kind]}');
    expect(paper).to.include("data.paperStarted === false");
    expect(paper).to.include('paperFinalized');
    expect(paper).to.include('已交卷');
    expect(paper).to.include('examShowVerdict');
    expect(paper).to.include('examShowVerdict && c.questionKey && draft?.judgeResult');
    expect(sections).to.include('开始答题');
    expect(sections).to.include('h-14 w-full');
    expect(shell).to.include("true_false: '判断'");
    expect(workspace).not.to.include('paperStarted');
    expect(workspace).not.to.include('/paper/');
  });
});
