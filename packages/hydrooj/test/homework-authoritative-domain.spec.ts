import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');

const PERM = new Proxy({}, { get: (_target, key: string) => key });
const PRIV = new Proxy({}, { get: (_target, key: string) => key });

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {}
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const errors = new Proxy(
    {},
    {
        get: (_target, key: string) =>
            class extends Error {
                name = key;
            },
    },
);

function cursor(rows: any[] = []) {
    const value: any = {
        project() {
            return value;
        },
        sort() {
            return value;
        },
        async toArray() {
            return rows;
        },
    };
    return value;
}

const calls: Array<{ model: string; domainId: string }> = [];
const contestAdds: any[][] = [];
const courseAttaches: any[][] = [];
const contestDeletes: any[][] = [];
let currentHomework: any;
let currentStatus: any;
let currentCourse: any;
let studentGroupIds: ObjectId[] = [];
let lastContestQuery: any;
let contestDone = true;
let attachSucceeds = true;
const groupA = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
const groupB = new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb');
const courseId = new ObjectId('cccccccccccccccccccccccc');
const homeworkId = new ObjectId('dddddddddddddddddddddddd');

(global as any).Hydro = {
    model: {
        userbind: {
            async findStudentByUserId() {
                return { groupIds: studentGroupIds };
            },
            async listUserGroups() {
                return [
                    { _id: groupA, name: 'A 班' },
                    { _id: groupB, name: 'B 班' },
                ];
            },
        },
    },
};
const { homeworkParticipantScopeAllows } = require('../src/model/homework-access.ts');

const contestStub: any = {
    async get(domainId: string) {
        calls.push({ model: 'contest.get', domainId });
        return currentHomework;
    },
    async getStatus(domainId: string) {
        calls.push({ model: 'contest.getStatus', domainId });
        return currentStatus;
    },
    async add(...args: any[]) {
        contestAdds.push(args);
        return homeworkId;
    },
    async attend(domainId: string) {
        calls.push({ model: 'contest.attend', domainId });
    },
    async del(...args: any[]) {
        contestDeletes.push(args);
    },
    getMulti(domainId: string, query: any) {
        calls.push({ model: 'contest.getMulti', domainId });
        lastContestQuery = query;
        return cursor();
    },
    isExtended: () => false,
    isNotStarted: () => false,
    isDone: () => contestDone,
    isOngoing: () => false,
    canShowSelfRecord: () => true,
};

const trainingStub = {
    async get(domainId: string) {
        calls.push({ model: 'training.get', domainId });
        return currentCourse;
    },
    async attachContestToCourseChapter(...args: any[]) {
        courseAttaches.push(args);
        return attachSucceeds;
    },
};

const discussionStub = {
    getMulti(domainId: string) {
        calls.push({ model: 'discussion.getMulti', domainId });
        return cursor();
    },
};

const problemStub = {
    PROJECTION_CONTEST_LIST: ['docId', 'title'],
    async getList(domainId: string) {
        calls.push({ model: 'problem.getList', domainId });
        return {};
    },
    assertProblemAclDomain() {
        return undefined;
    },
};

const recordStub = {
    async getList(domainId: string) {
        calls.push({ model: 'record.getList', domainId });
        return {};
    },
};

const userStub = {
    async getList(domainId: string) {
        calls.push({ model: 'user.getList', domainId });
        return {};
    },
    async listGroup() {
        return [];
    },
};

const contestHandlerStub = {
    ContestCodeHandler: class {},
    ContestFileDownloadHandler: class {},
    ContestScoreboardHandler: class {},
};

