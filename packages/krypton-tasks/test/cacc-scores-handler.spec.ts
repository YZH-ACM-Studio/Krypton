import { localizedErrorText } from '@hydrooj/framework';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const handlerPath = require.resolve('../src/handler.ts');
const originalLoad = Module._load;

const STUDENT_1 = new ObjectId();
const STUDENT_2 = new ObjectId();

interface CaccDoc {
    _id: ObjectId;
    domainId: string;
    studentDocId: ObjectId;
    year: number;
    stage: string;
    award: string;
    createdAt: Date;
    createdBy: number;
    updatedAt?: Date;
    updatedBy?: number;
}

interface FindCall {
    filter: Record<string, unknown>;
    sort: Record<string, number> | null;
    limit: number | null;
    rows: CaccDoc[];
}

const students = new Map<string, { studentId: string; realName: string; schoolId: string; boundUserId: number | null }>([
    [String(STUDENT_1), { studentId: 'S1', realName: '张三', schoolId: 'sch', boundUserId: 4 }],
    [String(STUDENT_2), { studentId: 'S2', realName: '李四', schoolId: 'sch', boundUserId: null }],
]);

const store: CaccDoc[] = [];
const calls = {
    insertOne: 0,
    updateOne: 0,
    deleteOne: 0,
    lastUpdate: null as null | { filter: Record<string, unknown>; update: unknown; options?: { upsert?: boolean } },
    lastDelete: null as null | Record<string, unknown>,
    lastFind: null as null | FindCall,
    uids: [] as number[],
};
let insertError: Error | null = null;

function valuesEqual(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

function matches(doc: CaccDoc, filter: Record<string, unknown>): boolean {
    const record = doc as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(filter)) {
        if (!valuesEqual(record[key], value)) return false;
    }
    return true;
}

function compareField(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    }
    const leftText = String(left);
    const rightText = String(right);
    if (leftText < rightText) return -1;
    if (leftText > rightText) return 1;
    return 0;
}

const caccScoreColl = {
    async findOne(filter: Record<string, unknown>) {
        return store.find((doc) => matches(doc, filter)) ?? null;
    },
    async insertOne(doc: CaccDoc) {
        if (insertError) throw insertError;
        calls.insertOne += 1;
        store.push(doc);
        return { insertedId: doc._id };
    },
    async updateOne(
        filter: Record<string, unknown>,
        update: { $set?: Partial<CaccDoc>; $setOnInsert?: Partial<CaccDoc> },
        options?: { upsert?: boolean },
    ) {
        calls.updateOne += 1;
        calls.lastUpdate = { filter, update, options };
        const index = store.findIndex((doc) => matches(doc, filter));
        if (index >= 0) {
            Object.assign(store[index], update.$set ?? {});
            return { matchedCount: 1 };
        }
        if (options?.upsert) {
            store.push({
                ...(update.$setOnInsert ?? {}),
                ...filter,
                ...(update.$set ?? {}),
            } as CaccDoc);
            return { upsertedCount: 1 };
        }
        return { matchedCount: 0 };
    },
    async deleteOne(filter: Record<string, unknown>) {
        calls.deleteOne += 1;
        calls.lastDelete = filter;
        const index = store.findIndex((doc) => matches(doc, filter));
        if (index < 0) return { deletedCount: 0 };
        store.splice(index, 1);
        return { deletedCount: 1 };
    },
    find(filter: Record<string, unknown>) {
        const query = {
            sortSpec: null as Record<string, number> | null,
            limitN: null as number | null,
            sort(spec: Record<string, number>) {
                this.sortSpec = spec;
                return this;
            },
            limit(count: number) {
                this.limitN = count;
                return this;
            },
            async toArray() {
                let rows = store.filter((doc) => matches(doc, filter));
                if (this.sortSpec) {
                    const spec: Record<string, number> = this.sortSpec;
                    rows = rows.slice().sort((left, right) => {
                        const recordLeft = left as unknown as Record<string, unknown>;
                        const recordRight = right as unknown as Record<string, unknown>;
                        for (const [key, direction] of Object.entries(spec)) {
                            const compared = compareField(recordLeft[key], recordRight[key]);
                            if (compared !== 0) return compared * direction;
                        }
                        return 0;
                    });
                }
                if (this.limitN != null) rows = rows.slice(0, this.limitN);
                calls.lastFind = {
                    filter: { ...filter },
                    sort: this.sortSpec ? { ...this.sortSpec } : null,
                    limit: this.limitN,
                    rows,
                };
                return rows;
            },
        };
        return query;
    },
};

