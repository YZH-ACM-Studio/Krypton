/**
 * /permits/inbox — per-problem collaboration inbox.
 *
 * Backed by krypton-permits `MyVerifyInboxHandler` (returns the user's
 * permit rows plus joined problem/granter/contest dicts). Organized as a
 * DESIGN.md §5.1 list page with category tabs, search/filter toolbar,
 * pending-first data/tag contribution panels, direct invitation roles, and
 * contest-level verification groups.
 */
import { parseDate } from '@hydrooj/common';
import {
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  Inbox,
  Lock,
  LogOut,
  MoreHorizontal,
  Pencil,
  Send,
  Trophy,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { SendProblemToCph } from '@/components/competitive-companion-bridge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { confirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Difficulty } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { createRequestId } from '@/lib/request-id';

type PermitRole = 'verifier' | 'author' | 'maintainer';
type ContributionScope = 'data' | 'tag';
type ContributionStatus = 'pending' | 'completed';
type InboxTab = 'all' | 'contributions' | 'direct' | 'contests';
type ScopeFilter = 'all' | ContributionScope;
type RoleFilter = 'all' | PermitRole;

interface PermitRow {
  _id: string;
  pid: number;
  uid: number;
  role: PermitRole;
  grantedBy: number;
  grantedAt: string;
  viaContest: string | null;
  note: string;
}

interface ContributionRow {
  _id: string;
  pid: number;
  uid: number;
  scope: ContributionScope;
  active: boolean;
  status: ContributionStatus;
  note?: string;
  assignedBy: number;
  assignedAt: string;
  firstCompletedAt?: string;
}

interface UserMini {
  _id?: number;
  uname: string;
}

interface ProblemMini {
  docId?: number;
  pid?: string;
  title: string;
  hidden?: boolean;
  lockHidden?: boolean;
  difficulty?: number;
  authoringMode?: 'managed';
}

interface ContestMini {
  _id: string;
  title: string;
}

interface InboxPageData {
  permits: PermitRow[];
  contributions: ContributionRow[];
  pdict: Record<string, ProblemMini | undefined>;
  udict: Record<string, UserMini | undefined>;
  tdict: Record<string, ContestMini | undefined>;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const RELATIVE_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const EMPTY_INBOX_DATA: InboxPageData = {
  permits: [],
  contributions: [],
  pdict: Object.create(null) as Record<string, ProblemMini | undefined>,
  udict: Object.create(null) as Record<string, UserMini | undefined>,
  tdict: Object.create(null) as Record<string, ContestMini | undefined>,
};

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'data', label: '数据' },
  { value: 'tag', label: '标签' },
];

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: '全部角色' },
  { value: 'verifier', label: '验题人' },
  { value: 'author', label: '出题人' },
  { value: 'maintainer', label: '维护者' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asIdString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (isRecord(value) && typeof value.$oid === 'string' && value.$oid.trim().length > 0) {
    return value.$oid.trim();
  }
  throw new Error(`${label}格式不正确`);
}

function asOptionalIdString(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return asIdString(value, label);
}

function asPositiveInt(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`${label}格式不正确`);
}

function asOptionalPositiveInt(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asPositiveInt(value, label);
}

function asOptionalNonNegativeInt(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`${label}格式不正确`);
}

function asOptionalString(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  throw new Error(`${label}格式不正确`);
}

function asOptionalDateText(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  if (isRecord(value) && value.$date !== undefined) {
    return asOptionalDateText(value.$date, label);
  }
  throw new Error(`${label}格式不正确`);
}

function parsePermitRole(value: unknown): PermitRole {
  if (value === 'maintainer' || value === 'author' || value === 'verifier') return value;
  throw new Error('协作角色字段格式不正确');
}

function parseContributionScope(value: unknown): ContributionScope {
  if (value === 'data' || value === 'tag') return value;
  throw new Error('贡献任务类型字段格式不正确');
}

function parseContributionStatus(value: unknown): ContributionStatus {
  if (value === 'pending' || value === 'completed') return value;
  throw new Error('贡献任务状态字段格式不正确');
}

