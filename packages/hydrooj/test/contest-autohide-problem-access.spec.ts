import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const PERM = {
    PERM_EDIT_PROBLEM: 1n,
    PERM_CREATE_PROBLEM: 2n,
    PERM_EDIT_CONTEST: 4n,
    PERM_EDIT_CONTEST_SELF: 8n,
};
const PRIV = { PRIV_EDIT_SYSTEM: 1 };

class TestPermissionError extends Error {
    name = 'PermissionError';
    status = 403;
}
class TestValidationError extends Error {
    name = 'ValidationError';
}
class UnexpectedProblemWrite extends Error { }

const calls = {
    contestEdits: [] as any[],
    events: [] as string[],
    getLists: [] as any[],
    maintains: [] as any[],
    modelDomains: [] as Array<{ model: string; domainId: string }>,
    problemEdits: [] as any[],
    selections: [] as any[],
};
const problemDocs = new Map<number, any>();
let currentContest: any;
let currentStatus: any;

const contestStub: any = {
    RULES: { acm: { hidden: false, TEXT: 'ACM' } },
    async get(domainId: string) {
        calls.modelDomains.push({ model: 'contest.get', domainId });
        return currentContest;
    },
    async getStatus(domainId: string) {
        calls.modelDomains.push({ model: 'contest.getStatus', domainId });
        return currentStatus;
    },
    async getMultiClarification(domainId: string) {
        calls.modelDomains.push({ model: 'contest.getMultiClarification', domainId });
        return [];
    },
    isDone: () => true,
    isNotStarted: () => false,
    isClientRequired: () => false,
    isClientFinished: () => false,
    canShowSelfRecord: () => false,
    async edit(...args: any[]) { calls.events.push('contest.edit'); calls.contestEdits.push(args); },
    async add() { calls.events.push('contest.add'); return 'new-contest'; },
    async recalcStatus() { return undefined; },
};

const problemStub = {
    PROJECTION_CONTEST_LIST: ['domainId', 'docId', 'owner', 'title'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'owner', 'hidden'],
    assertProblemAclDomain(user: any, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) throw new TestPermissionError();
    },
    async getList(domainId: string, pids: number[]) {
        calls.modelDomains.push({ model: 'problem.getList', domainId });
        calls.getLists.push({ domainId, pids: [...pids] });
        return Object.fromEntries(
            pids.map((pid) => problemDocs.get(pid)).filter(Boolean).map((doc) => [doc.docId, doc]),
        );
    },
    canMaintainProblem(user: any, pdoc: any) {
        calls.events.push(`maintain:${pdoc.docId}`);
        calls.maintains.push({ user, pdoc });
        return pdoc.allowed === true && !user._aclFencedPids.has(pdoc.docId);
    },
    async edit(...args: any[]) {
        calls.events.push(`problem.edit:${args[1]}`);
        calls.problemEdits.push(args);
        throw new UnexpectedProblemWrite();
    },
    async editAuthorized(...args: any[]) {
        calls.events.push(`problem.editAuthorized:${args[1]}`);
        calls.problemEdits.push(args);
    },
};

const userStub = {
    async getList(domainId: string) {
        calls.modelDomains.push({ model: 'user.getList', domainId });
        return {};
    },
};

const problemAccessStub = {
    async assertProblemBankSelection(domainId: string, pids: number[], user: any, existingPids: number[]) {
        calls.selections.push({ domainId, pids: [...pids], user, existingPids: [...existingPids] });
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}
class HandlerStub { }
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Type: class { },
    Types: new Proxy({}, { get: () => () => ({}) }),
};
class ServiceStub {
    ctx: any;
    constructor(ctx: any) { this.ctx = ctx; }
}

const genericModel = new Proxy({}, {
    get: () => async () => undefined,
});
const scheduleStub = {
    async deleteMany() { return undefined; },
    async add() { return undefined; },
};
const errors = new Proxy({
    PermissionError: TestPermissionError,
    ValidationError: TestValidationError,
}, {
    get(target, key: string) { return target[key] || class extends Error { }; },
});

