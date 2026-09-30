import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';
import type { StudentDirectoryGroup, StudentDirectorySchool } from '../service/student-directory';
import { studentDirectory } from '../service/student-directory';
import type { StaffScopeActor } from './staff-school-scope';
import { resolveStaffSchoolScope } from './staff-school-scope';

const logger = new Logger('user-group-attach');

export interface AttachActor extends StaffScopeActor {}

export interface GroupRefView {
    _id: string;
    name: string | null;
    schoolName: string | null;
    state: 'active' | 'archived' | 'deleted';
    kind: 'own' | 'school' | 'other-teacher' | 'unknown';
    attachable: boolean;
}

interface AttachSnapshot {
    groups: Map<string, StudentDirectoryGroup>;
    schools: Map<string, StudentDirectorySchool>;
    scope: Set<string>;
}

/** 每次调用都重新读目录和学校范围，不跨调用缓存。不受限执行者也走同一路径。 */
async function loadSnapshot(domainId: string, actor: AttachActor): Promise<AttachSnapshot> {
    const directory = studentDirectory();
    const groups = await directory.listUserGroups(domainId);
    const schools = await directory.listSchools(domainId);
    const scopeIds = await resolveStaffSchoolScope(domainId, actor);
    return {
        groups: new Map(groups.map((group) => [group._id.toHexString(), group])),
        schools: new Map(schools.map((school) => [school._id.toHexString(), school])),
        scope: new Set(scopeIds.map((schoolId) => schoolId.toHexString())),
    };
}

function ownerFieldMissing(group: StudentDirectoryGroup): boolean {
    return group.ownerUid === undefined;
}

function isArchived(group: StudentDirectoryGroup): boolean {
    return group.archivedAt !== undefined && group.archivedAt !== null;
}

function schoolInScope(group: StudentDirectoryGroup, scope: ReadonlySet<string>): boolean {
    return group.schoolId instanceof ObjectId && scope.has(group.schoolId.toHexString());
}

function groupKind(group: StudentDirectoryGroup, actorId: number): GroupRefView['kind'] {
    if (ownerFieldMissing(group)) return 'school';
    if (group.ownerUid === actorId) return 'own';
    return 'other-teacher';
}

function isAttachable(group: StudentDirectoryGroup, snapshot: AttachSnapshot, actor: AttachActor, unrestricted: boolean): boolean {
    if (unrestricted) return true;
    if (isArchived(group)) return false;
    if (!schoolInScope(group, snapshot.scope)) return false;
    if (group.ownerUid === actor._id) return true;
    if (ownerFieldMissing(group) && group.teacherAttachable === true) return true;
    return false;
}

function schoolNameOf(snapshot: AttachSnapshot, group: StudentDirectoryGroup): string | null {
    if (!(group.schoolId instanceof ObjectId)) return null;
    const school = snapshot.schools.get(group.schoolId.toHexString());
    if (!school) return null;
    return school.name;
}

function viewForGroup(group: StudentDirectoryGroup, snapshot: AttachSnapshot, actor: AttachActor, unrestricted: boolean): GroupRefView {
    return {
        _id: group._id.toHexString(),
        name: group.name,
        schoolName: schoolNameOf(snapshot, group),
        state: isArchived(group) ? 'archived' : 'active',
        kind: groupKind(group, actor._id),
        attachable: isAttachable(group, snapshot, actor, unrestricted),
    };
}

function deletedView(id: ObjectId): GroupRefView {
    return {
        _id: id.toHexString(),
        name: null,
        schoolName: null,
        state: 'deleted',
        kind: 'unknown',
        attachable: false,
    };
}

/** 学校名空串在前，然后学校名、组名、_id 十六进制。 */
function compareGroupRefViews(left: GroupRefView, right: GroupRefView): number {
    const leftSchool = left.schoolName ?? '';
    const rightSchool = right.schoolName ?? '';
    if (leftSchool < rightSchool) return -1;
    if (leftSchool > rightSchool) return 1;
    const leftName = left.name ?? '';
    const rightName = right.name ?? '';
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    if (left._id < right._id) return -1;
    if (left._id > right._id) return 1;
    return 0;
}

