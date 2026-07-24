import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from 'react';
import { ClipboardCheck, Eye, Pencil, Search } from 'lucide-react';
import { ManagedPublishProtocolFields } from '@/components/managed-programming-authority';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { managedSourceFieldViews, type ManagedSourceTemplateOption } from '@/lib/managed-problem-source';

type R = Record<string, any>;
type ReviewStatus = 'all' | 'draft' | 'confirmed';

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string; description: string }> = [
  { value: 'all', label: '全部待处理', description: '首次审核与等待重新公开' },
  { value: 'draft', label: '首次审核', description: '尚未确认正式元数据' },
  { value: 'confirmed', label: '重新公开', description: '已审核但当前隐藏' },
];
const PUBLISH_CONFIRM_TITLE_ID = 'problem-review-publish-confirm-title';
const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true',
  );
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function buildUrl(baseUrl: string, values: Record<string, string | number>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === '' || value === 'all') return;
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `${baseUrl}?${encoded}` : baseUrl;
}

export function ProblemReviewPage() {
  const bs = useBootstrap();
  const data = bs.page.data as R;
  const pdocs: R[] = data.pdocs || [];
  const page = Number(data.page) || 1;
  const ppcount = Number(data.ppcount) || 1;
  const pcount = Number(data.pcount) || 0;
  const query = String(data.qs || '');
  const status = (data.status || 'all') as ReviewStatus;
  const reviewUrl = String(data.problemReviewUrl || '');
  const managedAuthorsByDocId: Record<string, Array<{ _id: number; uname?: string }>> = data.managedAuthorsByDocId || {};
  const pendingContributionsByDocId: Record<string, Array<{ uid: number; scope: 'data' | 'tag' }>> = data.pendingContributionsByDocId || {};
  const pendingContributionFingerprintByDocId: Record<string, string> = data.pendingContributionFingerprintByDocId || {};
  const contributionUdict: Record<string, { _id: number; uname?: string }> = data.contributionUdict || {};
  const managedSourceTemplates: ManagedSourceTemplateOption[] = data.managedSourceTemplates || [];
  const managedTrainingOptions: R[] = data.managedTrainingOptions || [];
  const [publishConfirm, setPublishConfirm] = useState<{
    form: HTMLFormElement;
    title: string;
    pending: Array<{ uid: number; scope: 'data' | 'tag' }>;
  } | null>(null);
  const [publishError, setPublishError] = useState('');
  const publishReturnFocusRef = useRef<HTMLElement | null>(null);

  if (!reviewUrl) throw new Error('Problem review URL is missing');
  for (const [docId, pending] of Object.entries(pendingContributionsByDocId)) {
    if (pending.length && !pendingContributionFingerprintByDocId[docId]) {
      throw new Error(`Pending contribution fingerprint is missing for problem ${docId}`);
    }
  }

  const paginationBase = buildUrl(reviewUrl, { q: query, status });

  function requestManagedPublish(event: FormEvent<HTMLFormElement>, title: string, pending: Array<{ uid: number; scope: 'data' | 'tag' }>) {
    if (!pending.length) return;
    const confirmation = event.currentTarget.elements.namedItem('pendingContributionsConfirmed') as HTMLInputElement | null;
    if (confirmation?.value === 'true') return;
    event.preventDefault();
    publishReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPublishError('');
    setPublishConfirm({ form: event.currentTarget, title, pending });
  }

  function closePublishConfirm() {
    setPublishConfirm(null);
    window.requestAnimationFrame(() => publishReturnFocusRef.current?.focus());
  }

  function confirmManagedPublish() {
    if (!publishConfirm) return;
    const confirmation = publishConfirm.form.elements.namedItem('pendingContributionsConfirmed') as HTMLInputElement | null;
    if (!confirmation) {
      setPublishError('发布确认字段缺失，请刷新页面后重试');
      setPublishConfirm(null);
      return;
    }
    confirmation.value = 'true';
    const form = publishConfirm.form;
    setPublishConfirm(null);
    form.requestSubmit();
  }

  return (
    <main className="w-full min-w-0 space-y-6 overflow-x-clip pb-12">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">统一题库 · 管理员</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">审核队列</h1>
          <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">集中处理托管编程题的首次审核与重新公开。当前条件下共 {pcount} 道题。</p>
        </div>
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
          <ClipboardCheck className="size-5" />
        </div>
      </header>

      <ProblemBankNav active="review" problemsUrl={bs.urls.problems} reviewUrl={reviewUrl} canReview />

      <section aria-label="审核队列筛选" className="space-y-3 rounded-2xl bg-muted/45 p-4">
        <nav aria-label="审核状态" className="grid gap-2 sm:grid-cols-3">
          {REVIEW_STATUS_OPTIONS.map((option) => {
            const active = option.value === status;
            return (
              <Button key={option.value} asChild variant={active ? 'default' : 'outline'} className="h-auto min-h-11 justify-start py-2 text-left">
                <a href={buildUrl(reviewUrl, { q: query, status: option.value })} aria-current={active ? 'page' : undefined}>
                  <span>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs font-normal opacity-75">{option.description}</span>
                  </span>
                </a>
              </Button>
            );
          })}
        </nav>
        <form method="get" action={reviewUrl} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="status" value={status} />
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索题目标题或 PID</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={query} placeholder="搜索标题、PID 或题号" className="min-h-11 pl-9" />
          </label>
          <Button type="submit" className="min-h-11">
            搜索
          </Button>
          {query ? (
            <Button asChild variant="ghost" className="min-h-11">
              <a href={buildUrl(reviewUrl, { status })}>清除</a>
            </Button>
          ) : null}
        </form>
      </section>

      {publishError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {publishError}
        </p>
      ) : null}

      {pdocs.length ? (
        <ul className="space-y-3">
          {pdocs.map((pdoc) => {
            const docId = String(pdoc.docId);
            const displayPid = String(pdoc.pid || pdoc.docId);
            const metadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft';
            const workingTitle = String(pdoc.managedAuthoring?.workingTitle || '');
            const formalTitle = String(pdoc.title || '');
            const title = metadataDraft ? workingTitle || formalTitle || '未命名题目' : formalTitle || '未命名题目';
            const detailUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: displayPid });
            const sourceTemplate = managedSourceTemplates.find((template) => template.id === pdoc.sourceMeta?.template);
            const sourceFields = managedSourceFieldViews(pdoc.sourceMeta, sourceTemplate);
            const authors = managedAuthorsByDocId[docId] || [];
            const pending = pendingContributionsByDocId[docId] || [];
            const pendingPlacement = pdoc.managedAuthoring?.pendingTrainingPlacement;
            const pendingTraining = managedTrainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
            const pendingChapter = pendingTraining?.chapters?.find((chapter: R) => chapter.id === pendingPlacement?.chapterId);
            return (
              <li key={docId} className="rounded-2xl border border-border/80 bg-background p-4 sm:p-5">
                <article className="space-y-4">
                  <header className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={metadataDraft ? 'default' : 'outline'}>{metadataDraft ? '首次审核' : '等待重新公开'}</Badge>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{displayPid}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{metadataDraft ? '工作标题' : '正式标题'}</p>
                      <h2 className="break-words text-lg font-semibold tracking-tight text-pretty">{title}</h2>
                      {!metadataDraft && workingTitle && workingTitle !== formalTitle ? (
                        <p className="truncate text-xs text-muted-foreground" title={workingTitle}>
                          原工作标题 · {workingTitle}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        出题人 ·{' '}
                        {authors.length
                          ? authors.map((author) => `${author.uname || `UID ${author._id}`}（UID ${author._id}）`).join(' / ')
                          : '未找到 canonical 出题人'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <a href={detailUrl}>
                          <Eye className="size-3.5" />
                          查看
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <a href={`${detailUrl}/edit`}>
                          <Pencil className="size-3.5" />
                          编辑
                        </a>
                      </Button>
                    </div>
                  </header>

                  <dl className="grid gap-x-5 gap-y-3 rounded-xl bg-muted/45 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">难度</dt>
                      <dd className="mt-1 font-medium tabular-nums">{pdoc.difficulty ?? 0}</dd>
                    </div>
                    {sourceFields.map((field) => (
                      <div key={field.label} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{field.label}</dt>
                        <dd className="mt-1 truncate font-medium" title={field.value}>
                          {field.value}
                        </dd>
                      </div>
                    ))}
                    {metadataDraft ? (
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">待挂训练</dt>
                        <dd className="mt-1 truncate font-medium">
                          {pendingPlacement
                            ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                            : '不挂入训练'}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {pending.length ? (
                    <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                      <p className="font-medium">仍有 {pending.length} 项协作任务待完成，发布不会自动完成或撤销这些任务。</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pending.map((item, index) => (
                          <Badge key={`${item.uid}:${item.scope}:${index}`} variant="outline">
                            {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据' : '标签'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <form
                    method="post"
                    action={bs.urls.problems}
                    className="grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
                    onSubmit={(event) => requestManagedPublish(event, title, pending)}
                  >
                    <ManagedPublishProtocolFields docId={pdoc.docId} expectedStructureRevision={pdoc.structureRevision} />
                    <input type="hidden" name="pendingContributionsConfirmed" value="false" />
                    <input type="hidden" name="pendingContributionFingerprint" value={pendingContributionFingerprintByDocId[docId] || ''} />
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">正式标题</span>
                      <Input
                        name="formalTitle"
                        defaultValue={metadataDraft ? pdoc.managedAuthoring?.workingTitle || '' : pdoc.title || ''}
                        required
                        className="min-h-11"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">难度</span>
                      <SimpleSelect
                        name="difficulty"
                        defaultValue={String(pdoc.difficulty ?? 0)}
                        className="min-h-11"
                        options={Array.from({ length: 11 }, (_, value) => ({
                          value: String(value),
                          label: value === 0 ? '未设置' : String(value),
                        }))}
                      />
                    </label>
                    <Button type="submit" className="min-h-11">
                      {metadataDraft ? '确认并发布' : '重新公开'}
                    </Button>
                  </form>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <div className="space-y-2">
            <p className="font-medium">当前没有待处理题目</p>
            <p className="text-sm text-muted-foreground">尝试切换审核状态或清除搜索条件。</p>
          </div>
        </section>
      )}

      <Pagination current={page} total={ppcount} baseUrl={paginationBase} />

      <Dialog open={publishConfirm !== null} onOpenChange={(open) => !open && closePublishConfirm()}>
        <DialogContent
          className="w-full sm:w-[520px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={PUBLISH_CONFIRM_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={PUBLISH_CONFIRM_TITLE_ID}>确认发布「{publishConfirm?.title || ''}」</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">下列协作任务仍未完成：</p>
            <ul className="space-y-1 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              {(publishConfirm?.pending || []).map((item, index) => (
                <li key={`${item.uid}:${item.scope}:${index}`}>
                  {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据贡献' : '标签贡献'}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">继续发布不会完成、撤销或公开这些任务。</p>
          </DialogBody>
          <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="outline" className="min-h-11" autoFocus onClick={closePublishConfirm}>
              取消
            </Button>
            <Button type="button" className="min-h-11" onClick={confirmManagedPublish}>
              确认发布
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
