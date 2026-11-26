import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, type SetCodePolicy, type TeachType } from '@hydrooj/common';
import { PERM } from '@hydrooj/common/permission';
import { ContestNotFoundError, PermissionError, TrainingNotFoundError } from '../src/error';

// The handler is loaded at runtime. A static import fails this lane's tsc gate
// while packages/hydrooj/src/handler/teach-paper.ts is still absent.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const domainId = 'school-domain';
const forgedDomainId = 'forged-domain';
const ownerUid = 42;
const studentUid = 9;
const managerUid = 77;
const trueDocId = 101;
const falseDocId = 102;
const singleDocId = 103;
const multiDocId = 201;
const blankDocId = 202;
const programDocId = 301;
const programNextDocId = 302;
const poolTrueIds = [401, 402, 403];
const poolSingleIds = [404, 405, 406];
const choiceOptions = ['甲', '乙', '丙'];
const trueStatement = '见 ![图](file://a.png)';
const singleStatement = '单选题面';
const programStatement = '编程题面甲';
const programNextStatement = '编程题面乙';

interface TeachActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
}

interface PageResponse {
    body?: unknown;
    template?: string | null;
}

interface PageHandler {
    get: (args: Record<string, unknown>) => Promise<unknown>;
    user: TeachActor;
    domain: { _id: string };
    response: PageResponse;
    request: {
        method: string;
        host: string;
        path: string;
        headers: Record<string, string>;
        query: Record<string, unknown>;
        params: Record<string, string>;
        body: Record<string, unknown>;
        json: boolean;
    };
    args: Record<string, unknown>;
    checkPerm: (...perm: bigint[]) => void;
    checkPriv: (...priv: number[]) => void;
}

interface RouteCall {
    name: string;
    path: string;
    HandlerClass: new (...ctorArgs: unknown[]) => PageHandler;
}

interface PaperItem {
    label: string;
    pid: number;
    title: string;
    score: number | null;
    kind: string;
    statement: string;
    options: string[] | null;
    answer: string | null;
}

interface PaperSection {
    kind: string | null;
    heading: string;
    drawNote: string | null;
    items: PaperItem[];
}

interface PaperExport {
    title: string;
    type: string;
    answers: boolean;
    grouped: boolean;
    sections: PaperSection[];
    raw: Record<string, unknown>;
    template: string | null;
}

interface ModuleLoader {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule | undefined>;
}

const Module = requireFromTest('module') as ModuleLoader;
const contestDocs = new Map<string, Record<string, unknown>>();
const problems = new Map<number, Record<string, unknown>>();
const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];
let routes: RouteCall[] | undefined;
let loadError: unknown;
const originalLoad = Module._load;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idText(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') return value.toLowerCase();
    return '';
}

function teachActor(uid: number, perms: readonly bigint[] = []): TeachActor {
    const permSet = new Set<bigint>(perms);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: () => false,
        own: (doc) => doc.owner === uid || (doc.maintainer || []).includes(uid),
    };
}

function installStub(relativePath: string, exportsValue: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: Module._cache[resolved] });
    const entry = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsValue,
        children: [],
        paths: [],
    } as NodeModule;
    Module._cache[resolved] = entry;
    requireFromTest.cache[resolved] = entry;
}

installStub('../src/model/contest.ts', {
    RULES: {
        acm: {},
        oi: {},
        ioi: {},
        ledo: {},
        strictioi: {},
        exam: {},
        homework: { hidden: true },
    },
    async get(nextDomainId: string, id: unknown) {
        const doc = contestDocs.get(idText(id));
        if (!doc || nextDomainId !== domainId) throw new ContestNotFoundError(nextDomainId, id);
        return doc;
    },
});
installStub('../src/model/training.ts', {
    async get(nextDomainId: string, id: unknown) {
        throw new TrainingNotFoundError(nextDomainId, id);
    },
});

