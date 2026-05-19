import { motion } from 'motion/react';
import { ChevronRight, Download, Filter, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, replaceRouteTokens, toDate } from '@/lib/format';

type R = Record<string, any>;
type SubtaskView = R & { id: string };

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: '等待评测', color: 'text-muted-foreground' },
  1: { label: 'Accepted', color: 'text-green-600 dark:text-green-400' },
  2: { label: 'Wrong Answer', color: 'text-red-600 dark:text-red-400' },
  3: { label: 'Time Exceeded', color: 'text-yellow-600 dark:text-yellow-400' },
  4: { label: 'Memory Exceeded', color: 'text-orange-600 dark:text-orange-400' },
  5: { label: 'Output Exceeded', color: 'text-orange-600 dark:text-orange-400' },
  6: { label: 'Runtime Error', color: 'text-purple-600 dark:text-purple-400' },
  7: { label: 'Compile Error', color: 'text-blue-600 dark:text-blue-400' },
  8: { label: 'System Error', color: 'text-gray-600 dark:text-gray-400' },
  9: { label: 'Canceled', color: 'text-gray-500' },
  10: { label: 'Unknown Error', color: 'text-red-600 dark:text-red-400' },
  11: { label: 'Hacked', color: 'text-red-600 dark:text-red-400' },
  20: { label: 'Running', color: 'text-blue-500' },
  21: { label: 'Compiling', color: 'text-blue-500' },
  22: { label: 'Fetched', color: 'text-blue-500' },
  30: { label: 'Ignored', color: 'text-gray-500' },
  31: { label: 'Format Error', color: 'text-gray-500' },
  32: { label: 'Hack Successful', color: 'text-green-600 dark:text-green-400' },
  33: { label: 'Hack Unsuccessful', color: 'text-red-600 dark:text-red-400' },
};

function statusDisplay(status: number | undefined) {
  const code = typeof status === 'number' ? status : 0;
  const s = STATUS_MAP[code] || { label: `Status ${status}`, color: 'text-muted-foreground' };
  return <span className={`text-sm font-medium ${s.color}`}>{s.label}</span>;
}

function statusLabel(status: number | string, statusTexts: R) {
  const value = statusTexts[String(status)] ?? statusTexts[Number(status)];
  if (typeof value === 'string') return value;
  const fallback = STATUS_MAP[Number(status)];
  return fallback?.label || `Status ${status}`;
}

function formatMemory(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const kib = value;
  if (kib < 1024) return `${Math.round(kib * 10) / 10} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib * 10) / 10} MiB`;
  return `${Math.round((mib / 1024) * 10) / 10} GiB`;
}

function formatTime(value: unknown, status?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const limited = status === 3 || status === 4 || status === 5;
  return `${limited ? '≥ ' : ''}${Math.round(value)}ms`;
}

function toRecordDate(value: unknown) {
  const date = toDate(value);
  if (date) return date;
  if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) {
    return new Date(parseInt(value.slice(0, 8), 16) * 1000);
  }
  return null;
}

function formatRecordTime(value: unknown, locale: string) {
  const date = toRecordDate(value);
  return date ? formatRelativeTime(date, locale) : '—';
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function formatJudgeText(text: unknown): string {
  if (text == null || text === '') return '';
  if (typeof text === 'string') return text;
  if (typeof text === 'number' || typeof text === 'boolean') return String(text);
  if (typeof text === 'object') {
    const item = text as R;
    const message = item.message ?? item.msg ?? item.text ?? '';
    const params = Array.isArray(item.params) ? item.params.map((p) => String(p)) : [];
    const template = String(message);
    const formatted = params.reduce((current, param, index) => current.replaceAll(`{${index}}`, param), template);
    const suffix = /\{\d+\}/.test(template) ? '' : params.join(' ');
    const stack = import.meta.env.DEV && item.stack ? `\n${String(item.stack)}` : '';
    return [formatted, suffix].filter(Boolean).join(' ').concat(stack).trim();
  }
  return '';
}

function collectTexts(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source.map(formatJudgeText).filter(Boolean);
}

function normalizeSubtasks(value: unknown): SubtaskView[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      ...(typeof item === 'object' && item ? item as R : {}),
      id: String((typeof item === 'object' && item ? (item as R).id : undefined) ?? index + 1),
    }));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, R>).map(([id, item]) => ({ ...(item || {}), id }));
  }
  return [];
}

