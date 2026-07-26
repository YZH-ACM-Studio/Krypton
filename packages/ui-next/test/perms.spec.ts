// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canAccessDomainAdmin,
  canSeeAdminAffordance,
  hasAnyPriv,
  hasPriv,
  isSystemAdmin,
  PRIV,
} from '../src/lib/perms.ts';
import type { AdminAccessLevel } from '../src/lib/perms.ts';

describe('pRIV bit map', () => {
  it('anchors the sentinel and boundary bits', () => {
    expect(PRIV.PRIV_NONE).to.equal(0);
    expect(PRIV.PRIV_EDIT_SYSTEM).to.equal(1);
    expect(PRIV.PRIV_SET_PERM).to.equal(2);
    expect(PRIV.PRIV_MOD_BADGE).to.equal(1 << 24);
  });

  it('keeps every non-zero priv a distinct single bit', () => {
    const bits = Object.values(PRIV).filter((value) => value !== 0);
    // No duplicates: two privs sharing a bit would silently grant each other.
    expect(new Set(bits).size).to.equal(bits.length);
    for (const bit of bits) {
      expect(bit).to.be.greaterThan(0);
      // Power-of-two check: exactly one bit set.
      expect(bit & (bit - 1)).to.equal(0);
    }
  });

  it('mirrors upstream numbering gaps instead of packing bits', () => {
    // Bits 6, 17 and 18 are intentionally unused (removed upstream);
    // renumbering here would desync stored priv values.
    const bits = new Set<number>(Object.values(PRIV));
    expect(bits.has(1 << 6)).to.equal(false);
    expect(bits.has(1 << 17)).to.equal(false);
    expect(bits.has(1 << 18)).to.equal(false);
    expect(bits.has(1 << 19)).to.equal(true);
  });
});

describe('hasPriv', () => {
  it('requires every requested bit to be present', () => {
    const priv = PRIV.PRIV_EDIT_SYSTEM | PRIV.PRIV_SET_PERM;
    expect(hasPriv(priv, PRIV.PRIV_EDIT_SYSTEM)).to.equal(true);
    expect(hasPriv(priv, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_SET_PERM)).to.equal(true);
    expect(hasPriv(priv, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_JUDGE)).to.equal(false);
    expect(hasPriv(priv, PRIV.PRIV_JUDGE)).to.equal(false);
  });

  it('rejects a zero priv regardless of the bits asked for', () => {
    expect(hasPriv(0, PRIV.PRIV_NONE)).to.equal(false);
    expect(hasPriv(0, PRIV.PRIV_EDIT_SYSTEM)).to.equal(false);
    expect(hasPriv(0)).to.equal(false);
  });

  it('treats -1 (all bits set) as holding every priv', () => {
    expect(hasPriv(-1, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_MANAGE_ALL_DOMAIN, PRIV.PRIV_MOD_BADGE)).to.equal(true);
  });

  it('is vacuously true for a truthy priv when no bits are requested', () => {
    // Documents current behavior: `bits.every` on an empty list is true.
    expect(hasPriv(PRIV.PRIV_JUDGE)).to.equal(true);
  });

  it('considers PRIV_NONE held by any truthy priv', () => {
    // (priv & 0) === 0 always; only the `!userPriv` guard can reject.
    expect(hasPriv(PRIV.PRIV_JUDGE, PRIV.PRIV_NONE)).to.equal(true);
  });
});

describe('hasAnyPriv', () => {
  it('accepts when at least one requested bit is present', () => {
    const priv = PRIV.PRIV_USER_PROFILE | PRIV.PRIV_SEND_MESSAGE;
    expect(hasAnyPriv(priv, PRIV.PRIV_SEND_MESSAGE)).to.equal(true);
    expect(hasAnyPriv(priv, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_USER_PROFILE)).to.equal(true);
    expect(hasAnyPriv(priv, PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_JUDGE)).to.equal(false);
  });

  it('rejects a zero priv and an empty bit list', () => {
    expect(hasAnyPriv(0, PRIV.PRIV_EDIT_SYSTEM)).to.equal(false);
    // `bits.some` on an empty list is false — asymmetric with hasPriv().
    expect(hasAnyPriv(PRIV.PRIV_JUDGE)).to.equal(false);
  });
});

