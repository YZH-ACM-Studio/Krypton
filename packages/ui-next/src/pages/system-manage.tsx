/**
 * System management pages — settings, config, scripts, user import, user privileges.
 */

import { useMemo, useState } from 'react';
import * as YAML from 'yaml';
import { Check, ChevronDown, ChevronRight, Play, Save, Search, Upload, X } from 'lucide-react';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';

/** Option source for select-type settings; tuples are `[value, label]`. */
type SettingRange = (string | [string, string])[] | Record<string, string>;

/** System setting descriptor produced by `setting.SYSTEM_SETTINGS` on the server. */
interface SystemSetting {
  key: string;
  family?: string;
  name?: string;
  desc?: string;
  type?: string;
  subType?: string;
  flag: number;
  value?: unknown;
  range?: SettingRange | null;
  /** Optional label rendered next to boolean checkboxes. */
  ui?: string;
}

/** Serialized `global.Hydro.script` entry (function fields survive as schema JSON or are dropped). */
interface ScriptEntry {
  description?: string;
  validate?: object | boolean;
  hidden?: boolean;
}

/** Row of the user-import preview / result table. */
interface ImportedUser {
  email?: string;
  username?: string;
  password?: string;
  displayName?: string;
}

/** User row in the privilege table; rows opened via the manual editor carry string ids. */
interface UserPrivRecord {
  _id: number | string;
  uname?: string;
  priv?: number | string;
}

interface SystemManagePageData {
  Priv?: Record<string, unknown>;
  current?: Record<string, unknown>;
  defaultPriv?: number;
  messages?: string[];
  schema?: unknown;
  scripts?: Record<string, ScriptEntry>;
  settings?: SystemSetting[];
  udocs?: UserPrivRecord[];
  users?: ImportedUser[];
  value?: unknown;
}

/* ================================================================== */
/*  System Settings (manage_setting.html)                              */
/* ================================================================== */

export function ManageSettingPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SystemManagePageData;
  const settings: SystemSetting[] = data.settings || [];
  const current: Record<string, unknown> = data.current || {};

  const families = new Map<string, SystemSetting[]>();
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="系统设置">
      <Panel>
        <form method="post" className="flex flex-col gap-6">
          {Array.from(families.entries()).map(([fam, items]) => (
            <fieldset key={fam} className="flex flex-col gap-5">
              <legend className="text-sm font-semibold text-fg">{familyLabels[fam] || fam}</legend>
              {items.map((setting) => (
                <SettingField key={setting.key} setting={setting} value={current[setting.key]} />
              ))}
            </fieldset>
          ))}
          <div className="flex justify-end border-t border-line-subtle pt-4">
            <Button type="submit" variant="primary">
              <Save />
              保存设置
            </Button>
          </div>
        </form>
      </Panel>
    </AdminPage>
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
  return (
    (desc as Record<string, string>)[langKey] ||
    (desc as Record<string, string>).en ||
    (desc as Record<string, string>).zh ||
    Object.values(desc as Record<string, string>)[0]
  );
}

function lookupRef(env: SchemaEnvelope | undefined, ref: number | SchemaNode | undefined): SchemaNode | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'object') return ref;
  return env?.refs?.[String(ref)];
}

/** Walk an object along a path, returning the value or undefined. */
function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Immutably set a value at a nested path; creates intermediate objects. */
function setPath(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next: Record<string, unknown> = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {};
  next[head] = setPath(next[head], rest, value);
  return next;
}