function parsePermits(raw: unknown): PermitRow[] {
  if (!Array.isArray(raw)) throw new Error('协作权限列表格式不正确');
  return raw.map((entry) => {
    if (!isRecord(entry)) throw new Error('协作权限条目格式不正确');
    return {
      _id: asIdString(entry._id, '协作权限编号'),
      pid: asPositiveInt(entry.pid, '题目编号'),
      uid: asOptionalNonNegativeInt(entry.uid, '协作用户编号'),
      role: parsePermitRole(entry.role),
      grantedBy: asOptionalNonNegativeInt(entry.grantedBy, '邀请人编号'),
      grantedAt: asOptionalDateText(entry.grantedAt, '邀请时间'),
      viaContest: asOptionalIdString(entry.viaContest, '比赛来源'),
      note: asOptionalString(entry.note, '邀请附言'),
    };
  });
}

function parseContributions(raw: unknown): ContributionRow[] {
  if (!Array.isArray(raw)) throw new Error('贡献任务列表格式不正确');
  return raw.map((entry) => {
    if (!isRecord(entry)) throw new Error('贡献任务条目格式不正确');
    if (typeof entry.active !== 'boolean') throw new Error('贡献任务有效状态格式不正确');
    const note = asOptionalString(entry.note, '贡献附言');
    const firstCompletedAt = asOptionalDateText(entry.firstCompletedAt, '首次完成时间');
    return {
      _id: asIdString(entry._id, '贡献任务编号'),
      pid: asPositiveInt(entry.pid, '贡献题目编号'),
      uid: asOptionalNonNegativeInt(entry.uid, '任务执行人编号'),
      scope: parseContributionScope(entry.scope),
      active: entry.active,
      status: parseContributionStatus(entry.status),
      note: note.length > 0 ? note : undefined,
      assignedBy: asOptionalNonNegativeInt(entry.assignedBy, '分配人编号'),
      assignedAt: asOptionalDateText(entry.assignedAt, '分配时间'),
      firstCompletedAt: firstCompletedAt.length > 0 ? firstCompletedAt : undefined,
    };
  });
}

function parseProblemDict(raw: unknown): Record<string, ProblemMini | undefined> {
  if (!isRecord(raw)) throw new Error('题目字典格式不正确');
  const dict = Object.create(null) as Record<string, ProblemMini | undefined>;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new Error('题目字典条目格式不正确');
    const pid = asOptionalString(value.pid, '题号');
    dict[key] = {
      docId: asOptionalPositiveInt(value.docId, '题目文档编号'),
      pid: pid.length > 0 ? pid : undefined,
      title: asOptionalString(value.title, '题目标题'),
      hidden: value.hidden === true,
      lockHidden: value.lockHidden === true,
      difficulty: typeof value.difficulty === 'number' && Number.isFinite(value.difficulty) ? value.difficulty : undefined,
      authoringMode: value.authoringMode === 'managed' ? 'managed' : undefined,
    };
  }
  return dict;
}

function parseUserDict(raw: unknown): Record<string, UserMini | undefined> {
  if (!isRecord(raw)) throw new Error('用户字典格式不正确');
  const dict = Object.create(null) as Record<string, UserMini | undefined>;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new Error('用户字典条目格式不正确');
    dict[key] = {
      _id: value._id === undefined || value._id === null ? undefined : asOptionalNonNegativeInt(value._id, '用户编号'),
      uname: asOptionalString(value.uname, '用户名'),
    };
  }
  return dict;
}

function parseContestDict(raw: unknown): Record<string, ContestMini | undefined> {
  if (!isRecord(raw)) throw new Error('比赛字典格式不正确');
  const dict = Object.create(null) as Record<string, ContestMini | undefined>;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new Error('比赛字典条目格式不正确');
    const id = value._id === undefined || value._id === null ? key : asIdString(value._id, '比赛编号');
    dict[key] = {
      _id: id,
      title: asOptionalString(value.title, '比赛标题'),
    };
  }
  return dict;
}

