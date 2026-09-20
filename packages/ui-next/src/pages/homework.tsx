import { motion } from 'motion/react';
import { Users, ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';

interface HomeworkDocument {
  docId?: string | number;
  title?: string;
  penaltySince?: unknown;
  endAt?: unknown;
  attend?: number;
  pids?: Array<string | number>;
  content?: string;
}

interface HomeworkProblem {
  title?: string;
  nAccept?: number;
  nSubmit?: number;
}

interface HomeworkPageData {
  tdocs?: HomeworkDocument[];
  tdoc?: HomeworkDocument;
  page?: string | number;
  tpcount?: string | number;
  pids?: Array<string | number>;
  pdict?: Record<string, HomeworkProblem>;
  canGradeSubjective?: boolean;
  canEditHomework?: boolean;
  canDeleteHomework?: boolean;
}

function hwState(h: HomeworkDocument) {
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
  const data = bs.page.data as HomeworkPageData;
  const tdocs = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const locale = bs.locale;

  return (
    <motion.div className="space-y-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">作业</h1>
          <p className="text-sm text-muted-foreground">课程作业列表</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.homework}/create`}>创建作业</a>
        </Button>
      </div>

      {tdocs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">暂无作业</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:hidden">
            {tdocs.map((h) => {
              const st = hwState(h);
              return (
                <a
                  key={String(h.docId)}
                  href={replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(h.docId) })}
                  className="block rounded-xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 break-words text-sm font-medium">{h.title || '未命名作业'}</h2>
                    <Badge variant={st.variant} className="shrink-0">
                      {st.label}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatDateTime(h.penaltySince || h.endAt, locale)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" />
                      {h.attend || 0}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
          <Card className="hidden sm:block">
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
                  {tdocs.map((h) => {
                    const st = hwState(h);
                    return (
                      <TableRow key={String(h.docId)}>
                        <TableCell className="min-w-0">
                          <a
                            href={replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(h.docId) })}
                            className="break-words font-medium hover:text-primary hover:underline"
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
                            <Users className="size-3" />
                            {h.attend || 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Pagination current={page} total={tpcount} baseUrl={bs.urls.homework} />
    </motion.div>
  );
}

export function HomeworkDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as HomeworkPageData;
  const tdoc = data.tdoc || {};
  const pids: (string | number)[] = data.pids || tdoc.pids || [];
  const pdict = data.pdict || {};
  const st = hwState(tdoc);
  const locale = bs.locale;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={bs.urls.homework} className="hover:text-primary">
              作业
            </a>
            <ChevronRight className="size-3 shrink-0" />
          </div>
          <h1 className="mt-1 min-w-0 break-words text-2xl font-bold">{tdoc.title || '作业'}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {data.canEditHomework ? (
            <Button asChild variant="outline">
              <a href={`/homework/${String(tdoc.docId)}/edit`}>编辑作业</a>
            </Button>
          ) : null}
          {data.canDeleteHomework ? (
            <Button asChild variant="outline">
              <a href={`/homework/${String(tdoc.docId)}/file`}>文件</a>
            </Button>
          ) : null}
          {data.canGradeSubjective ? (
            <Button asChild variant="outline">
              <a href={`/manage/grading/${String(tdoc.docId)}`}>主观题阅卷</a>
            </Button>
          ) : null}
          {data.canDeleteHomework ? (
            <form
              method="post"
              action={`/homework/${String(tdoc.docId)}/edit`}
              onSubmit={(event) => {
                void confirmFormSubmit(event, '确定要删除此作业吗？', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="destructive">
                删除
              </Button>
            </form>
          ) : null}
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

      {tdoc.content ? (
        <Card>
          <CardHeader>
            <CardTitle>作业说明</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownView content={tdoc.content} className="prose prose-sm dark:prose-invert max-w-[80ch]" />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>题目列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pids.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">暂无题目</p>
          ) : (
            <>
              <div className="grid gap-3 p-4 sm:hidden">
                {pids.map((pid, i) => {
                  const p = pdict[String(pid)] || {};
                  return (
                    <a
                      key={String(pid)}
                      href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                        <p className="mt-0.5 break-words text-sm font-medium">{p.title || `Problem ${pid}`}</p>
                      </div>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {p.nAccept || 0}/{p.nSubmit || 0}
                      </span>
                    </a>
                  );
                })}
              </div>
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>题目</TableHead>
                      <TableHead className="w-20 text-right">通过/提交</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pids.map((pid, i) => {
                      const p = pdict[String(pid)] || {};
                      return (
                        <TableRow key={String(pid)}>
                          <TableCell className="font-mono text-muted-foreground">{String.fromCharCode(65 + i)}</TableCell>
                          <TableCell className="min-w-0">
                            <a
                              href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}
                              className="break-words font-medium hover:text-primary hover:underline"
                            >
                              {p.title || `Problem ${pid}`}
                            </a>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {p.nAccept || 0}/{p.nSubmit || 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
