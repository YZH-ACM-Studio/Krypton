import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PrepareProblemDataWrite,
  type ProblemDataWriteGuardState,
  type ProblemDataWriteOperation,
  prepareProblemDataWrite,
  useProblemDataWriteGuard,
} from '../src/components/problem-data-write-guard';

function GuardHarness({
  prepare,
  operation = 'files-upload',
  state = { active: [], canOverride: false },
}: {
  prepare: PrepareProblemDataWrite;
  operation?: ProblemDataWriteOperation;
  state?: ProblemDataWriteGuardState;
}) {
  const [result, setResult] = useState('');
  const guard = useProblemDataWriteGuard(state, 'data', prepare);
  return (
    <>
      <button
        type="button"
        disabled={guard.blocked}
        onClick={() => {
          void guard.confirm('修改测试数据', operation).then((confirmation) => setResult(String(confirmation)));
        }}
      >
        执行
      </button>
      <output>{result}</output>
      {guard.notice}
      {guard.dialog}
    </>
  );
}

describe('problem data write guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests one operation-bound challenge from the files endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          active: [{ id: 'contest-1', title: '期中考试', rule: 'exam' }],
          canOverride: true,
          confirmationRequestId: 'fresh-upload-confirmation',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(prepareProblemDataWrite('/d/system/p/P5046/files', 'files-upload')).resolves.toEqual({
      active: [{ id: 'contest-1', title: '期中考试', rule: 'exam' }],
      canOverride: true,
      confirmationRequestId: 'fresh-upload-confirmation',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('/d/system/p/P5046/files');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('same-origin');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('operation')).toBe('prepare_data_write');
    expect((request.body as FormData).get('writeOperation')).toBe('files-upload');
  });

  it('uses an action-time challenge when the page bootstrap predates the active contest', async () => {
    const prepare = vi.fn().mockResolvedValue({
      active: [{ id: 'contest-1', title: '期中考试', rule: 'exam' }],
      canOverride: true,
      confirmationRequestId: 'fresh-upload-confirmation',
    });
    render(<GuardHarness prepare={prepare} />);

    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByRole('heading', { name: '确认修改赛中评测数据' })).toBeInTheDocument();
    expect(screen.getByText(/期中考试/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '我已确认，继续' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('fresh-upload-confirmation'));
    expect(prepare).toHaveBeenCalledExactlyOnceWith('files-upload');
  });

  it.each<ProblemDataWriteOperation>(['files-rename', 'files-delete', 'generate-testdata-request'])(
    'checks current container state before %s',
    async (operation) => {
      const prepare = vi.fn().mockResolvedValue({ active: [], canOverride: false });
      render(<GuardHarness prepare={prepare} operation={operation} />);

      fireEvent.click(screen.getByRole('button', { name: '执行' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('true'));
      expect(prepare).toHaveBeenCalledExactlyOnceWith(operation);
    },
  );

  it('rechecks instead of staying blocked when a contest ended after page load', async () => {
    const prepare = vi.fn().mockResolvedValue({ active: [], canOverride: false });
    render(
      <GuardHarness
        prepare={prepare}
        state={{
          active: [{ id: 'contest-1', title: '已结束的考试', rule: 'exam' }],
          canOverride: false,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: '执行' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await waitFor(() => expect(screen.getByText('true', { selector: 'output' })).toBeInTheDocument());
    expect(prepare).toHaveBeenCalledExactlyOnceWith('files-upload');
  });

  it('shows a preparation failure instead of submitting without confirmation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prepare = vi.fn().mockRejectedValue(new Error('无法读取当前比赛状态'));
    render(<GuardHarness prepare={prepare} />);

    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取当前比赛状态');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('false'));
    expect(consoleError).toHaveBeenCalledWith('Problem data write preparation failed', {
      operation: 'files-upload',
      error: expect.any(Error),
    });
  });
});
