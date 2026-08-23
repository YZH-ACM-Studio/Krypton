export interface RedemptionCapabilityUser {
  hasPriv?: (privilege: unknown) => boolean;
  hasPerm?: (permission: unknown) => boolean;
}

export interface RedemptionCapabilityInput {
  user?: RedemptionCapabilityUser | null;
  editSystemPriv: unknown;
  createRedemptionPerm: unknown;
  onError: (error: unknown) => void;
}

export function resolveRedemptionManageCapability({
  user,
  editSystemPriv,
  createRedemptionPerm,
  onError,
}: RedemptionCapabilityInput): boolean {
  if (!user) return false;
  if (typeof user.hasPriv !== 'function' || typeof user.hasPerm !== 'function') {
    onError(new TypeError('redemption permission methods are unavailable'));
    return false;
  }
  try {
    return user.hasPriv(editSystemPriv) || user.hasPerm(createRedemptionPerm);
  } catch (error) {
    onError(error);
    return false;
  }
}
