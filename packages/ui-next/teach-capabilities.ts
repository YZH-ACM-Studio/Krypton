export interface TeachCapabilityUser {
  hasPriv?: (privilege: unknown) => boolean;
  hasPerm?: (permission: unknown) => boolean;
}

export interface TeachCapabilityInput {
  user?: TeachCapabilityUser | null;
  editSystemPriv: unknown;
  createContestPerm: unknown;
  createHomeworkPerm: unknown;
  createTrainingPerm: unknown;
  onError: (error: unknown) => void;
}

/**
 * Sidebar「教学」entry. PRIV_EDIT_SYSTEM or any of contest, homework, and
 * training creation. Missing methods or thrown lookups fail closed; routes
 * remain the authorization boundary.
 */
export function resolveTeachCapability({
  user,
  editSystemPriv,
  createContestPerm,
  createHomeworkPerm,
  createTrainingPerm,
  onError,
}: TeachCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function' || typeof user.hasPerm !== 'function') {
    onError(new TypeError('teach capability permission methods are unavailable'));
    return false;
  }
  try {
    return user.hasPriv(editSystemPriv)
      || user.hasPerm(createContestPerm)
      || user.hasPerm(createHomeworkPerm)
      || user.hasPerm(createTrainingPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
