import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const domainId = 'system';
const taskId = new ObjectId();
const assignmentId = new ObjectId();

let assignment: Record<string, any>;
let assignmentReads = 0;
let blockInitialReads = false;
let releaseAssignmentReads: (() => void) | null = null;
let bothAssignmentReads: Promise<void>;
let releaseConfirmClaim: (() => void) | null = null;
let confirmClaim: Promise<void>;
let auditFailures = 0;
let finalizeFailures = 0;
let taskCountsAsStay: boolean | undefined;
let taskCounterUpdates = 0;
const audits: Array<Record<string, any>> = [];
const stayEvents: Array<Record<string, any>> = [];

function sameId(left: unknown, right: unknown) {
    return left instanceof ObjectId && right instanceof ObjectId && (left as { equals(value: unknown): boolean }).equals(right);
}

function pathValue(doc: Record<string, any>, path: string) {
    return path
        .split('.')
        .reduce<unknown>((value, segment) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined), doc);
}

function matches(doc: Record<string, any>, query: Record<string, any>): boolean {
    return Object.entries(query).every(([key, expected]) => {
        if (key === '$or') return (expected as Array<Record<string, any>>).some((candidate) => matches(doc, candidate));
        const actual = pathValue(doc, key);
        if (expected === null) return actual == null;
        if (actual instanceof ObjectId || expected instanceof ObjectId) return sameId(actual, expected);
        return actual === expected;
    });
}