/** Strip undefined nested entries so we don't emit empty `key:` lines. */
function compact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(compact);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
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
  node,
  path: _path,
  value,
  onChange,
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
      <div className="flex flex-col gap-1.5">
        {description ? <p className="text-2xs text-fg-subtle">{description}</p> : null}
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
      <div className="flex flex-col gap-1.5">
        {description ? <p className="text-2xs text-fg-subtle">{description}</p> : null}
        <Input
          type="number"
          value={typeof value === 'number' ? value : ((value as string | undefined) ?? '')}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={meta.default != null ? String(meta.default) : ''}
          className="max-w-48"
        />
      </div>
    );
  }
  if (node.type === 'boolean') {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-fg-muted">{description || '启用'}</span>
      </label>
    );
  }
  if (node.type === 'const') {
    return (
      <div className="text-xs text-fg-subtle">
        固定值：<Code>{String(node.value)}</Code>
      </div>
    );
  }
  // Array / object / complex types fall back to a YAML text editor.
  return (
    <div className="flex flex-col gap-1.5">
      {description ? <p className="text-2xs text-fg-subtle">{description}</p> : null}
      <Textarea
        value={(() => {
          if (value === undefined || value === null) return '';
          if (typeof value === 'string') return value;
          try {
            return YAML.stringify(value).trimEnd();
          } catch {
            return String(value);
          }
        })()}
        onChange={(e) => {
          const text = e.target.value;
          if (!text.trim()) {
            onChange(undefined);
            return;
          }
          try {
            const parsed = YAML.parse(text);
            onChange(parsed);
          } catch {
            // Still update with raw text so user can keep typing; revert later if invalid.
            onChange(text);
          }
        }}
        rows={Math.min(8, Math.max(2, String(value || '').split('\n').length + 1))}
        className="max-w-2xl font-mono"
        placeholder={node.type ? `（${node.type} — YAML）` : ''}
        spellCheck={false}
      />
    </div>
  );
}

