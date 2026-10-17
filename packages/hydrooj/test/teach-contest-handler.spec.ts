import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const host = globalThis as unknown as {
    Hydro?: { model: Record<string, unknown>; module: Record<string, unknown> };
};
host.Hydro ||= { model: {}, module: {} };
const { PERM } = require('../src/model/builtin') as typeof import('../src/model/builtin');

const SCORE_MESSAGE = '只有考试和 OI/IOI 比赛能设置题目分数';
const KIND_MESSAGE = '这些题目不能加入当前类型的题目集：P6（单选题）';

interface ProblemRow {
    docId: number;
    pid: string;
    title: string;
    problemKind?: string;
}

interface ErrorView {
    field: string;
    text: string;
}

interface Editor {
    domain: { _id: string };
    user: {
        _id: number;
        _problemAclLoaded: boolean;
        _problemAclDomainId: string;
        timeZone: string;
        hasPerm: (perm: bigint) => boolean;
        hasPriv: (priv: number) => boolean;
        own: (doc: unknown) => boolean;
    };
    tdoc: {
        domainId: string;
        docId: string;
        owner: number;
        rule: string;
        pids: number[];
        beginAt: Date;
        endAt: Date;
        lockAt: null;
        score: Record<string, number>;
        _code?: string;
    };
    response: { body: Record<string, unknown>; redirect?: string; template?: string };
    url: (name: string, params: { tid: string }) => string;
    checkPerm: (perm: bigint) => void;
    get: (domainId: string, tid?: string) => Promise<void>;
    postUpdate: (...args: unknown[]) => Promise<unknown>;
}

const contestPath = require.resolve('../src/handler/contest.ts');
const kindGuardPath = require.resolve('../src/lib/container-problem-kinds.ts');
const problemRows = new Map<number, ProblemRow>();
const edits: unknown[][] = [];
const adds: unknown[][] = [];
let contestModule: { ContestEditHandler: new () => Editor };

function errorView(error: unknown): ErrorView {
    if (!error || typeof error !== 'object') return { field: '', text: '' };
    const named = error as { message?: unknown; params?: unknown };
    const params = Array.isArray(named.params) ? named.params : [];
    const field = typeof params[0] === 'string' ? params[0] : '';
    if (params.length >= 3) return { field, text: String(params[2]) };
    return { field, text: typeof named.message === 'string' ? named.message : '' };
}

function copyPayload(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...source };
    if (source.score && typeof source.score === 'object') {
        copy.score = { ...(source.score as Record<string, unknown>) };
    }
    return copy;
}

function scoreValue(payload: unknown, pid: number): unknown {
    if (!payload || typeof payload !== 'object') return undefined;
    const score = (payload as { score?: unknown }).score;
    if (!score || typeof score !== 'object') return undefined;
    return (score as Record<string, unknown>)[String(pid)];
}

function readDocIds(query: unknown): number[] {
    if (!query || typeof query !== 'object') return [];
    const docId = (query as { docId?: unknown }).docId;
    if (!docId || typeof docId !== 'object') return [];
    const list = (docId as { $in?: unknown }).$in;
    if (!Array.isArray(list)) return [];
    return list.filter((id): id is number => typeof id === 'number');
}

function getMulti(_domainId: string, _docType: number, query?: unknown) {
    const rows = readDocIds(query).flatMap((docId) => {
        const row = problemRows.get(docId);
        return row ? [{ ...row }] : [];
    });
    const cursor = {
        project() {
            return cursor;
        },
        sort() {
            return cursor;
        },
        limit() {
            return cursor;
        },
        async toArray() {
            return rows;
        },
    };
    return cursor;
}

const documentStub = {
    __esModule: true as const,
    TYPE_PROBLEM: 10,
    TYPE_CONTEST: 30,
    getMulti,
    async set() {
        return undefined;
    },
    coll: {
        async findOneAndUpdate() {
            return { docId: 'contest' };
        },
    },
    default: undefined as unknown,
};
documentStub.default = documentStub;

