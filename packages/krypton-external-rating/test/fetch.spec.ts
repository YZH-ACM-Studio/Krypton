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
    MANUAL_REFRESH_MIN_INTERVAL_MS: number;
    ExternalRatingRefreshRateLimitError: new (message?: string) => Error;
    applyFetch(state: RatingState, site: 'codeforces' | 'nowcoder', newHandle: string, now: Date | number): Promise<RatingState>;
    refreshSite(
        state: RatingState,
        site: 'codeforces' | 'nowcoder',
        now: Date | number,
        lastAttemptAt: Date | number | null | undefined,
    ): Promise<RatingState>;
    refreshBoth(state: RatingState, now: Date | number, lastAttemptAt: Date | number | null | undefined): Promise<RatingState>;
    shouldAllowManualRefresh(lastAttemptAt: Date | number | null | undefined, now: Date | number): boolean;
}

interface CfApi {
    CODEFORCES_USER_INFO_TIMEOUT_MS: number;
    fetchCodeforcesRating(handle: string): Promise<{ rating: number | null; rank?: string }>;
    CodeforcesUserNotFoundError: new (handle: string, message?: string) => Error;
    CodeforcesNetworkError: new (handle: string, message: string) => Error;
}

interface NowcoderApi {
    NOWCODER_RATING_INDEX_TIMEOUT_MS: number;
    fetchNowcoderRating(name: string): Promise<{ rating: number }>;
    NowcoderUserNotFoundError: new (handle: string, message?: string) => Error;
    NowcoderNetworkError: new (handle: string, message: string) => Error;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`unexpected live network call: ${String(input)}`);
};

const fetchApi = require('../src/fetch') as FetchApi;
const cfApi = require('../src/cf') as CfApi;
const nowcoderApi = require('../src/nowcoder') as NowcoderApi;

const {
    applyFetch,
    refreshSite,
    refreshBoth,
    shouldAllowManualRefresh,
    MANUAL_REFRESH_MIN_INTERVAL_MS,
    ExternalRatingRefreshRateLimitError,
} = fetchApi;
const {
    fetchCodeforcesRating,
    CodeforcesUserNotFoundError,
    CodeforcesNetworkError,
    CODEFORCES_USER_INFO_TIMEOUT_MS,
} = cfApi;
const {
    fetchNowcoderRating,
    NowcoderUserNotFoundError,
    NowcoderNetworkError,
    NOWCODER_RATING_INDEX_TIMEOUT_MS,
} = nowcoderApi;

const NOW = new Date('2026-09-13T08:00:00.000Z');
const PREV_FETCHED_AT = new Date('2026-01-01T00:00:00.000Z');

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
        handle: 'tourist',
        rating: 3301,
        fetchedAt: PREV_FETCHED_AT,
        lastError: null,
        publicShow: false,
        ...overrides,
    };
}

