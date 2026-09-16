import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';
import {
    NOWCODER_RATING_INDEX_URL,
    NowcoderMalformedError,
    NowcoderUserNotFoundError,
    fetchNowcoderRating,
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

function htmlResponse(body: string, url: string, status = 200): Response {
    const response = new Response(body, {
        status,
        headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

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

function stubHtml(html: string): void {
    stub = async (url) => htmlResponse(html, url);
}

function expectNowcoderSearch(name: string): void {
    expect(fetchCalls).to.have.lengthOf(1);
    expect(fetchCalls[0].url).to.equal(expectedSearchUrl(name));
    expect(fetchCalls[0].url).to.not.include('www.nowcoder.com');
    expect(fetchCalls[0].init?.method).to.equal('GET');
}

describe('parseNowcoderRatingIndexHtml', { concurrency: false }, () => {
    it('returns the rating for an exact username match and ignores a similar nickname', () => {
        const parsed = parseNowcoderRatingIndexHtml(exactMatchHtml(), NAME);
        expect(parsed).to.deep.equal({ rating: EXACT_RATING });
        expect(parsed.rating).to.not.equal(SIMILAR_RATING);
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
        expect(fetched).to.deep.equal({ rating: EXACT_RATING });
        expect(fetched.rating).to.not.equal(SIMILAR_RATING);
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
