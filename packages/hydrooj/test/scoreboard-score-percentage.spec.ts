import { expect } from 'chai';
import { describe, it } from 'node:test';
import { annotateScoreboardPercentages } from '../src/lib/scoreboard-score-percentage';

describe('scoreboard score percentages', () => {
    it('uses each problem actual maximum instead of assuming 100 points', () => {
        const rows: Parameters<typeof annotateScoreboardPercentages>[1] = [
            [
                { type: 'rank', value: '#' },
                { type: 'total_score', value: '总分' },
                { type: 'problem', value: 'A', raw: 101 },
                { type: 'problem', value: 'B', raw: 102 },
            ],
            [
                { type: 'rank', value: '1' },
                { type: 'total_score', value: '22.5' },
                { type: 'record', value: '15', score: 15, style: 'background-color: rgb(217, 240, 199);' },
                { type: 'record', value: '7.5', score: 7.5 },
            ],
        ];
        const pdict = {
            101: { config: { maxScore: 15 } },
            102: { config: { maxScore: 15 } },
        };

        annotateScoreboardPercentages({ pids: [101, 102] }, rows, pdict);

        expect(rows[1][1].scorePercentage).to.equal(75);
        expect(rows[1][2].scorePercentage).to.equal(100);
        expect(rows[1][3].scorePercentage).to.equal(50);
        expect(rows[1][2].style).to.equal('background-color: rgb(217, 240, 199);');
    });

    it('accounts for contest score weights and annotates post-contest record pairs', () => {
        const rows: Parameters<typeof annotateScoreboardPercentages>[1] = [
            [
                { type: 'rank', value: '#' },
                { type: 'total_score', value: '总分' },
                { type: 'problem', value: 'A', raw: 201 },
            ],
            [
                { type: 'rank', value: '1' },
                { type: 'total_score', value: '10' },
                {
                    type: 'records',
                    value: '',
                    raw: [
                        { type: 'record', value: '10', score: 40 },
                        { type: 'record', value: '25', score: 100 },
                    ],
                },
            ],
        ];
        const pdict = { 201: { config: { maxScore: 100 } } };

        annotateScoreboardPercentages({ pids: [201], score: { 201: 25 } }, rows, pdict);

        expect(rows[1][1].scorePercentage).to.equal(40);
        expect(rows[1][2].raw[0].scorePercentage).to.equal(40);
        expect(rows[1][2].raw[1].scorePercentage).to.equal(100);
    });

    it('colors the displayed penalty score instead of the unpenalized raw score', () => {
        const rows: Parameters<typeof annotateScoreboardPercentages>[1] = [
            [
                { type: 'rank', value: '#' },
                { type: 'total_score', value: '总分' },
                { type: 'problem', value: 'A', raw: 301 },
            ],
            [
                { type: 'rank', value: '1' },
                { type: 'total_score', value: '10.5' },
                { type: 'record', value: '10.5', score: 15 },
            ],
            [
                { type: 'rank', value: '2' },
                { type: 'total_score', value: '10' },
                { type: 'record', value: '10 / 15\n0:42', score: 15 },
            ],
        ];

        annotateScoreboardPercentages({ pids: [301] }, rows, { 301: { config: { maxScore: 15 } } });

        expect(rows[1][2].scorePercentage).to.equal(70);
        expect(rows[2][2].scorePercentage).to.equal(100 * (10 / 15));
    });

    it('fails with the problem id when the parsed maximum-score contract is missing', () => {
        const rows: Parameters<typeof annotateScoreboardPercentages>[1] = [
            [
                { type: 'rank', value: '#' },
                { type: 'problem', value: 'A', raw: 401 },
            ],
        ];

        expect(() => annotateScoreboardPercentages({ pids: [401] }, rows, { 401: { config: 'Cannot parse: bad yaml' } })).to.throw(
            'Cannot normalize scoreboard scores for problem 401: parsed config object is missing',
        );
    });

    it('treats mathematically equal totals as full score across floating-point summation order', () => {
        const rows: Parameters<typeof annotateScoreboardPercentages>[1] = [
            [
                { type: 'rank', value: '#' },
                { type: 'total_score', value: '总分' },
                { type: 'problem', value: 'A', raw: 501 },
                { type: 'problem', value: 'B', raw: 502 },
                { type: 'problem', value: 'C', raw: 503 },
            ],
            [
                { type: 'rank', value: '1' },
                { type: 'total_score', value: 0.3 + 0.2 + 0.1 },
                { type: 'record', value: 0.1, score: 0.1 },
                { type: 'record', value: 0.2, score: 0.2 },
                { type: 'record', value: 0.3, score: 0.3 },
            ],
        ];

        annotateScoreboardPercentages({ pids: [501, 502, 503] }, rows, {
            501: { config: { maxScore: 0.1 } },
            502: { config: { maxScore: 0.2 } },
            503: { config: { maxScore: 0.3 } },
        });

        expect(rows[1][1].scorePercentage).to.equal(100);
    });
});
