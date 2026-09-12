import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

(global as any).Hydro ||= { model: {} };
const { PERM, PRIV } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');
const { canonicalProblemSetAudience } = require('../src/lib/problem-set-audience.ts') as typeof import('../src/lib/problem-set-audience');

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const accessPath = require.resolve('../src/model/problem-set-access.ts');
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { collection: () => ({ createIndex: async () => 'ok', find: () => ({ toArray: async () => [] }) }) },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_TRAINING: 40, coll: { find: () => ({ toArray: async () => [] }) } },
} as NodeModule;
delete require.cache[accessPath];
const { ACCESS_ENTITLEMENT_WHOLE_SET_STAGE, ProblemSetAccessService } = require(accessPath) as typeof import('../src/model/problem-set-access');
type AccessEntitlementDoc = import('../src/model/problem-set-access').AccessEntitlementDoc;

const domainId = 'system';
const setId = new ObjectId();
const otherSetId = new ObjectId();
const courseId = new ObjectId();
const groupId = new ObjectId();
const sourceId = new ObjectId();
const uid = 42;

function user(overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>([PERM.PERM_VIEW_TRAINING, ...((overrides.perms as bigint[] | undefined) || [])]);
    const privs = new Set<number>([PRIV.PRIV_USER_PROFILE, ...((overrides.privs as number[] | undefined) || [])]);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (priv: number) => privs.has(priv),
        own: (doc: { owner?: number }) => doc?.owner === uid,
        ...overrides,
    };
}

function memoryEntitlements(rows: AccessEntitlementDoc[]) {
    return {
        async createIndex() {
            return 'ok';
        },
        find(filter: any) {
            return {
                async toArray() {
                    return rows.filter((row) => matchEntitlement(row, filter));
                },
            };
        },
        async findOne(filter: any) {
            return rows.find((row) => matchEntitlement(row, filter)) || null;
        },
        async insertOne(doc: AccessEntitlementDoc) {
            if (rows.some((row) => matchEntitlement(row, { ...doc, _id: undefined }))) {
                const error: any = new Error('duplicate');
                error.code = 11000;
                throw error;
            }
            rows.push(doc);
            return { insertedId: doc._id };
        },
        async updateOne(filter: any, update: any) {
            const current = rows.find((row) => matchEntitlement(row, filter));
            if (!current) return { modifiedCount: 0 };
            Object.assign(current, update.$set || {});
            return { modifiedCount: 1 };
        },
        async deleteMany() {
            rows.length = 0;
        },
    };
}

function matchEntitlement(row: AccessEntitlementDoc, filter: any) {
    if (filter._id && String(filter._id) !== String(row._id)) return false;
    if (filter.domainId && filter.domainId !== row.domainId) return false;
    if (filter.uid && filter.uid !== row.uid) return false;
    if (filter.targetKind?.$in && !filter.targetKind.$in.includes(row.targetKind)) return false;
    if (filter.targetKind && !filter.targetKind.$in && filter.targetKind !== row.targetKind) return false;
    if (filter.targetId?.$in && !filter.targetId.$in.some((id: ObjectId) => String(id) === String(row.targetId))) return false;
    if (filter.targetId && !filter.targetId.$in && String(filter.targetId) !== String(row.targetId)) return false;
    if (filter.stageId !== undefined && filter.stageId !== row.stageId) return false;
    if (filter.source && filter.source !== row.source) return false;
    if (filter.sourceId && String(filter.sourceId) !== String(row.sourceId)) return false;
    if (filter.revokedAt === null && row.revokedAt !== null) return false;
    return true;
}

function service(input: { entitlements?: AccessEntitlementDoc[]; courses?: any[]; groups?: string[]; enrollments?: Record<string, boolean> }) {
    const entitlements = input.entitlements || [];
    return new ProblemSetAccessService({
        entitlements: memoryEntitlements(entitlements) as any,
        courses: {
            find() {
                return {
                    async toArray() {
                        return input.courses || [];
                    },
                };
            },
        } as any,
        findStudentGroupIds: async () => new Set(input.groups || []),
        getEnrollment: async (_domainId, tid) => (input.enrollments?.[String(tid)] ? { enroll: 1 } : { enroll: 0 }),
    });
}

const publicSet = { domainId, docId: setId, owner: 7, kind: 'problem_set', title: 'Public', dag: [] };
const hiddenSet = {
    domainId,
    docId: otherSetId,
    owner: 7,
    kind: 'problem_set',
    title: 'Secret',
    dag: [],
    problemSetAudience: { public: false, groupIds: [] },
};

