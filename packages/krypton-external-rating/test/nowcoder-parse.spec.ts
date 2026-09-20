import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';
import {
    NOWCODER_RATING_HISTORY_URL,
    NOWCODER_RATING_INDEX_TIMEOUT_MS,
    NOWCODER_RATING_INDEX_URL,
    NowcoderMalformedError,
    NowcoderNetworkError,
    NowcoderUserNotFoundError,
    fetchNowcoderRating,
    fetchNowcoderRatingHistory,
    parseNowcoderRatingHistoryJson,
    parseNowcoderRatingIndexHtml,
} from '../src/nowcoder';

type FetchInit = RequestInit | undefined;
type FetchStub = (url: string, init: FetchInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`unexpected live network call: ${String(input)}`);
};

const NAME = 'jiangly';
const SIMILAR_NAME = 'jianglyly';
const EXACT_UID = '111111';
const SIMILAR_UID = '222222';
const DUP_UID = '333333';
const EXACT_RATING = 2800;
const SIMILAR_RATING = 9999;
const DUP_RATING = 1000;

function ratingIndexPage(body: string): string {
    return [
        '<html><head><title>Rating排行榜</title></head><body>',
        `<input name="searchUserName" value="${NAME}">`,
        body,
        '</body></html>',
    ].join('');
}

function ratingRow(uid: string, name: string, rating: number, rank: number): string {
    return [
        `<tr data-uid="${uid}">`,
        `<td><span class="rate-num">${rank}</span></td>`,
        `<td><a href="/acm/contest/profile/${uid}"><span class="rate-score5">${name}</span></a></td>`,
        '<td>school</td>',
        '<td>bio</td>',
        `<td><span class="rate-score5">${rating}</span></td>`,
        '</tr>',
    ].join('');
}

function ratingTable(rows: string[]): string {
    return `<table class="rating-data">${rows.join('')}</table>`;
}

function exactMatchHtml(): string {
    return ratingIndexPage(ratingTable([
        ratingRow(SIMILAR_UID, SIMILAR_NAME, SIMILAR_RATING, 1),
        ratingRow(EXACT_UID, NAME, EXACT_RATING, 2),
    ]));
}

function similarOnlyHtml(): string {
    return ratingIndexPage(ratingTable([
        ratingRow(SIMILAR_UID, SIMILAR_NAME, SIMILAR_RATING, 1),
    ]));
}

function twoExactMatchesHtml(): string {
    return ratingIndexPage(ratingTable([
        ratingRow(EXACT_UID, NAME, SIMILAR_RATING, 1),
        ratingRow(DUP_UID, NAME, DUP_RATING, 2),
    ]));
}

function emptyBoardHtml(): string {
    return ratingIndexPage('<div class="empty-tip-mod"><p>暂无数据</p></div>');
}

function expectedSearchUrl(name: string): string {
    return `${NOWCODER_RATING_INDEX_URL}?searchUserName=${encodeURIComponent(name)}`;
}

function expectedHistoryUrl(uid: string): string {
    return `${NOWCODER_RATING_HISTORY_URL}?uid=${encodeURIComponent(uid)}`;
}

function htmlResponse(body: string, url: string, status = 200): Response {
    const response = new Response(body, {
        status,
        headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

function jsonResponse(body: unknown, url: string, status = 200): Response {
    const response = new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

const HISTORY_TIME_A = 1_700_000_000_000;
const HISTORY_TIME_B = 1_700_000_100_000;
const HISTORY_CONTEST_A = 1001;
const HISTORY_CONTEST_B = 1002;

const EMPTY_HISTORY_JSON = '{"code":0,"data":[]}';

function historyPoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        contestId: HISTORY_CONTEST_A,
        rating: 1500,
        rank: 12,
        changeValue: 80,
        time: HISTORY_TIME_A,
        contestName: 'Nowcoder Round',
        colorLevel: 3,
        ...overrides,
    };
}

function historyEnvelope(data: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { code: 0, data, ...extra };
}

const TWO_POINT_HISTORY_JSON = JSON.stringify(historyEnvelope(
    [
        historyPoint(),
        historyPoint({
            contestId: HISTORY_CONTEST_B,
            rating: 1450,
            rank: 30,
            changeValue: -50,
            time: HISTORY_TIME_B,
            contestName: 'Foo &amp; Bar',
            colorLevel: 4,
        }),
    ],
    { msg: 'OK' },
));

const TWO_POINT_HISTORY_ENTRIES = [
    {
        ratedAt: new Date(HISTORY_TIME_A),
        rating: 1500,
        contestKey: '1001',
        oldRating: 1420,
        rank: 12,
        contestName: 'Nowcoder Round',
    },
    {
        ratedAt: new Date(HISTORY_TIME_B),
        rating: 1450,
        contestKey: '1002',
        oldRating: 1500,
        rank: 30,
        contestName: 'Foo & Bar',
    },
];

let stub: FetchStub | null = null;
const fetchCalls: { url: string; init: FetchInit }[] = [];

beforeEach(() => {
    stub = null;
    fetchCalls.length = 0;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        fetchCalls.push({ url, init });
        if (!stub) throw new Error(`unexpected live network call: ${url}`);
        return stub(url, init);
    }) as typeof fetch;
});