function cloneProblem(doc: Record<string, unknown>): Record<string, unknown> {
    if (!isRecord(doc.config)) return { ...doc };
    const config: Record<string, unknown> = { ...doc.config };
    if (!isRecord(config.main)) return { ...doc, config };
    const main: Record<string, unknown> = { ...config.main };
    if (Array.isArray(main.options)) main.options = [...main.options];
    if (Array.isArray(main.answerIndexes)) main.answerIndexes = [...main.answerIndexes];
    config.main = main;
    return { ...doc, config };
}

function problemById(pid: unknown): Record<string, unknown> | undefined {
    const docId = typeof pid === 'number' ? pid : typeof pid === 'string' && /^[1-9]\d*$/.test(pid) ? Number(pid) : Number.NaN;
    if (!Number.isSafeInteger(docId)) return undefined;
    const doc = problems.get(docId);
    return doc ? cloneProblem(doc) : undefined;
}

function problemApi() {
    return {
        PROJECTION_PUBLIC: ['docId', 'pid', 'title', 'content', 'config'],
        PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title', 'config', 'content', 'problemKind'],
        async get(nextDomainId: string, pid: unknown) {
            if (nextDomainId !== domainId) return null;
            return problemById(pid) ?? null;
        },
        async getList(nextDomainId: string, pids: unknown) {
            const found: Record<number, Record<string, unknown>> = {};
            if (nextDomainId !== domainId || !Array.isArray(pids)) return found;
            for (const pid of pids) {
                const doc = problemById(pid);
                if (!doc || typeof doc.docId !== 'number') continue;
                found[doc.docId] = { ...doc, config: { maxScore: 100, ...(doc.config as object) } };
            }
            return found;
        },
    };
}

function isPaperModule(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/handler/teach-paper.ts')
        || normalized.endsWith('/src/lib/teach-paper-export.ts')
        || normalized.endsWith('/src/handler/teach-paper.js')
        || normalized.endsWith('/src/lib/teach-paper-export.js');
}

function isProblemRequest(request: string): boolean {
    return /(?:^|\/)model\/problem(?:\.ts|\.js)?$/.test(request);
}

Module._load = function load(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (!isPaperModule(parent?.filename) || !isProblemRequest(request)) {
        return originalLoad.call(this, request, parent, isMain);
    }
    const api = problemApi();
    return { ...api, __esModule: true, default: api };
};

function resetFixtures(): void {
    contestDocs.clear();
    problems.clear();
}

function putContest(fields: Record<string, unknown>): ObjectId {
    const docId = fields.docId instanceof ObjectId ? fields.docId : new ObjectId();
    contestDocs.set(docId.toHexString(), {
        domainId,
        owner: ownerUid,
        maintainer: [],
        title: '题目集',
        pids: [],
        score: {},
        beginAt: new Date('2020-01-01T00:00:00.000Z'),
        endAt: new Date('2099-01-01T00:00:00.000Z'),
        ...fields,
        docId,
        _id: docId,
    });
    return docId;
}

function putProblem(docId: number, fields: Record<string, unknown>): void {
    problems.set(docId, {
        docId,
        pid: `H${docId}`,
        title: `题目${docId}`,
        problemKind: 'programming',
        content: '',
        hidden: false,
        owner: ownerUid,
        ...fields,
    });
}

function objective(main: Record<string, unknown>): Record<string, unknown> {
    return { type: 'objective', main };
}

function loadHandlerModule(): Record<string, unknown> {
    try {
        const loaded: unknown = requireFromTest('../src/handler/teach-paper.ts');
        if (!isRecord(loaded)) throw new TypeError('teach export missing: handler');
        return loaded;
    } catch (error) {
        if (error instanceof TypeError && error.message.startsWith('teach export missing:')) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new TypeError(`teach export missing: ${detail}`);
    }
}

