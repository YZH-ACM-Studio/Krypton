import { expect } from 'chai';
import { after, beforeEach, describe, it } from 'node:test';
import {
    CODEFORCES_USER_INFO_TIMEOUT_MS,
    CODEFORCES_USER_RATING_URL,
    CodeforcesMalformedError,
    CodeforcesNetworkError,
    CodeforcesUserNotFoundError,
    fetchCodeforcesRatingHistory,
} from '../src/cf';

type FetchInit = RequestInit | undefined;
type FetchStub = (url: string, init: FetchInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`unexpected live network call: ${String(input)}`);
};

const HANDLE = 'tourist';
const RATED_AT_SECONDS = 1_700_000_000;

let stub: FetchStub | null = null;
const fetchCalls: { url: string; init: FetchInit }[] = [];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
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

function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        contestId: 1234,
        contestName: 'Codeforces Round #1',
        handle: 'Tourist',
        rank: 10,
        ratingUpdateTimeSeconds: RATED_AT_SECONDS,
        oldRating: 1400,
        newRating: 1502,
        ...overrides,
    };
}

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

function expectUserRatingRequest(handle: string): void {
    expect(fetchCalls).to.have.lengthOf(1);
    const parsed = new URL(fetchCalls[0].url);
    expect(`${parsed.origin}${parsed.pathname}`).to.equal(CODEFORCES_USER_RATING_URL);
    expect(parsed.searchParams.get('handle')).to.equal(handle);
    expect(parsed.searchParams.has('handles')).to.equal(false);
    expect(fetchCalls[0].url).to.include('handle=');
    expect(fetchCalls[0].url).to.not.include('handles=');
    expect(fetchCalls[0].url).to.not.include('user.info');
    expect(fetchCalls[0].init?.method).to.equal('GET');
    const headers = fetchCalls[0].init?.headers;
    expect(headers).to.deep.include({
        Accept: 'application/json',
        'User-Agent': 'KryptonOJ/external-rating',
    });
}

describe('fetchCodeforcesRatingHistory', { concurrency: false }, () => {
    it('returns [] for an OK empty result (unrated), using handle= not handles=', async () => {
        stub = async () => jsonResponse({ status: 'OK', result: [] });
        const entries = await fetchCodeforcesRatingHistory(HANDLE);
        expect(entries).to.deep.equal([]);
        expectUserRatingRequest(HANDLE);
    });

    it('maps rating-change rows and accepts a CF-case-equal handle', async () => {
        stub = async () => jsonResponse({
            status: 'OK',
            result: [
                historyRow(),
                historyRow({
                    contestId: 5678,
                    contestName: 'Codeforces Round #2',
                    rank: 3,
                    ratingUpdateTimeSeconds: RATED_AT_SECONDS + 86400,
                    oldRating: 1502,
                    newRating: 1600,
                }),
            ],
        });
        const entries = await fetchCodeforcesRatingHistory(HANDLE);
        expect(entries).to.deep.equal([
            {
                ratedAt: new Date(RATED_AT_SECONDS * 1000),
                rating: 1502,
                contestKey: '1234',
                oldRating: 1400,
                rank: 10,
                contestName: 'Codeforces Round #1',
            },
            {
                ratedAt: new Date((RATED_AT_SECONDS + 86400) * 1000),
                rating: 1600,
                contestKey: '5678',
                oldRating: 1502,
                rank: 3,
                contestName: 'Codeforces Round #2',
            },
        ]);
        expectUserRatingRequest(HANDLE);
    });

    it('throws CodeforcesUserNotFoundError when FAILED comment contains not found', async () => {
        stub = async () => jsonResponse({
            status: 'FAILED',
            comment: 'handle: User with handle nobody not found',
        });
        const error = await expectNamed(() => fetchCodeforcesRatingHistory('nobody'), 'CodeforcesUserNotFoundError');
        expect(error).to.be.instanceOf(CodeforcesUserNotFoundError);
        expectUserRatingRequest('nobody');
    });

    it('throws CodeforcesNetworkError on timeout', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        stub = hangUntilAbort;
        const pending = expectNamed(() => fetchCodeforcesRatingHistory(HANDLE), 'CodeforcesNetworkError');
        t.mock.timers.tick(CODEFORCES_USER_INFO_TIMEOUT_MS);
        const error = await pending;
        expect(error).to.be.instanceOf(CodeforcesNetworkError);
        expect(error.message).to.match(/timed out/i);
        expectUserRatingRequest(HANDLE);
    });

    it('throws CodeforcesMalformedError on bad JSON', async () => {
        stub = async () => new Response('not json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
        const error = await expectNamed(() => fetchCodeforcesRatingHistory(HANDLE), 'CodeforcesMalformedError');
        expect(error).to.be.instanceOf(CodeforcesMalformedError);
        expectUserRatingRequest(HANDLE);
    });

    it('throws CodeforcesMalformedError when newRating is missing', async () => {
        const row = historyRow();
        delete row.newRating;
        stub = async () => jsonResponse({ status: 'OK', result: [row] });
        const error = await expectNamed(() => fetchCodeforcesRatingHistory(HANDLE), 'CodeforcesMalformedError');
        expect(error).to.be.instanceOf(CodeforcesMalformedError);
        expect(error.message).to.match(/newRating/i);
        expectUserRatingRequest(HANDLE);
    });
});
