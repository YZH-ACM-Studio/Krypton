import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { RecordDetailPage } from '../src/pages/records';

vi.mock('../src/hooks/use-record-socket', () => ({ useRecordSocket: () => undefined }));
vi.mock('../src/components/krypton-ide', () => ({
  KryptonIDE: ({ value }: { value: string }) => <pre data-testid="submitted-code">{value}</pre>,
}));

const source = 'int sign(int x) {\n  if (x > 0) return 1;\n  return x < 0 ? -1 : 0;\n}';
const rawCode = JSON.stringify({ 'r-submitted-region': source });
const writeText = vi.fn<(text: string) => Promise<void>>();

function showRecord(code: string, problemKind = 'function') {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton', siteName: 'Krypton OJ', locale: 'zh-CN', theme: 'light', generatedAt: '2026-11-11T01:35:00.000Z',
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { records: '/record', recordDetail: '/record/{RID}', problemDetail: '/p/{PID}' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'record_detail.html',
      data: {
        tdoc: { docId: 'homework-1', rule: 'homework' },
        pdoc: { title: '符号函数', problemKind, config: { type: problemKind, maxScore: 100 } },
        rdoc: {
          _id: '507f1f77bcf86cd799439011', pid: 1001, uid: 7, lang: 'c', code, status: 1, score: 100,
          testCases: [{ id: 1, subtaskId: 1, status: 1, score: 100, time: 2, memory: 380 }],
        },
        udoc: { _id: 7, uname: 'student' },
        langs: { c: { display: 'C' } },
      },
    },
  };
  return render(<BootstrapProvider bootstrap={bootstrap}><RecordDetailPage /></BootstrapProvider>);
}

beforeEach(() => {
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

describe('structured submission record code', () => {
  it('displays and copies the submitted function with real line breaks', async () => {
    showRecord(rawCode);
    expect(screen.getByTestId('submitted-code').textContent).toBe(source);
    expect(screen.queryByText(/r-submitted-region/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制提交代码' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    expect(await screen.findByRole('button', { name: '提交代码已复制' })).toBeVisible();
  });

  it('keeps a submitted empty region visible without offering to copy absent code', () => {
    showRecord('{"r-empty":""}');
    expect(screen.getByTestId('submitted-code').textContent).toBe('');
    expect(screen.queryByRole('button', { name: '复制提交代码' })).not.toBeInTheDocument();
  });

  it('keeps the original malformed submission visible with an error', () => {
    showRecord('{"body":42}');
    expect(screen.getByRole('alert')).toHaveTextContent('作答区数据格式无效');
    expect(screen.getByTestId('submitted-code').textContent).toBe('{"body":42}');
  });

  it('preserves ordinary programming submissions that contain JSON', async () => {
    showRecord(rawCode, 'programming');
    expect(screen.getByTestId('submitted-code').textContent).toBe(rawCode);
    fireEvent.click(screen.getByRole('button', { name: '复制提交代码' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rawCode));
  });
});
