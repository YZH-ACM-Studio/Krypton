import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { after, beforeEach, describe, it } from 'node:test';
import {
    COLLECT_HARD_MAX_FILE_BYTES,
    COLLECT_HARD_MAX_FILES,
    COLLECT_HARD_MAX_TOTAL_BYTES,
    type CollectRequestDoc,
    type CollectSlot,
    type CollectSubmissionDoc,
} from '../src/types';

const framework = require('../../../framework/framework');
const Module = require('module');

const domainId = 'system';
const schoolId = new ObjectId('66b900000000000000000001');
const otherSchoolId = new ObjectId('66b900000000000000000002');
const groupId = new ObjectId('66b900000000000000000011');
const requestId = new ObjectId('66b900000000000000000021');
const submissionId = new ObjectId('66b900000000000000000031');

interface AudienceStudent {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
}

interface CollectActor {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
}

const requests: CollectRequestDoc[] = [];
const submissions: CollectSubmissionDoc[] = [];
const boundStudents: AudienceStudent[] = [];

function sameId(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return String(left) === String(right);
}

function pathValue(doc: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, segment) => {
        if (value && typeof value === 'object') return (value as Record<string, unknown>)[segment];
        return undefined;
    }, doc);
}

function matches(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, expected]) => {
        const actual = pathValue(doc, key);
        if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)) {
            const spec = expected as Record<string, unknown>;
            if ('$in' in spec && Array.isArray(spec.$in)) return spec.$in.some((item) => sameId(actual, item) || actual === item);
        }
        if (expected === null) return actual == null;
        if (actual instanceof ObjectId || expected instanceof ObjectId) return sameId(actual, expected);
        return actual === expected;
    });
}

function createCollection<T extends { _id: ObjectId }>(rows: T[]) {
    return {
        async findOne(query: Record<string, unknown>) {
            return rows.find((row) => matches(row as unknown as Record<string, unknown>, query)) ?? null;
        },
        async updateOne(query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
            const doc = rows.find((row) => matches(row as unknown as Record<string, unknown>, query));
            if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
            if (update.$set) Object.assign(doc, update.$set);
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        },
        async insertOne(doc: T) {
            rows.push(doc);
            return { acknowledged: true, insertedId: doc._id };
        },
    };
}

async function findBoundStudentsByGroupIds(targetDomainId: string, groupIds: ObjectId[]): Promise<AudienceStudent[]> {
    if (!groupIds.length) return [];
    const wanted = new Set(groupIds.map((id) => String(id)));
    return boundStudents.filter(
        (student) => student.domainId === targetDomainId && student.groupIds.some((id) => wanted.has(String(id))),
    );
}

const userBindModel = {
    findBoundStudentsByGroupIds,
    async findStudentByUserId(targetDomainId: string, userId: number) {
        return boundStudents.find((student) => student.domainId === targetDomainId && student.boundUserId === userId) ?? null;
    },
    async listUserGroups(targetDomainId: string, targetSchoolId?: ObjectId) {
        if (targetDomainId !== domainId) return [];
        if (targetSchoolId && !sameId(targetSchoolId, schoolId)) return [];
        return [{ _id: groupId, domainId, schoolId, name: '一班' }];
    },
};

type HydroHolder = { Hydro?: { model?: { userbind?: unknown } } };
const hydroHolder = globalThis as HydroHolder;
const previousHydro = hydroHolder.Hydro;
hydroHolder.Hydro = { model: { userbind: userBindModel } };

