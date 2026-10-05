import { ArrowRight, ChevronDown, Tag } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/display';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { DIFFICULTY_LEVELS } from '@/components/ui/verdict';
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
  const [hiddenValue, setHiddenValue] = useState(!!pdoc.hidden);
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
    <aside className={cn('min-w-0 space-y-5', layout === 'sidebar' && 'lg:border-l lg:border-line lg:pl-5')} aria-label="题目元数据">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">标题</span>
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
        />
        {titleTouched ? (
          <span role="alert" className="text-xs text-danger-fg">
            标题不能为空。
          </span>
        ) : null}
      </label>

      <section className="space-y-1.5" aria-labelledby="structured-pid-label">
        <span id="structured-pid-label" className="text-sm font-medium text-fg">
          题目编号
        </span>
        {canUseCustomPid ? (
          <details className="group border-y border-line-subtle py-2">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-xs text-fg-subtle">
              <span className="min-w-0 break-words">{isCreate ? '自动分配；管理员可展开自定义' : displayPid || '自动编号'}</span>
              <ChevronDown className="size-3.5 shrink-0 text-fg-subtle transition-transform duration-(--dur-2) ease-(--ease-out) group-open:rotate-180" aria-hidden="true" />
            </summary>
            <Input
              name="pid"
              defaultValue={typeof pdoc.pid === 'string' ? pdoc.pid : ''}
              placeholder="留空自动分配，如 P1001"
              pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
              disabled={locked}
              className="mt-2"
            />
          </details>
        ) : (
          <p className="border-y border-line-subtle py-3 text-xs text-fg-subtle">
            {isCreate ? '保存时由系统自动分配' : displayPid || '系统自动编号'}
          </p>
        )}
      </section>

      <section className="min-w-0 space-y-1.5" role="group" aria-labelledby="structured-knowledge-label">
        <span id="structured-knowledge-label" className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <Tag className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          知识标签
        </span>
        {isCreate ? (
          <SimpleSelect
            className="w-full min-w-0 [&>span]:min-w-0"
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
            <p className="min-w-0 break-words border-y border-line-subtle py-3 text-sm font-medium text-fg">{persistedMapTitle}</p>
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
          renderChip={(option) => <span className={option.invalid ? 'min-w-0 break-words text-danger-fg' : 'min-w-0 break-words'}>{option.label}</span>}
          name={submitKnowledgeFields ? 'knowledgeNodeIds' : undefined}
          placeholder="从知识导图选择，可多选"
          emptyText="没有匹配的知识节点"
          disabled={!knowledgeMapId}
        />
        <p className="text-xs text-fg-subtle">保存时由服务端重新物化所选节点及其带标签祖先；不接受自由标签。</p>
        {hasInvalidKnowledge ? (
          <p role="alert" className="text-xs text-danger-fg">
            原选择中有已删除或不可选的节点；请移除并重新选择后再保存。
          </p>
        ) : null}
        {!isCreate && knowledgeMaps.some((map) => map.id !== knowledgeMapId) ? (
          <div className="mt-4 min-w-0 space-y-3 border-t border-line-subtle pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">更换所属导图</p>
              <p className="mt-1 text-xs text-fg-subtle">这是独立的原子操作；会先展示保留、新增和删除标签，再要求确认。</p>
            </div>
            <SimpleSelect
              className="w-full min-w-0 [&>span]:min-w-0"
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
            />
            {formDirty ? <Alert tone="warning">当前表单有未保存修改，请先保存或撤销后再切换导图。</Alert> : null}
            {switchError ? (
              <p role="alert" className="min-w-0 break-words text-xs text-danger-fg">
                {switchError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={requestMapSwitchPreview}
              disabled={formDirty || !switchMapId || !switchKnowledge.length || switchState === 'previewing' || switchState === 'applying'}
            >
              {switchState === 'previewing' ? <Spinner className="size-3.5" /> : null}
              预览导图切换
            </Button>
          </div>
        ) : null}
      </section>

      <label className="block min-w-0 space-y-1.5">
        <span className="text-sm font-medium text-fg">难度</span>
        <SimpleSelect
          className="w-full min-w-0 [&>span]:min-w-0"
          name="difficulty"
          defaultValue={String(pdoc.difficulty || 0)}
          options={DIFFICULTY_LEVELS.map((d) => ({ value: String(d.value), label: d.label }))}
          onValueChange={onMetadataChange}
          ariaLabel="题目难度"
        />
      </label>

      {isCreate ? (
        <Alert tone="neutral">新题首次保存固定为隐藏，检查完成后再发布。</Alert>
      ) : visibilityLockedReason ? (
        <div className="space-y-2 border-y border-line-subtle py-2">
          <input type="hidden" name="hidden" value="true" />
          <label className="flex min-h-10 items-center gap-2 text-sm text-fg-disabled">
            <Switch checked disabled />
            <span>隐藏题目</span>
          </label>
          <Alert tone="neutral">{visibilityLockedReason}</Alert>
        </div>
      ) : (
        <label className="flex min-h-10 cursor-pointer items-center gap-2 border-y border-line-subtle py-2 text-sm text-fg">
          <input type="hidden" name="hidden" value={hiddenValue ? 'true' : 'false'} />
          <Switch
            checked={hiddenValue}
            aria-label="隐藏题目"
            onCheckedChange={(checked) => {
              setHiddenValue(checked);
              onMetadataChange();
            }}
          />
          <span>隐藏题目</span>
        </label>
      )}
      {locked ? (
        <Alert tone="warning">题目结构已锁定；本侧元数据仍可保存，但题号不可修改。</Alert>
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
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>确认更换所属导图</DialogTitle>
          </DialogHeader>
          {switchPreview ? (
            <DialogBody className="space-y-5">
              <p className="text-sm text-fg-muted">
                确认后，服务端会用当前题目与实时导图重新校验，并一次写入新导图、节点引用和派生标签。
              </p>
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-fg-subtle">当前所属导图</p>
                  <p className="mt-1 min-w-0 break-words font-medium text-fg">{persistedMapTitle}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-fg-subtle">确认后所属导图</p>
                  <p className="mt-1 min-w-0 break-words font-medium text-fg">{switchPreview.knowledgeMapTitle}</p>
                </div>
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-3">
                {[
                  { label: '保留', tags: switchPreview.retainedTags, tone: 'neutral' as const },
                  { label: '新增', tags: switchPreview.addedTags, tone: 'neutral' as const },
                  { label: '删除', tags: switchPreview.removedTags, tone: 'danger' as const },
                ].map((group) => (
                  <div key={group.label} className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface-sunken px-4 py-3">
                    <p className="text-xs font-semibold text-fg">{group.label}</p>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                      {group.tags.length ? (
                        group.tags.map((tag, index) => (
                          <Badge
                            key={`${group.label}:${tag}:${index}`}
                            variant="soft"
                            tone={group.tone}
                            className="inline-block h-auto max-w-full min-w-0 shrink whitespace-normal break-words py-0.5 text-left"
                          >
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-fg-subtle">无</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </DialogBody>
          ) : null}
          {switchPreview ? (
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={switchState === 'applying'}
                onClick={() => {
                  setSwitchPreviewOpen(false);
                  setSwitchPreview(null);
                }}
              >
                取消
              </Button>
              <Button type="button" variant="primary" disabled={switchState === 'applying'} onClick={confirmMapSwitch}>
                {switchState === 'applying' ? <Spinner /> : null}
                确认并更换导图
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