function visibleRule() {
    return { hidden: false };
}

const contestStub = {
    __esModule: true as const,
    RULES: {
        acm: visibleRule(),
        oi: visibleRule(),
        ioi: visibleRule(),
        strictioi: visibleRule(),
        exam: visibleRule(),
        homework: visibleRule(),
        ledo: visibleRule(),
    },
    getParticipationMode(tdoc: { participationMode?: unknown } | null | undefined) {
        return tdoc?.participationMode === 'team' ? 'team' : 'individual';
    },
    async get() {
        return null;
    },
    async edit(...args: unknown[]) {
        edits.push(args.map((arg, index) => (index === 2 ? copyPayload(arg) : arg)));
    },
    async add(...args: unknown[]) {
        adds.push(args.map((arg, index) => (index === 9 ? copyPayload(arg) : arg)));
        return 'new-contest';
    },
    async del() {
        return undefined;
    },
    async recalcStatus() {
        return undefined;
    },
    async countStatus() {
        return 0;
    },
    default: undefined as unknown,
};
contestStub.default = contestStub;

const problemStub = {
    __esModule: true as const,
    PROJECTION_CONTEST_LIST: ['docId'],
    PROJECTION_PUBLIC: ['docId'],
    assertProblemAclDomain(user: { _problemAclLoaded?: boolean; _problemAclDomainId?: string }, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) {
            const error = new Error('problem acl');
            error.name = 'PermissionError';
            throw error;
        }
    },
    async getList() {
        return {};
    },
    canPublishProblem() {
        return true;
    },
    default: undefined as unknown,
};
problemStub.default = problemStub;

const problemAccessStub = {
    __esModule: true as const,
    async assertProblemBankSelection() {
        return undefined;
    },
    problemViewReadFace() {
        return 'direct-stable';
    },
};

const contestTeamStub = {
    __esModule: true as const,
    async countActiveTeams() {
        return 0;
    },
    async getTeamByMember() {
        return null;
    },
    async listTeams() {
        return [];
    },
};

