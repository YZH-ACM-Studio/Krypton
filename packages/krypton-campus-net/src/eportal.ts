/**
 * Machine-room DrCOM EPortal login client (PLAN P4.1 / Grill G5).
 *
 * Live portal (oj, 2026-09-13): Vue SPA at http://192.168.4.252:801/eportal/,
 * nginx. Student auth is JSONP `/eportal/portal/login`, not srun/Ruijie
 * InterFace.cgi/.do (404) and not ACSetting (returns the admin SPA HTML).
 * loadConfig.login_method is "0"; login_method=1 returns 没有配置接入服务器.
 * The server reads credentials from the query string; a POST body alone is
 * ignored. Do not log the request URL (it contains the password).
 */

export const EPORTAL_ORIGIN = 'http://192.168.4.252:801';
export const EPORTAL_BASE_URL = `${EPORTAL_ORIGIN}/eportal/`;
export const EPORTAL_LOGIN_PATH = '/eportal/portal/login';
export const EPORTAL_LOGIN_URL = `${EPORTAL_ORIGIN}${EPORTAL_LOGIN_PATH}`;

/** Observed `loadConfig.data.login_method`. */
export const EPORTAL_LOGIN_METHOD = '0';
export const EPORTAL_JSONP_CALLBACK = 'dr1003';
export const EPORTAL_JS_VERSION = '4.1.3';
export const EPORTAL_LOGIN_TIMEOUT_MS = 10_000;

const MAX_LOGIN_BODY_CHARS = 1_000_000;
const DEFAULT_WLAN_USER_MAC = '000000000000';

const TIMEOUT_NAMES = new Set([
    'AbortError',
    'TimeoutError',
    'ConnectTimeoutError',
    'HeadersTimeoutError',
    'BodyTimeoutError',
]);

const TIMEOUT_CODES = new Set([
    'ABORT_ERR',
    'ETIMEDOUT',
    'UND_ERR_ABORTED',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
]);

export class EPortalLoginError extends Error {
    readonly code: string;

    constructor(message: string, code = 'eportal_login_failed') {
        super(message);
        this.name = 'EPortalLoginError';
        this.code = code;
    }
}

export interface EPortalLoginSuccess {
    alreadyOnline: boolean;
    msg: string;
}

export async function login(username: string, password: string): Promise<EPortalLoginSuccess> {
    if (typeof username !== 'string' || typeof password !== 'string') {
        throw new EPortalLoginError('eportal login requires string username and password', 'eportal_login_invalid_input');
    }
    if (username.length === 0 || password.length === 0) {
        throw new EPortalLoginError('eportal login requires non-empty username and password', 'eportal_login_invalid_input');
    }

    const params = buildLoginParams(username, password);
    const url = new URL(EPORTAL_LOGIN_URL);
    for (const [key, value] of params) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EPORTAL_LOGIN_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                Referer: EPORTAL_BASE_URL,
                'User-Agent': 'KryptonCampusNet/1.0',
            },
            body: params.toString(),
            redirect: 'error',
            signal: controller.signal,
        });
    } catch (error) {
        throw sanitizeNetworkError(error);
    } finally {
        clearTimeout(timer);
    }

    if (response.status !== 200) {
        throw new EPortalLoginError(`eportal login HTTP ${response.status}`, 'eportal_login_http');
    }

    let body: string;
    try {
        body = await response.text();
    } catch (error) {
        throw sanitizeNetworkError(error);
    }
    return parseEportalLoginBody(body);
}

export function parseEportalLoginBody(body: string): EPortalLoginSuccess {
    if (typeof body !== 'string' || body.trim().length === 0) {
        throw new EPortalLoginError('eportal login returned an empty body', 'eportal_login_empty');
    }
    if (body.length > MAX_LOGIN_BODY_CHARS) {
        throw new EPortalLoginError('eportal login response too large', 'eportal_login_too_large');
    }

    const trimmed = body.trim();
    if (/^</.test(trimmed) || /<html/i.test(trimmed)) {
        throw new EPortalLoginError('eportal login returned HTML, not JSONP', 'eportal_login_html');
    }

    const parsed = parseJsonpOrJson(trimmed);
    if (!isRecord(parsed)) {
        throw new EPortalLoginError('eportal login JSON is not an object', 'eportal_login_unknown_json');
    }
    if (!('result' in parsed)) {
        throw new EPortalLoginError(
            `eportal login JSON missing result (keys: ${Object.keys(parsed).sort().join(',')})`,
            'eportal_login_unknown_json',
        );
    }

    const msg = typeof parsed.msg === 'string' ? oneLine(parsed.msg) : '';
    if (isSuccessResult(parsed.result)) {
        return { alreadyOnline: false, msg: msg || 'ok' };
    }
    if (isAlreadyOnline(parsed)) {
        return { alreadyOnline: true, msg: msg || 'already online' };
    }
    if (isFailureResult(parsed.result)) {
        throw new EPortalLoginError(msg || `eportal login failed (result=${stringifyResult(parsed.result)})`);
    }

    throw new EPortalLoginError(
        `eportal login returned unknown result ${stringifyResult(parsed.result)}`,
        'eportal_login_unknown_json',
    );
}

