import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { managedSourceFieldViews, type ManagedSourceMetaView, type ManagedSourceTemplateOption } from '../lib/managed-problem-source';
import { readHydroResponseError } from '../lib/error-presenter';
import type { ManagedTrainingOptionView } from './problem-authoring-state';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { SimpleSelect } from './ui/select';
import { Spinner } from './ui/display';
import { fetchHydroResponse } from '@/lib/error-presenter';

interface ManagedReviewProblemDocument {
  difficulty?: string | number;
  docId?: string | number;
  hidden?: boolean;
  managedAuthoring?: {
    metadataStatus?: string;
    workingTitle?: string;
    pendingTrainingPlacement?: {
      trainingId?: string | number;
      chapterId?: string | number;
    };
  };
  pid?: string | number;
  sourceMeta?: ManagedSourceMetaView;
  structureRevision?: number;
  tag?: string[];
  title?: string;
}

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

export function ManagedPublishProtocolFields({ docId, expectedStructureRevision }: { docId: number | string; expectedStructureRevision: number }) {
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
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs text-fg-subtle">知识导图节点</p>
      {children}
      {editable ? <input type="hidden" name="knowledgeNodeIds" value={selectedNodeIds.join(',')} /> : null}
      <p className="text-xs text-fg-subtle">
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
  pendingContributions = [],
  pendingContributionFingerprint = '',
  contributionUdict = {},
}: {
  pdoc: ManagedReviewProblemDocument;
  sourceTemplates: ManagedSourceTemplateOption[];
  trainingOptions: ManagedTrainingOptionView[];
  problemsUrl: string;
  difficultyOptions: Array<{ value: string | number; label: string }>;
  reviewPreview?: ManagedReviewPreview;
  pendingContributions?: Array<{ uid: number; scope: 'data' | 'tag' }>;
  pendingContributionFingerprint?: string;
  contributionUdict?: Record<string, { _id: number; uname: string }>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [pendingConfirmOpen, setPendingConfirmOpen] = useState(false);
  const pendingFormRef = useRef<HTMLFormElement | null>(null);
  if (pendingContributions.length && !pendingContributionFingerprint.trim()) {
    throw new Error('Managed publication requires a pending contribution fingerprint');
  }
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

  const submitReview = async (form: HTMLFormElement, pendingConfirmed: boolean) => {
    setReviewError('');
    setReviewing(true);
    try {
      const payload = new URLSearchParams(Array.from(new FormData(form), ([key, value]) => [key, String(value)]));
      payload.set('pendingContributionsConfirmed', String(pendingConfirmed));
      payload.set('pendingContributionFingerprint', pendingContributionFingerprint);
      const response = await fetchHydroResponse(problemsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: payload,
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '审核发布失败'));
      const responseBody = await response.json();
      if (typeof responseBody?.url !== 'string' || !responseBody.url) throw new Error('审核发布响应缺少跳转地址');
      window.location.assign(responseBody.url);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '审核发布失败');
      setReviewing(false);
    }
  };

  const requestReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingContributions.length) {
      pendingFormRef.current = event.currentTarget;
      setPendingConfirmOpen(true);
      return;
    }
    void submitReview(event.currentTarget, false);
  };

  const confirmPendingReview = () => {
    const form = pendingFormRef.current;
    if (!form) {
      setReviewError('发布确认表单已失效，请刷新页面后重试');
      setPendingConfirmOpen(false);
      return;
    }
    setPendingConfirmOpen(false);
    void submitReview(form, true);
  };

  return (
    <>
      <section aria-labelledby="managed-review-heading" className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <header className="border-b border-line-subtle px-4 py-2.5">
          <h2 id="managed-review-heading" className="min-w-0 break-words text-lg font-semibold text-fg">
            {reviewHeading}
          </h2>
          {metadataDraft ? (
            <p className="mt-1 text-sm text-fg-muted">确认正式标题、来源、标签和待挂训练后，通过既有统一发布服务公开题目。</p>
          ) : pdoc.hidden ? (
            <p className="mt-1 text-sm text-fg-muted">该题已完成审核确认，但当前处于隐藏状态；重新公开不会再次消费待挂训练。</p>
          ) : (
            <Alert tone="neutral" className="mt-2">
              该题已完成审核确认；当前来源、标签和所属训练均为只读。
            </Alert>
          )}
        </header>
        <div className="space-y-5 p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-fg-subtle">{metadataDraft ? '工作标题' : '正式标题'}</dt>
              <dd className="mt-1 min-w-0 break-words font-medium text-fg">{metadataDraft ? pdoc.managedAuthoring?.workingTitle || '—' : pdoc.title || '—'}</dd>
            </div>
            {sourceFields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-xs text-fg-subtle">{field.label}</dt>
                <dd className="mt-1 min-w-0 break-words font-medium text-fg">{field.value}</dd>
              </div>
            ))}
            {metadataDraft ? (
              <div className="min-w-0">
                <dt className="text-xs text-fg-subtle">待挂训练</dt>
                <dd className="mt-1 min-w-0 break-words font-medium text-fg">
                  {pendingPlacement
                    ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                    : '不挂入训练'}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">最终标签</p>
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
              {finalTags.map((tag: string) => (
                <Badge
                  key={tag}
                  variant="soft"
                  tone="neutral"
                  className="inline-block h-auto max-w-full min-w-0 shrink whitespace-normal break-words py-0.5 text-left"
                >
                  {tag}
                </Badge>
              ))}
              {!finalTags.length ? <span className="text-sm text-fg-muted">尚未生成</span> : null}
            </div>
          </div>

          {previewMessage ? <Alert tone="danger">审核预检失败：{previewMessage}</Alert> : null}

          {pendingContributions.length ? (
            <Alert tone="warning">
              <p className="font-medium text-fg">仍有 {pendingContributions.length} 项协作任务待完成，发布不会自动完成或撤销这些任务。</p>
              <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                {pendingContributions.map((item, index) => (
                  <Badge
                    key={`${item.uid}:${item.scope}:${index}`}
                    variant="outline"
                    className="inline-block h-auto max-w-full min-w-0 shrink whitespace-normal break-words py-0.5 text-left"
                  >
                    {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据' : '标签'}
                  </Badge>
                ))}
              </div>
            </Alert>
          ) : null}

          {pdoc.hidden ? (
            <form
              method="post"
              action={problemsUrl}
              className="grid grid-cols-1 gap-4 border-t border-line-subtle pt-5 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-end"
              onSubmit={requestReview}
            >
              <ManagedPublishProtocolFields docId={pdoc.docId ?? ''} expectedStructureRevision={Number(pdoc.structureRevision)} />
              <input type="hidden" name="pendingContributionsConfirmed" value="false" />
              <input type="hidden" name="pendingContributionFingerprint" value={pendingContributionFingerprint} />
              {metadataDraft ? (
                <label className="min-w-0 space-y-1.5">
                  <span className="text-sm font-medium text-fg">正式标题</span>
                  <Input name="formalTitle" defaultValue={pdoc.managedAuthoring?.workingTitle || ''} required />
                </label>
              ) : (
                <div className="min-w-0 space-y-1.5">
                  <span className="text-sm font-medium text-fg">正式标题</span>
                  <p className="min-w-0 break-words text-sm font-medium text-fg">{pdoc.title || '未命名题目'}</p>
                  <p className="text-xs text-fg-subtle">重新公开不会改正式标题。题库管理员请到题目编辑页更正。</p>
                  <input type="hidden" name="formalTitle" value={pdoc.title || ''} />
                </div>
              )}
              <label className="min-w-0 space-y-1.5">
                <span className="text-sm font-medium text-fg">难度</span>
                <SimpleSelect
                  name="difficulty"
                  defaultValue={String(pdoc.difficulty ?? 0)}
                  options={difficultyOptions.map((option) => ({ value: String(option.value || 0), label: option.label }))}
                />
              </label>
              <Button type="submit" variant={pendingConfirmOpen ? 'secondary' : 'primary'} disabled={reviewing || previewInvalid}>
                {reviewing ? <Spinner /> : null}
                {metadataDraft ? '确认并发布' : '重新公开'}
              </Button>
              {reviewError ? (
                <Alert tone="danger" className="md:col-span-3">
                  {reviewError}
                </Alert>
              ) : null}
            </form>
          ) : (
            <p role="status" className="border-t border-line-subtle pt-4 text-sm text-fg-muted">
              此题已经发布；如因生命周期操作重新隐藏，仍需从本区走统一重新公开流程。
            </p>
          )}
        </div>
      </section>

      <Dialog open={pendingConfirmOpen} onOpenChange={(open) => !reviewing && setPendingConfirmOpen(open)}>
        <DialogContent onClose={() => !reviewing && setPendingConfirmOpen(false)}>
          <DialogHeader>
            <DialogTitle>确认发布题目</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-fg-muted">下列协作任务仍未完成：</p>
            <Alert tone="warning">
              <ul className="space-y-1">
                {pendingContributions.map((item, index) => (
                  <li key={`${item.uid}:${item.scope}:${index}`} className="min-w-0 break-words">
                    {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据贡献' : '标签贡献'}
                  </li>
                ))}
              </ul>
            </Alert>
            <p className="text-xs text-fg-subtle">继续发布不会完成、撤销或公开这些任务。</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={reviewing} onClick={() => setPendingConfirmOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="primary" disabled={reviewing} onClick={confirmPendingReview}>
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
