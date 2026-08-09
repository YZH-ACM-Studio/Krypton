import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import type { RecordDoc } from '../src/interface';
import type { ContextualCompletionDoc } from '../src/model/contextual-completion';
import type { TrustedPracticeContextReference } from '../src/model/practice-integrity';

(global as any).Hydro = { model: {} };
const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => ({}) } },
} as NodeModule;
const { STATUS } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');
const { ContextualCompletionService } = require('../src/model/contextual-completion.ts') as typeof import('../src/model/contextual-completion');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

class MemoryCompletionCollection {
    docs: ContextualCompletionDoc[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];
    attempts: Record<string, unknown>[] = [];
    updateError: unknown = null;
    updateFailure: ((filter: Record<string, unknown>) => unknown) | null = null;

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async updateOne(filter: Record<string, unknown>, update: { $setOnInsert: ContextualCompletionDoc }, options: { upsert: boolean }) {
        this.attempts.push(filter);
        const targetedFailure = this.updateFailure?.(filter);
        if (targetedFailure) throw targetedFailure;
        if (this.updateError) throw this.updateError;
        const existing = this.docs.find((doc) => this.matches(doc, filter));
        if (existing) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        this.docs.push({ ...update.$setOnInsert });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: update.$setOnInsert._id };
    }

    find(filter: Record<string, unknown>) {
        const docs = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            project: (_projection: Record<string, number>) => ({
                toArray: async () => docs,
            }),
        };
    }

    async deleteMany(filter: Record<string, unknown>) {
        const before = this.docs.length;
        this.docs = this.docs.filter((doc) => !this.matches(doc, filter));
        return { deletedCount: before - this.docs.length };
    }

    private matches(doc: ContextualCompletionDoc, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => {
            const actual = doc[field as keyof ContextualCompletionDoc];
            if (expected && typeof expected === 'object' && '$in' in expected) {
                return (expected as { $in: unknown[] }).$in.some((candidate) => sameValue(actual, candidate));
            }
            return sameValue(actual, expected);
        });
    }
}

const courseId = new ObjectId('66b800000000000000000001');
const problemSetId = new ObjectId('66b800000000000000000002');
const courseRevisionId = new ObjectId('66b800000000000000000003');
const problemSetRevisionId = new ObjectId('66b800000000000000000004');

function trustedContext(overrides: Partial<TrustedPracticeContextReference> = {}): TrustedPracticeContextReference {
    return {
        contextId: new ObjectId(),
        domainId: 'system',
        uid: 42,
        pid: 1001,
        mode: 'student',
        containerKind: 'course',
        containerId: courseId,
        scopeKind: 'chapter',
        scopeId: 2,
        targets: [
            {
                revisionId: courseRevisionId,
                containerKind: 'course',
                containerId: courseId,
                scopeKind: 'chapter',
                scopeId: 2,
                revision: 1,
            },
            {
                revisionId: problemSetRevisionId,
                containerKind: 'problemSet',
                containerId: problemSetId,
                scopeKind: 'stage',
                scopeId: 7,
                revision: 3,
            },
        ],
        ...overrides,
    };
}

function recordDoc(overrides: Partial<RecordDoc> = {}): RecordDoc {
    return {
        _id: new ObjectId(),
        domainId: 'system',
        uid: 42,
        pid: 1001,
        lang: 'cc.cc20o2',
        code: 'int main(){}',
        status: STATUS.STATUS_ACCEPTED,
        score: 100,
        time: 1,
        memory: 1,
        judgeTexts: [],
        compilerTexts: [],
        testCases: [],
        judger: 1,
        judgeAt: new Date(),
        rejudged: false,
        practiceContext: trustedContext(),
        ...overrides,
    } as RecordDoc;
}

function makeService() {
    const completions = new MemoryCompletionCollection();
    const logs: Array<{ level: 'info' | 'error'; format: string; args: unknown[] }> = [];
    const service = new ContextualCompletionService({
        completions: completions as never,
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        logger: {
            info(format: string, ...args: unknown[]) {
                logs.push({ level: 'info', format, args });
            },
            error(format: string, ...args: unknown[]) {
                logs.push({ level: 'error', format, args });
            },
        },
    });
    return { service, completions, logs };
}

