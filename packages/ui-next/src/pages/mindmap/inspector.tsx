import { ArrowLeftRight, ExternalLink, Link2, Loader2, LockKeyhole, Plus, Save, Search, Trash2, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { loadNodeProblems, mindmapProblemHref, searchMindmapProblems } from './api';
import { resolveRootBranchSides } from './layout';
import { mergeMindmapTagDraft } from './tree';
import type { MindmapNode, PanelProblem, ProblemOption } from './types';

const COLOR_OPTIONS = [
  { value: 'gray', label: '中性灰' },
  { value: 'sky', label: '天空蓝' },
  { value: 'blue', label: '深蓝' },
  { value: 'green', label: '绿色' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '玫红' },
  { value: 'purple', label: '紫色' },
];

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function MindmapInspector({
  mapId,
  node,
  nodes,
  rootId,
  layoutDirection,
  referenceCount,
  busy,
  onSave,
  onMoveSide,
  onCreateChild,
  onCreateSibling,
  onDelete,
  onDirtyChange,
}: {
  mapId: string;
  node: MindmapNode | null;
  nodes: MindmapNode[];
  rootId: string | null;
  layoutDirection: 'RIGHT' | 'DOWN';
  referenceCount: number;
  busy: boolean;
  onSave: (node: MindmapNode, fields: Record<string, unknown>) => Promise<void>;
  onMoveSide: (node: MindmapNode, side: 'left' | 'right') => void;
  onCreateChild: (node: MindmapNode) => void;
  onCreateSibling: (node: MindmapNode) => void;
  onDelete: (node: MindmapNode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (!node) {
    return (
      <section className="grid h-full min-h-0 place-items-center bg-transparent px-8 text-center">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Link2 className="size-5" />
          </span>
          <h2 className="mt-3 text-sm font-semibold">选择节点开始编辑</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">节点字段在这里保存；结构调整从左侧大纲完成。</p>
        </div>
      </section>
    );
  }
  return (
    <NodeInspectorForm
      key={`${node._id}:${node.updatedAt}`}
      mapId={mapId}
      node={node}
      nodes={nodes}
      rootId={rootId}
      layoutDirection={layoutDirection}
      referenceCount={referenceCount}
      busy={busy}
      onSave={onSave}
      onMoveSide={onMoveSide}
      onCreateChild={onCreateChild}
      onCreateSibling={onCreateSibling}
      onDelete={onDelete}
      onDirtyChange={onDirtyChange}
    />
  );
}

function NodeInspectorForm({
  mapId,
  node,
  nodes,
  rootId,
  layoutDirection,
  referenceCount,
  busy,
  onSave,
  onMoveSide,
  onCreateChild,
  onCreateSibling,
  onDelete,
  onDirtyChange,
}: {
  mapId: string;
  node: MindmapNode;
  nodes: MindmapNode[];
  rootId: string | null;
  layoutDirection: 'RIGHT' | 'DOWN';
  referenceCount: number;
  busy: boolean;
  onSave: (node: MindmapNode, fields: Record<string, unknown>) => Promise<void>;
  onMoveSide: (node: MindmapNode, side: 'left' | 'right') => void;
  onCreateChild: (node: MindmapNode) => void;
  onCreateSibling: (node: MindmapNode) => void;
  onDelete: (node: MindmapNode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [topic, setTopic] = useState(node.topic);
  const [description, setDescription] = useState(node.description || '');
  const [color, setColor] = useState(node.color || 'gray');
  const [tags, setTags] = useState(node.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [problemIds, setProblemIds] = useState(node.problemIds);
  const [problemOptions, setProblemOptions] = useState<Map<string, ProblemOption>>(new Map());
  const [associations, setAssociations] = useState<PanelProblem[]>([]);
  const [associationLoading, setAssociationLoading] = useState(false);
  const [associationError, setAssociationError] = useState<string | null>(null);
  const [problemQuery, setProblemQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProblemOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAssociationLoading(true);
    setAssociationError(null);
    void loadNodeProblems(mapId, node._id, true)
      .then((problems) => {
        if (cancelled) return;
        setAssociations(problems);
        setProblemOptions(
          new Map(
            problems
              .filter((problem) => problem.sources.includes('manual'))
              .map((problem) => [
                problem.pid,
                { domainId: problem.domainId, docId: problem.docId, pid: problem.pid, title: problem.title, hidden: problem.hidden },
              ]),
          ),
        );
      })
      .catch((error) => {
        if (!cancelled) setAssociationError(error instanceof Error ? error.message : '关联题目加载失败');
      })
      .finally(() => {
        if (!cancelled) setAssociationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, node._id]);

  useEffect(() => {
    const query = problemQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void searchMindmapProblems(mapId, query, controller.signal)
        .then(setSearchResults)
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSearchResults([]);
          setSearchError(error instanceof Error ? error.message : '题目搜索失败');
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mapId, problemQuery]);

  const effectiveTags = mergeMindmapTagDraft(tags, tagDraft);
  const dirty =
    topic !== node.topic ||
    description !== (node.description || '') ||
    color !== (node.color || 'gray') ||
    !sameStrings(effectiveTags, node.tags) ||
    !sameStrings(problemIds, node.problemIds);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const rootSide = rootId ? resolveRootBranchSides(nodes, rootId).get(node._id) : undefined;
  const isRootBranch = node.parentId === rootId;
  const canonicallyMatched = associations.filter((problem) => problem.sources.includes('canonical'));

  const addTag = () => {
    if (referenceCount > 0) return;
    const next = mergeMindmapTagDraft(tags, tagDraft);
    setTags(next);
    setTagDraft('');
  };

  const addProblem = (problem: ProblemOption) => {
    setProblemIds((current) => (current.includes(problem.pid) ? current : [...current, problem.pid]));
    setProblemOptions((current) => new Map(current).set(problem.pid, problem));
    setProblemQuery('');
    setSearchResults([]);
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-transparent">
      <header className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">节点检查器</p>
            <h2 className="mt-1 truncate text-base font-semibold">{node.topic}</h2>
          </div>
          {dirty ? <Badge className="shrink-0">未保存</Badge> : <Badge variant="outline">已同步</Badge>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => onCreateChild(node)} disabled={busy}>
            <Plus className="size-3.5" /> 子节点
          </Button>
          {node.parentId ? (
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => onCreateSibling(node)} disabled={busy}>
              <Plus className="size-3.5" /> 同级
            </Button>
          ) : null}
          {node._id !== rootId ? (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-10 text-destructive hover:text-destructive"
              onClick={() => onDelete(node)}
              disabled={busy}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 border-t border-border/50">
        <div className="space-y-6 p-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="mindmap-topic" className="text-xs font-medium">
                名称
              </label>
              <Input id="mindmap-topic" value={topic} maxLength={100} onChange={(event) => setTopic(event.target.value)} className="mt-1.5 h-10" />
            </div>
            <div>
              <label htmlFor="mindmap-description" className="text-xs font-medium">
                说明
              </label>
              <Textarea
                id="mindmap-description"
                value={description}
                maxLength={2000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充这个知识点的范围或学习目标"
                className="mt-1.5 resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium">颜色</label>
              <SimpleSelect
                value={color}
                onValueChange={setColor}
                options={COLOR_OPTIONS}
                className="mt-1.5 min-h-10"
                contentClassName="[&_[role=option]]:min-h-10"
              />
            </div>
          </div>

          {layoutDirection === 'RIGHT' && isRootBranch ? (
            <div className="rounded-xl bg-muted/35 p-3 ring-1 ring-border/50">
              <div className="flex items-center gap-2 text-xs font-medium">
                <ArrowLeftRight className="size-3.5 text-muted-foreground" /> 根分支方向
              </div>
              <p className="mt-1 text-xs text-muted-foreground">只决定相对左右；节点绝对位置始终由结构自动计算。</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant={rootSide === 'left' ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-10"
                  disabled={busy || rootSide === 'left'}
                  onClick={() => onMoveSide(node, 'left')}
                >
                  左侧
                </Button>
                <Button
                  variant={rootSide === 'right' ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-10"
                  disabled={busy || rootSide === 'right'}
                  onClick={() => onMoveSide(node, 'right')}
                >
                  右侧
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mindmap-tag" className="text-xs font-medium">
                标签
              </label>
              {referenceCount > 0 ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <LockKeyhole className="size-3" /> {referenceCount} 道题引用
                </Badge>
              ) : null}
            </div>
            {referenceCount > 0 ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                该节点已进入题目标签链。名称、说明和颜色仍可修改；标签需通过独立迁移流程变更。
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="min-h-10 gap-1 pl-3 pr-0">
                  {tag}
                  {referenceCount === 0 ? (
                    <button
                      type="button"
                      onClick={() => setTags((current) => current.filter((value) => value !== tag))}
                      aria-label={`移除标签 ${tag}`}
                      className="grid size-10 place-items-center rounded-lg transition-[background-color,scale] duration-150 ease-out hover:bg-background/60 active:scale-[0.96] motion-reduce:transition-none"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </Badge>
              ))}
              {!tags.length ? <span className="text-xs text-muted-foreground">暂无标签</span> : null}
            </div>
            {referenceCount === 0 ? (
              <div className="flex gap-2">
                <Input
                  id="mindmap-tag"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="输入标签，回车添加"
                  className="h-10"
                />
                <Button
                  className="size-10"
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addTag}
                  disabled={!tagDraft.trim()}
                  aria-label="添加标签"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-medium">手动关联题目</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">按题号或标题搜索。移除关联不会删除题目，也不会修改题目标签。</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={problemQuery}
                onChange={(event) => setProblemQuery(event.target.value)}
                placeholder="搜索 PID 或标题"
                className="h-10 pl-8 pr-9"
              />
              {searching ? <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
              {problemQuery.trim() ? (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-auto rounded-xl border bg-popover p-1.5 shadow-xl">
                  {searchError ? <p className="px-3 py-3 text-xs text-destructive">{searchError}</p> : null}
                  {!searching && !searchError && !searchResults.length ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">没有匹配题目</p>
                  ) : null}
                  {searchResults.map((problem) => (
                    <button
                      key={problem.docId}
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.96] disabled:opacity-50 motion-reduce:transition-none"
                      disabled={problemIds.includes(problem.pid)}
                      onClick={() => addProblem(problem)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{problem.title}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{problem.pid}</span>
                      </span>
                      {problem.hidden ? <Badge variant="outline">隐藏</Badge> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {problemIds.map((pid) => {
                const problem = problemOptions.get(pid);
                return (
                  <div key={pid} className="flex min-h-11 items-center gap-2 rounded-lg bg-background px-3 py-2 ring-1 ring-border/50">
                    <Link2 className="size-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{problem?.title || pid}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{pid}</span>
                    </span>
                    <button
                      type="button"
                      className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out hover:bg-destructive/10 hover:text-destructive active:scale-[0.96] motion-reduce:transition-none"
                      onClick={() => setProblemIds((current) => current.filter((value) => value !== pid))}
                      aria-label={`移除手动关联 ${pid}`}
                    >
                      <Unlink className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              {!problemIds.length ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">暂无手动关联</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium">当前知识归类</h3>
              <span className="text-[11px] text-muted-foreground">{canonicallyMatched.length} 道</span>
            </div>
            {associationLoading ? <p className="py-3 text-xs text-muted-foreground">正在读取关联…</p> : null}
            {associationError ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{associationError}</p> : null}
            {!associationLoading && !associationError && canonicallyMatched.length ? (
              <div className="space-y-1.5">
                {canonicallyMatched.slice(0, 40).map((problem) => (
                  <a key={problem.docId} href={mindmapProblemHref(problem)} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{problem.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{problem.pid}</span>
                    </span>
                    <div className="flex gap-1">
                      <Badge variant="outline" className="text-[9px]">
                        知识节点
                      </Badge>
                      {problem.sources.includes('manual') ? (
                        <Badge variant="outline" className="text-[9px]">
                          手动
                        </Badge>
                      ) : null}
                    </div>
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </a>
                ))}
                {canonicallyMatched.length > 40 ? (
                  <p className="px-2 text-[11px] text-muted-foreground">仅显示前 40 道，公开页面仍按完整关联查询。</p>
                ) : null}
              </div>
            ) : null}
            {!associationLoading && !associationError && !canonicallyMatched.length ? (
              <p className="text-xs text-muted-foreground">当前节点及其子节点尚无归类题目</p>
            ) : null}
          </div>

          {node._id !== rootId ? (
            <div className="rounded-xl bg-destructive/5 p-3 ring-1 ring-destructive/20">
              <h3 className="text-xs font-medium text-destructive">危险操作</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">只允许删除无子节点、无题目引用的叶子。</p>
              <Button size="sm" variant="destructive" className="mt-3 min-h-10" disabled={busy} onClick={() => onDelete(node)}>
                <Trash2 className="size-3.5" /> 删除节点
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <footer className="border-t border-border/50 bg-card p-3">
        <Button
          className="min-h-10 w-full"
          disabled={busy || !dirty || !topic.trim()}
          onClick={() =>
            onSave(node, {
              topic,
              description,
              color,
              ...(referenceCount === 0 ? { tags: effectiveTags } : {}),
              problemIds,
            })
          }
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存节点
        </Button>
      </footer>
    </section>
  );
}