const modelPath = require.resolve('../src/model.ts');
const errorsPath = require.resolve('../src/errors.ts');
const authPath = require.resolve('../src/auth.ts');
const originalLoad = Module._load;
const hydroojStub = {
    ...framework,
    ObjectId,
    PERM,
    PRIV,
    nanoid: () => 'slotid01',
    StorageModel: {},
    UserModel: {},
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename;
    if ((filename === modelPath || filename === errorsPath || filename === authPath) && request === 'hydrooj') {
        return hydroojStub;
    }
    if (filename === modelPath && request === './db') {
        return {
            requestsColl: createCollection(requests),
            submissionsColl: createCollection(submissions),
            filesColl: createCollection([] as Array<{ _id: ObjectId }>),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

type PublishRequest = (domainId: string, id: ObjectId | string, actor: CollectActor, expectedRevision: number) => Promise<CollectRequestDoc>;
type UpdateRequest = (
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
    patch: { slots?: CollectSlot[] },
) => Promise<CollectRequestDoc>;

let publishRequest: PublishRequest;
let updateRequest: UpdateRequest;
try {
    delete require.cache[modelPath];
    delete require.cache[errorsPath];
    delete require.cache[authPath];
    const loaded = require(modelPath) as { publishRequest: PublishRequest; updateRequest: UpdateRequest };
    publishRequest = loaded.publishRequest;
    updateRequest = loaded.updateRequest;
} finally {
    Module._load = originalLoad;
}

after(() => {
    if (previousHydro) hydroHolder.Hydro = previousHydro;
    else delete hydroHolder.Hydro;
});

function owner(): CollectActor {
    return {
        _id: 10,
        hasPerm() {
            return false;
        },
        hasPriv() {
            return false;
        },
    };
}

function requiredSlot(): CollectSlot {
    return { id: 'report', title: '报告', required: true, allowedExt: ['pdf'], maxFiles: 1 };
}

function makeRequest(overrides: Partial<CollectRequestDoc> = {}): CollectRequestDoc {
    const now = new Date();
    return {
        _id: requestId,
        domainId,
        ownerUid: 10,
        collaboratorUids: [],
        schoolId,
        groupIds: [groupId],
        title: '第一次收集',
        description: '说明',
        slots: [requiredSlot()],
        dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        status: 'draft',
        revision: 1,
        maxFileBytes: COLLECT_HARD_MAX_FILE_BYTES,
        maxTotalBytes: COLLECT_HARD_MAX_TOTAL_BYTES,
        maxFiles: COLLECT_HARD_MAX_FILES,
        courseRef: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        closedAt: null,
        archivedAt: null,
        lastNudgeAt: null,
        lastNudgeBy: 0,
        ...overrides,
    };
}

async function expectNamedError(run: Promise<unknown>, name: string) {
    try {
        await run;
    } catch (error) {
        expect((error as { name?: string }).name).to.equal(name);
        return;
    }
    expect.fail(`expected ${name}`);
}

beforeEach(() => {
    requests.splice(0, requests.length);
    submissions.splice(0, submissions.length);
    boundStudents.splice(0, boundStudents.length);
    hydroHolder.Hydro = { model: { userbind: userBindModel } };
    requests.push(makeRequest());
});

describe('krypton-collect publish', () => {
    it('rejects publish when the live bound audience is empty', async () => {
        boundStudents.push({
            _id: new ObjectId('66b900000000000000000102'),
            domainId,
            schoolId,
            studentId: '24000002',
            realName: '未绑定',
            groupIds: [groupId],
            boundUserId: null,
        });
        boundStudents.push({
            _id: new ObjectId('66b900000000000000000103'),
            domainId,
            schoolId: otherSchoolId,
            studentId: '24000003',
            realName: '外校',
            groupIds: [groupId],
            boundUserId: 103,
        });

        await expectNamedError(publishRequest(domainId, requestId, owner(), 1), 'CollectAudienceEmptyError');
        expect(requests[0].status).to.equal('draft');
        expect(requests[0].revision).to.equal(1);
    });

    it('locks slots after a submitted file exists', async () => {
        boundStudents.push({
            _id: new ObjectId('66b900000000000000000101'),
            domainId,
            schoolId,
            studentId: '24000001',
            realName: '张三',
            groupIds: [groupId],
            boundUserId: 101,
        });
        requests.splice(0, requests.length);
        requests.push(makeRequest({ status: 'published', revision: 2, publishedAt: new Date() }));
        const now = new Date();
        submissions.push({
            _id: submissionId,
            domainId,
            requestId,
            uid: 101,
            status: 'submitted',
            submittedAt: now,
            currentFiles: [{
                slotId: 'report',
                fileId: 'file-1',
                originalName: 'lab.pdf',
                size: 12,
                sha256: 'abc',
                ext: 'pdf',
            }],
            createdAt: now,
            updatedAt: now,
        });

        await expectNamedError(
            updateRequest(
                domainId,
                requestId,
                owner(),
                2,
                { slots: [{ id: 'photo', title: '照片', required: true, allowedExt: ['jpg'], maxFiles: 1 }] },
            ),
            'CollectSlotLockedError',
        );
        expect(requests[0].slots[0].id).to.equal('report');
        expect(requests[0].revision).to.equal(2);
    });
});
