import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    bestCaccScore,
    CACC_AWARD_OPTIONS,
    CACC_STAGE_OPTIONS,
    caccAwardAtLeast,
    decideCaccImport,
    isCaccYear,
    parseCaccAward,
    parseCaccStage,
    parseCaccYear,
} from '../src/cacc';

describe('CACC result rules', () => {
    it('parses regional, Final, spaced 区域赛, and 决赛, and rejects empty, 省赛, constructor, and toString', () => {
        expect(parseCaccStage('regional')).to.equal('regional');
        expect(parseCaccStage('Final')).to.equal('final');
        expect(parseCaccStage(' 区域赛 ')).to.equal('regional');
        expect(parseCaccStage('决赛')).to.equal('final');
        expect(parseCaccStage('')).to.equal(null);
        expect(parseCaccStage('省赛')).to.equal(null);
        expect(parseCaccStage('constructor')).to.equal(null);
        expect(parseCaccStage('toString')).to.equal(null);
    });

    it('parses all 11 award aliases, including FIRST and spaced 参赛, and rejects empty, 特等奖, constructor, and __proto__', () => {
        expect(parseCaccAward('first')).to.equal('first');
        expect(parseCaccAward('FIRST')).to.equal('first');
        expect(parseCaccAward('second')).to.equal('second');
        expect(parseCaccAward('third')).to.equal('third');
        expect(parseCaccAward('participant')).to.equal('participant');
        expect(parseCaccAward('一等奖')).to.equal('first');
        expect(parseCaccAward('二等奖')).to.equal('second');
        expect(parseCaccAward('三等奖')).to.equal('third');
        expect(parseCaccAward('一等')).to.equal('first');
        expect(parseCaccAward('二等')).to.equal('second');
        expect(parseCaccAward('三等')).to.equal('third');
        expect(parseCaccAward('参赛')).to.equal('participant');
        expect(parseCaccAward(' 参赛 ')).to.equal('participant');
        expect(parseCaccAward('')).to.equal(null);
        expect(parseCaccAward('特等奖')).to.equal(null);
        expect(parseCaccAward('constructor')).to.equal(null);
        expect(parseCaccAward('__proto__')).to.equal(null);
    });

    it('accepts four-digit years from 2000 to 2099 and rejects out-of-range or non-four-digit text', () => {
        expect(parseCaccYear('2026')).to.equal(2026);
        expect(parseCaccYear(' 2000 ')).to.equal(2000);
        expect(parseCaccYear('2099')).to.equal(2099);
        expect(parseCaccYear('1999')).to.equal(null);
        expect(parseCaccYear('2100')).to.equal(null);
        expect(parseCaccYear('02026'), '02026').to.equal(null);
        expect(parseCaccYear('2026.0'), '2026.0').to.equal(null);
        expect(parseCaccYear('2026x')).to.equal(null);
        expect(parseCaccYear('26')).to.equal(null);
        expect(parseCaccYear('')).to.equal(null);
    });

    it('accepts only integer years inside 2000–2099', () => {
        expect(isCaccYear(2026)).to.equal(true);
        expect(isCaccYear(2000)).to.equal(true);
        expect(isCaccYear(2099)).to.equal(true);
        expect(isCaccYear(2026.5)).to.equal(false);
        expect(isCaccYear('2026')).to.equal(false);
        expect(isCaccYear(1999)).to.equal(false);
        expect(isCaccYear(2100)).to.equal(false);
        expect(isCaccYear(Number.NaN)).to.equal(false);
    });

    it('compares awards with the full 4×4 at-least table', () => {
        const awards = ['first', 'second', 'third', 'participant'] as const;
        const expected: Record<(typeof awards)[number], Record<(typeof awards)[number], boolean>> = {
            first: { first: true, second: true, third: true, participant: true },
            second: { first: false, second: true, third: true, participant: true },
            third: { first: false, second: false, third: true, participant: true },
            participant: { first: false, second: false, third: false, participant: true },
        };
        for (const actual of awards) {
            for (const min of awards) {
                expect(caccAwardAtLeast(actual, min), `${actual} at least ${min}`).to.equal(expected[actual][min]);
            }
        }
    });

    it('inserts when nothing is stored, upgrades a higher award, leaves the same award unchanged, and skips a lower award', () => {
        for (const incoming of ['first', 'second', 'third', 'participant'] as const) {
            expect(decideCaccImport(null, incoming), `insert ${incoming}`).to.equal('insert');
        }
        expect(decideCaccImport('third', 'second')).to.equal('upgrade');
        expect(decideCaccImport('participant', 'first')).to.equal('upgrade');
        expect(decideCaccImport('second', 'second'), 'unchanged').to.equal('unchanged');
        expect(decideCaccImport('first', 'third')).to.equal('skip');
        expect(decideCaccImport('third', 'participant')).to.equal('skip');
    });

    it('picks the higher award even from an earlier year, then the later year, and returns that same object', () => {
        expect(bestCaccScore([])).to.equal(null);

        const earlySecond = { award: 'second' as const, year: 2000 };
        const lateThird = { award: 'third' as const, year: 2099 };
        expect(bestCaccScore([lateThird, earlySecond])).to.equal(earlySecond);
        expect(bestCaccScore([earlySecond, lateThird])).to.equal(earlySecond);

        const earlier = { award: 'first' as const, year: 2024 };
        const later = { award: 'first' as const, year: 2026 };
        expect(bestCaccScore([earlier, later]), 'later year').to.equal(later);
        expect(bestCaccScore([later, earlier]), 'later year first').to.equal(later);
    });

    it('lists award options from first prize down to participation, and stage options as regional then final', () => {
        expect(CACC_AWARD_OPTIONS).to.deep.equal([
            { value: 'first', label: '一等奖' },
            { value: 'second', label: '二等奖' },
            { value: 'third', label: '三等奖' },
            { value: 'participant', label: '参赛' },
        ]);
        expect(CACC_STAGE_OPTIONS).to.deep.equal([
            { value: 'regional', label: '区域赛' },
            { value: 'final', label: '决赛' },
        ]);
    });

    it('starts every import line in src/cacc.ts with import type', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/krypton-tasks/src/cacc.ts'), 'utf8');
        const importLines = source.split(/\r?\n/).filter((line) => line.startsWith('import '));
        expect(importLines.length).to.be.greaterThan(0);
        for (const line of importLines) {
            expect(line.startsWith('import type '), line).to.equal(true);
        }
    });
});
