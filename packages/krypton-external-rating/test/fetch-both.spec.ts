import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';

type FetchInit = RequestInit | undefined;
type FetchStub = (url: string, init: FetchInit) => Promise<Response>;

interface SiteSnapshot {
    handle: string;
    rating: number | null;
    fetchedAt: Date | null;
    lastError: string | null;
    publicShow: boolean;
}

interface RatingState {
    codeforces: SiteSnapshot;
    nowcoder: SiteSnapshot;
}

interface FetchApi {
    fetchBoth(
        state: RatingState,
        now: Date | number,
        newHandles?: Partial<Record<'codeforces' | 'nowcoder', string>>,
    ): Promise<RatingState>;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`unexpected live network call: ${String(input)}`);
};

const { fetchBoth } = require('../src/fetch') as FetchApi;

const NOW = new Date('2026-09-13T08:00:00.000Z');
const PREV_FETCHED_AT = new Date('2026-01-01T00:00:00.000Z');
const CF_HANDLE = 'tourist';
const NC_HANDLE = 'jiangly';
const NC_UID = '123456';
const NC_NEW_RATING = 2918;

const emptySite = (): SiteSnapshot => ({
    handle: '',
    rating: null,
    fetchedAt: null,
    lastError: null,
    publicShow: false,
});

function state(overrides: Partial<RatingState> = {}): RatingState {
    return {
        codeforces: emptySite(),
        nowcoder: emptySite(),
        ...overrides,
    };
}

function cfSite(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
    return {
        handle: CF_HANDLE,
        rating: 3301,
        fetchedAt: PREV_FETCHED_AT,
        lastError: null,
        publicShow: false,
        ...overrides,
    };
}

function nowcoderSite(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
    return {
        handle: NC_HANDLE,
        rating: 2800,
        fetchedAt: PREV_FETCHED_AT,
        lastError: null,
        publicShow: false,
        ...overrides,
    };
}

let stub: FetchStub | null = null;
const fetchCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function textResponse(body: string, status: number, url: string): Response {
    const response = new Response(body, { status, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

function nowcoderRatingIndexHtml(name: string, uid: string, rating: number): string {
    return [
        '<html><head><title>Rating排行榜</title></head><body>',
        `<input name="searchUserName" value="${name}">`,
        '<table class="rating-data">',
        `<tr data-uid="${uid}">`,
        '<td><span class="rate-num">1</span></td>',
        `<td><a href="/acm/contest/profile/${uid}"><span class="rate-score5">${name}</span></a></td>`,
        '<td>school</td>',
        '<td>bio</td>',
        `<td><span class="rate-score5">${rating}</span></td>`,
        '</tr></table></body></html>',
    ].join('');
}

function isCodeforcesUrl(url: string): boolean {
    return url.includes('codeforces.com/api/user.info');
}

function isNowcoderUrl(url: string): boolean {
    return url.includes('ac.nowcoder.com/acm/contest/rating-index');
}

function stubCfFailNowcoderOk(mode: 'not_found' | 'throw'): void {
    stub = async (url) => {
        if (isCodeforcesUrl(url)) {
            if (mode === 'throw') throw new TypeError('fetch failed');
            return jsonResponse({
                status: 'FAILED',
                comment: `handles: User with handle ${CF_HANDLE} not found`,
            });
        }
        if (isNowcoderUrl(url)) {
            return textResponse(nowcoderRatingIndexHtml(NC_HANDLE, NC_UID, NC_NEW_RATING), 200, url);
        }
        throw new Error(`unexpected live network call: ${url}`);
    };
}

beforeEach(() => {
    stub = null;
    fetchCalls.length = 0;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        fetchCalls.push(url);
        if (!stub) throw new Error(`unexpected live network call: ${url}`);
        return stub(url, init);
    }) as typeof fetch;
});

after(() => {
    globalThis.fetch = originalFetch;
});

function expectBothSitesFetched(): void {
    expect(fetchCalls.some((url) => isCodeforcesUrl(url))).to.equal(true);
    expect(fetchCalls.some((url) => isNowcoderUrl(url))).to.equal(true);
    expect(fetchCalls.some((url) => url.includes(`handles=${CF_HANDLE}`))).to.equal(true);
    expect(fetchCalls.some((url) => url.includes(`searchUserName=${encodeURIComponent(NC_HANDLE)}`))).to.equal(true);
}

describe('krypton-external-rating fetchBoth', { concurrency: false }, () => {
    it('does not skip a successful Nowcoder fetch when Codeforces returns not_found', async () => {
        stubCfFailNowcoderOk('not_found');
        const previous = state({
            codeforces: cfSite({ publicShow: true }),
            nowcoder: nowcoderSite({ publicShow: true }),
        });

        const next = await fetchBoth(previous, NOW);

        expect(next.codeforces.handle).to.equal(CF_HANDLE);
        expect(next.codeforces.rating).to.equal(3301);
        expect(next.codeforces.fetchedAt).to.equal(PREV_FETCHED_AT);
        expect(next.codeforces.lastError).to.equal('not_found');
        expect(next.codeforces.publicShow).to.equal(true);

        expect(next.nowcoder.handle).to.equal(NC_HANDLE);
        expect(next.nowcoder.rating).to.equal(NC_NEW_RATING);
        expect(next.nowcoder.fetchedAt).to.equal(NOW);
        expect(next.nowcoder.lastError).to.equal(null);
        expect(next.nowcoder.publicShow).to.equal(true);
        expect(next.nowcoder.rating).to.not.equal(previous.nowcoder.rating);

        expectBothSitesFetched();
        expect(fetchCalls).to.have.lengthOf(2);
    });

    it('does not skip Nowcoder success when Codeforces fetch throws during save-time dual fetch', async () => {
        stubCfFailNowcoderOk('throw');
        const previous = state({
            codeforces: cfSite(),
            nowcoder: nowcoderSite({ handle: 'oldnc', rating: 1000 }),
        });

        const next = await fetchBoth(previous, NOW, {
            codeforces: CF_HANDLE,
            nowcoder: NC_HANDLE,
        });

        expect(next.codeforces.handle).to.equal(CF_HANDLE);
        expect(next.codeforces.rating).to.equal(3301);
        expect(next.codeforces.fetchedAt).to.equal(PREV_FETCHED_AT);
        expect(next.codeforces.lastError).to.equal('network_error');

        expect(next.nowcoder.handle).to.equal(NC_HANDLE);
        expect(next.nowcoder.rating).to.equal(NC_NEW_RATING);
        expect(next.nowcoder.fetchedAt).to.equal(NOW);
        expect(next.nowcoder.lastError).to.equal(null);
        expect(next.nowcoder.handle).to.not.equal('oldnc');
        expect(next.nowcoder.rating).to.not.equal(1000);

        expectBothSitesFetched();
        expect(fetchCalls).to.have.lengthOf(2);
    });
});
