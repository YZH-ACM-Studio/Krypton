import { useState } from 'react';
import { motion } from 'motion/react';
import { Medal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown-renderer';
import { ExternalLink } from 'lucide-react';
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
  onShowBio,
  studentInfo,
}: {
  user: GenericUserDoc & R;
  rank: number | string;
  rpKeys: string[];
  current?: boolean;
  onShowBio?: (user: GenericUserDoc & R) => void;
  /** Admin-only column. When undefined, the cell is suppressed. */
  studentInfo?: { studentId: string; realName: string } | null;
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
        <a
          href={replaceRouteTokens(bs.urls.userDetail, { UID: String(user._id) })}
          className="flex min-w-0 items-center gap-2 hover:text-primary"
        >
          <Avatar className="size-7">
            {user.avatarUrl ? <AvatarImage src={String(user.avatarUrl)} alt={String(user.uname || '')} /> : null}
            <AvatarFallback className="text-[10px]">{makeInitials(user.uname || '?')}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{user.uname || `#${user._id}`}</span>
          {current ? <Badge variant="secondary" className="text-[10px]">我</Badge> : null}
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
      <TableCell className="max-w-64 text-sm">
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
  const studentDict: Record<string, { studentId: string; realName: string }> = data.studentDict || {};
  const hasStudentColumn = Object.keys(studentDict).length > 0;
  const [bioUser, setBioUser] = useState<(GenericUserDoc & R) | null>(null);

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
          <div>
            <Table>
              <TableHeader>
<TableRow>
                  <TableHead className="w-16 text-center">#</TableHead>
                  <TableHead>用户</TableHead>
                  {hasStudentColumn ? (
                    <TableHead className="w-32">学号 / 姓名</TableHead>
                  ) : null}
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
                  <RankingRow
                    user={self as GenericUserDoc & R}
                    rank={self.rank || '—'}
                    rpKeys={rpKeys}
                    current
                    onShowBio={setBioUser}
                    studentInfo={hasStudentColumn ? (studentDict[String(self._id)] ?? null) : undefined}
                  />
                ) : null}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5 + rpKeys.length + (hasStudentColumn ? 1 : 0)} className="py-8 text-center text-sm text-muted-foreground">
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
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Pagination current={page} total={upcount} baseUrl={bs.urls.ranking} />

      {/* Bio detail dialog */}
      <Dialog open={!!bioUser} onOpenChange={(o) => !o && setBioUser(null)}>
        <DialogContent
          className="flex h-[80vh] w-[80vw] max-w-4xl flex-col"
          onClose={() => setBioUser(null)}
        >
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
          <ScrollArea className="flex-1" viewportClassName="px-6 py-5">
            {bioUser?.bio ? (
              <MarkdownView content={bioUser.bio} preferredLang={bs.locale} />
            ) : (
              <p className="text-sm text-muted-foreground">该用户暂无简介</p>
            )}
          </ScrollArea>
          <div className="flex shrink-0 justify-end border-t px-6 py-3">
            <Button asChild variant="default" size="sm">
              <a
                href={replaceRouteTokens(bs.urls.userDetail, { UID: String(bioUser?._id || '') })}
              >
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
