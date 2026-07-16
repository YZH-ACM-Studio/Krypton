/** Public, read-only algorithm mindmap. Editing lives only at /admin/mindmap. */
import { ReactFlowProvider } from '@xyflow/react';
import { Network, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { loadNodeProblems, mindmapProblemHref, MindmapApiError } from './api';
import { MindmapCanvas } from './canvas';
import type { MindmapConfig, MindmapNode, PanelProblem } from './types';

function difficultyStyle(value: number): string {
  if (value <= 1) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
  if (value <= 2) return 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200';
  if (value <= 3) return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200';
  if (value <= 4) return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  if (value <= 5) return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200';
  return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200';
}

function ProblemPanel({
  selected,
  problems,
  visibleProblems,
  loading,
  problemError,
  query,
  sort,
  onQueryChange,
  onSortChange,
  onClose,
}: {
  selected: MindmapNode | null;
  problems: PanelProblem[];
  visibleProblems: PanelProblem[];
  loading: boolean;
  problemError: string | null;
  query: string;
  sort: 'pid' | 'difficulty' | 'accept';
  onQueryChange: (value: string) => void;
  onSortChange: (value: 'pid' | 'difficulty' | 'accept') => void;
  onClose?: () => void;
}) {
  return (
    <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-lg lg:shadow-sm">
      <header className="relative border-b px-4 py-4">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            aria-label="关闭相关题目"
          >
            <X className="size-4" />
          </button>
        ) : null}
        {selected ? (
          <>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">知识节点</p>
            <h2 className="mt-1 truncate pr-8 text-lg font-semibold tracking-tight">{selected.topic}</h2>
            {selected.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{selected.description}</p> : null}
            {selected.tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-5" />
            选择一个节点查看相关题目
          </div>
        )}
      </header>
      {selected ? (
        <>
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索题号或标题" className="h-9 pl-8" />
            </div>
            <MiniTabs
              size="sm"
              value={sort}
              onValueChange={(value) => onSortChange(value as typeof sort)}
              items={[
                { value: 'pid', label: '题号' },
                { value: 'difficulty', label: '难度' },
                { value: 'accept', label: '通过数' },
              ]}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {loading ? <p className="py-10 text-center text-sm text-muted-foreground">正在加载…</p> : null}
            {!loading && problemError ? <p className="px-5 py-10 text-center text-sm text-destructive">{problemError}</p> : null}
            {!loading && !problemError && !visibleProblems.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{problems.length ? '没有匹配题目' : '此节点暂无关联题目'}</p>
            ) : null}
            {!loading && !problemError ? (
              <ul className="divide-y">
                {visibleProblems.map((problem) => (
                  <li key={`${problem.domainId}:${problem.docId}`}>
                    <a href={mindmapProblemHref(problem)} className="flex items-center gap-2.5 px-4 py-3 hover:bg-accent/50">
                      <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', difficultyStyle(problem.difficulty))}>
                        {problem.difficulty}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{problem.title}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {problem.pid} · {problem.nAccept}/{problem.nSubmit}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </ScrollArea>
        </>
      ) : null}
    </Card>
  );
}

export function MindmapPage() {
  const bootstrap = useBootstrap();
  const data = bootstrap.page.data as { nodes: MindmapNode[]; config: MindmapConfig };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problems, setProblems] = useState<PanelProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'pid' | 'difficulty' | 'accept'>('pid');
  const selected = selectedId ? data.nodes.find((node) => node._id === selectedId) || null : null;

  useEffect(() => {
    setQuery('');
    if (!selectedId) {
      setProblems([]);
      setProblemError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setProblemError(null);
    void loadNodeProblems(selectedId, false)
      .then((items) => {
        if (!cancelled) setProblems(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setProblems([]);
        setProblemError(
          error instanceof MindmapApiError && error.status === 403 ? '你没有浏览题库关联信息的权限' : error.message || '关联题目加载失败',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const visibleProblems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let result = normalized
      ? problems.filter((problem) => problem.pid.toLowerCase().includes(normalized) || problem.title.toLowerCase().includes(normalized))
      : problems;
    if (sort === 'difficulty') result = [...result].sort((left, right) => left.difficulty - right.difficulty);
    else if (sort === 'accept') result = [...result].sort((left, right) => right.nAccept - left.nAccept);
    else result = [...result].sort((left, right) => left.pid.localeCompare(right.pid, 'zh-CN', { numeric: true }));
    return result;
  }, [problems, query, sort]);

  return (
    <ReactFlowProvider>
      <div className="flex h-[calc(100dvh-6rem)] min-h-[34rem] gap-3">
        <section className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border bg-background shadow-sm">
          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Network className="size-4" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">{data.config.title}</h1>
                <p className="text-xs text-muted-foreground">{data.nodes.length} 个知识节点</p>
              </div>
            </div>
          </header>
          <div className="h-full pt-14">
            <MindmapCanvas nodes={data.nodes} config={data.config} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          {selected ? (
            <div className="absolute inset-x-3 bottom-3 top-[42%] z-20 flex lg:hidden">
              <ProblemPanel
                selected={selected}
                problems={problems}
                visibleProblems={visibleProblems}
                loading={loading}
                problemError={problemError}
                query={query}
                sort={sort}
                onQueryChange={setQuery}
                onSortChange={setSort}
                onClose={() => setSelectedId(null)}
              />
            </div>
          ) : null}
        </section>

        <aside className="hidden w-[22rem] shrink-0 lg:flex">
          <ProblemPanel
            selected={selected}
            problems={problems}
            visibleProblems={visibleProblems}
            loading={loading}
            problemError={problemError}
            query={query}
            sort={sort}
            onQueryChange={setQuery}
            onSortChange={setSort}
          />
        </aside>
      </div>
    </ReactFlowProvider>
  );
}
