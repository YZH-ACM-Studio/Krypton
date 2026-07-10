/**
 * 出卷中心（PLAN 2026-07 P3.1 骨架 / Rev.12 全量）——客观题 / 函数题的
 * 独立管理列表。后端见 packages/hydrooj/src/handler/paper-center.ts
 * （/paper-center，PERM_CREATE_PROBLEM：管理员+教师）。
 *
 * Rev.12：新建走弹标题框 → POST /paper-center/create → 客观题直达独立
 * 编辑器（/paper-center/:docId/edit），函数题跳现有 problem-edit 链路。
 */
import { FilePlus2, FunctionSquare, Loader2, NotebookPen, Search } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';

interface KindSummary {
  type: string;
  kinds: Record<string, number>;
  total: number;
  parseError?: boolean;
}

interface Row {
  docId: number;
  pid?: string;
  title: string;
  hidden: boolean;
  owner: number;
  ownerName: string;
  createdAt: string | null;
  summary: KindSummary;
}

const KIND_LABEL: Record<string, string> = {
  single: '单选',
  multi: '多选',
  blank: '填空',
  fill_program: '程序填空',
  subjective: '主观题',
  fill_function: '挖空区',
};

function KindBadges({ summary }: { summary: KindSummary }) {
  if (summary.parseError) {
    return <Badge variant="destructive" className="text-[10px]">config 解析失败</Badge>;
  }
  const entries = Object.entries(summary.kinds).filter(([, n]) => n > 0);
  if (!entries.length) {
    return <span className="text-xs text-muted-foreground">无小题</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([kind, n]) => (
        <Badge key={kind} variant="secondary" className="text-[10px]">
          {KIND_LABEL[kind] || kind} ×{n}
        </Badge>
      ))}
    </div>
  );
}

function CreateDialog({
  open, ptype, onClose,
}: {
  open: boolean;
  ptype: 'objective' | 'fill_function';
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    if (!title.trim()) {
      setErr('标题不能为空');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('ptype', ptype);
      const res = await fetch('/paper-center/create', {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.error) throw new Error(body?.error?.message || `创建失败（HTTP ${res.status}）`);
      window.location.assign(body.url);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ptype === 'objective' ? '新建客观题' : '新建函数题'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="题目标题"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          />
          <p className="text-xs text-muted-foreground">
            {ptype === 'objective'
              ? '创建后进入独立编辑器添加小题（默认对学生隐藏）。'
              : '创建后进入题目编辑页配置代码模板、挖空区与测试数据（默认对学生隐藏）。'}
          </p>
          {err ? <p className="text-xs text-red-600 dark:text-red-400">{err}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
            <Button onClick={create} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PaperCenterPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    rows: Row[]; page: number; ppcount: number; pcount: number; q: string;
  };
  const rows = data.rows || [];
  const page = data.page || 1;
  const [createType, setCreateType] = useState<'objective' | 'fill_function' | null>(null);

  const problemHref = (r: Row) => `/p/${r.pid || r.docId}`;
  const editHref = (r: Row) => (r.summary.type === 'fill_function'
    ? `${problemHref(r)}/edit`
    : `/paper-center/${r.docId}/edit`);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-2">
        <NotebookPen className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">出卷中心</h1>
        <span className="ml-2 text-xs text-muted-foreground">
          共 {data.pcount ?? rows.length} 道客观题类题目（客观题 / 函数题）
        </span>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setCreateType('fill_function')}>
          <FunctionSquare className="mr-1 size-4" />新建函数题
        </Button>
        <Button onClick={() => setCreateType('objective')}>
          <FilePlus2 className="mr-1 size-4" />新建客观题
        </Button>
      </header>
      {createType ? (
        <CreateDialog open ptype={createType} onClose={() => setCreateType(null)} />
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b p-3">
            <form method="get" className="flex flex-1 items-center gap-2">
              <Search className="size-4 text-muted-foreground" />
              <Input name="q" defaultValue={data.q || ''} placeholder="按 pid / 标题搜索" className="h-8 max-w-72" />
              <Button type="submit" variant="outline" size="sm">搜索</Button>
            </form>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40 pl-5">题号</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-28">类型</TableHead>
                <TableHead className="w-64">题型构成</TableHead>
                <TableHead className="w-28">出题人</TableHead>
                <TableHead className="w-40">创建时间</TableHead>
                <TableHead className="w-20 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {data.q ? '没有匹配的题目。' : '还没有客观题类题目，点右上角「新建客观题」开始。'}
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.docId}>
                  <TableCell className="pl-5 font-mono text-xs">{r.pid || `#${r.docId}`}</TableCell>
                  <TableCell>
                    <a href={problemHref(r)} className="text-sm hover:text-primary hover:underline">{r.title}</a>
                    {r.hidden ? <Badge variant="outline" className="ml-2 text-[10px]">隐藏</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.summary.type === 'fill_function' ? 'default' : 'secondary'} className="text-[10px]">
                      {r.summary.type === 'fill_function' ? '函数题' : '客观题'}
                    </Badge>
                  </TableCell>
                  <TableCell><KindBadges summary={r.summary} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.ownerName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                      <a href={editHref(r)}>编辑</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(data.ppcount || 1) > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/paper-center?page=${page - 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>上一页</a>
            </Button>
          ) : <Button variant="outline" size="sm" disabled>上一页</Button>}
          <span className="text-xs text-muted-foreground">{page} / {data.ppcount}</span>
          {page < data.ppcount ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/paper-center?page=${page + 1}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}>下一页</a>
            </Button>
          ) : <Button variant="outline" size="sm" disabled>下一页</Button>}
        </div>
      ) : null}
    </div>
  );
}
