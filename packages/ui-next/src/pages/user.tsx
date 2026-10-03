/**
 * User detail page — Cloudflare / shadcn profile:
 *   - Full-width header: avatar | identity + badges | actions
 *   - Bio, KPI, 外站 Rating, then a full-width GitHub-style heatmap
 *   - xl split: completions + contests | meta + contacts + solutions
 *   - CF / 牛客 charts consume server `externalRatingHistory` only (no browser fetch)
 */
import { useState, type ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  Calendar,
  Clipboard,
  Globe,
  Hash,
  Mail,
  MessageSquare,
  Network,
  Settings as SettingsIcon,
  Trophy,
  User as UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EChart, type KryptonEChartsOption } from '@/components/ui/echart';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SimpleSelect } from '@/components/ui/select';
import { Progress, Stat } from '@/components/ui/display';
import { Page, PageHeader } from '@/components/ui/page';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatDateTime, makeInitials, replaceRouteTokens, toDate } from '@/lib/format';

interface UserProfileDocument {
  _id?: string | number;
  uname?: string;
  rp?: number;
  bio?: string;
  nAccept?: number;
  nSubmit?: number;
  loginat?: unknown;
  mail?: string;
  qq?: string;
  wechat?: string;
  avatar?: string;
  avatarUrl?: string;
  displayName?: string;
  role?: string;
  rank?: string | number;
  regat?: unknown;
  timezone?: string;
}

interface UserContestDocument {
  docId?: string | number;
  title?: string;
  rule?: string;
}

interface UserSolutionDocument {
  _id?: string | number;
  parentId?: string | number;
  title?: string;
  vote?: number;
}

interface UserStudentBinding {
  bound?: boolean;
  realName?: string;
  studentId?: string;
  schoolName?: string | null;
}

interface UserSetting {
  key: string;
  name?: string;
  desc?: string;
  type?: string;
  range?: Record<string, unknown>;
}

interface UserSession {
  _id?: string | number;
  userAgent?: string;
  updateAt?: unknown;
}

interface UserMessage {
  _id?: string | number;
  from?: string;
  updateAt?: unknown;
  content?: string;
}

interface ProfileCompletionItem {
  id: string;
  title: string;
  count: number;
  href?: string;
  subtitle?: string;
}

type ExternalRatingSiteId = 'codeforces' | 'nowcoder';

/** Client-safe CF / 牛客 snapshot. Not Hydro RP. */
interface ExternalRatingSiteView {
  handle?: string;
  rating?: number | null;
  fetchedAt?: unknown;
  lastError?: string | null;
  publicShow?: boolean;
  stale?: boolean;
}

interface ExternalRatingSiteEntry extends ExternalRatingSiteView {
  site?: string;
  id?: string;
}

interface ExternalRatingViewerFlags {
  isSelf?: boolean;
  isTeacherOrAdmin?: boolean;
  viewerIsTeacher?: boolean;
}

interface ExternalRatingPayload {
  viewerIsSelf?: boolean;
  viewerIsTeacher?: boolean;
  isSelf?: boolean;
  isTeacherOrAdmin?: boolean;
  viewerRole?: string;
  viewer?: ExternalRatingViewerFlags;
  externalRatingCanEdit?: boolean;
  codeforces?: ExternalRatingSiteView | null;
  nowcoder?: ExternalRatingSiteView | null;
  sites?: ExternalRatingSiteEntry[];
}

/** Server-projected contest history. Visibility is already applied; do not fetch. */
interface ExternalRatingHistoryPoint {
  ratedAt: string;
  rating: number;
  contestName?: string;
}

type ExternalRatingHistoryBySite = Record<ExternalRatingSiteId, ExternalRatingHistoryPoint[]>;