function rejectInvalidGroupId(field: string): never {
    logger.warn('User group attach rejected stage=%s reason=%s field=%s', 'parseGroupIdList', 'invalid-group-id', field);
    throw new ValidationError(field, null, localizedErrorText`用户组参数无效`);
}

function rejectDeletedGroup(domainId: string, actor: AttachActor, field: string, groupId: string): never {
    logger.warn(
        'User group attach rejected domain=%s uid=%d stage=%s reason=%s group=%s',
        domainId,
        actor._id,
        'assertGroupsAttachable',
        'group-deleted',
        groupId,
    );
    throw new ValidationError(field, null, localizedErrorText`所选用户组已被删除，请先移除后再保存`);
}

function rejectUnattachableGroup(domainId: string, actor: AttachActor, field: string, group: StudentDirectoryGroup): never {
    logger.warn(
        'User group attach rejected domain=%s uid=%d stage=%s reason=%s group=%s',
        domainId,
        actor._id,
        'assertGroupsAttachable',
        'group-not-attachable',
        group._id.toHexString(),
    );
    throw new ValidationError(
        field,
        null,
        localizedErrorText`你不能使用用户组「${group.name}」，只能使用自己的用户组或管理员开放给老师的本校用户组`,
    );
}

export function parseGroupIdList(field: string, raw: readonly string[] | undefined): ObjectId[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) rejectInvalidGroupId(field);
    const seen = new Set<string>();
    const ids: ObjectId[] = [];
    for (const value of raw) {
        if (typeof value !== 'string') rejectInvalidGroupId(field);
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (!ObjectId.isValid(trimmed) || new ObjectId(trimmed).toHexString() !== trimmed.toLowerCase()) rejectInvalidGroupId(field);
        const id = new ObjectId(trimmed);
        const hex = id.toHexString();
        if (seen.has(hex)) continue;
        seen.add(hex);
        ids.push(id);
    }
    return ids;
}

export async function listAttachableGroups(domainId: string, actor: AttachActor, opts: { unrestricted: boolean }): Promise<GroupRefView[]> {
    const snapshot = await loadSnapshot(domainId, actor);
    const views: GroupRefView[] = [];
    for (const group of snapshot.groups.values()) {
        const view = viewForGroup(group, snapshot, actor, opts.unrestricted);
        if (!view.attachable) continue;
        views.push(view);
    }
    views.sort(compareGroupRefViews);
    return views;
}

export async function describeGroupRefs(
    domainId: string,
    actor: AttachActor,
    ids: readonly ObjectId[],
    opts: { unrestricted: boolean },
): Promise<GroupRefView[]> {
    const snapshot = await loadSnapshot(domainId, actor);
    const views: GroupRefView[] = [];
    for (const id of ids) {
        const group = snapshot.groups.get(id.toHexString());
        views.push(group ? viewForGroup(group, snapshot, actor, opts.unrestricted) : deletedView(id));
    }
    return views;
}

export async function assertGroupsAttachable(
    domainId: string,
    actor: AttachActor,
    opts: { field: string; previous: readonly ObjectId[]; next: readonly ObjectId[]; unrestricted: boolean },
): Promise<void> {
    const snapshot = await loadSnapshot(domainId, actor);
    const previous = new Set(opts.previous.map((id) => id.toHexString()));
    const nextGroups: Array<{ hex: string; group: StudentDirectoryGroup }> = [];
    for (const id of opts.next) {
        const hex = id.toHexString();
        const group = snapshot.groups.get(hex);
        if (!group) rejectDeletedGroup(domainId, actor, opts.field, hex);
        nextGroups.push({ hex, group });
    }
    for (const item of nextGroups) {
        if (previous.has(item.hex)) continue;
        if (!isAttachable(item.group, snapshot, actor, opts.unrestricted)) rejectUnattachableGroup(domainId, actor, opts.field, item.group);
    }
}
