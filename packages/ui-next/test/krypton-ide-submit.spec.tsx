import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KryptonIDE, PretestResultInline } from '../src/components/krypton-ide';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('krypton IDE problem submission', () => {
  it('attaches the opaque practice context to a controlled IDE submission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439014' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KryptonIDE
        langs={['cc.cc17']}
        defaultCode="int main() { return 0; }"
        submitUrl="/p/P1000/submit"
        practiceContextId="66b800000000000000000029"
        minHeight={120}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request[1]?.body))).to.deep.include({ practiceContextId: '66b800000000000000000029' });
  });

  it('renders CRLF and LF self-test output as matching', () => {
    render(
      <PretestResultInline
        result={{
          status: 1,
          testCases: [{ id: 1, status: 1, time: 1, memory: 10, message: 'first\r\nsecond\r\n' }],
        }}
        expectedOutput={'first\nsecond\n'}
        activeResultTab="diff"
        onResultTabChange={() => undefined}
      />,
    );

    expect(screen.getByText('输出匹配')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✓ 匹配' })).toBeInTheDocument();
    expect(screen.queryByText('输出不匹配')).not.toBeInTheDocument();
  });

  it('keeps polling after one transient record request failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439012' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rdoc: { status: 2, score: 0, time: 3, memory: 128 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const onRecordsChange = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <KryptonIDE
        langs={['cc.cc17']}
        defaultCode="int main() { return 0; }"
        submitUrl="/p/P1000/submit"
        onRecordsChange={onRecordsChange}
        minHeight={120}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));
    await act(async () => undefined);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRecordsChange.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ status: 2, score: 0, time: 3, memory: 128 });
  });

  it('keeps record polling mounted after an isolated draft language switch', async () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    store.set('krypton:code:integrity-language-switch:py.py3', 'print(1)');
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439019' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rdoc: { status: 1, score: 100 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KryptonIDE
        langs={['cc.cc17', 'py.py3']}
        defaultLang="cc.cc17"
        defaultCode=""
        submitUrl="/p/P1000/submit"
        cacheKey="integrity-language-switch"
        isolateDraftByLanguage
        minHeight={120}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /C\+\+17/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Python \(py3\).*py\.py3/ }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling when the judge returns a format-error terminal status', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439013' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rdoc: { status: 31, score: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const onRecordsChange = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KryptonIDE
        langs={['cc.cc17']}
        defaultCode="int main() { return 0; }"
        submitUrl="/p/P1000/submit"
        onRecordsChange={onRecordsChange}
        minHeight={120}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));
    await act(async () => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRecordsChange.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ status: 31, score: 0 });
  });

  it('keeps the run-all control width stable while a self-test enters cooldown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439011' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(
      <KryptonIDE
        langs={['cc.cc17']}
        defaultCode="int main() { return 0; }"
        submitUrl="/p/P1000/submit"
        canPretest
        samples={[{ id: 1, input: '1\n', output: '1\n' }]}
        minHeight={120}
      />,
    );
    const runAll = screen.getByRole('button', { name: '运行全部自测' });

    expect(runAll).toHaveClass('w-[7.25rem]', 'shrink-0');
    fireEvent.click(runAll);
    expect(screen.getByText('样例 1')).toBeInTheDocument();
    fireEvent.click(runAll);

    await waitFor(() => expect(screen.getByRole('button', { name: '3s' })).toBeDisabled());
    expect(screen.getByRole('button', { name: '3s' })).toHaveClass('w-[7.25rem]', 'shrink-0');
  });

  it('shows the Hydro error instead of silently falling back when the server rejects submission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            name: 'PermissionError',
            errorCode: 'PermissionError',
            code: 403,
            status: 403,
            params: ['提交题目'],
            message: '你在当前域中没有所需权限（提交题目）。',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const fallback = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" onSubmit={fallback} minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('你在当前域中没有所需权限（提交题目）。');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('makes a network failure visible without invoking the no-URL fallback callback', async () => {
    const fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network offline')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" onSubmit={fallback} minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请求失败');
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['an object record id', { rid: {} }, '提交响应包含无效记录编号'],
    ['an off-site redirect', { url: 'https://example.net/record/1' }, '提交响应包含非本站地址'],
  ])('rejects %s in an otherwise successful response', async (_case, body, expectedError) => {
    const fallback = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" onSubmit={fallback} minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedError);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('rejects a followed redirect instead of parsing the destination page as submission success', async () => {
    const response = new Response(JSON.stringify({ rid: '507f1f77bcf86cd799439011' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    Object.defineProperty(response, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('提交响应发生了非预期重定向');
  });
});