const homeworkPath = require.resolve('../src/handler/homework.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromHomework = parent?.filename === homeworkPath;
    if (fromHomework && request === '@hydrooj/utils/lib/utils') {
        return { sortFiles: (files: any[]) => files, Time: { day: 86400000 } };
    }
    if (fromHomework && request === '@hydrooj/utils') {
        return {
            Logger: class {
                error() {}
            },
        };
    }
    if (fromHomework && request === '../error') return errors;
    if (fromHomework && request === '../interface') return {};
    if (fromHomework && request === '../model/builtin') return { PERM, PRIV };
    if (fromHomework && request === '../model/contest') return contestStub;
    if (fromHomework && request === '../model/discussion') return discussionStub;
    if (fromHomework && request === '../model/problem') return problemStub;
    if (fromHomework && request === '../model/problem-access') {
        return {
            assertProblemBankSelection: async () => undefined,
            async readContextViewableProblems(domainId: string, _user: unknown, pids: number[], context: { kind: string }, adapters: any) {
                calls.push({ model: 'readContextViewableProblems', domainId });
                if (context.kind !== 'homework-membership') throw new TypeError(context.kind);
                return adapters.readContainer(pids);
            },
        };
    }
    if (fromHomework && request === '../model/record') return recordStub;
    if (fromHomework && request === '../model/storage') return {};
    if (fromHomework && request === '../model/system') return { get: () => 1024 };
    if (fromHomework && request === '../model/training') return trainingStub;
    if (fromHomework && request === '../model/user') return userStub;
    if (fromHomework && request === '../service/server') return serverStub;
    if (fromHomework && request === './contest') return contestHandlerStub;
    return originalLoad.call(this, request, parent, isMain);
};

let homeworkModule: typeof import('../src/handler/homework');
try {
    delete require.cache[homeworkPath];
    homeworkModule = require(homeworkPath);
} finally {
    Module._load = originalLoad;
}

const routes: Record<string, any> = {};
void homeworkModule.apply({
    Route(name: string, _path: string, HandlerClass: any) {
        routes[name] = HandlerClass;
    },
    async inject(_deps: string[], callback: (ctx: any) => unknown) {
        return callback({
            Route() {
                return undefined;
            },
        });
    },
} as any);

function makeHandler(HandlerClass: any, userOverrides: Record<string, unknown> = {}) {
    const handler = new HandlerClass();
    Object.assign(handler, {
        domain: { _id: 'system' },
        user: {
            _id: 42,
            group: [],
            hasPerm: () => true,
            hasPriv: () => false,
            own: () => true,
            timeZone: 'UTC',
            ...userOverrides,
        },
        response: { body: {} },
        request: { ip: '127.0.0.1' },
        paginate: async () => [[], 1, 0],
        url: (name: string, args: any = {}) => (name === 'course_detail' ? `/course/${args.tid}` : '/target'),
        back: () => undefined,
        checkPerm: () => undefined,
    });
    return handler;
}

beforeEach(() => {
    calls.length = 0;
    contestAdds.length = 0;
    courseAttaches.length = 0;
    contestDeletes.length = 0;
    studentGroupIds = [];
    lastContestQuery = null;
    contestDone = true;
    attachSucceeds = true;
    currentHomework = {
        domainId: 'system',
        docId: 'homework',
        owner: 42,
        rule: 'homework',
        title: 'Homework',
        content: '',
        pids: [11],
        assign: [],
        files: [],
    };
    currentStatus = {
        attend: 1,
        startAt: new Date(),
        journal: [{ pid: 11, rid: 'record-1' }],
    };
    currentCourse = {
        domainId: 'system',
        docId: courseId,
        owner: 42,
        kind: 'course',
        title: '程序设计',
        courseGroupIds: [groupA],
        dag: [{ _id: 3, title: '循环', pids: [], requireNids: [], tids: [] }],
    };
});

