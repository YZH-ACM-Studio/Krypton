import { ReactFlowProvider } from '@xyflow/react';
import { BookOpen, Network, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { mindmapProblemHref } from '../mindmap/api';
import { MindmapCanvas } from '../mindmap/canvas';
import type { MindmapNode } from '../mindmap/types';
import { problemsForCourseMindmapNode } from './mindmap-state';
import type { CourseMindmapData, CourseMindmapProblem } from './types';

export function courseMindmapProblemHref(tid: string, problem: CourseMindmapProblem, integrityControlled: boolean): string {
  const base = mindmapProblemHref(problem);
  if (!integrityControlled) return base;
  const chapter = problem.chapters[0];
  if (!chapter) throw new TypeError(`controlled course mindmap problem ${problem.docId} has no chapter scope`);
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
    <Card className="flex min-h-[16rem] min-w-0 flex-col overflow-hidden rounded-2xl shadow-sm lg:min-h-0">
      <header className="border-b px-4 py-4">
        {selected ? (
          <>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">课程知识节点</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{selected.topic}</h2>
            {selected.description ? <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p> : null}
          </>
        ) : (
          <div className="py-5 text-center text-sm text-pretty text-muted-foreground">
            <Network className="mx-auto mb-2 size-5" />
            选择一个节点，查看本课直接归属于它的题目
          </div>
        )}
      </header>
      {selected ? (
        <ScrollArea className="min-h-0 flex-1">
          {problems.length ? (
            <ul className="divide-y divide-border/70">
              {problems.map((problem) => (
                <li key={problem.docId} className="px-4 py-3">
                  <a
                    href={courseMindmapProblemHref(tid, problem, integrityControlled)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg py-1 transition-colors duration-200 hover:text-primary',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
                    )}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{problem.pid}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{problem.title}</span>
                  </a>
                  {problem.chapters.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {problem.chapters.map((chapter) => (
                        <a
                          key={chapter.id}
                          href={`/course/${encodeURIComponent(tid)}?chapter=${encodeURIComponent(String(chapter.id))}`}
                          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Badge variant="outline" className="font-normal">
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
            <p className="px-5 py-10 text-center text-sm text-pretty text-muted-foreground">
              本课程没有直接归属于该节点的可见题目。章节里仍可挂其它导图或尚未归类的题。
            </p>
          )}
        </ScrollArea>
      ) : null}
    </Card>
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
      <section className="grid min-h-[30rem] place-items-center rounded-2xl border border-dashed bg-muted/15 px-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Network className="size-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-balance">本课程尚未绑定知识导图</h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">课程内容不受影响。绑定一张公开导图后，这里会标出本课题目直接覆盖的节点。</p>
          {canManage ? (
            <Button asChild variant="outline" className="mt-5 min-h-11 gap-1.5">
              <a href={`/course/${encodeURIComponent(tid)}/edit#course-mindmap-settings`}>
                <Pencil className="size-4" />
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
      <section aria-label="课程知识导图" className="grid min-w-0 gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="relative h-[62dvh] min-h-[30rem] min-w-0 overflow-hidden rounded-2xl border bg-background shadow-sm lg:h-full">
          <header className="absolute inset-x-0 top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Network className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{data.config.title}</h2>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {data.usedNodeIds.length} 个直接使用节点 · {data.problems.length} 道可见题目
                </p>
              </div>
            </div>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <BookOpen className="size-3.5" />
              未使用节点已弱化
            </span>
          </header>
          <div className="h-full pt-16">
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
