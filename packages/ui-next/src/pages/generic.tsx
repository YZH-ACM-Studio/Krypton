import type { ReactNode } from 'react';
import { ArrowLeft, Boxes, CheckCircle2, CircleOff, FileText, Hash, LinkIcon, ListTree, Table2, Text } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stat } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, unknown>;

/** Rows rendered by ObjectTable — hydro docs commonly carry one of these identifying keys. */
interface RowDoc extends R {
  _id?: string | number;
  docId?: string | number;
  name?: string;
}

interface GenericPageData extends R {
  ddoc?: { title?: string };
  pdoc?: { title?: string };
  tdoc?: { title?: string };
  udoc?: { uname?: string };
}

const TEMPLATE_LABELS: Record<string, string> = {
  'problem_edit.html': '编辑题目',
  'problem_config.html': '题目配置',
  'problem_files.html': '题目文件',
  'problem_solution.html': '题解',
  'problem_statistics.html': '题目统计',
  'problem_import.html': '导入题目',
  'contest_edit.html': '编辑比赛',
  'contest_teams.html': '比赛队伍',
  'contest_manage.html': '比赛管理',
  'contest_problemlist.html': '比赛题目',
  'contest_user.html': '比赛参赛者',
  'contest_balloon.html': '气球分发',
  'contest_clarification.html': '比赛答疑',
  'contest_print.html': '打印',
  'homework_edit.html': '编辑作业',
  'homework_files.html': '作业文件',
  'problem_set_edit.html': '编辑题集',
  'problem_set_files.html': '题集文件',
  'problem_set_roster.html': '参加名单',
  'discussion_create.html': '发起讨论',
  'discussion_edit.html': '编辑讨论',
  'domain_create.html': '创建域',
  'domain_edit.html': '编辑域',
  'domain_user.html': '域用户',
  'domain_user_raw.html': '域用户',
  'domain_permission.html': '域权限',
  'domain_role.html': '域角色',
  'domain_group.html': '用户组',
  'domain_join.html': '加入域',
  'domain_join_applications.html': '加入申请',
  'manage_script.html': '运行脚本',
  'manage_setting.html': '系统设置',
  'manage_config.html': '系统配置',
  'manage_user_import.html': '导入用户',
  'manage_user_priv.html': '用户权限',
  'user_register_mail_sent.html': '注册邮件已发送',
  'user_lostpass_with_code.html': '重置密码',
  'user_sudo.html': '鉴权',
  'user_sudo_redirect.html': '鉴权跳转',
  'user_delete_pending.html': '删除账号',
  'user_changemail_mail_sent.html': '更换邮箱',
  'contest_mode.html': '比赛模式',
};

