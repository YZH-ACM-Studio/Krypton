import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleOff,
  FileText,
  Hash,
  LinkIcon,
  ListTree,
  Table2,
  Text,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

const TEMPLATE_LABELS: Record<string, string> = {
  'problem_edit.html': '编辑题目',
  'problem_config.html': '题目配置',
  'problem_files.html': '题目文件',
  'problem_solution.html': '题解',
  'problem_statistics.html': '题目统计',
  'problem_import.html': '导入题目',
  'contest_edit.html': '编辑比赛',
  'contest_manage.html': '比赛管理',
  'contest_problemlist.html': '比赛题目',
  'contest_user.html': '比赛参赛者',
  'contest_balloon.html': '气球分发',
  'contest_clarification.html': '比赛答疑',
  'contest_print.html': '打印',
  'homework_edit.html': '编辑作业',
  'homework_files.html': '作业文件',
  'training_edit.html': '编辑训练',
  'training_files.html': '训练文件',
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
  const data = bs.page.data;
  const label = TEMPLATE_LABELS[tpl] || tpl.replace(/\.html$/, '').replace(/_/g, ' ');

  const title = data.pdoc?.title || data.tdoc?.title || data.ddoc?.title || data.udoc?.uname || '';
  const entries = usefulEntries(data);
  const metrics = entries
    .filter(([, value]) => isScalar(value) || Array.isArray(value) || isPlainObject(value))
    .slice(0, 6);

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold capitalize">{label}</h1>
          {title ? <p className="text-sm text-muted-foreground">{title}</p> : null}
        </div>
        <Badge variant="outline" className="ml-auto">{tpl}</Badge>
      </div>

      {entries.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map(([key, value]) => (
              <MetricTile key={key} name={key} value={value} locale={bs.locale} />
            ))}
          </div>

          <div className="grid gap-4">
            {entries.map(([key, value]) => (
              <DataSection key={key} name={key} value={value} locale={bs.locale} />
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">此页面尚无额外数据</p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}

const HIDDEN_KEYS = new Set([
  '_',
  'handler',
  'model',
  'global',
  'ctx',
  'context',
  'domain',
  'udict',
  'UserContext',
  'UiContext',
]);

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

function usefulEntries(data: R): [string, any][] {
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
  const date = new Date(value as any);
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

function MetricTile({ name, value, locale }: { name: string; value: unknown; locale: string }) {
  const Icon = iconFor(value);
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{labelFor(name)}</p>
          <p className="mt-1 truncate text-sm font-medium">{describeValue(value, locale)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DataSection({ name, value, locale }: { name: string; value: any; locale: string }) {
  const title = labelFor(name);
  const Icon = iconFor(value);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" />
          {title}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{name}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ValueView value={value} locale={locale} depth={0} />
      </CardContent>
    </Card>
  );
}

function ValueView({
  value,
  locale,
  depth,
}: {
  value: any;
  locale: string;
  depth: number;
}): ReactNode {
  if (isScalar(value)) return <ScalarValue value={value} locale={locale} />;
  if (Array.isArray(value)) return <ArrayValue value={value} locale={locale} depth={depth} />;
  if (isPlainObject(value)) return <ObjectValue value={value} locale={locale} depth={depth} />;
  return <span className="text-sm text-muted-foreground">{String(value)}</span>;
}

function ScalarValue({ value, locale }: { value: unknown; locale: string }) {
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'secondary' : 'outline'}>
        {value ? '是' : '否'}
      </Badge>
    );
  }
  if (isUrl(value)) {
    return (
      <a href={String(value)} className="break-all text-sm text-primary hover:underline">
        {String(value)}
      </a>
    );
  }
  if (isDateLike(value)) {
    return <span className="text-sm">{formatDateTime(value, locale)}</span>;
  }
  return <span className="break-words text-sm">{describeValue(value, locale)}</span>;
}

function ArrayValue({ value, locale, depth }: { value: any[]; locale: string; depth: number }) {
  if (value.length === 0) {
    return <EmptyData label="暂无条目" />;
  }

  if (value.every(isPlainObject)) {
    return <ObjectTable rows={value as R[]} locale={locale} depth={depth} />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {value.slice(0, 80).map((item, index) => (
        <div key={index} className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
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
    return <ObjectTable rows={arrayEntries[0][1] as R[]} locale={locale} depth={depth} />;
  }

  return (
    <div className="divide-y rounded-md border">
      {entries.map(([key, item]) => (
        <div key={key} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[180px_1fr]">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{labelFor(key)}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{key}</p>
          </div>
          <div className="min-w-0">
            {isPlainObject(item) || Array.isArray(item) ? (
              depth >= 2 ? (
                <span className="text-sm text-muted-foreground">{describeValue(item, locale)}</span>
              ) : (
                <details className="group">
                  <summary className="cursor-pointer select-none text-sm text-primary">
                    {describeValue(item, locale)}
                  </summary>
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
  const ordered = [
    ...COLUMN_PRIORITY.filter((key) => keys.has(key)),
    ...Array.from(keys).filter((key) => !COLUMN_PRIORITY.includes(key)),
  ];
  return ordered.slice(0, 6);
}

function ObjectTable({ rows, locale, depth }: { rows: R[]; locale: string; depth: number }) {
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
                  className={cn(
                    'max-w-[220px]',
                    isPlainObject(row[column]) || Array.isArray(row[column])
                      ? 'text-muted-foreground'
                      : '',
                  )}
                >
                  <ValueView value={row[column]} locale={locale} depth={depth + 1} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 40 ? (
        <p className="text-xs text-muted-foreground">已显示前 40 项，另有 {rows.length - 40} 项。</p>
      ) : null}
    </div>
  );
}

function EmptyData({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Boxes className="size-4" />
      {label}
    </div>
  );
}
