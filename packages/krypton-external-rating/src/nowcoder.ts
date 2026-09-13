/**
 * Nowcoder ACM rating client (HTML; there is no stable JSON user.info).
 *
 * Canonical GET (username-keyed; this is what the student typed):
 *   https://ac.nowcoder.com/acm/contest/rating-index?searchUserName={urlencoded exact nickname}
 *
 * Why this URL, not the personal homepage:
 *   ACM homepages are `/acm/contest/profile/{numericUid}` and 404/redirect when
 *   given a nickname. There is no nickname-keyed profile URL. Do not use
 *   www.nowcoder.com user search. Do not treat searchUserName as “first row
 *   wins”: it is a substring/school filter and will return similar nicknames.
 *
 * Parse contract (breakage must fail closed, not guess):
 *   1. Final URL host `ac.nowcoder.com`, path `/acm/contest/rating-index`.
 *   2. HTTP 404, title `页面找不到了`, or the board empty state
 *      `div.empty-tip-mod` + `p` text `暂无数据` with no `table.rating-data`
 *      → NowcoderUserNotFoundError. The board copy says only contestants from
 *      the last 6 months are listed; off-board accounts are not-found.
 *   3. Page must be the rating-index HTML: `<title>Rating排行榜` and
 *      `input[name=searchUserName]`. Anything else → malformed.
 *   4. Each `table.rating-data tr[data-uid]` has exactly 5 `<td>`:
 *        [0] Rating排名 — `span.rate-num` (ignored; never used as rating)
 *        [1] 用户名 — `a[href=/acm/contest/profile/{uid}] > span.rate-scoreN`
 *        [2] 学校
 *        [3] 简介
 *        [4] Rating — `span.rate-scoreN` whose text is an unsigned integer
 *      `rate-scoreN` is a color tier, not the score. Profile uid must equal
 *      `data-uid`.
 *   5. Keep a row only when the decoded username text equals the requested
 *      nickname (NFC, en-US case fold). Nowcoder’s own search is
 *      case-insensitive; substring hits such as `jianglyly` for `jiangly`
 *      are dropped. Zero exact rows → not-found. Two or more exact rows
 *      (nicknames are not unique) → malformed; never pick the higher rating.
 *
 * Timeout ~8s. No retries. No cookie/token logging.
 */

export const NOWCODER_RATING_INDEX_URL = 'https://ac.nowcoder.com/acm/contest/rating-index';
export const NOWCODER_RATING_INDEX_TIMEOUT_MS = 8000;
export const NOWCODER_MAX_HTML_CHARS = 1_000_000;
export const NOWCODER_MAX_NAME_CHARS = 128;

export type NowcoderFetchFailureKind = 'not_found' | 'network' | 'malformed';

export class NowcoderFetchError extends Error {
    readonly kind: NowcoderFetchFailureKind;
    readonly handle: string;

    constructor(kind: NowcoderFetchFailureKind, handle: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.kind = kind;
        this.handle = handle;
        this.name = nowcoderErrorName(kind);
    }
}

export class NowcoderUserNotFoundError extends NowcoderFetchError {
    constructor(handle: string, message?: string, options?: ErrorOptions) {
        super('not_found', handle, message ?? `Nowcoder user not found: ${handle}`, options);
    }
}

export class NowcoderNetworkError extends NowcoderFetchError {
    constructor(handle: string, message: string, options?: ErrorOptions) {
        super('network', handle, message, options);
    }
}

export class NowcoderMalformedError extends NowcoderFetchError {
    constructor(handle: string, message: string, options?: ErrorOptions) {
        super('malformed', handle, message, options);
    }
}

function nowcoderErrorName(kind: NowcoderFetchFailureKind): string {
    if (kind === 'not_found') return 'NowcoderUserNotFoundError';
    if (kind === 'network') return 'NowcoderNetworkError';
    return 'NowcoderMalformedError';
}

function logStage(level: 'info' | 'error', stage: string, handle: string, detail?: string): void {
    const line = detail
        ? `krypton-external-rating.nowcoder stage=${stage} name=${handle} ${detail}`
        : `krypton-external-rating.nowcoder stage=${stage} name=${handle}`;
    if (level === 'error') console.error(line);
    else console.info(line);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return 'unknown network error';
}

