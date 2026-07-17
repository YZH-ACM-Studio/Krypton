import { Loader2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { managedSourceFieldViews, type ManagedSourceTemplateOption } from '../lib/managed-problem-source';
import { readHydroResponseError } from '../lib/problem-save-response';
import type { ManagedTrainingOptionView } from './problem-authoring-state';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SimpleSelect } from './ui/select';

type R = Record<string, any>;

export interface ManagedReviewPreview {
  state: 'ready' | 'confirmed' | 'invalid';
  structureRevision?: number;
  tags: string[];
  selectedMindmapNodeIds: string[];
  message?: string;
}

export function ManagedProgrammingAuthorControl({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? children : null;
}

export function ManagedProgrammingTrainingControl({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? children : null;
}

export function ManagedPublishProtocolFields({
  docId,
  expectedStructureRevision,
}: {
  docId: number | string;
  expectedStructureRevision: number;
}) {
  const normalizedDocId = Number(docId);
  if (!Number.isSafeInteger(normalizedDocId) || normalizedDocId < 1) throw new Error('Managed publication requires a valid problem docId');
  if (!Number.isSafeInteger(expectedStructureRevision) || expectedStructureRevision < 1) {
    throw new Error('Managed publication requires an exact structure revision');
  }
  return (
    <>
      <input type="hidden" name="operation" value="managedPublish" />
      <input type="hidden" name="pid" value={String(normalizedDocId)} />
      <input type="hidden" name="expectedStructureRevision" value={String(expectedStructureRevision)} />
    </>
  );
}

export function ManagedKnowledgeSuggestionField({
  editable,
  metadataDraft,
  selectedNodeIds,
  children,
}: {
  editable: boolean;
  metadataDraft: boolean;
  selectedNodeIds: string[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">知识导图节点</p>
      {children}
      {editable ? <input type="hidden" name="knowledgeNodeIds" value={selectedNodeIds.join(',')} /> : null}
      <p className="text-[11px] leading-5 text-muted-foreground">
        {editable
          ? '可提交知识节点建议；服务端保存时会重新读取节点，正式标签仍只在管理员发布时派生。'
          : metadataDraft
            ? '当前角色只能查看创建时保存的节点引用，发布前由服务端重新物化。'
            : '节点已在审核发布时由服务端重新物化。'}
      </p>
    </div>
  );
}

export function ManagedReviewPanel({
  pdoc,
  sourceTemplates,
  trainingOptions,
  problemsUrl,
  difficultyOptions,
  reviewPreview,
}: {
  pdoc: R;
  sourceTemplates: ManagedSourceTemplateOption[];
  trainingOptions: ManagedTrainingOptionView[];
  problemsUrl: string;
  difficultyOptions: Array<{ value: string | number; label: string }>;
  reviewPreview?: ManagedReviewPreview;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const template = sourceTemplates.find((item) => item.id === pdoc.sourceMeta?.template);
  const sourceFields = managedSourceFieldViews(pdoc.sourceMeta, template);
  const pendingPlacement = pdoc.managedAuthoring?.pendingTrainingPlacement;
  const pendingTraining = trainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
  const pendingChapter = pendingTraining?.chapters.find((chapter) => chapter.id === pendingPlacement?.chapterId);
  const metadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft';
  const previewInvalid = metadataDraft && reviewPreview?.state !== 'ready';
  const previewMessage =
    metadataDraft && reviewPreview?.state === 'invalid'
      ? reviewPreview.message || '来源、知识节点或待挂训练预检失败'
      : metadataDraft && !reviewPreview
        ? '服务端未提供当前修订的审核预检结果，请刷新后重试。'
        : '';
  const finalTags = metadataDraft && reviewPreview?.state === 'ready' ? reviewPreview.tags : metadataDraft ? [] : pdoc.tag || [];
  const reviewHeading = metadataDraft ? '管理员审核与发布' : pdoc.hidden ? '重新公开托管题' : '发布状态';
  const reviewDescription = metadataDraft
    ? '确认正式标题、来源、标签和待挂训练后，通过既有统一发布服务公开题目。'
    : pdoc.hidden
      ? '该题已完成审核确认，但当前处于隐藏状态；重新公开不会再次消费待挂训练。'
      : '该题已完成审核确认；当前来源、标签和所属训练均为只读。';

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReviewError('');
    setReviewing(true);
    try {
      const response = await fetch(problemsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(event.currentTarget) as any),
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '审核发布失败'));
      const body = await response.json();
      if (typeof body?.url !== 'string' || !body.url) throw new Error('审核发布响应缺少跳转地址');
      window.location.assign(body.url);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '审核发布失败');
      setReviewing(false);
    }
  };

  return (
    <section aria-labelledby="managed-review-heading" className="rounded-2xl border border-primary/25 bg-primary/[0.025]">
      <header className="border-b border-primary/15 px-5 py-4">
        <h2 id="managed-review-heading" className="text-base font-semibold tracking-tight">
          {reviewHeading}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{reviewDescription}</p>
      </header>
      <div className="space-y-5 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{metadataDraft ? '工作标题' : '正式标题'}</dt>
            <dd className="mt-1 font-medium">{metadataDraft ? pdoc.managedAuthoring?.workingTitle || '—' : pdoc.title || '—'}</dd>
          </div>
          {sourceFields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="mt-1 font-medium">{field.value}</dd>
            </div>
          ))}
          {metadataDraft ? (
            <div>
              <dt className="text-xs text-muted-foreground">待挂训练</dt>
              <dd className="mt-1 font-medium">
                {pendingPlacement
                  ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                  : '不挂入训练'}
              </dd>
            </div>
          ) : null}
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">最终标签</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {finalTags.map((tag: string) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {!finalTags.length ? <span className="text-sm text-muted-foreground">尚未生成</span> : null}
          </div>
        </div>

        {previewMessage ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            审核预检失败：{previewMessage}
          </p>
        ) : null}

        {pdoc.hidden ? (
          <form
            method="post"
            action={problemsUrl}
            className="grid gap-4 border-t border-primary/15 pt-5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
            onSubmit={submitReview}
          >
            <ManagedPublishProtocolFields docId={pdoc.docId} expectedStructureRevision={pdoc.structureRevision} />
            <label className="space-y-1.5">
              <span className="text-sm font-medium">正式标题</span>
              <Input
                name="formalTitle"
                defaultValue={metadataDraft ? pdoc.managedAuthoring?.workingTitle || '' : pdoc.title || pdoc.managedAuthoring?.workingTitle || ''}
                required
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">难度</span>
              <SimpleSelect
                name="difficulty"
                defaultValue={String(pdoc.difficulty ?? 0)}
                options={difficultyOptions.map((option) => ({ value: String(option.value || 0), label: option.label }))}
              />
            </label>
            <Button type="submit" className="min-h-11" disabled={reviewing || previewInvalid}>
              {reviewing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {metadataDraft ? '确认并发布' : '重新公开'}
            </Button>
            {reviewError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:col-span-3">
                {reviewError}
              </p>
            ) : null}
          </form>
        ) : (
          <p role="status" className="border-t border-primary/15 pt-4 text-sm text-muted-foreground">
            此题已经发布；如因生命周期操作重新隐藏，仍需从本区走统一重新公开流程。
          </p>
        )}
      </div>
    </section>
  );
}
