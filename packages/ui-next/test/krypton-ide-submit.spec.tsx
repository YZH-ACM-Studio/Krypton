import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KryptonIDE } from '../src/components/krypton-ide';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('krypton IDE problem submission', () => {
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
      new Response(JSON.stringify({ error: { message: "You don't have the required permission ({0})", params: ['Submit problem'] } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fallback = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" onSubmit={fallback} minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have the required permission (Submit problem)");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('makes a network failure visible without invoking the no-URL fallback callback', async () => {
    const fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network offline')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<KryptonIDE langs={['cc.cc17']} defaultCode="int main() { return 0; }" submitUrl="/p/P1000/submit" onSubmit={fallback} minHeight={120} />);
    fireEvent.click(screen.getByRole('button', { name: /^提交/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('network offline');
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
