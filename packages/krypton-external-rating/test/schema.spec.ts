import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const typesPath = require.resolve('../src/types.ts');
const validatePath = require.resolve('../src/validate.ts');
const serializePath = require.resolve('../src/serialize.ts');
const originalLoad = Module._load;

class ValidationError extends Error {
    params: unknown[];
    constructor(...params: unknown[]) {
        super(params.map(String).join(' '));
        this.name = 'ValidationError';
        this.params = params;
    }
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (
        request === 'hydrooj'
        && parent
        && (parent.filename === typesPath || parent.filename === validatePath || parent.filename === serializePath)
    ) {
        return { ValidationError };
    }
    return originalLoad.call(this, request, parent, isMain);
};

type ExternalRatingSiteId = 'codeforces' | 'nowcoder';

interface FieldError extends Error {
    field: string;
}

interface ErrorCtor {
    new (field?: string, message?: string): Error;
}

interface SiteSnapshot {
    handle: string;
    rating: number | null;
    fetchedAt: Date | null;
    lastError: string | null;
    publicShow?: boolean;
}

interface UserState {
    codeforces: SiteSnapshot;
    nowcoder: SiteSnapshot;
}

interface PublicSiteView {
    handle?: string | null;
    rating?: number | null;
    fetchedAt?: string | Date | null;
    lastError?: unknown;
    publicShow?: boolean;
    stale?: true;
}

interface OwnerSiteView extends PublicSiteView {
    lastError?: string | null;
    publicShow?: boolean;
}

interface TypesApi {
    EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT: boolean;
    ExternalRatingTypeError: ErrorCtor;
    emptyUserExternalRatingState(): UserState;
    parseExternalRatingPublicShow(value: unknown, field: string): boolean;
    parseExternalRatingSiteSnapshot(value: unknown, field: string): SiteSnapshot;
    assertNoClientSnapshotWrite(input: unknown, field: string): void;
    serializePublic?(state: UserState): Partial<Record<ExternalRatingSiteId, PublicSiteView | null>>;
    serializeOwner?(state: UserState): Record<ExternalRatingSiteId, OwnerSiteView>;
}

interface ValidateApi {
    ExternalRatingSnapshotFieldError: ErrorCtor;
    parsePublicFlag(value?: unknown): boolean;
    assertClientMayNotSetSnapshotFields(body: unknown): void;
    normalizeCfHandle(value: unknown): string;
    normalizeNowcoderName(value: unknown): string;
}

interface SerializeApi {
    serializePublic(state: UserState): Partial<Record<ExternalRatingSiteId, PublicSiteView | null>>;
    serializeOwner?(state: UserState): Record<ExternalRatingSiteId, OwnerSiteView>;
    serializeOwnerOrTeacher?(state: UserState): Record<ExternalRatingSiteId, OwnerSiteView>;
}

let types: TypesApi;
let validate: ValidateApi;
let serialize: SerializeApi;
try {
    delete require.cache[typesPath];
    delete require.cache[validatePath];
    delete require.cache[serializePath];
    types = require(typesPath) as TypesApi;
    validate = require(validatePath) as ValidateApi;
    serialize = require(serializePath) as SerializeApi;
} finally {
    Module._load = originalLoad;
}

function serializePublic(state: UserState) {
    const fn = types.serializePublic ?? serialize.serializePublic;
    if (typeof fn !== 'function') throw new Error('serializePublic is missing from types.ts / serialize.ts');
    return fn(state);
}

function serializeOwner(state: UserState) {
    const fn = types.serializeOwner ?? serialize.serializeOwner ?? serialize.serializeOwnerOrTeacher;
    if (typeof fn !== 'function') throw new Error('serializeOwner is missing from types.ts / serialize.ts');
    return fn(state);
}

const FETCHED_AT = new Date('2026-09-13T00:00:00.000Z');
const FETCHED_AT_ISO = '2026-09-13T00:00:00.000Z';
const UNSET_HANDLE = '';

