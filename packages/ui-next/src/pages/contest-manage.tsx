/**
 * Contest management pages — edit, manage, problem list, users, balloon,
 * clarification, print.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Copy,
  Download,
  FileText,
  FolderOpen,
  HelpCircle,
  MessageSquare,
  Palette,
  Printer,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatDateTime, formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function getAlphabeticId(index: number) {
  if (index < 0) return '?';
  let n = index + 1;
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function formatObjectIdTime(id: unknown, locale: string) {
  const value = String(id || '');
  if (!/^[0-9a-f]{24}$/i.test(value)) return '';
  const timestamp = Number.parseInt(value.slice(0, 8), 16) * 1000;
  if (!Number.isFinite(timestamp)) return '';
  return formatDateTime(timestamp, locale);
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimeInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateTimeInput(dateText: string, timeText: string, durationHours: string) {
  const begin = new Date(`${dateText}T${timeText || '00:00'}`);
  const duration = Number(durationHours);
  if (Number.isNaN(begin.getTime()) || !Number.isFinite(duration)) return '';
  begin.setMinutes(begin.getMinutes() + Math.round(duration * 60));
  return `${formatDateInput(begin)} ${formatTimeInput(begin)}`;
}

function formatCommaValue(value: unknown) {
  return Array.isArray(value) ? value.join(',') : String(value || '');
}

type BalloonColorRow = {
  pid: string;
  label: string;
  title: string;
  color: string;
  name: string;
};

const DEFAULT_BALLOON_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function clarificationSubjectLabel(tdoc: R, pdict: Record<string, R>, subject: unknown) {
  const pids: Array<string | number> = tdoc.pids || [];
  const numeric = Number(subject);
  if (numeric === -1) return '技术问题';
  if (numeric === 0 || subject == null) return '通用';
  const byPidIndex = pids.findIndex((pid) => String(pid) === String(subject));
  const legacyIndex = Number.isInteger(numeric) && numeric >= 0 && numeric < pids.length ? numeric : -1;
  const index = byPidIndex >= 0 ? byPidIndex : legacyIndex;
  if (index >= 0) {
    const pid = pids[index];
    const problem = pdict[String(pid)] || {};
    return `${getAlphabeticId(index)} — ${problem.title || `P${pid}`}`;
  }
  return String(subject);
}

function normalizeBalloonRows(tdoc: R, pdict: Record<string, R>): BalloonColorRow[] {
  const pids: Array<string | number> = tdoc.pids || [];
  const existing: R = tdoc.balloon || {};
  return pids.map((pid, index) => {
    const key = String(pid);
    const config = existing[key] || existing[Number(pid)] || {};
    const problem = pdict[key] || {};
    const isObject = config && typeof config === 'object';
    return {
      pid: key,
      label: getAlphabeticId(index),
      title: problem.title || `P${key}`,
      color: isObject ? config.color || DEFAULT_BALLOON_COLORS[index % DEFAULT_BALLOON_COLORS.length] : String(config || DEFAULT_BALLOON_COLORS[index % DEFAULT_BALLOON_COLORS.length]),
      name: isObject ? config.name || problem.title || '' : problem.title || '',
    };
  });
}

function serializeBalloonRows(rows: BalloonColorRow[]) {
  return rows.map((row) => [
    `${row.pid}:`,
    `  color: ${JSON.stringify(row.color || '#ffffff')}`,
    `  name: ${JSON.stringify(row.name || '')}`,
  ].join('\n')).join('\n');
}

/* ---------- Contest Edit ---------- */