const contestPath = require.resolve('../src/handler/contest.ts');
const paperPath = require.resolve('../src/handler/paper.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromContest = parent?.filename === contestPath;
    if (fromContest && request === '../context') return { Context: class { }, Service: ServiceStub };
    if (fromContest && request === '../error') return errors;
    if (fromContest && request === '../model/builtin') return { PERM, PRIV, STATUS: {} };
    if (fromContest && request === '../model/contest') return contestStub;
    if (fromContest && request === '../model/problem') return problemStub;
    if (fromContest && request === '../model/problem-access') return problemAccessStub;
    if (fromContest && request === '../model/schedule') return scheduleStub;
    if (fromContest && request === '../model/user') return userStub;
    if (fromContest && request === '../service/server') return serverStub;
    if (fromContest && request.startsWith('../model/')) return genericModel;
    return originalLoad.call(this, request, parent, isMain);
};

let contestModule: typeof import('../src/handler/contest');
try {
    delete require.cache[contestPath];
    contestModule = require(contestPath);
} finally {
    Module._load = originalLoad;
}

function makeUser() {
    return {
        _id: 42,
        _problemAclLoaded: true,
        _problemAclDomainId: 'system',
        _aclFencedPids: new Set<number>(),
        timeZone: 'Asia/Shanghai',
        hasPerm: (perm: bigint) => perm === PERM.PERM_EDIT_PROBLEM,
        hasPriv: () => false,
        own: () => true,
    } as any;
}

function makeHandler() {
    const handler = new (contestModule as any).ContestEditHandler();
    Object.assign(handler, {
        domain: { _id: 'system' },
        user: makeUser(),
        tdoc: {
            domainId: 'system', docId: 'contest', owner: 42, rule: 'acm', pids: [11, 22],
            beginAt: new Date('2099-01-01T00:00:00Z'), endAt: new Date('2099-01-01T02:00:00Z'),
            lockAt: null,
        },
        response: { body: {} },
        checkPerm: () => undefined,
    });
    return handler;
}

function makeDetailHandler(HandlerClass: any) {
    const handler = new HandlerClass();
    Object.assign(handler, {
        ctx: { parallel: async () => undefined },
        domain: { _id: 'system' },
        user: makeUser(),
        response: { body: {} },
        request: { ip: '127.0.0.1', json: false },
        url: () => '/target',
        back: () => undefined,
        checkPerm: () => undefined,
    });
    return handler;
}

async function update(handler: any) {
    return handler.postUpdate(
        'forged-domain', 'contest', '2099-01-01', '08:00', 2,
        'Contest', 'Body', 'acm', '11,22', false, '', true,
    );
}

async function captureFailure(callback: () => Promise<unknown>) {
    try {
        await callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    for (const value of Object.values(calls)) value.length = 0;
    problemDocs.clear();
    currentContest = {
        domainId: 'system', docId: { toHexString: () => 'contest' }, owner: 42,
        rule: 'acm', title: 'Contest', content: '', pids: [11], assign: [],
        privateFiles: [], files: [], maintainer: [], score: {},
    };
    currentStatus = null;
});

describe('contest autoHide canonical maintenance', () => {
    it('rejects a grandfathered unauthorized target before any contest or problem write', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 7, allowed: false });
        const error = await captureFailure(() => update(makeHandler()));
        expect(error?.name).to.equal('PermissionError');
        expect(calls.selections[0].existingPids).to.deep.equal([11, 22]);
        expect(calls.getLists).to.deep.equal([{ domainId: 'system', pids: [11, 22] }]);
        expect(calls.events).to.deep.equal(['maintain:11', 'maintain:22']);
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('gives missing and unauthorized autoHide targets the same error and zero writes', async () => {
        const run = async (second: any) => {
            for (const value of Object.values(calls)) value.length = 0;
            problemDocs.clear();
            problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
            if (second) problemDocs.set(22, second);
            return captureFailure(() => update(makeHandler()));
        };
        const missing = await run(null);
        const unauthorized = await run({ domainId: 'system', docId: 22, owner: 7, allowed: false });
        expect(missing?.name).to.equal('PermissionError');
        expect(unauthorized?.name).to.equal('PermissionError');
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });
});

