import { createRequire } from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import { PERM, PRIV } from '@hydrooj/common';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError } from '../src/error';
import type { Tdoc } from '../src/interface';

const requireFromTest = createRequire(__filename);

const Module = requireFromTest('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const hydroHost = globalThis as unknown as { Hydro?: { model: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

const { teachCourseManagedFilter } = requireFromTest('../src/lib/teach-courses.ts') as typeof import('../src/lib/teach-courses');

const DOMAIN = 'system';
const UID = 7;

const ownedAcmId = new ObjectId('64b0000000000000000000a1');
const maintainedIoiId = new ObjectId('64b0000000000000000000a2');
const acmInCourseId = new ObjectId('64b0000000000000000000a3');
const examInCourseId = new ObjectId('64b0000000000000000000a4');
const homeworkInCourseId = new ObjectId('64b0000000000000000000a5');
const unseenId = new ObjectId('64b0000000000000000000a6');
const chapterContestId = new ObjectId('64b0000000000000000000c1');
const courseExamId = new ObjectId('64b0000000000000000000c2');
const filterContestId = new ObjectId('64b0000000000000000000d1');
const ignoredContestHex = '64b0000000000000000000c3';

interface ContainerVisibilityActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

type ContainerViewerClass = 'all' | 'teacher' | 'student';

interface TeacherContainerScope {
    uid: number;
    courseContestIds: ReadonlySet<string>;
}

interface ContestRef {
    docId: ObjectId;
    owner: number;
    maintainer?: number[];
    rule: string;
}

interface CourseChapter {
    tids?: readonly unknown[];
}

interface CourseRow {
    dag?: readonly CourseChapter[];
    courseExam?: { contestId?: unknown };
}

interface CourseRead {
    domainId: string;
    query: unknown;
}

interface CourseClause {
    rule: { $in: readonly string[] };
    docId: { $in: readonly ObjectId[] };
}

interface TeacherContestFilter {
    $or: readonly [
        { owner: number },
        { maintainer: number },
        ...Array<{ owner: number } | { maintainer: number } | CourseClause>,
    ];
}

interface VisibilityApi {
    contestViewerClass(actor: ContainerVisibilityActor, rule: string): ContainerViewerClass;
    loadTeacherContainerScope(domainId: string, uid: number): Promise<TeacherContainerScope>;
    teacherSeesContest(scope: TeacherContainerScope, tdoc: ContestRef): boolean;
    teacherContestFilter(scope: TeacherContainerScope): TeacherContestFilter;
    decideContainerVisibility(domainId: string, tdoc: Tdoc, actor: ContainerVisibilityActor): Promise<'bypass' | 'student'>;
}

interface ClassCase {
    label: string;
    perms: readonly bigint[];
    privs: readonly number[];
    rule: string;
    viewerClass: ContainerViewerClass;
}

let courseReads = 0;
let courses: CourseRow[] = [];
let courseRead: CourseRead | null = null;

const trainingStub = {
    getMulti(domainId: string, query: unknown) {
        courseReads += 1;
        courseRead = { domainId, query };
        const cursor = {
            project() {
                return cursor;
            },
            toArray() {
                return Promise.resolve(courses);
            },
        };
        return cursor;
    },
};

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    const fromVisibility = parent?.filename?.endsWith('/src/lib/container-visibility.ts') === true;
    if (fromVisibility && request === '../model/training') return trainingStub;
    return originalLoad.call(this, request, parent, isMain);
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isMissingVisibility(error: unknown): boolean {
    if (!(error instanceof Error) || !isRecord(error)) return false;
    return String(error.code) === 'MODULE_NOT_FOUND' && error.message.includes('container-visibility');
}

function visibilityExports(): Record<string, unknown> {
    try {
        const loaded = requireFromTest('../src/lib/container-visibility.ts') as unknown;
        if (!isRecord(loaded)) return {};
        const nested = loaded.default;
        if (typeof loaded.contestViewerClass !== 'function' && isRecord(nested)) return nested;
        return loaded;
    } catch (error) {
        if (isMissingVisibility(error)) return {};
        throw error;
    }
}

function callExport(loaded: Record<string, unknown>, name: string, args: readonly unknown[]): unknown {
    const fn = loaded[name];
    if (typeof fn !== 'function') return undefined;
    return fn(...args);
}

function loadVisibility(): VisibilityApi {
    const loaded = visibilityExports();
    return {
        contestViewerClass(actor, rule) {
            return callExport(loaded, 'contestViewerClass', [actor, rule]) as ContainerViewerClass;
        },
        teacherSeesContest(scope, tdoc) {
            return callExport(loaded, 'teacherSeesContest', [scope, tdoc]) as boolean;
        },
        teacherContestFilter(scope) {
            return callExport(loaded, 'teacherContestFilter', [scope]) as TeacherContestFilter;
        },
        async loadTeacherContainerScope(domainId, uid) {
            return (await callExport(loaded, 'loadTeacherContainerScope', [domainId, uid])) as TeacherContainerScope;
        },
        async decideContainerVisibility(domainId, tdoc, actor) {
            return (await callExport(loaded, 'decideContainerVisibility', [domainId, tdoc, actor])) as 'bypass' | 'student';
        },
    };
}

function caught(body: () => unknown): unknown {
    try {
        return body();
    } catch (error) {
        return error;
    }
}

async function settled(body: () => Promise<unknown>): Promise<unknown> {
    try {
        return await body();
    } catch (error) {
        return error;
    }
}

function actorOf(perms: readonly bigint[], privs: readonly number[] = [], uid = UID): ContainerVisibilityActor {
    const perm = perms.reduce((bits, item) => bits | item, 0n);
    const priv = privs.reduce((bits, item) => bits | item, 0);
    return {
        _id: uid,
        own(doc) {
            return doc.owner === uid || (doc.maintainer ?? []).includes(uid);
        },
        hasPerm(...wanted) {
            return wanted.some((item) => (perm & item) === item);
        },
        hasPriv(...wanted) {
            return wanted.some((item) => (priv & item) === item);
        },
    };
}

function teacher(): ContainerVisibilityActor {
    return actorOf([PERM.PERM_CREATE_CONTEST]);
}

function contest(input: ContestRef): Tdoc {
    return {
        _id: input.docId,
        docId: input.docId,
        docType: 30,
        domainId: DOMAIN,
        owner: input.owner,
        maintainer: input.maintainer,
        beginAt: new Date('2026-10-18T06:00:00.000Z'),
        endAt: new Date('2026-10-18T08:00:00.000Z'),
        attend: 0,
        title: 'container',
        content: '',
        rule: input.rule,
        pids: [],
        duration: 0,
    };
}

async function rejection(body: () => Promise<unknown>): Promise<unknown> {
    try {
        await body();
    } catch (error) {
        return error;
    }
    return undefined;
}

function assertNotFound(error: unknown, docId: ObjectId): void {
    expect(error instanceof ContestNotFoundError, 'ContestNotFoundError').to.equal(true);
    if (!(error instanceof ContestNotFoundError)) return;
    expect(error.params[0], 'domain').to.equal(DOMAIN);
    const id = error.params[1];
    expect(id instanceof ObjectId, 'docId').to.equal(true);
    if (!(id instanceof ObjectId)) return;
    expect(id.toHexString(), 'docId hex').to.equal(docId.toHexString());
}

const classCases: ClassCase[] = [
    { label: 'edit system on acm', perms: [], privs: [PRIV.PRIV_EDIT_SYSTEM], rule: 'acm', viewerClass: 'all' },
    { label: 'edit system on homework', perms: [], privs: [PRIV.PRIV_EDIT_SYSTEM], rule: 'homework', viewerClass: 'all' },
    { label: 'hidden contest on acm', perms: [PERM.PERM_VIEW_HIDDEN_CONTEST], privs: [], rule: 'acm', viewerClass: 'all' },
    { label: 'hidden contest on homework', perms: [PERM.PERM_VIEW_HIDDEN_CONTEST], privs: [], rule: 'homework', viewerClass: 'student' },
    {
        label: 'hidden contest plus create homework',
        perms: [PERM.PERM_VIEW_HIDDEN_CONTEST, PERM.PERM_CREATE_HOMEWORK],
        privs: [],
        rule: 'homework',
        viewerClass: 'teacher',
    },
    { label: 'create contest on acm', perms: [PERM.PERM_CREATE_CONTEST], privs: [], rule: 'acm', viewerClass: 'teacher' },
    { label: 'create contest on homework', perms: [PERM.PERM_CREATE_CONTEST], privs: [], rule: 'homework', viewerClass: 'teacher' },
    { label: 'no permission', perms: [], privs: [], rule: 'acm', viewerClass: 'student' },
    { label: 'hidden homework on homework', perms: [PERM.PERM_VIEW_HIDDEN_HOMEWORK], privs: [], rule: 'homework', viewerClass: 'all' },
    { label: 'hidden homework on acm', perms: [PERM.PERM_VIEW_HIDDEN_HOMEWORK], privs: [], rule: 'acm', viewerClass: 'student' },
    { label: 'edit contest on oi', perms: [PERM.PERM_EDIT_CONTEST], privs: [], rule: 'oi', viewerClass: 'all' },
    { label: 'edit homework on homework', perms: [PERM.PERM_EDIT_HOMEWORK], privs: [], rule: 'homework', viewerClass: 'all' },
    { label: 'edit homework on acm', perms: [PERM.PERM_EDIT_HOMEWORK], privs: [], rule: 'acm', viewerClass: 'student' },
    { label: 'create homework on exam', perms: [PERM.PERM_CREATE_HOMEWORK], privs: [], rule: 'exam', viewerClass: 'teacher' },
    { label: 'create training on ioi', perms: [PERM.PERM_CREATE_TRAINING], privs: [], rule: 'ioi', viewerClass: 'teacher' },
];

describe('container visibility', { concurrency: false }, () => {
    beforeEach(() => {
        courseReads = 0;
        courses = [];
        courseRead = null;
    });

    it('classifies all, teacher, and student viewers', () => {
        const api = loadVisibility();
        for (const item of classCases) {
            const viewerClass = caught(() => api.contestViewerClass(actorOf(item.perms, item.privs), item.rule));
            expect(viewerClass, item.label).to.equal(item.viewerClass);
        }
    });

    it('shows owned, collaborated, and course-linked exam or homework', () => {
        const api = loadVisibility();
        const scope: TeacherContainerScope = {
            uid: UID,
            courseContestIds: new Set([acmInCourseId.toHexString(), examInCourseId.toHexString(), homeworkInCourseId.toHexString()]),
        };
        expect(caught(() => api.teacherSeesContest(scope, { docId: ownedAcmId, owner: UID, rule: 'acm' })), 'owned acm').to.equal(true);
        expect(caught(() => api.teacherSeesContest(scope, { docId: maintainedIoiId, owner: 8, maintainer: [4, UID], rule: 'ioi' })), 'maintainer ioi').to.equal(
            true,
        );
        expect(caught(() => api.teacherSeesContest(scope, { docId: acmInCourseId, owner: 8, maintainer: [], rule: 'acm' })), 'course acm').to.equal(false);
        expect(caught(() => api.teacherSeesContest(scope, { docId: examInCourseId, owner: 8, rule: 'exam' })), 'course exam').to.equal(true);
        expect(caught(() => api.teacherSeesContest(scope, { docId: homeworkInCourseId, owner: 8, rule: 'homework' })), 'course homework').to.equal(true);
        expect(caught(() => api.teacherSeesContest(scope, { docId: unseenId, owner: 8, rule: 'oi' })), 'unrelated').to.equal(false);
    });

    it('omits the course clause when the teacher has no course contests', () => {
        const api = loadVisibility();
        expect(caught(() => api.teacherContestFilter({ uid: UID, courseContestIds: new Set() }))).to.deep.equal({
            $or: [{ owner: UID }, { maintainer: UID }],
        });
    });

    it('adds exam and homework ids to the teacher filter', () => {
        const api = loadVisibility();
        const filter = caught(() =>
            api.teacherContestFilter({
                uid: UID,
                courseContestIds: new Set([filterContestId.toHexString()]),
            }),
        );
        const clauses = isRecord(filter) && Array.isArray(filter.$or) ? filter.$or : [];
        expect(clauses[0], 'owner clause').to.deep.equal({ owner: UID });
        expect(clauses[1], 'maintainer clause').to.deep.equal({ maintainer: UID });
        expect(clauses.length, 'clause count').to.equal(3);
        const third = clauses[2];
        const course = isRecord(third) && isRecord(third.rule) && isRecord(third.docId) ? third : undefined;
        expect(course?.rule, 'course rules').to.deep.equal({ $in: ['exam', 'homework'] });
        const docField = course?.docId;
        const ids = isRecord(docField) && Array.isArray(docField.$in) ? docField.$in : [];
        const id = ids[0];
        expect(id instanceof ObjectId, 'filter docId').to.equal(true);
        if (!(id instanceof ObjectId)) return;
        expect(id.toHexString()).to.equal(filterContestId.toHexString());
    });

    it('collects object ids from chapter tids and course exams', async () => {
        const api = loadVisibility();
        courses = [
            {},
            { courseExam: { contestId: courseExamId } },
            {
                dag: [{ tids: [chapterContestId, ignoredContestHex, 5, null] }],
                courseExam: { contestId: ignoredContestHex },
            },
            { dag: [{ tids: [courseExamId, chapterContestId] }] },
        ];
        const scope = await settled(() => api.loadTeacherContainerScope(DOMAIN, UID));
        const ids = isRecord(scope) && scope.courseContestIds instanceof Set ? scope.courseContestIds : undefined;
        expect(courseReads, 'course reads').to.equal(1);
        expect(courseRead?.domainId, 'domain').to.equal(DOMAIN);
        expect(courseRead?.query, 'managed course filter').to.deep.equal(teachCourseManagedFilter(UID));
        expect(isRecord(scope) ? scope.uid : undefined).to.equal(UID);
        expect(ids?.size, 'deduped ids').to.equal(2);
        expect(ids?.has(courseExamId.toHexString()) ?? false, 'course exam').to.equal(true);
        expect(ids?.has(chapterContestId.toHexString()) ?? false, 'chapter tid').to.equal(true);
        expect(ids?.has(ignoredContestHex) ?? false, 'non object id').to.equal(false);
    });

    it('bypasses an all viewer', async () => {
        const api = loadVisibility();
        const doc = contest({ docId: unseenId, owner: 8, rule: 'acm' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, doc, actorOf([], [PRIV.PRIV_EDIT_SYSTEM]))), 'all viewer').to.equal('bypass');
    });

    it('bypasses a contest the teacher owns without reading courses', async () => {
        const api = loadVisibility();
        const owned = contest({ docId: ownedAcmId, owner: UID, rule: 'acm' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, owned, teacher())), 'owner').to.equal('bypass');
        expect(courseReads, 'owner course reads').to.equal(0);

        courseReads = 0;
        const maintained = contest({ docId: maintainedIoiId, owner: 8, maintainer: [UID], rule: 'ioi' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, maintained, teacher())), 'maintainer').to.equal('bypass');
        expect(courseReads, 'maintainer course reads').to.equal(0);
    });

    it('hides an acm the teacher does not own', async () => {
        const api = loadVisibility();
        courses = [{ dag: [{ tids: [examInCourseId] }] }];
        const doc = contest({ docId: unseenId, owner: 8, rule: 'acm' });
        assertNotFound(await rejection(() => api.decideContainerVisibility(DOMAIN, doc, teacher())), unseenId);
    });

    it('bypasses an exam referenced by one of the teacher courses', async () => {
        const api = loadVisibility();
        courses = [{ dag: [{ tids: [examInCourseId] }] }];
        const doc = contest({ docId: examInCourseId, owner: 8, rule: 'exam' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, doc, teacher())), 'course exam').to.equal('bypass');
    });

    it('hides an exam the teacher does not own and no course references', async () => {
        const api = loadVisibility();
        const doc = contest({ docId: examInCourseId, owner: 8, rule: 'exam' });
        assertNotFound(await rejection(() => api.decideContainerVisibility(DOMAIN, doc, teacher())), examInCourseId);
    });

    it('bypasses a homework referenced by a teacher course exam', async () => {
        const api = loadVisibility();
        courses = [{ courseExam: { contestId: homeworkInCourseId } }];
        const doc = contest({ docId: homeworkInCourseId, owner: 8, rule: 'homework' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, doc, teacher())), 'course homework').to.equal('bypass');
    });

    it('hides a homework the teacher does not own and no course references', async () => {
        const api = loadVisibility();
        const doc = contest({ docId: homeworkInCourseId, owner: 8, rule: 'homework' });
        assertNotFound(await rejection(() => api.decideContainerVisibility(DOMAIN, doc, teacher())), homeworkInCourseId);
    });

    it('leaves a student on the existing visibility check', async () => {
        const api = loadVisibility();
        const doc = contest({ docId: unseenId, owner: 8, rule: 'acm' });
        expect(await settled(() => api.decideContainerVisibility(DOMAIN, doc, actorOf([]))), 'student').to.equal('student');
    });

    it('drops hidden contest and homework bits from the teacher pack', () => {
        expect(PERM.PERM_TEACHER & PERM.PERM_VIEW_HIDDEN_CONTEST).to.equal(0n);
        expect(PERM.PERM_TEACHER & PERM.PERM_VIEW_HIDDEN_HOMEWORK).to.equal(0n);
        expect((PERM.PERM_TEACHER & PERM.PERM_CREATE_CONTEST) !== 0n).to.equal(true);
    });
});