export function ContestEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const rules: Record<string, string> = data.rules || {};
  const isEdit = data.page_name === 'contest_edit';
  const contestUrl = isEdit
    ? replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId || tdoc._id) })
    : bs.urls.contests;
  const initialBeginAt = data.beginAt || tdoc.beginAt || '';
  const [beginDate, setBeginDate] = useState(formatDateInput(initialBeginAt));
  const [beginTime, setBeginTime] = useState(formatTimeInput(initialBeginAt));
  const [duration, setDuration] = useState(String(data.duration || 2));
  const [permission, setPermission] = useState(() => {
    if (tdoc.assign?.length) return 'assign';
    if (tdoc._code || tdoc.code) return 'invite';
    return 'public';
  });
  const endAtDate = toDate(tdoc.endAt);
  const lockAtDate = toDate(tdoc.lockAt);
  const lockMinutes = endAtDate && lockAtDate
    ? Math.max(0, Math.round((endAtDate.getTime() - lockAtDate.getTime()) / 60000))
    : '';

  return (
    <motion.div
      className="mx-auto max-w-2xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑比赛' : '创建比赛'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">比赛标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rule" className="text-sm font-medium">赛制</label>
              <select id="rule" name="rule" defaultValue={tdoc.rule || ''} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {Object.entries(rules).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="beginAtDate" className="text-sm font-medium">开始日期</label>
                <Input id="beginAtDate" name="beginAtDate" type="date" value={beginDate} onChange={(e) => setBeginDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="beginAtTime" className="text-sm font-medium">开始时间</label>
                <Input id="beginAtTime" name="beginAtTime" type="time" value={beginTime} onChange={(e) => setBeginTime(e.target.value)} required />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="duration" className="text-sm font-medium">时长 (小时)</label>
                <Input id="duration" name="duration" type="number" step="0.5" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">结束时间</label>
                <Input value={formatDateTimeInput(beginDate, beginTime, duration)} readOnly className="text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pids" className="text-sm font-medium">题目列表 (逗号分隔)</label>
              <Input id="pids" name="pids" defaultValue={data.pids || ''} placeholder="P1001,P1002,P1003" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">比赛说明 (Markdown)</label>
              <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={320} />
            </div>

            <div className="space-y-3 rounded-md border bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="maintainer" className="text-sm font-medium">比赛维护者</label>
                  <Input id="maintainer" name="maintainer" defaultValue={formatCommaValue(tdoc.maintainer)} placeholder="UID，逗号分隔" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="permission" className="text-sm font-medium">访问控制</label>
                  <select
                    id="permission"
                    value={permission}
                    onChange={(e) => setPermission(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="public">公开</option>
                    <option value="invite">需要邀请码</option>
                    <option value="assign">指定用户 / 用户组</option>
                  </select>
                </div>
              </div>
              {permission === 'invite' && (
                <div className="space-y-1.5">
                  <label htmlFor="code" className="text-sm font-medium">邀请码</label>
                  <Input id="code" name="code" defaultValue={tdoc._code || tdoc.code || ''} placeholder="留空表示不设置邀请码" />
                </div>
              )}
              {permission === 'assign' && (
                <div className="space-y-1.5">
                  <label htmlFor="assign" className="text-sm font-medium">分配给</label>
                  <Input id="assign" name="assign" defaultValue={formatCommaValue(tdoc.assign)} placeholder="用户组 / UID，逗号分隔" />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="langs" className="text-sm font-medium">允许语言 (逗号分隔，留空为全部)</label>
              <Input id="langs" name="langs" defaultValue={Array.isArray(tdoc.langs) ? tdoc.langs.join(',') : ''} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="lock" className="text-sm font-medium">封榜时间 (剩余分钟)</label>
                <Input id="lock" name="lock" type="number" min="0" defaultValue={lockMinutes} placeholder="留空表示不封榜" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="contestDuration" className="text-sm font-medium">弹性时长 (小时)</label>
                <Input id="contestDuration" name="contestDuration" type="number" min="0" step="0.5" defaultValue={tdoc.duration || ''} placeholder="留空表示不限制" />
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="rated" value="true" defaultChecked={tdoc.rated}  />
                计入 Rating
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="autoHide" value="true" defaultChecked={tdoc.autoHide}  />
                赛后自动隐藏题目
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="allowViewCode" value="true" defaultChecked={tdoc.allowViewCode}  />
                允许查看代码
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="allowPrint" value="true" defaultChecked={tdoc.allowPrint}  />
                允许打印
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="keepScoreboardHidden" value="true" defaultChecked={tdoc.keepScoreboardHidden}  />
                赛后保持榜单隐藏
              </label>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" name="operation" value="update">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建比赛'}
              </Button>
              {isEdit && (
                <Button
                  type="submit"
                  name="operation"
                  value="update"
                  variant="outline"
                  formAction={`${bs.urls.contests}/create`}
                >
                  <Copy className="mr-1 size-4" />复制为新比赛
                </Button>
              )}
              {isEdit && (
                <Button
                  type="submit"
                  name="operation"
                  value="delete"
                  variant="destructive"
                  size="sm"
                  formNoValidate
                  onClick={(e) => { if (!confirm('确定要删除此比赛吗？')) e.preventDefault(); }}
                >
                  <Trash2 className="mr-1 size-3" />删除比赛
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Manage (files) ---------- */

export function ContestManagePage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const files: R[] = data.files || [];
  const privateFiles: R[] = data.privateFiles || [];
  const pdict: Record<string, R> = data.pdict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const [selectedPublic, setSelectedPublic] = useState<Set<string>>(new Set());
  const [selectedPrivate, setSelectedPrivate] = useState<Set<string>>(new Set());

  const toggleContestFile = (selected: Set<string>, setSelected: (next: Set<string>) => void, name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const FileSection = ({
    title,
    fileList,
    type,
    selected,
    setSelected,
  }: {
    title: string;
    fileList: R[];
    type: string;
    selected: Set<string>;
    setSelected: (next: Set<string>) => void;
  }) => (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />{title} ({fileList.length})
        </CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />上传
            </Button>
          </form>
          {selected.size > 0 && (
            <form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm(`确认删除选中的 ${selected.size} 个文件吗？`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="operation" value="delete_files" />
              <input type="hidden" name="type" value={type} />
              {Array.from(selected).map((name) => <input key={name} type="hidden" name="files" value={name} />)}
              <Button type="submit" size="sm" variant="destructive">
                <Trash2 className="mr-1 size-3" />删除 ({selected.size})
              </Button>
            </form>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {fileList.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size === fileList.length && fileList.length > 0}
                    onChange={() => setSelected(selected.size === fileList.length ? new Set() : new Set(fileList.map((file) => file.name)))}
                   />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-28 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileList.map((f) => (
                <TableRow key={f.name}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(f.name)}
                      onChange={() => toggleContestFile(selected, setSelected, f.name)}
                     />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1">
                      <Button asChild variant="ghost" size="icon" className="size-7">
                        <a href={`${contestUrl}/file/${type}/${encodeURIComponent(f.name)}`}>
                          <Download className="size-3" />
                        </a>
                      </Button>
                      <form method="post" className="inline">
                        <input type="hidden" name="files" value={f.name} />
                        <input type="hidden" name="type" value={type} />
                        <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {/* Problem scores */}
      {Object.keys(pdict).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">题目分值</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>题号</TableHead>
                  <TableHead>题目</TableHead>
                  <TableHead className="w-32 text-right">分值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(pdict).map(([pid, p]) => (
                  <TableRow key={pid}>
                    <TableCell className="font-mono text-sm">{p.pid || pid}</TableCell>
                    <TableCell className="text-sm">{p.title || '-'}</TableCell>
                    <TableCell className="text-right">
                      <form method="post" className="flex items-center justify-end gap-1">
                        <input type="hidden" name="operation" value="set_score" />
                        <input type="hidden" name="pid" value={pid} />
                        <Input name="score" type="number" min="1" defaultValue={tdoc.score?.[pid] || 100} className="w-20 text-right" />
                        <Button type="submit" size="icon" variant="ghost" className="size-7">
                          <Save className="size-3" />
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <FileSection title="公开文件" fileList={files} type="public" selected={selectedPublic} setSelected={setSelectedPublic} />
      <FileSection title="私有文件" fileList={privateFiles} type="private" selected={selectedPrivate} setSelected={setSelectedPrivate} />
    </motion.div>
  );
}

/* ---------- Contest Problem List ---------- */

export function ContestProblemListPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pdict: Record<string, R> = data.pdict || {};
  const tcdocs: R[] = data.tcdocs || [];
  const pids: number[] = tdoc.pids || [];
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const showScore = data.showScore;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛题目</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">#</TableHead>
                <TableHead>题目</TableHead>
                {showScore && <TableHead className="w-20 text-right">分值</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pids.map((pid, idx) => {
                const p = pdict[String(pid)] || {};
                return (
                  <TableRow key={String(pid)}>
                    <TableCell className="text-center font-mono font-semibold">{getAlphabeticId(idx)}</TableCell>
                    <TableCell>
                      <a href={`${contestUrl}/p/${p.pid || pid}`} className="text-sm text-primary hover:underline">
                        {p.title || `P${pid}`}
                      </a>
                    </TableCell>
                    {showScore && (
                      <TableCell className="text-right font-mono text-sm">{tdoc.score?.[pid] || 100}</TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Clarifications */}
      {tcdocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="size-4" />答疑 ({tcdocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tcdocs.map((tc) => (
              <div key={String(tc._id)} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{clarificationSubjectLabel(tdoc, pdict, tc.subject)}</Badge>
                  <span className="text-xs text-muted-foreground">{tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}</span>
                </div>
                <MarkdownView content={tc.content || ''} className="mt-2" preferredLang={bs.locale} />
                {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
                  <div className="mt-3 space-y-2 border-l pl-3">
                    {tc.reply.map((reply: R) => (
                      <div key={String(reply._id || reply.content)} className="rounded-md bg-muted/30 p-3">
                        <div className="mb-1 text-xs text-muted-foreground">
                          Jury{reply._id ? ` · ${formatObjectIdTime(reply._id, bs.locale)}` : ''}
                        </div>
                        <MarkdownView content={reply.content || ''} preferredLang={bs.locale} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Submit clarification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">提交答疑</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="clarification" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">主题</label>
              <select name="subject" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="0">通用</option>
                <option value="-1">技术问题</option>
                {pids.map((pid, idx) => {
                  const p = pdict[String(pid)] || {};
                  return <option key={String(pid)} value={pid}>{getAlphabeticId(idx)} — {p.title || `P${pid}`}</option>;
                })}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容 (Markdown)</label>
              <MarkdownEditor name="content" value="" minHeight={180} preferredLang={bs.locale} />
            </div>
            <Button type="submit">发送</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest User ---------- */

export function ContestUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tsdocs: R[] = data.tsdocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">参赛选手</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title} — 共 {tsdocs.length} 人</p>
        </div>
      </div>

      {/* Add user */}
      <Card>
        <CardContent className="p-4">
          <form method="post" className="flex items-end gap-3">
            <input type="hidden" name="operation" value="add_user" />
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">用户 UID (逗号分隔)</label>
              <Input name="uids" placeholder="1001,1002" required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="unrank" value="true"  />不计入排名
            </label>
            <Button type="submit"><UserPlus className="mr-1 size-4" />添加</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead className="w-20 text-center">状态</TableHead>
                <TableHead className="w-36 text-right">开始时间</TableHead>
                <TableHead className="w-36 text-right">结束时间</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tsdocs.map((ts) => {
                const u = getUser(udict, ts.uid);
                return (
                  <TableRow key={String(ts.uid)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{u?.uname || `UID ${ts.uid}`}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {ts.attend ? (
                        <Badge variant={ts.unrank ? 'outline' : 'default'} className="text-xs">
                          {ts.unrank ? '不计排名' : '参赛中'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">未参赛</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {ts.startAt ? formatDateTime(ts.startAt, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {ts.endAt ? formatDateTime(ts.endAt, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="rank" />
                        <input type="hidden" name="uid" value={String(ts.uid)} />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                          {ts.unrank ? '恢复排名' : '取消排名'}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
              {tsdocs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">暂无选手</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Balloon ---------- */

export function ContestBalloonPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const bdocs: R[] = data.bdocs || [];
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const [balloonRows, setBalloonRows] = useState<BalloonColorRow[]>(() => normalizeBalloonRows(tdoc, pdict));

  const updateBalloonRow = (pid: string, patch: Partial<BalloonColorRow>) => {
    setBalloonRows((rows) => rows.map((row) => (row.pid === pid ? { ...row, ...patch } : row)));
  };

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">气球分发</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {balloonRows.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="set_color" />
            <input type="hidden" name="color" value={serializeBalloonRows(balloonRows)} readOnly />
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">题目气球配置</h2>
                <p className="text-xs text-muted-foreground">为每道题设置发放时显示的颜色和气球名称。</p>
              </div>
              <Button type="submit" size="sm">
                <Palette className="mr-1 size-3" />保存颜色
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {balloonRows.map((row) => (
                <div key={row.pid} className="grid gap-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold">
                      {row.label}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.title}</p>
                      <p className="text-xs text-muted-foreground">P{row.pid}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-[2.75rem_1fr] gap-2">
                    <input
                      type="color"
                      value={row.color}
                      className="h-9 w-11 cursor-pointer rounded-md border bg-background p-1"
                      onChange={(e) => updateBalloonRow(row.pid, { color: e.target.value })}
                      aria-label={`${row.label} 题气球颜色`}
                    />
                    <Input
                      value={row.name}
                      onChange={(e) => updateBalloonRow(row.pid, { name: e.target.value })}
                      placeholder="气球名称"
                    />
                  </div>
                </div>
              ))}
            </div>
          </form>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-28">编号</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-36">提交者</TableHead>
                <TableHead className="w-36">送达者</TableHead>
                <TableHead className="w-28 text-center">奖励</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bdocs.map((b) => {
                const u = getUser(udict, b.uid);
                const sentBy = getUser(udict, b.sent);
                const p = pdict[String(b.pid)] || {};
                const index = (tdoc.pids || []).map(String).indexOf(String(b.pid));
                const config = (tdoc.balloon || {})[String(b.pid)] || {};
                const sent = Boolean(b.sent);
                const submitTime = formatObjectIdTime(b._id, bs.locale);
                return (
                  <TableRow key={String(b._id)}>
                    <TableCell>
                      <Badge variant={sent ? 'default' : 'outline'} className="text-xs">
                        {sent ? '已送达' : '待处理'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{String(b._id || '').slice(0, 8) || '-'}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-full border"
                          style={{ backgroundColor: typeof config === 'object' ? config.color : undefined }}
                        />
                        <span className="font-semibold">{getAlphabeticId(index)}</span>
                        <span className="min-w-0 truncate">{typeof config === 'object' && config.name ? config.name : p.title || `P${b.pid}`}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{u?.uname || `UID ${b.uid}`}</div>
                      {submitTime && <div className="text-xs text-muted-foreground">{submitTime}</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {sentBy ? (
                        <>
                          <div>{sentBy.uname || `UID ${b.sent}`}</div>
                          {b.sentAt && <div className="text-xs text-muted-foreground">{formatDateTime(b.sentAt, bs.locale)}</div>}
                        </>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">{b.first ? '首个通过' : '-'}</TableCell>
                    <TableCell className="text-center">
                      {!sent && (
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="done" />
                          <input type="hidden" name="balloon" value={String(b._id)} />
                          <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">完成</Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {bdocs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">暂无气球任务</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Clarification ---------- */

export function ContestClarificationPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tcdocs: R[] = data.tcdocs || [];
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const pids: number[] = tdoc.pids || [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">答疑管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {/* Reply form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">发布通知/回复</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="clarification" />
            <div className="grid gap-3 sm:grid-cols-3">
              <select name="subject" className="rounded-md border bg-background px-3 py-2 text-sm sm:col-span-1">
                <option value="0">通用通知</option>
                <option value="-1">技术问题</option>
                {pids.map((pid, idx) => {
                  const p = pdict[String(pid)] || {};
                  return <option key={String(pid)} value={pid}>{getAlphabeticId(idx)} — {p.title || `P${pid}`}</option>;
                })}
              </select>
              <div className="hidden sm:col-span-2 sm:block" />
              <div className="sm:col-span-3">
                <MarkdownEditor name="content" value="" minHeight={180} preferredLang={bs.locale} />
              </div>
            </div>
            <Button type="submit"><MessageSquare className="mr-1 size-4" />发送</Button>
          </form>
        </CardContent>
      </Card>

      {/* Clarification list */}
      {tcdocs.length > 0 ? (
        <div className="space-y-3">
          {tcdocs.map((tc) => {
            const u = getUser(udict, tc.owner);
            return (
              <Card key={String(tc._id)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[9px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{u?.uname || '管理员'}</span>
                    <Badge variant="outline" className="text-xs">{clarificationSubjectLabel(tdoc, pdict, tc.subject)}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}
                    </span>
                  </div>
                  <MarkdownView content={tc.content || ''} className="mt-3" preferredLang={bs.locale} />
                  {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
                    <div className="mt-3 space-y-2 border-l pl-3">
                      {tc.reply.map((reply: R) => (
                        <div key={String(reply._id || reply.content)} className="rounded-md bg-muted/30 p-3">
                          <div className="mb-1 text-xs text-muted-foreground">
                            Jury{reply._id ? ` · ${formatObjectIdTime(reply._id, bs.locale)}` : ''}
                          </div>
                          <MarkdownView content={reply.content || ''} preferredLang={bs.locale} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {tc.owner ? (
                    <form method="post" className="mt-4 space-y-2 border-t pt-3">
                      <input type="hidden" name="operation" value="clarification" />
                      <input type="hidden" name="did" value={String(tc._id)} />
                      <MarkdownEditor name="content" value="" minHeight={140} preferredLang={bs.locale} />
                      <Button type="submit" size="sm" variant="outline">回复</Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">暂无答疑</CardContent>
        </Card>
      )}
    </motion.div>
  );
}

/* ---------- Contest Print ---------- */

export function ContestPrintPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const isPrintAdmin = Boolean(data.isAdmin || data.canEdit || String(bs.user.id) === String(tdoc.owner));
  const [tasks, setTasks] = useState<R[]>([]);
  const [udict, setUdict] = useState<Record<string, GenericUserDoc>>({});
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [kioskEnabled, setKioskEnabled] = useState(false);

  const postPrintOperation = async (payload: Record<string, string>) => {
    const response = await fetch(window.location.href, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || '请求失败');
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };

  const refreshTasks = async () => {
    setLoadingTasks(true);
    try {
      const result = await postPrintOperation({ operation: 'get_print_task' });
      setTasks(result.tasks || []);
      setUdict(result.udict || {});
    } finally {
      setLoadingTasks(false);
    }
  };

  const printTask = (task: R, owner: R) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600,popup=1');
    if (!printWindow) return;
    const lines = String(task.content || '').split('\n');
    const clipped: string[] = [];
    let visualLines = 0;
    for (const line of lines) {
      visualLines += Math.max(1, Math.ceil(line.length / 100));
      if (visualLines > 300) break;
      clipped.push(line);
    }
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(task.title || 'Print')}</title>
          <style>
            body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 12px; font-size: 13px; line-height: 1.35; }
            .header { border-bottom: 1px solid #bbb; margin-bottom: 10px; padding-bottom: 6px; }
            .meta { display: flex; justify-content: space-between; gap: 16px; }
            pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="meta">
              <span>[${escapeHtml(owner.uname || `UID ${task.owner}`)}] ${escapeHtml(owner.school || '')} ${escapeHtml(owner.displayName || '')}</span>
              <span>${escapeHtml(formatObjectIdTime(task._id, bs.locale))}</span>
            </div>
            <div class="meta">
              <span>Filename: ${escapeHtml(task.title || '')}</span>
              <span>By Hydro</span>
            </div>
          </div>
          <pre>${escapeHtml(clipped.join('\n'))}</pre>
        </body>
      </html>
    `);
    printWindow.document.close();
    window.setTimeout(() => printWindow.print(), 300);
  };

  useEffect(() => {
    refreshTasks().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!kioskEnabled) return undefined;
    let active = true;
    const loop = async () => {
      while (active) {
        try {
          const result = await postPrintOperation({ operation: 'allocate_print_task' });
          if (result.task) {
            printTask(result.task, result.udoc || {});
            await postPrintOperation({ operation: 'update_print_task', taskId: String(result.task._id), status: 'printed' });
            await refreshTasks();
          } else {
            await new Promise((resolve) => { window.setTimeout(resolve, 5000); });
          }
        } catch {
          await new Promise((resolve) => { window.setTimeout(resolve, 5000); });
        }
      }
    };
    loop();
    return () => { active = false; };
  }, [kioskEnabled]);

  return (
    <motion.div
      className="mx-auto max-w-4xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">打印服务</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="size-4" />提交打印
          </CardTitle>
          <form method="post" encType="multipart/form-data" className="flex items-center gap-2">
            <input type="hidden" name="operation" value="print" />
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" size="sm" variant="outline">
              <Upload className="mr-1 size-3.5" />
              上传文件
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="print" />
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" placeholder="文件标题" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容</label>
              <textarea
                name="content"
                rows={12}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder="粘贴要打印的代码或文本..."
                required
              />
            </div>
            <Button type="submit"><Printer className="mr-1 size-4" />提交打印</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />打印队列
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => refreshTasks().catch((error) => alert(error.message))}>
              <RefreshCw className="mr-1 size-3.5" />
              {loadingTasks ? '刷新中' : '刷新'}
            </Button>
            {isPrintAdmin && (
              <Button type="button" size="sm" variant={kioskEnabled ? 'default' : 'outline'} onClick={() => setKioskEnabled((value) => !value)}>
                <Printer className="mr-1 size-3.5" />
                {kioskEnabled ? '打印亭已开启' : '开启打印亭'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">用户</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-40">时间</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
                {isPrintAdmin && <TableHead className="w-24 pr-5 text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isPrintAdmin ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
                    暂无打印任务
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => {
                  const owner = udict[String(task.owner)] || {};
                  return (
                    <TableRow key={String(task._id)}>
                      <TableCell className="pl-5 text-sm">
                        {owner.uname || `UID ${task.owner}`}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{task.title || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatObjectIdTime(task._id, bs.locale) || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={String(task.status).includes('printed') ? 'secondary' : 'outline'} className="text-xs">
                          {String(task.status || 'pending')}
                        </Badge>
                      </TableCell>
                      {isPrintAdmin && (
                        <TableCell className="pr-5 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => postPrintOperation({ operation: 'update_print_task', taskId: String(task._id), status: 'pending' })
                              .then(refreshTasks)
                              .catch((error) => alert(error.message))}
                          >
                            重新打印
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}
