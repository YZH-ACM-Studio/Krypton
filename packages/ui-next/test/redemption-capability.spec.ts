import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRedemptionManageCapability } from '../redemption-capabilities.ts';

const root = resolve(import.meta.dirname, '..');

describe('P3.7 redemption manage capability', () => {
  it('fails closed without permission methods and opens for create or system admin', () => {
    const errors: unknown[] = [];
    expect(
      resolveRedemptionManageCapability({
        user: {},
        editSystemPriv: 1,
        createRedemptionPerm: 2n,
        onError: (error) => errors.push(error),
      }),
    ).to.equal(false);
    expect(errors).to.have.length(1);
    expect(
      resolveRedemptionManageCapability({
        user: { hasPriv: () => false, hasPerm: (perm) => perm === 2n },
        editSystemPriv: 1,
        createRedemptionPerm: 2n,
        onError: () => undefined,
      }),
    ).to.equal(true);
  });

  it('registers manage and redeem pages behind server capability', () => {
    const resolver = readFileSync(resolve(root, 'src/pages/resolver.tsx'), 'utf8');
    const sidebar = readFileSync(resolve(root, 'src/components/layout/sidebar.tsx'), 'utf8');
    const manage = readFileSync(resolve(root, 'src/pages/redemption-manage.tsx'), 'utf8');
    const redeem = readFileSync(resolve(root, 'src/pages/redeem.tsx'), 'utf8');
    expect(resolver).to.include("'redemption_code_manage.html': RedemptionCodeManagePage");
    expect(resolver).to.include("'redeem.html': RedeemPage");
    expect(sidebar).to.include("href: '/manage/redemption-codes'");
    expect(sidebar).to.include("href: '/redeem'");
    expect(manage).to.include('仅此一次');
    expect(manage).to.include('撤销该来源');
    expect(redeem).to.include('name="code"');
  });
});
