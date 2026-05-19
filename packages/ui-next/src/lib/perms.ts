// Mirror of PRIV bit values from packages/common/permission.ts.
// Duplicated here so ui-next stays standalone (no cross-package import).
// Keep in sync if PRIV is renumbered upstream.
export const PRIV = {
  PRIV_NONE: 0,
  PRIV_EDIT_SYSTEM: 1 << 0,
  PRIV_SET_PERM: 1 << 1,
  PRIV_USER_PROFILE: 1 << 2,
  PRIV_REGISTER_USER: 1 << 3,
  PRIV_READ_PROBLEM_DATA: 1 << 4,
  PRIV_READ_PROBLEM_DATA_SELF: 1 << 5,
  PRIV_READ_RECORD_CODE: 1 << 7,
  PRIV_VIEW_HIDDEN_RECORD: 1 << 8,
  PRIV_JUDGE: 1 << 9,
  PRIV_CREATE_DOMAIN: 1 << 10,
  PRIV_VIEW_ALL_DOMAIN: 1 << 11,
  PRIV_MANAGE_ALL_DOMAIN: 1 << 12,
  PRIV_REJUDGE: 1 << 13,
  PRIV_VIEW_USER_SECRET: 1 << 14,
  PRIV_VIEW_JUDGE_STATISTICS: 1 << 15,
  PRIV_UNLIMITED_ACCESS: 1 << 16,
  PRIV_VIEW_SYSTEM_NOTIFICATION: 1 << 19,
  PRIV_SEND_MESSAGE: 1 << 20,
  PRIV_CREATE_FILE: 1 << 21,
  PRIV_UNLIMITED_QUOTA: 1 << 22,
  PRIV_DELETE_FILE: 1 << 23,
  PRIV_MOD_BADGE: 1 << 24,
} as const;

export type PrivBit = (typeof PRIV)[keyof typeof PRIV];

export function hasPriv(userPriv: number, ...bits: PrivBit[]): boolean {
  if (!userPriv) return false;
  return bits.every((bit) => (userPriv & bit) === bit);
}

export function hasAnyPriv(userPriv: number, ...bits: PrivBit[]): boolean {
  if (!userPriv) return false;
  return bits.some((bit) => (userPriv & bit) === bit);
}

export function isSystemAdmin(userPriv: number): boolean {
  return hasPriv(userPriv, PRIV.PRIV_EDIT_SYSTEM);
}

export function canAccessDomainAdmin(userPriv: number): boolean {
  return hasAnyPriv(userPriv, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_MANAGE_ALL_DOMAIN);
}
