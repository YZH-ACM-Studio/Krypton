import { motion } from 'motion/react';
import { Medal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { makeInitials, replaceRouteTokens } from '@/lib/format';

export function RankingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ranked: number[] = data.ranked || [];
  const page = Number(data.page) || 1;
  const rpcount = Number(data.rpcount) || 1;

  const getMedalColor = (i: number) => {
    if (i === 0) return 'text-yellow-500';
    if (i === 1) return 'text-gray-400';
    if (i === 2) return 'text-amber-700';
    return 'text-muted-foreground';
  };

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <h1 className="text-xl font-semibold">排名</h1>
        <p className="text-sm text-muted-foreground">用户 RP 排行榜</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">#</TableHead>
                <TableHead>用户</TableHead>
                <TableHead className="w-20 text-right">RP</TableHead>
                <TableHead className="w-24 text-right">简介</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    暂无排名数据
                  </TableCell>
                </TableRow>
              ) : (
                ranked.map((uid, i) => {
                  const u: GenericUserDoc | null = bs.udict[String(uid)] || null;
                  const rank = (page - 1) * 50 + i + 1;
                  return (
                    <TableRow key={uid}>
                      <TableCell className="text-center">
                        {rank <= 3 ? (
                          <Medal className={`mx-auto size-5 ${getMedalColor(rank - 1)}`} />
                        ) : (
                          <span className="tabular-nums text-muted-foreground">{rank}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.userDetail, { UID: String(uid) })}
                          className="flex items-center gap-2 hover:text-primary"
                        >
                          <Avatar className="size-7">
                            <AvatarFallback className="text-[10px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{u?.uname || `#${uid}`}</span>
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {Math.round(Number(u?.rp || 0))}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground truncate max-w-32">
                        {u?.bio || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination current={page} total={rpcount} baseUrl={bs.urls.ranking} />
    </motion.div>
  );
}
