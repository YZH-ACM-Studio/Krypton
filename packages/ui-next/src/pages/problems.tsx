import { type FormEvent, useState } from 'react';
import { Archive, CheckCircle2, Copy, Eye, EyeOff, LockKeyhole, Pencil, SlidersHorizontal, Users, XCircle } from 'lucide-react';
import { effectiveProblemKind, type ProblemKind } from '@hydrooj/common';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { ManagedPublishProtocolFields } from '@/components/managed-programming-authority';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { ProblemCreationActions } from '@/components/problem-creation-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { confirmFormSubmit, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Input, SearchInput } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Difficulty } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { managedSourceFieldViews, type ManagedSourceMetaView, type ManagedSourceTemplateOption } from '@/lib/managed-problem-source';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { createRequestId } from '@/lib/request-id';

const KIND_LABEL: Record<ProblemKind, string> = {
  programming: '编程题',
  single: '单选题',
  multi: '多选题',
  true_false: '判断题',
  blank: '填空题',
  subjective: '主观题',
  program_fill: '程序填空题',
  function: '代码实现题',
};

interface BankFilters {
  kind?: string;
  tag?: string;
  contest?: string;
  owner?: string | number;
  visibility?: 'all' | 'hidden' | 'published';
  lifecycle?: 'active' | 'archived' | 'all';
  managedReview?: 'all' | 'pending';
  pidNamespaceId?: string;
}

interface ProblemListDocument {
  docId: number;
  pid?: string | number;
  title?: string;
  difficulty?: string | number;
  archivedAt?: unknown;
  hidden?: boolean;
  owner?: string | number;
  sourceMeta?: ManagedSourceMetaView;
  structureLockedAt?: unknown;
  structureRevision: number;
  tag?: string[];
  problemKind?: unknown;
  kind?: ProblemKind;
  type?: string;
  config?: { type?: string };
  managedAuthoring?: {
    metadataStatus?: string;
    workingTitle?: string;
    pendingTrainingPlacement?: {
      trainingId?: unknown;
      chapterId?: unknown;
    };
  };
}

interface ManagedTrainingListOption {
  id: string;
  title?: string;
  chapters?: Array<{ id: unknown; title?: string }>;
}

interface ProblemsPageData {
  pdocs?: ProblemListDocument[];
  page?: string | number;
  ppcount?: string | number;
  pcount?: string | number;
  qs?: string;
  sort?: string;
  filters?: BankFilters;
  problemKinds?: Array<{ kind: ProblemKind; slug: string }>;
  contestOptions?: Array<{ id: string; title: string; beginAt?: string | Date }>;
  pidNamespaces?: Array<{ namespaceId: string; name: string; pidPattern: string }>;
  ownerNames?: Record<string, string>;
  canManageByDocId?: Record<string, boolean>;
  canArchiveByDocId?: Record<string, boolean>;
  canManageContributionsByDocId?: Record<string, boolean>;
  canCloneByDocId?: Record<string, boolean>;
  managedReviewableByDocId?: Record<string, boolean>;
  pendingContributionsByDocId?: Record<string, Array<{ uid: number; scope: 'data' | 'tag' }>>;
  pendingContributionFingerprintByDocId?: Record<string, string>;
  contributionUdict?: Record<string, { _id: number; uname?: string }>;
  managedSourceTemplates?: ManagedSourceTemplateOption[];
  managedTrainingOptions?: ManagedTrainingListOption[];
  problemCreationCapabilities?: { canCreateAny: boolean; canImport: boolean };
  psdict?: Record<string, { status?: number }>;
  problemReviewUrl?: string;
  canReviewManaged?: boolean;
  pidNamespaceUrl?: string;
  canManagePidNamespaces?: boolean;
  canFilterOwner?: boolean;
}

const BULK_VERIFIER_STATUSES = new Set(['applied', 'already-present', 'conflict-higher-role', 'failed'] as const);

type BulkVerifierStatus = 'applied' | 'already-present' | 'conflict-higher-role' | 'failed';

interface BulkVerifierResult {
  pid: number;
  publicPid: string;
  status: BulkVerifierStatus;
}

interface BulkVerifierResponse {
  success: boolean;
  requestId: string;
  results: BulkVerifierResult[];
  retryPids: number[];
}

