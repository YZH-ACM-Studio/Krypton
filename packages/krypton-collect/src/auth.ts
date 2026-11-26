/**
 * Permission helpers for file collections.
 *
 * - `PERM_CREATE_COLLECT` (domain perm): create collections.
 * - `PERM_MANAGE_COLLECT` (domain perm): view/manage every collection in the domain.
 * - `PRIV_EDIT_SYSTEM` (system priv): bypass.
 *
 * Owners may edit their own requests. Explicit `collaboratorUids` may view,
 * pack, and nudge, but cannot edit rules. Runtime never checks `role === 'teacher'`.
 * Signing requests require system privilege to create/edit; only explicitly
 * named collaborators with collection permission share read access.
 *
 * Usage in a handler:
 *   if (!canEditCollect(this.user, request)) throw new CollectForbiddenError(...);
 */
import { PERM, PRIV } from 'hydrooj';
import { collectKind } from './types';
import type { CollectRequestDoc } from './types';

interface CollectAuthUser { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean }

export function canManageAllCollect(user: CollectAuthUser): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || user.hasPerm(PERM.PERM_MANAGE_COLLECT);
}

export function canCreateCollect(user: CollectAuthUser, kind: 'files' | 'signing' = 'files'): boolean {
    if (collectKind({ kind }) === 'signing') return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    if (canManageAllCollect(user)) return true;
    if (user.hasPerm(PERM.PERM_CREATE_COLLECT)) return true;
    return false;
}

export function canEditCollect(
    user: CollectAuthUser,
    request: Pick<CollectRequestDoc, 'ownerUid' | 'kind'>,
): boolean {
    if (collectKind(request) === 'signing') return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    if (canManageAllCollect(user)) return true;
    if (request.ownerUid === user._id) return true;
    return false;
}

export function canViewCollect(
    user: CollectAuthUser,
    request: Pick<CollectRequestDoc, 'ownerUid' | 'collaboratorUids' | 'kind'>,
): boolean {
    if (canEditCollect(user, request)) return true;
    if (!request.collaboratorUids.includes(user._id)) return false;
    return canCreateCollect(user);
}
