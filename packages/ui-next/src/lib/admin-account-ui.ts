export const ADMIN_ACCOUNTS_ENDPOINT = '/admin/accounts';

type UrlPatch = Record<string, string | number | null | undefined>;

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function buildAdminAccountListHref(currentHref: string, patch: UrlPatch): string {
  const url = new URL(currentHref);
  url.pathname = ADMIN_ACCOUNTS_ENDPOINT;
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return relativeUrl(url);
}

export function buildAdminAccountDetailHref(currentHref: string, uid: number): string {
  const source = new URL(currentHref);
  const permissionsView = source.searchParams.get('view') === 'permissions';
  const returnUrl = new URL(source.href);
  returnUrl.pathname = ADMIN_ACCOUNTS_ENDPOINT;
  for (const key of ['action', 'format', 'returnTo', 'selected', 'uid', 'view']) returnUrl.searchParams.delete(key);
  if (permissionsView) returnUrl.searchParams.set('view', 'permissions');

  const detailUrl = new URL(`${ADMIN_ACCOUNTS_ENDPOINT}/${uid}`, source.origin);
  if (permissionsView) detailUrl.searchParams.set('view', 'permissions');
  for (const key of ['groupDomain', 'roleDomain']) {
    const value = source.searchParams.get(key);
    if (value) detailUrl.searchParams.set(key, value);
  }
  detailUrl.searchParams.set('returnTo', relativeUrl(returnUrl));
  return relativeUrl(detailUrl);
}

export function buildAdminAccountDetailStateHref(currentHref: string, patch: UrlPatch): string {
  const url = new URL(currentHref);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return relativeUrl(url);
}

export function isAdminAccountPermissionsView(currentHref: string): boolean {
  return new URL(currentHref).searchParams.get('view') === 'permissions';
}

export function buildAdminAccountFiltersClearHref(currentHref: string): string {
  return isAdminAccountPermissionsView(currentHref)
    ? `${ADMIN_ACCOUNTS_ENDPOINT}?view=permissions`
    : ADMIN_ACCOUNTS_ENDPOINT;
}

const ADMIN_ACCOUNT_SEMANTIC_FIELDS = new Set([
  'action',
  'bindingStatus',
  'businessData',
  'password',
  'result',
  'sessions',
  'stage',
  'state',
  'status',
]);
const ADMIN_ACCOUNT_DATE_FIELDS = new Set([
  'at',
  'boundAt',
  'createdAt',
  'expiresAt',
  'finishedAt',
  'lastLoginAt',
  'lastUsedAt',
  'registeredAt',
  'time',
  'updatedAt',
]);
const ADMIN_ACCOUNT_VALUE_LABELS: Record<string, string> = {
  clear_tfa: '清除 TOTP',
  clear_webauthn: '移除全部 Passkey',
  'create-core-account': '创建核心账号',
  'disable-account': '写入禁用状态',
  'force-logout': '强制退出登录',
  group_add: '加入用户组',
  group_remove: '移出用户组',
  preflight: '全量预检',
  reauthenticate: '验证管理员密码',
  'replace-password': '替换密码',
  'revoke-access': '撤销访问凭据',
  revoke_api_tokens: '撤销 API / 工具令牌',
  revoke_all: '撤销全部访问凭据',
  revoke_sessions: '撤销全部会话',
  'revoke-before-disable': '禁用前撤销凭据',
  'run-import-hook': '执行账号导入扩展',
  'set-role': '设置域角色',
  set_role: '设置域角色',
  unlink_oauth: '解除 OAuth 关联',
  'write-privilege': '写入全站权限',
  'write-profile': '写入账号资料',
  'write-session': '切换会话身份',
  add: '加入',
  active: '仍有有效会话',
  complete: '已完成',
  disable: '禁用账号',
  disabled: '已禁用',
  enabled: '正常',
  failed: '失败',
  groups: '写入用户组',
  pending: '等待中',
  preserved: '已保留',
  remove: '移出',
  replaced: '已替换',
  revoked: '已撤销',
  restore: '恢复账号',
  started: '执行中',
  success: '成功',
  unchanged: '未变更',
};

export function adminAccountDynamicValueLabel(value: string): string | null {
  if (value === 'force_logout') return '强制退出登录';
  const matched = /^(preflight|create|profile)-line-(\d+)$/.exec(value);
  if (matched) {
    const [, stage, line] = matched;
    if (stage === 'preflight') return `预检第 ${line} 行`;
    if (stage === 'create') return `创建第 ${line} 行`;
    return `写入第 ${line} 行资料`;
  }
  const groupAction = /^(add|remove) (.+)$/.exec(value);
  if (groupAction) return `${groupAction[1] === 'add' ? '加入' : '移出'} ${groupAction[2]}`;
  return null;
}

export function adminAccountSemanticValueLabel(fieldKey: string | undefined, value: string): string | null {
  if (!fieldKey || !ADMIN_ACCOUNT_SEMANTIC_FIELDS.has(fieldKey)) return null;
  return ADMIN_ACCOUNT_VALUE_LABELS[value.toLocaleLowerCase()] || adminAccountDynamicValueLabel(value);
}

export function adminAccountAuditImpactLabel(value: string): string {
  return ADMIN_ACCOUNT_VALUE_LABELS[value.toLocaleLowerCase()] || adminAccountDynamicValueLabel(value) || value;
}

export function isAdminAccountDateField(fieldKey: string | undefined): boolean {
  return !!fieldKey && ADMIN_ACCOUNT_DATE_FIELDS.has(fieldKey);
}
