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

/**
 * Best-effort gate for admin-ish UI affordances against the current user.
 * - `systemAdmin`: must hold PRIV_EDIT_SYSTEM.
 * - `domainAdmin`: holds PRIV_EDIT_SYSTEM, PRIV_MANAGE_ALL_DOMAIN, or the
 *   bootstrap-side `role === 'root'`. Custom roles with PERM_EDIT_DOMAIN are
 *   not represented in the bootstrap; users with those roles still see admin
 *   pages directly but won't get the entry chip — acceptable for now.
 * - omitted: visible to anyone (signed in or not).
 */
export type AdminAccessLevel = 'systemAdmin' | 'domainAdmin';

export function canSeeAdminAffordance(
  user: { priv: number; role?: string; signedIn?: boolean },
  required?: AdminAccessLevel,
): boolean {
  if (!required) return true;
  if (required === 'systemAdmin') return isSystemAdmin(user.priv);
  if (required === 'domainAdmin') {
    return canAccessDomainAdmin(user.priv) || user.role === 'root';
  }
  return false;
}

/**
 * Robust BigInt parser. Handles the Hydro "BigInt::<digits>" string
 * serialization (see packages/ui-default/backendlib/template.ts) as well as
 * plain bigints, numbers, and decimal strings. Falls back to 0n on garbage.
 *
 * Permission bits (domain PERM, BigInt) and similar large values arrive over
 * the bootstrap payload as either:
 *   - native bigint (rare, only if templates emit raw JSON)
 *   - "BigInt::3579258398816786743425" string (typical)
 *   - plain decimal string "12345"
 *   - plain number (small values)
 */
/** Count set bits ("popcount") in a bigint. Used to summarise perm masks. */
export function bigIntPopcount(value: bigint): number {
  if (value <= 0n) return 0;
  let count = 0;
  let v = value;
  while (v > 0n) {
    if (v & 1n) count++;
    v >>= 1n;
  }
  return count;
}

/**
 * Integer log2 of a single-bit bigint. The Hydro domain_permission POST
 * handler reads each form value as a bit *index*, then does `1n << index`
 * to reconstruct the perm bit. So when we send checkbox values we must
 * also send indices, not the raw bit value.
 *
 * Assumes `value` has exactly one bit set (which is always true for
 * built-in PERM constants). Returns 0 for non-positive input.
 */
export function bigIntLog2(value: bigint): number {
  if (value <= 0n) return 0;
  let count = 0;
  let v = value;
  while (v > 1n) {
    v >>= 1n;
    count++;
  }
  return count;
}

export function parseBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (value == null) return 0n;
  const raw = String(value).trim();
  if (!raw) return 0n;
  const stripped = raw.startsWith('BigInt::') ? raw.slice('BigInt::'.length) : raw;
  // Allow optional sign + digits only — BigInt() throws on anything else.
  if (!/^-?\d+$/.test(stripped)) return 0n;
  try {
    return BigInt(stripped);
  } catch {
    return 0n;
  }
}
