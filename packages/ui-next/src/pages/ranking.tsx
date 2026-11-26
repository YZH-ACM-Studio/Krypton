import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ActivityRankingPage } from '@hydrooj/common/activity-ranking';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { SimpleSelect } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatPlainTextSummary, makeInitials, replaceRouteTokens } from '@/lib/format';
import { ActivityRanking, RankCell, RankingTabs } from './ranking-activity';
import { rankingShowsExternalRatingColumns } from './ranking-external-rating';

type ExternalRatingSiteId = 'codeforces' | 'nowcoder';

/** Ranking serializer may attach a public CF / Nowcoder number, or omit the site. */
interface RankingUser extends GenericUserDoc {
  avatarUrl?: string;
  nAccept?: number;
  rank?: number | string;
  rpInfo?: Record<string, unknown>;
  externalRating?: unknown;
  externalRatings?: unknown;
}

interface RankingFilters {
  q?: string;
  schoolId?: string;
  groupId?: string;
  binding?: string;
}

interface RankingPageData {
  activity?: ActivityRankingPage;
  canFilterRanking?: boolean;
  filters?: RankingFilters;
  schools?: { id: string; name: string }[];
  groups?: { id: string; schoolId: string; name: string }[];
  sort?: string;
  order?: 'asc' | 'desc';
  pageSize?: number;
  ucount?: number;
  page?: string | number;
  upcount?: string | number;
  rpcount?: string | number;
  udocs?: RankingUser[];
  ranked?: number[];
  rpDefinitions?: Record<string, { hidden?: boolean }>;
  self?: RankingUser | null;
  studentDict?: Record<string, { studentId: string; realName: string }>;
  /** Optional uid → public rating map. Handler name is externalRatingByUid. */
  externalRatingByUid?: unknown;
  externalRating?: unknown;
  externalRatings?: unknown;
}

interface RankingTableRow {
  key: string;
  user: RankingUser;
  rank: number | string;
  current: boolean;
  studentInfo?: { studentId: string; realName: string } | null;
  cfRating?: number;
  nowcoderRating?: number;
}

const RP_LABELS: Record<string, string> = {
  problem: '题目 RP',
  contest: '比赛 RP',
};

const EXTERNAL_RATING_SITE_IDS: ExternalRatingSiteId[] = ['codeforces', 'nowcoder'];

