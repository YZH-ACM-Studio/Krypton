import { useState } from 'react';
import { motion } from 'motion/react';
import { Medal, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatPlainTextSummary, makeInitials, replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';
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

interface RankingPageData {
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

function publicRatingRowProps(
  user: RankingUser,
  pageDicts: unknown[],
  showCfRating: boolean,
  showNowcoderRating: boolean,
) {
  return {
    showCfRating,
    showNowcoderRating,
    cfRating: readUserPublicRating(user, 'codeforces', pageDicts).rating,
    nowcoderRating: readUserPublicRating(user, 'nowcoder', pageDicts).rating,
  };
}

function medalColor(rank: number) {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-gray-400';
  if (rank === 3) return 'text-amber-700';
  return 'text-muted-foreground';
}

function getRpDetail(user: RankingUser, key: string) {
  const value = user?.rpInfo?.[key];
  return typeof value === 'number' ? Math.round(value) : '—';
}

function userRankFallback(page: number, index: number) {
  return (page - 1) * 50 + index + 1;
}

function RankingRow({
  user,
  rank,
  rpKeys,
  current,
  onShowBio,
  studentInfo,
  showCfRating,
  showNowcoderRating,
  cfRating,
  nowcoderRating,
}: {
  user: RankingUser;
  rank: number | string;
  rpKeys: string[];
  current?: boolean;
  onShowBio?: (user: RankingUser) => void;
  /** Admin-only column. When undefined, the cell is suppressed. */
  studentInfo?: { studentId: string; realName: string } | null;
  showCfRating: boolean;
  showNowcoderRating: boolean;
  cfRating?: number;
  nowcoderRating?: number;
}) {
  const bs = useBootstrap();
  const numericRank = typeof rank === 'number' ? rank : Number(rank);
  const bioPreview = formatPlainTextSummary(user.bio);

  return (
    <TableRow className={cn(current && 'bg-primary/5')}>
      <TableCell className="text-center">
        {Number.isFinite(numericRank) && numericRank <= 3 ? (
          <Medal className={`mx-auto size-5 ${medalColor(numericRank)}`} />
        ) : (
          <span className="tabular-nums text-muted-foreground">{rank || '—'}</span>
        )}
      </TableCell>
      <TableCell>
        <a href={replaceRouteTokens(bs.urls.userDetail, { UID: String(user._id) })} className="flex min-w-0 items-center gap-2 hover:text-primary">
          <Avatar className="size-7">
            {user.avatarUrl ? <AvatarImage src={String(user.avatarUrl)} alt={String(user.uname || '')} /> : null}
            <AvatarFallback className="text-[10px]">{makeInitials(user.uname || '?')}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{user.uname || `#${user._id}`}</span>
          {current ? (
            <Badge variant="secondary" className="text-[10px]">
              我
            </Badge>
          ) : null}
        </a>
      </TableCell>
      {studentInfo !== undefined ? (
        <TableCell className="text-xs">
          {studentInfo ? (
            <>
              <div className="font-mono">{studentInfo.studentId}</div>
              <div className="text-muted-foreground">{studentInfo.realName}</div>
            </>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>
      ) : null}
      <TableCell className="text-right tabular-nums font-medium">{Math.round(Number(user.rp || 0))}</TableCell>
      {rpKeys.map((key) => (
        <TableCell key={key} className="hidden text-right tabular-nums text-sm text-muted-foreground md:table-cell">
          {getRpDetail(user, key)}
        </TableCell>
      ))}
      {showCfRating ? (
        <TableCell className="hidden text-right tabular-nums text-sm text-muted-foreground md:table-cell">
          {formatPublicRating(cfRating)}
        </TableCell>
      ) : null}
      {showNowcoderRating ? (
        <TableCell className="hidden text-right tabular-nums text-sm text-muted-foreground md:table-cell">
          {formatPublicRating(nowcoderRating)}
        </TableCell>
      ) : null}
      <TableCell className="text-right tabular-nums">{user.nAccept ?? 0}</TableCell>
      <TableCell className="hidden min-w-40 max-w-64 text-sm lg:table-cell">
        {bioPreview ? (
          <button
            type="button"
            onClick={() => onShowBio?.(user)}
            className="block w-full max-w-full truncate text-left text-muted-foreground hover:text-foreground hover:underline"
            title="点击查看完整简介"
          >
            {bioPreview}
          </button>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function RankingPage() {
  const bs = useBootstrap();
  const data = bs.page.data as RankingPageData;
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
  const hasStudentColumn = Object.keys(studentDict).length > 0;
  const publicRatingDicts = readPublicRatingDicts(data);
  const hasExternalRatingColumns = rankingShowsExternalRatingColumns(data);
  const extraRatingColumns = hasExternalRatingColumns ? EXTERNAL_RATING_SITE_IDS.length : 0;
  const [bioUser, setBioUser] = useState<RankingUser | null>(null);

  return (
    <motion.div className="min-w-0 space-y-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div>
        <h1 className="text-xl font-semibold">排名</h1>
        <p className="text-sm text-muted-foreground">用户 RP 排行榜，分项列会跟随当前评分脚本配置。</p>
      </div>

      <Card className="min-w-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">#</TableHead>
                <TableHead>用户</TableHead>
                {hasStudentColumn ? <TableHead className="w-32">学号 / 姓名</TableHead> : null}
                <TableHead className="w-20 text-right">RP</TableHead>
                {rpKeys.map((key) => (
                  <TableHead key={key} className="hidden w-24 text-right md:table-cell">
                    {RP_LABELS[key] || key}
                  </TableHead>
                ))}
                {hasExternalRatingColumns
                  ? EXTERNAL_RATING_SITE_IDS.map((site) => (
                      <TableHead key={site} className="hidden w-20 text-right md:table-cell">
                        {EXTERNAL_RATING_SITE_LABEL[site]}
                      </TableHead>
                    ))
                  : null}
                <TableHead className="w-20 text-right">AC</TableHead>
                <TableHead className="hidden min-w-40 lg:table-cell">简介</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {self ? (
                <RankingRow
                  user={self}
                  rank={self.rank || '—'}
                  rpKeys={rpKeys}
                  current
                  onShowBio={setBioUser}
                  studentInfo={hasStudentColumn ? (studentDict[String(self._id)] ?? null) : undefined}
                  {...publicRatingRowProps(self, publicRatingDicts, hasExternalRatingColumns, hasExternalRatingColumns)}
                />
              ) : null}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5 + rpKeys.length + extraRatingColumns + (hasStudentColumn ? 1 : 0)}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    暂无排名数据
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((user, index) => (
                  <RankingRow
                    key={user._id}
                    user={user}
                    rank={user.rank || userRankFallback(page, index)}
                    rpKeys={rpKeys}
                    onShowBio={setBioUser}
                    studentInfo={hasStudentColumn ? (studentDict[String(user._id)] ?? null) : undefined}
                    {...publicRatingRowProps(user, publicRatingDicts, hasExternalRatingColumns, hasExternalRatingColumns)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination current={page} total={upcount} baseUrl={bs.urls.ranking} />

      {/* Bio detail dialog */}
      <Dialog open={!!bioUser} onOpenChange={(o) => !o && setBioUser(null)}>
        <DialogContent size="xl" className="flex min-h-0 w-full flex-col" onClose={() => setBioUser(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Avatar className="size-7">
                {bioUser?.avatarUrl ? <AvatarImage src={String(bioUser.avatarUrl)} alt={bioUser?.uname || ''} /> : null}
                <AvatarFallback className="text-[10px]">{makeInitials(bioUser?.uname || '?')}</AvatarFallback>
              </Avatar>
              <span>{bioUser?.uname || '用户'}</span>
              <span className="text-xs font-normal text-muted-foreground">· 个人简介</span>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 py-5">
            {bioUser?.bio ? (
              <MarkdownView content={bioUser.bio} preferredLang={bs.locale} />
            ) : (
              <p className="text-sm text-muted-foreground">该用户暂无简介</p>
            )}
          </ScrollArea>
          <div className="flex shrink-0 justify-end border-t px-6 py-3">
            <Button asChild variant="default" size="sm">
              <a href={replaceRouteTokens(bs.urls.userDetail, { UID: String(bioUser?._id || '') })}>
                查看完整资料
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
