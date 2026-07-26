import { useEffect, useMemo, useState } from 'react';
import {
  ArchiveRestore,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  KeyRound,
  Link2Off,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  ADMIN_ACCOUNTS_ENDPOINT,
  adminAccountAuditImpactLabel,
  adminAccountSemanticValueLabel,
  buildAdminAccountDetailHref,
  buildAdminAccountDetailStateHref,
  buildAdminAccountFiltersClearHref,
  buildAdminAccountListHref,
  isAdminAccountPermissionsView,
  isAdminAccountDateField,
} from '@/lib/admin-account-ui';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, makeInitials } from '@/lib/format';
import { PRIV } from '@/lib/perms';

const ENDPOINT = ADMIN_ACCOUNTS_ENDPOINT;

interface AccountRow {
  uid: number;
  username: string;
  email: string;
  displayName: string;
  status: 'enabled' | 'disabled';
  school: string;
  studentId: string;
  priv: number;
  registeredAt: string | null;
  lastLoginAt: string | null;
  avatarUrl: string;
  isAdmin: boolean;
  hasTfa: boolean;
  hasWebAuthn: boolean;
  oauthProviders: string[];
  binding: null | { studentId: string; realName: string; enrollmentYear?: number | null };
  protected: boolean;
}

interface AccountDetail {
  account: AccountRow & {
    profileVersion: string;
    avatar: string;
    qq: string;
    gender: number;
    bio: string;
    registrationIps: string[];
    lastLoginIp: string;
    disabled: null | { at: string | null; by: number | null; previousPriv: number };
    banReason: string;
  };
  security: {
    hasTfa: boolean;
    authenticators: Array<{
      name: string;
      registeredAt: string | null;
      credentialType: string;
      deviceType: string;
      attachment: string;
    }>;
    oauth: Array<{ platform: string }>;
    sessions: Array<{
      createdAt: string | null;
      updatedAt: string | null;
      createdIp: string;
      updatedIp: string;
      userAgent: string;
    }>;
    apiTokens: Array<{
      id: string;
      display: string;
      label: string;
      channels: string[];
      createdAt: string | null;
      lastUsedAt: string | null;
      expiresAt: string | null;
      revoked: boolean;
    }>;
  };
  memberships: Array<{ domainId: string; domainName: string; role: string }>;
  groups: Array<{ domainId: string; name: string }>;
  binding: { available: boolean; student: Record<string, unknown> | null };
  related: {
    submissionCount: number;
    acceptedCount: number;
    ownedProblems: number;
    links: { submissions: string; ownedProblems: string };
  };
  activity: Array<{ time?: string; operateIp?: string; ua?: string }>;
  audit: Array<{
    _id?: string;
    type?: string;
    time?: string;
    operator?: number;
    operateIp?: string;
    result?: string;
    before?: unknown;
    after?: unknown;
    impact?: string;
    error?: { message?: string };
    progress?: unknown;
    detail?: unknown;
    targetUid?: number;
    targetUids?: number[];
  }>;
}

interface AccountFilters {
  q: string;
  status: string;
  admin: string;
  security: string;
  binding: string;
  groupDomain: string;
  group: string;
  roleDomain: string;
  role: string;
  registeredFrom: string;
  registeredTo: string;
  loginFrom: string;
  loginTo: string;
  sort: string;
  order: string;
}

interface AccountMetadata {
  domains: Array<{ id: string; name: string }>;
  groups: Array<{ name: string; count: number }>;
  roles: string[];
  groupDomain: string;
  roleDomain: string;
  privileges: Array<{ key: string; value: number }>;
  defaultPriv: number;
  bulkLimit: number;
  superadminUid: number;
  timeZone: string;
}

interface AdminAccountsData {
  accounts: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  filters: AccountFilters;
  bindingAvailable: boolean;
  metadata: AccountMetadata;
}

interface AdminAccountDetailData {
  detail: AccountDetail;
  metadata: AccountMetadata;
  returnTo: string;
}

interface PendingAction {
  title: string;
  description: string;
  impact: string;
  before: unknown;
  after: unknown;
  fields: Record<string, string>;
  confirmLabel?: string;
  destructive?: boolean;
  requirePassword?: boolean;
}

