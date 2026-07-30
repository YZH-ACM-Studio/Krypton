import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import yaml from 'js-yaml';
import { formatRecordJudgeMessages } from '../src/lib/record-judge-presentation';

describe('record judge presentation', () => {
    it('formats translated placeholders once at the server response boundary without mutating the record', () => {
        const record = {
            compilerTexts: ['compiler output'],
            judgeTexts: [
                {
                    message: 'On line {0}: Read {1}, expect {2}.',
                    params: [3, 'foo', 'bar'],
                },
            ],
            testCases: [
                {
                    message: {
                        message: 'Your program returned {0}.',
                        params: [7],
                    },
                },
            ],
        };
        const translated = formatRecordJudgeMessages(record, (message) => {
            if (message === 'On line {0}: Read {1}, expect {2}.') return '第 {0} 行：读到 {1}，应为 {2}。';
            if (message === 'Your program returned {0}.') return '程序返回了 {0}。';
            return message;
        });

        assert.deepEqual(translated.compilerTexts, ['compiler output']);
        assert.deepEqual(translated.judgeTexts, ['第 3 行：读到 foo，应为 bar。']);
        assert.equal(translated.testCases[0].message, '程序返回了 7。');
        assert.equal(typeof record.judgeTexts[0], 'object');
        assert.equal(typeof record.testCases[0].message, 'object');
    });

    it('preserves legacy aliases and parameter suffixes while rejecting mismatched translated placeholders', () => {
        assert.deepEqual(
            formatRecordJudgeMessages(
                {
                    judgeTexts: [{ msg: 'Checker output', params: ['detail'] }],
                    testCases: [],
                },
                (message) => message,
            ).judgeTexts,
            ['Checker output detail'],
        );

        assert.throws(
            () =>
                formatRecordJudgeMessages(
                    {
                        judgeTexts: [{ message: 'Value {0}', params: ['x'] }],
                        testCases: [],
                    },
                    () => '值 {1}',
                ),
            /placeholder indexes/,
        );
    });

    it('formats the real line checker template through both Chinese judge catalogs', () => {
        const source = 'On line {0}: Read {1}, expect {2}.';
        for (const [locale, expected] of [
            ['zh', '第 3 行：读取到 foo，应为 bar。'],
            ['zh_TW', '第 3 行：讀取到 foo，應為 bar。'],
        ] as const) {
            const translations = yaml.load(readFileSync(resolve(process.cwd(), `packages/hydrojudge/locales/${locale}.yaml`), 'utf8')) as Record<
                string,
                string
            >;
            const formatted = formatRecordJudgeMessages(
                {
                    judgeTexts: [{ message: source, params: [3, 'foo', 'bar'] }],
                    testCases: [],
                },
                (message) => translations[message] || message,
            );
            assert.deepEqual(formatted.judgeTexts, [expected]);
        }
    });
});
