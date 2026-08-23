import { expect } from 'chai';
import { localizedErrorText } from '@hydrooj/framework';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const PERM = {
    PERM_EDIT_COURSE: 1n,
    PERM_EDIT_TRAINING: 2n,
    PERM_EDIT_TRAINING_SELF: 4n,
    PERM_VIEW_TRAINING: 8n,
    PERM_VIEW_PROBLEM: 16n,
};
const PRIV = { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 };

class TestPermissionError extends Error {
    name = 'PermissionError';

    constructor(public readonly required?: unknown) {
        super('permission denied');
    }
}

class TestValidationError extends Error {
    name = 'ValidationError';

    constructor(...args: any[]) {
        super(String(args.at(-1) || 'validation failed'));
    }
}

class TestConflictError extends Error {
    name = 'PracticeIntegrityConflictError';

    constructor(public readonly reason: string) {
        super(reason);
    }
}

const calls = {
    getContainer: [] as any[],
    getPolicyState: [] as any[],
    latest: [] as any[],
    save: [] as any[],
    publish: [] as any[],
    issue: [] as any[],
    oplog: [] as any[],
    problemViews: [] as any[],
    trainingHooks: [] as any[],
    logs: [] as any[],
};

const containerId = new ObjectId('66b700000000000000000010');
const revisionId = new ObjectId('66b700000000000000000011');
let currentContainer: any;
let currentPolicyState: any;
let latestRevision: any;
let groupIds: ObjectId[] = [];
let problemVisible = true;
let problemAuthor = false;
let problemMaintainer = false;
let trainingHookError: Error | null = null;
let saveError: Error | null = null;
let publishError: Error | null = null;

const trainingStub = {
    async get(domainId: string, id: ObjectId) {
        calls.getContainer.push([domainId, id]);
        return currentContainer;
    },
    getPids(dag: any[] = []) {
        return Array.from(new Set(dag.flatMap((node) => node.pids || [])));
    },
    isDone(node: any, doneNids: Set<number>, donePids: Set<number>) {
        return (node.requireNids || []).every((nid: number) => doneNids.has(nid)) && (node.pids || []).every((pid: number) => donePids.has(pid));
    },
    buildScopedTrainingProgress() {
        return { doneNids: [] };
    },
};

const problemStub = {
    canAuthorProblem() {
        return problemAuthor;
    },
    canMaintainProblem() {
        return problemMaintainer;
    },
    async getViewableAuthorized(domainId: string, pid: number, user: any, projection: string[]) {
        calls.problemViews.push({ domainId, pid, user, projection });
        return problemVisible ? { domainId, docId: pid } : null;
    },
    async getListStatus() {
        return {};
    },
};

const practiceIntegrityService = {
    async getPolicyState(...args: any[]) {
        calls.getPolicyState.push(args);
        return currentPolicyState;
    },
    async getLatestPublished(...args: any[]) {
        calls.latest.push(args);
        return latestRevision;
    },
    async saveDraft(input: any) {
        if (saveError) throw saveError;
        calls.save.push(input);
        return {
            _id: revisionId,
            ...input,
            revision: 1,
            state: 'draft',
            draftVersion: input.expectedDraftVersion + 1,
            createdAt: new Date('2026-08-09T08:00:00Z'),
            updatedAt: new Date('2026-08-09T08:00:00Z'),
        };
    },
    async publishDraft(input: any) {
        if (publishError) throw publishError;
        calls.publish.push(input);
        return {
            _id: revisionId,
            ...input,
            policy: latestRevision.policy,
            revision: 1,
            state: 'published',
            createdAt: new Date('2026-08-09T08:00:00Z'),
            updatedAt: new Date('2026-08-09T08:01:00Z'),
            publishedAt: new Date('2026-08-09T08:01:00Z'),
        };
    },
    async issueContext(input: any) {
        calls.issue.push(input);
        return {
            _id: new ObjectId('66b700000000000000000012'),
            ...input,
            policy: input.targets[0].revision.policy,
            revisions: input.targets.map((target: any) => ({
                revisionId: target.revision._id,
                containerKind: target.revision.containerKind,
                containerId: target.revision.containerId,
                scopeKind: target.scopeKind,
                scopeId: target.scopeId,
                revision: target.revision.revision,
            })),
            issuedAt: new Date('2026-08-09T08:00:00Z'),
            expiresAt: new Date('2026-08-09T08:15:00Z'),
        };
    },
};

