export interface HydroClientErrorPayload {
    name: string;
    errorCode: string;
    code: number;
    status: number;
    params: readonly unknown[];
    message: string;
    nested?: Readonly<Record<number, HydroClientErrorPayload>>;
    traceId?: string;
}

export interface HydroClientErrorPresentation {
    message: string;
    payload?: HydroClientErrorPayload;
    traceId?: string;
    diagnostic?: InvalidHydroErrorEnvelopeError;
}

export interface PresentHydroErrorOptions {
    fallback: string;
    createTraceId: () => string;
    expectedStatus?: number;
}

export class InvalidHydroErrorEnvelopeError extends TypeError {
    constructor(reason: string) {
        super(`Invalid Hydro error envelope: ${reason}`);
        this.name = 'InvalidHydroErrorEnvelopeError';
    }
}

const RESIDUAL_PLACEHOLDER = /\{\d+\}/;
const NESTED_KEY = /^(?:0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(source: Record<string, unknown>, field: string, path: string): string {
    const value = source[field];
    if (typeof value !== 'string' || !value.trim()) {
        throw new InvalidHydroErrorEnvelopeError(`${path}.${field} must be a non-empty string`);
    }
    return value;
}

function requiredStatus(source: Record<string, unknown>, field: 'code' | 'status', path: string): number {
    const value = source[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 400 || value > 599) {
        throw new InvalidHydroErrorEnvelopeError(`${path}.${field} must be an HTTP error status`);
    }
    return value;
}

export function parseHydroErrorPayload(value: unknown, path = 'error'): HydroClientErrorPayload {
    if (!isRecord(value)) throw new InvalidHydroErrorEnvelopeError(`${path} must be an object`);
    const message = requiredString(value, 'message', path);
    if (RESIDUAL_PLACEHOLDER.test(message)) {
        throw new InvalidHydroErrorEnvelopeError(`${path}.message contains an unresolved placeholder`);
    }
    const name = requiredString(value, 'name', path);
    const errorCode = requiredString(value, 'errorCode', path);
    const code = requiredStatus(value, 'code', path);
    const status = requiredStatus(value, 'status', path);
    if (code !== status) throw new InvalidHydroErrorEnvelopeError(`${path}.code and ${path}.status must match`);
    if (!Array.isArray(value.params)) throw new InvalidHydroErrorEnvelopeError(`${path}.params must be an array`);

    let nested: Record<number, HydroClientErrorPayload> | undefined;
    if (value.nested !== undefined) {
        if (!isRecord(value.nested)) throw new InvalidHydroErrorEnvelopeError(`${path}.nested must be an object`);
        nested = {};
        for (const [key, child] of Object.entries(value.nested)) {
            if (!NESTED_KEY.test(key)) throw new InvalidHydroErrorEnvelopeError(`${path}.nested has an invalid key`);
            nested[Number(key)] = parseHydroErrorPayload(child, `${path}.nested.${key}`);
        }
    }

    let traceId: string | undefined;
    if (value.traceId !== undefined) traceId = requiredString(value, 'traceId', path);
    return {
        name,
        errorCode,
        code,
        status,
        params: value.params,
        message,
        ...(nested && Object.keys(nested).length ? { nested } : {}),
        ...(traceId ? { traceId } : {}),
    };
}

export function parseHydroErrorEnvelope(value: unknown): HydroClientErrorPayload {
    if (!isRecord(value)) throw new InvalidHydroErrorEnvelopeError('response body must be an object');
    return parseHydroErrorPayload(value.error);
}

export function presentHydroErrorEnvelope(value: unknown, options: PresentHydroErrorOptions): HydroClientErrorPresentation {
    try {
        const payload = parseHydroErrorEnvelope(value);
        if (options.expectedStatus !== undefined) {
            if (!Number.isSafeInteger(options.expectedStatus) || options.expectedStatus < 400 || options.expectedStatus > 599) {
                throw new InvalidHydroErrorEnvelopeError('expectedStatus must be an HTTP error status');
            }
            if (payload.status !== options.expectedStatus) {
                throw new InvalidHydroErrorEnvelopeError('response status does not match error.status');
            }
        }
        return { message: payload.message, payload };
    } catch (error) {
        const diagnostic =
            error instanceof InvalidHydroErrorEnvelopeError ? error : new InvalidHydroErrorEnvelopeError('parsing failed unexpectedly');
        const traceId = options.createTraceId();
        if (typeof traceId !== 'string' || !traceId.trim()) {
            throw new TypeError('Client error trace ID generator returned an invalid value');
        }
        return {
            message: `${options.fallback}：服务器返回了无法解析的错误响应。错误编号：${traceId}`,
            traceId,
            diagnostic,
        };
    }
}
