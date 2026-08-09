import { describe, expect, it } from 'vitest';
import { parseBulkVerifierResponse } from '../src/pages/problems';

describe('problem bulk verifier response', () => {
  it('accepts the canonical per-problem result and exact retry set', () => {
    expect(
      parseBulkVerifierResponse(
        {
          success: false,
          requestId: 'batch-1',
          results: [
            { pid: 42, publicPid: 'P42', status: 'applied' },
            { pid: 43, publicPid: 'P43', status: 'already-present' },
            { pid: 44, publicPid: 'P44', status: 'conflict-higher-role' },
            { pid: 45, publicPid: 'P45', status: 'failed' },
          ],
          retryPids: [45],
        },
        [42, 43, 44, 45],
        'batch-1',
      ),
    ).to.deep.equal({
      success: false,
      requestId: 'batch-1',
      results: [
        { pid: 42, publicPid: 'P42', status: 'applied' },
        { pid: 43, publicPid: 'P43', status: 'already-present' },
        { pid: 44, publicPid: 'P44', status: 'conflict-higher-role' },
        { pid: 45, publicPid: 'P45', status: 'failed' },
      ],
      retryPids: [45],
    });
  });

  it('rejects a response whose retry set does not exactly match failed results', () => {
    expect(() =>
      parseBulkVerifierResponse(
        {
          success: false,
          requestId: 'batch-2',
          results: [{ pid: 45, publicPid: 'P45', status: 'failed' }],
          retryPids: [],
        },
        [45],
        'batch-2',
      ),
    ).toThrow('批量只读验题人响应格式无效');
  });

  it('rejects unknown result states instead of treating them as success', () => {
    expect(() =>
      parseBulkVerifierResponse(
        {
          success: true,
          requestId: 'batch-3',
          results: [{ pid: 42, publicPid: 'P42', status: 'maybe' }],
          retryPids: [],
        },
        [42],
        'batch-3',
      ),
    ).toThrow('批量只读验题人响应格式无效');
  });

  it('rejects an incomplete per-problem result list', () => {
    expect(() =>
      parseBulkVerifierResponse(
        {
          success: true,
          requestId: 'batch-4',
          results: [{ pid: 42, publicPid: 'P42', status: 'applied' }],
          retryPids: [],
        },
        [42, 43],
        'batch-4',
      ),
    ).toThrow('批量只读验题人响应格式无效');
  });

  it('rejects a valid-looking response from a different request', () => {
    expect(() =>
      parseBulkVerifierResponse(
        {
          success: true,
          requestId: 'stale-batch',
          results: [{ pid: 42, publicPid: 'P42', status: 'applied' }],
          retryPids: [],
        },
        [42],
        'current-batch',
      ),
    ).toThrow('批量只读验题人响应格式无效');
  });
});
