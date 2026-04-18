import { motion } from 'motion/react';
import { Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';

type R = Record<string, any>;

function contestState(c: R) {
  const now = Date.now();
  const begin = toDate(c.beginAt)?.getTime() || 0;
  const end = toDate(c.endAt)?.getTime() || 0;
  if (!begin || !end) return { label: '待发布', variant: 'secondary' as const };
  if (now < begin) return { label: '即将开始', variant: 'outline' as const };
  if (now > end) return { label: '已结束', variant: 'secondary' as const };
  return { label: '进行中', variant: 'default' as const };
}

export function ContestsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdocs: R[] = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">比赛</h1>
          <p className="text-sm text-muted-foreground">共 {tdocs.length} 场比赛</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.contests}/create`}>创建比赛</a>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>比赛名称</TableHead>
                <TableHead className="w-44">时间</TableHead>
                <TableHead className="w-20 text-center">规则</TableHead>
                <TableHead className="w-20 text-center">参与</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    暂无比赛
                  </TableCell>
                </TableRow>
              ) : (
                tdocs.map((c) => {
                  const st = contestState(c);
                  return (
                    <TableRow key={String(c.docId)}>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) })}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {c.title || '未命名比赛'}
                        </a>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(c.beginAt, locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        {c.rule ? <Badge variant="outline">{c.rule}</Badge> : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                          <Users className="size-3" />{c.attend || 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination current={page} total={tpcount} baseUrl={bs.urls.contests} />
    </motion.div>
  );
}

export function ContestDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pids: (string | number)[] = data.pids || tdoc.pids || [];
  const pdict: Record<string, R> = data.pdict || {};
  const psdict: Record<string, R> = data.psdict || {};
  const attended = data.attended || data.tsdoc?.attend;
  const st = contestState(tdoc);
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={bs.urls.contests} className="hover:text-primary">比赛</a>
            <ChevronRight className="size-3" />
          </div>
          <h1 className="mt-1 text-2xl font-bold">{tdoc.title || '比赛'}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={st.variant}>{st.label}</Badge>
            {tdoc.rule ? <Badge variant="outline">{tdoc.rule}</Badge> : null}
            {tdoc.rated ? <Badge variant="secondary">Rated</Badge> : null}
          </div>
        </div>
        <div className="flex gap-2">
          {!attended ? (
            <form method="post">
              <input type="hidden" name="operation" value="attend" />
              <Button type="submit">参加比赛</Button>
            </form>
          ) : (
            <Badge variant="secondary">已参加</Badge>
          )}
          <Button asChild variant="outline">
            <a href={`${replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId) })}/scoreboard`}>
              排行榜
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">开始时间</p>
            <p className="mt-1 font-medium">{formatDateTime(tdoc.beginAt, locale)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">结束时间</p>
            <p className="mt-1 font-medium">{formatDateTime(tdoc.endAt, locale)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">参与人数</p>
            <p className="mt-1 text-2xl font-semibold">{tdoc.attend || 0}</p>
          </CardContent>
        </Card>
      </div>

      {tdoc.content ? (
        <Card>
          <CardHeader><CardTitle>说明</CardTitle></CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: tdoc.content }} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>题目列表</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-20 text-right">通过/提交</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pids.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                    {attended ? '暂无题目' : '参加比赛后可查看题目'}
                  </TableCell>
                </TableRow>
              ) : (
                pids.map((pid, i) => {
                  const p = pdict[String(pid)] || {};
                  const ps = psdict[String(pid)];
                  return (
                    <TableRow key={String(pid)}>
                      <TableCell className="font-mono text-muted-foreground">{String.fromCharCode(65 + i)}</TableCell>
                      <TableCell>
                        <a href={`${replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId) })}/p/${pid}`} className="font-medium hover:text-primary hover:underline">
                          {p.title || `Problem ${pid}`}
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {p.nAccept || 0}/{p.nSubmit || 0}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function ContestScoreboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const rows: R[] = data.rows || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={bs.urls.contests} className="hover:text-primary">比赛</a>
          <ChevronRight className="size-3" />
          <a
            href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId) })}
            className="hover:text-primary"
          >
            {tdoc.title || '比赛'}
          </a>
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-xl font-semibold">排行榜</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead className="w-20 text-right">总分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.user || row.uname || `#${row.uid}`}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{row.score || row.totalScore || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无排行数据</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
