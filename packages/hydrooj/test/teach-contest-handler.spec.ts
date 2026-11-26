import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { createDraftConfig, type SetConfig } from '@hydrooj/common';

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
        lockAt: Date | null;
        statusRecalcToken?: string;
        score: Record<string, number>;
        _code?: string;
        setConfig?: SetConfig;
        setPoints?: Record<number, { points: number; rawMax: number }>;
        setAudienceConfirmed?: boolean;
        participationMode?: 'individual' | 'team';
        autoHide?: boolean;
        autoHideProblemPids?: number[];
        autoHidePendingPids?: number[];
        unrankRosterEnabled?: boolean;
        unrankRosterUids?: number[];
    };
    response: { body: Record<string, unknown>; redirect?: string; template?: string };
    url: (name: string, params: { tid: string }) => string;
    checkPerm: (perm: bigint) => void;
    get: (domainId: string, tid?: string) => Promise<void>;
    postUpdate: (...args: unknown[]) => Promise<unknown>;
    postUpdateProblems: (...args: unknown[]) => Promise<unknown>;
}

const contestPath = require.resolve('../src/handler/contest.ts');
const kindGuardPath = require.resolve('../src/lib/container-problem-kinds.ts');
const problemRows = new Map<number, ProblemRow>();
const edits: unknown[][] = [];
const adds: unknown[][] = [];
let contestModule: {
    ContestEditHandler: new () => Editor;
    contestCanUnrank: (doc: Editor['tdoc'], status: { attend?: number } | null, mode: 'browser' | 'client' | 'preview') => boolean;
};
let ContestManagementHandler: new () => Editor & { postSetScores: (domainId: string, pids: number[], score: number) => Promise<void> };
let currentEditorDoc: Editor['tdoc'] | null = null;
const recalcCalls: Array<{ kind: 'legacy' | 'configured'; pids?: readonly number[]; revision?: number }> = [];
let failRecalc = false;
let failHide = false;
let failUnhide = false;
const visibilityWrites: Array<{ pid: number; hidden: boolean }> = [];

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
    isDone(doc: { endAt: Date }) {
        return doc.endAt.getTime() <= Date.now();
    },
    usesAcmScoring(doc: Editor['tdoc']) {
        return doc.setConfig ? doc.setConfig.settings.codePolicy === 'acm' : doc.rule === 'acm';
    },
    async get() {
        return currentEditorDoc;
    },
    async edit(...args: unknown[]) {
        edits.push(args.map((arg, index) => (index === 2 ? copyPayload(arg) : arg)));
        if (currentEditorDoc) Object.assign(currentEditorDoc, args[2]);
    },
    async add(...args: unknown[]) {
        adds.push(args.map((arg, index) => (index === 9 ? copyPayload(arg) : arg)));
        return 'new-contest';
    },
    async del() {
        return undefined;
    },
    async recalcStatus() {
        recalcCalls.push({ kind: 'legacy' });
        if (failRecalc) throw new Error('recalc fixture failure');
        if (currentEditorDoc) delete currentEditorDoc.statusRecalcToken;
    },
    async recalcConfiguredSet(doc: Editor['tdoc'], pids: readonly number[] = doc.pids) {
        recalcCalls.push({ kind: 'configured', pids: [...pids], revision: doc.setConfig?.revision });
        if (failRecalc) throw new Error('recalc fixture failure');
        if (currentEditorDoc) delete currentEditorDoc.statusRecalcToken;
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
    async getList(_domainId: string, pids: number[]) {
        return Object.fromEntries(pids.flatMap((pid) => problemRows.has(pid) ? [[pid, { ...problemRows.get(pid), config: { maxScore: 100 } }]] : []));
    },
    async editAuthorized(_domainId: string, pid: number, patch: { hidden: boolean }) {
        if (failHide) throw new Error('fixture hide failure');
        visibilityWrites.push({ pid, hidden: patch.hidden });
    },
    async edit(_domainId: string, pid: number, patch: { hidden: boolean }) {
        if (failUnhide) throw new Error('fixture unhide failure');
        visibilityWrites.push({ pid, hidden: patch.hidden });
    },
    async get(_domainId: string, pid: number) {
        return problemRows.get(pid) ?? null;
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
    async add() { return 'schedule-id'; },
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
    if (parent?.filename.endsWith('/lib/set-paper-edit.ts') && request === '../service/db') {
        return { collection: () => ({ find: () => ({ toArray: async () => [] }) }) };
    }
    if ((parent?.filename.endsWith('/lib/set-paper-edit.ts') || parent?.filename.endsWith('/lib/set-publish-facts.ts'))
        && request === '../model/problem') return problemStub;
    const fromContest = isFile(parent, contestPath);
    const fromKind = isFile(parent, kindGuardPath);
    if ((fromContest || fromKind) && (request === '../model/document' || request === './document')) return documentStub;
    if (!fromContest) return originalLoad.call(this, request, parent, isMain);
    if (request === '../model/builtin') return originalLoad.call(this, request, parent, isMain);
    if (request === '../context') return { Context: class ContextStub {}, Service: class ServiceStub {} };
    if (request === '../lib/teach-access') return { canManageTeachContainer: () => true };
    if (request === '../lib/set-problem-access') return { currentSetProblemPids: async () => null, projectCurrentSetTdoc: async (doc: unknown) => doc };
    if (request === '../lib/set-participation-access') return { assertSetPreviewWindow() {} };
    if (request === '../lib/set-student-state') return { loadSetStudentState: async () => null, setWorkspaceState: () => ({}) };
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
    contestModule = require(contestPath) as typeof contestModule;
    ({ ContestManagementHandler } = require(contestPath));
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
    currentEditorDoc = handler.tdoc;
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

function savePaper(handler: Editor, pids: number[], points = Object.fromEntries(pids.map((pid) => [pid, 100]))) {
    const edit = { revision: currentEditorDoc!.setConfig!.revision, points, excluded: [], target: null, quotas: null };
    return handler.postUpdateProblems('forged-domain', 'contest', pids.join(','), undefined, JSON.stringify(edit));
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
    recalcCalls.length = 0;
    failRecalc = false;
    failHide = false;
    failUnhide = false;
    visibilityWrites.length = 0;
});

describe('contest handler scores and kind guard', { concurrency: false }, () => {
    it('offers self-unrank by configured scoring while preserving entry and roster gates', () => {
        const doc = makeEditor('contest', []).tdoc;
        doc.setConfig = { ...createDraftConfig('contest'), publication: 'published' };
        expect(contestModule.contestCanUnrank(doc, null, 'browser')).to.equal(true);
        doc.setConfig.settings.codePolicy = 'acm';
        expect(contestModule.contestCanUnrank(doc, null, 'browser')).to.equal(true);
        expect(contestModule.contestCanUnrank(doc, { attend: 1 }, 'browser')).to.equal(false);
        expect(contestModule.contestCanUnrank(doc, null, 'client')).to.equal(false);
        expect(contestModule.contestCanUnrank({ ...doc, participationMode: 'team' }, null, 'browser')).to.equal(false);
        expect(contestModule.contestCanUnrank({ ...doc, unrankRosterEnabled: true, unrankRosterUids: [1] }, null, 'browser')).to.equal(false);
        expect(contestModule.contestCanUnrank({ ...doc, endAt: new Date(0) }, null, 'browser')).to.equal(false);
        const legacy = { ...doc, rule: 'ledo' };
        delete legacy.setConfig;
        expect(contestModule.contestCanUnrank(legacy, null, 'browser')).to.equal(false);
    });

    it('saves only paper fields for an undated configured draft', async () => {
        const handler = makeEditor('contest', []);
        handler.tdoc.setConfig = createDraftConfig('contest');
        Reflect.deleteProperty(handler.tdoc, 'beginAt');
        Reflect.deleteProperty(handler.tdoc, 'endAt');
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'Code', problemKind: 'programming' });
        await savePaper(handler, [5], { 5: 25 });
        expect(Object.keys(edits[0][2] as object).sort()).to.deep.equal(['pids', 'score', 'setConfig', 'setPoints', 'setTargetScore', 'statusRecalcToken']);
        expect(currentEditorDoc).not.to.have.property('beginAt');
        expect(currentEditorDoc).not.to.have.property('endAt');
        expect(currentEditorDoc?.setPoints?.[5]).to.deep.equal({ points: 25, rawMax: 100 });
    });

    it('removes scored ACM draft problems when the composer omits weights', async () => {
        const handler = makeEditor('contest', [5, 6]);
        handler.tdoc.setConfig = createDraftConfig('contest');
        handler.tdoc.setConfig.settings.codePolicy = 'acm';
        handler.tdoc.score = { 5: 100, 6: 100 };
        await handler.postUpdateProblems('system', 'contest', '5');
        expect(currentEditorDoc?.pids).to.deep.equal([5]);
        expect(currentEditorDoc?.score).to.deep.equal({ 5: 100 });
        await handler.postUpdateProblems('system', 'contest', '');
        expect(currentEditorDoc?.pids).to.deep.equal([]);
        expect(currentEditorDoc?.score).to.deep.equal({});
    });

    it('keeps active auto-hide authorization and recovers unfinished paper visibility changes', async () => {
        const handler = makeEditor('contest', [5]);
        handler.tdoc.setConfig = createDraftConfig('contest');
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [5];
        for (const pid of [5, 6]) problemRows.set(pid, { docId: pid, pid: `P${pid}`, title: 'Code', problemKind: 'programming' });
        handler.user.hasPerm = (permission) => permission === PERM.PERM_EDIT_CONTEST_SELF;
        let denied: unknown;
        try {
            await savePaper(handler, [5, 6]);
        } catch (error) { denied = error; }
        expect((denied as Error).name).to.equal('PermissionError');
        expect(edits).to.have.length(0);
        handler.user.hasPerm = () => true;
        failHide = true;
        let failed: unknown;
        try {
            await savePaper(handler, [5, 6]);
        } catch (error) { failed = error; }
        expect((failed as Error).message).to.equal('fixture hide failure');
        expect(currentEditorDoc?.autoHidePendingPids).to.deep.equal([6]);
        failHide = false;
        await savePaper(handler, [5, 6]);
        expect(visibilityWrites).to.deep.equal([{ pid: 6, hidden: true }]);
        expect(currentEditorDoc?.autoHidePendingPids).to.deep.equal([]);
        await savePaper(handler, [6]);
        expect(visibilityWrites[1]).to.deep.equal({ pid: 5, hidden: false });
        expect(currentEditorDoc?.autoHideProblemPids).to.deep.equal([6]);
    });

    it('recovers inactive auto-hide without publishing newly selected hidden problems', async () => {
        const handler = makeEditor('contest', [5]);
        handler.tdoc.setConfig = createDraftConfig('contest');
        handler.tdoc.autoHide = false;
        handler.tdoc.autoHideProblemPids = [5];
        for (const pid of [5, 6]) problemRows.set(pid, { docId: pid, pid: `P${pid}`, title: 'Code', problemKind: 'programming' });
        failUnhide = true;
        let failed: unknown;
        try {
            await savePaper(handler, [5, 6]);
        } catch (error) { failed = error; }
        expect((failed as Error).message).to.equal('fixture unhide failure');
        expect(currentEditorDoc?.autoHideProblemPids).to.deep.equal([5]);
        failUnhide = false;
        await savePaper(handler, [5, 6]);
        expect(visibilityWrites).to.deep.equal([{ pid: 5, hidden: false }]);
        expect(currentEditorDoc?.autoHideProblemPids).to.deep.equal([]);
    });

    it('edits a published contest preset and keeps its strategy in setConfig', async () => {
        const handler = makeEditor('contest', [5]);
        const config = createDraftConfig('contest');
        config.publication = 'published';
        config.settings.personalLimit.hours = 1;
        config.settings.retake.passScore = 40;
        handler.tdoc.setConfig = config;
        handler.tdoc.setAudienceConfirmed = true;
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'Code', problemKind: 'programming' });
        await savePaper(handler, [5], { 5: 50 });
        expect(currentEditorDoc?.setPoints?.[5]?.points).to.equal(50);
        const writes = edits.map((args) => args[2] as Record<string, unknown>);
        for (const write of writes) {
            for (const key of ['duration', 'examPassScore', 'examAttemptLimit', 'examPaperQuotas', 'examShowVerdict', 'keepScoreboardHidden']) {
                expect(write, key).not.to.have.property(key);
            }
        }
        expect(config.settings.retake.passScore).to.equal(40);
    });

    it('rejects a published score edit that puts the pass line above the actual paper', async () => {
        const handler = makeEditor('contest', [5]);
        handler.tdoc.setConfig = { ...createDraftConfig('contest'), publication: 'published' };
        handler.tdoc.setConfig.settings.retake.passScore = 40;
        handler.tdoc.setAudienceConfirmed = true;
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'Code', problemKind: 'programming' });
        let thrown: unknown;
        try {
            await savePaper(handler, [5], { 5: 30 });
        } catch (error) { thrown = error; }
        expect(errorView(thrown).field).to.equal('problemScores');
        expect(edits).to.have.length(0);
    });

    it('directs legacy bulk changes on a configured paper to the versioned composer', async () => {
        const handler = Object.assign(new ContestManagementHandler(), makeEditor('contest', [5]));
        handler.tdoc.setConfig = { ...createDraftConfig('contest'), publication: 'published' };
        handler.tdoc.setConfig.settings.retake.passScore = 40;
        handler.tdoc.setAudienceConfirmed = true;
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'Code', problemKind: 'programming' });
        let thrown: unknown;
        try {
            await handler.postSetScores('forged-domain', [5], 30);
        } catch (error) { thrown = error; }
        expect(errorView(thrown).field).to.equal('problemScores');
        expect(edits).to.have.length(0);
    });

    it('persists score revision and recalc marker together, and retries the entire paper after failure', async () => {
        const handler = makeEditor('contest', [5, 6]);
        for (const pid of [5, 6]) problemRows.set(pid, { docId: pid, pid: `P${pid}`, title: 'Code', problemKind: 'programming' });
        handler.tdoc.setConfig = createDraftConfig('contest');
        const revision = handler.tdoc.setConfig.revision;
        failRecalc = true;
        let thrown: unknown;
        try {
            await savePaper(handler, [5, 6], { 5: 30, 6: 100 });
        } catch (error) { thrown = error; }
        expect((thrown as Error).message).to.equal('recalc fixture failure');
        expect(currentEditorDoc?.setPoints?.[5]?.points).to.equal(30);
        expect(currentEditorDoc?.setConfig?.revision).to.equal(revision + 1);
        expect(currentEditorDoc?.statusRecalcToken).to.be.a('string');
        expect(recalcCalls).to.deep.equal([{ kind: 'configured', pids: [5], revision: revision + 1 }]);
        failRecalc = false;
        await savePaper(handler, [5, 6], { 5: 30, 6: 100 });
        expect(recalcCalls[1]).to.deep.equal({ kind: 'configured', pids: [5, 6], revision: revision + 1 });
        expect(currentEditorDoc?.statusRecalcToken).to.equal(undefined);
        expect(currentEditorDoc?.setConfig?.revision).to.equal(revision + 1);
    });

    it('recalculates legacy scores through the legacy status path', async () => {
        const handler = Object.assign(new ContestManagementHandler(), makeEditor('exam', [5]), { back() {} });
        await handler.postSetScores('forged-domain', [5], 30);
        expect(recalcCalls).to.deep.equal([{ kind: 'legacy' }]);
        expect(currentEditorDoc?.score[5]).to.equal(30);
        expect(currentEditorDoc).not.to.have.property('setConfig');
    });

    it('rejects invalid audience before persisting scores or advancing revision', async () => {
        const handler = makeEditor('contest', [5]);
        handler.tdoc.setConfig = createDraftConfig('contest');
        const args = postUpdateArgs('contest', '5', '{"5":50}');
        args[44] = 'schools';
        args[45] = ['bad-school-id'];
        let thrown: unknown;
        try {
            await handler.postUpdate(...args);
        } catch (error) { thrown = error; }
        expect(thrown).to.be.instanceOf(Error);
        expect(edits).to.have.length(0);
        expect(recalcCalls).to.have.length(0);
    });

    it('preserves advanced lockAt and rejects an editor whose management access was removed', async () => {
        const handler = makeEditor('contest', [5]);
        handler.tdoc.setConfig = createDraftConfig('contest');
        handler.tdoc.lockAt = new Date('2099-01-01T01:00:00Z');
        await handler.postUpdate(...postUpdateArgs('contest', '5'));
        expect(edits.every((entry) => !('lockAt' in (entry[2] as object)))).to.equal(true);
        expect(currentEditorDoc?.lockAt).to.deep.equal(new Date('2099-01-01T01:00:00Z'));
        edits.length = 0;
        handler.user.own = () => false;
        let thrown: unknown;
        try {
            await handler.postUpdate(...postUpdateArgs('contest', '5'));
        } catch (error) { thrown = error; }
        expect((thrown as Error).name).to.equal('PermissionError');
        expect(edits).to.have.length(0);
    });

    it('uses configured scoring capabilities when editing a migrated acm container', async () => {
        const handler = makeEditor('acm', [5]);
        handler.tdoc.setConfig = { ...createDraftConfig('contest'), publication: 'published' };
        handler.tdoc.setAudienceConfirmed = true;
        problemRows.set(5, { docId: 5, pid: 'P5', title: 'Code', problemKind: 'programming' });
        problemRows.set(6, { docId: 6, pid: 'P6', title: 'Choice', problemKind: 'single' });
        await savePaper(handler, [5, 6], { 5: 50, 6: 10 });
        expect(currentEditorDoc?.setPoints?.[6]?.points).to.equal(10);
        edits.length = 0;
        handler.tdoc.setConfig.settings.codePolicy = 'acm';
        let thrown: unknown;
        try {
            await handler.postUpdate(...postUpdateArgs('acm', '5,6'));
        } catch (error) { thrown = error; }
        expect(errorView(thrown).field).to.equal('setConfig');
        expect(edits).to.have.length(0);
    });

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