async function captureRoutes(loaded: Record<string, unknown>): Promise<RouteCall[]> {
    const apply = loaded.apply ?? (isRecord(loaded.default) ? loaded.default.apply : undefined);
    if (typeof apply !== 'function') throw new TypeError('teach export missing: apply');
    const found: RouteCall[] = [];
    const ctx = {
        Route(name: unknown, routePath: unknown, HandlerClass: unknown) {
            if (typeof name !== 'string' || typeof routePath !== 'string' || typeof HandlerClass !== 'function') {
                throw new TypeError(`teach export missing: route ${String(name)}`);
            }
            found.push({ name, path: routePath, HandlerClass: HandlerClass as new (...ctorArgs: unknown[]) => PageHandler });
        },
        inject(_deps: unknown, callback: (context: object) => unknown) {
            return callback(ctx);
        },
    };
    await (apply as (context: typeof ctx) => unknown)(ctx);
    return found;
}

async function ensureRoutes(): Promise<RouteCall[]> {
    if (routes) return routes;
    if (loadError) throw loadError;
    try {
        routes = await captureRoutes(loadHandlerModule());
        return routes;
    } catch (error) {
        loadError = error;
        throw error;
    }
}

async function paperRoute(): Promise<RouteCall> {
    const found = (await ensureRoutes()).find((item) => item.name === 'teach_paper');
    if (!found) throw new TypeError('teach export missing: teach_paper');
    return found;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readString(value: unknown, label: string): string {
    expect(typeof value, label).to.equal('string');
    if (typeof value === 'string') return value;
    throw new TypeError(label);
}

function readNumber(value: unknown, label: string): number {
    expect(typeof value, label).to.equal('number');
    if (typeof value === 'number') return value;
    throw new TypeError(label);
}

function readNullableNumber(value: unknown, label: string): number | null {
    if (typeof value === 'number') return value;
    expect(value, label).to.equal(null);
    return null;
}

function readNullableString(value: unknown, label: string): string | null {
    if (typeof value === 'string') return value;
    expect(value, label).to.equal(null);
    return null;
}

function readOptions(value: unknown, label: string): string[] | null {
    expect(value === null || isStringArray(value), label).to.equal(true);
    if (value === null) return null;
    if (isStringArray(value)) return value;
    throw new TypeError(label);
}

function readItem(value: unknown, index: number): PaperItem {
    expect(isRecord(value), `items[${index}]`).to.equal(true);
    if (!isRecord(value)) throw new TypeError('paper item');
    return {
        label: readString(value.label, `items[${index}].label`),
        pid: readNumber(value.pid, `items[${index}].pid`),
        title: readString(value.title, `items[${index}].title`),
        score: readNullableNumber(value.score, `items[${index}].score`),
        kind: readString(value.kind, `items[${index}].kind`),
        statement: readString(value.statement, `items[${index}].statement`),
        options: readOptions(value.options, `items[${index}].options`),
        answer: readNullableString(value.answer, `items[${index}].answer`),
    };
}

function readSection(value: unknown, index: number): PaperSection {
    expect(isRecord(value), `sections[${index}]`).to.equal(true);
    if (!isRecord(value)) throw new TypeError('paper section');
    expect(Array.isArray(value.items), `sections[${index}].items`).to.equal(true);
    if (!Array.isArray(value.items)) throw new TypeError('paper section');
    return {
        kind: readNullableString(value.kind, `sections[${index}].kind`),
        heading: readString(value.heading, `sections[${index}].heading`),
        drawNote: readNullableString(value.drawNote, `sections[${index}].drawNote`),
        items: value.items.map((item, itemIndex) => readItem(item, itemIndex)),
    };
}

function readPaper(value: unknown, template: string | null): PaperExport {
    expect(isRecord(value), 'response body').to.equal(true);
    if (!isRecord(value)) throw new TypeError('paper export');
    expect(typeof value.title).to.equal('string');
    expect(typeof value.type).to.equal('string');
    expect(typeof value.answers).to.equal('boolean');
    expect(typeof value.grouped).to.equal('boolean');
    expect(Array.isArray(value.sections)).to.equal(true);
    if (
        typeof value.title !== 'string'
        || typeof value.type !== 'string'
        || typeof value.answers !== 'boolean'
        || typeof value.grouped !== 'boolean'
        || !Array.isArray(value.sections)
    ) throw new TypeError('paper export');
    return {
        title: value.title,
        type: value.type,
        answers: value.answers,
        grouped: value.grouped,
        sections: value.sections.map((section, index) => readSection(section, index)),
        raw: value,
        template,
    };
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('teach export missing:')) throw error;
        return error;
    }
    throw new Error('expected the call to reject');
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