function isAbortError(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
        const name = 'name' in current && typeof current.name === 'string' ? current.name : '';
        if (name === 'AbortError' || name === 'TimeoutError') return true;
        current = 'cause' in current ? current.cause : undefined;
    }
    return false;
}

function throwNotFound(handle: string, message?: string): never {
    const error = new NowcoderUserNotFoundError(handle, message);
    logStage('error', 'not_found', handle, error.message);
    throw error;
}

function throwNetwork(handle: string, message: string, cause?: unknown): never {
    const error = new NowcoderNetworkError(handle, message, cause === undefined ? undefined : { cause });
    logStage('error', 'network', handle, message);
    throw error;
}

function throwMalformed(handle: string, message: string, cause?: unknown): never {
    const error = new NowcoderMalformedError(handle, message, cause === undefined ? undefined : { cause });
    logStage('error', 'malformed', handle, message);
    throw error;
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    circ: '\u02C6',
    tilde: '\u02DC',
    ndash: '\u2013',
    mdash: '\u2014',
    middot: '\u00B7',
    hellip: '\u2026',
    times: '\u00D7',
    plusmn: '\u00B1',
};

function decodeHtmlText(raw: string): string {
    return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, body: string) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = Number.parseInt(body.slice(2), 16);
            if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
            return String.fromCodePoint(code);
        }
        if (body.startsWith('#')) {
            const code = Number.parseInt(body.slice(1), 10);
            if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
            return String.fromCodePoint(code);
        }
        const mapped = NAMED_HTML_ENTITIES[body.toLowerCase()];
        return mapped === undefined ? entity : mapped;
    });
}

function namesEqual(left: string, right: string): boolean {
    return left.normalize('NFC').toLocaleLowerCase('en-US') === right.normalize('NFC').toLocaleLowerCase('en-US');
}

function normalizeName(name: string): string {
    if (typeof name !== 'string') {
        throwMalformed('', 'Nowcoder username must be a string');
    }
    const normalized = name.trim();
    if (!normalized) {
        throwMalformed(name, 'Nowcoder username is empty');
    }
    if (normalized.length > NOWCODER_MAX_NAME_CHARS) {
        throwMalformed(normalized, `Nowcoder username exceeds ${NOWCODER_MAX_NAME_CHARS} characters`);
    }
    if (/[\u0000-\u001f]/.test(normalized)) {
        throwMalformed(normalized, 'Nowcoder username must not contain control characters');
    }
    return normalized;
}

function collectTdInnerHtml(rowInner: string): string[] {
    const cells: string[] = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    for (const match of rowInner.matchAll(tdRe)) {
        cells.push(match[1]);
    }
    return cells;
}

function parseRatingRow(uid: string, rowInner: string, requestedName: string): { uid: string; rating: number } | null {
    const cells = collectTdInnerHtml(rowInner);
    if (cells.length !== 5) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} does not have 5 columns`);
    }
    if (!/<span class="rate-num\b/i.test(cells[0])) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} column 0 is not Rating排名`);
    }

    const nameMatch = cells[1].match(
        /<a\s+href="(?:https?:\/\/ac\.nowcoder\.com)?\/acm\/contest\/profile\/(\d+)"[^>]*>\s*<span class="rate-score\d+"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (!nameMatch) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} is missing the profile username span`);
    }
    if (nameMatch[1] !== uid) {
        throwMalformed(requestedName, `Nowcoder rating row data-uid=${uid} does not match profile href uid=${nameMatch[1]}`);
    }
    if (nameMatch[2].includes('<')) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} username span contains nested markup`);
    }
    const displayedName = decodeHtmlText(nameMatch[2]).trim();
    if (!displayedName) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} username is empty`);
    }

    const ratingMatch = cells[4].match(/<span class="rate-score\d+"[^>]*>\s*(\d+)\s*<\/span>/i);
    if (!ratingMatch) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} is missing the Rating span`);
    }
    const rating = Number(ratingMatch[1]);
    if (!Number.isInteger(rating)) {
        throwMalformed(requestedName, `Nowcoder rating row uid=${uid} rating is malformed`);
    }

    if (!namesEqual(displayedName, requestedName)) return null;
    return { uid, rating };
}

