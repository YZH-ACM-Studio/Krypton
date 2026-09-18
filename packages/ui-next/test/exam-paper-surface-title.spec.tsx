import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examPaperSurfaceTitle } from '../src/components/paper/paper-shell';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ExamPaperPage } from '../src/pages/exam-mode/paper';

function bootstrap(cells: Array<{ pid: number; questionKey: string | null }>): KryptonBootstrap {
  const now = Date.now();
  const pdict = Object.fromEntries(
    cells.map((cell) => [
      cell.pid,
      {
        docId: cell.pid,
        title: `内部标题 ${cell.pid}`,
        content: '',
        config: {
          type: 'objective',
          options: { [cell.questionKey || 'main']: ['A', 'B'] },
        },
      },
    ]),
  );
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
          title: '考试',
          beginAt: new Date(now - 60_000).toISOString(),
          endAt: new Date(now + 60_000).toISOString(),
          rule: 'exam',
          owner: 1,
        },
        pdict,
        cells: cells.map((cell) => ({ ...cell, kind: 'single' as const, score: 100, prompt: '请选择。' })),
        now,
        inWindow: true,
        canFinalize: true,
        owner: null,
        broadcasts: [],
        scoreboard: [],
        showScoreboard: false,
        allowSubmitByKind: false,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '#overview');
});

describe('exam paper surface title', () => {
  it('numbers the current paper surface from 1', () => {
    expect(examPaperSurfaceTitle(1)).to.equal('第 1 题');
    expect(examPaperSurfaceTitle(2)).to.equal('第 2 题');
  });

  it('rejects a non-positive or non-integer order', () => {
    expect(() => examPaperSurfaceTitle(0)).to.throw(TypeError, 'exam_paper_surface_order');
    expect(() => examPaperSurfaceTitle(-1)).to.throw(TypeError, 'exam_paper_surface_order');
    expect(() => examPaperSurfaceTitle(1.5)).to.throw(TypeError, 'exam_paper_surface_order');
  });

  it('renders two main-keyed cells as 第 1 题 and 第 2 题', () => {
    window.history.replaceState(null, '', '#problems');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ drafts: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(
      <BootstrapProvider
        bootstrap={bootstrap([
          { pid: 11, questionKey: 'main' },
          { pid: 12, questionKey: 'main' },
        ])}
      >
        <ExamPaperPage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '第 1 题' })).to.exist;
    expect(screen.getByRole('heading', { name: '第 2 题' })).to.exist;
    expect(screen.queryByText('第 main 题')).to.equal(null);
    expect(screen.queryByText('内部标题 11')).to.equal(null);
  });

  it('locks the exam paper title to surface order instead of questionKey', () => {
    const paper = readFileSync(resolve(import.meta.dirname, '../src/pages/exam-mode/paper.tsx'), 'utf8');
    expect(paper).to.include('examPaperSurfaceTitle(cellIndex + 1)');
    expect(paper).not.to.include('第 ${cell.questionKey} 题');
    expect(paper).to.include('预览不能交卷');
    expect(paper).to.include('if (paperPreview || !canFinalize)');
    expect(paper).to.include('paperPreview={paperPreview === true}');
  });
});