export function parseBulkVerifierResponse(value: unknown, expectedPids: readonly number[], expectedRequestId: string): BulkVerifierResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('批量只读验题人响应格式无效');
  const record = value as Record<string, unknown>;
  if (
    typeof record.success !== 'boolean' ||
    typeof record.requestId !== 'string' ||
    record.requestId !== expectedRequestId ||
    !Array.isArray(record.results) ||
    !Array.isArray(record.retryPids)
  ) {
    throw new Error('批量只读验题人响应格式无效');
  }

  const results: BulkVerifierResult[] = [];
  const seen = new Set<number>();
  for (const item of record.results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('批量只读验题人响应格式无效');
    const result = item as Record<string, unknown>;
    if (
      !Number.isSafeInteger(result.pid) ||
      Number(result.pid) <= 0 ||
      typeof result.publicPid !== 'string' ||
      !result.publicPid ||
      typeof result.status !== 'string' ||
      !BULK_VERIFIER_STATUSES.has(result.status as BulkVerifierStatus) ||
      seen.has(Number(result.pid))
    ) {
      throw new Error('批量只读验题人响应格式无效');
    }
    seen.add(Number(result.pid));
    results.push({ pid: Number(result.pid), publicPid: result.publicPid, status: result.status as BulkVerifierStatus });
  }

  if (record.retryPids.some((pid) => typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0)) {
    throw new Error('批量只读验题人响应格式无效');
  }
  const retryPids = record.retryPids as number[];
  const expected = [...new Set(expectedPids)].sort((a, b) => a - b);
  const actual = results.map((result) => result.pid).sort((a, b) => a - b);
  const failedPids = results.filter((result) => result.status === 'failed').map((result) => result.pid);
  const sortedRetry = [...retryPids].sort((a, b) => a - b);
  const sortedFailed = [...failedPids].sort((a, b) => a - b);
  if (
    record.success !== (failedPids.length === 0) ||
    expected.length !== expectedPids.length ||
    actual.length !== expected.length ||
    actual.some((pid, index) => pid !== expected[index]) ||
    sortedRetry.length !== sortedFailed.length ||
    sortedRetry.some((pid, index) => pid !== sortedFailed[index])
  ) {
    throw new Error('批量只读验题人响应格式无效');
  }

  return { success: record.success, requestId: record.requestId, results, retryPids };
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function FilterFields({
  query,
  sort,
  filters,
  problemKinds,
  contestOptions,
  pidNamespaces,
  canFilterOwner,
  canReviewManaged,
  compact = false,
}: {
  query: string;
  sort: string;
  filters: BankFilters;
  problemKinds: Array<{ kind: ProblemKind; slug: string }>;
  contestOptions: Array<{ id: string; title: string; beginAt?: string | Date }>;
  pidNamespaces: Array<{ namespaceId: string; name: string; pidPattern: string }>;
  canFilterOwner: boolean;
  canReviewManaged: boolean;
  compact?: boolean;
}) {
  const fieldClass = compact ? 'flex min-w-0 flex-col gap-1.5' : 'flex w-full min-w-0 flex-col gap-1.5 sm:w-40';
  const searchClass = compact ? 'flex min-w-0 flex-col gap-1.5' : 'flex w-full min-w-0 flex-col gap-1.5 sm:w-72';
  const wideClass = compact ? 'flex min-w-0 flex-col gap-1.5' : 'flex w-full min-w-0 flex-col gap-1.5 sm:w-56';
  return (
    <>
      <label className={searchClass}>
        <span className="text-xs font-medium text-fg-subtle">关键词或题号</span>
        <SearchInput name="q" defaultValue={query} placeholder="标题、PID、题号或标签" />
      </label>
      <label className={fieldClass}>
        <span className="text-xs font-medium text-fg-subtle">题型</span>
        <SimpleSelect
          name="kind"
          defaultValue={filters.kind || ''}
          options={[{ value: '', label: '全部题型' }, ...problemKinds.map((item) => ({ value: item.slug, label: KIND_LABEL[item.kind] }))]}
        />
      </label>
      {contestOptions.length ? (
        <label className={wideClass}>
          <span className="text-xs font-medium text-fg-subtle">所属比赛</span>
          <SimpleSelect
            name="contest"
            defaultValue={filters.contest || ''}
            options={[
              { value: '', label: '全部比赛' },
              ...contestOptions.map((item) => {
                const year = item.beginAt ? new Date(item.beginAt).getFullYear() : null;
                return { value: item.id, label: `${item.title}${year && Number.isFinite(year) ? ` · ${year}` : ''}` };
              }),
            ]}
          />
        </label>
      ) : null}
      <label className={wideClass}>
        <span className="text-xs font-medium text-fg-subtle">题号命名空间</span>
        <SimpleSelect
          name="pidNamespaceId"
          defaultValue={filters.pidNamespaceId || ''}
          options={[
            { value: '', label: '全部命名空间' },
            ...pidNamespaces.map((namespace) => ({
              value: namespace.namespaceId,
              label: `${namespace.name} · ${namespace.pidPattern}`,
            })),
          ]}
        />
      </label>
      <label className={fieldClass}>
        <span className="text-xs font-medium text-fg-subtle">标签</span>
        <Input name="tag" defaultValue={filters.tag || ''} placeholder="精确标签" />
      </label>
      {canFilterOwner ? (
        <label className={fieldClass}>
          <span className="text-xs font-medium text-fg-subtle">出题人 UID</span>
          <Input name="owner" type="number" min={1} defaultValue={filters.owner || ''} placeholder="全部" />
        </label>
      ) : null}
      {canReviewManaged ? (
        <label className={fieldClass}>
          <span className="text-xs font-medium text-fg-subtle">托管审核</span>
          <SimpleSelect
            name="managedReview"
            defaultValue={filters.managedReview || 'all'}
            options={[
              { value: 'all', label: '全部' },
              { value: 'pending', label: '元数据待确认' },
            ]}
          />
        </label>
      ) : null}
      <label className={fieldClass}>
        <span className="text-xs font-medium text-fg-subtle">可见性</span>
        <SimpleSelect
          name="visibility"
          defaultValue={filters.visibility || 'all'}
          options={[
            { value: 'all', label: '全部' },
            { value: 'hidden', label: '隐藏' },
            { value: 'published', label: '已发布' },
          ]}
        />
      </label>
      <label className={fieldClass}>
        <span className="text-xs font-medium text-fg-subtle">生命周期</span>
        <SimpleSelect
          name="lifecycle"
          defaultValue={filters.lifecycle || 'active'}
          options={[
            { value: 'active', label: '使用中' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部' },
          ]}
        />
      </label>
      <label className={fieldClass}>
        <span className="text-xs font-medium text-fg-subtle">排序</span>
        <SimpleSelect
          name="sort"
          defaultValue={sort}
          options={[
            { value: 'default', label: '题号顺序' },
            { value: 'recent', label: '最近创建' },
            { value: 'title', label: '标题 A–Z' },
          ]}
        />
      </label>
    </>
  );
}

function FilterActions({ action, compact = false }: { action: string; compact?: boolean }) {
  return (
    <div className={compact ? 'flex shrink-0 gap-2 border-t border-line px-5 py-3' : 'flex shrink-0 items-center gap-2'}>
      <Button type="submit" variant="secondary" className={compact ? 'w-full' : undefined}>
        应用
      </Button>
      <Button asChild type="button" variant="ghost" className="shrink-0">
        <a href={action}>清空</a>
      </Button>
    </div>
  );
}

function FilterForm({
  action,
  query,
  sort,
  filters,
  problemKinds,
  contestOptions,
  pidNamespaces,
  canFilterOwner,
  canReviewManaged,
  compact = false,
}: {
  action: string;
  query: string;
  sort: string;
  filters: BankFilters;
  problemKinds: Array<{ kind: ProblemKind; slug: string }>;
  contestOptions: Array<{ id: string; title: string; beginAt?: string | Date }>;
  pidNamespaces: Array<{ namespaceId: string; name: string; pidPattern: string }>;
  canFilterOwner: boolean;
  canReviewManaged: boolean;
  compact?: boolean;
}) {
  const fields = (
    <FilterFields
      query={query}
      sort={sort}
      filters={filters}
      problemKinds={problemKinds}
      contestOptions={contestOptions}
      pidNamespaces={pidNamespaces}
      canFilterOwner={canFilterOwner}
      canReviewManaged={canReviewManaged}
      compact={compact}
    />
  );
  if (compact) {
    return (
      <form method="get" action={action} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SheetBody>
          <div className="flex flex-col gap-5">{fields}</div>
        </SheetBody>
        <FilterActions action={action} compact />
      </form>
    );
  }
  return (
    <form method="get" action={action}>
      <Toolbar className="items-end">
        {fields}
        <FilterActions action={action} />
      </Toolbar>
    </form>
  );
}

function SubmissionStatus({ status }: { status?: number }) {
  if (status === 1) return <CheckCircle2 className="size-4 text-success-fg" aria-label="已通过" />;
  if (status === 2) return <XCircle className="size-4 text-danger-fg" aria-label="未通过" />;
  return <span className="size-4" aria-hidden="true" />;
}

function problemDifficultyLevel(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) return undefined;
  return numeric;
}

