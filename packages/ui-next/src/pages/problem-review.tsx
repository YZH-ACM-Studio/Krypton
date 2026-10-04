import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { ManagedPublishProtocolFields } from '@/components/managed-programming-authority';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SearchInput } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import {
  managedSourceFieldViews,
  type ManagedSourceMetaView,
  type ManagedSourceTemplateOption,
} from '@/lib/managed-problem-source';

type ReviewStatus = 'all' | 'draft' | 'confirmed';
interface MindmapOption {
  id: string;
  mapId: string;
  mapTitle: string;
  label: string;
  tags: string[];
}
interface PidNamespaceOption {
  namespaceId: string;
  name: string;
  pidPattern: string;
  sourceTemplates: string[];
}

interface ProblemReviewDocument {
  docId: string | number;
  pid?: string | number;
  title?: string;
  difficulty?: string | number;
  knowledgeMapId?: unknown;
  structureRevision: number;
  sourceMeta?: ManagedSourceMetaView;
  pidNamespaceId?: string;
  pidNamespaceReview?: { note?: string };
  managedAuthoring?: {
    selectedMindmapNodeIds?: unknown[];
    workingTitle?: string;
    metadataStatus?: string;
    pendingTrainingPlacement?: {
      trainingId?: unknown;
      chapterId?: unknown;
    };
  };
}

interface ManagedTrainingReviewOption {
  id: string;
  title?: string;
  chapters?: Array<{ id: unknown; title?: string }>;
}

interface ProblemReviewPageData {
  pdocs?: ProblemReviewDocument[];
  page?: string | number;
  ppcount?: string | number;
  pcount?: string | number;
  qs?: string;
  status?: ReviewStatus;
  problemReviewUrl?: string;
  managedAuthorsByDocId?: Record<string, Array<{ _id: number; uname?: string }>>;
  pendingContributionsByDocId?: Record<string, Array<{ uid: number; scope: 'data' | 'tag' }>>;
  pendingContributionFingerprintByDocId?: Record<string, string>;
  contributionUdict?: Record<string, { _id: number; uname?: string }>;
  managedSourceTemplates?: ManagedSourceTemplateOption[];
  managedTrainingOptions?: ManagedTrainingReviewOption[];
  knowledgeMindmapOptions?: MindmapOption[];
  pidNamespaces?: PidNamespaceOption[];
  canCorrectPidNamespaces?: boolean;
  pidNamespaceUrl?: string;
  canManagePidNamespaces?: boolean;
}

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

function difficultyOptions() {
  return Array.from({ length: 11 }, (_, value) => ({
    value: String(value),
    label: value === 0 ? '未设置' : String(value),
  }));
}

