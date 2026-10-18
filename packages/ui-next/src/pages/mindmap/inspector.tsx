import { ArrowLeftRight, ExternalLink, Link2, LockKeyhole, Plus, Save, Trash2, Unlink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DomainUserMultiSelect, loadDomainUsersByIds, type DomainUserOption } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { loadNodeProblems, mindmapProblemHref, searchMindmapProblems } from './api';
import { resolveRootBranchSides } from './layout';
import { SwitchRow } from '../teach/settings-kit';
import { mergeMindmapTagDraft } from './tree';
import type { MindmapNode, PanelProblem, ProblemOption } from './types';

const TEACHER_HINT = '负责教师可以编辑这门课下面的知识点，不能改课程节点本身';
const COLLECTED_HINT = '收录题：把不是挂在这个知识点上的题也算进来';
const PUBLIC_DESCRIPTION = '出现在公开导图页';
const HIDDEN_DESCRIPTION = '只有管理员和负责教师能在导图页看到；老师组卷时仍能用';

export interface CourseNodeSettingsDraft {
  visibility: 'public' | 'hidden';
  ownerUids: number[];
}

const COLOR_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'gray', label: '中性灰' },
  { value: 'sky', label: '天空蓝' },
  { value: 'blue', label: '深蓝' },
  { value: 'green', label: '绿色' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '玫红' },
  { value: 'purple', label: '紫色' },
];

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectedDocId(problem: { docId: number }): string | null {
  if (!Number.isSafeInteger(problem.docId) || problem.docId <= 0) return null;
  return String(problem.docId);
}

function useAnchorRect(anchor: HTMLElement | null, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active || !anchor) {
      setRect(null);
      return;
    }
    const update = () => setRect(anchor.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [active, anchor]);
  return rect;
}

/** Keep the floating list inside the viewport. A 120px floor overflows when the field sits near the bottom. */
function searchResultsFrame(rect: DOMRect): { top: number; maxHeight: number } {
  const gap = 4;
  const margin = 12;
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin);
  const spaceAbove = Math.max(0, rect.top - margin);
  const placeBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;
  const available = placeBelow ? spaceBelow : spaceAbove;
  const maxHeight = Math.min(256, available);
  const top = placeBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - maxHeight);
  return { top, maxHeight };
}

function ProblemSearchResults({
  anchor,
  open,
  searching,
  searchError,
  searchResults,
  problemIds,
  onPick,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  searching: boolean;
  searchError: string | null;
  searchResults: ProblemOption[];
  problemIds: string[];
  onPick: (problem: ProblemOption) => void;
}) {
  const rect = useAnchorRect(anchor, open);
  if (!open || !rect || typeof document === 'undefined') return null;
  const frame = searchResultsFrame(rect);
  return createPortal(
    <div
      data-mindmap-problem-search="results"
      className="z-50 overflow-auto rounded-lg border border-line bg-surface-raised p-1 text-sm shadow-pop"
      style={{
        position: 'fixed',
        left: rect.left,
        top: frame.top,
        width: rect.width,
        maxHeight: frame.maxHeight,
      }}
    >
      {searchError ? <p className="px-3 py-3 text-xs text-danger-fg">{searchError}</p> : null}
      {!searching && !searchError && !searchResults.length ? <p className="px-3 py-3 text-xs text-fg-subtle">没有匹配题目</p> : null}
      {searchResults.map((problem) => {
        const docId = collectedDocId(problem);
        return (
        <Button
          key={problem.docId}
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal"
          disabled={docId === null || problemIds.includes(docId)}
          onClick={() => onPick(problem)}
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-fg">{problem.title}</span>
            <span className="font-mono text-2xs text-fg-subtle">{problem.pid}</span>
          </span>
          {problem.hidden ? (
            <Badge variant="outline" size="sm">
              隐藏
            </Badge>
          ) : null}
        </Button>
        );
      })}
    </div>,
    document.body,
  );
}

function canonicalOwnerUids(ids: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('负责教师必须是正整数');
    unique.add(id);
  }
  if (unique.size > 50) throw new Error('负责教师最多 50 人');
  return [...unique].sort((left, right) => left - right);
}

