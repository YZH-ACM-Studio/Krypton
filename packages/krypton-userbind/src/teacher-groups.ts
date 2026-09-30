/**
 * Teacher-owned user groups. Membership stays on StudentRecord.groupIds.
 */
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ObjectId, resolveStaffSchoolScope, ValidationError } from 'hydrooj';
import type { StaffScopeActor } from 'hydrooj';
import { studentsColl } from './db';
import type { ImportGroupReport } from './model';
import {
    archiveUserGroup,
    assignStudentsToGroup,
    createUserGroup,
    deleteTeacherCreatedStudent,
    deleteUserGroup,
    getUserGroup,
    importStudentsToGroup,
    listSchools,
    listStudents,
    listTeacherGroups,
    parseRosterText,
    removeStudentsFromGroup,
    unarchiveUserGroup,
    updateUserGroup,
} from './model';
import type { School, StudentRecord, UserGroup } from './types';

const logger = new Logger('userbind.teacher-groups');

const NO_SCOPE_MESSAGE = '你还没有被加入任何学校的教师名单，请联系管理员';

export interface TeacherGroupListPayload {
    schools: Array<{ _id: string; name: string }>;
    groups: Array<{
        _id: string;
        name: string;
        schoolId: string;
        schoolName: string;
        archived: boolean;
        memberCount: number;
    }>;
    noScopeMessage: string | null;
}

export interface TeacherGroupMemberView {
    _id: string;
    studentId: string;
    realName: string;
    bound: boolean;
    deletable: boolean;
}

export interface TeacherGroupCandidateView {
    _id: string;
    studentId: string;
    realName: string;
    bound: boolean;
}

export interface TeacherGroupDetailPayload {
    group: {
        _id: string;
        name: string;
        schoolId: string;
        schoolName: string;
        archived: boolean;
    };
    members: TeacherGroupMemberView[];
    candidates: TeacherGroupCandidateView[];
    q: string;
    importReport: ImportGroupReport | null;
}

function warn(domainId: string, uid: number, stage: string, reason: string) {
    logger.warn('domain=%s uid=%s stage=%s reason=%s', domainId, uid, stage, reason);
}

function rejectNotOwned(domainId: string, actor: StaffScopeActor, stage: string, reason: string): never {
    warn(domainId, actor._id, stage, reason);
    throw new ValidationError('groupId', null, localizedErrorText`用户组不存在或不属于你`);
}

function requireSchoolName(schools: School[], schoolId: ObjectId): string {
    const school = schools.find((item) => item._id.equals(schoolId));
    if (!school) throw new ValidationError('schoolId', null, localizedErrorText`School not found`);
    return school.name;
}

function isBound(student: StudentRecord): boolean {
    return typeof student.boundUserId === 'number';
}

function isDeletable(student: StudentRecord, actorUid: number, ownedGroupIds: ObjectId[]): boolean {
    if (student.createdBy !== actorUid) return false;
    if (student.boundUserId !== null) return false;
    return student.groupIds.every((groupId) => ownedGroupIds.some((ownedId) => ownedId.equals(groupId)));
}

// listStudents defaults to 100 rows. Clear and the detail roster need every member.
async function listGroupMembers(domainId: string, groupId: ObjectId): Promise<StudentRecord[]> {
    const pageSize = 100;
    const members: StudentRecord[] = [];
    let skip = 0;
    for (;;) {
        const page = await listStudents(domainId, { groupId, skip, limit: pageSize });
        if (page.docs.length === 0) break;
        members.push(...page.docs);
        skip += page.docs.length;
        if (skip >= page.total || page.docs.length < pageSize) break;
    }
    return members;
}

async function countMembers(domainId: string, groupIds: ObjectId[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (groupIds.length === 0) return counts;
    const wanted = new Set(groupIds.map((groupId) => groupId.toHexString()));
    const docs = await studentsColl.find({ domainId, groupIds: { $in: groupIds } }).toArray();
    for (const doc of docs) {
        const seen = new Set<string>();
        for (const groupId of doc.groupIds) {
            const hex = groupId.toHexString();
            if (seen.has(hex) || !wanted.has(hex)) continue;
            seen.add(hex);
            counts.set(hex, (counts.get(hex) || 0) + 1);
        }
    }
    return counts;
}

export async function loadOwnedGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId, stage = 'load'): Promise<UserGroup> {
    const group = await getUserGroup(domainId, groupId);
    if (!group) rejectNotOwned(domainId, actor, stage, 'group_missing');
    if (group.ownerUid !== actor._id) rejectNotOwned(domainId, actor, stage, 'not_owner');
    const scope = await resolveStaffSchoolScope(domainId, actor);
    if (!scope.some((schoolId) => schoolId.equals(group.schoolId))) rejectNotOwned(domainId, actor, stage, 'school_out_of_scope');
    return group;
}

export async function createTeacherGroup(domainId: string, actor: StaffScopeActor, schoolId: ObjectId, name: string): Promise<UserGroup> {
    const scope = await resolveStaffSchoolScope(domainId, actor);
    if (!scope.some((candidate) => candidate.equals(schoolId))) {
        warn(domainId, actor._id, 'create', 'school_out_of_scope');
        throw new ValidationError('schoolId', null, localizedErrorText`你不能在这所学校建用户组`);
    }
    return createUserGroup(domainId, schoolId, name, actor._id, new ObjectId(), { ownerUid: actor._id });
}

export async function renameTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId, name: string): Promise<void> {
    await loadOwnedGroup(domainId, actor, groupId, 'rename');
    await updateUserGroup(domainId, groupId, { name });
}

