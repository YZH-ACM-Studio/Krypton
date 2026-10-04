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
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
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
    <Badge tone="warning" size="sm">
      <EyeOff className="size-3" aria-hidden="true" />
      隐藏
    </Badge>
  ) : (
    <Badge tone="success" size="sm">
      <Eye className="size-3" aria-hidden="true" />
      可见
    </Badge>
  );
}

function ProblemTitleBlock({ p }: { p: OwnedProblem }) {
  return (
    <>
      <a href={problemHref(p)} className="block min-w-0 truncate text-sm font-medium text-fg hover:text-brand-fg hover:underline">
        {p.title}
      </a>
      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
        {(p.tag || []).slice(0, 4).map((t: string) => (
          <Badge key={t} variant="outline" size="sm" className="h-auto! max-w-full min-w-0 shrink! whitespace-normal! break-words py-0.5">
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
  const pageCount = data.ppcount || 1;
  const mdUp = useMdUp();

  return (
    <Page width="wide">
      <PageHeader
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <BookOpen className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0 truncate">我的题目</span>
          </span>
        )}
        meta={<span className="tabular">共 {data.pcount ?? pdocs.length} 题</span>}
        actions={<ProblemMineCreateAction allowed={data.canCreate === true} />}
      />

      <Panel flush>
        {pdocs.length === 0 ? (
          <EmptyState
            title="你还没有参与出题。"
            description={data.canCreate ? '点击右上角「新建题目」开始。' : undefined}
          />
        ) : (
          mdUp ? (
            <Table density="flush">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">ID</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-24 text-center">状态</TableHead>
                  <TableHead className="w-28 text-right">通过 / 提交</TableHead>
                  <TableHead className="w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pdocs.map((p) => (
                  <TableRow key={String(p.docId)}>
                    <TableCell className="font-mono text-xs">{p.pid || `P${p.docId}`}</TableCell>
                    <TableCell className="min-w-0">
                      <ProblemTitleBlock p={p} />
                    </TableCell>
                    <TableCell className="text-center">
                      <ProblemVisibilityBadge hidden={p.hidden} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-fg-subtle tabular">
                      {p.nAccept ?? 0} / {p.nSubmit ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="secondary" size="sm">
                        <a href={`${problemHref(p)}/edit`}>
                          <Pencil />
                          编辑
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ul className="flex flex-col gap-3 p-3">
              {pdocs.map((p) => (
                <li key={String(p.docId)} className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-fg-subtle">ID</span>
                    <span className="min-w-0 truncate font-mono text-xs text-fg">{p.pid || `P${p.docId}`}</span>
                  </div>
                  <div className="min-w-0">
                    <ProblemTitleBlock p={p} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-fg-subtle">状态</span>
                    <ProblemVisibilityBadge hidden={p.hidden} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-fg-subtle">通过 / 提交</span>
                    <span className="font-mono text-xs text-fg-subtle tabular">
                      {p.nAccept ?? 0} / {p.nSubmit ?? 0}
                    </span>
                  </div>
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <a href={`${problemHref(p)}/edit`}>
                      <Pencil />
                      编辑
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
      </Panel>

      <Pagination current={page} total={pageCount} baseUrl="/problem/mine" />
    </Page>
  );
}
