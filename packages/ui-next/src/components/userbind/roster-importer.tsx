/**
 * RosterImporter — reusable roster-entry component for admin import surfaces.
 *
 * Modes:
 *   - "text" : paste lines of `学号 姓名`; client-side preview shows which rows
 *              are valid before submitting.
 *   - "search": (optional) search existing student records in a given scope
 *              and multi-select to attach.
 *
 * Submits as a plain HTML form so it works with the existing
 * `<form method="post">` admin handlers. Mode + hidden fields are baked in
 * by the caller via the `formAction` / `targetKind` / `targetId` props.
 *
 * Validation mirrors the server's `parseRosterText` rules:
 *   - studentId: 1-64 chars [a-zA-Z0-9._-]
 *   - realName : 1-32 trimmed chars
 *   - no duplicate studentId within the batch
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, FileText, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';

const STUDENT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const REAL_NAME_MAX = 32;

type RowStatus = 'ok' | 'invalid_id' | 'invalid_name' | 'dup_in_batch';

interface ParsedRow {
  line: number;
  raw: string;
  studentId: string;
  realName: string;
  status: RowStatus;
  reason?: string;
}

function parseRosterText(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  const lines = (text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/[\s,;\t]+/).filter(Boolean);
    const studentId = (parts[0] || '').trim();
    const realName = parts.slice(1).join(' ').trim();
    const row: ParsedRow = {
      line: i + 1, raw, studentId, realName, status: 'ok',
    };
    if (!STUDENT_ID_RE.test(studentId)) {
      row.status = 'invalid_id';
      row.reason = '学号必须为 1-64 位字母/数字/._-';
    } else if (!realName) {
      row.status = 'invalid_name';
      row.reason = '姓名不能为空';
    } else if (realName.length > REAL_NAME_MAX) {
      row.status = 'invalid_name';
      row.reason = `姓名超过 ${REAL_NAME_MAX} 字符`;
    } else if (seen.has(studentId)) {
      row.status = 'dup_in_batch';
      row.reason = '本批次内已出现该学号';
    } else {
      seen.add(studentId);
    }
    out.push(row);
  }
  return out;
}

interface SearchStudent {
  _id: string | number;
  studentId: string;
  realName: string;
  boundUserId: number | null;
}

export interface RosterImporterProps {
  /** Form POST URL. */
  action: string;
  /** Optional hidden fields to embed in the form (operation, targetKind, schoolId, etc.) */
  hiddenFields?: Record<string, string>;
  /** Heading rendered above the importer. */
  title?: ReactNode;
  /** Show search tab? Defaults to false (text-only). */
  enableSearch?: boolean;
  /** Search props — only used when enableSearch=true. */
  searchScope?: 'school_roster';
  searchUrl?: string;  // URL to GET for search results, e.g. '/admin/userbind/groups/:id?q=' (server returns JSON via data)
  searchResults?: SearchStudent[];
  searchQuery?: string;
  searchParamName?: string;
  searchHiddenFields?: Record<string, string>;
  searchResultHint?: ReactNode;
  /** Hidden field name to use for the selected student IDs (multi-value). */
  searchSelectFieldName?: string;
  /** Text in the submit button. */
  submitLabel?: string;
  /** Extra CSS for the outer Card. */
  className?: string;
  /** Optional description under the title. */
  description?: ReactNode;
}

