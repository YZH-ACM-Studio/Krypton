import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorPage } from '../src/pages/error';
import { fetchHydroResponse, formatHydroErrorResponse, presentHydroErrorPayload, readHydroResponseError } from '../src/lib/error-presenter';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';

const canonicalError = {
  name: 'ValidationError',
  errorCode: 'ValidationError',
  code: 400,
  status: 400,
  params: ['content'],
  message: '字段 content 校验失败。',
  nested: {
    0: {
      name: 'ValidationError.Parameter',
      errorCode: 'ValidationError.Parameter',
      code: 400,
      status: 400,
      params: [],
      message: '字段 content 不能为空。',
    },
  },
};

const deterministicOptions = {
  createTraceId: () => 'ui-next-test-trace',
  report: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bootstrap(error: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-07-30T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'error.html',
      data: { error },
    },
  };
}

describe('ui-next error presenter', () => {
  it('uses the same authoritative message for raw responses, fetch responses, and page payloads', async () => {
    const raw = JSON.stringify({ error: canonicalError });

    expect(formatHydroErrorResponse(raw, 400, '保存失败', deterministicOptions)).toBe('字段 content 校验失败。');
    await expect(
      readHydroResponseError(new Response(raw, { status: 400, headers: { 'content-type': 'application/json' } }), '保存失败', deterministicOptions),
    ).resolves.toBe('字段 content 校验失败。');
    expect(presentHydroErrorPayload(canonicalError, '请求失败', deterministicOptions)).toBe('字段 content 校验失败。');
  });

  it('fails malformed plaintext and residual placeholders closed with a visible trace ID', async () => {
    const report = vi.fn();
    const options = { ...deterministicOptions, report };

    expect(formatHydroErrorResponse('upstream failed', 502, '保存失败', options)).toBe(
      '保存失败：服务器返回了无法解析的错误响应。错误编号：ui-next-test-trace',
    );
    await expect(
      readHydroResponseError(
        new Response(
          JSON.stringify({
            error: {
              ...canonicalError,
              message: 'Field {0} validation failed.',
            },
          }),
          { status: 400 },
        ),
        '保存失败',
        options,
      ),
    ).resolves.toBe('保存失败：服务器返回了无法解析的错误响应。错误编号：ui-next-test-trace');
    expect(report).toHaveBeenCalled();
  });

  it('turns a request rejected before an HTTP response into the cataloged Chinese fallback', async () => {
    const report = vi.fn();
    const networkFailure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkFailure));

    const request = fetchHydroResponse('/paper/T1000/draft', {}, '答题草稿加载失败', { ...deterministicOptions, report });
    await expect(request).rejects.toBeInstanceOf(TypeError);
    await expect(request).rejects.toMatchObject({
      message: '答题草稿加载失败',
      cause: networkFailure,
    });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'ui-next-test-trace',
        diagnostic: expect.any(TypeError),
      }),
    );
  });

  it('uses the shared catalog fallback for generic requests and preserves abort control flow', async () => {
    const report = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));

    await expect(fetchHydroResponse('/api/example', undefined, undefined, { ...deterministicOptions, report })).rejects.toThrow('请求失败');
    expect(report).toHaveBeenCalledTimes(1);

    report.mockClear();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(abort));
    await expect(fetchHydroResponse('/api/example', undefined, undefined, { ...deterministicOptions, report })).rejects.toBe(abort);
    expect(report).not.toHaveBeenCalled();
  });

  it('renders the common error page from the authoritative message without exposing raw params', () => {
    render(
      <BootstrapProvider bootstrap={bootstrap(canonicalError)}>
        <ErrorPage />
      </BootstrapProvider>,
    );

    expect(screen.getByText('字段 content 校验失败。')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });
});