after(() => {
    globalThis.fetch = originalFetch;
});

function expectNamedSync(run: () => unknown, name: string): Error {
    try {
        run();
    } catch (error) {
        expect((error as Error).name).to.equal(name);
        return error as Error;
    }
    expect.fail(`expected ${name}`);
    throw new Error('unreachable');
}

async function expectNamed(run: () => Promise<unknown>, name: string): Promise<Error> {
    try {
        await run();
    } catch (error) {
        expect((error as Error).name).to.equal(name);
        return error as Error;
    }
    expect.fail(`expected ${name}`);
    throw new Error('unreachable');
}

function stubHtml(html: string, status = 200, urlOverride?: string): void {
    stub = async (url) => htmlResponse(html, urlOverride ?? url, status);
}

function stubJson(body: unknown, status = 200, urlOverride?: string): void {
    stub = async (url) => jsonResponse(body, urlOverride ?? url, status);
}

async function hangUntilAbort(_url: string, init: FetchInit): Promise<Response> {
    const signal = init?.signal;
    if (signal == null) {
        expect.fail('hangUntilAbort requires AbortSignal');
    }
    await new Promise<never>((_resolve, reject) => {
        const fail = () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
        };
        if (signal.aborted) {
            fail();
            return;
        }
        signal.addEventListener('abort', fail, { once: true });
    });
    throw new Error('unreachable: hangUntilAbort resolved');
}

function expectNowcoderSearch(name: string): void {
    expect(fetchCalls).to.have.lengthOf(1);
    expect(fetchCalls[0].url).to.equal(expectedSearchUrl(name));
    expect(fetchCalls[0].url).to.not.include('www.nowcoder.com');
    expect(fetchCalls[0].init?.method).to.equal('GET');
}

function expectNowcoderHistory(uid: string): void {
    expect(fetchCalls).to.have.lengthOf(1);
    const parsed = new URL(fetchCalls[0].url);
    expect(`${parsed.origin}${parsed.pathname}`).to.equal(NOWCODER_RATING_HISTORY_URL);
    expect(parsed.searchParams.get('uid')).to.equal(uid);
    expect(parsed.searchParams.has('userId')).to.equal(false);
    expect(fetchCalls[0].url).to.equal(expectedHistoryUrl(uid));
    expect(fetchCalls[0].url).to.not.include('www.nowcoder.com');
    expect(fetchCalls[0].init?.method).to.equal('GET');
    expect(fetchCalls[0].init?.headers).to.deep.include({
        Accept: 'application/json',
        'User-Agent': 'KryptonOJ/external-rating',
    });
}

describe('parseNowcoderRatingIndexHtml', { concurrency: false }, () => {
    it('returns the rating for an exact username match and ignores a similar nickname', () => {
        const parsed = parseNowcoderRatingIndexHtml(exactMatchHtml(), NAME);
        expect(parsed).to.deep.equal({ rating: EXACT_RATING, uid: EXACT_UID });
        expect(parsed.rating).to.not.equal(SIMILAR_RATING);
        expect(parsed.uid).to.not.equal(SIMILAR_UID);
        expect(typeof parsed.uid).to.equal('string');
    });

    it('does not pick a similar nickname when there is no exact match', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingIndexHtml(similarOnlyHtml(), NAME),
            'NowcoderUserNotFoundError',
        );
        expect(error).to.be.instanceOf(NowcoderUserNotFoundError);
        expect(error.message).to.not.match(new RegExp(String(SIMILAR_RATING)));
    });

    it('fails closed as malformed when two exact username matches exist', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingIndexHtml(twoExactMatchesHtml(), NAME),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/2 exact username matches/i);
        expect(error.message).to.match(/refusing to pick one/i);
    });

    it('treats an empty rating board as not_found', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingIndexHtml(emptyBoardHtml(), NAME),
            'NowcoderUserNotFoundError',
        );
        expect(error).to.be.instanceOf(NowcoderUserNotFoundError);
    });
});