const EXTERNAL_RATING_SITE_LABEL: Record<ExternalRatingSiteId, string> = {
  codeforces: 'CF',
  nowcoder: '牛客',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIncludedPublicRating(raw: unknown): { included: boolean; rating?: number } {
  if (raw === undefined) return { included: false };
  if (raw === null) return { included: true };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { included: true, rating: raw };
  if (isRecord(raw)) {
    // Canonical / owner snapshots keep publicShow and lastError. Ranking only
    // renders serializer-cropped public numbers, never those private fields.
    if ('publicShow' in raw || 'lastError' in raw) return { included: false };
    if ('rating' in raw) return readIncludedPublicRating(raw.rating);
  }
  return { included: false };
}

function wrappedRatingView(source: unknown): Record<string, unknown> | null {
  if (!isRecord(source)) return null;
  if (isRecord(source.externalRating)) return source.externalRating;
  if (isRecord(source.externalRatings)) return source.externalRatings;
  return null;
}

function perRowRatingView(user: RankingUser): unknown {
  if (user.externalRating !== undefined) return user.externalRating;
  if (user.externalRatings !== undefined) return user.externalRatings;
  return undefined;
}

function readPublicRatingFromView(view: unknown, site: ExternalRatingSiteId): { included: boolean; rating?: number } {
  if (view === undefined) return { included: false };
  const nested = wrappedRatingView(view);
  const siteMap = nested ?? (isRecord(view) ? view : null);
  if (!siteMap) return { included: false };
  return readIncludedPublicRating(siteMap[site]);
}

function readPublicRatingDicts(data: RankingPageData): unknown[] {
  return [data.externalRatingByUid, data.externalRatings, data.externalRating];
}

function readPagePublicRating(
  user: RankingUser,
  site: ExternalRatingSiteId,
  pageDicts: unknown[],
): { included: boolean; rating?: number } {
  const uid = String(user._id);
  for (const dict of pageDicts) {
    if (!isRecord(dict) || !Object.hasOwn(dict, uid)) continue;
    return readPublicRatingFromView(dict[uid], site);
  }
  return { included: false };
}

function readUserPublicRating(
  user: RankingUser,
  site: ExternalRatingSiteId,
  pageDicts: unknown[],
): { included: boolean; rating?: number } {
  const perRow = perRowRatingView(user);
  if (perRow !== undefined) {
    const fromPerRow = readPublicRatingFromView(perRow, site);
    if (fromPerRow.included) return fromPerRow;
  } else {
    const fromTopLevel = readIncludedPublicRating(user[site]);
    if (fromTopLevel.included) return fromTopLevel;
  }
  return readPagePublicRating(user, site, pageDicts);
}

function formatPublicRating(rating: number | undefined): string {
  return typeof rating === 'number' ? String(Math.round(rating)) : '—';
}

function getRpDetail(user: RankingUser, key: string) {
  const value = user?.rpInfo?.[key];
  return typeof value === 'number' ? Math.round(value) : '—';
}

export function rankingUrl(baseUrl: string, sort: SortState, filters: RankingFilters = {}) {
  const url = new URL(baseUrl, 'https://krypton.invalid');
  url.searchParams.delete('page');
  url.searchParams.set('sort', sort.key);
  url.searchParams.set('order', sort.dir);
  for (const key of ['q', 'schoolId', 'groupId', 'binding'] as const) {
    const value = filters[key]?.trim();
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}`;
}

function userRankFallback(page: number, index: number, pageSize: number) {
  return (page - 1) * pageSize + index + 1;
}

export function RankingPage() {
  const data = useBootstrap().page.data as RankingPageData;
  return data.activity ? <ActivityRanking activity={data.activity} /> : <RpRanking data={data} />;
}

function RpRanking({ data }: { data: RankingPageData }) {
  const bs = useBootstrap();
  const page = Number(data.page) || 1;
  const upcount = Number(data.upcount || data.rpcount) || 1;
  const users = data.udocs || [];
  const ranked: number[] = data.ranked || [];
  const fallbackUsers = ranked.map((uid) => bs.udict[String(uid)] as RankingUser).filter(Boolean);
  const rows = users.length ? users : fallbackUsers;
  const rpDefinitions = data.rpDefinitions || {};
  const rpKeys = Object.entries(rpDefinitions)
    .filter(([, def]) => !def.hidden)
    .map(([key]) => key);
  const self = data.self || null;
  const studentDict = data.studentDict || {};
  const canFilterRanking = data.canFilterRanking === true;
  const hasStudentColumn = canFilterRanking;
  const filters = canFilterRanking ? data.filters || {} : {};
  const schools = canFilterRanking ? data.schools || [] : [];
  const groups = canFilterRanking ? data.groups || [] : [];
  const sort: SortState = { key: data.sort || 'rp', dir: data.order === 'asc' ? 'asc' : 'desc' };
  const [search, setSearch] = useState(filters.q || '');
  const [schoolId, setSchoolId] = useState(filters.schoolId || '');
  const [groupId, setGroupId] = useState(filters.groupId || '');
  const [binding, setBinding] = useState(filters.binding || '');
  const filtered = Object.values(filters).some(Boolean);
  const pageUrl = rankingUrl(bs.urls.ranking, sort, filters);
  const clearUrl = rankingUrl(bs.urls.ranking, sort);
  const publicRatingDicts = readPublicRatingDicts(data);
  const hasExternalRatingColumns = rankingShowsExternalRatingColumns(data);
  const [bioUser, setBioUser] = useState<RankingUser | null>(null);

  const toRow = (user: RankingUser, rank: number | string, current: boolean, key: string): RankingTableRow => ({
    key,
    user,
    rank,
    current: current || user._id === bs.user.id,
    studentInfo: hasStudentColumn ? (studentDict[String(user._id)] ?? null) : undefined,
    cfRating: readUserPublicRating(user, 'codeforces', publicRatingDicts).rating,
    nowcoderRating: readUserPublicRating(user, 'nowcoder', publicRatingDicts).rating,
  });

  const tableRows: RankingTableRow[] = [
    ...(self ? [toRow(self, self.rank || '—', true, `self-${self._id}`)] : []),
    ...rows.map((user, index) => toRow(user, user.rank || userRankFallback(page, index, Number(data.pageSize) || 100), false, `row-${user._id}-${index}`)),
  ];

  const columns: Column<RankingTableRow>[] = [
    {
      key: 'rank',
      header: '#',
      align: 'center',
      width: '4rem',
      cell: (row) => <RankCell rank={row.rank} />,
    },
    {
      key: 'user',
      header: '用户',
      cell: (row) => (
        <a href={replaceRouteTokens(bs.urls.userDetail, { UID: String(row.user._id) })} className="flex min-w-0 items-center gap-2 text-fg hover:text-brand-fg">
          <Avatar className="size-8">
            {row.user.avatarUrl ? <AvatarImage src={String(row.user.avatarUrl)} alt={String(row.user.uname || '')} /> : null}
            <AvatarFallback className="text-2xs">{makeInitials(row.user.uname || '?')}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{row.user.uname || `#${row.user._id}`}</span>
          {row.current ? <Badge tone="neutral" size="sm">我</Badge> : null}
        </a>
      ),
    },
    ...(hasStudentColumn
      ? [{
          key: 'student',
          header: '学号 / 姓名',
          width: '8rem',
          cell: (row: RankingTableRow) => (
            row.studentInfo ? (
              <>
                <div className="font-mono text-xs">{row.studentInfo.studentId}</div>
                <div className="text-xs text-fg-subtle">{row.studentInfo.realName}</div>
              </>
            ) : (
              <span className="text-fg-subtle">—</span>
            )
          ),
        } satisfies Column<RankingTableRow>]
      : []),
    {
      key: 'rp',
      header: 'RP',
      align: 'right',
      width: '5rem',
      cell: (row) => <span className="tabular font-medium">{Math.round(Number(row.user.rp || 0))}</span>,
    },
    ...rpKeys.map((key) => ({
      key: `rp:${key}`,
      header: RP_LABELS[key] || key,
      align: 'right' as const,
      width: '6rem',
      cell: (row: RankingTableRow) => <span className="tabular text-fg-muted">{getRpDetail(row.user, key)}</span>,
    })),
    ...(hasExternalRatingColumns
      ? EXTERNAL_RATING_SITE_IDS.map((site) => ({
          key: site,
          header: EXTERNAL_RATING_SITE_LABEL[site],
          align: 'right' as const,
          width: '5rem',
          cell: (row: RankingTableRow) => (
            <span className="tabular text-fg-muted">
              {formatPublicRating(site === 'codeforces' ? row.cfRating : row.nowcoderRating)}
            </span>
          ),
        }))
      : []),
    {
      key: 'ac',
      header: 'AC',
      align: 'right',
      width: '5rem',
      cell: (row) => <span className="tabular">{row.user.nAccept ?? 0}</span>,
    },
    {
      key: 'bio',
      header: '简介',
      cell: (row) => {
        const bioPreview = formatPlainTextSummary(row.user.bio);
        if (!bioPreview) return <span className="block truncate text-fg-subtle">—</span>;
        return (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto max-w-full justify-start truncate px-0"
            title="点击查看完整简介"
            onClick={() => setBioUser(row.user)}
          >
            {bioPreview}
          </Button>
        );
      },
    },
  ];

  return (
    <Page width="wide">
      <PageHeader title="排名" description="按本域 RP 排名，可点列表头切换排序。" tabs={<RankingTabs board="rp" />} />

      {canFilterRanking ? (
        <form method="get" action={bs.urls.ranking} aria-label="排名筛选">
          <input type="hidden" name="board" value="rp" />
          <input type="hidden" name="sort" value={sort.key} />
          <input type="hidden" name="order" value={sort.dir} />
          <Toolbar end={typeof data.ucount === 'number' ? <span className="text-sm text-fg-subtle">共 {data.ucount} 人</span> : undefined}>
            <SearchInput
              name="q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="用户名、UID、学号或姓名"
              aria-label="搜索排名用户"
              maxLength={200}
              className="w-full sm:w-72"
            />
            <SimpleSelect
              name="schoolId"
              ariaLabel="学校"
              className="w-40"
              value={schoolId}
              onValueChange={(value) => {
                setSchoolId(value);
                if (value && !groups.some((group) => group.id === groupId && group.schoolId === value)) setGroupId('');
              }}
              options={[{ value: '', label: '全部学校' }, ...schools.map((school) => ({ value: school.id, label: school.name }))]}
            />
            <SimpleSelect
              name="groupId"
              ariaLabel="用户组"
              className="w-48"
              value={groupId}
              onValueChange={setGroupId}
              options={[{ value: '', label: '全部用户组' }, ...groups.filter((group) => !schoolId || group.schoolId === schoolId)
                .map((group) => ({ value: group.id, label: group.name }))]}
            />
            <SimpleSelect
              name="binding"
              ariaLabel="绑定状态"
              className="w-36"
              value={binding}
              onValueChange={setBinding}
              options={[{ value: '', label: '全部绑定状态' }, { value: 'bound', label: '已绑定' }, { value: 'unbound', label: '未绑定' }]}
            />
            <Button type="submit" variant="primary">筛选</Button>
            <Button asChild variant="ghost"><a href={clearUrl}>清除筛选</a></Button>
          </Toolbar>
        </form>
      ) : null}

      <Panel flush>
        <DataTable
          mobile="scroll"
          columns={columns.map((column) => ({ ...column, sortable: true }))}
          sort={sort}
          onSort={(next) => window.location.assign(rankingUrl(bs.urls.ranking, next, filters))}
          rows={tableRows}
          rowKey={(row) => row.key}
          empty={<EmptyState
compact
title={filtered ? '没有匹配的用户' : '暂无排名数据'}
            action={filtered ? <Button asChild variant="secondary"><a href={clearUrl}>清除筛选</a></Button> : undefined} />}
        />
      </Panel>

      <Pagination current={page} total={upcount} baseUrl={pageUrl} />

      <Dialog open={!!bioUser} onOpenChange={(open) => !open && setBioUser(null)}>
        <DialogContent size="xl" onClose={() => setBioUser(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Avatar className="size-8">
                {bioUser?.avatarUrl ? <AvatarImage src={String(bioUser.avatarUrl)} alt={bioUser?.uname || ''} /> : null}
                <AvatarFallback className="text-2xs">{makeInitials(bioUser?.uname || '?')}</AvatarFallback>
              </Avatar>
              <span>{bioUser?.uname || '用户'}</span>
              <span className="text-xs font-normal text-fg-muted">· 个人简介</span>
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {bioUser?.bio ? (
              <MarkdownView content={bioUser.bio} preferredLang={bs.locale} />
            ) : (
              <p className="text-sm text-fg-muted">该用户暂无简介</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button asChild variant="primary" size="sm">
              <a href={replaceRouteTokens(bs.urls.userDetail, { UID: String(bioUser?._id || '') })}>
                查看完整资料
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
