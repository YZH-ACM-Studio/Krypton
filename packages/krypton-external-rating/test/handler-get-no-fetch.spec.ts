import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import {
    CreateError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
    localizedErrorText,
} from '@hydrooj/framework';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { resolve, sep } from 'node:path';

const Module = require('module');
const handlerSourcePath = resolve(__dirname, '../src/handler.ts');
const handlerSource = readFileSync(handlerSourcePath, 'utf8');
const originalLoad = Module._load;
const originalFetch = globalThis.fetch;

let fetchCalls = 0;
globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    fetchCalls += 1;
    throw new Error(`unexpected live network call: ${String(input)}`);
};

class PermissionError extends ForbiddenError {
    name = 'PermissionError';
}

// CreateError is a factory, not a constructor.
// eslint-disable-next-line unicorn/throw-new-error
const UserNotFoundError = CreateError('UserNotFoundError', NotFoundError, 'User {0} not found.');

const FETCHED_AT = new Date('2026-09-13T08:00:00.000Z');
const CF_RATED_AT = new Date('2026-01-02T00:00:00.000Z');
const NC_RATED_AT = new Date('2026-02-02T00:00:00.000Z');
const PROFILE_UID = 2;
const STRANGER_UID = 99;

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

const storedState: RatingState = {
    codeforces: {
        handle: 'tourist',
        rating: 3301,
        fetchedAt: FETCHED_AT,
        lastError: 'timeout',
        publicShow: true,
    },
    nowcoder: {
        handle: 'nc_user',
        rating: 2500,
        fetchedAt: FETCHED_AT,
        lastError: 'parse_failed',
        publicShow: false,
    },
};

const storedHistoryDocs = {
    codeforces: [
        {
            uid: PROFILE_UID,
            site: 'codeforces' as const,
            handle: 'tourist',
            contestId: '2044',
            contestName: 'CF Round 1000',
            ratedAt: CF_RATED_AT,
            rating: 3400,
            oldRating: 3301,
            rank: 12,
            ingestedAt: new Date('2026-01-03T00:00:00.000Z'),
            lastError: 'timeout',
        },
    ],
    nowcoder: [
        {
            uid: PROFILE_UID,
            site: 'nowcoder' as const,
            handle: 'nc_user',
            contestId: '888',
            contestName: 'Nowcoder Round Secret',
            ratedAt: NC_RATED_AT,
            rating: 9999,
            oldRating: 8888,
            rank: 3,
            ingestedAt: new Date('2026-02-03T00:00:00.000Z'),
            lastError: 'parse_failed',
        },
    ],
};

const users = new Map<number, { _id: number; externalRating: RatingState }>([
    [PROFILE_UID, { _id: PROFILE_UID, externalRating: storedState }],
]);

const UserModel = {
    coll: {
        async findOne(filter: { _id?: number }) {
            const uid = filter._id;
            if (typeof uid !== 'number') return null;
            const doc = users.get(uid);
            return doc ? { ...doc, externalRating: { ...doc.externalRating } } : null;
        },
    },
    async getById() {
        throw new Error('GET inject must not load users for fetch');
    },
    async setById() {
        throw new Error('GET inject must not write snapshots');
    },
};

function param() {
    return (_target: unknown, _key: unknown, descriptor?: PropertyDescriptor) => descriptor;
}

class Handler {}