function rawArgsParamDecorator(name: string) {
    return (target: any, key: string, descriptor: PropertyDescriptor) => {
        target.__testParams ||= {};
        target.__testParams[key] ||= [];
        target.__testParams[key].unshift(name);
        target.__testParamWrapped ||= {};
        if (!target.__testParamWrapped[key]) {
            target.__testParamWrapped[key] = true;
            const original = descriptor.value;
            descriptor.value = function wrapped(rawArgs: Record<string, unknown>, ...extra: unknown[]) {
                if (!rawArgs || typeof rawArgs !== 'object' || extra.length) return original.call(this, rawArgs, ...extra);
                return original.call(this, rawArgs, ...target.__testParams[key].map((field: string) => rawArgs[field]));
            };
        }
        return descriptor;
    };
}

class HandlerStub {}
const routes = new Map<string, any>();
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromHandler = parent?.filename?.endsWith('/packages/hydrooj/src/handler/practice-integrity.ts');
    const fromPracticeAccess = parent?.filename?.endsWith('/packages/hydrooj/src/model/practice-integrity-access.ts');
    const fromPracticeModule = fromHandler || fromPracticeAccess;
    if (fromHandler && request === '@hydrooj/utils') {
        return {
            Logger: class {
                info(...args: any[]) {
                    calls.logs.push(['info', ...args]);
                }

                warn(...args: any[]) {
                    calls.logs.push(['warn', ...args]);
                }
            },
        };
    }
    if (fromPracticeModule && request === '../error') {
        return {
            localizedErrorText,
            PermissionError: TestPermissionError,
            ValidationError: TestValidationError,
        };
    }
    if ((fromHandler && request === '../model/builtin') || (fromPracticeAccess && request === './builtin')) return { PERM, PRIV };
    if (fromHandler && request === '../model/oplog') {
        return {
            async log(...args: any[]) {
                calls.oplog.push(args);
            },
        };
    }
    if (fromHandler && request === '../model/practice-integrity') {
        return {
            PracticeIntegrityConflictError: TestConflictError,
            canonicalPracticePolicy: (value: unknown) => value,
            practiceIntegrityService,
        };
    }
    if ((fromHandler && request === '../model/problem') || (fromPracticeAccess && request === './problem')) return problemStub;
    if ((fromHandler && request === '../model/problem-set-access') || (fromPracticeAccess && request === './problem-set-access')) {
        return {
            canManageProblemSet() {
                return false;
            },
            problemSetAccessService: {
                async assertAccessible() {
                    return { discoverable: true, accessible: true, enrolled: false, sources: [{ kind: 'public' }], stageAccess: 'all' };
                },
                async assertStageEnterable() {
                    return { discoverable: true, accessible: true, enrolled: false, sources: [{ kind: 'public' }], stageAccess: 'all' };
                },
            },
        };
    }
    if ((fromHandler && request === '../model/training') || (fromPracticeAccess && request === './training')) return trainingStub;
    if (fromHandler && request === '../service/server') {
        return {
            Handler: HandlerStub,
            param: rawArgsParamDecorator,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    const handlerPath = require.resolve('../src/handler/practice-integrity.ts');
    delete require.cache[handlerPath];
    const module = require(handlerPath) as typeof import('../src/handler/practice-integrity');
    void module.apply({
        Route(name: string, _path: string, HandlerClass: any) {
            routes.set(name, HandlerClass);
        },
    } as any);
} finally {
    Module._load = originalLoad;
}

function makeUser(overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>([PERM.PERM_VIEW_TRAINING]);
    return {
        _id: 42,
        uname: 'student',
        hasPerm: (...wanted: bigint[]) => wanted.some((permission) => perms.has(permission)),
        hasPriv: (privilege: number) => privilege === PRIV.PRIV_USER_PROFILE,
        own: (doc: any) => doc?.owner === 42,
        ...overrides,
    } as any;
}

function makeHandler(route: string, user = makeUser()) {
    const HandlerClass = routes.get(route);
    const handler = new HandlerClass();
    Object.assign(handler, {
        domain: { _id: 'system' },
        user,
        response: { body: undefined },
        ctx: {
            async parallel(name: string, ...args: any[]) {
                calls.trainingHooks.push([name, ...args]);
                if (trainingHookError) throw trainingHookError;
            },
        },
        checkPriv(privilege: number) {
            if (!user.hasPriv(privilege)) throw new TestPermissionError();
        },
    });
    return handler as any;
}

async function capture(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    groupIds = [];
    problemVisible = true;
    problemAuthor = false;
    problemMaintainer = false;
    trainingHookError = null;
    saveError = null;
    publishError = null;
    (global as any).Hydro.model.userbind = {
        async findStudentByUserId() {
            return { groupIds };
        },
    };
    currentContainer = {
        docId: containerId,
        kind: 'course',
        owner: 7,
        courseGroupIds: [],
        dag: [{ _id: 3, pids: [42] }],
    };
    currentPolicyState = { draft: null, published: null };
    latestRevision = {
        _id: revisionId,
        domainId: 'system',
        containerKind: 'course',
        containerId,
        revision: 1,
        state: 'published',
        policy: {
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: false,
            antiAiCopyInjection: false,
        },
        publishedAt: new Date('2026-08-09T08:00:00Z'),
    };
});