function CourseNodeSettings({
  node,
  busy,
  onSave,
  onDirtyChange,
}: {
  node: MindmapNode;
  busy: boolean;
  onSave: (node: MindmapNode, settings: CourseNodeSettingsDraft) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const domainId = useBootstrap().domain.id;
  const serverPublic = node.courseVisibility !== 'hidden';
  const serverOwners = node.ownerUids ?? [];
  const [coursePublic, setCoursePublic] = useState(serverPublic);
  const [ownerUids, setOwnerUids] = useState<number[]>(() => [...serverOwners]);
  const courseDirty = coursePublic !== serverPublic || !sameNumbers(ownerUids, serverOwners);
  const courseDirtyRef = useRef(courseDirty);
  courseDirtyRef.current = courseDirty;
  const seenCourseVersion = useRef(node.updatedAt);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idsKey = ownerUids.join(',');
  const [loaded, setLoaded] = useState<{ key: string; users: DomainUserOption[] } | null>(null);
  const users = loaded?.key === idsKey ? loaded.users : ownerUids.map((id) => ({ _id: id }));

  useEffect(() => {
    const ids = idsKey === '' ? [] : idsKey.split(',').map((part) => Number(part));
    if (ids.length === 0) return undefined;
    let cancelled = false;
    loadDomainUsersByIds(domainId, ids)
      .then((found) => {
        if (cancelled) return;
        const byId = new Map(found.map((user) => [user._id, user]));
        setLoaded({ key: idsKey, users: ids.map((id) => byId.get(id) ?? { _id: id }) });
        setLookupError(null);
      })
      .catch((error: unknown) => {
        console.error('mindmap course owner lookup failed', { domainId, error });
        if (cancelled) return;
        setLookupError(error instanceof Error ? error.message : '负责教师加载失败');
        setLoaded({ key: idsKey, users: ids.map((id) => ({ _id: id })) });
      });
    return () => {
      cancelled = true;
    };
  }, [domainId, idsKey]);

  useEffect(() => {
    if (seenCourseVersion.current === node.updatedAt) return;
    seenCourseVersion.current = node.updatedAt;
    if (courseDirtyRef.current) return;
    setCoursePublic(node.courseVisibility !== 'hidden');
    setOwnerUids(node.ownerUids ? [...node.ownerUids] : []);
  }, [node.courseVisibility, node.ownerUids, node.updatedAt]);

  useEffect(() => {
    onDirtyChange(courseDirty);
    return () => onDirtyChange(false);
  }, [courseDirty, onDirtyChange]);

  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const nextOwners = canonicalOwnerUids(ownerUids);
      await onSave(node, {
        visibility: coursePublic ? 'public' : 'hidden',
        ownerUids: nextOwners,
      });
      toast.success('已保存课程节点设置');
    } catch (error) {
      console.error('mindmap course node settings failed', error);
      setSaveError(error instanceof Error ? error.message : '课程节点设置保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">课程节点</h3>
      <SwitchRow
        id={`course-public-${node._id}`}
        label="对学生公开"
        description={coursePublic ? PUBLIC_DESCRIPTION : HIDDEN_DESCRIPTION}
        checked={coursePublic}
        disabled={busy || saving}
        onCheckedChange={setCoursePublic}
      />
      <FormField label="负责教师" hint={TEACHER_HINT}>
        <DomainUserMultiSelect
          domainId={domainId}
          value={users}
          disabled={busy || saving}
          maxItems={50}
          onChange={(next) => setOwnerUids(next.map((user) => user._id))}
        />
      </FormField>
      {lookupError ? <Alert tone="danger">{lookupError}</Alert> : null}
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <div>
        <Button type="button" variant="secondary" size="sm" disabled={busy || saving} loading={saving} onClick={() => void save()}>
          保存课程节点设置
        </Button>
      </div>
    </section>
  );
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
  onSaveCourseSettings,
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
  onSaveCourseSettings: (node: MindmapNode, settings: CourseNodeSettingsDraft) => Promise<void>;
  onMoveSide: (node: MindmapNode, side: 'left' | 'right') => void;
  onCreateChild: (node: MindmapNode) => void;
  onCreateSibling: (node: MindmapNode) => void;
  onDelete: (node: MindmapNode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (!node) {
    return (
      <section className="grid h-full min-h-0 place-items-center px-8 text-center">
        <EmptyState compact icon={<Link2 />} title="选择节点开始编辑" description="节点字段在这里保存；结构调整从左侧大纲完成。" />
      </section>
    );
  }
  return (
    <NodeInspectorForm
      key={node._id}
      mapId={mapId}
      node={node}
      nodes={nodes}
      rootId={rootId}
      layoutDirection={layoutDirection}
      referenceCount={referenceCount}
      busy={busy}
      onSave={onSave}
      onSaveCourseSettings={onSaveCourseSettings}
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
  onSaveCourseSettings,
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
  onSaveCourseSettings: (node: MindmapNode, settings: CourseNodeSettingsDraft) => Promise<void>;
  onMoveSide: (node: MindmapNode, side: 'left' | 'right') => void;
  onCreateChild: (node: MindmapNode) => void;
  onCreateSibling: (node: MindmapNode) => void;
  onDelete: (node: MindmapNode) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [topic, setTopic] = useState(node.topic);
  const [description, setDescription] = useState(node.description || '');
  const [color, setColor] = useState(node.color || '');
  const [tags, setTags] = useState(node.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [problemIds, setProblemIds] = useState(node.problemIds);
  const [problemOptions, setProblemOptions] = useState<Map<string, ProblemOption>>(new Map());
  const [associations, setAssociations] = useState<PanelProblem[]>([]);
  const [associationLoading, setAssociationLoading] = useState(false);
  const [associationError, setAssociationError] = useState<string | null>(null);
  const [courseDirty, setCourseDirty] = useState(false);
  const [problemQuery, setProblemQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProblemOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAnchor, setSearchAnchor] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAssociationLoading(true);
    setAssociationError(null);
    void loadNodeProblems(mapId, node._id, true)
      .then((problems) => {
        if (cancelled) return;
        setAssociations(problems);
        setProblemOptions((current) => {
          const next = new Map(current);
          for (const problem of problems) {
            if (!problem.sources.includes('manual')) continue;
            const docId = collectedDocId(problem);
            if (!docId) continue;
            next.set(docId, {
              domainId: problem.domainId,
              docId: problem.docId,
              pid: problem.pid,
              title: problem.title,
              hidden: problem.hidden,
            });
          }
          return next;
        });
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
  const isRoot = node._id === rootId;
  const submittedTopic = topic.trim();
  const submittedDescription = description.trim();
  const nodeFieldsDirty =
    submittedTopic !== node.topic ||
    (!isRoot && (
      submittedDescription !== (node.description || '') ||
      color !== (node.color || '') ||
      !sameStrings(effectiveTags, node.tags) ||
      !sameStrings(problemIds, node.problemIds)
    ));
  const dirty =
    nodeFieldsDirty ||
    topic !== node.topic ||
    (!isRoot && description !== (node.description || '')) ||
    courseDirty;
  const nodeFieldsDirtyRef = useRef(nodeFieldsDirty);
  nodeFieldsDirtyRef.current = nodeFieldsDirty;
  const seenNodeVersion = useRef(node.updatedAt);
  useEffect(() => {
    if (seenNodeVersion.current === node.updatedAt) return;
    seenNodeVersion.current = node.updatedAt;
    if (nodeFieldsDirtyRef.current) return;
    setTopic(node.topic);
    setDescription(node.description || '');
    setColor(node.color || '');
    setTags(node.tags);
    setTagDraft('');
    setProblemIds(node.problemIds);
  }, [node.color, node.description, node.problemIds, node.tags, node.topic, node.updatedAt]);
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
    const docId = collectedDocId(problem);
    if (!docId) return;
    setProblemIds((current) => (current.includes(docId) ? current : [...current, docId]));
    setProblemOptions((current) => new Map(current).set(docId, problem));
    setProblemQuery('');
    setSearchResults([]);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium text-fg-subtle">节点检查器</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-fg">{node.topic}</h2>
          </div>
          {dirty ? (
            <Badge variant="soft" tone="warning" className="shrink-0">
              未保存
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              已同步
            </Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => onCreateChild(node)} disabled={busy}>
            <Plus /> 子节点
          </Button>
          {node.parentId ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onCreateSibling(node)} disabled={busy}>
              <Plus /> 同级
            </Button>
          ) : null}
          {node._id !== rootId ? (
            <Button type="button" size="sm" variant="danger-soft" onClick={() => onDelete(node)} disabled={busy}>
              <Trash2 /> 删除
            </Button>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 border-t border-line-subtle">
        <div className="flex flex-col gap-6 p-4">
          <div className="flex flex-col gap-5">
            <FormField label="名称" htmlFor="mindmap-topic">
              <Input id="mindmap-topic" value={topic} maxLength={100} onChange={(event) => setTopic(event.target.value)} />
            </FormField>
            {isRoot ? null : (
              <>
            <FormField label="说明" htmlFor="mindmap-description">
              <Textarea
                id="mindmap-description"
                value={description}
                maxLength={2000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充这个知识点的范围或学习目标"
              />
            </FormField>
            <FormField label="颜色" htmlFor="mindmap-color">
              <SimpleSelect
                id="mindmap-color"
                value={color}
                onValueChange={setColor}
                options={COLOR_OPTIONS}
                contentClassName="[&_[role=option]]:min-h-10"
              />
            </FormField>
              </>
            )}
          </div>

          {!isRoot && layoutDirection === 'RIGHT' && isRootBranch ? (
            <div className="rounded-md bg-surface-sunken p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-fg">
                <ArrowLeftRight className="size-3.5 text-fg-subtle" /> 根分支方向
              </div>
              <p className="mt-1 text-xs text-fg-subtle">只决定相对左右；节点绝对位置始终由结构自动计算。</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={rootSide === 'left' ? 'soft' : 'secondary'}
                  size="sm"
                  disabled={busy || rootSide === 'left'}
                  onClick={() => onMoveSide(node, 'left')}
                >
                  左侧
                </Button>
                <Button
                  type="button"
                  variant={rootSide === 'right' ? 'soft' : 'secondary'}
                  size="sm"
                  disabled={busy || rootSide === 'right'}
                  onClick={() => onMoveSide(node, 'right')}
                >
                  右侧
                </Button>
              </div>
            </div>
          ) : null}

          {isRoot ? null : <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mindmap-tag" className="text-sm font-medium text-fg">
                标签
              </label>
              {referenceCount > 0 ? (
                <Badge variant="outline" size="sm">
                  <LockKeyhole className="size-3" /> {referenceCount} 道题引用
                </Badge>
              ) : null}
            </div>
            {referenceCount > 0 ? (
              <Alert tone="warning">该节点已进入题目标签链。名称、说明和颜色仍可修改；标签需通过独立迁移流程变更。</Alert>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="soft" tone="neutral" className="pr-0">
                  {tag}
                  {referenceCount === 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => setTags((current) => current.filter((value) => value !== tag))}
                      aria-label={`移除标签 ${tag}`}
                    >
                      <X />
                    </Button>
                  ) : null}
                </Badge>
              ))}
              {!tags.length ? <span className="text-xs text-fg-subtle">暂无标签</span> : null}
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
                />
                <Button type="button" variant="secondary" iconOnly onClick={addTag} disabled={!tagDraft.trim()} aria-label="添加标签">
                  <Plus />
                </Button>
              </div>
            ) : null}
          </div>}

          {isRoot ? null : <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">收录题</h3>
              <p className="mt-1 text-xs text-fg-subtle">{COLLECTED_HINT}</p>
            </div>
            <div ref={setSearchAnchor}>
              <SearchInput
                value={problemQuery}
                onChange={(event) => setProblemQuery(event.target.value)}
                placeholder="搜索 PID 或标题"
                trailing={searching ? <Spinner /> : undefined}
              />
              <ProblemSearchResults
                anchor={searchAnchor}
                open={!!problemQuery.trim()}
                searching={searching}
                searchError={searchError}
                searchResults={searchResults}
                problemIds={problemIds}
                onPick={addProblem}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              {problemIds.map((docId) => {
                const problem = problemOptions.get(docId);
                const pidLabel = problem?.pid || docId;
                return (
                  <div key={docId} className="flex min-h-12 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                    <Link2 className="size-4 shrink-0 text-brand-fg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">{problem?.title || docId}</span>
                      <span className="font-mono text-2xs text-fg-subtle">{pidLabel}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => setProblemIds((current) => current.filter((value) => value !== docId))}
                      aria-label={`移除收录题 ${pidLabel}`}
                    >
                      <Unlink />
                    </Button>
                  </div>
                );
              })}
              {!problemIds.length ? (
                <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">暂无收录题</p>
              ) : null}
            </div>
          </div>}

          {isRoot ? null : <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">当前知识归类</h3>
              <span className="text-xs text-fg-subtle tabular">{canonicallyMatched.length} 道</span>
            </div>
            {associationLoading ? <p className="py-3 text-xs text-fg-subtle">正在读取关联…</p> : null}
            {associationError ? <Alert tone="danger">{associationError}</Alert> : null}
            {!associationLoading && !associationError && canonicallyMatched.length ? (
              <div className="flex flex-col gap-1.5">
                {canonicallyMatched.slice(0, 40).map((problem) => (
                  <a
                    key={problem.docId}
                    href={mindmapProblemHref(problem)}
                    className="flex min-h-10 items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">{problem.title}</span>
                      <span className="font-mono text-2xs text-fg-subtle">{problem.pid}</span>
                    </span>
                    <div className="flex gap-1">
                      <Badge variant="outline" size="sm">
                        知识节点
                      </Badge>
                      {problem.sources.includes('manual') ? (
                        <Badge variant="outline" size="sm">
                          手动
                        </Badge>
                      ) : null}
                    </div>
                    <ExternalLink className="size-3 text-fg-subtle" />
                  </a>
                ))}
                {canonicallyMatched.length > 40 ? (
                  <p className="px-2 text-2xs text-fg-subtle">仅显示前 40 道，公开页面仍按完整关联查询。</p>
                ) : null}
              </div>
            ) : null}
            {!associationLoading && !associationError && !canonicallyMatched.length ? (
              <p className="text-xs text-fg-subtle">当前节点及其子节点尚无归类题目</p>
            ) : null}
          </div>}

          {!isRoot && rootId !== null && node.parentId === rootId ? (
            node.courseVisibility && node.ownerUids ? (
              <CourseNodeSettings node={node} busy={busy} onSave={onSaveCourseSettings} onDirtyChange={setCourseDirty} />
            ) : (
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-fg">课程节点</h3>
                <Alert tone="danger">这门课的公开状态或负责教师缺失，无法保存设置。</Alert>
              </section>
            )
          ) : null}

          {node._id !== rootId ? (
            <Alert
              tone="danger"
              title="危险操作"
              action={
                <Button type="button" size="sm" variant="danger-soft" disabled={busy} onClick={() => onDelete(node)}>
                  <Trash2 /> 删除节点
                </Button>
              }
            >
              只允许删除无子节点、无题目引用的叶子。
            </Alert>
          ) : null}
        </div>
      </ScrollArea>

      <footer className="border-t border-line-subtle bg-surface-sunken p-3">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={busy || !dirty || !topic.trim()}
          onClick={() =>
            onSave(
              node,
              isRoot
                ? { topic: submittedTopic }
                : {
                    topic: submittedTopic,
                    description: submittedDescription,
                    color,
                    ...(referenceCount === 0 ? { tags: effectiveTags } : {}),
                    problemIds,
                  },
            )
          }
        >
          {busy ? <Spinner /> : <Save />}
          保存节点
        </Button>
      </footer>
    </section>
  );
}
