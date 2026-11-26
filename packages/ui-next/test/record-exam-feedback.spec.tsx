import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { RecordDetailPage } from '../src/pages/records';

const RID = '507f1f77bcf86cd799439011';
const RECORD_URL = `/exam-mode/set-1/record/${RID}`;

function renderExamRecord(record: Record<string, unknown>, statusVisible = false) {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-11-10T00:00:00.000Z',
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { records: '/record', recordDetail: '/record/{RID}', problemDetail: '/p/{PID}' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'record_detail.html',
      data: {
        examMode: { urls: { record: '/exam-mode/set-1/record/__RID__', problem: '/paper/set-1/problem/__PID__', records: '/exam-mode/set-1/records' } },
        examRecordStatusVisible: statusVisible,
        examRecordDownloadAvailable: false,
        pdoc: { title: '程序填空', config: { type: 'default', maxScore: 100 } },
        rdoc: { _id: RID, pid: 1001, uid: 7, lang: 'cc.cc17', ...record },
        udoc: { _id: 7, uname: 'student' },
      },
    },
  };
  return render(<BootstrapProvider bootstrap={bootstrap}><RecordDetailPage /></BootstrapProvider>);
}

describe('exam record feedback projection', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders an explicitly public zero score while the verdict is hidden', () => {
    renderExamRecord({ score: 0, judging: false });
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('这场考试不显示对错')).toBeVisible();
    expect(screen.queryByText('等待评测')).not.toBeInTheDocument();
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
  });

  it('polls score-only results until judging becomes false without requiring a status', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rdoc: { score: 40, judging: true } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ page: { data: { rdoc: { score: 80, judging: false } } } })));
    renderExamRecord({ score: 0, judging: true });

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('40')).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(1, RECORD_URL, {
      headers: { Accept: 'application/json' }, credentials: 'same-origin',
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('80')).toBeVisible();
    expect(screen.queryByText('40')).not.toBeInTheDocument();
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not poll a completed score-only record', async () => {
    renderExamRecord({ score: 80, judging: false });
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('80')).toBeVisible();
  });

  it('replaces score-only progress when the server publishes a full terminal result', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      rdoc: { status: 1, score: 100 }, examRecordStatusVisible: true,
    })));
    renderExamRecord({ score: 40, judging: true });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('Accepted')).toBeVisible();
    expect(screen.getByText('100')).toBeVisible();
    expect(screen.queryByText('这场考试不显示对错')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes previously public scores when the server hides feedback during judging', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      page: { data: { rdoc: {}, examRecordStatusVisible: false } },
    })));
    renderExamRecord({ score: 40, judging: true });
    expect(screen.getByText('40')).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByText('40')).not.toBeInTheDocument();
    expect(screen.getByText('这场考试不显示对错')).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a legacy hidden record hidden without polling', async () => {
    renderExamRecord({});
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('等待评测')).not.toBeInTheDocument();
  });

  it('continues polling legacy visible statuses and stops at a terminal status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rdoc: { status: 1, score: 100 } })));
    renderExamRecord({ status: 0, score: 0 }, true);
    expect(screen.getByText('等待评测')).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('Accepted')).toBeVisible();
    expect(screen.getByText('100')).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