function ReviewMetadataEditor({
  pdoc,
  action,
  mindmapOptions,
}: {
  pdoc: ProblemReviewDocument;
  action: string;
  mindmapOptions: MindmapOption[];
}) {
  const initialIds = (pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String);
  const options = mindmapOptions.filter((option) => option.mapId === String(pdoc.knowledgeMapId || ''));
  const optionById = new Map(options.map((option) => [option.id, option]));
  const [workingTitle, setWorkingTitle] = useState(String(pdoc.managedAuthoring?.workingTitle || ''));
  const [difficulty, setDifficulty] = useState(String(pdoc.difficulty ?? 0));
  const [selected, setSelected] = useState<MindmapOption[]>(
    initialIds.map((id: string) => optionById.get(id)).filter((option): option is MindmapOption => !!option),
  );
  const [returnOpen, setReturnOpen] = useState(false);
  const selectedIds = selected.map((option) => option.id).join(',');
  const protocolFields = (
    <>
      <input type="hidden" name="operation" value="managedReview" />
      <input type="hidden" name="pid" value={String(pdoc.docId)} />
      <input type="hidden" name="expectedStructureRevision" value={String(pdoc.structureRevision)} />
      <input type="hidden" name="knowledgeNodeIds" value={selectedIds} />
    </>
  );

  return (
    <>
      <form method="post" action={action} className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4">
        {protocolFields}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-subtle">审核标题</span>
            <Input name="workingTitle" value={workingTitle} onChange={(event) => setWorkingTitle(event.target.value)} required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-subtle">难度</span>
            <SimpleSelect
              name="difficulty"
              value={difficulty}
              onValueChange={setDifficulty}
              options={difficultyOptions()}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-subtle">导图节点</span>
          <MultiSelect
            options={options}
            value={selected}
            onChange={setSelected}
            getKey={(option) => option.id}
            getLabel={(option) => option.label}
            getDescription={(option) => option.tags.join('、')}
            placeholder={options.length ? '搜索当前导图节点' : '当前导图没有可选节点'}
            disabled={!options.length}
            minHeight={44}
          />
          <p className="text-xs text-fg-subtle">
            节点归属固定在“{options[0]?.mapTitle || '当前导图'}”；发布时服务端会重新读取节点并生成系统标签。
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setReturnOpen(true)}>
            退回修改
          </Button>
          <Button type="submit" variant="secondary">
            保存审核信息
          </Button>
        </div>
      </form>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>退回「{workingTitle || '未命名题目'}」</DialogTitle>
          </DialogHeader>
          <form method="post" action={action}>
            <DialogBody className="flex flex-col gap-3">
              {protocolFields}
              <input type="hidden" name="workingTitle" value={workingTitle} />
              <input type="hidden" name="difficulty" value={difficulty} />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">退回说明</span>
                <Textarea name="returnNote" required maxLength={1000} rows={5} placeholder="说明需要作者修改的内容；不写题面、源码或测试数据。" />
              </label>
              <p className="text-xs text-fg-subtle">退回只记录说明并保留草稿，不撤销作者原有的逐题权限。</p>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setReturnOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary">
                确认退回
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NamespaceCorrection({
  pdoc,
  action,
  namespaces,
  sourceTemplates,
}: {
  pdoc: ProblemReviewDocument;
  action: string;
  namespaces: PidNamespaceOption[];
  sourceTemplates: ManagedSourceTemplateOption[];
}) {
  const candidates = namespaces.filter(
    (namespace) => namespace.namespaceId !== String(pdoc.pidNamespaceId || '') && namespace.sourceTemplates.length,
  );
  const [open, setOpen] = useState(false);
  const [namespaceId, setNamespaceId] = useState(candidates[0]?.namespaceId || '');
  const initialNamespace = candidates.find((namespace) => namespace.namespaceId === namespaceId);
  const [template, setTemplate] = useState(initialNamespace?.sourceTemplates[0] || '');
  const [year, setYear] = useState(String(pdoc.sourceMeta?.year || new Date().getFullYear()));
  const [season, setSeason] = useState(String(pdoc.sourceMeta?.season || 'spring'));
  const [level, setLevel] = useState(String(pdoc.sourceMeta?.level || 'L1'));
  const [round, setRound] = useState(String(pdoc.sourceMeta?.round || 1));
  const selectedNamespace = candidates.find((namespace) => namespace.namespaceId === namespaceId);
  const availableTemplates = sourceTemplates.filter((candidate) => selectedNamespace?.sourceTemplates.includes(candidate.id));
  const templateDefinition = availableTemplates.find((candidate) => candidate.id === template);

  if (!candidates.length) return null;
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        纠正命名空间
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>纠正题号命名空间</DialogTitle>
          </DialogHeader>
          <form method="post" action={action}>
            <DialogBody className="flex flex-col gap-4">
              <input type="hidden" name="operation" value="managedNamespaceCorrect" />
              <input type="hidden" name="pid" value={String(pdoc.docId)} />
              <input type="hidden" name="expectedStructureRevision" value={String(pdoc.structureRevision)} />
              <Alert tone="warning">
                仅首次审核前可执行。系统将消耗目标命名空间的新题号并写入审计；旧题号不会退回编号计数器。
              </Alert>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">目标命名空间</span>
                  <SimpleSelect
                    name="targetPidNamespaceId"
                    value={namespaceId}
                    onValueChange={(value) => {
                      setNamespaceId(value);
                      const next = candidates.find((candidate) => candidate.namespaceId === value);
                      setTemplate(next?.sourceTemplates[0] || '');
                    }}
                    options={candidates.map((namespace) => ({
                      value: namespace.namespaceId,
                      label: `${namespace.name} · ${namespace.pidPattern}`,
                    }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">来源模板</span>
                  <SimpleSelect
                    name="template"
                    value={template}
                    onValueChange={setTemplate}
                    options={availableTemplates.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">年份</span>
                  <Input name="year" type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(event.target.value)} required />
                </label>
                {templateDefinition?.fields.includes('season') ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg">季度</span>
                    <SimpleSelect
                      name="season"
                      value={season}
                      onValueChange={setSeason}
                      options={[
                        { value: 'spring', label: '春季' },
                        { value: 'summer', label: '夏季' },
                        { value: 'autumn', label: '秋季' },
                        { value: 'winter', label: '冬季' },
                      ]}
                    />
                  </label>
                ) : null}
                {templateDefinition?.fields.includes('level') ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg">题目等级</span>
                    <SimpleSelect
                      name="level"
                      value={level}
                      onValueChange={setLevel}
                      options={['L1', 'L2', 'L3'].map((value) => ({ value, label: value }))}
                    />
                  </label>
                ) : null}
                {templateDefinition?.fields.includes('round') ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-fg">场次</span>
                    <Input name="round" type="number" min={1} max={99} value={round} onChange={(event) => setRound(event.target.value)} required />
                  </label>
                ) : null}
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={!namespaceId || !template}>
                分配新题号并纠正
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProblemReviewPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemReviewPageData;
  const pdocs = data.pdocs || [];
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
  const managedTrainingOptions = data.managedTrainingOptions || [];
  const knowledgeMindmapOptions: MindmapOption[] = data.knowledgeMindmapOptions || [];
  const pidNamespaces: PidNamespaceOption[] = data.pidNamespaces || [];
  const canCorrectPidNamespaces = !!data.canCorrectPidNamespaces;
  const pidNamespaceById = new Map(pidNamespaces.map((namespace) => [namespace.namespaceId, namespace]));
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
    <Page width="wide">
      <PageHeader
        breadcrumb={<p className="text-xs font-medium text-fg-subtle">统一题库 · 命名空间审核</p>}
        title="审核队列"
        description={`集中处理托管编程题的首次审核与重新公开。当前条件下共 ${pcount} 道题。`}
      />

      <ProblemBankNav
        active="review"
        problemsUrl={bs.urls.problems}
        reviewUrl={reviewUrl}
        canReview
        namespaceUrl={String(data.pidNamespaceUrl || '')}
        canManageNamespaces={!!data.canManagePidNamespaces}
      />

      <section aria-label="审核队列筛选" className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4">
        <nav aria-label="审核状态" className="grid gap-2 sm:grid-cols-3">
          {REVIEW_STATUS_OPTIONS.map((option) => {
            const active = option.value === status;
            return (
              <a
                key={option.value}
                href={buildUrl(reviewUrl, { q: query, status: option.value })}
                aria-current={active ? 'page' : undefined}
                className={active
                  ? 'flex min-h-12 flex-col justify-center rounded-md border border-brand bg-brand-soft/60 px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  : 'flex min-h-12 flex-col justify-center rounded-md border border-line bg-surface px-3 py-2 text-left outline-none transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'}
              >
                <span className="block text-sm font-medium text-fg">{option.label}</span>
                <span className="block text-xs text-fg-subtle">{option.description}</span>
              </a>
            );
          })}
        </nav>
        <form method="get" action={reviewUrl} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="status" value={status} />
          <label className="min-w-0 flex-1">
            <span className="sr-only">搜索题目标题或 PID</span>
            <SearchInput name="q" defaultValue={query} placeholder="搜索标题、PID 或题号" />
          </label>
          <Button type="submit" variant="secondary">
            搜索
          </Button>
          {query ? (
            <Button asChild variant="ghost">
              <a href={buildUrl(reviewUrl, { status })}>清除</a>
            </Button>
          ) : null}
        </form>
      </section>

      {publishError ? (
        <Alert tone="danger">{publishError}</Alert>
      ) : null}

      {pdocs.length ? (
        <ul className="flex flex-col gap-4">
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
            const pendingChapter = pendingTraining?.chapters?.find((chapter) => chapter.id === pendingPlacement?.chapterId);
            const pidNamespace = pidNamespaceById.get(String(pdoc.pidNamespaceId || ''));
            return (
              <li key={docId} className="rounded-lg border border-line bg-surface p-4 shadow-xs">
                <article className="flex flex-col gap-4">
                  <header className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge tone="warning">{metadataDraft ? '首次审核' : '等待重新公开'}</Badge>
                        {pidNamespace ? (
                          <Badge variant="outline" className="h-auto! max-w-full min-w-0 shrink! whitespace-normal! break-words py-0.5">
                            {pidNamespace.name}
                          </Badge>
                        ) : null}
                        <span className="font-mono text-xs text-fg-subtle tabular">{displayPid}</span>
                      </div>
                      <p className="mt-2 text-xs text-fg-subtle">{metadataDraft ? '工作标题' : '正式标题'}</p>
                      <h2 className="mt-1 break-words text-lg font-semibold text-balance text-fg">{title}</h2>
                      {!metadataDraft && workingTitle && workingTitle !== formalTitle ? (
                        <p className="mt-1 min-w-0 truncate text-xs text-fg-subtle" title={workingTitle}>
                          原工作标题 · {workingTitle}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-fg-subtle">
                        出题人 ·{' '}
                        {authors.length
                          ? authors.map((author) => `${author.uname || `UID ${author._id}`}（UID ${author._id}）`).join(' / ')
                          : '未找到出题人'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {metadataDraft && canCorrectPidNamespaces ? (
                        <NamespaceCorrection
                          pdoc={pdoc}
                          action={bs.urls.problems}
                          namespaces={pidNamespaces}
                          sourceTemplates={managedSourceTemplates}
                        />
                      ) : null}
                      <Button asChild variant="ghost" size="sm">
                        <a href={detailUrl}>
                          <Eye />
                          查看
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <a href={`${detailUrl}/edit`}>
                          <Pencil />
                          编辑
                        </a>
                      </Button>
                    </div>
                  </header>

                  <dl className="grid gap-x-5 gap-y-3 rounded-lg bg-surface-sunken p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div className="min-w-0">
                      <dt className="text-xs text-fg-subtle">难度</dt>
                      <dd className="mt-1 font-medium text-fg tabular">{pdoc.difficulty ?? 0}</dd>
                    </div>
                    {sourceFields.map((field) => (
                      <div key={field.label} className="min-w-0">
                        <dt className="text-xs text-fg-subtle">{field.label}</dt>
                        <dd className="mt-1 truncate font-medium text-fg" title={field.value}>
                          {field.value}
                        </dd>
                      </div>
                    ))}
                    {metadataDraft ? (
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-subtle">待挂训练</dt>
                        <dd className="mt-1 truncate font-medium text-fg">
                          {pendingPlacement
                            ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                            : '不挂入训练'}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {pending.length ? (
                    <Alert tone="warning">
                      <p className="font-medium text-fg">仍有 {pending.length} 项协作任务待完成，发布不会自动完成或撤销这些任务。</p>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                        {pending.map((item, index) => (
                          <Badge key={`${item.uid}:${item.scope}:${index}`} variant="outline" className="h-auto! max-w-full min-w-0 shrink! whitespace-normal! break-words py-0.5">
                            {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据' : '标签'}
                          </Badge>
                        ))}
                      </div>
                    </Alert>
                  ) : null}

                  {metadataDraft ? <ReviewMetadataEditor pdoc={pdoc} action={bs.urls.problems} mindmapOptions={knowledgeMindmapOptions} /> : null}

                  {pdoc.pidNamespaceReview?.note ? (
                    <Alert tone="warning" title="最近退回说明">
                      <p className="whitespace-pre-wrap">{pdoc.pidNamespaceReview.note}</p>
                    </Alert>
                  ) : null}

                  <form
                    method="post"
                    action={bs.urls.problems}
                    className="grid grid-cols-1 gap-3 border-t border-line pt-4 md:grid-cols-2 md:items-end"
                    onSubmit={(event) => requestManagedPublish(event, title, pending)}
                  >
                    <ManagedPublishProtocolFields docId={pdoc.docId} expectedStructureRevision={pdoc.structureRevision} />
                    <input type="hidden" name="pendingContributionsConfirmed" value="false" />
                    <input type="hidden" name="pendingContributionFingerprint" value={pendingContributionFingerprintByDocId[docId] || ''} />
                    {metadataDraft ? (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-fg-subtle">正式标题</span>
                        <Input
                          name="formalTitle"
                          defaultValue={pdoc.managedAuthoring?.workingTitle || ''}
                          required
                        />
                      </label>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-fg-subtle">正式标题</span>
                        <p className="text-sm font-medium text-fg">{pdoc.title || '未命名题目'}</p>
                        <p className="text-xs text-fg-subtle">重新公开不会改正式标题。题库管理员请到题目编辑页更正。</p>
                        <input type="hidden" name="formalTitle" value={pdoc.title || ''} />
                      </div>
                    )}
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-fg-subtle">难度</span>
                      <SimpleSelect
                        name="difficulty"
                        defaultValue={String(pdoc.difficulty ?? 0)}
                        options={difficultyOptions()}
                      />
                    </label>
                    {metadataDraft ? (
                      <label className="flex min-h-12 items-center gap-2 rounded-lg border border-line px-3 text-sm md:col-span-2">
                        <Switch name="finalHidden" value="true" />
                        <span className="min-w-0">
                          <span className="block font-medium text-fg">审核后保持隐藏</span>
                          <span className="block text-xs text-fg-subtle">确认元数据与训练归属，但暂不向普通用户公开。</span>
                        </span>
                      </label>
                    ) : null}
                    <Button type="submit" variant="soft" className="w-full sm:w-auto md:col-span-2 md:justify-self-end">
                      {metadataDraft ? '确认并发布' : '重新公开'}
                    </Button>
                  </form>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="当前没有待处理题目" description="尝试切换审核状态或清除搜索条件。" />
      )}

      <Pagination current={page} total={ppcount} baseUrl={paginationBase} />

      <Dialog open={publishConfirm !== null} onOpenChange={(open) => !open && closePublishConfirm()}>
        <DialogContent
          size="md"
          role="dialog"
          aria-modal="true"
          aria-labelledby={PUBLISH_CONFIRM_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={PUBLISH_CONFIRM_TITLE_ID}>确认发布「{publishConfirm?.title || ''}」</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <p className="text-sm text-fg-muted">下列协作任务仍未完成：</p>
            <ul className="flex flex-col gap-1 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-fg">
              {(publishConfirm?.pending || []).map((item, index) => (
                <li key={`${item.uid}:${item.scope}:${index}`}>
                  {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据贡献' : '标签贡献'}
                </li>
              ))}
            </ul>
            <p className="text-xs text-fg-subtle">继续发布不会完成、撤销或公开这些任务。</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" autoFocus onClick={closePublishConfirm}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={confirmManagedPublish}>
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
