/** Public, read-only algorithm mindmap. Editing lives only at /admin/mindmap. */
import { ReactFlowProvider } from '@xyflow/react';
import { Network, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { PageHeader, Toolbar, Workspace } from '@/components/ui/page';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Difficulty } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { loadNodeProblems, mindmapProblemHref, MindmapApiError } from './api';
import { initialCollapsedNodes, MindmapCanvas } from './canvas';
import { readMindmapSnapshot, type KnowledgeMap, type MindmapNode, type PanelProblem } from './types';

/** Complement of the `lg` sidebar (`min-width: 1024px`), including fractional widths in between. */
const PUBLIC_DESKTOP_QUERY = '(min-width: 1024px)';
const HIDDEN_COURSE_HINT = '仅你可见';

interface PublicCourseNode {
  id: string;
  title: string;
  order: number;
  visibility: 'public' | 'hidden';
  ownerUids: number[];
}

interface PublicMindmapPageData {
  config: KnowledgeMap;
  /** null when the server has not selected a course (no public course, or the field is empty). */
  course: string | null;
  courses: PublicCourseNode[];
  nodes: MindmapNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPublicCourse(value: unknown): PublicCourseNode {
  if (!isRecord(value)) throw new Error('课程节点格式无效');
  const { id, title, order, visibility, ownerUids } = value;
  if (typeof id !== 'string' || id.length === 0) throw new Error('课程节点格式无效');
  if (typeof title !== 'string' || title.length === 0) throw new Error('课程节点格式无效');
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error('课程节点格式无效');
  if (visibility !== 'public' && visibility !== 'hidden') throw new Error('课程节点格式无效');
  if (!Array.isArray(ownerUids)) throw new Error('课程节点格式无效');
  const owners: number[] = [];
  for (const uid of ownerUids) {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) throw new Error('课程节点格式无效');
    owners.push(uid);
  }
  return { id, title, order, visibility, ownerUids: owners };
}

/** G5 public page: one map, the visible course nodes, and the selected subtree. */
function readPublicMindmapPage(value: unknown): PublicMindmapPageData {
  if (!isRecord(value)) throw new Error('公开导图页数据格式无效');
  const snapshot = readMindmapSnapshot({
    nodes: value.nodes,
    config: value.config,
    referenceCounts: {},
  });
  if (!snapshot.config) throw new Error('公开导图页数据格式无效');
  if (!Array.isArray(value.courses)) throw new Error('公开导图页数据格式无效');
  const courses = value.courses.map(readPublicCourse);
  const seen = new Set<string>();
  for (const course of courses) {
    if (seen.has(course.id)) throw new Error('公开导图页数据格式无效');
    seen.add(course.id);
  }
  const course = readSelectedCourse(value.course, seen);
  return {
    config: snapshot.config,
    course,
    courses,
    nodes: snapshot.nodes,
  };
}

/** null and '' mean nothing is selected. A string must name a visible course. Anything else is invalid. */
function readSelectedCourse(value: unknown, courseIds: ReadonlySet<string>): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !courseIds.has(value)) throw new Error('公开导图页数据格式无效');
  return value;
}

function coursePageHref(courseId: string): string {
  return `/mindmap?course=${encodeURIComponent(courseId)}`;
}

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
  const data = readPublicMindmapPage(bootstrap.page.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problems, setProblems] = useState<PanelProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'pid' | 'difficulty' | 'accept'>('pid');
  const [collapsed, setCollapsed] = useState(() => {
    const next = initialCollapsedNodes(data.nodes, data.config.rootNodeId);
    if (data.course) next.delete(data.course);
    return next;
  });
  const selected = selectedId ? data.nodes.find((node) => node._id === selectedId) || null : null;
  const currentMapId = data.config._id;

  useEffect(() => {
    setQuery('');
    if (!selectedId || !currentMapId || selectedId === data.config.rootNodeId) {
      setProblems([]);
      setProblemError(null);
      setLoading(false);
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
  }, [currentMapId, data.config.rootNodeId, selectedId]);

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

  if (data.courses.length === 0) {
    return (
      <Workspace className="flex w-full min-w-0 overflow-hidden">
        <EmptyState className="my-auto" icon={<Network />} title="还没有公开的知识图谱" description="管理员公开课程后会在这里显示。" />
      </Workspace>
    );
  }

  const config = data.config;

  return (
    <ReactFlowProvider>
      <Workspace className="flex w-full min-w-0 overflow-hidden">
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          <PageHeader title={config.title} />
        </div>
        <Toolbar className="h-10 shrink-0 flex-nowrap border-b border-line bg-surface px-2">
          <SimpleSelect
            {...(data.course === null ? {} : { value: data.course })}
            onValueChange={(courseId) => window.location.assign(coursePageHref(courseId))}
            options={data.courses.map((course) => ({
              value: course.id,
              label: course.title,
              hint: course.visibility === 'hidden' ? HIDDEN_COURSE_HINT : undefined,
            }))}
            placeholder="选择课程"
            ariaLabel="课程"
            size="sm"
            className="w-56 shrink-0"
            contentClassName="[&_[role=option]]:min-h-10"
          />
          <span className="hidden text-xs text-fg-subtle tabular sm:inline">{data.nodes.length} 个知识节点</span>
        </Toolbar>
        <div className="flex min-h-0 min-w-0 flex-1">
          <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <MindmapCanvas
              nodes={data.nodes}
              config={config}
              selectedId={selectedId}
              onSelect={setSelectedId}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
            />
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
