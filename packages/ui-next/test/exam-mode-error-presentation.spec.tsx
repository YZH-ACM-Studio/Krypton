import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ExamPaperPage } from '../src/pages/exam-mode/paper';

const canonicalDraftError = {
  name: 'PermissionError',
  errorCode: 'PermissionError',
  code: 403,
  status: 403,
  params: ['加载考试草稿'],
  message: '你没有加载考试草稿的权限。',
};

function bootstrap(): KryptonBootstrap {
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
          title: '考试',
          beginAt: new Date(now - 60_000).toISOString(),
          endAt: new Date(now + 60_000).toISOString(),
          rule: 'exam',
          owner: 1,
        },
        pdict: {
          1: {
            docId: 1,
            title: '单选题',
            content: '',
            config: {
              type: 'objective',
              options: { main: ['A', 'B'] },
            },
          },
        },
        cells: [{ pid: 1, questionKey: 'main', kind: 'single', score: 100, prompt: '请选择。' }],
        now,
        inWindow: true,
        owner: null,
        broadcasts: [],
        scoreboard: [],
        showScoreboard: false,
        allowSubmitByKind: true,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '#overview');
});

describe('exam mode error presentation', () => {
  it('shows the authoritative draft error while preserving the locked exam shell', async () => {
    window.history.replaceState(null, '', '#problems');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: canonicalDraftError }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ExamPaperPage />
      </BootstrapProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('草稿加载失败：你没有加载考试草稿的权限。 已阻止作答、保存和交卷，请刷新重试。');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '交卷' })).toBeDisabled();
      expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    });
    expect(window.location.hash).toBe('#problems');
  });

  it('shows the cataloged Chinese load error when the browser receives no HTTP response', async () => {
    window.history.replaceState(null, '', '#problems');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ExamPaperPage />
      </BootstrapProvider>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('草稿加载失败：答题草稿加载失败 已阻止作答、保存和交卷，请刷新重试。');
    expect(alert).not.toHaveTextContent('Failed to fetch');
  });
});
