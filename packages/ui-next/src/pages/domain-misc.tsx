/**
 * Domain misc pages — create, join, join applications, contest mode.
 */

import { ArrowLeft, Globe, Key, Save, Trash2, UserPlus } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/display';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { useBootstrap } from '@/lib/bootstrap';

interface DomainJoinInfo {
  name?: string;
  bulletin?: string;
}

interface DomainJoinSettings {
  method?: number;
  role?: string;
  code?: string;
}

interface DomainMiscPageData {
  domainInfo?: DomainJoinInfo;
  joinSettings?: DomainJoinSettings;
  target?: string;
  redirect?: string;
  code?: string;
  rolesWithText?: Array<[string, string]>;
  expirations?: Record<string, string>;
  url_prefix?: string;
  bindings?: Array<{ _id: number; loginip: string }>;
}

function joinMethodTone(method: number | undefined): BadgeTone {
  if (method === 0) return 'danger';
  if (method === 1) return 'success';
  if (method === 2) return 'warning';
  return 'neutral';
}

function BackButton() {
  return (
    <Button type="button" variant="ghost" iconOnly aria-label="返回" onClick={() => window.history.back()}>
      <ArrowLeft />
    </Button>
  );
}

/* ---------- Domain Create ---------- */

export function DomainCreatePage() {
  return (
    <Page width="form">
      <PageHeader title="创建域" breadcrumb={<BackButton />} />
      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="域 ID" htmlFor="id" hint="只能包含字母、数字、下划线和连字符，以字母开头">
            <Input id="id" name="id" required placeholder="my-domain" pattern="[a-zA-Z][a-zA-Z0-9_-]*" />
          </FormField>

          <FormField label="域名称" htmlFor="name">
            <Input id="name" name="name" required placeholder="我的域" />
          </FormField>

          <FormField label="公告 (Markdown)" htmlFor="bulletin">
            <MarkdownEditor name="bulletin" value="" minHeight={220} />
          </FormField>

          <FormField label="头像 URL (可选)" htmlFor="avatar">
            <Input id="avatar" name="avatar" placeholder="https://..." />
          </FormField>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              <Globe />
              创建域
            </Button>
          </div>
        </form>
      </Panel>
    </Page>
  );
}

/* ---------- Domain Join ---------- */

export function DomainJoinPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainMiscPageData;
  const domainInfo = data.domainInfo || {};
  const joinSettings = data.joinSettings || {};
  const target = data.target || '';
  const redirect = data.redirect || '';
  const code = data.code || '';
  const needCode = joinSettings.method === 2; // JOIN_METHOD_CODE

  return (
    <Page width="form">
      <PageHeader title="加入域" breadcrumb={<BackButton />} />

      {domainInfo.name && (
        <Panel title={domainInfo.name}>
          {domainInfo.bulletin ? (
            <div className="rounded-md border border-line bg-surface-sunken p-3">
              <MarkdownView content={domainInfo.bulletin} />
            </div>
          ) : null}
        </Panel>
      )}

      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="redirect" value={redirect} />

          {needCode && (
            <FormField label="邀请码" htmlFor="code">
              <Input id="code" name="code" defaultValue={code} required placeholder="输入邀请码" />
            </FormField>
          )}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              <UserPlus />
              加入
            </Button>
          </div>
        </form>
      </Panel>
    </Page>
  );
}

/* ---------- Domain Join Applications ---------- */

export function DomainJoinApplicationsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainMiscPageData;
  const joinSettings = data.joinSettings || null;
  const rolesWithText = data.rolesWithText || [];
  const expirations = data.expirations || {};
  const urlPrefix = data.url_prefix || '';

  const METHOD_LABELS: Record<number, string> = {
    0: '禁止加入',
    1: '自由加入',
    2: '需要邀请码',
  };

  return (
    <AdminPage bypassPrivGate title="入域申请" description="管理加入域的方式与默认角色">
      {joinSettings && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={joinMethodTone(joinSettings.method)}>{METHOD_LABELS[joinSettings.method ?? -1] || '未知'}</Badge>
            {joinSettings.role && <Badge variant="outline">角色: {joinSettings.role}</Badge>}
          </div>
          {joinSettings.method === 2 && joinSettings.code && (
            <div className="mt-2 flex min-w-0 items-start gap-2 text-sm">
              <Key className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <span className="shrink-0 text-fg-muted">邀请码:</span>
              <Code className="min-w-0 break-all">{joinSettings.code}</Code>
            </div>
          )}
          {urlPrefix && (
            <p className="mt-2 min-w-0 text-xs text-fg-subtle">
              加入链接: <Code className="break-all">{urlPrefix}domain/join</Code>
            </p>
          )}
        </Panel>
      )}

      <Panel title="修改加入设置">
        <form method="post" className="grid gap-5">
          <FormField label="加入方式" htmlFor="method">
            <SimpleSelect
              id="method"
              name="method"
              defaultValue={String(joinSettings?.method ?? 0)}
              options={[
                { value: '0', label: '禁止加入' },
                { value: '1', label: '自由加入' },
                { value: '2', label: '需要邀请码' },
              ]}
            />
          </FormField>

          <FormField label="默认角色" htmlFor="role">
            <SimpleSelect
              id="role"
              name="role"
              defaultValue={joinSettings?.role || 'default'}
              options={rolesWithText.map(([val, text]) => ({
                value: val,
                label: text,
              }))}
            />
          </FormField>

          <FormField label="有效期" htmlFor="expire">
            <SimpleSelect
              id="expire"
              name="expire"
              defaultValue={Object.keys(expirations)[0]}
              options={Object.entries(expirations).map(([k, v]) => ({
                value: k,
                label: v as string,
              }))}
            />
          </FormField>

          <FormField label="邀请码" htmlFor="invitationCode">
            <Input id="invitationCode" name="invitationCode" defaultValue={joinSettings?.code || ''} placeholder="设置邀请码" />
          </FormField>

          <FormField label="加入用户组 (可选)" htmlFor="group">
            <Input id="group" name="group" placeholder="组名" />
          </FormField>

          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              <Save />
              保存
            </Button>
          </div>
        </form>
      </Panel>
    </AdminPage>
  );
}

/* ---------- Contest Mode ---------- */

export function ContestModePage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainMiscPageData;
  const bindings = data.bindings || [];

  return (
    <Page width="form">
      <PageHeader
        title="比赛模式"
        description={`比赛模式下，用户将绑定 IP 地址，只能在绑定的设备上登录。共 ${bindings.length} 个绑定。`}
        breadcrumb={<BackButton />}
        actions={(
          <form
            method="post"
            onSubmit={(e) => {
              void confirmFormSubmit(e, '确定要解绑所有用户吗？', { destructive: true });
            }}
          >
            <input type="hidden" name="operation" value="reset" />
            <Button type="submit" variant="danger-soft" size="sm">
              <Trash2 />
              全部解绑
            </Button>
          </form>
        )}
      />

      <Panel flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>UID</TableHead>
              <TableHead>IP 地址</TableHead>
              <TableHead className="w-20 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bindings.map((b) => (
              <TableRow key={b._id}>
                <TableCell className="font-mono text-sm tabular">{b._id}</TableCell>
                <TableCell className="font-mono text-sm">{b.loginip}</TableCell>
                <TableCell className="text-center">
                  <form method="post" className="inline">
                    <input type="hidden" name="operation" value="reset" />
                    <input type="hidden" name="uid" value={String(b._id)} />
                    <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label="解绑">
                      <Trash2 />
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
            {bindings.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-fg-muted">
                  暂无 IP 绑定
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Panel>
    </Page>
  );
}