function SchemaSection({
  env,
  node,
  path,
  value,
  onChange,
  defaultOpen = true,
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
    return <SchemaField node={resolved} path={path} value={value} onChange={(next) => onChange(path, next)} />;
  }

  const sectionLabel = path.length === 0 ? '系统配置' : path[path.length - 1];
  const sectionDesc = describeMeta(resolved.meta);

  return (
    <div className={cn('min-w-0', path.length > 0 && 'rounded-md bg-surface-sunken')}>
      {path.length > 0 ? (
        <Button type="button" variant="ghost" className="w-full" onClick={() => setOpen((v) => !v)}>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {open ? <ChevronDown className="shrink-0 text-fg-subtle" /> : <ChevronRight className="shrink-0 text-fg-subtle" />}
            <span className="min-w-0 max-w-48 truncate font-mono text-xs text-fg">{sectionLabel}</span>
            {sectionDesc ? <span className="min-w-0 flex-1 truncate text-xs font-normal text-fg-subtle">{sectionDesc}</span> : null}
          </span>
        </Button>
      ) : null}
      {open ? (
        <div className={cn('flex flex-col gap-4', path.length > 0 && 'border-t border-line-subtle p-4')}>
          {Object.entries(resolved.dict).map(([key, child]) => {
            const childPath = [...path, key];
            const childValue = getPath(value, [key]);
            const childResolved = resolveSchema(env, child);
            const isLeaf = childResolved.type !== 'object';

            return (
              <div key={key} className={isLeaf ? 'grid min-w-0 gap-1.5 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start' : 'min-w-0'}>
                {isLeaf ? (
                  <label className="text-sm font-medium">
                    <Code>{key}</Code>
                  </label>
                ) : null}
                <div className="min-w-0">
                  {isLeaf ? (
                    <SchemaField node={childResolved} path={childPath} value={childValue} onChange={(next) => onChange(childPath, next)} />
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
  const data = bs.page.data as SystemManagePageData;
  const initialYaml: string = typeof data.value === 'string' ? data.value : '';
  const env: SchemaEnvelope | undefined =
    data.schema && typeof data.schema === 'object' && 'uid' in data.schema ? (data.schema as SchemaEnvelope) : undefined;
  const rootSchema = env ? lookupRef(env, env.uid) : (data.schema as SchemaNode | undefined);
  const hasSchema = !!(rootSchema && (rootSchema.dict || rootSchema.list || rootSchema.type === 'intersect' || rootSchema.type === 'object'));

  // Mode: visual or yaml. Visual is preferred; fall back if no schema or parse fails.
  const [mode, setMode] = useState<'visual' | 'yaml'>(hasSchema ? 'visual' : 'yaml');

  // Parsed object state for visual editor — re-derived from yaml string.
  const [yamlText, setYamlText] = useState(initialYaml);
  const parsed = useMemo<unknown>(() => {
    try {
      return YAML.parse(yamlText) || {};
    } catch {
      return null;
    }
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="系统配置">
      <Panel
        title="高级配置"
        description="修改后点击保存生效。标记为 [hidden] 的值为敏感信息，不会显示。"
        actions={hasSchema ? (
          <MiniTabs
            size="sm"
            className="min-w-0 max-w-full overflow-x-auto"
            value={mode}
            onValueChange={(v) => setMode(v as 'visual' | 'yaml')}
            items={[
              { value: 'visual', label: '可视化' },
              { value: 'yaml', label: 'YAML' },
            ]}
          />
        ) : null}
      >
        <form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="value" value={yamlText} />

          {mode === 'visual' && hasSchema ? (
            parseError ? (
              <Alert tone="danger">
                YAML 解析失败，请先切换到 YAML 模式修复后再使用可视化编辑。
              </Alert>
            ) : (
              <SchemaSection env={env} node={rootSchema!} path={[]} value={parsed} onChange={handleChange} />
            )
          ) : (
            <Textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              rows={24}
              className="font-mono"
              spellCheck={false}
            />
          )}

          <div className="flex items-center justify-end gap-2">
            {mode === 'visual' && hasSchema ? (
              <details className="mr-auto text-xs text-fg-subtle">
                <summary className="cursor-pointer">查看生成的 YAML</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-2xs text-fg">{yamlText || '（空）'}</pre>
              </details>
            ) : null}
            <Button type="submit" variant="primary">
              <Save />
              保存配置
            </Button>
          </div>
        </form>
      </Panel>
    </AdminPage>
  );
}

/* ================================================================== */
/*  Run Scripts (manage_script.html)                                   */
/* ================================================================== */

export function ManageScriptPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SystemManagePageData;
  const scripts: Record<string, ScriptEntry> = data.scripts || {};
  const visibleScripts = Object.entries(scripts).filter(([, script]) => !script.hidden);

  return (
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="运行脚本">
      {visibleScripts.length === 0 ? (
        <EmptyState icon={<Play />} title="暂无可用脚本" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleScripts.map(([id, script]) => {
            const s = script;
            return (
              <Panel key={id}>
                <form method="post" className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="min-w-0">
                    <p className="min-w-0 truncate text-sm font-medium">{id}</p>
                    {s.description && <p className="mt-0.5 text-xs text-fg-subtle">{s.description}</p>}
                  </div>
                  {s.validate && (
                    <FormField label="参数 (JSON)">
                      <Input name="args" placeholder='{"key": "value"}' className="font-mono" />
                    </FormField>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" variant="soft" size="sm">
                      <Play />
                      运行
                    </Button>
                  </div>
                </form>
              </Panel>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}

/* ================================================================== */
/*  User Import (manage_user_import.html)                              */
/* ================================================================== */

export function ManageUserImportPage() {
  const data = useBootstrap().page.data as SystemManagePageData;
  const users: ImportedUser[] = data.users || [];
  const messages: string[] = data.messages || [];

  return (
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="导入用户">
      <Panel
        title="批量导入"
        description={(
          <>
            每行一个用户，格式：<Code>邮箱,用户名,密码[,显示名[,额外信息 JSON]]</Code>
          </>
        )}
      >
        <form method="post" className="flex flex-col gap-4">
          <Textarea
            name="users"
            rows={10}
            className="font-mono"
            placeholder="user@example.com,username,password&#10;another@example.com,user2,pass123,DisplayName"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button type="submit" name="draft" value="true" variant="secondary">
              <Search />
              预览
            </Button>
            <Button type="submit" name="draft" value="false" variant="primary">
              <Upload />
              导入
            </Button>
          </div>
        </form>
      </Panel>

      {messages.length > 0 && (
        <Panel title="导入日志">
          <ScrollArea className="max-h-48 rounded-md border border-line bg-surface-sunken" viewportClassName="p-3">
            {messages.map((msg, i) => (
              <p key={i} className="font-mono text-xs text-fg-muted">
                {msg}
              </p>
            ))}
          </ScrollArea>
        </Panel>
      )}

      {users.length > 0 && (
        <Panel
          flush
          title={(
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">导入结果</span>
              <Badge size="sm">{users.length}</Badge>
            </span>
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>密码</TableHead>
                <TableHead>显示名</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{u.email || '—'}</TableCell>
                  <TableCell className="font-medium">{u.username || '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-fg-subtle">{u.password || '—'}</TableCell>
                  <TableCell className="text-xs">{u.displayName || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </AdminPage>
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

interface PrivEntry {
  key: string;
  bit: bigint;
  label: string;
}

function toPrivBits(value: unknown) {
  try {
    return BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
}

function getPrivEntries(privEnum: Record<string, unknown>): PrivEntry[] {
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
  submitVariant = 'primary',
  onCancel,
}: {
  title: string;
  description?: string;
  uid: string | number;
  system?: boolean;
  entries: PrivEntry[];
  initialValue: unknown;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary';
  onCancel?: () => void;
}) {
  const [bits, setBits] = useState(() => toPrivBits(initialValue));

  return (
    <Panel title={title} description={description}>
      <form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="priv" value={bits.toString()} />
        {system ? <input type="hidden" name="system" value="true" /> : null}
        <div className="rounded-md bg-surface-sunken p-3 font-mono text-xs text-fg-muted tabular">当前权限值：{bits.toString()}</div>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {entries.map((entry) => (
            <label key={entry.key} className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                size="sm"
                className="shrink-0"
                checked={hasPrivBit(bits, entry.bit)}
                onChange={(event) => setBits((value) => togglePrivBit(value, entry.bit, event.currentTarget.checked))}
              />
              <span className="min-w-0 truncate">{entry.label}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              取消
            </Button>
          ) : null}
          <Button type="submit" variant={submitVariant} size="sm">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function ManageUserPrivPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SystemManagePageData;
  const udocs: UserPrivRecord[] = data.udocs || [];
  const defaultPriv: number = data.defaultPriv || 0;
  const privEnum: Record<string, unknown> = data.Priv || {};
  const [search, setSearch] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [manualInitialPriv, setManualInitialPriv] = useState(String(defaultPriv));
  const [editingUser, setEditingUser] = useState<UserPrivRecord | null>(null);
  const defaultPrivBits = toPrivBits(defaultPriv);
  const privEntries = getPrivEntries(privEnum);

  const filteredUsers = udocs.filter(
    (u) => !search || (u.uname || '').toLowerCase().includes(search.toLowerCase()) || String(u._id).includes(search),
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="用户权限">
      <PrivEditor
        title="默认权限"
        description="新注册用户默认拥有的权限位"
        uid={0}
        system
        entries={privEntries}
        initialValue={defaultPriv}
        submitLabel="保存默认权限"
        submitVariant={editingUser ? 'secondary' : 'primary'}
      />

      <Panel title="选择用户">
        <form onSubmit={openManualEditor} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <FormField label="UID">
            <Input value={manualUid} onChange={(event) => setManualUid(event.target.value)} placeholder="输入 UID" />
          </FormField>
          <FormField label="起始权限值">
            <Input
              value={manualInitialPriv}
              onChange={(event) => setManualInitialPriv(event.target.value)}
              className="font-mono"
              placeholder={defaultPrivBits.toString()}
            />
          </FormField>
          <Button type="submit" variant="secondary">
            打开编辑器
          </Button>
        </form>
      </Panel>

      {editingUser ? (
        <PrivEditor
          key={`${editingUser._id}-${editingUser.priv}`}
          title={`编辑 ${editingUser.uname || `UID ${editingUser._id}`}`}
          uid={editingUser._id}
          entries={privEntries}
          initialValue={editingUser.priv}
          submitLabel="保存用户权限"
          submitVariant="primary"
          onCancel={() => setEditingUser(null)}
        />
      ) : null}

      <Panel
        flush
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">用户权限列表</span>
            <Badge size="sm">{udocs.length}</Badge>
          </span>
        )}
      >
        <div className="border-b border-line-subtle px-4 py-3">
          <Input
            leading={<Search />}
            className="max-w-xs"
            placeholder="搜索用户…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">UID</TableHead>
              <TableHead>用户名</TableHead>
              <TableHead>权限值</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-fg-muted">
                  {search ? '无匹配用户' : '暂无非默认权限用户'}
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((u) => {
                const isBanned = toPrivBits(u.priv) === 0n;
                return (
                  <TableRow key={u._id}>
                    <TableCell className="font-mono text-xs tabular">{u._id}</TableCell>
                    <TableCell className="font-medium">{u.uname || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-fg-subtle tabular">{u.priv}</TableCell>
                    <TableCell>
                      {isBanned ? (
                        <Badge tone="danger" size="sm">
                          <X />
                          已封禁
                        </Badge>
                      ) : (
                        <Badge variant="outline" size="sm">
                          <Check />
                          自定义
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setEditingUser(u)}>
                          编辑
                        </Button>
                        <form method="post">
                          <input type="hidden" name="uid" value={u._id} />
                          {isBanned ? (
                            <>
                              <input type="hidden" name="priv" value={defaultPrivBits.toString()} />
                              <Button type="submit" variant="secondary" size="sm">
                                解封
                              </Button>
                            </>
                          ) : (
                            <>
                              <input type="hidden" name="priv" value="0" />
                              <Button type="submit" variant="danger-soft" size="sm">
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
      </Panel>
    </AdminPage>
  );
}

/* ================================================================== */
/*  Shared setting field renderer                                      */
/* ================================================================== */

function SettingField({ setting, value }: { setting: SystemSetting; value: unknown }) {
  const isDisabled = !!(setting.flag & 2);
  const rawValue = value ?? setting.value ?? '';
  const scalarValue = typeof rawValue === 'string' || typeof rawValue === 'number' || Array.isArray(rawValue) ? rawValue : String(rawValue);

  return (
    <FormField inline label={setting.name || setting.key} hint={setting.desc || undefined}>
      {setting.type === 'boolean' || setting.type === 'checkbox' ? (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <Switch name={setting.key} defaultChecked={!!value} disabled={isDisabled} />
          {/* An unchecked box posts nothing; this key tells the server to store false. */}
          {isDisabled ? null : <input type="hidden" name={`booleanKeys.${setting.key}`} value="on" />}
          <span className="text-sm text-fg-muted">{setting.ui || '启用'}</span>
        </label>
      ) : setting.type === 'select' ? (
        <SimpleSelect
          name={setting.key}
          defaultValue={String(rawValue)}
          disabled={isDisabled}
          options={rangeOptions(setting.range)}
        />
      ) : setting.type === 'yaml' || setting.type === 'json' ? (
        <Textarea
          name={setting.key}
          defaultValue={typeof rawValue === 'object' ? JSON.stringify(rawValue, null, 2) : scalarValue}
          disabled={isDisabled}
          rows={6}
          className="font-mono"
          spellCheck={false}
        />
      ) : setting.type === 'markdown' && !isDisabled ? (
        <MarkdownEditor name={setting.key} value={String(rawValue)} minHeight={260} />
      ) : setting.type === 'textarea' || setting.type === 'markdown' ? (
        <Textarea
          name={setting.key}
          defaultValue={scalarValue}
          disabled={isDisabled}
          rows={setting.type === 'markdown' ? 6 : 3}
          className="font-mono"
        />
      ) : setting.type === 'number' || setting.type === 'float' ? (
        <Input
          type="number"
          name={setting.key}
          defaultValue={scalarValue}
          disabled={isDisabled}
          step={setting.type === 'float' ? 'any' : '1'}
          className="max-w-xs"
        />
      ) : setting.type === 'password' ? (
        <Input type="password" name={setting.key} defaultValue="" disabled={isDisabled} autoComplete="new-password" className="max-w-xs" />
      ) : (
        <Input name={setting.key} defaultValue={scalarValue} disabled={isDisabled} className="max-w-sm" />
      )}
    </FormField>
  );
}

function rangeOptions(range: SettingRange | null | undefined): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? opt[1] || opt[0] : opt;
      return { value: String(val), label: String(label) };
    });
  }
  return Object.entries(range).map(([val, label]) => ({
    value: val,
    label: String(label),
  }));
}
