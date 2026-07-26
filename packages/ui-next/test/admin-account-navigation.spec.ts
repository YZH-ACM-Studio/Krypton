import { describe, expect, it } from 'vitest';
import {
  adminAccountDynamicValueLabel,
  adminAccountSemanticValueLabel,
  buildAdminAccountDetailHref,
  buildAdminAccountFiltersClearHref,
  isAdminAccountPermissionsView,
  isAdminAccountDateField,
} from '../src/lib/admin-account-ui.ts';
import { formatDateTime } from '../src/lib/format.ts';

describe('admin account page navigation', () => {
  it('keeps permission mode through filtering, detail navigation, and list return', () => {
    const listHref = 'https://krypton.test/admin/accounts?view=permissions&q=student&page=2&groupDomain=system';
    expect(isAdminAccountPermissionsView(listHref)).to.equal(true);
    expect(buildAdminAccountFiltersClearHref(listHref)).to.equal('/admin/accounts?view=permissions');

    const detail = new URL(buildAdminAccountDetailHref(listHref, 8), 'https://krypton.test');
    expect(detail.pathname).to.equal('/admin/accounts/8');
    expect(detail.searchParams.get('view')).to.equal('permissions');
    expect(detail.searchParams.get('groupDomain')).to.equal('system');

    const returnTo = new URL(detail.searchParams.get('returnTo')!, 'https://krypton.test');
    expect(returnTo.pathname).to.equal('/admin/accounts');
    expect(returnTo.searchParams.get('view')).to.equal('permissions');
    expect(returnTo.searchParams.get('q')).to.equal('student');
    expect(returnTo.searchParams.get('page')).to.equal('2');
  });

  it('does not carry the import dialog into a detail page or its return link', () => {
    const detail = new URL(
      buildAdminAccountDetailHref('https://krypton.test/admin/accounts?view=import&q=student', 8),
      'https://krypton.test',
    );
    expect(detail.searchParams.has('view')).to.equal(false);
    const returnTo = new URL(detail.searchParams.get('returnTo')!, 'https://krypton.test');
    expect(returnTo.searchParams.has('view')).to.equal(false);
    expect(returnTo.searchParams.get('q')).to.equal('student');
  });

  it('formats account facts in the server-provided site time zone', () => {
    const instant = '2026-07-16T00:00:00.000Z';
    expect(formatDateTime(instant, 'zh-CN', 'Asia/Shanghai')).to.match(/08:00/);
    expect(formatDateTime(instant, 'zh-CN', 'UTC')).to.match(/00:00/);
  });

  it('turns import progress line stages into readable labels', () => {
    expect(adminAccountDynamicValueLabel('preflight-line-7')).to.equal('预检第 7 行');
    expect(adminAccountDynamicValueLabel('create-line-7')).to.equal('创建第 7 行');
    expect(adminAccountDynamicValueLabel('profile-line-7')).to.equal('写入第 7 行资料');
    expect(adminAccountDynamicValueLabel('unknown-line-7')).to.equal(null);
  });

  it('turns dynamic group audit impacts into readable actions', () => {
    expect(adminAccountDynamicValueLabel('force_logout')).to.equal('强制退出登录');
    expect(adminAccountDynamicValueLabel('add system/程序设计 1 班')).to.equal('加入 system/程序设计 1 班');
    expect(adminAccountDynamicValueLabel('remove system/程序设计 1 班')).to.equal('移出 system/程序设计 1 班');
  });

  it('translates only semantic fields and preserves user-authored text', () => {
    expect(adminAccountSemanticValueLabel('result', 'success')).to.equal('成功');
    expect(adminAccountSemanticValueLabel('stage', 'profile-line-3')).to.equal('写入第 3 行资料');
    expect(adminAccountSemanticValueLabel('action', 'add')).to.equal('加入');
    expect(adminAccountSemanticValueLabel('bio', 'success')).to.equal(null);
    expect(adminAccountSemanticValueLabel('bio', 'add me')).to.equal(null);
    expect(adminAccountSemanticValueLabel('school', 'enabled')).to.equal(null);
  });

  it('formats binding dates and password audit states without affecting ordinary fields', () => {
    expect(isAdminAccountDateField('boundAt')).to.equal(true);
    expect(adminAccountSemanticValueLabel('password', 'unchanged')).to.equal('未变更');
    expect(adminAccountSemanticValueLabel('password', 'replaced')).to.equal('已替换');
    expect(adminAccountSemanticValueLabel('sessions', 'active')).to.equal('仍有有效会话');
    expect(adminAccountSemanticValueLabel('sessions', 'revoked')).to.equal('已撤销');
    expect(adminAccountSemanticValueLabel('bio', 'revoked')).to.equal(null);
  });
});
