/**
 * Public-internet probe for the campus-net daemon.
 *
 * Same GET the 2026-09-13 grill used: Codeforces `user.info` for `tourist`.
 * Success is only HTTP 200 plus JSON `status === "OK"`. Any other outcome,
 * including timeout, DNS, TLS, non-200, or unparsable body, is `ok: false`.
 * This module does not read campus credentials and does not talk to DrCOM.
 */

export interface InternetProbeResult {
    ok: boolean;
    detail: string;
}

/** Grill-verified public endpoint. Do not add query params or switch hosts. */
export const INTERNET_PROBE_URL = 'https://codeforces.com/api/user.info?handles=tourist';

/** Whole-request budget: DNS, TLS, headers, and body. */
export const INTERNET_PROBE_TIMEOUT_MS = 8000;

const MAX_PROBE_BODY_CHARS = 1_000_000;

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

const DNS_CODES = new Set([
    'EAI_ADDRFAMILY',
    'EAI_AGAIN',
    'EAI_FAIL',
    'EAI_NODATA',
    'EAI_NONAME',
    'EAI_SYSTEM',
    'ENODATA',
    'ENOTFOUND',
]);

export async function probeInternet(): Promise<InternetProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INTERNET_PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(INTERNET_PROBE_URL, {
            method: 'GET',
            signal: controller.signal,
        });
        if (response.status !== 200) {
            return { ok: false, detail: `http ${response.status}` };
        }
        const body = await response.text();
        return parseCfProbeBody(body);
    } catch (error) {
        return { ok: false, detail: classifyProbeFailure(error) };
    } finally {
        clearTimeout(timer);
    }
}

function parseCfProbeBody(body: string): InternetProbeResult {
    if (body.length > MAX_PROBE_BODY_CHARS) {
        return { ok: false, detail: 'parse: response too large' };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { ok: false, detail: 'parse: response is not JSON' };
    }
    if (!isRecord(parsed)) {
        return { ok: false, detail: 'parse: response is not a JSON object' };
    }
    if (!('status' in parsed)) {
        return { ok: false, detail: 'parse: missing status' };
    }
    const status = parsed.status;
    if (status !== 'OK') {
        const shown = typeof status === 'string' ? status : typeof status;
        const comment = typeof parsed.comment === 'string' ? oneLine(parsed.comment) : '';
        return {
            ok: false,
            detail: comment ? `parse: status ${shown}: ${comment}` : `parse: status ${shown}`,
        };
    }
    return { ok: true, detail: 'http 200 status OK' };
}

function classifyProbeFailure(error: unknown): string {
    try {
        const facts = collectErrorFacts(error);
        if (
            facts.names.some((name) => TIMEOUT_NAMES.has(name))
            || facts.codes.some((code) => TIMEOUT_CODES.has(code))
            || facts.messages.some((message) => /timeout|aborted/i.test(message))
        ) {
            return 'timeout';
        }
        const dnsCode = facts.codes.find((code) => DNS_CODES.has(code));
        if (dnsCode) return `dns: ${dnsCode}`;
        const dnsFromMessage = matchDnsToken(facts.messages);
        if (dnsFromMessage) return `dns: ${dnsFromMessage}`;
        if (facts.messages.some((message) => /getaddrinfo/i.test(message))) {
            return 'dns';
        }
        const tlsCode = facts.codes.find((code) => isTlsCode(code));
        if (tlsCode) return `tls: ${tlsCode}`;
        if (facts.messages.some((message) => /certificate|\bSSL\b|\bTLS\b/i.test(message))) {
            return `tls: ${oneLine(facts.messages[0] || 'certificate error')}`;
        }
        const networkCode = facts.codes.find((code) => isNetworkCode(code));
        if (networkCode) return `network: ${networkCode}`;
        const message = facts.messages[0] || stringifyUnknown(error);
        return `error: ${oneLine(message)}`;
    } catch {
        return 'error: failed to classify probe failure';
    }
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
        if (typeof current !== 'object') continue;
        const name = getUnknownProp(current, 'name');
        const code = getUnknownProp(current, 'code');
        const message = getUnknownProp(current, 'message');
        if (typeof name === 'string') names.push(name);
        if (typeof code === 'string') codes.push(code);
        if (typeof message === 'string') messages.push(message);
        if ('cause' in current) stack.push(getUnknownProp(current, 'cause'));
        const nestedErrors = getUnknownProp(current, 'errors');
        if (Array.isArray(nestedErrors)) {
            for (const nested of nestedErrors) stack.push(nested);
        }
    }
    return { names, codes, messages };
}

function matchDnsToken(messages: string[]): string | null {
    for (const message of messages) {
        const matched = message.match(/ENOTFOUND|EAI_[A-Z]+|ENODATA/);
        if (matched) return matched[0];
    }
    return null;
}

function isTlsCode(code: string): boolean {
    return (
        code.includes('SSL')
        || code.includes('TLS')
        || code.includes('CERT')
        || code.startsWith('UNABLE_TO_VERIFY')
    );
}

function isNetworkCode(code: string): boolean {
    return code.startsWith('E') || code.startsWith('UND_ERR_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getUnknownProp(value: object, key: string): unknown {
    return (value as Record<string, unknown>)[key];
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function stringifyUnknown(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    return 'unknown probe failure';
}
