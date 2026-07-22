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
