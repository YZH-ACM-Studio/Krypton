import { ArrowRight, ChevronDown, Loader2, Tag } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

export interface KnowledgeMindmapOption {
  id: string;
  mapId: string;
  mapTitle: string;
  label: string;
  tags: string[];
  invalid?: boolean;
}

export interface KnowledgeMapOption {
  id: string;
  title: string;
  visibility: 'hidden' | 'public';
}

export interface StructuredProblemMetadataDocument {
  difficulty?: string | number;
  docId?: string | number;
  hidden?: boolean;
  knowledgeMapId?: unknown;
  knowledgeNodeIds?: unknown[];
  pid?: string | number;
  title?: string;
}

export interface StructuredProblemMetadataState {
  title: string;
  selectedKnowledgeCount: number;
  hasInvalidKnowledge: boolean;
}

interface StructuredProblemMetadataPanelProps {
  pdoc: StructuredProblemMetadataDocument;
  isCreate: boolean;
  locked: boolean;
  knowledgeMaps: KnowledgeMapOption[];
  mindmapOptions: KnowledgeMindmapOption[];
  canUseCustomPid: boolean;
  formDirty: boolean;
  onMetadataChange: () => void;
  onMetadataStateChange?: (state: StructuredProblemMetadataState) => void;
  layout?: 'sidebar' | 'inline';
  visibilityLockedReason?: string;
  children?: ReactNode;
}

interface KnowledgeTagPreview {
  knowledgeMapId: string;
  knowledgeMapTitle: string;
  selectedNodeIds: string[];
  retainedTags: string[];
  addedTags: string[];
  removedTags: string[];
  fingerprint: string;
}

const DIFFICULTY_OPTIONS = [
  { value: '0', label: '未评定' },
  { value: '1', label: '入门' },
  { value: '2', label: '普及−' },
  { value: '3', label: '普及/提高−' },
  { value: '4', label: '普及+/提高' },
  { value: '5', label: '提高+/省选−' },
  { value: '6', label: '省选/NOI−' },
  { value: '7', label: '省选/NOI' },
  { value: '8', label: 'NOI/NOI+' },
  { value: '9', label: 'NOI+/CTSC' },
  { value: '10', label: 'CTSC/IOI' },
];

