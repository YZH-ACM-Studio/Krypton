import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    serializeForViewer,
    serializeOwnerOrTeacher,
    serializePublic,
    serializeRanking,
} from '../src/serialize';
import type { ExternalRatingErrorCode } from '../src/types';

const FETCHED_AT = new Date('2026-09-13T08:00:00.000Z');
const FETCHED_AT_ISO = '2026-09-13T08:00:00.000Z';
const LAST_ERROR: ExternalRatingErrorCode = 'timeout';
const NOWCODER_LAST_ERROR: ExternalRatingErrorCode = 'parse_failed';

const STRANGER = { isSelf: false, isTeacherOrAdmin: false };
const SELF = { isSelf: true, isTeacherOrAdmin: false };
const TEACHER = { isSelf: false, isTeacherOrAdmin: true };
const ADMIN = { isSelf: false, isTeacherOrAdmin: true };

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

const cfPublicOnly = state(
    site({ handle: 'tourist', rating: 3301, lastError: LAST_ERROR, publicShow: true }),
    site({ handle: 'nc_user', rating: 2500, lastError: NOWCODER_LAST_ERROR, publicShow: false }),
);

function expectNoSiteFields(view: object) {
    expect(view).to.not.have.property('codeforces');
    expect(view).to.not.have.property('nowcoder');
    expect(Object.keys(view)).to.deep.equal([]);
}

describe('P2.3 external rating visibility serializer', () => {
    it('omits CF and Nowcoder fields for a stranger when public flags are default-hidden', () => {
        const omittedFlags = state(
            { handle: 'tourist', rating: 3301, fetchedAt: FETCHED_AT, lastError: LAST_ERROR },
            { handle: 'nc_user', rating: 2500, fetchedAt: FETCHED_AT, lastError: NOWCODER_LAST_ERROR },
        );

        for (const snapshot of [hiddenBoth, omittedFlags]) {
            const view = serializeForViewer(snapshot, STRANGER);
            expect(view).to.deep.equal({});
            expect(view).to.deep.equal(serializePublic(snapshot));
            expectNoSiteFields(view);
            const json = JSON.stringify(view);
            expect(json).to.not.include('tourist');
            expect(json).to.not.include('nc_user');
            expect(json).to.not.include('codeforces');
            expect(json).to.not.include('nowcoder');
            expect(json).to.not.include(LAST_ERROR);
            expect(json).to.not.include(NOWCODER_LAST_ERROR);
        }
    });

    it('shows only Codeforces to a stranger when only CF is public', () => {
        const view = serializeForViewer(cfPublicOnly, STRANGER);
        expect(view).to.deep.equal(serializePublic(cfPublicOnly));
        expect(view).to.have.property('codeforces');
        expect(view).to.not.have.property('nowcoder');
        expect(view.codeforces).to.include({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
        });
        expect(JSON.stringify(view)).to.not.include('nc_user');
        expect(JSON.stringify(view)).to.not.include('2500');
    });

    it('lets the owner see both sites even when publicShow is false', () => {
        const view = serializeForViewer(hiddenBoth, SELF);
        expect(view).to.deep.equal(serializeOwnerOrTeacher(hiddenBoth));
        expect(view).to.have.property('codeforces');
        expect(view).to.have.property('nowcoder');
        expect(view.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
            lastError: LAST_ERROR,
            publicShow: false,
        });
        expect(view.nowcoder).to.deep.equal({
            handle: 'nc_user',
            rating: 2500,
            fetchedAt: FETCHED_AT_ISO,
            lastError: NOWCODER_LAST_ERROR,
            publicShow: false,
        });
    });

    it('lets teachers and admins see the same owner snapshot as self', () => {
        const ownerView = serializeForViewer(hiddenBoth, SELF);
        expect(serializeForViewer(hiddenBoth, TEACHER)).to.deep.equal(ownerView);
        expect(serializeForViewer(hiddenBoth, ADMIN)).to.deep.equal(ownerView);
        expect(serializeOwnerOrTeacher(hiddenBoth)).to.deep.equal(ownerView);
        expect(ownerView.codeforces.lastError).to.equal(LAST_ERROR);
        expect(ownerView.nowcoder.lastError).to.equal(NOWCODER_LAST_ERROR);
        expect(ownerView.codeforces.publicShow).to.equal(false);
        expect(ownerView.nowcoder.publicShow).to.equal(false);
    });

    it('never includes lastError code in the public view', () => {
        const view = serializePublic(cfPublicOnly);
        expect(view).to.not.have.property('nowcoder');
        expect(view.codeforces).to.not.have.property('lastError');
        expect(view.codeforces).to.not.have.property('publicShow');
        expect(view.codeforces.stale).to.equal(true);
        expect(view.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: 3301,
            fetchedAt: FETCHED_AT_ISO,
            stale: true,
        });
        const json = JSON.stringify(view);
        expect(json).to.not.include('lastError');
        expect(json).to.not.include(LAST_ERROR);
        expect(json).to.not.include(NOWCODER_LAST_ERROR);
        expect(JSON.stringify(serializeForViewer(cfPublicOnly, STRANGER))).to.equal(json);
    });

    it('omits hidden sites from the ranking serializer', () => {
        const ranking = serializeRanking(cfPublicOnly);
        expect(ranking).to.deep.equal({ codeforces: 3301 });
        expect(ranking).to.not.have.property('nowcoder');
        const json = JSON.stringify(ranking);
        expect(json).to.not.include('nc_user');
        expect(json).to.not.include('lastError');
        expect(json).to.not.include(LAST_ERROR);
        expect(json).to.not.include(NOWCODER_LAST_ERROR);
        expect(json).to.not.include('tourist');

        expect(serializeRanking(hiddenBoth)).to.deep.equal({});
        expect(serializeRanking(hiddenBoth)).to.not.have.property('codeforces');
        expect(serializeRanking(hiddenBoth)).to.not.have.property('nowcoder');
    });
});
