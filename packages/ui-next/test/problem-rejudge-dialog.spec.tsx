import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProblemRejudgeDialog } from '../src/components/problem-rejudge-dialog';

const baseProps = {
  open: true,
  endpoint: '/p/P1000',
  pid: 'P1000',
  title: 'A + B Problem',
  onOpenChange: vi.fn(),
  onSuccess: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('problem rejudge dialog', () => {
  it('confirms one explicit whole-problem rejudge request and reports the queued count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, rejudged: 12 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    render(<ProblemRejudgeDialog {...baseProps} onOpenChange={onOpenChange} onSuccess={onSuccess} />);

    expect(screen.getByRole('heading', { name: '整题重测' })).toBeInTheDocument();
    expect(screen.getByText('A + B Problem')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认重测' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(String(init.body)).toBe('operation=rejudge');
    expect(onSuccess).toHaveBeenCalledWith(12);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open and exposes the server error when rejudge is rejected', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Problem {0} config is invalid', params: ['P1000'] } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const onOpenChange = vi.fn();
    render(<ProblemRejudgeDialog {...baseProps} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole('button', { name: '确认重测' }));

    expect(await screen.findByText('Problem P1000 config is invalid')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(consoleError).toHaveBeenCalledWith('Whole-problem rejudge failed', expect.objectContaining({ endpoint: '/p/P1000', pid: 'P1000' }));
  });
});
