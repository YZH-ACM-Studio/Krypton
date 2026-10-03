import { ReactFlowProvider } from '@xyflow/react';
import { ChevronRight, Network, Pencil, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { mindmapProblemHref } from '../mindmap/api';
import { MindmapCanvas } from '../mindmap/canvas';
import type { MindmapNode } from '../mindmap/types';
import { problemsForCourseMindmapNode } from './mindmap-state';
import type { CourseMindmapData, CourseMindmapProblem } from './types';

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

/** Panel's content wrapper has no class hook; the child selector lets the body fill the panel. */
const PANEL_FILL = 'flex min-h-0 min-w-0 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col';

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
    <Panel flush className={`${PANEL_FILL} lg:h-full`}>
      <header className="shrink-0 border-b border-line-subtle px-4 py-4">
        {selected ? (
          <>
            <p className="text-2xs font-semibold text-fg-subtle">课程知识节点</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg text-balance">{selected.topic}</h2>
            {selected.description ? <p className="mt-1.5 text-xs text-fg-subtle text-pretty">{selected.description}</p> : null}
          </>
        ) : (
          <div className="py-6 text-center">
            <span aria-hidden="true" className="mx-auto mb-2.5 grid size-10 place-items-center rounded-lg border border-line bg-surface-sunken text-fg-subtle">
              <Network className="size-4" strokeWidth={1.75} />
            </span>
            <p className="text-xs text-fg-subtle text-pretty">选择一个节点，查看本课直接归属于它的题目</p>
          </div>
        )}
      </header>
      {selected ? (
        <ScrollArea className="min-h-0 flex-1">
          {problems.length ? (
            <ul className="flex flex-col gap-0.5 p-1.5">
              {problems.map((problem) => (
                <li key={problem.docId}>
                  <a
                    href={courseMindmapProblemHref(tid, problem, integrityControlled)}
                    className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="shrink-0 font-mono text-2xs text-fg-subtle">{problem.pid}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {problem.title}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                  </a>
                  {problem.chapters.length ? (
                    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                      {problem.chapters.map((chapter) => (
                        <a
                          key={chapter.id}
                          href={`/course/${encodeURIComponent(tid)}?chapter=${encodeURIComponent(String(chapter.id))}`}
                          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <Badge variant="outline" size="sm">
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
            <p className="px-4 py-10 text-center text-xs text-fg-subtle text-pretty">
              本课程没有直接归属于该节点的可见题目。章节里仍可挂其它导图或尚未归类的题。
            </p>
          )}
        </ScrollArea>
      ) : null}
    </Panel>
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
      <Panel flush>
        <EmptyState
          icon={<Network />}
          title="本课程尚未绑定知识导图"
          description="课程内容不受影响。绑定公开导图或创建本课导图后，这里会显示本课的知识结构。"
          action={canManage ? (
            <Button asChild variant="secondary">
              <a href={`/course/${encodeURIComponent(tid)}/edit#course-mindmap-settings`}>
                <Pencil strokeWidth={1.75} />
                前往课程设置
              </a>
            </Button>
          ) : undefined}
        />
      </Panel>
    );
  }

  return (
    <ReactFlowProvider>
      {/* ds-allow DS004: 画布和题目栏的列宽只能写成 minmax 与 rem，间距档位表达不了这条轨道 */}
      <section aria-label="课程知识导图" className="grid min-h-0 min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel flush className={`${PANEL_FILL} h-96 lg:h-full`}>
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-fg">
                <Network className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold leading-5 text-fg">{data.config.title}</h2>
                <p className="text-xs text-fg-subtle tabular">
                  {data.usedNodeIds.length} 个直接使用节点 · {data.problems.length} 道可见题目
                </p>
              </div>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 text-xs text-fg-subtle sm:inline-flex">
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
        </Panel>
        <CourseProblemPanel tid={tid} selected={selected} problems={problems} integrityControlled={integrityControlled} />
      </section>
    </ReactFlowProvider>
  );
}
