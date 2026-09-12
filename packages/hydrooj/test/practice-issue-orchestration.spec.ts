import { expect } from 'chai';
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
}

class TestValidationError extends Error {
    name = 'ValidationError';
}

const calls = {
    latest: [] as any[],
    issue: [] as any[],
    reasons: [] as string[],
};

const courseId = new ObjectId('66b700000000000000000010');
const setId = new ObjectId('66b700000000000000000030');
const courseRevisionId = new ObjectId('66b700000000000000000011');
const setRevisionId = new ObjectId('66b700000000000000000031');
const contextId = new ObjectId('66b700000000000000000012');

const containers: Record<string, any> = {};
let coursePublished: any;
let setPublished: any;

const policy = {
    prohibitExternalCodeInjection: true,
    removeIndependentSubmitForm: false,
    antiAiCopyInjection: false,
};

function publishedRevision(overrides: Record<string, unknown> = {}) {
    return {
        _id: courseRevisionId,
        domainId: 'system',
        containerKind: 'course',
        containerId: courseId,
        revision: 1,
        state: 'published',
        policy,
        publishedAt: new Date('2026-08-09T08:00:00Z'),
        ...overrides,
    };
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromAccess = parent?.filename?.includes('practice-integrity-access');
    const fromLiveRef = parent?.filename?.includes('course-live-ref');
    if (fromAccess && request === './builtin') return { PERM, PRIV, STATUS: { STATUS_ACCEPTED: 1 } };
    if ((fromAccess && request === '../error') || (fromLiveRef && request === '../error')) {
        return {
            localizedErrorText: (value: unknown) => value,
            PermissionError: TestPermissionError,
            TrainingNotFoundError: class TrainingNotFoundError extends Error {},
            ValidationError: TestValidationError,
        };
    }
    if (fromAccess && request === './practice-integrity') {
        return {
            canonicalPracticePolicy: (value: unknown) => value,
            practiceIntegrityService: {
                async getLatestPublished(...args: any[]) {
                    calls.latest.push(args);
                    if (args[1] === 'problemSet') return setPublished;
                    return coursePublished;
                },
                async issueContext(input: any) {
                    calls.issue.push(input);
                    return {
                        _id: contextId,
                        domainId: input.domainId,
                        uid: input.uid,
                        containerKind: input.containerKind,
                        containerId: input.containerId,
                        scopeKind: input.scopeKind,
                        scopeId: input.scopeId,
                        pid: input.pid,
                        mode: input.mode,
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
            },
        };
    }
    if (fromAccess && request === './problem-set-access') {
        return {
            problemSetAccessService: {
                async assertAccessible() {
                    return { discoverable: true, accessible: true, enrolled: false, sources: [{ kind: 'public' }], stageAccess: 'all' };
                },
                async assertStageEnterable() {
                    return { discoverable: true, accessible: true, enrolled: false, sources: [{ kind: 'public' }], stageAccess: 'all' };
                },
                async hasActiveEntitlement() {
                    return false;
                },
            },
        };
    }
    if (fromAccess && request === './problem') {
        return {
            canAuthorProblem() {
                return false;
            },
            canMaintainProblem() {
                return false;
            },
            async getViewableAuthorized() {
                return { domainId: 'system', docId: 42 };
            },
            async getListStatus() {
                return {};
            },
        };
    }
    if ((fromAccess && request === './training') || (fromLiveRef && request === '../model/training')) {
        return {
            async get(_domainId: string, id: ObjectId) {
                return containers[String(id)] || null;
            },
            getPids(dag: any[] = []) {
                return Array.from(new Set(dag.flatMap((node: any) => node.pids || [])));
            },
            isDone(node: any, doneNids: Set<number>, donePids: Set<number>) {
                return (node.requireNids || []).every((nid: number) => doneNids.has(nid)) && (node.pids || []).every((pid: number) => donePids.has(pid));
            },
            buildScopedTrainingProgress() {
                return { doneNids: [] };
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let issuePracticeContext: typeof import('../src/model/practice-integrity-access').issuePracticeContext;
try {
    const accessPath = require.resolve('../src/model/practice-integrity-access.ts');
    const liveRefPath = require.resolve('../src/lib/course-live-ref.ts');
    delete require.cache[accessPath];
    delete require.cache[liveRefPath];
    ({ issuePracticeContext } = require('../src/model/practice-integrity-access.ts'));
} finally {
    Module._load = originalLoad;
}

function makeUser() {
    const perms = new Set<bigint>([PERM.PERM_VIEW_TRAINING]);
    return {
        _id: 42,
        hasPriv: (privilege: number) => privilege === PRIV.PRIV_USER_PROFILE,
        hasPerm: (...wanted: bigint[]) => wanted.some((permission) => perms.has(permission)),
        own: () => false,
    } as any;
}

function makeHandler() {
    return {
        ctx: {
            async parallel() {
                return undefined;
            },
        },
    };
}

function courseTarget() {
    return { containerKind: 'course' as const, containerId: courseId, scopeKind: 'chapter' as const, scopeId: 3 };
}

async function issue(overrides: Record<string, unknown> = {}) {
    return issuePracticeContext({
        domainId: 'system',
        user: makeUser(),
        handler: makeHandler(),
        target: courseTarget(),
        pid: 42,
        mode: 'student',
        setRejectionReason: (reason) => {
            calls.reasons.push(reason);
        },
        ...overrides,
    });
}

async function capture(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('practice issue orchestration', () => {
    beforeEach(() => {
        for (const entries of Object.values(calls)) entries.length = 0;
        Object.keys(containers).forEach((key) => delete containers[key]);
        coursePublished = publishedRevision();
        setPublished = undefined;
        containers[String(courseId)] = {
            docId: courseId,
            kind: 'course',
            owner: 7,
            courseGroupIds: [],
            dag: [{ _id: 3, pids: [42] }],
        };
        containers[String(setId)] = {
            docId: setId,
            kind: 'problem_set',
            owner: 7,
            dag: [{ _id: 1, pids: [42] }],
        };
    });

    it('does not issue a context when neither container has a published policy', async () => {
        coursePublished = null;
        const result = await issue();
        expect(result).to.deep.include({ controlled: false });
        expect(result.selected).to.deep.equal({ controlled: false });
        expect(calls.issue).to.deep.equal([]);
        expect(calls.reasons).to.include('policy-read-failed');
        expect(calls.reasons).to.not.include('context-issue-failed');
    });

    it('issues a course chain with both published targets', async () => {
        containers[String(courseId)].dag = [{ _id: 3, pids: [], problemSetId: setId }];
        setPublished = publishedRevision({
            _id: setRevisionId,
            containerKind: 'problemSet',
            containerId: setId,
            revision: 4,
        });
        const result = await issue();
        expect(result.controlled).to.equal(true);
        if (!result.controlled) return;
        expect(result.selected.identity).to.deep.include({ containerKind: 'course', scopeKind: 'chapter', scopeId: 3 });
        expect(String(result.selected.identity.containerId)).to.equal(String(courseId));
        expect(result.selected.targets).to.have.length(2);
        expect(calls.issue).to.have.length(1);
        expect(calls.issue[0]).to.include({
            domainId: 'system',
            uid: 42,
            containerKind: 'course',
            scopeKind: 'chapter',
            scopeId: 3,
            pid: 42,
            mode: 'student',
        });
        expect(calls.issue[0].targets).to.have.length(2);
        expect(calls.issue[0].targets[1].revision.containerKind).to.equal('problemSet');
        expect(String(calls.issue[0].targets[1].revision.containerId)).to.equal(String(setId));
        expect(result.context._id.toHexString()).to.equal(String(contextId));
        expect(result.context.revisions).to.have.length(2);
        expect(result.prepared.extra).to.include({ containerKind: 'problemSet', scopeKind: 'stage', scopeId: 1 });
    });

    it('fails closed when a published revision identity does not match the selected target', async () => {
        coursePublished = publishedRevision({ domainId: 'other-domain' });
        const primary = await capture(() => issue());
        expect(primary).to.be.instanceOf(TypeError);
        expect(primary?.message).to.equal(`practice integrity published revision identity mismatch: ${courseRevisionId}`);
        expect(calls.issue).to.deep.equal([]);
        expect(calls.reasons.at(-1)).to.equal('published-revision-invalid');

        calls.reasons.length = 0;
        containers[String(courseId)].dag = [{ _id: 3, pids: [], problemSetId: setId }];
        coursePublished = publishedRevision();
        setPublished = publishedRevision({
            _id: setRevisionId,
            containerKind: 'problemSet',
            containerId: new ObjectId('66b700000000000000000099'),
            revision: 4,
        });
        const extra = await capture(() => issue());
        expect(extra).to.be.instanceOf(TypeError);
        expect(extra?.message).to.equal(`practice integrity published revision identity mismatch: ${setRevisionId}`);
        expect(calls.issue).to.deep.equal([]);
    });

    it('issues the referenced problem set as primary when only the set is published', async () => {
        containers[String(courseId)].dag = [{ _id: 3, pids: [], problemSetId: setId }];
        coursePublished = null;
        setPublished = publishedRevision({
            _id: setRevisionId,
            containerKind: 'problemSet',
            containerId: setId,
            revision: 4,
        });
        const result = await issue();
        expect(result.controlled).to.equal(true);
        if (!result.controlled) return;
        expect(result.selected.identity.containerKind).to.equal('problemSet');
        expect(String(result.selected.identity.containerId)).to.equal(String(setId));
        expect(result.selected.identity).to.include({ scopeKind: 'stage', scopeId: 1 });
        expect(result.selected.targets).to.have.length(1);
        expect(calls.issue[0].containerKind).to.equal('problemSet');
        expect(String(calls.issue[0].containerId)).to.equal(String(setId));
        expect(calls.issue[0].scopeKind).to.equal('stage');
        expect(calls.issue[0].targets).to.have.length(1);
        expect(result.context.containerKind).to.equal('problemSet');
    });
});
