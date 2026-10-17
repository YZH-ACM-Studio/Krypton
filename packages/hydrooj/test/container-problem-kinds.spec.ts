import { expect } from 'chai';
import nodeModule from 'node:module';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import type { TeachType } from '@hydrooj/common';

const host = globalThis as unknown as { Hydro?: { model: Record<string, unknown> } };
host.Hydro ||= { model: {} };

const TYPE_PROBLEM = 10;
const KIND_SENTENCE = '这些题目不能加入当前类型的题目集：';

interface ProblemRow {
    docId: number;
    pid: string;
    title: string;
    problemKind?: string;
}

interface QueryCall {
    domainId: string;
    docType: number;
    docIds: number[];
    projection: Record<string, number> | null;
}

interface ProblemCursor {
    project(projection: Readonly<Record<string, number>>): ProblemCursor;
    sort(): ProblemCursor;
    limit(): ProblemCursor;
    toArray(): Promise<ProblemRow[]>;
    [Symbol.asyncIterator](): AsyncIterableIterator<ProblemRow>;
}

type AssertContainerProblemKinds = (
    domainId: string,
    type: TeachType,
    nextPids: readonly number[],
    previousPids?: readonly number[],
) => Promise<void>;

interface ContainerProblemKindsModule {
    assertContainerProblemKinds?: AssertContainerProblemKinds;
}

type ModuleLoader = (this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;

const moduleLoader = nodeModule as unknown as { _load: ModuleLoader };
const originalLoad = moduleLoader._load;
const queries: QueryCall[] = [];
const warnCalls: unknown[][] = [];
let problems: ProblemRow[] = [];
let assertContainerProblemKinds: AssertContainerProblemKinds | undefined;

function recordWarn(...args: unknown[]) {
    warnCalls.push(args);
}

class RecordingLogger {
    info() {}

    warn(...args: unknown[]) {
        recordWarn(...args);
    }

    error() {}

    debug() {}
}

const loggerSingleton = new RecordingLogger();

function cloneRow(row: ProblemRow): ProblemRow {
    const copy: ProblemRow = { docId: row.docId, pid: row.pid, title: row.title };
    if (Object.hasOwn(row, 'problemKind')) copy.problemKind = row.problemKind;
    return copy;
}

function readDocIds(query: unknown): number[] {
    if (!query || typeof query !== 'object') return [];
    const docId = (query as { docId?: unknown }).docId;
    if (!docId || typeof docId !== 'object') return [];
    const list = (docId as { $in?: unknown }).$in;
    if (!Array.isArray(list)) return [];
    return list.filter((id): id is number => typeof id === 'number');
}

function rowsFor(call: QueryCall): ProblemRow[] {
    if (call.docType !== TYPE_PROBLEM) return [];
    return problems.filter((row) => call.docIds.includes(row.docId)).map((row) => cloneRow(row));
}

function makeCursor(call: QueryCall): ProblemCursor {
    const cursor: ProblemCursor = {
        project(projection) {
            call.projection = { ...projection };
            return cursor;
        },
        sort() {
            return cursor;
        },
        limit() {
            return cursor;
        },
        async toArray() {
            return rowsFor(call);
        },
        async *[Symbol.asyncIterator]() {
            for (const row of rowsFor(call)) yield row;
        },
    };
    return cursor;
}

function getMulti(domainId: string, docType: number, query?: unknown, projection?: Readonly<Record<string, number>>) {
    const call: QueryCall = {
        domainId,
        docType,
        docIds: readDocIds(query),
        projection: projection ? { ...projection } : null,
    };
    queries.push(call);
    return makeCursor(call);
}

const documentPath = require.resolve('../src/model/document.ts');
const loggerPath = require.resolve('../src/logger.ts');
const modulePath = path.join(__dirname, '../src/lib/container-problem-kinds.ts');
const previousDocument = require.cache[documentPath];
const previousLogger = require.cache[loggerPath];

require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        __esModule: true,
        TYPE_PROBLEM,
        getMulti,
    },
} as NodeModule;
require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
        __esModule: true,
        Logger: RecordingLogger,
        logger: loggerSingleton,
    },
} as NodeModule;

function isKindGuard(parent: NodeModule | null | undefined): boolean {
    return Boolean(parent?.filename?.includes('container-problem-kinds'));
}

function installLoggerHook() {
    moduleLoader._load = function load(request, parent, isMain) {
        const loaded = originalLoad.call(this, request, parent, isMain);
        if (!isKindGuard(parent)) return loaded;
        if (request !== '@hydrooj/utils' && request !== '@hydrooj/utils/lib/utils') return loaded;
        return new Proxy(loaded as object, {
            get(target, key, receiver) {
                if (key === 'Logger') return RecordingLogger;
                if (key === 'logger') return loggerSingleton;
                return Reflect.get(target, key, receiver);
            },
        });
    };
}