const hydroojStub = {
    Context: class Context {},
    CreateError,
    ForbiddenError,
    Handler,
    OplogModel: {
        async log() {
            throw new Error('GET inject must not write oplog');
        },
    },
    PERM,
    PRIV,
    PermissionError,
    SettingModel: {
        Setting(...args: unknown[]) {
            return args;
        },
    },
    Types: { Int: 'int' },
    UserModel,
    UserNotFoundError,
    ValidationError,
    db: {
        collection(name: string) {
            if (name !== 'externalRating.history') {
                throw new Error(`unexpected collection ${name}`);
            }
            return {
                async createIndex() {
                    return 'uid_1_site_1_contestId_1';
                },
                find(filter: { uid?: number; site?: string }) {
                    const docs = [
                        ...storedHistoryDocs.codeforces,
                        ...storedHistoryDocs.nowcoder,
                    ].filter((doc) => {
                        if (doc.uid !== filter.uid) return false;
                        if (filter.site != null && doc.site !== filter.site) return false;
                        return true;
                    });
                    return {
                        sort() {
                            return {
                                async toArray() {
                                    return docs.map((doc) => ({ ...doc }));
                                },
                            };
                        },
                    };
                },
                async bulkWrite() {
                    throw new Error('GET inject must not write history');
                },
            };
        },
    },
    localizedErrorText,
    param,
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj' && typeof parent?.filename === 'string' && parent.filename.includes(`${sep}krypton-external-rating${sep}`)) {
        return hydroojStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface HydroGlobal {
    Hydro?: { model?: { userbind?: { findStudentByUserId?: (domainId: string, uid: number) => Promise<{ boundUserId?: number | null } | null> } } };
}

const hydroGlobal: HydroGlobal = globalThis;
const originalHydro = hydroGlobal.Hydro;
hydroGlobal.Hydro = {
    model: {
        userbind: {
            async findStudentByUserId(_domainId: string, uid: number) {
                return { boundUserId: uid };
            },
        },
    },
};

interface InjectApi {
    injectUserProfileExternalRating(handler: FakeHandler): Promise<void>;
    injectRankingExternalRating(handler: FakeHandler): Promise<void>;
    injectAccountSettingsExternalRating(handler: FakeHandler): Promise<void>;
}

for (const rel of ['../src/handler.ts', '../src/model.ts', '../src/settings.ts', '../src/db.ts', '../src/history.ts']) {
    delete require.cache[require.resolve(rel)];
}

let injectApi: InjectApi;
try {
    injectApi = require('../src/handler.ts') as InjectApi;
} finally {
    Module._load = originalLoad;
}

interface FakeUser {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
}

interface FakeHandler {
    user: FakeUser;
    domain: { _id: string };
    args: Record<string, unknown>;
    response: { body: Record<string, unknown> };
    request: { body: Record<string, unknown>; json?: boolean };
}

function strangerUser(): FakeUser {
    return {
        _id: STRANGER_UID,
        hasPerm: () => false,
        hasPriv: () => false,
    };
}

function selfUser(): FakeUser {
    return {
        _id: PROFILE_UID,
        hasPerm: () => false,
        hasPriv: () => false,
    };
}

function profileHandler(user: FakeUser): FakeHandler {
    return {
        user,
        domain: { _id: 'system' },
        args: { domainId: 'system' },
        request: { body: {}, json: true },
        response: {
            body: {
                udoc: { _id: PROFILE_UID, uname: 'alice' },
            },
        },
    };
}

function rankingHandler(): FakeHandler {
    return {
        user: strangerUser(),
        domain: { _id: 'system' },
        args: { domainId: 'system' },
        request: { body: {}, json: true },
        response: {
            body: {
                udocs: [
                    {
                        _id: PROFILE_UID,
                        uname: 'alice',
                        _udoc: { externalRating: storedState },
                    },
                ],
            },
        },
    };
}

function accountHandler(): FakeHandler {
    return {
        user: selfUser(),
        domain: { _id: 'system' },
        args: { domainId: 'system', category: 'account' },
        request: { body: {}, json: true },
        response: { body: {} },
    };
}

const FORBIDDEN_FETCH_NAMES = [
    'applyFetch',
    'refreshBoth',
    'fetchBoth',
    'refreshSite',
    'fetchCodeforces',
    'fetchNowcoder',
    'fetchCodeforcesRating',
    'fetchNowcoderRating',
    'fetchCodeforcesRatingHistory',
    'fetchNowcoderRatingHistory',
] as const;

function extractFunctionSource(src: string, name: string): string {
    const start = src.indexOf(`export async function ${name}`);
    if (start < 0) throw new Error(`missing ${name}`);
    const brace = src.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${name}`);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${name}`);
}

function assertNoFetchInInject(name: string): void {
    const body = extractFunctionSource(handlerSource, name);
    for (const ident of FORBIDDEN_FETCH_NAMES) {
        expect(body, `${name} must not contain ${ident}`).to.not.match(new RegExp(`\\b${ident}\\b`));
    }
}

