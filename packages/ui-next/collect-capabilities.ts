export interface CollectCapabilityUser {
  hasPriv?: (privilege: any) => boolean;
  hasPerm?: (permission: any) => boolean;
}

export interface CollectCapabilityInput {
  user?: CollectCapabilityUser | null;
  editSystemPriv: any;
  createCollectPerm: any;
  manageCollectPerm: any;
  onError: (error: unknown) => void;
}

/**
 * Resolve the main-sidebar collect-management affordance from the same three
 * permissions enforced by krypton-collect. Routes remain the authorization
 * boundary; this capability only decides whether the entry is rendered.
 */
export function resolveCollectManagementCapability({
  user,
  editSystemPriv,
  createCollectPerm,
  manageCollectPerm,
  onError,
}: CollectCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function') {
    onError(new TypeError('collect capability user.hasPriv is unavailable'));
    return false;
  }
  try {
    if (user.hasPriv(editSystemPriv)) return true;
  } catch (error) {
    onError(error);
    return false;
  }
  if (typeof user.hasPerm !== 'function') {
    onError(new TypeError('collect capability user.hasPerm is unavailable'));
    return false;
  }
  try {
    return !!user.hasPerm(manageCollectPerm) || !!user.hasPerm(createCollectPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