function DiagnosticCard({ title, texts }: { title: string; texts: string[] }) {
  if (!texts.length) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground">
          {texts.join('\n')}
        </pre>
      </CardContent>
    </Card>
  );
}

export function RecordsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const rdocs: R[] = data.rdocs || [];
  const page = Number(data.page) || 1;
  const locale = bs.locale;
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = { ...bs.udict, ...(data.udict || {}) };
  const langs: R = data.langs || {};
  const statusTexts: R = data.statusTexts || {};
  const filterStatus = typeof data.filterStatus === 'number' ? String(data.filterStatus) : '';
  const filterParams = {
    uidOrName: data.filterUidOrName || '',
    pid: data.filterPid || '',
    tid: data.filterTid || '',
    lang: data.filterLang || '',
    status: filterStatus,
    all: data.all ? '1' : '',
    allDomain: data.allDomain ? '1' : '',
    stat: data.statistics ? '1' : '',
  };
  const nextUrl = buildUrlWithQuery(bs.urls.records, { ...filterParams, page: page + 1 });
  const prevUrl = buildUrlWithQuery(bs.urls.records, { ...filterParams, page: page - 1 });
  const statistics: R | null = data.statistics || null;
  const languageOptions = Object.entries(langs);
  const statusOptions: Array<[string, string]> = Object.keys(statusTexts).length
    ? Object.keys(statusTexts).map((key) => [key, statusLabel(key, statusTexts)])
    : Object.entries(STATUS_MAP).map(([key, value]) => [key, value.label]);

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
        <CardContent className="p-4">
          <form method="get" action={bs.urls.records} className="grid gap-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">用户 / UID</label>
              <Input name="uidOrName" defaultValue={data.filterUidOrName || ''} placeholder="用户名或 UID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">题目</label>
              <Input name="pid" defaultValue={data.filterPid || ''} placeholder="题号" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">比赛</label>
              <Input name="tid" defaultValue={data.filterTid || ''} placeholder="比赛 ID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">语言</label>
              <select
                name="lang"
                defaultValue={data.filterLang || ''}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">全部语言</option>
                {languageOptions.map(([key, value]) => (
                  <option key={key} value={key}>
                    {String((value as R)?.display || (value as R)?.name || key)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">状态</label>
              <select
                name="status"
                defaultValue={filterStatus}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">全部提交</option>
                {statusOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">
                <Filter className="size-4" />
                筛选
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={bs.urls.records}>
                  <RotateCcw className="size-4" />
                  重置
                </a>
              </Button>
            </div>
            <div className="lg:col-span-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="all" value="1" defaultChecked={!!data.all} className="size-3.5 rounded border accent-primary" />
                包含比赛记录
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="allDomain" value="1" defaultChecked={!!data.allDomain} className="size-3.5 rounded border accent-primary" />
                全站域记录
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="stat" value="1" defaultChecked={!!statistics} className="size-3.5 rounded border accent-primary" />
                显示统计
              </label>
            </div>
          </form>
        </CardContent>
      </Card>

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
                <TableHead className="w-24 text-right">内存</TableHead>
                <TableHead className="w-28 text-right">提交时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    暂无提交记录
                  </TableCell>
                </TableRow>
              ) : (
                rdocs.map((r) => {
                  const user = getUser(udict, r.uid);
                  const pdoc = pdict[String(r.pid)] || {};
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
                          {pdoc.title ? `${r.pid}. ${pdoc.title}` : r.pid}
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
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {formatMemory(r.memory)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRecordTime(r._id || r.judgeAt, locale)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <a href={prevUrl}>上一页</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>上一页</Button>
        )}
        <span className="text-xs text-muted-foreground">第 {page} 页</span>
        {rdocs.length ? (
          <Button asChild variant="outline" size="sm">
            <a href={nextUrl}>下一页</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>下一页</Button>
        )}
      </div>

      {statistics ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Search className="size-4 text-primary" />
              评测统计
            </div>
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {[
                ['5 分钟', 'd5min'],
                ['1 小时', 'd1h'],
                ['今日', 'day'],
                ['本周', 'week'],
                ['本月', 'month'],
                ['今年', 'year'],
                ['总计', 'total'],
              ].map(([label, key]) => (
                <div key={key} className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="font-mono text-sm font-medium">{statistics[key] ?? 0}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
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
  const compilerTexts = collectTexts(rdoc.compilerTexts);
  const judgeTexts = collectTexts(rdoc.judgeTexts);
  const subtasks = normalizeSubtasks(rdoc.subtasks);
  const allRevs = Object.entries(data.allRevs || {}) as Array<[string, string]>;
  const recordUrl = replaceRouteTokens(bs.urls.recordDetail, { RID: String(rdoc._id) });
  const downloadUrl = `${recordUrl}?download=true`;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={bs.urls.records} className="hover:text-primary">记录</a>
            <ChevronRight className="size-3" />
          </div>
          <h1 className="mt-1 text-xl font-semibold">
            提交记录 #{String(rdoc._id).slice(-8)}
          </h1>
        </div>
        {(code || rdoc.files?.code || rdoc.files?.hack) ? (
          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={downloadUrl}>
              <Download className="size-4" />
              {rdoc.files?.hack ? '下载 Hack 输入' : '下载代码'}
            </a>
          </Button>
        ) : null}
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
              {formatTime(rdoc.time, rdoc.status)} / {formatMemory(rdoc.memory)}
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

      <Card>
        <CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">语言</p>
            <p className="mt-1 font-medium">{rdoc.lang || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">提交时间</p>
            <p className="mt-1 font-medium">{formatRecordTime(rdoc._id, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">评测时间</p>
            <p className="mt-1 font-medium">{rdoc.judgeAt ? formatRecordTime(rdoc.judgeAt, locale) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">进度</p>
            <p className="mt-1 font-medium">{rdoc.progress != null ? `${Math.trunc(Number(rdoc.progress))}%` : '—'}</p>
          </div>
        </CardContent>
      </Card>

      <DiagnosticCard title="编译输出" texts={compilerTexts} />
      <DiagnosticCard title="评测输出" texts={judgeTexts} />

      {subtasks.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-medium">子任务</div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">#{subtask.id}</span>
                    {statusDisplay(subtask.status)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>得分 {subtask.score ?? '—'}</span>
                    {subtask.type ? <Badge variant="outline" className="text-[10px]">{subtask.type}</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                {cases.map((c, i) => {
                  const message = formatJudgeText(c.message);
                  const subtaskId = c.subtaskId ?? c.subtask;
                  const caseId = c.id ?? i + 1;
                  return (
                    <TableRow key={`${subtaskId ?? 'case'}-${caseId}-${i}`}>
                      <TableCell className="text-muted-foreground">
                        {subtaskId != null ? `${subtaskId}-${caseId}` : caseId}
                      </TableCell>
                      <TableCell>
                        <div>{statusDisplay(c.status)}</div>
                        {message ? (
                          <p className="mt-1 max-w-xl whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                            {message}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.score ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatTime(c.time, c.status)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatMemory(c.memory)}</TableCell>
                    </TableRow>
                  );
                })}
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

      {allRevs.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-medium">历史版本</div>
            <div className="divide-y">
              <a href={recordUrl} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent">
                <span>最新版本</span>
                {!data.rev ? <Badge variant="outline">当前</Badge> : null}
              </a>
              {allRevs.map(([rev, time]) => (
                <a key={rev} href={`${recordUrl}?rev=${rev}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent">
                  <span>{formatRecordTime(time, locale)}</span>
                  {String(data.rev || '') === rev ? <Badge variant="outline">当前</Badge> : null}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}
