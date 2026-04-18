import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: '等待评测', color: 'text-muted-foreground' },
  1: { label: 'Accepted', color: 'text-green-600 dark:text-green-400' },
  2: { label: 'Wrong Answer', color: 'text-red-600 dark:text-red-400' },
  3: { label: 'Time Limit', color: 'text-yellow-600 dark:text-yellow-400' },
  4: { label: 'Memory Limit', color: 'text-orange-600 dark:text-orange-400' },
  5: { label: 'Output Limit', color: 'text-orange-600 dark:text-orange-400' },
  6: { label: 'Runtime Error', color: 'text-purple-600 dark:text-purple-400' },
  7: { label: 'Compile Error', color: 'text-blue-600 dark:text-blue-400' },
  8: { label: 'System Error', color: 'text-gray-600 dark:text-gray-400' },
  9: { label: 'Canceled', color: 'text-gray-500' },
  10: { label: '部分正确', color: 'text-yellow-600 dark:text-yellow-400' },
  20: { label: '评测中', color: 'text-blue-500' },
  30: { label: '编译中', color: 'text-blue-500' },
};

function statusDisplay(status: number | undefined) {
  const s = STATUS_MAP[status || 0] || { label: `Status ${status}`, color: 'text-muted-foreground' };
  return <span className={`text-sm font-medium ${s.color}`}>{s.label}</span>;
}

export function RecordsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const rdocs: R[] = data.rdocs || [];
  const page = Number(data.page) || 1;
  const rpcount = Number(data.rpcount) || 1;
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <h1 className="text-xl font-semibold">评测记录</h1>
        <p className="text-sm text-muted-foreground">所有提交记录</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">状态</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-28">用户</TableHead>
                <TableHead className="w-20 text-center">语言</TableHead>
                <TableHead className="w-24 text-right">得分</TableHead>
                <TableHead className="w-24 text-right">时间</TableHead>
                <TableHead className="w-28 text-right">提交时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    暂无提交记录
                  </TableCell>
                </TableRow>
              ) : (
                rdocs.map((r) => {
                  const user = getUser(bs.udict, r.uid);
                  return (
                    <TableRow key={String(r._id)}>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.recordDetail, { RID: String(r._id) })}
                          className="hover:underline"
                        >
                          {statusDisplay(r.status)}
                        </a>
                      </TableCell>
                      <TableCell>
                        <a
                          href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(r.pid) })}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {r.pid}
                        </a>
                      </TableCell>
                      <TableCell className="text-sm">
                        {user?.uname || `#${r.uid}`}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-[10px]">{r.lang || '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.score != null ? (
                          <span className={r.score === 100 ? 'font-medium text-green-600 dark:text-green-400' : ''}>
                            {r.score}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {r.time != null ? `${r.time}ms` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelativeTime(r._id || r.judgeAt, locale)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination current={page} total={rpcount} baseUrl={bs.urls.records} />
    </motion.div>
  );
}

export function RecordDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const rdoc: R = data.rdoc || {};
  const pdoc: R = data.pdoc || {};
  const code = data.code || rdoc.code || '';
  const locale = bs.locale;
  const user = getUser(bs.udict, rdoc.uid);
  const cases: R[] = rdoc.testCases || rdoc.cases || [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={bs.urls.records} className="hover:text-primary">记录</a>
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-xl font-semibold">
          提交记录 #{String(rdoc._id).slice(-8)}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">状态</p>
            <div className="mt-1">{statusDisplay(rdoc.status)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">得分</p>
            <p className="mt-1 text-xl font-semibold">{rdoc.score ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">用时 / 内存</p>
            <p className="mt-1 text-sm font-medium">
              {rdoc.time != null ? `${rdoc.time}ms` : '—'} / {rdoc.memory != null ? `${Math.round(rdoc.memory / 1024)}MB` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">题目 / 用户</p>
            <p className="mt-1 text-sm">
              <a href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(rdoc.pid) })} className="font-medium hover:text-primary">
                {pdoc.title || rdoc.pid}
              </a>
              <span className="text-muted-foreground"> · {user?.uname || `#${rdoc.uid}`}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {cases.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-20 text-right">得分</TableHead>
                  <TableHead className="w-24 text-right">时间</TableHead>
                  <TableHead className="w-24 text-right">内存</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>{statusDisplay(c.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.score ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{c.time != null ? `${c.time}ms` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{c.memory != null ? `${Math.round(c.memory / 1024)}KB` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {code ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">代码</span>
              <Badge variant="outline">{rdoc.lang || '未知语言'}</Badge>
            </div>
            <pre className="overflow-auto p-4 text-sm leading-relaxed">
              <code>{code}</code>
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}
