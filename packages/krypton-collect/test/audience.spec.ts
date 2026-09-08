import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { after, beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');

const domainId = 'system';
const schoolId = new ObjectId('66b900000000000000000001');
const otherSchoolId = new ObjectId('66b900000000000000000002');
const groupId = new ObjectId('66b900000000000000000011');
const otherGroupId = new ObjectId('66b900000000000000000012');

interface AudienceStudent {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
}

interface BoundAudienceRow {
    boundUserId: number;
    schoolId: ObjectId;
    groupIds: ObjectId[];
    studentId: string;
    realName: string;
}

const boundStudents: AudienceStudent[] = [];
const findBoundCalls: Array<{ domainId: string; groupIds: ObjectId[] }> = [];

async function findBoundStudentsByGroupIds(targetDomainId: string, groupIds: ObjectId[]): Promise<AudienceStudent[]> {
    findBoundCalls.push({ domainId: targetDomainId, groupIds: [...groupIds] });
    if (!groupIds.length) return [];
    const wanted = new Set(groupIds.map((id) => String(id)));
    return boundStudents.filter(
        (student) => student.domainId === targetDomainId && student.groupIds.some((id) => wanted.has(String(id))),
    );
}

async function findStudentByUserId(targetDomainId: string, userId: number): Promise<AudienceStudent | null> {
    return boundStudents.find((student) => student.domainId === targetDomainId && student.boundUserId === userId) ?? null;
}

const userBindModel = {
    findBoundStudentsByGroupIds,
    findStudentByUserId,
    async listUserGroups(targetDomainId: string, targetSchoolId?: ObjectId) {
        const groups = [
            { _id: groupId, domainId, schoolId, name: '一班' },
            { _id: otherGroupId, domainId, schoolId: otherSchoolId, name: '外校班' },
        ];
        return groups.filter((group) => group.domainId === targetDomainId && (targetSchoolId == null || String(group.schoolId) === String(targetSchoolId)));
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
            requestsColl: { findOne: async () => null },
            submissionsColl: { findOne: async () => null },
            filesColl: { findOne: async () => null },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let resolveAudience: (domainId: string, schoolId: ObjectId, groupIds: ObjectId[]) => Promise<BoundAudienceRow[]>;
try {
    delete require.cache[modelPath];
    delete require.cache[errorsPath];
    delete require.cache[authPath];
    ({ resolveAudience } = require(modelPath) as { resolveAudience: typeof resolveAudience });
} finally {
    Module._load = originalLoad;
}

after(() => {
    if (previousHydro) hydroHolder.Hydro = previousHydro;
    else delete hydroHolder.Hydro;
});

function student(opts: {
    id: string;
    studentId: string;
    uid: number | null;
    school?: ObjectId;
    groups?: ObjectId[];
}): AudienceStudent {
    return {
        _id: new ObjectId(opts.id),
        domainId,
        schoolId: opts.school ?? schoolId,
        studentId: opts.studentId,
        realName: `学生${opts.studentId}`,
        groupIds: opts.groups ?? [groupId],
        boundUserId: opts.uid,
    };
}

beforeEach(() => {
    boundStudents.splice(0, boundStudents.length);
    findBoundCalls.splice(0, findBoundCalls.length);
    hydroHolder.Hydro = { model: { userbind: userBindModel } };
    boundStudents.push(
        student({ id: '66b900000000000000000101', studentId: '24000001', uid: 101 }),
        student({ id: '66b900000000000000000102', studentId: '24000002', uid: null }),
        student({ id: '66b900000000000000000103', studentId: '24000003', uid: 103, school: otherSchoolId }),
        student({ id: '66b900000000000000000104', studentId: '24000004', uid: 104, groups: [otherGroupId] }),
    );
});

describe('krypton-collect audience', () => {
    it('includes a bound member of the selected group', async () => {
        const rows = await resolveAudience(domainId, schoolId, [groupId]);
        expect(findBoundCalls).to.deep.equal([{ domainId, groupIds: [groupId] }]);
        expect(rows.map((row) => row.boundUserId)).to.deep.equal([101]);
        expect(rows[0].studentId).to.equal('24000001');
    });

    it('excludes a student who is not in the selected group', async () => {
        const rows = await resolveAudience(domainId, schoolId, [groupId]);
        expect(rows.map((row) => row.boundUserId)).to.not.include(104);
    });

    it('excludes an unbound roster record even if userbind returned it', async () => {
        const rows = await resolveAudience(domainId, schoolId, [groupId]);
        expect(rows.some((row) => row.studentId === '24000002')).to.equal(false);
        expect(rows.every((row) => row.boundUserId > 1)).to.equal(true);
    });

    it('excludes a bound student from another school', async () => {
        const rows = await resolveAudience(domainId, schoolId, [groupId]);
        expect(rows.map((row) => row.boundUserId)).to.not.include(103);
        expect(rows.every((row) => String(row.schoolId) === String(schoolId))).to.equal(true);
    });
});
