import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { after, beforeEach, describe, it } from 'node:test';

const Module = require('module');

const domainId = 'system';
const courseId = new ObjectId('66b800000000000000000001');
const otherCourseId = new ObjectId('66b800000000000000000002');
const schoolId = new ObjectId('66b900000000000000000001');
const otherSchoolId = new ObjectId('66b900000000000000000002');
const groupId = new ObjectId('66b900000000000000000011');
const otherGroupId = new ObjectId('66b900000000000000000012');
const inAudienceId = new ObjectId('66ba00000000000000000001');
const outAudienceId = new ObjectId('66ba00000000000000000002');
const draftId = new ObjectId('66ba00000000000000000003');
const closedId = new ObjectId('66ba00000000000000000004');
const archivedId = new ObjectId('66ba00000000000000000005');

interface RequestRow {
    _id: ObjectId;
    domainId: string;
    title: string;
    dueAt: Date;
    status: 'draft' | 'published' | 'closed' | 'archived';
    courseRef: { courseId: ObjectId; chapterId?: number };
    ownerUid: number;
    collaboratorUids: number[];
    schoolId: ObjectId;
    groupIds: ObjectId[];
    requireCourseExamComplete?: boolean;
}

const rows: RequestRow[] = [];
const audienceCalls: Array<{ domainId: string; uid: number; schoolId: string; groupIds: string[] }> = [];
const projections: Array<Record<string, number>> = [];

function sameId(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

function pathValue(doc: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, segment) => {
        if (value && typeof value === 'object') return (value as Record<string, unknown>)[segment];
        return undefined;
    }, doc);
}

function matches(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, expected]) => {
        const actual = pathValue(doc, key);
        if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)) {
            const spec = expected as Record<string, unknown>;
            if ('$in' in spec && Array.isArray(spec.$in)) return spec.$in.some((item) => sameId(actual, item) || actual === item);
        }
        if (actual instanceof ObjectId || expected instanceof ObjectId) return sameId(actual, expected);
        return actual === expected;
    });
}

const requestsColl = {
    find(query: Record<string, unknown>) {
        let found = rows.filter((row) => matches(row as unknown as Record<string, unknown>, query));
        const cursor = {
            sort(spec: Record<string, number>) {
                const entries = Object.entries(spec);
                found = [...found].sort((left, right) => {
                    for (const [key, dir] of entries) {
                        const av = (left as unknown as Record<string, unknown>)[key];
                        const bv = (right as unknown as Record<string, unknown>)[key];
                        let cmp = 0;
                        if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
                        else cmp = String(av).localeCompare(String(bv));
                        if (cmp !== 0) return dir < 0 ? -cmp : cmp;
                    }
                    return 0;
                });
                return cursor;
            },
            project(spec: Record<string, number>) {
                projections.push(spec);
                return cursor;
            },
            async toArray() {
                return found.map((row) => ({ ...row }));
            },
        };
        return cursor;
    },
    async findOne(query: Record<string, unknown>) {
        return rows.find((row) => matches(row as unknown as Record<string, unknown>, query)) ?? null;
    },
};

function viewer(id: number) {
    return {
        _id: id,
        hasPerm() { return false; },
        hasPriv() { return false; },
    };
}

