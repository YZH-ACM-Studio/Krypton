export interface DomainPermissionCapabilityUser {
  hasPerm?: (permission: any) => boolean;
}

export function resolveDomainPermissionManagementCapability(input: {
  user?: DomainPermissionCapabilityUser | null;
  editDomainPerm: any;
  onError: (error: unknown) => void;
}): boolean {
  const { user, editDomainPerm, onError } = input;
  if (!user) return false;
  if (typeof user.hasPerm !== 'function') {
    onError(new TypeError('domain permission capability user.hasPerm is unavailable'));
    return false;
  }
  try {
    return !!user.hasPerm(editDomainPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}

export interface DiscussionCapabilityUser {
  hasPriv?: (privilege: unknown) => boolean;
  hasPerm?: (permission: unknown) => boolean;
}

export interface DiscussionCapabilityInput {
  user?: DiscussionCapabilityUser | null;
  editSystemPriv: unknown;
  viewPerm: unknown;
  editPerm: unknown;
  createPerm: unknown;
  onError: (error: unknown) => void;
}

/**
 * Discussion entry visibility. System edit, or any of view, edit, and create.
 * Missing methods or thrown lookups fail closed; routes stay the authorization boundary.
 */
export function resolveDiscussionCapability({
  user,
  editSystemPriv,
  viewPerm,
  editPerm,
  createPerm,
  onError,
}: DiscussionCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function' || typeof user.hasPerm !== 'function') {
    onError(new TypeError('discussion capability permission methods are unavailable'));
    return false;
  }
  try {
    return user.hasPriv(editSystemPriv)
      || user.hasPerm(viewPerm)
      || user.hasPerm(editPerm)
      || user.hasPerm(createPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