export function parseNowcoderRatingIndexHtml(html: string, name: string): { rating: number } {
    if (typeof html !== 'string') {
        throwMalformed(name, 'Nowcoder response is not text');
    }
    if (html.length > NOWCODER_MAX_HTML_CHARS) {
        throwMalformed(name, 'Nowcoder rating-index HTML exceeds size limit');
    }
    if (/<title>\s*页面找不到了/i.test(html)) {
        throwNotFound(name);
    }
    if (!/<title>\s*Rating排行榜/i.test(html) || !/\bname="searchUserName"/i.test(html)) {
        throwMalformed(name, 'Nowcoder response is not the ACM rating-index HTML');
    }

    const tableMatch = html.match(/<table\b[^>]*\brating-data\b[^>]*>([\s\S]*?)<\/table>/i);
    const emptyBoard = /<div class="empty-tip-mod"[\s\S]*?<p>\s*暂无数据\s*<\/p>/i.test(html);
    if (!tableMatch) {
        if (emptyBoard) throwNotFound(name);
        throwMalformed(name, 'Nowcoder rating-index is missing table.rating-data');
    }

    const exactMatches: { uid: string; rating: number }[] = [];
    const rowRe = /<tr\b[^>]*\bdata-uid="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let sawRow = false;
    for (const row of tableMatch[1].matchAll(rowRe)) {
        sawRow = true;
        const parsed = parseRatingRow(row[1], row[2], name);
        if (parsed) exactMatches.push(parsed);
    }
    if (!sawRow) {
        if (emptyBoard) throwNotFound(name);
        throwMalformed(name, 'Nowcoder rating-index table.rating-data has no data-uid rows');
    }
    if (exactMatches.length === 0) {
        throwNotFound(name);
    }
    if (exactMatches.length !== 1) {
        throwMalformed(name, `Nowcoder returned ${exactMatches.length} exact username matches; refusing to pick one`);
    }
    return { rating: exactMatches[0].rating };
}

function assertRatingIndexUrl(finalUrl: string, handle: string): void {
    let parsed: URL;
    try {
        parsed = new URL(finalUrl);
    } catch (error: unknown) {
        throwMalformed(handle, 'Nowcoder response URL is malformed', error);
    }
    if (parsed.hostname !== 'ac.nowcoder.com' || parsed.pathname !== '/acm/contest/rating-index') {
        throwMalformed(handle, `Nowcoder redirected away from rating-index to ${parsed.hostname}${parsed.pathname}`);
    }
}

async function fetchRatingIndex(url: string, handle: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NOWCODER_RATING_INDEX_TIMEOUT_MS);
    try {
        return await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'text/html',
                'User-Agent': 'KryptonOJ/external-rating',
            },
            signal: controller.signal,
        });
    } catch (error: unknown) {
        const timedOut = controller.signal.aborted || isAbortError(error);
        if (timedOut) {
            logStage('error', 'timeout', handle, `timeoutMs=${NOWCODER_RATING_INDEX_TIMEOUT_MS}`);
            throw new NowcoderNetworkError(
                handle,
                `Nowcoder request timed out after ${NOWCODER_RATING_INDEX_TIMEOUT_MS}ms`,
                { cause: error },
            );
        }
        throwNetwork(handle, `Nowcoder request failed: ${errorMessage(error)}`, error);
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchNowcoderRating(name: string): Promise<{ rating: number }> {
    const normalized = normalizeName(name);
    logStage('info', 'start', normalized);
    const url = `${NOWCODER_RATING_INDEX_URL}?searchUserName=${encodeURIComponent(normalized)}`;
    logStage('info', 'request', normalized);
    const response = await fetchRatingIndex(url, normalized);
    logStage('info', 'http', normalized, `status=${response.status}`);
    if (response.status === 404) {
        throwNotFound(normalized);
    }
    if (response.status !== 200) {
        throwNetwork(normalized, `Nowcoder HTTP ${response.status}`);
    }
    assertRatingIndexUrl(response.url, normalized);
    let html: string;
    try {
        html = await response.text();
    } catch (error: unknown) {
        throwNetwork(normalized, 'Nowcoder response body failed', error);
    }
    logStage('info', 'parse', normalized);
    const result = parseNowcoderRatingIndexHtml(html, normalized);
    logStage('info', 'success', normalized, `rating=${result.rating}`);
    return result;
}
