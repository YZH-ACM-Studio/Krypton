export interface ForceBindSubject {
    uid: number;
    role: string;
    isTemporary: boolean;
    hasEditSystem: boolean;
    bound: boolean;
}

const EXACT_ALLOWED_PATHS = new Set([
    '/',
    '/home',
    '/favicon.ico',
    '/manifest.json',
    '/api/collect/pending',
    '/api/announce/unread',
    '/api/announce/homepage',
]);

const PREFIX_ALLOWED_PATHS = [
    '/userbind',
    '/bind',
    '/login',
    '/logout',
    '/register',
    '/lostpass',
    '/sudo',
    '/oauth',
    '/exam-mode',
    '/paper',
    '/client-required-notice',
    '/home/security',
    '/home/messages',
];

/** `false` / `0` disable. Missing/unregistered values stay on (PLAN default). */
export function isForceBindEnabled(raw: unknown): boolean {
    if (raw === false || raw === 0) return false;
    if (raw === true || raw === 1 || raw === undefined || raw === null || raw === '') return true;
    throw new TypeError('userbind.forceBind must be a boolean');
}

export function wantsForceBindHtml(method: string, accept: string, isJson: boolean): boolean {
    return String(method || 'GET').toUpperCase() === 'GET' && accept.includes('text/html') && !isJson;
}

function normalizeForceBindPath(path: string): string {
    const queryIndex = path.indexOf('?');
    const withoutQuery = queryIndex === -1 ? path : path.slice(0, queryIndex);
    return withoutQuery === '' ? '/' : withoutQuery;
}

function pathHasAllowedPrefix(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(`${prefix}/`);
}

/** `request.path` without domain prefix. `/` and `/api` are never prefixes. */
export function pathIsForceBindAllowed(path: string): boolean {
    const normalized = normalizeForceBindPath(path);
    if (EXACT_ALLOWED_PATHS.has(normalized)) return true;
    return PREFIX_ALLOWED_PATHS.some((prefix) => pathHasAllowedPrefix(normalized, prefix));
}

export function shouldForceBindSubject(subject: ForceBindSubject): boolean {
    return subject.uid > 0
        && !subject.isTemporary
        && !subject.hasEditSystem
        && subject.role === 'default'
        && subject.bound === false;
}

export function decideForceBind(input: {
    enabled: boolean;
    subject: ForceBindSubject;
    path: string;
    method: string;
    wantsHtml: boolean;
}): 'allow' | 'redirect' | 'reject' {
    if (!input.enabled || !shouldForceBindSubject(input.subject) || pathIsForceBindAllowed(input.path)) {
        return 'allow';
    }
    return input.wantsHtml ? 'redirect' : 'reject';
}
