import { expect } from 'chai';
import { describe, it } from 'node:test';
import { serializeRanking } from '../src/serialize';
import {
    emptyUserExternalRatingState,
    type ExternalRatingErrorCode,
} from '../src/types';

const FETCHED_AT = new Date('2026-09-13T08:00:00.000Z');
const LAST_ERROR: ExternalRatingErrorCode = 'timeout';
const NOWCODER_LAST_ERROR: ExternalRatingErrorCode = 'parse_failed';

interface SiteInput {
    handle: string;
    rating: number | null;
    fetchedAt: Date | null;
    lastError: ExternalRatingErrorCode | null;
    publicShow?: boolean;
}

function site(partial: Partial<SiteInput> & Pick<SiteInput, 'handle' | 'rating'>): SiteInput {
    return {
        fetchedAt: FETCHED_AT,
        lastError: null,
        publicShow: false,
        ...partial,
    };
}

function state(codeforces: SiteInput, nowcoder: SiteInput) {
    return { codeforces, nowcoder };
}

const hiddenBoth = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: false }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

const omittedFlags = state(
    { handle: 'tourist', rating: 3301, fetchedAt: FETCHED_AT, lastError: LAST_ERROR },
    { handle: 'nc_user', rating: 2500, fetchedAt: FETCHED_AT, lastError: NOWCODER_LAST_ERROR },
);

const cfPublicOnly = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

const nowcoderPublicOnly = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: false }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: true }),
);

const bothPublic = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: true }),
);

const publicNullRating = state(
    site({ handle: 'tourist', rating: null, fetchedAt: null, lastError: 'not_found', publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

function expectOmitted(view: object) {
    expect(view).to.deep.equal({});
    expect(view).to.not.have.property('codeforces');
    expect(view).to.not.have.property('nowcoder');
    expect(Object.keys(view)).to.deep.equal([]);
}

function expectOnlyRatingNumbers(view: object, expected: { codeforces?: number | null; nowcoder?: number | null }) {
    expect(view).to.deep.equal(expected);
    for (const [siteId, value] of Object.entries(view)) {
        expect(['codeforces', 'nowcoder']).to.include(siteId);
        expect(value === null || typeof value === 'number').to.equal(true);
        if (value !== null) {
            expect(value).to.be.a('number');
            expect(Number.isSafeInteger(value)).to.equal(true);
        }
    }
    const json = JSON.stringify(view);
    expect(json).to.not.include('handle');
    expect(json).to.not.include('fetchedAt');
    expect(json).to.not.include('lastError');
    expect(json).to.not.include('publicShow');
    expect(json).to.not.include('stale');
    expect(json).to.not.include('tourist');
    expect(json).to.not.include('nc_user');
    expect(json).to.not.include(LAST_ERROR);
    expect(json).to.not.include(NOWCODER_LAST_ERROR);
    expect(json).to.not.include('not_found');
}

describe('krypton-external-rating serializeRanking', () => {
    it('omits hidden sites', () => {
        expectOmitted(serializeRanking(hiddenBoth));
        expectOmitted(serializeRanking(omittedFlags));
        expectOmitted(serializeRanking(emptyUserExternalRatingState()));
        expect(JSON.stringify(serializeRanking(hiddenBoth))).to.equal('{}');
        expect(JSON.stringify(serializeRanking(hiddenBoth))).to.not.include('3301');
        expect(JSON.stringify(serializeRanking(hiddenBoth))).to.not.include('2500');
    });

    it('emits only rating numbers for public sites', () => {
        expectOnlyRatingNumbers(serializeRanking(cfPublicOnly), { codeforces: 3301 });
        expect(serializeRanking(cfPublicOnly)).to.not.have.property('nowcoder');
        expect(JSON.stringify(serializeRanking(cfPublicOnly))).to.not.include('2500');

        expectOnlyRatingNumbers(serializeRanking(nowcoderPublicOnly), { nowcoder: 2500 });
        expect(serializeRanking(nowcoderPublicOnly)).to.not.have.property('codeforces');
        expect(JSON.stringify(serializeRanking(nowcoderPublicOnly))).to.not.include('3301');

        expectOnlyRatingNumbers(serializeRanking(bothPublic), { codeforces: 3301, nowcoder: 2500 });
        expectOnlyRatingNumbers(serializeRanking(publicNullRating), { codeforces: null });
        expect(serializeRanking(publicNullRating)).to.not.have.property('nowcoder');
    });
});
