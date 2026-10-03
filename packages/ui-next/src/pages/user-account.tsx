/**
 * Unified user account page — settings / security / messages / files
 * displayed in a single layout with tab navigation.
 *
 * Each tab corresponds to a separate server-side URL, so switching tabs
 * triggers a full-page navigation. The active tab is determined by the
 * current templateName from bootstrap.
 */

import { type ReactNode, useState } from 'react';
import {
  FolderOpen,
  Fingerprint,
  Globe,
  Link as LinkIcon,
  LogOut,
  Lock,
  Mail,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  Trophy,
  Upload,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { RedeemDialogButton } from '@/components/redeem-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AvatarUpload } from '@/components/uploader';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, toDate } from '@/lib/format';
import { MessagesPanel } from './messages';
import {
  settingFamilyDescription,
  settingFamilyLabel,
  settingHint,
  settingLabel,
  settingOptionLabel,
  shouldRenderAccountSetting,
} from './user-account-settings';

export { MessagesPanel, NARROW_QUERY } from './messages';

/* ------------------------------------------------------------------ */
/*  Server-doc shapes flowing through the loosely-typed page data      */
/* ------------------------------------------------------------------ */

/** Subset of hydrooj `Setting` consumed by the settings form. */
interface SettingDescriptor {
  key: string;
  name?: string;
  desc?: string;
  family?: string;
  type?: string;
  flag: number;
  ui?: string;
  value?: unknown;
  range?: Array<string | [string, string]> | Record<string, string>;
}

/** JSON-serialized MongoDB `Binary` (WebAuthn credential id). */
interface BinaryIdLike {
  $binary?: { base64?: unknown };
  buffer?: string | { data?: unknown };
  data?: unknown;
}

interface SessionDoc {
  _id: string;
  isCurrent?: boolean;
  updateIp?: string;
  createIp?: string;
  updateUaInfo?: { browser?: { name?: string }; os?: { name?: string } };
}

interface AuthenticatorDoc {
  credentialID?: string | BinaryIdLike;
  name?: string;
  credentialDeviceType?: string;
  fmt?: string;
  regat?: number;
}

interface OauthRelation {
  platform?: string;
  id?: string;
  name?: string;
}

interface LoginMethod {
  id?: string;
  type?: string;
  name?: string;
  text?: string;
}

interface UserFileDoc {
  _id?: string;
  name?: string;
  filename?: string;
  size?: number;
}

/** Owner-only CF / Nowcoder snapshot. Rating is server-owned and not editable. */
interface ExternalRatingSiteOwnerView {
  handle?: string | null;
  rating?: number | null;
  fetchedAt?: unknown;
  lastError?: string | null;
  publicShow?: boolean;
}

interface ExternalRatingAccountPayload {
  bound?: boolean;
  codeforces?: ExternalRatingSiteOwnerView | null;
  nowcoder?: ExternalRatingSiteOwnerView | null;
}

interface StudentBindingView {
  bound?: boolean;
  realName?: string | null;
  studentId?: string | null;
  enrollmentYear?: number | null;
  schoolName?: string | null;
}

interface UserAccountPageData {
  authenticators?: AuthenticatorDoc[];
  category?: string;
  current?: Record<string, unknown> & { avatarUrl?: string | null };
  externalRating?: ExternalRatingAccountPayload | null;
  /** Strict `true` from HomeSettings inject; missing hides the CF/Nowcoder section. */
  externalRatingBound?: boolean;
  files?: UserFileDoc[];
  loginMethods?: LoginMethod[];
  messages?: unknown;
  relations?: OauthRelation[];
  sessions?: SessionDoc[];
  settings?: SettingDescriptor[];
  studentBinding?: StudentBindingView | null;
}

const EXTERNAL_RATING_SAVE_ACTION = '/user/external-rating';
const EXTERNAL_RATING_REFRESH_ACTION = '/user/external-rating/refresh';
const EXTERNAL_RATING_REFRESH_FORM_ID = 'external-rating-refresh';

const EXTERNAL_RATING_SETTING_KEYS = {
  codeforcesHandle: 'codeforcesHandle',
  nowcoderName: 'nowcoderName',
  codeforcesRatingPublic: 'codeforcesRatingPublic',
  nowcoderRatingPublic: 'nowcoderRatingPublic',
} as const;

const EXTERNAL_RATING_SETTING_KEY_SET = new Set<string>(Object.values(EXTERNAL_RATING_SETTING_KEYS));

const EXTERNAL_RATING_ERROR_LABEL: Record<string, string> = {
  not_found: '未找到该用户',
  timeout: '抓取超时',
  http_error: '外站 HTTP 错误',
  api_error: '外站接口错误',
  parse_failed: '页面解析失败',
  network_error: '网络错误',
  network: '网络错误',
  rate_limited: '刷新过于频繁',
  invalid_handle: '账号不合法',
  malformed: '返回数据无法解析',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExternalRatingSetting(setting: SettingDescriptor): boolean {
  return setting.family === 'setting_external_rating' || EXTERNAL_RATING_SETTING_KEY_SET.has(setting.key);
}

function readExternalRatingPayload(data: UserAccountPageData): ExternalRatingAccountPayload | null {
  if (data.externalRating) return data.externalRating;
  const nested = data.current?.externalRating;
  if (!isRecord(nested)) return null;
  const payload: ExternalRatingAccountPayload = {};
  if (nested.bound === true) payload.bound = true;
  if (nested.codeforces !== undefined) payload.codeforces = readSiteOwnerView(nested.codeforces);
  if (nested.nowcoder !== undefined) payload.nowcoder = readSiteOwnerView(nested.nowcoder);
  return payload;
}

function readSiteOwnerView(value: unknown): ExternalRatingSiteOwnerView {
  if (!isRecord(value)) return {};
  const view: ExternalRatingSiteOwnerView = {};
  if (typeof value.handle === 'string') view.handle = value.handle;
  else if (value.handle === null) view.handle = null;
  if (typeof value.rating === 'number' && Number.isFinite(value.rating)) view.rating = value.rating;
  else if (value.rating === null) view.rating = null;
  if (value.fetchedAt !== undefined) view.fetchedAt = value.fetchedAt;
  if (typeof value.lastError === 'string') view.lastError = value.lastError;
  else if (value.lastError === null) view.lastError = null;
  if (value.publicShow === true) view.publicShow = true;
  return view;
}

function unwrapDateValue(value: unknown): unknown {
  if (!isRecord(value) || !('$date' in value)) return value;
  return value.$date;
}

function readOptionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatExternalRatingValue(rating: number | null | undefined): string {
  if (typeof rating === 'number' && Number.isFinite(rating)) return String(Math.round(rating));
  return '—';
}

function formatExternalRatingError(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  return EXTERNAL_RATING_ERROR_LABEL[lastError] ?? lastError;
}

function settingByKey(settings: SettingDescriptor[], key: string): SettingDescriptor | undefined {
  return settings.find((setting) => setting.key === key);
}

function binaryIdToBase64(value: string | BinaryIdLike | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.$binary?.base64) return String(value.$binary.base64);
  if (typeof value.buffer === 'string') return value.buffer;
  const data = value.buffer?.data || value.data;
  if (Array.isArray(data)) {
    const bytes = new Uint8Array(data);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }
  return String(value.buffer || value);
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                    */
/* ------------------------------------------------------------------ */

interface AccountTab {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  templates: string[];
}

function useTabs() {
  const bs = useBootstrap();
  const tabs: AccountTab[] = [
    { id: 'preference', label: '偏好', icon: Settings, href: `${bs.urls.settings}/preference`, templates: [] },
    { id: 'account', label: '账号', icon: UserIcon, href: `${bs.urls.settings}/account`, templates: [] },
    { id: 'domain', label: '域设置', icon: Globe, href: `${bs.urls.settings}/domain`, templates: [] },
    { id: 'security', label: '安全', icon: Shield, href: bs.urls.security, templates: ['home_security.html'] },
    { id: 'messages', label: '消息', icon: Mail, href: bs.urls.messages, templates: ['home_messages.html'] },
    { id: 'files', label: '文件', icon: FolderOpen, href: bs.urls.files, templates: ['home_files.html'] },
  ];
  // Determine active from templateName + data.category
  const tpl = bs.page.templateName;
  const category = (bs.page.data as UserAccountPageData | undefined)?.category;
  let activeId: string;

  if (tpl === 'home_settings.html') {
    activeId = category || 'preference';
  } else {
    activeId = tabs.find((t) => t.templates.includes(tpl))?.id || 'preference';
  }

  return { tabs, activeId };
}

/* ------------------------------------------------------------------ */
/*  Shell — wraps all sub-pages                                        */
/* ------------------------------------------------------------------ */

export function UserAccountPage() {
  const bs = useBootstrap();
  const { tabs, activeId } = useTabs();
  const tpl = bs.page.templateName;
  const isMessages = tpl === 'home_messages.html';

  let content: React.ReactNode;
  if (tpl === 'home_settings.html') content = <SettingsPanel />;
  else if (tpl === 'home_security.html') content = <SecurityPanel />;
  else if (isMessages) content = <MessagesPanel />;
  else if (tpl === 'home_files.html') content = <FilesPanel />;
  else content = <SettingsPanel />;

  const body = (
    <>
      <PageHeader
        title={isMessages ? '消息' : '账号设置'}
        description={isMessages ? undefined : '偏好、公开资料和登录安全都在这里。学号、姓名和学校只来自学生绑定。'}
      />
      <div className="min-w-0 max-w-full shrink-0 overflow-x-auto overflow-y-hidden scrollbar-none">
        <MiniTabs
          size="md"
          value={activeId}
          aria-label="账号设置分类"
          items={tabs.map((tab) => ({
            value: tab.id,
            label: tab.label,
            icon: tab.icon,
            href: tab.href,
            count: tab.id === 'messages' && bs.user.unreadMessages > 0 ? bs.user.unreadMessages : undefined,
          }))}
        />
      </div>
      {content}
    </>
  );

  if (isMessages) {
    return (
      <Page width="wide" className="flex h-full max-h-full min-h-0 flex-col overflow-hidden pb-0 [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:overflow-hidden">
        {body}
      </Page>
    );
  }
  return <Page width="form">{body}</Page>;
}

/* ------------------------------------------------------------------ */
/*  Settings panel                                                     */
/* ------------------------------------------------------------------ */

function SettingsPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const settings: SettingDescriptor[] = data.settings || [];
  const current: Record<string, unknown> = data.current || {};
  const showExternalRating = data.category === 'account' && data.externalRatingBound === true;
  const externalRating = readExternalRatingPayload(data);
  const isAccount = data.category === 'account';

  const families = new Map<string, SettingDescriptor[]>();
  for (const setting of settings) {
    if (!shouldRenderAccountSetting(setting) || isExternalRatingSetting(setting)) continue;
    const fam = setting.family || 'general';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(setting);
  }

  return (
    <div className="flex flex-col gap-4">
      {isAccount ? <StudentIdentityCard binding={data.studentBinding} /> : null}
      {bs.user.signedIn ? (
        <Panel title="兑换码" description="用兑换码获取题集或课程访问权益。结果在弹窗里显示。">
          <div className="flex flex-wrap justify-end">
            <RedeemDialogButton variant="outline" />
          </div>
        </Panel>
      ) : null}
      {showExternalRating ? <form id={EXTERNAL_RATING_REFRESH_FORM_ID} method="post" action={EXTERNAL_RATING_REFRESH_ACTION} hidden /> : null}
      <form method="post" className="flex flex-col gap-4">
        {Array.from(families.entries()).map(([fam, items]) => (
          <Panel key={fam} title={settingFamilyLabel(fam)} description={settingFamilyDescription(fam)}>
            <div className="flex flex-col gap-5">
              {items.map((setting) => (
                <SettingField key={setting.key} setting={setting} value={current[setting.key]} />
              ))}
            </div>
          </Panel>
        ))}
        <div className="flex flex-wrap justify-end">
          <Button type="submit" variant="primary">保存设置</Button>
        </div>
      </form>
      {showExternalRating ? (
        <Panel
          title={
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="size-4" />
              外站分数
            </span>
          }
          description="填写 Codeforces 用户名与牛客用户名后点保存即可抓取。公开开关默认关闭，只影响公开资料和排行榜。分数由系统抓取，不可编辑。"
        >
          <form method="post" action={EXTERNAL_RATING_SAVE_ACTION}>
            <ExternalRatingSettingsFields settings={settings} current={current} payload={externalRating} locale={bs.locale} />
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

function identityDetail(value: string | null | undefined, mono = false): ReactNode {
  const text = value?.trim() || '—';
  return mono ? <span className="font-mono">{text}</span> : text;
}

function StudentIdentityCard({ binding }: { binding?: StudentBindingView | null }) {
  const bound = binding?.bound === true;
  return (
    <Panel
      title="学生身份"
      description="学号、姓名和学校只来自花名册绑定，不能在账号设置里填写。"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs text-fg-subtle">
            {bound ? '绑定后无法在此修改。如需变更，请联系管理员。' : '去绑定页填写学校、学号和姓名，与花名册核对。'}
          </p>
          <Button asChild variant="secondary" size="sm" className="shrink-0">
            <a href="/userbind">{bound ? '查看绑定' : '去绑定'}</a>
          </Button>
        </div>
      }
    >
      {bound ? (
        <DescriptionList
          columns={2}
          items={[
            { term: '姓名', detail: identityDetail(binding?.realName) },
            { term: '学号', detail: identityDetail(binding?.studentId, true) },
            { term: '学校', detail: identityDetail(binding?.schoolName) },
            { term: '入学年', detail: identityDetail(binding?.enrollmentYear == null ? null : String(binding.enrollmentYear)) },
          ]}
        />
      ) : (
        <p className="text-sm text-fg-muted">还未绑定学生档案。绑定后，公开资料和考试页会显示花名册上的学号和姓名。</p>
      )}
    </Panel>
  );
}

function ExternalRatingSettingsFields({
  settings,
  current,
  payload,
  locale,
}: {
  settings: SettingDescriptor[];
  current: Record<string, unknown>;
  payload: ExternalRatingAccountPayload | null;
  locale: string;
}) {
  const codeforces = readSiteOwnerView(payload?.codeforces);
  const nowcoder = readSiteOwnerView(payload?.nowcoder);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="secondary" size="sm">
          保存
        </Button>
        <Button type="submit" form={EXTERNAL_RATING_REFRESH_FORM_ID} variant="secondary" size="sm">
          <RefreshCw />
          刷新分数
        </Button>
      </div>
      <ExternalRatingSiteFields
        siteLabel="Codeforces"
        handleSetting={settingByKey(settings, EXTERNAL_RATING_SETTING_KEYS.codeforcesHandle)}
        handleKey={EXTERNAL_RATING_SETTING_KEYS.codeforcesHandle}
        handleLabel="Codeforces 用户名"
        handlePlaceholder="tourist"
        handleMaxLength={24}
        publicSetting={settingByKey(settings, EXTERNAL_RATING_SETTING_KEYS.codeforcesRatingPublic)}
        publicKey={EXTERNAL_RATING_SETTING_KEYS.codeforcesRatingPublic}
        publicLabel="在公开资料和排行榜展示 Codeforces"
        current={current}
        snapshot={codeforces}
        locale={locale}
      />
      <ExternalRatingSiteFields
        siteLabel="牛客"
        handleSetting={settingByKey(settings, EXTERNAL_RATING_SETTING_KEYS.nowcoderName)}
        handleKey={EXTERNAL_RATING_SETTING_KEYS.nowcoderName}
        handleLabel="牛客用户名"
        handlePlaceholder="牛客用户名"
        handleMaxLength={64}
        publicSetting={settingByKey(settings, EXTERNAL_RATING_SETTING_KEYS.nowcoderRatingPublic)}
        publicKey={EXTERNAL_RATING_SETTING_KEYS.nowcoderRatingPublic}
        publicLabel="在公开资料和排行榜展示牛客"
        current={current}
        snapshot={nowcoder}
        locale={locale}
      />
    </div>
  );
}

function ExternalRatingSiteFields({
  siteLabel,
  handleSetting,
  handleKey,
  handleLabel,
  handlePlaceholder,
  handleMaxLength,
  publicSetting,
  publicKey,
  publicLabel,
  current,
  snapshot,
  locale,
}: {
  siteLabel: string;
  handleSetting: SettingDescriptor | undefined;
  handleKey: string;
  handleLabel: string;
  handlePlaceholder: string;
  handleMaxLength: number;
  publicSetting: SettingDescriptor | undefined;
  publicKey: string;
  publicLabel: string;
  current: Record<string, unknown>;
  snapshot: ExternalRatingSiteOwnerView;
  locale: string;
}) {
  const handleName = handleSetting?.key || handleKey;
  const publicName = publicSetting?.key || publicKey;
  const handleDisabled = !!((handleSetting?.flag ?? 0) & 2);
  const publicDisabled = !!((publicSetting?.flag ?? 0) & 2);
  const handleValue = readOptionalText(current[handleName]) || readOptionalText(snapshot.handle);
  const publicChecked = snapshot.publicShow === true;
  const fetchedAt = toDate(unwrapDateValue(snapshot.fetchedAt));
  const lastError = formatExternalRatingError(snapshot.lastError);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-sunken p-4">
      <p className="text-sm font-medium">{siteLabel}</p>
      <FormField label={handleLabel} hint="留空则清空该站账号">
        <Input
          name={handleName}
          defaultValue={handleValue}
          disabled={handleDisabled}
          placeholder={handlePlaceholder}
          maxLength={handleMaxLength}
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      <FormField label={publicLabel} hint="默认关闭。打开后公开资料和排行榜可以展示该站分数。">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <Switch name={publicName} value="on" defaultChecked={publicChecked} disabled={publicDisabled} />
          <span className="text-sm text-fg-muted">展示</span>
        </label>
      </FormField>
      <FormField label={`${siteLabel} 分数`} hint="由系统抓取，不可编辑">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium tabular">{formatExternalRatingValue(snapshot.rating)}</p>
          <p className="text-xs text-fg-subtle">{fetchedAt ? `最近抓取 ${formatDateTime(fetchedAt, locale)}` : '尚未抓取'}</p>
          {lastError ? <p className="text-xs text-danger-fg">失败：{lastError}</p> : null}
        </div>
      </FormField>
    </div>
  );
}

function SettingField({ setting, value }: { setting: SettingDescriptor; value: unknown }) {
  const isDisabled = !!(setting.flag & 2); // FLAG_DISABLED
  const isSecret = !!(setting.flag & 4); // FLAG_SECRET
  const bs = useBootstrap();
  const label = settingLabel(setting.key, setting.name);
  const hint = settingHint(setting.key, setting.desc || undefined);
  const isAvatar = setting.key === 'avatar';
  const fieldId = setting.key;

  if (isAvatar) {
    const data = bs.page.data as { current?: { avatarUrl?: string | null } };
    const current: { avatarUrl?: string | null } = data.current || {};
    const avatarUrl = current.avatarUrl || null;
    return (
      <FormField label={label} hint={hint}>
        <AvatarUpload
          uname={bs.user.name}
          currentUrl={avatarUrl || (typeof value === 'string' && /^https?:|^\//.test(value) ? value : null)}
          size={96}
        />
        <input type="hidden" name={setting.key} value={(value ?? '') as string} readOnly />
      </FormField>
    );
  }

  let control: ReactNode;
  let labelFor: string | undefined = fieldId;
  if (setting.type === 'boolean' || setting.type === 'checkbox') {
    control = (
      <label className="inline-flex cursor-pointer items-center gap-2">
        <Switch id={fieldId} name={setting.key} value="on" defaultChecked={!!value} disabled={isDisabled} />
        <span className="text-sm text-fg-muted">{setting.ui || '启用'}</span>
        {!isDisabled ? <input type="hidden" name={`booleanKeys.${setting.key}`} value="on" /> : null}
      </label>
    );
  } else if (setting.type === 'select') {
    control = (
      <SimpleSelect id={fieldId} name={setting.key} defaultValue={String(value ?? setting.value ?? '')} disabled={isDisabled} options={rangeOptions(setting.range)} />
    );
  } else if (setting.type === 'markdown' && !isDisabled) {
    labelFor = undefined;
    control = <MarkdownEditor name={setting.key} value={(value ?? setting.value ?? '') as string} minHeight={260} />;
  } else if (setting.type === 'textarea' || setting.type === 'markdown') {
    control = (
      <Textarea
        id={fieldId}
        name={setting.key}
        defaultValue={(value ?? setting.value ?? '') as string}
        disabled={isDisabled}
        rows={setting.type === 'markdown' ? 6 : 3}
        className="font-mono"
      />
    );
  } else if (setting.type === 'number' || setting.type === 'float') {
    control = (
      <Input
        id={fieldId}
        type="number"
        name={setting.key}
        defaultValue={(value ?? setting.value ?? '') as string | number}
        disabled={isDisabled}
        step={setting.type === 'float' ? 'any' : '1'}
      />
    );
  } else if (setting.type === 'password') {
    control = <Input id={fieldId} type="password" name={setting.key} defaultValue="" disabled={isDisabled} autoComplete="new-password" />;
  } else {
    control = (
      <Input
        id={fieldId}
        name={setting.key}
        defaultValue={isSecret ? '' : ((value ?? setting.value ?? '') as string)}
        disabled={isDisabled}
        type={isSecret ? 'password' : 'text'}
      />
    );
  }

  return (
    <FormField label={label} hint={hint} htmlFor={labelFor}>
      {control}
    </FormField>
  );
}

function rangeOptions(range: SettingDescriptor['range']): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt) => {
      const val = Array.isArray(opt) ? String(opt[0]) : String(opt);
      const rawLabel = Array.isArray(opt) ? String(opt[1] || opt[0]) : String(opt);
      return { value: val, label: settingOptionLabel(val, rawLabel) };
    });
  }
  return Object.entries(range).map(([val, label]) => ({
    value: val,
    label: settingOptionLabel(val, String(label)),
  }));
}

