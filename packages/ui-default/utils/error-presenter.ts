import { presentHydroErrorEnvelope } from '@hydrooj/common';

interface ErrorPresenterOptions {
  fallback: string;
  createTraceId?: () => string;
  report?: (traceId: string, diagnostic: Error) => void;
  status?: number;
}

function createTraceId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return `ui-${cryptoApi.randomUUID()}`;
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new TypeError('当前浏览器不支持安全的错误编号生成，请升级浏览器后重试');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return `ui-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function presentLegacyUiError(body: unknown, options: ErrorPresenterOptions): string {
  const result = presentHydroErrorEnvelope(body, {
    fallback: options.fallback,
    createTraceId: options.createTraceId || createTraceId,
    ...(options.status === undefined ? {} : { expectedStatus: options.status }),
  });
  if (result.diagnostic && result.traceId) {
    const report =
      options.report ||
      ((traceId: string, diagnostic: Error) => {
        console.error(`[${traceId}] Invalid Hydro error response`, diagnostic);
      });
    report(result.traceId, result.diagnostic);
  }
  return result.message;
}