class FakeValidationError extends Error {
    readonly field: string;

    constructor(field: string, _expected: unknown, detail?: unknown) {
        super(detail == null ? '' : String(detail));
        this.name = 'ValidationError';
        this.field = field;
    }
}

class FakeHandler {
    user: any;
    response: Record<string, any> = {};

    url(_name: string, params: { query: { tab: string } }) {
        return `/admin/tasks/scores?tab=${params.query.tab}`;
    }
}

const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

const userBindModel = {
    async findStudentsByStudentId(_domainId: string, studentId: string) {
        if (studentId === 'S1') return [{ _id: STUDENT_1 }];
        if (studentId === 'S2') return [{ _id: STUDENT_2 }];
        if (studentId === 'DUP') return [{ _id: new ObjectId() }, { _id: new ObjectId() }];
        return [];
    },
    async getStudent(_domainId: string, sid: ObjectId) {
        return students.get(String(sid)) ?? null;
    },
};

const taskModel = {
    async getDomainSettings() {
        return { maxPatScore: 100, maxGpltScore: 290, maxCspScore: 500 };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                DocumentModel: { TYPE_CONTEST: 30, TYPE_TRAINING: 40, coll: {} },
                ForbiddenError: class extends Error {},
                Handler: FakeHandler,
                NotFoundError: class extends Error {},
                ObjectId,
                OplogModel: { log: async () => undefined },
                param,
                PRIV: { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 },
                ProblemModel: {},
                requireAuthToken: async () => ({}),
                Types,
                UserModel: {
                    async getList(_domainId: string, uids: number[]) {
                        calls.uids = uids;
                        const listed: Record<number, { uname: string }> = {};
                        for (const uid of uids) listed[uid] = { uname: `user-${uid}` };
                        return listed;
                    },
                },
                ValidationError: FakeValidationError,
                localizeError: (error: unknown) => error,
                localizedErrorText,
                assertGroupsAttachable: () => undefined,
                describeGroupRefs: () => [],
                listAttachableGroups: async () => [],
                parseGroupIdList: () => [],
            };
        }
        if (request === '@hydrooj/krypton-userbind') return { userBindModel };
        if (request === './auth') {
            return {
                canCreateTask: () => true,
                canManageAllTasks: () => false,
                canModifyTask: () => true,
            };
        }
        if (request === './db') return { caccScoreColl, cspScoreColl: {}, gpltScoreColl: {}, patScoreColl: {} };
        if (request === './model') return { taskModel, TaskAssignmentTransitionError: class extends Error {} };
        if (request === './presets') {
            return {
                listTagAcCountOptions: async () => [],
                presetSummaries: () => [],
                validateTagAcCountGraph: async () => undefined,
            };
        }
        if (request === './types') return { emptyTaskGraph: () => ({ nodes: [], edges: [] }) };
        if (request === './stats-export') return { buildTaskStatsCsv: () => '', defaultTaskGroupName: () => '' };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let AdminScoresHandler: any;