export function GenericPage() {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;
  const data = bs.page.data as GenericPageData;
  const label = TEMPLATE_LABELS[tpl] || tpl.replace(/\.html$/, '').replace(/_/g, ' ');

  const title = data.pdoc?.title || data.tdoc?.title || data.ddoc?.title || data.udoc?.uname || '';
  const entries = usefulEntries(data);
  const metrics = entries.filter(([, value]) => isScalar(value) || Array.isArray(value) || isPlainObject(value)).slice(0, 6);

  return (
    <Page width="wide">
      <PageHeader
        title={<span className="block min-w-0 truncate capitalize">{label}</span>}
        description={title ? <span className="block min-w-0 truncate">{title}</span> : undefined}
        actions={
          <>
            <Button type="button" variant="ghost" size="sm" iconOnly className="shrink-0" title="返回" aria-label="返回" onClick={() => window.history.back()}>
              <ArrowLeft />
            </Button>
            <Badge variant="outline" size="sm">
              {tpl}
            </Badge>
          </>
        }
      />

      {entries.length > 0 ? (
        <>
          {metrics.length > 0 ? (
            <Panel>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {metrics.map(([key, value]) => (
                  <div key={key} className="@container min-w-0 overflow-hidden">
                    <Stat
                      label={labelFor(key)}
                      value={<span className="block max-w-[100cqw] truncate">{describeValue(value, bs.locale)}</span>}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <div className="grid gap-4">
            {entries.map(([key, value]) => (
              <DataSection key={key} name={key} value={value} locale={bs.locale} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState compact icon={<FileText />} title="此页面尚无额外数据" />
      )}
    </Page>
  );
}

const HIDDEN_KEYS = new Set(['_', 'handler', 'model', 'global', 'ctx', 'context', 'domain', 'udict', 'UserContext', 'UiContext', 'params']);

const LABELS: Record<string, string> = {
  pdoc: '题目',
  tdoc: '比赛/作业',
  ddoc: '讨论/文章',
  udoc: '用户',
  udict: '用户字典',
  pdocs: '题目列表',
  tdocs: '比赛/训练列表',
  ddocs: '讨论列表',
  rdocs: '提交记录',
  psdocs: '题解',
  tsdocs: '参赛记录',
  users: '用户',
  roles: '角色',
  groups: '用户组',
  settings: '设置项',
  current: '当前配置',
  files: '文件',
  page: '页码',
  pcount: '总数',
  dpcount: '总页数',
  title: '标题',
  content: '内容',
};

function usefulEntries(data: R): [string, unknown][] {
  return Object.entries(data || {})
    .filter(([key, value]) => !HIDDEN_KEYS.has(key) && value !== undefined)
    .filter(([key]) => !key.startsWith('__'));
}

function labelFor(key: string) {
  if (LABELS[key]) return LABELS[key];
  return key
    .replace(/docs$/i, ' 列表')
    .replace(/doc$/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

function isPlainObject(value: unknown): value is R {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown) {
  return value == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value);
}

function isDateLike(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value);
  if (/^\d{24}$/.test(text)) return false;
  if (!/^\d{4}-\d{2}-\d{2}|^\d{13}$/.test(text)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isUrl(value: unknown) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function describeValue(value: unknown, locale: string): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return `${value.length} 项`;
  if (isPlainObject(value)) return `${Object.keys(value).length} 字段`;
  if (typeof value === 'boolean') return value ? '启用' : '关闭';
  if (isDateLike(value)) return formatDateTime(value, locale);
  return String(value);
}

function iconFor(value: unknown) {
  if (Array.isArray(value)) return Table2;
  if (isPlainObject(value)) return ListTree;
  if (typeof value === 'number' || typeof value === 'bigint') return Hash;
  if (typeof value === 'boolean') return value ? CheckCircle2 : CircleOff;
  if (isUrl(value)) return LinkIcon;
  return Text;
}

function DataSection({ name, value, locale }: { name: string; value: unknown; locale: string }) {
  const title = labelFor(name);
  const Icon = iconFor(value);

  return (
    <Panel
      title={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon className="size-4 shrink-0 text-fg-subtle" />
          <span className="truncate">{title}</span>
        </span>
      }
      actions={
        <Badge variant="outline" size="sm" className="font-mono">
          {name}
        </Badge>
      }
    >
      <ValueView value={value} locale={locale} depth={0} />
    </Panel>
  );
}

function ValueView({ value, locale, depth }: { value: unknown; locale: string; depth: number }): ReactNode {
  if (isScalar(value)) return <ScalarValue value={value} locale={locale} />;
  if (Array.isArray(value)) return <ArrayValue value={value} locale={locale} depth={depth} />;
  if (isPlainObject(value)) return <ObjectValue value={value} locale={locale} depth={depth} />;
  return <span className="text-sm text-fg-muted">{String(value)}</span>;
}

function ScalarValue({ value, locale }: { value: unknown; locale: string }) {
  if (typeof value === 'boolean') {
    return <Badge variant={value ? 'soft' : 'outline'}>{value ? '是' : '否'}</Badge>;
  }
  if (isUrl(value)) {
    return (
      <a href={String(value)} className="break-all text-sm text-brand-fg underline-offset-4 hover:underline">
        {String(value)}
      </a>
    );
  }
  if (isDateLike(value)) {
    return <span className="text-sm">{formatDateTime(value, locale)}</span>;
  }
  return <span className="break-words text-sm">{describeValue(value, locale)}</span>;
}

function ArrayValue({ value, locale, depth }: { value: unknown[]; locale: string; depth: number }) {
  if (value.length === 0) {
    return <EmptyData label="暂无条目" />;
  }

  if (value.every(isPlainObject)) {
    return <ObjectTable rows={value as RowDoc[]} locale={locale} depth={depth} />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {value.slice(0, 80).map((item, index) => (
        <div key={index} className="rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm">
          <ValueView value={item} locale={locale} depth={depth + 1} />
        </div>
      ))}
      {value.length > 80 ? <Badge variant="outline">另有 {value.length - 80} 项</Badge> : null}
    </div>
  );
}

function ObjectValue({ value, locale, depth }: { value: R; locale: string; depth: number }) {
  const entries = usefulEntries(value);
  if (entries.length === 0) return <EmptyData label="无可显示字段" />;

  const arrayEntries = entries.filter(([, item]) => Array.isArray(item) && item.every(isPlainObject));
  if (depth === 0 && arrayEntries.length === 1 && entries.length <= 3) {
    return <ObjectTable rows={arrayEntries[0][1] as RowDoc[]} locale={locale} depth={depth} />;
  }

  return (
    <div className="divide-y divide-line-subtle rounded-md border border-line">
      {entries.map(([key, item]) => (
        <div key={key} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[12rem_1fr]">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{labelFor(key)}</p>
            <p className="truncate font-mono text-2xs text-fg-subtle">{key}</p>
          </div>
          <div className="min-w-0">
            {isPlainObject(item) || Array.isArray(item) ? (
              depth >= 2 ? (
                <span className="text-sm text-fg-muted">{describeValue(item, locale)}</span>
              ) : (
                <details>
                  <summary className="cursor-pointer select-none text-sm text-brand-fg">{describeValue(item, locale)}</summary>
                  <div className="mt-2">
                    <ValueView value={item} locale={locale} depth={depth + 1} />
                  </div>
                </details>
              )
            ) : (
              <ValueView value={item} locale={locale} depth={depth + 1} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const COLUMN_PRIORITY = [
  'title',
  'name',
  'uname',
  'pid',
  'docId',
  '_id',
  'uid',
  'owner',
  'role',
  'status',
  'score',
  'views',
  'nReply',
  'updateAt',
  'createdAt',
  'time',
  'size',
];

function pickColumns(rows: R[]) {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) {
      if (!HIDDEN_KEYS.has(key) && !key.startsWith('__')) keys.add(key);
    }
  }
  const ordered = [...COLUMN_PRIORITY.filter((key) => keys.has(key)), ...Array.from(keys).filter((key) => !COLUMN_PRIORITY.includes(key))];
  return ordered.slice(0, 6);
}

function ObjectTable({ rows, locale, depth }: { rows: RowDoc[]; locale: string; depth: number }) {
  if (rows.length === 0) return <EmptyData label="暂无条目" />;
  const columns = pickColumns(rows);
  if (columns.length === 0) return <EmptyData label={`${rows.length} 项`} />;

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{labelFor(column)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 40).map((row, index) => (
            <TableRow key={row._id || row.docId || row.name || index}>
              {columns.map((column) => (
                <TableCell
                  key={column}
                  className={cn('max-w-xs', isPlainObject(row[column]) || Array.isArray(row[column]) ? 'text-fg-muted' : '')}
                >
                  <ValueView value={row[column]} locale={locale} depth={depth + 1} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 40 ? <p className="text-xs text-fg-subtle">已显示前 40 项，另有 {rows.length - 40} 项。</p> : null}
    </div>
  );
}

function EmptyData({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-4 text-sm text-fg-muted">
      <Boxes className="size-4 text-fg-subtle" />
      {label}
    </div>
  );
}
