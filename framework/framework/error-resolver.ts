import { getLocalizedErrorMetadata, HydroError, type LocalizedErrorTemplate, UserFacingError } from './error';

export type ErrorSurface = 'ui-next' | 'legacy-ui' | 'api' | 'websocket';

export interface ErrorLocaleFacts {
    surface: ErrorSurface;
    authenticated: boolean;
    userLocale?: string | null;
    sessionLocale?: string | null;
    requestLocales?: readonly string[];
    domainLocale: string;
}

export interface ErrorMessageDescriptor {
    name: string;
    errorCode: string;
    status: number;
    template: string;
    params: readonly unknown[];
    messageParams: Readonly<Record<number, unknown>>;
    nested?: Readonly<Record<number, ErrorMessageDescriptor>>;
}

export interface ResolvedErrorMessage extends ErrorMessageDescriptor {
    locale: string;
    message: string;
    nested?: Readonly<Record<number, ResolvedErrorMessage>>;
}

export type ErrorMessageFailureReason =
    | 'invalid_descriptor'
    | 'missing_translation'
    | 'translation_lookup_failed'
    | 'malformed_template'
    | 'placeholder_mismatch'
    | 'parameter_mismatch'
    | 'invalid_parameter'
    | 'unresolved_placeholder';

export interface ResolveErrorMessageOptions {
    locale: string;
    lookup: (template: string, locale: string) => string | null | undefined;
    createTraceId?: () => string;
}

export interface ErrorTransportPayload {
    name: string;
    errorCode: string;
    code: number;
    status: number;
    params: readonly unknown[];
    message: string;
    nested?: Readonly<Record<number, ErrorTransportPayload>>;
    traceId?: string;
}

export interface ResolvedErrorTransport {
    status: number;
    template: 'error.html' | 'bsod.html';
    userFacing: boolean;
    error: ErrorTransportPayload;
    traceId?: string;
    /**
     * Server-side diagnostics only. Never copy this value into a response body
     * or WebSocket frame.
     */
    internalError?: Error;
}

export type ResolveErrorTransportOptions = ResolveErrorMessageOptions;

interface ResolutionFailureInput {
    reason: ErrorMessageFailureReason;
    traceId: string;
    errorName: string;
    locale: string;
    template: string;
    parameterTypes: readonly string[];
    cause?: unknown;
}

export class ErrorMessageResolutionError extends Error {
    readonly reason: ErrorMessageFailureReason;
    readonly traceId: string;
    readonly errorName: string;
    readonly locale: string;
    readonly template: string;
    readonly parameterTypes: readonly string[];

    constructor(input: ResolutionFailureInput) {
        super(`Error message resolution failed [${input.traceId}] (${input.reason}: ${input.errorName}, ${input.locale})`, {
            cause: input.cause,
        });
        this.name = 'ErrorMessageResolutionError';
        this.reason = input.reason;
        this.traceId = input.traceId;
        this.errorName = input.errorName;
        this.locale = input.locale;
        this.template = input.template;
        this.parameterTypes = input.parameterTypes;
    }
}

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
const RESIDUAL_PLACEHOLDER_PATTERN = /\{\d+\}/;

export interface ErrorTraceCrypto {
    randomUUID?: () => string;
    getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

function normalizeLocale(locale: string, source: string): string {
    const value = locale.trim();
    if (!value || !LOCALE_PATTERN.test(value)) throw new TypeError(`${source} contains an invalid locale`);
    return value
        .replace(/_/g, '-')
        .split('-')
        .map((part, index) => {
            if (index === 0) return part.toLowerCase();
            if (part.length === 2 || /^\d{3}$/.test(part)) return part.toUpperCase();
            if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
            return part;
        })
        .join('-');
}

export function resolveErrorLocale(facts: ErrorLocaleFacts): string {
    const domainLocale = normalizeLocale(facts.domainLocale, 'domainLocale');
    if (facts.surface === 'ui-next') return 'zh-CN';
    if (!facts.authenticated) return domainLocale;

    const candidates: Array<[string, string | null | undefined]> = [
        ['userLocale', facts.userLocale],
        ['sessionLocale', facts.sessionLocale],
    ];
    for (const [source, candidate] of candidates) {
        if (candidate) return normalizeLocale(candidate, source);
    }
    const requestLocale = facts.requestLocales?.find((locale) => locale && locale !== '*');
    if (requestLocale) return normalizeLocale(requestLocale, 'requestLocales[0]');
    return domainLocale;
}

function describeParameter(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Error) return `error:${value.name}`;
    return typeof value;
}