export async function archiveTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId): Promise<void> {
    await loadOwnedGroup(domainId, actor, groupId, 'archive');
    await archiveUserGroup(domainId, groupId);
}

export async function unarchiveTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId): Promise<void> {
    await loadOwnedGroup(domainId, actor, groupId, 'unarchive');
    await unarchiveUserGroup(domainId, groupId);
}

export async function deleteTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId): Promise<void> {
    await loadOwnedGroup(domainId, actor, groupId, 'delete');
    await deleteUserGroup(domainId, groupId);
}

export async function clearTeacherGroupMembers(domainId: string, actor: StaffScopeActor, groupId: ObjectId): Promise<number> {
    await loadOwnedGroup(domainId, actor, groupId, 'clear');
    const members = await listGroupMembers(domainId, groupId);
    await removeStudentsFromGroup(
        domainId,
        groupId,
        members.map((student) => student._id),
    );
    return members.length;
}

export async function addToTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId, recordIds: ObjectId[]): Promise<void> {
    const group = await loadOwnedGroup(domainId, actor, groupId, 'add');
    if (recordIds.length === 0) return;
    // assignStudentsToGroup silently skips other schools, so reject the whole add first.
    const found = await studentsColl.find({ domainId, _id: { $in: recordIds }, schoolId: group.schoolId }).toArray();
    if (found.length !== recordIds.length) {
        warn(domainId, actor._id, 'add', 'student_school_mismatch');
        throw new ValidationError('studentRecordIds', null, localizedErrorText`部分学生不属于该用户组所在学校，请刷新后重试`);
    }
    await assignStudentsToGroup(domainId, groupId, recordIds);
}

export async function removeFromTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId, recordIds: ObjectId[]): Promise<void> {
    await loadOwnedGroup(domainId, actor, groupId, 'remove');
    await removeStudentsFromGroup(domainId, groupId, recordIds);
}

export async function importToTeacherGroup(domainId: string, actor: StaffScopeActor, groupId: ObjectId, text: string): Promise<ImportGroupReport> {
    await loadOwnedGroup(domainId, actor, groupId, 'import');
    const rows = parseRosterText(text);
    return importStudentsToGroup(domainId, groupId, rows, actor._id);
}

export async function deleteOwnStudent(domainId: string, actor: StaffScopeActor, recordId: ObjectId): Promise<void> {
    const owned = await listTeacherGroups(domainId, actor._id);
    try {
        await deleteTeacherCreatedStudent(
            domainId,
            recordId,
            actor._id,
            owned.map((group) => group._id),
        );
    } catch (error) {
        if (error instanceof ValidationError) warn(domainId, actor._id, 'delete_student', 'delete_student_rejected');
        throw error;
    }
}

export async function searchSchoolStudents(domainId: string, actor: StaffScopeActor, groupId: ObjectId, q: string): Promise<StudentRecord[]> {
    const group = await loadOwnedGroup(domainId, actor, groupId, 'search');
    const query = q.trim();
    if (!query) return [];
    const page = await listStudents(domainId, { schoolId: group.schoolId, query, limit: 50 });
    return page.docs.filter((student) => !student.groupIds.some((id) => id.equals(group._id)));
}

export async function buildTeacherGroupList(domainId: string, actor: StaffScopeActor): Promise<TeacherGroupListPayload> {
    const scope = await resolveStaffSchoolScope(domainId, actor);
    if (scope.length === 0) {
        return { schools: [], groups: [], noScopeMessage: NO_SCOPE_MESSAGE };
    }
    const schools = await listSchools(domainId);
    const owned = await listTeacherGroups(domainId, actor._id);
    const visible = owned.filter((group) => scope.some((schoolId) => schoolId.equals(group.schoolId)));
    const counts = await countMembers(
        domainId,
        visible.map((group) => group._id),
    );
    return {
        schools: scope.map((schoolId) => ({
            _id: schoolId.toHexString(),
            name: requireSchoolName(schools, schoolId),
        })),
        groups: visible.map((group) => ({
            _id: group._id.toHexString(),
            name: group.name,
            schoolId: group.schoolId.toHexString(),
            schoolName: requireSchoolName(schools, group.schoolId),
            archived: group.archivedAt != null,
            memberCount: counts.get(group._id.toHexString()) || 0,
        })),
        noScopeMessage: null,
    };
}

export async function buildTeacherGroupDetail(
    domainId: string,
    actor: StaffScopeActor,
    groupId: ObjectId,
    q: string,
    importReport: ImportGroupReport | null,
): Promise<TeacherGroupDetailPayload> {
    const group = await loadOwnedGroup(domainId, actor, groupId, 'detail');
    const query = (q || '').trim();
    const [schools, members, owned, candidates] = await Promise.all([
        listSchools(domainId),
        listGroupMembers(domainId, groupId),
        listTeacherGroups(domainId, actor._id),
        query ? searchSchoolStudents(domainId, actor, groupId, query) : Promise.resolve([]),
    ]);
    const ownedIds = owned.map((item) => item._id);
    return {
        group: {
            _id: group._id.toHexString(),
            name: group.name,
            schoolId: group.schoolId.toHexString(),
            schoolName: requireSchoolName(schools, group.schoolId),
            archived: group.archivedAt != null,
        },
        members: members.map((student) => ({
            _id: student._id.toHexString(),
            studentId: student.studentId,
            realName: student.realName,
            bound: isBound(student),
            deletable: isDeletable(student, actor._id, ownedIds),
        })),
        candidates: candidates.map((student) => ({
            _id: student._id.toHexString(),
            studentId: student.studentId,
            realName: student.realName,
            bound: isBound(student),
        })),
        q: query,
        importReport,
    };
}