async function openPaper(
    actor: TeachActor,
    type: string,
    id: string,
    answers: boolean,
    json: boolean,
): Promise<PaperExport> {
    const query: Record<string, unknown> = answers ? { answers: '1' } : {};
    const args = { domainId: forgedDomainId, type, id, ...query };
    const response: PageResponse = {};
    const request = {
        method: 'get',
        host: 'localhost',
        path: `/teach/${type}/${id}/paper`,
        headers: json ? { accept: 'application/json' } : {},
        query,
        params: { type, id },
        body: {},
        json,
    };
    const handler = new (await paperRoute()).HandlerClass({
        session: {},
        holdFiles: [],
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
            domain: { _id: domainId },
        },
    }, {});
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.response = response;
    handler.request = request;
    handler.args = args;
    handler.checkPerm = (...perms: bigint[]) => {
        if (!actor.hasPerm(...perms)) throw new PermissionError(...perms);
    };
    handler.checkPriv = () => undefined;
    const returned = await handler.get(args);
    const body = handler.response.body !== undefined ? handler.response.body : returned;
    return readPaper(body, handler.response.template ?? null);
}

function homeworkOwner(): TeachActor {
    return teachActor(ownerUid, [PERM.PERM_EDIT_HOMEWORK_SELF]);
}

function contestOwner(): TeachActor {
    return teachActor(ownerUid, [PERM.PERM_EDIT_CONTEST_SELF]);
}

function sectionView(paper: PaperExport) {
    return paper.sections.map((section) => ({
        kind: section.kind,
        heading: section.heading,
        drawNote: section.drawNote,
        items: section.items.map((item) => ({
            label: item.label,
            pid: item.pid,
            title: item.title,
            score: item.score,
            kind: item.kind,
            statement: item.statement,
            options: item.options,
            answer: item.answer,
        })),
    }));
}

after(() => {
    Module._load = originalLoad;
    for (const item of replaced) {
        if (item.previous) {
            Module._cache[item.resolved] = item.previous;
            requireFromTest.cache[item.resolved] = item.previous;
        } else {
            delete Module._cache[item.resolved];
            delete requireFromTest.cache[item.resolved];
        }
    }
});

beforeEach(() => {
    resetFixtures();
});

