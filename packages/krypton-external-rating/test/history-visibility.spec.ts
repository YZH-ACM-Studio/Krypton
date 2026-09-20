import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    serializeHistoryForViewer,
    serializeOwnerOrTeacher,
    serializePublic,
    serializeRanking,
} from '../src/serialize';
import type { ExternalRatingErrorCode, ExternalRatingSiteSnapshot, UserExternalRatingState } from '../src/types';

const FETCHED_AT = new Date('2026-09-13T08:00:00.000Z');
const LAST_ERROR: ExternalRatingErrorCode = 'timeout';
const NOWCODER_LAST_ERROR: ExternalRatingErrorCode = 'parse_failed';

const STRANGER = { isSelf: false, isTeacherOrAdmin: false };
const SELF = { isSelf: true, isTeacherOrAdmin: false };
const TEACHER = { isSelf: false, isTeacherOrAdmin: true };
const ADMIN = { isSelf: false, isTeacherOrAdmin: true };

/** Wire-shaped input: `publicShow` may be absent, which the parser defaults to hidden. */
type SiteInput = Omit<ExternalRatingSiteSnapshot, 'publicShow'> & { publicShow?: boolean };

function site(partial: Partial<SiteInput> & Pick<SiteInput, 'handle' | 'rating'>): SiteInput {
    return {
        fetchedAt: FETCHED_AT,
        lastError: null,
        publicShow: false,
        ...partial,
    };
}

function state(codeforces: SiteInput, nowcoder: SiteInput): UserExternalRatingState {
    return { codeforces, nowcoder } as UserExternalRatingState;
}

const hiddenBoth = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: false }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

const cfPublicOnly = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

const bothPublic = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: true }),
);

const history = {
    codeforces: [
        {
            ratedAt: new Date('2026-01-02T00:00:00.000Z'),
            rating: 3400,
            contestName: 'CF Round 1000',
            contestId: 2044,
            oldRating: 3301,
            rank: 12,
            ingestedAt: new Date('2026-01-03T00:00:00.000Z'),
            handle: 'tourist',
            lastError: LAST_ERROR,
            publicShow: false,
        },
        {
            ratedAt: new Date('2026-01-01T00:00:00.000Z'),
            rating: 3301,
            contestName: null,
        },
        {
            ratedAt: new Date('2026-01-04T00:00:00.000Z'),
            rating: 3500,
            contestName: '',
        },
        {
            ratedAt: new Date('2026-01-05T00:00:00.000Z'),
            rating: Number.NaN,
            contestName: 'invalid rating skipped',
        },
        {
            ratedAt: new Date('2026-01-06T00:00:00.000Z'),
            rating: 1.5,
            contestName: 'non-integer skipped',
        },
        {
            ratedAt: new Date('2026-01-07T00:00:00.000Z'),
            rating: -1,
            contestName: 'negative skipped',
        },
        {
            ratedAt: new Date('2026-01-08T00:00:00.000Z'),
            rating: 100000,
            contestName: 'out of range skipped',
        },
    ],
    nowcoder: [
        {
            ratedAt: new Date('2026-02-02T00:00:00.000Z'),
            rating: 9999,
            contestName: 'Nowcoder Round Secret',
            contestId: 888,
            oldRating: 8888,
            rank: 3,
            ingestedAt: new Date('2026-02-03T00:00:00.000Z'),
            handle: 'nc_user',
            lastError: NOWCODER_LAST_ERROR,
            publicShow: false,
        },
        {
            ratedAt: new Date('2026-02-01T00:00:00.000Z'),
            rating: 8888,
        },
    ],
};

const expectedCodeforcesHistory = [
    { ratedAt: '2026-01-01T00:00:00.000Z', rating: 3301 },
    { ratedAt: '2026-01-02T00:00:00.000Z', rating: 3400, contestName: 'CF Round 1000' },
    { ratedAt: '2026-01-04T00:00:00.000Z', rating: 3500 },
];

const expectedNowcoderHistory = [
    { ratedAt: '2026-02-01T00:00:00.000Z', rating: 8888 },
    { ratedAt: '2026-02-02T00:00:00.000Z', rating: 9999, contestName: 'Nowcoder Round Secret' },
];

const emptyHistory = { codeforces: [], nowcoder: [] };

function expectNoHistorySecrets(view: object) {
    const json = JSON.stringify(view);
    expect(json).to.not.include('lastError');
    expect(json).to.not.include(LAST_ERROR);
    expect(json).to.not.include(NOWCODER_LAST_ERROR);
    expect(json).to.not.include('publicShow');
    expect(json).to.not.include('contestId');
    expect(json).to.not.include('oldRating');
    expect(json).to.not.include('"rank"');
    expect(json).to.not.include('ingestedAt');
    expect(json).to.not.include('handle');
}