interface ImportPreview {
  rows: Array<{
    line: number;
    email: string;
    username: string;
    displayName: string;
    passwordPresent: boolean;
    status: 'ok' | 'invalid' | 'duplicate';
    message: string;
  }>;
  summary: { total: number; ready: number; invalid: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(payload: unknown, status: number): string {
  if (!isRecord(payload)) return `请求失败 (${status})`;
  const error = payload?.error;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return `请求失败 (${status})`;
}

async function postOperation<T = Record<string, unknown>>(fields: Record<string, string>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams(fields),
  });
  const payload: unknown = await response.json().catch((error) => {
    throw new Error(`服务器返回了无法解析的响应：${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return payload as T;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const configured = window.__KRYPTON_BOOTSTRAP__?.page?.data?.metadata?.timeZone;
  const timeZone = typeof configured === 'string' && configured ? configured : 'Asia/Shanghai';
  return formatDateTime(date, 'zh-CN', timeZone);
}

function accountHref(patch: Record<string, string | number | null | undefined>): string {
  return buildAdminAccountListHref(window.location.href, patch);
}

function accountDetailHref(uid: number): string {
  return buildAdminAccountDetailHref(window.location.href, uid);
}

function detailHref(patch: Record<string, string | number | null | undefined>): string {
  return buildAdminAccountDetailStateHref(window.location.href, patch);
}

function exportHref(selected?: number[]): string {
  const url = new URL(window.location.href);
  url.pathname = ENDPOINT;
  url.searchParams.delete('page');
  url.searchParams.delete('uid');
  url.searchParams.set('format', 'csv');
  if (selected?.length) url.searchParams.set('selected', selected.join(','));
  else url.searchParams.delete('selected');
  return `${url.pathname}${url.search}`;
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function privilegeLabel(key: string): string {
  const labels: Record<string, string> = {
    PRIV_EDIT_SYSTEM: '系统管理',
    PRIV_SET_PERM: '权限配置',
    PRIV_USER_PROFILE: '用户资料管理',
    PRIV_REGISTER_USER: '注册用户',
    PRIV_READ_PROBLEM_DATA: '读取全部题目数据',
    PRIV_READ_PROBLEM_DATA_SELF: '读取自有题目数据',
    PRIV_READ_RECORD_CODE: '读取提交代码',
    PRIV_VIEW_HIDDEN_RECORD: '查看隐藏提交',
    PRIV_JUDGE: '评测管理',
    PRIV_CREATE_DOMAIN: '创建域',
    PRIV_VIEW_ALL_DOMAIN: '查看所有域',
    PRIV_MANAGE_ALL_DOMAIN: '管理所有域',
    PRIV_REJUDGE: '重判',
    PRIV_VIEW_USER_SECRET: '查看用户私密信息',
    PRIV_VIEW_JUDGE_STATISTICS: '查看评测统计',
    PRIV_UNLIMITED_ACCESS: '不限访问频率',
    PRIV_VIEW_SYSTEM_NOTIFICATION: '查看系统通知',
    PRIV_SEND_MESSAGE: '发送消息',
    PRIV_CREATE_FILE: '创建文件',
    PRIV_UNLIMITED_QUOTA: '不限配额',
    PRIV_DELETE_FILE: '删除文件',
    PRIV_MOD_BADGE: '管理徽章',
  };
  return labels[key] || key.replace(/^PRIV_/, '').toLocaleLowerCase().replaceAll('_', ' ');
}

const STRUCTURED_FIELD_LABELS: Record<string, string> = {
  _id: '记录 ID',
  action: '操作',
  activeUid: '当前账号 UID',
  actorUid: '管理员 UID',
  afterCount: '操作后数量',
  afterMembers: '操作后成员',
  apiTokens: 'API / 工具令牌',
  at: '操作时间',
  banReason: '禁用说明',
  beforeCount: '操作前数量',
  beforeMembers: '操作前成员',
  bindingStatus: '绑定状态',
  businessData: '业务数据',
  by: '操作者 UID',
  channels: '可用频道',
  count: '数量',
  createdAccounts: '已创建账号',
  createdAt: '创建时间',
  displayName: '展示名',
  domainId: '域 ID',
  email: '邮箱',
  enabled: '是否启用',
  enrollmentYear: '入学年',
  error: '错误',
  expiresAt: '过期时间',
  gender: '性别',
  group: '用户组',
  groupIds: '所属用户组',
  isAdmin: '系统管理员',
  label: '名称',
  lastUsedAt: '最近使用',
  linked: '是否关联',
  member: '是否为成员',
  name: '名称',
  operator: '操作者 UID',
  platform: '平台',
  previousPriv: '禁用前权限',
  priv: '权限值',
  processedUids: '已处理账号 UID',
  realName: '姓名',
  revoked: '是否已撤销',
  role: '域角色',
  school: '学校',
  schoolId: '学校档案 ID',
  sessions: '登录会话',
  stage: '执行阶段',
  status: '状态',
  studentId: '学号',
  targetDomainId: '目标域',
  targetUid: '目标账号 UID',
  targetUids: '目标账号 UID',
  uid: '账号 UID',
  updatedAt: '更新时间',
  username: '用户名',
};

const AUDIT_TYPE_LABELS: Record<string, string> = {
  'admin.account.bulk': '批量账号操作',
  'admin.account.bulk.disable': '批量禁用账号',
  'admin.account.bulk.force_logout': '批量强制退出',
  'admin.account.bulk.group_add': '批量加入用户组',
  'admin.account.bulk.group_remove': '批量移出用户组',
  'admin.account.bulk.restore': '批量恢复账号',
  'admin.account.bulk.set_role': '批量设置域角色',
  'admin.account.create': '创建账号',
  'admin.account.disable': '禁用账号',
  'admin.account.group': '修改用户组',
  'admin.account.group.add': '加入用户组',
  'admin.account.group.remove': '移出用户组',
  'admin.account.import': '批量导入账号',
  'admin.account.impersonate': '切换账号',
  'admin.account.impersonate.return': '返回管理员账号',
  'admin.account.password': '替换密码',
  'admin.account.privilege': '修改全站权限',
  'admin.account.profile': '修改基本资料',
  'admin.account.restore': '恢复账号',
  'admin.account.role': '修改域角色',
  'admin.account.security': '安全恢复',
  'admin.account.security.clear_tfa': '清除 TOTP',
  'admin.account.security.clear_webauthn': '移除全部 Passkey',
  'admin.account.security.revoke_all': '撤销全部访问凭据',
  'admin.account.security.revoke_api_tokens': '撤销 API / 工具令牌',
  'admin.account.security.revoke_sessions': '撤销全部会话',
  'admin.account.security.unlink_oauth': '解除 OAuth 关联',
};

function auditResultLabel(result: string | undefined): string {
  if (!result) return '未知结果';
  return adminAccountSemanticValueLabel('result', result) || result;
}

function auditTypeLabel(type: string | undefined): string {
  if (!type) return '账号管理';
  if (AUDIT_TYPE_LABELS[type]) return AUDIT_TYPE_LABELS[type];
  return `账号管理：${structuredFieldLabel(type.replace(/^admin\.account\./, ''))}`;
}

function auditImpactLabel(impact: string): string {
  return adminAccountAuditImpactLabel(impact);
}

function structuredFieldLabel(key: string): string {
  if (STRUCTURED_FIELD_LABELS[key]) return STRUCTURED_FIELD_LABELS[key];
  return key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

function parseStructuredString(value: string): unknown {
  const trimmed = value.trim();
  const looksLikeObject = trimmed.startsWith('{') && trimmed.endsWith('}');
  const looksLikeArray = trimmed.startsWith('[') && trimmed.endsWith(']');
  if (!looksLikeObject && !looksLikeArray) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function structuredPrimitiveText(value: string | number | boolean, fieldKey: string | undefined): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  return adminAccountSemanticValueLabel(fieldKey, value) || value || '—';
}

const STRUCTURED_JSON_FIELDS = new Set(['after', 'before', 'detail', 'disabled', 'progress', 'student']);

function StructuredValue({
  value,
  depth = 0,
  fieldKey,
  parseJson = true,
}: {
  value: unknown;
  depth?: number;
  fieldKey?: string;
  parseJson?: boolean;
}) {
  const normalized = typeof value === 'string' && parseJson ? parseStructuredString(value) : value;
  if (normalized == null || normalized === '') return <span className="text-muted-foreground">—</span>;
  if (normalized instanceof Date) return <span>{formatDate(normalized.toISOString())}</span>;
  if (typeof normalized === 'boolean') return <Badge variant="outline">{normalized ? '是' : '否'}</Badge>;
  if (typeof normalized === 'number') return <span className="tabular-nums">{normalized}</span>;
  if (typeof normalized === 'string') {
    if (isAdminAccountDateField(fieldKey) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return <span>{formatDate(normalized)}</span>;
    const translated = adminAccountSemanticValueLabel(fieldKey, normalized);
    if (translated) return <Badge variant="outline">{translated}</Badge>;
    return <span className="break-words leading-5">{normalized}</span>;
  }
  if (Array.isArray(normalized)) {
    if (!normalized.length) return <span className="text-muted-foreground">无</span>;
    if (normalized.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {normalized.map((item, index) => <Badge key={`${String(item)}-${index}`} variant="secondary">{structuredPrimitiveText(item as string | number | boolean, fieldKey)}</Badge>)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {normalized.map((item, index) => (
          <div key={index} className="rounded-md bg-background/70 px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">第 {index + 1} 项</p>
            <StructuredValue value={item} depth={depth + 1} fieldKey={fieldKey} parseJson={parseJson} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof normalized === 'object') {
    const entries = Object.entries(normalized as Record<string, unknown>);
    if (!entries.length) return <span className="text-muted-foreground">无</span>;
    return (
      <dl className={depth ? 'divide-y divide-border/60' : 'grid gap-x-5 gap-y-3 sm:grid-cols-2'}>
        {entries.map(([key, entry]) => (
          <div key={key} className={depth ? 'grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]' : 'min-w-0'}>
            <dt className="text-[11px] font-medium text-muted-foreground">{structuredFieldLabel(key)}</dt>
            <dd className="mt-0.5 min-w-0 text-xs"><StructuredValue value={entry} depth={depth + 1} fieldKey={key} parseJson={STRUCTURED_JSON_FIELDS.has(key)} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(normalized)}</span>;
}

function SummaryBox({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-xs"><StructuredValue value={value} /></div>
    </div>
  );
}

function SensitiveActionDialog({ action, onClose }: { action: PendingAction | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setBusy(false);
    setError(null);
  }, [action]);

  const close = () => {
    if (!busy) onClose();
  };
  const submit = async () => {
    if (!action || busy || (action.requirePassword !== false && !password)) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await postOperation({
        ...action.fields,
        ...(action.requirePassword === false ? {} : { password }),
      });
      if (payload?.redirect) window.location.assign(String(payload.redirect));
      else window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && close()}>
      <DialogContent className="w-full sm:w-[640px]" onClose={close}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action?.destructive ? <ShieldAlert className="size-4 text-destructive" /> : <ShieldCheck className="size-4 text-primary" />}
            {action?.title}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-muted-foreground">{action?.description}</p>
            <div className={action?.destructive ? 'rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm' : 'rounded-lg border bg-muted/20 p-3 text-sm'}>
              <strong>影响：</strong>{action?.impact}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryBox label="变更前" value={action?.before} />
              <SummaryBox label="变更后" value={action?.after} />
            </div>
            {action?.requirePassword !== false ? (
              <FormField label="当前管理员密码" htmlFor="account-admin-password" required hint="仅用于本次再认证，不会进入审计记录。">
                <Input
                  id="account-admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit();
                  }}
                />
              </FormField>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </ScrollArea>
        <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>取消</Button>
          <Button
            type="button"
            variant={action?.destructive ? 'destructive' : 'default'}
            disabled={busy || (action?.requirePassword !== false && !password)}
            onClick={() => void submit()}
          >
            {busy ? <RefreshCw className="animate-spin" /> : <ShieldCheck />}
            {busy ? '处理中…' : action?.confirmLabel || '确认执行'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { uid: number; username: string; password: string }) => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [school, setSchool] = useState('');
  const [studentId, setStudentId] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUsername('');
    setEmail('');
    setDisplayName('');
    setSchool('');
    setStudentId('');
    setAccountPassword('');
    setAdminPassword('');
    setBusy(false);
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const submit = async () => {
    if (!username.trim() || !email.trim() || !accountPassword || !adminPassword || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postOperation<{ uid: string | number }>({
        operation: 'create',
        username: username.trim(),
        email: email.trim(),
        displayName: displayName.trim(),
        school: school.trim(),
        studentId: studentId.trim(),
        __accountPassword: accountPassword,
        password: adminPassword,
      });
      const created = { uid: Number(result.uid), username: username.trim(), password: accountPassword };
      reset();
      onClose();
      onCreated(created);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="w-full sm:w-[720px]" onClose={close}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-4" />创建账号</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-5 px-5 py-4">
            <FormSection title="登录信息" description="UID 由系统分配；密码只在本次创建流程中显示。">
              <FormRow columns={2}>
                <FormField label="用户名" htmlFor="create-username" required>
                  <Input id="create-username" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} />
                </FormField>
                <FormField label="邮箱" htmlFor="create-email" required>
                  <Input id="create-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
                </FormField>
              </FormRow>
              <FormField label="新账号密码" htmlFor="create-account-password" required>
                <div className="flex gap-2">
                  <Input
                    id="create-account-password"
                    type="text"
                    autoComplete="new-password"
                    value={accountPassword}
                    onChange={(event) => setAccountPassword(event.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => setAccountPassword(generatePassword())}>生成</Button>
                </div>
              </FormField>
            </FormSection>
            <FormSection title="基础资料">
              <FormRow columns={2}>
                <FormField label="展示名"><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></FormField>
                <FormField label="学校"><Input value={school} onChange={(event) => setSchool(event.target.value)} /></FormField>
              </FormRow>
              <FormField label="学号"><Input value={studentId} onChange={(event) => setStudentId(event.target.value)} /></FormField>
            </FormSection>
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryBox label="变更前" value={{ account: '不存在' }} />
              <SummaryBox label="变更后" value={{ username: username.trim(), email: email.trim(), displayName: displayName.trim(), school: school.trim(), studentId: studentId.trim() }} />
            </div>
            <FormField label="当前管理员密码" htmlFor="create-admin-password" required hint="确认操作者身份后才会创建。">
              <Input id="create-admin-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
            </FormField>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </DialogBody>
        <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>取消</Button>
          <Button type="button" disabled={busy || !username.trim() || !email.trim() || !accountPassword || !adminPassword} onClick={() => void submit()}>
            {busy ? <RefreshCw className="animate-spin" /> : <Plus />}{busy ? '创建中…' : '创建账号'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OneTimePasswordDialog({ result, onClose }: {
  result: { uid: number; username: string; password: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [result]);
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopied(true);
      setCopyError(null);
    } catch (error) {
      setCopyError(`复制失败，请手动复制：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full sm:w-[520px]" onClose={onClose}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Check className="size-4 text-emerald-600" />账号创建成功</DialogTitle></DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-muted-foreground">UID {result?.uid} · {result?.username}。关闭后无法再次查看此密码。</p>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1 text-xs text-muted-foreground">一次性显示的新账号密码</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all text-sm">{result?.password}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制'}</Button>
            </div>
          </div>
          {copyError ? <p role="alert" className="text-sm text-destructive">{copyError}</p> : null}
        </div>
        <div className="flex justify-end border-t bg-muted/20 px-5 py-3"><Button type="button" onClick={onClose}>我已保存，关闭</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ImportAccountsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setText('');
    setPreview(null);
    setPassword('');
    setBusy(false);
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const runPreview = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postOperation<ImportPreview>({ operation: 'import_preview', __users: text });
      setPreview(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview || preview.summary.ready !== preview.summary.total || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postOperation({ operation: 'import_commit', __users: text, password });
      window.location.reload();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="w-full sm:w-[860px]" onClose={close}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileUp className="size-4" />批量导入账号</DialogTitle></DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-5 py-4">
            <FormField
              label="账号数据"
              required
              hint={'每行：邮箱<TAB>用户名<TAB>密码<TAB>展示名<TAB>{"school":"学校","studentId":"学号","group":"组名"}；也支持逗号分隔。最多 1000 行。'}
            >
              <Textarea className="min-h-40 font-mono text-xs" value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} />
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={!text.trim() || busy} onClick={() => void runPreview()}>
                {busy && !preview ? <RefreshCw className="animate-spin" /> : <Search />}预览校验
              </Button>
              {preview ? (
                <span className="text-sm text-muted-foreground">共 {preview.summary.total} 行，可创建 {preview.summary.ready} 行，问题 {preview.summary.invalid} 行</span>
              ) : null}
            </div>
            {preview ? (
              <div className="overflow-hidden rounded-lg border">
                <Table density="compact">
                  <TableHeader><TableRow><TableHead>行</TableHead><TableHead>用户名 / 邮箱</TableHead><TableHead>展示名</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.line}>
                        <TableCell className="font-mono text-xs">{row.line}</TableCell>
                        <TableCell><p className="font-medium">{row.username || '—'}</p><p className="text-xs text-muted-foreground">{row.email || '—'}</p></TableCell>
                        <TableCell>{row.displayName || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={row.status === 'ok' ? 'default' : 'destructive'}>{row.status === 'ok' ? '可创建' : row.message || row.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {preview && preview.summary.ready === preview.summary.total && preview.summary.total > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SummaryBox label="变更前" value={{ accounts: '保持不变' }} />
                  <SummaryBox label="变更后" value={{ createdAccounts: preview.summary.ready }} />
                </div>
                <FormField label="当前管理员密码" required hint="再次校验数据后才会执行导入。">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </FormField>
              </>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </ScrollArea>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>取消</Button>
          <Button
            type="button"
            disabled={busy || !preview || preview.summary.total === 0 || preview.summary.ready !== preview.summary.total || !password}
            onClick={() => void commit()}
          >
            {busy && preview ? <RefreshCw className="animate-spin" /> : <FileUp />}{busy && preview ? '导入中…' : '确认导入'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountFiltersPanel({ data }: { data: AdminAccountsData }) {
  const { filters, metadata } = data;
  const domainOptions = metadata.domains.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }));
  const permissionsView = isAdminAccountPermissionsView(window.location.href);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm"><Search className="size-4" />搜索与筛选</CardTitle>
        <Button asChild variant="ghost" size="sm"><a href={buildAdminAccountFiltersClearHref(window.location.href)}>清空</a></Button>
      </CardHeader>
      <CardContent className="pt-0">
        <form method="get" action={ENDPOINT} className="space-y-3">
          {permissionsView ? <input type="hidden" name="view" value="permissions" /> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="关键词" className="xl:col-span-2">
              <Input name="q" defaultValue={filters.q} placeholder="UID、用户名、邮箱、展示名、学号或学校" />
            </FormField>
            <FormField label="账号状态"><SimpleSelect name="status" defaultValue={filters.status} options={[{ value: 'all', label: '全部状态' }, { value: 'enabled', label: '正常' }, { value: 'disabled', label: '已禁用' }]} /></FormField>
            <FormField label="系统管理员"><SimpleSelect name="admin" defaultValue={filters.admin} options={[{ value: 'all', label: '全部' }, { value: 'yes', label: '仅管理员' }, { value: 'no', label: '非管理员' }]} /></FormField>
            <FormField label="安全能力"><SimpleSelect name="security" defaultValue={filters.security} options={[{ value: 'all', label: '全部' }, { value: 'tfa', label: '已启用 TOTP' }, { value: 'webauthn', label: '有 Passkey' }, { value: 'oauth', label: '有 OAuth 关联' }, { value: 'none', label: '均未配置' }]} /></FormField>
            <FormField label="绑定状态" hint={!data.bindingAvailable ? '用户绑定模块不可用，筛选已禁用。' : undefined}>
              <SimpleSelect name="binding" defaultValue={data.bindingAvailable ? filters.binding : 'all'} disabled={!data.bindingAvailable} options={[{ value: 'all', label: '全部' }, { value: 'bound', label: '已绑定' }, { value: 'unbound', label: '未绑定' }]} />
            </FormField>
            <FormField label="用户组所在域" hint="切换域后先应用筛选，再选择该域用户组。"><SimpleSelect name="groupDomain" defaultValue={filters.groupDomain} options={domainOptions} /></FormField>
            <FormField label="用户组"><SimpleSelect name="group" defaultValue={filters.group} options={[{ value: '', label: '全部用户组' }, ...metadata.groups.map((group) => ({ value: group.name, label: `${group.name} (${group.count})` }))]} /></FormField>
            <FormField label="角色所在域" hint="切换域后先应用筛选，再选择该域角色。"><SimpleSelect name="roleDomain" defaultValue={filters.roleDomain} options={domainOptions} /></FormField>
            <FormField label="域角色"><SimpleSelect name="role" defaultValue={filters.role} options={[{ value: '', label: '全部角色' }, ...metadata.roles.map((role) => ({ value: role, label: role }))]} /></FormField>
            <FormField label="注册日期从"><Input type="date" name="registeredFrom" defaultValue={filters.registeredFrom} /></FormField>
            <FormField label="注册日期至"><Input type="date" name="registeredTo" defaultValue={filters.registeredTo} /></FormField>
            <FormField label="登录日期从"><Input type="date" name="loginFrom" defaultValue={filters.loginFrom} /></FormField>
            <FormField label="登录日期至"><Input type="date" name="loginTo" defaultValue={filters.loginTo} /></FormField>
            <FormField label="排序字段"><SimpleSelect name="sort" defaultValue={filters.sort} options={[{ value: 'uid', label: 'UID' }, { value: 'username', label: '用户名' }, { value: 'registeredAt', label: '注册时间' }, { value: 'lastLoginAt', label: '最近登录' }]} /></FormField>
            <FormField label="排序方向"><SimpleSelect name="order" defaultValue={filters.order} options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} /></FormField>
          </div>
          <div className="flex justify-end"><Button type="submit"><Search />应用筛选</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function BulkActionDialog({ open, selected, metadata, onClose }: {
  open: boolean;
  selected: number[];
  metadata: AccountMetadata;
  onClose: () => void;
}) {
  const [action, setAction] = useState('force_logout');
  const [group, setGroup] = useState(metadata.groups[0]?.name || '');
  const [role, setRole] = useState(metadata.roles[0] || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAction('force_logout');
    setGroup(metadata.groups[0]?.name || '');
    setRole(metadata.roles[0] || '');
    setPassword('');
    setBusy(false);
    setError(null);
  }, [open, metadata]);

  const needsGroup = action === 'group_add' || action === 'group_remove';
  const needsRole = action === 'set_role';
  const domainId = needsRole ? metadata.roleDomain : metadata.groupDomain;
  const valid = !!password && (!needsGroup || !!group) && (!needsRole || !!role);
  const label: Record<string, string> = {
    disable: '批量禁用',
    restore: '批量恢复',
    force_logout: '批量强制退出',
    group_add: '批量加入用户组',
    group_remove: '批量移出用户组',
    set_role: '批量分配域角色',
  };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postOperation({
        operation: 'bulk',
        uids: selected.join(','),
        action,
        password,
        ...(needsGroup || needsRole ? { targetDomainId: domainId } : {}),
        ...(needsGroup ? { group } : {}),
        ...(needsRole ? { role } : {}),
      });
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="w-full sm:w-[620px]" onClose={() => !busy && onClose()}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="size-4" />批量操作</DialogTitle></DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-sm">已选择 <strong>{selected.length}</strong> 个账号（单次上限 {metadata.bulkLimit}）。全部目标会先通过服务端预检。</div>
          <FormField label="操作"><SimpleSelect value={action} onValueChange={setAction} options={Object.entries(label).map(([value, text]) => ({ value, label: text }))} /></FormField>
          {needsGroup || needsRole ? (
            <FormField label="目标域">
              <SimpleSelect
                value={domainId}
                options={metadata.domains.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))}
                disabled
              />
              <p className="text-xs text-muted-foreground">用户组/角色选项来自当前筛选区选择的域；如需换域，请先在筛选区切换后应用。</p>
            </FormField>
          ) : null}
          {needsGroup ? <FormField label="用户组"><SimpleSelect value={group} onValueChange={setGroup} options={metadata.groups.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))} placeholder="该域暂无用户组" /></FormField> : null}
          {needsRole ? <FormField label="域角色"><SimpleSelect value={role} onValueChange={setRole} options={metadata.roles.map((item) => ({ value: item, label: item }))} placeholder="该域暂无角色" /></FormField> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBox label="变更前" value={{ targets: selected, state: '现状' }} />
            <SummaryBox label="变更后" value={{ operation: label[action], domainId: needsGroup || needsRole ? domainId : undefined, group: needsGroup ? group : undefined, role: needsRole ? role : undefined }} />
          </div>
          <FormField label="当前管理员密码" required><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></FormField>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="button" variant={action === 'disable' ? 'destructive' : 'default'} disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? <RefreshCw className="animate-spin" /> : <ShieldCheck />}{busy ? '处理中…' : label[action]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountList({ data, selected, setSelected, openBulk }: {
  data: AdminAccountsData;
  selected: Set<number>;
  setSelected: (next: Set<number>) => void;
  openBulk: () => void;
}) {
  const selectable = data.accounts.filter((account) => !account.protected);
  const allSelected = selectable.length > 0 && selectable.every((account) => selected.has(account.uid));
  const partlySelected = selectable.some((account) => selected.has(account.uid)) && !allSelected;
  const selectedArray = [...selected].sort((a, b) => a - b);
  const toggleAll = (checked: boolean) => {
    const next = new Set(selected);
    for (const account of selectable) {
      if (checked) next.add(account.uid);
      else next.delete(account.uid);
    }
    setSelected(next);
  };
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm">账号列表</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">共 {data.total} 个账号；当前第 {data.page} / {data.pageCount} 页</p>
        </div>
        {selected.size ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">已选 {selected.size}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={openBulk}><UserCog />批量操作</Button>
            <Button asChild size="sm" variant="outline"><a href={exportHref(selectedArray)}><Download />导出所选</a></Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X />取消选择</Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox size="sm" checked={allSelected} indeterminate={partlySelected} onCheckedChange={toggleAll} aria-label="选择本页账号" /></TableHead>
              <TableHead>账号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>学校 / 学号</TableHead>
              <TableHead>绑定</TableHead>
              <TableHead>安全</TableHead>
              <TableHead>最近登录</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.accounts.map((account) => (
              <TableRow key={account.uid} data-state={selected.has(account.uid) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    size="sm"
                    checked={selected.has(account.uid)}
                    disabled={account.protected}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected);
                      if (checked) next.add(account.uid);
                      else next.delete(account.uid);
                      setSelected(next);
                    }}
                    aria-label={`选择 ${account.username}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-56 items-center gap-3">
                    <Avatar className="size-9"><AvatarImage src={account.avatarUrl} alt={account.username} /><AvatarFallback className="text-xs">{makeInitials(account.displayName || account.username)}</AvatarFallback></Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{account.displayName || account.username}</span><span className="font-mono text-[11px] text-muted-foreground">UID {account.uid}</span></div>
                      <p className="truncate text-xs text-muted-foreground">{account.username} · {account.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell><div className="flex flex-wrap gap-1"><Badge variant={account.status === 'disabled' ? 'destructive' : 'outline'}>{account.status === 'disabled' ? '已禁用' : '正常'}</Badge>{account.isAdmin ? <Badge>系统管理员</Badge> : null}{account.protected ? <Badge variant="secondary">UID 2 保护</Badge> : null}</div></TableCell>
                <TableCell><p>{account.school || '—'}</p><p className="text-xs text-muted-foreground">{account.studentId || '无学号'}</p></TableCell>
                <TableCell>{account.binding ? <><p>{account.binding.realName || '已绑定'}</p><p className="text-xs text-muted-foreground">{account.binding.studentId || '—'}{account.binding.enrollmentYear ? ` · ${account.binding.enrollmentYear}` : ''}</p></> : <span className="text-muted-foreground">未绑定</span>}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{account.hasTfa ? <Badge variant="secondary">TOTP</Badge> : null}{account.hasWebAuthn ? <Badge variant="secondary">Passkey</Badge> : null}{account.oauthProviders.map((provider) => <Badge key={provider} variant="outline">{provider}</Badge>)}{!account.hasTfa && !account.hasWebAuthn && !account.oauthProviders.length ? <span className="text-muted-foreground">—</span> : null}</div></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{formatDate(account.lastLoginAt)}</TableCell>
                <TableCell className="text-right"><Button asChild size="sm" variant="ghost"><a href={accountDetailHref(account.uid)}>查看档案</a></Button></TableCell>
              </TableRow>
            ))}
            {!data.accounts.length ? <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">没有符合条件的账号</TableCell></TableRow> : null}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">每页 {data.pageSize} 个</p>
          <div className="flex items-center gap-2">
            <Button asChild={data.page > 1} type="button" size="sm" variant="outline" disabled={data.page <= 1}>{data.page > 1 ? <a href={accountHref({ page: data.page - 1, uid: null })}><ChevronLeft />上一页</a> : <><ChevronLeft />上一页</>}</Button>
            <span className="text-xs tabular-nums">{data.page} / {data.pageCount}</span>
            <Button asChild={data.page < data.pageCount} type="button" size="sm" variant="outline" disabled={data.page >= data.pageCount}>{data.page < data.pageCount ? <a href={accountHref({ page: data.page + 1, uid: null })}>下一页<ChevronRight /></a> : <>下一页<ChevronRight /></>}</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type DetailTab = 'profile' | 'security' | 'permissions' | 'related' | 'audit';

const DETAIL_TABS = new Set<DetailTab>(['profile', 'security', 'permissions', 'related', 'audit']);

function detailTabFromUrl(): DetailTab {
  const view = new URLSearchParams(window.location.search).get('view') as DetailTab | null;
  return view && DETAIL_TABS.has(view) ? view : 'profile';
}

function AccountDetailPanel({ detail, metadata }: { detail: AccountDetail; metadata: AccountMetadata }) {
  const bs = useBootstrap();
  const account = detail.account;
  const [tab, setTab] = useState<DetailTab>(detailTabFromUrl);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [profile, setProfile] = useState(() => ({
    username: account.username,
    email: account.email,
    displayName: account.displayName,
    avatar: account.avatar || '',
    qq: account.qq || '',
    gender: String(account.gender ?? 0),
    bio: account.bio || '',
    school: account.school || '',
    studentId: account.studentId || '',
  }));
  const [nextPassword, setNextPassword] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [priv, setPriv] = useState(account.priv);
  const [membershipDomain, setMembershipDomain] = useState(metadata.groupDomain);
  const [membershipGroup, setMembershipGroup] = useState(metadata.groups[0]?.name || '');
  const [roleDomain, setRoleDomain] = useState(metadata.roleDomain);
  const [role, setRole] = useState(metadata.roles[0] || '');

  useEffect(() => {
    setTab(detailTabFromUrl());
    setPending(null);
    setProfile({ username: account.username, email: account.email, displayName: account.displayName, avatar: account.avatar || '', qq: account.qq || '', gender: String(account.gender ?? 0), bio: account.bio || '', school: account.school || '', studentId: account.studentId || '' });
    setNextPassword('');
    setVerifyPassword('');
    setPriv(account.priv);
  }, [account.uid]);

  useEffect(() => {
    const syncTabFromHistory = () => setTab(detailTabFromUrl());
    window.addEventListener('popstate', syncTabFromHistory);
    return () => window.removeEventListener('popstate', syncTabFromHistory);
  }, []);

  const selectTab = (next: DetailTab) => {
    setTab(next);
    window.history.pushState({}, '', detailHref({ view: next === 'profile' ? null : next }));
  };

  const target = `${account.displayName || account.username}（UID ${account.uid}）`;
  const protectedMessage = account.protected ? 'UID 2 是固定超级管理员，此页面只展示其只读档案。' : null;
  const changeProfile = () => {
    const before = { username: account.username, email: account.email, displayName: account.displayName, avatar: account.avatar, qq: account.qq, gender: account.gender, bio: account.bio, school: account.school, studentId: account.studentId };
    const after = { ...profile, gender: Number(profile.gender) };
    const identityChanged = profile.username.trim() !== account.username || profile.email.trim() !== account.email;
    setPending({
      title: `保存 ${target} 的资料`,
      description: '仅更新明确列出的账号资料字段，UID 与系统派生字段不会改变。',
      impact: identityChanged ? '用户名或邮箱将改变登录标识，需要当前管理员密码再认证。' : '更新基础资料；不影响权限和业务数据。',
      before,
      after,
      requirePassword: identityChanged,
      fields: { operation: 'update_profile', uid: String(account.uid), expectedProfileVersion: account.profileVersion, ...profile },
      confirmLabel: '保存资料',
    });
  };
  const changePassword = () => {
    if (!nextPassword || nextPassword !== verifyPassword) return;
    setPending({
      title: `替换 ${target} 的密码`,
      description: '旧密码不可查看。新密码设置后立即生效，不要求用户下次登录再次修改。',
      impact: '替换密码，并撤销该账号全部登录 session、恢复 token 与 API/工具 token。',
      before: { password: '保持加密且不可见', access: '当前可能存在有效凭据' },
      after: { password: '已替换', access: '全部撤销' },
      fields: { operation: 'password', uid: String(account.uid), __newPassword: nextPassword, __verifyPassword: verifyPassword },
      confirmLabel: '替换密码',
      destructive: true,
    });
  };
  const simpleAction = (operation: string, title: string, impact: string, before: unknown, after: unknown, fields: Record<string, string> = {}, destructive = false) => setPending({
    title: `${title}：${target}`,
    description: '该操作由服务端再次校验目标与权限，并写入账号管理审计。',
    impact,
    before,
    after,
    fields: { operation, uid: String(account.uid), ...fields },
    confirmLabel: title,
    destructive,
  });
  const changeRole = () => {
    const current = detail.memberships.find((item) => item.domainId === roleDomain);
    simpleAction(
      'role',
      '设置域角色',
      `在 ${roleDomain} 域将角色设置为 ${role}。`,
      current || null,
      { domainId: roleDomain, role },
      { targetDomainId: roleDomain, role, expectedRole: current?.role || '', expectedJoin: String(!!current) },
    );
  };
  const changeGroup = (action: 'add' | 'remove') => {
    const member = detail.groups.some((item) => item.domainId === membershipDomain && item.name === membershipGroup);
    simpleAction(
      'group',
      action === 'add' ? '加入用户组' : '移出用户组',
      `${action === 'add' ? '加入' : '移出'} ${membershipDomain}/${membershipGroup}。`,
      { member },
      { member: action === 'add' },
      { targetDomainId: membershipDomain, group: membershipGroup, action, expectedMember: String(member) },
      action === 'remove',
    );
  };

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get('action') !== 'impersonate'
      || account.protected
      || account.isAdmin
      || account.status === 'disabled'
    ) return;
    setPending({
      title: `切换账号：${target}`,
      description: '该操作由服务端再次校验目标与权限，并写入账号管理审计。',
      impact: '当前会话将以目标账号浏览；顶部持续显示代理身份并可一键返回。',
      before: { actorUid: bs.user.id, targetUid: account.uid },
      after: { activeUid: account.uid },
      fields: { operation: 'impersonate', uid: String(account.uid) },
      confirmLabel: '切换账号',
    });
  }, [account.isAdmin, account.protected, account.status, account.uid, bs.user.id, target]);

  const tabs = [
    { value: 'profile' as const, label: '基本资料' },
    { value: 'security' as const, label: '账号安全' },
    { value: 'permissions' as const, label: '权限与成员关系' },
    { value: 'related' as const, label: '关联数据' },
    { value: 'audit' as const, label: '操作审计' },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-12"><AvatarImage src={account.avatarUrl} alt={account.username} /><AvatarFallback>{makeInitials(account.displayName || account.username)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><CardTitle>{account.displayName || account.username}</CardTitle><Badge variant="secondary">UID {account.uid}</Badge>{account.isAdmin ? <Badge>系统管理员</Badge> : null}{account.status === 'disabled' ? <Badge variant="destructive">已禁用</Badge> : null}</div>
              <p className="truncate text-sm text-muted-foreground">{account.username} · {account.email}</p>
            </div>
          </div>
        </div>
        {protectedMessage ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><Shield className="mr-2 inline size-4" />{protectedMessage}</div> : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={account.isAdmin || account.status === 'disabled'}
              title={account.isAdmin ? '不能切换到系统管理员账号' : account.status === 'disabled' ? '不能切换到已禁用账号' : undefined}
              onClick={() => simpleAction('impersonate', '切换账号', '当前会话将以目标账号浏览；顶部持续显示代理身份并可一键返回。', { actorUid: bs.user.id, targetUid: account.uid }, { activeUid: account.uid })}
            >
              <UserCog />切换账号
            </Button>
            {account.status === 'disabled' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => simpleAction('restore', '恢复账号', '恢复禁用前保存的非系统管理员权限，不恢复系统管理员位。', { status: account.status, priv: account.priv }, { status: 'enabled', priv: account.disabled?.previousPriv || metadata.defaultPriv }, { expectedPriv: String(account.priv) })}><ArchiveRestore />恢复</Button>
            ) : (
              <Button type="button" size="sm" variant="destructive" disabled={account.isAdmin || account.uid === bs.user.id} onClick={() => simpleAction('disable', '禁用账号', '可逆禁用并撤销全部访问凭据；题目、提交、消息和其他业务数据不会删除。', { status: account.status, priv: account.priv }, { status: 'disabled', businessData: '保留' }, { expectedPriv: String(account.priv) }, true)}><Ban />禁用</Button>
            )}
          </div>
        )}
        <MiniTabs value={tab} onValueChange={selectTab} items={tabs} className="max-w-full overflow-x-auto" aria-label="账号档案分区" />
      </CardHeader>
      <CardContent className="border-t pt-5">
        {tab === 'profile' ? (
          <div className="space-y-5">
            <FormSection title="可维护资料" description="UID、注册/登录时间与登录历史是只读系统事实。">
              <FormRow columns={2}>
                <FormField label="UID"><Input value={account.uid} disabled /></FormField>
                <FormField label="用户名"><Input value={profile.username} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, username: event.target.value }))} /></FormField>
                <FormField label="邮箱"><Input type="email" value={profile.email} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} /></FormField>
                <FormField label="system 域展示名"><Input value={profile.displayName} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))} /></FormField>
                <FormField label="头像规格"><Input value={profile.avatar} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, avatar: event.target.value }))} placeholder="gravatar:… 或 url:…" /></FormField>
                <FormField label="QQ"><Input value={profile.qq} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, qq: event.target.value }))} /></FormField>
                <FormField label="性别"><SimpleSelect value={profile.gender} disabled={account.protected} onValueChange={(gender) => setProfile((current) => ({ ...current, gender }))} options={[{ value: '0', label: '未设置' }, { value: '1', label: '男' }, { value: '2', label: '女' }]} /></FormField>
                <FormField label="学校"><Input value={profile.school} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, school: event.target.value }))} /></FormField>
                <FormField label="学号"><Input value={profile.studentId} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, studentId: event.target.value }))} /></FormField>
              </FormRow>
              <FormField label="简介"><Textarea value={profile.bio} disabled={account.protected} onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))} /></FormField>
              {!account.protected ? <div className="flex justify-end"><Button type="button" onClick={changeProfile}><Save />保存资料</Button></div> : null}
            </FormSection>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryBox label="注册时间" value={formatDate(account.registeredAt)} />
              <SummaryBox label="最近登录" value={formatDate(account.lastLoginAt)} />
              <SummaryBox label="注册 IP" value={account.registrationIps} />
              <SummaryBox label="最近登录 IP" value={account.lastLoginIp || '—'} />
            </div>
            {account.disabled ? (
              <SummaryBox label="禁用快照（只读）" value={{ ...account.disabled, banReason: account.banReason || '—' }} />
            ) : null}
          </div>
        ) : null}

        {tab === 'security' ? (
          <div className="space-y-5">
            {!account.protected ? (
              <FormSection title="替换密码" description="不会展示旧密码。成功后会撤销该账号的全部访问凭据。">
                <FormRow columns={2}>
                  <FormField label="新密码"><Input type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></FormField>
                  <FormField label="再次输入" error={verifyPassword && nextPassword !== verifyPassword ? '两次输入不一致' : undefined}><Input type="password" autoComplete="new-password" value={verifyPassword} onChange={(event) => setVerifyPassword(event.target.value)} /></FormField>
                </FormRow>
                <div className="flex justify-end"><Button type="button" variant="destructive" disabled={!nextPassword || nextPassword !== verifyPassword} onClick={changePassword}><KeyRound />替换密码并撤销凭据</Button></div>
              </FormSection>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-sm">二次验证与 OAuth</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">TOTP</p><p className="text-xs text-muted-foreground">{detail.security.hasTfa ? '已启用' : '未启用'}</p></div>{detail.security.hasTfa && !account.protected ? <Button size="sm" variant="outline" onClick={() => simpleAction('security', '清除 TOTP', '移除目标账号当前的 TOTP 配置。', { enabled: true }, { enabled: false }, { action: 'clear_tfa' }, true)}><Trash2 />清除</Button> : null}</div>
                  <div className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-sm font-medium">WebAuthn / Passkey</p><p className="text-xs text-muted-foreground">{detail.security.authenticators.length} 个设备</p></div>{detail.security.authenticators.length && !account.protected ? <Button size="sm" variant="outline" onClick={() => simpleAction('security', '移除全部 Passkey', '移除目标账号的全部 WebAuthn/passkey，不展示任何 credential。', { count: detail.security.authenticators.length }, { count: 0 }, { action: 'clear_webauthn' }, true)}><Trash2 />全部移除</Button> : null}</div>{detail.security.authenticators.map((item, index) => <div key={`${item.name}-${index}`} className="border-t py-2 text-xs"><p className="font-medium">{item.name || `设备 ${index + 1}`}</p><p className="text-muted-foreground">{item.deviceType || item.credentialType || '未知类型'} · {formatDate(item.registeredAt)}</p></div>)}</div>
                  <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">OAuth 关联</p>{detail.security.oauth.length ? detail.security.oauth.map((item) => <div key={item.platform} className="flex items-center justify-between gap-2 border-t py-2"><span className="text-sm">{item.platform}</span>{!account.protected ? <Button size="sm" variant="ghost" onClick={() => simpleAction('security', `解除 ${item.platform}`, '解除指定 OAuth 平台关联，不返回平台 secret。', { platform: item.platform, linked: true }, { platform: item.platform, linked: false }, { action: 'unlink_oauth', platform: item.platform }, true)}><Link2Off />解除</Button> : null}</div>) : <p className="text-xs text-muted-foreground">无 OAuth 关联</p>}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">访问凭据</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex flex-wrap gap-2">{!account.protected ? <><Button size="sm" variant="outline" onClick={() => simpleAction('security', '撤销全部 session', '目标账号将在所有已登录设备退出。', { sessions: detail.security.sessions.length }, { sessions: 0 }, { action: 'revoke_sessions' }, true)}><LogOut />撤销 session</Button><Button size="sm" variant="outline" onClick={() => simpleAction('security', '撤销 API/工具 token', '撤销与目标账号绑定的 API/工具访问凭据。', { apiTokens: detail.security.apiTokens.filter((item) => !item.revoked).length }, { apiTokens: 0 }, { action: 'revoke_api_tokens' }, true)}><KeyRound />撤销 API token</Button><Button size="sm" variant="destructive" onClick={() => simpleAction('security', '撤销全部访问凭据', '同时撤销 session、恢复 token 与 API/工具 token。', { sessions: detail.security.sessions.length, apiTokens: detail.security.apiTokens.filter((item) => !item.revoked).length }, { sessions: 0, apiTokens: 0 }, { action: 'revoke_all' }, true)}><ShieldAlert />全部撤销</Button></> : null}</div>
                  <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">登录 session（仅元数据）</p>{detail.security.sessions.length ? detail.security.sessions.map((session, index) => <div key={`${session.createdAt}-${index}`} className="border-t py-2 text-xs"><p>{formatDate(session.updatedAt || session.createdAt)} · {session.updatedIp || session.createdIp || '未知 IP'}</p><p className="truncate text-muted-foreground">{session.userAgent || '未知设备'}</p></div>) : <p className="text-xs text-muted-foreground">无有效 session</p>}</div>
                  <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">API/工具 token（仅元数据）</p>{detail.security.apiTokens.length ? detail.security.apiTokens.map((item) => <div key={item.id} className="border-t py-2 text-xs"><div className="flex flex-wrap items-center gap-1.5"><p className="font-medium">{item.label || item.display || '未命名'}</p>{item.revoked ? <Badge variant="secondary">已撤销</Badge> : <Badge variant="outline">有效</Badge>}</div><p className="mt-1 text-muted-foreground">最近使用 {formatDate(item.lastUsedAt)}</p><div className="mt-1.5 flex flex-wrap gap-1">{item.channels.length ? item.channels.map((channel) => <Badge key={channel} variant="secondary">{channel}</Badge>) : <span className="text-muted-foreground">无频道</span>}</div></div>) : <p className="text-xs text-muted-foreground">无账号绑定 token</p>}</div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'permissions' ? (
          <div className="space-y-5">
            <FormSection title="全站 privilege" description="普通管理员不能写 PRIV_ALL/-1。提升或降级系统管理员会撤销目标访问凭据。">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {metadata.privileges.map((entry) => <label key={entry.key} className="flex items-start gap-2 rounded-lg border p-3"><Checkbox checked={(priv & entry.value) === entry.value} disabled={account.protected || account.status === 'disabled'} onCheckedChange={(checked) => setPriv((current) => checked ? current | entry.value : current & ~entry.value)} /><span><span className="block text-sm font-medium">{privilegeLabel(entry.key)}</span><span className="font-mono text-[10px] text-muted-foreground">{entry.key} · {entry.value}</span></span></label>)}
              </div>
              {!account.protected ? <div className="flex justify-end"><Button type="button" disabled={account.status === 'disabled' || priv === account.priv} onClick={() => setPending({ title: `修改 ${target} 的全站权限`, description: '系统将再次校验 UID 2、操作者自降和最后管理员保护。', impact: '全站 privilege 位将立即改变；管理员位变化时撤销目标访问凭据。', before: { priv: account.priv, isAdmin: account.isAdmin }, after: { priv, isAdmin: (priv & PRIV.PRIV_EDIT_SYSTEM) === PRIV.PRIV_EDIT_SYSTEM }, fields: { operation: 'privilege', uid: String(account.uid), priv: String(priv), expectedPriv: String(account.priv) }, confirmLabel: '保存权限', destructive: account.isAdmin && (priv & PRIV.PRIV_EDIT_SYSTEM) === 0 })}><ShieldCheck />保存权限</Button></div> : null}
            </FormSection>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-sm">域成员与角色</CardTitle></CardHeader><CardContent className="space-y-3 pt-0">{detail.memberships.length ? detail.memberships.map((item) => <div key={item.domainId} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{item.domainName}</p><p className="text-xs text-muted-foreground">{item.domainId}</p></div><Badge variant="outline">{item.role}</Badge></div>) : <p className="text-sm text-muted-foreground">无域成员关系</p>}{!account.protected ? <div className="space-y-3 border-t pt-4"><FormField label="目标域"><SimpleSelect value={roleDomain} onValueChange={setRoleDomain} disabled options={metadata.domains.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))} /><p className="text-xs text-muted-foreground">角色选项来自筛选区当前角色域。</p></FormField><FormField label="角色"><SimpleSelect value={role} onValueChange={setRole} options={metadata.roles.map((item) => ({ value: item, label: item }))} placeholder="该域暂无角色" /></FormField><Button type="button" size="sm" disabled={!role} onClick={changeRole}><UserCog />设置角色</Button></div> : null}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">用户组</CardTitle></CardHeader><CardContent className="space-y-3 pt-0">{detail.groups.length ? <div className="flex flex-wrap gap-2">{detail.groups.map((item) => <Badge key={`${item.domainId}/${item.name}`} variant="secondary">{item.domainId} / {item.name}</Badge>)}</div> : <p className="text-sm text-muted-foreground">未加入用户组</p>}{!account.protected ? <div className="space-y-3 border-t pt-4"><FormField label="目标域"><SimpleSelect value={membershipDomain} onValueChange={setMembershipDomain} disabled options={metadata.domains.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))} /><p className="text-xs text-muted-foreground">用户组选项来自筛选区当前用户组域。</p></FormField><FormField label="用户组"><SimpleSelect value={membershipGroup} onValueChange={setMembershipGroup} options={metadata.groups.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))} placeholder="该域暂无用户组" /></FormField><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={!membershipGroup} onClick={() => changeGroup('add')}><Plus />加入</Button><Button type="button" size="sm" variant="outline" disabled={!membershipGroup} onClick={() => changeGroup('remove')}><Trash2 />移出</Button></div></div> : null}</CardContent></Card>
            </div>
          </div>
        ) : null}

        {tab === 'related' ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3"><SummaryBox label="system 域练习提交" value={detail.related.submissionCount} /><SummaryBox label="system 域通过提交" value={detail.related.acceptedCount} /><SummaryBox label="system 域拥有题目" value={detail.related.ownedProblems} /></div>
            <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><a href={detail.related.links.submissions}>查看练习提交</a></Button><Button asChild variant="outline" size="sm"><a href={detail.related.links.ownedProblems}>查看拥有题目</a></Button>{detail.binding.available ? <Button asChild variant="outline" size="sm"><a href={`/admin/userbind/students?q=${encodeURIComponent(account.studentId || account.username)}`}>打开绑定管理</a></Button> : null}</div>
            <Card><CardHeader><CardTitle className="text-sm">绑定档案（只读）</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{detail.binding.available ? detail.binding.student ? <StructuredValue value={detail.binding.student} /> : <p className="text-muted-foreground">当前账号未绑定学生档案</p> : <p className="text-destructive">用户绑定模块不可用；未将其伪装为空数据。</p>}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">最近登录活动（只读）</CardTitle></CardHeader><CardContent className="space-y-2 pt-0">{detail.activity.length ? detail.activity.map((item, index) => <div key={`${item.time}-${index}`} className="rounded-lg border p-3 text-xs"><p>{formatDate(item.time)} · {item.operateIp || '未知 IP'}</p><p className="truncate text-muted-foreground">{item.ua || '未知设备'}</p></div>) : <p className="text-sm text-muted-foreground">暂无登录活动记录</p>}</CardContent></Card>
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">最近 50 条与此账号相关的账号管理审计。秘密字段已在服务端净化。</p>
            {detail.audit.length ? detail.audit.map((entry, index) => <div key={entry._id || `${entry.time}-${index}`} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge variant={entry.result === 'success' ? 'default' : entry.result === 'failed' ? 'destructive' : 'secondary'}>{auditResultLabel(entry.result)}</Badge><span className="text-xs font-medium">{auditTypeLabel(entry.type)}</span></div><span className="text-xs text-muted-foreground">{formatDate(entry.time)}</span></div><p className="mt-2 text-xs text-muted-foreground">操作者 UID {entry.operator ?? '—'} · IP {entry.operateIp || '—'}{entry.impact ? ` · ${auditImpactLabel(entry.impact)}` : ''}{entry.targetUids ? ` · ${entry.targetUids.length} 个目标` : ''}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><SummaryBox label="变更前" value={entry.before} /><SummaryBox label="变更后" value={entry.after} />{entry.progress ? <SummaryBox label="执行阶段" value={entry.progress} /> : null}{entry.detail ? <SummaryBox label="结果摘要" value={entry.detail} /> : null}</div>{entry.error?.message ? <p className="mt-2 text-xs text-destructive">{entry.error.message}</p> : null}</div>) : <p className="py-8 text-center text-sm text-muted-foreground">暂无账号管理审计</p>}
          </div>
        ) : null}
      </CardContent>
      <SensitiveActionDialog
        action={pending}
        onClose={() => {
          setPending(null);
          if (new URLSearchParams(window.location.search).has('action')) {
            window.history.replaceState({}, '', detailHref({ action: null }));
          }
        }}
      />
    </Card>
  );
}

export function AdminAccountsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as AdminAccountsData;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'import');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [created, setCreated] = useState<{ uid: number; username: string; password: string } | null>(null);
  const selectedArray = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  useEffect(() => {
    const syncImportFromHistory = () => setImportOpen(new URLSearchParams(window.location.search).get('view') === 'import');
    window.addEventListener('popstate', syncImportFromHistory);
    return () => window.removeEventListener('popstate', syncImportFromHistory);
  }, []);

  const openImport = () => {
    window.history.pushState({}, '', accountHref({ view: 'import' }));
    setImportOpen(true);
  };
  const closeImport = () => {
    if (new URLSearchParams(window.location.search).get('view') === 'import') {
      window.history.replaceState({}, '', accountHref({ view: null }));
    }
    setImportOpen(false);
  };

  return (
    <AdminPage
      title="全站账号管理"
      description={`管理可登录真实账号。UID ${data.metadata.superadminUid} 为只读超级管理员；不提供永久删除或任意字段编辑。`}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      hideSidebar
      contentClassName="pb-6"
      actions={(
        <>
          <Button type="button" variant="outline" onClick={openImport}><FileUp />批量导入</Button>
          <Button asChild variant="outline"><a href={exportHref()}><Download />导出 CSV</a></Button>
          <Button type="button" onClick={() => setCreateOpen(true)}><Plus />创建账号</Button>
        </>
      )}
    >
      <AccountFiltersPanel data={data} />
      {new URLSearchParams(window.location.search).get('view') === 'permissions' ? (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          旧权限管理入口已合并到账号档案。请选择一个账号，页面会直接打开“权限与成员关系”。
        </div>
      ) : null}
      <AccountList data={data} selected={selected} setSelected={setSelected} openBulk={() => setBulkOpen(true)} />
      <CreateAccountDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={setCreated} />
      <OneTimePasswordDialog result={created} onClose={() => { setCreated(null); window.location.reload(); }} />
      <ImportAccountsDialog open={importOpen} onClose={closeImport} />
      <BulkActionDialog open={bulkOpen} selected={selectedArray} metadata={data.metadata} onClose={() => setBulkOpen(false)} />
    </AdminPage>
  );
}

export function AdminAccountDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as AdminAccountDetailData;
  const account = data.detail.account;

  return (
    <AdminPage
      title="账号档案"
      description={`${account.displayName || account.username}（UID ${account.uid}）的资料、安全、权限、关联数据与操作审计。`}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      hideSidebar
      contentClassName="pb-6"
      actions={(
        <Button asChild variant="outline">
          <a href={data.returnTo}><ChevronLeft />返回账号列表</a>
        </Button>
      )}
    >
      <AccountDetailPanel detail={data.detail} metadata={data.metadata} />
    </AdminPage>
  );
}
