/**
 * 我的题目（PLAN 2026-07-02 §4）——出题人的工作台。
 * 题库列表对学生隐藏（题库白名单模式）后，出过题的用户在这里管理
 * 自己 own 的题：列表 + 建题入口。数据来自 ProblemMineHandler
 * （/problem/mine，只查 owner=自己）。
 */
import { useSyncExternalStore } from 'react';
import { BookOpen, Eye, EyeOff, Pencil } from 'lucide-react';
import { ProblemMineCreateAction } from '@/components/problem-mine-create-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';

const MD_UP_QUERY = '(min-width: 768px)';

function subscribeMdUp(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(MD_UP_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function mdUpMatches() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MD_UP_QUERY).matches;
}

function useMdUp() {
  return useSyncExternalStore(subscribeMdUp, mdUpMatches, () => false);
}

interface OwnedProblem {
  docId: string | number;
  pid?: string | number;
  title?: string;
  tag?: string[];
  hidden?: boolean;
  nAccept?: number;
  nSubmit?: number;
}

function problemHref(p: OwnedProblem) {
  return `/p/${p.pid || p.docId}`;
}

function ProblemVisibilityBadge({ hidden }: { hidden?: boolean }) {
  return hidden ? (
    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
      <EyeOff className="size-2.5" />
      隐藏
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      <Eye className="size-2.5" />
      可见
    </Badge>
  );
}

function ProblemTitleBlock({ p }: { p: OwnedProblem }) {
  return (
    <>
      <a href={problemHref(p)} className="text-sm font-medium hover:text-primary hover:underline">
        {p.title}
      </a>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {(p.tag || []).slice(0, 4).map((t: string) => (
          <Badge key={t} variant="outline" className="text-[10px]">
            {t}
          </Badge>
        ))}
      </div>
    </>
  );
}

export function ProblemMinePage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    pdocs: OwnedProblem[];
    page: number;
    pcount: number;
    ppcount: number;
    canCreate: boolean;
  };
  const pdocs = data.pdocs || [];
  const page = data.page || 1;
  const mdUp = useMdUp();

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">我的题目</h1>
          <span className="text-xs text-muted-foreground">共 {data.pcount ?? pdocs.length} 题</span>
        </div>
        <ProblemMineCreateAction allowed={data.canCreate === true} />
      </header>

      <Card>
        <CardContent className="p-0">
          {pdocs.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              你还没有参与出题。{data.canCreate ? '点击右上角「新建题目」开始。' : ''}
            </p>
          ) : (
            mdUp ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28 pl-5">ID</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-24 text-center">状态</TableHead>
                    <TableHead className="w-28 text-right">通过 / 提交</TableHead>
                    <TableHead className="w-28 pr-5 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pdocs.map((p) => (
                    <TableRow key={String(p.docId)}>
                      <TableCell className="pl-5 font-mono text-xs">{p.pid || `P${p.docId}`}</TableCell>
                      <TableCell>
                        <ProblemTitleBlock p={p} />
                      </TableCell>
                      <TableCell className="text-center">
                        <ProblemVisibilityBadge hidden={p.hidden} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {p.nAccept ?? 0} / {p.nSubmit ?? 0}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button asChild variant="outline" size="sm" className="gap-1">
                          <a href={`${problemHref(p)}/edit`}>
                            <Pencil className="size-3" />
                            编辑
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <ul className="space-y-3 p-3">
                {pdocs.map((p) => (
                  <li key={String(p.docId)} className="grid grid-cols-1 gap-3 rounded-xl border border-border/80 bg-background p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">ID</span>
                      <span className="font-mono text-xs">{p.pid || `P${p.docId}`}</span>
                    </div>
                    <div className="min-w-0">
                      <ProblemTitleBlock p={p} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">状态</span>
                      <ProblemVisibilityBadge hidden={p.hidden} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">通过 / 提交</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.nAccept ?? 0} / {p.nSubmit ?? 0}
                      </span>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-auto min-h-11 w-full gap-1">
                      <a href={`${problemHref(p)}/edit`}>
                        <Pencil className="size-3" />
                        编辑
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )
          )}
        </CardContent>
      </Card>

      {(data.ppcount || 1) > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/problem/mine?page=${page - 1}`}>上一页</a>
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
              <a href={`/problem/mine?page=${page + 1}`}>下一页</a>
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