describe('P3.3 problem set access sources', () => {
    it('treats missing audience as public and does not treat enroll as authorization', async () => {
        const access = service({ enrollments: { [String(setId)]: true } });
        const decision = await access.evaluate(domainId, user(), publicSet as any);
        expect(decision.discoverable).to.equal(true);
        expect(decision.accessible).to.equal(true);
        expect(decision.enrolled).to.equal(true);
        expect(decision.stageAccess).to.equal('all');
        expect(decision.sources.map((source) => source.kind)).to.deep.equal(['public']);
        expect(canonicalProblemSetAudience(undefined)).to.deep.equal({ public: true, groupIds: [] });
    });

    it('grants group access dynamically and drops it after leaving the group', async () => {
        const grouped = {
            ...hiddenSet,
            problemSetAudience: { public: false, groupIds: [groupId] },
        };
        const inside = service({ groups: [groupId.toHexString()] });
        const outside = service({ groups: [] });
        expect((await inside.evaluate(domainId, user(), grouped as any)).sources[0]).to.include({ kind: 'group', groupId: groupId.toHexString() });
        expect((await outside.evaluate(domainId, user(), grouped as any)).accessible).to.equal(false);
    });

    it('grants course-reference access only while the course is visible and still references the set', async () => {
        const course = {
            domainId,
            docId: courseId,
            owner: 9,
            kind: 'course',
            courseGroupIds: [],
            dag: [{ _id: 1, title: 'Ch', requireNids: [], pids: [], problemSetId: otherSetId }],
        };
        const withRef = service({ courses: [course] });
        const withoutRef = service({ courses: [{ ...course, dag: [{ _id: 1, title: 'Ch', requireNids: [], pids: [] }] }] });
        expect((await withRef.evaluate(domainId, user(), hiddenSet as any)).sources[0]).to.include({ kind: 'course', courseId: String(courseId) });
        expect((await withoutRef.evaluate(domainId, user(), hiddenSet as any)).discoverable).to.equal(false);
    });

    it('expands selected course stages through the DAG access-closure', async () => {
        const staged = {
            ...hiddenSet,
            dag: [
                { _id: 1, title: 'A', requireNids: [], pids: [11] },
                { _id: 2, title: 'B', requireNids: [1], pids: [12] },
                { _id: 3, title: 'C', requireNids: [2], pids: [13] },
            ],
        };
        const course = {
            domainId,
            docId: courseId,
            owner: 9,
            kind: 'course',
            courseGroupIds: [],
            dag: [{ _id: 1, title: 'Ch', requireNids: [], pids: [], problemSetId: otherSetId, stageIds: [3] }],
        };
        const decision = await service({ courses: [course] }).evaluate(domainId, user(), staged as any);
        expect(decision.accessible).to.equal(true);
        expect(decision.stageAccess).to.deep.equal([1, 2, 3]);
    });

    it('lets a course redemption keep the referenced problem set visible', async () => {
        const course = {
            domainId,
            docId: courseId,
            owner: 9,
            kind: 'course',
            courseGroupIds: [groupId],
            dag: [{ _id: 1, title: 'Ch', requireNids: [], pids: [], problemSetId: otherSetId }],
        };
        const access = service({
            groups: [],
            courses: [course],
            entitlements: [
                {
                    _id: new ObjectId(),
                    domainId,
                    uid,
                    targetKind: 'course',
                    targetId: courseId,
                    stageId: ACCESS_ENTITLEMENT_WHOLE_SET_STAGE,
                    source: 'redemption',
                    sourceId,
                    createdAt: new Date(),
                    revokedAt: null,
                },
            ],
        });
        const decision = await access.evaluate(domainId, user(), hiddenSet as any);
        expect(decision.accessible).to.equal(true);
        expect(decision.sources.map((source) => source.kind)).to.deep.equal(['course']);
        expect(await access.hasActiveEntitlement(domainId, uid, 'course', courseId)).to.equal(true);
        expect(await access.hasActiveEntitlement(domainId, uid, 'course', otherSetId)).to.equal(false);
    });

    it('keeps a redemption entitlement after leaving the group and after revoking a different source', async () => {
        const grouped = {
            ...hiddenSet,
            problemSetAudience: { public: false, groupIds: [groupId] },
        };
        const access = service({ groups: [groupId.toHexString()] });
        const entitlement = await access.grantRedemptionEntitlement({
            domainId,
            uid,
            targetKind: 'problem_set',
            targetId: otherSetId,
            sourceId,
        });
        expect(entitlement.stageId).to.equal(ACCESS_ENTITLEMENT_WHOLE_SET_STAGE);
        const both = await access.evaluate(domainId, user(), grouped as any);
        expect(both.sources.map((source) => source.kind).sort()).to.deep.equal(['group', 'redemption']);
        const afterLeave = service({
            groups: [],
            entitlements: [entitlement],
        });
        const remaining = await afterLeave.evaluate(domainId, user(), grouped as any);
        expect(remaining.accessible).to.equal(true);
        expect(remaining.sources.map((source) => source.kind)).to.deep.equal(['redemption']);
        await afterLeave.revokeRedemptionEntitlement({ domainId, uid, entitlementId: entitlement._id });
        expect((await afterLeave.evaluate(domainId, user(), grouped as any)).accessible).to.equal(false);
    });

    it('does not leak a hidden set across domains or by enumeration', async () => {
        const access = service({});
        const foreign = await access.evaluate('other', user(), hiddenSet as any);
        expect(foreign.discoverable).to.equal(false);
        try {
            await access.assertAccessible(domainId, user(), hiddenSet as any);
            expect.fail('expected hidden set to 404');
        } catch (error) {
            expect(error).to.have.property('name', 'TrainingNotFoundError');
        }
        const manager = user({ perms: [PERM.PERM_VIEW_TRAINING, PERM.PERM_EDIT_TRAINING] });
        expect((await access.evaluate(domainId, manager, hiddenSet as any)).sources[0].kind).to.equal('manage');
    });

    it('refuses unknown audience fields and treats enroll-only hidden sets as unauthorized', async () => {
        expect(() => canonicalProblemSetAudience({ public: false, extra: true })).to.throw(TypeError);
        const access = service({ enrollments: { [String(otherSetId)]: true } });
        const decision = await access.evaluate(domainId, user(), hiddenSet as any);
        expect(decision.enrolled).to.equal(true);
        expect(decision.accessible).to.equal(false);
        expect(decision.discoverable).to.equal(false);
    });

    it('grants a stage-redemption closure without marking completion and still requires DAG progress', async () => {
        const staged = {
            ...hiddenSet,
            dag: [
                { _id: 1, title: 'A', requireNids: [], pids: [11] },
                { _id: 2, title: 'B', requireNids: [1], pids: [12] },
                { _id: 3, title: 'C', requireNids: [2], pids: [13] },
            ],
        };
        const access = service({});
        const granted = await access.grantStageRedemptionWithClosure({
            domainId,
            uid,
            tdoc: staged as any,
            stageId: 3,
            sourceId,
        });
        expect(granted.map((row) => row.stageId)).to.deep.equal([1, 2, 3]);
        const decision = await access.evaluate(domainId, user(), staged as any);
        expect(decision.accessible).to.equal(true);
        expect(decision.stageAccess).to.deep.equal([1, 2, 3]);
        expect(decision.enrolled).to.equal(false);
        await access.assertStageEnterable(domainId, user(), staged as any, 1, new Set());
        try {
            await access.assertStageEnterable(domainId, user(), staged as any, 3, new Set());
            expect.fail('expected prereq denial');
        } catch (error: any) {
            expect(error).to.have.property('name', 'ValidationError');
            expect(error.params || []).to.include('前置阶段尚未完成');
        }
        await access.assertStageEnterable(domainId, user(), staged as any, 3, new Set([1, 2]));
        const other = {
            ...staged,
            dag: [
                { _id: 1, title: 'A', requireNids: [], pids: [11] },
                { _id: 4, title: 'D', requireNids: [], pids: [14] },
            ],
        };
        try {
            await access.assertStageEnterable(domainId, user(), other as any, 4, new Set());
            expect.fail('expected no-access denial');
        } catch (error: any) {
            expect(error).to.have.property('name', 'ValidationError');
            expect(error.params || []).to.include('未获得该阶段的访问权');
        }
    });

    it('keeps intro dump of inaccessible stages and does not split discoverable from accessible', async () => {
        const staged = {
            ...hiddenSet,
            dag: [
                { _id: 1, title: 'A', requireNids: [], pids: [11] },
                { _id: 2, title: 'Secret', requireNids: [1], pids: [12] },
            ],
        };
        const access = service({
            entitlements: [
                {
                    _id: new ObjectId(),
                    domainId,
                    uid,
                    targetKind: 'problem_set_stage',
                    targetId: otherSetId,
                    stageId: 1,
                    source: 'redemption',
                    sourceId,
                    createdAt: new Date(),
                    revokedAt: null,
                },
            ],
        });
        const decision = await access.evaluate(domainId, user(), staged as any);
        expect(decision.discoverable).to.equal(decision.accessible);
        expect(decision.stageAccess).to.deep.equal([1]);
        const intro = access.serializeIntro(staged as any, decision, {
            psdict: {},
            publishedIntegrity: null,
            contextualDoneByScope: null,
            selfContextualDoneByScope: null,
        });
        expect(access.introPids(staged as any)).to.deep.equal([11, 12]);
        expect(intro.pids).to.deep.equal([11, 12]);
        expect(intro.ndict[2]).to.include({ title: 'Secret' });
        expect(intro.ndict[2].pids).to.deep.equal([12]);
        expect(intro.nsdict[1].hasAccess).to.equal(true);
        expect(intro.nsdict[2]).to.include({ hasAccess: false, lockReason: 'no_access' });
    });
});