describe('homework authoritative domain', () => {
    it('keeps prepare, status, discussion, user, problem and record reads in the handler domain', async () => {
        const handler = makeHandler(routes.homework_detail);

        await handler.prepare('forged-domain', 'homework');
        await handler.get('forged-domain', 'homework', 1);

        expect(calls.map((call) => call.model)).to.include.members([
            'contest.get',
            'contest.getStatus',
            'discussion.getMulti',
            'user.getList',
            'readContextViewableProblems',
            'problem.getList',
            'record.getList',
        ]);
        expect(calls.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
        expect(handler.response.body.tdoc).to.equal(currentHomework);
    });

    it('contains no homework handler model path that consumes a raw method domain', () => {
        const source = readFileSync(homeworkPath, 'utf8');
        const sections = [
            ['class HomeworkMainHandler', 'class HomeworkDetailHandler'],
            ['class HomeworkDetailHandler', 'class HomeworkEditHandler'],
            ['class HomeworkEditHandler', 'export class HomeworkFilesHandler'],
            ['export class HomeworkFilesHandler', 'export async function apply'],
        ];
        for (const [start, end] of sections) {
            const body = source.slice(source.indexOf(start), source.indexOf(end));
            expect(body, start).not.to.match(/async\s+\w+\s*\(\s*(?:\{\s*)?domainId\b/);
            expect(body, start).not.to.match(/(?:contest|problem|user|discussion|record)\.\w+\(\s*_?domainId\b/);
        }
    });

    it('declares homework-membership and injects getList(..., true) as the container adapter', () => {
        const source = readFileSync(homeworkPath, 'utf8');
        expect(source).to.include("kind: 'homework-membership'");
        expect(source).to.include('readContextViewableProblems(');
        expect(source).to.include('problem.getList(authoritativeDomainId, pids, true, true, problem.PROJECTION_CONTEST_LIST)');
        expect(source).not.to.include('canViewAllContestProblems');
        expect(source).not.to.include('contest-membership');
        expect(source).not.to.include('loadManagedContainerPids');
    });
});

describe('P3.7 course homework scope', () => {
    it('allows A class and rejects B class before detail or attend', async () => {
        currentHomework = {
            ...currentHomework,
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        };
        const user = { own: () => false, hasPerm: () => false };

        studentGroupIds = [groupA];
        const allowed = makeHandler(routes.homework_detail, user);
        await allowed.prepare('forged-domain', homeworkId);
        contestDone = false;
        await allowed.postAttend({ domainId: 'forged-domain' });
        expect(calls.filter((call) => call.model === 'contest.attend')).to.have.length(1);

        studentGroupIds = [groupB];
        const denied = makeHandler(routes.homework_detail, user);
        let error: any;
        try {
            await denied.prepare('forged-domain', homeworkId);
        } catch (caught) {
            error = caught;
        }
        expect(error?.name).to.equal('NotAssignedError');
        expect(calls.filter((call) => call.model === 'contest.attend')).to.have.length(1);
    });

    it('pushes the bound student group into the homework list query', async () => {
        studentGroupIds = [groupA];
        const handler = makeHandler(routes.homework_main, { hasPerm: () => false });
        await handler.get('forged-domain', '', 1, '');
        const participantClause = lastContestQuery.$or[2].$and[1].$or[2];
        expect(participantClause.participantScopeMode).to.equal('groups');
        expect(participantClause.participantGroupIds.$in.map(String)).to.deep.equal([String(groupA)]);
        expect(calls.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
    });

    it('combines legacy assign and participant groups while preserving manager bypass', async () => {
        currentHomework = {
            ...currentHomework,
            assign: ['legacy-a'],
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        };
        studentGroupIds = [groupA];
        const student = makeHandler(routes.homework_detail, {
            own: () => false,
            hasPerm: () => false,
            group: [],
        });
        let error: any;
        try {
            await student.prepare('forged-domain', homeworkId);
        } catch (caught) {
            error = caught;
        }
        expect(error?.name).to.equal('NotAssignedError');

        studentGroupIds = [groupB];
        const manager = makeHandler(routes.homework_detail, {
            own: () => false,
            hasPerm: () => true,
            group: [],
        });
        await manager.prepare('forged-domain', homeworkId);
    });

    it('prefills a course quiz, stores the canonical groups, and attaches it atomically to the chapter', async () => {
        const handler = makeHandler(routes.homework_create);
        await handler.get('forged-domain', undefined, courseId, 3);
        expect(handler.response.body.tdoc.title).to.equal('程序设计 · 循环');
        expect(handler.response.body.participantGroupIds).to.deep.equal([String(groupA)]);

        await handler.postUpdate(
            'forged-domain',
            undefined,
            '2026-07-13',
            '00:00',
            '2026-07-20',
            '23:59',
            1,
            { 1: 0.9 },
            '程序设计 · 循环',
            '',
            '101',
            false,
            [],
            [],
            [],
            'none',
            [],
            courseId,
            3,
        );
        const createData = contestAdds[0][9];
        expect(createData.participantScopeMode).to.equal('groups');
        expect(createData.participantGroupIds.map(String)).to.deep.equal([String(groupA)]);
        expect(courseAttaches).to.deep.equal([['system', courseId, 3, homeworkId]]);
        expect(handler.response.redirect).to.equal(`/course/${courseId}?chapter=3`);
        expect(calls.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
    });

    it('rejects a forged course shortcut before creating a homework', async () => {
        const handler = makeHandler(routes.homework_create, {
            own: () => false,
            hasPerm: () => false,
            hasPriv: () => false,
        });
        let error: any;
        try {
            await handler.get('forged-domain', undefined, courseId, 3);
        } catch (caught) {
            error = caught;
        }
        expect(error?.name).to.equal('PermissionError');
        expect(contestAdds).to.deep.equal([]);
        expect(courseAttaches).to.deep.equal([]);
    });

    it('keeps ordinary homework unrestricted when participant scope is none', () => {
        expect(homeworkParticipantScopeAllows({ participantScopeMode: 'none' } as any, new Set())).to.equal(true);
        expect(homeworkParticipantScopeAllows({} as any, new Set())).to.equal(true);
    });

    it('creates an ordinary homework without course scope or chapter attachment', async () => {
        const handler = makeHandler(routes.homework_create);
        await handler.postUpdate(
            'forged-domain',
            undefined,
            '2026-07-13',
            '00:00',
            '2026-07-20',
            '23:59',
            1,
            { 1: 0.9 },
            '普通作业',
            '',
            '101',
            false,
            [],
            [],
            [],
            'none',
            [],
            undefined,
            0,
        );
        expect(contestAdds[0][9]).to.deep.include({
            participantScopeMode: 'none',
            participantGroupIds: [],
        });
        expect(courseAttaches).to.deep.equal([]);
        expect(handler.response.redirect).to.equal('/target');
    });

    it('deletes the newly created homework when chapter attachment loses the race', async () => {
        attachSucceeds = false;
        const handler = makeHandler(routes.homework_create);
        let error: any;
        try {
            await handler.postUpdate(
                'forged-domain',
                undefined,
                '2026-07-13',
                '00:00',
                '2026-07-20',
                '23:59',
                1,
                { 1: 0.9 },
                '程序设计 · 循环',
                '',
                '101',
                false,
                [],
                [],
                [],
                'none',
                [],
                courseId,
                3,
            );
        } catch (caught) {
            error = caught;
        }
        expect(error?.name).to.equal('ValidationError');
        expect(contestDeletes).to.deep.equal([['system', homeworkId]]);
    });

    it('routes every homework enumeration and reused contest entry through the shared access boundary', () => {
        const homework = readFileSync(homeworkPath, 'utf8');
        const home = readFileSync(require.resolve('../src/handler/home.ts'), 'utf8');
        const contest = readFileSync(require.resolve('../src/handler/contest.ts'), 'utf8');
        expect(homework).to.include('buildHomeworkListAccessFilter(');
        expect(homework).to.include('assertHomeworkAccess(authoritativeDomainId, this.tdoc, this.user)');
        expect(home).to.include('buildHomeworkListAccessFilter(');
        expect(contest.match(/assertHomeworkAccess\(/g)).to.have.length(2);
    });
});