function objectIdString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const objectId = (value as { $oid?: unknown }).$oid;
    if (typeof objectId === 'string') return objectId;
  }
  return String(value || '');
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function StructuredProblemMetadataPanel({
  pdoc,
  isCreate,
  locked,
  knowledgeMaps,
  mindmapOptions,
  canUseCustomPid,
  formDirty,
  onMetadataChange,
  onMetadataStateChange,
  layout = 'sidebar',
  visibilityLockedReason,
  children,
}: StructuredProblemMetadataPanelProps) {
  const initialKnowledgeMapId = objectIdString(pdoc.knowledgeMapId || (knowledgeMaps.length === 1 ? knowledgeMaps[0].id : ''));
  const initialKnowledgeNodeIds = useMemo(
    () => (Array.isArray(pdoc.knowledgeNodeIds) ? pdoc.knowledgeNodeIds : []).map(objectIdString).filter(Boolean),
    [pdoc.knowledgeNodeIds],
  );
  const [knowledgeMapId, setKnowledgeMapId] = useState(initialKnowledgeMapId);
  const scopedMindmapOptions = mindmapOptions.filter((option) => option.mapId === knowledgeMapId);
  const initialKnowledge = useMemo(() => {
    const byId = new Map(mindmapOptions.map((option) => [option.id, option]));
    return initialKnowledgeNodeIds.map(
      (id): KnowledgeMindmapOption =>
        byId.get(id) || {
          id,
          mapId: initialKnowledgeMapId,
          mapTitle: knowledgeMaps.find((map) => map.id === initialKnowledgeMapId)?.title || '未知导图',
          label: `已失效的知识节点 · ${id}`,
          tags: [],
          invalid: true,
        },
    );
  }, [initialKnowledgeMapId, initialKnowledgeNodeIds, knowledgeMaps, mindmapOptions]);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeMindmapOption[]>(initialKnowledge);
  const [switchMapId, setSwitchMapId] = useState('');
  const [switchKnowledge, setSwitchKnowledge] = useState<KnowledgeMindmapOption[]>([]);
  const [switchPreview, setSwitchPreview] = useState<KnowledgeTagPreview | null>(null);
  const [switchPreviewOpen, setSwitchPreviewOpen] = useState(false);
  const [switchState, setSwitchState] = useState<'idle' | 'previewing' | 'applying' | 'error'>('idle');
  const [switchError, setSwitchError] = useState('');
  const [title, setTitle] = useState(String(pdoc.title || ''));
  const [titleTouched, setTitleTouched] = useState(false);
  const hasInvalidKnowledge = selectedKnowledge.some((option) => option.invalid);
  const displayPid = typeof pdoc.pid === 'string' ? pdoc.pid : pdoc.docId ? `P${pdoc.docId}` : '';
  const persistedMapTitle = knowledgeMaps.find((map) => map.id === knowledgeMapId)?.title || '所属导图不可用';
  const switchMindmapOptions = mindmapOptions.filter((option) => option.mapId === switchMapId);
  const problemUrl = `/p/${encodeURIComponent(String(pdoc.docId || pdoc.pid || ''))}`;
  const knowledgeSelectionChanged =
    knowledgeMapId !== initialKnowledgeMapId ||
    !sameStringSet(
      selectedKnowledge.map((option) => option.id),
      initialKnowledgeNodeIds,
    );
  const submitKnowledgeFields = isCreate || knowledgeSelectionChanged;

  useEffect(() => {
    onMetadataStateChange?.({
      title,
      selectedKnowledgeCount: selectedKnowledge.filter((option) => !option.invalid).length,
      hasInvalidKnowledge,
    });
  }, [hasInvalidKnowledge, onMetadataStateChange, selectedKnowledge, title]);

  const requestMapSwitchPreview = async () => {
    setSwitchError('');
    if (formDirty) {
      setSwitchError('请先保存或撤销当前表单修改，再单独更换所属导图。');
      setSwitchState('error');
      return;
    }
    if (!switchMapId || !switchKnowledge.length) {
      setSwitchError('请选择新导图和至少一个知识节点。');
      setSwitchState('error');
      return;
    }
    setSwitchState('previewing');
    try {
      const response = await fetchHydroResponse(`${problemUrl}/tags/preview`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          knowledgeMapId: switchMapId,
          knowledgeNodeIds: switchKnowledge.map((option) => option.id).join(','),
        }),
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, response.status === 409 ? '题目或导图已变化，请刷新后重试' : '导图切换预览失败'));
      }
      const preview = (await response.json())?.preview as KnowledgeTagPreview | undefined;
      if (
        !preview ||
        typeof preview.knowledgeMapId !== 'string' ||
        typeof preview.knowledgeMapTitle !== 'string' ||
        typeof preview.fingerprint !== 'string' ||
        !Array.isArray(preview.selectedNodeIds) ||
        !Array.isArray(preview.retainedTags) ||
        !Array.isArray(preview.addedTags) ||
        !Array.isArray(preview.removedTags)
      ) {
        throw new Error('导图切换预览响应格式错误');
      }
      setSwitchPreview(preview);
      setSwitchPreviewOpen(true);
      setSwitchState('idle');
    } catch (error) {
      console.error('Failed to preview structured problem knowledge map switch', error);
      setSwitchError(error instanceof Error ? error.message : '导图切换预览失败');
      setSwitchState('error');
    }
  };

  const confirmMapSwitch = async () => {
    if (!switchPreview) return;
    setSwitchError('');
    setSwitchState('applying');
    try {
      const response = await fetchHydroResponse(`${problemUrl}/tags/apply`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          knowledgeMapId: switchPreview.knowledgeMapId,
          knowledgeNodeIds: switchPreview.selectedNodeIds.join(','),
          intent: 'normalize',
          confirmed: 'true',
          previewFingerprint: switchPreview.fingerprint,
        }),
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, response.status === 409 ? '预览已过期，请重新预览' : '更换所属导图失败'));
      }
      const body = await response.json();
      if (body?.ok !== true || body?.programmingTagState?.knowledgeMapId !== switchPreview.knowledgeMapId) {
        throw new Error('更换所属导图响应格式错误');
      }
      window.location.reload();
    } catch (error) {
      console.error('Failed to apply structured problem knowledge map switch', error);
      setSwitchPreviewOpen(false);
      setSwitchPreview(null);
      setSwitchError(error instanceof Error ? error.message : '更换所属导图失败');
      setSwitchState('error');
    }
  };

  return (
    <aside className={cn('space-y-5', layout === 'sidebar' && 'lg:border-l lg:border-border/70 lg:pl-5')} aria-label="题目元数据">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">标题</span>
        <Input
          name="title"
          value={title}
          required
          pattern=".*\S.*"
          aria-invalid={titleTouched && !title.trim() ? true : undefined}
          onBlur={(event) => setTitleTouched(!event.currentTarget.value.trim())}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setTitle(next);
            event.currentTarget.setCustomValidity(next.trim() ? '' : '请输入题目标题');
            if (titleTouched && next.trim()) setTitleTouched(false);
          }}
          onInvalid={(event) => {
            event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? '' : '请输入题目标题');
            setTitleTouched(true);
          }}
          className="min-h-11"
        />
        {titleTouched ? (
          <span role="alert" className="text-xs text-destructive">
            标题不能为空。
          </span>
        ) : null}
      </label>

      <section className="space-y-1.5" aria-labelledby="structured-pid-label">
        <span id="structured-pid-label" className="text-xs font-medium">
          题目编号
        </span>
        {canUseCustomPid ? (
          <details className="group border-y border-border/70 py-2">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-xs text-muted-foreground">
              <span>{isCreate ? '自动分配；管理员可展开自定义' : displayPid || '自动编号'}</span>
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <Input
              name="pid"
              defaultValue={typeof pdoc.pid === 'string' ? pdoc.pid : ''}
              placeholder="留空自动分配，如 P1001"
              pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
              disabled={locked}
              className="mt-2 min-h-11"
            />
          </details>
        ) : (
          <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">
            {isCreate ? '保存时由系统自动分配' : displayPid || '系统自动编号'}
          </p>
        )}
      </section>

      <section className="space-y-1.5" role="group" aria-labelledby="structured-knowledge-label">
        <span id="structured-knowledge-label" className="flex items-center gap-1 text-xs font-medium">
          <Tag className="size-3.5" aria-hidden="true" />
          知识标签
        </span>
        {isCreate ? (
          <SimpleSelect
            name="knowledgeMapId"
            value={knowledgeMapId}
            onValueChange={(next) => {
              if (next === knowledgeMapId) return;
              setKnowledgeMapId(next);
              setSelectedKnowledge([]);
              onMetadataChange();
            }}
            options={[
              ...(knowledgeMaps.length > 1 ? [{ value: '', label: '请选择所属导图' }] : []),
              ...knowledgeMaps.map((map) => ({ value: map.id, label: map.title })),
            ]}
            ariaLabel="所属知识导图"
          />
        ) : (
          <>
            {submitKnowledgeFields ? <input type="hidden" name="knowledgeMapId" value={knowledgeMapId} /> : null}
            <p className="border-y border-border/70 py-3 text-sm font-medium">{persistedMapTitle}</p>
          </>
        )}
        <MultiSelect<KnowledgeMindmapOption>
          options={scopedMindmapOptions}
          value={selectedKnowledge}
          onChange={(next) => {
            setSelectedKnowledge(next);
            onMetadataChange();
          }}
          getKey={(option) => option.id}
          getLabel={(option) => option.label}
          getDescription={(option) => (option.invalid ? '节点已失效，请移除并重新选择' : option.tags.join(' / '))}
          renderChip={(option) => <span className={option.invalid ? 'text-destructive' : undefined}>{option.label}</span>}
          name={submitKnowledgeFields ? 'knowledgeNodeIds' : undefined}
          placeholder="从知识导图选择，可多选"
          emptyText="没有匹配的知识节点"
          disabled={!knowledgeMapId}
          minHeight={44}
        />
        <p className="text-xs text-muted-foreground">保存时由服务端重新物化所选节点及其带标签祖先；不接受自由标签。</p>
        {hasInvalidKnowledge ? (
          <p role="alert" className="text-xs text-destructive">
            原选择中有已删除或不可选的节点；请移除并重新选择后再保存。
          </p>
        ) : null}
        {!isCreate && knowledgeMaps.some((map) => map.id !== knowledgeMapId) ? (
          <div className="mt-4 space-y-3 border-t border-border/70 pt-4">
            <div>
              <p className="text-xs font-medium">更换所属导图</p>
              <p className="mt-1 text-xs text-muted-foreground">这是独立的原子操作；会先展示保留、新增和删除标签，再要求确认。</p>
            </div>
            <SimpleSelect
              value={switchMapId}
              onValueChange={(next) => {
                setSwitchMapId(next);
                setSwitchKnowledge([]);
                setSwitchPreview(null);
                setSwitchError('');
                setSwitchState('idle');
              }}
              options={[
                { value: '', label: '选择新的所属导图' },
                ...knowledgeMaps.filter((map) => map.id !== knowledgeMapId).map((map) => ({ value: map.id, label: map.title })),
              ]}
              disabled={switchState === 'previewing' || switchState === 'applying'}
            />
            <MultiSelect<KnowledgeMindmapOption>
              options={switchMindmapOptions}
              value={switchKnowledge}
              onChange={(next) => {
                setSwitchKnowledge(next);
                setSwitchPreview(null);
                setSwitchError('');
                setSwitchState('idle');
              }}
              getKey={(option) => option.id}
              getLabel={(option) => option.label}
              getDescription={(option) => option.tags.join(' / ')}
              placeholder="选择新导图内的知识节点"
              emptyText="没有匹配的知识节点"
              disabled={!switchMapId || switchState === 'previewing' || switchState === 'applying'}
              minHeight={44}
            />
            {formDirty ? <p className="text-xs text-amber-700 dark:text-amber-300">当前表单有未保存修改，请先保存或撤销后再切换导图。</p> : null}
            {switchError ? (
              <p role="alert" className="text-xs text-destructive">
                {switchError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestMapSwitchPreview}
              disabled={formDirty || !switchMapId || !switchKnowledge.length || switchState === 'previewing' || switchState === 'applying'}
            >
              {switchState === 'previewing' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
              预览导图切换
            </Button>
          </div>
        ) : null}
      </section>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium">难度</span>
        <SimpleSelect
          name="difficulty"
          defaultValue={String(pdoc.difficulty || 0)}
          options={DIFFICULTY_OPTIONS}
          onValueChange={onMetadataChange}
          ariaLabel="题目难度"
        />
      </label>

      {isCreate ? (
        <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">新题首次保存固定为隐藏，检查完成后再发布。</p>
      ) : visibilityLockedReason ? (
        <div className="space-y-1 border-y border-border/70 py-2">
          <input type="hidden" name="hidden" value="true" />
          <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked disabled />
            <span>隐藏题目</span>
          </label>
          <p className="text-xs text-muted-foreground">{visibilityLockedReason}</p>
        </div>
      ) : (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 border-y border-border/70 py-2 text-sm">
          <Checkbox name="hidden" defaultChecked={!!pdoc.hidden} />
          <span>隐藏题目</span>
        </label>
      )}
      {locked ? (
        <p className="border-y border-amber-300 py-3 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-200">
          题目结构已锁定；本侧元数据仍可保存，但题号不可修改。
        </p>
      ) : null}
      {children}
      <Dialog
        open={switchPreviewOpen}
        onOpenChange={(open) => {
          if (switchState === 'applying') return;
          setSwitchPreviewOpen(open);
          if (!open) setSwitchPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>确认更换所属导图</DialogTitle>
          </DialogHeader>
          {switchPreview ? (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                确认后，服务端会用当前题目与实时导图重新校验，并一次写入新导图、节点引用和派生标签。
              </p>
              <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-xs text-muted-foreground">当前所属导图</p>
                  <p className="mt-1 font-medium">{persistedMapTitle}</p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">确认后所属导图</p>
                  <p className="mt-1 font-medium">{switchPreview.knowledgeMapTitle}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '保留', tags: switchPreview.retainedTags, tone: 'border-border/70' },
                  { label: '新增', tags: switchPreview.addedTags, tone: 'border-emerald-500/30 bg-emerald-500/[0.035]' },
                  { label: '删除', tags: switchPreview.removedTags, tone: 'border-destructive/30 bg-destructive/[0.025]' },
                ].map((group) => (
                  <div key={group.label} className={`rounded-xl border px-4 py-3 ${group.tone}`}>
                    <p className="text-xs font-semibold">{group.label}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {group.tags.length ? (
                        group.tags.map((tag, index) => (
                          <Badge key={`${group.label}:${tag}:${index}`} variant={group.label === '删除' ? 'destructive' : 'secondary'}>
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">无</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={switchState === 'applying'}
                  onClick={() => {
                    setSwitchPreviewOpen(false);
                    setSwitchPreview(null);
                  }}
                >
                  取消
                </Button>
                <Button type="button" disabled={switchState === 'applying'} onClick={confirmMapSwitch}>
                  {switchState === 'applying' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                  确认并更换导图
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
