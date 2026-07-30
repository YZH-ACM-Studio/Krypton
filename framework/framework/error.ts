interface IHydroError {
    new (...args: any[]): HydroError;
}

export interface LocalizedErrorTemplate {
    template: string;
    params: readonly unknown[];
}

export interface LocalizedErrorMetadata {
    message?: LocalizedErrorTemplate;
    parameters: Map<number, LocalizedErrorTemplate>;
}

const localizedErrorMetadata = new WeakMap<HydroError, LocalizedErrorMetadata>();

export class LocalizedErrorText {
    readonly raw: string;
    readonly template: string;
    readonly params: readonly unknown[];

    constructor(strings: TemplateStringsArray, params: readonly unknown[]) {
        this.params = [...params];
        this.template = strings.reduce((result, part, index) => result + (index ? `{${index - 1}}` : '') + part, '');
        this.raw = strings.reduce((result, part, index) => result + (index ? String(params[index - 1]) : '') + part, '');
    }

    toString(): string {
        return this.raw;
    }
}

export function localizedErrorText(strings: TemplateStringsArray, ...params: readonly unknown[]): LocalizedErrorText {
    return new LocalizedErrorText(strings, params);
}

export class HydroError extends Error {
    params: any[];
    code: number;

    constructor(...params: any[]) {
        super();
        const parameters = new Map<number, LocalizedErrorTemplate>();
        this.params = params.map((value, index) => {
            if (!(value instanceof LocalizedErrorText)) return value;
            parameters.set(index, { template: value.template, params: value.params });
            return value.raw;
        });
        if (parameters.size) localizedErrorMetadata.set(this, { parameters });
    }

    msg() {
        return 'HydroError';
    }

    get message() {
        return this.msg();
    }
}

function setLocalizedTemplate(error: HydroError, target: 'message' | number, template: string, params: readonly unknown[]): void {
    if (!template) throw new TypeError('Localized error template must not be empty');
    const metadata = localizedErrorMetadata.get(error) || { parameters: new Map<number, LocalizedErrorTemplate>() };
    const value = { template, params: [...params] };
    if (target === 'message') metadata.message = value;
    else {
        if (!Number.isSafeInteger(target) || target < 0) throw new TypeError('Localized error parameter index must be non-negative');
        metadata.parameters.set(target, value);
    }
    localizedErrorMetadata.set(error, metadata);
}

export function localizeError<T extends HydroError>(error: T, template: string, ...params: readonly unknown[]): T {
    setLocalizedTemplate(error, 'message', template, params);
    return error;
}

export function localizeErrorParameter<T extends HydroError>(error: T, index: number, template: string, ...params: readonly unknown[]): T {
    setLocalizedTemplate(error, index, template, params);
    return error;
}

export function getLocalizedErrorMetadata(error: HydroError): Readonly<LocalizedErrorMetadata> | undefined {
    return localizedErrorMetadata.get(error);
}

const Err = (name: string, Class: IHydroError, ...info: Array<(() => string) | string | number>) => {
    let msg: () => string;
    let code: number;
    for (const item of info) {
        if (typeof item === 'number') {
            code = item;
        } else if (typeof item === 'string') {
            msg = function () {
                return item;
            };
        } else if (typeof item === 'function') {
            msg = item;
        }
    }
    // eslint-disable-next-line ts/no-shadow
    return class HydroError extends Class {
        name = name;
        constructor(...args: any[]) {
            super(...args);
            if (msg) this.msg = msg;
            if (code) this.code = code;
        }
    };
};

export const UserFacingError = Err('UserFacingError', HydroError, 'UserFacingError', 400);
export const SystemError = Err('SystemError', HydroError, 'SystemError', 500);

export const BadRequestError = Err('BadRequestError', UserFacingError, 'BadRequestError', 400);
export const ForbiddenError = Err('ForbiddenError', UserFacingError, 'ForbiddenError', 403);
export const NotFoundError = Err(
    'NotFoundError',
    UserFacingError,
    function (this: HydroError) {
        if (this.params.length >= 2) return '{0} {1} not found.';
        if (this.params.length === 1) return '{0} not found.';
        return 'NotFoundError';
    },
    404,
);
export const MethodNotAllowedError = Err('MethodNotAllowedError', UserFacingError, 'MethodNotAllowedError', 405);

export class HttpStatusError extends UserFacingError {
    name = 'HttpStatusError';

    constructor(status: number) {
        super(status);
        if (!Number.isSafeInteger(status) || status < 400 || status > 499) {
            throw new TypeError('HttpStatusError requires a 4xx status');
        }
        this.code = status;
        localizeError(this, 'Request failed (HTTP {0}).', status);
    }
}

export const ValidationError = Err('ValidationError', ForbiddenError, function (this: HydroError) {
    if (this.params.length === 3) {
        return this.params[1] ? 'Field {0} or {1} validation failed. ({2})' : 'Field {0} validation failed. ({2})';
    }
    return this.params[1] ? 'Field {0} or {1} validation failed.' : 'Field {0} validation failed.';
});
export const CsrfTokenError = Err('CsrfTokenError', ForbiddenError, 'CsrfTokenError');
export const InvalidOperationError = Err('InvalidOperationError', MethodNotAllowedError);
export const FileTooLargeError = Err('FileTooLargeError', ValidationError, 'The uploaded file is too long.');

export const CreateError = Err;