const queryPath = require.resolve('../src/course-query.ts');
const authPath = require.resolve('../src/auth.ts');
const originalLoad = Module._load;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename;
    if ((filename === queryPath || filename === authPath) && request === 'hydrooj') {
        return { ObjectId, PERM, PRIV };
    }
    if (filename === queryPath && request === './db') {
        return { requestsColl };
    }
    if (filename === queryPath && request === './model') {
        return {
            async isAudienceMember(targetDomainId: string, uid: number, doc: { schoolId: ObjectId; groupIds: ObjectId[] }) {
                audienceCalls.push({
                    domainId: targetDomainId,
                    uid,
                    schoolId: String(doc.schoolId),
                    groupIds: doc.groupIds.map(String),
                });
                return uid === 101
                    && String(doc.schoolId) === String(schoolId)
                    && doc.groupIds.some((id) => String(id) === String(groupId));
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

type ListByCourseChapter = (
    domainId: string,
    courseId: ObjectId | string,
    chapterId: number,
    options?: { includeDraft?: boolean; viewer?: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean } },
) => Promise<Array<{ _id: string; title: string; status: string; chapterId: number | null }>>;
type ListByCourse = (
    domainId: string,
    courseId: ObjectId | string,
    options?: { includeDraft?: boolean; viewer?: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean } },
) => Promise<Array<{ _id: string; title: string; status: string; chapterId: number | null }>>;
type ExistsRequiringCourseExam = (domainId: string, courseId: ObjectId | string) => Promise<boolean>;

let listByCourseChapter: ListByCourseChapter;
let listByCourse: ListByCourse;
let existsRequiringCourseExam: ExistsRequiringCourseExam;
try {
    delete require.cache[queryPath];
    delete require.cache[authPath];
    ({ listByCourseChapter, listByCourse, existsRequiringCourseExam } = require(queryPath));
} finally {
    Module._load = originalLoad;
}

after(() => {
    Module._load = originalLoad;
});

function row(overrides: Partial<RequestRow> & Pick<RequestRow, '_id' | 'title' | 'status'>): RequestRow {
    return {
        domainId,
        dueAt: new Date('2026-09-18T00:00:00.000Z'),
        courseRef: { courseId, chapterId: 1 },
        ownerUid: 10,
        collaboratorUids: [],
        schoolId,
        groupIds: [groupId],
        ...overrides,
    };
}

beforeEach(() => {
    rows.splice(0, rows.length);
    audienceCalls.splice(0, audienceCalls.length);
    projections.splice(0, projections.length);
    rows.push(
        row({ _id: inAudienceId, title: '在名单内', status: 'published' }),
        row({
            _id: outAudienceId,
            title: '不在名单',
            status: 'published',
            schoolId: otherSchoolId,
            groupIds: [otherGroupId],
            dueAt: new Date('2026-09-19T00:00:00.000Z'),
        }),
        row({ _id: draftId, title: '草稿', status: 'draft', dueAt: new Date('2026-09-20T00:00:00.000Z') }),
        row({ _id: closedId, title: '已关闭', status: 'closed', dueAt: new Date('2026-09-17T00:00:00.000Z') }),
        row({
            _id: archivedId,
            title: '已归档',
            status: 'archived',
            requireCourseExamComplete: true,
            dueAt: new Date('2026-09-16T00:00:00.000Z'),
        }),
    );
});

describe('listByCourseChapter audience', () => {
    it('projects schoolId and groupIds, then hides non-audience rows from students', async () => {
        const listed = await listByCourseChapter(domainId, courseId, 1, { viewer: viewer(101) });
        expect(projections[0]).to.include({ schoolId: 1, groupIds: 1 });
        expect(audienceCalls.map((call) => call.uid)).to.deep.equal([101, 101, 101]);
        expect(listed.map((item) => item._id)).to.deep.equal([closedId.toHexString(), inAudienceId.toHexString()]);
        expect(listed.map((item) => item.title)).to.not.include('不在名单');
        expect(listed.map((item) => item.status)).to.not.include('draft');
    });

    it('keeps every chapter request on the includeDraft manager path', async () => {
        const listed = await listByCourseChapter(domainId, courseId, 1, {
            includeDraft: true,
            viewer: viewer(10),
        });
        expect(audienceCalls).to.deep.equal([]);
        expect(listed.map((item) => item._id)).to.deep.equal([
            closedId.toHexString(),
            inAudienceId.toHexString(),
            outAudienceId.toHexString(),
            draftId.toHexString(),
        ]);
    });

    it('keeps the published/closed list when no viewer is provided', async () => {
        const listed = await listByCourseChapter(domainId, courseId, 1);
        expect(audienceCalls).to.deep.equal([]);
        expect(listed.map((item) => item._id)).to.deep.equal([
            closedId.toHexString(),
            inAudienceId.toHexString(),
            outAudienceId.toHexString(),
        ]);
    });
});

describe('listByCourse', () => {
    it('includes course-level collections that have no chapterId', async () => {
        const courseLevelId = new ObjectId('66ba00000000000000000006');
        rows.push(row({
            _id: courseLevelId,
            title: '整门课收集',
            status: 'published',
            courseRef: { courseId },
            dueAt: new Date('2026-09-21T00:00:00.000Z'),
        }));
        const listed = await listByCourse(domainId, courseId);
        expect(listed.some((item) => item._id === courseLevelId.toHexString() && item.chapterId === null)).to.equal(true);
        const chapterOnly = await listByCourseChapter(domainId, courseId, 1);
        expect(chapterOnly.map((item) => item._id)).to.not.include(courseLevelId.toHexString());
    });
});

describe('existsRequiringCourseExam', () => {
    it('is true for draft/published/closed rows with the flag, and ignores archived', async () => {
        expect(await existsRequiringCourseExam(domainId, courseId)).to.equal(false);
        rows[0].requireCourseExamComplete = true;
        expect(await existsRequiringCourseExam(domainId, courseId)).to.equal(true);
        rows[0].requireCourseExamComplete = false;
        rows[2].requireCourseExamComplete = true;
        expect(rows[2].status).to.equal('draft');
        expect(await existsRequiringCourseExam(domainId, courseId)).to.equal(true);
        rows[2].requireCourseExamComplete = false;
        rows[3].requireCourseExamComplete = true;
        expect(rows[3].status).to.equal('closed');
        expect(await existsRequiringCourseExam(domainId, courseId)).to.equal(true);
        rows[3].requireCourseExamComplete = false;
        expect(await existsRequiringCourseExam(domainId, courseId)).to.equal(false);
        expect(await existsRequiringCourseExam(domainId, otherCourseId)).to.equal(false);
    });
});