const assignmentsColl = {
    async findOne(query: Record<string, any>) {
        if (!matches(assignment, query)) return null;
        const snapshot = { ...assignment };
        assignmentReads++;
        if (blockInitialReads && assignmentReads <= 2) {
            if (assignmentReads === 2) releaseAssignmentReads?.();
            await bothAssignmentReads;
        }
        return snapshot;
    },
    async updateOne(query: Record<string, any>, update: { $set: Record<string, any> }) {
        const transition = update.$set.admissionTransition as Record<string, any> | undefined;
        if (blockInitialReads && (transition?.operation === 'unadmit' || update.$set.status === 'cancelled')) await confirmClaim;
        if (!matches(assignment, query)) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        if (query['admissionTransition.state'] === 'pending' && finalizeFailures > 0) {
            finalizeFailures--;
            throw new Error('finalize failed');
        }
        Object.assign(assignment, update.$set);
        if (transition?.operation === 'confirm' && transition.state === 'pending') releaseConfirmClaim?.();
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
};

const tasksColl = {
    async findOne(query: Record<string, any>) {
        if (query.domainId !== domainId || !sameId(query._id, taskId)) return null;
        return {
            _id: taskId,
            domainId,
            admissionMode: 'quota',
            ...(taskCountsAsStay === undefined ? {} : { countsAsStay: taskCountsAsStay }),
        };
    },
    async updateOne() {
        taskCounterUpdates++;
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
};

const auditColl = {
    async insertOne(doc: Record<string, any>) {
        if (auditFailures > 0) {
            auditFailures--;
            throw new Error('audit insert failed');
        }
        if (audits.some((audit) => sameId(audit._id, doc._id))) throw Object.assign(new Error('duplicate audit'), { code: 11000 });
        audits.push(doc);
        return { acknowledged: true, insertedId: doc._id };
    },
    async findOne(query: Record<string, any>) {
        return audits.find((audit) => matches(audit, query)) || null;
    },
};

const stayEventsColl = {
    async insertOne(doc: Record<string, any>) {
        if (stayEvents.some((event) => event.domainId === doc.domainId && event.userId === doc.userId && event.source === doc.source)) {
            throw Object.assign(new Error('duplicate stay event'), { code: 11000 });
        }
        stayEvents.push(doc);
        return { acknowledged: true, insertedId: doc._id };
    },
};

const inertCollection = {
    async findOne() {
        return null;
    },
};

const modelPath = require.resolve('../src/model.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modelPath) {
        if (request === 'hydrooj') return { ...framework, ObjectId };
        if (request === '@hydrooj/krypton-userbind') return { userBindModel: {} };
        if (request === './db') {
            return {
                assignmentsColl,
                auditColl,
                tasksColl,
                stayEventsColl,
                gpltScoreColl: inertCollection,
                settingsColl: inertCollection,
            };
        }
        if (request === './presets') return { runChecker: async () => undefined, taskPointPresets: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let taskModel: typeof import('../src/model.ts').taskModel;
let TaskAssignmentTransitionError: typeof import('../src/model.ts').TaskAssignmentTransitionError;
try {
    delete require.cache[modelPath];
    ({ taskModel, TaskAssignmentTransitionError } = require(modelPath));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    assignment = {
        _id: assignmentId,
        domainId,
        taskId,
        userId: 101,
        status: 'admitted',
        admittedBy: 7,
    };
    assignmentReads = 0;
    blockInitialReads = false;
    bothAssignmentReads = new Promise((resolve) => {
        releaseAssignmentReads = resolve;
    });
    confirmClaim = new Promise((resolve) => {
        releaseConfirmClaim = resolve;
    });
    auditFailures = 0;
    finalizeFailures = 0;
    taskCountsAsStay = undefined;
    taskCounterUpdates = 0;
    audits.length = 0;
    stayEvents.length = 0;
});

describe('task admission state-machine CAS', () => {
    it('does not let an unadmit race overwrite a completed confirmation', async () => {
        blockInitialReads = true;
        const [confirmed, unadmitted] = await Promise.allSettled([
            taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认'),
            taskModel.unadmitAssignment(domainId, taskId, assignmentId, 3, '撤销'),
        ]);

        expect(confirmed.status).to.equal('fulfilled');
        expect(unadmitted.status).to.equal('rejected');
        if (unadmitted.status !== 'rejected') throw new Error('Expected unadmit to lose the CAS race');
        expect(unadmitted.reason).to.be.instanceOf(TaskAssignmentTransitionError);
        expect(unadmitted.reason.reason).to.equal('assignment_state_changed');
        expect(assignment.status).to.equal('completed');
        expect(audits.map((audit) => audit.eventType)).to.deep.equal(['confirm']);
    });

    it('does not let a self-cancel race overwrite a completed confirmation', async () => {
        blockInitialReads = true;
        assignment.canCancel = true;
        const [confirmed, cancelled] = await Promise.allSettled([
            taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认'),
            taskModel.cancelAssignment(domainId, assignmentId, assignment.userId),
        ]);

        expect(confirmed.status).to.equal('fulfilled');
        expect(cancelled.status).to.equal('rejected');
        expect(assignment.status).to.equal('completed');
        expect(taskCounterUpdates).to.equal(0);
        expect(audits.map((audit) => audit.eventType)).to.deep.equal(['confirm']);
    });

    it('normalizes a legacy task without countsAsStay across admit, unadmit, and confirm', async () => {
        assignment.status = 'qualified';

        await taskModel.admitAssignment(domainId, taskId, assignmentId, 2, '录取');
        expect(assignment.status).to.equal('admitted');
        expect(assignment.admissionTransition.countsAsStay).to.equal(false);

        await taskModel.unadmitAssignment(domainId, taskId, assignmentId, 2, '撤销');
        expect(assignment.status).to.equal('qualified');

        await taskModel.admitAssignment(domainId, taskId, assignmentId, 2, '再次录取');
        await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');

        expect(assignment.status).to.equal('completed');
        expect(stayEvents).to.have.lengthOf(0);
        expect(audits.map((audit) => audit.eventType)).to.deep.equal(['admit', 'unadmit', 'admit', 'confirm']);
    });

    it('resumes a durable confirmation after the stay event was written but the audit failed', async () => {
        taskCountsAsStay = true;
        auditFailures = 1;

        let firstError: unknown;
        try {
            await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');
        } catch (error) {
            firstError = error;
        }
        expect((firstError as Error).message).to.equal('audit insert failed');
        expect(assignment.status).to.equal('admitted');
        expect(assignment.admissionTransition.state).to.equal('pending');
        expect(stayEvents).to.have.lengthOf(1);
        expect(audits).to.have.lengthOf(0);

        await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');

        expect(assignment.status).to.equal('completed');
        expect(assignment.admissionTransition.state).to.equal('complete');
        expect(stayEvents).to.have.lengthOf(1);
        expect(audits.map((audit) => audit.eventType)).to.deep.equal(['confirm']);
    });

    it('does not duplicate durable effects when final status persistence is retried', async () => {
        taskCountsAsStay = true;
        finalizeFailures = 1;

        let firstError: unknown;
        try {
            await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');
        } catch (error) {
            firstError = error;
        }
        expect((firstError as Error).message).to.equal('finalize failed');
        expect(assignment.status).to.equal('admitted');
        expect(assignment.admissionTransition.state).to.equal('pending');
        expect(stayEvents).to.have.lengthOf(1);
        expect(audits).to.have.lengthOf(1);

        await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');

        expect(assignment.status).to.equal('completed');
        expect(stayEvents).to.have.lengthOf(1);
        expect(audits).to.have.lengthOf(1);

        await taskModel.confirmAssignment(domainId, taskId, assignmentId, 2, '确认');
        expect(stayEvents).to.have.lengthOf(1);
        expect(audits).to.have.lengthOf(1);
    });

    it('rejects an assignment id scoped through a different route task', async () => {
        const otherTaskId = new ObjectId();
        let observed: unknown;

        try {
            await taskModel.confirmAssignment(domainId, otherTaskId, assignmentId, 2, '');
        } catch (error) {
            observed = error;
        }

        expect(observed).to.be.instanceOf(TaskAssignmentTransitionError);
        expect((observed as Error).message).to.equal('任务分配不存在或不属于当前任务');
        expect(assignment.status).to.equal('admitted');
        expect(audits).to.have.lengthOf(0);
    });
});
