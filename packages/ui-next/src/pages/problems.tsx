import { useState } from 'react';
import { Archive, CheckCircle2, Copy, Eye, EyeOff, LockKeyhole, Pencil, Plus, Search, SlidersHorizontal, Upload, XCircle } from 'lucide-react';
import { effectiveProblemKind, type ProblemKind } from '@hydrooj/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

const KIND_LABEL: Record<ProblemKind, string> = {
  programming: '编程题',
  single: '单选题',
  multi: '多选题',
  true_false: '判断题',
  blank: '填空题',
  subjective: '主观题',
  program_fill: '程序填空题',
  function: '函数题',
};

interface BankFilters {
  kind?: string;
  tag?: string;
  owner?: string | number;
  visibility?: 'all' | 'hidden' | 'published';
  lifecycle?: 'active' | 'archived' | 'all';
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function FilterForm({
  action,
  query,
  sort,
  filters,
  problemKinds,
  canFilterOwner,
  compact = false,
}: {
  action: string;
  query: string;
  sort: string;
  filters: BankFilters;
  problemKinds: Array<{ kind: ProblemKind; slug: string }>;
  canFilterOwner: boolean;
  compact?: boolean;
}) {
  return (
    <form method="get" action={action} className={compact ? 'space-y-4' : 'grid gap-3 lg:grid-cols-4 xl:grid-cols-7'}>
      <label className={compact ? 'block space-y-1.5' : 'space-y-1.5 lg:col-span-2'}>
        <span className="text-xs font-medium text-muted-foreground">关键词或题号</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={query} placeholder="标题、PID、题号或标签" className="min-h-11 pl-9" />
        </span>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">题型</span>
        <SimpleSelect
          name="kind"
          defaultValue={filters.kind || ''}
          className="min-h-11"
          options={[{ value: '', label: '全部题型' }, ...problemKinds.map((item) => ({ value: item.slug, label: KIND_LABEL[item.kind] }))]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">标签</span>
        <Input name="tag" defaultValue={filters.tag || ''} placeholder="精确标签" className="min-h-11" />
      </label>
      {canFilterOwner ? (
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Owner UID</span>
          <Input name="owner" type="number" min={1} defaultValue={filters.owner || ''} placeholder="全部" className="min-h-11" />
        </label>
      ) : null}
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">可见性</span>
        <SimpleSelect
          name="visibility"
          defaultValue={filters.visibility || 'all'}
          className="min-h-11"
          options={[
            { value: 'all', label: '全部' },
            { value: 'hidden', label: '隐藏' },
            { value: 'published', label: '已发布' },
          ]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">生命周期</span>
        <SimpleSelect
          name="lifecycle"
          defaultValue={filters.lifecycle || 'active'}
          className="min-h-11"
          options={[
            { value: 'active', label: '使用中' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部' },
          ]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">排序</span>
        <SimpleSelect
          name="sort"
          defaultValue={sort}
          className="min-h-11"
          options={[
            { value: 'default', label: '题号顺序' },
            { value: 'recent', label: '最近创建' },
            { value: 'title', label: '标题 A–Z' },
          ]}
        />
      </label>
      <div className={compact ? 'flex gap-2 pt-1' : 'flex items-end gap-2'}>
        <Button type="submit" className="min-h-11 flex-1">
          应用
        </Button>
        <Button asChild type="button" variant="ghost" className="min-h-11">
          <a href={action}>清空</a>
        </Button>
      </div>
    </form>
  );
}

function SubmissionStatus({ status }: { status?: number }) {
  if (status === 1) return <CheckCircle2 className="size-4 text-emerald-600" aria-label="已通过" />;
  if (status === 2) return <XCircle className="size-4 text-rose-600" aria-label="未通过" />;
  return <span className="size-4" aria-hidden="true" />;
}

export function ProblemsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as R;
  const pdocs: R[] = data.pdocs || [];
  const page = Number(data.page) || 1;
  const ppcount = Number(data.ppcount) || 1;
  const pcount = Number(data.pcount) || pdocs.length;
  const query = String(data.qs || '');
  const sort = String(data.sort || 'default');
  const filters: BankFilters = data.filters || {};
  const problemKinds: Array<{ kind: ProblemKind; slug: string }> = data.problemKinds || [];
  const ownerNames: Record<string, string> = data.ownerNames || {};
  const canManageByDocId: Record<string, boolean> = data.canManageByDocId || {};
  const psdict: Record<string, R> = data.psdict || {};
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const filtersActive = Boolean(
    query ||
    filters.kind ||
    filters.tag ||
    filters.owner ||
    (filters.visibility && filters.visibility !== 'all') ||
    (filters.lifecycle && filters.lifecycle !== 'active') ||
    sort !== 'default',
  );
  const problemsBaseUrl = buildUrlWithQuery(bs.urls.problems, {
    q: query,
    kind: filters.kind,
    tag: filters.tag,
    owner: filters.owner,
    visibility: filters.visibility === 'all' ? '' : filters.visibility,
    lifecycle: filters.lifecycle === 'active' ? '' : filters.lifecycle,
    sort: sort === 'default' ? '' : sort,
  });

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] space-y-6 overflow-x-clip pb-12">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">统一题库</p>
          <h1 className="text-3xl font-semibold tracking-tight">题目</h1>
          <p className="text-sm text-muted-foreground">当前条件下共 {pcount} 道题</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="sm:hidden" onClick={() => setMobileFiltersOpen(true)}>
            <SlidersHorizontal className="size-4" />
            筛选{filtersActive ? ' · 已启用' : ''}
          </Button>
          <Button asChild variant="outline">
            <a href="/problem/import/hydro">
              <Upload className="size-4" />
              导入
            </a>
          </Button>
          <Button asChild>
            <a href="/problem/create">
              <Plus className="size-4" />
              新建题目
            </a>
          </Button>
        </div>
      </header>

      <section aria-label="题库筛选" className="hidden rounded-2xl bg-muted/45 p-4 sm:block">
        <FilterForm
          action={bs.urls.problems}
          query={query}
          sort={sort}
          filters={filters}
          problemKinds={problemKinds}
          canFilterOwner={!!data.canFilterOwner}
        />
      </section>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>筛选题库</SheetTitle>
          </SheetHeader>
          <div className="p-5">
            <FilterForm
              action={bs.urls.problems}
              query={query}
              sort={sort}
              filters={filters}
              problemKinds={problemKinds}
              canFilterOwner={!!data.canFilterOwner}
              compact
            />
          </div>
        </SheetContent>
      </Sheet>

      <section aria-label="题目列表" className="overflow-hidden rounded-2xl border border-border/80 bg-background">
        {pdocs.length === 0 ? (
          <div className="grid min-h-56 place-items-center px-6 py-12 text-center">
            <div className="space-y-2">
              <p className="font-medium">没有符合条件的题目</p>
              <p className="text-sm text-muted-foreground">调整筛选条件，或创建一道新题。</p>
              {filtersActive ? (
                <Button asChild variant="outline" size="sm">
                  <a href={bs.urls.problems}>清空筛选</a>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {pdocs.map((pdoc) => {
              const docId = String(pdoc.docId);
              const displayPid = String(pdoc.pid || pdoc.docId);
              const kind = effectiveProblemKind(pdoc);
              const canManage = !!canManageByDocId[docId];
              const detailUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: displayPid });
              const status = psdict[docId]?.status;
              return (
                <li key={docId} className="px-4 py-4 sm:px-5">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-[1.2rem_minmax(0,1fr)_auto] sm:items-center">
                    <SubmissionStatus status={status} />
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-normal">
                          {KIND_LABEL[kind]}
                        </Badge>
                        <a href={detailUrl} className="min-w-0 truncate font-medium hover:text-primary hover:underline">
                          {pdoc.title || '未命名题目'}
                        </a>
                        <span className="font-mono text-xs text-muted-foreground">{displayPid}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Owner · {ownerNames[String(pdoc.owner)] || `UID ${pdoc.owner}`}</span>
                        <span className="inline-flex items-center gap-1">
                          {pdoc.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          {pdoc.hidden ? '隐藏' : '已发布'}
                        </span>
                        {pdoc.structureLockedAt ? (
                          <span className="inline-flex items-center gap-1">
                            <LockKeyhole className="size-3.5" />
                            结构已锁定
                          </span>
                        ) : null}
                        {pdoc.archivedAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Archive className="size-3.5" />
                            已归档
                          </span>
                        ) : null}
                      </div>
                      {pdoc.tag?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {(pdoc.tag as string[]).slice(0, 5).map((tag) => (
                            <Badge key={tag} variant="outline" className="font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <Button asChild variant="ghost" size="sm">
                        <a href={detailUrl}>查看</a>
                      </Button>
                      {canManage ? (
                        <>
                          <Button asChild variant="ghost" size="sm">
                            <a href={`${detailUrl}/edit`}>
                              <Pencil className="size-3.5" />
                              编辑
                            </a>
                          </Button>
                          <form method="post">
                            <input type="hidden" name="operation" value="clone" />
                            <input type="hidden" name="pid" value={docId} />
                            <Button type="submit" variant="ghost" size="sm">
                              <Copy className="size-3.5" />
                              克隆
                            </Button>
                          </form>
                          {!pdoc.archivedAt ? (
                            <form
                              method="post"
                              onSubmit={(event) => {
                                if (!window.confirm(`归档题目「${pdoc.title || displayPid}」？归档后将强制隐藏。`)) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="operation" value="archive" />
                              <input type="hidden" name="pid" value={docId} />
                              <input type="hidden" name="reason" value="Archived from problem bank" />
                              <Button type="submit" variant="ghost" size="sm">
                                <Archive className="size-3.5" />
                                归档
                              </Button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Pagination current={page} total={ppcount} baseUrl={problemsBaseUrl} />
    </main>
  );
}