function parseInboxData(raw: unknown): ParseResult<InboxPageData> {
  try {
    if (!isRecord(raw)) throw new Error('页面未返回有效的协作数据，请刷新重试。');
    return {
      ok: true,
      value: {
        permits: parsePermits(raw.permits),
        contributions: parseContributions(raw.contributions),
        pdict: parseProblemDict(raw.pdict),
        udict: parseUserDict(raw.udict),
        tdict: parseContestDict(raw.tdict),
      },
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error && cause.message ? cause.message : '协作数据格式不正确，请刷新重试。',
    };
  }
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function roleLabel(role: PermitRole): string {
  if (role === 'maintainer') return '维护者';
  if (role === 'author') return '出题人';
  return '验题人';
}

function contestLeaveCopy(roles: ReadonlySet<PermitRole>): {
  buttonLabel: string;
  confirmTitleSuffix: string;
  permissionNoun: string;
} {
  if (roles.size === 1 && roles.has('maintainer')) {
    return {
      buttonLabel: '退出本场维护',
      confirmTitleSuffix: '维护者角色',
      permissionNoun: '维护权限',
    };
  }
  if (roles.size === 1 && roles.has('verifier')) {
    return {
      buttonLabel: '退出本场验题',
      confirmTitleSuffix: '验题角色',
      permissionNoun: '验题权限',
    };
  }
  return {
    buttonLabel: '退出本场协作',
    confirmTitleSuffix: '比赛协作角色',
    permissionNoun: '协作权限',
  };
}

function formatProblemCode(problem: ProblemMini | undefined, fallbackPid: number): string {
  return String(problem?.pid || problem?.docId || fallbackPid);
}

function formatProblemLabel(problem: ProblemMini | undefined, fallbackPid: number): string {
  const code = formatProblemCode(problem, fallbackPid);
  return problem?.title ? `${code} ${problem.title}` : code;
}

function formatActorLabel(actor: UserMini | undefined, uid: number, verb: string): string | null {
  const uname = actor?.uname.trim();
  if (uname) return `${uname} ${verb}`;
  if (uid > 0) return `UID ${uid} ${verb}`;
  return null;
}

function validDifficultyLevel(value: number | undefined): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10) return value;
  return null;
}

function matchesInboxQuery(
  normalizedQuery: string,
  problem: ProblemMini | undefined,
  fallbackPid: number,
  actor: UserMini | undefined,
  note?: string,
  contestTitle?: string,
): boolean {
  if (!normalizedQuery) return true;
  const parts = [
    problem?.pid,
    problem?.docId,
    fallbackPid,
    problem?.title,
    actor?.uname,
    note,
    contestTitle,
  ];
  return parts.some((part) => part !== undefined && part !== null && String(part).toLowerCase().includes(normalizedQuery));
}

function InboxTime({ value, prefix }: { value?: string; prefix?: string }) {
  if (!value) return null;
  const parsed = parseDate(value);
  if (!parsed) return null;
  const useRelative = Math.abs(Date.now() - parsed.getTime()) < RELATIVE_TIME_WINDOW_MS;
  return (
    <span>
      {prefix ? `${prefix} ` : null}
      <DateTime value={parsed} mode={useRelative ? 'relative' : 'datetime'} />
    </span>
  );
}

function InlineMeta({
  items,
  as = 'span',
  className,
}: {
  items: ReactNode[];
  as?: 'span' | 'p';
  className?: string;
}) {
  const present = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (present.length === 0) return null;
  const Comp = as;
  return (
    <Comp className={className ? `flex min-w-0 flex-wrap items-center gap-x-1.5 ${className}` : 'flex min-w-0 flex-wrap items-center gap-x-1.5'}>
      {present.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-x-1.5">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {item}
        </span>
      ))}
    </Comp>
  );
}

