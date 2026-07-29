import { localizeErrorParameter, localizedErrorText, ObjectId, SystemError, ValidationError } from 'hydrooj';
import type { StudentRecord, UserGroup } from './types';

export interface BoundUserGroupTarget {
    userId: number;
    username: string;
}

export interface BoundUserGroupContext {
    taskId?: string;
}

export interface CreateGroupFromBoundUsersResult {
    group: UserGroup;
    memberCount: number;
}

export interface CreateGroupFromBoundUsersDependencies {
    findStudents(domainId: string, userIds: number[]): Promise<StudentRecord[]>;
    findExistingUserIds(userIds: number[]): Promise<number[]>;
    createGroup(domainId: string, schoolId: ObjectId, name: string, createdBy: number, groupId: ObjectId): Promise<UserGroup>;
    addStudentMembership(domainId: string, schoolId: ObjectId, recordIds: ObjectId[], userIds: number[], groupId: ObjectId): Promise<number>;
    addUserMembership(userIds: number[], groupId: ObjectId): Promise<number>;
    countStudentMembership(domainId: string, recordIds: ObjectId[], groupId: ObjectId): Promise<number>;
    countUserMembership(userIds: number[], groupId: ObjectId): Promise<number>;
    recordSuccess(result: CreateGroupFromBoundUsersResult): Promise<void>;
    removeStudentMembership(domainId: string, recordIds: ObjectId[], groupId: ObjectId): Promise<void>;
    removeUserMembership(userIds: number[], groupId: ObjectId): Promise<void>;
    deleteGroup(domainId: string, groupId: ObjectId): Promise<boolean>;
    logError(message: string, context: Record<string, unknown>): void;
}