function expectThrown(run: () => unknown, ErrorCtor: ErrorCtor, name: string): Error {
    try {
        run();
    } catch (error) {
        expect(error).to.be.instanceOf(ErrorCtor);
        expect((error as Error).name).to.equal(name);
        return error as Error;
    }
    expect.fail(`expected ${name}`);
    throw new Error('unreachable');
}

function expectTypeError(run: () => unknown): FieldError {
    const error = expectThrown(run, types.ExternalRatingTypeError, 'ExternalRatingTypeError') as FieldError;
    expect(error.field).to.be.a('string');
    return error;
}

function expectSnapshotFieldError(run: () => unknown, field: string): FieldError {
    const error = expectThrown(
        run,
        validate.ExternalRatingSnapshotFieldError,
        'ExternalRatingSnapshotFieldError',
    ) as FieldError;
    expect(error).to.be.instanceOf(types.ExternalRatingTypeError);
    expect(error.field).to.equal(field);
    return error;
}

function siteSnapshot(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
    return {
        handle: UNSET_HANDLE,
        rating: null,
        fetchedAt: null,
        lastError: null,
        ...overrides,
    };
}

function ratingState(overrides: Partial<Record<ExternalRatingSiteId, Partial<SiteSnapshot>>> = {}): UserState {
    return {
        codeforces: siteSnapshot(overrides.codeforces),
        nowcoder: siteSnapshot(overrides.nowcoder),
    };
}

