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
};
const PRIV = { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 };

const courseId = new ObjectId('66c200000000000000000001');
const setId = new ObjectId('66c200000000000000000002');
const groupId = new ObjectId('66c200000000000000000003');

const published: any[] = [];
const containers: Record<string, any> = {};
let studentGroups: ObjectId[] = [];
let enrolled = false;
let setAccessible = false;
let livePids: number[] = [];
let getError: Error | null = null;

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromAccess = parent?.filename?.includes('practice-integrity-access');
    const fromLiveRef = parent?.filename?.includes('course-live-ref');
    if (fromAccess && request === './builtin') return { PERM, PRIV, STATUS: { STATUS_ACCEPTED: 1 } };
    if (fromAccess && request === '../error') {
        return {
            localizedErrorText: (value: unknown) => value,
            PermissionError: class PermissionError extends Error {},
            TrainingNotFoundError: class TrainingNotFoundError extends Error {},
            ValidationError: class ValidationError extends Error {},
        };
    }
    if (fromAccess && request === './practice-integrity') {
        return {
            canonicalPracticePolicy: (value: unknown) => value,
            practiceIntegrityService: {
                async listLatestPublished() {
                    return published;
                },
            },
        };
    }
    if (fromAccess && request === './problem-set-access') {
        return {
            problemSetAccessService: {
                async evaluate() {
                    return { accessible: setAccessible };
                },
                async hasActiveEntitlement() {
                    return true;
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
                return { docId: 7 };
            },
            async getListStatus() {
                return {};
            },
        };
    }
    if ((fromAccess && request === './training') || (fromLiveRef && request === '../model/training')) {
        return {
            async get(_domainId: string, id: ObjectId) {
                if (getError) throw getError;
                return containers[String(id)] || null;
            },
            getPids(dag: any[] = []) {
                return Array.from(new Set(dag.flatMap((node) => node.pids || [])));
            },
            async getStatus() {
                return enrolled ? { enroll: 1 } : null;
            },
        };
    }
    if (fromAccess && request === '../lib/course-live-ref') {
        return {
            async liveReferencedPids() {
                return livePids;
            },
        };
    }
    if (fromAccess && request === '../lib/training-kind') {
        return {
            isCourseKind: (kind: string) => kind === 'course',
            isProblemSetKind: (kind: string) => kind === 'problem_set' || kind === 'training' || !kind,
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let resolveInheritedPracticeEnforcement: typeof import('../src/model/practice-integrity-access').resolveInheritedPracticeEnforcement;
try {
    const accessPath = require.resolve('../src/model/practice-integrity-access.ts');
    delete require.cache[accessPath];
    ({ resolveInheritedPracticeEnforcement } = require('../src/model/practice-integrity-access.ts'));
} finally {
    Module._load = originalLoad;
}

function makeUser(overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>();
    return {
        _id: 42,
        hasPriv: (priv: number) => priv === PRIV.PRIV_USER_PROFILE,
        hasPerm: (...wanted: bigint[]) => wanted.some((permission) => perms.has(permission)),
        own: () => false,
        ...overrides,
        grant(permission: bigint) {
            perms.add(permission);
            return this;
        },
    };
}

describe('inherited practice enforcement resolver', () => {
    beforeEach(() => {
        published.length = 0;
        Object.keys(containers).forEach((key) => delete containers[key]);
        studentGroups = [groupId];
        enrolled = false;
        setAccessible = false;
        livePids = [];
        getError = null;
        (global as any).Hydro.model.userbind = {
            async findStudentByUserId() {
                return { groupIds: studentGroups };
            },
        };
        containers[String(courseId)] = {
            docId: courseId,
            kind: 'course',
            owner: 9,
            courseGroupIds: [groupId],
            dag: [{ _id: 1, pids: [7], sections: [] }],
        };
        containers[String(setId)] = {
            docId: setId,
            kind: 'problem_set',
            owner: 9,
            dag: [{ _id: 1, pids: [7] }],
        };
    });

    it('inherits paste and IDE-only from an audience course on the problem bank', async () => {
        published.push({
            containerKind: 'course',
            containerId: courseId,
            policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: true },
        });
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: true,
        });
    });

    it('does not inherit when the student is outside the course groups, even with a course entitlement', async () => {
        published.push({
            containerKind: 'course',
            containerId: courseId,
            policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
        });
        studentGroups = [];
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
    });

    it('uses enroll-only audience for a domain-wide course', async () => {
        containers[String(courseId)].courseGroupIds = [];
        published.push({
            containerKind: 'course',
            containerId: courseId,
            policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: false, antiAiCopyInjection: false },
        });
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
        enrolled = true;
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: false,
        });
    });

    it('skips managers and ORs matching problem-set access', async () => {
        published.push(
            {
                containerKind: 'course',
                containerId: courseId,
                policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: false, antiAiCopyInjection: false },
            },
            {
                containerKind: 'problemSet',
                containerId: setId,
                policy: { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
            },
        );
        const manager = makeUser();
        manager.own = () => true;
        manager.grant(PERM.PERM_EDIT_COURSE);
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: manager as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
        setAccessible = true;
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: true,
        });
    });

    it('does not inherit for guests or problems that are not hung in the container', async () => {
        published.push({
            containerKind: 'course',
            containerId: courseId,
            policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
        });
        const guest = makeUser({
            _id: 0,
            hasPriv: () => false,
        });
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: guest as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 8 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
        livePids = [8];
        containers[String(courseId)].dag = [{ _id: 1, pids: [], sections: [], problemSetId: setId }];
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 8 })).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: true,
        });
    });

    it('skips a missing published container and rethrows unexpected load failures', async () => {
        published.push({
            containerKind: 'course',
            containerId: courseId,
            policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
        });
        delete containers[String(courseId)];
        expect(await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 })).to.deep.equal({
            prohibitExternalCodeInjection: false,
            removeIndependentSubmitForm: false,
        });
        getError = new Error('ECONNRESET');
        let thrown: Error | null = null;
        try {
            await resolveInheritedPracticeEnforcement({ domainId: 'system', user: makeUser() as any, pid: 7 });
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).to.equal('ECONNRESET');
    });
});
