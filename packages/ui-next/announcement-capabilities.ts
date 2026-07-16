export interface AnnouncementCapabilityUser {
  hasPriv?: (privilege: any) => boolean;
  hasPerm?: (permission: any) => boolean;
}

export interface AnnouncementCapabilityInput {
  user?: AnnouncementCapabilityUser | null;
  editSystemPriv: any;
  editDomainPerm: any;
  onError: (error: unknown) => void;
}

/**
 * Resolve the main-sidebar announcement affordance from the same two facts
 * enforced by krypton-announcement handlers. This is UI-only; routes still
 * perform their own permission checks.
 */
export function resolveAnnouncementManagementCapability({ user, editSystemPriv, editDomainPerm, onError }: AnnouncementCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function') {
    onError(new TypeError('announcement capability user.hasPriv is unavailable'));
    return false;
  }
  try {
    if (user.hasPriv(editSystemPriv)) return true;
  } catch (error) {
    onError(error);
    return false;
  }
  if (typeof user.hasPerm !== 'function') {
    onError(new TypeError('announcement capability user.hasPerm is unavailable'));
    return false;
  }
  try {
    return !!user.hasPerm(editDomainPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
