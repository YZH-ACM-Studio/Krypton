export interface TaskCapabilityUser {
  hasPriv?: (privilege: any) => boolean;
  hasPerm?: (permission: any) => boolean;
}

export interface TaskCapabilityInput {
  user?: TaskCapabilityUser | null;
  editSystemPriv: any;
  createTaskPerm: any;
  manageTasksPerm: any;
  onError: (error: unknown) => void;
}

/**
 * Resolve the main-sidebar task-management affordance from the same three
 * permissions enforced by krypton-tasks. Routes remain the authorization
 * boundary; this capability only decides whether the entry is rendered.
 */
export function resolveTaskManagementCapability({
  user,
  editSystemPriv,
  createTaskPerm,
  manageTasksPerm,
  onError,
}: TaskCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function') {
    onError(new TypeError('task capability user.hasPriv is unavailable'));
    return false;
  }
  try {
    if (user.hasPriv(editSystemPriv)) return true;
  } catch (error) {
    onError(error);
    return false;
  }
  if (typeof user.hasPerm !== 'function') {
    onError(new TypeError('task capability user.hasPerm is unavailable'));
    return false;
  }
  try {
    return !!user.hasPerm(manageTasksPerm) || !!user.hasPerm(createTaskPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
