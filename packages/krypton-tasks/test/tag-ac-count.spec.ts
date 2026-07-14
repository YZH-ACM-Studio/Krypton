import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const presetsPath = require.resolve('../src/presets.ts');
const originalLoad = Module._load;

class TestValidationError extends Error {
    name = 'ValidationError';

    constructor(field: string, _value?: unknown, message?: string) {
        super(message || field);
    }
}

const catalog = [
    { value: '数据结构', label: '算法 / 数据结构', group: '算法知识点' },
    { value: 'L1', label: 'L1', group: '来源与赛事' },
];
let problemDocIds: number[] = [];
let acceptedProblemIds: number[] = [];
const problemQueries: Array<{ field: string; filter: any }> = [];
const recordQueries: Array<{ field: string; filter: any }> = [];
const catalogDomains: string[] = [];

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
                        async distinct(field: string, filter: any) {
                            problemQueries.push({ field, filter: structuredClone(filter) });
                            return [...problemDocIds];
                        },
                    },
                    collStatus: inertCollection,
                },
                listCanonicalProblemTagOptions: async (domainId: string) => {
                    catalogDomains.push(domainId);
                    return catalog.map((option) => ({ ...option }));
                },
                ObjectId,
                RecordModel: {
                    coll: {
                        async distinct(field: string, filter: any) {
                            recordQueries.push({ field, filter });
                            return [...acceptedProblemIds];
                        },
                        async countDocuments() {
                            return 0;
                        },
                        async findOne() {
                            return null;
                        },
                    },
                },
                STATUS: { STATUS_ACCEPTED: 1, STATUS_CANCELED: 0 },
                ValidationError: TestValidationError,
            };
        }
        if (request === '@hydrooj/krypton-userbind') {
            return {
                userBindModel: {
                    async findStudentByUserId() {
                        return null;
                    },
                },
            };
        }
        if (request === './db') {
            return {
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

function tagGraph(tag: unknown, count: unknown, dates: Record<string, unknown> = {}) {
    return {
        nodes: [
            { id: 'start', type: 'start' as const, position: { x: 0, y: 0 } },
            {
                id: 'tag-point',
                type: 'task' as const,
                position: { x: 0, y: 100 },
                presetId: 'tag_ac_count',
                name: 'AC 指定标签题目数',
                params: { tag, count, ...dates },
            },
            { id: 'end', type: 'end' as const, position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

async function captureFailure(work: Promise<unknown>) {
    try {
        await work;
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    problemDocIds = [];
    acceptedProblemIds = [];
    problemQueries.length = 0;
    recordQueries.length = 0;
    catalogDomains.length = 0;
});

describe('P2.5 tag AC count preset', () => {
    it('counts distinct accepted problem ids through two bounded queries and honors inclusive date boundaries', async () => {
        problemDocIds = [101, 102, 103];
        acceptedProblemIds = [101, 103];

        const result = await presets.taskPointPresets.tag_ac_count.checker(
            { domainId: 'system', userId: 42 },
            { tag: 'L1', count: 3, startDate: '2026-07-01', endDate: '2026-07-31' },
        );

        expect(problemQueries).to.deep.equal([{ field: 'docId', filter: { domainId: 'system', docType: 10, tag: 'L1' } }]);
        expect(recordQueries).to.have.length(1);
        expect(recordQueries[0].field).to.equal('pid');
        expect(recordQueries[0].filter).to.include({ domainId: 'system', uid: 42, status: 1 });
        expect(recordQueries[0].filter.pid).to.deep.equal({ $in: [101, 102, 103] });
        expect(recordQueries[0].filter._id.$gte.getTimestamp().toISOString()).to.equal('2026-06-30T16:00:00.000Z');
        expect(recordQueries[0].filter._id.$lte.getTimestamp().toISOString()).to.equal('2026-07-31T15:59:59.000Z');
        expect(result).to.deep.equal({ current: 2, target: 3, completed: false, details: '已 AC 2/3 道 L1 题目' });
    });

    it('skips the record query when the canonical tag currently matches no problem', async () => {
        const result = await presets.taskPointPresets.tag_ac_count.checker({ domainId: 'system', userId: 42 }, { tag: 'L1', count: 2 });

        expect(problemQueries).to.have.length(1);
        expect(recordQueries).to.have.length(0);
        expect(result).to.deep.equal({ current: 0, target: 2, completed: false, details: '已 AC 0/2 道 L1 题目' });
    });

    it('marks an algorithm-path target complete after two distinct accepted problems', async () => {
        problemDocIds = [201, 202, 203];
        acceptedProblemIds = [201, 202];

        const result = await presets.taskPointPresets.tag_ac_count.checker({ domainId: 'system', userId: 7 }, { tag: '数据结构', count: 2 });

        expect(problemQueries[0].filter.tag).to.equal('数据结构');
        expect(recordQueries[0].filter.pid).to.deep.equal({ $in: [201, 202, 203] });
        expect(result).to.deep.equal({ current: 2, target: 2, completed: true, details: '已 AC 2/2 道 数据结构 题目' });
    });

    it('re-reads the canonical catalog on save and rejects free, blank, dirty, or invalid-count values', async () => {
        await presets.validateTagAcCountGraph('system', tagGraph('L1', 3), 42);
        expect(catalogDomains).to.deep.equal(['system']);

        for (const [tag, count] of [
            ['随便写的标签', 3],
            ['', 3],
            [' L1 ', 3],
            ['L1', 0],
            ['L1', 1.5],
        ] as Array<[unknown, unknown]>) {
            const error = await captureFailure(presets.validateTagAcCountGraph('system', tagGraph(tag, count), 42));
            expect(error).to.be.instanceOf(TestValidationError);
        }
    });

    it('rejects invalid or reversed date windows at both save and check boundaries', async () => {
        for (const dates of [
            { startDate: 'not-a-date' },
            { endDate: '2026-99-99' },
            { startDate: '2026-02-30' },
            { startDate: '2026-08-01', endDate: '2026-07-31' },
            { startDate: '1969-12-31' },
            { endDate: '2106-02-08' },
            { endDate: '9999-12-31' },
        ]) {
            const saveError = await captureFailure(presets.validateTagAcCountGraph('system', tagGraph('L1', 3, dates), 42));
            expect(saveError).to.be.instanceOf(TestValidationError);

            const checkError = await captureFailure(
                presets.taskPointPresets.tag_ac_count.checker({ domainId: 'system', userId: 42 }, { tag: 'L1', count: 3, ...dates }),
            );
            expect(checkError).to.be.instanceOf(TestValidationError);
        }
        expect(problemQueries).to.have.length(0);

        await presets.validateTagAcCountGraph('system', tagGraph('L1', 3, { startDate: '2026-07-14', endDate: '2026-07-14' }), 42);
    });

    it('does not replace a non-empty invalid node date with the task-level date', async () => {
        const result = await presets.runChecker(
            'tag_ac_count',
            { domainId: 'system', userId: 42, startDate: new Date('2026-07-01T00:00:00+08:00') },
            { tag: 'L1', count: 3, startDate: 'not-a-date' },
        );

        expect(problemQueries).to.have.length(0);
        expect(result).to.deep.equal({
            completed: false,
            current: 0,
            target: 0,
            details: '校验错误: 开始日期格式无效',
        });
    });

    it('preserves task-level date inheritance for existing presets with an invalid node date', async () => {
        await presets.runChecker(
            'ac_count',
            { domainId: 'system', userId: 42, startDate: new Date('2026-07-01T00:00:00+08:00') },
            { count: 3, startDate: 'not-a-date' },
        );

        expect(recordQueries).to.have.length(1);
        expect(recordQueries[0].filter._id.$gte.getTimestamp().toISOString()).to.equal('2026-06-30T16:00:00.000Z');
    });

    it('exposes the grouped catalog only on the canonical tag parameter', async () => {
        const summaries = presets.presetSummaries(await presets.listTagAcCountOptions('system'));
        const preset = summaries.find((item) => item.id === 'tag_ac_count');

        expect(preset?.name).to.equal('AC 指定标签题目数');
        expect(preset?.params[0]).to.deep.include({ name: 'tag', type: 'canonical_tag', required: true });
        expect(preset?.params[0].options).to.deep.equal(catalog);
        expect(preset?.params[1]).to.deep.include({ name: 'count', type: 'number', required: true });
    });
});
