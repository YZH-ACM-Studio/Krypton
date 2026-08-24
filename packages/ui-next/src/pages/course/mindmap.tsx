import { ReactFlowProvider } from '@xyflow/react';
import { ChevronRight, Network, Pencil, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { mindmapProblemHref } from '../mindmap/api';
import { MindmapCanvas } from '../mindmap/canvas';
import type { MindmapNode } from '../mindmap/types';
import { problemsForCourseMindmapNode } from './mindmap-state';
import type { CourseMindmapData, CourseMindmapProblem } from './types';
import { riseStyle } from './ui';

export function courseMindmapProblemHref(tid: string, problem: CourseMindmapProblem, _integrityControlled = false): string {
  const base = mindmapProblemHref(problem);
  const chapter = problem.chapters[0];
  if (!chapter) throw new TypeError(`course mindmap problem ${problem.docId} has no chapter scope`);
  return practiceProblemEntryUrl(base, {
    containerKind: 'course',
    containerId: tid,
    scopeKind: 'chapter',
    scopeId: chapter.id,
  });
}

function CourseProblemPanel({
  tid,
  selected,
  problems,
  integrityControlled,
}: {
  tid: string;
  selected: MindmapNode | null;
  problems: CourseMindmapProblem[];
  integrityControlled: boolean;
}) {
  return (
    <div className="krypton-course-panel flex min-h-[16rem] min-w-0 flex-col overflow-hidden lg:min-h-0">
      <header className="shrink-0 border-b border-border/50 px-4 py-4">
        {selected ? (
          <>
            <p className="krypton-course-eyebrow">课程知识节点</p>
            <h2 className="krypton-course-title mt-1">{selected.topic}</h2>
            {selected.description ? <p className="krypton-course-meta mt-1.5 text-pretty">{selected.description}</p> : null}
          </>
        ) : (
          <div className="py-6 text-center">
            <span aria-hidden="true" className="mx-auto mb-2.5 grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Network className="size-4" strokeWidth={1.75} />
            </span>
            <p className="krypton-course-meta text-pretty">选择一个节点，查看本课直接归属于它的题目</p>
          </div>
        )}
      </header>
      {selected ? (
        <ScrollArea className="min-h-0 flex-1">
          {problems.length ? (
            <ul className="space-y-0.5 p-1.5">
              {problems.map((problem, index) => (
                <li key={problem.docId} style={riseStyle(index, 35)} className="krypton-course-rise">
                  <a
                    href={courseMindmapProblemHref(tid, problem, integrityControlled)}
                    className={cn(
                      'krypton-course-row group flex min-h-11 items-center gap-2.5 px-2.5 py-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    )}
                  >
                    <span className="krypton-course-meta shrink-0 font-mono text-[11px]">{problem.pid}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium transition-colors duration-150 group-hover:text-primary motion-reduce:transition-none">
                      {problem.title}
                    </span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
                      strokeWidth={1.75}
                    />
                  </a>
                  {problem.chapters.length ? (
                    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                      {problem.chapters.map((chapter) => (
                        <a
                          key={chapter.id}
                          href={`/course/${encodeURIComponent(tid)}?chapter=${encodeURIComponent(String(chapter.id))}`}
                          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Badge variant="outline" className="rounded-md border-border/70 text-[10px] font-normal">
                            {chapter.title}
                          </Badge>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="krypton-course-meta px-5 py-10 text-center text-pretty">
              本课程没有直接归属于该节点的可见题目。章节里仍可挂其它导图或尚未归类的题。
            </p>
          )}
        </ScrollArea>
      ) : null}
    </div>
  );
}

export function CourseMindmapView({
  tid,
  data,
  canManage,
  integrityControlled,
}: {
  tid: string;
  data: CourseMindmapData | null;
  canManage: boolean;
  integrityControlled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const emphasizedIds = useMemo(() => new Set(data?.usedNodeIds || []), [data?.usedNodeIds]);
  const selected = selectedId ? data?.nodes.find((node) => node._id === selectedId) || null : null;
  const problems = useMemo(() => problemsForCourseMindmapNode(data?.problems || [], selectedId), [data?.problems, selectedId]);

  if (!data) {
    return (
      <section className="krypton-course-hero krypton-course-grain grid min-h-[30rem] place-items-center px-6 text-center">
        <div className="relative z-10 max-w-md">
          <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-2xl bg-background/80 text-muted-foreground shadow-sm">
            <Network className="size-6" strokeWidth={1.5} />
          </span>
          <h2 className="krypton-course-display mt-5">本课程尚未绑定知识导图</h2>
          <p className="krypton-course-meta mx-auto mt-2.5 max-w-sm text-pretty">
            课程内容不受影响。绑定一张公开导图后，这里会标出本课题目直接覆盖的节点。
          </p>
          {canManage ? (
            <Button asChild variant="outline" className="mt-6 min-h-11 gap-1.5">
              <a href={`/course/${encodeURIComponent(tid)}/edit#course-mindmap-settings`}>
                <Pencil className="size-4" strokeWidth={1.75} />
                前往课程设置
              </a>
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <ReactFlowProvider>
      <section aria-label="课程知识导图" className="grid min-w-0 gap-4 lg:h-[calc(100dvh-15rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* Flex column rather than an absolute header over a padded canvas —
            the old `absolute` + `pt-16` pair silently broke whenever the
            header wrapped to a second line. */}
        <div className="krypton-course-panel flex h-[62dvh] min-h-[30rem] min-w-0 flex-col overflow-hidden lg:h-full">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Network className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[13px] font-semibold leading-5">{data.config.title}</h2>
                <p className="krypton-course-meta">
                  {data.usedNodeIds.length} 个直接使用节点 · {data.problems.length} 道可见题目
                </p>
              </div>
            </div>
            <span className="krypton-course-meta hidden shrink-0 items-center gap-1.5 sm:inline-flex">
              <Sparkles className="size-3" strokeWidth={1.75} />
              未使用节点已弱化
            </span>
          </header>
          <div className="min-h-0 flex-1">
            <MindmapCanvas
              nodes={data.nodes}
              config={data.config}
              selectedId={selectedId}
              onSelect={setSelectedId}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              emphasizedIds={emphasizedIds}
            />
          </div>
        </div>
        <CourseProblemPanel tid={tid} selected={selected} problems={problems} integrityControlled={integrityControlled} />
      </section>
    </ReactFlowProvider>
  );
}
