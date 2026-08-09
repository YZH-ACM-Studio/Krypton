import { type FormEvent, useState } from 'react';
import { Archive, CheckCircle2, Copy, Eye, EyeOff, LockKeyhole, Pencil, Search, SlidersHorizontal, Users, XCircle } from 'lucide-react';
import { effectiveProblemKind, type ProblemKind } from '@hydrooj/common';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { ManagedPublishProtocolFields } from '@/components/managed-programming-authority';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { ProblemCreationActions } from '@/components/problem-creation-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
  return (
    <form method="get" action={action} className={compact ? 'space-y-4' : 'grid gap-3 lg:grid-cols-4 xl:grid-cols-8'}>
      <label className={compact ? 'block space-y-1.5' : 'space-y-1.5 lg:col-span-2'}>
        <span className="text-xs font-medium text-muted-foreground">关键词或题号</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={query} placeholder="标题、PID、题号或标签" className="min-h-11 pl-9" />
        </span>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">题型</span>
        <SimpleSelect
          name="kind"
          defaultValue={filters.kind || ''}
          className="min-h-11"
          options={[{ value: '', label: '全部题型' }, ...problemKinds.map((item) => ({ value: item.slug, label: KIND_LABEL[item.kind] }))]}
        />
      </label>
      {contestOptions.length ? (
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">所属比赛</span>
          <SimpleSelect
            name="contest"
            defaultValue={filters.contest || ''}
            className="min-h-11"
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
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">题号命名空间</span>
        <SimpleSelect
          name="pidNamespaceId"
          defaultValue={filters.pidNamespaceId || ''}
          className="min-h-11"
          options={[
            { value: '', label: '全部命名空间' },
            ...pidNamespaces.map((namespace) => ({
              value: namespace.namespaceId,
              label: `${namespace.name} · ${namespace.pidPattern}`,
            })),
          ]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">标签</span>
        <Input name="tag" defaultValue={filters.tag || ''} placeholder="精确标签" className="min-h-11" />
      </label>
      {canFilterOwner ? (
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Owner UID</span>
          <Input name="owner" type="number" min={1} defaultValue={filters.owner || ''} placeholder="全部" className="min-h-11" />
        </label>
      ) : null}
      {canReviewManaged ? (
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">托管审核</span>
          <SimpleSelect
            name="managedReview"
            defaultValue={filters.managedReview || 'all'}
            className="min-h-11"
            options={[
              { value: 'all', label: '全部' },
              { value: 'pending', label: '元数据待确认' },
            ]}
          />
        </label>
      ) : null}
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">可见性</span>
        <SimpleSelect
          name="visibility"
          defaultValue={filters.visibility || 'all'}
          className="min-h-11"
          options={[
            { value: 'all', label: '全部' },
            { value: 'hidden', label: '隐藏' },
            { value: 'published', label: '已发布' },
          ]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">生命周期</span>
        <SimpleSelect
          name="lifecycle"
          defaultValue={filters.lifecycle || 'active'}
          className="min-h-11"
          options={[
            { value: 'active', label: '使用中' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部' },
          ]}
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">排序</span>
        <SimpleSelect
          name="sort"
          defaultValue={sort}
          className="min-h-11"
          options={[
            { value: 'default', label: '题号顺序' },
            { value: 'recent', label: '最近创建' },
            { value: 'title', label: '标题 A–Z' },
          ]}
        />
      </label>
      <div className={compact ? 'flex gap-2 pt-1' : 'flex items-end gap-2'}>
        <Button type="submit" className="min-h-11 flex-1">
          应用
        </Button>
        <Button asChild type="button" variant="ghost" className="min-h-11">
          <a href={action}>清空</a>
        </Button>
      </div>
    </form>
  );
}

function SubmissionStatus({ status }: { status?: number }) {
  if (status === 1) return <CheckCircle2 className="size-4 text-emerald-600" aria-label="已通过" />;
  if (status === 2) return <XCircle className="size-4 text-rose-600" aria-label="未通过" />;
  return <span className="size-4" aria-hidden="true" />;
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

  return (
    <main className="w-full min-w-0 space-y-6 overflow-x-clip pb-12">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">统一题库</p>
          <h1 className="text-3xl font-semibold tracking-tight">题目</h1>
          <p className="text-sm text-muted-foreground">当前条件下共 {pcount} 道题</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pdocs.some((pdoc) => canManageContributionsByDocId[String(pdoc.docId)]) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBatchError('');
                setBatchVerifierResults(null);
                setBatchOpen(true);
              }}
              disabled={selectedContributionPids.size === 0}
            >
              <Users className="size-4" />
              批量分配协作{selectedContributionPids.size ? ` · ${selectedContributionPids.size}` : ''}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="sm:hidden" onClick={() => setMobileFiltersOpen(true)}>
            <SlidersHorizontal className="size-4" />
            筛选{filtersActive ? ' · 已启用' : ''}
          </Button>
          <ProblemCreationActions {...problemCreationCapabilities} />
        </div>
      </header>

      <ProblemBankNav
        active="problems"
        problemsUrl={bs.urls.problems}
        reviewUrl={String(data.problemReviewUrl || '')}
        canReview={!!data.canReviewManaged}
        namespaceUrl={String(data.pidNamespaceUrl || '')}
        canManageNamespaces={!!data.canManagePidNamespaces}
      />

      {batchMessage ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {batchMessage}
        </p>
      ) : null}
      {batchError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {batchError}
        </p>
      ) : null}

      <section aria-label="题库筛选" className="hidden rounded-2xl bg-muted/45 p-4 sm:block">
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
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>筛选题库</SheetTitle>
          </SheetHeader>
          <div className="p-5">
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
          </div>
        </SheetContent>
      </Sheet>

      <section aria-label="题目列表" className="overflow-hidden rounded-2xl border border-border/80 bg-background">
        {pdocs.length === 0 ? (
          <div className="grid min-h-56 place-items-center px-6 py-12 text-center">
            <div className="space-y-2">
              <p className="font-medium">没有符合条件的题目</p>
              <p className="text-sm text-muted-foreground">调整筛选条件，或创建一道新题。</p>
              {filtersActive ? (
                <Button asChild variant="outline" size="sm">
                  <a href={bs.urls.problems}>清空筛选</a>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {pdocs.map((pdoc) => {
              const docId = String(pdoc.docId);
              const displayPid = String(pdoc.pid || pdoc.docId);
              const kind = effectiveProblemKind(pdoc);
              const canManage = !!canManageByDocId[docId];
              const canArchive = !!canArchiveByDocId[docId];
              const canManageContributions = !!canManageContributionsByDocId[docId];
              const canClone = !!canCloneByDocId[docId];
              const canReviewManaged = !!managedReviewableByDocId[docId];
              const detailUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: displayPid });
              const status = psdict[docId]?.status;
              const sourceTemplate = managedSourceTemplates.find((template) => template.id === pdoc.sourceMeta?.template);
              const sourceFields = managedSourceFieldViews(pdoc.sourceMeta, sourceTemplate);
              const pendingPlacement = pdoc.managedAuthoring?.pendingTrainingPlacement;
              const pendingTraining = managedTrainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
              const pendingChapter = pendingTraining?.chapters?.find((chapter) => chapter.id === pendingPlacement?.chapterId);
              const pendingContributions = pendingContributionsByDocId[docId] || [];
              return (
                <li key={docId} className="px-4 py-4 sm:px-5">
                  <div className="grid min-w-0 gap-3 sm:grid-cols-[1.2rem_1.2rem_minmax(0,1fr)_auto] sm:items-center">
                    <SubmissionStatus status={status} />
                    {canManageContributions ? (
                      <Checkbox
                        size="sm"
                        checked={selectedContributionPids.has(Number(pdoc.docId))}
                        onCheckedChange={(checked) => toggleContributionPid(Number(pdoc.docId), checked)}
                        aria-label={`选择 ${pdoc.title || displayPid} 进行协作分配`}
                      />
                    ) : (
                      <span className="size-3.5" aria-hidden="true" />
                    )}
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-normal">
                          {KIND_LABEL[kind]}
                        </Badge>
                        <a href={detailUrl} className="min-w-0 truncate font-medium hover:text-primary hover:underline">
                          {pdoc.title || '未命名题目'}
                        </a>
                        <span className="font-mono text-xs text-muted-foreground">{displayPid}</span>
                        {canReviewManaged ? (
                          <Badge variant="outline">{pdoc.managedAuthoring?.metadataStatus === 'draft' ? '元数据待确认' : '等待重新公开'}</Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Owner · {ownerNames[String(pdoc.owner)] || `UID ${pdoc.owner}`}</span>
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
                            <Badge key={tag} variant="outline" className="font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {canReviewManaged ? (
                        <section className="mt-3 space-y-3 rounded-xl border border-primary/20 bg-primary/[0.025] p-4" aria-label="托管草稿审核">
                          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                            <span>
                              工作标题 · <strong className="font-medium text-foreground">{pdoc.managedAuthoring?.workingTitle || '—'}</strong>
                            </span>
                            {sourceFields.map((field) => (
                              <span key={field.label}>
                                {field.label} · <strong className="font-medium text-foreground">{field.value}</strong>
                              </span>
                            ))}
                            {pdoc.managedAuthoring?.metadataStatus === 'draft' ? (
                              <span>
                                待挂训练 ·{' '}
                                <strong className="font-medium text-foreground">
                                  {pendingPlacement
                                    ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                                    : '不挂入训练'}
                                </strong>
                              </span>
                            ) : null}
                          </div>
                          {pendingContributions.length ? (
                            <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                              <p className="font-medium">仍有 {pendingContributions.length} 项协作任务待完成，发布不会自动完成或撤销这些任务。</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {pendingContributions.map((item, index) => (
                                  <Badge key={`${item.uid}:${item.scope}:${index}`} variant="outline">
                                    {contributionUdict[item.uid]?.uname || `UID ${item.uid}`} · {item.scope === 'data' ? '数据' : '标签'}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <form
                            method="post"
                            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
                            onSubmit={(event) => requestManagedPublish(event, pdoc.title || displayPid, pendingContributions)}
                          >
                            <ManagedPublishProtocolFields docId={pdoc.docId} expectedStructureRevision={pdoc.structureRevision} />
                            <input type="hidden" name="pendingContributionsConfirmed" value="false" />
                            <input type="hidden" name="pendingContributionFingerprint" value={pendingContributionFingerprintByDocId[docId] || ''} />
                            <label className="space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">正式标题</span>
                              <Input
                                name="formalTitle"
                                defaultValue={
                                  pdoc.managedAuthoring?.metadataStatus === 'draft'
                                    ? pdoc.managedAuthoring?.workingTitle || ''
                                    : pdoc.title || pdoc.managedAuthoring?.workingTitle || ''
                                }
                                required
                                className="min-h-10"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">难度</span>
                              <SimpleSelect
                                name="difficulty"
                                defaultValue={String(pdoc.difficulty ?? 0)}
                                className="min-h-10"
                                options={Array.from({ length: 11 }, (_, value) => ({
                                  value: String(value),
                                  label: value === 0 ? '未设置' : String(value),
                                }))}
                              />
                            </label>
                            <Button type="submit" className="min-h-10">
                              {pdoc.managedAuthoring?.metadataStatus === 'draft' ? '确认并发布' : '重新公开'}
                            </Button>
                          </form>
                        </section>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <Button asChild variant="ghost" size="sm">
                        <a href={detailUrl}>查看</a>
                      </Button>
                      {canManage ? (
                        <>
                          <Button asChild variant="ghost" size="sm">
                            <a href={`${detailUrl}/edit`}>
                              <Pencil className="size-3.5" />
                              编辑
                            </a>
                          </Button>
                          {canClone ? (
                            <form method="post">
                              <input type="hidden" name="operation" value="clone" />
                              <input type="hidden" name="pid" value={docId} />
                              <Button type="submit" variant="ghost" size="sm">
                                <Copy className="size-3.5" />
                                克隆
                              </Button>
                            </form>
                          ) : null}
                          {canArchive && !pdoc.archivedAt ? (
                            <form
                              method="post"
                              onSubmit={(event) => {
                                if (!window.confirm(`归档题目「${pdoc.title || displayPid}」？归档后将强制隐藏。`)) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="operation" value="archive" />
                              <input type="hidden" name="pid" value={docId} />
                              <input type="hidden" name="reason" value="Archived from problem bank" />
                              <Button type="submit" variant="ghost" size="sm">
                                <Archive className="size-3.5" />
                                归档
                              </Button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Pagination current={page} total={ppcount} baseUrl={problemsBaseUrl} />

      <Dialog open={batchOpen} onOpenChange={(open) => !batchBusy && setBatchOpen(open)}>
        <DialogContent className="w-full sm:w-[580px]" onClose={() => !batchBusy && setBatchOpen(false)}>
          <DialogHeader>
            <DialogTitle>批量分配题目协作</DialogTitle>
          </DialogHeader>
          <form className="space-y-4 p-5" onSubmit={submitContributionBatch}>
            <p className="text-sm text-muted-foreground">只处理本页已明确勾选的 {selectedContributionPids.size} 道题。</p>
            {batchError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {batchError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">目标用户</label>
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
              <legend className="text-xs text-muted-foreground">协作类型</legend>
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
                  <span className="block text-xs leading-5 text-muted-foreground">可查看题面、测试数据和提交记录，不能编辑题目。</span>
                </span>
              </label>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="batch-contribution-note" className="text-xs text-muted-foreground">
                备注（可选）
              </label>
              <Input id="batch-contribution-note" name="note" placeholder="会进入任务箱和站内信" />
            </div>
            {batchVerifierResults ? (
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">逐题结果</p>
                  <p className="font-mono text-xs text-muted-foreground">{batchVerifierResults.requestId}</p>
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
                      <p className="text-xs font-medium text-muted-foreground">
                        {label} · {items.length}
                      </p>
                      <ul className="flex flex-wrap gap-1.5">
                        {items.map((item) => (
                          <li key={item.pid} className="rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-xs">
                            {item.publicPid}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" disabled={batchBusy} onClick={() => setBatchOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={batchBusy || !selectedContributionPids.size || !batchUser[0] || (!batchVerifierRole && !batchDataScope && !batchTagScope)}
              >
                {batchBusy ? '分配中…' : batchVerifierRole && batchVerifierResults?.retryPids.length ? '重试失败项' : '确认分配'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={publishConfirm !== null} onOpenChange={(open) => !open && setPublishConfirm(null)}>
        <DialogContent className="w-full sm:w-[520px]" onClose={() => setPublishConfirm(null)}>
          <DialogHeader>
            <DialogTitle>确认发布题目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">确认发布「{publishConfirm?.title || '题目'}」？</p>
            {publishConfirm?.pending.length ? (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPublishConfirm(null)}>
                取消
              </Button>
              <Button type="button" onClick={confirmManagedPublish}>
                确认发布
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
