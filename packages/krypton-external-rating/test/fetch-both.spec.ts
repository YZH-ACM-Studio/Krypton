import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';

const Module = require('module');

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
        options?: { uid?: number },
    ): Promise<RatingState>;
}

interface HistoryCall {
    method: string;
}

interface HistoryHarness {
    calls: HistoryCall[];
}

function historyHarness(): HistoryHarness {
    const g = globalThis as typeof globalThis & { __kryptonExternalRatingHistory?: HistoryHarness };
    if (!g.__kryptonExternalRatingHistory) g.__kryptonExternalRatingHistory = { calls: [] };
    return g.__kryptonExternalRatingHistory;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`unexpected live network call: ${String(input)}`);
};

const fetchPath = require.resolve('../src/fetch.ts');
const originalLoad = Module._load;
const historyMockInstalled = (globalThis as typeof globalThis & { __kryptonExternalRatingHistoryMocked?: boolean });
if (!historyMockInstalled.__kryptonExternalRatingHistoryMocked) {
    historyMockInstalled.__kryptonExternalRatingHistoryMocked = true;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === fetchPath && /(?:^|\/)history(?:\.ts)?$/.test(request)) {
            return {
                async upsertPoints() {
                    historyHarness().calls.push({ method: 'upsertPoints' });
                },
                async deletePoints() {
                    historyHarness().calls.push({ method: 'deletePoints' });
                    throw new Error('history delete must not be called');
                },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
}

const { fetchBoth } = require('../src/fetch') as FetchApi;

const NOW = new Date('2026-09-13T08:00:00.000Z');
const PREV_FETCHED_AT = new Date('2026-01-01T00:00:00.000Z');
const TARGET_UID = 42;
const CF_HANDLE = 'tourist';
const NC_HANDLE = 'jiangly';
const NC_UID = '123456';
const CF_NEW_RATING = 3302;
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

function jsonResponse(body: unknown, status = 200, url?: string): Response {
    const response = new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
    if (url) Object.defineProperty(response, 'url', { value: url });
    return response;
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

function isCodeforcesUserInfoUrl(url: string): boolean {
    return url.includes('codeforces.com/api/user.info');
}

function isCodeforcesUserRatingUrl(url: string): boolean {
    return url.includes('codeforces.com/api/user.rating');
}

function isNowcoderRatingIndexUrl(url: string): boolean {
    return url.includes('ac.nowcoder.com/acm/contest/rating-index');
}

function isNowcoderRatingHistoryUrl(url: string): boolean {
    return /rating[-_]?history/i.test(url);
}

function emptyCfHistory(): unknown {
    return { status: 'OK', result: [] };
}

function emptyNowcoderHistory(): unknown {
    return { code: 0, data: [] };
}

function stubCfFailNowcoderOk(mode: 'not_found' | 'throw'): void {
    stub = async (url) => {
        if (isCodeforcesUserInfoUrl(url)) {
            if (mode === 'throw') throw new TypeError('fetch failed');
            return jsonResponse({
                status: 'FAILED',
                comment: `handles: User with handle ${CF_HANDLE} not found`,
            });
        }
        if (isCodeforcesUserRatingUrl(url)) {
            throw new Error(`CF history must not be fetched after current-rating failure: ${url}`);
        }
        if (isNowcoderRatingIndexUrl(url)) {
            return textResponse(nowcoderRatingIndexHtml(NC_HANDLE, NC_UID, NC_NEW_RATING), 200, url);
        }
        if (isNowcoderRatingHistoryUrl(url)) {
            return jsonResponse(emptyNowcoderHistory(), 200, url);
        }
        throw new Error(`unexpected live network call: ${url}`);
    };
}

function stubDualSuccess(): void {
    stub = async (url) => {
        if (isCodeforcesUserInfoUrl(url)) {
            return jsonResponse({ status: 'OK', result: [{ handle: CF_HANDLE, rating: CF_NEW_RATING }] });
        }
        if (isCodeforcesUserRatingUrl(url)) {
            return jsonResponse(emptyCfHistory());
        }
        if (isNowcoderRatingIndexUrl(url)) {
            return textResponse(nowcoderRatingIndexHtml(NC_HANDLE, NC_UID, NC_NEW_RATING), 200, url);
        }
        if (isNowcoderRatingHistoryUrl(url)) {
            return jsonResponse(emptyNowcoderHistory(), 200, url);
        }
        throw new Error(`unexpected live network call: ${url}`);
    };
}

beforeEach(() => {
    stub = null;
    fetchCalls.length = 0;
    historyHarness().calls.length = 0;
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

function expectCurrentRatingFetched(): void {
    expect(fetchCalls.some((url) => isCodeforcesUserInfoUrl(url))).to.equal(true);
    expect(fetchCalls.some((url) => isNowcoderRatingIndexUrl(url))).to.equal(true);
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

        const next = await fetchBoth(previous, NOW, undefined, { uid: TARGET_UID });

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

        expectCurrentRatingFetched();
        expect(fetchCalls.some((url) => isCodeforcesUserRatingUrl(url))).to.equal(false);
        expect(fetchCalls.some((url) => isNowcoderRatingHistoryUrl(url) && url.includes(`uid=${NC_UID}`))).to.equal(true);
        expect(fetchCalls).to.have.lengthOf(3);
        expect(historyHarness().calls.map((call) => call.method)).to.not.include('deletePoints');
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
        }, { uid: TARGET_UID });

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

        expectCurrentRatingFetched();
        expect(fetchCalls.some((url) => isCodeforcesUserRatingUrl(url))).to.equal(false);
        expect(fetchCalls.some((url) => isNowcoderRatingHistoryUrl(url) && url.includes(`uid=${NC_UID}`))).to.equal(true);
        expect(fetchCalls).to.have.lengthOf(3);
        expect(historyHarness().calls.map((call) => call.method)).to.not.include('deletePoints');
    });

    it('fetches CF user.info + user.rating and Nowcoder rating-index + rating-history on dual success', async () => {
        stubDualSuccess();
        const previous = state({
            codeforces: cfSite(),
            nowcoder: nowcoderSite(),
        });

        const next = await fetchBoth(previous, NOW, undefined, { uid: TARGET_UID });

        expect(next.codeforces.handle).to.equal(CF_HANDLE);
        expect(next.codeforces.rating).to.equal(CF_NEW_RATING);
        expect(next.codeforces.fetchedAt).to.equal(NOW);
        expect(next.codeforces.lastError).to.equal(null);

        expect(next.nowcoder.handle).to.equal(NC_HANDLE);
        expect(next.nowcoder.rating).to.equal(NC_NEW_RATING);
        expect(next.nowcoder.fetchedAt).to.equal(NOW);
        expect(next.nowcoder.lastError).to.equal(null);

        expectCurrentRatingFetched();
        expect(fetchCalls.some((url) => isCodeforcesUserRatingUrl(url))).to.equal(true);
        expect(fetchCalls.some((url) => isNowcoderRatingHistoryUrl(url) && url.includes(`uid=${NC_UID}`))).to.equal(true);
        expect(fetchCalls).to.have.lengthOf(4);
        expect(historyHarness().calls.map((call) => call.method)).to.not.include('deletePoints');
    });
});