after(() => {
    moduleLoader._load = originalLoad;
    if (previousDocument) require.cache[documentPath] = previousDocument;
    else delete require.cache[documentPath];
    if (previousLogger) require.cache[loggerPath] = previousLogger;
    else delete require.cache[loggerPath];
});

function guard(): AssertContainerProblemKinds {
    if (!assertContainerProblemKinds) {
        installLoggerHook();
        try {
            const loaded = require(modulePath) as ContainerProblemKindsModule;
            assertContainerProblemKinds = loaded.assertContainerProblemKinds;
        } finally {
            moduleLoader._load = originalLoad;
        }
    }
    if (typeof assertContainerProblemKinds !== 'function') {
        throw new TypeError('missing export assertContainerProblemKinds');
    }
    return assertContainerProblemKinds;
}

function rejectionText(pid: string, label: string): string {
    return `${KIND_SENTENCE}${pid}（${label}）`;
}

function validationOf(error: unknown): InstanceType<typeof ValidationError> {
    expect(error).to.be.instanceOf(ValidationError);
    if (!(error instanceof ValidationError)) throw new Error('expected ValidationError');
    return error;
}

async function capture(work: Promise<void>): Promise<unknown> {
    try {
        await work;
        return undefined;
    } catch (error) {
        return error;
    }
}

function warnTokens(): string[] {
    const raw: string[] = [];
    const visit = (value: unknown) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            raw.push(String(value));
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            for (const item of Object.values(value)) visit(item);
        }
    };
    for (const args of warnCalls) visit(args);
    return raw.flatMap((part) => part.split(/[^\p{L}\p{N}_]+/u)).filter((part) => part.length > 0);
}

function expectWarned(domainId: string, type: TeachType, docIds: number[]) {
    expect(warnCalls.length).to.equal(1);
    const tokens = warnTokens();
    expect(tokens.includes(domainId)).to.equal(true);
    expect(tokens.includes(type)).to.equal(true);
    for (const docId of docIds) expect(tokens.includes(String(docId))).to.equal(true);
}

beforeEach(() => {
    queries.length = 0;
    warnCalls.length = 0;
    problems = [];
});