const contestTeamBatchStub = {
    __esModule: true as const,
    canManageTeamBatches() {
        return true;
    },
    async getBatch() {
        return null;
    },
    async listBatches() {
        return [];
    },
    async writeCreatedContestPlannedBatch() {
        return {};
    },
    async setContestPlannedBatch() {
        return {};
    },
    async clearContestTeamBatchPointers() {
        return {};
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

const serverStub = {
    Handler: class HandlerStub {},
    param: noopDecorator,
    post: noopDecorator,
    Type: class TypeStub {},
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const scheduleStub = {
    __esModule: true as const,
    async deleteMany() {
        return undefined;
    },
    default: undefined as unknown,
};
scheduleStub.default = scheduleStub;

const recordStub = {
    __esModule: true as const,
    coll: { countDocuments: async () => 0 },
    updateMulti: async () => undefined,
    default: undefined as unknown,
};
recordStub.default = recordStub;

const storageStub = {
    __esModule: true as const,
    async del() {
        return undefined;
    },
    default: undefined as unknown,
};
storageStub.default = storageStub;

const userStub = {
    __esModule: true as const,
    async getList() {
        return {};
    },
    default: undefined as unknown,
};
userStub.default = userStub;

const discussionStub = {
    __esModule: true as const,
    getMulti: () => ({
        project: () => ({
            toArray: async () => [],
        }),
    }),
    del: async () => undefined,
};

const genericModel = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);

function isFile(parent: NodeModule | null | undefined, filename: string): boolean {
    return parent?.filename === filename;
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    const fromContest = isFile(parent, contestPath);
    const fromKind = isFile(parent, kindGuardPath);
    if ((fromContest || fromKind) && (request === '../model/document' || request === './document')) return documentStub;
    if (!fromContest) return originalLoad.call(this, request, parent, isMain);
    if (request === '../context') return { Context: class ContextStub {}, Service: class ServiceStub {} };
    if (request === '../lib/course-exam-gate') return { async assertCourseExamWatchGate() { return undefined; } };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/contest-team') return contestTeamStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-access') return problemAccessStub;
    if (request === '../model/contest-team-batch') return contestTeamBatchStub;
    if (request === '../model/discussion') return discussionStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/schedule') return scheduleStub;
    if (request === '../model/storage') return storageStub;
    if (request === '../model/user') return userStub;
    if (request === '../service/server') return serverStub;
    if (request.startsWith('../model/')) return genericModel;
    return originalLoad.call(this, request, parent, isMain);
};

try {
    delete require.cache[contestPath];
    delete require.cache[kindGuardPath];
    contestModule = require(contestPath) as { ContestEditHandler: new () => Editor };
    require(kindGuardPath);
} finally {
    Module._load = originalLoad;
}

function makeEditor(rule: string, pids: number[]): Editor {
    const handler = new contestModule.ContestEditHandler();
    handler.domain = { _id: 'system' };
    handler.user = {
        _id: 42,
        _problemAclLoaded: true,
        _problemAclDomainId: 'system',
        timeZone: 'Asia/Shanghai',
        hasPerm: (perm: bigint) => perm === PERM.PERM_EDIT_PROBLEM || perm === PERM.PERM_EDIT_CONTEST_SELF,
        hasPriv: () => false,
        own: () => true,
    };
    handler.tdoc = {
        domainId: 'system',
        docId: 'contest',
        owner: 42,
        rule,
        pids: [...pids],
        beginAt: new Date('2099-01-01T00:00:00Z'),
        endAt: new Date('2099-01-01T02:00:00Z'),
        lockAt: null,
        score: {},
    };
    handler.response = { body: {} };
    handler.url = (name, params) => `${name}:${params.tid}`;
    handler.checkPerm = (perm) => {
        if (!handler.user.hasPerm(perm)) {
            const error = new Error('permission');
            error.name = 'PermissionError';
            throw error;
        }
    };
    return handler;
}

function postUpdateArgs(rule: string, pids: string, examScores = ''): unknown[] {
    return [
        'forged-domain',
        'contest',
        '2099-01-01',
        '08:00',
        2,
        'Contest',
        'Body',
        rule,
        pids,
        false,
        '',
        false,
        [],
        false,
        null,
        null,
        [],
        false,
        false,
        false,
        null,
        null,
        null,
        null,
        [],
        false,
        'open',
        'strict',
        false,
        false,
        'strict',
        '',
        '',
        '',
        false,
        null,
        false,
        null,
        null,
        true,
        false,
        true,
        null,
        '',
        'none',
        [],
        [],
        null,
        null,
        '',
        null,
        '',
        undefined,
        '',
        '',
        examScores,
    ];
}

async function save(rule: string, pids: string, examScores = '', previous: number[] = [5]): Promise<ErrorView> {
    const handler = makeEditor(rule, previous);
    try {
        await handler.postUpdate(...postUpdateArgs(rule, pids, examScores));
        return { field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

function extractNamed(text: string, marker: string): string {
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`missing ${JSON.stringify(marker)}`);
    const brace = text.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${marker}`);
    let depth = 0;
    for (let i = brace; i < text.length; i++) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${marker}`);
}

before(async () => {
    problemRows.set(6, { docId: 6, pid: 'P6', title: 'choice', problemKind: 'single' });
    const guard = require(kindGuardPath) as {
        assertContainerProblemKinds: (
            domainId: string,
            type: 'acm',
            nextPids: readonly number[],
            previousPids?: readonly number[],
        ) => Promise<void>;
    };
    let thrown: unknown = null;
    try {
        await guard.assertContainerProblemKinds('system', 'acm', [6], []);
    } catch (error) {
        thrown = error;
    }
    const view = errorView(thrown);
    if (view.text !== KIND_MESSAGE) {
        throw new Error(`kind guard stub is not wired: ${view.field} ${view.text}`);
    }
    problemRows.clear();
});

beforeEach(() => {
    edits.length = 0;
    adds.length = 0;
    problemRows.clear();
});

describe('contest handler scores and kind guard', { concurrency: false }, () => {
    for (const rule of ['oi', 'ioi', 'strictioi', 'exam'] as const) {
        it(`writes score 30 for problem 5 when rule is ${rule}`, async () => {
            const view = await save(rule, '5', '{"5":30}');
            expect([view.text, scoreValue(edits[0]?.[2], 5)]).to.deep.equal(['', 30]);
            expect(adds.length).to.equal(0);
        });
    }

    for (const rule of ['oi', 'ioi', 'strictioi', 'exam'] as const) {
        it(`writes score 1 for problem 5 when rule is ${rule}`, async () => {
            const view = await save(rule, '5', '{"5":1}');
            expect([view.text, scoreValue(edits[0]?.[2], 5)]).to.deep.equal(['', 1]);
            expect(adds.length).to.equal(0);
        });
    }

    it('rejects exam scores on an acm contest', async () => {
        const view = await save('acm', '5', '{"5":30}');
        expect([view.field, view.text, edits.length, adds.length]).to.deep.equal(['examScores', SCORE_MESSAGE, 0, 0]);
    });

    for (const rule of ['ledo', 'homework'] as const) {
        it(`rejects exam scores on a ${rule} contest`, async () => {
            const view = await save(rule, '5', '{"5":30}');
            expect([view.field, view.text, edits.length, adds.length]).to.deep.equal(['examScores', SCORE_MESSAGE, 0, 0]);
        });
    }

    it('rejects a newly added single choice problem in an acm contest', async () => {
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'code', problemKind: 'programming' });
        problemRows.set(6, { docId: 6, pid: 'P6', title: 'choice', problemKind: 'single' });
        const view = await save('acm', '5,6', '', [5]);
        expect([view.field, view.text, edits.length, adds.length]).to.deep.equal(['pids', KIND_MESSAGE, 0, 0]);
    });

    it('keeps an existing incompatible problem when nothing new is added', async () => {
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'choice', problemKind: 'single' });
        const view = await save('acm', '5', '', [5]);
        const payload = edits[0]?.[2] as { pids?: unknown } | undefined;
        expect(view.text).to.equal('');
        expect(payload?.pids).to.deep.equal([5]);
    });

    it('calls the kind guard from postUpdate after bank selection', () => {
        const source = readFileSync(resolve(__dirname, '../src/handler/contest.ts'), 'utf8');
        const postUpdate = extractNamed(extractNamed(source, 'export class ContestEditHandler'), 'async postUpdate(');
        const bank = postUpdate.indexOf('assertProblemBankSelection(');
        const guard = postUpdate.indexOf('assertContainerProblemKinds(');
        expect(bank >= 0).to.equal(true);
        expect(guard > bank).to.equal(true);
        expect(postUpdate.includes('teachTypeOfContestRule(rule)')).to.equal(true);
        expect(postUpdate.includes('this.tdoc?.pids ?? []')).to.equal(true);
    });

    it('returns the stored invitation code on the edit payload', async () => {
        const handler = makeEditor('acm', [5]);
        handler.tdoc._code = 'abc123';
        await handler.get('forged-domain', 'contest');
        expect(handler.response.body.inviteCode).to.equal('abc123');
        expect(handler.response.body.tdoc).to.equal(handler.tdoc);
        expect(handler.response.body.page_name).to.equal('contest_edit');
    });

    it('returns an empty invitation code when the contest has none', async () => {
        const handler = makeEditor('acm', [5]);
        await handler.get('forged-domain', 'contest');
        expect(handler.response.body.inviteCode).to.equal('');
    });

    it('returns an empty invitation code when creating a contest', async () => {
        const handler = makeEditor('acm', [5]);
        handler.tdoc._code = 'abc123';
        await handler.get('forged-domain');
        expect(handler.response.body.inviteCode).to.equal('');
        expect(handler.response.body.page_name).to.equal('contest_create');
    });
});
