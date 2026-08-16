/**
 * 赛时通过率管理（PLAN 2026-07 P1.2）——独立编辑界面。
 *
 * `pdoc.origStat` = 题目在原赛（牛客/杭电等外站）当年的通过/提交数。
 * 后端见 packages/hydrooj/src/handler/realpass.ts（/manage/realpass，
 * 仅 PRIV_EDIT_SYSTEM）。功能：单题录入、批量粘贴（预览→确认写入）、
 * 列表管理（搜索/编辑/删除）、迁移报告展示。
 */
import { BarChart3, ClipboardPaste, Pencil, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface OriginalContestStats {
  accepted: number;
  submitted: number;
  updatedAt?: string | Date;
  updatedBy?: string | number;
}

interface RealPassProblem {
  docId: number;
  pid?: string | number;
  title: string;
  origStat?: OriginalContestStats;
}

interface MigrationUnmatched {
  _id: string;
  accepted: number;
  submitted: number;
}

interface MigrationConflict extends MigrationUnmatched {
  byDocId: string | number;
  byPid: string | number;
}

interface RealPassMigration {
  at: string;
  total: number;
  ok: number;
  unmatched: MigrationUnmatched[];
  conflicts: MigrationConflict[];
}

interface BatchPreviewRow {
  status: string;
  line: string;
  pid?: string | number;
  docId?: string | number;
  title?: string;
  reason?: string;
  accepted?: number;
  submitted?: number;
}

interface BatchPreviewSummary {
  total: number;
  ok: number;
  unmatched: number;
  conflict: number;
  invalid: number;
  duplicate: number;
}

interface BatchPreviewResponse {
  rows: BatchPreviewRow[];
  summary: BatchPreviewSummary;
}

function messageFromError(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(error);
}

async function postOp<T = Record<string, unknown>>(fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetchHydroResponse('/manage/realpass', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(await readHydroResponseError(res, '实名管理操作失败'));
  const body: unknown = await res.json().catch(() => null);
  const error = (body as { error?: unknown } | null)?.error;
  if (error) throw new Error('实名管理响应包含错误标记');
  return body as T;
}

function pct(a: number, s: number) {
  return s > 0 ? Math.round((a / s) * 100) : 0;
}

const BATCH_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  ok: { label: '命中', variant: 'secondary' },
  unmatched: { label: '未找到', variant: 'destructive' },
  conflict: { label: '冲突', variant: 'destructive' },
  invalid: { label: '格式错误', variant: 'destructive' },
  duplicate: { label: '重复跳过', variant: 'outline' },
};

export function RealPassManagePage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    pdocs: RealPassProblem[];
    page: number;
    ppcount: number;
    pcount: number;
    q: string;
    migration: RealPassMigration | null;
  };
  const pdocs = data.pdocs || [];
  const page = data.page || 1;
  const migration = data.migration;

  const [target, setTarget] = useState('');
  const [accepted, setAccepted] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [payload, setPayload] = useState('');
  // preview 绑定发起预览时的 payload 快照——确认写入只写快照内容，
  // 且在途响应回来时若内容已被改动则整个丢弃（防"确认写入未预览内容"竞态）。
  const [preview, setPreview] = useState<(BatchPreviewResponse & { payload: string }) | null>(null);
  const payloadRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fail = (error: unknown) => setMsg({ kind: 'err', text: messageFromError(error) });

  const saveSingle = async () => {
    if (!target.trim() || accepted === '' || submitted === '') {
      setMsg({ kind: 'err', text: '题目ID、通过数、提交数都要填' });
      return;
    }
    setBusy(true);
    try {
      await postOp({
        operation: 'set',
        target: target.trim(),
        accepted,
        submitted,
      });
      window.location.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (docId: number, title: string) => {
    if (!window.confirm(`确认删除「${title}」(#${docId}) 的赛时数据？`)) return;
    setBusy(true);
    try {
      await postOp({ operation: 'remove', docId: String(docId) });
      window.location.reload();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const runBatch = async (commit: boolean) => {
    if (commit) {
      if (!preview) return;

      if (!window.confirm(`确认写入 ${preview.summary?.ok ?? 0} 条赛时数据？（写入内容=刚才预览的那份，重复执行会覆盖同题旧值）`)) return;
    } else if (!payload.trim()) {
      setMsg({ kind: 'err', text: '批量内容为空' });
      return;
    }
    setBusy(true);
    try {
      if (commit) {
        // 只写预览快照，textarea 后续改动不影响本次写入。
        await postOp({ operation: 'batch', payload: preview!.payload, commit: 'true' });
        window.location.reload();
        return;
      }
      const snap = payload;
      const r = await postOp<BatchPreviewResponse>({ operation: 'batch', payload: snap, commit: 'false' });
      // 在途期间内容被改过 → 该预览已过期，丢弃（用户需重新预览）。
      if (payloadRef.current !== snap) return;
      setPreview({ ...r, payload: snap });
      setMsg(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const onPayloadChange = (v: string) => {
    setPayload(v);
    payloadRef.current = v;
    setPreview(null);
  };

  const fillForm = (p: RealPassProblem) => {
    setTarget(String(p.pid || p.docId));
    setAccepted(String(p.origStat?.accepted ?? ''));
    setSubmitted(String(p.origStat?.submitted ?? ''));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <BarChart3 className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">赛时通过率管理</h1>
        <span className="ml-2 text-xs text-muted-foreground">
          已录 {data.pcount ?? pdocs.length} 题 · 数据为题目在原赛（牛客/杭电等）当年的通过/提交数
        </span>
      </header>

      {msg ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.kind === 'err'
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
              : 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
          }`}
        >
          {msg.text}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">单题录入 / 修改</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">题目 ID（docId 或 pid）</label>
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="如 2467 或 CCCCCAUC20250001" />
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs text-muted-foreground">通过数</label>
                <Input type="number" min={0} value={accepted} onChange={(e) => setAccepted(e.target.value)} />
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs text-muted-foreground">提交数</label>
                <Input type="number" min={0} value={submitted} onChange={(e) => setSubmitted(e.target.value)} />
              </div>
              <Button onClick={saveSingle} disabled={busy}>
                保存
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">纯数字 ID 会同时按题号(docId)与 pid 匹配；两者命中不同题时会拒绝并提示，请改用完整 pid。</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardPaste className="size-4" />
              批量粘贴导入
            </h2>
            <Textarea
              value={payload}
              readOnly={busy}
              onChange={(e) => onPayloadChange(e.target.value)}
              placeholder={'每行：题目ID<TAB>通过数<TAB>提交数（也接受逗号/空格分隔）\n如：\n2467\t277\t965\n2466\t681\t2146'}
              className="min-h-28 font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => runBatch(false)} disabled={busy}>
                预览（不写入）
              </Button>
              <Button onClick={() => runBatch(true)} disabled={busy || !preview || !(preview.summary?.ok > 0)}>
                确认写入{preview ? `（${preview.summary.ok} 条）` : ''}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {preview ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">
              批量预览 · 共 {preview.summary.total} 行：命中 {preview.summary.ok} · 未找到 {preview.summary.unmatched} · 冲突{' '}
              {preview.summary.conflict} · 格式错误 {preview.summary.invalid} · 重复 {preview.summary.duplicate}
            </h2>
            <ScrollArea className="max-h-80" viewportLayout="block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead>原始行 / 命中题目</TableHead>
                    <TableHead className="w-32 text-right">赛时数据</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r, i) => {
                    const st = BATCH_STATUS[r.status] || BATCH_STATUS.invalid;
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant={st.variant} className="text-[10px]">
                            {st.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono">{r.line}</span>
                          {r.status === 'ok' ? (
                            <span className="ml-2 text-muted-foreground">
                              → {r.pid || `#${r.docId}`} {r.title}
                            </span>
                          ) : r.reason ? (
                            <span className="ml-2 text-red-600 dark:text-red-400">{r.reason}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.accepted != null ? `${r.accepted}/${r.submitted}` : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}

      {migration && (migration.unmatched?.length || 0) + (migration.conflicts?.length || 0) > 0 ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
              迁移遗留待处理：未匹配 {migration.unmatched?.length || 0} 条 · 冲突 {migration.conflicts?.length || 0} 条
            </h2>
            <div className="space-y-1 text-xs text-muted-foreground">
              {(migration.unmatched || []).slice(0, 20).map((u, i) => (
                <div key={`u${i}`} className="font-mono">
                  未匹配：{u._id} → {u.accepted}/{u.submitted}（可用上方单题录入手动补）
                </div>
              ))}
              {(migration.conflicts || []).slice(0, 20).map((c, i) => (
                <div key={`c${i}`} className="font-mono">
                  冲突：{c._id} → docId #{c.byDocId} / pid #{c.byPid}，请人工裁决后用 pid 录入
                </div>
              ))}
              {(migration.unmatched?.length || 0) > 20 || (migration.conflicts?.length || 0) > 20 ? (
                <div>
                  （未匹配 {migration.unmatched?.length || 0} 条 / 冲突 {migration.conflicts?.length || 0} 条， 各仅显示前 20 条，完整清单在 system
                  集合 realpass.migration_unmatched）
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b p-3">
            <form method="get" className="flex flex-1 items-center gap-2">
              <Search className="size-4 text-muted-foreground" />
              <Input name="q" defaultValue={data.q || ''} placeholder="按 pid / 标题搜索已录题目" className="h-8 max-w-72" />
              <Button type="submit" variant="outline" size="sm">
                搜索
              </Button>
            </form>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44 pl-5">题目</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-36 text-right">赛时通过 / 提交</TableHead>
                <TableHead className="w-20 text-right">通过率</TableHead>
                <TableHead className="w-40">更新</TableHead>
                <TableHead className="w-28 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {data.q ? '没有匹配的已录题目。' : '还没有任何赛时数据。先跑迁移脚本或用上方录入。'}
                  </TableCell>
                </TableRow>
              ) : (
                pdocs.map((p) => (
                  <TableRow key={String(p.docId)}>
                    <TableCell className="pl-5 font-mono text-xs">{p.pid || `#${p.docId}`}</TableCell>
                    <TableCell>
                      <a href={`/p/${p.pid || p.docId}`} className="text-sm hover:text-primary hover:underline">
                        {p.title}
                      </a>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {p.origStat ? `${p.origStat.accepted}/${p.origStat.submitted}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {p.origStat ? `${pct(p.origStat.accepted, p.origStat.submitted)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.origStat?.updatedAt ? new Date(p.origStat.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                      {p.origStat?.updatedBy ? <span className="ml-1">by {p.origStat.updatedBy}</span> : null}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => fillForm(p)}>
                          <Pencil className="size-3" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-red-600 hover:text-red-700 dark:text-red-400"
                          onClick={() => remove(p.docId, p.title)}
                          disabled={busy}
                        >
                          <Trash2 className="size-3" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(data.ppcount || 1) > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/manage/realpass?page=${page - 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>上一页</a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              上一页
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {page} / {data.ppcount}
          </span>
          {page < data.ppcount ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/manage/realpass?page=${page + 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>下一页</a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              下一页
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