describe('fetchNowcoderRating export', { concurrency: false }, () => {
    it('fetches rating-index HTML and returns the exact username match', async () => {
        stubHtml(exactMatchHtml());
        const fetched = await fetchNowcoderRating(NAME);
        expect(fetched).to.deep.equal({ rating: EXACT_RATING, uid: EXACT_UID });
        expect(fetched.rating).to.not.equal(SIMILAR_RATING);
        expect(fetched.uid).to.not.equal(SIMILAR_UID);
        expectNowcoderSearch(NAME);
    });

    it('does not pick a similar nickname from the mocked board', async () => {
        stubHtml(similarOnlyHtml());
        const error = await expectNamed(() => fetchNowcoderRating(NAME), 'NowcoderUserNotFoundError');
        expect(error).to.be.instanceOf(NowcoderUserNotFoundError);
        expectNowcoderSearch(NAME);
    });

    it('throws malformed when the mocked board has two exact username matches', async () => {
        stubHtml(twoExactMatchesHtml());
        const error = await expectNamed(() => fetchNowcoderRating(NAME), 'NowcoderMalformedError');
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/2 exact username matches/i);
        expectNowcoderSearch(NAME);
    });

    it('throws not_found when the mocked rating board is empty', async () => {
        stubHtml(emptyBoardHtml());
        const error = await expectNamed(() => fetchNowcoderRating(NAME), 'NowcoderUserNotFoundError');
        expect(error).to.be.instanceOf(NowcoderUserNotFoundError);
        expectNowcoderSearch(NAME);
    });
});

describe('parseNowcoderRatingHistoryJson', { concurrency: false }, () => {
    it('parses history JSON fixtures into dated entries and ignores extra msg/colorLevel', () => {
        const parsed = parseNowcoderRatingHistoryJson(TWO_POINT_HISTORY_JSON, EXACT_UID);
        expect(parsed).to.deep.equal(TWO_POINT_HISTORY_ENTRIES);
        expect(parsed[0]).to.not.have.property('colorLevel');
        expect(parsed[0]).to.not.have.property('contestId');
        expect(parsed[0].contestKey).to.equal(String(HISTORY_CONTEST_A));
        expect(parsed[1].oldRating).to.equal(1450 - (-50));
    });

    it('treats empty data as success, not not_found', () => {
        const parsed = parseNowcoderRatingHistoryJson(EMPTY_HISTORY_JSON, EXACT_UID);
        expect(parsed).to.deep.equal([]);
        const fromObject = parseNowcoderRatingHistoryJson(historyEnvelope([]), EXACT_UID);
        expect(fromObject).to.deep.equal([]);
    });

    it('fails closed when code is not 0 or data is not an array', () => {
        const codeError = expectNamedSync(
            () => parseNowcoderRatingHistoryJson({ code: 1, data: [] }, EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(codeError).to.be.instanceOf(NowcoderMalformedError);
        const dataError = expectNamedSync(
            () => parseNowcoderRatingHistoryJson({ code: 0, data: {} }, EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(dataError).to.be.instanceOf(NowcoderMalformedError);
    });

    it('rejects a non-integer rating such as 1877.5', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(historyEnvelope([historyPoint({ rating: 1877.5 })]), EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/rating is malformed/i);
    });

    it('rejects unix-seconds timestamps', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(historyEnvelope([historyPoint({ time: 1_700_000_000 })]), EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/unix milliseconds/i);
    });

    it('rejects duplicate contestId', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(
                historyEnvelope([
                    historyPoint(),
                    historyPoint({ time: HISTORY_TIME_B }),
                ]),
                EXACT_UID,
            ),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/duplicate contestId/i);
    });

    it('rejects time that is not strictly increasing in array order', () => {
        const equal = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(
                historyEnvelope([
                    historyPoint(),
                    historyPoint({ contestId: HISTORY_CONTEST_B }),
                ]),
                EXACT_UID,
            ),
            'NowcoderMalformedError',
        );
        expect(equal.message).to.match(/strictly increasing/i);
        const decreasing = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(
                historyEnvelope([
                    historyPoint({ time: HISTORY_TIME_B }),
                    historyPoint({ contestId: HISTORY_CONTEST_B, time: HISTORY_TIME_A }),
                ]),
                EXACT_UID,
            ),
            'NowcoderMalformedError',
        );
        expect(decreasing.message).to.match(/strictly increasing/i);
    });

    it('rejects a decoded contestName that contains <', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(
                historyEnvelope([historyPoint({ contestName: 'Foo &lt;Bar&gt;' })]),
                EXACT_UID,
            ),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/contestName contains markup/i);
    });

    it('rejects rank below 1', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson(historyEnvelope([historyPoint({ rank: 0 })]), EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/rank is malformed/i);
    });

    it('treats an HTML body as malformed', () => {
        const error = expectNamedSync(
            () => parseNowcoderRatingHistoryJson('<html><title>Rating排行榜</title></html>', EXACT_UID),
            'NowcoderMalformedError',
        );
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/not valid JSON/i);
    });
});