function buildLoginParams(username: string, password: string): URLSearchParams {
    return new URLSearchParams({
        callback: EPORTAL_JSONP_CALLBACK,
        login_method: EPORTAL_LOGIN_METHOD,
        user_account: username,
        user_password: password,
        wlan_user_ip: '',
        wlan_user_ipv6: '',
        wlan_user_mac: DEFAULT_WLAN_USER_MAC,
        wlan_ac_ip: '',
        wlan_ac_name: '',
        jsVersion: EPORTAL_JS_VERSION,
        terminal_type: '1',
        lang: 'zh',
    });
}

function parseJsonpOrJson(body: string): unknown {
    if (body.startsWith('{') || body.startsWith('[')) {
        return parseJson(body, 'eportal login returned unparseable JSON');
    }
    const open = body.indexOf('(');
    const close = body.lastIndexOf(')');
    if (open <= 0 || close <= open) {
        throw new EPortalLoginError('eportal login returned unparseable JSONP', 'eportal_login_unparseable');
    }
    const callback = body.slice(0, open).trim();
    if (!/^[A-Za-z_][\w]*$/.test(callback)) {
        throw new EPortalLoginError('eportal login returned unparseable JSONP', 'eportal_login_unparseable');
    }
    const trailing = body.slice(close + 1).trim();
    if (trailing !== '' && trailing !== ';') {
        throw new EPortalLoginError('eportal login returned unparseable JSONP', 'eportal_login_unparseable');
    }
    return parseJson(body.slice(open + 1, close), 'eportal login returned unparseable JSONP');
}

function parseJson(text: string, message: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new EPortalLoginError(message, 'eportal_login_unparseable');
    }
}

function isSuccessResult(result: unknown): boolean {
    return result === 1 || result === '1' || result === 'ok' || result === 'OK';
}

function isFailureResult(result: unknown): boolean {
    return result === 0 || result === '0';
}

function isAlreadyOnline(payload: Record<string, unknown>): boolean {
    if (!isFailureResult(payload.result)) return false;
    return payload.ret_code === 2 || payload.ret_code === '2';
}

function stringifyResult(result: unknown): string {
    if (typeof result === 'string') return JSON.stringify(result);
    if (typeof result === 'number' || typeof result === 'boolean' || result === null) return String(result);
    return typeof result;
}

function sanitizeNetworkError(error: unknown): EPortalLoginError {
    const facts = collectErrorFacts(error);
    if (
        facts.names.some((name) => TIMEOUT_NAMES.has(name))
        || facts.codes.some((code) => TIMEOUT_CODES.has(code))
        || facts.messages.some((message) => /timeout|aborted/i.test(message))
    ) {
        return new EPortalLoginError('eportal login timeout', 'eportal_login_timeout');
    }
    const networkCode = facts.codes.find((code) => code.startsWith('E') || code.startsWith('UND_ERR_'));
    if (networkCode) {
        return new EPortalLoginError(`eportal login network error: ${networkCode}`, 'eportal_login_network');
    }
    return new EPortalLoginError('eportal login network error', 'eportal_login_network');
}

function isErrorLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function collectErrorFacts(error: unknown): { names: string[]; codes: string[]; messages: string[] } {
    const names: string[] = [];
    const codes: string[] = [];
    const messages: string[] = [];
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];
    while (stack.length) {
        const current = stack.pop();
        if (current == null || seen.has(current)) continue;
        seen.add(current);
        if (typeof current === 'string') {
            messages.push(current);
            continue;
        }
        if (!isErrorLike(current)) continue;
        if (typeof current.name === 'string') names.push(current.name);
        if (typeof current.code === 'string') codes.push(current.code);
        if (typeof current.message === 'string') messages.push(current.message);
        if ('cause' in current) stack.push(current.cause);
        if ('errors' in current && Array.isArray(current.errors)) {
            for (const nested of current.errors) stack.push(nested);
        }
    }
    return { names, codes, messages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}