describe('contest detail authoritative domain', () => {
    const tid = { toHexString: () => 'contest' } as any;

    it('keeps detail owner/problem reads in the handler domain when the method domain is forged', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        const handler = makeDetailHandler((contestModule as any).ContestDetailHandler);

        await handler.__prepare('forged-domain', tid);
        await handler.get('forged-domain', tid);

        expect(calls.modelDomains.map((call) => call.model)).to.include.members([
            'contest.get', 'contest.getStatus', 'user.getList', 'problem.getList',
        ]);
        expect(calls.modelDomains.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
        expect(handler.response.body.tdoc).to.equal(currentContest);
    });

    it('keeps problem-list problem/user/clarification reads in the handler domain for exam-mode reuse', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        const handler = makeDetailHandler((contestModule as any).ContestProblemListHandler);
        handler.liveStatsEnabled = false;

        await handler.__prepare('forged-domain', tid);
        await handler.get('forged-domain', tid);

        expect(calls.modelDomains.map((call) => call.model)).to.include.members([
            'problem.getList', 'user.getList', 'contest.getMultiClarification',
        ]);
        expect(calls.modelDomains.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
        expect(handler.response.body.pdict).to.be.an('object');
    });

    it('contains no inherited contest handler model path that consumes a raw method domain', () => {
        const source = readFileSync(contestPath, 'utf8');
        const sections = [
            ['export class ContestDetailHandler', 'export class ContestPrintHandler'],
            ['export class ContestPrintHandler', 'interface ContestLiveStat'],
            ['export class ContestProblemListHandler', 'export class ContestEditHandler'],
            ['export class ContestManagementHandler', 'class ContestClarificationHandler'],
            ['class ContestClarificationHandler', 'export class ContestFileDownloadHandler'],
            ['export class ContestFileDownloadHandler', 'export class ContestUserHandler'],
            ['export class ContestUserHandler', 'export class ContestBalloonHandler'],
            ['export class ContestBalloonHandler', 'interface BuiltinInput'],
            ['export class ContestScoreboardHandler', 'class ScoreboardService'],
        ];
        for (const [start, end] of sections) {
            const body = source.slice(source.indexOf(start), source.indexOf(end));
            expect(body, start).not.to.match(/async\s+\w+\s*\(\s*(?:\{\s*)?domainId\b/);
            expect(body, start).not.to.match(/(?:contest|problem|user|discussion|record)\.\w+\(\s*_?domainId\b/);
        }
    });

    it('keeps exam-mode contest subclasses from forwarding a raw method domain', () => {
        const source = readFileSync(paperPath, 'utf8');
        const sections = [
            ['class ExamModeProblemListHandler', 'class ExamModeAnnouncementsHandler'],
            ['class ExamModeAnnouncementsHandler', 'class ExamModeProblemDetailHandler'],
            ['class ExamModeProblemDetailHandler', 'class ExamModeScoreboardHandler'],
            ['class ExamModeScoreboardHandler', 'class ExamModePrintHandler'],
            ['class ExamModePrintHandler', 'class ExamModeRecordDetailHandler'],
        ];
        for (const [start, end] of sections) {
            const body = source.slice(source.indexOf(start), source.indexOf(end));
            expect(body, start).not.to.match(/async\s+\w+\s*\(\s*(?:\{\s*)?domainId\b/);
            expect(body, start).not.to.match(/ensureExamModeAccess\(this,\s*_?domainId\b/);
        }
    });
});