try {
    delete require.cache[handlerPath];
    ({ AdminScoresHandler } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function createHandler() {
    const instance = Reflect.construct(AdminScoresHandler, []) as FakeHandler;
    instance.user = { _id: 9 };
    instance.response = {};
    return instance as any;
}

function seed(partial: Partial<CaccDoc> = {}): CaccDoc {
    const doc: CaccDoc = {
        _id: partial._id ?? new ObjectId(),
        domainId: partial.domainId ?? 'system',
        studentDocId: partial.studentDocId ?? STUDENT_1,
        year: partial.year ?? 2026,
        stage: partial.stage ?? 'regional',
        award: partial.award ?? 'third',
        createdAt: partial.createdAt ?? new Date('2020-01-01T00:00:00.000Z'),
        createdBy: partial.createdBy ?? 1,
        updatedAt: partial.updatedAt,
        updatedBy: partial.updatedBy,
    };
    store.push(doc);
    return doc;
}

async function captureFailure(run: Promise<unknown>): Promise<any> {
    try {
        await run;
        return null;
    } catch (error) {
        return error;
    }
}

async function importRows(text: string) {
    const instance = createHandler();
    await instance.postCaccImport({ domainId: 'system' }, text);
    return instance;
}

function onlyDoc(): CaccDoc {
    expect(store).to.have.length(1);
    return store[0];
}

beforeEach(() => {
    store.length = 0;
    insertError = null;
    calls.insertOne = 0;
    calls.updateOne = 0;
    calls.deleteOne = 0;
    calls.lastUpdate = null;
    calls.lastDelete = null;
    calls.lastFind = null;
    calls.uids = [];
});

describe('AdminScoresHandler CACC', () => {
    it('imports a new CACC award', async () => {
        const instance = await importRows('S1,2026,区域赛,二等奖');

        expect(instance.response.body).to.deep.equal({ success: true, imported: 1, errors: [] });
        const doc = onlyDoc();
        expect(doc.domainId).to.equal('system');
        expect(String(doc.studentDocId)).to.equal(String(STUDENT_1));
        expect(doc.year).to.equal(2026);
        expect(doc.stage).to.equal('regional');
        expect(doc.award).to.equal('second');
        expect(doc.createdBy).to.equal(9);
        expect(doc.createdAt).to.be.instanceOf(Date);
        expect(calls.updateOne).to.equal(0);
    });

    it('upgrades a lower award and records who updated it', async () => {
        const existing = seed({ award: 'third', createdBy: 1 });
        const instance = await importRows('S1,2026,区域赛,一等');

        expect(instance.response.body).to.deep.equal({ success: true, imported: 1, errors: [] });
        expect(store).to.have.length(1);
        expect(store[0]._id).to.equal(existing._id);
        expect(store[0].award).to.equal('first');
        expect(store[0].updatedBy).to.equal(9);
        expect(store[0].createdBy).to.equal(1);
        expect(calls.insertOne).to.equal(0);
        expect(calls.updateOne).to.equal(1);
    });

    it('counts an identical award without writing', async () => {
        seed({ award: 'second' });
        const instance = await importRows('S1,2026,regional,second');

        expect(instance.response.body).to.deep.equal({ success: true, imported: 1, errors: [] });
        expect(calls.insertOne).to.equal(0);
        expect(calls.updateOne).to.equal(0);
        expect(onlyDoc().award).to.equal('second');
        expect(onlyDoc().updatedBy).to.equal(undefined);
    });

    it('skips a lower award without writing and names the existing award', async () => {
        seed({ award: 'first' });
        const instance = await importRows('S1,2026,区域赛,参赛');

        expect(instance.response.body).to.deep.equal({
            success: true,
            imported: 0,
            errors: ['学号 S1: 2026 年区域赛已有更高等级（一等奖），本行参赛已跳过'],
        });
        expect(calls.insertOne).to.equal(0);
        expect(calls.updateOne).to.equal(0);
        expect(onlyDoc().award).to.equal('first');
    });

    it('keeps the highest award regardless of row order', async () => {
        await importRows('S1,2026,regional,first\nS1,2026,regional,participant');
        expect(store.map((doc) => doc.award)).to.deep.equal(['first']);

        store.length = 0;
        await importRows('S1,2026,regional,participant\nS1,2026,regional,first');
        expect(store.map((doc) => doc.award)).to.deep.equal(['first']);
        expect(onlyDoc().stage).to.equal('regional');
        expect(onlyDoc().year).to.equal(2026);
    });

    it('stores regional and final awards separately', async () => {
        const instance = await importRows('S1,2026,区域赛,一等奖\nS1,2026,决赛,参赛');

        expect(instance.response.body.imported).to.equal(2);
        expect(instance.response.body.errors).to.deep.equal([]);
        expect(store.map((doc) => ({ stage: doc.stage, award: doc.award }))).to.deep.equal([
            { stage: 'regional', award: 'first' },
            { stage: 'final', award: 'participant' },
        ]);
    });

    it('imports a different year as a new award', async () => {
        const existing = seed({ year: 2024, stage: 'regional', award: 'first' });
        const instance = await importRows('S1,2026,区域赛,三等奖');

        expect(instance.response.body).to.deep.equal({ success: true, imported: 1, errors: [] });
        expect(store).to.have.length(2);
        expect(store[0]._id).to.equal(existing._id);
        expect(store[0].year).to.equal(2024);
        expect(store[0].award).to.equal('first');
        expect(store[0].updatedBy).to.equal(undefined);
        expect(store[1].year).to.equal(2026);
        expect(store[1].stage).to.equal('regional');
        expect(store[1].award).to.equal('third');
        expect(String(store[1].studentDocId)).to.equal(String(STUDENT_1));
        expect(calls.insertOne).to.equal(1);
        expect(calls.updateOne).to.equal(0);
    });

    it('imports a different student as a new award', async () => {
        const existing = seed({ studentDocId: STUDENT_2, year: 2026, stage: 'regional', award: 'second' });
        const instance = await importRows('S1,2026,区域赛,一等奖');

        expect(instance.response.body).to.deep.equal({ success: true, imported: 1, errors: [] });
        expect(store).to.have.length(2);
        expect(store[0]._id).to.equal(existing._id);
        expect(String(store[0].studentDocId)).to.equal(String(STUDENT_2));
        expect(store[0].award).to.equal('second');
        expect(store[0].updatedBy).to.equal(undefined);
        expect(String(store[1].studentDocId)).to.equal(String(STUDENT_1));
        expect(store[1].year).to.equal(2026);
        expect(store[1].stage).to.equal('regional');
        expect(store[1].award).to.equal('first');
        expect(calls.insertOne).to.equal(1);
        expect(calls.updateOne).to.equal(0);
    });

    it('does not change a score stored in another domain', async () => {
        seed({ domainId: 'other', award: 'third' });
        await importRows('S1,2026,区域赛,一等奖');

        expect(store.map((doc) => ({ domainId: doc.domainId, award: doc.award }))).to.deep.equal([
            { domainId: 'other', award: 'third' },
            { domainId: 'system', award: 'first' },
        ]);
    });

    it('reports each invalid import row and still imports a valid one', async () => {
        const instance = await importRows([
            'S1,1999,区域赛,一等奖',
            'S1,02026,区域赛,一等奖',
            'S1,2026,省赛,一等奖',
            'S1,2026,区域赛,特等奖',
            'NOPE,2026,区域赛,一等奖',
            'DUP,2026,决赛,二等奖',
            'S2,2025,决赛,三等奖',
        ].join('\n'));

        expect(instance.response.body).to.deep.equal({
            success: true,
            imported: 1,
            errors: [
                '学号 S1: 年份无效 (2000-2099)',
                '学号 S1: 年份无效 (2000-2099)',
                '学号 S1: 级别无效 (区域赛/决赛)',
                '学号 S1: 等级无效 (一等奖/二等奖/三等奖/参赛)',
                '学号 NOPE: 未找到学生档案',
                '学号 DUP: 未找到学生档案',
            ],
        });
        const doc = onlyDoc();
        expect(String(doc.studentDocId)).to.equal(String(STUDENT_2));
        expect(doc.year).to.equal(2025);
        expect(doc.stage).to.equal('final');
        expect(doc.award).to.equal('third');
        expect(calls.insertOne).to.equal(1);
        expect(calls.updateOne).to.equal(0);
    });

    it('reports a row that does not have four fields', async () => {
        const instance = await importRows('S1,2026,区域赛\nS2,2024,final,参赛');

        expect(instance.response.body).to.deep.equal({
            success: true,
            imported: 1,
            errors: ['第 1 行: 字段数不足，需要 4 列'],
        });
        const doc = onlyDoc();
        expect(String(doc.studentDocId)).to.equal(String(STUDENT_2));
        expect(doc.year).to.equal(2024);
        expect(doc.stage).to.equal('final');
        expect(doc.award).to.equal('participant');
    });

    it('single entry overwrites an award, including a downgrade', async () => {
        const existing = seed({ award: 'first', createdBy: 3 });
        const instance = createHandler();
        await instance.postCacc({ domainId: 'system' }, 'S1', 2026, 'regional', 'participant');

        expect(store).to.have.length(1);
        expect(store[0]._id).to.equal(existing._id);
        expect(store[0].award).to.equal('participant');
        expect(store[0].updatedBy).to.equal(9);
        expect(store[0].createdBy).to.equal(3);
        expect(instance.response.redirect).to.equal('/admin/tasks/scores?tab=cacc');
    });

    it('single entry creates a missing award with createdAt and createdBy', async () => {
        const instance = createHandler();
        await instance.postCacc({ domainId: 'system' }, 'S1', 2026, 'final', 'second');

        const doc = onlyDoc();
        expect(doc.domainId).to.equal('system');
        expect(String(doc.studentDocId)).to.equal(String(STUDENT_1));
        expect(doc.year).to.equal(2026);
        expect(doc.stage).to.equal('final');
        expect(doc.award).to.equal('second');
        expect(doc.createdAt).to.be.instanceOf(Date);
        expect(doc.createdBy).to.equal(9);
        expect(calls.insertOne).to.equal(0);
        expect(calls.updateOne).to.equal(1);
        expect(calls.lastUpdate?.options).to.deep.equal({ upsert: true });
        expect(instance.response.redirect).to.equal('/admin/tasks/scores?tab=cacc');
    });

    it('single entry rejects year 1999 without writing', async () => {
        const instance = createHandler();
        const error = await captureFailure(instance.postCacc({ domainId: 'system' }, 'S1', 1999, 'regional', 'first'));

        expect(error).to.be.instanceOf(FakeValidationError);
        expect(error.field).to.equal('year');
        expect(error.message).to.equal('年份无效，请填写 2000 到 2099 之间的年份');
        expect(store).to.deep.equal([]);
        expect(calls.insertOne).to.equal(0);
        expect(calls.updateOne).to.equal(0);
    });

    it('single entry rejects an invalid stage without writing', async () => {
        const instance = createHandler();
        const error = await captureFailure(instance.postCacc({ domainId: 'system' }, 'S1', 2026, 'all', 'first'));

        expect(error).to.be.instanceOf(FakeValidationError);
        expect(error.field).to.equal('stage');
        expect(error.message).to.equal('CACC 级别无效，请选择区域赛或决赛');
        expect(store).to.deep.equal([]);
        expect(calls.updateOne).to.equal(0);
    });

    it('single entry rejects an invalid award without writing', async () => {
        const instance = createHandler();
        const error = await captureFailure(instance.postCacc({ domainId: 'system' }, 'S1', 2026, 'regional', 'gold'));

        expect(error).to.be.instanceOf(FakeValidationError);
        expect(error.field).to.equal('award');
        expect(error.message).to.equal('CACC 等级无效，请选择一等奖、二等奖、三等奖或参赛');
        expect(store).to.deep.equal([]);
        expect(calls.updateOne).to.equal(0);
    });

    it('single entry rejects an unknown student without writing', async () => {
        const instance = createHandler();
        const error = await captureFailure(instance.postCacc({ domainId: 'system' }, 'NOPE', 2026, 'regional', 'first'));

        expect(error).to.be.instanceOf(FakeValidationError);
        expect(error.field).to.equal('studentId');
        expect(error.message).to.equal('学号 NOPE: 未找到学生档案');
        expect(store).to.deep.equal([]);
        expect(calls.updateOne).to.equal(0);
    });

    it('deletes only the score whose domainId and id both match', async () => {
        const sharedId = new ObjectId();
        const other = seed({ _id: sharedId, domainId: 'other', award: 'first' });
        seed({ _id: sharedId, domainId: 'system', award: 'second' });
        const sibling = seed({ domainId: 'system', award: 'third', year: 2025 });
        const instance = createHandler();

        await instance.postCaccDelete({ domainId: 'system' }, sharedId);

        expect(calls.lastDelete).to.deep.equal({ domainId: 'system', _id: sharedId });
        expect(store.map((doc) => String(doc._id))).to.deep.equal([String(other._id), String(sibling._id)]);
        expect(store.map((doc) => doc.domainId)).to.deep.equal(['other', 'system']);
        expect(store[0].award).to.equal('first');
        expect(instance.response.redirect).to.equal('/admin/tasks/scores?tab=cacc');
    });

    it('filters the CACC list by stage and year', async () => {
        const finalScore = seed({ year: 2026, stage: 'final', award: 'first' });
        seed({ year: 2026, stage: 'regional', award: 'second', studentDocId: STUDENT_2 });
        seed({ year: 2025, stage: 'final', award: 'third' });
        seed({ domainId: 'other', year: 2026, stage: 'final', award: 'participant', studentDocId: STUDENT_2 });
        const instance = createHandler();

        await instance.get({ domainId: 'system' }, 'cacc', 'final', 2026);

        expect(calls.lastFind?.filter).to.deep.equal({ domainId: 'system', stage: 'final', year: 2026 });
        expect(calls.lastFind?.sort).to.deep.equal({ year: -1, stage: 1, studentDocId: 1 });
        expect(calls.lastFind?.limit).to.equal(500);
        expect(instance.response.template).to.equal('admin_tasks_scores.html');
        expect(instance.response.body.tab).to.equal('cacc');
        expect(instance.response.body.scores).to.equal(calls.lastFind?.rows);
        expect(instance.response.body.scores).to.deep.equal([finalScore]);
        expect(instance.response.body.stayEvents).to.deep.equal([]);
        expect(instance.response.body.schools).to.deep.equal([]);
        expect(instance.response.body.level).to.equal('final');
        expect(instance.response.body.year).to.equal(2026);
        expect(instance.response.body.settings).to.deep.equal({ maxPatScore: 100, maxGpltScore: 290, maxCspScore: 500 });
        expect(instance.response.body.studentDict).to.deep.equal({
            [String(STUDENT_1)]: { studentId: 'S1', realName: '张三', schoolId: 'sch', boundUserId: 4 },
        });
        expect(instance.response.body.udict).to.deep.equal({ 4: { uname: 'user-4' } });
    });

    it('ignores an unknown stage and an empty year when listing', async () => {
        seed({ year: 2026, stage: 'final', award: 'first' });
        seed({ year: 2024, stage: 'regional', award: 'third', studentDocId: STUDENT_2 });
        seed({ domainId: 'other', year: 2026, stage: 'final', award: 'participant' });
        const instance = createHandler();

        await instance.get({ domainId: 'system' }, 'cacc', 'bogus', 0);

        expect(calls.lastFind?.filter).to.deep.equal({ domainId: 'system' });
        expect(calls.lastFind?.sort).to.deep.equal({ year: -1, stage: 1, studentDocId: 1 });
        expect(calls.lastFind?.limit).to.equal(500);
        expect(instance.response.template).to.equal('admin_tasks_scores.html');
        expect(instance.response.body.tab).to.equal('cacc');
        expect(instance.response.body.scores).to.equal(calls.lastFind?.rows);
        expect(instance.response.body.scores).to.have.length(2);
        expect(instance.response.body.level).to.equal('bogus');
        expect(instance.response.body.year).to.equal(0);
        expect(instance.response.body.stayEvents).to.deep.equal([]);
        expect(instance.response.body.schools).to.deep.equal([]);
    });

    it('propagates an insertOne duplicate-key error', async () => {
        insertError = new Error('E11000 duplicate key');
        const instance = createHandler();
        const error = await captureFailure(instance.postCaccImport({ domainId: 'system' }, 'S1,2026,区域赛,一等奖'));

        expect(error).to.equal(insertError);
        expect(instance.response.body).to.equal(undefined);
        expect(store).to.deep.equal([]);
    });
});
