import { motion } from 'motion/react';
import { Medal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatPlainTextSummary, makeInitials, replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

const RP_LABELS: Record<string, string> = {
  problem: '题目 RP',
  contest: '比赛 RP',
};

function medalColor(rank: number) {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-gray-400';
  if (rank === 3) return 'text-amber-700';
  return 'text-muted-foreground';
}

function getRpDetail(user: R, key: string) {
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
}: {
  user: GenericUserDoc & R;
  rank: number | string;
  rpKeys: string[];
  current?: boolean;
}) {
  const bs = useBootstrap();
  const numericRank = typeof rank === 'number' ? rank : Number(rank);

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
        <a
          href={replaceRouteTokens(bs.urls.userDetail, { UID: String(user._id) })}
          className="flex min-w-0 items-center gap-2 hover:text-primary"
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-[10px]">{makeInitials(user.uname || '?')}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{user.uname || `#${user._id}`}</span>
          {current ? <Badge variant="secondary" className="text-[10px]">我</Badge> : null}
        </a>
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {Math.round(Number(user.rp || 0))}
      </TableCell>
      {rpKeys.map((key) => (
        <TableCell key={key} className="hidden text-right tabular-nums text-sm text-muted-foreground md:table-cell">
          {getRpDetail(user, key)}
        </TableCell>
      ))}
      <TableCell className="text-right tabular-nums">
        {user.nAccept ?? 0}
      </TableCell>
      <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
        {formatPlainTextSummary(user.bio) || '—'}
      </TableCell>
    </TableRow>
  );
}

export function RankingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const page = Number(data.page) || 1;
  const upcount = Number(data.upcount || data.rpcount) || 1;
  const users: Array<GenericUserDoc & R> = data.udocs || [];
  const ranked: number[] = data.ranked || [];
  const fallbackUsers = ranked
    .map((uid) => bs.udict[String(uid)] as GenericUserDoc & R)
    .filter(Boolean);
  const rows = users.length ? users : fallbackUsers;
  const rpDefinitions: R = data.rpDefinitions || {};
  const rpKeys = Object.entries(rpDefinitions)
    .filter(([, def]) => !(def as R)?.hidden)
    .map(([key]) => key);
  const self: R | null = data.self || null;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <h1 className="text-xl font-semibold">排名</h1>
        <p className="text-sm text-muted-foreground">用户 RP 排行榜，分项列会跟随当前评分脚本配置。</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">#</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead className="w-20 text-right">RP</TableHead>
                  {rpKeys.map((key) => (
                    <TableHead key={key} className="hidden w-24 text-right md:table-cell">
                      {RP_LABELS[key] || key}
                    </TableHead>
                  ))}
                  <TableHead className="w-20 text-right">AC</TableHead>
                  <TableHead className="min-w-40">简介</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {self ? (
                  <RankingRow user={self as GenericUserDoc & R} rank={self.rank || '—'} rpKeys={rpKeys} current />
                ) : null}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5 + rpKeys.length} className="py-8 text-center text-sm text-muted-foreground">
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
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Pagination current={page} total={upcount} baseUrl={bs.urls.ranking} />
    </motion.div>
  );
}
