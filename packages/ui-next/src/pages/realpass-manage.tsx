/**
 * 赛时通过率管理（PLAN 2026-07 P1.2）——独立编辑界面。
 *
 * `pdoc.origStat` = 题目在原赛（牛客/杭电等外站）当年的通过/提交数。
 * 后端见 packages/hydrooj/src/handler/realpass.ts（/manage/realpass，
 * 仅 PRIV_EDIT_SYSTEM）。功能：单题录入、批量粘贴（预览→确认写入）、
 * 列表管理（搜索/编辑/删除）、迁移报告展示。
 */
import { ClipboardPaste, Pencil, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
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

function scrollNearestContainerToTop(from: HTMLElement | null) {
  if (!from) return;
  const viewport = from.closest('[data-radix-scroll-area-viewport]');
  if (viewport instanceof HTMLElement) {
    viewport.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const owner = from.closest('[data-scroll-owner]');
  if (!(owner instanceof HTMLElement)) return;
  const inner = owner.querySelector('[data-radix-scroll-area-viewport]');
  if (inner instanceof HTMLElement) {
    inner.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  owner.scrollTo({ top: 0, behavior: 'smooth' });
}

const BATCH_STATUS: Record<string, { label: string; tone: BadgeTone; variant: 'soft' | 'outline' }> = {
  ok: { label: '命中', tone: 'success', variant: 'soft' },
  unmatched: { label: '未找到', tone: 'danger', variant: 'soft' },
  conflict: { label: '冲突', tone: 'danger', variant: 'soft' },
  invalid: { label: '格式错误', tone: 'danger', variant: 'soft' },
  duplicate: { label: '重复跳过', tone: 'neutral', variant: 'outline' },
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
  const editorRef = useRef<HTMLDivElement>(null);
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
    if (!(await confirmDialog('这道题的原赛通过数和提交数会被删掉。', {
      title: `删除「${title}」（#${docId}）的赛时数据？`,
      confirmLabel: '删除',
      destructive: true,
    }))) return;
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

      if (!(await confirmDialog('写入内容是刚才预览的那份。重复执行会覆盖同题旧的赛时数据。', {
        title: `写入 ${preview.summary?.ok ?? 0} 条赛时数据？`,
        confirmLabel: '写入',
        destructive: true,
      }))) return;
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
    scrollNearestContainerToTop(editorRef.current);
  };

  return (
    <Page width="wide">
      <PageHeader
        title="赛时通过率管理"
        description={`已录 ${data.pcount ?? pdocs.length} 题 · 数据为题目在原赛（牛客/杭电等）当年的通过/提交数`}
      />

      {msg ? <Alert tone={msg.kind === 'err' ? 'danger' : 'success'}>{msg.text}</Alert> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div ref={editorRef} className="min-w-0">
          <Panel title="单题录入 / 修改">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-fg" htmlFor="realpass-target">题目 ID（docId 或 pid）</label>
                  <Input id="realpass-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="如 2467 或 CCCCCAUC20250001" />
                </div>
                <div className="w-32">
                  <label className="mb-1.5 block text-sm font-medium text-fg" htmlFor="realpass-accepted">通过数</label>
                  <Input id="realpass-accepted" type="number" min={0} value={accepted} onChange={(e) => setAccepted(e.target.value)} />
                </div>
                <div className="w-32">
                  <label className="mb-1.5 block text-sm font-medium text-fg" htmlFor="realpass-submitted">提交数</label>
                  <Input id="realpass-submitted" type="number" min={0} value={submitted} onChange={(e) => setSubmitted(e.target.value)} />
                </div>
                <Button type="button" variant="primary" onClick={saveSingle} disabled={busy}>
                  保存
                </Button>
              </div>
              <p className="text-xs text-fg-subtle">纯数字 ID 会同时按题号(docId)与 pid 匹配；两者命中不同题时会拒绝并提示，请改用完整 pid。</p>
            </div>
          </Panel>
        </div>

        <Panel
          title={
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <ClipboardPaste className="size-4 shrink-0 text-fg-subtle" />
              <span className="min-w-0">批量粘贴导入</span>
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <Textarea
              value={payload}
              readOnly={busy}
              onChange={(e) => onPayloadChange(e.target.value)}
              placeholder={'每行：题目ID<TAB>通过数<TAB>提交数（也接受逗号/空格分隔）\n如：\n2467\t277\t965\n2466\t681\t2146'}
              className="min-h-32 font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => runBatch(false)} disabled={busy}>
                预览（不写入）
              </Button>
              <Button type="button" variant="danger-soft" onClick={() => runBatch(true)} disabled={busy || !preview || !(preview.summary?.ok > 0)}>
                确认写入{preview ? `（${preview.summary.ok} 条）` : ''}
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      {preview ? (
        <Panel
          title={
            <span className="block min-w-0 break-words">
              批量预览 · 共 {preview.summary.total} 行：命中 {preview.summary.ok} · 未找到 {preview.summary.unmatched} · 冲突{' '}
              {preview.summary.conflict} · 格式错误 {preview.summary.invalid} · 重复 {preview.summary.duplicate}
            </span>
          }
        >
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
                        <Badge tone={st.tone} variant={st.variant} size="sm">
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{r.line}</span>
                        {r.status === 'ok' ? (
                          <span className="ml-2 text-fg-muted">
                            → {r.pid || `#${r.docId}`} {r.title}
                          </span>
                        ) : r.reason ? (
                          <span className="ml-2 text-danger-fg">{r.reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular">{r.accepted != null ? `${r.accepted}/${r.submitted}` : '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </Panel>
      ) : null}

      {migration && (migration.unmatched?.length || 0) + (migration.conflicts?.length || 0) > 0 ? (
        <Panel
          title={
            <span className="block min-w-0 break-words text-warning-fg">
              迁移遗留待处理：未匹配 {migration.unmatched?.length || 0} 条 · 冲突 {migration.conflicts?.length || 0} 条
            </span>
          }
        >
          <div className="space-y-1 text-xs text-fg-subtle">
            {(migration.unmatched || []).slice(0, 20).map((u, i) => (
              <div key={`u${i}`} className="break-all font-mono">
                未匹配：{u._id} → {u.accepted}/{u.submitted}（可用上方单题录入手动补）
              </div>
            ))}
            {(migration.conflicts || []).slice(0, 20).map((c, i) => (
              <div key={`c${i}`} className="break-all font-mono">
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
        </Panel>
      ) : null}

      <Panel flush>
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <form method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Search className="size-4 shrink-0 text-fg-subtle" />
            <Input name="q" size="sm" defaultValue={data.q || ''} placeholder="按 pid / 标题搜索已录题目" className="w-auto min-w-40 max-w-72 flex-1" />
            <Button type="submit" variant="secondary" size="sm">
              搜索
            </Button>
          </form>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">题目</TableHead>
              <TableHead>标题</TableHead>
              <TableHead className="w-36 text-right">赛时通过 / 提交</TableHead>
              <TableHead className="w-20 text-right">通过率</TableHead>
              <TableHead className="w-40">更新</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pdocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-fg-muted">
                  {data.q ? '没有匹配的已录题目。' : '还没有任何赛时数据。先跑迁移脚本或用上方录入。'}
                </TableCell>
              </TableRow>
            ) : (
              pdocs.map((p) => (
                <TableRow key={String(p.docId)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{p.pid || `#${p.docId}`}</TableCell>
                  <TableCell className="max-w-0">
                    <a href={`/p/${p.pid || p.docId}`} title={p.title} className="block min-w-0 truncate text-sm text-fg hover:text-brand-fg hover:underline">
                      {p.title}
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular">
                    {p.origStat ? `${p.origStat.accepted}/${p.origStat.submitted}` : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular">
                    {p.origStat ? `${pct(p.origStat.accepted, p.origStat.submitted)}%` : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-fg-subtle">
                    {p.origStat?.updatedAt ? new Date(p.origStat.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                    {p.origStat?.updatedBy ? <span className="ml-1">by {p.origStat.updatedBy}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => fillForm(p)}>
                        <Pencil />
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="danger-soft"
                        size="sm"
                        onClick={() => remove(p.docId, p.title)}
                        disabled={busy}
                      >
                        <Trash2 />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      {(data.ppcount || 1) > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`/manage/realpass?page=${page - 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>上一页</a>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              上一页
            </Button>
          )}
          <span className="text-xs text-fg-subtle tabular">
            {page} / {data.ppcount}
          </span>
          {page < data.ppcount ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`/manage/realpass?page=${page + 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>下一页</a>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              下一页
            </Button>
          )}
        </div>
      ) : null}
    </Page>
  );
}
