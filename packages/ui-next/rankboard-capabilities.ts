export interface RankboardCapabilityUser {
  hasPriv?: (privilege: any) => boolean;
  hasPerm?: (permission: any) => boolean;
}

export interface RankboardCapabilityInput {
  user?: RankboardCapabilityUser | null;
  domainId: string;
  editSystemPriv: any;
  importPerm: any;
  managePerm: any;
  /** Required so fail-closed errors can never become silent. */
  onError: (error: unknown) => void;
}

export interface RankboardCapabilities {
  canImportRankboard: boolean;
  canManageRankboard: boolean;
}

const NO_RANKBOARD_CAPABILITIES: RankboardCapabilities = {
  canImportRankboard: false,
  canManageRankboard: false,
};

/**
 * Compute the rankboard affordances from the same scope and permission facts
 * used by the server handlers. The function is deliberately fail-closed:
 * bootstrap rendering must never turn a missing handler or permission method
 * into a management link.
 */
export function resolveRankboardCapabilities({
  user,
  domainId,
  editSystemPriv,
  importPerm,
  managePerm,
  onError,
}: RankboardCapabilityInput): RankboardCapabilities {
  if (!user || typeof user.hasPriv !== 'function') return { ...NO_RANKBOARD_CAPABILITIES };
  try {
    if (user.hasPriv(editSystemPriv)) {
      return { canImportRankboard: true, canManageRankboard: true };
    }
    // Rankboard is a system-domain singleton. A domain owner has PERM_ALL
    // in their own domain, which must not leak into this capability.
    if (domainId !== 'system' || typeof user.hasPerm !== 'function') {
      return { ...NO_RANKBOARD_CAPABILITIES };
    }
    const canManageRankboard = !!user.hasPerm(managePerm);
    const canImportRankboard = canManageRankboard || !!user.hasPerm(importPerm);
    return { canImportRankboard, canManageRankboard };
  } catch (error) {
    onError(error);
    return { ...NO_RANKBOARD_CAPABILITIES };
  }
}
