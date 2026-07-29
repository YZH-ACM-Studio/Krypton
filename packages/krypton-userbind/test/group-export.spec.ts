import { expect } from 'chai';
import { LocalizedErrorText, localizeErrorParameter, localizedErrorText } from '@hydrooj/framework';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import type { BoundUserGroupTarget, CreateGroupFromBoundUsersDependencies } from '../src/group-export';
import type { StudentRecord, UserGroup } from '../src/types';

class FakeHydroError extends Error {
    code: number;
    params: unknown[];

    constructor(code: number, ...params: unknown[]) {
        super();
        this.code = code;
        this.params = params.map((value) => (value instanceof LocalizedErrorText ? value.raw : value));
    }
}

class FakeValidationError extends FakeHydroError {
    constructor(...params: unknown[]) {
        super(403, ...params);
    }
}

class FakeSystemError extends FakeHydroError {
    constructor(...params: unknown[]) {
        super(500, ...params);
    }
}

function loadGroupExportModule() {
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') {
            return {
                localizeErrorParameter,
                localizedErrorText,
                ObjectId,
                SystemError: FakeSystemError,
                ValidationError: FakeValidationError,
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const modulePath = require.resolve('../src/group-export');
        delete require.cache[modulePath];
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
}

const { createGroupFromBoundUsersWithDependencies } = loadGroupExportModule();

const domainId = 'system';
const schoolA = new ObjectId();
const schoolB = new ObjectId();

function student(userId: number, schoolId = schoolA): StudentRecord {
    return {
        _id: new ObjectId(),
        domainId,
        schoolId,
        studentId: `2400${userId}`,
        realName: `学生${userId}`,
        groupIds: [],
        boundUserId: userId,
        boundAt: new Date(),
        enrollmentYear: 2024,
        createdAt: new Date(),
        createdBy: 2,
    };
}

function targets(...userIds: number[]): BoundUserGroupTarget[] {
    return userIds.map((userId) => ({ userId, username: `user${userId}` }));
}

function fixture(records: StudentRecord[], existingUserIds = records.map((record) => record.boundUserId!)) {
    const state = {
        group: null as UserGroup | null,
        studentMembership: new Set<string>(),
        userMembership: new Set<number>(),
        deleted: false,
        logs: [] as Array<{ message: string; context: Record<string, unknown> }>,
    };
    const dependencies: CreateGroupFromBoundUsersDependencies = {
        findStudents: async () => records,
        findExistingUserIds: async () => existingUserIds,
        createGroup: async (targetDomainId, schoolId, name, createdBy, groupId) => {
            state.group = {
                _id: groupId,
                domainId: targetDomainId,
                schoolId,
                name,
                createdAt: new Date(),
                createdBy,
            };
            return state.group;
        },
        addStudentMembership: async (_targetDomainId, _schoolId, recordIds) => {
            for (const id of recordIds) state.studentMembership.add(id.toHexString());
            return recordIds.length;
        },
        addUserMembership: async (userIds) => {
            for (const userId of userIds) state.userMembership.add(userId);
            return userIds.length;
        },
        countStudentMembership: async () => state.studentMembership.size,
        countUserMembership: async () => state.userMembership.size,
        recordSuccess: async () => undefined,
        removeStudentMembership: async () => {
            state.studentMembership.clear();
        },
        removeUserMembership: async () => {
            state.userMembership.clear();
        },
        deleteGroup: async () => {
            state.deleted = true;
            state.group = null;
            return true;
        },
        logError: (message, context) => state.logs.push({ message, context }),
    };
    return { dependencies, state };
}

async function captureFailure(run: Promise<unknown>): Promise<any> {
    try {
        await run;
        return null;
    } catch (error) {
        return error;
    }
}

describe('P1.6 createGroupFromBoundUsers', () => {
    it('deduplicates users and creates one same-school group with exact membership', async () => {
        const records = [student(7), student(42)];
        const { dependencies, state } = fixture(records);
        const result = await createGroupFromBoundUsersWithDependencies(
            domainId,
            '暑期任务组',
            2,
            targets(7, 42, 7),
            { taskId: 'task-1' },
            dependencies,
        );

        expect(result.memberCount).to.equal(2);
        expect(result.group.schoolId.equals(schoolA)).to.equal(true);
        expect(state.studentMembership).to.have.lengthOf(2);
        expect([...state.userMembership]).to.deep.equal([7, 42]);
        expect(state.deleted).to.equal(false);
    });

    it('reports every missing or ambiguous binding before creating a group', async () => {
        const records = [student(7), student(7)];
        const { dependencies, state } = fixture(records, [7, 42]);
        const error = await captureFailure(createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), {}, dependencies));

        expect(error?.code).to.equal(403);
        expect(error?.params?.[2]).to.include('user7（UID 7）：绑定身份不唯一');
        expect(error?.params?.[2]).to.include('user42（UID 42）：没有有效的学生绑定记录');
        expect(state.group).to.equal(null);
    });

    it('rejects a mixed valid/invalid UID set instead of silently dropping the invalid assignment', async () => {
        const { dependencies, state } = fixture([student(7)]);
        const error = await captureFailure(
            createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, [...targets(7), { userId: 0, username: 'broken' }], {}, dependencies),
        );

        expect(error?.params?.[2]).to.include('任务包含非法用户 ID：0');
        expect(state.group).to.equal(null);
    });

    it('rejects cross-school members before any write', async () => {
        const { dependencies, state } = fixture([student(7, schoolA), student(42, schoolB)]);
        const error = await captureFailure(createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), {}, dependencies));

        expect(error?.params?.[2]).to.include('任务成员属于多个学校');
        expect(error?.params?.[2]).to.include(schoolA.toHexString());
        expect(error?.params?.[2]).to.include(schoolB.toHexString());
        expect(state.group).to.equal(null);
    });

    it('rolls back both membership mirrors and the new group after a write failure', async () => {
        const records = [student(7), student(42)];
        const { dependencies, state } = fixture(records);
        dependencies.addUserMembership = async (userIds) => {
            state.userMembership.add(userIds[0]);
            throw new Error('user mirror failed');
        };

        const error = await captureFailure(
            createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), { taskId: 'task-2' }, dependencies),
        );

        expect(error?.code).to.equal(500);
        expect(state.studentMembership.size).to.equal(0);
        expect(state.userMembership.size).to.equal(0);
        expect(state.deleted).to.equal(true);
        expect(state.logs[0].context).to.deep.include({ taskId: 'task-2', stage: 'add_user_membership' });
    });

    it('rolls back when the final UserModel membership count is incomplete', async () => {
        const records = [student(7), student(42)];
        const { dependencies, state } = fixture(records);
        dependencies.countUserMembership = async () => 1;

        const error = await captureFailure(createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), {}, dependencies));

        expect(error?.code).to.equal(500);
        expect(state.studentMembership.size).to.equal(0);
        expect(state.userMembership.size).to.equal(0);
        expect(state.deleted).to.equal(true);
        expect(state.logs[0].context).to.deep.include({
            stage: 'verify_user_membership',
            matchedStudents: 2,
            matchedUsers: 2,
            finalStudentMembers: 2,
            finalUserMembers: 1,
        });
    });

    it('treats Oplog failure as part of the same rollback boundary', async () => {
        const records = [student(7), student(42)];
        const { dependencies, state } = fixture(records);
        dependencies.recordSuccess = async () => {
            throw new Error('oplog insert failed');
        };

        const error = await captureFailure(
            createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), { taskId: 'task-oplog' }, dependencies),
        );

        expect(error?.code).to.equal(500);
        expect(state.studentMembership.size).to.equal(0);
        expect(state.userMembership.size).to.equal(0);
        expect(state.deleted).to.equal(true);
        expect(state.logs[0].context).to.deep.include({ taskId: 'task-oplog', stage: 'record_success' });
    });

    it('cleans up the planned group id when insert succeeds but createGroup throws', async () => {
        const records = [student(7), student(42)];
        const { dependencies, state } = fixture(records);
        dependencies.createGroup = async (targetDomainId, targetSchoolId, name, createdBy, plannedGroupId) => {
            state.group = {
                _id: plannedGroupId,
                domainId: targetDomainId,
                schoolId: targetSchoolId,
                name,
                createdAt: new Date(),
                createdBy,
            };
            throw new Error('insert acknowledgement lost');
        };

        const error = await captureFailure(
            createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7, 42), { taskId: 'task-create' }, dependencies),
        );

        expect(error?.code).to.equal(500);
        expect(error?.params?.[0]).to.equal('Task user group creation failed');
        expect(state.group).to.equal(null);
        expect(state.deleted).to.equal(true);
        expect(state.studentMembership.size).to.equal(0);
        expect(state.userMembership.size).to.equal(0);
        expect(state.logs[0].context).to.deep.include({ taskId: 'task-create', stage: 'create_group' });
        expect(state.logs[0].context.groupId).to.be.a('string').and.have.lengthOf(24);
    });

    it('logs unexpected preflight failures with task and stage context before rethrowing', async () => {
        const { dependencies, state } = fixture([student(7)]);
        dependencies.findStudents = async () => {
            throw new Error('students query failed');
        };

        const error = await captureFailure(
            createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7), { taskId: 'task-read' }, dependencies),
        );

        expect(error?.message).to.equal('students query failed');
        expect(state.group).to.equal(null);
        expect(state.logs).to.have.lengthOf(1);
        expect(state.logs[0].context).to.deep.include({
            taskId: 'task-read',
            stage: 'preflight',
            schoolId: null,
            groupId: null,
        });
    });

    it('surfaces rollback failure as a distinct 5xx and logs the failed operation', async () => {
        const records = [student(7)];
        const { dependencies, state } = fixture(records);
        dependencies.addUserMembership = async () => {
            throw new Error('write failed');
        };
        dependencies.removeStudentMembership = async () => {
            throw new Error('student rollback failed');
        };

        const error = await captureFailure(createGroupFromBoundUsersWithDependencies(domainId, '任务组', 2, targets(7), {}, dependencies));

        expect(error?.code).to.equal(500);
        expect(error?.params?.[0]).to.equal('Task user group rollback failed');
        expect(state.logs.at(-1)?.message).to.include('rollback failed');
        expect(state.logs.at(-1)?.context.rollbackFailures).to.deep.equal(['remove_student_membership: student rollback failed']);
    });
});
