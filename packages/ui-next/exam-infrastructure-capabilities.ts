export interface ExamInfrastructureCapabilityUser {
  hasPriv?: (privilege: unknown) => boolean;
  hasPerm?: (permission: unknown) => boolean;
}

export interface ExamInfrastructureCapabilityInput {
  user?: ExamInfrastructureCapabilityUser | null;
  editSystemPriv: unknown;
  createExamEventPerm: unknown;
  manageExamInfrastructurePerm: unknown;
  onError: (error: unknown) => void;
}

/**
 * Resolve only the main-sidebar affordance. Every route independently repeats
 * the school, ownership and revision checks at the Hydro boundary.
 */
export function resolveExamInfrastructureCapability({
  user,
  editSystemPriv,
  createExamEventPerm,
  manageExamInfrastructurePerm,
  onError,
}: ExamInfrastructureCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function' || typeof user.hasPerm !== 'function') {
    onError(new TypeError('exam infrastructure permission methods are unavailable'));
    return false;
  }
  try {
    return user.hasPriv(editSystemPriv) || user.hasPerm(manageExamInfrastructurePerm) || user.hasPerm(createExamEventPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