describe('container problem kind guard', () => {
    it('rejects a newly added single-choice problem in an acm set', async () => {
        problems = [
            { docId: 1, pid: 'P1', title: 'already kept', problemKind: 'programming' },
            { docId: 2, pid: 'P2', title: 'choice', problemKind: 'single' },
        ];
        const error = validationOf(await capture(guard()('system', 'acm', [1, 2], [1])));
        expect(error.params[0]).to.equal('pids');
        expect(error.params[1]).to.equal(null);
        expect(error.params[2]).to.equal(rejectionText('P2', '单选题'));
        expect(queries.length).to.equal(1);
        expect(queries[0].domainId).to.equal('system');
        expect(queries[0].docType).to.equal(TYPE_PROBLEM);
        expect(queries[0].docIds).to.deep.equal([2]);
        expectWarned('system', 'acm', [2]);
    });

    it('allows a newly added problem whose problemKind is missing', async () => {
        problems = [
            { docId: 1, pid: 'P1', title: 'essay', problemKind: 'subjective' },
            { docId: 2, pid: 'P2', title: 'legacy' },
        ];
        await guard()('system', 'acm', [1, 2], [1]);
        expect(queries.length).to.equal(1);
        expect(queries[0].docIds).to.deep.equal([2]);
    });

    it('does not query when the only problem is already in the container', async () => {
        problems = [{ docId: 1, pid: 'P1', title: 'essay', problemKind: 'subjective' }];
        await guard()('system', 'acm', [1], [1]);
        expect(queries.length).to.equal(0);
    });

    it('rejects subjective problems in practice and allows true or false', async () => {
        const check = guard();
        problems = [{ docId: 3, pid: 'P3', title: 'essay', problemKind: 'subjective' }];
        const error = validationOf(await capture(check('system', 'practice', [3], [])));
        expect(error.params[0]).to.equal('pids');
        expect(error.params[2]).to.equal(rejectionText('P3', '主观题'));
        expectWarned('system', 'practice', [3]);

        queries.length = 0;
        warnCalls.length = 0;
        problems = [{ docId: 4, pid: 'P4', title: 'judge', problemKind: 'true_false' }];
        await check('system', 'practice', [4]);
        expect(queries.length).to.equal(1);
        expect(queries[0].docIds).to.deep.equal([4]);
    });

    it('returns without a query when no problem is newly added', async () => {
        const check = guard();
        await check('school-a', 'exam', []);
        await check('school-a', 'oi', [5, 5], [5, 5]);
        expect(queries.length).to.equal(0);
    });

    it('checks a repeated new problem only once', async () => {
        problems = [{ docId: 2, pid: 'P2', title: 'choice', problemKind: 'single' }];
        const error = validationOf(await capture(guard()('system', 'acm', [2, 2, 1], [1])));
        expect(error.params[2]).to.equal(rejectionText('P2', '单选题'));
        expect(queries.length).to.equal(1);
        expect(queries[0].docIds).to.deep.equal([2]);
        expectWarned('system', 'acm', [2]);
    });

    it('ignores a docId the problem read does not return', async () => {
        await guard()('domain-x', 'acm', [9], []);
        expect(queries.length).to.equal(1);
        expect(queries[0].domainId).to.equal('domain-x');
        expect(queries[0].docType).to.equal(TYPE_PROBLEM);
        expect(queries[0].docIds).to.deep.equal([9]);
    });

    it('lists every rejected problem with its chinese kind name', async () => {
        problems = [
            { docId: 2, pid: 'P2', title: 'one', problemKind: 'single' },
            { docId: 3, pid: 'P3', title: 'many', problemKind: 'multi' },
            { docId: 4, pid: 'P4', title: 'code', problemKind: 'programming' },
        ];
        const error = validationOf(await capture(guard()('system', 'acm', [4, 2, 3], [])));
        const message = String(error.params[2]);
        expect(message.startsWith(KIND_SENTENCE)).to.equal(true);
        const parts = message.slice(KIND_SENTENCE.length).split('、');
        expect(parts.length).to.equal(2);
        expect(parts.includes('P2（单选题）')).to.equal(true);
        expect(parts.includes('P3（多选题）')).to.equal(true);
        expectWarned('system', 'acm', [2, 3]);
    });

    it('follows the teach kind table for oi, homework and exam', async () => {
        const check = guard();
        problems = [{ docId: 6, pid: 'P6', title: 'choice', problemKind: 'single' }];
        const rejected = validationOf(await capture(check('system', 'oi', [6], [])));
        expect(rejected.params[2]).to.equal(rejectionText('P6', '单选题'));
        expectWarned('system', 'oi', [6]);

        warnCalls.length = 0;
        problems = [{ docId: 8, pid: 'P8', title: 'essay', problemKind: 'subjective' }];
        await check('system', 'homework', [8], []);
        await check('system', 'exam', [8], []);
        problems = [{ docId: 6, pid: 'P6', title: 'fn', problemKind: 'function' }];
        await check('system', 'oi', [6], []);
        await check('system', 'acm', [6], []);
    });

    it('names a rejected blank problem and a rejected true or false problem in chinese', async () => {
        const check = guard();
        problems = [{ docId: 7, pid: 'P7', title: 'fill', problemKind: 'blank' }];
        const blank = validationOf(await capture(check('system', 'acm', [7], [])));
        expect(blank.params[0]).to.equal('pids');
        expect(blank.params[1]).to.equal(null);
        expect(blank.params[2]).to.equal(rejectionText('P7', '填空题'));

        queries.length = 0;
        warnCalls.length = 0;
        problems = [{ docId: 5, pid: 'P5', title: 'judge', problemKind: 'true_false' }];
        const judged = validationOf(await capture(check('system', 'oi', [5], [])));
        expect(judged.params[2]).to.equal(rejectionText('P5', '判断题'));
    });

    it('lists rejected problems in the order they were newly added', async () => {
        problems = [
            { docId: 3, pid: 'P3', title: 'many', problemKind: 'multi' },
            { docId: 2, pid: 'P2', title: 'one', problemKind: 'single' },
            { docId: 4, pid: 'P4', title: 'code', problemKind: 'programming' },
        ];
        const error = validationOf(await capture(guard()('system', 'acm', [4, 2, 3, 2], [4])));
        expect(String(error.params[2])).to.equal(`${KIND_SENTENCE}P2（单选题）、P3（多选题）`);
        expect(queries.length).to.equal(1);
        expect(queries[0].docIds).to.deep.equal([2, 3]);
    });

    it('asks the problem read for docId, problemKind, pid and title', async () => {
        problems = [{ docId: 7, pid: 'P7', title: 'fill', problemKind: 'blank' }];
        await capture(guard()('system', 'acm', [7], []));
        expect(queries.length).to.equal(1);
        expect(queries[0].projection).to.deep.equal({
            docId: 1,
            problemKind: 1,
            pid: 1,
            title: 1,
        });
    });

    it('warns the rejected docIds and not an allowed problem from the same save', async () => {
        problems = [
            { docId: 4, pid: 'P4', title: 'code', problemKind: 'programming' },
            { docId: 2, pid: 'P2', title: 'one', problemKind: 'single' },
            { docId: 3, pid: 'P3', title: 'many', problemKind: 'multi' },
        ];
        const error = validationOf(await capture(guard()('system', 'acm', [4, 2, 3], [])));
        expect(String(error.params[2]).includes('P4')).to.equal(false);
        expectWarned('system', 'acm', [2, 3]);
        expect(warnTokens().includes('4')).to.equal(false);
    });
});