function policySaveArgs(overrides: Record<string, unknown> = {}) {
    return {
        domainId: 'forged-domain',
        containerKind: 'course',
        containerId,
        prohibitExternalCodeInjection: true,
        removeIndependentSubmitForm: false,
        antiAiCopyInjection: false,
        expectedDraftVersion: 0,
        ...overrides,
    };
}

function policyPublishArgs(overrides: Record<string, unknown> = {}) {
    return {
        domainId: 'forged-domain',
        containerKind: 'problemSet',
        containerId,
        expectedDraftVersion: 2,
        ...overrides,
    };
}

function contextIssueArgs(overrides: Record<string, unknown> = {}) {
    return {
        domainId: 'forged-domain',
        containerKind: 'course',
        containerId,
        scopeKind: 'chapter',
        scopeId: 3,
        pid: 42,
        preview: false,
        ...overrides,
    };
}

describe('practice integrity handlers', () => {
    it('denies policy writes before the canonical service is called', async () => {
        const handler = makeHandler('practice_integrity_policy');
        const error = await capture(() => handler.postSave(policySaveArgs()));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect((error as TestPermissionError).required).to.equal(PERM.PERM_EDIT_COURSE);
        expect(calls.save).to.deep.equal([]);

        currentContainer = { ...currentContainer, kind: 'training', owner: 42 };
        const owner = makeHandler('practice_integrity_policy');
        const selfError = await capture(() => owner.postSave(policySaveArgs({ containerKind: 'problemSet' })));
        expect((selfError as TestPermissionError).required).to.equal(PERM.PERM_EDIT_TRAINING_SELF);
    });

    it('saves a course-owner draft with the authoritative domain and exact policy', async () => {
        currentContainer.owner = 42;
        const handler = makeHandler('practice_integrity_policy');
        await handler.postSave(policySaveArgs({ removeIndependentSubmitForm: true }));
        expect(calls.getContainer[0][0]).to.equal('system');
        expect(calls.save).to.deep.equal([
            {
                domainId: 'system',
                containerKind: 'course',
                containerId,
                policy: {
                    prohibitExternalCodeInjection: true,
                    removeIndependentSubmitForm: true,
                    antiAiCopyInjection: false,
                },
                actorUid: 42,
                expectedDraftVersion: 0,
            },
        ]);
        expect(handler.response.body.draft).to.include({ revision: 1, draftVersion: 1 });
        expect(handler.response.body.draft).not.to.have.property('_id');
    });

    it('logs the stable CAS reason before returning a localized draft conflict', async () => {
        currentContainer.owner = 42;
        saveError = new TestConflictError('draft_version_mismatch');
        const handler = makeHandler('practice_integrity_policy');
        expect(await capture(() => handler.postSave(policySaveArgs({ expectedDraftVersion: 1 })))).to.be.instanceOf(TestValidationError);
        expect(calls.logs.at(-1)?.at(-1)).to.equal('draft_version_mismatch');
    });

    it('lets a training manager publish a problem-set policy without treating a course as a problem set', async () => {
        currentContainer = { ...currentContainer, kind: undefined };
        const manager = makeUser({ hasPerm: (permission: bigint) => permission === PERM.PERM_EDIT_TRAINING });
        const handler = makeHandler('practice_integrity_policy', manager);
        await handler.postPublish(policyPublishArgs());
        expect(calls.publish[0]).to.include({ domainId: 'system', containerKind: 'problemSet', actorUid: 42, expectedDraftVersion: 2 });

        currentContainer.kind = 'course';
        const mismatch = await capture(() => handler.postPublish(policyPublishArgs()));
        expect(mismatch).to.be.instanceOf(TestValidationError);
    });

    it('keeps an unconfigured container in ordinary mode without minting a context', async () => {
        latestRevision = null;
        const handler = makeHandler('practice_context');
        await handler.postIssue(contextIssueArgs());
        expect(handler.response.body).to.deep.equal({ controlled: false });
        expect(calls.issue).to.deep.equal([]);
    });

    it('fails closed when a course student is outside the configured groups', async () => {
        currentContainer.courseGroupIds = [new ObjectId('66b700000000000000000020')];
        groupIds = [new ObjectId('66b700000000000000000021')];
        const handler = makeHandler('practice_context');
        const error = await capture(() => handler.postIssue(contextIssueArgs()));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.issue).to.deep.equal([]);
    });

    it('fails closed for unknown container kinds and invisible referenced problems', async () => {
        const handler = makeHandler('practice_context');
        currentContainer.kind = 'future-container';
        expect(await capture(() => handler.postIssue(contextIssueArgs({ containerKind: 'problemSet', scopeKind: 'stage' })))).to.be.instanceOf(
            TestValidationError,
        );

        currentContainer.kind = 'course';
        problemVisible = false;
        const hidden = await capture(() => handler.postIssue(contextIssueArgs()));
        expect(hidden).to.be.instanceOf(TestPermissionError);
        expect(calls.issue).to.deep.equal([]);
        expect(calls.problemViews.at(-1)).to.include({ domainId: 'system', pid: 42 });
    });

    it('runs the canonical training extension gate before issuing a problem-set context', async () => {
        currentContainer.kind = 'training';
        trainingHookError = new TestPermissionError();
        const handler = makeHandler('practice_context');
        expect(await capture(() => handler.postIssue(contextIssueArgs({ containerKind: 'problemSet', scopeKind: 'stage' })))).to.equal(
            trainingHookError,
        );
        expect(calls.trainingHooks[0][0]).to.equal('training/get');
        expect(calls.problemViews).to.deep.equal([]);
        expect(calls.issue).to.deep.equal([]);
    });

    it('logs stable distinct reason codes without request content', async () => {
        const handler = makeHandler('practice_context');
        await capture(() => handler.postIssue(contextIssueArgs({ scopeKind: 'stage' })));
        await capture(() => handler.postIssue(contextIssueArgs({ pid: 43 })));
        problemVisible = false;
        await capture(() => handler.postIssue(contextIssueArgs()));
        const rejectionLogs = calls.logs.filter(([level]) => level === 'warn');
        expect(rejectionLogs.map((entry) => entry.at(-1))).to.deep.equal(['scope-container-mismatch', 'pid-outside-scope', 'problem-view-denied']);
        expect(JSON.stringify(rejectionLogs)).not.to.include('hidden prompt');
    });

    it('issues a student context only for an exact visible scope and pid', async () => {
        const groupId = new ObjectId('66b700000000000000000020');
        currentContainer.courseGroupIds = [groupId];
        groupIds = [groupId];
        const handler = makeHandler('practice_context');
        await handler.postIssue(contextIssueArgs());
        expect(calls.issue[0]).to.include({
            domainId: 'system',
            uid: 42,
            containerKind: 'course',
            containerId,
            scopeKind: 'chapter',
            scopeId: 3,
            pid: 42,
            mode: 'student',
        });
        expect(handler.response.body).to.deep.include({
            controlled: true,
            contextId: '66b700000000000000000012',
            expiresAt: '2026-08-09T08:15:00.000Z',
        });
        expect(handler.response.body.revisions).to.deep.equal([
            { containerKind: 'course', containerId: String(containerId), scopeKind: 'chapter', scopeId: 3, revision: 1 },
        ]);

        const wrongPid = await capture(() => handler.postIssue(contextIssueArgs({ pid: 43 })));
        expect(wrongPid).to.be.instanceOf(TestValidationError);
    });

    it('allows container managers and problem collaborators to mint an explicit student preview', async () => {
        const student = makeHandler('practice_context');
        expect(await capture(() => student.postIssue(contextIssueArgs({ preview: true })))).to.be.instanceOf(TestPermissionError);

        const admin = makeUser({ hasPriv: () => true });
        const preview = makeHandler('practice_context', admin);
        await preview.postIssue(contextIssueArgs({ preview: true }));
        expect(calls.issue.at(-1)?.mode).to.equal('preview');

        problemAuthor = true;
        await makeHandler('practice_context').postIssue(contextIssueArgs({ preview: true }));
        expect(calls.issue.at(-1)?.mode).to.equal('preview');

        problemAuthor = false;
        const verifier = makeUser({ _permitPids: new Set([42]) });
        await makeHandler('practice_context', verifier).postIssue(contextIssueArgs({ preview: true }));
        expect(calls.issue.at(-1)?.mode).to.equal('preview');
    });
});