after(() => {
    globalThis.fetch = originalFetch;
    hydroGlobal.Hydro = originalHydro;
});

describe('krypton-external-rating GET inject never fetches', { concurrency: false }, () => {
    it('source-scans inject functions for fetch/history boundaries', () => {
        assertNoFetchInInject('injectUserProfileExternalRating');
        assertNoFetchInInject('injectRankingExternalRating');
        assertNoFetchInInject('injectAccountSettingsExternalRating');

        const profile = extractFunctionSource(handlerSource, 'injectUserProfileExternalRating');
        expect(profile).to.match(/\blistHistory\b/);
        expect(profile).to.match(/\bserializeHistoryForViewer\b/);
        expect(profile).to.match(/\bexternalRatingHistory\b/);

        const ranking = extractFunctionSource(handlerSource, 'injectRankingExternalRating');
        expect(ranking).to.not.match(/\blistHistory\b/);
        expect(ranking).to.not.match(/\bserializeHistoryForViewer\b/);
        expect(ranking).to.not.match(/\bexternalRatingHistory\b/);

        const account = extractFunctionSource(handlerSource, 'injectAccountSettingsExternalRating');
        expect(account).to.not.match(/\blistHistory\b/);
        expect(account).to.not.match(/\bserializeHistoryForViewer\b/);
        expect(account).to.not.match(/\bexternalRatingHistory\b/);
    });

    it('injects stored history on profile GET and does not fetch', async () => {
        const before = fetchCalls;
        const handler = profileHandler(strangerUser());
        await injectApi.injectUserProfileExternalRating(handler);
        expect(fetchCalls).to.equal(before);

        const body = handler.response.body;
        expect(body.externalRating).to.deep.equal({
            codeforces: {
                handle: 'tourist',
                rating: 3301,
                fetchedAt: FETCHED_AT.toISOString(),
                stale: true,
            },
        });
        expect(body.externalRatingHistory).to.deep.equal({
            codeforces: [
                {
                    ratedAt: CF_RATED_AT.toISOString(),
                    rating: 3400,
                    contestName: 'CF Round 1000',
                },
            ],
        });
        expect(body).to.have.property('externalRatingHistory');
        expect(body.externalRatingHistory).to.not.have.property('nowcoder');
        const json = JSON.stringify(body.externalRatingHistory);
        expect(json).to.not.include('tourist');
        expect(json).to.not.include('nc_user');
        expect(json).to.not.include('lastError');
        expect(json).to.not.include('timeout');
        expect(json).to.not.include('contestId');
        expect(json).to.not.include('oldRating');
        expect(json).to.not.include('"rank"');
        expect(json).to.not.include('ingestedAt');
        expect(json).to.not.include('handle');
        expect(json).to.not.include('Nowcoder Round Secret');
    });

    it('does not attach history on ranking or account GET and does not fetch', async () => {
        const before = fetchCalls;
        const ranking = rankingHandler();
        await injectApi.injectRankingExternalRating(ranking);
        const account = accountHandler();
        await injectApi.injectAccountSettingsExternalRating(account);
        expect(fetchCalls).to.equal(before);

        expect(ranking.response.body.externalRatingByUid).to.deep.equal({
            [String(PROFILE_UID)]: { codeforces: 3301 },
        });
        expect(ranking.response.body).to.not.have.property('externalRatingHistory');
        const rankingRow = (ranking.response.body.udocs as Array<Record<string, unknown>>)[0];
        expect(rankingRow.externalRating).to.deep.equal({ codeforces: 3301 });
        expect(rankingRow).to.not.have.property('externalRatingHistory');
        expect(JSON.stringify(ranking.response.body)).to.not.include('ratedAt');
        expect(JSON.stringify(ranking.response.body)).to.not.include('contestName');
        expect(JSON.stringify(ranking.response.body)).to.not.include('history');

        expect(account.response.body).to.not.have.property('externalRatingHistory');
        expect(account.response.body.externalRating).to.be.an('object');
        expect(JSON.stringify(account.response.body.externalRating)).to.not.include('ratedAt');
        expect(JSON.stringify(account.response.body.externalRating)).to.not.include('contestName');
        expect(JSON.stringify(account.response.body)).to.not.include('CF Round 1000');
    });
});