interface UserPageData {
  udoc?: UserProfileDocument;
  sdoc?: { updateAt?: unknown };
  pdocs?: unknown[];
  tags?: Array<[string, number]>;
  problemSetCompletions?: ProfileCompletionItem[];
  knowledgeNodeCompletions?: ProfileCompletionItem[];
  tdocs?: UserContestDocument[];
  psdocs?: UserSolutionDocument[];
  pdict?: Record<string, { title?: string }>;
  isSelfProfile?: boolean;
  viewerIsSelf?: boolean;
  viewerIsTeacher?: boolean;
  isSelf?: boolean;
  isTeacherOrAdmin?: boolean;
  viewerRole?: string;
  /** Server-computed; true for bound self or teacher/admin. viewerIsTeacher is never sent. */
  externalRatingCanEdit?: boolean;
  studentBinding?: UserStudentBinding | null;
  daily?: Record<string, number>;
  settings?: UserSetting[];
  current?: Record<string, unknown>;
  page_name?: string;
  sessions?: UserSession[];
  mdocs?: UserMessage[];
  codeforces?: ExternalRatingSiteView | null;
  nowcoder?: ExternalRatingSiteView | null;
  externalRating?: ExternalRatingPayload | null;
  externalRatings?: ExternalRatingPayload | null;
  /** Viewer-filtered CF / 牛客 history. Hidden sites are omitted by the server. */
  externalRatingHistory?: unknown;
}

const EXTERNAL_RATING_SITE_IDS: ExternalRatingSiteId[] = ['codeforces', 'nowcoder'];

const EXTERNAL_RATING_SITE_LABEL: Record<ExternalRatingSiteId, string> = {
  codeforces: 'Codeforces',
  nowcoder: '牛客',
};