export function MyVerifyInboxPage() {
  const bs = useBootstrap();
  const parsed = useMemo(() => parseInboxData(bs.page.data), [bs.page.data]);
  const [tab, setTab] = useState<InboxTab>('all');
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [actionError, setActionError] = useState('');
  const [completing, setCompleting] = useState('');
  const [leavingKey, setLeavingKey] = useState('');
  const [expandedCompleted, setExpandedCompleted] = useState<Record<ContributionScope, boolean>>({
    data: false,
    tag: false,
  });
  const [searchCollapsedCompleted, setSearchCollapsedCompleted] = useState<Record<ContributionScope, boolean>>({
    data: false,
    tag: false,
  });

  const data = parsed.ok ? parsed.value : EMPTY_INBOX_DATA;
  const direct = (data.permits || []).filter((p) => !p.viaContest);
  const contributions = (data.contributions || []).filter((row) => row.active);

  // Group contest permits by tid
  const byContest = new Map<string, PermitRow[]>();
  for (const p of data.permits || []) {
    if (!p.viaContest) continue;
    const list = byContest.get(p.viaContest);
    if (list) list.push(p);
    else byContest.set(p.viaContest, [p]);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredContributions = contributions.filter((row) =>
    matchesInboxQuery(normalizedQuery, data.pdict[row.pid], row.pid, data.udict[row.assignedBy], row.note),
  );
  const filteredDirect = direct.filter((p) =>
    matchesInboxQuery(normalizedQuery, data.pdict[p.pid], p.pid, data.udict[p.grantedBy], p.note),
  );
  const filteredByContest = new Map<string, PermitRow[]>();
  for (const [tid, rows] of byContest.entries()) {
    const contestTitle = data.tdict[tid]?.title || tid;
    const matched = rows.filter((p) =>
      matchesInboxQuery(normalizedQuery, data.pdict[p.pid], p.pid, data.udict[p.grantedBy], p.note, contestTitle),
    );
    if (matched.length > 0) filteredByContest.set(tid, matched);
  }

  const contestPermitCount = Array.from(byContest.values()).reduce((sum, rows) => sum + rows.length, 0);
  const totalCount = contributions.length + direct.length + contestPermitCount;
  const empty = direct.length === 0 && byContest.size === 0 && contributions.length === 0;

  const showContributions = tab === 'all' || tab === 'contributions';
  const showDirect = tab === 'all' || tab === 'direct';
  const showContests = tab === 'all' || tab === 'contests';

  const visibleContributions = showContributions
    ? filteredContributions.filter((row) => tab !== 'contributions' || scopeFilter === 'all' || row.scope === scopeFilter)
    : [];
  const visibleDirect = showDirect
    ? filteredDirect.filter((p) => tab !== 'direct' || roleFilter === 'all' || p.role === roleFilter)
    : [];
  const visibleContestCount = showContests
    ? Array.from(filteredByContest.values()).reduce((sum, rows) => sum + rows.length, 0)
    : 0;
  const visiblePendingContributions = visibleContributions.filter((row) => row.status === 'pending').length;
  const visibleTotal = visibleContributions.length + visibleDirect.length + visibleContestCount;
  const hasActiveFilter =
    normalizedQuery.length > 0
    || (tab === 'contributions' && scopeFilter !== 'all')
    || (tab === 'direct' && roleFilter !== 'all');

  function clearFilters() {
    setQuery('');
    setScopeFilter('all');
    setRoleFilter('all');
    setSearchCollapsedCompleted({ data: false, tag: false });
  }

  async function revoke(permit: PermitRow) {
    if (leavingKey) return;
    const problem = data.pdict[permit.pid];
    const confirmed = await confirmDialog(
      '退出后将失去该题目的协作访问权限，如需恢复须由管理员或出题人重新邀请。',
      {
        title: `退出「${formatProblemLabel(problem, permit.pid)}」的${roleLabel(permit.role)}角色？`,
        confirmLabel: '退出角色',
        destructive: true,
      },
    );
    if (!confirmed) return;
    setLeavingKey(permit._id);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('permitId', permit._id);
      const r = await fetchHydroResponse(`/p/${permit.pid}/permits/revoke`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(await readHydroResponseError(r, '退出协作失败'));
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '退出协作失败');
    } finally {
      setLeavingKey('');
    }
  }

  async function revokeViaContest(tid: string, contestTitle: string, count: number, roles: ReadonlySet<PermitRole>) {
    if (leavingKey) return;
    const copy = contestLeaveCopy(roles);
    const confirmed = await confirmDialog(
      `这会同时撤销你通过本场比赛获得的全部 ${formatCount(count)} 道题目${copy.permissionNoun}。`,
      {
        title: `退出「${contestTitle}」的${copy.confirmTitleSuffix}？`,
        confirmLabel: copy.buttonLabel,
        destructive: true,
      },
    );
    if (!confirmed) return;
    setLeavingKey(`contest:${tid}`);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('uid', String(bs.user.id));
      const r = await fetchHydroResponse(`/contest/${tid}/verifiers/remove`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(await readHydroResponseError(r, '退出协作失败'));
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '退出协作失败');
    } finally {
      setLeavingKey('');
    }
  }

  async function complete(row: ContributionRow) {
    if (completing) return;
    const key = `${row.pid}:${row.scope}`;
    setCompleting(key);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('scope', row.scope);
      fd.set('status', 'completed');
      fd.set('requestId', createRequestId());
      const response = await fetchHydroResponse(`/p/${row.pid}/contributions/status`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, '标记完成失败'));
      }
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '标记完成失败');
      setCompleting('');
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        title="我的出题协作"
        description="出题角色与数据、标签贡献任务都集中在这里；完成仅记录工作进度。"
        tabs={
          parsed.ok && !empty ? (
            <PageTabs<InboxTab>
              aria-label="协作分类"
              value={tab}
              onValueChange={setTab}
              items={[
                { value: 'all', label: '全部', count: totalCount },
                { value: 'contributions', label: '贡献任务', count: contributions.length },
                { value: 'direct', label: '直接邀请', count: direct.length },
                { value: 'contests', label: '比赛验题', count: contestPermitCount },
              ]}
            />
          ) : undefined
        }
      />

      {!parsed.ok ? (
        <Alert tone="danger" title="协作数据加载异常">
          {parsed.error}
        </Alert>
      ) : null}

      {parsed.ok && !empty ? (
        <Toolbar
          end={
            <span className="text-sm text-fg-subtle tabular">
              {`共 ${formatCount(visibleTotal)} 项${
                showContributions && visiblePendingContributions > 0
                  ? ` · ${formatCount(visiblePendingContributions)} 项贡献待完成`
                  : ''
              }`}
            </span>
          }
        >
          <SearchInput
            className="w-full sm:w-72"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchCollapsedCompleted({ data: false, tag: false });
            }}
            placeholder="搜索题号、标题、邀请人或附言…"
            aria-label="搜索协作任务"
          />
          {tab === 'contributions' ? (
            <MiniTabs<ScopeFilter>
              aria-label="贡献类型"
              size="md"
              value={scopeFilter}
              onValueChange={setScopeFilter}
              items={SCOPE_OPTIONS}
            />
          ) : null}
          {tab === 'direct' ? (
            <SimpleSelect
              className="w-32 shrink-0"
              ariaLabel="按角色筛选"
              value={roleFilter}
              onValueChange={(next) => {
                if (next === 'all' || next === 'verifier' || next === 'author' || next === 'maintainer') {
                  setRoleFilter(next);
                }
              }}
              options={ROLE_OPTIONS}
            />
          ) : null}
        </Toolbar>
      ) : null}

      {parsed.ok && actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {parsed.ok && empty ? (
        <Panel>
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            title="还没有任何题目协作邀请"
            description="当你被邀请担任验题人、出题人，或收到数据与标签分工任务时，会出现在这里。"
          />
        </Panel>
      ) : null}

      {parsed.ok && !empty && visibleTotal === 0 ? (
        <Panel>
          <EmptyState
            title={hasActiveFilter ? '没有匹配的协作任务' : '当前分类下还没有协作任务'}
            description={
              hasActiveFilter ? '尝试更换关键词或清除筛选条件。' : '切换「全部」查看其它协作邀请，或等待新的分工与邀请。'
            }
            action={
              hasActiveFilter ? (
                <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : null}

      {parsed.ok && showContributions
        ? (['data', 'tag'] as const).map((scope) => {
            if (tab === 'contributions' && scopeFilter !== 'all' && scopeFilter !== scope) return null;
            const scoped = filteredContributions.filter((row) => row.scope === scope);
            const pending = scoped.filter((row) => row.status === 'pending');
            const completed = scoped.filter((row) => row.status === 'completed');
            if (!scoped.length) return null;
            const title = scope === 'data' ? '数据贡献任务' : '标签贡献任务';
            const isSearching = normalizedQuery.length > 0;
            const completedOpen = isSearching ? !searchCollapsedCompleted[scope] : expandedCompleted[scope];
            return (
              <Panel
                key={scope}
                flush
                title={title}
                description={
                  <span className="tabular">{`${formatCount(pending.length)} 待完成 · ${formatCount(completed.length)} 已完成`}</span>
                }
              >
                {pending.length ? (
                  <ul className="divide-y divide-line-subtle">
                    {pending.map((row) => {
                      const key = `${row.pid}:${row.scope}`;
                      return (
                        <ContributionRowItem
                          key={row._id}
                          row={row}
                          pdict={data.pdict}
                          udict={data.udict}
                          completing={completing === key}
                          busyCompleting={completing.length > 0}
                          onComplete={() => {
                            void complete(row);
                          }}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-xs text-fg-subtle">当前没有待完成任务</p>
                )}
                {completed.length ? (
                  <details
                    className="group border-t border-line-subtle bg-surface-sunken/60"
                    open={completedOpen}
                    onToggle={(event) => {
                      const nextOpen = event.currentTarget.open;
                      if (isSearching) {
                        const nextCollapsed = !nextOpen;
                        setSearchCollapsedCompleted((prev) => (prev[scope] === nextCollapsed ? prev : { ...prev, [scope]: nextCollapsed }));
                      } else {
                        setExpandedCompleted((prev) => (prev[scope] === nextOpen ? prev : { ...prev, [scope]: nextOpen }));
                      }
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-fg-subtle outline-none transition-colors duration-(--dur-1) ease-(--ease-standard) hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        className="size-3.5 shrink-0 transition-transform duration-(--dur-1) ease-(--ease-standard) group-open:rotate-90"
                        aria-hidden="true"
                      />
                      <span className="tabular">{`查看已完成任务（${formatCount(completed.length)}）`}</span>
                    </summary>
                    <ul className="divide-y divide-line-subtle border-t border-line-subtle bg-surface">
                      {completed.map((row) => (
                        <ContributionRowItem
                          key={row._id}
                          row={row}
                          pdict={data.pdict}
                          udict={data.udict}
                          completing={false}
                          busyCompleting={false}
                        />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Panel>
            );
          })
        : null}

      {parsed.ok && showDirect && visibleDirect.length > 0 ? (
        <Panel
          flush
          title="直接邀请"
          description={<span className="tabular">{`${formatCount(visibleDirect.length)} 题 · 单题协作权限`}</span>}
        >
          <ul className="divide-y divide-line-subtle">
            {visibleDirect.map((p) => (
              <PermitRowItem
                key={p._id}
                permit={p}
                pdict={data.pdict}
                udict={data.udict}
                inContest={false}
                busyLeaving={leavingKey.length > 0}
                onRevoke={() => {
                  void revoke(p);
                }}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {parsed.ok && showContests
        ? Array.from(filteredByContest.entries()).map(([tid, rows]) => {
            const contest = data.tdict[tid];
            const contestTitle = contest?.title || tid;
            const allContestRows = byContest.get(tid) ?? rows;
            const primaryRow = allContestRows[0];
            const contestTotal = allContestRows.length;
            const contestRoles = new Set<PermitRole>(allContestRows.map((row) => row.role));
            const headerRole = contestRoles.size === 1 ? primaryRow?.role : undefined;
            const leaveCopy = contestLeaveCopy(contestRoles);
            const granter = primaryRow ? data.udict[primaryRow.grantedBy] : undefined;
            const actorLabel = primaryRow ? formatActorLabel(granter, primaryRow.grantedBy, '邀请') : null;
            const leavingThisContest = leavingKey === `contest:${tid}`;
            const busyLeaving = leavingKey.length > 0;
            const countText =
              rows.length < contestTotal
                ? `${formatCount(rows.length)} / ${formatCount(contestTotal)} 题`
                : `${formatCount(contestTotal)} 题`;
            const headerMeta: ReactNode[] = [
              actorLabel ? <span>{actorLabel}</span> : null,
              primaryRow?.grantedAt && parseDate(primaryRow.grantedAt) ? <InboxTime value={primaryRow.grantedAt} /> : null,
            ];
            return (
              <Panel
                key={tid}
                flush
                title={
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Trophy className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                    <a href={`/contest/${tid}`} className="min-w-0 break-words text-brand-fg hover:underline">
                      {contestTitle}
                    </a>
                    {headerRole ? (
                      <Badge variant="outline" size="sm">
                        {roleLabel(headerRole)}
                      </Badge>
                    ) : null}
                    <span className="text-xs font-normal text-fg-subtle tabular">{countText}</span>
                  </span>
                }
                description={
                  primaryRow ? (
                    <span className="block min-w-0">
                      <InlineMeta items={headerMeta} />
                      {primaryRow.note ? (
                        <span className="mt-0.5 block truncate text-fg-muted" title={primaryRow.note}>
                          {primaryRow.note}
                        </span>
                      ) : null}
                    </span>
                  ) : undefined
                }
                actions={
                  <>
                    <Button asChild size="sm" variant="secondary">
                      <a href={`/contest/${tid}`}>
                        <ExternalLink />
                        进入比赛
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger-soft"
                      loading={leavingThisContest}
                      disabled={busyLeaving}
                      onClick={() => {
                        void revokeViaContest(tid, contestTitle, contestTotal, contestRoles);
                      }}
                    >
                      {leaveCopy.buttonLabel}
                    </Button>
                  </>
                }
              >
                <ul className="divide-y divide-line-subtle">
                  {rows.map((p) => (
                    <PermitRowItem
                      key={p._id}
                      permit={p}
                      pdict={data.pdict}
                      udict={data.udict}
                      inContest
                      contestHeader={primaryRow ? { role: headerRole, grantedBy: primaryRow.grantedBy, note: primaryRow.note } : undefined}
                      busyLeaving={busyLeaving}
                    />
                  ))}
                </ul>
              </Panel>
            );
          })
        : null}
    </Page>
  );
}

function ContributionRowItem({
  row,
  pdict,
  udict,
  completing,
  busyCompleting,
  onComplete,
}: {
  row: ContributionRow;
  pdict: Record<string, ProblemMini | undefined>;
  udict: Record<string, UserMini | undefined>;
  completing: boolean;
  busyCompleting: boolean;
  onComplete?: () => void;
}) {
  const p = pdict[row.pid];
  const assigner = udict[row.assignedBy];
  const pidText = formatProblemCode(p, row.pid);
  const problemHref = `/p/${pidText}`;
  const actorLabel = formatActorLabel(assigner, row.assignedBy, '分配');
  const metaItems: ReactNode[] = [
    actorLabel ? <span>{actorLabel}</span> : null,
    row.assignedAt && parseDate(row.assignedAt) ? <InboxTime value={row.assignedAt} /> : null,
    row.firstCompletedAt && parseDate(row.firstCompletedAt) ? <InboxTime value={row.firstCompletedAt} prefix="首次完成于" /> : null,
  ];
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-fg-subtle tabular">{pidText}</span>
          <a href={`${problemHref}/edit`} className="min-w-0 break-words text-sm font-medium text-fg hover:text-brand-fg hover:underline">
            {p?.title || '题目'}
          </a>
          <Badge variant="outline" size="sm">
            {row.scope === 'data' ? '数据' : '标签'}
          </Badge>
          {row.status === 'completed' ? (
            <Badge tone="success" size="sm">
              已完成
            </Badge>
          ) : null}
        </div>
        <InlineMeta as="p" items={metaItems} className="mt-1 text-xs text-fg-subtle" />
        {row.note ? (
          <p className="mt-1 truncate text-xs text-fg-muted" title={row.note}>
            {row.note}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SendProblemToCph href={problemHref} compact />
        <Button asChild size="sm" variant="ghost">
          <a href={`${problemHref}?ide=1`}>
            <Code2 />
            IDE
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={`${problemHref}/submit`}>
            <Send />
            提交
          </a>
        </Button>
        {onComplete ? (
          <Button type="button" size="sm" variant="soft" onClick={onComplete} loading={completing} disabled={busyCompleting}>
            <Check />
            标记完成
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function PermitRowItem({
  permit,
  pdict,
  udict,
  inContest,
  contestHeader,
  busyLeaving,
  onRevoke,
}: {
  permit: PermitRow;
  pdict: Record<string, ProblemMini | undefined>;
  udict: Record<string, UserMini | undefined>;
  inContest: boolean;
  contestHeader?: { role?: PermitRole; grantedBy: number; note: string };
  busyLeaving: boolean;
  onRevoke?: () => void;
}) {
  const p = pdict[permit.pid];
  const granter = udict[permit.grantedBy];
  const pidText = formatProblemCode(p, permit.pid);
  const titleText = p?.title || '题目';
  const menuTargetLabel = p?.title ? `${pidText} ${titleText}` : `${pidText} 题目`;
  const problemHref = `/p/${pidText}`;
  const canEdit = permit.role === 'author' || permit.role === 'maintainer';
  const lockedMaintainer = !inContest && permit.role === 'maintainer' && p?.authoringMode === 'managed';
  const difficulty = validDifficultyLevel(p?.difficulty);
  const showRoleBadge = !inContest || (contestHeader !== undefined && contestHeader.role !== permit.role);
  const showDistinctContestActor = inContest && contestHeader !== undefined && permit.grantedBy !== contestHeader.grantedBy;
  const showDistinctContestNote = inContest && contestHeader !== undefined && permit.note.length > 0 && permit.note !== contestHeader.note;

  // Collect inline badges and cap to at most 3 per DESIGN.md §6.14 ("多了用「+N」").
  const inlineBadges: { key: string; label: string; node: ReactNode }[] = [];
  if (showRoleBadge) {
    const label = roleLabel(permit.role);
    inlineBadges.push({
      key: 'role',
      label,
      node: (
        <Badge key="role" variant="outline" size="sm">
          {label}
        </Badge>
      ),
    });
  }
  if (p?.lockHidden === true) {
    inlineBadges.push({
      key: 'lock',
      label: '锁定',
      node: (
        <Badge key="lock" tone="danger" size="sm">
          <Lock className="size-3" aria-hidden="true" />
          锁定
        </Badge>
      ),
    });
  }
  if (difficulty !== null) {
    inlineBadges.push({
      key: 'difficulty',
      label: `难度 ${difficulty}`,
      node: <Difficulty key="difficulty" level={difficulty} />,
    });
  }
  if (p?.hidden === true) {
    inlineBadges.push({
      key: 'hidden',
      label: '隐藏',
      node: (
        <Badge key="hidden" tone="warning" size="sm">
          <EyeOff className="size-3" aria-hidden="true" />
          隐藏
        </Badge>
      ),
    });
  }

  const visibleBadges = inlineBadges.length <= 3 ? inlineBadges.map((item) => item.node) : [
    ...inlineBadges.slice(0, 2).map((item) => item.node),
    <Badge key="overflow" variant="outline" size="sm" title={inlineBadges.slice(2).map((item) => item.label).join('、')}>
      {`+${inlineBadges.length - 2}`}
    </Badge>,
  ];

  const menuItems: (MenuItem | 'separator')[] = [
    { label: '查看题面', icon: <Eye />, href: problemHref },
    ...(canEdit ? [{ label: '在 IDE 中打开', icon: <Code2 />, href: `${problemHref}?ide=1` }] : []),
    { label: '独立提交页', icon: <Send />, href: `${problemHref}/submit` },
  ];
  if (!inContest) {
    const footerItem: MenuItem | null = lockedMaintainer
      ? { label: '托管维护者需管理员撤销', disabled: true }
      : onRevoke
        ? { label: '退出此题协作', icon: <LogOut />, danger: true, disabled: busyLeaving, onSelect: onRevoke }
        : null;
    if (footerItem) {
      menuItems.push('separator', footerItem);
    }
  }

  const actorLabel = formatActorLabel(granter, permit.grantedBy, '邀请');
  const directMetaItems: ReactNode[] = [
    actorLabel ? <span>{actorLabel}</span> : null,
    permit.grantedAt && parseDate(permit.grantedAt) ? <InboxTime value={permit.grantedAt} /> : null,
    lockedMaintainer ? <span>需管理员撤销</span> : null,
  ];
  const contestRowMetaItems: ReactNode[] = showDistinctContestActor && actorLabel ? [<span>{actorLabel}</span>] : [];
  const rowNote = !inContest ? permit.note : showDistinctContestNote ? permit.note : '';

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-fg-subtle tabular">{pidText}</span>
          <a href={problemHref} className="min-w-0 break-words text-sm font-medium text-fg hover:text-brand-fg hover:underline">
            {titleText}
          </a>
          {visibleBadges}
        </div>
        {!inContest ? (
          <InlineMeta as="p" items={directMetaItems} className="mt-1 text-xs text-fg-subtle" />
        ) : (
          <InlineMeta as="p" items={contestRowMetaItems} className="mt-1 text-xs text-fg-subtle" />
        )}
        {rowNote ? (
          <p className="mt-1 truncate text-xs text-fg-muted" title={rowNote}>
            {rowNote}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {canEdit ? (
          <Button asChild size="sm" variant="secondary">
            <a href={`${problemHref}/edit`}>
              <Pencil />
              编辑
            </a>
          </Button>
        ) : (
          <Button asChild size="sm" variant="secondary">
            <a href={`${problemHref}?ide=1`}>
              <Code2 />
              IDE
            </a>
          </Button>
        )}
        <Menu
          label={`更多操作：${menuTargetLabel}`}
          placement="bottom-end"
          trigger={(menuProps) => (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              iconOnly
              aria-haspopup="menu"
              aria-label={`更多操作：${menuTargetLabel}`}
              title="更多操作"
              disabled={busyLeaving}
              {...menuProps}
            >
              <MoreHorizontal />
            </Button>
          )}
          items={menuItems}
        />
      </div>
    </li>
  );
}
