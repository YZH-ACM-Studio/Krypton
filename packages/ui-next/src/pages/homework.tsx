import { motion } from 'motion/react';
import { Users, ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';

type R = Record<string, any>;

function hwState(h: R) {
  const now = Date.now();
  const dl = toDate(h.penaltySince)?.getTime() || 0;
  const hard = toDate(h.endAt)?.getTime() || 0;
  if (!dl) return { label: '待开放', variant: 'secondary' as const };
  if (now < dl) return { label: '进行中', variant: 'default' as const };
  if (hard && now < hard) return { label: '宽限期', variant: 'outline' as const };
  return { label: '已结束', variant: 'secondary' as const };
}

export function HomeworkPage() {
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
          <h1 className="text-xl font-semibold">作业</h1>
          <p className="text-sm text-muted-foreground">课程作业列表</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.homework}/create`}>创建作业</a>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>作业名称</TableHead>
                <TableHead className="w-44">截止时间</TableHead>
                <TableHead className="w-20 text-center">参与</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    暂无作业
                  </TableCell>
                </TableRow>
              ) : (
                tdocs.map((h) => {
                  const st = hwState(h);
                  return (
                    <TableRow key={String(h.docId)}>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(h.docId) })}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {h.title || '未命名作业'}
                        </a>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatDateTime(h.penaltySince || h.endAt, locale)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                          <Users className="size-3" />{h.attend || 0}
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

      <Pagination current={page} total={tpcount} baseUrl={bs.urls.homework} />
    </motion.div>
  );
}

export function HomeworkDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pids: (string | number)[] = data.pids || tdoc.pids || [];
  const pdict: Record<string, R> = data.pdict || {};
  const st = hwState(tdoc);
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={bs.urls.homework} className="hover:text-primary">作业</a>
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-2xl font-bold">{tdoc.title || '作业'}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant={st.variant}>{st.label}</Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">截止时间</p>
            <p className="mt-1 font-medium">{formatDateTime(tdoc.penaltySince, locale)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">硬截止</p>
            <p className="mt-1 font-medium">{formatDateTime(tdoc.endAt, locale)}</p>
          </CardContent>
        </Card>
      </div>

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
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">暂无题目</TableCell>
                </TableRow>
              ) : (
                pids.map((pid, i) => {
                  const p = pdict[String(pid)] || {};
                  return (
                    <TableRow key={String(pid)}>
                      <TableCell className="font-mono text-muted-foreground">{String.fromCharCode(65 + i)}</TableCell>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}
                          className="font-medium hover:text-primary hover:underline"
                        >
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