function ProblemManagedReview({
  pdoc,
  managedSourceTemplates,
  managedTrainingOptions,
  pendingContributions,
  pendingFingerprint,
  contributionUdict,
  onPublish,
}: {
  pdoc: ProblemListDocument;
  managedSourceTemplates: ManagedSourceTemplateOption[];
  managedTrainingOptions: ManagedTrainingListOption[];
  pendingContributions: Array<{ uid: number; scope: 'data' | 'tag' }>;
  pendingFingerprint: string;
  contributionUdict: Record<string, { _id: number; uname?: string }>;
  onPublish: (event: FormEvent<HTMLFormElement>, title: string, pending: Array<{ uid: number; scope: 'data' | 'tag' }>) => void;
}) {
  const displayPid = String(pdoc.pid || pdoc.docId);
  const sourceTemplate = managedSourceTemplates.find((template) => template.id === pdoc.sourceMeta?.template);
  const sourceFields = managedSourceFieldViews(pdoc.sourceMeta, sourceTemplate);
  const pendingPlacement = pdoc.managedAuthoring?.pendingTrainingPlacement;
  const pendingTraining = managedTrainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
  const pendingChapter = pendingTraining?.chapters?.find((chapter) => chapter.id === pendingPlacement?.chapterId);
  return (
    <section className="space-y-3 rounded-lg border border-brand-line bg-brand-soft p-4" aria-label="托管草稿审核">
      <div className="grid gap-2 text-xs text-fg-subtle sm:grid-cols-2 lg:grid-cols-4">
        <span>
          工作标题 · <strong className="font-medium text-fg">{pdoc.managedAuthoring?.workingTitle || '—'}</strong>
        </span>
        {sourceFields.map((field) => (
          <span key={field.label}>
            {field.label} · <strong className="font-medium text-fg">{field.value}</strong>
          </span>
        ))}
        {pdoc.managedAuthoring?.metadataStatus === 'draft' ? (
          <span>
            待挂训练 ·{' '}
            <strong className="font-medium text-fg">
              {pendingPlacement
                ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                : '不挂入训练'}
            </strong>
          </span>
        ) : null}
      </div>
      {pendingContributions.length ? (
        <div className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-xs text-fg">
          <p className="font-medium">仍有 {pendingContributions.length} 项协作任务待完成，发布不会自动完成或撤销这些任务。</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pendingContributions.map((item, index) => (
              <Badge key={`${item.uid}:${item.scope}:${index}`} variant="outline" size="sm">
                {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据' : '标签'}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      <form
        method="post"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => onPublish(event, pdoc.title || displayPid, pendingContributions)}
      >
        <ManagedPublishProtocolFields docId={pdoc.docId} expectedStructureRevision={pdoc.structureRevision} />
        <input type="hidden" name="pendingContributionsConfirmed" value="false" />
        <input type="hidden" name="pendingContributionFingerprint" value={pendingFingerprint} />
        {pdoc.managedAuthoring?.metadataStatus === 'draft' ? (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-fg-subtle">正式标题</span>
            <Input
              name="formalTitle"
              defaultValue={pdoc.managedAuthoring?.workingTitle || ''}
              required
            />
          </label>
        ) : (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-fg-subtle">正式标题</span>
            <p className="text-sm font-medium text-fg">{pdoc.title || '未命名题目'}</p>
            <p className="text-xs text-fg-subtle">重新公开不会改正式标题。题库管理员请到题目编辑页更正。</p>
            <input type="hidden" name="formalTitle" value={pdoc.title || ''} />
          </div>
        )}
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-fg-subtle">难度</span>
          <SimpleSelect
            name="difficulty"
            defaultValue={String(pdoc.difficulty ?? 0)}
            options={Array.from({ length: 11 }, (_, value) => ({
              value: String(value),
              label: value === 0 ? '未设置' : String(value),
            }))}
          />
        </label>
        {pdoc.managedAuthoring?.metadataStatus === 'draft' ? (
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm sm:col-span-2">
            <Switch name="finalHidden" value="true" />
            <span>
              <span className="block font-medium">审核后保持隐藏</span>
              <span className="block text-xs text-fg-subtle">确认元数据与训练归属，但暂不向普通用户公开。</span>
            </span>
          </label>
        ) : null}
        <div className="sm:col-span-2 sm:justify-self-end">
          <Button type="submit" variant="primary">
            {pdoc.managedAuthoring?.metadataStatus === 'draft' ? '确认并发布' : '重新公开'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ProblemsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemsPageData;
  const pdocs = data.pdocs || [];
  const page = Number(data.page) || 1;
  const ppcount = Number(data.ppcount) || 1;
  const pcount = Number(data.pcount) || pdocs.length;
  const query = String(data.qs || '');
  const sort = String(data.sort || 'default');
  const filters: BankFilters = data.filters || {};
  const problemKinds: Array<{ kind: ProblemKind; slug: string }> = data.problemKinds || [];
  const contestOptions: Array<{ id: string; title: string; beginAt?: string | Date }> = data.contestOptions || [];
  const pidNamespaces: Array<{ namespaceId: string; name: string; pidPattern: string }> = data.pidNamespaces || [];
  const ownerNames: Record<string, string> = data.ownerNames || {};
  const canManageByDocId: Record<string, boolean> = data.canManageByDocId || {};
  const canArchiveByDocId: Record<string, boolean> = data.canArchiveByDocId || {};
  const canManageContributionsByDocId: Record<string, boolean> = data.canManageContributionsByDocId || {};
  const canCloneByDocId: Record<string, boolean> = data.canCloneByDocId || {};
  const managedReviewableByDocId: Record<string, boolean> = data.managedReviewableByDocId || {};
  const pendingContributionsByDocId: Record<string, Array<{ uid: number; scope: 'data' | 'tag' }>> = data.pendingContributionsByDocId || {};
  const pendingContributionFingerprintByDocId: Record<string, string> = data.pendingContributionFingerprintByDocId || {};
  const contributionUdict: Record<string, { _id: number; uname?: string }> = data.contributionUdict || {};
  const managedSourceTemplates: ManagedSourceTemplateOption[] = data.managedSourceTemplates || [];
  const managedTrainingOptions = data.managedTrainingOptions || [];
  const problemCreationCapabilities = data.problemCreationCapabilities as { canCreateAny: boolean; canImport: boolean } | undefined;
  if (
    !problemCreationCapabilities ||
    typeof problemCreationCapabilities.canCreateAny !== 'boolean' ||
    typeof problemCreationCapabilities.canImport !== 'boolean'
  ) {
    throw new Error('Problem creation capabilities are missing');
  }
  const psdict = data.psdict || {};
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedContributionPids, setSelectedContributionPids] = useState<Set<number>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchUser, setBatchUser] = useState<DomainUserOption[]>([]);
  const [batchDataScope, setBatchDataScope] = useState(true);
  const [batchTagScope, setBatchTagScope] = useState(false);
  const [batchVerifierRole, setBatchVerifierRole] = useState(false);
  const [batchVerifierResults, setBatchVerifierResults] = useState<BulkVerifierResponse | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [batchError, setBatchError] = useState('');
  const [publishConfirm, setPublishConfirm] = useState<{
    form: HTMLFormElement;
    title: string;
    pending: Array<{ uid: number; scope: 'data' | 'tag' }>;
  } | null>(null);
  const filtersActive = Boolean(
    query ||
    filters.kind ||
    filters.tag ||
    filters.contest ||
    filters.owner ||
    (filters.visibility && filters.visibility !== 'all') ||
    (filters.lifecycle && filters.lifecycle !== 'active') ||
    (filters.managedReview && filters.managedReview !== 'all') ||
    filters.pidNamespaceId ||
    sort !== 'default',
  );
  const problemsBaseUrl = buildUrlWithQuery(bs.urls.problems, {
    q: query,
    kind: filters.kind,
    tag: filters.tag,
    contest: filters.contest,
    owner: filters.owner,
    visibility: filters.visibility === 'all' ? '' : filters.visibility,
    lifecycle: filters.lifecycle === 'active' ? '' : filters.lifecycle,
    managedReview: filters.managedReview === 'all' ? '' : filters.managedReview,
    pidNamespaceId: filters.pidNamespaceId || '',
    sort: sort === 'default' ? '' : sort,
  });

  function toggleContributionPid(pid: number, selected: boolean) {
    setSelectedContributionPids((current) => {
      const next = new Set(current);
      if (selected) next.add(pid);
      else next.delete(pid);
      return next;
    });
  }

  async function submitContributionBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPdocs = pdocs.filter((pdoc) => selectedContributionPids.has(Number(pdoc.docId)));
    if (!selectedPdocs.length || !batchUser[0] || (!batchVerifierRole && !batchDataScope && !batchTagScope)) {
      setBatchError('请选择题目、目标用户和至少一种协作类型');
      return;
    }
    setBatchBusy(true);
    setBatchError('');
    setBatchMessage('');
    setBatchVerifierResults(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set('pids', selectedPdocs.map((pdoc) => pdoc.docId).join(','));
      form.set(
        'expectedRevisions',
        JSON.stringify(Object.fromEntries(selectedPdocs.map((pdoc) => [pdoc.docId, Number(pdoc.structureRevision ?? 0)]))),
      );
      form.set('uid', String(batchUser[0]._id));
      if (batchVerifierRole) {
        form.set('role', 'verifier');
        form.delete('scopes');
      } else {
        form.delete('role');
        form.set('scopes', [batchDataScope ? 'data' : '', batchTagScope ? 'tag' : ''].filter(Boolean).join(','));
      }
      const requestId = createRequestId();
      form.set('requestId', requestId);
      const response = await fetchHydroResponse('/problem-contributions/bulk', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, '批量分配失败'));
      }
      if (batchVerifierRole) {
        const result = parseBulkVerifierResponse(
          await response.json(),
          selectedPdocs.map((pdoc) => pdoc.docId),
          requestId,
        );
        const applied = result.results.filter((item) => item.status === 'applied').length;
        const alreadyPresent = result.results.filter((item) => item.status === 'already-present').length;
        const higherRole = result.results.filter((item) => item.status === 'conflict-higher-role').length;
        setBatchVerifierResults(result);
        setSelectedContributionPids(new Set(result.retryPids));
        setBatchMessage(`只读验题人分配结果：新增 ${applied}，已存在 ${alreadyPresent}，较高角色 ${higherRole}，失败 ${result.retryPids.length}。`);
        if (result.retryPids.length) setBatchError(`有 ${result.retryPids.length} 道题失败，已只保留失败项供重试。请求 ID：${result.requestId}`);
        return;
      }
      setBatchMessage(`已为 ${batchUser[0].uname || `UID ${batchUser[0]._id}`} 分配 ${selectedPdocs.length} 道题。`);
      setSelectedContributionPids(new Set());
      setBatchUser([]);
      setBatchDataScope(true);
      setBatchTagScope(false);
      setBatchVerifierRole(false);
      setBatchOpen(false);
    } catch (cause) {
      setBatchError(cause instanceof Error ? cause.message : '批量分配失败');
    } finally {
      setBatchBusy(false);
    }
  }

  function requestManagedPublish(event: FormEvent<HTMLFormElement>, title: string, pending: Array<{ uid: number; scope: 'data' | 'tag' }>) {
    const confirmation = event.currentTarget.elements.namedItem('pendingContributionsConfirmed') as HTMLInputElement | null;
    if (confirmation?.value === 'true') return;
    event.preventDefault();
    setPublishConfirm({ form: event.currentTarget, title, pending });
  }

  function confirmManagedPublish() {
    if (!publishConfirm) return;
    const input = publishConfirm.form.elements.namedItem('pendingContributionsConfirmed') as HTMLInputElement | null;
    if (!input) {
      setBatchError('发布确认字段缺失，请刷新页面后重试');
      setPublishConfirm(null);
      return;
    }
    input.value = 'true';
    const form = publishConfirm.form;
    setPublishConfirm(null);
    form.requestSubmit();
  }

  const showBankNav = !!data.canReviewManaged || !!data.canManagePidNamespaces;

  return (
    <main className="w-full min-w-0 overflow-x-clip">
      <Page width="wide">
      <PageHeader
        title="题目"
        description={(
          <>
            <span className="mb-1 block text-xs font-medium text-fg-subtle">统一题库</span>
            当前条件下共 <span className="tabular">{pcount}</span> 道题
          </>
        )}
        actions={(
          <>
            {pdocs.some((pdoc) => canManageContributionsByDocId[String(pdoc.docId)]) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setBatchError('');
                  setBatchVerifierResults(null);
                  setBatchOpen(true);
                }}
                disabled={selectedContributionPids.size === 0}
              >
                <Users />
                批量分配协作{selectedContributionPids.size ? ` · ${selectedContributionPids.size}` : ''}
              </Button>
            ) : null}
            <div className="sm:hidden">
              <Button type="button" variant="secondary" onClick={() => setMobileFiltersOpen(true)}>
                <SlidersHorizontal />
                筛选{filtersActive ? ' · 已启用' : ''}
              </Button>
            </div>
            <ProblemCreationActions {...problemCreationCapabilities} />
          </>
        )}
        tabs={showBankNav ? (
          <ProblemBankNav
            active="problems"
            problemsUrl={bs.urls.problems}
            reviewUrl={String(data.problemReviewUrl || '')}
            canReview={!!data.canReviewManaged}
            namespaceUrl={String(data.pidNamespaceUrl || '')}
            canManageNamespaces={!!data.canManagePidNamespaces}
          />
        ) : undefined}
      />

      {batchMessage ? (
        <p role="status" className="rounded-lg border border-success-line bg-success-soft px-4 py-3 text-sm text-fg">
          {batchMessage}
        </p>
      ) : null}
      {batchError ? (
        <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-fg">
          {batchError}
        </p>
      ) : null}

      <section aria-label="题库筛选" className="hidden sm:block">
        <FilterForm
          action={bs.urls.problems}
          query={query}
          sort={sort}
          filters={filters}
          problemKinds={problemKinds}
          contestOptions={contestOptions}
          pidNamespaces={pidNamespaces}
          canFilterOwner={!!data.canFilterOwner}
          canReviewManaged={!!data.canReviewManaged}
        />
      </section>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="min-h-0">
          <SheetHeader>
            <SheetTitle>筛选题库</SheetTitle>
          </SheetHeader>
          <FilterForm
            action={bs.urls.problems}
            query={query}
            sort={sort}
            filters={filters}
            problemKinds={problemKinds}
            contestOptions={contestOptions}
            pidNamespaces={pidNamespaces}
            canFilterOwner={!!data.canFilterOwner}
            canReviewManaged={!!data.canReviewManaged}
            compact
          />
        </SheetContent>
      </Sheet>

      <section aria-label="题目列表">
        <Panel flush footer={ppcount > 1 ? <Pagination current={page} total={ppcount} baseUrl={problemsBaseUrl} /> : undefined}>
          {(() => {
            const problemEmpty = (
              <EmptyState
                compact
                title="没有符合条件的题目"
                description="调整筛选条件，或创建一道新题。"
                action={filtersActive ? (
                  <Button asChild variant="secondary" size="sm">
                    <a href={bs.urls.problems}>清空筛选</a>
                  </Button>
                ) : undefined}
              />
            );
            const columns: Column<ProblemListDocument>[] = [
              {
                key: 'status',
                header: '状态',
                width: '2.5rem',
                stackRole: 'hidden',
                cell: (pdoc) => <SubmissionStatus status={psdict[String(pdoc.docId)]?.status} />,
              },
              {
                key: 'pick',
                header: '选择',
                width: '2.5rem',
                stackRole: 'hidden',
                cell: (pdoc) => {
                  const docId = String(pdoc.docId);
                  const displayPid = String(pdoc.pid || pdoc.docId);
                  if (!canManageContributionsByDocId[docId]) return <span className="size-4" aria-hidden="true" />;
                  return (
                    <Checkbox
                      size="sm"
                      checked={selectedContributionPids.has(Number(pdoc.docId))}
                      onCheckedChange={(checked) => toggleContributionPid(Number(pdoc.docId), checked)}
                      aria-label={`选择 ${pdoc.title || displayPid} 进行协作分配`}
                    />
                  );
                },
              },
              {
                key: 'pid',
                header: '题号',
                width: '6rem',
                stackRole: 'hidden',
                cell: (pdoc) => <span className="font-mono text-xs text-fg-subtle">{String(pdoc.pid || pdoc.docId)}</span>,
              },
              {
                key: 'title',
                header: '标题',
                stackRole: 'title',
                cell: (pdoc) => {
                  const docId = String(pdoc.docId);
                  const displayPid = String(pdoc.pid || pdoc.docId);
                  const kind = effectiveProblemKind(pdoc);
                  const canReviewManaged = !!managedReviewableByDocId[docId];
                  const canManageContributions = !!canManageContributionsByDocId[docId];
                  const detailUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: displayPid });
                  const status = psdict[docId]?.status;
                  const pendingContributions = pendingContributionsByDocId[docId] || [];
                  return (
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="md:hidden"><SubmissionStatus status={status} /></span>
                        {canManageContributions ? (
                          <span className="md:hidden">
                            <Checkbox
                              size="sm"
                              checked={selectedContributionPids.has(Number(pdoc.docId))}
                              onCheckedChange={(checked) => toggleContributionPid(Number(pdoc.docId), checked)}
                              aria-label={`选择 ${pdoc.title || displayPid} 进行协作分配`}
                            />
                          </span>
                        ) : null}
                        <Badge variant="outline" size="sm">{KIND_LABEL[kind]}</Badge>
                        <a href={detailUrl} className="min-w-0 truncate font-medium text-fg hover:text-brand-fg hover:underline">
                          {pdoc.title || '未命名题目'}
                        </a>
                        <span className="font-mono text-xs text-fg-subtle md:hidden">{displayPid}</span>
                        {canReviewManaged ? (
                          <Badge variant="outline" tone="warning" size="sm">
                            {pdoc.managedAuthoring?.metadataStatus === 'draft' ? '元数据待确认' : '等待重新公开'}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
                        <span>出题人 · {ownerNames[String(pdoc.owner)] || `UID ${pdoc.owner}`}</span>
                        <span className="inline-flex items-center gap-1">
                          {pdoc.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          {pdoc.hidden ? '隐藏' : '已发布'}
                        </span>
                        {pdoc.structureLockedAt ? (
                          <span className="inline-flex items-center gap-1">
                            <LockKeyhole className="size-3.5" />
                            结构已锁定
                          </span>
                        ) : null}
                        {pdoc.archivedAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Archive className="size-3.5" />
                            已归档
                          </span>
                        ) : null}
                      </div>
                      {pdoc.tag?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {(pdoc.tag as string[]).slice(0, 5).map((tag) => (
                            <Badge key={tag} variant="outline" size="sm">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {canReviewManaged ? (
                        <ProblemManagedReview
                          pdoc={pdoc}
                          managedSourceTemplates={managedSourceTemplates}
                          managedTrainingOptions={managedTrainingOptions}
                          pendingContributions={pendingContributions}
                          pendingFingerprint={pendingContributionFingerprintByDocId[docId] || ''}
                          contributionUdict={contributionUdict}
                          onPublish={requestManagedPublish}
                        />
                      ) : null}
                    </div>
                  );
                },
              },
              {
                key: 'difficulty',
                header: '难度',
                width: '5rem',
                stackRole: 'meta',
                cell: (pdoc) => <Difficulty level={problemDifficultyLevel(pdoc.difficulty)} />,
              },
              {
                key: 'actions',
                header: '操作',
                cell: (pdoc) => {
                  const docId = String(pdoc.docId);
                  const displayPid = String(pdoc.pid || pdoc.docId);
                  const canManage = !!canManageByDocId[docId];
                  const canArchive = !!canArchiveByDocId[docId];
                  const canClone = !!canCloneByDocId[docId];
                  const detailUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: displayPid });
                  return (
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <a href={detailUrl}>查看</a>
                      </Button>
                      {canManage ? (
                        <>
                          <Button asChild variant="ghost" size="sm">
                            <a href={`${detailUrl}/edit`}>
                              <Pencil />
                              编辑
                            </a>
                          </Button>
                          {canClone ? (
                            <form method="post">
                              <input type="hidden" name="operation" value="clone" />
                              <input type="hidden" name="pid" value={docId} />
                              <Button type="submit" variant="ghost" size="sm">
                                <Copy />
                                克隆
                              </Button>
                            </form>
                          ) : null}
                          {canArchive && !pdoc.archivedAt ? (
                            <form
                              method="post"
                              onSubmit={(event) => {
                                void confirmFormSubmit(
                                  event,
                                  `归档题目「${pdoc.title || displayPid}」？归档后将强制隐藏。`,
                                  { destructive: true },
                                );
                              }}
                            >
                              <input type="hidden" name="operation" value="archive" />
                              <input type="hidden" name="pid" value={docId} />
                              <input type="hidden" name="reason" value="Archived from problem bank" />
                              <Button type="submit" variant="danger-soft" size="sm">
                                <Archive />
                                归档
                              </Button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                },
              },
            ];
            const titleColumn = columns.find((column) => column.stackRole === 'title');
            if (titleColumn === undefined) {
              throw new TypeError('Problem bank stack layout needs a title column');
            }
            const metaColumn = columns.find((column) => column.stackRole === 'meta');
            const restColumns = columns.filter((column) => column !== titleColumn && column !== metaColumn && column.stackRole !== 'hidden');
            return (
              <>
                <div className="hidden md:block">
                  <DataTable
                    mobile="stack"
                    rows={pdocs}
                    rowKey={(pdoc) => String(pdoc.docId)}
                    empty={problemEmpty}
                    columns={columns}
                  />
                </div>
                <ul className="divide-y divide-line-subtle md:hidden">
                  {pdocs.length === 0 ? <li>{problemEmpty}</li> : pdocs.map((pdoc) => (
                    <li key={String(pdoc.docId)} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex w-full items-start justify-between gap-3">
                        <div className="min-w-0">{titleColumn.cell(pdoc)}</div>
                        {metaColumn ? <div className="shrink-0">{metaColumn.cell(pdoc)}</div> : null}
                      </div>
                      {restColumns.map((column) => (
                        <div key={column.key} className="min-w-0">{column.cell(pdoc)}</div>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
        </Panel>
      </section>

      <Dialog open={batchOpen} onOpenChange={(open) => !batchBusy && setBatchOpen(open)}>
        <DialogContent size="lg" onClose={() => !batchBusy && setBatchOpen(false)}>
          <DialogHeader>
            <DialogTitle>批量分配题目协作</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitContributionBatch}>
            <DialogBody className="space-y-4">
            <p className="text-sm text-fg-muted">只处理本页已明确勾选的 {selectedContributionPids.size} 道题。</p>
            {batchError ? (
              <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-fg">
                {batchError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-xs text-fg-subtle">目标用户</label>
              <MultiSelect<DomainUserOption>
                value={batchUser}
                onChange={(next) => {
                  setBatchVerifierResults(null);
                  setBatchError('');
                  setBatchMessage('');
                  setBatchUser(next.length ? [next[next.length - 1]] : []);
                }}
                loadOptions={async (searchQuery) => {
                  try {
                    return await loadDomainUsers(bs.domain?.id || 'system', searchQuery);
                  } catch (cause) {
                    setBatchError(cause instanceof Error ? cause.message : '用户搜索失败');
                    throw cause;
                  }
                }}
                getKey={(user) => String(user._id)}
                getLabel={domainUserSearchLabel}
                renderChip={(user) => `${user.uname || `uid:${user._id}`} · UID ${user._id}`}
                renderOption={(user) => <DomainUserSearchOption user={user} />}
                placeholder="输入 UID / 用户名 / 邮箱搜索"
                emptyText="没有找到用户"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-fg-subtle">协作类型</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={batchDataScope}
                  onCheckedChange={(checked) => {
                    setBatchVerifierResults(null);
                    setBatchError('');
                    setBatchMessage('');
                    setBatchDataScope(checked);
                    if (checked) setBatchVerifierRole(false);
                  }}
                />
                数据贡献者
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={batchTagScope}
                  onCheckedChange={(checked) => {
                    setBatchVerifierResults(null);
                    setBatchError('');
                    setBatchMessage('');
                    setBatchTagScope(checked);
                    if (checked) setBatchVerifierRole(false);
                  }}
                />
                标签贡献者
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={batchVerifierRole}
                  onCheckedChange={(checked) => {
                    setBatchVerifierResults(null);
                    setBatchError('');
                    setBatchMessage('');
                    setBatchVerifierRole(checked);
                    if (checked) {
                      setBatchDataScope(false);
                      setBatchTagScope(false);
                    }
                  }}
                />
                <span>
                  <span className="block">只读验题人</span>
                  <span className="block text-xs text-fg-subtle">可查看题面、测试数据和提交记录，不能编辑题目。</span>
                </span>
              </label>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="batch-contribution-note" className="text-xs text-fg-subtle">
                备注（可选）
              </label>
              <Input id="batch-contribution-note" name="note" placeholder="会进入任务箱和站内信" />
            </div>
            {batchVerifierResults ? (
              <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">逐题结果</p>
                  <p className="font-mono text-xs text-fg-subtle">{batchVerifierResults.requestId}</p>
                </div>
                {(
                  [
                    ['applied', '已新增'],
                    ['already-present', '已是只读验题人'],
                    ['conflict-higher-role', '已有更高角色，未降级'],
                    ['failed', '失败，可重试'],
                  ] as const
                ).map(([status, label]) => {
                  const items = batchVerifierResults.results.filter((item) => item.status === status);
                  if (!items.length) return null;
                  return (
                    <div key={status} className="space-y-1">
                      <p className="text-xs font-medium text-fg-subtle">
                        {label} · {items.length}
                      </p>
                      <ul className="flex flex-wrap gap-1.5">
                        {items.map((item) => (
                          <li key={item.pid} className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs">
                            {item.publicPid}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={batchBusy} onClick={() => setBatchOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={batchBusy || !selectedContributionPids.size || !batchUser[0] || (!batchVerifierRole && !batchDataScope && !batchTagScope)}
              >
                {batchBusy ? '分配中…' : batchVerifierRole && batchVerifierResults?.retryPids.length ? '重试失败项' : '确认分配'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={publishConfirm !== null} onOpenChange={(open) => !open && setPublishConfirm(null)}>
        <DialogContent size="md" onClose={() => setPublishConfirm(null)}>
          <DialogHeader>
            <DialogTitle>确认发布题目</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-fg-muted text-pretty">确认发布「{publishConfirm?.title || '题目'}」？</p>
            {publishConfirm?.pending.length ? (
              <div className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-fg">
                <p className="font-medium">下列协作任务仍未完成：</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {publishConfirm.pending.map((item, index) => (
                    <li key={`${item.uid}:${item.scope}:${index}`}>
                      {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据贡献' : '标签贡献'}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">继续发布不会完成、撤销或公开这些任务。</p>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPublishConfirm(null)}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={confirmManagedPublish}>
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </Page>
    </main>
  );
}