describe('krypton-external-rating serializeHistoryForViewer', () => {
    it('omits hidden history for a stranger and does not leak handles', () => {
        const view = serializeHistoryForViewer(history, cfPublicOnly, STRANGER);
        expect(view).to.deep.equal({ codeforces: expectedCodeforcesHistory });
        expect(view).to.have.property('codeforces');
        expect(view).to.not.have.property('nowcoder');
        expect(Object.keys(view)).to.deep.equal(['codeforces']);

        const json = JSON.stringify(view);
        expect(json).to.not.include('tourist');
        expect(json).to.not.include('nc_user');
        expect(json).to.not.include('Nowcoder Round Secret');
        expect(json).to.not.include('8888');
        expect(json).to.not.include('9999');
        expectNoHistorySecrets(view);

        const hiddenView = serializeHistoryForViewer(history, hiddenBoth, STRANGER);
        expect(hiddenView).to.deep.equal({});
        expect(hiddenView).to.not.have.property('codeforces');
        expect(hiddenView).to.not.have.property('nowcoder');
        const hiddenJson = JSON.stringify(hiddenView);
        expect(hiddenJson).to.equal('{}');
        expect(hiddenJson).to.not.include('tourist');
        expect(hiddenJson).to.not.include('nc_user');
        expect(hiddenJson).to.not.include('CF Round 1000');
        expect(hiddenJson).to.not.include('Nowcoder Round Secret');
    });

    it('lets the owner see history when publicShow is false', () => {
        const view = serializeHistoryForViewer(history, hiddenBoth, SELF);
        expect(view).to.have.property('codeforces');
        expect(view).to.have.property('nowcoder');
        expect(view).to.deep.equal({
            codeforces: expectedCodeforcesHistory,
            nowcoder: expectedNowcoderHistory,
        });
        expectNoHistorySecrets(view);
        const json = JSON.stringify(view);
        expect(json).to.not.include('invalid rating skipped');
        expect(json).to.not.include('non-integer skipped');
        expect(json).to.not.include('negative skipped');
        expect(json).to.not.include('out of range skipped');

        const empty = serializeHistoryForViewer(emptyHistory, hiddenBoth, SELF);
        expect(empty).to.deep.equal({ codeforces: [], nowcoder: [] });
        expect(empty).to.have.property('codeforces');
        expect(empty).to.have.property('nowcoder');
    });

    it('lets teachers and admins see the same hidden history as the owner', () => {
        const ownerView = serializeHistoryForViewer(history, hiddenBoth, SELF);
        expect(serializeHistoryForViewer(history, hiddenBoth, TEACHER)).to.deep.equal(ownerView);
        expect(serializeHistoryForViewer(history, hiddenBoth, ADMIN)).to.deep.equal(ownerView);
        expect(ownerView.nowcoder).to.deep.equal(expectedNowcoderHistory);
    });

    it('keeps ranking serialize numbers-only with no history field', () => {
        const ranking = serializeRanking(cfPublicOnly);
        expect(ranking).to.deep.equal({ codeforces: 3301 });
        expect(ranking).to.not.have.property('history');
        expect(ranking).to.not.have.property('nowcoder');
        const json = JSON.stringify(ranking);
        expect(json).to.not.include('history');
        expect(json).to.not.include('ratedAt');
        expect(json).to.not.include('contestName');
        expect(json).to.not.include('tourist');
        expect(json).to.not.include('nc_user');
        expect(json).to.not.include('handle');
        expect(json).to.not.include('lastError');
        expect(json).to.not.include('publicShow');

        expect(serializeRanking(hiddenBoth)).to.deep.equal({});
        expect(JSON.stringify(serializeRanking(hiddenBoth))).to.equal('{}');
        expect(serializeRanking(bothPublic)).to.deep.equal({ codeforces: 3301, nowcoder: 2500 });
        expect(serializeRanking(bothPublic)).to.not.have.property('history');
    });

    it('does not attach history onto snapshot serializers', () => {
        const owner = serializeOwnerOrTeacher(hiddenBoth);
        expect(owner).to.not.have.property('history');
        expect(owner.codeforces).to.not.have.property('history');
        expect(owner.nowcoder).to.not.have.property('history');
        expect(Object.keys(owner.codeforces)).to.deep.equal([
            'handle',
            'rating',
            'fetchedAt',
            'lastError',
            'publicShow',
        ]);

        const publicView = serializePublic(cfPublicOnly);
        expect(publicView).to.not.have.property('history');
        expect(publicView.codeforces).to.not.have.property('history');
        expect(publicView).to.not.have.property('nowcoder');
        expect(Object.keys(publicView.codeforces)).to.deep.equal([
            'handle',
            'rating',
            'fetchedAt',
            'stale',
        ]);
    });

    it('sends an empty array for a public site with no history, not a hidden-site key', () => {
        const view = serializeHistoryForViewer(emptyHistory, cfPublicOnly, STRANGER);
        expect(view).to.deep.equal({ codeforces: [] });
        expect(view).to.not.have.property('nowcoder');
    });
});