describe('fetchNowcoderRatingHistory export', { concurrency: false }, () => {
    it('GETs rating-history?uid= and returns parsed entries', async () => {
        stubJson(JSON.parse(TWO_POINT_HISTORY_JSON));
        const fetched = await fetchNowcoderRatingHistory(EXACT_UID);
        expect(fetched).to.deep.equal(TWO_POINT_HISTORY_ENTRIES);
        expectNowcoderHistory(EXACT_UID);
    });

    it('returns an empty array for data:[] instead of not_found', async () => {
        stubJson(JSON.parse(EMPTY_HISTORY_JSON));
        const fetched = await fetchNowcoderRatingHistory(EXACT_UID);
        expect(fetched).to.deep.equal([]);
        expectNowcoderHistory(EXACT_UID);
    });

    it('throws not_found on HTTP 404', async () => {
        stubJson({ code: 0, data: [] }, 404);
        const error = await expectNamed(() => fetchNowcoderRatingHistory(EXACT_UID), 'NowcoderUserNotFoundError');
        expect(error).to.be.instanceOf(NowcoderUserNotFoundError);
        expectNowcoderHistory(EXACT_UID);
    });

    it('throws network on a non-404 HTTP error', async () => {
        stubJson({ code: 0, data: [] }, 500);
        const error = await expectNamed(() => fetchNowcoderRatingHistory(EXACT_UID), 'NowcoderNetworkError');
        expect(error).to.be.instanceOf(NowcoderNetworkError);
        expect(error.message).to.match(/HTTP 500/);
        expectNowcoderHistory(EXACT_UID);
    });

    it('throws malformed when the body is HTML', async () => {
        stubHtml('<html><title>Rating排行榜</title></html>');
        const error = await expectNamed(() => fetchNowcoderRatingHistory(EXACT_UID), 'NowcoderMalformedError');
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expectNowcoderHistory(EXACT_UID);
    });

    it('rejects a non-digit uid before network', async () => {
        stubJson(historyEnvelope([]));
        const error = await expectNamed(() => fetchNowcoderRatingHistory('abc'), 'NowcoderMalformedError');
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/digit string/i);
        expect(fetchCalls).to.deep.equal([]);
    });

    it('keeps a leading-zero uid as a digit string instead of Number()', async () => {
        stubJson(historyEnvelope([]));
        const fetched = await fetchNowcoderRatingHistory('0111');
        expect(fetched).to.deep.equal([]);
        expectNowcoderHistory('0111');
        expect(new URL(fetchCalls[0].url).searchParams.get('uid')).to.equal('0111');
        expect(new URL(fetchCalls[0].url).searchParams.get('uid')).to.not.equal('111');
    });

    it('fails closed when the final URL leaves ac.nowcoder.com/acm/contest/rating-history', async () => {
        stubJson(historyEnvelope([]), 200, 'https://www.nowcoder.com/acm/contest/rating-history?userId=111111');
        const error = await expectNamed(() => fetchNowcoderRatingHistory(EXACT_UID), 'NowcoderMalformedError');
        expect(error).to.be.instanceOf(NowcoderMalformedError);
        expect(error.message).to.match(/redirected away from rating-history/i);
        expectNowcoderHistory(EXACT_UID);
    });

    it('throws NowcoderNetworkError on timeout without retrying', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        stub = hangUntilAbort;
        const pending = expectNamed(() => fetchNowcoderRatingHistory(EXACT_UID), 'NowcoderNetworkError');
        t.mock.timers.tick(NOWCODER_RATING_INDEX_TIMEOUT_MS);
        const error = await pending;
        expect(error).to.be.instanceOf(NowcoderNetworkError);
        expect(error.message).to.match(/timed out/i);
        expectNowcoderHistory(EXACT_UID);
    });
});
