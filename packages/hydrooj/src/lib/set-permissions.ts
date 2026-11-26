import { readStoredSetConfig, resolveSetPermissions, type SetPermissions } from '@hydrooj/common';
import type { Tdoc } from '../interface';
import { localizedErrorText, ValidationError } from '../error';
import { studentDirectory } from '../service/student-directory';
import type { TeachActor } from './teach-permissions';

export function isSetManager(tdoc: Tdoc, actor: TeachActor): boolean {
    const { canManageTeachContainer } = require('./teach-permissions') as typeof import('./teach-permissions');
    const config = readStoredSetConfig(tdoc);
    return canManageTeachContainer(actor, config.purpose === 'homework' ? 'homework' : 'exam', tdoc);
}

export async function setPermissionsFor(tdoc: Tdoc, uid: number): Promise<SetPermissions | null> {
    if (!tdoc.setConfig) return null;
    const policy = readStoredSetConfig(tdoc).settings.authorization;
    if (!policy) return null;
    const student = policy.groups.length ? await studentDirectory().findStudentByUserId(tdoc.domainId, uid) : null;
    return resolveSetPermissions(policy, student?.groupIds.map((id) => id.toHexString()) ?? []);
}

export type SetCapability = 'view' | 'answer' | 'selfRecords' | 'recordsList' | 'recordDetails' | 'scoreboard';

export async function canUseSetCapability(tdoc: Tdoc, actor: TeachActor, capability: SetCapability, now = new Date()): Promise<boolean> {
    if (!tdoc.setConfig || !readStoredSetConfig(tdoc).settings.authorization || isSetManager(tdoc, actor)) return true;
    const permissions = await setPermissionsFor(tdoc, actor._id);
    if (!permissions) return true;
    if (tdoc.endAt && now >= tdoc.endAt && !permissions.afterEnd) return false;
    if (capability === 'view') return permissions.problems !== 'hidden';
    if (capability === 'answer') return permissions.problems === 'answer';
    if (capability === 'scoreboard') return permissions.scoreboard;
    if (capability === 'recordsList') return permissions.records !== 'self';
    if (capability === 'recordDetails') return permissions.records === 'details';
    return true;
}

export async function assertSetCapability(tdoc: Tdoc, actor: TeachActor, capability: SetCapability) {
    if (await canUseSetCapability(tdoc, actor, capability)) return;
    throw new ValidationError('authorization', null, localizedErrorText`当前用户组没有这项题目集权限。`);
}

export async function assertSetDiscussion(tdoc: Tdoc, actor: TeachActor) {
    if (!tdoc.setConfig || isSetManager(tdoc, actor)) return;
    if (readStoredSetConfig(tdoc).settings.experience?.discussion === false) { throw new ValidationError('discussion', null, localizedErrorText`本题目集未开放讨论区。`); }
    await assertSetCapability(tdoc, actor, 'view');
}