function nowcoderSite(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
    return {
        handle: 'jiangly',
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

function textResponse(body: string, status: number, url?: string): Response {
    const response = new Response(body, { status, headers: { 'content-type': 'text/html' } });
    if (url) Object.defineProperty(response, 'url', { value: url });
    return response;
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

function stubCfOk(user: Record<string, unknown>): void {
    stub = async () => jsonResponse({ status: 'OK', result: [user] });
}

function stubCfNotFound(): void {
    stub = async () => jsonResponse({
        status: 'FAILED',
        comment: 'handles: User with handle nobody not found',
    });
}

function stubCfEmptyResult(): void {
    stub = async () => jsonResponse({ status: 'OK', result: [] });
}

function stubTimeout(): void {
    stub = hangUntilAbort;
}

function stubNowcoderNotFound(): void {
    stub = async (url) => {
        if (!url.includes('ac.nowcoder.com/acm/contest/rating-index') || !url.includes('searchUserName=')) {
            throw new Error(`unexpected nowcoder url: ${url}`);
        }
        return textResponse('not found', 404, url);
    };
}

function expectNowcoderRatingIndexCall(url: string): void {
    expect(url).to.include('acm/contest/rating-index');
    expect(url).to.include('searchUserName=');
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

async function expectNamed(run: () => Promise<unknown>, name: string): Promise<Error> {
    try {
        await run();
    } catch (error) {
        expect((error as Error).name).to.equal(name);
        return error as Error;
    }
    expect.fail(`expected ${name}`);
}

describe('krypton-external-rating applyFetch G8', { concurrency: false }, () => {
    it('keeps the old rating and fetchedAt when the same handle fails, and sets lastError', async () => {
        stubCfNotFound();
        const previous = state({
            codeforces: cfSite({ publicShow: true }),
            nowcoder: nowcoderSite(),
        });

        const next = await applyFetch(previous, 'codeforces', 'tourist', NOW);

        expect(next.codeforces.handle).to.equal('tourist');
        expect(next.codeforces.rating).to.equal(3301);
        expect(next.codeforces.fetchedAt).to.equal(PREV_FETCHED_AT);
        expect(next.codeforces.lastError).to.equal('not_found');
        expect(next.codeforces.publicShow).to.equal(true);
        expect(next.nowcoder).to.deep.equal(previous.nowcoder);
        expect(fetchCalls).to.have.lengthOf(1);
        expect(fetchCalls[0]).to.include('codeforces.com/api/user.info');
        expect(fetchCalls[0]).to.include('handles=tourist');
    });

    it('clears the old rating on handle change; a failed fetch leaves rating null', async () => {
        stubCfNotFound();
        const previous = state({
            codeforces: cfSite({ publicShow: true }),
            nowcoder: nowcoderSite(),
        });

        const next = await applyFetch(previous, 'codeforces', 'Petr', NOW);

        expect(next.codeforces.handle).to.equal('Petr');
        expect(next.codeforces.rating).to.equal(null);
        expect(next.codeforces.fetchedAt).to.equal(null);
        expect(next.codeforces.lastError).to.equal('not_found');
        expect(next.codeforces.publicShow).to.equal(true);
        expect(next.nowcoder).to.deep.equal(previous.nowcoder);
        expect(next.codeforces.rating).to.not.equal(3301);
        expect(fetchCalls).to.have.lengthOf(1);
        expect(fetchCalls[0]).to.include('handles=Petr');
    });

    it('clears the site snapshot when the handle is emptied, without fetching', async () => {
        const previous = state({
            codeforces: cfSite({ publicShow: true, lastError: 'timeout' }),
            nowcoder: nowcoderSite(),
        });

        const next = await applyFetch(previous, 'codeforces', '', NOW);
        const whitespace = await applyFetch(previous, 'codeforces', '   ', NOW);

        expect(next.codeforces).to.deep.equal(emptySite());
        expect(whitespace.codeforces).to.deep.equal(emptySite());
        expect(next.nowcoder).to.deep.equal(previous.nowcoder);
        expect(fetchCalls).to.deep.equal([]);
    });

    it('treats unrated Codeforces (rating undefined) as success with null rating, not an error', async () => {
        stubCfOk({ handle: 'newbie' });
        const previous = state({
            codeforces: cfSite({ handle: 'newbie', rating: 800, lastError: 'network_error' }),
        });

        const next = await applyFetch(previous, 'codeforces', 'newbie', NOW);
        const fetched = await fetchCodeforcesRating('newbie');

        expect(fetched.rating).to.equal(null);
        expect(next.codeforces.handle).to.equal('newbie');
        expect(next.codeforces.rating).to.equal(null);
        expect(next.codeforces.fetchedAt).to.equal(NOW);
        expect(next.codeforces.lastError).to.equal(null);
        expect(next.codeforces.publicShow).to.equal(false);
    });

    it('keeps a Nowcoder rating on same-handle failure and clears it on handle change', async () => {
        stubNowcoderNotFound();
        const previous = state({
            codeforces: cfSite(),
            nowcoder: nowcoderSite({ publicShow: true }),
        });

        const same = await applyFetch(previous, 'nowcoder', 'jiangly', NOW);
        expect(same.nowcoder.rating).to.equal(2800);
        expect(same.nowcoder.fetchedAt).to.equal(PREV_FETCHED_AT);
        expect(same.nowcoder.lastError).to.equal('not_found');
        expect(same.nowcoder.publicShow).to.equal(true);
        expect(same.codeforces).to.deep.equal(previous.codeforces);
        expect(fetchCalls).to.have.lengthOf(1);
        expectNowcoderRatingIndexCall(fetchCalls[0]);

        const changed = await applyFetch(previous, 'nowcoder', 'jianglyly', NOW);
        expect(changed.nowcoder.handle).to.equal('jianglyly');
        expect(changed.nowcoder.rating).to.equal(null);
        expect(changed.nowcoder.fetchedAt).to.equal(null);
        expect(changed.nowcoder.lastError).to.equal('not_found');
        expect(changed.nowcoder.publicShow).to.equal(true);
        expect(fetchCalls).to.have.lengthOf(2);
        expectNowcoderRatingIndexCall(fetchCalls[1]);
    });
});

describe('krypton-external-rating fetch named errors', { concurrency: false }, () => {
    it('throws CodeforcesUserNotFoundError / NowcoderUserNotFoundError when the user is missing', async () => {
        stubCfEmptyResult();
        const cfError = await expectNamed(() => fetchCodeforcesRating('nobody'), 'CodeforcesUserNotFoundError');
        expect(cfError).to.be.instanceOf(CodeforcesUserNotFoundError);

        stubNowcoderNotFound();
        const ncError = await expectNamed(() => fetchNowcoderRating('nobody'), 'NowcoderUserNotFoundError');
        expect(ncError).to.be.instanceOf(NowcoderUserNotFoundError);
        expectNowcoderRatingIndexCall(fetchCalls[fetchCalls.length - 1]);
    });

    it('throws CodeforcesNetworkError / NowcoderNetworkError on timeout', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        stubTimeout();
        const cfPending = expectNamed(() => fetchCodeforcesRating('tourist'), 'CodeforcesNetworkError');
        t.mock.timers.tick(CODEFORCES_USER_INFO_TIMEOUT_MS);
        const cfError = await cfPending;
        expect(cfError).to.be.instanceOf(CodeforcesNetworkError);
        expect(cfError.message).to.match(/timed out/i);

        stubTimeout();
        const ncPending = expectNamed(() => fetchNowcoderRating('jiangly'), 'NowcoderNetworkError');
        t.mock.timers.tick(NOWCODER_RATING_INDEX_TIMEOUT_MS);
        const ncError = await ncPending;
        expect(ncError).to.be.instanceOf(NowcoderNetworkError);
        expect(ncError.message).to.match(/timed out/i);
        expectNowcoderRatingIndexCall(fetchCalls[fetchCalls.length - 1]);
    });

    it('records timeout and not_found as lastError codes through applyFetch', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        stubTimeout();
        const timedOutPending = applyFetch(state({ codeforces: cfSite() }), 'codeforces', 'tourist', NOW);
        t.mock.timers.tick(CODEFORCES_USER_INFO_TIMEOUT_MS);
        const timedOut = await timedOutPending;
        expect(timedOut.codeforces.rating).to.equal(3301);
        expect(timedOut.codeforces.fetchedAt).to.equal(PREV_FETCHED_AT);
        expect(timedOut.codeforces.lastError).to.equal('timeout');

        stubCfNotFound();
        const missing = await applyFetch(state({ codeforces: cfSite() }), 'codeforces', 'tourist', NOW);
        expect(missing.codeforces.rating).to.equal(3301);
        expect(missing.codeforces.lastError).to.equal('not_found');
    });
});

describe('krypton-external-rating manual refresh rate limit', { concurrency: false }, () => {
    it('rejects a rapid refresh without hitting the network', async () => {
        const previous = state({ codeforces: cfSite() });
        const lastAttemptAt = new Date(NOW.getTime() - 1_000);

        expect(shouldAllowManualRefresh(lastAttemptAt, NOW)).to.equal(false);

        const siteError = await expectNamed(
            () => refreshSite(previous, 'codeforces', NOW, lastAttemptAt),
            'ExternalRatingRefreshRateLimitError',
        );
        expect(siteError).to.be.instanceOf(ExternalRatingRefreshRateLimitError);

        const bothError = await expectNamed(
            () => refreshBoth(previous, NOW, lastAttemptAt),
            'ExternalRatingRefreshRateLimitError',
        );
        expect(bothError).to.be.instanceOf(ExternalRatingRefreshRateLimitError);
        expect(fetchCalls).to.deep.equal([]);
    });

    it('allows a refresh after the cooldown and on a first attempt', async () => {
        stubCfOk({ handle: 'tourist', rating: 3302 });
        const previous = state({ codeforces: cfSite() });
        const cooled = new Date(NOW.getTime() - MANUAL_REFRESH_MIN_INTERVAL_MS);

        expect(shouldAllowManualRefresh(null, NOW)).to.equal(true);
        expect(shouldAllowManualRefresh(cooled, NOW)).to.equal(true);

        const next = await refreshSite(previous, 'codeforces', NOW, cooled);
        expect(next.codeforces.rating).to.equal(3302);
        expect(next.codeforces.lastError).to.equal(null);
        expect(next.codeforces.fetchedAt).to.equal(NOW);
        expect(fetchCalls).to.have.lengthOf(1);
    });
});
