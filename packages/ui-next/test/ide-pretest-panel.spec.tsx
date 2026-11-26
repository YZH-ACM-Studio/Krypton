import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdePretestPanel, useIdePretest, type IdePretestOptions } from '../src/components/ide-pretest-panel';
import { KryptonIDE } from '../src/components/krypton-ide';
import { pretestActualOutput } from '../src/lib/pretest-results';

const samples = [
  { id: 1, input: '1\n', output: '2\n' },
  { id: 2, input: '3\n', output: '4\n' },
];

function options(overrides: Partial<IdePretestOptions> = {}): IdePretestOptions {
  return {
    getCode: () => '{"region-1":"return 2;"}', getLang: () => 'c', canPretest: true,
    pretestUrl: '/p/1/submit?tid=exam', resolveRecordUrl: (rid) => `/record/${rid}?tid=exam`,
    samples, ...overrides,
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared IDE self-test panel', () => {
  it('refreshes equal-length sample edits while retaining custom input and a valid active tab', () => {
    const { result, rerender } = renderHook((props) => useIdePretest(props), { initialProps: options() });
    act(() => result.current.updateTabField('custom', 'input', 'mine'));
    act(() => result.current.openSampleTab(1));
    rerender(options({ samples: [{ id: 1, input: '5\n', output: '6\n' }, samples[1]] }));
    expect(result.current.activeTab).toMatchObject({ input: '5\n', expectedOutput: '6\n' });
    rerender(options({ samples: [] }));
    expect(result.current.activeTestTab).toBe('custom');
    expect(result.current.activeTab.input).toBe('mine');
  });

  it('copies a read-only sample into an editable custom tab and preserves independent custom tabs', () => {
    function Harness() {
      const pretest = useIdePretest(options());
      return <><button onClick={() => pretest.openSampleTab(1)}>打开样例</button><IdePretestPanel pretest={pretest} /></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开样例' }));
    expect(screen.queryByPlaceholderText('在此输入测试数据…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制到自定义' }));
    expect(screen.getByPlaceholderText('在此输入测试数据…')).toHaveValue('1\n');
    expect(screen.getByPlaceholderText('输入期望输出以便自动比对…')).toHaveValue('2\n');
    fireEvent.change(screen.getByPlaceholderText('在此输入测试数据…'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: '添加自定义测试' }));
    fireEvent.click(screen.getByRole('button', { name: '添加自定义测试' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭自定义 4' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义 2' }));
    expect(screen.getByPlaceholderText('在此输入测试数据…')).toHaveValue('changed');
    fireEvent.click(screen.getByRole('button', { name: '样例 1' }));
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('在此输入测试数据…')).not.toBeInTheDocument();
  });

  it('runs all samples atomically with the structured code and binds out-of-order case results by id', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ rid: 'test-record' }))
      .mockResolvedValueOnce(response({ rdoc: { status: 1, testCases: [
        { id: 2, status: 1, time: 2, memory: 12, message: '4\n' },
        { id: 1, status: 1, time: 1, memory: 11, message: '2\n' },
      ] } }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useIdePretest(options({ practiceContextId: 'context' })));
    act(() => result.current.openSampleTab(1));
    await act(async () => result.current.handleRunAll());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/p/1/submit?tid=exam');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      lang: 'c', code: '{"region-1":"return 2;"}', pretest: true, input: ['1\n', '3\n'], practiceContextId: 'context',
    });
    act(() => result.current.handleRunActive());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock.mock.calls[1][0]).toBe('/record/test-record?tid=exam');
    expect(pretestActualOutput(result.current.pretestResults.get('sample-1'))).toBe('2\n');
    expect(pretestActualOutput(result.current.pretestResults.get('sample-2'))).toBe('4\n');
    expect(result.current.pretestLoading).toBe(false);
    expect(result.current.pretestCooldown).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.pretestCooldown).toBe(0);
  });

  it('keeps F9 scoped to the active tab in the original IDE', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(response({ rid: 'f9-record' }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<KryptonIDE langs={['c']} defaultCode="int main() {}" samples={samples} pretestUrl="/pretest" canPretest />);
    const editor = container.querySelector('.cm-content');
    if (!editor) throw new Error('CodeMirror editor missing');
    fireEvent.keyDown(editor, { key: 'F9', code: 'F9', keyCode: 120 });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '样例 2' }));
    await act(async () => fireEvent.keyDown(editor, { key: 'F9', code: 'F9', keyCode: 120 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toEqual(['3\n']);
  });

  it('aborts an in-flight request on unmount and shows invalid responses as errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ missing: 'rid' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useIdePretest(options()));
    act(() => result.current.openSampleTab(1));
    await act(async () => result.current.handleRunActive());
    expect(result.current.pretestResults.get('sample-1')?.error).toBe('自测提交响应中没有记录编号');
    unmount();

    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const next = renderHook(() => useIdePretest(options()));
    act(() => next.result.current.openSampleTab(1));
    act(() => next.result.current.handleRunActive());
    const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    next.unmount();
    expect(request.signal?.aborted).toBe(true);
  });

  it('shows a line diff against the expected output through the shared panel', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ rid: 'diff-record' }))
      .mockResolvedValueOnce(response({ status: 1, testCases: [{ id: 1, status: 1, time: 1, memory: 1, message: 'wrong\n' }] }));
    vi.stubGlobal('fetch', fetchMock);
    function Harness() {
      const pretest = useIdePretest(options());
      return <><button onClick={() => pretest.openSampleTab(1)}>打开</button><IdePretestPanel pretest={pretest} /></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /运行此自测/ })));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(screen.getByRole('button', { name: '✗ 差异' }));
    expect(screen.getByText('输出不匹配')).toBeInTheDocument();
    expect(screen.getByText(/^wrong$/)).toHaveClass('bg-danger-soft');
  });
});
