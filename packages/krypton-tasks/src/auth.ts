/**
 * Three-tier permission helper for task management.
 *
 * Tier 1 — `creator`:  always allowed for tasks they personally created.
 * Tier 2 — `PERM_MANAGE_TASKS` (domain perm): can manage any task in their domain.
 * Tier 3 — `PRIV_EDIT_SYSTEM` (system priv): can manage anything anywhere.
 *
 * Usage in a handler:
 *   if (!canModifyTask(this.user, task)) throw new PermissionError(...);
 */
import { PERM, PRIV } from 'hydrooj';
import type { TaskDoc } from './types';

export function canModifyTask(
    user: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean },
    task: Pick<TaskDoc, 'createdBy'>,
): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (user.hasPerm(PERM.PERM_MANAGE_TASKS)) return true;
    if (task.createdBy === user._id) return true;
    return false;
}

export function canCreateTask(user: {
    hasPerm(p: bigint): boolean;
    hasPriv(p: number): boolean;
}): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (user.hasPerm(PERM.PERM_MANAGE_TASKS)) return true;
    if (user.hasPerm(PERM.PERM_CREATE_TASK)) return true;
    return false;
}

export function canManageAllTasks(user: {
    hasPerm(p: bigint): boolean;
    hasPriv(p: number): boolean;
}): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || user.hasPerm(PERM.PERM_MANAGE_TASKS);
}
