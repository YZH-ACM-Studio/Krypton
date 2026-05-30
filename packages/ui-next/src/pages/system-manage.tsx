/**
 * System management pages — settings, config, scripts, user import, user privileges.
 */

import { useMemo, useState } from 'react';
import * as YAML from 'yaml';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Key,
  Play,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

/* ================================================================== */
/*  Shared layout                                                      */
/* ================================================================== */

function ManageShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <AdminPage
      bypassPrivGate
      title={(
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
      )}
    >
      {children}
    </AdminPage>
  );
}

/* ================================================================== */
/*  System Settings (manage_setting.html)                              */
/* ================================================================== */

export function ManageSettingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const settings: R[] = data.settings || [];
  const current: R = data.current || {};

  const families = new Map<string, R[]>();
  for (const s of settings) {
    if (s.flag & 1) continue; // FLAG_HIDDEN
    const fam = s.family || 'general';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(s);
  }

  const familyLabels: Record<string, string> = {
    setting_server: '服务器',
    setting_limits: '限制',
    setting_basic: '基本',
    setting_smtp: '邮件 (SMTP)',
    setting_oauth: 'OAuth',
    setting_vigil: '反作弊',
    setting_storage: '存储',
    setting_file: '文件',
    setting_judge: '评测',
    setting_display: '显示',
    setting_usage: '使用',
    general: '通用',
  };

  return (
    <ManageShell title="系统设置" icon={Settings}>
      <Card>
        <CardContent className="p-5">
          <form method="post" className="space-y-6">
            {Array.from(families.entries()).map(([fam, items]) => (
              <fieldset key={fam} className="space-y-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {familyLabels[fam] || fam}
                </legend>
                {items.map((setting) => (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    value={current[setting.key]}
                  />
                ))}
              </fieldset>
            ))}
            <Separator />
            <div className="flex justify-end">
              <Button type="submit" className="gap-1">
                <Save className="size-3.5" />
                保存设置
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  System Config (manage_config.html)                                 */
/* ================================================================== */

/* ────────────────────────────────────────────────────────────────────── */
/*  System Config — visual schema-driven editor + YAML fallback           */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Cosmokind Schema toJSON shape. The top-level envelope is
 *   { uid: number, refs: { [id: number]: SchemaNode } }
 * where children inside `dict` / `list` are numeric ids pointing back into
 * `refs`. We resolve those lazily via `lookupRef`.
 */
interface SchemaEnvelope {
  uid: number;
  refs: Record<string, SchemaNode>;
}

type DescOrLang = string | Record<string, string>;

interface SchemaNode {
  type?: string;
  dict?: Record<string, number | SchemaNode>;
  list?: Array<number | SchemaNode>;
  inner?: number | SchemaNode;
  meta?: {
    description?: DescOrLang;
    default?: unknown;
    hidden?: boolean;
    role?: string;
    secret?: boolean;
    required?: boolean;
    [k: string]: unknown;
  };
  value?: unknown;
  [k: string]: unknown;
}

/** Pick a localised description if present; else the raw string. */
function describeMeta(meta: SchemaNode['meta'], locale = 'zh-CN'): string | undefined {
  const desc = meta?.description;
  if (!desc) return undefined;
  if (typeof desc === 'string') return desc;
  const langKey = locale.startsWith('zh') ? 'zh' : 'en';
  return (desc as Record<string, string>)[langKey] || (desc as Record<string, string>).en
    || (desc as Record<string, string>).zh
    || Object.values(desc as Record<string, string>)[0];
}

function lookupRef(env: SchemaEnvelope | undefined, ref: number | SchemaNode | undefined): SchemaNode | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'object') return ref;
  return env?.refs?.[String(ref)];
}

/** Walk an object along a path, returning the value or undefined. */
function getPath(obj: any, path: string[]): unknown {
  let cur: any = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Immutably set a value at a nested path; creates intermediate objects. */
function setPath(obj: any, path: string[], value: unknown): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {};
  next[head] = setPath(next[head], rest, value);
  return next;
}

