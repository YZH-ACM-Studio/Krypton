/** Public, read-only algorithm mindmap. Editing lives only at /admin/mindmap. */
import { ReactFlowProvider } from '@xyflow/react';
import { Network, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar, Workspace } from '@/components/ui/page';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Difficulty } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { loadNodeProblems, mindmapProblemHref, MindmapApiError } from './api';
import { MindmapCanvas } from './canvas';
import type { KnowledgeMap, MindmapNode, PanelProblem } from './types';

/** Complement of the `lg` sidebar (`min-width: 1024px`), including fractional widths in between. */
const PUBLIC_DESKTOP_QUERY = '(min-width: 1024px)';

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

function NodeSummary({ selected, compact }: { selected: MindmapNode; compact?: boolean }) {
  return (
    <>
      {compact ? null : <p className="text-2xs font-medium text-fg-subtle">知识节点</p>}
      {compact ? null : <h2 className="mt-1 truncate text-lg font-semibold text-fg">{selected.topic}</h2>}
      {selected.description ? <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{selected.description}</p> : null}
      {selected.tags.length ? (
        <div className={cn('flex flex-wrap gap-1.5', selected.description || !compact ? 'mt-3' : 'mt-1')}>
          {selected.tags.map((tag) => (
            <Badge key={tag} variant="outline" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ProblemFilters({
  query,
  sort,
  onQueryChange,
  onSortChange,
}: {
  query: string;
  sort: 'pid' | 'difficulty' | 'accept';
  onQueryChange: (value: string) => void;
  onSortChange: (value: 'pid' | 'difficulty' | 'accept') => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索题号或标题" size="sm" />
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
  );
}

function ProblemResults({
  problems,
  visibleProblems,
  loading,
  problemError,
}: {
  problems: PanelProblem[];
  visibleProblems: PanelProblem[];
  loading: boolean;
  problemError: string | null;
}) {
  return (
    <>
      {loading ? <p className="py-10 text-center text-sm text-fg-muted">正在加载…</p> : null}
      {!loading && problemError ? <p className="px-4 py-10 text-center text-sm text-danger-fg">{problemError}</p> : null}
      {!loading && !problemError && !visibleProblems.length ? (
        <p className="py-10 text-center text-sm text-fg-muted">{problems.length ? '没有匹配题目' : '此节点暂无关联题目'}</p>
      ) : null}
      {!loading && !problemError ? (
        <ul className="divide-y divide-line-subtle">
          {visibleProblems.map((problem) => (
            <li key={`${problem.domainId}:${problem.docId}`}>
              <a href={mindmapProblemHref(problem)} className="flex min-h-12 items-center gap-2 px-4 py-3 hover:bg-surface-hover">
                <Difficulty level={problem.difficulty} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{problem.title}</span>
                  <span className="block font-mono text-2xs text-fg-subtle">
                    {problem.pid} · <span className="tabular">{problem.nAccept}/{problem.nSubmit}</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
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
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-b border-line-subtle px-4 py-4">
        {selected ? (
          <NodeSummary selected={selected} />
        ) : (
          <EmptyState compact icon={<Sparkles />} title="选择一个节点查看相关题目" />
        )}
      </header>
      {selected ? (
        <>
          <div className="shrink-0 border-b border-line-subtle p-3">
            <ProblemFilters query={query} sort={sort} onQueryChange={onQueryChange} onSortChange={onSortChange} />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ProblemResults problems={problems} visibleProblems={visibleProblems} loading={loading} problemError={problemError} />
          </ScrollArea>
        </>
      ) : null}
    </div>
  );
}

export function MindmapPage() {
  const bootstrap = useBootstrap();
  const data = bootstrap.page.data as { nodes: MindmapNode[]; config: KnowledgeMap | null; maps: KnowledgeMap[] };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problems, setProblems] = useState<PanelProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'pid' | 'difficulty' | 'accept'>('pid');
  const selected = selectedId ? data.nodes.find((node) => node._id === selectedId) || null : null;
  const currentMapId = data.config?._id || null;

  useEffect(() => {
    setQuery('');
    if (!selectedId || !currentMapId) {
      setProblems([]);
      setProblemError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setProblemError(null);
    void loadNodeProblems(currentMapId, selectedId, false)
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
  }, [currentMapId, selectedId]);

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
  const compact = !useMatchMedia(PUBLIC_DESKTOP_QUERY);

  if (!data.config) {
    return (
      <Workspace className="flex w-full min-w-0 overflow-hidden">
        <EmptyState className="my-auto" icon={<Network />} title="暂无公开知识导图" description="管理员发布导图后会在这里显示。" />
      </Workspace>
    );
  }

  const config = data.config;

  return (
    <ReactFlowProvider>
      <Workspace className="flex w-full min-w-0 overflow-hidden">
        <Toolbar
          className="h-10 shrink-0 flex-nowrap border-b border-line bg-surface px-2"
          end={
            <SimpleSelect
              value={config._id}
              onValueChange={(mapId) => window.location.assign(`/mindmap?map=${encodeURIComponent(mapId)}`)}
              options={data.maps.map((map) => ({
                value: map._id,
                label: map.isDefault ? `${map.title}（默认）` : map.title,
              }))}
              ariaLabel="切换知识导图"
              size="sm"
              className="w-32 shrink-0 sm:w-48 xl:w-56"
              contentClassName="[&_[role=option]]:min-h-10"
            />
          }
        >
          <span className="min-w-0 truncate text-sm font-semibold text-fg">{config.title}</span>
          <span className="hidden text-xs text-fg-subtle tabular sm:inline">{data.nodes.length} 个知识节点</span>
        </Toolbar>
        <div className="flex min-h-0 min-w-0 flex-1">
          <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <MindmapCanvas nodes={data.nodes} config={config} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          <aside className="hidden min-h-0 w-80 shrink-0 flex-col border-l border-line bg-surface lg:flex">
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
        <Sheet
          open={!!selected && compact}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
        >
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{selected?.topic || '相关题目'}</SheetTitle>
              {selected ? <NodeSummary selected={selected} compact /> : null}
            </SheetHeader>
            <div className="shrink-0 border-b border-line-subtle p-3">
              <ProblemFilters query={query} sort={sort} onQueryChange={setQuery} onSortChange={setSort} />
            </div>
            <SheetBody>
              <ProblemResults problems={problems} visibleProblems={visibleProblems} loading={loading} problemError={problemError} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Workspace>
    </ReactFlowProvider>
  );
}
