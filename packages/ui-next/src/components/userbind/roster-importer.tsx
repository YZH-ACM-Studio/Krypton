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
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

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
    const parts = trimmed.split(/[\s,;]+/).filter(Boolean);
    const studentId = (parts[0] || '').trim();
    const realName = parts.slice(1).join(' ').trim();
    const row: ParsedRow = {
      line: i + 1,
      raw,
      studentId,
      realName,
      status: 'ok',
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
  searchUrl?: string; // URL to GET for search results, e.g. '/admin/userbind/groups/:id?q=' (server returns JSON via data)
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
  action,
  hiddenFields = {},
  title = '导入名单',
  enableSearch = false,
  searchResults = [],
  searchQuery = '',
  searchSelectFieldName = 'initialMemberIds',
  searchParamName = 'q',
  searchHiddenFields = {},
  searchResultHint = '已是成员的不在结果中',
  searchUrl,
  submitLabel = '开始导入',
  className,
  description,
}: RosterImporterProps) {
  const [mode, setMode] = useState<'text' | 'search'>(enableSearch && (searchResults.length > 0 || searchQuery) ? 'search' : 'text');
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(searchResults.map((r) => r._id)));
  const clearSelection = () => setSelectedIds(new Set());

  return (
    <Panel className={className} title={title} description={description}>
      <div className="space-y-4">
        {enableSearch && (
          <MiniTabs
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'text', label: '名单导入', icon: FileText },
              { value: 'search', label: '搜索导入', icon: Search },
            ]}
          />
        )}

        {mode === 'text' && (
          <form method="post" action={action} className="space-y-4">
            {Object.entries(hiddenFields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <FormField label="学生名单" required hint="每行一条 学号 姓名 — 学号 1-64 位字母/数字/._-；姓名最多 32 字符。以 # 开头的行会被忽略。">
              <Textarea
                name="text"
                rows={8}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="font-mono"
                placeholder={'202301001 张三\n202301002 李四'}
              />
            </FormField>

            {parsedRows.length > 0 && <PreviewTable rows={parsedRows} />}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-subtle">
                {validCount > 0 && <span className="text-success-fg"><span className="tabular">{validCount}</span> 行有效</span>}
                {validCount > 0 && invalidCount > 0 && '；'}
                {invalidCount > 0 && <span className="text-danger-fg"><span className="tabular">{invalidCount}</span> 行无效</span>}
                {parsedRows.length === 0 && '暂无输入'}
                {checked && parsedRows.length > 0 && ' · 已检查'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" disabled={parsedRows.length === 0} onClick={() => setChecked(true)}>
                  检查名单
                </Button>
                <Button type="submit" variant="primary" disabled={validCount === 0}>
                  {submitLabel}
                </Button>
              </div>
            </div>
          </form>
        )}

        {mode === 'search' && enableSearch && (
          <div className="space-y-4">
            {/* Search uses GET to the same page with q= to populate searchResults. */}
            <form method="get" action={searchUrl || action} className="flex flex-wrap gap-2">
              {Object.entries(searchHiddenFields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Input name={searchParamName} placeholder="搜索学号或姓名" defaultValue={searchQuery} className="min-w-0 flex-1" />
              <Button type="submit" variant="secondary">
                <Search />
                搜索
              </Button>
            </form>

            {searchQuery && (
              <p className="text-xs text-fg-subtle">
                关键词「{searchQuery}」找到 <span className="tabular">{searchResults.length}</span> 名学生
                {searchResultHint && <>（{searchResultHint}）</>}
                {searchResults.length > 0 && (
                  <>
                    {' · '}
                    <Button type="button" variant="link" size="sm" onClick={selectAll}>
                      全选
                    </Button>
                    {selectedIds.size > 0 && (
                      <>
                        {' · '}
                        <Button type="button" variant="link" size="sm" onClick={clearSelection}>
                          清除选择
                        </Button>
                      </>
                    )}
                  </>
                )}
              </p>
            )}

            {searchResults.length > 0 && (
              <ScrollArea viewportLayout="block" className="max-h-64 rounded-md border border-line bg-surface-sunken">
                <ul className="w-full min-w-0 space-y-1 p-2">
                  {searchResults.map((s) => (
                    <li key={s._id} className="min-w-0">
                      <label
                        className={cn(
                          'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          selectedIds.has(s._id) ? 'bg-brand-soft/60' : 'hover:bg-surface-hover',
                        )}
                      >
                        <Checkbox checked={selectedIds.has(s._id)} onChange={() => toggleSelect(s._id)} />
                        <span className="min-w-0 flex-1 truncate font-mono">{s.studentId}</span>
                        <span className="min-w-0 flex-1 truncate text-fg">{s.realName}</span>
                        {s.boundUserId && (
                          <Badge tone="neutral" variant="outline" size="sm">
                            已绑定 UID {s.boundUserId}
                          </Badge>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}

            <form method="post" action={action} className="space-y-4">
              {Object.entries(hiddenFields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {selectedIds.size > 0 &&
                Array.from(selectedIds).map((id) => <input key={id} type="hidden" name={searchSelectFieldName} value={String(id)} />)}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-fg-subtle">{selectedIds.size > 0 ? <>已选 <span className="tabular">{selectedIds.size}</span> 人</> : '从结果中勾选要添加的学生'}</p>
                <Button type="submit" variant="primary" disabled={selectedIds.size === 0}>
                  {submitLabel}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Panel>
  );
}

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ScrollArea
      orientation="both"
      viewportLayout="block"
      className="max-h-56 rounded-md border border-line [&_tr:has(.invalid)]:bg-danger-soft [&_[data-slot=data-table]>div]:overflow-visible"
    >
      <DataTable
        mobile="scroll"
        stickyHeader
        rows={rows}
        rowKey={(row) => String(row.line)}
        columns={[
          {
            key: 'line',
            header: '行',
            width: '4rem',
            cell: (row) => <span className="font-mono text-fg-subtle tabular">{row.line}</span>,
          },
          {
            key: 'studentId',
            header: '学号',
            cell: (row) => <span className="font-mono">{row.studentId || '—'}</span>,
          },
          {
            key: 'realName',
            header: '姓名',
            cell: (row) => row.realName || '—',
          },
          {
            key: 'status',
            header: '状态',
            cell: (row) => (row.status === 'ok' ? (
              <span className="inline-flex items-center gap-1.5 text-success-fg">
                <CheckCircle2 className="size-3.5 shrink-0" />
                有效
              </span>
            ) : (
              <span className="invalid inline-flex min-w-0 items-center gap-1.5 text-danger-fg" title={row.reason}>
                <X className="size-3.5 shrink-0" />
                {row.reason}
              </span>
            )),
          },
        ]}
      />
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
    <Alert tone="success" title="导入结果">
      <div className="min-w-0 space-y-2">
        <p className="font-medium text-fg">{ok}</p>
        {failed.length > 0 && (
          <details className="min-w-0 rounded-md border border-danger-line bg-danger-soft p-3">
            <summary className="cursor-pointer text-xs font-medium text-danger-fg">{failed.length} 条未导入（点击展开）</summary>
            <ul className="mt-2 min-w-0 space-y-0.5 font-mono text-2xs break-all">
              {failed.map((d, i) => (
                <li key={i}>
                  <span className="text-danger-fg">{d.studentId || '(空)'}</span>: {d.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {report.preflightInvalid && report.preflightInvalid.length > 0 && (
          <details className="min-w-0 rounded-md border border-warning-line bg-warning-soft p-3">
            <summary className="cursor-pointer text-xs font-medium text-warning-fg">
              {report.preflightInvalid.length} 行未通过格式校验
            </summary>
            <ul className="mt-2 min-w-0 space-y-0.5 font-mono text-2xs break-all">
              {report.preflightInvalid.map((p, i) => (
                <li key={i}>
                  第 {p.line} 行: {p.studentId || '(空)'} — {p.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {report.autoBindSkipped && report.autoBindSkipped.length > 0 && (
          <details className="min-w-0 rounded-md border border-warning-line bg-warning-soft p-3">
            <summary className="cursor-pointer text-xs font-medium text-warning-fg">
              {report.autoBindSkipped.length} 人未自动绑定
            </summary>
            <ul className="mt-2 min-w-0 space-y-0.5 font-mono text-2xs break-all">
              {report.autoBindSkipped.map((p, i) => (
                <li key={i}>
                  {p.studentId || '(空)'}: {p.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Alert>
  );
}