describe('isSystemAdmin', () => {
  it('depends only on PRIV_EDIT_SYSTEM', () => {
    expect(isSystemAdmin(PRIV.PRIV_EDIT_SYSTEM)).to.equal(true);
    expect(isSystemAdmin(PRIV.PRIV_EDIT_SYSTEM | PRIV.PRIV_JUDGE)).to.equal(true);
    expect(isSystemAdmin(PRIV.PRIV_MANAGE_ALL_DOMAIN)).to.equal(false);
    expect(isSystemAdmin(0)).to.equal(false);
  });
});

describe('canAccessDomainAdmin', () => {
  it('accepts either PRIV_EDIT_SYSTEM or PRIV_MANAGE_ALL_DOMAIN', () => {
    expect(canAccessDomainAdmin(PRIV.PRIV_EDIT_SYSTEM)).to.equal(true);
    expect(canAccessDomainAdmin(PRIV.PRIV_MANAGE_ALL_DOMAIN)).to.equal(true);
    expect(canAccessDomainAdmin(PRIV.PRIV_EDIT_SYSTEM | PRIV.PRIV_MANAGE_ALL_DOMAIN)).to.equal(true);
  });

  it('rejects unrelated privs and zero', () => {
    expect(canAccessDomainAdmin(PRIV.PRIV_VIEW_ALL_DOMAIN)).to.equal(false);
    expect(canAccessDomainAdmin(PRIV.PRIV_CREATE_DOMAIN)).to.equal(false);
    expect(canAccessDomainAdmin(0)).to.equal(false);
  });
});

describe('canSeeAdminAffordance', () => {
  it('shows ungated affordances to everyone, signed in or not', () => {
    expect(canSeeAdminAffordance({ priv: 0 })).to.equal(true);
    expect(canSeeAdminAffordance({ priv: 0, signedIn: false })).to.equal(true);
    expect(canSeeAdminAffordance({ priv: 0, role: 'default' }, undefined)).to.equal(true);
  });

  it('gates systemAdmin on PRIV_EDIT_SYSTEM only — root role is not enough', () => {
    expect(canSeeAdminAffordance({ priv: PRIV.PRIV_EDIT_SYSTEM }, 'systemAdmin')).to.equal(true);
    expect(canSeeAdminAffordance({ priv: PRIV.PRIV_MANAGE_ALL_DOMAIN }, 'systemAdmin')).to.equal(false);
    expect(canSeeAdminAffordance({ priv: 0, role: 'root' }, 'systemAdmin')).to.equal(false);
  });

  it('gates domainAdmin on priv bits or the bootstrap root role', () => {
    expect(canSeeAdminAffordance({ priv: PRIV.PRIV_EDIT_SYSTEM }, 'domainAdmin')).to.equal(true);
    expect(canSeeAdminAffordance({ priv: PRIV.PRIV_MANAGE_ALL_DOMAIN }, 'domainAdmin')).to.equal(true);
    expect(canSeeAdminAffordance({ priv: 0, role: 'root' }, 'domainAdmin')).to.equal(true);
    expect(canSeeAdminAffordance({ priv: 0, role: 'admin' }, 'domainAdmin')).to.equal(false);
    expect(canSeeAdminAffordance({ priv: PRIV.PRIV_JUDGE, role: 'default' }, 'domainAdmin')).to.equal(false);
  });

  it('fails closed on an unknown access level', () => {
    expect(canSeeAdminAffordance({ priv: -1, role: 'root' }, 'superAdmin' as AdminAccessLevel)).to.equal(false);
  });
});