const EXTERNAL_RATING_ERROR_TEXT: Record<string, string> = {
  not_found: '未找到该用户',
  timeout: '抓取超时',
  http_error: '外站 HTTP 错误',
  api_error: '外站接口错误',
  parse_failed: '页面解析失败',
  network_error: '网络错误',
  network: '网络错误',
  rate_limited: '刷新过于频繁',
  invalid_handle: '账号不合法',
  malformed: '返回数据无法解析',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUnknownField(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function isTrueFlag(value: unknown): boolean {
  return value === true;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

function readOptionalRating(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function readExternalRatingSiteId(value: unknown): ExternalRatingSiteId | null {
  if (value === 'codeforces' || value === 'nowcoder') return value;
  return null;
}

function unwrapDateValue(value: unknown): unknown {
  if (!isRecord(value) || !('$date' in value)) return value;
  return value.$date;
}

function readExternalRatingSiteView(value: unknown): ExternalRatingSiteView | null {
  if (!isRecord(value)) return null;
  const view: ExternalRatingSiteView = {};
  const handle = readOptionalString(value.handle);
  const rating = readOptionalRating(value.rating);
  const lastError = readOptionalString(value.lastError);
  if (handle !== undefined) view.handle = handle;
  if (rating !== undefined) view.rating = rating;
  if (value.fetchedAt !== undefined) view.fetchedAt = value.fetchedAt;
  if (lastError !== undefined) view.lastError = lastError;
  if (value.publicShow === true) view.publicShow = true;
  else if (value.publicShow === false) view.publicShow = false;
  if (value.stale === true) view.stale = true;
  return view;
}

function collectExternalRatingSites(payload: Record<string, unknown>): Array<{ id: ExternalRatingSiteId; view: ExternalRatingSiteView }> {
  const found = new Map<ExternalRatingSiteId, ExternalRatingSiteView>();
  const codeforces = readExternalRatingSiteView(payload.codeforces);
  const nowcoder = readExternalRatingSiteView(payload.nowcoder);
  if (codeforces) found.set('codeforces', codeforces);
  if (nowcoder) found.set('nowcoder', nowcoder);
  if (Array.isArray(payload.sites)) {
    for (const item of payload.sites) {
      if (!isRecord(item)) continue;
      const id = readExternalRatingSiteId(item.site) ?? readExternalRatingSiteId(item.id);
      if (!id || found.has(id)) continue;
      const view = readExternalRatingSiteView(item);
      if (view) found.set(id, view);
    }
  }
  const sites: Array<{ id: ExternalRatingSiteId; view: ExternalRatingSiteView }> = [];
  for (const id of EXTERNAL_RATING_SITE_IDS) {
    const view = found.get(id);
    if (view) sites.push({ id, view });
  }
  return sites;
}

function readViewerFlagSource(source: unknown): { viewerIsSelf: boolean; viewerIsTeacher: boolean } {
  if (!isRecord(source)) return { viewerIsSelf: false, viewerIsTeacher: false };
  const nestedViewer = isRecord(source.viewer) ? source.viewer : null;
  return {
    viewerIsSelf:
      isTrueFlag(source.viewerIsSelf) || isTrueFlag(source.isSelf) || isTrueFlag(nestedViewer?.isSelf),
    viewerIsTeacher:
      isTrueFlag(source.viewerIsTeacher)
      || isTrueFlag(source.isTeacherOrAdmin)
      || isTrueFlag(nestedViewer?.isTeacherOrAdmin)
      || isTrueFlag(nestedViewer?.viewerIsTeacher),
  };
}

function readExternalRatingView(data: UserPageData): {
  viewerIsSelf: boolean;
  viewerIsTeacher: boolean;
  canEdit: boolean;
  sites: Array<{ id: ExternalRatingSiteId; view: ExternalRatingSiteView }>;
} {
  const raw: unknown = data.externalRating ?? data.externalRatings ?? readUnknownField(data.udoc, 'externalRating') ?? null;
  const payload: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const pageCodeforces: unknown = data.codeforces;
  const pageNowcoder: unknown = data.nowcoder;
  if (payload.codeforces == null && pageCodeforces != null) payload.codeforces = pageCodeforces;
  if (payload.nowcoder == null && pageNowcoder != null) payload.nowcoder = pageNowcoder;
  const fromPage = readViewerFlagSource(data);
  const fromPayload = readViewerFlagSource(payload);
  return {
    viewerIsSelf: fromPage.viewerIsSelf || fromPayload.viewerIsSelf,
    viewerIsTeacher: fromPage.viewerIsTeacher || fromPayload.viewerIsTeacher,
    canEdit: isTrueFlag(data.externalRatingCanEdit) || isTrueFlag(payload.externalRatingCanEdit),
    sites: collectExternalRatingSites(payload),
  };
}

function hasExternalRatingSiteContent(
  view: ExternalRatingSiteView,
  includeError: boolean,
  history: ExternalRatingHistoryPoint[],
): boolean {
  if (view.handle) return true;
  if (typeof view.rating === 'number') return true;
  if (toDate(unwrapDateValue(view.fetchedAt))) return true;
  if (includeError && !!view.lastError) return true;
  // Unset handle clears the snapshot but not injected history.
  return history.length >= 1;
}

function isExternalRatingSiteVisible(
  view: ExternalRatingSiteView,
  canViewPrivate: boolean,
  history: ExternalRatingHistoryPoint[],
): boolean {
  if (canViewPrivate) return hasExternalRatingSiteContent(view, true, history);
  // Strangers never see lastError. Hidden sites stay hidden even if history sneaks in.
  // The public projection already dropped hidden sites and omits the flag.
  if (view.publicShow === false) return false;
  return hasExternalRatingSiteContent(view, false, history);
}

function formatExternalRatingValue(rating: number | null | undefined): string {
  if (typeof rating === 'number') return String(Math.round(rating));
  return '—';
}

function formatExternalRatingLastError(lastError: string): string {
  return EXTERNAL_RATING_ERROR_TEXT[lastError] || lastError;
}

function emptyExternalRatingHistory(): ExternalRatingHistoryBySite {
  return { codeforces: [], nowcoder: [] };
}

function readRatedAt(value: unknown): string | undefined {
  const text = readOptionalString(value);
  if (text) return text;
  const date = toDate(unwrapDateValue(value));
  return date ? date.toISOString() : undefined;
}

function readExternalRatingHistoryPoints(value: unknown): ExternalRatingHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  const points: ExternalRatingHistoryPoint[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const ratedAt = readRatedAt(item.ratedAt);
    const rating = readOptionalRating(item.rating);
    if (ratedAt === undefined || typeof rating !== 'number') continue;
    const contestName = readOptionalString(item.contestName);
    const point: ExternalRatingHistoryPoint = { ratedAt, rating };
    if (contestName) point.contestName = contestName;
    points.push(point);
  }
  return points;
}

function readExternalRatingHistoryBySite(raw: unknown): ExternalRatingHistoryBySite {
  if (!isRecord(raw)) return emptyExternalRatingHistory();
  return {
    codeforces: readExternalRatingHistoryPoints(raw.codeforces),
    nowcoder: readExternalRatingHistoryPoints(raw.nowcoder),
  };
}

function readTooltipRating(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && typeof value[1] === 'number' && Number.isFinite(value[1])) return value[1];
  return undefined;
}

function formatExternalRatingTooltip(raw: unknown, points: ExternalRatingHistoryPoint[]): string {
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!isRecord(item)) return '';
  const index = typeof item.dataIndex === 'number' ? item.dataIndex : -1;
  const point = index >= 0 && index < points.length ? points[index] : undefined;
  const ratedAt = point?.ratedAt ?? (typeof item.axisValue === 'string' ? item.axisValue : '');
  const rating = point?.rating ?? readTooltipRating(item.value);
  const lines: string[] = [];
  if (point?.contestName) lines.push(point.contestName);
  if (ratedAt) lines.push(ratedAt);
  lines.push(`Rating ${typeof rating === 'number' ? String(Math.round(rating)) : '—'}`);
  return lines.join('\n');
}

function buildExternalRatingChartOption(points: ExternalRatingHistoryPoint[]): KryptonEChartsOption {
  const option: KryptonEChartsOption = {
    grid: { left: 8, right: 12, top: 16, bottom: points.length > 20 ? 48 : 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      formatter: (raw) => formatExternalRatingTooltip(raw, points),
    },
    xAxis: {
      type: 'time',
    },
    yAxis: {
      type: 'value',
      scale: true,
    },
    series: [
      {
        type: 'line',
        name: 'Rating',
        smooth: true,
        showSymbol: points.length <= 20,
        symbolSize: 6,
        data: points.map((point) => ({
          name: point.contestName || point.ratedAt,
          value: [point.ratedAt, point.rating],
        })),
      },
    ],
  };
  if (points.length > 20) {
    option.dataZoom = [
      { type: 'inside', filterMode: 'none' },
      { type: 'slider', height: 16, bottom: 4 },
    ];
  }
  return option;
}

function codeforcesProfileUrl(handle: string): string {
  return `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
}

export function UserDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as UserPageData;
  const udoc = data.udoc || {};
  const sdoc = data.sdoc || {};
  const pdocs = data.pdocs || [];
  const problemSetCompletions = data.problemSetCompletions || [];
  const knowledgeNodeCompletions = data.knowledgeNodeCompletions || [];
  const tdocs = data.tdocs || [];
  const psdocs = data.psdocs || [];
  const pdict = data.pdict || {};
  const isSelfProfile = !!data.isSelfProfile || Number(udoc._id) === Number(bs.user.id);
  const externalRatingView = readExternalRatingView(data);
  const canViewPrivateExternalRating =
    isSelfProfile
    || data.externalRatingCanEdit === true
    || externalRatingView.canEdit
    || externalRatingView.viewerIsSelf
    || externalRatingView.viewerIsTeacher
    || data.viewerIsTeacher === true
    || data.isTeacherOrAdmin === true;
  const historyBySite = readExternalRatingHistoryBySite(data.externalRatingHistory);
  const sitesById = new Map(externalRatingView.sites.map((site) => [site.id, site.view]));
  const visibleExternalRatingSites = EXTERNAL_RATING_SITE_IDS.flatMap((id) => {
    const view = sitesById.get(id) ?? {};
    if (!isExternalRatingSiteVisible(view, canViewPrivateExternalRating, historyBySite[id])) return [];
    return [{ id, view }];
  });

  const name = udoc.uname || 'User';
  const rp = Math.round(Number(udoc.rp || 0));
  const bio = udoc.bio || '';
  const acCount = Number(udoc.nAccept ?? pdocs.length ?? 0);
  const submitCount = Number(udoc.nSubmit ?? 0);
  const lastActive = sdoc?.updateAt || udoc.loginat;

  // 学号/姓名/学校只认 userbind。绑定状态所有人可见；身份字段仅登录用户可见。
  const binding = data.studentBinding || null;
  const isBound = !!binding?.bound;

  const contactItems = [
    { label: '邮箱', value: udoc.mail, icon: Mail },
    { label: 'QQ', value: udoc.qq, icon: MessageSquare },
    { label: '微信', value: udoc.wechat, icon: MessageSquare },
    ...(isBound
      ? [
          { label: '学号', value: binding.studentId, icon: Hash },
          { label: '学校', value: binding.schoolName, icon: UserIcon },
        ]
      : []),
  ].filter((it) => it.value);

  const avatarUrl = udoc.avatarUrl || (udoc.avatar && /^https?:|^\//.test(udoc.avatar) ? udoc.avatar : null);

  const externalRatingTitle = (
    <span className="inline-flex items-center gap-1.5">
      <Globe className="size-4 text-fg-subtle" />
      外站 Rating
    </span>
  );
  const profileSubtitle = isBound && binding?.realName ? (
    <>
      {binding.realName}
      {binding.studentId ? <span className="ml-1.5 font-mono tabular">{binding.studentId}</span> : null}
    </>
  ) : udoc.displayName || undefined;

  return (
    <Page width="wide">
      <div className="flex min-w-0 items-start gap-4">
        <Avatar className="size-16">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
          <AvatarFallback className="text-lg">{makeInitials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={name}
            description={profileSubtitle}
            meta={(
              <>
                {udoc.role ? <Badge variant="outline" size="sm">{udoc.role}</Badge> : null}
                {binding ? (
                  isBound ? <Badge tone="success" size="sm">已绑定</Badge> : <Badge variant="outline" size="sm">未绑定</Badge>
                ) : null}
                {isBound && binding.schoolName ? <Badge size="sm">{binding.schoolName}</Badge> : null}
                <Badge variant="outline" size="sm" className="font-mono">
                  UID {udoc._id ?? '?'}
                </Badge>
              </>
            )}
            actions={isSelfProfile || (bs.user.signedIn && udoc._id) ? (
              <>
                {isSelfProfile ? (
                  <Button asChild variant="secondary" size="sm">
                    <a href="/home/settings/account">
                      <SettingsIcon />
                      编辑资料
                    </a>
                  </Button>
                ) : null}
                {bs.user.signedIn && udoc._id ? (
                  <Button asChild variant="secondary" size="sm">
                    <a href={`/home/messages?target=${udoc._id}`} target="_blank" rel="noreferrer">
                      <MessageSquare />
                      发消息
                    </a>
                  </Button>
                ) : null}
              </>
            ) : undefined}
          />
        </div>
      </div>

      {bio ? (
        <Panel title={<span className="inline-flex items-center gap-1.5"><UserIcon className="size-4 text-fg-subtle" />个人简介</span>}>
          <MarkdownView content={bio} preferredLang={bs.locale} />
        </Panel>
      ) : null}

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 md:divide-x md:divide-line-subtle [&>*]:md:pl-6 [&>*:first-child]:md:pl-0">
          <Stat label="RP" value={rp} />
          <Stat label="通过" value={acCount} />
          <Stat label="提交" value={submitCount} />
          <Stat label="排名" value={udoc.rank ? `#${udoc.rank}` : '—'} />
        </div>
      </Panel>

      {visibleExternalRatingSites.length ? (
        <div data-slot="card" className="min-w-0">
          <Panel
            className="w-full"
            title={externalRatingTitle}
            description="Codeforces / 牛客快照，不是本站 RP"
          >
            <div
              data-slot="card-content"
              className={cn('grid w-full min-w-0 gap-6', visibleExternalRatingSites.length > 1 && 'sm:grid-cols-2')}
            >
              {visibleExternalRatingSites.map((site) => (
                <ExternalRatingSiteBlock
                  key={site.id}
                  siteId={site.id}
                  view={site.view}
                  history={historyBySite[site.id]}
                  canViewPrivate={canViewPrivateExternalRating}
                  locale={bs.locale}
                />
              ))}
            </div>
          </Panel>
        </div>
      ) : null}

      <ActivityHeatmap daily={data.daily || {}} />

      <div className="grid w-full min-w-0 gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <CompletionList title="题集完成" icon={<BookOpen className="size-4 text-fg-subtle" />} items={problemSetCompletions} unit="题" />
          <CompletionList title="知识点完成" icon={<Network className="size-4 text-fg-subtle" />} items={knowledgeNodeCompletions} unit="题" />

          {tdocs.length ? (
            <Panel
              flush
              title={<span className="inline-flex items-center gap-1.5"><Trophy className="size-4 text-fg-subtle" />参加过的比赛</span>}
              actions={<span className="text-xs font-normal tabular text-fg-subtle">{tdocs.length}</span>}
            >
              <div className="divide-y divide-line-subtle">
                {tdocs.slice(0, 12).map((t) => (
                  <a
                    key={String(t.docId)}
                    href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(t.docId) })}
                    className="flex min-h-12 items-center gap-2 px-4 py-3 text-sm transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover"
                  >
                    <span className="truncate">{t.title || '未命名'}</span>
                    <Badge variant="outline" size="sm" className="ml-auto">
                      {t.rule || '—'}
                    </Badge>
                  </a>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={<span className="inline-flex items-center gap-1.5"><Calendar className="size-4 text-fg-subtle" />账号信息</span>}>
            <DescriptionList
              items={[
                { term: 'UID', detail: <span className="font-mono">{String(udoc._id ?? '—')}</span> },
                { term: '注册', detail: udoc.regat ? formatDateTime(udoc.regat, bs.locale) : '—' },
                { term: '最近活跃', detail: lastActive ? formatDateTime(lastActive, bs.locale) : '离线' },
                ...(udoc.timezone ? [{ term: '时区', detail: String(udoc.timezone) }] : []),
              ]}
            />
          </Panel>

          {contactItems.length ? (
            <Panel title="联系方式">
              <div className="flex flex-col gap-2">
                {contactItems.map(({ label, value, icon: Icon }) => (
                  <ContactRow key={label} label={label} value={String(value)} icon={<Icon className="text-fg-subtle" />} />
                ))}
              </div>
            </Panel>
          ) : null}

          {psdocs.length ? (
            <Panel title="最近题解" flush>
              <div className="divide-y divide-line-subtle">
                {psdocs.slice(0, 8).map((ps) => {
                  const p = pdict[String(ps.parentId)];
                  return (
                    <a
                      key={String(ps._id)}
                      href={`${replaceRouteTokens(bs.urls.problemDetail, { PID: String(ps.parentId) })}/solution/${ps._id}`}
                      className="flex min-h-12 items-center gap-2 px-4 py-3 text-xs transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover"
                    >
                      <span className="font-mono text-2xs text-fg-subtle">{ps.parentId}</span>
                      <span className="truncate">{p?.title || ps.title || '题解'}</span>
                      {ps.vote ? (
                        <Badge variant="outline" size="sm" className="ml-auto">
                          {ps.vote}↑
                        </Badge>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

function CompletionList({
  title,
  icon,
  items,
  unit,
}: {
  title: string;
  icon: ReactNode;
  items: ProfileCompletionItem[];
  unit: string;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, 12);
  const maxCount = Math.max(...shown.map((item) => item.count));
  return (
    <Panel
      flush
      title={<span className="inline-flex min-w-0 items-center gap-1.5">{icon}{title}</span>}
      actions={<span className="shrink-0 text-xs font-normal text-fg-subtle">{shown.length}</span>}
    >
      <ol className="divide-y divide-line-subtle">
        {shown.map((item, index) => {
          const pct = maxCount > 0 ? Math.round((item.count / maxCount) * 100) : 0;
          const row = (
            <div className="flex items-start gap-3">
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-2xs tabular text-fg-subtle">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug break-words">{item.title}</p>
                {item.subtitle ? <p className="mt-0.5 text-2xs leading-snug text-fg-subtle">{item.subtitle}</p> : null}
                <Progress value={pct} size="sm" className="mt-2" />
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-md font-semibold tabular leading-none">{item.count}</span>
                <span className="mt-0.5 block text-2xs text-fg-subtle">{unit}</span>
              </span>
            </div>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <a href={item.href} className="block px-4 py-3 transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover" title={item.title}>
                  {row}
                </a>
              ) : (
                <div className="px-4 py-3">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function ExternalRatingSiteBlock({
  siteId,
  view,
  history,
  canViewPrivate,
  locale,
}: {
  siteId: ExternalRatingSiteId;
  view: ExternalRatingSiteView;
  history: ExternalRatingHistoryPoint[];
  canViewPrivate: boolean;
  locale: string;
}) {
  const handle = view.handle;
  const fetchedAt = toDate(unwrapDateValue(view.fetchedAt));
  const profileHref = siteId === 'codeforces' && handle ? codeforcesProfileUrl(handle) : null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{EXTERNAL_RATING_SITE_LABEL[siteId]}</p>
        {canViewPrivate && view.publicShow !== true ? (
          <Badge variant="outline" size="sm">
            未公开
          </Badge>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {profileHref ? (
            <a
              href={profileHref}
              target="_blank"
              rel="noreferrer"
              className="block max-w-full truncate font-mono text-sm text-brand-fg hover:underline"
              title={handle}
            >
              {handle}
            </a>
          ) : (
            <span className="block max-w-full truncate font-mono text-sm">{handle || '—'}</span>
          )}
          {canViewPrivate || fetchedAt ? (
            <p className="mt-1 text-2xs text-fg-subtle">
              抓取 {fetchedAt ? formatDateTime(fetchedAt, locale) : '—'}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-3xl font-semibold tabular leading-none">{formatExternalRatingValue(view.rating)}</span>
      </div>
      {canViewPrivate && view.lastError ? (
        <p className="break-words text-2xs text-danger-fg">失败 {formatExternalRatingLastError(view.lastError)}</p>
      ) : null}
      {!canViewPrivate && view.stale ? <p className="text-2xs text-fg-subtle">快照可能过期</p> : null}
      {history.length >= 1 ? (
        <EChart
          option={buildExternalRatingChartOption(history)}
          className={"h-[240px] w-full min-w-0" /* ds-allow DS004: 历史曲线高度由既有契约固定为 240px，间距阶梯没有这一档 */}
        />
      ) : null}
    </div>
  );
}

/**
 * GitHub-style submission heatmap. 53 columns × 7 rows (Sun→Sat).
 *
 * `daily` is keyed by local-time YYYY-MM-DD strings — the backend already
 * formatted via `$dateToString` so we don't re-do timezone math here.
 *
 * Color scale: 5 buckets, transparent → primary at quartiles of the
 * non-zero distribution. We compute thresholds locally so a low-activity
 * user still gets a meaningful gradient (instead of one solid color).
 */
function ActivityHeatmap({ daily }: { daily: Record<string, number> }) {
  // Build the 53×7 grid backwards from "today" so the rightmost column
  // contains the current day, with Sunday at row 0 and Saturday at row 6.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = today.getTime();

  // Align right column to a full Sun-Sat week by padding forward to Saturday.
  const sat = new Date(today);
  sat.setDate(today.getDate() + (6 - today.getDay()));
  const totalDays = 53 * 7;
  const startTs = sat.getTime() - (totalDays - 1) * 86400000;

  const cells: Array<{ date: string; count: number; isFuture: boolean }> = [];
  let totalSubmissions = 0;
  let activeDays = 0;
  const nonZeroCounts: number[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startTs + i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = daily[key] || 0;
    const isFuture = d.getTime() > endDay;
    cells.push({ date: key, count, isFuture });
    if (!isFuture && count > 0) {
      totalSubmissions += count;
      activeDays++;
      nonZeroCounts.push(count);
    }
  }

  // Quartile thresholds for the 4 active buckets. Sort non-zero counts and
  // pick 25/50/75 percentile boundaries. Falls back to [1,2,4,8] for tiny
  // samples so empty / brand-new users still see a sensible scale.
  function bucket(n: number): 0 | 1 | 2 | 3 | 4 {
    if (n <= 0) return 0;
    const sorted = nonZeroCounts.slice().sort((a, b) => a - b);
    if (sorted.length < 4) {
      if (n >= 8) return 4;
      if (n >= 4) return 3;
      if (n >= 2) return 2;
      return 1;
    }
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q2 = sorted[Math.floor(sorted.length * 0.5)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    if (n >= q3) return 4;
    if (n >= q2) return 3;
    if (n >= q1) return 2;
    return 1;
  }

  // Group by column (53 columns of 7 days each).
  const columns: Array<Array<(typeof cells)[number]>> = [];
  for (let c = 0; c < 53; c++) columns.push(cells.slice(c * 7, c * 7 + 7));

  // Month labels — show the month name above the first column where it
  // changes (only for full visible months, not partial). We also add a
  // label for the very first column.
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  columns.forEach((col, ci) => {
    const firstDay = new Date(col[0].date);
    const m = firstDay.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: ci, label: `${m + 1}月` });
      lastMonth = m;
    }
  });

  const bucketClass: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-surface-sunken',
    1: 'bg-brand-soft/60',
    2: 'bg-brand-soft',
    3: 'bg-brand-soft-hover',
    4: 'bg-brand',
  };

  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Activity className="size-4 text-fg-subtle" />最近一年的提交活跃度</span>}
      actions={<span className="text-xs font-normal tabular text-fg-subtle">共 {totalSubmissions} 次 · 活跃 {activeDays} 天</span>}
    >
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="inline-flex flex-col gap-1 text-2xs text-fg-subtle">
          <div className="flex gap-1">
            <div className="w-6 shrink-0" />
            <div className="flex gap-0.5">
              {columns.map((_, ci) => {
                const label = monthLabels.find((m) => m.col === ci);
                return (
                  <div key={ci} className="w-3 shrink-0 text-left">
                    {label ? <span className="whitespace-nowrap">{label.label}</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-1">
            <div className="flex w-6 shrink-0 flex-col justify-around gap-0.5 text-right">
              {['', '一', '', '三', '', '五', ''].map((d, i) => (
                <div key={i} className="flex h-3 items-center justify-end">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-0.5">
                  {col.map((cell, ri) => (
                    <div
                      key={ri}
                      className={`size-3 shrink-0 rounded-sm ${cell.isFuture ? 'opacity-0' : bucketClass[bucket(cell.count)]}`}
                      title={cell.isFuture ? '' : `${cell.date} · ${cell.count} 次提交`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <div className="w-6 shrink-0" />
            <span>少</span>
            {([0, 1, 2, 3, 4] as const).map((b) => (
              <span key={b} className={`size-3 shrink-0 rounded-sm ${bucketClass[b]}`} />
            ))}
            <span>多</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ContactRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Button type="button" variant="secondary" className="w-full" onClick={handleCopy} title="点击复制">
      {icon}
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-left text-fg-muted">{value}</span>
      <Clipboard className={copied ? 'text-success-fg' : 'text-fg-subtle'} />
      {copied ? <span className="text-2xs text-success-fg">已复制</span> : null}
    </Button>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Settings / Security / Messages (unchanged from before)             */
/* ────────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as UserPageData;
  const settings = data.settings || [];
  const current = data.current || {};

  return (
    <Page width="form">
      <PageHeader title={data.page_name === 'home_account' ? '账号' : '设置'} />
      <form method="post" className="flex flex-col gap-6">
        {settings.map((s) => (
          <Panel key={String(s.key)} title={s.name || s.key}>
            <SettingControl setting={s} value={current[s.key]} />
          </Panel>
        ))}
        <div className="flex justify-end">
          <Button type="submit" variant="primary">保存</Button>
        </div>
      </form>
    </Page>
  );
}

function SettingControl({ setting, value }: { setting: UserSetting; value: unknown }) {
  const name = String(setting.key);
  const type = setting.type || 'text';
  const formValue = value ? String(value) : '';
  if (setting.range && typeof setting.range === 'object') {
    const entries = Object.entries(setting.range);
    return <SimpleSelect name={name} defaultValue={formValue} options={entries.map(([k, v]) => ({ value: k, label: String(v) }))} />;
  }
  if (type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name={name} defaultChecked={!!value} />
        {setting.desc || setting.key}
      </label>
    );
  }
  if (type === 'markdown' || type === 'textarea') {
    return <MarkdownEditor name={name} value={formValue} minHeight={220} />;
  }
  return <Input name={name} defaultValue={formValue} />;
}

export function SecurityPage() {
  const bs = useBootstrap();
  const data = bs.page.data as UserPageData;
  const sessions = data.sessions || [];

  return (
    <Page width="form">
      <PageHeader title="账号安全" />
      <Panel title="修改密码">
        <form method="post" action="/home/security/password" className="flex flex-col gap-5">
          <Input name="currentPassword" placeholder="当前密码" type="password" />
          <Input name="newPassword" placeholder="新密码" type="password" />
          <Input name="newPasswordAgain" placeholder="重复新密码" type="password" />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">修改密码</Button>
          </div>
        </form>
      </Panel>
      <Panel title="会话" flush={sessions.length > 0}>
        {sessions.length === 0 ? (
          <EmptyState compact title="暂无会话" />
        ) : (
          <div className="divide-y divide-line-subtle">
            {sessions.map((s) => (
              <div key={String(s._id)} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.userAgent || 'Unknown'}</p>
                  <p className="text-xs text-fg-subtle">{s.updateAt ? formatDateTime(s.updateAt, bs.locale) : '—'}</p>
                </div>
                {s._id ? (
                  <form method="post" action="/home/security/session" className="ml-auto">
                    <input type="hidden" name="sid" value={String(s._id)} />
                    <Button type="submit" variant="secondary" size="sm">
                      登出
                    </Button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}

export function MessagesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as UserPageData;
  const mdocs = data.mdocs || [];

  return (
    <Page width="wide">
      <PageHeader title="消息" />
      <Panel flush={mdocs.length > 0}>
        {mdocs.length === 0 ? (
          <EmptyState compact title="没有消息" />
        ) : (
          <div className="divide-y divide-line-subtle">
            {mdocs.map((m) => (
              <div key={String(m._id)} className="px-4 py-3 text-sm">
                <p className="font-medium">{m.from || '系统'}</p>
                <p className="text-xs text-fg-subtle">{m.updateAt ? formatDateTime(m.updateAt, bs.locale) : '—'}</p>
                <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