async function capture(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('contextual completion model', () => {
    it('creates exact idempotency, progress, record, and context indexes', async () => {
        const { service, completions } = makeService();
        await service.ensureIndexes();
        expect(completions.indexes).to.deep.equal([
            {
                key: { domainId: 1, uid: 1, containerKind: 1, containerId: 1, scopeKind: 1, scopeId: 1, pid: 1, revisionId: 1 },
                options: { name: 'contextualCompletionIdentity', unique: true },
            },
            {
                key: { domainId: 1, uid: 1, containerKind: 1, containerId: 1, scopeKind: 1, scopeId: 1, pid: 1 },
                options: { name: 'contextualCompletionProgress' },
            },
            { key: { domainId: 1, rid: 1 }, options: { name: 'contextualCompletionRecord' } },
            { key: { domainId: 1, contextId: 1 }, options: { name: 'contextualCompletionContext' } },
        ]);
    });

    it('writes the explicit course and referenced problem-set targets, while a direct problem set only completes itself', async () => {
        const { service, completions } = makeService();
        await service.recordJudge(recordDoc());
        expect(completions.docs).to.have.length(2);
        expect(completions.docs.map((doc) => [doc.containerKind, doc.scopeKind, doc.scopeId, doc.pid])).to.deep.equal([
            ['course', 'chapter', 2, 1001],
            ['problemSet', 'stage', 7, 1001],
        ]);

        const direct = trustedContext({
            pid: 1002,
            containerKind: 'problemSet',
            containerId: problemSetId,
            scopeKind: 'stage',
            scopeId: 8,
            targets: [
                {
                    revisionId: problemSetRevisionId,
                    containerKind: 'problemSet',
                    containerId: problemSetId,
                    scopeKind: 'stage',
                    scopeId: 8,
                    revision: 3,
                },
            ],
        });
        await service.recordJudge(recordDoc({ practiceContext: direct, pid: 1002 }));
        expect(completions.docs.filter((doc) => doc.pid === 1002).map((doc) => doc.containerKind)).to.deep.equal(['problemSet']);

        const forgedDirect = trustedContext({
            containerKind: 'problemSet',
            containerId: problemSetId,
            scopeKind: 'stage',
            scopeId: 7,
        });
        expect(await capture(() => service.recordJudge(recordDoc({ practiceContext: forgedDirect })))).to.be.instanceOf(Error);
    });

    it('settles every explicit target before surfacing write failures and can idempotently fill a missing target', async () => {
        const { service, completions } = makeService();
        const courseFailure = new Error('course write failed');
        completions.updateFailure = (filter) => (filter.containerKind === 'course' ? courseFailure : null);

        expect(await capture(() => service.recordJudge(recordDoc()))).to.equal(courseFailure);
        expect(completions.attempts.map((filter) => filter.containerKind)).to.deep.equal(['course', 'problemSet']);
        expect(completions.docs.map((doc) => doc.containerKind)).to.deep.equal(['problemSet']);

        completions.updateFailure = null;
        await service.recordJudge(recordDoc());
        expect(completions.docs.map((doc) => doc.containerKind).sort()).to.deep.equal(['course', 'problemSet']);
    });

    it('aggregates distinct failures after attempting every contextual target', async () => {
        const { service, completions } = makeService();
        const failures = {
            course: new Error('course unavailable'),
            problemSet: new Error('problem set unavailable'),
        };
        completions.updateFailure = (filter) => failures[filter.containerKind as keyof typeof failures];

        const error = await capture(() => service.recordJudge(recordDoc()));

        expect(error).to.be.instanceOf(AggregateError);
        expect((error as AggregateError).errors).to.deep.equal([failures.course, failures.problemSet]);
        expect(completions.attempts.map((filter) => filter.containerKind)).to.deep.equal(['course', 'problemSet']);
        expect(completions.docs).to.deep.equal([]);
    });

    it('is idempotent for concurrent callbacks and rejudge, but preserves a later policy revision as a separate fact', async () => {
        const { service, completions } = makeService();
        const first = recordDoc();
        await Promise.all([service.recordJudge(first), service.recordJudge(first), service.recordJudge({ ...first, rejudged: true })]);
        expect(completions.docs).to.have.length(2);

        const nextRevision = new ObjectId('66b800000000000000000005');
        const nextContext = trustedContext({
            targets: trustedContext().targets.map((target) =>
                target.containerKind === 'course' ? { ...target, revisionId: nextRevision, revision: 2 } : target,
            ),
        });
        await service.recordJudge(recordDoc({ practiceContext: nextContext }));
        expect(completions.docs.filter((doc) => doc.containerKind === 'course')).to.have.length(2);
        const progress = await service.getCompletedByScope('system', 42, 'course', courseId);
        expect([...progress.get(2)!]).to.deep.equal([1001]);
        expect(await service.getCompletedCounts('system', [42], 'course', courseId)).to.deep.equal(new Map([[42, 1]]));
        expect(await service.getCompletedCounts('system', [42], 'course', courseId, new Map([[2, new Set([9999])]]))).to.deep.equal(new Map());
    });

    it('classifies only an exact identity duplicate as an idempotent concurrent completion', async () => {
        const { service, completions, logs } = makeService();
        const direct = trustedContext({
            containerKind: 'problemSet',
            containerId: problemSetId,
            scopeKind: 'stage',
            scopeId: 7,
            targets: [trustedContext().targets[1]],
        });
        const duplicate = Object.assign(new Error('duplicate'), {
            code: 11000,
            keyPattern: {
                domainId: 1,
                uid: 1,
                containerKind: 1,
                containerId: 1,
                scopeKind: 1,
                scopeId: 1,
                pid: 1,
                revisionId: 1,
            },
            keyValue: {
                domainId: 'system',
                uid: 42,
                containerKind: 'problemSet',
                containerId: problemSetId,
                scopeKind: 'stage',
                scopeId: 7,
                pid: 1001,
                revisionId: problemSetRevisionId,
            },
        });
        completions.updateError = duplicate;
        expect(await capture(() => service.recordJudge(recordDoc({ practiceContext: direct })))).to.equal(null);
        expect(logs.some((entry) => entry.level === 'info' && entry.format.includes('result=duplicate'))).to.equal(true);

        duplicate.keyValue = { ...duplicate.keyValue, uid: 43 };
        expect(await capture(() => service.recordJudge(recordDoc({ practiceContext: direct })))).to.equal(duplicate);
    });

    it('keeps the same problem independent across courses and users', async () => {
        const { service, completions } = makeService();
        const secondCourseId = new ObjectId('66b800000000000000000006');
        const secondContext = trustedContext({
            containerId: secondCourseId,
            scopeId: 9,
            targets: [
                {
                    revisionId: new ObjectId('66b800000000000000000007'),
                    containerKind: 'course',
                    containerId: secondCourseId,
                    scopeKind: 'chapter',
                    scopeId: 9,
                    revision: 1,
                },
            ],
        });
        await Promise.all([
            service.recordJudge(recordDoc()),
            service.recordJudge(recordDoc({ practiceContext: secondContext })),
            service.recordJudge(recordDoc({ uid: 43, practiceContext: trustedContext({ uid: 43 }) })),
        ]);
        expect(completions.docs.filter((doc) => doc.containerKind === 'course' && doc.pid === 1001)).to.have.length(3);
    });

    it('does not create completion for ordinary, Contest/VP, preview, pretest, canceled, or non-AC results', async () => {
        const { service, completions } = makeService();
        await service.recordJudge(recordDoc({ practiceContext: undefined }));
        await service.recordJudge(recordDoc({ practiceContext: undefined, contest: new ObjectId() }));
        await service.recordJudge(recordDoc({ practiceContext: trustedContext({ mode: 'preview' }) }));
        await service.recordJudge(recordDoc({ contest: new ObjectId('000000000000000000000000') }));
        await service.recordJudge(recordDoc({ status: STATUS.STATUS_CANCELED }));
        await service.recordJudge(recordDoc({ status: STATUS.STATUS_WRONG_ANSWER }));
        expect(completions.docs).to.have.length(0);
    });

    it('logs every target and revision for skipped and rejected contextual callbacks', async () => {
        const { service, completions, logs } = makeService();
        await service.recordJudge(recordDoc({ contest: new ObjectId('000000000000000000000000') }));
        await service.recordJudge(recordDoc({ practiceContext: trustedContext({ mode: 'preview' }) }));
        await service.recordJudge(recordDoc({ status: STATUS.STATUS_CANCELED }));
        await service.recordJudge(recordDoc({ status: STATUS.STATUS_WRONG_ANSWER }));
        expect(await capture(() => service.recordJudge(recordDoc({ contest: new ObjectId() })))).to.be.instanceOf(Error);
        expect(await capture(() => service.recordJudge(recordDoc({ uid: 43 })))).to.be.instanceOf(Error);

        const targetLogs = logs.filter((entry) => entry.format.includes('container=%s/%s scope=%s/%d pid=%d revision=%d'));
        for (const result of ['pretest', 'preview', 'not-accepted', 'unexpected-contest']) {
            const matching = targetLogs.filter((entry) => entry.format.includes(`result=${result}`));
            expect(matching.length).to.be.greaterThanOrEqual(result === 'not-accepted' ? 4 : 2);
            expect(new Set(matching.map((entry) => entry.args[4]))).to.deep.equal(new Set(['course', 'problemSet']));
        }
        const validationLog = logs.find((entry) => entry.format.includes('stage=context-validation result=failed'));
        expect(validationLog?.format).to.include('domain=%s rid=%s contextId=%s uid=%o pid=%o');
        expect(completions.docs).to.deep.equal([]);
    });

    it('surfaces corrupt trusted state and impossible contest combinations', async () => {
        const { service, completions, logs } = makeService();
        const malformed = trustedContext({ targets: [] });
        expect(await capture(() => service.recordJudge(recordDoc({ practiceContext: malformed })))).to.be.instanceOf(Error);
        expect(await capture(() => service.recordJudge(recordDoc({ contest: new ObjectId() })))).to.be.instanceOf(Error);
        expect(await capture(() => service.recordJudge(recordDoc({ status: 9999 })))).to.be.instanceOf(Error);
        for (const status of ['STATUS_ACCEPTED', '1', Number.NaN]) {
            expect(await capture(() => service.recordJudge(recordDoc({ status: status as never })))).to.be.instanceOf(Error);
        }
        const unknownLog = logs.find((entry) => entry.level === 'error' && entry.format.includes('unknown-status'));
        expect(unknownLog?.format).to.include('container=%s/%s scope=%s/%d');
        expect(unknownLog?.format).to.include('revision=%d');

        completions.updateError = new Error('mongo unavailable');
        expect(await capture(() => service.recordJudge(recordDoc()))).to.equal(completions.updateError);
        const writeLog = logs.find((entry) => entry.level === 'error' && entry.format.includes('stage=completion-write result=failed'));
        expect(writeLog?.format).to.include('rid=%s contextId=%s');
        expect(writeLog?.format).to.include('container=%s/%s scope=%s/%d pid=%d revision=%d stage=completion-write');
    });

    it('rejects a trusted snapshot attached to a different domain, user, or problem', async () => {
        const { service, completions } = makeService();
        for (const mismatch of [{ domainId: 'other' }, { uid: 43 }, { pid: 1002 }]) {
            expect(await capture(() => service.recordJudge(recordDoc(mismatch)))).to.be.instanceOf(Error);
        }
        expect(completions.docs).to.deep.equal([]);
    });
});