function targetLabel(target: BoundUserGroupTarget): string {
    const username = target.username.trim();
    return `${username || `UID ${target.userId}`}（UID ${target.userId}）`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function createGroupFromBoundUsersWithDependencies(
    domainId: string,
    name: string,
    createdBy: number,
    inputTargets: BoundUserGroupTarget[],
    context: BoundUserGroupContext,
    dependencies: CreateGroupFromBoundUsersDependencies,
): Promise<CreateGroupFromBoundUsersResult> {
    const groupName = name.trim();
    if (!groupName) throw new ValidationError('name', null, localizedErrorText`用户组名称不能为空`);

    const invalidUserIds = inputTargets
        .filter((target) => !Number.isInteger(target.userId) || target.userId <= 0)
        .map((target) => String((target as any).userId));
    if (invalidUserIds.length > 0) {
        throw new ValidationError('users', null, localizedErrorText`任务包含非法用户 ID：${invalidUserIds.join('、')}`);
    }
    const targets = Array.from(
        new Map(inputTargets.map((target) => [target.userId, { userId: target.userId, username: String(target.username || '') }])).values(),
    );
    if (targets.length === 0) throw new ValidationError('users', null, localizedErrorText`任务没有可导出的非取消成员`);

    const userIds = targets.map((target) => target.userId);
    const baseLogContext = {
        domainId,
        taskId: context.taskId || null,
        createdBy,
        userIds,
        memberCount: userIds.length,
    };
    let stage = 'preflight';
    let group: UserGroup | null = null;
    let plannedGroupId: ObjectId | null = null;
    let records: StudentRecord[] = [];
    let schoolId: ObjectId | null = null;
    let matchedStudents: number | null = null;
    let matchedUsers: number | null = null;
    let finalStudentMembers: number | null = null;
    let finalUserMembers: number | null = null;

    const structuredLogContext = () => ({
        ...baseLogContext,
        schoolId: schoolId?.toHexString() || null,
        groupId: (group?._id || plannedGroupId)?.toHexString() || null,
        stage,
        matchedStudents,
        matchedUsers,
        finalStudentMembers,
        finalUserMembers,
    });

    try {
        const [foundRecords, existingUserIds] = await Promise.all([
            dependencies.findStudents(domainId, userIds),
            dependencies.findExistingUserIds(userIds),
        ]);
        records = foundRecords;
        const existingUsers = new Set(existingUserIds);
        const recordsByUid = new Map<number, StudentRecord[]>();
        for (const record of records) {
            if (!record.boundUserId) continue;
            const bucket = recordsByUid.get(record.boundUserId) || [];
            bucket.push(record);
            recordsByUid.set(record.boundUserId, bucket);
        }

        const validationFailures: string[] = [];
        const missingUsers: string[] = [];
        const missingBindings: string[] = [];
        const ambiguousBindings: string[] = [];
        const selectedRecords: StudentRecord[] = [];
        for (const target of targets) {
            const label = targetLabel(target);
            if (!existingUsers.has(target.userId)) {
                validationFailures.push(`${label}：OJ 用户不存在`);
                missingUsers.push(label);
                continue;
            }
            const matches = recordsByUid.get(target.userId) || [];
            if (matches.length === 0) {
                validationFailures.push(`${label}：没有有效的学生绑定记录`);
                missingBindings.push(label);
                continue;
            }
            if (matches.length > 1) {
                validationFailures.push(`${label}：绑定身份不唯一（${matches.length} 条学生记录）`);
                ambiguousBindings.push(`${label}（${matches.length} 条）`);
                continue;
            }
            selectedRecords.push(matches[0]);
        }
        if (validationFailures.length > 0) {
            throw localizeErrorParameter(
                new ValidationError('users', null, validationFailures.join('；')),
                2,
                'The selected users failed validation (OJ user missing: {0}; no valid student binding: {1}; ambiguous student binding: {2}).',
                missingUsers.join('、') || '-',
                missingBindings.join('、') || '-',
                ambiguousBindings.join('、') || '-',
            );
        }

        const schoolIds = new Set(selectedRecords.map((record) => record.schoolId.toHexString()));
        if (schoolIds.size !== 1) {
            const schoolDetails = targets.map((target) => {
                const record = recordsByUid.get(target.userId)![0];
                return `${targetLabel(target)}=${record.schoolId.toHexString()}`;
            });
            throw new ValidationError('users', null, localizedErrorText`任务成员属于多个学校：${schoolDetails.join('；')}`);
        }

        records = selectedRecords;
        schoolId = records[0].schoolId;
        const recordIds = records.map((record) => record._id);

        stage = 'create_group';
        plannedGroupId = new ObjectId();
        group = await dependencies.createGroup(domainId, schoolId, groupName, createdBy, plannedGroupId);

        stage = 'add_student_membership';
        matchedStudents = await dependencies.addStudentMembership(domainId, schoolId, recordIds, userIds, group._id);
        if (matchedStudents !== records.length) {
            throw new Error(`Student membership matched ${matchedStudents}/${records.length}`);
        }

        stage = 'add_user_membership';
        matchedUsers = await dependencies.addUserMembership(userIds, group._id);
        if (matchedUsers !== userIds.length) {
            throw new Error(`User membership matched ${matchedUsers}/${userIds.length}`);
        }

        stage = 'verify_membership';
        finalStudentMembers = await dependencies.countStudentMembership(domainId, recordIds, group._id);
        if (finalStudentMembers !== records.length) {
            throw new Error(`Final student membership count ${finalStudentMembers}/${records.length}`);
        }

        stage = 'verify_user_membership';
        finalUserMembers = await dependencies.countUserMembership(userIds, group._id);
        if (finalUserMembers !== userIds.length) {
            throw new Error(`Final user membership count ${finalUserMembers}/${userIds.length}`);
        }

        const result = { group, memberCount: records.length };
        stage = 'record_success';
        await dependencies.recordSuccess(result);
        return result;
    } catch (error) {
        if (!group) {
            if (error instanceof ValidationError) throw error;
            dependencies.logError(
                stage === 'create_group'
                    ? '[krypton-userbind] task group creation failed before acknowledgement'
                    : '[krypton-userbind] task group preflight failed',
                {
                    ...structuredLogContext(),
                    error: errorMessage(error),
                },
            );
            if (stage === 'create_group' && plannedGroupId) {
                try {
                    await dependencies.deleteGroup(domainId, plannedGroupId);
                } catch (rollbackError) {
                    dependencies.logError('[krypton-userbind] task group rollback failed', {
                        ...structuredLogContext(),
                        rollbackFailures: [`delete_group: ${errorMessage(rollbackError)}`],
                    });
                    throw new SystemError('Task user group rollback failed', plannedGroupId.toHexString());
                }
                throw new SystemError('Task user group creation failed', plannedGroupId.toHexString(), stage);
            }
            throw error;
        }

        dependencies.logError('[krypton-userbind] task group creation failed', {
            ...structuredLogContext(),
            error: errorMessage(error),
        });

        const recordIds = records.map((record) => record._id);
        const rollbackResults = await Promise.allSettled([
            dependencies.removeStudentMembership(domainId, recordIds, group._id),
            dependencies.removeUserMembership(userIds, group._id),
            dependencies.deleteGroup(domainId, group._id),
        ]);
        const rollbackFailures = rollbackResults.flatMap((result, index) => {
            const operation = ['remove_student_membership', 'remove_user_membership', 'delete_group'][index];
            if (result.status === 'rejected') return [`${operation}: ${errorMessage(result.reason)}`];
            if (operation === 'delete_group' && result.value !== true) return [`${operation}: group was not deleted`];
            return [];
        });
        if (rollbackFailures.length > 0) {
            dependencies.logError('[krypton-userbind] task group rollback failed', {
                ...structuredLogContext(),
                rollbackFailures,
            });
            throw new SystemError('Task user group rollback failed', group._id.toHexString());
        }
        throw new SystemError('Task user group creation failed', group._id.toHexString(), stage);
    }
}
