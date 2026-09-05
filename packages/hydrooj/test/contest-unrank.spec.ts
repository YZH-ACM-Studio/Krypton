import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import {
    assertIndividualContestUnrankAllowed,
    contestRpRatingInput,
    contestScoreboardRankValue,
    isContestUnofficial,
    rankSkippingUnofficial,
} from '../src/lib/contest-unrank';

describe('contest unofficial-star ranking', () => {
    it('treats missing and false as official, and true as unofficial', () => {
        expect(isContestUnofficial(undefined)).to.equal(false);
        expect(isContestUnofficial(null)).to.equal(false);
        expect(isContestUnofficial(false)).to.equal(false);
        expect(isContestUnofficial(true)).to.equal(true);
    });

    it('fails closed on a malformed unrank value', () => {
        expect(() => isContestUnofficial(1)).to.throw(ValidationError);
        expect(() => isContestUnofficial('true')).to.throw(ValidationError);
    });

    it('gives sandwiched official rows rank 1 instead of 2', () => {
        const ranked = rankSkippingUnofficial(
            [
                { name: 'star-high', accept: 3, time: 100, unrank: true },
                { name: 'official', accept: 2, time: 200 },
                { name: 'star-low', accept: 1, time: 300, unrank: true },
            ],
            (a, b) => a.accept === b.accept && a.time === b.time,
        );
        expect(ranked.map(([rank, row]) => [rank, row.name])).to.deep.equal([
            [0, 'star-high'],
            [1, 'official'],
            [0, 'star-low'],
        ]);
    });

    it('keeps official ties after skipping unofficial rows in between', () => {
        const ranked = rankSkippingUnofficial(
            [
                { name: 'A', accept: 3, time: 100 },
                { name: 'star', accept: 3, time: 100, unrank: true },
                { name: 'C', accept: 3, time: 100 },
            ],
            (a, b) => a.accept === b.accept && a.time === b.time,
        );
        expect(ranked.map(([rank, row]) => [rank, row.name])).to.deep.equal([
            [1, 'A'],
            [0, 'star'],
            [1, 'C'],
        ]);
    });

    it('serializes unofficial rank 0 as * for screen and CSV export', () => {
        expect(contestScoreboardRankValue(0)).to.equal('*');
        expect(contestScoreboardRankValue(1)).to.equal('1');
    });

    it('rejects personal starring outside individual acm/oi/ioi contests', () => {
        expect(() => assertIndividualContestUnrankAllowed('acm', 'individual')).to.not.throw();
        expect(() => assertIndividualContestUnrankAllowed('exam', 'individual')).to.throw(ValidationError);
        expect(() => assertIndividualContestUnrankAllowed('acm', 'team')).to.throw(ValidationError);
        expect(() => assertIndividualContestUnrankAllowed('homework', 'individual')).to.throw(ValidationError);
    });

    it('excludes unofficial rows from contest RP input and keeps their old rating unused', () => {
        const ranked: Array<[number, { uid: number; unrank?: boolean }]> = [
            [0, { uid: 11, unrank: true }],
            [1, { uid: 12 }],
            [0, { uid: 13, unrank: true }],
            [2, { uid: 14 }],
        ];
        const udict = { 11: 1500, 12: 1600, 13: 1700, 14: 1800 };
        expect(contestRpRatingInput(ranked, udict)).to.deep.equal([
            { uid: 12, rank: 1, old: 1600 },
            { uid: 14, rank: 2, old: 1800 },
        ]);
    });
});