describe('krypton-external-rating schema', () => {
    it('defaults the public flag to false', () => {
        expect(types.EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT).to.equal(false);
        expect(validate.parsePublicFlag()).to.equal(false);
        expect(validate.parsePublicFlag(undefined)).to.equal(false);
        expect(validate.parsePublicFlag(false)).to.equal(false);
        expect(types.parseExternalRatingPublicShow(undefined, 'publicShow')).to.equal(false);
        expect(types.emptyUserExternalRatingState().codeforces.publicShow).to.equal(false);
        expect(types.emptyUserExternalRatingState().nowcoder.publicShow).to.equal(false);
        expect(validate.parsePublicFlag(true)).to.equal(true);
        expect(types.parseExternalRatingPublicShow(true, 'publicShow')).to.equal(true);
        expectTypeError(() => validate.parsePublicFlag('true'));
        expectTypeError(() => validate.parsePublicFlag(1));
        expectTypeError(() => types.parseExternalRatingPublicShow('true', 'publicShow'));
    });

    it('treats a missing public flag as false', () => {
        expect(validate.parsePublicFlag(null)).to.equal(false);
        expect(validate.parsePublicFlag(undefined)).to.equal(false);

        const parsed = types.parseExternalRatingSiteSnapshot({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT,
            lastError: null,
        }, 'codeforces');
        expect(parsed.publicShow).to.equal(false);

        const nowcoder = types.parseExternalRatingSiteSnapshot({
            handle: 'alice',
            rating: 2000,
            fetchedAt: FETCHED_AT,
            lastError: null,
        }, 'nowcoder');
        expect(nowcoder.publicShow).to.equal(false);
    });

    it('rejects client snapshot fields', () => {
        validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', publicShow: false });
        validate.assertClientMayNotSetSnapshotFields({
            codeforces: { handle: 'tourist', publicShow: true },
            nowcoder: { handle: '', publicShow: false },
        });
        types.assertNoClientSnapshotWrite({ handle: 'tourist', publicShow: false }, 'codeforces');
        types.assertNoClientSnapshotWrite({
            codeforces: { handle: 'tourist', publicShow: true },
            nowcoder: { handle: '', publicShow: false },
        }, 'externalRating');

        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', rating: 3301 }),
            'rating',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', rating: 0 }),
            'rating',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', rating: null }),
            'rating',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({
                codeforces: { handle: 'tourist', publicShow: true, rating: 0 },
            }),
            'rating',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({
                nowcoder: { handle: 'alice', rating: null },
            }),
            'rating',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', fetchedAt: FETCHED_AT.toISOString() }),
            'fetchedAt',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({ handle: 'tourist', lastError: 'timeout' }),
            'lastError',
        );
        expectSnapshotFieldError(
            () => validate.assertClientMayNotSetSnapshotFields({
                codeforces: { handle: 'tourist', rating: 3301 },
            }),
            'rating',
        );

        expectTypeError(() => types.assertNoClientSnapshotWrite({ handle: 'tourist', rating: 3301 }, 'codeforces'));
        expectTypeError(() => types.assertNoClientSnapshotWrite({ handle: 'tourist', rating: 0 }, 'codeforces'));
        expectTypeError(() => types.assertNoClientSnapshotWrite({ handle: 'tourist', rating: null }, 'codeforces'));
        expectTypeError(() => types.assertNoClientSnapshotWrite({ handle: 'tourist', fetchedAt: FETCHED_AT }, 'codeforces'));
        expectTypeError(() => types.assertNoClientSnapshotWrite({ handle: 'tourist', lastError: 'timeout' }, 'codeforces'));
        expectTypeError(() => types.assertNoClientSnapshotWrite({ rp: 1200, handle: 'tourist' }, 'externalRating'));

        const storedZero = types.parseExternalRatingSiteSnapshot({
            handle: 'tourist',
            rating: 0,
            fetchedAt: FETCHED_AT,
            lastError: null,
            publicShow: false,
        }, 'codeforces');
        expect(storedZero.rating).to.equal(0);
        expect(storedZero.fetchedAt).to.equal(FETCHED_AT);
    });

    it('accepts an empty handle', () => {
        expect(validate.normalizeCfHandle('')).to.equal(UNSET_HANDLE);
        expect(validate.normalizeCfHandle('   ')).to.equal(UNSET_HANDLE);
        expect(validate.normalizeCfHandle(null)).to.equal(UNSET_HANDLE);
        expect(validate.normalizeCfHandle(undefined)).to.equal(UNSET_HANDLE);
        expect(validate.normalizeNowcoderName('')).to.equal(UNSET_HANDLE);
        expect(validate.normalizeNowcoderName('   ')).to.equal(UNSET_HANDLE);
        expect(validate.normalizeNowcoderName(null)).to.equal(UNSET_HANDLE);

        const cleared = types.parseExternalRatingSiteSnapshot({
            handle: '',
            rating: null,
            fetchedAt: null,
            lastError: null,
        }, 'codeforces');
        expect(cleared.handle).to.equal(UNSET_HANDLE);
        expect(cleared.publicShow).to.equal(false);
        expect(cleared.rating).to.equal(null);
        expect(cleared.fetchedAt).to.equal(null);
    });

    it('fails closed on a garbage handle', () => {
        expect(validate.normalizeCfHandle('tourist')).to.equal('tourist');
        expect(validate.normalizeCfHandle('  Jiangly  ')).to.equal('Jiangly');
        expect(validate.normalizeNowcoderName('alice')).to.equal('alice');

        for (const garbage of [
            'not a handle',
            'https://codeforces.com/profile/tourist',
            'tour;ist',
            '<script>alert(1)</script>',
            'a'.repeat(100),
            '../../etc/passwd',
            { handle: 'tourist' },
            12345,
        ]) {
            expectTypeError(() => validate.normalizeCfHandle(garbage));
        }

        for (const garbage of [
            'a'.repeat(200),
            'ali\nce',
            'ali\u0000ce',
            { name: 'alice' },
            99,
        ]) {
            expectTypeError(() => validate.normalizeNowcoderName(garbage));
        }
    });

    it('serializePublic omits hidden sites', () => {
        const stalePublic = ratingState({
            codeforces: {
                handle: 'tourist',
                rating: 3301,
                fetchedAt: FETCHED_AT,
                lastError: 'timeout',
                publicShow: true,
            },
            nowcoder: {
                handle: 'alice',
                rating: 2000,
                fetchedAt: FETCHED_AT,
                lastError: 'parse_failed',
                publicShow: false,
            },
        });
        expect(stalePublic.codeforces.publicShow).to.equal(true);
        expect(stalePublic.nowcoder.publicShow).to.equal(false);

        const view = serializePublic(stalePublic);
        expect(view).to.have.property('codeforces');
        expect(view).to.not.have.property('nowcoder');
        expect(view.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
            stale: true,
        });
        expect(view.codeforces).to.not.have.property('lastError');
        expect(view.codeforces).to.not.have.property('publicShow');
        expect(JSON.stringify(view)).to.not.include('alice');
        expect(JSON.stringify(view)).to.not.include('timeout');

        const omittedPublicShow: UserState = {
            codeforces: {
                handle: 'tourist',
                rating: 3301,
                fetchedAt: FETCHED_AT,
                lastError: null,
            },
            nowcoder: {
                handle: 'alice',
                rating: 2000,
                fetchedAt: FETCHED_AT,
                lastError: null,
                publicShow: true,
            },
        };
        expect(omittedPublicShow.codeforces).to.not.have.property('publicShow');

        const hiddenMissing = serializePublic(omittedPublicShow);
        expect(hiddenMissing).to.not.have.property('codeforces');
        expect(hiddenMissing.nowcoder).to.deep.equal({
            handle: 'alice',
            rating: 2000,
            fetchedAt: FETCHED_AT_ISO,
        });
        expect(hiddenMissing.nowcoder).to.not.have.property('publicShow');
        expect(hiddenMissing.nowcoder).to.not.have.property('lastError');
        expect(JSON.stringify(hiddenMissing)).to.not.include('tourist');
        expect(JSON.stringify(hiddenMissing)).to.not.include('publicShow');
    });

    it('serializeOwner includes lastError', () => {
        const state = ratingState({
            codeforces: {
                handle: 'tourist',
                rating: 3301,
                fetchedAt: FETCHED_AT,
                lastError: 'timeout',
                publicShow: false,
            },
            nowcoder: {
                handle: 'alice',
                rating: null,
                fetchedAt: null,
                lastError: 'not_found',
                publicShow: true,
            },
        });
        const view = serializeOwner(state);
        expect(view.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
            lastError: 'timeout',
            publicShow: false,
        });
        expect(view.nowcoder).to.deep.equal({
            handle: 'alice',
            rating: null,
            fetchedAt: null,
            lastError: 'not_found',
            publicShow: true,
        });

        const omittedPublicShow: UserState = {
            codeforces: {
                handle: 'tourist',
                rating: 3301,
                fetchedAt: FETCHED_AT,
                lastError: 'timeout',
            },
            nowcoder: {
                handle: 'alice',
                rating: 2000,
                fetchedAt: FETCHED_AT,
                lastError: null,
            },
        };
        expect(omittedPublicShow.codeforces).to.not.have.property('publicShow');
        expect(omittedPublicShow.nowcoder).to.not.have.property('publicShow');
        const omittedOwner = serializeOwner(omittedPublicShow);
        expect(omittedOwner.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
            lastError: 'timeout',
            publicShow: false,
        });
        expect(omittedOwner.nowcoder).to.deep.equal({
            handle: 'alice',
            rating: 2000,
            fetchedAt: FETCHED_AT_ISO,
            lastError: null,
            publicShow: false,
        });

        const empty = serializeOwner(types.emptyUserExternalRatingState());
        expect(empty.codeforces).to.deep.equal({
            handle: UNSET_HANDLE,
            rating: null,
            fetchedAt: null,
            lastError: null,
            publicShow: false,
        });
        expect(empty.nowcoder).to.deep.equal({
            handle: UNSET_HANDLE,
            rating: null,
            fetchedAt: null,
            lastError: null,
            publicShow: false,
        });
    });
});
