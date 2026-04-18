import { motion } from 'motion/react';
import { Search, ChevronRight, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function statusIcon(status: number | undefined) {
  if (status === 1) return <CheckCircle2 className="size-4 text-green-500" />;
  if (status === 2) return <XCircle className="size-4 text-red-500" />;
  if (status === 3) return <MinusCircle className="size-4 text-yellow-500" />;
  return null;
}

function difficultyBadge(d: number | undefined) {
  if (!d) return null;
  const colors: Record<number, string> = {
    1: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    2: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    3: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    4: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    5: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };
  const labels: Record<number, string> = { 1: '入门', 2: '普及', 3: '提高', 4: '省选', 5: 'NOI' };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${colors[d] || ''}`}>
      {labels[d] || `Lv${d}`}
    </span>
  );
}

export function ProblemsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdocs: R[] = data.pdocs || [];
  const page = Number(data.page) || 1;
  const ppcount = Number(data.ppcount) || 1;
  const pcount = Number(data.pcount) || pdocs.length;
  const category = data.category || '';
  const psdict: Record<string, R> = data.psdict || {};
  const query = data.query || data.q || '';

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">题库</h1>
          <p className="text-sm text-muted-foreground">共 {pcount} 道题目</p>
        </div>
        <form className="flex gap-2" method="get" action={bs.urls.problems}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={query} placeholder="搜索题目…" className="w-56 pl-8" />
          </div>
          <Button type="submit" size="sm">搜索</Button>
        </form>
      </div>

      {category ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">分类:</span>
          <Badge variant="secondary">{category}</Badge>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">状态</TableHead>
                <TableHead className="w-24">编号</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-20 text-center">难度</TableHead>
                <TableHead className="w-20 text-right">通过率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    没有找到题目
                  </TableCell>
                </TableRow>
              ) : (
                pdocs.map((p) => {
                  const ps = psdict[String(p.docId)] || psdict[String(p._id)];
                  const nSubmit = p.nSubmit || 0;
                  const nAccept = p.nAccept || 0;
                  const rate = nSubmit > 0 ? Math.round((nAccept / nSubmit) * 100) : 0;
                  return (
                    <TableRow key={String(p.docId || p._id)}>
                      <TableCell>{statusIcon(ps?.status)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.pid || p.docId}
                      </TableCell>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.pid || p.docId) })}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {p.title || '未命名'}
                        </a>
                        {p.tag?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(p.tag as string[]).slice(0, 4).map((t: string) => (
                              <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center">{difficultyBadge(p.difficulty)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        <span className="text-green-600 dark:text-green-400">{nAccept}</span>
                        <span className="text-muted-foreground">/{nSubmit}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({rate}%)</span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination current={page} total={ppcount} baseUrl={bs.urls.problems} />
    </motion.div>
  );
}

export function ProblemDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const title = pdoc.title || pdoc.pid || '题目';
  const content = data.content || pdoc.content || '';
  const nSubmit = pdoc.nSubmit || 0;
  const nAccept = pdoc.nAccept || 0;
  const tags: string[] = pdoc.tag || [];
  const pid = pdoc.pid || pdoc.docId || '';

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={bs.urls.problems} className="hover:text-primary">题库</a>
            <ChevronRight className="size-3" />
            <span>{pid}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold">{title}</h1>
          {tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <a href={`${replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}/submit`}>
              提交代码
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">{nSubmit}</p>
            <p className="text-xs text-muted-foreground">提交次数</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums text-green-600">{nAccept}</p>
            <p className="text-xs text-muted-foreground">通过次数</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {nSubmit > 0 ? Math.round((nAccept / nSubmit) * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground">通过率</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none p-6">
          {content ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <p className="text-muted-foreground">题目内容加载中…</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
