import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');

const PERM = new Proxy({}, { get: (_target, key: string) => key });

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub { }
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const errors = new Proxy({}, {
    get: (_target, key: string) => class extends Error { name = key; },
});

function cursor(rows: any[] = []) {
    const value: any = {
        project() { return value; },
        sort() { return value; },
        async toArray() { return rows; },
    };
    return value;
}

const calls: Array<{ model: string; domainId: string }> = [];
let currentHomework: any;
let currentStatus: any;

const contestStub: any = {
    async get(domainId: string) {
        calls.push({ model: 'contest.get', domainId });
        return currentHomework;
    },
    async getStatus(domainId: string) {
        calls.push({ model: 'contest.getStatus', domainId });
        return currentStatus;
    },
    isNotStarted: () => false,
    isDone: () => true,
    isOngoing: () => false,
    canShowSelfRecord: () => true,
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
    assertProblemAclDomain() { return undefined; },
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
};

const contestHandlerStub = {
    ContestCodeHandler: class { },
    ContestFileDownloadHandler: class { },
    ContestScoreboardHandler: class { },
};

const homeworkPath = require.resolve('../src/handler/homework.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromHomework = parent?.filename === homeworkPath;
    if (fromHomework && request === '@hydrooj/utils/lib/utils') {
        return { sortFiles: (files: any[]) => files, Time: { day: 86400000 } };
    }
    if (fromHomework && request === '../error') return errors;
    if (fromHomework && request === '../interface') return {};
    if (fromHomework && request === '../model/builtin') return { PERM };
    if (fromHomework && request === '../model/contest') return contestStub;
    if (fromHomework && request === '../model/discussion') return discussionStub;
    if (fromHomework && request === '../model/problem') return problemStub;
    if (fromHomework && request === '../model/problem-access') {
        return { assertProblemBankSelection: async () => undefined };
    }
    if (fromHomework && request === '../model/record') return recordStub;
    if (fromHomework && request === '../model/storage') return {};
    if (fromHomework && request === '../model/system') return { get: () => 1024 };
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
    Route(name: string, _path: string, HandlerClass: any) { routes[name] = HandlerClass; },
    async inject(_deps: string[], callback: (ctx: any) => unknown) {
        return callback({ Route() { return undefined; } });
    },
} as any);

function makeHandler(HandlerClass: any) {
    const handler = new HandlerClass();
    Object.assign(handler, {
        domain: { _id: 'system' },
        user: {
            _id: 42,
            group: [],
            hasPerm: () => true,
            own: () => true,
        },
        response: { body: {} },
        request: { ip: '127.0.0.1' },
        paginate: async () => [[], 1, 0],
        url: () => '/target',
        back: () => undefined,
        checkPerm: () => undefined,
    });
    return handler;
}

beforeEach(() => {
    calls.length = 0;
    currentHomework = {
        domainId: 'system', docId: 'homework', owner: 42, rule: 'homework',
        title: 'Homework', content: '', pids: [11], assign: [], files: [],
    };
    currentStatus = {
        attend: 1,
        startAt: new Date(),
        journal: [{ pid: 11, rid: 'record-1' }],
    };
});

describe('homework authoritative domain', () => {
    it('keeps prepare, status, discussion, user, problem and record reads in the handler domain', async () => {
        const handler = makeHandler(routes.homework_detail);

        await handler.prepare('forged-domain', 'homework');
        await handler.get('forged-domain', 'homework', 1);

        expect(calls.map((call) => call.model)).to.include.members([
            'contest.get', 'contest.getStatus', 'discussion.getMulti',
            'user.getList', 'problem.getList', 'record.getList',
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
});