/** Strip undefined nested entries so we don't emit empty `key:` lines. */
function compact(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(compact);
  if (typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const compacted = compact(v);
    if (compacted === undefined) continue;
    if (typeof compacted === 'object' && compacted !== null && !Array.isArray(compacted) && Object.keys(compacted).length === 0) {
      continue;
    }
    out[k] = compacted;
  }
  return out;
}

/** Flatten intersect / union into a single dict where possible. */
function resolveSchema(env: SchemaEnvelope | undefined, node: SchemaNode | number | undefined): SchemaNode {
  const resolved = typeof node === 'number' ? lookupRef(env, node) : node;
  if (!resolved) return { type: 'unknown' };
  if (resolved.type === 'intersect' && Array.isArray(resolved.list)) {
    const merged: SchemaNode = { type: 'object', dict: {}, meta: resolved.meta };
    for (const child of resolved.list) {
      const sub = resolveSchema(env, child);
      if (sub.type === 'object' && sub.dict) {
        Object.assign(merged.dict!, sub.dict);
      }
    }
    return merged;
  }
  if (resolved.type === 'union' && Array.isArray(resolved.list) && resolved.list.length > 0) {
    // Pick the first non-null branch as the form representation.
    const branches = resolved.list.map((c) => resolveSchema(env, c));
    const pick = branches.find((b) => b.type !== 'const' || (b.value !== null && b.value !== undefined)) || branches[0];
    return pick;
  }
  return resolved;
}

