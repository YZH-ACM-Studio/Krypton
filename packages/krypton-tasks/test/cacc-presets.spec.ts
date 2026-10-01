import { expect } from 'chai';
import { localizedErrorText } from '@hydrooj/framework';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const presetsPath = require.resolve('../src/presets.ts');
const originalLoad = Module._load;

const STUDENT = new ObjectId();
const OTHER_STUDENT = new ObjectId();

interface CaccRow {
    domainId: string;
    studentDocId: ObjectId;
    year: number;
    stage: string;
    award: string;
}

const scores: CaccRow[] = [];
const queries = { findOne: 0, find: 0 };

function valuesEqual(actual: unknown, expected: unknown): boolean {
    if (actual instanceof ObjectId || expected instanceof ObjectId) return String(actual) === String(expected);
    return actual === expected;
}

function matches(doc: CaccRow, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, expected]) => valuesEqual(doc[key as keyof CaccRow], expected));
}

const inertCollection = {
    async findOne() {
        return null;
    },
    find() {
        return {
            sort() {
                return this;
            },
            limit() {
                return this;
            },
            async next() {
                return null;
            },
        };
    },
    async countDocuments() {
        return 0;
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === presetsPath) {
        if (request === 'hydrooj') {
            return {
                ContestModel: {},
                DocumentModel: {
                    TYPE_CONTEST: 30,
                    TYPE_PROBLEM: 10,
                    TYPE_TRAINING: 40,
                    coll: {
                        async distinct() {
                            return [];
                        },
                    },
                    collStatus: inertCollection,
                },
                listCanonicalProblemTagOptions: async () => [],
                ObjectId,
                RecordModel: {
                    coll: {
                        async distinct() {
                            return [];
                        },
                        async countDocuments() {
                            return 0;
                        },
                        async findOne() {
                            return null;
                        },
                    },
                },
                localizedErrorText,
                STATUS: { STATUS_ACCEPTED: 1, STATUS_CANCELED: 0 },
                ValidationError: class TestValidationError extends Error {
                    name = 'ValidationError';
                },
            };
        }
        if (request === '@hydrooj/krypton-userbind') {
            return {
                userBindModel: {
                    async findStudentByUserId(_domainId: string, userId: number) {
                        if (userId === 1) return { _id: STUDENT };
                        return null;
                    },
                },
            };
        }
        if (request === './db') {
            return {
                caccScoreColl: {
                    async findOne(filter: Record<string, unknown>) {
                        queries.findOne += 1;
                        return scores.find((doc) => matches(doc, filter)) ?? null;
                    },
                    find(filter: Record<string, unknown>) {
                        queries.find += 1;
                        const matched = scores.filter((doc) => matches(doc, filter));
                        return {
                            async toArray() {
                                return matched;
                            },
                        };
                    },
                },
                cspScoreColl: inertCollection,
                gpltScoreColl: inertCollection,
                patScoreColl: inertCollection,
                stayEventsColl: inertCollection,
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let presets: typeof import('../src/presets');
try {
    delete require.cache[presetsPath];
    presets = require(presetsPath);
} finally {
    Module._load = originalLoad;
}

const stageOptions = [
    { value: 'regional', label: '区域赛' },
    { value: 'final', label: '决赛' },
];
const awardOptions = [
    { value: 'first', label: '一等奖' },
    { value: 'second', label: '二等奖' },
    { value: 'third', label: '三等奖' },
    { value: 'participant', label: '参赛' },
];

const specificParams = [
    { name: 'year', type: 'number', label: '年份', default: new Date().getFullYear(), required: true },
    { name: 'stage', type: 'select', label: '比赛级别', default: 'regional', required: true, options: stageOptions },
    { name: 'minAward', type: 'select', label: '最低等级', default: 'third', required: true, options: awardOptions },
];
const anyParams = [
    { name: 'stage', type: 'select', label: '比赛级别', default: 'regional', required: true, options: stageOptions },
    { name: 'minAward', type: 'select', label: '最低等级', default: 'third', required: true, options: awardOptions },
];

function seed(rows: Array<Pick<CaccRow, 'year' | 'stage' | 'award'> & { domainId?: string; studentDocId?: ObjectId }>) {
    scores.splice(0, scores.length, ...rows.map((row) => ({
        domainId: row.domainId ?? 'system',
        studentDocId: row.studentDocId ?? STUDENT,
        year: row.year,
        stage: row.stage,
        award: row.award,
    })));
}

const bound = { userId: 1, domainId: 'system' };

beforeEach(() => {
    scores.splice(0, scores.length);
    queries.findOne = 0;
    queries.find = 0;
});

describe('CACC task point presets', { concurrency: false }, () => {
    it('registers both presets in the registry and summaries with select params', () => {
        const specific = presets.taskPointPresets.cacc_specific_year;
        const any = presets.taskPointPresets.cacc_any_year;
        expect(specific).to.include({
            id: 'cacc_specific_year',
            name: 'CACC 指定年份达标',
            category: 'behavior',
            description: '用户在指定年份、指定级别的 CACC 中达到指定等级',
        });
        expect(any).to.include({
            id: 'cacc_any_year',
            name: 'CACC 任意年份达标',
            category: 'behavior',
            description: '用户在任意一年指定级别的 CACC 中达到指定等级即可',
        });
        expect(specific.params).to.deep.equal(specificParams);
        expect(any.params).to.deep.equal(anyParams);

        const summaries = presets.presetSummaries();
        const specificSummary = summaries.find((item) => item.id === 'cacc_specific_year');
        const anySummary = summaries.find((item) => item.id === 'cacc_any_year');
        expect(specificSummary?.params).to.deep.equal(specificParams);
        expect(anySummary?.params).to.deep.equal(anyParams);
    });

    it('completes a specific year when the stored award meets the minimum', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'second' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'third' });

        expect(result).to.deep.equal({
            completed: true,
            current: 1,
            target: 1,
            details: '2026 年 区域赛二等奖（需 区域赛三等奖及以上）',
        });
    });

    it('does not complete a specific year when the stored award is below the minimum', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'second' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'first' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 1,
            details: '2026 年 区域赛二等奖（需 区域赛一等奖及以上）',
        });
    });

    it('does not treat a final award as regional participation', async () => {
        seed([{ year: 2026, stage: 'final', award: 'first' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'participant' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('未参加 2026 年 CACC 区域赛')).to.equal(true);
    });

    it('does not treat another year as the requested year', async () => {
        seed([{ year: 2025, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'third' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('未参加 2026 年 CACC 区域赛')).to.equal(true);
    });

    it('does not treat another domain score as the specific year', async () => {
        seed([{ domainId: 'other', year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'participant' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('未参加 2026 年 CACC 区域赛')).to.equal(true);
    });

    it('does not treat another student score as the specific year', async () => {
        seed([{ studentDocId: OTHER_STUDENT, year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'participant' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('未参加 2026 年 CACC 区域赛')).to.equal(true);
    });

    it('completes a specific year when participation meets a participation minimum', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'participant' }]);

        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'participant' });

        expect(result).to.deep.equal({
            completed: true,
            current: 1,
            target: 1,
            details: '2026 年 区域赛参赛（需 区域赛参赛及以上）',
        });
    });

    it('reports an unbound user without querying CACC scores', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_specific_year', { userId: 2, domainId: 'system' }, {
            year: 2026,
            stage: 'regional',
            minAward: 'third',
        });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 1,
            details: '未绑定学生档案',
        });
        expect(queries).to.deep.equal({ findOne: 0, find: 0 });
    });

    it('reports an unbound user on any year without querying CACC scores', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_any_year', { userId: 2, domainId: 'system' }, {
            stage: 'regional',
            minAward: 'third',
        });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 1,
            details: '未绑定学生档案',
        });
        expect(queries).to.deep.equal({ findOne: 0, find: 0 });
    });

    it('rejects an unknown stage as an invalid CACC parameter', async () => {
        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'all', minAward: 'third' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
        expect(queries).to.deep.equal({ findOne: 0, find: 0 });
    });

    it('rejects an unknown award as an invalid CACC parameter', async () => {
        const result = await presets.runChecker('cacc_specific_year', bound, { year: 2026, stage: 'regional', minAward: 'gold' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
    });

    it('rejects a year below 2000 as an invalid CACC parameter', async () => {
        const result = await presets.runChecker('cacc_specific_year', bound, { year: 1999, stage: 'regional', minAward: 'third' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
    });

    it('rejects a blank year as an invalid CACC parameter', async () => {
        const result = await presets.runChecker('cacc_specific_year', bound, { year: '', stage: 'regional', minAward: 'third' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
    });

    it('uses the best same-stage award and ignores the other stage', async () => {
        seed([
            { year: 2024, stage: 'regional', award: 'first' },
            { year: 2026, stage: 'regional', award: 'third' },
            { year: 2026, stage: 'final', award: 'first' },
        ]);

        const regional = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'second' });
        expect(regional.completed).to.equal(true);
        expect(regional.current).to.equal(1);
        expect(regional.target).to.equal(1);
        expect(regional.details.startsWith('最佳: 2024 年 区域赛一等奖')).to.equal(true);

        const final = await presets.runChecker('cacc_any_year', bound, { stage: 'final', minAward: 'second' });
        expect(final.completed).to.equal(true);
        expect(final.current).to.equal(1);
        expect(final.target).to.equal(1);
        expect(final.details.startsWith('最佳: 2026 年 决赛一等奖')).to.equal(true);
    });

    it('does not complete any year when the best award is below the minimum', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'third' }]);

        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'first' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 1,
            details: '最佳: 2026 年 区域赛三等奖（需 区域赛一等奖及以上）',
        });
    });

    it('rejects an unknown stage on any year without querying', async () => {
        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'all', minAward: 'third' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
        expect(queries).to.deep.equal({ findOne: 0, find: 0 });
    });

    it('rejects an unknown award on any year without querying', async () => {
        seed([{ year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'gold' });

        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: CACC 任务点参数无效',
        });
        expect(queries).to.deep.equal({ findOne: 0, find: 0 });
    });

    it('does not treat another student score as any year', async () => {
        seed([{ studentDocId: OTHER_STUDENT, year: 2026, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'participant' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('暂无 CACC 区域赛成绩')).to.equal(true);
    });

    it('does not treat another domain score as any year', async () => {
        seed([{ domainId: 'other', year: 2024, stage: 'regional', award: 'first' }]);

        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'second' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('暂无 CACC 区域赛成绩')).to.equal(true);
    });

    it('reports no score when that stage has no records', async () => {
        seed([{ year: 2026, stage: 'final', award: 'first' }]);

        const result = await presets.runChecker('cacc_any_year', bound, { stage: 'regional', minAward: 'third' });

        expect(result.completed).to.equal(false);
        expect(result.current).to.equal(0);
        expect(result.target).to.equal(1);
        expect(result.details.startsWith('暂无 CACC 区域赛成绩')).to.equal(true);
    });
});
