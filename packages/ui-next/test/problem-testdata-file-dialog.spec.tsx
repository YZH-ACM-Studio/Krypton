import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProblemTestdataFileDialog } from '../src/components/problem-testdata-file-dialog';

vi.mock('../src/components/krypton-ide', () => ({
  KryptonIDE: ({ value }: { value: string }) => <pre data-testid="file-content">{value}</pre>,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('problem testdata file preview', () => {
  it('loads the signed file as text after obtaining its URL through the JSON error boundary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: '/signed/input.txt' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('1 2\n', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ProblemTestdataFileDialog file={{ name: 'input.txt', size: 4 }} problemUrl="/p/P1000" onClose={() => undefined} />);

    expect(await screen.findByTestId('file-content')).toHaveTextContent('1 2');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/p/P1000/file/input.txt?type=testdata&noDisposition=1',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/signed/input.txt',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { Accept: 'text/plain' },
      }),
    );
  });
});