function SchemaField({
  node, path, value, onChange,
}: {
  node: SchemaNode;
  path: string[];
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const meta = node.meta || {};
  const isSecret = meta.secret === true || meta.role === 'secret';
  const description = describeMeta(meta);
  const display = isSecret && value === '[hidden]' ? '' : (value ?? '');

  if (node.type === 'string') {
    return (
      <div className="space-y-1">
        {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        <Input
          value={typeof display === 'string' || typeof display === 'number' ? String(display) : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSecret ? (value === '[hidden]' ? '（已设置，留空保持不变）' : '') : (meta.default as string) || ''}
          type={isSecret ? 'password' : 'text'}
          autoComplete="off"
          className="max-w-md"
        />
      </div>
    );
  }
  if (node.type === 'number') {
    return (
      <div className="space-y-1">
        {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        <Input
          type="number"
          value={typeof value === 'number' ? value : (value as any) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={meta.default != null ? String(meta.default) : ''}
          className="max-w-[200px]"
        />
      </div>
    );
  }
  if (node.type === 'boolean') {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
         />
        <span className="text-muted-foreground">{description || '启用'}</span>
      </label>
    );
  }
  if (node.type === 'const') {
    return (
      <div className="text-xs text-muted-foreground">
        固定值：<code className="rounded bg-muted px-1.5 py-0.5 font-mono">{String((node as any).value)}</code>
      </div>
    );
  }
  // Array / object / complex types fall back to a JSON-shaped textarea editor.
  return (
    <div className="space-y-1">
      {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
      <textarea
        value={(() => {
          if (value === undefined || value === null) return '';
          if (typeof value === 'string') return value;
          try { return YAML.stringify(value).trimEnd(); } catch { return String(value); }
        })()}
        onChange={(e) => {
          const text = e.target.value;
          if (!text.trim()) { onChange(undefined); return; }
          try {
            const parsed = YAML.parse(text);
            onChange(parsed);
          } catch {
            // Still update with raw text so user can keep typing; revert later if invalid.
            onChange(text);
          }
        }}
        rows={Math.min(8, Math.max(2, String(value || '').split('\n').length + 1))}
        className="w-full max-w-2xl resize-y rounded-md border bg-background p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder={node.type ? `（${node.type} — YAML）` : ''}
        spellCheck={false}
      />
    </div>
  );
}

function SchemaSection({
  env, node, path, value, onChange, defaultOpen = true,
}: {
  env: SchemaEnvelope | undefined;
  node: SchemaNode | number;
  path: string[];
  value: unknown;
  onChange: (path: string[], next: unknown) => void;
  defaultOpen?: boolean;
}) {
  const resolved = resolveSchema(env, node);
  const [open, setOpen] = useState(defaultOpen);

  if (resolved.type !== 'object' || !resolved.dict) {
    return (
      <SchemaField
        node={resolved}
        path={path}
        value={value}
        onChange={(next) => onChange(path, next)}
      />
    );
  }

  const sectionLabel = path.length === 0 ? '系统配置' : path[path.length - 1];
  const sectionDesc = describeMeta(resolved.meta);

  return (
    <div className={cn(
      'rounded-md border bg-card/40',
      path.length === 0 ? 'border-transparent bg-transparent' : '',
    )}>
      {path.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
        >
          {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{sectionLabel}</span>
          {sectionDesc ? (
            <span className="ml-2 truncate text-[11px] font-normal text-muted-foreground/80">
              {sectionDesc}
            </span>
          ) : null}
        </button>
      ) : null}
      {open ? (
        <div className={cn('space-y-4', path.length > 0 ? 'border-t bg-background/40 p-4' : 'p-0')}>
          {Object.entries(resolved.dict).map(([key, child]) => {
            const childPath = [...path, key];
            const childValue = getPath(value as any, [key]);
            const childResolved = resolveSchema(env, child);
            const isLeaf = childResolved.type !== 'object';

            return (
              <div key={key} className={isLeaf ? 'grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start' : ''}>
                {isLeaf ? (
                  <label className="text-sm font-medium">
                    <code className="font-mono text-xs text-muted-foreground">{key}</code>
                  </label>
                ) : null}
                <div className="min-w-0">
                  {isLeaf ? (
                    <SchemaField
                      node={childResolved}
                      path={childPath}
                      value={childValue}
                      onChange={(next) => onChange(childPath, next)}
                    />
                  ) : (
                    <SchemaSection
                      env={env}
                      node={childResolved}
                      path={childPath}
                      value={childValue}
                      onChange={onChange}
                      defaultOpen={path.length < 1}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ManageConfigPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const initialYaml: string = typeof data.value === 'string' ? data.value : '';
  const env: SchemaEnvelope | undefined = data.schema && typeof data.schema === 'object' && 'uid' in data.schema
    ? (data.schema as SchemaEnvelope) : undefined;
  const rootSchema = env ? lookupRef(env, env.uid) : (data.schema as SchemaNode | undefined);
  const hasSchema = !!(rootSchema && (rootSchema.dict || rootSchema.list || rootSchema.type === 'intersect' || rootSchema.type === 'object'));

  // Mode: visual or yaml. Visual is preferred; fall back if no schema or parse fails.
  const [mode, setMode] = useState<'visual' | 'yaml'>(hasSchema ? 'visual' : 'yaml');

  // Parsed object state for visual editor — re-derived from yaml string.
  const [yamlText, setYamlText] = useState(initialYaml);
  const parsed = useMemo(() => {
    try { return YAML.parse(yamlText) || {}; } catch { return null; }
  }, [yamlText]);
  const parseError = parsed === null;

  const handleChange = (path: string[], next: unknown) => {
    if (parsed === null) return;
    const updated = setPath(parsed, path, next);
    try {
      setYamlText(YAML.stringify(compact(updated)));
    } catch {
      // Should never happen with sane values, but degrade gracefully.
    }
  };

  return (
    <ManageShell title="系统配置" icon={FileCode}>
      <Card>
        <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-sm">高级配置</CardTitle>
            <p className="text-xs text-muted-foreground">
              修改后点击保存生效。标记为 [hidden] 的值为敏感信息，不会显示。
            </p>
          </div>
          {hasSchema ? (
            <MiniTabs
              size="sm"
              value={mode}
              onValueChange={(v) => setMode(v as 'visual' | 'yaml')}
              items={[
                { value: 'visual', label: '可视化' },
                { value: 'yaml', label: 'YAML' },
              ]}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="value" value={yamlText} />

            {mode === 'visual' && hasSchema ? (
              parseError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  YAML 解析失败，请先切换到 YAML 模式修复后再使用可视化编辑。
                </div>
              ) : (
                <SchemaSection
                  env={env}
                  node={rootSchema!}
                  path={[]}
                  value={parsed}
                  onChange={handleChange}
                />
              )
            ) : (
              <textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                rows={24}
                className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                spellCheck={false}
              />
            )}

            <div className="flex items-center justify-end gap-2">
              {mode === 'visual' && hasSchema ? (
                <details className="mr-auto text-xs text-muted-foreground">
                  <summary className="cursor-pointer">查看生成的 YAML</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px]">
                    {yamlText || '（空）'}
                  </pre>
                </details>
              ) : null}
              <Button type="submit" className="gap-1">
                <Save className="size-3.5" />
                保存配置
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  Run Scripts (manage_script.html)                                   */
/* ================================================================== */

export function ManageScriptPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const scripts: R = data.scripts || {};
  const visibleScripts = Object.entries(scripts).filter(([, script]) => !(script as R).hidden);

  return (
    <ManageShell title="运行脚本" icon={Play}>
      {visibleScripts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            暂无可用脚本
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleScripts.map(([id, script]) => {
            const s = script as R;
            return (
              <Card key={id}>
                <CardContent className="p-4">
                  <form method="post" className="space-y-3">
                    <input type="hidden" name="id" value={id} />
                    <div>
                      <p className="text-sm font-medium">{id}</p>
                      {s.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    {s.validate && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">参数 (JSON)</label>
                        <Input name="args" placeholder='{"key": "value"}' className="font-mono text-xs" />
                      </div>
                    )}
                    <Button type="submit" size="sm" className="gap-1">
                      <Play className="size-3" />
                      运行
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ManageShell>
  );
}

/* ================================================================== */
/*  User Import (manage_user_import.html)                              */
/* ================================================================== */

export function ManageUserImportPage() {
  const data = useBootstrap().page.data;
  const users: R[] = data.users || [];
  const messages: string[] = data.messages || [];

  return (
    <ManageShell title="导入用户" icon={Upload}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">批量导入</CardTitle>
          <p className="text-xs text-muted-foreground">
            每行一个用户，格式：<code className="rounded bg-muted px-1">邮箱,用户名,密码[,显示名[,额外信息 JSON]]</code>
          </p>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <textarea
              name="users"
              rows={10}
              className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="user@example.com,username,password&#10;another@example.com,user2,pass123,DisplayName"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="submit" name="draft" value="true" variant="outline" className="gap-1">
                <Search className="size-3.5" />
                预览
              </Button>
              <Button type="submit" name="draft" value="false" className="gap-1">
                <Upload className="size-3.5" />
                导入
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Messages from import */}
      {messages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">导入日志</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-48 rounded border bg-muted/30" viewportClassName="p-3">
              {messages.map((msg, i) => (
                <p key={i} className="font-mono text-xs text-muted-foreground">{msg}</p>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Imported users table */}
      {users.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              导入结果
              <Badge variant="secondary" className="ml-2 text-[10px]">{users.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">邮箱</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>密码</TableHead>
                  <TableHead className="pr-5">显示名</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-5 text-xs">{u.email || '—'}</TableCell>
                    <TableCell className="text-sm font-medium">{u.username || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.password || '—'}</TableCell>
                    <TableCell className="pr-5 text-xs">{u.displayName || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </ManageShell>
  );
}

/* ================================================================== */
/*  User Privileges (manage_user_priv.html)                            */
/* ================================================================== */

const PRIV_LABELS: Record<string, string> = {
  PRIV_EDIT_SYSTEM: '编辑系统设置',
  PRIV_SET_PERM: '设置域权限',
  PRIV_USER_PROFILE: '使用个人资料',
  PRIV_REGISTER_USER: '注册用户',
  PRIV_READ_PROBLEM_DATA: '读取题目数据',
  PRIV_READ_RECORD_CODE: '查看提交代码',
  PRIV_VIEW_HIDDEN_RECORD: '查看隐藏记录',
  PRIV_JUDGE: '评测',
  PRIV_CREATE_DOMAIN: '创建域',
  PRIV_VIEW_ALL_DOMAIN: '查看所有域',
  PRIV_MANAGE_ALL_DOMAIN: '管理所有域',
  PRIV_REJUDGE: '重新评测',
  PRIV_VIEW_USER_SECRET: '查看用户隐私',
  PRIV_VIEW_JUDGE_STATISTICS: '查看评测统计',
  PRIV_UNLIMITED_ACCESS: '无限制访问',
  PRIV_VIEW_SYSTEM_NOTIFICATION: '查看系统通知',
  PRIV_SEND_MESSAGE: '发送消息',
  PRIV_CREATE_FILE: '上传文件',
  PRIV_UNLIMITED_QUOTA: '无限配额',
  PRIV_DELETE_FILE: '删除文件',
  PRIV_MOD_BADGE: '修改徽章',
};

type PrivEntry = {
  key: string;
  bit: bigint;
  label: string;
};

function toPrivBits(value: unknown) {
  try {
    return BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
}

function getPrivEntries(privEnum: R): PrivEntry[] {
  return Object.entries(privEnum)
    .filter(([, value]) => value != null && /^\d+$/.test(String(value)))
    .map(([key, value]) => ({
      key,
      bit: toPrivBits(value),
      label: PRIV_LABELS[key] || key,
    }))
    .sort((a, b) => (a.bit < b.bit ? -1 : a.bit > b.bit ? 1 : 0));
}

function hasPrivBit(value: bigint, bit: bigint) {
  return (value & bit) !== 0n;
}

function togglePrivBit(value: bigint, bit: bigint, enabled: boolean) {
  const has = hasPrivBit(value, bit);
  if (enabled && !has) return value + bit;
  if (!enabled && has) return value - bit;
  return value;
}

function PrivEditor({
  title,
  description,
  uid,
  system,
  entries,
  initialValue,
  submitLabel,
  onCancel,
}: {
  title: string;
  description?: string;
  uid: string | number;
  system?: boolean;
  entries: PrivEntry[];
  initialValue: unknown;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [bits, setBits] = useState(() => toPrivBits(initialValue));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="size-4" />
          {title}
        </CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        <form method="post" className="space-y-4">
          <input type="hidden" name="uid" value={uid} />
          <input type="hidden" name="priv" value={bits.toString()} />
          {system ? <input type="hidden" name="system" value="true" /> : null}
          <div className="rounded-md border bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
            当前权限值：{bits.toString()}
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {entries.map((entry) => (
              <label key={entry.key} className="inline-flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox size="sm"
                  checked={hasPrivBit(bits, entry.bit)}
                  onChange={(event) => setBits((value) => togglePrivBit(value, entry.bit, event.currentTarget.checked))}
                 />
                <span className="text-muted-foreground">{entry.label}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                取消
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ManageUserPrivPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const udocs: R[] = data.udocs || [];
  const defaultPriv: number = data.defaultPriv || 0;
  const privEnum: R = data.Priv || {};
  const [search, setSearch] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [manualInitialPriv, setManualInitialPriv] = useState(String(defaultPriv));
  const [editingUser, setEditingUser] = useState<R | null>(null);
  const defaultPrivBits = toPrivBits(defaultPriv);
  const privEntries = getPrivEntries(privEnum);

  const filteredUsers = udocs.filter(
    (u) =>
      !search ||
      (u.uname || '').toLowerCase().includes(search.toLowerCase()) ||
      String(u._id).includes(search),
  );

  const openManualEditor = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const uid = manualUid.trim();
    if (!uid) return;
    setEditingUser({
      _id: uid,
      uname: `UID ${uid}`,
      priv: manualInitialPriv || defaultPriv,
    });
  };

  return (
    <ManageShell title="用户权限" icon={Key}>
      <PrivEditor
        title="默认权限"
        description="新注册用户默认拥有的权限位"
        uid={0}
        system
        entries={privEntries}
        initialValue={defaultPriv}
        submitLabel="保存默认权限"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="size-4" />
            选择用户
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={openManualEditor} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">UID</label>
              <Input value={manualUid} onChange={(event) => setManualUid(event.target.value)} placeholder="输入 UID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">起始权限值</label>
              <Input
                value={manualInitialPriv}
                onChange={(event) => setManualInitialPriv(event.target.value)}
                className="font-mono"
                placeholder={defaultPrivBits.toString()}
              />
            </div>
            <Button type="submit" variant="outline">打开编辑器</Button>
          </form>
        </CardContent>
      </Card>

      {editingUser ? (
        <PrivEditor
          key={`${editingUser._id}-${editingUser.priv}`}
          title={`编辑 ${editingUser.uname || `UID ${editingUser._id}`}`}
          uid={editingUser._id}
          entries={privEntries}
          initialValue={editingUser.priv}
          submitLabel="保存用户权限"
          onCancel={() => setEditingUser(null)}
        />
      ) : null}

      {/* User privilege table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserCog className="size-4" />
            用户权限列表
            <Badge variant="secondary" className="text-[10px]">{udocs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索用户…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 w-20">UID</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>权限值</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead className="w-32 text-right pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    {search ? '无匹配用户' : '暂无非默认权限用户'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => {
                  const isBanned = toPrivBits(u.priv) === 0n;
                  return (
                    <TableRow key={u._id}>
                      <TableCell className="pl-5 font-mono text-xs">{u._id}</TableCell>
                      <TableCell className="text-sm font-medium">{u.uname || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {u.priv}
                      </TableCell>
                      <TableCell>
                        {isBanned ? (
                          <Badge variant="destructive" className="text-[10px] gap-0.5">
                            <X className="size-2.5" />
                            已封禁
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <Check className="size-2.5" />
                            自定义
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditingUser(u)}
                          >
                            编辑
                          </Button>
                          <form method="post">
                            <input type="hidden" name="uid" value={u._id} />
                            {isBanned ? (
                              <>
                                <input type="hidden" name="priv" value={defaultPrivBits.toString()} />
                                <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
                                  解封
                                </Button>
                              </>
                            ) : (
                              <>
                                <input type="hidden" name="priv" value="0" />
                                <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                                  封禁
                                </Button>
                              </>
                            )}
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  Shared setting field renderer                                      */
/* ================================================================== */

function SettingField({ setting, value }: { setting: R; value: any }) {
  const isDisabled = !!(setting.flag & 2);

  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start">
      <div>
        <label className="text-sm font-medium">{setting.name || setting.key}</label>
        {setting.desc ? (
          <p className="text-[11px] leading-tight text-muted-foreground">{setting.desc}</p>
        ) : null}
      </div>
      <div>
        {setting.type === 'boolean' || setting.type === 'checkbox' ? (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox
              name={setting.key}
              defaultChecked={!!value}
              disabled={isDisabled}
             />
            <span className="text-sm text-muted-foreground">{setting.ui || '启用'}</span>
          </label>
        ) : setting.type === 'select' ? (
          <SimpleSelect
            name={setting.key}
            defaultValue={String(value ?? setting.value ?? '')}
            disabled={isDisabled}
            options={rangeOptions(setting.range)}
          />
        ) : setting.type === 'yaml' || setting.type === 'json' ? (
          <textarea
            name={setting.key}
            defaultValue={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value ?? setting.value ?? '')}
            disabled={isDisabled}
            rows={6}
            className="w-full rounded-md border bg-background p-3 font-mono text-xs disabled:opacity-50"
            spellCheck={false}
          />
        ) : setting.type === 'markdown' && !isDisabled ? (
          <MarkdownEditor
            name={setting.key}
            value={value ?? setting.value ?? ''}
            minHeight={260}
          />
        ) : setting.type === 'textarea' || setting.type === 'markdown' ? (
          <textarea
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            rows={setting.type === 'markdown' ? 6 : 3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
          />
        ) : setting.type === 'number' || setting.type === 'float' ? (
          <Input
            type="number"
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            step={setting.type === 'float' ? 'any' : '1'}
            className="max-w-xs"
          />
        ) : setting.type === 'password' ? (
          <Input
            type="password"
            name={setting.key}
            defaultValue=""
            disabled={isDisabled}
            autoComplete="new-password"
            className="max-w-xs"
          />
        ) : (
          <Input
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            className="max-w-sm"
          />
        )}
      </div>
    </div>
  );
}

function rangeOptions(range: any): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt: any) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? (opt[1] || opt[0]) : opt;
      return { value: String(val), label: String(label) };
    });
  }
  return Object.entries(range).map(([val, label]) => ({
    value: val,
    label: String(label),
  }));
}