export function RosterImporter({
  action, hiddenFields = {}, title = '导入名单',
  enableSearch = false, searchResults = [], searchQuery = '',
  searchSelectFieldName = 'initialMemberIds',
  searchParamName = 'q',
  searchHiddenFields = {},
  searchResultHint = '已是成员的不在结果中',
  searchUrl,
  submitLabel = '开始导入', className, description,
}: RosterImporterProps) {
  const [mode, setMode] = useState<'text' | 'search'>(
    enableSearch && (searchResults.length > 0 || searchQuery) ? 'search' : 'text',
  );
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(false);
  const parsedRows = useMemo(() => parseRosterText(text), [text]);
  const validCount = parsedRows.filter((r) => r.status === 'ok').length;
  const invalidCount = parsedRows.length - validCount;
  useEffect(() => setChecked(false), [text]);

  // Search-pick selection (client-only)
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const toggleSelect = (id: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(searchResults.map((r) => r._id)));
  const clearSelection = () => setSelectedIds(new Set());

  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {enableSearch && (
          <div className="flex gap-1 rounded-md border bg-muted/30 p-1">
            <TabBtn active={mode === 'text'} onClick={() => setMode('text')} icon={FileText}>
              名单导入
            </TabBtn>
            <TabBtn active={mode === 'search'} onClick={() => setMode('search')} icon={Search}>
              搜索导入
            </TabBtn>
          </div>
        )}

        {mode === 'text' && (
          <form method="post" action={action} className="space-y-3">
            {Object.entries(hiddenFields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <FormField
              label="学生名单"
              required
              hint="每行一条 学号 姓名 — 学号 1-64 位字母/数字/._-；姓名最多 32 字符。以 # 开头的行会被忽略。"
            >
              <textarea
                name="text"
                rows={8}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="w-full rounded-md border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={'202301001 张三\n202301002 李四'}
              />
            </FormField>

            {parsedRows.length > 0 && (
              <PreviewTable rows={parsedRows} />
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {validCount > 0 && <span className="text-emerald-700 dark:text-emerald-400">{validCount} 行有效</span>}
                {validCount > 0 && invalidCount > 0 && '；'}
                {invalidCount > 0 && <span className="text-rose-700 dark:text-rose-400">{invalidCount} 行无效</span>}
                {parsedRows.length === 0 && '暂无输入'}
                {checked && parsedRows.length > 0 && ' · 已检查'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={parsedRows.length === 0}
                  onClick={() => setChecked(true)}
                >
                  检查名单
                </Button>
                <Button type="submit" disabled={validCount === 0}>
                  {submitLabel}
                </Button>
              </div>
            </div>
          </form>
        )}

        {mode === 'search' && enableSearch && (
          <div className="space-y-3">
            {/* Search uses GET to the same page with q= to populate searchResults. */}
            <form method="get" action={searchUrl || action} className="flex gap-2">
              {Object.entries(searchHiddenFields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Input
                name={searchParamName}
                placeholder="搜索学号或姓名"
                defaultValue={searchQuery}
              />
              <Button type="submit" variant="outline" className="gap-1">
                <Search className="size-4" />搜索
              </Button>
            </form>

            {searchQuery && (
              <p className="text-xs text-muted-foreground">
                关键词「{searchQuery}」找到 {searchResults.length} 名学生
                {searchResultHint && <>（{searchResultHint}）</>}
                {searchResults.length > 0 && (
                  <>
                    {' · '}
                    <button type="button" className="underline" onClick={selectAll}>全选</button>
                    {selectedIds.size > 0 && (
                      <>
                        {' · '}
                        <button type="button" className="underline" onClick={clearSelection}>清除选择</button>
                      </>
                    )}
                  </>
                )}
              </p>
            )}

            {searchResults.length > 0 && (
              <ScrollArea className="max-h-64 rounded-md border bg-muted/20" viewportClassName="space-y-1 p-2">
                {searchResults.map((s) => (
                  <label
                    key={s._id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                      selectedIds.has(s._id) ? 'bg-primary/10' : 'hover:bg-muted/60',
                    )}
                  >
                    <Checkbox
                      checked={selectedIds.has(s._id)}
                      onChange={() => toggleSelect(s._id)}
                     />
                    <span className="flex-1 font-mono">{s.studentId}</span>
                    <span className="text-foreground">{s.realName}</span>
                    {s.boundUserId && (
                      <Badge variant="outline" className="text-[10px]">已绑定 UID {s.boundUserId}</Badge>
                    )}
                  </label>
                ))}
              </ScrollArea>
            )}

            <form method="post" action={action} className="space-y-3">
              {Object.entries(hiddenFields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {selectedIds.size > 0 && Array.from(selectedIds).map((id) => (
                <input key={id} type="hidden" name={searchSelectFieldName} value={String(id)} />
              ))}

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size > 0 ? `已选 ${selectedIds.size} 人` : '从结果中勾选要添加的学生'}
                </p>
                <Button type="submit" disabled={selectedIds.size === 0}>
                  {submitLabel}
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TabBtn({
  active, onClick, icon: Icon, children,
}: { active: boolean; onClick: () => void; icon: any; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ScrollArea className="max-h-56 rounded-md border bg-card">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left">行</th>
            <th className="px-2 py-1.5 text-left">学号</th>
            <th className="px-2 py-1.5 text-left">姓名</th>
            <th className="px-2 py-1.5 text-left">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.line}
              className={cn(
                'border-t border-border/50',
                r.status === 'ok'
                  ? 'bg-background'
                  : 'bg-rose-500/5',
              )}
            >
              <td className="px-2 py-1 font-mono text-muted-foreground">{r.line}</td>
              <td className="px-2 py-1 font-mono">{r.studentId || '—'}</td>
              <td className="px-2 py-1">{r.realName || '—'}</td>
              <td className="px-2 py-1">
                {r.status === 'ok' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" /> 有效
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400" title={r.reason}>
                    <X className="size-3" /> {r.reason}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/** Server-returned import report — rendered as a result card. */
export interface ImportResult {
  kind?: 'school' | 'user_group';
  retry?: boolean;
  // school import
  inserted?: number;
  duplicates?: Array<{ studentId: string; reason: string }>;
  // user_group import
  created?: number;
  attached?: number;
  alreadyMember?: number;
  failed?: Array<{ studentId: string; reason: string }>;
  alreadyBound?: number;
  autoBound?: number;
  unboundScanned?: number;
  autoBindSkipped?: Array<{ studentId: string; reason: string }>;
  preflightInvalid?: Array<{ line: number; studentId: string; reason: string }>;
}

export function ImportResultPanel({ report }: { report: ImportResult }) {
  if (!report) return null;
  const isGroup = report.kind === 'user_group';
  const failed = (isGroup ? report.failed : report.duplicates) || [];
  const ok = report.retry
    ? `扫描未绑定 ${report.unboundScanned || 0} 人 · 新绑定 ${report.autoBound || 0} 人 · 仍未绑定 ${(report.autoBindSkipped || []).length} 人`
    : isGroup
      ? `新建 ${report.created || 0} · 加入已有 ${report.attached || 0} · 已是成员 ${report.alreadyMember || 0} · 已绑定 ${report.alreadyBound || 0} · 本次新绑定 ${report.autoBound || 0}`
      : `成功插入 ${report.inserted || 0} 条 · 已绑定 ${report.alreadyBound || 0} 人 · 本次新绑定 ${report.autoBound || 0} 人`;
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" /> 导入结果
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">{ok}</p>
        {failed.length > 0 && (
          <details className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
            <summary className="cursor-pointer text-xs font-medium text-rose-700 dark:text-rose-300">
              {failed.length} 条未导入（点击展开）
            </summary>
            <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
              {failed.map((d, i) => (
                <li key={i}>
                  <span className="text-rose-700 dark:text-rose-300">{d.studentId || '(空)'}</span>: {d.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {report.preflightInvalid && report.preflightInvalid.length > 0 && (
          <details className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-300">
              {report.preflightInvalid.length} 行未通过格式校验
            </summary>
            <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
              {report.preflightInvalid.map((p, i) => (
                <li key={i}>第 {p.line} 行: {p.studentId || '(空)'} — {p.reason}</li>
              ))}
            </ul>
          </details>
        )}
        {report.autoBindSkipped && report.autoBindSkipped.length > 0 && (
          <details className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-300">
              {report.autoBindSkipped.length} 人未自动绑定
            </summary>
            <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
              {report.autoBindSkipped.map((p, i) => (
                <li key={i}>{p.studentId || '(空)'}: {p.reason}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