/* ------------------------------------------------------------------ */
/*  Security panel                                                     */
/* ------------------------------------------------------------------ */

function SecurityPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const sessions: SessionDoc[] = data.sessions || [];
  const authenticators: AuthenticatorDoc[] = data.authenticators || [];
  const relations: OauthRelation[] = data.relations || [];
  const loginMethods: LoginMethod[] = data.loginMethods || [];
  const linkedPlatforms = new Set(relations.map((relation) => relation.platform));
  const methodsToLink = loginMethods.filter((method) => !linkedPlatforms.has(method.id || method.type));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <UserIcon className="size-4" />
            修改用户名
          </span>
        }
      >
        <form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="operation" value="change_username" />
          <input type="hidden" name="expectedUsername" value={bs.user.name} />
          <FormRow columns={2}>
            <FormField label="新用户名">
              <Input name="username" defaultValue={bs.user.name} autoComplete="username" />
            </FormField>
            <FormField label="当前密码">
              <Input name="current" type="password" autoComplete="current-password" />
            </FormField>
          </FormRow>
          <p className="text-xs text-fg-subtle">保存后使用新用户名登录；现有登录会话保持不变。</p>
          <Button type="submit" variant="secondary" size="sm">
            更新用户名
          </Button>
        </form>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Lock className="size-4" />
            修改密码
          </span>
        }
      >
        <form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="operation" value="change_password" />
          <FormRow columns={1} className="lg:grid-cols-3">
            <FormField label="当前密码">
              <Input name="current" type="password" autoComplete="current-password" />
            </FormField>
            <FormField label="新密码">
              <Input name="password" type="password" autoComplete="new-password" />
            </FormField>
            <FormField label="确认新密码">
              <Input name="verifyPassword" type="password" autoComplete="new-password" />
            </FormField>
          </FormRow>
          <Button type="submit" variant="secondary" size="sm">
            更新密码
          </Button>
        </form>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Mail className="size-4" />
            修改邮箱
          </span>
        }
      >
        <form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="operation" value="change_mail" />
          <FormRow columns={2}>
            <FormField label="当前密码">
              <Input name="password" type="password" />
            </FormField>
            <FormField label="新邮箱">
              <Input name="mail" type="email" />
            </FormField>
          </FormRow>
          <Button type="submit" variant="secondary" size="sm">
            更换邮箱
          </Button>
        </form>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <LinkIcon className="size-4" />
            关联账号
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {bs.user.mail ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm">
              <span className="text-fg-subtle">邮箱</span>
              <span className="font-medium">{bs.user.mail}</span>
            </div>
          ) : null}
          {relations
            .filter((relation) => relation.platform !== 'mail')
            .map((relation) => (
              <div
                key={`${relation.platform}-${relation.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{relation.name || relation.platform}</p>
                  <p className="truncate text-xs text-fg-subtle">{relation.id}</p>
                </div>
                <form method="post">
                  <input type="hidden" name="operation" value="unlink_account" />
                  <Button type="submit" name="platform" value={relation.platform} size="sm" variant="secondary">
                    解绑
                  </Button>
                </form>
              </div>
            ))}
          {methodsToLink.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {methodsToLink.map((method) => (
                <form key={method.id || method.type} method="post">
                  <input type="hidden" name="operation" value="link_account" />
                  <Button type="submit" name="platform" value={method.id || method.type} size="sm" variant="secondary">
                    关联 {method.name || method.text || method.id || method.type}
                  </Button>
                </form>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Fingerprint className="size-4" />
            认证器
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {bs.user.tfa && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm">
              <div>
                <p className="font-medium">两步验证</p>
                <p className="text-xs text-fg-subtle">TOTP 动态验证码</p>
              </div>
              <form method="post">
                <input type="hidden" name="operation" value="disable_tfa" />
                <Button type="submit" size="sm" variant="secondary">
                  移除
                </Button>
              </form>
            </div>
          )}
          {authenticators.map((authenticator) => {
            const id = binaryIdToBase64(authenticator.credentialID);
            return (
              <div key={id || authenticator.name} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{authenticator.name || '未命名认证器'}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {[authenticator.credentialDeviceType, authenticator.fmt].filter(Boolean).join(' · ') || 'WebAuthn'}
                    {authenticator.regat ? ` · ${formatDateTime(authenticator.regat, bs.locale)}` : ''}
                  </p>
                </div>
                <form method="post">
                  <input type="hidden" name="operation" value="disable_authn" />
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" size="sm" variant="secondary">
                    移除
                  </Button>
                </form>
              </div>
            );
          })}
          {!bs.user.tfa && authenticators.length === 0 && <p className="text-sm text-fg-muted">暂无认证器</p>}
        </div>
      </Panel>

      <Panel
        title="活跃会话"
        flush
        footer={
          <div className="flex flex-wrap justify-end">
            <form
              method="post"
              onSubmit={(event) => {
                void confirmFormSubmit(event, '确定要注销所有会话吗？当前会话也会退出。', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete_all_tokens" />
              <Button type="submit" size="sm" variant="secondary">
                <LogOut />
                注销所有会话
              </Button>
            </form>
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">设备</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-fg-muted">
                  无活跃会话
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((s) => {
                const ua: NonNullable<SessionDoc['updateUaInfo']> = s.updateUaInfo || {};
                const browser = ua.browser?.name || '未知';
                const os = ua.os?.name || '';
                return (
                  <TableRow key={s._id}>
                    <TableCell className="pl-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">
                          {browser} {os ? `(${os})` : ''}
                        </span>
                        {s.isCurrent && (
                          <Badge variant="soft" tone="neutral" size="sm">
                            当前
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-fg-subtle">{s.updateIp || s.createIp || '—'}</TableCell>
                    <TableCell className="pr-4 text-right">
                      {!s.isCurrent && (
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="delete_token" />
                          <input type="hidden" name="tokenDigest" value={s._id} />
                          <Button type="submit" variant="danger-soft" size="sm">
                            撤销
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel title={<span className="text-danger-fg">危险区域</span>} className="border-danger-line">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs text-fg-subtle">删除账号后所有数据将无法恢复</p>
          <Button asChild variant="danger-soft" size="sm" className="shrink-0">
            <a href="/user/delete">删除账号</a>
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Files panel                                                        */
/* ------------------------------------------------------------------ */

function FilesPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const files: UserFileDoc[] = data.files || [];
  const [uploadName, setUploadName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (name: string) => {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectedList = Array.from(selectedFiles);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="上传文件">
        <form method="post" encType="multipart/form-data" className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <FormField label="选择文件" htmlFor="user-file">
            <input
              id="user-file"
              type="file"
              name="file"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-brand"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) setUploadName(file.name);
              }}
            />
          </FormField>
          <FormField label="保存为" htmlFor="user-filename">
            <Input
              id="user-filename"
              name="filename"
              value={uploadName}
              onChange={(event) => setUploadName(event.target.value)}
              placeholder="文件名"
              required
            />
          </FormField>
          <Button type="submit" variant="primary" size="sm">
            <Upload />
            上传
          </Button>
        </form>
      </Panel>

      {selectedList.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-brand-line bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg">
            已选择 <span className="tabular">{selectedList.length}</span> 个文件
          </p>
          <form
            method="post"
            onSubmit={(event) => {
              void confirmFormSubmit(event, '确认删除选中的文件吗？', { destructive: true });
            }}
          >
            <input type="hidden" name="operation" value="delete_files" />
            {selectedList.map((name) => (
              <input key={name} type="hidden" name="files" value={name} />
            ))}
            <Button type="submit" size="sm" variant="danger-soft">
              删除选中
            </Button>
          </form>
        </div>
      )}

      <Panel flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4" />
              <TableHead>文件名</TableHead>
              <TableHead className="w-24 text-right">大小</TableHead>
              <TableHead className="w-24 pr-4 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-fg-muted">
                  暂无文件
                </TableCell>
              </TableRow>
            ) : (
              files.map((f) => {
                const name = String(f.name || f.filename);
                return (
                  <TableRow key={String(f.name || f._id)}>
                    <TableCell className="pl-4">
                      <Checkbox checked={selectedFiles.has(name)} onChange={() => toggleFile(name)} />
                    </TableCell>
                    <TableCell className="text-sm font-medium">{f.name || f.filename}</TableCell>
                    <TableCell className="text-right text-xs text-fg-subtle tabular">
                      {f.size != null ? formatFileSize(f.size) : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <a href={`/file/${bs.user.id}/${f.name || f.filename}`}>下载</a>
                        </Button>
                        <form
                          method="post"
                          className="inline"
                          onSubmit={(event) => {
                            void confirmFormSubmit(event, `确认删除 ${f.name || f.filename}？`, { destructive: true });
                          }}
                        >
                          <input type="hidden" name="operation" value="delete_files" />
                          <input type="hidden" name="files" value={f.name || f.filename} />
                          <Button type="submit" variant="danger-soft" size="sm" aria-label="删除" title="删除">
                            <Trash2 />
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