export function createErrorTraceId(cryptoApi: ErrorTraceCrypto | undefined = globalThis.crypto as ErrorTraceCrypto): string {
    if (typeof cryptoApi?.randomUUID === 'function') return `error-${cryptoApi.randomUUID()}`;
    if (typeof cryptoApi?.getRandomValues !== 'function') {
        throw new TypeError('A secure random source is required to create an error trace ID');
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `error-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameIndexes(left: ReadonlySet<number>, right: ReadonlySet<number>) {
    if (left.size !== right.size) return false;
    for (const index of left) {
        if (!right.has(index)) return false;
    }
    return true;
}

function scalarParameter(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
    return null;
}

export function resolveErrorMessage(descriptor: ErrorMessageDescriptor, options: ResolveErrorMessageOptions): ResolvedErrorMessage {
    const locale = normalizeLocale(options.locale, 'locale');
    let traceId: string | undefined;
    const parameterTypes = Array.isArray(descriptor?.params) ? descriptor.params.map(describeParameter) : [];
    const fail = (reason: ErrorMessageFailureReason, cause?: unknown): never => {
        traceId ||= (options.createTraceId || createErrorTraceId)();
        throw new ErrorMessageResolutionError({
            reason,
            traceId,
            errorName: descriptor?.name || 'UnknownError',
            locale,
            template: descriptor?.template || '',
            parameterTypes,
            cause,
        });
    };

    if (
        !descriptor ||
        typeof descriptor.name !== 'string' ||
        !descriptor.name ||
        typeof descriptor.errorCode !== 'string' ||
        !descriptor.errorCode ||
        !Number.isInteger(descriptor.status) ||
        descriptor.status < 100 ||
        descriptor.status > 599 ||
        typeof descriptor.template !== 'string' ||
        !descriptor.template ||
        !Array.isArray(descriptor.params) ||
        !descriptor.messageParams ||
        typeof descriptor.messageParams !== 'object' ||
        Array.isArray(descriptor.messageParams)
    ) {
        fail('invalid_descriptor');
    }

    const parseIndexes = (template: string): Set<number> => {
        const indexes = new Set<number>();
        for (let offset = 0; offset < template.length; offset++) {
            const character = template[offset];
            if (character === '}') fail('malformed_template');
            if (character !== '{') continue;
            const end = template.indexOf('}', offset + 1);
            if (end === -1) fail('malformed_template');
            const token = template.slice(offset + 1, end);
            if (!/^(?:0|[1-9]\d*)$/.test(token)) fail('malformed_template');
            const index = Number(token);
            if (!Number.isSafeInteger(index)) fail('malformed_template');
            indexes.add(index);
            offset = end;
        }
        return indexes;
    };

    const sourceIndexes = parseIndexes(descriptor.template);
    let localizedTemplate: string | null | undefined;
    try {
        localizedTemplate = options.lookup(descriptor.template, locale);
    } catch (error) {
        fail('translation_lookup_failed', error);
    }
    if (typeof localizedTemplate !== 'string' || !localizedTemplate) fail('missing_translation');
    const localizedIndexes = parseIndexes(localizedTemplate);
    if (!sameIndexes(sourceIndexes, localizedIndexes)) fail('placeholder_mismatch');

    const messageParamIndexes = new Set<number>();
    for (const key of Object.keys(descriptor.messageParams)) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key) fail('parameter_mismatch');
        messageParamIndexes.add(index);
    }
    if (!sameIndexes(sourceIndexes, messageParamIndexes)) fail('parameter_mismatch');

    const nestedDescriptors = descriptor.nested || {};
    for (const key of Object.keys(nestedDescriptors)) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || !sourceIndexes.has(index)) fail('parameter_mismatch');
    }

    const nested: Record<number, ResolvedErrorMessage> = {};
    const displayParams: Record<number, string> = {};
    for (const index of sourceIndexes) {
        const value = descriptor.messageParams[index];
        const child = nestedDescriptors[index];
        if (child) {
            nested[index] = resolveInternal(child);
            displayParams[index] = nested[index].message;
            continue;
        }
        const scalar = scalarParameter(value);
        if (scalar === null) fail('invalid_parameter');
        displayParams[index] = scalar;
    }

    const message = localizedTemplate.replace(/\{\d+\}/g, (token) => displayParams[Number(token.slice(1, -1))]);
    if (RESIDUAL_PLACEHOLDER_PATTERN.test(message)) fail('unresolved_placeholder');

    const { nested: _nestedDescriptors, ...baseDescriptor } = descriptor;
    return {
        ...baseDescriptor,
        locale,
        message,
        ...(Object.keys(nested).length ? { nested } : {}),
    };

    function resolveInternal(child: ErrorMessageDescriptor): ResolvedErrorMessage {
        return resolveErrorMessage(child, {
            ...options,
            locale,
            createTraceId: () => {
                traceId ||= (options.createTraceId || createErrorTraceId)();
                return traceId;
            },
        });
    }
}

export function describeHydroError(error: HydroError): ErrorMessageDescriptor {
    const params = [...(error.params || [])];
    let dynamicTemplate!: string;
    let dynamicParams!: unknown[];
    try {
        dynamicTemplate = error.msg();
        dynamicParams = [...(error.params || [])];
    } finally {
        error.params.splice(0, error.params.length, ...params);
    }
    const metadata = getLocalizedErrorMetadata(error);
    const parameterZeroTemplate = metadata?.parameters.get(0);
    const promotesParameterZero =
        !metadata?.message &&
        !!parameterZeroTemplate &&
        (dynamicTemplate === dynamicParams[0] ||
            ['BadRequestError', 'ForbiddenError', 'MethodNotAllowedError', 'UserFacingError'].includes(error.name));
    const promotedTemplate = promotesParameterZero ? parameterZeroTemplate : undefined;
    const template = metadata?.message?.template || promotedTemplate?.template || dynamicTemplate;
    const templateParams = metadata?.message?.params || promotedTemplate?.params || dynamicParams;
    const describeTemplate = (
        name: string,
        errorCode: string,
        status: number,
        sourceTemplate: string,
        rawParams: readonly unknown[],
    ): ErrorMessageDescriptor => {
        const messageParams: Record<number, unknown> = {};
        const nested: Record<number, ErrorMessageDescriptor> = {};
        for (const match of sourceTemplate.matchAll(/\{(0|[1-9]\d*)\}/g)) {
            const index = Number(match[1]);
            messageParams[index] = rawParams[index];
            if (rawParams[index] instanceof HydroError) nested[index] = describeHydroError(rawParams[index]);
        }
        return {
            name,
            errorCode,
            status,
            template: sourceTemplate,
            params: rawParams,
            messageParams,
            ...(Object.keys(nested).length ? { nested } : {}),
        };
    };
    const descriptor = describeTemplate(error.name, error.name, error.code, template, templateParams);
    descriptor.params = params;
    const nested = { ...(descriptor.nested || {}) };
    const describeParameterTemplate = (index: number, value: LocalizedErrorTemplate) => {
        nested[index] = describeTemplate(`${error.name}.Parameter`, `${error.name}.Parameter`, error.code, value.template, value.params);
    };
    for (const [index, value] of metadata?.parameters || []) {
        if (promotesParameterZero && index === 0) continue;
        describeParameterTemplate(index, value);
    }
    if (Object.keys(nested).length) descriptor.nested = nested;
    else delete descriptor.nested;
    return descriptor;
}

const SAFE_INTERNAL_ERROR_TEMPLATE = 'Unexpected server error. Reference: {0}';

function toTransportPayload(error: ResolvedErrorMessage): ErrorTransportPayload {
    const nested = Object.fromEntries(Object.entries(error.nested || {}).map(([index, child]) => [index, toTransportPayload(child)])) as Record<
        number,
        ErrorTransportPayload
    >;
    return {
        name: error.name,
        errorCode: error.errorCode,
        code: error.status,
        status: error.status,
        params: error.params,
        message: error.message,
        ...(Object.keys(nested).length ? { nested } : {}),
    };
}

function resolveSafeInternalErrorMessage(
    locale: string,
    traceId: string,
    options: ResolveErrorTransportOptions,
): { message: string; failure?: Error } {
    try {
        return {
            message: resolveErrorMessage(
                {
                    name: 'SystemError',
                    errorCode: 'SystemError',
                    status: 500,
                    template: SAFE_INTERNAL_ERROR_TEMPLATE,
                    params: [traceId],
                    messageParams: { 0: traceId },
                },
                {
                    ...options,
                    locale,
                    createTraceId: () => traceId,
                },
            ).message,
        };
    } catch (error) {
        const normalized = locale.replace(/_/g, '-').toLowerCase();
        return {
            message:
                normalized === 'en' || normalized.startsWith('en-')
                    ? `Unexpected server error. Reference: ${traceId}`
                    : `服务器发生了未预期错误。错误编号：${traceId}`,
            failure: error instanceof Error ? error : new Error('Safe error message resolution failed', { cause: error }),
        };
    }
}

function safeInternalErrorTransport(
    locale: string,
    traceId: string,
    internalError: Error,
    options: ResolveErrorTransportOptions,
): ResolvedErrorTransport {
    const safeMessage = resolveSafeInternalErrorMessage(locale, traceId, options);
    return {
        status: 500,
        template: 'bsod.html',
        userFacing: false,
        traceId,
        internalError: safeMessage.failure
            ? new AggregateError([internalError, safeMessage.failure], `Error transport failed closed [${traceId}]`)
            : internalError,
        error: {
            name: 'SystemError',
            errorCode: 'SystemError',
            code: 500,
            status: 500,
            params: [],
            message: safeMessage.message,
            traceId,
        },
    };
}

export function resolveErrorTransport(error: unknown, options: ResolveErrorTransportOptions): ResolvedErrorTransport {
    if (!(error instanceof UserFacingError)) {
        const traceId = (options.createTraceId || createErrorTraceId)();
        const internalError = error instanceof Error ? error : new Error('Non-error value reached the error transport', { cause: error });
        return safeInternalErrorTransport(options.locale, traceId, internalError, options);
    }

    try {
        const resolved = resolveErrorMessage(describeHydroError(error), options);
        return {
            status: resolved.status,
            template: 'error.html',
            userFacing: true,
            error: toTransportPayload(resolved),
        };
    } catch (resolutionError) {
        const internalError =
            resolutionError instanceof Error
                ? resolutionError
                : new Error('Non-error value interrupted error transport resolution', { cause: resolutionError });
        const traceId =
            resolutionError instanceof ErrorMessageResolutionError ? resolutionError.traceId : (options.createTraceId || createErrorTraceId)();
        return safeInternalErrorTransport(options.locale, traceId, internalError, options);
    }
}
