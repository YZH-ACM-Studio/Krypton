import { parseHydroErrorPayload, presentHydroErrorEnvelope, type HydroClientErrorPayload } from '@hydrooj/common';
import { createRequestId } from './request-id';

export interface ErrorPresenterDiagnostic {
  traceId: string;
  status?: number;
  diagnostic: Error;
}

export interface ErrorPresenterOptions {
  createTraceId?: () => string;
  report?: (diagnostic: ErrorPresenterDiagnostic) => void;
}

export interface PresentedResponseError {
  message: string;
  payload?: HydroClientErrorPayload;
}

const defaultReport = ({ traceId, status, diagnostic }: ErrorPresenterDiagnostic) => {
  console.error(`[${traceId}] Invalid Hydro error response`, { status, diagnostic });
};

const defaultRequestReport = ({ traceId, diagnostic }: ErrorPresenterDiagnostic) => {
  console.error(`[${traceId}] Hydro request failed before receiving a response`, diagnostic);
};

function presentBody(
  body: unknown,
  status: number | undefined,
  fallback: string,
  options: ErrorPresenterOptions,
  cause?: unknown,
): PresentedResponseError {
  const result = presentHydroErrorEnvelope(body, {
    fallback,
    createTraceId: options.createTraceId || (() => `ui-${createRequestId()}`),
    ...(status === undefined ? {} : { expectedStatus: status }),
  });
  if (result.diagnostic && result.traceId) {
    const diagnostic =
      cause === undefined
        ? result.diagnostic
        : new AggregateError(
            [result.diagnostic, cause instanceof Error ? cause : new Error('Non-error response parsing failure', { cause })],
            'Hydro error response parsing failed',
          );
    (options.report || defaultReport)({
      traceId: result.traceId,
      status,
      diagnostic,
    });
  }
  return {
    message: result.message,
    ...(result.payload ? { payload: result.payload } : {}),
  };
}

/** Present a raw XHR body using Hydro's strict JSON error contract. */
export function formatHydroErrorResponse(raw: string, status: number, fallback: string, options: ErrorPresenterOptions = {}): string {
  let body: unknown = raw;
  let parseFailure: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    parseFailure = error;
    // The strict presenter below converts non-JSON bodies into a traceable
    // protocol error without exposing proxy HTML or arbitrary plaintext.
  }
  return presentBody(body, status, fallback, options, parseFailure).message;
}

/** Read and present a failed fetch response without guessing legacy fields. */
export async function presentHydroResponseError(
  response: Response,
  fallback: string,
  options: ErrorPresenterOptions = {},
): Promise<PresentedResponseError> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return presentBody(undefined, response.status, fallback, options, error);
  }
  let body: unknown = raw;
  let parseFailure: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    parseFailure = error;
    // See formatHydroErrorResponse: malformed transport data fails closed.
  }
  return presentBody(body, response.status, fallback, options, parseFailure);
}

export async function readHydroResponseError(response: Response, fallback: string, options: ErrorPresenterOptions = {}): Promise<string> {
  return (await presentHydroResponseError(response, fallback, options)).message;
}

/**
 * Run a Hydro request through the same visible error boundary when the browser
 * fails before any HTTP response exists. Response parsing remains the caller's
 * responsibility so successful endpoint behavior is unchanged.
 */
export async function fetchHydroResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallback = '请求失败',
  options: ErrorPresenterOptions = {},
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') {
      throw cause;
    }
    const traceId = (options.createTraceId || (() => `ui-${createRequestId()}`))();
    const diagnostic = cause instanceof Error ? cause : new Error(undefined, { cause });
    (options.report || defaultRequestReport)({ traceId, diagnostic });
    if (cause instanceof TypeError) throw new TypeError(fallback, { cause });
    throw new Error(fallback, { cause: diagnostic });
  }
}

/** Present the canonical payload embedded in a server-rendered error page. */
export function presentHydroErrorPayload(payload: unknown, fallback: string, options: ErrorPresenterOptions = {}): string {
  try {
    return parseHydroErrorPayload(payload).message;
  } catch {
    return presentBody({ error: payload }, undefined, fallback, options).message;
  }
}