describe('teach paper export', { concurrency: false }, () => {
    it('exports configured weights by code policy for new and migrated contest presets', async () => {
        const examples: Array<{ rule: string; type: TeachType; codePolicy: SetCodePolicy; score: number | null }> = [
            { rule: 'contest', type: 'exam', codePolicy: 'highest', score: 25 },
            { rule: 'acm', type: 'acm', codePolicy: 'highest', score: 25 },
            { rule: 'exam', type: 'exam', codePolicy: 'acm', score: null },
        ];
        putProblem(programDocId, { problemKind: 'programming', title: 'Code', content: programStatement });
        for (const example of examples) {
            const config = createDraftConfig('contest');
            config.settings.codePolicy = example.codePolicy;
            const tid = putContest({ rule: example.rule, pids: [programDocId], score: { [programDocId]: 25 }, setConfig: config });
            const paper = await openPaper(contestOwner(), example.type, tid.toHexString(), true, false);
            expect(paper.sections[0].items[0].score).to.equal(example.score);
            if (example.score === null) expect(paper.sections[0].heading).not.to.include('分');
        }
    });

    it('registers the paper route and groups a homework by kind', async () => {
        const found = await ensureRoutes();
        expect(found.find((item) => item.name === 'teach_paper')?.path).to.equal('/teach/:type/:id/paper');
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId, falseDocId, singleDocId],
            score: { [trueDocId]: 2, [falseDocId]: 2, [singleDocId]: 5 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: trueStatement,
            config: objective({ answer: true }),
        });
        putProblem(falseDocId, {
            problemKind: 'true_false',
            title: '判断乙',
            content: '第二道判断',
            config: objective({ answer: false }),
        });
        putProblem(singleDocId, {
            problemKind: 'single',
            title: '单选甲',
            content: singleStatement,
            config: objective({ options: choiceOptions, answerIndex: 1 }),
        });
        const paper = await openPaper(homeworkOwner(), 'homework', tid.toHexString(), false, false);
        expect(paper.template).to.equal('teach_paper_print.html');
        expect(paper.title).to.equal('第一章作业');
        expect(paper.type).to.equal('homework');
        expect(paper.answers).to.equal(false);
        expect(paper.grouped).to.equal(true);
        expect(sectionView(paper)).to.deep.equal([
            {
                kind: 'true_false',
                heading: '一、判断题（每题 2 分，共 4 分）',
                drawNote: null,
                items: [
                    {
                        label: '1-1',
                        pid: trueDocId,
                        title: '判断甲',
                        score: 2,
                        kind: 'true_false',
                        statement: `见 ![图](/p/${trueDocId}/file/a.png)`,
                        options: null,
                        answer: null,
                    },
                    {
                        label: '1-2',
                        pid: falseDocId,
                        title: '判断乙',
                        score: 2,
                        kind: 'true_false',
                        statement: '第二道判断',
                        options: null,
                        answer: null,
                    },
                ],
            },
            {
                kind: 'single',
                heading: '二、单选题（每题 5 分，共 5 分）',
                drawNote: null,
                items: [
                    {
                        label: '2-1',
                        pid: singleDocId,
                        title: '单选甲',
                        score: 5,
                        kind: 'single',
                        statement: singleStatement,
                        options: choiceOptions,
                        answer: null,
                    },
                ],
            },
        ]);
        const json = await openPaper(homeworkOwner(), 'homework', tid.toHexString(), false, true);
        expect(json.raw).to.deep.equal(paper.raw);
    });

    it('returns objective answers only when answers=1', async () => {
        const homeworkId = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId, falseDocId, singleDocId],
            score: { [trueDocId]: 2, [falseDocId]: 2, [singleDocId]: 5 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: trueStatement,
            config: objective({ answer: true }),
        });
        putProblem(falseDocId, {
            problemKind: 'true_false',
            title: '判断乙',
            content: '第二道判断',
            config: objective({ answer: false }),
        });
        putProblem(singleDocId, {
            problemKind: 'single',
            title: '单选甲',
            content: singleStatement,
            config: objective({ options: choiceOptions, answerIndex: 1 }),
        });
        const hidden = await openPaper(homeworkOwner(), 'homework', homeworkId.toHexString(), false, false);
        expect(hidden.answers).to.equal(false);
        expect(hidden.sections.flatMap((section) => section.items.map((item) => item.answer))).to.deep.equal([null, null, null]);
        const shown = await openPaper(homeworkOwner(), 'homework', homeworkId.toHexString(), true, false);
        expect(shown.answers).to.equal(true);
        expect(shown.sections.flatMap((section) => section.items.map((item) => [item.label, item.answer]))).to.deep.equal([
            ['1-1', '对'],
            ['1-2', '错'],
            ['2-1', 'B'],
        ]);

        const choiceId = putContest({
            rule: 'homework',
            title: '选择题作业',
            pids: [multiDocId, blankDocId],
            score: { [multiDocId]: 4, [blankDocId]: 3 },
        });
        putProblem(multiDocId, {
            problemKind: 'multi',
            title: '多选甲',
            content: '多选题面',
            config: objective({ options: choiceOptions, answerIndexes: [0, 2] }),
        });
        putProblem(blankDocId, {
            problemKind: 'blank',
            title: '填空甲',
            content: '填空题面',
            config: objective({ answer: '42' }),
        });
        const choiceHidden = await openPaper(homeworkOwner(), 'homework', choiceId.toHexString(), false, false);
        expect(choiceHidden.sections.flatMap((section) => section.items.map((item) => item.answer))).to.deep.equal([null, null]);
        const choiceShown = await openPaper(homeworkOwner(), 'homework', choiceId.toHexString(), true, false);
        expect(choiceShown.answers).to.equal(true);
        expect(choiceShown.sections.flatMap((section) => section.items.map((item) => ({
            label: item.label,
            kind: item.kind,
            options: item.options,
            answer: item.answer,
        })))).to.deep.equal([
            { label: '3-1', kind: 'multi', options: choiceOptions, answer: 'A, C' },
            { label: '4-1', kind: 'blank', options: null, answer: '42' },
        ]);
    });

    it('exports an acm contest as one ungrouped section', async () => {
        const tid = putContest({
            rule: 'acm',
            title: '校赛',
            pids: [programDocId, programNextDocId],
            score: { [programDocId]: 10 },
        });
        putProblem(programDocId, { title: '编程甲', content: programStatement });
        putProblem(programNextDocId, { title: '编程乙', content: programNextStatement });
        const paper = await openPaper(contestOwner(), 'acm', tid.toHexString(), true, false);
        expect(paper.title).to.equal('校赛');
        expect(paper.type).to.equal('acm');
        expect(paper.answers).to.equal(true);
        expect(paper.grouped).to.equal(false);
        expect(paper.template).to.equal('teach_paper_print.html');
        expect(sectionView(paper)).to.deep.equal([
            {
                kind: null,
                heading: '',
                drawNote: null,
                items: [
                    {
                        label: 'A',
                        pid: programDocId,
                        title: '编程甲',
                        score: null,
                        kind: 'programming',
                        statement: programStatement,
                        options: null,
                        answer: null,
                    },
                    {
                        label: 'B',
                        pid: programNextDocId,
                        title: '编程乙',
                        score: null,
                        kind: 'programming',
                        statement: programNextStatement,
                        options: null,
                        answer: null,
                    },
                ],
            },
        ]);
    });

    it('lists the whole exam pool and notes each draw quota', async () => {
        const pids = [...poolTrueIds, ...poolSingleIds];
        const score: Record<number, number> = {};
        for (const pid of pids) score[pid] = 2;
        const tid = putContest({
            rule: 'exam',
            title: '期中考试',
            pids,
            score,
            examPaperQuotas: { true_false: 2, single: 2 },
        });
        for (const [index, pid] of poolTrueIds.entries()) {
            putProblem(pid, {
                problemKind: 'true_false',
                title: `判断池${index + 1}`,
                content: `判断正文${index + 1}`,
                config: objective({ answer: index % 2 === 0 }),
            });
        }
        for (const [index, pid] of poolSingleIds.entries()) {
            putProblem(pid, {
                problemKind: 'single',
                title: `单选池${index + 1}`,
                content: `单选正文${index + 1}`,
                config: objective({ options: ['是', '否'], answerIndex: 0 }),
            });
        }
        const paper = await openPaper(contestOwner(), 'exam', tid.toHexString(), false, false);
        expect(paper.type).to.equal('exam');
        expect(paper.grouped).to.equal(true);
        expect(paper.answers).to.equal(false);
        expect(paper.sections.map((section) => ({
            kind: section.kind,
            drawNote: section.drawNote,
            labels: section.items.map((item) => item.label),
            pids: section.items.map((item) => item.pid),
            titles: section.items.map((item) => item.title),
        }))).to.deep.equal([
            {
                kind: 'true_false',
                drawNote: '每人抽 2 道',
                labels: ['1-1', '1-2', '1-3'],
                pids: poolTrueIds,
                titles: ['判断池1', '判断池2', '判断池3'],
            },
            {
                kind: 'single',
                drawNote: '每人抽 2 道',
                labels: ['2-1', '2-2', '2-3'],
                pids: poolSingleIds,
                titles: ['单选池1', '单选池2', '单选池3'],
            },
        ]);
        expect(paper.sections.flatMap((section) => section.items).length).to.equal(pids.length);
    });

    it('rejects a student', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId],
            score: { [trueDocId]: 2 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: '判断正文',
            config: objective({ answer: true }),
        });
        const error = await rejectionOf(() => openPaper(teachActor(studentUid), 'homework', tid.toHexString(), false, false));
        expect(errorName(error)).to.equal('PermissionError');
    });

    it('lists multi-select answers as letters in ascending order', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '选择题作业',
            pids: [multiDocId],
            score: { [multiDocId]: 4 },
        });
        putProblem(multiDocId, {
            problemKind: 'multi',
            title: '多选甲',
            content: '多选题面',
            config: objective({ options: choiceOptions, answerIndexes: [2, 0] }),
        });
        const paper = await openPaper(homeworkOwner(), 'homework', tid.toHexString(), true, false);
        expect(paper.sections.flatMap((section) => section.items.map((item) => ({
            options: item.options,
            answer: item.answer,
        })))).to.deep.equal([
            { options: choiceOptions, answer: 'A, C' },
        ]);
    });

    it('rewrites every file link in a statement', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId],
            score: { [trueDocId]: 2 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: '见 ![图](file://a.png) 和 ![表](file://b.png)',
            config: objective({ answer: true }),
        });
        const paper = await openPaper(homeworkOwner(), 'homework', tid.toHexString(), false, false);
        expect(paper.sections.flatMap((section) => section.items.map((item) => item.statement))).to.deep.equal([
            `见 ![图](/p/${trueDocId}/file/a.png) 和 ![表](/p/${trueDocId}/file/b.png)`,
        ]);
    });

    it('lets a homework manager who does not own the container export it', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId],
            score: { [trueDocId]: 2 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: '判断正文',
            config: objective({ answer: true }),
        });
        const paper = await openPaper(teachActor(managerUid, [PERM.PERM_EDIT_HOMEWORK]), 'homework', tid.toHexString(), false, false);
        expect(paper.title).to.equal('第一章作业');
        expect(paper.type).to.equal('homework');
        expect(paper.sections.flatMap((section) => section.items.map((item) => item.answer))).to.deep.equal([null]);
    });

    it('rejects a contest opened under a different teach type', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId],
            score: { [trueDocId]: 2 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: '判断正文',
            config: objective({ answer: true }),
        });
        const error = await rejectionOf(() => openPaper(contestOwner(), 'exam', tid.toHexString(), false, false));
        expect(errorName(error)).to.equal('NotFoundError');
    });

    it('states only the total when question scores differ', async () => {
        const tid = putContest({
            rule: 'homework',
            title: '第一章作业',
            pids: [trueDocId, falseDocId],
            score: { [trueDocId]: 2, [falseDocId]: 3 },
        });
        putProblem(trueDocId, {
            problemKind: 'true_false',
            title: '判断甲',
            content: '第一道',
            config: objective({ answer: true }),
        });
        putProblem(falseDocId, {
            problemKind: 'true_false',
            title: '判断乙',
            content: '第二道',
            config: objective({ answer: false }),
        });
        const paper = await openPaper(homeworkOwner(), 'homework', tid.toHexString(), false, false);
        expect(paper.sections.map((section) => ({
            heading: section.heading,
            scores: section.items.map((item) => item.score),
        }))).to.deep.equal([
            { heading: '一、判断题（共 5 分）', scores: [2, 3] },
        ]);
    });
});
